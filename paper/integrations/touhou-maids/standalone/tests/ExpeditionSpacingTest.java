package local.qdj.maids.brain;

import static local.qdj.maids.brain.ExpeditionSpacing.Step.*;

public final class ExpeditionSpacingTest {
    private static void check(Object wanted, Object got) {
        if (!wanted.equals(got)) throw new AssertionError("expected " + wanted + ", got " + got);
    }
    public static void main(String[] args) {
        var p = new ExpeditionSpacing();
        String same = "a>a", cross = "a>b";
        check(NEAR, p.sample(same,true,7,false,0));
        check(WALK, p.sample(same,true,9,false,1000));
        check(WALK, p.sample(same,true,6,true,2000));
        check(NEAR, p.sample(same,true,4,false,3000));
        check(WALK, p.sample(same,true,15,false,4000));
        check(WALK, p.sample(same,true,16,true,16500));
        check(WALK, p.sample(same,true,17,false,27500));
        check(REJOIN,p.sample(same,true,18,false,28500));
        p.pause();
        check(WAIT,p.sample(cross,false,Double.POSITIVE_INFINITY,false,29000));
        check(WAIT,p.sample(cross,false,Double.POSITIVE_INFINITY,false,35500));
        check(WAIT,p.sample("a>c",false,Double.POSITIVE_INFINITY,false,55000));
        check(WAIT,p.sample("a>c",false,Double.POSITIVE_INFINITY,false,58500));
        check(REJOIN,p.sample("a>c",false,Double.POSITIVE_INFINITY,false,60000));
        p.pause();
        check(WALK,p.sample(same,true,20,false,95000));
        check(WAIT,p.sample(same,true,70,false,96000));
        check(WAIT,p.sample(same,true,72,true,100000));
        check(REJOIN,p.sample(same,true,72,true,101000));
    }
}
