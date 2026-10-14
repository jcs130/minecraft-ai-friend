package org.afuhome.agentfriend;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;

public final class LifeChallengesTest {
    private static int checks;
    private static final UUID A=UUID.randomUUID(),B=UUID.randomUUID(),C=UUID.randomUUID(),OTHER=UUID.randomUUID();
    private static void check(String text,boolean result){if(!result)throw new AssertionError(text);checks++;}
    private static void invalid(String text,Runnable action){try{action.run();throw new AssertionError(text);}catch(IllegalArgumentException expected){checks++;}}
    private static ChallengeRun.Definition definition(String type){return new ChallengeRun.Definition(type+"_test","实测","真实操作",type,60,type.equals("backpack")?8:1,ChallengeRun.Definition.roles(type),ChallengeRun.Definition.steps(type));}
    private static JsonObject detail(String... values){JsonObject o=new JsonObject();for(int i=0;i<values.length;i+=2)o.addProperty(values[i],values[i+1]);return o;}
    private static ChallengeRun started(String type){ChallengeRun r=new ChallengeRun(A,definition(type),1_000);if(type.equals("supply")){r.join(B,"maker",1_010);r.join(C,"receiver",1_020);}if(type.equals("rescue"))r.join(B,"partner",1_020);r.begin(A,new JsonObject(),2_000);return r;}
    private static ChallengeInventory.Snapshot inv(int personal,int bag,boolean cursor){return new ChallengeInventory.Snapshot(personal==0?Map.of():Map.of("stone",personal),bag==0?Map.of():Map.of("stone",bag),cursor);}
    public static void main(String[] args) throws Exception {
        ChallengeRun r=new ChallengeRun(A,definition("supply"),1_000);
        check("creating does not start",r.started==0&&r.state.equals("forming"));
        check("unfilled team cannot begin",!r.begin(A,new JsonObject(),2_000));
        check("one identity cannot hold two roles",!r.join(A,"maker",1_001));
        check("unknown role denied",!r.join(B,"admin",1_001));
        check("member opts into role",r.join(B,"maker",1_001));
        check("occupied role denied",!r.join(C,"maker",1_001));
        check("third member joins",r.join(C,"receiver",1_001));
        check("only owner starts",!r.begin(B,new JsonObject(),2_000));
        JsonObject initial=detail("version","original");check("owner starts",r.begin(A,initial,2_000));initial.addProperty("version","changed");
        check("initial snapshot frozen",r.initial.get("version").getAsString().equals("original"));
        check("repeated begin cannot reset deadline",!r.begin(A,new JsonObject(),5_000)&&r.deadline==62_000);
        check("late join denied",!r.join(OTHER,"receiver",3_000));
        check("out-of-order event denied",!r.observe(C,"chest_delivered",new JsonObject(),3_000));
        check("wrong role denied",!r.observe(B,"wood_gathered",new JsonObject(),3_000));
        check("nonparticipant cannot submit",!r.observe(OTHER,"wood_gathered",new JsonObject(),3_000));
        check("pre-start observation denied",!r.observe(A,"wood_gathered",new JsonObject(),1_999));
        check("gather event accepted",r.observe(A,"wood_gathered",detail("amount","1"),3_000));
        int revision=r.revision;check("duplicate does not produce evidence",!r.observe(A,"wood_gathered",new JsonObject(),3_001)&&r.revision==revision);
        check("observed handoff accepted",r.observe(B,"wood_handoff",new JsonObject(),3_100));
        check("observed craft accepted",r.observe(B,"planks_crafted",new JsonObject(),3_200));
        check("observed output handoff accepted",r.observe(C,"planks_handoff",new JsonObject(),3_300));
        check("claim requires physical delivery",r.state.equals("running"));
        check("delivery completes",r.observe(C,"chest_delivered",new JsonObject(),3_400)&&r.state.equals("completed"));
        r.end("interrupted","server_stopped",3_500);check("terminal result cannot be rewritten",r.state.equals("completed"));
        check("roundtrip record validates",ChallengeRun.decode(r.encode()).encode().equals(r.encode()));
        JsonObject corrupt=r.encode();corrupt.addProperty("completedSteps",4);invalid("completion cannot outpace proofs",()->ChallengeRun.decode(corrupt));
        JsonObject reordered=r.encode();reordered.getAsJsonArray("events").get(4).getAsJsonObject().addProperty("sequence",99);invalid("broken evidence sequence rejected",()->ChallengeRun.decode(reordered));
        JsonObject changedRule=r.encode();changedRule.getAsJsonObject("definition").addProperty("seconds",100);invalid("frozen rule hash verified",()->ChallengeRun.decode(changedRule));
        ChallengeRun timed=started("backpack");check("deadline inclusive",timed.observe(A,"bag_open",new JsonObject(),timed.deadline));
        check("late event cannot pass",!timed.observe(A,"bag_deposit",new JsonObject(),timed.deadline+1)&&timed.state.equals("expired")&&timed.completed==1);
        ChallengeRun waiting=new ChallengeRun(A,definition("supply"),1_000);waiting.expire(301_001);check("formation expires",waiting.reason.equals("party_wait_limit"));
        check("system expiry is not attributed to owner",waiting.events.asList().getLast().getAsJsonObject().get("actorUuid").isJsonNull());
        ChallengeRun cancelled=started("supply");cancelled.end("cancelled","participant_cancelled",3_000,C);
        check("cancelling member is retained",cancelled.events.asList().getLast().getAsJsonObject().get("actorUuid").getAsString().equals(C.toString()));
        invalid("outsider cannot be terminal actor",()->started("supply").end("cancelled","fake",3_000,OTHER));
        ChallengeRun stopped=started("backpack");stopped.end("interrupted","participant_disconnected",3_000);check("disconnect cannot silently resume",!stopped.observe(A,"bag_open",new JsonObject(),4_000));
        invalid("no unverified success",()->started("backpack").end("completed","fake",3_000));
        ChallengeRun rescue=started("rescue");
        check("clear without rescue denied",!rescue.observe(A,"room_cleared",new JsonObject(),3_000));
        check("unrelated patient denied",!rescue.observe(A,"teammate_revived",detail("target",OTHER.toString(),"activity","tower:one:1"),3_000));
        check("real partner rescue accepted",rescue.observe(A,"teammate_revived",detail("target",B.toString(),"activity","tower:one:1"),3_000));
        JsonObject clear=detail("activity","site:one:1");clear.addProperty("bothPresent",true);
        check("different activity cannot clear",!rescue.observe(A,"room_cleared",clear,4_000));clear.addProperty("activity","tower:one:2");
        check("different floor cannot clear",!rescue.observe(A,"room_cleared",clear,4_000));clear.addProperty("activity","tower:one:1");clear.addProperty("bothPresent",false);
        check("absent teammate cannot clear",!rescue.observe(A,"room_cleared",clear,4_000));clear.addProperty("bothPresent",true);
        check("same team and room succeeds",rescue.observe(A,"room_cleared",clear,4_000)&&rescue.state.equals("completed"));

        ChallengeInventory cycle=new ChallengeInventory("stone",8);
        check("new inventory cycle opens",cycle.open(inv(32,6,true)).equals("bag_open"));
        check("duplicate open ignored",cycle.open(inv(32,6,true)).equals("duplicate"));
        check("net deposit confirmed",cycle.close(inv(24,14,true)).equals("bag_deposit"));
        check("duplicate close ignored",cycle.close(inv(24,14,true)).equals("duplicate"));
        check("new window ID irrelevant",cycle.open(inv(24,14,true)).equals("bag_reopen"));
        check("partial retrieval not completion",cycle.close(inv(28,10,true)).equals("no_change"));
        check("partial can reopen",cycle.open(inv(28,10,true)).equals("no_change"));
        check("restored all counts confirms",cycle.close(inv(32,6,true)).equals("bag_return"));
        ChallengeInventory wrong=new ChallengeInventory("stone",8);wrong.open(inv(32,6,true));
        check("external extra items fail conservation",wrong.close(inv(32,14,true)).equals("inventory_changed"));
        ChallengeInventory cursor=new ChallengeInventory("stone",8);cursor.open(inv(32,6,true));
        check("cursor cannot be ignored",cursor.close(inv(24,14,false)).equals("cursor_not_empty"));
        ChallengeInventory oldBag=new ChallengeInventory("stone",8);oldBag.open(inv(32,6,true));
        check("withdrawing old bag items not fresh proof",oldBag.close(inv(38,0,true)).equals("no_change"));
        ChallengeInventory sameWindow=new ChallengeInventory("stone",8);sameWindow.open(inv(32,6,true));
        check("deposit-withdraw in one open not a cycle",sameWindow.close(inv(32,6,true)).equals("no_change"));
        check("insufficient initial amount rejected",new ChallengeInventory("stone",8).open(inv(7,99,true)).equals("missing_material"));
        var meta=new ChallengeInventory.Snapshot(Map.of("stone",24,"sword_v2",1),Map.of("stone",14),true);
        var metaBefore=new ChallengeInventory.Snapshot(Map.of("stone",32,"sword_v1",1),Map.of("stone",6),true);
        check("metadata identity matters",!ChallengeInventory.deposit(metaBefore,meta,"stone",8));

        Path folder=Files.createTempDirectory("agentfriend-challenges-test-");
        try(ChallengeStore store=new ChallengeStore(folder)){
            check("empty journal loads",store.load().isEmpty());check("unsaved success isn't durable",!store.durable(r));
            store.save(r).get();check("saved success is durable",store.durable(r));
            check("disk restores exact evidence",store.load().getFirst().encode().equals(r.encode()));
            ChallengeRun pending=started("backpack");store.save(pending).get();pending.end("interrupted","server_stopped",3_000);store.save(pending).get();
            check("interruption persists",store.load().stream().anyMatch(x->x.id.equals(pending.id)&&x.reason.equals("server_stopped")));
        }
        Path blocked=Files.createTempFile("agentfriend-challenges-failure-",".file");
        try(ChallengeStore store=new ChallengeStore(blocked)){
            try{store.save(r).get();throw new AssertionError("disk failure");}catch(java.util.concurrent.ExecutionException expected){checks++;}
            check("disk failure cannot report durable success",!store.durable(r)&&!store.error.get().isEmpty());
        }
        System.out.println("LifeChallengesTest: "+checks+" passed; fixture directory="+folder);
    }
}
