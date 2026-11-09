package org.afuhome.agentfriend;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.afuhome.agentfriend.AdventureMenuModel.*;

public final class AdventureMenuModelTest {
    private static int checks;
    private static void check(boolean ok,String why){checks++;if(!ok)throw new AssertionError(why);}
    public static void main(String[] args)throws Exception{
        for(Page page:List.of(Page.HOME,Page.GROWTH,Page.ADVENTURE,Page.STORAGE,Page.TRADE,Page.SOCIAL,Page.MEMORIES)){
            List<Button> buttons=category(page);
            check(buttons.size()>=4&&buttons.size()<=6,"small category size "+page);
            check(buttons.stream().map(Button::slot).distinct().count()==buttons.size(),"unique content slots "+page);
            check(buttons.stream().allMatch(b->b.slot()>=10&&b.slot()<=25),"content separated from navigation "+page);
            check(buttons.stream().noneMatch(b->b.action()==Action.COMMON_USE||b.action()==Action.TIDY_BAG_CONFIRM||b.action()==Action.TIDY_STASH_CONFIRM),"no immediate destructive action "+page);
        }
        check(category(Page.HOME).stream().allMatch(b->destination(b.action())!=null),"home only navigates");
        check(parent(Page.COMMON_DETAIL)==Page.COMMON&&parent(Page.TIDY_STASH)==Page.STORAGE,"return to context");
        check(SIZE==36&&Arrays.stream(CONTENT).distinct().count()==14,"vanilla four-row grid");
        try{new View(Page.HOME,"","a","b",List.of(button(10,Action.HOME,"COMPASS","a"),button(10,Action.CLOSE,"BARRIER","b")));throw new AssertionError("duplicate accepted");}catch(IllegalArgumentException expected){checks++;}
        for(String input:List.of("中文菜单说明", "返回\uD83D\uDE80大厅", "§c红字\n换行\t下一步", "", "a\u0301bcdefghijklmn")){
            var rows=lines(input,8,2);check(rows.size()<=2,"bounded text");
            check(rows.stream().noneMatch(s->s.contains("§")||s.contains("\n")||s.contains("\t")),"no format/control spill");
            check(rows.stream().allMatch(s->{for(int i=0;i<s.length();i++){char c=s.charAt(i);if(Character.isHighSurrogate(c)){if(++i>=s.length()||!Character.isLowSurrogate(s.charAt(i)))return false;}else if(Character.isLowSurrogate(c))return false;}return true;}),"surrogate pairs intact");
        }
        UUID owner=UUID.randomUUID(),other=UUID.randomUUID();Ticket ticket=new Ticket(owner,1000);
        check(partyAction("create",true,false,null).equals("create"),"explicit own party creation");
        check(partyAction("create",false,false,null)==null,"unknown party state never creates");
        check(partyAction("create",true,true,null)==null,"membership change prevents duplicate creation");
        check(partyAction("create",true,false,owner.toString())==null,"pending invitation prevents accidental split party");
        check(partyAction("accept|"+owner,true,false,owner.toString()).equals("accept"),"current inviter accepted explicitly");
        check(partyAction("decline|"+owner,true,false,owner.toString()).equals("decline"),"current inviter declined explicitly");
        check(partyAction("accept|"+owner,true,false,other.toString())==null,"changed inviter never accepted");
        check(partyAction("decline|"+owner,true,false,null)==null,"expired invitation never acted on");
        for(String token:List.of("leave","create extra","accept|oops","accept|"+owner+"|extra","accept\n"+owner))
            check(partyAction(token,true,false,owner.toString())==null,"no arbitrary party command "+token);
        check(!ticket.consume(other,0,4,2000),"foreign actor rejected");
        check(!ticket.consume(owner,-1,4,2000)&&!ticket.consume(owner,4,4,2000),"out of range rejected");
        check(ticket.consume(owner,1,4,2000),"valid reply accepted once");
        check(!ticket.consume(owner,1,4,2000),"duplicate response rejected");
        check(!new Ticket(owner,1000).consume(owner,1,4,121001),"stale response rejected");
        ticket=new Ticket(owner,1000);ticket.close();check(!ticket.consume(owner,0,4,2000),"closed response rejected");
        Ticket concurrent=new Ticket(owner,1000);AtomicInteger accepted=new AtomicInteger();
        try(var pool=Executors.newFixedThreadPool(4)){
            var work=new ArrayList<Future<?>>();for(int i=0;i<32;i++)work.add(pool.submit(()->{if(concurrent.consume(owner,1,4,2000))accepted.incrementAndGet();}));
            for(var future:work)future.get();
        }
        check(accepted.get()==1,"one action despite concurrent duplicate replies");
        check(new Ticket(other,1000).consume(other,1,4,2000),"different player independent");
        System.out.println("PLAYER_UI_MODEL passed=true checks="+checks);
    }
}
