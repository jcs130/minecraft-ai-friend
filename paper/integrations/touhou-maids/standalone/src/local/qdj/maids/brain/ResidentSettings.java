package local.qdj.maids.brain;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import com.github.tartaricacid.touhoulittlemaid.ai.manager.site.AvailableSites;
import net.minecraft.network.chat.Component;

/** Operator-selected catalog IDs only. No credentials, URLs, shell commands or body replacement. */
final class ResidentSettings {
    private final Path directory;
    private final MaidResidents residents;
    private final MaidAgentsServer agents;
    private final Map<UUID,JsonObject> profiles=new HashMap<>();
    private final Map<String,MaidAgentsConfig.Voice> voices=new LinkedHashMap<>();
    private final Map<String,ResidentConfig.Appearance> models=new LinkedHashMap<>();
    private final Map<String,String> modelNames=new LinkedHashMap<>();
    private final Map<UUID,Long> installed=new HashMap<>();
    ResidentSettings(Path directory,Path config,MaidResidents residents,MaidAgentsServer agents)throws Exception {
        this.directory=directory;this.residents=residents;this.agents=agents;
        Path modelFile=config.resolve("tlm-resident-models.json");
        if(Files.exists(modelFile)){
            if(Files.size(modelFile)>32768)throw new IllegalArgumentException("model_catalog_too_large");
            var values=JsonParser.parseString(Files.readString(modelFile)).getAsJsonObject();
            if(values.size()>32)throw new IllegalArgumentException("model_catalog_too_large");
            for(var e:values.entrySet()){
                var value=e.getValue().getAsJsonObject();
                if(!e.getKey().matches("[a-z][a-z0-9_-]{0,31}")||e.getKey().equals("original"))throw new IllegalArgumentException("model_id_invalid");
                var model=new Gson().fromJson(value,ResidentConfig.Appearance.class);
                if(model==null||model.modelId()==null||!model.modelId().matches("[A-Za-z0-9_.-]{1,96}\\.ysm")||!ResidentConfig.text(model.texture(),64)||!model.sha256().matches("[a-f0-9]{64}"))throw new IllegalArgumentException("model_config_invalid");
                String label=value.get("label").getAsString();if(!ResidentConfig.text(label,48))throw new IllegalArgumentException("model_label_invalid");
                models.put(e.getKey(),model);modelNames.put(e.getKey(),label);
            }
        }
        Path options=config.resolve("tlm-resident-voices.json");
        if(Files.exists(options)) {
            if(Files.size(options)>32768)throw new IllegalArgumentException("voice_catalog_too_large");
            var value=JsonParser.parseString(Files.readString(options)).getAsJsonObject();
            if(value.size()>32)throw new IllegalArgumentException("voice_catalog_too_large");
            for(var entry:value.entrySet()) {
                if(!entry.getKey().matches("[a-z][a-z0-9_-]{0,31}")||List.of("none","default").contains(entry.getKey()))throw new IllegalArgumentException("voice_id_invalid");
                var voice=new Gson().fromJson(entry.getValue(),MaidAgentsConfig.Voice.class);
                if(voice==null||!ResidentConfig.text(voice.site(),96)||!ResidentConfig.text(voice.model(),128)||!List.of("zh-CN","ja-JP").contains(voice.language()))throw new IllegalArgumentException("voice_config_invalid");
                voices.put(entry.getKey(),voice);
            }
        }
        for(var id:residents.ids()) {
            Path file=directory.resolve(id+".json");
            if(Files.exists(file)) {
                if(Files.size(file)>16384)throw new IllegalArgumentException("profile_too_large");
                var p=JsonParser.parseString(Files.readString(file)).getAsJsonObject();
                if(!id.toString().equals(p.get("maidId").getAsString()))throw new IllegalArgumentException("profile_identity_mismatch");
                if(!p.getAsJsonObject("profile").has("appearance"))p.getAsJsonObject("profile").addProperty("appearance","original");
                validate(id,p.getAsJsonObject("profile"));profiles.put(id,p);
            }
        }
    }
    JsonObject profile(UUID id) {
        var saved=profiles.get(id);if(saved!=null)return saved.getAsJsonObject("profile").deepCopy();
        var r=residents.role(id);var a=agents.agent(id);var maid=residents.body(id);
        var p=new JsonObject();p.addProperty("name",r.name());p.addProperty("persona",a.persona(agents.companions()==null?"Minecraft居民":agents.companions().persona(id)));
        String brain=maid==null?"":a.brain(maid);p.addProperty("brain",a.binding().choices().containsKey(brain)?brain:a.binding().choices().keySet().stream().sorted().findFirst().orElseThrow());
        p.addProperty("appearance","original");p.addProperty("voice",a.binding().voice()==null?"none":"default");p.addProperty("autonomous",r.autonomous());p.addProperty("mapVisible",true);return p;
    }
    long revision(UUID id){return profiles.containsKey(id)?profiles.get(id).get("revision").getAsLong():0;}
    boolean flag(UUID id,String key){return profile(id).get(key).getAsBoolean();}
    String name(UUID id){return profile(id).get("name").getAsString();}
    private MaidAgentsConfig.Voice voice(UUID id,String key){return key.equals("none")?null:key.equals("default")?agents.agent(id).binding().voice():voices.get(key);}
    private boolean voiceAvailable(UUID id,String key){var v=voice(id,key);return key.equals("none")||v!=null&&AvailableSites.getTTSSite(v.site())!=null&&AvailableSites.getTTSSite(v.site()).enabled();}
    private List<String> voiceIds(UUID id){var out=new ArrayList<String>();out.add("none");if(voiceAvailable(id,"default"))out.add("default");for(String key:voices.keySet())if(voiceAvailable(id,key))out.add(key);return out;}
    private void validate(UUID id,JsonObject p) {
        if(!p.keySet().equals(Set.of("name","persona","brain","voice","appearance","autonomous","mapVisible")))throw new IllegalArgumentException("profile_fields_required");
        for(String key:List.of("name","persona","brain","voice","appearance"))if(!p.get(key).isJsonPrimitive()||!p.get(key).getAsJsonPrimitive().isString())throw new IllegalArgumentException(key+": string required");
        for(String key:List.of("autonomous","mapVisible"))if(!p.get(key).isJsonPrimitive()||!p.get(key).getAsJsonPrimitive().isBoolean())throw new IllegalArgumentException(key+": boolean required");
        if(!ResidentConfig.text(p.get("name").getAsString(),24)||!ResidentConfig.text(p.get("persona").getAsString(),1200))throw new IllegalArgumentException("name_or_persona_invalid");
        if(!agents.agent(id).binding().choices().containsKey(p.get("brain").getAsString()))throw new IllegalArgumentException("brain_not_configured");
        String key=p.get("voice").getAsString();if(!key.equals("none")&&!key.equals("default")&&!voices.containsKey(key))throw new IllegalArgumentException("voice_not_configured");
        key=p.get("appearance").getAsString();if(!key.equals("original")&&!models.containsKey(key))throw new IllegalArgumentException("model_not_configured");
    }
    void install(UUID id) {
        if(!profiles.containsKey(id)||Objects.equals(installed.get(id),revision(id)))return;
        var maid=residents.body(id);if(maid==null)return;var p=profile(id);var a=agents.agent(id);
        a.select(maid,p.get("brain").getAsString());a.configurePersona(p.get("persona").getAsString());
        a.configureVoice(voice(id,p.get("voice").getAsString()));
        if(a.voiceConfig()!=null&&voiceAvailable(id,p.get("voice").getAsString()))a.voice(maid);
        var model=selectedModel(id,p);
        try{if(model!=null)ResidentAppearance.apply(maid,model,p.get("name").getAsString());else maid.setIsYsmModel(false);}
        catch(Exception invalid){throw new IllegalArgumentException("model_unavailable",invalid);}
        maid.setCustomName(Component.literal(p.get("name").getAsString()));installed.put(id,revision(id));
    }
    Map<String,Object> catalogue() {
        var rows=new ArrayList<Map<String,Object>>();
        for(var id:residents.ids()) {
            var a=agents.agent(id);var maid=residents.body(id);
            rows.add(Map.of("id",id.toString(),"revision",revision(id),"profile",profile(id),"loaded",maid!=null,
                "profession",residents.role(id).profession(),"brains",a.binding().choices().entrySet().stream().sorted(Map.Entry.comparingByKey()).map(e->Map.of("id",e.getKey(),"model",e.getValue().model())).toList(),
                "voices",voiceIds(id),"models",modelOptions(),"currentBrain",maid==null?"offline":a.brain(maid)));
        }
        return Map.of("schemaVersion",1,"observedAt",java.time.Instant.now().toString(),"residents",rows);
    }
    private ResidentConfig.Appearance selectedModel(UUID id,JsonObject p){return p.get("appearance").getAsString().equals("original")?residents.role(id).appearance():models.get(p.get("appearance").getAsString());}
    private List<Map<String,String>> modelOptions(){var out=new ArrayList<Map<String,String>>();out.add(Map.of("id","original","label","角色原外观"));modelNames.forEach((id,name)->out.add(Map.of("id",id,"label",name)));return out;}
    Map<String,Object> receipt(UUID id,UUID request) {
        var saved=profiles.get(id);
        if(saved==null||!request.toString().equals(saved.get("requestId").getAsString()))return Map.of("requestId",request.toString(),"id",id.toString(),"status","unknown","completed",false,"reason","original_request_not_current_no_replay");
        install(id);boolean done=residents.body(id)!=null&&Objects.equals(installed.get(id),revision(id));
        return Map.of("requestId",request.toString(),"id",id.toString(),"status",done?"applied":"waiting_body","completed",done,"reason",done?"native_profile_verified":"saved_waiting_original_body");
    }
    Map<String,Object> applyChecked(UUID id,UUID request,long expected,JsonObject profile)throws Exception {
        try{return apply(id,request,expected,profile);}catch(IllegalArgumentException invalid){
            String reason=String.valueOf(invalid.getMessage()).replaceAll("[^a-z0-9_:-]","_");if(reason.length()>120)reason=reason.substring(0,120);
            return Map.of("requestId",request.toString(),"id",id.toString(),"status","failed","completed",false,"reason",reason);
        }
    }
    Map<String,Object> apply(UUID id,UUID request,long expected,JsonObject profile)throws Exception {
        if(residents.role(id)==null)throw new IllegalArgumentException("unknown_resident");
        validate(id,profile);
        var old=profiles.get(id);
        if(old!=null&&request.toString().equals(old.get("requestId").getAsString())) {
            if(old.get("expectedRevision").getAsLong()!=expected||!old.getAsJsonObject("profile").equals(profile))throw new IllegalArgumentException("request_id_conflict");
        } else {
            if(expected!=revision(id))throw new IllegalArgumentException("revision_conflict_read_again");
            if(residents.busy(id)||agents.companions()!=null&&agents.companions().thinking(id))throw new IllegalArgumentException("npc_busy_read_again");
            if(residents.body(id)==null)throw new IllegalArgumentException("body_unavailable");
            if(!voiceAvailable(id,profile.get("voice").getAsString()))throw new IllegalArgumentException("voice_unavailable");
            var model=selectedModel(id,profile);if(model!=null)ResidentAppearance.check(model);
            var a=agents.agent(id);var choice=a.binding().choices().get(profile.get("brain").getAsString());
            if(AvailableSites.getLLMSite(choice.site())==null||!AvailableSites.getLLMSite(choice.site()).enabled())throw new IllegalArgumentException("brain_unavailable");
            var saved=new JsonObject();saved.addProperty("maidId",id.toString());saved.addProperty("requestId",request.toString());saved.addProperty("expectedRevision",expected);saved.addProperty("revision",expected+1);saved.add("profile",profile.deepCopy());
            ResidentReceipts.replace(directory.resolve(id+".json"),saved);profiles.put(id,saved);a.invalidateActions();
        }
        install(id);var maid=residents.body(id);boolean applied=maid!=null&&Objects.equals(installed.get(id),revision(id))&&agents.agent(id).brain(maid).equals(profile.get("brain").getAsString())&&maid.getName().getString().equals(profile.get("name").getAsString());
        return Map.of("requestId",request.toString(),"id",id.toString(),"status",applied?"applied":"waiting_body","completed",applied,"revision",revision(id),"reason",applied?"native_profile_verified":"saved_waiting_original_body","observedAt",java.time.Instant.now().toString());
    }
}
