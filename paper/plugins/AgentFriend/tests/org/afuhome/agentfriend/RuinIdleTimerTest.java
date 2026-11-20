package org.afuhome.agentfriend;

import java.util.concurrent.TimeUnit;

public final class RuinIdleTimerTest {
    private static void check(boolean ok) { if (!ok) throw new AssertionError(); }
    private static long seconds(long value) { return TimeUnit.SECONDS.toNanos(value); }

    public static void main(String[] args) {
        RuinIdleTimer timer = new RuinIdleTimer(300);
        check(!timer.due("site-crypt", true, 0));
        check(!timer.due("site-crypt", true, seconds(300)-1));
        check(timer.due("site-crypt", true, seconds(300)));
        check(!timer.due("wild-cairn", true, seconds(302)));
        // A player arrives between batches. A full new quiet period is required.
        check(!timer.due("site-crypt", false, seconds(305)));
        check(!timer.due("site-crypt", true, seconds(306)));
        check(!timer.due("site-crypt", true, seconds(605)));
        check(timer.due("wild-cairn", true, seconds(605)));
        check(timer.due("site-crypt", true, seconds(606)));
        // A cleaned journal cannot carry its elapsed deadline into the next visit.
        check(!timer.due("wild-cairn", false, seconds(607)));
        check(!timer.due("wild-cairn", true, seconds(1000)));
        check(!new RuinIdleTimer(300).due("site-crypt", true, seconds(1000)));
        for (int invalid : new int[]{0,-1,86401}) {
            try { new RuinIdleTimer(invalid); throw new AssertionError(); }
            catch (IllegalArgumentException expected) { }
        }
        System.out.println("Ruin idle reset timing passed");
    }
}
