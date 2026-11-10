import local.tlmcompat.hybrid.MaidFollowPolicy;
import static local.tlmcompat.hybrid.MaidFollowPolicy.Action.*;
import java.util.*;

public final class MaidFollowPolicyFixture {
    private static int checks;
    private static void check(boolean value,String label){if(!value)throw new AssertionError(label);checks++;}
    private static MaidFollowPolicy.Point p(double x,double y,double z){return new MaidFollowPolicy.Point(x,y,z);}
    public static void main(String[] args){
        UUID a=UUID.randomUUID(),b=UUID.randomUUID();MaidFollowPolicy policy=new MaidFollowPolicy();
        var owner=p(4.5,2.5,0);var maid=p(0,0,0);
        check(policy.observe(a,maid,owner,0)==WALK,"nearby lower floor must request following before six blocks");
        check(policy.observe(a,maid,owner,7_000_000_000L)==WALK,"brief pathfinding must not teleport");
        check(policy.observe(a,maid,owner,8_000_000_000L)==RECOVER,"stuck path requests original safe recovery");
        check(policy.observe(a,maid,owner,16_000_000_000L)==WALK,"recovery respects cooldown even when landing failed");
        check(policy.observe(a,maid,owner,23_000_000_000L)==RECOVER,"later safe recovery is bounded by fifteen seconds");
        check(policy.observe(a,owner,owner,24_000_000_000L)==REST,"already nearby does not chase or teleport");
        check(policy.observe(a,p(2,2.5,0),owner,26_000_000_000L)==REST,"three block tolerance avoids close jitter");
        policy.clear(a);
        check(policy.observe(a,maid,owner,30_000_000_000L)==WALK,"resumed follow starts a fresh observation");
        check(policy.observe(a,p(.5,0,0),owner,37_000_000_000L)==WALK,"real progress extends navigation time");
        check(policy.observe(a,p(.5,0,0),owner,38_000_000_000L)==WALK,"progress is not reported as immediately stuck");
        check(policy.observe(a,p(.5,0,0),p(8,2.5,0),45_000_000_000L)==WALK,"owner movement starts a new progress window");
        check(policy.observe(b,maid,owner,45_000_000_000L)==WALK,"different maids do not share timing state");
        policy.retain(Set.of(b));
        check(policy.observe(a,maid,owner,60_000_000_000L)==WALK,"unloaded or unregistered state is discarded");
        policy.clear(b);
        check(policy.observe(b,maid,owner,65_000_000_000L)==WALK,"pause clears another maid independently");
        policy.clear(a);
        check(policy.observe(a,p(0,0,0),p(24,0,0),0,32,64)==REST,"custom profile permits nearby roaming");
        check(policy.observe(a,p(0,0,0),p(32,0,0),90_000_000_000L,32,64)==REST,"32 block boundary does not pull back even after a long pause");
        policy.clear(a);
        check(policy.observe(a,p(0,0,0),p(40,0,0),0,32,64)==WALK,"custom profile follows beyond 32 blocks");
        check(policy.observe(a,p(0,0,0),p(40,0,0),90_000_000_000L,32,64)==WALK,"blocked route inside 64 blocks never triggers bridge recovery");
        check(policy.observe(a,p(0,0,0),p(64,0,0),99_000_000_000L,32,64)==WALK,"bridge recovery requires distance greater than 64");
        policy.clear(a);
        check(policy.observe(a,p(0,0,0),p(70,0,0),0,32,64)==WALK,"far route first gets a navigation opportunity");
        check(policy.observe(a,p(0,0,0),p(70,0,0),8_000_000_000L,32,64)==RECOVER,"far stuck route can use original safe recovery");
        check(policy.observe(a,p(0,0,0),p(70,0,0),16_000_000_000L,32,64)==WALK,"custom recovery keeps cooldown");
        check(policy.observe(a,p(0,0,0),p(70,0,0),23_000_000_000L,32,64)==RECOVER,"custom recovery can retry after the cooldown");
        check(policy.observe(a,p(0,0,0),p(70,0,0),24_000_000_000L,48,96)==WALK,"profile changes reset stale timers");
        check(policy.observe(a,p(0,0,0),p(70,0,0),100_000_000_000L,48,96)==WALK,"expanded recovery range does not reuse a smaller threshold");
        check(policy.observe(b,maid,owner,100_000_000_000L)==RECOVER,"custom profile does not affect another maid's defaults");
        for(double[] invalid:new double[][]{{2,64},{32,31},{32,257},{Double.NaN,64},{32,Double.POSITIVE_INFINITY}}){
            boolean rejected=false;try{policy.observe(a,maid,owner,0,invalid[0],invalid[1]);}catch(IllegalArgumentException expected){rejected=true;}
            check(rejected,"invalid distances are rejected without guessing");
        }
        System.out.println("MaidFollowPolicyFixture: "+checks+" checks passed; no game connection");
    }
}
