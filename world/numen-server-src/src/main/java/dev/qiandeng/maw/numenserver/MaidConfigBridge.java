package dev.qiandeng.maw.numenserver;

import static dev.qiandeng.maw.numenserver.PrivateStore.*;
import com.google.gson.*;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.entity.MaidAIChatManager;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.site.AvailableSites;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.setting.SettingReader;
import com.github.tartaricacid.touhoulittlemaid.ai.service.SupportModelSelect;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.LLMSite;
import com.github.tartaricacid.touhoulittlemaid.ai.service.llm.openai.LLMOpenAISite;
import com.github.tartaricacid.touhoulittlemaid.config.subconfig.AIConfig;
import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.github.tartaricacid.touhoulittlemaid.entity.task.TaskManager;
import com.github.tartaricacid.touhoulittlemaid.api.event.InteractMaidEvent;
import com.github.tartaricacid.touhoulittlemaid.api.event.MaidTaskEnableEvent;
import com.github.tartaricacid.touhoulittlemaid.init.InitTrigger;
import com.github.tartaricacid.touhoulittlemaid.util.GameModeUtil;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;
import net.neoforged.neoforge.common.NeoForge;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.util.*;

/** Native TLM settings, not a second AI loop. Loaded only when the pinned mod exists. */
final class MaidConfigBridge {
    final HeadlessRuntime runtime;
    MaidConfigBridge(HeadlessRuntime runtime){this.runtime=runtime;}
    JsonObject invoke(ServerPlayer player,String action,JsonObject args){
        return switch(action){
            case "maid.menu"->menu(player);
            case "maid.detail"->object("ok",true,"maid",state(own(player,args)));
            case "maid.settings"->settings(player,args);
            case "maid.tasks"->tasks(player,args);
            case "maid.controls"->controls(player,args);
            case "maid.site.save"->saveSite(player,args);
            default->throw new IllegalArgumentException("unknown_maid_ui_action");
        };
    }
    JsonObject menu(ServerPlayer player){
        boolean admin=GameModeUtil.canEditSite(player);
        JsonArray sites=new JsonArray(),maids=new JsonArray();
        AvailableSites.LLM_SITES.values().stream().limit(64).forEach(site->sites.add(site(site,admin)));
        // Only loaded, nearby, owned maids. This never force-loads chunks or spawns a maid.
        for(EntityMaid maid:player.serverLevel().getEntitiesOfClass(EntityMaid.class,player.getBoundingBox().inflate(32),m->eligible(player,m)).stream().limit(24).toList())maids.add(state(maid));
        return object("ok",true,"schemaVersion",1,"nativeMod","touhou_little_maid","version","1.5.3","canEditSites",admin,"llmEnabled",AIConfig.LLM_ENABLED.get(),"range",32,"sites",sites,"maids",maids);
    }
    static boolean eligible(ServerPlayer player,EntityMaid maid){
        return maid.isAlive()&&!maid.isRemoved()&&maid.isTame()&&maid.isOwnedBy(player)&&maid.level()==player.level()&&player.distanceToSqr(maid)<=32*32;
    }
    boolean canOpenFromInteraction(ServerPlayer player,Entity target){
        return target instanceof EntityMaid maid && eligible(player,maid) &&
            !NeoForge.EVENT_BUS.post(new InteractMaidEvent(player,maid,player.getMainHandItem())).isCanceled();
    }
    EntityMaid own(ServerPlayer player,JsonObject args){
        var entity=player.serverLevel().getEntity(UUID.fromString(text(args,"maidUuid",36)));
        if(!(entity instanceof EntityMaid maid)||!eligible(player,maid))throw new IllegalArgumentException("maid_not_owned_nearby_alive");
        return maid;
    }
    static String limit(String value,int max){return value.length()>max?value.substring(0,max):value;}
    static String revision(MaidAIChatManager data){
        return hash(fingerprint(object("site",data.llmSite,"model",data.llmModel,"prompt",data.customSetting,"ownerName",data.ownerName,"language",data.chatLanguage)));
    }
    static JsonObject state(EntityMaid maid){
        MaidAIChatManager data=maid.getAiChatManager();LLMSite selected=data.getLLMSite();
        return object("maidUuid",maid.getUUID(),"name",limit(maid.getName().getString(),80),"position",HeadlessRuntime.position(maid.position()),"health",maid.getHealth(),"maxHealth",maid.getMaxHealth(),"hunger",maid.getHunger(),"taskId",maid.getTask().getUid().toString(),"follow",!maid.isMaidInSittingPose()&&!maid.isHomeModeEnable(),"pickup",maid.isPickup(),"sleeping",maid.isSleeping(),"controlRevision",controlRevision(maid),"siteId",data.llmSite,"effectiveSiteId",selected==null?null:selected.id(),"model",data.llmModel,"effectiveModel",data.getLLMModel(),"customSetting",limit(data.customSetting,4000),"language",data.getChatLanguage(),"revision",revision(data));
    }
    static String controlRevision(EntityMaid maid){
        return hash(fingerprint(object("taskId",maid.getTask().getUid(),"sitting",maid.isMaidInSittingPose(),"home",maid.isHomeModeEnable(),"pickup",maid.isPickup(),"sleeping",maid.isSleeping())));
    }
    JsonObject tasks(ServerPlayer player,JsonObject args){
        EntityMaid maid=own(player,args);JsonArray tasks=new JsonArray();
        for(var task:TaskManager.getNotHiddenTaskList(maid).stream().limit(32).toList())
            tasks.add(object("id",task.getUid(),"name",limit(task.getName().getString(),80),"enabled",task.isEnable(maid)));
        return object("ok",true,"maid",state(maid),"tasks",tasks);
    }
    JsonObject controls(ServerPlayer player,JsonObject args){
        EntityMaid maid=own(player,args);
        if(!equalsSecret(controlRevision(maid),text(args,"controlRevision",64)))throw new IllegalArgumentException("maid_controls_changed_refresh");
        if(maid.isSleeping())throw new IllegalArgumentException("maid_sleeping");
        ResourceLocation id=ResourceLocation.tryParse(text(args,"taskId",150));
        var task=id==null?null:TaskManager.findTask(id).orElse(null);
        if(task==null||task.isHidden(maid))throw new IllegalArgumentException("unknown_or_hidden_task");
        boolean changed=task!=maid.getTask();
        if(changed&&((task!=TaskManager.getIdleTask()&&NeoForge.EVENT_BUS.post(new MaidTaskEnableEvent(task,maid)).isCanceled())||!task.isEnable(maid)))throw new IllegalArgumentException("task_disabled");
        if(!args.has("follow")||!args.get("follow").isJsonPrimitive()||!args.getAsJsonPrimitive("follow").isBoolean()||!args.has("pickup")||!args.get("pickup").isJsonPrimitive()||!args.getAsJsonPrimitive("pickup").isBoolean())throw new IllegalArgumentException("invalid_maid_controls");
        boolean follow=args.get("follow").getAsBoolean(),pickup=args.get("pickup").getAsBoolean();
        if(changed){maid.setTask(task);if(task!=TaskManager.getIdleTask())InitTrigger.MAID_EVENT.get().trigger(player,"switch_task");}
        boolean following=!maid.isMaidInSittingPose()&&!maid.isHomeModeEnable();
        if(follow!=following){if(follow)maid.setHomeModeEnable(false);maid.setInSittingPose(!follow);}
        maid.setPickup(pickup);
        return object("ok",true,"maid",state(maid),"modelRequests",0);
    }
    static String revision(LLMSite site){
        JsonObject data=object("id",site.id(),"url",site.url(),"enabled",site.enabled(),"apiType",site.getApiType(),"headersHash",hash(fingerprint(new Gson().toJsonTree(site.headers()))));
        if(site instanceof LLMOpenAISite open){data.addProperty("keyHash",hash(open.secretKey()));data.addProperty("thinking",open.hasThinkingField());data.add("models",new Gson().toJsonTree(open.modelEntries()));}
        return hash(fingerprint(data));
    }
    static JsonObject site(LLMSite site,boolean admin){
        JsonObject row=object("siteId",site.id(),"enabled",site.enabled(),"apiType",site.getApiType());
        JsonArray models=new JsonArray();
        if(site instanceof SupportModelSelect select)select.models().keySet().stream().sorted().limit(24).forEach(models::add);
        row.add("models",models);
        if(admin){
            row.addProperty("url",site.url());row.addProperty("revision",revision(site));row.addProperty("editable",site instanceof LLMOpenAISite);
            if(site instanceof LLMOpenAISite open){row.addProperty("keyConfigured",!open.secretKey().isBlank());row.addProperty("hasThinkingField",open.hasThinkingField());}
        }
        return row;
    }
    JsonObject settings(ServerPlayer player,JsonObject args){
        EntityMaid maid=own(player,args);MaidAIChatManager data=maid.getAiChatManager();
        if(data.customSetting.length()>4000)throw new IllegalArgumentException("maid_prompt_too_long_use_java_editor");
        if(!equalsSecret(revision(data),text(args,"revision",64)))throw new IllegalArgumentException("maid_settings_changed_refresh");
        String sid=text(args,"siteId",100),model=text(args,"model",120),prompt=text(args,"customSetting",4000),language=text(args,"language",10);
        LLMSite site=AvailableSites.getLLMSite(sid);
        if(site==null||!site.enabled())throw new IllegalArgumentException("maid_site_not_enabled");
        if(!(site instanceof SupportModelSelect select)||!select.models().containsKey(model))throw new IllegalArgumentException("maid_model_not_in_site");
        if(!Set.of("zh_cn","en_us").contains(language))throw new IllegalArgumentException("unsupported_chat_language");
        // No copyFrom: preserve native TTS, history, role progress and every other maid field.
        data.llmSite=sid;data.llmModel=model;data.customSetting=prompt;data.chatLanguage=language;data.ownerName=player.getGameProfile().getName();
        return object("ok",true,"maid",state(maid),"modelRequests",0);
    }
    JsonObject saveSite(ServerPlayer player,JsonObject args){
        if(!GameModeUtil.canEditSite(player))throw new IllegalArgumentException("maid_site_requires_operator");
        String sid=text(args,"siteId",100);
        if(!sid.matches("[A-Za-z0-9_.-]{1,100}"))throw new IllegalArgumentException("invalid_maid_site_id");
        LLMSite old=AvailableSites.getLLMSite(sid);String expected=text(args,"revision",64);
        if(old==null?!expected.equals("new"):!equalsSecret(revision(old),expected))throw new IllegalArgumentException("maid_site_changed_refresh");
        if(old!=null&&!(old instanceof LLMOpenAISite))throw new IllegalArgumentException("unsupported_maid_site_type");
        if(old==null&&AvailableSites.LLM_SITES.size()>=64)throw new IllegalArgumentException("maid_site_capacity_reached");
        String url=text(args,"url",500);runtime.validateEndpoint(url);
        if(!java.net.URI.create(url).getPath().endsWith("/chat/completions"))throw new IllegalArgumentException("maid_site_needs_chat_completions_url");
        String key=text(args,"apiKey",4096);
        if(key.isBlank()&&old instanceof LLMOpenAISite previous)key=previous.secretKey();
        if(!key.isEmpty()&&!key.matches("[\\x21-\\x7e]{8,4096}"))throw new IllegalArgumentException("invalid_api_key");
        if(!args.has("models")||!args.get("models").isJsonArray())throw new IllegalArgumentException("invalid_maid_models");
        JsonArray requested=args.getAsJsonArray("models");
        if(requested.isEmpty()||requested.size()>24)throw new IllegalArgumentException("maid_models_limit");
        Map<String,LLMOpenAISite.ModelEntry> entries=new LinkedHashMap<>();
        for(var item:requested){
            if(!item.isJsonPrimitive()||!item.getAsJsonPrimitive().isString())throw new IllegalArgumentException("invalid_maid_model");
            String model=item.getAsString();if(model.isBlank()||model.length()>120||model.chars().anyMatch(Character::isISOControl)||entries.containsKey(model))throw new IllegalArgumentException("invalid_maid_model");
            var entry=old instanceof LLMOpenAISite previous?previous.modelEntries().get(model):null;
            entries.put(model,entry==null?new LLMOpenAISite.ModelEntry(model):entry);
        }
        boolean enabled=args.get("enabled").getAsBoolean(),thinking=args.get("hasThinkingField").getAsBoolean();
        if(enabled&&key.isBlank())throw new IllegalArgumentException("configure_model_and_key_first");
        LLMSite updated=new LLMOpenAISite(sid,old==null?ResourceLocation.fromNamespaceAndPath("touhou_little_maid","textures/gui/ai/openai.png"):old.icon(),url,enabled,key,thinking,old==null?Map.of():old.headers(),entries);
        Map<String,LLMSite> all=new LinkedHashMap<>(AvailableSites.LLM_SITES);all.put(sid,updated);
        Path file=runtime.server.getServerDirectory().resolve("config/touhou_little_maid/sites/llm.json"),tmp=file.resolveSibling("llm.json.maw-"+UUID.randomUUID());
        try{
            Files.createDirectories(file.getParent());
            if(Files.isSymbolicLink(file)||Files.isSymbolicLink(file.getParent()))throw new IllegalArgumentException("private_record_symlink");
            // The exact native serializer, atomic disk commit BEFORE publishing the in-memory site.
            LLMSite.writeSites(tmp,all);
            if(Files.size(tmp)>2_097_152)throw new IllegalArgumentException("maid_sites_too_large");
            Map<String,LLMSite> decoded=LLMSite.readSites(tmp);
            if(!decoded.keySet().equals(all.keySet())||all.entrySet().stream().anyMatch(e->!revision(e.getValue()).equals(revision(decoded.get(e.getKey())))))throw new IllegalArgumentException("maid_site_native_roundtrip_failed");
            try(FileChannel channel=FileChannel.open(tmp,StandardOpenOption.WRITE)){channel.force(true);}
            Files.move(tmp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
        }catch(java.io.IOException failure){throw new IllegalStateException("maid_site_save_failed");}
        finally{try{Files.deleteIfExists(tmp);}catch(java.io.IOException ignored){}}
        AvailableSites.LLM_SITES.put(sid,updated);SettingReader.reloadSettings();
        return object("ok",true,"site",site(updated,true),"modelRequests",0);
    }
}
