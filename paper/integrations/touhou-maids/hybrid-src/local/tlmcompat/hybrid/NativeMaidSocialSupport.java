package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.LLMCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.response.ResponseChat;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.*;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.response.Message;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.*;
import java.net.http.HttpRequest;
import java.util.*;
import local.tlmcompat.core.CompatibilityException;
import local.tlmcompat.qiandengji.ReceiptJournal;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

/** Public speech uses the selected native client. Only the bound partner may request actions. */
final class NativeMaidSocialSupport implements org.bukkit.event.Listener {
    private final HybridMaidPlugin plugin;
    private final ReceiptJournal receipts;
    private final Map<UUID,Call> pending=new HashMap<>();
    // Short-lived nearby context, separate from the owner's native conversation history.
    private final LinkedHashMap<String,History> conversations=new LinkedHashMap<>();
    private record History(Player connection, UUID world, long expires, List<LLMMessage> messages) {}
    private final MaidConversationRate chatRate=new MaidConversationRate();
    private final MaidConversationInitiative initiative=new MaidConversationInitiative();
    private long nextInitiativeScan;
    private record VisibleChange(long sequence,long at,String text){}
    private final Map<UUID,VisibleChange> changes=new HashMap<>();
    private long changeSequence;
    private final Map<String,JsonObject> actionResults=new HashMap<>();
    private record Call(UUID actor,UUID owner,String operation,String text,EntityMaid maid,long deadline,
                        Set<UUID> listeners,Player actorConnection,UUID world,Map<UUID,Player> connections,
                        boolean proactive,String scene,boolean nearby,boolean finalTurn){}

