package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import net.minecraft.world.entity.Mob;
import de.maxhenkel.voicechat.api.*;
import de.maxhenkel.voicechat.api.events.*;
import java.util.concurrent.ConcurrentHashMap;
import org.bukkit.Bukkit;

/** Explicit per-body voices using the existing local media service and durable receipts. */
final class NativeMaidVoices implements AutoCloseable {
    private final Map<UUID,NativeMaidSpeech> voices=new ConcurrentHashMap<>();
    private final Set<UUID> personalVoices=new HashSet<>(); // game thread only
    private final Map<UUID,String> missingNotices=new LinkedHashMap<>();
    private final HybridMaidPlugin plugin;
    private JsonObject transport;
    private MaidSpeechMedia media;
    private MaidPackTtsSite nativeSite;
    private volatile VoicechatServerApi api;
    private NativeMaidVoices(HybridMaidPlugin plugin){this.plugin=plugin;}

    static NativeMaidVoices create(HybridMaidPlugin plugin){
        var result=new NativeMaidVoices(plugin);
        Path baseFile=plugin.getDataFolder().toPath().resolve("companion-speech.json");
        if(!Files.exists(baseFile))return result;
        try{
            var base=JsonParser.parseString(Files.readString(baseFile)).getAsJsonObject();
            UUID primary=UUID.fromString(base.get("maidId").getAsString());
            Path registry=plugin.getDataFolder().toPath().getParent().resolve("QiandengVoice/npc-voices.json");
            var candidates=new LinkedHashMap<UUID,JsonObject>();candidates.put(primary,base);
            var registered=new HashSet<UUID>();
            if(Files.exists(registry)){
                var config=JsonParser.parseString(Files.readString(registry)).getAsJsonObject();
                if(config.get("schema").getAsInt()!=1)throw new IllegalArgumentException("NPC voice schema");
                if(config.getAsJsonArray("roles").size()>32)throw new IllegalArgumentException("NPC voice limit");
                var seen=new HashSet<UUID>();
                for(var value:config.getAsJsonArray("roles")){
                    var row=value.getAsJsonObject();UUID id=UUID.fromString(row.get("id").getAsString());
                    if(!seen.add(id))throw new IllegalArgumentException("Duplicate NPC voice");
                    if(!"maid".equals(row.get("kind").getAsString()))continue;
                    UUID owner=UUID.fromString(row.get("ownerId").getAsString());
                    if(id.equals(primary)&&!owner.toString().equals(base.get("ownerId").getAsString()))throw new IllegalArgumentException("Primary owner mismatch");
                    var voice=base.deepCopy();voice.addProperty("maidId",id.toString());voice.addProperty("ownerId",owner.toString());voice.add("voice",row.get("voice").deepCopy());
                    // A primary companion's prerecorded clips must not leak into another role's voice.
                    if(!id.equals(primary))voice.remove("ambientPack");candidates.put(id,voice);registered.add(id);
                }
            }
            result.transport=base;
            result.media=new MaidSpeechMedia(base);
            if(plugin.personal!=null&&plugin.personal.allOwned()){
                try{result.nativeSite=new MaidPackTtsSite(plugin,result.media,plugin.personal.nativeEncoder());}
                catch(Exception|LinkageError error){plugin.getLogger().warning("Native pack TTS unavailable: "+error.getClass().getSimpleName());}
            }
            for(var entry:candidates.entrySet())result.voices.put(entry.getKey(),new NativeMaidSpeech(plugin,entry.getValue(),registered.contains(entry.getKey()),result.media));
            result.registerPlayback();
        }catch(Exception|LinkageError failed){result.close();plugin.getLogger().warning("NPC maid voices unavailable: "+failed.getClass().getSimpleName()+"; text remains available");}
        return result;
    }
    private void registerPlayback(){
        BukkitVoicechatService service=Bukkit.getServicesManager().load(BukkitVoicechatService.class);
        if(service==null)return;
        // SVC registers plugins before the server starts. Future adoptions share this one listener.
        service.registerPlugin(new VoicechatPlugin(){
            public String getPluginId(){return "qiandengji_maid_voices";}
            public void registerEvents(EventRegistration events){
                events.registerEvent(VoicechatServerStartedEvent.class,event->{
                    api=event.getVoicechat();voices.values().forEach(v->v.voiceService(api));
                });
                events.registerEvent(VoicechatServerStoppedEvent.class,event->{
                    api=null;voices.values().forEach(v->v.voiceService(null));
                });
                events.registerEvent(LocationalSoundPacketEvent.class,event->voices.values().forEach(v->v.offered(event)),1000);
            }
        });
        Bukkit.getScheduler().runTaskTimer(plugin,()->{
            voices.values().forEach(NativeMaidSpeech::tick);
            personalVoices.removeIf(id->{
                var voice=voices.get(id);
                if(!voice.idle())return false;
                voices.remove(id,voice);voice.close();return true;
            });
        },5,5);
    }

