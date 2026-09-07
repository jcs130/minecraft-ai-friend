import dev.qiandeng.chanting.GestureBook;
import java.util.Map;

/** Actual gate transitions: audio intervals, release and one voice/shortcut ticket. */
public final class GestureBookTest {
    static final long T = 10_000_000;
    static final String A="actor-a", B="actor-b", W="qiandeng_chanting:whispering_staff", R="qiandeng_chanting:resonance_staff";
    static int assertions;
    static GestureBook book(){return new GestureBook("test",T-100_000);}
    static GestureBook.Pose pose(Object item,String id,String hand,boolean using){
        return new GestureBook.Pose(true,item==null?Map.of():Map.of(hand,new GestureBook.Held(id,item)),using?hand:"");
    }
    static void check(boolean truth,String name){assertions++;if(!truth)throw new AssertionError(name);}
    static void code(GestureBook.Result r,String expected){check(r.code().equals(expected),expected+" != "+r.code());}
    public static void main(String[] args){
        var empty=pose(null,"","mainhand",false);
        code(book().claim(A,T,T,0,empty,T),"direct_voice");
        Object wand=new Object();var active=pose(wand,W,"mainhand",true);var held=pose(wand,W,"mainhand",false);
        code(book().claim(A,T,T,0,held,T),"gesture_required");
        for(String itemId:new String[]{W,R}){
            var b=book();var p=pose(wand,itemId,"mainhand",true);var h=pose(wand,itemId,"mainhand",false);
            var first=b.begin(A,p,T);
            check(first!=null&&first.active()&&!first.claimed()&&first.slot()==0,"new press defaults to voice");
            check(b.begin(A,p,T+10).id().equals(first.id()),"held/repeated use cannot mint another ticket");
            code(b.claim(B,T,T+10,0,p,T+20),"gesture_required");
            code(b.claim(A,T+10,T+20,0,p,T+40),"gesture_pending");
            code(b.claim(A,T+10,T+20,0,p,T+50),"gesture_pending");
            check(!b.status(A,p,T+55).claimed(),"held claims and status do not consume");
            b.release(A,"mainhand",wand,T+60);
            var accepted=b.claim(A,T+10,T+20,0,h,T+70);
            check(accepted.ok(),"release permits one claim");code(accepted,"claimed");
            check(!accepted.gesture().active()&&accepted.gesture().claimed(),"receipt confirms released and consumed");
            code(b.claim(A,T+10,T+20,0,h,T+80),"gesture_consumed");
        }
        for(long gap:new long[]{0,7_999,8_000,8_001}){
            var b=book();b.begin(A,active,T);b.release(A,"mainhand",wand,T+1_000);
            code(b.claim(A,T+10,T+900,0,held,T+1_000+gap),gap<=8_000?"claimed":"gesture_expired");
        }
        // Capture and use share the MC JVM clock: no inferred five-second start.
        var b=book();b.begin(A,active,T);b.release(A,"mainhand",wand,T+1_000);
        code(b.claim(A,T-1,T-1,0,held,T+3_100),"gesture_required");
        code(b.claim(A,T-1,T+10,0,held,T+3_100),"ambiguous_gesture");
        code(b.claim(A,T,T+3_001,0,held,T+3_100),"recording_crossed_gesture");
        code(b.claim(A,T,T+3_000,0,held,T+3_100),"claimed");
        for(var changed:new GestureBook.Pose[]{empty,pose(wand,W,"offhand",false),pose(new Object(),W,"mainhand",false),pose(wand,R,"mainhand",false)}){
            b=book();b.begin(A,active,T);b.release(A,"mainhand",wand,T+1_000);
            code(b.claim(A,T+100,T+500,0,changed,T+1_500),"staff_changed");
            code(b.claim(A,T+100,T+500,0,held,T+1_600),"staff_changed");
        }
        b=book();b.begin(A,active,T);b.observe(A,empty,T+10);
        code(b.claim(A,T,T+5,0,active,T+20),"staff_changed");
        b=book();b.begin(A,active,T);b.observe(A,new GestureBook.Pose(false,Map.of(),""),T+10);
        code(b.claim(A,T,T+5,0,held,T+20),"actor_unavailable");
        code(book().claim(A,T,T,0,new GestureBook.Pose(false,Map.of(),""),T),"actor_unavailable");
        b=book();b.begin(A,active,T);b.release(A,"mainhand",wand,T+100);
        code(b.claim(A,T,T+50,0,empty,T+125_000),"staff_changed");
        code(b.claim(A,T,T+50,0,empty,T+125_001),"invalid_recorded_at");
        for(long[] times:new long[][]{{Long.MIN_VALUE,T},{0,T},{Long.MAX_VALUE,Long.MAX_VALUE},{T,T-1},{T,T+5_001}})
            code(book().claim(A,times[0],times[1],0,empty,T),"invalid_recorded_at");
        for(int slot:new int[]{-1,9})code(book().claim(A,T,T,slot,empty,T),"invalid_recorded_at");
        code(new GestureBook("restarted",T).claim(A,T-1,T,0,empty,T),"server_restarted");

        b=book();b.begin(A,active,T);b.select(A,2,active,T+20);
        check(b.status(A,active,T+25).slot()==2,"active selection uses the same gesture");
        code(b.claim(A,T+25,T+30,0,active,T+40),"shortcut_selected");
        code(b.claim(A,T+25,T+30,1,active,T+40),"slot_changed");
        code(b.claim(A,T+25,T+30,2,active,T+40),"gesture_pending");
        check(!b.status(A,active,T+50).claimed(),"selection mismatch and pending cannot consume");
        b.release(A,"mainhand",wand,T+60);b.select(A,3,held,T+70);
        check(b.status(A,held,T+75).slot()==2,"selection after release cannot rewrite the ticket");
        code(b.claim(A,T+25,T+30,2,held,T+80),"claimed");
        code(b.claim(A,T+25,T+30,0,held,T+90),"gesture_consumed");
        code(b.claim(A,T+25,T+30,2,held,T+95),"gesture_consumed");

        b=book();b.begin(A,active,T);b.select(A,8,active,T+20);b.select(A,0,active,T+40);
        b.release(A,"mainhand",wand,T+100);
        code(b.claim(A,T+10,T+80,0,held,T+110),"gesture_mode_changed");
        check(!b.status(A,held,T+115).claimed(),"old speech before mode switch cannot consume new voice mode");
        code(b.claim(A,T+40,T+90,0,held,T+120),"claimed");
        b=book();b.begin(A,active,T);b.select(A,9,active,T+10);b.select(A,-1,active,T+20);
        check(b.status(A,active,T+25).slot()==0,"invalid selection leaves default voice unchanged");
        b.cancel(A,T+50);b.select(A,3,held,T+60);
        code(b.claim(A,T+10,T+20,0,held,T+100),"gesture_cancelled");
        check(b.status(A,held,T+110).slot()==0,"cancelled gesture cannot be selected again");

        // Claimed/cancelled/unused old intervals all reject overlapping long
        // speech. Late ASR cannot borrow a new press, even after its old ticket ends.
        for(String previous:new String[]{"claimed","cancelled","unused"}){
            b=book();b.begin(A,active,T);
            if(previous.equals("cancelled"))b.cancel(A,T+1_000);else b.release(A,"mainhand",wand,T+1_000);
            if(previous.equals("claimed"))code(b.claim(A,T+100,T+500,0,held,T+1_100),"claimed");
            var newer=b.begin(A,active,T+2_100);
            code(b.claim(A,T+100,T+2_300,0,active,T+2_400),"ambiguous_gesture");
            code(b.claim(A,T+2_300,T+2_400,0,active,T+2_500),"ambiguous_gesture");
            check(!b.status(A,active,T+2_600).claimed(),"overlapping recording preserves new ticket: "+previous);
            b.release(A,"mainhand",wand,T+3_500);
            code(b.claim(A,T+3_000,T+3_000,0,held,T+3_600),"ambiguous_gesture");
            var single=b.claim(A,T+3_001,T+3_400,0,held,T+3_600);
            code(single,"claimed");check(single.gesture().id().equals(newer.id()),"non-overlapping released second gesture still works");
        }
        b=book();b.begin(A,active,T);b.release(A,"mainhand",wand,T+100);
        code(b.claim(A,T+50,T+2_101,0,empty,T+2_200),"recording_crossed_gesture");
        b=book();var off=pose(wand,R,"offhand",true);b.begin(A,off,T);b.release(A,"offhand",wand,T+100);
        code(b.claim(A,T,T+50,0,pose(wand,R,"offhand",false),T+200),"claimed");
        System.out.println("{\"ok\":true,\"assertions\":"+assertions+"}");
    }
}
