package org.afuhome.agentfriend;
import java.util.*;
import com.google.gson.*;

public final class DungeonAdviceTest {
    static int checks;
    static void check(boolean ok,String name){if(!ok)throw new AssertionError(name);checks++;}
    static Map<String,Object> facts(Object... pairs){Map<String,Object> out=new HashMap<>();out.put("configured",true);out.put("firstRoom","world 1,2,3");for(int n=0;n<pairs.length;n+=2)out.put(pairs[n].toString(),pairs[n+1]);return out;}
    static Map<String,Object> advice(Object... pairs){return DungeonAdvice.evaluate("undead_crypt","亡灵墓穴",facts(pairs));}
    static void state(String expected,Object... pairs){var out=advice(pairs);check(expected.equals(out.get("state")),expected);check(!(boolean)out.get("waitAtEntrance"),"no endless entrance waiting");}
    static void invalid(String... args){try{DungeonAdvice.parse(args);throw new AssertionError("accepted invalid args "+Arrays.toString(args));}catch(IllegalArgumentException expected){checks++;}}
    public static void main(String[] args){
        state("travel");state("ready","atFirstRoom",true);state("approach","atSite",true);
        check(advice("atFirstRoom",true).get("nextCommand").equals("/mycli dungeon start undead_crypt normal"),"idle false never interpreted as closed");
        state("unavailable","configured",false);state("cooldown","cooldownMs",12001L);
        check(advice("cooldownMs",12001L).get("retryAfterMs").equals(12001L),"actual cooldown not an invented fixed wait");
        state("occupied","occupied",true);state("joinable","occupied",true,"joinable",true,"atFirstRoom",true);
        state("blocked","otherActivity",true);
        state("requirements","admissionReason","COMBAT_LEVEL_REQUIRED","admissionHint","练级","admissionCommand","/mycli rpg status");
        state("fault_paused","participant",true,"phase","fighting","faulted",true);
        check(!advice("participant",true,"faulted",true).get("nextCommand").toString().contains("start"),"fault never recommends new start");
        state("paused","participant",true,"paused",true);state("muster","participant",true,"phase","muster");
        state("moving","participant",true,"phase","moving","target","world 4,5,6");
        state("fighting","participant",true,"phase","fighting","remainingMobs",3,"target","world 4,5,6");
        state("returning","participant",true,"phase","returning");state("claimable","pendingReward",true);
        check(advice("pendingReward",true).get("nextCommand").equals("/mycli dungeon claim undead_crypt"),"saved reward never requires rerun");
        JsonObject frozen=new JsonObject();frozen.addProperty("ready",false);frozen.addProperty("current",0);frozen.addProperty("target",1);frozen.addProperty("phase","perform_action");
        String before=frozen.toString();JsonObject attached=DungeonAdvice.attach(frozen,advice());
        check(frozen.toString().equals(before),"guidance does not rewrite frozen progress");check(attached.get("current").getAsInt()==0,"no invented clear credit");
        check(attached.get("phase").getAsString().equals("travel"),"task gets actual next step");
        frozen.addProperty("ready",true);check(DungeonAdvice.attach(frozen,advice())==frozen,"finished objective remains submit-ready");
        var request=DungeonAdvice.parse(new String[]{"dungeon","start","undead_crypt","normal","--json"});
        check(request.json()&&request.args().length==4&&request.args()[1].equals("start"),"json is formatting, not a separate query-only action");
        check(DungeonAdvice.parse(new String[]{"dungeon"}).args()[1].equals("list"),"bare dungeon discovers existing group");
        check(DungeonAdvice.parse(new String[]{"dungeon","list","--page","2"}).page()==2,"bounded pagination");
        check(DungeonAdvice.parse(new String[]{"dungeon","info","undead_crypt","--verbose"}).verbose(),"detail opt in");
        invalid("dungeon","start");invalid("dungeon","start","undead_crypt","secret");invalid("dungeon","start","undead_crypt","normal","extra");
        invalid("dungeon","travel","../world");invalid("dungeon","info","undead_crypt","--page","2");invalid("dungeon","list","--page","0");
        invalid("dungeon","list","--json","--json");invalid("dungeon","list","--unknown");invalid("dungeon","list","--page");
        invalid("dungeon","menu","--json");
        for(String id:List.of("undead_crypt","creeping_crypt","bunker","illager_camp","aincrad_01")){
            var p=DungeonAdvice.preparation(id,1);check(p.stars()>=1&&p.stars()<=5&&p.recommendedLevel()>=1,"all live sites get preparation");
            check(p.party().contains("可单人"),"party advice does not invent a minimum team size");
        }
        for(String role:List.of("warrior","mage","priest","tank"))check(DungeonAdvice.skill(role).length()<80,"bounded current profession advice");
        System.out.println("Dungeon advice: "+checks+" checks passed");
    }
}
