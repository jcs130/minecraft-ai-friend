package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.LLMCallback;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.site.AvailableSites;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMClient;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMSite;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.LLMOpenAIClient;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.LLMOpenAISite;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.*;
import java.lang.reflect.Type;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.function.Consumer;
import local.tlmcompat.core.CompatibilityException;
import org.bukkit.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.inventory.*;
import org.bukkit.inventory.*;
import net.kyori.adventure.text.Component;

/** A server-only adapter. Original TLM continues to own history and actions. */
public final class NativeMaidBrainSupport implements Listener,AutoCloseable {
    private final HybridMaidPlugin plugin;
    private final JsonObject binding;
    private final UUID maidId,ownerId;
    private final Map<LLMCallback,Selection> selections=Collections.synchronizedMap(new WeakHashMap<>());
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
    private final MaidBrainToolGuard toolGuard;
    private final ThreadLocal<LLMCallback> buildingRequest=new ThreadLocal<>();
    private volatile boolean closed;
    record Selection(String site,String model,UUID maid,UUID owner,String operation){}

    public static NativeMaidBrainSupport create(HybridMaidPlugin plugin){
        try{return new NativeMaidBrainSupport(plugin);}
        catch(Exception error){plugin.getLogger().warning("Maid Harness configuration unavailable; original native features retained: "+error.getClass().getSimpleName());return new NativeMaidBrainSupport(plugin,true);}
    }
    private NativeMaidBrainSupport(HybridMaidPlugin plugin,boolean disabled){
        this.plugin=plugin;binding=null;maidId=null;ownerId=null;toolGuard=null;
    }

