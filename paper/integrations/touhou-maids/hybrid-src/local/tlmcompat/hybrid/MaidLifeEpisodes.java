package local.tlmcompat.hybrid;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;

/** Native observations only. Old graves describe history, not an unobserved new death. */
public final class MaidLifeEpisodes {
    private static final String META="_episodes";
    private final JsonObject root;
    private boolean dirty;
    private final Set<String> pendingEvents=new HashSet<>();
    public MaidLifeEpisodes(JsonObject root){this.root=root;}
    public boolean dirty(){return dirty;}
    public void saved(){dirty=false;pendingEvents.clear();}
    public boolean durable(String event){return !pendingEvents.contains(event);}
    private static long time(JsonObject value,String key){
        try{return value.get(key).getAsLong();}catch(Exception ignored){return 0;}
    }
    private static long deathTime(JsonObject value){
        try{return Instant.parse(value.get("diedAt").getAsString()).toEpochMilli();}catch(Exception ignored){return 0;}
    }
    private static String text(JsonObject value,String key){
        try{return value.get(key).getAsString();}catch(Exception ignored){return "";}
    }
    private static boolean belongs(JsonObject value,UUID owner,UUID maid){
        return value!=null&&owner.toString().equals(text(value,"ownerId"))&&maid.toString().equals(text(value,"maidId"));
    }
    private static String event(String kind,UUID maid,String evidence){
        try{
            byte[] digest=MessageDigest.getInstance("SHA-256").digest((maid+"\n"+evidence).getBytes(StandardCharsets.UTF_8));
            return kind+"-"+HexFormat.of().formatHex(digest,0,12);
        }catch(Exception error){throw new IllegalStateException(error);}
    }
    private JsonObject row(UUID owner,UUID maid){
        if(!root.has(META)){root.add(META,new JsonObject());dirty=true;}
        JsonObject meta=root.getAsJsonObject(META);
        String key=owner+"/"+maid;
        if(!meta.has(key)){
            JsonObject row=new JsonObject();row.addProperty("schema",2);row.addProperty("ownerId",owner.toString());
            JsonElement old=root.get(maid.toString());
            if(old instanceof JsonObject death&&belongs(death,owner,maid))row.add("lastDeath",death.deepCopy());
            meta.add(key,row);dirty=true;
        }
        JsonObject row=meta.getAsJsonObject(key);
        if(time(row,"schema")!=2||!owner.toString().equals(text(row,"ownerId")))throw new IllegalStateException("Unverified maid lifecycle owner/schema");
        return row;
    }
    private void history(UUID owner,UUID maid,JsonObject row,JsonObject grave){
        if(!belongs(grave,owner,maid)||deathTime(grave)<=0)return;
        JsonObject old=row.has("lastDeath")?row.getAsJsonObject("lastDeath"):null;
        if(old==null||deathTime(grave)>deathTime(old)){
            row.add("lastDeath",grave.deepCopy());root.add(maid.toString(),grave.deepCopy());dirty=true;
        }
    }
    private boolean resolved(JsonObject row,JsonObject grave){
        return text(row,"resolvedDeathEventId").equals(text(grave,"eventId"))
            ||(time(row,"lastAliveMillis")>0&&deathTime(grave)<=time(row,"lastAliveMillis"));
    }
    public void alive(UUID owner,UUID maid,long now,JsonObject facts,JsonObject grave){
        JsonObject row=row(owner,maid);history(owner,maid,row,grave);
        JsonObject previous=row.has("currentDeath")?row.getAsJsonObject("currentDeath"):
            row.has("lastDeath")?row.getAsJsonObject("lastDeath"):null;
        boolean recovered=previous!=null&&!text(previous,"eventId").equals(text(row,"resolvedDeathEventId"));
        if(recovered){
            JsonObject recovery=new JsonObject();recovery.addProperty("eventId",event("recovery",maid,text(previous,"eventId")));
            recovery.addProperty("maidId",maid.toString());recovery.addProperty("ownerId",owner.toString());
            recovery.addProperty("name",text(facts,"name"));recovery.addProperty("observedAt",Instant.ofEpochMilli(now).toString());
            recovery.addProperty("resolvedDeathEventId",text(previous,"eventId"));
            recovery.addProperty("evidence","original_tlm_alive_entity");recovery.addProperty("actualRevivalTimeKnown",false);
            recovery.addProperty("meaning","再次观察到原UUID存活；这是观察时间，不是实际复活时间。");
            row.add("recovery",recovery);row.addProperty("resolvedDeathEventId",text(previous,"eventId"));
            pendingEvents.add(text(recovery,"eventId"));dirty=true;
        }
        if(row.has("currentDeath")){row.remove("currentDeath");dirty=true;}
        if(recovered||time(row,"lastAliveMillis")==0||now-time(row,"lastAliveMillis")>=30000){
            row.addProperty("lastAliveMillis",Math.max(now,time(row,"lastAliveMillis")));
            JsonObject last=facts.deepCopy();last.addProperty("observedAt",Instant.ofEpochMilli(now).toString());
            row.add("lastSeenAlive",last);dirty=true;
        }
    }
    public void died(UUID owner,UUID maid,long now,JsonObject facts,JsonObject grave){
        JsonObject row=row(owner,maid);
        if(row.has("currentDeath"))return; // repeated native callbacks are one episode
        JsonObject death=belongs(grave,owner,maid)&&!resolved(row,grave)&&Math.abs(deathTime(grave)-now)<=5000?grave.deepCopy():facts.deepCopy();
        death.addProperty("maidId",maid.toString());death.addProperty("ownerId",owner.toString());
        if(!death.has("diedAt"))death.addProperty("diedAt",Instant.ofEpochMilli(now).toString());
        if(!death.has("evidence"))death.addProperty("evidence","original_tlm_death_event");
        long episode=time(row,"episode")+1;row.addProperty("episode",episode);
        death.addProperty("eventId",event("death",maid,death.has("tombstoneId")?text(death,"tombstoneId")+"/"+text(death,"diedAt"):"native/"+now+"/"+episode));
        row.add("currentDeath",death);row.add("lastDeath",death.deepCopy());root.add(maid.toString(),death.deepCopy());
        pendingEvents.add(text(death,"eventId"));dirty=true;
    }
    public JsonObject view(UUID owner,UUID maid,long now,JsonObject live,JsonObject grave){
        JsonObject row=row(owner,maid);
        if(live!=null)alive(owner,maid,now,live,grave);
        else if(belongs(grave,owner,maid)&&deathTime(grave)>0&&deathTime(grave)<=now+5000){
            history(owner,maid,row,grave);
            JsonObject active=row.has("currentDeath")?row.getAsJsonObject("currentDeath"):null;
            boolean matchingActive=active!=null&&(text(active,"tombstoneId").isEmpty()?Math.abs(deathTime(active)-deathTime(grave))<=5000:text(active,"tombstoneId").equals(text(grave,"tombstoneId")));
            if(matchingActive&&!resolved(row,grave)){
                // A later-arriving native tombstone enriches the same death event.
                JsonObject enriched=grave.deepCopy();enriched.addProperty("eventId",text(active,"eventId"));
                if(!enriched.equals(active)){row.add("currentDeath",enriched);row.add("lastDeath",enriched.deepCopy());root.add(maid.toString(),enriched.deepCopy());dirty=true;}
            }else if(!resolved(row,grave)&&((active==null&&time(row,"lastAliveMillis")>0)||(active!=null&&!text(active,"tombstoneId").isEmpty()&&deathTime(grave)>deathTime(active)))){
                JsonObject death=grave.deepCopy();death.addProperty("eventId",event("death",maid,text(grave,"tombstoneId")+"/"+text(grave,"diedAt")));
                row.add("currentDeath",death);row.add("lastDeath",death.deepCopy());root.add(maid.toString(),death.deepCopy());
                pendingEvents.add(text(death,"eventId"));dirty=true;
            }
        }
        JsonObject result=new JsonObject();result.addProperty("lifeState",live!=null?"alive":row.has("currentDeath")?"dead":"unloaded_or_unavailable");
        if(row.has("lastSeenAlive"))result.add("lastSeenAlive",row.get("lastSeenAlive").deepCopy());
        if(live==null&&row.has("currentDeath"))result.add("death",row.get("currentDeath").deepCopy());
        else {
            if(row.has("lastDeath"))result.add("historicalDeath",row.get("lastDeath").deepCopy());
            if(row.has("recovery"))result.add("recovery",row.get("recovery").deepCopy());
        }
        return result;
    }
}
