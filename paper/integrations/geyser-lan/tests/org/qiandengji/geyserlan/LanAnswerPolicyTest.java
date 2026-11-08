package org.qiandengji.geyserlan;

import java.util.concurrent.atomic.AtomicLong;

public final class LanAnswerPolicyTest {
    private static int passed;
    private static void eq(Object expected, Object actual) {
        if (!java.util.Objects.equals(expected, actual)) throw new AssertionError("Unexpected answer transformation");
        passed++;
    }
    public static void main(String[] args) {
        AtomicLong now = new AtomicLong(1000);
        LanAnswerPolicy policy = new LanAnswerPolicy(now::get);
        String sdp = "v=0\r\na=ice-ufrag:original\r\na=fingerprint:sha-256 unchanged\r\na=identity:signed-server-assertion\r\na=candidate:untouched\r\n";
        String original = "CONNECTRESPONSE c1 " + sdp;
        String compact = original.replace("a=identity:signed-server-assertion\r\n", "");
        eq(original, policy.answer("17", original));
        policy.offered("c1", "17", "v=0\r\n", true, false);
        eq(compact, policy.answer("17", original));
        eq(original, policy.answer("18", original));
        eq(original.replace("c1", "c2"), policy.answer("17", original.replace("c1", "c2")));
        for (String type : new String[]{"CONNECTREQUEST", "CANDIDATEADD", "CONNECTERROR"}) {
            String signal = original.replace("CONNECTRESPONSE", type); eq(signal, policy.answer("17", signal));
        }
        eq(compact, policy.answer("17", compact));
        policy.offered("c1", "17", "v=0\na=identity:validated\n", true, true);
        eq(original, policy.answer("17", original));
        policy.offered("c1", "17", "v=0\na=identity:unvalidated\n", true, false);
        eq(original, policy.answer("17", original));
        policy.offered("c1", "17", "v=0\n", false, false);
        eq(original, policy.answer("17", original));
        policy.offered("c1", "17", "v=0\n", true, true);
        eq(original, policy.answer("17", original));
        policy.offered("c1", "17", "v=0\n", true, false);
        now.addAndGet(60001); eq(original, policy.answer("17", original));
        policy.offered("c1", "17", "v=0\n", true, false);
        policy.closed("c1"); eq(original, policy.answer("17", original));
        policy.offered("c1", "17", "v=0\n", true, false);
        policy.clear(); eq(original, policy.answer("17", original));
        for (int i=0;i<256;i++) policy.offered("c"+i, "17", "v=0\n", true, false);
        policy.offered("overflow", "17", "v=0\n", true, false);
        String excess=original.replace("c1", "overflow"); eq(excess,policy.answer("17",excess));
        policy.closed("c1"); policy.offered("overflow", "17", "v=0\n", true, false);
        eq(excess.replace("a=identity:signed-server-assertion\r\n", ""),policy.answer("17",excess));
        eq("CONNECTRESPONSE overflow v=0\na=fingerprint:same\n",policy.answer("17","CONNECTRESPONSE overflow v=0\na=fingerprint:same\na=identity:last"));
        eq("CONNECTRESPONSE overflow malformed a=identity:literal",policy.answer("17","CONNECTRESPONSE overflow malformed a=identity:literal"));
        now.set(0); eq(excess,policy.answer("17",excess));
        System.out.println("LAN answer policy: "+passed+" checks passed");
    }
}
