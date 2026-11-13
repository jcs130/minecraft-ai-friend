import org.cortico.minecraft.ReconnectSession;
import java.util.List;

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
        Object timeout = new Object();
        check(!burst.tick(timeout, 130000, true), "first transient failure uses normal backoff");
        check(burst.tick(timeout, 133000, true), "retry after normal backoff");
        long time = 134000;
        for (long delay : new long[]{10000, 30000, 60000}) {
            Object next = new Object();
            check(!burst.tick(next, time, true), "schedule bounded retry");
            time += delay;
            check(burst.tick(next, time++, true), "consume bounded retry");
        }
        Object prolonged = new Object();
        check(!burst.tick(prolonged, 240000, true), "schedule slow reconnect");
        check(!burst.tick(prolonged, 359999, true), "respect the two minute backoff");
        check(burst.tick(prolonged, 360000, true), "recover after the normal budget was exhausted");
        check(!burst.tick(prolonged, 560000, true), "one connect per screen");
        check(!burst.tick(new Object(), 680000, false), "an intervening kick still stops");
        Object abandoned = new Object();
        check(!burst.tick(abandoned, 681000, true), "another network failure can wait");
        check(!burst.tick(null, 800000, false), "closing the disconnect screen cancels the pending retry");
        check(!burst.tick(abandoned, 801000, true), "cancelled timer cannot fire immediately");
        burst.block();
        check(!burst.tick(abandoned, 1000000, true), "auth block overrides slow reconnect");
        List<String> markers = List.of("AUTH_SERVICE_WARMING");
        String warming = "Login service preparing, please retry. [AUTH_SERVICE_WARMING]";
        check(ReconnectSession.isServiceUnavailable("connect.failed", warming, markers), "explicit service marker after login-preparing reason");
        check(ReconnectSession.isServiceUnavailable("disconnect.lost", "[AUTH_SERVICE_WARMING] unavailable", markers), "explicit marker at reason start");
        check(!ReconnectSession.isServiceUnavailable("chat.type.text", warming, markers), "chat cannot authorize reconnect");
        check(!ReconnectSession.isServiceUnavailable("connect.failed", warming, List.of()), "service recovery disabled by default");
        check(!ReconnectSession.isServiceUnavailable("connect.failed", "Wrong password", markers), "password failure remains bounded");
        check(!ReconnectSession.isServiceUnavailable("connect.failed", "Banned", markers), "ban remains bounded");
        check(!ReconnectSession.isServiceUnavailable("connect.failed", "try again", markers), "generic retry prose is not a contract");
        check(!ReconnectSession.isServiceUnavailable("connect.failed", warming, List.of("*", "", "AUTH_SERVICE")), "no wildcard or partial marker matching");
        check(!ReconnectSession.isServiceUnavailable("connect.failed", "[AUTH_SERVICE_WARMING_EXTRA]", markers), "longer protocol code does not match");
        ReconnectSession service = new ReconnectSession();service.arm();long serviceTime=0;
        for(long delay:delays){Object attempt=new Object();service.tick(attempt,serviceTime);serviceTime+=delay;check(service.tick(attempt,serviceTime++),"consume ordinary service retry");}
        Object waiting = new Object();boolean permitted=ReconnectSession.isServiceUnavailable("connect.failed",warming,markers);
        check(!service.tick(waiting,serviceTime,permitted), "service-not-ready keeps a slow retry scheduled");
        check(!service.tick(waiting,serviceTime+119999,permitted), "service retry does not spin");
        check(service.tick(waiting,serviceTime+120000,permitted), "service recovery continues after original four attempts");
        check(!service.tick(new Object(),serviceTime+240000,false), "unrecognized rejection stops continued service retries");
        service.block();check(!service.tick(new Object(),serviceTime+360000,permitted), "authentication block dominates service readiness");
        System.out.println("ReconnectSession: " + checks + " checks passed; bounded retries require stable authorization");
    }
}
