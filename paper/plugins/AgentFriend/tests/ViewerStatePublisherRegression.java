package org.afuhome.agentfriend;

import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.Server;
import org.bukkit.entity.Player;
import org.bukkit.plugin.messaging.Messenger;

/** Standalone regression checks; no Minecraft server or client is started. */
public final class ViewerStatePublisherRegression {
    public static void main(String[] args) throws Exception {
        ViewerStatePublisher publisher = new ViewerStatePublisher(null, null, null, null);
        Method localizedName = method("localizedName", String.class, String.class, Supplier.class);
        AtomicInteger resolutions = new AtomicInteger();
        Supplier<String> resolve = () -> {
            resolutions.incrementAndGet();
            return "§a技能";
        };
        // Simulate 14 players, 13 skills and 10,000 HUD polls. Localization must
        // scale with registry entries, not with players or elapsed server time.
        for (int poll = 0; poll < 10_000; poll++) {
            for (int player = 0; player < 14; player++) {
                for (int skill = 0; skill < 13; skill++) {
                    String label = (String) localizedName.invoke(publisher, "skill", "test:skill" + skill, resolve);
                    check(label.equals("技能"), "localized label changed");
                }
            }
        }
        check(resolutions.get() == 13, "HUD polls repeated localization: " + resolutions);
        localizedName.invoke(publisher, "mana-ability", "test:skill0", resolve);
        localizedName.invoke(publisher, "ability", "test:skill0", resolve);
        check(resolutions.get() == 15, "skill and ability IDs share a cache entry");
        var cacheField = ViewerStatePublisher.class.getDeclaredField("localizedNames");
        cacheField.setAccessible(true);
        Map<?, ?> cache = (Map<?, ?>) cacheField.get(publisher);
        check(cache.size() == 15, "localized-name cache grew with HUD polls");

        // An unsubscribed vanilla/Agent connection must return before consulting
        // AuraSkills or constructing state. The null dependencies make either
        // action fail if the subscription guard is absent.
        Method publish = method("publish", Player.class, boolean.class);
        publish.invoke(publisher, player(Set.of()), false);
        publish.invoke(publisher, player(Set.of("mcagent:state")), true);
        Method legacy = method("usesLegacyChannel", Player.class);
        check((boolean) legacy.invoke(publisher, player(Set.of(ViewerStatePublisher.LEGACY_CHANNEL))),
                "old-only subscriber lost compatibility route");
        check(!(boolean) legacy.invoke(publisher, player(Set.of(ViewerStatePublisher.CHANNEL))),
                "generic subscriber received a legacy duplicate");
        check(!(boolean) legacy.invoke(publisher, player(Set.of(ViewerStatePublisher.CHANNEL,
                ViewerStatePublisher.LEGACY_CHANNEL))), "dual subscriber received a legacy duplicate");

        // Exercise actual stop cleanup with an in-process Bukkit API stub.
        Messenger messenger = (Messenger) Proxy.newProxyInstance(Messenger.class.getClassLoader(),
                new Class<?>[] { Messenger.class }, (proxy, call, arguments) -> null);
        Server server = (Server) Proxy.newProxyInstance(Server.class.getClassLoader(),
                new Class<?>[] { Server.class }, (proxy, call, arguments) -> switch (call.getName()) {
                    case "getMessenger" -> messenger;
                    case "getLogger" -> Logger.getLogger("ViewerStatePublisherRegression");
                    case "getName" -> "RegressionStub";
                    case "getVersion", "getBukkitVersion" -> "1.20.6-R0.1-SNAPSHOT";
                    default -> throw new AssertionError("Unexpected server access: " + call.getName());
                });
        // Bukkit.setServer also initializes Paper's real game-version service.
        // Set only this test JVM's API stub, keeping the server runtime dormant.
        var serverField = Bukkit.class.getDeclaredField("server");
        serverField.setAccessible(true);
        serverField.set(null, server);
        publisher.stop();
        check(cache.isEmpty(), "stop retained localized-name cache");
        System.out.println("PASS: 1,820,000 HUD label requests -> 13 resolutions; typed cache,"
                + " subscription guard, legacy routing and stop cleanup passed.");
    }

    private static Player player(Set<String> channels) {
        return (Player) Proxy.newProxyInstance(Player.class.getClassLoader(), new Class<?>[] { Player.class },
                (proxy, call, arguments) -> switch (call.getName()) {
                    case "isOnline" -> true;
                    case "getListeningPluginChannels" -> channels;
                    default -> throw new AssertionError("Unexpected player access: " + call.getName());
                });
    }

    private static Method method(String name, Class<?>... parameterTypes) throws Exception {
        Method method = ViewerStatePublisher.class.getDeclaredMethod(name, parameterTypes);
        method.setAccessible(true);
        return method;
    }

    private static void check(boolean valid, String message) {
        if (!valid) throw new AssertionError(message);
    }
}
