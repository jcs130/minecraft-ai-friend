package dev.god.godvoice;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.regex.Pattern;

/** Explicit NPC voice identities, never inferred from names or chat text. */
final class NpcDialoguePolicy {
    record Profile(UUID id,UUID owner,String kind,String name,String voice,double range,List<String> aliases,List<String> spokenAliases,String residentId,String serviceCounter) {
        Profile(UUID id,UUID owner,String kind,String name,String voice,double range,List<String> aliases,List<String> spokenAliases,String residentId) {
            this(id,owner,kind,name,voice,range,aliases,spokenAliases,residentId,null);
        }
        Profile(UUID id,UUID owner,String kind,String name,String voice,double range,List<String> aliases,List<String> spokenAliases) {
            this(id,owner,kind,name,voice,range,aliases,spokenAliases,null);
        }
        Profile(UUID id,UUID owner,String kind,String name,String voice,double range,List<String> aliases) {
            this(id,owner,kind,name,voice,range,aliases,List.of());
        }
        boolean hasName(String value){return name.equalsIgnoreCase(value)||aliases.stream().anyMatch(value::equalsIgnoreCase);}
        String display(){return aliases.isEmpty()?name:aliases.getFirst();}
    }
    record Address(Profile profile,String text) {}
    record Group(List<Profile> recipients, String message) {}
    static String replyMode(JsonObject submitted, JsonObject answer){
        if(!answer.has("replyMode"))return "native";
        var value=answer.get("replyMode");
        if(!value.isJsonPrimitive()||!value.getAsJsonPrimitive().isString())return null;
        String mode=value.getAsString();
        if(mode.equals("native"))return mode;
        return Set.of("text","speech").contains(mode) && submitted.has("replyModes")
            && submitted.getAsJsonArray("replyModes").contains(value)?mode:null;
    }
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
        var residents=new HashSet<String>();
        var roles=config.getAsJsonArray("roles");if(roles.size()>32)throw new IllegalArgumentException("NPC_VOICE_LIMIT");
        for(var value:roles){
            var row=value.getAsJsonObject();UUID id=UUID.fromString(row.get("id").getAsString());
            String kind=row.get("kind").getAsString(),name=row.get("name").getAsString(),voice=row.get("voice").getAsString();
            UUID owner=null;
            String residentId=null;
            String serviceCounter=null;
            if(kind.equals("villager")){
                if(row.has("ownerId")||!row.has("residentId")||!row.get("residentId").isJsonPrimitive()||!row.get("residentId").getAsJsonPrimitive().isString())
                    throw new IllegalArgumentException("VILLAGER_VOICE_IDENTITY_INVALID");
                residentId=row.get("residentId").getAsString();
                if(!residentId.matches("[A-Za-z0-9_-]{1,48}")||!residents.add(residentId))
                    throw new IllegalArgumentException("VILLAGER_VOICE_IDENTITY_INVALID");
                if(row.has("serviceCounter")){
                    var service=row.get("serviceCounter");
                    if(!service.isJsonPrimitive()||!service.getAsJsonPrimitive().isString()
                            ||!"guild-receptionist".equals(service.getAsString()))
                        throw new IllegalArgumentException("VILLAGER_VOICE_SERVICE_INVALID");
                    serviceCounter=service.getAsString();
                }
            }else{
                if(!Set.of("maid","numen").contains(kind)||row.has("residentId")||row.has("serviceCounter")||!row.has("ownerId"))
                    throw new IllegalArgumentException("NPC_VOICE_PROFILE_INVALID");
                owner=UUID.fromString(row.get("ownerId").getAsString());
            }
            double range=row.has("range")?row.get("range").getAsDouble():24;
            if(id.equals(owner)||name.isBlank()||name.length()>48
                ||!voice.matches("[A-Za-z0-9_.-]{1,96}")||!Double.isFinite(range)||range<1||range>48)throw new IllegalArgumentException("NPC_VOICE_PROFILE_INVALID");
            var aliases=new ArrayList<String>(); var spokenAliases=new ArrayList<String>();
            for(String field:List.of("aliases","spokenAliases"))if(row.has(field)){
                if(!row.get(field).isJsonArray())throw new IllegalArgumentException("NPC_VOICE_ALIAS_INVALID");
                var configured=row.getAsJsonArray(field);
                if(configured.size()>8)throw new IllegalArgumentException("NPC_VOICE_ALIAS_LIMIT");
                for(var item:configured){
                    if(!item.isJsonPrimitive()||!item.getAsJsonPrimitive().isString())throw new IllegalArgumentException("NPC_VOICE_ALIAS_INVALID");
                    String alias=item.getAsString();
                    if(alias.isBlank()||alias.length()>48||!alias.equals(alias.strip())||
                        alias.codePoints().anyMatch(cp->Character.isISOControl(cp)||cp==0xA7||cp=='@'||cp=='/'||cp=='!'))
                        throw new IllegalArgumentException("NPC_VOICE_ALIAS_INVALID");
                    (field.equals("aliases")?aliases:spokenAliases).add(alias);
                }
            }
            var profile=new Profile(id,owner,kind,name,voice,range,List.copyOf(aliases),List.copyOf(spokenAliases),residentId,serviceCounter);
            if(result.putIfAbsent(id,profile)!=null)throw new IllegalArgumentException("NPC_VOICE_DUPLICATE_ID");
            for(String label:labels(profile,true)){
                UUID other=names.putIfAbsent(label.toLowerCase(Locale.ROOT),id);
                if(other!=null&&!other.equals(id))throw new IllegalArgumentException("NPC_VOICE_AMBIGUOUS_ALIAS");
            }
        }
        return Collections.unmodifiableMap(result);
    }
    private static List<String> labels(Profile profile,boolean spoken){
        var labels=new ArrayList<>(profile.aliases());
        labels.add(profile.name());
        if(spoken)labels.addAll(profile.spokenAliases());
        return labels;
    }
    /** Local activation records add a display name to a pre-registered body; all native bindings stay fixed. */
    static Map<UUID,Profile> residentNames(Map<UUID,Profile> configured, Path folder){
        if(!Files.isDirectory(folder))return configured;
        var claims=new HashMap<String,Set<UUID>>();
        var desired=new LinkedHashMap<UUID,String>();
        for(var profile:configured.values()){
            for(String label:labels(profile,true))
                claims.computeIfAbsent(label.toLowerCase(Locale.ROOT),key->new HashSet<>()).add(profile.id());
            if(profile.owner()==null)continue;
            Path file=folder.resolve(profile.id()+".json");
            try{
                if(!Files.isRegularFile(file,java.nio.file.LinkOption.NOFOLLOW_LINKS)||Files.size(file)>4096)continue;
                var record=JsonParser.parseString(Files.readString(file)).getAsJsonObject();
                if(!profile.id().toString().equals(record.get("bodyId").getAsString())
                        ||!profile.owner().toString().equals(record.get("ownerGameId").getAsString())
                        ||!profile.kind().equals(record.get("bodyKind").getAsString()))continue;
                String character=record.get("characterId").getAsString();
                if(!character.equals(UUID.fromString(character).toString()))continue;
                String name=record.get("name").getAsString();
                if(!name.equals(name.strip())||!name.matches("[\\p{L}\\p{N}_· -]{1,24}"))continue;
                desired.put(profile.id(),name);
                claims.computeIfAbsent(name.toLowerCase(Locale.ROOT),key->new HashSet<>()).add(profile.id());
            }catch(java.io.IOException|RuntimeException unavailable){/* A malformed record never changes the native profile. */}
        }
        var result=new LinkedHashMap<>(configured);
        for(var entry:desired.entrySet()){
            if(claims.get(entry.getValue().toLowerCase(Locale.ROOT)).size()!=1)continue;
            var p=configured.get(entry.getKey());
            var aliases=new LinkedHashSet<String>();aliases.add(entry.getValue());aliases.addAll(p.aliases());
            result.put(p.id(),new Profile(p.id(),p.owner(),p.kind(),p.name(),p.voice(),p.range(),List.copyOf(aliases),p.spokenAliases()));
        }
        return Collections.unmodifiableMap(result);
    }
    static Address addressed(Collection<Profile> profiles,String text){
        return addressed(profiles,text,false);
    }
    static boolean asksForAction(String rest){
        return rest.startsWith("帮我")||rest.startsWith("帮忙")||rest.startsWith("跟我")||rest.startsWith("带我")||rest.startsWith("掩护我");
    }
    static Address addressed(Collection<Profile> profiles,String text,boolean spoken){
        String line=text.strip();
        if(line.startsWith("@"))line=line.substring(1);
        Address matched=null;
        int longest=0;
        for(var profile:profiles)for(String label:labels(profile,spoken)){
            if(label.length()<=longest||line.length()<=label.length()||!line.regionMatches(true,0,label,0,label.length()))continue;
            String rest=line.substring(label.length());
            int first=rest.codePointAt(0);
            if(!Character.isWhitespace(first)&&"，,:：!！?？、。".indexOf(first)<0&&first!='你'&&first!='咱'
                && !asksForAction(rest) && !rest.startsWith("在吗"))continue;
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
