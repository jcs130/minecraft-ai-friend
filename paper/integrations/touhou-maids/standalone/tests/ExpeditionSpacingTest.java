package local.qdj.maids.brain;

import static local.qdj.maids.brain.CompanionFollowPolicy.Step.*;

public final class ExpeditionSpacingTest {
    private static void check(Object wanted, Object got) {
        if (!wanted.equals(got)) throw new AssertionError("expected " + wanted + ", got " + got);
    }
    public static void main(String[] args) {
        var p = new CompanionFollowPolicy();
        var expedition = CompanionFollowPolicy.Profile.teammate(8, 4, 64);
        String same = "a>a", cross = "a>b";
        check(NEAR, p.sample(expedition,same,true,7,false,false,0));
        check(WALK, p.sample(expedition,same,true,9,false,false,1000));
        check(WALK, p.sample(expedition,same,true,6,true,false,2000));
        check(NEAR, p.sample(expedition,same,true,4,false,false,3000));
        check(WALK, p.sample(expedition,same,true,15,false,false,4000));
        check(WALK, p.sample(expedition,same,true,16,true,false,16500));
        check(WALK, p.sample(expedition,same,true,17,false,false,27500));
        check(REJOIN,p.sample(expedition,same,true,18,false,true,28500));
        p.pause();
        check(WAIT,p.sample(expedition,cross,false,Double.POSITIVE_INFINITY,false,false,29000));
        check(WAIT,p.sample(expedition,cross,false,Double.POSITIVE_INFINITY,false,false,35500));
        check(WAIT,p.sample(expedition,"a>c",false,Double.POSITIVE_INFINITY,false,false,55000));
        check(WAIT,p.sample(expedition,"a>c",false,Double.POSITIVE_INFINITY,false,false,58500));
        check(REJOIN,p.sample(expedition,"a>c",false,Double.POSITIVE_INFINITY,false,false,60000));
        p.pause();
        check(WALK,p.sample(expedition,same,true,20,false,false,95000));
        check(WAIT,p.sample(expedition,same,true,70,false,false,96000));
        check(WAIT,p.sample(expedition,same,true,72,true,false,100000));
        check(REJOIN,p.sample(expedition,same,true,72,true,false,101000));

        var owner = new CompanionFollowPolicy();
        var feiyu = CompanionFollowPolicy.Profile.owner(6, 3, 12);
        check(NEAR, owner.sample(feiyu,same,true,6,false,false,0));
        check(WALK, owner.sample(feiyu,same,true,7,false,false,1_000));
        check(WALK, owner.sample(feiyu,same,true,5,true,false,2_000));
        check(NEAR, owner.sample(feiyu,same,true,3,false,false,3_000));
        check(WALK, owner.sample(feiyu,same,true,15,false,false,4_000));
        check(WALK, owner.sample(feiyu,same,true,16,false,true,11_000));
        check(REJOIN, owner.sample(feiyu,same,true,16,false,false,19_000));
        owner.pause();
        check(WALK, owner.sample(feiyu,same,true,16,false,false,20_000));
        check(WALK, owner.sample(feiyu,same,true,16,false,false,33_999));
        check(REJOIN, owner.sample(feiyu,same,true,16,false,false,34_000));
        var personalized = CompanionFollowPolicy.Profile.owner(14, 6, 20);
        check(NEAR, owner.sample(personalized,same,true,12,false,false,35_000));

        var contract = new CompanionFollowPolicy();
        var player = CompanionFollowPolicy.Profile.teammate(6, 3, 64);
        check(WALK, contract.sample(player,same,true,7,false,false,1_000));
        check(WALK, contract.sample(player,same,true,4,true,false,2_000));
        check(NEAR, contract.sample(player,same,true,3,false,false,3_000));
        check(WAIT, contract.sample(player,cross,false,Double.POSITIVE_INFINITY,false,false,4_000));
        check(REJOIN, contract.sample(player,cross,false,Double.POSITIVE_INFINITY,false,false,9_000));
        System.out.println("Companion follow policy checks passed for owners, resident teammates and player contracts");
    }
}
