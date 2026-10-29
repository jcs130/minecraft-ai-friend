package org.afuhome.agentfriend;

import java.util.*;

public final class RpgStoryRulesTest {
    private static int checks;
    private static void check(boolean ok,String label){checks++;if(!ok)throw new AssertionError(label);}
    private static void rejected(Runnable task){try{task.run();throw new AssertionError("expected invalid content");}catch(IllegalArgumentException expected){checks++;}}
    private static RpgStoryRules.Stage stage(String id,RpgStoryRules.Kind kind,String ref){return new RpgStoryRules.Stage(id,id,kind,ref,"需要真实操作","/mycli world story status");}
    private static RpgStoryRules.Facts facts(boolean trained,String route,Set<String> talks,Set<String> contracts){return new RpgStoryRules.Facts(trained,trained,trained,trained,trained,route,talks,contracts);}
    public static void main(String[] args){
        var arrival=stage("arrival",RpgStoryRules.Kind.TALK_OR_GRADUATE,"yingdeng");
        var register=stage("register",RpgStoryRules.Kind.MEMBER,"");
        var route=stage("route",RpgStoryRules.Kind.ROUTE,"");
        var finish=stage("report",RpgStoryRules.Kind.TALK,"muchen");
        var chapter=new RpgStoryRules.Chapter("first_light","借一盏灯","每个人都能走自己的路。",List.of(),List.of(arrival,register,route,finish));
        var empty=facts(false,"",Set.of(),Set.of());var p=RpgStoryRules.evaluate(chapter,empty);
        check(p.completed()==0&&p.currentId().equals("arrival"),"browsing does not count as talking");
        var talked=facts(false,"",Set.of("arrival@yingdeng"),Set.of());check(RpgStoryRules.evaluate(chapter,talked).completed()==1,"nearby explicit conversation qualifies only its stage");
        var veteran=facts(true,"",Set.of(),Set.of());check(RpgStoryRules.evaluate(chapter,veteran).completed()==2,"existing qualified onboarding is recognized without reset");
        check(!RpgStoryRules.matches(arrival,new RpgStoryRules.Facts(true,true,true,true,false,"",Set.of(),Set.of())),"partial old training does not fake graduation");
        var chose=facts(true,"combat",Set.of(),Set.of());check(RpgStoryRules.evaluate(chapter,chose).currentId().equals("report"),"route selection does not fake an NPC report");
        var done=facts(true,"combat",Set.of("report@muchen"),Set.of());check(RpgStoryRules.evaluate(chapter,done).ready(),"all authoritative conditions can finish chapter");
        check(!RpgStoryRules.matches(finish,facts(true,"combat",Set.of("arrival@muchen"),Set.of())),"a visit at an earlier stage does not pre-complete the return report");
        check(!RpgStoryRules.matches(route,facts(true,"administrator",Set.of(),Set.of())),"unknown route is not a profession or permission grant");
        for(var kind:List.of(RpgStoryRules.Kind.ENROLLED,RpgStoryRules.Kind.CATALOG,RpgStoryRules.Kind.CAST,RpgStoryRules.Kind.COMMISSION)){
            var s=stage("native_proof",kind,"");check(!RpgStoryRules.matches(s,empty),kind+" needs a server proof");check(RpgStoryRules.matches(s,veteran),kind+" retains existing valid proof");
        }
        var contract=stage("camp_report",RpgStoryRules.Kind.CONTRACT,"tm_field_camp");
        check(!RpgStoryRules.matches(contract,done),"chat or combat elsewhere is not a completed commission");
        check(RpgStoryRules.matches(contract,facts(true,"combat",Set.of(),Set.of("tm_field_camp"))),"existing settled contract qualifies its story link");
        var mutable=new HashSet<String>();mutable.add("arrival@yingdeng");var frozen=facts(false,"",mutable,Set.of());mutable.clear();check(frozen.conversations().contains("arrival@yingdeng"),"fact snapshots do not borrow mutable player sets");
        check(chapter.stages().size()==4&&RpgStoryRules.evaluate(chapter,empty).completed()==0,"evaluation is read only and repeatable");
        rejected(()->stage("bad:id",RpgStoryRules.Kind.TALK,"yingdeng"));
        rejected(()->new RpgStoryRules.Chapter("bad","标题","简介",List.of(),List.of(arrival,arrival)));
        rejected(()->new RpgStoryRules.Chapter("bad","标题","简介",List.of(),List.of()));
        rejected(()->new RpgStoryRules.Stage("bad","标题",RpgStoryRules.Kind.TALK,"yingdeng","简介","/op somePlayer"));
        rejected(()->RpgStoryRules.text("line\ncommand",40));
        check(chapter.requires().isEmpty(),"no hidden mandatory farming prerequisite");
        var ready=stage("prepare_combat",RpgStoryRules.Kind.COMBAT_READY,"");
        var roleOnly=new RpgStoryRules.Facts(false,false,false,false,false,"",Set.of(),Set.of(),true,1,Set.of(),false);
        var learnedPrepared=new RpgStoryRules.Facts(false,false,false,false,false,"",Set.of(),Set.of(),true,1,Set.of(),true);
        check(!RpgStoryRules.matches(ready,roleOnly),"choosing a role does not learn or prepare combat skills");
        check(RpgStoryRules.matches(ready,learnedPrepared),"server verified prepared combat skill satisfies training");
        check(!RpgStoryRules.matches(ready,new RpgStoryRules.Facts(false,false,false,false,false,"",Set.of(),Set.of(),false,1,Set.of(),true)),"preparation without active profession cannot pass");
        var conquest=stage("clear_floor",RpgStoryRules.Kind.CONQUEST_CLEAR,"1");
        check(!RpgStoryRules.matches(conquest,learnedPrepared),"preparation and browsing are not floor completion");
        System.out.println("RpgStoryRulesTest: "+checks+" checks passed");
    }
}
