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
    private final Map<UUID,Pending> pending=new HashMap<>();
    private final Map<UUID,Set<String>> notified=new HashMap<>();
    private record Pending(UUID actor,String operation,String text,EntityMaid maid,
                           Set<LLMMessage> before,long deadline) {}

    public NativeMaidAgentSupport(HybridMaidPlugin plugin,ReceiptJournal receipts)throws Exception {
        this.plugin=plugin;this.receipts=receipts;this.file=plugin.getDataFolder().toPath().resolve("native-lifecycle.json");
        deaths=Files.exists(file)?JsonParser.parseString(Files.readString(file)).getAsJsonObject():new JsonObject();
        Bukkit.getPluginManager().registerEvents(this,plugin);
        Bukkit.getScheduler().runTaskTimer(plugin,this::tick,20,20);
    }
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
    public void enrich(Player actor,UUID id,JsonObject context) {
        EntityMaid maid=HybridMaidPlugin.nativeMaid(Bukkit.getEntity(id));
        if(maid!=null&&maid.isAlive()&&!maid.isRemoved()) {
            context.addProperty("lifeState","alive");
            var manager=maid.getAiChatManager();var site=manager.getLLMSite();
            context.addProperty("dialogueMode",configured(maid)?"native_model":"not_configured");
            context.addProperty("dialogueCommand","/qdmaid chat "+id+" <requestId> <对她说的话>");
            if(configured(maid))context.addProperty("inferenceOwner","original_tlm");
            context.addProperty("helpCommand","/qdmaid help");
            context.addProperty("equipmentCommand","/qdmaid inventory "+id);
            return;
        }
        MaidInfo found=tombstone(actor.getUniqueId(),id);
        JsonObject death=deaths.has(id.toString())?deaths.getAsJsonObject(id.toString()).deepCopy():null;
        if(found!=null) {
            JsonObject next=new JsonObject();next.addProperty("maidId",id.toString());next.addProperty("ownerId",actor.getUniqueId().toString());
            next.addProperty("name",found.getName().getString());next.addProperty("eventId","death-"+found.getTimestamp());
            next.addProperty("diedAt",java.time.Instant.ofEpochMilli(found.getTimestamp()).toString());
            next.addProperty("dimension",found.getDimension());var p=found.getChunkPos();
            JsonArray position=new JsonArray();position.add(p.getX());position.add(p.getY());position.add(p.getZ());next.add("position",position);
            next.addProperty("tombstoneId",found.getEntityId().toString());next.addProperty("evidence","original_tlm_tombstone");
            if(!next.equals(death)) {
                deaths.add(id.toString(),next);
                try{ReceiptJournal.write(file,deaths,Files.exists(file));}catch(Exception error){plugin.getLogger().warning("Maid lifecycle persistence failed; native tombstone retained: "+error.getClass().getSimpleName());}
            }
            death=next;
        }
        if(death==null||!actor.getUniqueId().toString().equals(death.get("ownerId").getAsString())) {
            context.addProperty("lifeState","unloaded_or_unavailable");
            context.addProperty("nextStep","女仆当前未加载，不能据此认定死亡；靠近她最后所在的维度后再查询。");return;
        }
        context.addProperty("lifeState","dead");context.addProperty("name",death.get("name").getAsString());
        death.addProperty("tombstoneRegistered",found!=null);
        death.addProperty("tombstoneLoaded",found!=null&&Bukkit.getEntity(found.getEntityId())!=null);
        death.addProperty("nextStep",found!=null?"先到所列维度和坐标确认墓碑并清出背包。原生右键墓碑取回遗物与复活胶片；胶片复活需要原模组祭坛流程，使用 NeoForge 客户端。不要重复创建替代女仆。":"原生墓碑记录已不在，可能已取走；检查主人的背包、箱子与复活胶片，勿自动补发或新建女仆。");
        context.add("death",death);context.addProperty("nextStep",death.get("nextStep").getAsString());
    }
    public void notifyOwner(Player actor,UUID id,JsonObject context) {
        if(!context.has("death"))return;
        JsonObject d=context.getAsJsonObject("death");String event=d.get("eventId").getAsString();
        if(!notified.computeIfAbsent(actor.getUniqueId(),ignored->new HashSet<>()).add(id+":"+event))return;
        actor.sendMessage("[女仆·死亡] "+d.get("name").getAsString()+" 已死亡。遗物位置："+d.get("dimension").getAsString()+" "+d.get("position")+"。查询 /qdmaid context "+id+"；先确认遗物与胶片，不要当成仍在跟随。");
        plugin.reply(actor,"lifecycle",event,context,null);
    }
    public void validateChat(Player actor,EntityMaid maid) {
        if(pending.containsKey(maid.getUUID()))throw new CompatibilityException("chat_busy","上一条原生对话尚未结束；用 /qdmaid receipt 查询原 requestId，勿重复发送。");
        var manager=maid.getAiChatManager();var site=manager.getLLMSite();
        if(!configured(maid))throw new CompatibilityException("chat_not_configured","服主尚未启用这位女仆的原生模型；chat 不会退回留言箱或冒充回复。");
        var tokens=((net.neoforged.neoforge.attachment.IAttachmentHolder)(Object)((CraftPlayer)actor).getHandle()).getData(com.github.tartaricacid.touhoulittlemaid.init.InitDataAttachment.CHAT_TOKENS);
        if(tokens.get()>=AIConfig.MAX_TOKENS_PER_PLAYER.get())throw new CompatibilityException("chat_budget_exhausted","原模组本角色对话额度不足，请联系服主查看模型额度；没有发送请求。");
        if(manager.historySummaryRunning)throw new CompatibilityException("chat_busy","原生对话正在整理记忆，请稍后查询状态。");
        LLMMessage last=manager.getHistory().peek();
        if(last!=null&&(last.role()==Role.USER||last.role()==Role.TOOL||last.toolCalls()!=null&&!last.toolCalls().isEmpty()))
            throw new CompatibilityException("chat_unresolved","原生历史有未完成对话，先查看原回执及服务状态，不能叠加重试。");
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
        maid.getAiChatManager().chat(text,new ChatClientInfo("zh_cn",maid.getName().getString(),List.of()),((CraftPlayer)actor).getHandle());
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
    private void tick() {
        for(var entry:new ArrayList<>(pending.entrySet())) {
            UUID id=entry.getKey();Pending p=entry.getValue();String reason=null,reply=null;boolean user=false;
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
                pending.remove(id);Player actor=Bukkit.getPlayer(p.actor);
                if(actor!=null)plugin.reply(actor,"chat-result",p.operation,receipt,null);
            }catch(Exception error){plugin.getLogger().warning("Maid chat receipt retained: "+error.getClass().getSimpleName());}
        }
        // Only registered owners/entities. No chunk loads and no per-tick world entity scans.
        if(Bukkit.getCurrentTick()%100>=20)return;
        for(var entry:plugin.registeredMaids().entrySet())try {
            Player actor=Bukkit.getPlayer(UUID.fromString(entry.getValue().getAsJsonObject().get("ownerId").getAsString()));
            if(actor!=null){UUID id=UUID.fromString(entry.getKey());JsonObject context=plugin.context(actor,id);notifyOwner(actor,id,context);}
        }catch(Exception error){plugin.getLogger().fine("Maid lifecycle observation unavailable: "+error.getClass().getSimpleName());}
    }
}
