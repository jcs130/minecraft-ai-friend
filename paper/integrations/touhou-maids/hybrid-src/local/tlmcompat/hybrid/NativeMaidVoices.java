package local.tlmcompat.hybrid;

import com.github.tartaricacid.touhoulittlemaid.entity.passive.EntityMaid;
import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import net.minecraft.world.entity.Mob;

/** Explicit per-body voices using the existing local media service and durable receipts. */
final class NativeMaidVoices implements AutoCloseable {
    private final Map<UUID,NativeMaidSpeech> voices=new LinkedHashMap<>();
    static NativeMaidVoices create(HybridMaidPlugin plugin){
        var result=new NativeMaidVoices();
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
            for(var entry:candidates.entrySet())result.voices.put(entry.getKey(),new NativeMaidSpeech(plugin,entry.getValue(),registered.contains(entry.getKey())));
        }catch(Exception|LinkageError failed){result.close();plugin.getLogger().warning("NPC maid voices unavailable: "+failed.getClass().getSimpleName()+"; text remains available");}
        return result;
    }
    void reply(EntityMaid maid,String operation,String text,Set<UUID> audience){var voice=voices.get(maid.getUUID());if(voice!=null)voice.reply(maid,operation,text,audience);}
    void combat(EntityMaid maid,Mob target,String mode,float damage){var voice=voices.get(maid.getUUID());if(voice!=null)voice.combat(maid,target,mode,damage);}
    JsonObject describe(EntityMaid maid){var voice=voices.get(maid.getUUID());if(voice!=null)return voice.describe(maid);var out=new JsonObject();out.addProperty("enabled",false);out.addProperty("reason","voice_not_configured");return out;}
    public void close(){for(var voice:voices.values())voice.close();voices.clear();}
}
