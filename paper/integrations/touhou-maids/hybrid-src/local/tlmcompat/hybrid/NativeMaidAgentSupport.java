package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.ChatClientInfo;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.response.ResponseChat;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMMessage;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.Role;
import com.github.tartaricacid.touhoulittlemaid.config.subconfig.AIConfig;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.world.data.MaidInfo;
import com.github.tartaricacid.touhoulittlemaid.world.data.MaidWorldData;
import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import local.tlmcompat.core.CompatibilityException;
import local.tlmcompat.qiandengji.ReceiptJournal;
import org.bukkit.Bukkit;
import org.bukkit.craftbukkit.CraftWorld;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerQuitEvent;

/** Uses original TLM inference/history and tombstones. No second model client or automatic resurrection. */
public final class NativeMaidAgentSupport implements Listener {
    private final HybridMaidPlugin plugin;
    private final ReceiptJournal receipts;
    private final Path file;
    private final JsonObject deaths;
    private final MaidLifeEpisodes lifecycle;
    private final NativeMaidFollowSupport following=new NativeMaidFollowSupport();
    private long lastPersistenceWarning;
    private final java.util.function.Consumer<net.neoforged.neoforge.event.entity.living.LivingDeathEvent> deathListener;
    private final Map<UUID,Pending> pending=new HashMap<>();
    private final Map<UUID,String> modelFailures=new HashMap<>();
    private final ThreadLocal<String> startingOperation=new ThreadLocal<>();
    String startingOperation(){return startingOperation.get();}
    private final Map<UUID,Set<String>> notified=new HashMap<>();
    private record Pending(UUID actor,String operation,String text,EntityMaid maid,
                           Set<LLMMessage> before,long deadline) {}

    public NativeMaidAgentSupport(HybridMaidPlugin plugin,ReceiptJournal receipts)throws Exception {
        this.plugin=plugin;this.receipts=receipts;this.file=plugin.getDataFolder().toPath().resolve("native-lifecycle.json");
        deaths=Files.exists(file)?JsonParser.parseString(Files.readString(file)).getAsJsonObject():new JsonObject();
        lifecycle=new MaidLifeEpisodes(deaths);
        deathListener=event->{if(event.getEntity() instanceof EntityMaid maid)Bukkit.getScheduler().runTask(plugin,()->{
            if(!event.isCanceled()&&!maid.isAlive())observeDeath(maid);
        });};
        Bukkit.getPluginManager().registerEvents(this,plugin);
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(net.neoforged.bus.api.EventPriority.LOWEST,false,deathListener);
        Bukkit.getScheduler().runTaskTimer(plugin,this::tick,20,20);
    }
    public void close(){net.neoforged.neoforge.common.NeoForge.EVENT_BUS.unregister(deathListener);persistLifecycle();}
    @EventHandler public void quit(PlayerQuitEvent event){notified.remove(event.getPlayer().getUniqueId());}

