package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Server observations only. Chat, command text and client claims are never evidence. */
final class ChallengeRun {
    static final Gson JSON = new Gson();
    static final int SCHEMA = 1;
    record Definition(String id, String title, String description, String type, int seconds, int count,
                      List<String> roles, List<String> steps) {
        Definition {
            if (id == null || !id.matches("[a-z0-9_]{2,40}") || title == null || title.isBlank() || title.length()>40
                    || description == null || description.isBlank() || description.length()>300
                    || !Set.of("backpack", "supply", "rescue").contains(type) || seconds<30 || seconds>7200
                    || count<1 || count>16 || !type.equals("backpack")&&count!=1) throw new IllegalArgumentException("challenge definition");
            roles=List.copyOf(roles); steps=List.copyOf(steps);
            if (!roles.equals(roles(type)) || !steps.equals(steps(type))) throw new IllegalArgumentException("challenge roles/steps");
        }
        String version() { return sha(JSON.toJson(this)); }
        static List<String> roles(String type) { return switch(type) {
            case "backpack" -> List.of("learner"); case "supply" -> List.of("gatherer","maker","receiver");
            case "rescue" -> List.of("rescuer","partner"); default -> throw new IllegalArgumentException("type"); }; }
        static List<String> steps(String type) { return switch(type) {
            case "backpack" -> List.of("bag_open","bag_deposit","bag_reopen","bag_return");
            case "supply" -> List.of("wood_gathered","wood_handoff","planks_crafted","planks_handoff","chest_delivered");
            case "rescue" -> List.of("teammate_revived","room_cleared"); default -> throw new IllegalArgumentException("type"); }; }
    }
    final UUID id, owner;
    final Definition definition;
    final LinkedHashMap<String,UUID> members = new LinkedHashMap<>();
    final JsonArray events = new JsonArray();
    JsonObject initial = new JsonObject();
    final long created;
    long started, deadline, ended;
    int completed, revision;
    String state="forming", reason="waiting_party", activity="";
    ChallengeRun(UUID owner, Definition definition, long now) {
        this(UUID.randomUUID(),owner,definition,now);
        members.put(definition.roles().getFirst(),owner);
        event("created",owner,new JsonObject(),now);
    }
    private ChallengeRun(UUID id, UUID owner, Definition definition, long created) {
        this.id=id;this.owner=owner;this.definition=definition;this.created=created;
    }
    boolean active() { return state.equals("forming") || state.equals("running"); }
    boolean contains(UUID player) {return members.containsValue(player);}
    String role(UUID player) { return members.entrySet().stream().filter(e->e.getValue().equals(player)).map(Map.Entry::getKey).findFirst().orElse(""); }
    boolean join(UUID player, String role, long now) {
        if(!state.equals("forming") || contains(player) || !definition.roles().contains(role) || members.containsKey(role))return false;
        members.put(role,player);JsonObject detail=new JsonObject();detail.addProperty("role",role);event("joined",player,detail,now);return true;
    }
    boolean begin(UUID player, JsonObject snapshot, long now) {
        if(!state.equals("forming") || !owner.equals(player) || members.size()!=definition.roles().size())return false;
        initial=snapshot.deepCopy();started=now;deadline=now+definition.seconds()*1000L;state="running";reason="in_progress";
        event("started",player,new JsonObject(),now);return true;
    }
    String nextStep() { return completed<definition.steps().size()?definition.steps().get(completed):"done"; }
    boolean observe(UUID actor, String kind, JsonObject detail, long now) {
        if(!state.equals("running") || !contains(actor) || now<started)return false;
        if(now>deadline){end("expired","time_limit",now);return false;}
        if(!nextStep().equals(kind))return false; // Duplicate, old and out-of-order observations never advance.
        String required=switch(kind) {
            case "wood_gathered" -> "gatherer";
            case "wood_handoff","planks_crafted" -> "maker";
            case "planks_handoff","chest_delivered" -> "receiver";
            case "teammate_revived","room_cleared" -> "rescuer";
            default -> "learner";
        };
        if(!required.equals(role(actor)))return false;
        if(definition.type().equals("rescue")) {
            String context=detail.has("activity")?detail.get("activity").getAsString():"";
            if(context.isEmpty() || context.length()>160)return false;
            if(kind.equals("teammate_revived")) {
                if(!detail.has("target") || !members.get("partner").toString().equals(detail.get("target").getAsString()))return false;
                activity=context;
            } else if(!activity.equals(context) || !detail.has("bothPresent") || !detail.get("bothPresent").getAsBoolean())return false;
        }
        completed++;event(kind,actor,detail,now);
        if(completed==definition.steps().size())end("completed","all_conditions_verified",now);
        return true;
    }
    void expire(long now) {
        if(state.equals("running") && now>deadline)end("expired","time_limit",now);
        else if(state.equals("forming") && now-created>300_000)end("expired","party_wait_limit",now);
    }
    void end(String next,String why,long now) {
        end(next,why,now,null);
    }
    void end(String next,String why,long now,UUID actor) {
        if(!active())return;
        if(actor!=null&&!contains(actor))throw new IllegalArgumentException("terminal actor");
        if(!Set.of("completed","cancelled","interrupted","expired").contains(next))throw new IllegalArgumentException("terminal state");
        if(next.equals("completed") && completed!=definition.steps().size())throw new IllegalArgumentException("missing evidence");
        state=next;reason=why;ended=now;JsonObject detail=new JsonObject();detail.addProperty("state",next);detail.addProperty("reason",why);
        event("ended",actor,detail,now);
    }
    private void event(String kind,UUID actor,JsonObject detail,long now) {
        if(events.size()>=32)throw new IllegalStateException("evidence limit");
        JsonObject row=new JsonObject();row.addProperty("eventId",id+":"+(++revision));row.addProperty("sequence",revision);
        row.addProperty("observedAt",now);row.addProperty("type",kind);row.addProperty("actorUuid",actor==null?null:actor.toString());
        row.addProperty("source","server");row.add("detail",detail.deepCopy());events.add(row);
    }
    JsonObject encode() {
        JsonObject o=new JsonObject();o.addProperty("schemaVersion",SCHEMA);o.addProperty("runId",id.toString());o.addProperty("owner",owner.toString());
        o.add("definition",JSON.toJsonTree(definition));o.addProperty("ruleVersion",definition.version());o.add("members",JSON.toJsonTree(members));
        o.addProperty("createdAt",created);o.addProperty("startedAt",started);o.addProperty("deadline",deadline);o.addProperty("endedAt",ended);
        o.addProperty("state",state);o.addProperty("reason",reason);o.addProperty("completedSteps",completed);o.addProperty("revision",revision);
        o.addProperty("activity",activity);o.addProperty("track","live_world");o.addProperty("autonomy","unverified");o.addProperty("scorerVersion",1);
        o.add("initial",initial.deepCopy());o.add("events",events.deepCopy());return o;
    }
    static ChallengeRun decode(JsonObject o) {
        if(o.get("schemaVersion").getAsInt()!=SCHEMA)throw new IllegalArgumentException("challenge schema");
        Definition d=JSON.fromJson(o.get("definition"),Definition.class);
        if(!d.version().equals(o.get("ruleVersion").getAsString()))throw new IllegalArgumentException("rule hash");
        ChallengeRun r=new ChallengeRun(UUID.fromString(o.get("runId").getAsString()),UUID.fromString(o.get("owner").getAsString()),d,o.get("createdAt").getAsLong());
        o.getAsJsonObject("members").entrySet().forEach(e->r.members.put(e.getKey(),UUID.fromString(e.getValue().getAsString())));
        if(!d.roles().containsAll(r.members.keySet()) || !r.owner.equals(r.members.get(d.roles().getFirst()))
                || new HashSet<>(r.members.values()).size()!=r.members.size())throw new IllegalArgumentException("members");
        r.started=o.get("startedAt").getAsLong();r.deadline=o.get("deadline").getAsLong();r.ended=o.get("endedAt").getAsLong();
        r.state=o.get("state").getAsString();r.reason=o.get("reason").getAsString();r.completed=o.get("completedSteps").getAsInt();
        r.revision=o.get("revision").getAsInt();r.activity=o.get("activity").getAsString();r.initial=o.getAsJsonObject("initial").deepCopy();
        r.events.addAll(o.getAsJsonArray("events"));
        if(!Set.of("forming","running","completed","cancelled","expired","interrupted").contains(r.state)
                ||r.completed<0||r.completed>d.steps().size()||r.events.size()>32||r.events.size()!=r.revision
                ||r.state.equals("completed")&&r.completed!=d.steps().size())throw new IllegalArgumentException("challenge state");
        int proof=0,seq=0;
        for(JsonElement item:r.events){JsonObject e=item.getAsJsonObject();
            if(e.get("sequence").getAsInt()!=++seq || !e.get("eventId").getAsString().equals(r.id+":"+seq) || !e.get("source").getAsString().equals("server"))throw new IllegalArgumentException("evidence sequence");
            String kind=e.get("type").getAsString();
            if(d.steps().contains(kind)){if(proof>=d.steps().size()||!d.steps().get(proof++).equals(kind)
                    ||e.get("observedAt").getAsLong()<r.started||e.get("observedAt").getAsLong()>r.deadline)throw new IllegalArgumentException("evidence order/time");}
        }
        if(proof!=r.completed)throw new IllegalArgumentException("evidence incomplete");
        return r;
    }
    static String sha(String text) {
        try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));}
        catch(java.security.NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}
    }
}
