package dev.god.godvoice;
import java.util.Map;
import java.util.UUID;
public final class NearbySpeechTurnsTest {
    private static int checks;
    private static void check(boolean value){if(!value)throw new AssertionError("speech turn "+checks);checks++;}
    public static void main(String[] args){
        var t=new NearbySpeechTurns();
        UUID human=UUID.randomUUID(), session=UUID.randomUUID(), a=UUID.randomUUID(), b=UUID.randomUUID();
        UUID first=UUID.randomUUID(), next=UUID.randomUUID(), world=UUID.randomUUID();
        var mic=new NearbySpeechTurns.Place(world,0,70,0,8);
        var near=new NearbySpeechTurns.Place(world,4,70,0,24);
        var far=new NearbySpeechTurns.Place(world,65,70,0,24);
        var other=new NearbySpeechTurns.Place(UUID.randomUUID(),4,70,0,24);
        t.microphone(human,session,mic,false,1000);
        check(!t.begin(a,first,near,1050));
        check(t.begin(b,next,far,1060));
        t.end(b,next,1090);
        check(t.begin(b,next,other,1120));
        t.microphone(human,session,mic,true,1200);
        check(!t.begin(a,first,near,1200+NearbySpeechTurns.GAP_MS-1));
        check(t.begin(a,first,near,1200+NearbySpeechTurns.GAP_MS));
        check(t.begin(a,first,near,1700));
        t.end(b,next,1710);
        check(!t.begin(b,next,near,1710));
        t.end(a,UUID.randomUUID(),1750);
        check(!t.begin(b,next,near,1751));
        t.end(a,first,1800);
        check(t.begin(b,next,near,1800+NearbySpeechTurns.GAP_MS));
        t.clear();
        t.microphone(human,session,mic,false,3000);
        check(t.begin(a,first,new NearbySpeechTurns.Place(world,9,70,0,24),3010));
        t.forget(a);
        t.microphone(human,UUID.randomUUID(),mic,true,3015);
        check(!t.begin(a,first,near,3800));
        check(t.begin(a,first,near,3000+NearbySpeechTurns.LOST_STOP_MS));
        var moved=new VoiceAudience.Actor(a,session,world,65,70,0,"agent",true);
        t.update(new VoiceAudience.Snapshot(3910,Map.of(a,moved)),3910);
        check(t.begin(b,next,near,3911));
        t.forget(b);
        check(!t.begin(b,next,far,3912));
        t.clear();
        check(t.begin(b,next,far,3913));
        t.microphone(human,session,far,false,3914);
        check(!t.begin(b,next,far,3915));
        t.microphone(human,session,far,true,3920);
        check(t.begin(a,first,far,3920+NearbySpeechTurns.GAP_MS));
        System.out.println("Nearby voice turns: "+checks+" checks passed");
    }
}