    /** Native saved tombstone carries the original maid UUID in the name's insertion style. */
    private MaidInfo tombstone(UUID owner,UUID maid) {
        if(Bukkit.getWorlds().isEmpty())return null;
        var data=MaidWorldData.get(((CraftWorld)Bukkit.getWorlds().getFirst()).getHandle());
        var rows=data==null?null:data.getTombstones(owner);
        if(rows==null)return null;
        return rows.stream().filter(row->owner.equals(row.getOwnerId())&&row.getName()!=null
                &&maid.toString().equals(row.getName().getStyle().getInsertion()))
                .max(Comparator.comparingLong(MaidInfo::getTimestamp)).orElse(null);
    }
    private static boolean configured(EntityMaid maid){
        var site=maid.getAiChatManager().getLLMSite();
        return AIConfig.LLM_ENABLED.get()&&site!=null&&site.enabled()
            &&!(site.id().equals(com.github.tartaricacid.touhoulittlemaid.ai.service.llm.DefaultLLMSite.DEEPSEEK.id())
                &&site instanceof com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.LLMOpenAISite openai
                &&(openai.secretKey()==null||openai.secretKey().isBlank()));
    }
    private JsonObject facts(EntityMaid maid){
        JsonObject facts=new JsonObject();facts.addProperty("name",maid.getName().getString());
        facts.addProperty("dimension",maid.level().dimension().location().toString());
        JsonArray position=new JsonArray();position.add(maid.getX());position.add(maid.getY());position.add(maid.getZ());facts.add("position",position);
        return facts;
    }
    private UUID registeredOwner(EntityMaid maid){
        UUID owner=((net.minecraft.world.entity.TamableAnimal)maid).getOwnerUUID();
        JsonElement record=plugin.registeredMaids().get(maid.getUUID().toString());
        return owner!=null&&record instanceof JsonObject row&&owner.toString().equals(row.get("ownerId").getAsString())?owner:null;
    }
    private JsonObject grave(UUID owner,UUID id){
        MaidInfo found=tombstone(owner,id);if(found==null)return null;
        JsonObject next=new JsonObject();next.addProperty("maidId",id.toString());next.addProperty("ownerId",owner.toString());
        next.addProperty("name",found.getName().getString());next.addProperty("eventId","death-"+found.getTimestamp());
        next.addProperty("diedAt",java.time.Instant.ofEpochMilli(found.getTimestamp()).toString());
        next.addProperty("dimension",found.getDimension());var p=found.getChunkPos();
        JsonArray position=new JsonArray();position.add(p.getX());position.add(p.getY());position.add(p.getZ());next.add("position",position);
        next.addProperty("tombstoneId",found.getEntityId().toString());next.addProperty("evidence","original_tlm_tombstone");return next;
    }
    private void persistLifecycle(){
        if(!lifecycle.dirty())return;
        try{ReceiptJournal.write(file,deaths,Files.exists(file));lifecycle.saved();}
        catch(Exception error){long now=System.nanoTime();if(now-lastPersistenceWarning>30_000_000_000L){lastPersistenceWarning=now;plugin.getLogger().warning("Maid lifecycle persistence unavailable; recovery is not durably confirmed: "+error.getClass().getSimpleName());}}
    }
    public void observeLoaded(EntityMaid maid){
        UUID owner=registeredOwner(maid);if(owner==null||!maid.isAlive()||maid.isRemoved())return;
        lifecycle.alive(owner,maid.getUUID(),System.currentTimeMillis(),facts(maid),grave(owner,maid.getUUID()));persistLifecycle();
    }
    private void observeDeath(EntityMaid maid){
        UUID owner=registeredOwner(maid);if(owner==null)return;
        lifecycle.died(owner,maid.getUUID(),System.currentTimeMillis(),facts(maid),grave(owner,maid.getUUID()));persistLifecycle();
    }
    private void annotateGrave(JsonObject death,JsonObject found){
        boolean matching=found!=null&&death.has("tombstoneId")&&death.get("tombstoneId").equals(found.get("tombstoneId"));
        death.addProperty("tombstoneRegistered",matching);
        death.addProperty("tombstoneLoaded",matching&&Bukkit.getEntity(UUID.fromString(found.get("tombstoneId").getAsString()))!=null);
    }
    public void enrich(Player actor,UUID id,JsonObject context) {
        EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));
        boolean alive=maid!=null&&maid.isAlive()&&!maid.isRemoved();
        JsonObject found=grave(actor.getUniqueId(),id);
        JsonObject state=lifecycle.view(actor.getUniqueId(),id,System.currentTimeMillis(),alive?facts(maid):null,found);
        persistLifecycle();
        for(var entry:state.entrySet())context.add(entry.getKey(),entry.getValue());
        if(context.has("historicalDeath"))annotateGrave(context.getAsJsonObject("historicalDeath"),found);
        if(context.has("recovery"))context.getAsJsonObject("recovery").addProperty("persisted",lifecycle.durable(context.getAsJsonObject("recovery").get("eventId").getAsString()));
        if(alive) {
            context.add("follow",following.describe(maid));
            var manager=maid.getAiChatManager();var site=manager.getLLMSite();
            context.addProperty("dialogueMode",configured(maid)?"native_model":"not_configured");
            context.addProperty("dialogueCommand","/qdmaid chat "+id+" <requestId> <对她说的话>");
            if(configured(maid))context.addProperty("inferenceOwner","original_tlm");
            context.addProperty("helpCommand","/qdmaid help");
            context.addProperty("equipmentCommand","/qdmaid inventory "+id);
            return;
        }
        if(!context.has("death")) {
            context.addProperty("nextStep",context.has("recovery")?"曾再次确认原UUID存活；当前未加载，靠近lastSeenAlive所列维度位置后再查询。旧墓碑可留有遗物，不代表再次死亡，勿重复复活。":"女仆当前未加载，历史墓碑不足以确认当前死亡；靠近她最后所在的维度后再查询。");return;
        }
        JsonObject death=context.getAsJsonObject("death");annotateGrave(death,found);context.addProperty("name",death.get("name").getAsString());
        death.addProperty("nextStep",death.get("tombstoneRegistered").getAsBoolean()?"当前死亡有本次原生证据。先核对所列墓碑与遗物；原生胶片复活需模组祭坛，不要重复创建替代女仆。":"已观察到本次死亡，但原墓碑尚未确认或已取走；查询原状态，不自动补发物品或新建女仆。");
        context.addProperty("nextStep",death.get("nextStep").getAsString());
    }
    public void notifyOwner(Player actor,UUID id,JsonObject context) {
        boolean recovered=!context.has("death")&&context.has("recovery");
        if(!context.has("death")&&!recovered)return;
        JsonObject d=context.getAsJsonObject(recovered?"recovery":"death");
        if(recovered&&!d.get("persisted").getAsBoolean())return;
        String event=d.get("eventId").getAsString();
        if(!notified.computeIfAbsent(actor.getUniqueId(),ignored->new HashSet<>()).add(id+":"+event))return;
        actor.sendMessage(recovered?"[女仆·恢复] "+d.get("name").getAsString()+" 已再次确认原UUID存活；观察于 "+d.get("observedAt").getAsString()+"，不是实际复活时间。当前状态用 /qdmaid context "+id+" 查询；勿按旧墓碑重复复活。":"[女仆·死亡] "+d.get("name").getAsString()+" 已发生本次死亡。位置："+d.get("dimension").getAsString()+" "+d.get("position")+"。查询 /qdmaid context "+id+"；先核对本次遗物与胶片。");
        plugin.reply(actor,"lifecycle",event,context,null);
    }
    public void validateIdle(EntityMaid maid) {
        plugin.validatePublicIdle(maid);
        if(pending.containsKey(maid.getUUID()))throw new CompatibilityException("chat_busy","上一条原生对话尚未结束；用 /qdmaid receipt 查询原 requestId，勿重复发送。");
        var manager=maid.getAiChatManager();
        if(manager.historySummaryRunning)throw new CompatibilityException("chat_busy","原生对话正在整理记忆，请稍后查询状态。");
        LLMMessage last=manager.getHistory().peek();
        if(last!=null&&(last.role()==Role.USER||last.role()==Role.TOOL||last.toolCalls()!=null&&!last.toolCalls().isEmpty()))
            throw new CompatibilityException("chat_unresolved","原生历史有未完成对话，先查看原回执及服务状态，不能叠加重试。");
    }
    public void validateChat(Player actor,EntityMaid maid) {
        validateIdle(maid);
        var manager=maid.getAiChatManager();var site=manager.getLLMSite();
        if(!configured(maid))throw new CompatibilityException("chat_not_configured","服主尚未启用这位女仆的原生模型；chat 不会退回留言箱或冒充回复。");
        var tokens=((net.neoforged.neoforge.attachment.IAttachmentHolder)(Object)((CraftPlayer)actor).getHandle()).getData(com.github.tartaricacid.touhoulittlemaid.init.InitDataAttachment.CHAT_TOKENS);
        if(tokens.get()>=AIConfig.MAX_TOKENS_PER_PLAYER.get())throw new CompatibilityException("chat_budget_exhausted","原模组本角色对话额度不足，请联系服主查看模型额度；没有发送请求。");
    }
    public JsonObject chat(Player actor,EntityMaid maid,String operation,String text)throws Exception {
        var seen=Collections.newSetFromMap(new IdentityHashMap<LLMMessage,Boolean>());
        seen.addAll(maid.getAiChatManager().getHistory().getDeque());
        Pending call=new Pending(actor.getUniqueId(),operation,text,maid,seen,System.nanoTime()+120_000_000_000L);
        pending.put(maid.getUUID(),call);
        JsonObject observed=new JsonObject();observed.addProperty("maidId",maid.getUUID().toString());
        observed.addProperty("meaning","已交给原生女仆模型，尚未收到回复；查询原 operationId，不自动重发。");
        observed.addProperty("nextCommand","/qdmaid receipt "+maid.getUUID()+" "+operation);
        JsonObject result=receipts.finish(maid.getUUID(),operation,"pending",observed);
        startingOperation.set(operation);
        try{maid.getAiChatManager().chat(text,new ChatClientInfo("zh_cn",maid.getName().getString(),List.of()),((CraftPlayer)actor).getHandle());}
        finally{startingOperation.remove();}
        return result;
    }
    public JsonObject reconcile(JsonObject receipt)throws Exception {
        if("chat".equals(receipt.get("action").getAsString())&&"pending".equals(receipt.get("status").getAsString())
                &&(!pending.containsKey(UUID.fromString(receipt.get("maidId").getAsString()))||!pending.get(UUID.fromString(receipt.get("maidId").getAsString())).operation.equals(receipt.get("operationId").getAsString()))) {
            JsonObject observation=new JsonObject();observation.addProperty("reason","service_restarted");observation.addProperty("retryAllowed",false);
            observation.addProperty("meaning","服务已重启，旧模型结果不确定。查询原生聊天记录，不自动重放。");
            return receipts.finish(UUID.fromString(receipt.get("maidId").getAsString()),receipt.get("operationId").getAsString(),"unknown",observation);
        }
        return receipt;
    }
    public void modelFailed(com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.LLMCallback callback,String operation,String reason){
        EntityMaid maid=callback.getMaid();
        LLMMessage requested=null,current=null;
        for(LLMMessage row:callback.getMessages())if(row.role()==Role.USER)requested=row;
        for(LLMMessage row:maid.getAiChatManager().getHistory().getDeque())if(row.role()==Role.USER){current=row;break;}
        Pending p=pending.get(maid.getUUID());
        // Correlation is captured when this exact owner request enters TLM,
        // then carried through its original tool callbacks. Never close a new turn.
        if(operation!=null){
            if(p==null||!operation.equals(p.operation)||current==null||p.before.contains(current)||!p.text.equals(current.message()))return;
            modelFailures.put(maid.getUUID(),reason);
        }else{
            // TLM enriches the callback's user text with live contexts; its
            // original history stores the raw text at the same game tick.
            if(requested==null||current==null||requested.gameTime()!=current.gameTime())return;
            if(p!=null){
                if(p.before.contains(current)||!p.text.equals(current.message()))return;
                modelFailures.put(maid.getUUID(),reason);
            }
        }
        LLMMessage last=maid.getAiChatManager().getHistory().peek();
        if(last!=null&&last.role()!=Role.SYSTEM&&(last.toolCalls()==null||last.toolCalls().isEmpty()))
            maid.getAiChatManager().getHistory().add(LLMMessage.systemChat(maid,"[服务器状态] 本轮模型收尾失败："+reason+"。不是女仆回复，未确认目标完成；原生执行记录保留，请查询原回执和当前状态，勿重放本轮动作。"));
    }
    private void tick() {
        for(var entry:new ArrayList<>(pending.entrySet())) {
            UUID id=entry.getKey();Pending p=entry.getValue();String reason=modelFailures.get(id),reply=null;boolean user=false;
            var history=new ArrayList<>(p.maid.getAiChatManager().getHistory().getDeque());Collections.reverse(history);
            for(LLMMessage message:history) {
                if(p.before.contains(message))continue;
                if(message.role()==Role.USER) {if(user||!p.text.equals(message.message())){reason="interleaved_native_chat";break;}user=true;}
                if(user&&message.role()==Role.ASSISTANT&&(message.toolCalls()==null||message.toolCalls().isEmpty())&&!message.message().isBlank()) {
                    reply=new ResponseChat(message.message()).getChatText();
                }
            }
            if(reason==null&&!p.maid.isAlive())reason="maid_unavailable";
            if(reason==null&&reply==null&&System.nanoTime()>p.deadline)reason="native_reply_not_observed";
            if(reply==null&&reason==null)continue;
            JsonObject observation=new JsonObject();observation.addProperty("maidId",id.toString());observation.addProperty("retryAllowed",false);
            if(reason!=null){observation.addProperty("reason",reason);observation.addProperty("meaning","未确认原生回复；不是成功，也不要换 requestId 自动重试。");}
            else {observation.addProperty("reply",reply.length()>4000?reply.substring(0,4000):reply);observation.addProperty("meaning","已读到原生模型回复；其中提到的游戏行动仍须查询世界状态验收。");}
            try {
                JsonObject receipt=receipts.finish(id,p.operation,reason==null?"replied":"unknown",observation);
                pending.remove(id);modelFailures.remove(id);Player actor=Bukkit.getPlayer(p.actor);
                if(actor!=null)plugin.reply(actor,"chat-result",p.operation,receipt,null);
            }catch(Exception error){plugin.getLogger().warning("Maid chat receipt retained: "+error.getClass().getSimpleName());}
        }
        // Only registered owners/entities. No chunk loads and no per-tick world entity scans.
        boolean lifecycleDue=Bukkit.getCurrentTick()%100<20;
        Set<UUID> registered=new HashSet<>();
        for(var entry:plugin.registeredMaids().entrySet())try {
            UUID id=UUID.fromString(entry.getKey());registered.add(id);
            EntityMaid loaded=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));
            if(loaded!=null){
                try{if(registeredOwner(loaded)!=null){plugin.companionTick(loaded);following.tick(loaded);}else following.unavailable(id);}catch(Exception error){plugin.getLogger().fine("Native following observation unavailable: "+error.getClass().getSimpleName());}
                if(lifecycleDue)observeLoaded(loaded);
            }else following.unavailable(id);
            if(!lifecycleDue)continue;
            Player actor=Bukkit.getPlayer(UUID.fromString(entry.getValue().getAsJsonObject().get("ownerId").getAsString()));
            if(actor!=null){JsonObject context=plugin.context(actor,id);notifyOwner(actor,id,context);}
        }catch(Exception error){plugin.getLogger().fine("Maid lifecycle observation unavailable: "+error.getClass().getSimpleName());}
        following.retain(registered);
    }
}
