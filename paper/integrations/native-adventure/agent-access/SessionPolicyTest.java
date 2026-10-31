package dev.qiandeng.maw.taunative;

public final class SessionPolicyTest {
    private static int count;
    private static void check(boolean expected, boolean... flags) {
        boolean actual = SessionPolicy.allowed(flags[0], flags[1], flags[2], flags[3], flags[4], flags[5], flags[6], flags[7], flags[8], flags[9]);
        if (actual != expected) throw new AssertionError("session case " + count);
        count++;
    }
    public static void main(String[] ignored) {
        check(false, true,false,false,false,false,false,false,false,false,false);
        check(true, true,false,true,true,false,false,false,false,false,false);
        check(false, true,false,true,false,true,true,true,true,true,true);
        check(true, true,false,false,false,true,false,false,false,false,false);
        check(true, true,false,false,false,false,true,true,true,true,true);
        for (int missing : new int[]{0,5,6,7,8,9}) {
            boolean[] f={true,false,false,false,false,true,true,true,true,true}; f[missing]=false;
            check(false,f);
        }
        check(false,true,true,false,false,false,true,true,true,true,true);
        System.out.println("SessionPolicy assertions=" + count);
    }
}
