package org.afuhome.agentfriend;
import java.util.*;

public final class ConquestStoryRulesTest {
    static int checks;
    static void check(boolean v,String message){checks++;if(!v)throw new AssertionError(message);}
    static RpgStoryRules.Facts facts(boolean role,int level,Set<Integer> floors){return new RpgStoryRules.Facts(true,true,true,true,true,"combat",Set.of("briefing@gufeng"),Set.of("tm_starter_blade"),role,level,floors);}
    public static void main(String[] args){
        var role=new RpgStoryRules.Stage("choose_role","职业",RpgStoryRules.Kind.COMBAT_ROLE,"","选职业","/mycli profession menu");
        var level=new RpgStoryRules.Stage("combat_level","战斗",RpgStoryRules.Kind.COMBAT_LEVEL,"3","练级","/mycli tasks list combat");
        var clear=new RpgStoryRules.Stage("formal_clear","攻略",RpgStoryRules.Kind.CONQUEST_CLEAR,"1","真实通关","/mycli dungeon info aincrad_01");
        check(!RpgStoryRules.matches(role,facts(false,100,Set.of(1))),"level cannot substitute for profession");
        check(RpgStoryRules.matches(role,facts(true,1,Set.of())),"existing profession qualifies");
        check(!RpgStoryRules.matches(level,facts(true,2,Set.of())),"level shortfall");
        check(RpgStoryRules.matches(level,facts(true,3,Set.of())),"exact threshold");
        check(!RpgStoryRules.matches(clear,facts(true,100,Set.of())),"graduation/cast/farm/commission not floor proof");
        check(!RpgStoryRules.matches(clear,facts(true,100,Set.of(2))),"wrong floor cannot qualify");
        check(RpgStoryRules.matches(clear,facts(true,1,Set.of(1))),"durable formal proof qualifies");
        var chapter=new RpgStoryRules.Chapter("aincrad_qa","攻略","测试",List.of(),List.of(role,clear));
        check(RpgStoryRules.evaluate(chapter,facts(false,1,Set.of())).currentId().equals("choose_role"),"one explicit next stage");
        check(RpgStoryRules.evaluate(chapter,facts(true,1,Set.of())).currentId().equals("formal_clear"),"no farming detour");
        check(RpgStoryRules.evaluate(chapter,facts(true,1,Set.of(1))).ready(),"full clear");
        check(!RpgStoryRules.matches(clear,new RpgStoryRules.Facts(true,true,true,true,true,"combat",Set.of(),Set.of())),"legacy progress never fabricated as formal clear");
        for(String invalid:List.of("0","101","-1","01","not_a_floor")){
            try{new RpgStoryRules.Stage("bad_floor","攻略",RpgStoryRules.Kind.CONQUEST_CLEAR,invalid,"测试","/mycli status");throw new AssertionError(invalid);}catch(IllegalArgumentException expected){checks++;}
        }
        System.out.println("Conquest story checks: "+checks);
    }
}
