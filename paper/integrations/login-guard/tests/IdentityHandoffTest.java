package org.afuhome.auth;

import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.afuhome.identity.IdentityHandoff;
import org.afuhome.identity.PlatformIdentity;

public final class IdentityHandoffTest {
    public static void main(String[] args) throws Exception {
        var link = new PlatformIdentity("OfficialQA", UUID.randomUUID(), ".ConsoleQA", new UUID(0, 176));
        byte[] key = new byte[32];
        Arrays.fill(key, (byte) 27);
        var proxy = new IdentityHandoff(key, link);
        var backend = new IdentityHandoff(key, link);
        long now = 1_000_000;
        String forgeHost = "localhost\0FML3\0";
        String ticket = proxy.signHostname(forgeHost, now);
        check(ticket.endsWith("." + forgeHost), "original handshake content preserved");
        check(backend.consumeHostname(ticket + ":25565", now + 50), "one authentic handoff survives the real hostname format");
        check(!backend.consumeHostname(ticket, now + 51), "replayed authenticator refused");
        check(!backend.consumeHostname(proxy.signHostname("localhost", now), now + 20_000), "expired authenticator refused");
        check(!backend.consumeHostname(proxy.signHostname("localhost", now + 2_000), now), "future authenticator refused");
        String last = proxy.signHostname("localhost", now);
        check(!backend.consumeHostname(last.substring(0, 23) + "%" + last.substring(24), now), "invalid base64 refused");
        check(!backend.consumeHostname(last.substring(0, 23) + (last.charAt(23) == 'A' ? 'B' : 'A') + last.substring(24), now), "tampering refused");
        check(!new IdentityHandoff(new byte[32], link).consumeHostname(last, now), "wrong secret refused");
        check(!new IdentityHandoff(key, new PlatformIdentity("OfficialQA", UUID.randomUUID(), ".ConsoleQA", link.bedrockUuid()))
            .consumeHostname(last, now), "wrong Microsoft identity refused");
        check(!new IdentityHandoff(key, new PlatformIdentity("OfficialQA", link.premiumUuid(), ".ConsoleQA", new UUID(0, 177)))
            .consumeHostname(last, now), "wrong Floodgate UUID refused");
        try (var executor = Executors.newFixedThreadPool(8)) {
            var tasks = java.util.stream.IntStream.range(0, 24)
                .<Callable<Boolean>>mapToObj(i -> () -> backend.consumeHostname(last, now + i)).toList();
            int accepted = 0;
            for (var result : executor.invokeAll(tasks)) if (result.get()) accepted++;
            check(accepted == 1, "parallel replay cannot acquire another authorization");
        }
        System.out.println("PASS 11 verified identity handoff, expiry and replay checks");
    }

    private static void check(boolean condition, String wording) {
        if (!condition) throw new AssertionError(wording);
    }
}
