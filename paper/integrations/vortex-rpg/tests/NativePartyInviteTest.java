package org.qiandengji.vortex.tests;

import io.vortexcore.world.ExpeditionPartyManager;
import java.time.Duration;
import java.util.UUID;

public final class NativePartyInviteTest {
    private static int checks;
    private static void check(boolean ok){if(!ok)throw new AssertionError("invite rule "+checks);checks++;}
    public static void main(String[]args)throws Exception {
        var manager=new ExpeditionPartyManager(Duration.ofSeconds(120));var a=UUID.randomUUID();var b=UUID.randomUUID();
        check(manager.pendingInviteOf(b).isEmpty());check(manager.createParty(a).success());check(manager.invite(a,b).success());
        var first=manager.pendingInviteOf(b).orElseThrow();check(first.inviterId().equals(a)&&first.targetId().equals(b));
        check(manager.pendingInviteOf(b).orElseThrow().equals(first));check(manager.partyOf(b).isEmpty());
        check(manager.acceptInvite(b).success());check(manager.pendingInviteOf(b).isEmpty());check(manager.membersOf(a).size()==2);
        check(!manager.acceptInvite(b).success());check(manager.leave(b).success());check(manager.invite(a,b).success());
        check(manager.declineInvite(b).success());check(manager.pendingInviteOf(b).isEmpty());
        check(manager.invite(a,b).success());check(manager.disband(a).success());check(manager.pendingInviteOf(b).isEmpty());
        var expired=new ExpeditionPartyManager(Duration.ofMillis(1));check(expired.createParty(a).success());check(expired.invite(a,b).success());
        Thread.sleep(8);check(expired.pendingInviteOf(b).isEmpty());check(!expired.acceptInvite(b).success());
        check(manager.pendingInviteOf(null).isEmpty());
        System.out.println("native-invite-checks="+checks+" passed=true");
    }
}