    void applyNativeDefault(EntityMaid maid){
        var manager=maid.getAiChatManager();
        if(nativeSite!=null&&manager.ttsSite.isBlank()&&manager.ttsModel.isBlank()){
            manager.ttsSite=PersonalMaidDialogue.SITE;
            manager.ttsModel=MaidPackTtsSite.MODEL;
            if(manager.ttsLanguage.isBlank())manager.ttsLanguage="zh_cn";
        }
    }

    NativeMaidSpeech forReply(EntityMaid maid){
        UUID id=maid.getUUID();
        var current=voices.get(id);
        if(current!=null&&!personalVoices.contains(id))return current;
        if((!plugin.personalDialogue(maid)&&!plugin.guideVoice(maid))||media==null)return null;
        if(current!=null&&current.forSelection(maid))return current;
        if(current!=null){voices.remove(id);personalVoices.remove(id);current.close();}
        String selected=plugin.personal.selectedVoice(maid);
        if(selected==null||personalVoices.size()>=32)return null;
        try{
            var profile=plugin.personal.speechProfile(transport,maid,selected);
            var next=new NativeMaidSpeech(plugin,profile,true,media);
            voices.put(id,next);next.voiceService(api);personalVoices.add(id);return next;
        }catch(Exception error){plugin.getLogger().warning("Personal speech unavailable: "+error.getClass().getSimpleName());return null;}
    }

    void reply(EntityMaid maid,String operation,String text,Set<UUID> audience){
        var voice=forReply(maid);
        if(voice!=null){missingNotices.remove(maid.getUUID());voice.reply(maid,operation,text,audience);return;}
        if((!plugin.personalDialogue(maid)&&!plugin.guideVoice(maid))||plugin.personal.selectedVoice(maid)!=null||maid.isSilent())return;
        var owner=Bukkit.getPlayer(maid.getOwnerUUID());
        if(owner==null||!audience.contains(owner.getUniqueId()))return;
        String selection=owner.getUniqueId()+":"+maid.getSoundPackId();
        if(selection.equals(missingNotices.put(maid.getUUID(),selection)))return;
        if(missingNotices.size()>256)missingNotices.remove(missingNotices.keySet().iterator().next());
        owner.sendMessage("[女仆语音] 当前声音包尚未导入服务器，暂用文字回复。可在女仆的声音包菜单更换。");
    }
    void combat(EntityMaid maid,Mob target,String mode,float damage){var voice=voices.get(maid.getUUID());if(voice!=null)voice.combat(maid,target,mode,damage);}
    JsonObject describe(EntityMaid maid){
        var voice=voices.get(maid.getUUID());
        if(voice!=null&&(!personalVoices.contains(maid.getUUID())||voice.forSelection(maid)))return voice.describe(maid);
        var out=new JsonObject();
        boolean personal=plugin.personalDialogue(maid)||plugin.guideVoice(maid);
        String selected=personal?plugin.personal.selectedVoice(maid):null;
        out.addProperty("soundPackId",maid.getSoundPackId());
        boolean ready=selected!=null&&api!=null&&!maid.isSilent();
        out.addProperty("enabled",ready);
        if(selected!=null)out.addProperty("voice",selected);
        if(!ready)out.addProperty("reason",!personal?"voice_not_configured":selected==null?"selected_pack_has_no_matching_voice":maid.isSilent()?"muted":"voice_service_unavailable");
        return out;
    }
    public void close(){
        if(nativeSite!=null)nativeSite.close();
        voices.values().forEach(NativeMaidSpeech::close);voices.clear();personalVoices.clear();
        if(media!=null)media.close();
    }
}