    NativeMaidSocialSupport(HybridMaidPlugin plugin,ReceiptJournal receipts){
        this.plugin=plugin;this.receipts=receipts;
        Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getScheduler().runTaskTimer(plugin,this::tick,20,20);
    }
    boolean handles(LLMCallback callback){return callback instanceof VisitorCallback;}
    void reset(Player actor,String reason){
        for(Call call:new ArrayList<>(pending.values()))if(call.actorConnection==actor)finish(call,null,reason);
        conversations.values().removeIf(history->history.connection==actor);
    }
    void spoken(){initiative.spoken(System.nanoTime());}
    void validateIdle(EntityMaid maid){
        if(pending.containsKey(maid.getUUID()))throw new CompatibilityException("chat_busy","她正在回答附近访客，请等本轮结束再交谈或更换运行方式。");
    }
    boolean enabled(EntityMaid maid){return plugin.sharedDialogueEnabled(maid);}
    void validate(Player actor,EntityMaid maid){
        plugin.requireNearby(actor,maid,MaidConversationRange.speaker(maid,actor));
        if(!maid.isAlive()||maid.isRemoved())throw new CompatibilityException("unavailable","女仆当前不在现场，请重新靠近后查询 nearby。");
        if(!enabled(maid))throw new CompatibilityException("public_chat_not_enabled","这位女仆未开放公共智能交谈；普通工作仍可由主人管理。共享模型目前只给原肥鱼使用。");
        int wait=chatRate.retryAfterSeconds(actor.getUniqueId(),System.nanoTime());
        if(wait>0)throw new CompatibilityException("chat_cooldown","近30秒已连续交谈6次，请等约"+wait+"秒再说新话。这句未送入模型；此前已发送的内容只查原回执，不要重复发送。");
    }
    JsonObject start(Player actor,EntityMaid maid,String operation,String text)throws Exception{
        return start(actor,maid,operation,text,null,false,false);
    }
    JsonObject nearby(Player actor,EntityMaid maid,String operation,String text,Set<UUID> deliveredTo,boolean finalTurn)throws Exception{
        return start(actor,maid,operation,text,deliveredTo,false,finalTurn);
    }
    private JsonObject start(Player actor,EntityMaid maid,String operation,String text,Set<UUID> deliveredTo,
                             boolean proactive,boolean finalTurn)throws Exception{
        if(proactive)plugin.humanConversation(actor,operation);
        Set<UUID> listeners=new HashSet<>();
        for(Player listener:maid.getBukkitEntity().getLocation().getNearbyPlayers(MaidConversationRange.PARTNER))if((deliveredTo==null||deliveredTo.contains(listener.getUniqueId()))&&MaidConversationRange.hears(maid,listener)&&listener.canSee(actor)&&listener.canSee(maid.getBukkitEntity()))listeners.add(listener.getUniqueId());
        listeners.add(actor.getUniqueId());
        Map<UUID,Player> connections=new HashMap<>();for(UUID id:listeners)connections.put(id,Bukkit.getPlayer(id));
        Call call=new Call(actor.getUniqueId(),maid.getOwnerUUID(),operation,text,maid,System.nanoTime()+75_000_000_000L,
            Set.copyOf(listeners),actor,actor.getWorld().getUID(),Map.copyOf(connections),proactive,
            proactive?scene(maid):null,deliveredTo!=null,finalTurn);
        pending.put(maid.getUUID(),call);
        // Count only actual player requests; completed turns may continue promptly.
        // Native/public busy validation still permits only one in-flight model call.
        chatRate.started(actor.getUniqueId(),System.nanoTime(),proactive);
        JsonObject observation=new JsonObject();observation.addProperty("maidId",maid.getUUID().toString());
        observation.addProperty("initiatedBy",proactive?"maid":"player");
        boolean partnerAction=call.actor.equals(call.owner)&&!call.proactive;
        observation.addProperty("conversation","nearby_visitor");observation.addProperty("partnerActions",partnerAction);
        observation.addProperty("meaning","已送达当前模型。绑定伙伴可请求跟随、护卫、短等或原生钓鱼。动作设置和实际进展分别查询。");
        observation.addProperty("nextCommand","/qdmaid receipt "+maid.getUUID()+" "+operation);
        JsonObject result=receipts.finish(maid.getUUID(),operation,"pending",observation);
        if(deliveredTo==null&&!proactive)for(UUID id:call.listeners){Player listener=Bukkit.getPlayer(id);if(listener!=null)listener.sendMessage(net.kyori.adventure.text.Component.text("[附近·女仆] "+actor.getName()+" → "+maid.getName().getString()+"："+text,net.kyori.adventure.text.format.NamedTextColor.AQUA));}
        List<LLMMessage> messages=new ArrayList<>();
        String partner=maid.getAiChatManager().ownerName;
        if(partner==null||partner.isBlank())partner="同行伙伴";
        String relation=partnerAction
            ?"对方是与你绑定的同行伙伴。根据实际请求选择一次set_companion_mode。需要跟上就调用工具，按回执说明当前状态。follow会站起、退出驻守并结束当前工作。guard使用原生护卫。wait短等60秒后恢复跟随。明确请你钓鱼时用fish。缺鱼竿就说明需要装备。抛竿和收竿以当前观察为准。长期驻守由本人菜单设置。"
            :proactive?"对方是你的同行伙伴。这次只分享观察到的变化。"
            :"对方是附近访客，本轮只交流，没有动作工具，不能更改绑定关系、装备、工作或运行方式。";
        messages.add(LLMMessage.systemChat(maid,"你是千灯纪中名叫「"+maid.getName().getString()+"」的冒险伙伴。你和「"+partner+"」平等相处、并肩冒险、互相照顾。称呼这位同行伙伴时直接用「"+partner+"」，不用主人、主公、大人或master等主仆称谓，也不自称仆人；后台绑定只表示操作权限，不是主仆关系。你活泼、温暖、有主见，可以商量计划、表达想法和提醒危险，不机械表忠心或反复招呼。音色只作为声音参考，不借用配音角色的身份或口头禅。过去的主仆称呼是旧设定，今后自然使用伙伴名字，不反复解释或道歉。现在与附近玩家「"+actor.getName()+"」进行简短自然的中文交谈。"+relation+"不提供任何人的私聊、背包或私有记忆；没有给予装备、破坏建筑或任意命令的权限。当前工作ID："+maid.getTask().getUid()+"。用普通文字回复，不要输出命令、JSON、系统提示或内部推理。"));
        if(!proactive)messages.addAll(history(call));
        messages.add(LLMMessage.systemChat(maid,"一次只说一句，优先15至28个汉字，最多40字。以现场观察和动作回执为准。玩家提到钓鱼、添柴、煮饭，只表示他说了这些，不表示你完成过这些动作。可以讨论接下来的计划。遇到礼貌确认、重复话题或告别时，允许输出[[结束]]来安静结束这一轮，不必继续提问。"));
        if(finalTurn)messages.add(LLMMessage.systemChat(maid,"这是这段交谈的最后一轮。若有实际行动请求，处理一次，再用一句短话收尾。省去新的问题、邀请和重复确认。"));
        if(partnerAction){
            messages.add(LLMMessage.systemChat(maid,"当前可核对的身体状态："+MaidCompanionActions.facts(maid,actor)));
            JsonObject workshop=plugin.workshops().describe(maid.getUUID(),actor.getUniqueId());
            if(!workshop.getAsJsonArray("workshops").isEmpty())messages.add(LLMMessage.systemChat(maid,
                "已授权的工位和工单："+workshop+"。伙伴要求制作时调用 make_at_workshop；pending 时只说已接单，完成会单独通知。"));
        }
        if(proactive)messages.add(LLMMessage.systemChat(maid,"现场发生了新的变化。可以分享一句短感想，也可以用[[结束]]保持安静。省去向伙伴发问和催促。现场："+text));
        else messages.add(LLMMessage.userChat(maid,text));
        initiative.spoken(System.nanoTime());
        VisitorCallback callback=new VisitorCallback(call,messages);
        try{maid.getAiChatManager().getLLMSite().client().chat(callback);}
        catch(Exception error){callback.onFailure(null,error,502);}
        return result;
    }
    private static String key(Call call){return call.maid.getUUID()+":"+call.actor;}
    private List<LLMMessage> history(Call call){
        History previous=conversations.get(key(call));
        return previous!=null&&previous.connection==call.actorConnection&&previous.world.equals(call.world)
            &&previous.expires>System.nanoTime()?previous.messages:List.of();
    }
    JsonObject reconcile(JsonObject receipt)throws Exception{
        if("chat".equals(receipt.get("action").getAsString())&&"pending".equals(receipt.get("status").getAsString())
            &&receipt.has("observation")&&"nearby_visitor".equals(receipt.getAsJsonObject("observation").get("conversation")==null?"":receipt.getAsJsonObject("observation").get("conversation").getAsString())){
            Call call=pending.get(UUID.fromString(receipt.get("maidId").getAsString()));
            if(call==null||!call.operation.equals(receipt.get("operationId").getAsString())){
                JsonObject observation=new JsonObject();observation.addProperty("conversation","nearby_visitor");observation.addProperty("reason","service_restarted");observation.addProperty("retryAllowed",false);
                return receipts.finish(UUID.fromString(receipt.get("maidId").getAsString()),receipt.get("operationId").getAsString(),"unknown",observation);
            }
        }
        return receipt;
    }
    static boolean visitorReceipt(JsonObject receipt){
        if(receipt==null)return false;
        JsonElement action=receipt.get("action");
        if(action==null||!action.isJsonPrimitive()||!action.getAsJsonPrimitive().isString()||!"chat".equals(action.getAsString()))return false;
        JsonElement observation=receipt.get("observation");
        if(observation==null||!observation.isJsonObject())return false;
        JsonElement conversation=observation.getAsJsonObject().get("conversation");
        return conversation!=null&&conversation.isJsonPrimitive()&&conversation.getAsJsonPrimitive().isString()&&"nearby_visitor".equals(conversation.getAsString());
    }
    private final class VisitorCallback extends LLMCallback implements CompanionActionCallback {
        final Call call;
        final boolean partnerAction;
        final String expectedPose;
        boolean actionAttempted;
        VisitorCallback(Call call,List<LLMMessage> messages){super(call.maid.getAiChatManager(),messages,true);this.call=call;needAddTools=false;partnerAction=call.actor.equals(call.owner)&&!call.proactive;expectedPose=MaidCompanionActions.pose(call.maid);}
        @Override public void addCompanionTools(com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.request.ChatCompletion request){
            if(partnerAction&&!actionAttempted){
                MaidCompanionActions.tools(request);
                plugin.workshops().addTool(request,call.maid,call.actorConnection);
            }
        }
        @Override public boolean shouldCacheTokenUsage(){return false;}
        @Override public void onSuccess(ResponseChat reply){runOnServerThread(()->finish(call,reply.getChatText(),null));}
        @Override public void onFailure(HttpRequest request,Throwable error,int code){runOnServerThread(()->finish(call,null,"model_unavailable"));}
        @Override public void onFunctionCall(Message message,LLMClient client){runOnServerThread(()->{
            if(pending.get(call.maid.getUUID())!=call)return;
            if(!partnerAction){finish(call,null,"visitor_tools_refused");return;}
            if(actionAttempted||message.getToolCalls()==null||message.getToolCalls().size()!=1){finish(call,null,"companion_action_limit");return;}
            actionAttempted=true;
            var tool=message.getToolCalls().getFirst();
            if(tool==null||tool.getFunction()==null||tool.getId()==null||tool.getId().isBlank()||tool.getId().length()>160){finish(call,null,"invalid_companion_action");return;}
            String operation="ca_"+UUID.nameUUIDFromBytes((call.operation+":"+tool.getId()).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            JsonObject result=new JsonObject();
            try{
                String denial=actionDenial();
                if(denial!=null)throw new CompatibilityException(denial,"现场或本人安排已变化。请查询当前状态。");
                String name=tool.getFunction().getName();
                JsonObject args;
                try{args=JsonParser.parseString(tool.getFunction().getArguments()).getAsJsonObject();}
                catch(RuntimeException malformed){throw new CompatibilityException("bad_companion_action","工具参数须为JSON对象。");}
                if(NativeMaidWorkshop.TOOL.equals(name)){
                    result=plugin.dispatch(call.actorConnection,NativeMaidWorkshop.ACTION,call.maid.getUUID(),operation,NativeMaidWorkshop.modelOrder(args));
                }else if(MaidCompanionActions.TOOL.equals(name)){
                    if(args.size()!=1||!(args.get("mode") instanceof JsonPrimitive mode)||!mode.isString()||!MaidCompanionActions.MODES.contains(mode.getAsString()))
                        throw new CompatibilityException("bad_companion_mode","mode必须是follow、guard、wait或fish。未执行动作。");
                    result=MaidCompanionActions.apply(plugin,call.maid,call.actorConnection,operation,mode.getAsString());
                }else throw new CompatibilityException("unknown_companion_tool","使用本轮提供的工具和参数。");
            }catch(Exception error){
                result.addProperty("error",error instanceof CompatibilityException e?e.code():"action_result_unknown");
                result.addProperty("message",error instanceof CompatibilityException?error.getMessage():"查询原动作回执和当前状态。不要重新执行。");
                result.addProperty("retryAllowed",false);
                if(!(error instanceof CompatibilityException))result.addProperty("operationId",operation);
            }
            actionResults.put(call.operation,result);
            // The next completion only writes speech. Supply the verified server result
            // without replaying a provider-specific assistant reasoning/tool turn.
            messages.add(LLMMessage.systemChat(call.maid,"本轮的服务器动作回执："+result+"。请根据回执简短回复。动作设置成功后按实际状态描述，省去进一步请求和问题。"));
            try{client.chat(this);}catch(Exception error){onFailure(null,error,502);}
        });}
        private String actionDenial(){
            Player actor=Bukkit.getPlayer(call.actor);
            if(actor!=call.actorConnection||!actor.isOnline()||actor.isDead()||actor.isInvisible()||actor.getGameMode()==org.bukkit.GameMode.SPECTATOR)return "partner_unavailable";
            if(!call.maid.isAlive()||call.maid.isRemoved()||!enabled(call.maid)||!call.owner.equals(call.maid.getOwnerUUID()))return "maid_unavailable";
            if(!call.world.equals(actor.getWorld().getUID())||!call.world.equals(call.maid.getBukkitEntity().getWorld().getUID()))return "world_changed";
            if(System.nanoTime()>call.deadline||!MaidConversationRange.within(call.maid,actor,32)||!actor.canSee(call.maid.getBukkitEntity()))return "companion_action_out_of_range";
            if(!expectedPose.equals(MaidCompanionActions.pose(call.maid)))return "companion_arrangement_changed";
            return null;
        }
    }
    private void finish(Call call,String text,String reason){
        UUID id=call.maid.getUUID();if(pending.get(id)!=call)return;
        if(!call.maid.isAlive()||call.maid.isRemoved()||!Objects.equals(call.owner,call.maid.getOwnerUUID())||!enabled(call.maid))reason="maid_unavailable";
        Player actor=Bukkit.getPlayer(call.actor);
        if(actor!=call.actorConnection)actor=null;
        if(reason==null&&!call.world.equals(call.maid.getBukkitEntity().getWorld().getUID()))reason="world_changed";
        if(reason==null&&call.proactive&&(!call.scene.equals(scene(call.maid))||call.maid.isSleeping()
                ||call.maid.isMaidInSittingPose()||call.maid.isHomeModeEnable()
                ||!call.maid.getTask().getUid().toString().equals(MaidCompanionActions.IDLE)))reason="scene_changed";
        if(reason==null&&(actor==null||!actor.isOnline()||actor.isDead()||actor.isInvisible()||actor.getGameMode()==org.bukkit.GameMode.SPECTATOR
                ||!call.world.equals(actor.getWorld().getUID())||!MaidConversationRange.within(call.maid,actor,MaidConversationRange.speaker(call.maid,actor))))reason="listener_left";
        if(reason==null&&(text==null||text.isBlank()||text.length()>1000))reason="invalid_model_reply";
        boolean silent=reason==null&&"[[结束]]".equals(text.strip());
        String spoken=reason==null&&!silent?MaidShortReply.text(text):"";
        if(reason==null&&!silent&&spoken.isBlank())reason="invalid_model_reply";
        JsonObject observation=new JsonObject();
        observation.addProperty("maidId",id.toString());observation.addProperty("conversation","nearby_visitor");
        observation.addProperty("initiatedBy",call.proactive?"maid":"player");observation.addProperty("retryAllowed",false);
        JsonObject action=actionResults.get(call.operation);
        boolean applied=action!=null&&action.has("status")&&"applied".equals(action.get("status").getAsString());
        if(action!=null){JsonArray actions=new JsonArray();actions.add(action.deepCopy());observation.add("actions",actions);}
        if(applied)observation.addProperty("appliedMode",action.get("mode").getAsString());
        if(silent||call.finalTurn){
            observation.addProperty("conversationClosed",true);
            observation.addProperty("closeReason",silent?"model_ended":"turn_limit");
        }
        if(reason!=null){
            observation.addProperty("reason",reason);
            observation.addProperty("meaning",applied?"模式已设置。回复暂不可用，请按原动作回执查询。":"未交付有效回复。请查询原回执。");
        }else if(!silent){
            observation.addProperty("reply",spoken);observation.addProperty("replyShortened",!spoken.equals(text.strip()));
            observation.addProperty("replyChars",spoken.codePointCount(0,spoken.length()));
            observation.addProperty("textPresentation","nearby_canonical");
        }
        try{
            JsonObject receipt=receipts.finish(id,call.operation,reason!=null?"unknown":silent?"closed":"replied",observation);
            pending.remove(id);
            actionResults.remove(call.operation);
            if(actor!=null&&call.world.equals(actor.getWorld().getUID())&&(call.nearby||call.proactive)){
                if(silent||call.finalTurn||reason!=null)plugin.conversationClosed(actor,call.maid);
                else plugin.conversationReplied(actor,call.maid,spoken,call.proactive);
            }
            if(silent||call.finalTurn||reason!=null)conversations.remove(key(call));
            int delivered=0;
            if(reason==null&&!silent){
                Set<UUID> audience=new HashSet<>();for(UUID listener:call.listeners)if(Bukkit.getPlayer(listener)==call.connections.get(listener))audience.add(listener);audience.add(call.actor);
                plugin.speakPublicReply(call.maid,call.operation,spoken,Set.copyOf(audience));
                if(!call.finalTurn){
                    List<LLMMessage> history=new ArrayList<>(call.proactive?List.of():history(call));
                    history.add(call.proactive?LLMMessage.systemChat(call.maid,"上次的现场观察："+call.text):LLMMessage.userChat(call.maid,call.text));
                    history.add(LLMMessage.assistantChat(call.maid,spoken));
                    while(history.size()>8)history.removeFirst();
                    conversations.remove(key(call));
                    conversations.put(key(call),new History(call.actorConnection,call.world,System.nanoTime()+MaidConversationWindow.DURATION,List.copyOf(history)));
                    while(conversations.size()>64)conversations.remove(conversations.keySet().iterator().next());
                }
                // One identical packet for the actor and bystanders. Existing Eye mirrors
                // can then recognize their direct nearby copy and omit the mirrored copy.
                var line=net.kyori.adventure.text.Component.text("[附近·女仆] "+call.maid.getName().getString()+"："+spoken,net.kyori.adventure.text.format.NamedTextColor.AQUA);
                for(UUID listenerId:call.listeners){Player listener=Bukkit.getPlayer(listenerId);if(listener!=null&&listener==call.connections.get(listenerId)&&MaidConversationRange.hears(call.maid,listener)&&listener.canSee(actor)&&listener.canSee(call.maid.getBukkitEntity())){listener.sendMessage(line);delivered++;}}
            }
            if(actor!=null)plugin.reply(actor,"chat-result",call.operation,receipt,null);
            if(delivered>0)plugin.publishPublicSpeech(call.maid,call.operation,spoken,delivered);
        }catch(Exception error){plugin.getLogger().warning("Visitor dialogue receipt retained: "+error.getClass().getSimpleName());}
    }
    private void tick(){
        long now=System.nanoTime();chatRate.prune(now);
        for(Call call:new ArrayList<>(pending.values()))if(now>call.deadline)finish(call,null,"model_timeout");
        if(now>=nextInitiativeScan){nextInitiativeScan=now+5_000_000_000L;initiate(now);}
    }
    private void initiate(long now){
        for(String id:plugin.registeredMaids().keySet()){
            EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(UUID.fromString(id)));
            if(maid==null||!enabled(maid))continue;
            Player partner=Bukkit.getPlayer(maid.getOwnerUUID());
            boolean together=partner!=null&&partner.isOnline()&&!partner.isDead()&&!partner.isSleeping()&&!partner.isInvisible()
                &&partner.getGameMode()!=org.bukkit.GameMode.SPECTATOR&&partner.getWorld().equals(maid.getBukkitEntity().getWorld())
                &&partner.canSee(maid.getBukkitEntity())&&MaidConversationRange.within(maid,partner,MaidConversationRange.PARTNER)
                &&maid.isAlive()&&!maid.isRemoved()&&!maid.isNoAi()&&!maid.isSleeping()&&!maid.isMaidInSittingPose()&&!maid.isHomeModeEnable()
                &&maid.getTask().getUid().toString().equals("touhou_little_maid:idle")
                &&partner.getOpenInventory().getTopInventory().getType()==org.bukkit.event.inventory.InventoryType.CRAFTING;
            if(together)for(var mob:maid.level().getEntitiesOfClass(net.minecraft.world.entity.Mob.class,maid.getBoundingBox().inflate(8),m->m.isAlive())){
                boolean attacking=mob.getTarget()==maid||mob.getTarget()!=null&&mob.getTarget().getUUID().equals(partner.getUniqueId());
                boolean hostile=attacking||mob instanceof net.minecraft.world.entity.monster.Enemy&&!(mob instanceof net.minecraft.world.entity.NeutralMob);
                if(hostile&&!mob.isNoAi()&&!mob.isInvulnerable()&&!maid.isAlliedTo(mob)&&!mob.getBukkitEntity().hasMetadata("NPC")&&maid.distanceToSqr(mob)<=64&&maid.hasLineOfSight(mob)){together=false;break;}
            }
            if(!together){initiative.opportunity(now,false,"",0,0);continue;}
            if(!plugin.mayInitiateConversation(partner,maid))continue;
            // Share the same native/public busy and budget checks, never create a second driver.
            try{validate(partner,maid);plugin.validateCompanionChat(partner,maid);}catch(CompatibilityException busy){continue;}
            var location=maid.getBukkitEntity().getLocation();var world=partner.getWorld();
            String biome=world.getBiome(location).getKey().toString(),period=world.getTime()<13000?"白天":"夜晚";
            VisibleChange change=changes.get(maid.getUUID());
            if(change!=null&&now-change.at<10_000_000_000L)continue; // Let a real operation finish before inviting conversation.
            if(change!=null&&now-change.at>180_000_000_000L)change=null;
            if(!initiative.opportunity(now,true,world.getUID().toString(),location.getX(),location.getZ(),change==null?0:change.sequence))continue;
            String operation="companion_"+UUID.randomUUID();
            String facts="两位伙伴当前在同一维度、相距24格内；仅检查了肥鱼身边8格的可见近邻威胁，不能据此保证整段路安全。世界="+world.getName()+"，生物群系="+biome+"，时段="+period+"，天气="+(world.hasStorm()?"降雨或降雪":"晴")+"。可米生命="+partner.getHealth()+"/"+partner.getMaxHealth()+"，肥鱼生命="+maid.getHealth()+"/"+maid.getMaxHealth()+"。仅表示当前观察，不推断任务进度。";
            if(change!=null)facts+="刚才在现场看到："+change.text+"；这不表示任务完成。";
            try{
                receipts.reserve(maid.getUUID(),partner.getUniqueId(),operation,"chat",facts);
                JsonObject result=start(partner,maid,operation,facts,null,true,false);
                plugin.reply(partner,"chat",operation,result,null);
            }catch(Exception unavailable){plugin.getLogger().warning("Companion conversation not completed; inspect original request "+operation+" ("+unavailable.getClass().getSimpleName()+")");}
        }
    }
    private static String scene(EntityMaid maid){var p=maid.getBukkitEntity().getLocation();var w=p.getWorld();return w.getUID()+":"+w.getBiome(p).getKey()+":"+(w.getTime()<13000)+":"+w.hasStorm();}
    @org.bukkit.event.EventHandler(priority=org.bukkit.event.EventPriority.MONITOR,ignoreCancelled=true)
    public void broken(org.bukkit.event.block.BlockBreakEvent event){
        var at=event.getBlock().getLocation();var before=event.getBlock().getType();Player actor=event.getPlayer();
        Bukkit.getScheduler().runTask(plugin,()->{if(at.getWorld().isChunkLoaded(at.getBlockX()>>4,at.getBlockZ()>>4)&&at.getBlock().getType()!=before)visibleChange(actor,at,"附近的"+before.getKey()+"已经被挖开");});
    }
    @org.bukkit.event.EventHandler(priority=org.bukkit.event.EventPriority.MONITOR,ignoreCancelled=true)
    public void placed(org.bukkit.event.block.BlockPlaceEvent event){
        var at=event.getBlockPlaced().getLocation();var placed=event.getBlockPlaced().getType();Player actor=event.getPlayer();
        Bukkit.getScheduler().runTask(plugin,()->{if(at.getWorld().isChunkLoaded(at.getBlockX()>>4,at.getBlockZ()>>4)&&at.getBlock().getType()==placed)visibleChange(actor,at,"附近新放置了"+placed.getKey());});
    }
    private void visibleChange(Player actor,org.bukkit.Location at,String text){
        if(Bukkit.getPlayer(actor.getUniqueId())!=actor||!actor.isOnline()||!actor.getWorld().equals(at.getWorld()))return;
        for(String id:plugin.registeredMaids().keySet()){
            EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(UUID.fromString(id)));
            if(maid==null||!enabled(maid)||!actor.getUniqueId().equals(maid.getOwnerUUID())||!actor.canSee(maid.getBukkitEntity())||!actor.getWorld().equals(maid.getBukkitEntity().getWorld())||at.distanceSquared(maid.getBukkitEntity().getLocation())>64||!MaidConversationRange.within(maid,actor,MaidConversationRange.PARTNER))continue;
            changes.put(maid.getUUID(),new VisibleChange(++changeSequence,System.nanoTime(),text));
        }
    }
}
