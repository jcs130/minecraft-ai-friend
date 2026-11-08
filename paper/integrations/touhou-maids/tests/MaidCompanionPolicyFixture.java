package local.tlmcompat.hybrid;
import java.util.*;
public final class MaidCompanionPolicyFixture {
    static int count;
    static void check(boolean value,String name){if(!value)throw new AssertionError(name);count++;}
    public static void main(String[] args){
        var D=MaidCompanionPolicy.Action.DEFEND;var H=MaidCompanionPolicy.Action.HOLD;var R=MaidCompanionPolicy.Action.RESTORE;
        check(MaidCompanionPolicy.choose(true,false,true,false,true,true,0)==D,"armed threat");
        check(MaidCompanionPolicy.choose(true,false,true,false,true,false,0)==H,"no hostile no attack");
        check(MaidCompanionPolicy.choose(true,false,true,false,false,true,0)==H,"weapon required");
        check(MaidCompanionPolicy.choose(true,false,false,false,true,true,0)==H,"manual work preserved");
        check(MaidCompanionPolicy.choose(false,false,true,false,true,true,0)==H,"sitting/world/owner gate");
        check(MaidCompanionPolicy.choose(true,false,true,true,true,true,0)==H,"low health no attack");
        check(MaidCompanionPolicy.choose(true,true,false,true,true,true,0)==R,"low health exits");
        check(MaidCompanionPolicy.choose(true,true,false,false,false,true,0)==R,"lost weapon exits");
        check(MaidCompanionPolicy.choose(false,true,false,false,true,true,0)==R,"pause exits");
        check(MaidCompanionPolicy.choose(true,true,false,false,true,false,4_999_999_999L)==H,"hysteresis");
        check(MaidCompanionPolicy.choose(true,true,false,false,true,false,5_000_000_000L)==R,"quiet restore");
        check(MaidCompanionPolicy.choose(true,true,false,false,true,false,Long.MAX_VALUE)==R,"restart re-evaluates");
        var w=new MaidConversationWindow();UUID a=UUID.randomUUID(),m=UUID.randomUUID(),world=UUID.randomUUID();Object session=new Object();
        check(w.followup(a,m,world,session,"hello",0)==null,"no uninvited listener");w.replied(a,m,world,session,0);
        check("继续".equals(w.followup(a,m,world,session,"继续",1)),"natural follow-up");
        check(w.followup(UUID.randomUUID(),m,world,session,"hello",1)==null,"other speaker");
        check(w.followup(a,UUID.randomUUID(),world,session,"hello",1)==null,"other maid");
        for(String text:List.of("/msg x hi","!hello","@other hi","x\ny","§x","x".repeat(141)))check(w.followup(a,m,world,session,text,2)==null,"invalid/shout/command");
        check(w.followup(a,m,world,new Object(),"hello",3)==null,"reconnect invalidates");
        w.replied(a,m,world,session,0);check(w.followup(a,m,UUID.randomUUID(),session,"hello",1)==null,"world invalidates");
        w.replied(a,m,world,session,0);check(w.followup(a,m,world,session,"hello",45_000_000_001L)==null,"expires");
        w.replied(a,m,world,session,0);for(int i=0;i<3;i++)check(w.followup(a,m,world,session,"hello",1)!=null,"bounded pending turns");
        check(w.followup(a,m,world,session,"hello",1)==null,"turn cap");
        System.out.println("PASS "+count+" companion and conversation rules");
    }
}
