import org.cortico.minecraft.ReconnectSession;

public final class ReconnectSessionCheck {
    private static int checks;
    private static void check(boolean value, String label) { checks++; if (!value) throw new AssertionError(label); }
    public static void main(String[] args) {
        ReconnectSession retry = new ReconnectSession();
        Object first = new Object();
        check(!retry.tick(first, 0), "disabled by default");
        retry.arm();
        check(!retry.tick(first, 0), "schedule initial retry");
        check(!retry.tick(first, 2999), "wait initial delay");
        check(retry.tick(first, 3000), "retry after three seconds");
        check(!retry.tick(first, 5000), "one attempt per disconnected screen");
        check(!retry.tick(null, 6000), "connecting or title screen has no retry");
        check(!retry.tick(first, 7000), "cancel returns to the same screen without another attempt");
        Object failed = new Object();
        check(!retry.tick(failed, 8000), "fresh failed connection schedules next attempt");
        check(!retry.tick(failed, 17999), "backoff grows");
        check(retry.tick(failed, 18000), "second retry");
        retry.arm(); retry.cancel();
        check(retry.attempts() == 2, "auth-pending connection does not reset failed reconnect backoff");
        retry.block();
        check(!retry.tick(new Object(), 100000), "authentication failure stops reconnection");
        retry.arm();
        Object manual = new Object();
        retry.tick(manual, 1000);
        retry.tick(null, 2000);
        check(!retry.tick(null, 100000), "leaving disconnect screen cancels scheduled retry");
        retry.online(100000);
        check(retry.attempts() == 2, "initial authorization does not reset failed reconnect backoff");
        retry.online(129999);
        check(retry.attempts() == 2, "authorization must remain stable for thirty seconds");
        retry.online(130000);
        check(retry.attempts() == 0, "stable authorized connection resets backoff");
        Object recovery = new Object();
        check(!retry.tick(recovery, 200000), "new disconnect can retry");
        check(retry.tick(recovery, 203000), "new disconnect resets delay");
        ReconnectSession burst = new ReconnectSession();burst.arm();
        long now=0;long[] delays={3000,10000,30000,60000};
        for(int i=0;i<delays.length;i++){
            Object kicked=new Object();
            check(!burst.tick(kicked,now),"a new kick waits its current backoff");
            check(!burst.tick(kicked,now+delays[i]-1),"brief prior authorization cannot shorten backoff");
            check(burst.tick(kicked,now+delays[i]),"one bounded retry after its full delay");
            burst.arm();burst.online(now+delays[i]+1);burst.online(now+delays[i]+100);
            check(burst.attempts()==i+1,"join and short authorized PLAY do not reset the retry budget");
            now+=delays[i]+1000;
        }
        check(burst.exhausted()&&burst.maximumAttempts()==4,"four short-lived reconnects exhaust the budget");
        Object stopped=new Object();
        check(!burst.tick(stopped,now)&&!burst.tick(stopped,now+600000),"no fifth automatic retry even after a long wait");
        burst.arm();check(!burst.tick(new Object(),now+700000),"re-arming at a join does not erase exhaustion");
        burst.block();burst.online(now+800000);burst.online(now+900000);
        check(burst.exhausted()&&!burst.tick(new Object(),now+1000000),"blocked authentication cannot reset or revive retries");
        burst.arm();burst.online(now+1100000);burst.online(now+1130000);
        check(!burst.exhausted()&&burst.attempts()==0,"actual stable manual recovery permits future normal reconnects");
        ReconnectSession interrupted=new ReconnectSession();interrupted.arm();Object broken=new Object();
        interrupted.tick(broken,0);interrupted.tick(broken,3000);interrupted.online(4000);
        interrupted.tick(null,5000);interrupted.online(100000);
        check(interrupted.attempts()==1,"leaving PLAY breaks the stable authorization interval");
        interrupted.online(99999);interrupted.online(129998);
        check(interrupted.attempts()==1,"backward clock does not immediately reset retries");
        interrupted.online(129999);check(interrupted.attempts()==0,"clock recovery requires a complete new stable interval");
        System.out.println("ReconnectSession: " + checks + " checks passed; bounded retries require stable authorization");
    }
}
