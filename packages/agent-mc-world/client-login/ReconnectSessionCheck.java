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
        retry.block();
        check(!retry.tick(new Object(), 100000), "authentication failure stops reconnection");
        retry.arm();
        Object manual = new Object();
        retry.tick(manual, 1000);
        retry.tick(null, 2000);
        check(!retry.tick(null, 100000), "leaving disconnect screen cancels scheduled retry");
        retry.online();
        check(retry.attempts() == 0, "online resets backoff");
        Object recovery = new Object();
        check(!retry.tick(recovery, 200000), "new disconnect can retry");
        check(retry.tick(recovery, 203000), "new disconnect resets delay");
        System.out.println("ReconnectSession: " + checks + " checks passed");
    }
}
