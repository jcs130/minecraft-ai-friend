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
        System.out.println("LoginSessionCheck: 28 authentication checks passed");
    }
}
