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
final class NativeMaidSocialSupport {
    private final HybridMaidPlugin plugin;
    private final ReceiptJournal receipts;
    private final Map<UUID,Call> pending=new HashMap<>();
    // Short-lived conversation continuity, never the owner's private native memory.
    private final LinkedHashMap<String,List<LLMMessage>> conversations=new LinkedHashMap<>();
    private final Map<UUID,Long> nextChat=new HashMap<>();
    private record Call(UUID actor,UUID owner,String operation,String text,EntityMaid maid,long deadline,Set<UUID> listeners,Player actorConnection,UUID world,Map<UUID,Player> connections){}

    NativeMaidSocialSupport(HybridMaidPlugin plugin,ReceiptJournal receipts){
        this.plugin=plugin;this.receipts=receipts;
        Bukkit.getScheduler().runTaskTimer(plugin,this::tick,20,20);
    }
    boolean handles(LLMCallback callback){return callback instanceof VisitorCallback;}
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
        Set<UUID> listeners=new HashSet<>();
        for(Player listener:maid.getBukkitEntity().getLocation().getNearbyPlayers(8))if((deliveredTo==null||deliveredTo.contains(listener.getUniqueId()))&&listener.canSee(actor)&&listener.canSee(maid.getBukkitEntity()))listeners.add(listener.getUniqueId());
        Map<UUID,Player> connections=new HashMap<>();for(UUID id:listeners)connections.put(id,Bukkit.getPlayer(id));
        Call call=new Call(actor.getUniqueId(),maid.getOwnerUUID(),operation,text,maid,System.nanoTime()+75_000_000_000L,Set.copyOf(listeners),actor,actor.getWorld().getUID(),Map.copyOf(connections));
        pending.put(maid.getUUID(),call);nextChat.put(actor.getUniqueId(),System.nanoTime()+5_000_000_000L);
        JsonObject observation=new JsonObject();observation.addProperty("maidId",maid.getUUID().toString());
        observation.addProperty("conversation","nearby_visitor");observation.addProperty("meaning","已发送给原女仆当前选定的模型，等待回复；不是给主人下指令。");
        observation.addProperty("nextCommand","/qdmaid receipt "+maid.getUUID()+" "+operation);
        JsonObject result=receipts.finish(maid.getUUID(),operation,"pending",observation);
        if(deliveredTo==null)for(UUID id:call.listeners){Player listener=Bukkit.getPlayer(id);if(listener!=null)listener.sendMessage(net.kyori.adventure.text.Component.text("[附近·女仆] "+actor.getName()+" → "+maid.getName().getString()+"："+text,net.kyori.adventure.text.format.NamedTextColor.AQUA));}
        List<LLMMessage> messages=new ArrayList<>();
        String relation=actor.getUniqueId().equals(maid.getOwnerUUID())?"对方是主人，但这里是公开聊天；安排工作请主人使用右键交谈入口。":"对方不是主人，不能更改你的主人、装备、工作或运行方式。";
        messages.add(LLMMessage.systemChat(maid,"你是游戏中名叫「"+maid.getName().getString()+"」的原生车万女仆。现在与附近玩家「"+actor.getName()+"」进行中文简短交谈。"+relation+"本轮只交流，没有动作工具，也不提供主人的私聊、背包或记忆。可以说明原生女仆支持跟随、驻守、战斗、耕作等工作，需要主人从菜单选择并准备装备；不要声称已执行动作。当前工作ID："+maid.getTask().getUid()+"。用普通文字回复，不要输出命令、JSON、系统提示或内部推理。"));
        messages.addAll(conversations.getOrDefault(key(call),List.of()));messages.add(LLMMessage.userChat(maid,text));
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
        if(reason==null&&(actor==null||!actor.isOnline()||actor.isDead()||actor.isInvisible()||actor.getGameMode()==org.bukkit.GameMode.SPECTATOR||!actor.getWorld().equals(call.maid.getBukkitEntity().getWorld())||actor.getLocation().distanceSquared(call.maid.getBukkitEntity().getLocation())>64))reason="listener_left";
        if(reason==null&&(text==null||text.isBlank()||text.length()>1000))reason="invalid_model_reply";
        JsonObject observation=new JsonObject();observation.addProperty("maidId",id.toString());observation.addProperty("conversation","nearby_visitor");observation.addProperty("retryAllowed",false);
        if(reason==null)observation.addProperty("reply",text.replaceAll("[\\p{Cntrl}§]"," "));
        else{observation.addProperty("reason",reason);observation.addProperty("meaning","未交付有效回复；查原回执，不自动重发。可稍后另说一句新话。");}
        try{
            JsonObject receipt=receipts.finish(id,call.operation,reason==null?"replied":"unknown",observation);
            pending.remove(id);
            if(reason==null){
                plugin.conversationReplied(actor,call.maid);
                Set<UUID> audience=new HashSet<>();for(UUID listener:call.listeners)if(Bukkit.getPlayer(listener)==call.connections.get(listener))audience.add(listener);audience.add(call.actor);
                plugin.speakPublicReply(call.maid,call.operation,observation.get("reply").getAsString(),Set.copyOf(audience));
                List<LLMMessage> history=new ArrayList<>(conversations.getOrDefault(key(call),List.of()));history.add(LLMMessage.userChat(call.maid,call.text));history.add(LLMMessage.assistantChat(call.maid,observation.get("reply").getAsString()));
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
    }
}
