package local.tlmcompat.hybrid;
import java.util.*;
public final class MaidCompanionPolicyFixture {
    static int count;
    static void check(boolean value,String name){if(!value)throw new AssertionError(name);count++;}
    static boolean allow(MaidConversationWindow window,UUID actor,UUID maid,UUID world,Object session,String text,long now){
        return window.admit(actor,maid,world,session,text,true,now).allowed();
    }
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
        check(w.followup(a,m,world,session,"hello",0)==null,"no uninvited listener");
        w.replied(a,m,world,session,"继续看看吧",true,0);
        check("继续".equals(w.followup(a,m,world,session,"继续",1)),"natural follow-up");
        check(w.followup(UUID.randomUUID(),m,world,session,"hello",1)==null,"other speaker");
        check(w.followup(a,UUID.randomUUID(),world,session,"hello",1)==null,"other maid");
        for(String text:List.of("/msg x hi","!hello","@other hi","x\ny","§x","x".repeat(141)))check(w.followup(a,m,world,session,text,2)==null,"invalid/shout/command");
        check(w.followup(a,m,world,new Object(),"hello",3)==null,"reconnect invalidates");
        w.replied(a,m,world,session,"继续看看吧",true,0);check(w.followup(a,m,UUID.randomUUID(),session,"hello",1)==null,"world invalidates");
        w.replied(a,m,world,session,"继续看看吧",true,0);check(w.followup(a,m,world,session,"hello",119_000_000_000L)!=null,"slow natural followup stays available");
        check(w.followup(a,m,world,session,"hello",120_000_000_001L)==null,"expires");
        w.reset(a);
        check(allow(w,a,m,world,session,"你今天想去哪儿",0),"first named request allowed");
        for(int i=0;i<6;i++){
            check(w.started(a,m,world,session,i)==(i==5),"only sixth request marks the last turn");
            w.replied(a,m,world,session,"去看看山脚的路",false,i);
            check((w.followup(a,m,world,session,"那边怎么走",i)!=null)==(i<5),"a reply never renews the turn budget");
        }
        var rest=w.admit(a,m,world,session,"再说一遍",true,31_000_000_000L);
        check(!rest.allowed()&&rest.retryAfterSeconds()==90,"named partner receives the actual rounded time remaining");
        check(!w.mayInitiate(a,m,world,session,32_000_000_000L),"initiative respects conversation closure");
        rest=w.admit(a,m,world,session,"还有多久到神庙",true,61_000_000_000L);
        check(!rest.allowed()&&rest.retryAfterSeconds()==0,"later named messages do not repeat the reminder");
        check(!allow(w,a,m,world,session,"现在看得到入口吗",91_000_000_000L),"second suppressed message does not open a new turn");
        check(!allow(w,a,m,world,session,"谢谢，回头聊。",100_000_000_000L),"repeated closing does not extend the pause");
        check(allow(w,a,m,world,session,"我们谈谈新任务",121_000_000_000L),"suppressed messages cannot keep extending quiet time");
        w.started(a,m,world,session,152_000_000_000L);
        w.replied(a,m,world,session,"去看看山脚的路",false,153_000_000_000L);
        check(!allow(w,a,m,world,session,"去看看山脚的路。",154_000_000_000L),"echo is ignored");
        check(!allow(w,a,m,world,session,"谢谢，回头聊。",155_000_000_000L),"farewell needs no inference");
        check(w.followup(a,m,world,session,"那边怎么走",156_000_000_000L)==null,"farewell also closes implicit followups");
        w.reset(a);
        check(allow(w,a,m,world,session,"谢谢，跟我走吧",157_000_000_000L),"substantive request with thanks is accepted");
        w.started(a,m,world,session,157_000_000_000L);
        w.replied(a,m,world,session,"一起出发",false,200_000_000_000L);
        check(w.followup(a,m,world,session,"前面是什么",278_000_000_000L)==null,"reply cannot renew the absolute deadline");
        System.out.println("PASS "+count+" companion and conversation rules");
    }
}
