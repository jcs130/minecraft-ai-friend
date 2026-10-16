import java.util.List;
import org.cortico.minecraft.LoginSession;
import org.cortico.minecraft.LoginSession.Result;

public final class LoginSessionCheck {
    private static void check(boolean ok, String message) {
        if (!ok) throw new AssertionError(message);
    }
    private static LoginSession session() {
        return new LoginSession(List.of("AUTH_LOGIN"), List.of("AUTH_SUCCESS"), List.of("AUTH_FAILED", "AUTH_2FA"));
    }
    public static void main(String[] args) {
        LoginSession first = session();
        check(first.observe("<player> AUTH_LOGIN") == Result.IGNORE, "player quote ignored");
        check(first.observe("§a[AUTH_LOGIN] use login") == Result.SUBMIT, "formatted request submitted");
        check(first.observe("[AUTH_LOGIN] use login") == Result.IGNORE, "duplicate prompt ignored");
        check(first.observe("AUTH_SUCCESS: entered") == Result.CONFIRMED, "explicit server confirmation");
        check(first.observe("AUTH_LOGIN: again") == Result.IGNORE, "no submission after confirmation");
        LoginSession second = session();
        check(second.observe("AUTH_LOGIN") == Result.SUBMIT, "new connection independent");
        check(second.observe("AUTH_FAILED") == Result.BLOCKED, "bad password stops");
        check(second.observe("AUTH_LOGIN") == Result.IGNORE, "failure never retries");
        LoginSession twoFactor = session();
        check(twoFactor.observe("[AUTH_2FA] enter code") == Result.BLOCKED, "two factor requires intervention");
        check(twoFactor.observe("AUTH_LOGIN") == Result.IGNORE, "two factor never bypassed");
        LoginSession already = session();
        check(already.observe("AUTH_SUCCESS") == Result.CONFIRMED, "server can confirm existing login");
        check(LoginSession.matchesAccount("EXAMPLE.test", "Camera", "example.test:25565", "Camera"), "default port and hostname case");
        check(!LoginSession.matchesAccount("example.test:25565", "Camera", "example.test:25566", "Camera"), "different port rejected");
        check(!LoginSession.matchesAccount("example.test", "Camera", "other.test", "Camera"), "different host rejected");
        check(!LoginSession.matchesAccount("example.test", "Camera", "example.test", "Player"), "different account rejected");
        check(LoginSession.command("login", "sample-secret").equals("login sample-secret"), "command formatting");
        try { LoginSession.command("login", "secret\nother"); throw new AssertionError("newline allowed"); }
        catch (IllegalArgumentException expected) {}
        try { LoginSession.command("login other", "secret"); throw new AssertionError("command injection allowed"); }
        catch (IllegalArgumentException expected) {}
        LoginSession.ConnectionScope scope = new LoginSession.ConnectionScope();
        Object transport = new Object();
        Object other = new Object();
        check(scope.join(transport), "first connection arms login");
        long generation = scope.generation();
        check(!scope.join(transport), "repeated join packet preserves authentication state");
        check(scope.generation() == generation, "repeated join preserves queued command generation");
        check(!scope.disconnect(other), "unrelated disconnect ignored");
        check(scope.generation() == generation, "unrelated disconnect does not cancel current login");
        check(scope.disconnect(transport), "current disconnect disarms login");
        check(scope.generation() != generation, "disconnect invalidates queued credential submission");
        check(scope.join(transport), "reconnect can arm a new login attempt");
        check(scope.join(other), "new transport starts a separate authentication session");
        check(!scope.disconnect(transport), "late old disconnect cannot disarm new connection");
        LoginSession renewable = new LoginSession(List.of("AUTH_LOGIN"), List.of("AUTH_SUCCESS"),
            List.of("AUTH_FAILED", "AUTH_2FA"), List.of("AUTH_EXPIRED"));
        check(renewable.observe("AUTH_EXPIRED", 0) == Result.IGNORE, "renewal requires previous confirmed login");
        check(renewable.observe("AUTH_LOGIN", 1) == Result.SUBMIT, "initial login remains scoped");
        check(renewable.observe("AUTH_SUCCESS", 2) == Result.CONFIRMED, "initial authentication confirmed");
        check(renewable.observe("<player> [AUTH_EXPIRED]", 3) == Result.IGNORE, "quoted expiry ignored");
        check(renewable.observe("AUTH_LOGIN", 4) == Result.IGNORE, "ordinary prompt cannot reset confirmed state");
        check(renewable.observe("§e[AUTH_EXPIRED] login required", 5) == Result.SUBMIT, "explicit expiry renews once");
        check(renewable.observe("AUTH_EXPIRED", 6) == Result.IGNORE, "repeated expiry cannot resubmit while pending");
        check(renewable.observe("AUTH_LOGIN", 7) == Result.IGNORE, "pending renewal cannot resubmit password");
        check(renewable.observe("AUTH_SUCCESS", 8) == Result.CONFIRMED, "renewal must be confirmed");
        check(renewable.observe("AUTH_EXPIRED", 30_005) == Result.SUBMIT, "later independent expiry can renew");
        check(renewable.observe("AUTH_SUCCESS", 30_006) == Result.CONFIRMED, "second renewal confirmed");
        check(renewable.observe("AUTH_EXPIRED", 30_007) == Result.BLOCKED, "rapid confirmed-expiry loop stops");
        check(renewable.observe("AUTH_EXPIRED", 90_000) == Result.IGNORE, "blocked renewal does not retry later");
        LoginSession failedRenewal = new LoginSession(List.of("AUTH_LOGIN"), List.of("AUTH_SUCCESS"),
            List.of("AUTH_FAILED"), List.of("AUTH_EXPIRED"));
        check(failedRenewal.observe("AUTH_SUCCESS", 0) == Result.CONFIRMED, "existing authenticated connection can arm renewal");
        check(failedRenewal.observe("AUTH_EXPIRED", 1) == Result.SUBMIT, "confirmed connection renewal submitted");
        check(failedRenewal.observe("AUTH_FAILED", 2) == Result.BLOCKED, "renewal password failure stops");
        check(failedRenewal.observe("AUTH_LOGIN", 3) == Result.IGNORE, "failed renewal never resubmits");
        System.out.println("LoginSessionCheck: 45 authentication checks passed");
    }
}
