package com.dwinovo.numen.api.entity;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Exercises the production lease extracted unchanged from native/upstream.patch.
 * No Minecraft server, paid model, or player identity is used. */
class HostedLeaseRecoveryTest {
    private static final HostedControlLease.Fence FIRST = new HostedControlLease.Fence("audit-process-one",1);
    private HostedControlLease lease() { return new HostedControlLease(15_000,500); }

    @Test void anUninitializedSeatHasNoDrivingAuthority() {
        var lease=lease();
        assertEquals(HostedControlLease.Mode.PAUSED,lease.state().mode());
        assertTrue(lease.holdsNativeLoop(0));assertTrue(lease.releaseInput(0));
        assertThrows(IllegalStateException.class,()->lease.requireHarness(FIRST,0));
        assertThrows(IllegalStateException.class,()->lease.input(FIRST,"browser-one",1,0));
    }

    @Test void rejectedInputCannotExtendTheHeartbeatOrChangeTheLastSequence() {
        var lease=lease();lease.begin(FIRST,HostedControlLease.Mode.MANUAL,"browser-one",100);
        lease.confirmStopped(FIRST,true,101);
        assertThrows(IllegalStateException.class,()->lease.input(FIRST,"browser-other",999,15_000));
        assertEquals(-1,lease.state().lastSequence());assertTrue(lease.expire(15_100));
    }

    @Test void cancellationCannotBeConfirmedAfterTheLeaseDeadline() {
        var lease=lease();lease.begin(FIRST,HostedControlLease.Mode.HARNESS,null,100);
        assertThrows(IllegalStateException.class,()->lease.confirmStopped(FIRST,true,15_100));
        assertFalse(lease.state().settled());assertTrue(lease.holdsNativeLoop(15_100));
        assertThrows(IllegalStateException.class,()->lease.requireHarness(FIRST,15_100));
    }

    @Test void expiredModelModesStayPausedAndCannotBeRevivedByLateHeartbeats() {
        for(var mode:new HostedControlLease.Mode[]{HostedControlLease.Mode.NUMEN,HostedControlLease.Mode.HARNESS}) {
            var lease=lease();lease.begin(FIRST,mode,null,100);lease.confirmStopped(FIRST,true,101);
            assertTrue(lease.expire(15_100));assertEquals(HostedControlLease.Mode.PAUSED,lease.state().mode());
            assertFalse(lease.state().settled());assertTrue(lease.holdsNativeLoop(15_100));
            assertThrows(IllegalStateException.class,()->lease.heartbeat(FIRST,15_101));
            assertThrows(IllegalStateException.class,()->lease.requireHarness(FIRST,15_101));
        }
    }

    @Test void aNewProcessRecoversIntoPausedOnlyAfterTheOldLeaseExpires() {
        var lease=lease();lease.begin(FIRST,HostedControlLease.Mode.NUMEN,null,100);lease.confirmStopped(FIRST,true,101);
        var recovery=new HostedControlLease.Fence("audit-process-two",1);
        assertThrows(IllegalStateException.class,()->lease.begin(recovery,HostedControlLease.Mode.PAUSED,null,15_099));
        lease.expire(15_100);lease.begin(recovery,HostedControlLease.Mode.PAUSED,null,15_101);
        assertFalse(lease.state().settled());lease.confirmStopped(recovery,true,15_102);
        assertEquals(HostedControlLease.Mode.PAUSED,lease.state().mode());assertTrue(lease.holdsNativeLoop(15_103));
        assertThrows(IllegalStateException.class,()->lease.requireHarness(FIRST,15_103));
        assertThrows(IllegalStateException.class,()->lease.requireHarness(recovery,15_103));
    }

    @Test void explicitPauseInvalidatesTheOldBrainEvenWhenHeartbeatsContinue() {
        var lease=lease();lease.begin(FIRST,HostedControlLease.Mode.HARNESS,null,100);lease.confirmStopped(FIRST,true,101);
        var paused=new HostedControlLease.Fence(FIRST.boot(),2);
        lease.begin(paused,HostedControlLease.Mode.PAUSED,null,200);lease.confirmStopped(paused,true,201);
        lease.heartbeat(paused,202);assertTrue(lease.holdsNativeLoop(203));
        assertThrows(IllegalStateException.class,()->lease.requireHarness(FIRST,203));
        assertThrows(IllegalStateException.class,()->lease.requireHarness(paused,203));
        assertTrue(lease.releaseInput(203));
    }
}
