package org.afuhome.agentfriend;
import java.util.*;
public final class TrialGuideTest {
    static int checks;
    static void check(boolean value,String name){if(!value)throw new AssertionError(name);checks++;}
    static TrialGuide.Facts facts(String state){return new TrialGuide.Facts(!state.equals("unbuilt"),state.startsWith("participant"),state.startsWith("participant")||state.equals("busy"),state.equals("participant_paused"),!state.equals("participant_preparing"),state.equals("participant_cleared"),2,state.equals("participant_outside")?0:2,3,15,state.equals("observer"),!state.equals("dead"),state.equals("downed"),state.equals("site"),!state.startsWith("far"),state.equals("far_unknown")?-1:state.equals("far_low")?0:30,state.equals("cooldown")?3000:0,state.equals("missing")?List.of("头盔"):List.of());}
    public static void main(String[] args){
        Map<String,String> cases=Map.ofEntries(Map.entry("unbuilt","trial_unavailable"),Map.entry("observer","observer"),Map.entry("downed","downed"),Map.entry("participant_paused","waiting_reconnect"),Map.entry("participant_outside","participant_outside_floor"),Map.entry("participant_cleared","wait_next_floor"),Map.entry("participant_preparing","wait_spawn"),Map.entry("participant_fighting","fight_remaining"),Map.entry("site","other_activity"),Map.entry("busy","trial_busy"),Map.entry("cooldown","trial_cooldown"),Map.entry("missing","equipment_missing"),Map.entry("far_unknown","mana_unknown"),Map.entry("far_low","travel_mana_required"),Map.entry("far_ready","reach_trial_entrance"),Map.entry("ready","ready_to_start"));
        for(var row:cases.entrySet()){var result=TrialGuide.next(facts(row.getKey()));check(result.get("reason").equals(row.getValue()),row.getKey());check(Boolean.TRUE.equals(result.get("queryOnly")),"read only "+row.getKey());}
        var ready=TrialGuide.next(facts("ready"));check(ready.get("entryMana").equals(0),"actual normal entry is free");check(ready.get("travelMana").equals(6)&&ready.get("checkpointMana").equals(8),"travel costs distinct");
        check(ready.get("nextCommand").equals("/mycli arena start")&&Boolean.TRUE.equals(ready.get("canStart")),"one exact action");
        check(TrialGuide.next(facts("far_ready")).get("nextCommand").equals(TrialGuide.TRAVEL),"no crypt routing");
        check(TrialGuide.next(facts("participant_fighting")).get("requiresWorldAction").equals(true),"query is not fighting");
        check(TrialGuide.next(facts("busy")).get("nextCommand").equals("/mycli dungeon list"),"busy chooses alternative");
        check(TrialGuide.next(facts("dead")).get("reason").equals("actor_unavailable"),"dead cannot be ready");
        check(TrialGuide.route().contains("从第1层")&&!TrialGuide.route().contains("各有8"),"accurate tower route");
        for(var goal:GuildManager.Goal.values())check(TrialGuide.goal(goal)==Set.of("FLOOR","PARTY_FLOOR","FAST_FLOOR","NO_DEATH","LIGHT_FLOOR","STONE_FLOOR","WITCH_KILLS","CLAIMS").contains(goal.name()),"goal "+goal);
        System.out.println("TrialGuideTest: "+checks+" passed");
    }
}
