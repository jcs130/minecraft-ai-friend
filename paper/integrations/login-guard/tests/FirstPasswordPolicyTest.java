package org.afuhome.auth;

/** A first-visit exception must never overwrite an existing password, and a
 * stale/disconnected session must not acquire credential-changing permission. */
public final class FirstPasswordPolicyTest {
    public static void main(String[] args) {
        check(LoginGuard.maySetPassword(true,true,false,false),"first visit can set its first password");
        check(!LoginGuard.maySetPassword(false,true,false,false),"limbo cannot use the authenticated setup shortcut");
        check(!LoginGuard.maySetPassword(true,true,true,false),"stale first-visit flag cannot overwrite an existing password");
        check(!LoginGuard.maySetPassword(true,false,true,false),"ordinary login cannot reset a password without the old one");
        check(LoginGuard.maySetPassword(true,false,true,true),"verified premium owner can replace a forgotten server password");
        check(LoginGuard.maySetPassword(true,false,false,true),"premium-only owner can choose an offline password");
        check(!LoginGuard.maySetPassword(false,false,true,true),"stale premium proof without authorization cannot reset credentials");
        check(!LoginGuard.maySetPassword(true,false,false,false),"missing hash alone is not reset permission");
        System.out.println("PASS 8 first-password / verified-owner reset permission cases");
    }
    static void check(boolean ok,String label){if(!ok)throw new AssertionError(label);}
}
