package dev.god.godvoice;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Explicit NPC voice identities, never inferred from names or chat text. */
final class NpcDialoguePolicy {
    record Profile(UUID id,UUID owner,String kind,String name,String voice,double range) {}
    static Map<UUID,Profile> profiles(JsonObject config) {
        if(!config.has("schema")||config.get("schema").getAsInt()!=1||!config.has("roles"))throw new IllegalArgumentException("NPC_VOICE_CONFIG_INVALID");
        var result=new LinkedHashMap<UUID,Profile>();
        var roles=config.getAsJsonArray("roles");if(roles.size()>32)throw new IllegalArgumentException("NPC_VOICE_LIMIT");
        for(var value:roles){
            var row=value.getAsJsonObject();UUID id=UUID.fromString(row.get("id").getAsString()),owner=UUID.fromString(row.get("ownerId").getAsString());
            String kind=row.get("kind").getAsString(),name=row.get("name").getAsString(),voice=row.get("voice").getAsString();
            double range=row.has("range")?row.get("range").getAsDouble():24;
            if(id.equals(owner)||!Set.of("maid","numen").contains(kind)||name.isBlank()||name.length()>48
                ||!voice.matches("[A-Za-z0-9_.-]{1,96}")||!Double.isFinite(range)||range<1||range>48)throw new IllegalArgumentException("NPC_VOICE_PROFILE_INVALID");
            if(result.putIfAbsent(id,new Profile(id,owner,kind,name,voice,range))!=null)throw new IllegalArgumentException("NPC_VOICE_DUPLICATE_ID");
        }
        return Collections.unmodifiableMap(result);
    }
    static UUID speechId(UUID source,String original){
        if(original==null||original.isBlank()||original.length()>160||original.codePoints().anyMatch(Character::isISOControl))throw new IllegalArgumentException("NPC_SPEECH_ID_INVALID");
        return UUID.nameUUIDFromBytes(("npc-speech-v1\0"+source+"\0"+original).getBytes(StandardCharsets.UTF_8));
    }
    static boolean fresh(long at,long now){return at<=now&&now-at<=15_000;}
    static String text(String text){
        if(text==null||text.isBlank()||text.length()>1200||text.codePoints().anyMatch(c->Character.isISOControl(c)||c==0xA7))throw new IllegalArgumentException("NPC_DIALOGUE_TEXT_INVALID");
        return text;
    }
    static boolean nearby(UUID source,UUID target,UUID sourceWorld,UUID targetWorld,double squaredDistance,double range){
        return !source.equals(target)&&sourceWorld.equals(targetWorld)&&Double.isFinite(squaredDistance)&&squaredDistance>=0
            &&Double.isFinite(range)&&range>0&&squaredDistance<=range*range;
    }
    static final class Seen {
        private final LinkedHashMap<String,Long> rows=new LinkedHashMap<>();
        boolean add(UUID listener,UUID source,String event,long now){
            rows.entrySet().removeIf(e->e.getValue()<now-180_000);
            String key=listener+"/"+source+"/"+event;
            if(rows.putIfAbsent(key,now)!=null)return false;
            while(rows.size()>4096)rows.remove(rows.keySet().iterator().next());return true;
        }
    }
}
