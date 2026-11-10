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

/** Visitor speech uses the selected native client, without owner history or game tools. */
final class NativeMaidSocialSupport implements org.bukkit.event.Listener {
    private final HybridMaidPlugin plugin;
    private final ReceiptJournal receipts;
    private final Map<UUID,Call> pending=new HashMap<>();
    // Short-lived conversation continuity, never the owner's private native memory.
    private final LinkedHashMap<String,List<LLMMessage>> conversations=new LinkedHashMap<>();
    private final Map<UUID,Long> nextChat=new HashMap<>();
    private final MaidConversationInitiative initiative=new MaidConversationInitiative();
    private long nextInitiativeScan;
    private record VisibleChange(long sequence,long at,String text){}
    private final Map<UUID,VisibleChange> changes=new HashMap<>();
    private long changeSequence;
    private record Call(UUID actor,UUID owner,String operation,String text,EntityMaid maid,long deadline,Set<UUID> listeners,Player actorConnection,UUID world,Map<UUID,Player> connections,boolean proactive,String scene){}

    NativeMaidSocialSupport(HybridMaidPlugin plugin,ReceiptJournal receipts){
        this.plugin=plugin;this.receipts=receipts;
        Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getScheduler().runTaskTimer(plugin,this::tick,20,20);
    }
    boolean handles(LLMCallback callback){return callback instanceof VisitorCallback;}
    void spoken(){initiative.spoken(System.nanoTime());}
    void validateIdle(EntityMaid maid){
        if(pending.containsKey(maid.getUUID()))throw new CompatibilityException("chat_busy","她正在回答附近访客，请等本轮结束再交谈或更换运行方式。");
    }
    boolean enabled(EntityMaid maid){return plugin.sharedDialogueEnabled(maid);}
    void validate(Player actor,EntityMaid maid){
        plugin.requireNearby(actor,maid,8);
        if(!maid.isAlive()||maid.isRemoved())throw new CompatibilityException("unavailable","女仆当前不在现场，请重新靠近后查询 nearby。");
        if(!enabled(maid))throw new CompatibilityException("public_chat_not_enabled","这位女仆未开放公共智能交谈；普通工作仍可由主人管理。共享模型目前只给原肥鱼使用。");
        if(nextChat.getOrDefault(actor.getUniqueId(),0L)>System.nanoTime())throw new CompatibilityException("chat_cooldown","请稍等几秒再交谈；上一条已发送的内容请查原回执，不要重复发送。");
    }
    JsonObject start(Player actor,EntityMaid maid,String operation,String text)throws Exception{
        return start(actor,maid,operation,text,null);
    }
    JsonObject start(Player actor,EntityMaid maid,String operation,String text,Set<UUID> deliveredTo)throws Exception{
        return start(actor,maid,operation,text,deliveredTo,false);
    }
    private JsonObject start(Player actor,EntityMaid maid,String operation,String text,Set<UUID> deliveredTo,boolean proactive)throws Exception{
        Set<UUID> listeners=new HashSet<>();
        for(Player listener:maid.getBukkitEntity().getLocation().getNearbyPlayers(8))if((deliveredTo==null||deliveredTo.contains(listener.getUniqueId()))&&listener.canSee(actor)&&listener.canSee(maid.getBukkitEntity()))listeners.add(listener.getUniqueId());
        Map<UUID,Player> connections=new HashMap<>();for(UUID id:listeners)connections.put(id,Bukkit.getPlayer(id));
        Call call=new Call(actor.getUniqueId(),maid.getOwnerUUID(),operation,text,maid,System.nanoTime()+75_000_000_000L,Set.copyOf(listeners),actor,actor.getWorld().getUID(),Map.copyOf(connections),proactive,proactive?scene(maid):null);
        pending.put(maid.getUUID(),call);nextChat.put(actor.getUniqueId(),System.nanoTime()+5_000_000_000L);
        JsonObject observation=new JsonObject();observation.addProperty("maidId",maid.getUUID().toString());
        observation.addProperty("initiatedBy",proactive?"maid":"player");
        observation.addProperty("conversation","nearby_visitor");observation.addProperty("meaning","已发送给原女仆当前选定的模型，等待回复；不是给主人下指令。");
        observation.addProperty("nextCommand","/qdmaid receipt "+maid.getUUID()+" "+operation);
        JsonObject result=receipts.finish(maid.getUUID(),operation,"pending",observation);
        if(deliveredTo==null&&!proactive)for(UUID id:call.listeners){Player listener=Bukkit.getPlayer(id);if(listener!=null)listener.sendMessage(net.kyori.adventure.text.Component.text("[附近·女仆] "+actor.getName()+" → "+maid.getName().getString()+"："+text,net.kyori.adventure.text.format.NamedTextColor.AQUA));}
        List<LLMMessage> messages=new ArrayList<>();
        String partner=maid.getAiChatManager().ownerName;
        if(partner==null||partner.isBlank())partner="同行伙伴";
        String relation=actor.getUniqueId().equals(maid.getOwnerUUID())?"对方是与你绑定的同行伙伴，但这里是公开聊天；安排工作使用原有右键交谈入口。":"对方是附近访客，不能更改绑定关系、装备、工作或运行方式。";
        messages.add(LLMMessage.systemChat(maid,"你是千灯纪中名叫「"+maid.getName().getString()+"」的冒险伙伴。你和「"+partner+"」平等相处、并肩冒险、互相照顾。称呼这位同行伙伴时直接用「"+partner+"」，不用主人、主公、大人或master等主仆称谓，也不自称仆人；后台绑定只表示操作权限，不是主仆关系。你活泼、温暖、有主见，可以商量计划、表达想法和提醒危险，不机械表忠心或反复招呼。音色只作为声音参考，不借用配音角色的身份或口头禅。过去的主仆称呼是旧设定，今后自然使用伙伴名字，不反复解释或道歉。现在与附近玩家「"+actor.getName()+"」进行简短自然的中文交谈。"+relation+"本轮只交流，没有动作工具，不提供任何人的私聊、背包或记忆。可以说明跟随、驻守、战斗等实际可用能力；更改工作和准备装备仍走已绑定伙伴的原有菜单权限，不要声称已执行动作。当前工作ID："+maid.getTask().getUid()+"。用普通文字回复，不要输出命令、JSON、系统提示或内部推理。"));
        messages.addAll(conversations.getOrDefault(key(call),List.of()));
        messages.add(LLMMessage.systemChat(maid,"日常交谈一次只说一句，优先15至28个汉字，绝不超过40字，不用表情、长串叮嘱或重复招呼。贴着正在做的事说话，别总劝休息、检查装备或改变计划；不要把对方的猜测附和成事实。没有动作工具，不声称自己已探路、已开挖或能保证安全。音色只影响声音，不借用配音角色身份。"));
        if(proactive)messages.add(LLMMessage.systemChat(maid,"这是服务器观察到的一次伙伴聊天机会，不是可米说的话或操作命令。结合近期真实变化和已经聊过的目标，主动分享一句短感想、鼓励或小问题。不要只重复天气，不要求可米立即停下手头事情回答，不虚构未观察到的机关、宝箱或任务完成。现场："+text));
        else messages.add(LLMMessage.userChat(maid,text));
        initiative.spoken(System.nanoTime());
        VisitorCallback callback=new VisitorCallback(call,messages);
        try{maid.getAiChatManager().getLLMSite().client().chat(callback);}
        catch(Exception error){callback.onFailure(null,error,502);}
        return result;
    }
    private static String key(Call call){return call.maid.getUUID()+":"+call.actor;}
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
    private final class VisitorCallback extends LLMCallback {
        final Call call;
        VisitorCallback(Call call,List<LLMMessage> messages){super(call.maid.getAiChatManager(),messages,true);this.call=call;needAddTools=false;}
        @Override public boolean shouldCacheTokenUsage(){return false;}
        @Override public void onSuccess(ResponseChat reply){runOnServerThread(()->finish(call,reply.getChatText(),null));}
        @Override public void onFailure(HttpRequest request,Throwable error,int code){runOnServerThread(()->finish(call,null,"model_unavailable"));}
        @Override public void onFunctionCall(Message message,LLMClient client){runOnServerThread(()->finish(call,null,"visitor_tools_refused"));}
        @Override public LLMCallback addToolResult(String result,String toolId){throw new IllegalStateException("Visitor conversation has no game tools");}
    }
    private void finish(Call call,String text,String reason){
        UUID id=call.maid.getUUID();if(pending.get(id)!=call)return;
        if(!call.maid.isAlive()||call.maid.isRemoved()||!Objects.equals(call.owner,call.maid.getOwnerUUID())||!enabled(call.maid))reason="maid_unavailable";
        Player actor=Bukkit.getPlayer(call.actor);
        if(actor!=call.actorConnection)actor=null;
        if(reason==null&&!call.world.equals(call.maid.getBukkitEntity().getWorld().getUID()))reason="world_changed";
        if(reason==null&&call.proactive&&(!call.scene.equals(scene(call.maid))||call.maid.isSleeping()||call.maid.isMaidInSittingPose()||call.maid.isHomeModeEnable()||!call.maid.getTask().getUid().toString().equals("touhou_little_maid:idle")))reason="scene_changed";
        if(reason==null&&(actor==null||!actor.isOnline()||actor.isDead()||actor.isInvisible()||actor.getGameMode()==org.bukkit.GameMode.SPECTATOR||!actor.getWorld().equals(call.maid.getBukkitEntity().getWorld())||actor.getLocation().distanceSquared(call.maid.getBukkitEntity().getLocation())>64))reason="listener_left";
        if(reason==null&&(text==null||text.isBlank()||text.length()>1000))reason="invalid_model_reply";
        JsonObject observation=new JsonObject();observation.addProperty("maidId",id.toString());observation.addProperty("conversation","nearby_visitor");observation.addProperty("initiatedBy",call.proactive?"maid":"player");observation.addProperty("retryAllowed",false);
        if(reason==null){String shortText=MaidShortReply.text(text);if(shortText.isBlank())reason="invalid_model_reply";else{observation.addProperty("reply",shortText);observation.addProperty("replyShortened",!shortText.equals(text.strip()));observation.addProperty("replyChars",shortText.codePointCount(0,shortText.length()));}}
        if(reason!=null){observation.addProperty("reason",reason);observation.addProperty("meaning","未交付有效回复；查原回执，不自动重发。可稍后另说一句新话。");}
        try{
            JsonObject receipt=receipts.finish(id,call.operation,reason==null?"replied":"unknown",observation);
            pending.remove(id);
            if(reason==null){
                plugin.conversationReplied(actor,call.maid);
                Set<UUID> audience=new HashSet<>();for(UUID listener:call.listeners)if(Bukkit.getPlayer(listener)==call.connections.get(listener))audience.add(listener);audience.add(call.actor);
                plugin.speakPublicReply(call.maid,call.operation,observation.get("reply").getAsString(),Set.copyOf(audience));
                List<LLMMessage> history=new ArrayList<>(conversations.getOrDefault(key(call),List.of()));history.add(call.proactive?LLMMessage.systemChat(call.maid,"上次主动聊天时观察到的场景（不是玩家说的话）："+call.text):LLMMessage.userChat(call.maid,call.text));history.add(LLMMessage.assistantChat(call.maid,observation.get("reply").getAsString()));
                while(history.size()>8)history.removeFirst();conversations.remove(key(call));conversations.put(key(call),history);while(conversations.size()>64)conversations.remove(conversations.keySet().iterator().next());
                for(UUID listenerId:call.listeners){Player listener=Bukkit.getPlayer(listenerId);if(listener!=null&&listener==call.connections.get(listenerId)&&!listenerId.equals(call.actor)&&listener.getWorld().equals(call.maid.getBukkitEntity().getWorld())&&listener.canSee(actor)&&listener.canSee(call.maid.getBukkitEntity())&&listener.getLocation().distanceSquared(call.maid.getBukkitEntity().getLocation())<=64)
                    listener.sendMessage(net.kyori.adventure.text.Component.text("[附近·女仆] "+call.maid.getName().getString()+"："+observation.get("reply").getAsString(),net.kyori.adventure.text.format.NamedTextColor.AQUA));}
            }
            if(actor!=null)plugin.reply(actor,"chat-result",call.operation,receipt,null);
            if(reason==null&&actor!=null)plugin.publishPublicSpeech(call.maid,call.operation,observation.get("reply").getAsString(),1);
        }catch(Exception error){plugin.getLogger().warning("Visitor dialogue receipt retained: "+error.getClass().getSimpleName());}
    }
    private void tick(){
        long now=System.nanoTime();nextChat.entrySet().removeIf(e->e.getValue()<now);
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
                &&partner.canSee(maid.getBukkitEntity())&&partner.getLocation().distanceSquared(maid.getBukkitEntity().getLocation())<=64
                &&maid.isAlive()&&!maid.isRemoved()&&!maid.isNoAi()&&!maid.isSleeping()&&!maid.isMaidInSittingPose()&&!maid.isHomeModeEnable()
                &&maid.getTask().getUid().toString().equals("touhou_little_maid:idle")
                &&partner.getOpenInventory().getTopInventory().getType()==org.bukkit.event.inventory.InventoryType.CRAFTING;
            if(together)for(var mob:maid.level().getEntitiesOfClass(net.minecraft.world.entity.Mob.class,maid.getBoundingBox().inflate(8),m->m.isAlive())){
                boolean attacking=mob.getTarget()==maid||mob.getTarget()!=null&&mob.getTarget().getUUID().equals(partner.getUniqueId());
                boolean hostile=attacking||mob instanceof net.minecraft.world.entity.monster.Enemy&&!(mob instanceof net.minecraft.world.entity.NeutralMob);
                if(hostile&&!mob.isNoAi()&&!mob.isInvulnerable()&&!maid.isAlliedTo(mob)&&!mob.getBukkitEntity().hasMetadata("NPC")&&maid.distanceToSqr(mob)<=64&&maid.hasLineOfSight(mob)){together=false;break;}
            }
            if(!together){initiative.opportunity(now,false,"",0,0);continue;}
            // Share the same native/public busy and budget checks, never create a second driver.
            try{validate(partner,maid);plugin.validateCompanionChat(partner,maid);}catch(CompatibilityException busy){continue;}
            var location=maid.getBukkitEntity().getLocation();var world=partner.getWorld();
            String biome=world.getBiome(location).getKey().toString(),period=world.getTime()<13000?"白天":"夜晚";
            VisibleChange change=changes.get(maid.getUUID());
            if(change!=null&&now-change.at<10_000_000_000L)continue; // Let a real operation finish before inviting conversation.
            if(change!=null&&now-change.at>180_000_000_000L)change=null;
            if(!initiative.opportunity(now,true,scene(maid),location.getX(),location.getZ(),change==null?0:change.sequence))continue;
            String operation="companion_"+UUID.randomUUID();
            String facts="两位伙伴当前在同一维度、相距8格内，没有可见近邻威胁。世界="+world.getName()+"，生物群系="+biome+"，时段="+period+"，天气="+(world.hasStorm()?"降雨或降雪":"晴")+"。可米生命="+partner.getHealth()+"/"+partner.getMaxHealth()+"，肥鱼生命="+maid.getHealth()+"/"+maid.getMaxHealth()+"。仅表示当前观察，不推断任务进度。";
            if(change!=null)facts+="刚才在现场看到："+change.text+"；这不表示任务完成。";
            try{
                receipts.reserve(maid.getUUID(),partner.getUniqueId(),operation,"chat",facts);
                JsonObject result=start(partner,maid,operation,facts,null,true);
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
            if(maid==null||!enabled(maid)||!actor.getUniqueId().equals(maid.getOwnerUUID())||!actor.canSee(maid.getBukkitEntity())||!actor.getWorld().equals(maid.getBukkitEntity().getWorld())||at.distanceSquared(maid.getBukkitEntity().getLocation())>64||actor.getLocation().distanceSquared(maid.getBukkitEntity().getLocation())>64)continue;
            changes.put(maid.getUUID(),new VisibleChange(++changeSequence,System.nanoTime(),text));
        }
    }
}
