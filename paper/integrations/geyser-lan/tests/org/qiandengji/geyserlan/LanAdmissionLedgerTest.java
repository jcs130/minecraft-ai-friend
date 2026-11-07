package org.qiandengji.geyserlan;
import java.net.*;
import java.util.concurrent.atomic.AtomicLong;
public final class LanAdmissionLedgerTest {
    private static int checks;
    private static void check(boolean condition){checks++;if(!condition)throw new AssertionError("check "+checks);}
    public static void main(String[] args)throws Exception{
        var time=new AtomicLong(1000);var policy=new LanAdmissionLedger("192.168.3.0/24",time::get);
        InetAddress a=InetAddress.getByName("192.168.3.22"),b=InetAddress.getByName("192.168.3.23"),outside=InetAddress.getByName("192.168.4.22");
        check(policy.allowed(a));check(!policy.allowed(outside));check(!policy.allowed(InetAddress.getByName("127.0.0.1")));check(!policy.allowed(InetAddress.getByName("192.168.3.255")));check(!policy.allowed(InetAddress.getByName("::1")));
        String n=policy.challenge(a);check(n.length()==32);check(policy.challenge(a).equals(n));check(policy.challenge(outside)==null);
        check("LAN_LOGIN_UNSIGNED".equals(policy.consume(a,false,n,new byte[]{1})));
        check("LAN_SOURCE_DENIED".equals(policy.consume(outside,true,n,new byte[]{1})));
        check("LAN_CHALLENGE_MISSING".equals(policy.consume(a,true,null,new byte[]{1})));
        check("LAN_CHALLENGE_EXPIRED_OR_WRONG".equals(policy.consume(b,true,n,new byte[]{1})));
        check("LAN_CHALLENGE_EXPIRED_OR_WRONG".equals(policy.consume(a,true,"wrong",new byte[]{1})));
        check(policy.consume(a,true,n,new byte[]{1})==null);check("LAN_LOGIN_REPLAY".equals(policy.consume(a,true,n,new byte[]{1})));
        check(policy.consume(a,true,n,new byte[]{2})==null);
        time.addAndGet(30_001);String next=policy.challenge(a);check(!next.equals(n));check(policy.consume(a,true,n,new byte[]{3})==null);
        time.addAndGet(60_000);check("LAN_CHALLENGE_EXPIRED_OR_WRONG".equals(policy.consume(a,true,n,new byte[]{4})));check(policy.consume(a,true,next,new byte[]{5})==null);
        for(String bad:new String[]{"0.0.0.0/0","192.168.0.0/16","192.168.3.3/24","8.8.8.0/24","localhost/24"}){try{new LanAdmissionLedger(bad);throw new AssertionError(bad);}catch(IllegalArgumentException expected){checks++;}}
        System.out.println("LanAdmissionLedgerTest: "+checks+" passed");
    }
}