    public NativeMaidBrainSupport(HybridMaidPlugin plugin)throws Exception {
        this.plugin=plugin;
        Path path=plugin.getDataFolder().toPath().resolve("brain-routing.json");
        if(!Files.exists(path)){binding=null;maidId=null;ownerId=null;toolGuard=null;return;}
        binding=JsonParser.parseString(Files.readString(path)).getAsJsonObject();
        if(binding.get("schema").getAsInt()!=1)throw new IllegalStateException("Unknown maid brain binding; preserved");
        maidId=UUID.fromString(binding.get("maidId").getAsString());ownerId=UUID.fromString(binding.get("ownerId").getAsString());
        JsonObject choices=binding.getAsJsonObject("choices");
        if(choices.size()<2||choices.size()>9||!choices.has("native"))throw new IllegalStateException("Reviewed native/Harness choices required");
        Set<String> ids=new HashSet<>();
        for(var choice:choices.entrySet()){
            if(!choice.getKey().matches("[a-z0-9][a-z0-9_-]{0,31}"))throw new IllegalStateException("Invalid brain choice");
            JsonObject row=choice.getValue().getAsJsonObject();
            if(!row.has("label")||!row.get("site").getAsString().matches("[a-zA-Z0-9_-]{1,96}")||!ids.add(row.get("site").getAsString()))throw new IllegalStateException("Unique original site IDs required");
            if(row.get("model").getAsString().isBlank())throw new IllegalStateException("Explicit configured model required");
        }
        try{Class.forName("local.qdj.maids.brain.MaidBrainControl");}
        catch(ClassNotFoundException|LinkageError error){throw new IllegalStateException("Server-side maid brain extension is required",error);}
        toolGuard=new MaidBrainToolGuard(this);
        Bukkit.getPluginManager().registerEvents(this,plugin);
    }
    Set<String> siteIds(){
        Set<String> ids=new HashSet<>();
        for(var row:binding.getAsJsonObject("choices").entrySet()){
            String id=row.getValue().getAsJsonObject().get("site").getAsString();
            if(AvailableSites.getLLMSite(id)!=null)ids.add(id);
        }
        return ids;
    }
    LLMClient client(LLMOpenAISite site){return new ScopedClient(site);}
    private final class ScopedClient extends LLMOpenAIClient {
        final LLMOpenAISite site;
        ScopedClient(LLMOpenAISite site){super(http,site);this.site=site;}
        @Override public void chat(LLMCallback callback){
            EntityMaid maid=callback.getMaid();
            if(!allowed(maid)||!maid.getAiChatManager().getLLMSite().id().equals(site.id())){
                callback.onFailure(null,new IllegalStateException("SHARED_MAID_MODEL_NOT_ENABLED: only the original configured companion may use this site; query brain choices."),403);plugin.nativeModelFailed(callback,plugin.startingNativeOperation(),"SHARED_MAID_MODEL_NOT_ENABLED");return;
            }
            selections.putIfAbsent(callback,new Selection(site.id(),maid.getAiChatManager().getLLMModel(),maid.getUUID(),maid.getOwnerUUID(),plugin.startingNativeOperation()));
            LLMCallback previous=buildingRequest.get();
            try{buildingRequest.set(callback);super.chat(callback);}
            catch(Exception error){callback.onFailure(null,new IllegalStateException("MAID_NATIVE_REQUEST_FAILED_QUERY_RECEIPT"),502);failed(callback,"MAID_NATIVE_REQUEST_FAILED_QUERY_RECEIPT");}
            finally{if(previous==null)buildingRequest.remove();else buildingRequest.set(previous);}
        }
        @Override protected com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.request.ChatCompletion extraArgs(com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.request.ChatCompletion request){
            request=super.extraArgs(request);
            if(buildingRequest.get() instanceof CompanionActionCallback companion)companion.addCompanionTools(request);
            return request;
        }
        @Override public <T> void handleResponse(LLMCallback callback,HttpResponse<String> response,Throwable error,HttpRequest request,Consumer<T> consumer,Type type){
            if(!current(callback)){callback.onFailure(request,new IllegalStateException("MAID_BRAIN_CHANGED: original response refused; query original receipt."),409);failed(callback,"MAID_BRAIN_CHANGED_QUERY_RECEIPT");return;}
            if(error!=null||response==null||response.statusCode()<200||response.statusCode()>=300){
                String reason="MAID_MODEL_UNAVAILABLE_QUERY_RECEIPT";
                if(response!=null)try{String code=JsonParser.parseString(response.body()).getAsJsonObject().getAsJsonObject("error").get("code").getAsString();if(code.matches("[A-Z_]{5,96}"))reason=code;}catch(Exception ignored){}
                failed(callback,reason);
            }
            super.handleResponse(callback,response,error,request,consumer,type);
        }
        void failed(LLMCallback callback,String reason){Selection selection=selections.get(callback);plugin.nativeModelFailed(callback,selection==null?null:selection.operation,reason);}
    }
    boolean isScoped(EntityMaid maid){return binding!=null&&maid.getUUID().equals(maidId);}
    boolean allowed(EntityMaid maid){return !closed&&plugin.isEnabled()&&isScoped(maid)&&ownerId.equals(maid.getOwnerUUID())&&maid.isAlive()&&!maid.isRemoved();}
    Selection selection(LLMCallback callback){return selections.get(callback);}
    UUID boundMaid(){return maidId;}
    boolean current(LLMCallback callback){
        Selection selection=selections.get(callback);EntityMaid maid=callback.getMaid();
        return selection!=null&&allowed(maid)&&selection.maid.equals(maid.getUUID())&&selection.owner.equals(maid.getOwnerUUID())
            &&selection.site.equals(maid.getAiChatManager().getLLMSite().id())&&selection.model.equals(maid.getAiChatManager().getLLMModel());
    }
    void carry(LLMCallback before,LLMCallback after){Selection selection=selections.get(before);if(selection!=null)selections.put(after,selection);}
    public JsonObject describe(EntityMaid maid){
        JsonObject result=new JsonObject();result.addProperty("maidId",maid.getUUID().toString());result.addProperty("conversationOwner","original_tlm");
        result.addProperty("sharedModelEnabled",allowed(maid));result.addProperty("physicalController","original_maid_ai");
        result.addProperty("nextCommand","/qdmaid brain "+maid.getUUID());
        JsonArray choices=new JsonArray();String selected="external_or_unconfigured";
        if(isScoped(maid)&&ownerId.equals(maid.getOwnerUUID()))for(var entry:binding.getAsJsonObject("choices").entrySet()){
            JsonObject row=entry.getValue().getAsJsonObject(),choice=new JsonObject();String siteId=row.get("site").getAsString();LLMSite site=AvailableSites.getLLMSite(siteId);
            choice.addProperty("id",entry.getKey());choice.add("label",row.get("label"));choice.add("model",row.get("model"));
            choice.addProperty("configured",site!=null&&site.enabled()&&local.qdj.maids.brain.MaidBrainControl.isRoutedSite(siteId,maidId));choices.add(choice);
            if(maid.getAiChatManager().getLLMSite()!=null&&siteId.equals(maid.getAiChatManager().getLLMSite().id()))selected=entry.getKey();
        }
        result.addProperty("selected",selected);result.add("choices",choices);
        result.addProperty("meaning","运行方式与模型分别显示；配置可选不等于本轮调用成功。动作由原生女仆执行，以真实位置/工作/装备验收。");
        if(!isScoped(maid))result.addProperty("reason","共享智能服务暂仅对服主指定的原女仆启用；普通原生工作仍可使用。");
        return result;
    }
    public void validate(EntityMaid maid,String choice){
        if(!allowed(maid))throw new CompatibilityException("brain_not_enabled","此女仆尚未启用共享 Harness；原生行为照常，先查询 brain。");
        JsonObject row=binding.getAsJsonObject("choices").getAsJsonObject(choice);
        if(row==null)throw new CompatibilityException("brain_choice_unknown","运行方式不存在；/qdmaid brain "+maid.getUUID()+" 返回当前有效选项。");
        LLMSite site=AvailableSites.getLLMSite(row.get("site").getAsString());
        if(site==null||!site.enabled()||!local.qdj.maids.brain.MaidBrainControl.isRoutedSite(site.id(),maidId))throw new CompatibilityException("brain_unavailable","该运行方式尚未配置就绪；保留当前选择，请查询 brain 或联系服主检查 Harness 服务。");
    }
    public JsonObject select(EntityMaid maid,String choice){
        validate(maid,choice);JsonObject row=binding.getAsJsonObject("choices").getAsJsonObject(choice);
        maid.getAiChatManager().llmSite=row.get("site").getAsString();maid.getAiChatManager().llmModel=row.get("model").getAsString();
        JsonObject result=describe(maid);result.addProperty("historyPreserved",true);result.addProperty("goalCompleted",false);return result;
    }
    private final class Menu implements InventoryHolder {
        final UUID owner,maid;final Inventory inventory;final Map<Integer,String> buttons=new HashMap<>();
        Menu(Player player,EntityMaid entity){owner=player.getUniqueId();maid=entity.getUUID();inventory=Bukkit.createInventory(this,27,Component.text("女仆 · 运行方式"));}
        @Override public Inventory getInventory(){return inventory;}
    }
    public void open(Player player,EntityMaid maid){
        Menu menu=new Menu(player,maid);JsonObject info=describe(maid);int slot=10;
        if(info.getAsJsonArray("choices").isEmpty())throw new CompatibilityException("brain_not_enabled","此女仆尚未配置共享运行方式；原生工作仍可使用。");
        for(JsonElement element:info.getAsJsonArray("choices")){
            JsonObject row=element.getAsJsonObject();String choice=row.get("id").getAsString();ItemStack item=new ItemStack(row.get("configured").getAsBoolean()?Material.PAPER:Material.BARRIER);var meta=item.getItemMeta();
            meta.displayName(Component.text((choice.equals(info.get("selected").getAsString())?"✓ ":"")+row.get("label").getAsString()));
            meta.lore(List.of(Component.text("模型："+row.get("model").getAsString()),Component.text("切换保留原女仆、记忆和物品；对话中需等待。")));item.setItemMeta(meta);menu.inventory.setItem(slot,item);menu.buttons.put(slot,choice);slot+=2;
        }
        player.openInventory(menu.inventory);
    }
    @EventHandler public void click(InventoryClickEvent event){
        if(!(event.getView().getTopInventory().getHolder() instanceof Menu menu))return;event.setCancelled(true);
        if(!(event.getWhoClicked() instanceof Player actor)||!actor.getUniqueId().equals(menu.owner)||!menu.buttons.containsKey(event.getRawSlot()))return;
        try{plugin.dispatch(actor,"brain",menu.maid,"brain_"+UUID.randomUUID().toString().replace("-",""),menu.buttons.get(event.getRawSlot()));actor.sendMessage("[女仆] 已选择运行方式；下一次对话使用此选择。行为效果仍需查询状态。");actor.closeInventory();}
        catch(Exception error){actor.sendMessage("[女仆] 未切换："+error.getMessage());}
    }
    @EventHandler public void drag(InventoryDragEvent event){if(event.getView().getTopInventory().getHolder() instanceof Menu)event.setCancelled(true);}
    @Override public void close(){
        closed=true;for(Player player:Bukkit.getOnlinePlayers())if(player.getOpenInventory().getTopInventory().getHolder() instanceof Menu)player.closeInventory();
        if(toolGuard!=null)toolGuard.close();
        selections.clear();http.shutdownNow();
    }
}
