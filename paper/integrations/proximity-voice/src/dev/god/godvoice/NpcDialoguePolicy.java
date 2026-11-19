package dev.god.godvoice;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Pattern;

/** Explicit NPC voice identities, never inferred from names or chat text. */
final class NpcDialoguePolicy {
    record Profile(UUID id,UUID owner,String kind,String name,String voice,double range,List<String> aliases) {
        boolean hasName(String value){return name.equalsIgnoreCase(value)||aliases.stream().anyMatch(value::equalsIgnoreCase);}
        String display(){return aliases.isEmpty()?name:aliases.getFirst();}
    }
    record Address(Profile profile,String text) {}
    record Group(List<Profile> recipients, String message) {}
    private static final Pattern GROUP_END = Pattern.compile("[,，:：]");

    /** A leading list of registered names followed by a separate message. */
    static Group group(Collection<Profile> profiles, String text) {
        if (text == null || text.length() > 1200 || !text.contains("、")
                || text.codePoints().anyMatch(c -> Character.isISOControl(c) || c == 0xA7)) return null;
        String line = text.strip();
        var end = GROUP_END.matcher(line);
        if (!end.find()) return null;
        String message = line.substring(end.end()).strip();
        String[] names = line.substring(0, end.start()).split("、", -1);
        if (message.isEmpty() || names.length < 2) return null;
        var recipients = new LinkedHashSet<Profile>();
        for (String name : names) {
            String label = name.strip();
            if (label.startsWith("@")) label = label.substring(1);
            Profile target = null;
            for (var profile : profiles) if (profile.hasName(label)) { target = profile; break; }
            if (target == null) return null;
            recipients.add(target);
        }
        return new Group(List.copyOf(recipients), message);
    }
    static Map<UUID,Profile> profiles(JsonObject config) {
        if(!config.has("schema")||config.get("schema").getAsInt()!=1||!config.has("roles"))throw new IllegalArgumentException("NPC_VOICE_CONFIG_INVALID");
        var result=new LinkedHashMap<UUID,Profile>();
        var names=new HashMap<String,UUID>();
        var roles=config.getAsJsonArray("roles");if(roles.size()>32)throw new IllegalArgumentException("NPC_VOICE_LIMIT");
        for(var value:roles){
            var row=value.getAsJsonObject();UUID id=UUID.fromString(row.get("id").getAsString()),owner=UUID.fromString(row.get("ownerId").getAsString());
            String kind=row.get("kind").getAsString(),name=row.get("name").getAsString(),voice=row.get("voice").getAsString();
            double range=row.has("range")?row.get("range").getAsDouble():24;
            if(id.equals(owner)||!Set.of("maid","numen").contains(kind)||name.isBlank()||name.length()>48
                ||!voice.matches("[A-Za-z0-9_.-]{1,96}")||!Double.isFinite(range)||range<1||range>48)throw new IllegalArgumentException("NPC_VOICE_PROFILE_INVALID");
            var aliases=new ArrayList<String>();
            if(row.has("aliases")){
                if(!row.get("aliases").isJsonArray())throw new IllegalArgumentException("NPC_VOICE_ALIAS_INVALID");
                var configured=row.getAsJsonArray("aliases");
                if(configured.size()>8)throw new IllegalArgumentException("NPC_VOICE_ALIAS_LIMIT");
                for(var item:configured){
                    if(!item.isJsonPrimitive()||!item.getAsJsonPrimitive().isString())throw new IllegalArgumentException("NPC_VOICE_ALIAS_INVALID");
                    String alias=item.getAsString();
                    if(alias.isBlank()||alias.length()>48||!alias.equals(alias.strip())||
                        alias.codePoints().anyMatch(cp->Character.isISOControl(cp)||cp==0xA7||cp=='@'||cp=='/'||cp=='!'))
                        throw new IllegalArgumentException("NPC_VOICE_ALIAS_INVALID");
                    aliases.add(alias);
                }
            }
            var profile=new Profile(id,owner,kind,name,voice,range,List.copyOf(aliases));
            if(result.putIfAbsent(id,profile)!=null)throw new IllegalArgumentException("NPC_VOICE_DUPLICATE_ID");
            for(String label:labels(profile)){
                UUID other=names.putIfAbsent(label.toLowerCase(Locale.ROOT),id);
                if(other!=null&&!other.equals(id))throw new IllegalArgumentException("NPC_VOICE_AMBIGUOUS_ALIAS");
            }
        }
        return Collections.unmodifiableMap(result);
    }
    private static List<String> labels(Profile profile){
        var labels=new ArrayList<>(profile.aliases());
        labels.add(profile.name());
        return labels;
    }
    static Address addressed(Collection<Profile> profiles,String text){
        String line=text.strip();
        if(line.startsWith("@"))line=line.substring(1);
        Address matched=null;
        int longest=0;
        for(var profile:profiles)for(String label:labels(profile)){
            if(label.length()<=longest||line.length()<=label.length()||!line.regionMatches(true,0,label,0,label.length()))continue;
            String rest=line.substring(label.length());
            int first=rest.codePointAt(0);
            if(!Character.isWhitespace(first)&&"，,:：!！?？、。".indexOf(first)<0&&first!='你'&&first!='咱')continue;
            rest=rest.replaceFirst("^[\\s，,:：!！?？、。]+","").strip();
            if(!rest.isEmpty()){
                matched=new Address(profile,rest);
                longest=label.length();
            }
        }
        return matched;
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
