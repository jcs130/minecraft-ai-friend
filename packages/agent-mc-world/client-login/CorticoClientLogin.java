package org.cortico.minecraft;

import com.google.gson.Gson;
import com.sun.jna.Platform;
import com.sun.jna.platform.win32.Crypt32Util;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.minecraft.class_310;
import net.minecraft.class_642;
import net.minecraft.class_412;
import net.minecraft.class_419;
import net.minecraft.class_639;

/** Submits a scoped private credential only after the server requests login. */
public final class CorticoClientLogin implements ClientModInitializer {
    private record Account(String server, String username, String credentialFile, String command,
                           List<String> requestMarkers, List<String> successMarkers, List<String> failureMarkers,
                           boolean reconnect) {}
    private record Config(boolean enabled, List<Account> accounts) {}
    private LoginSession session;
    private Account account;
    private class_310 client;
    private final LoginSession.ConnectionScope connection = new LoginSession.ConnectionScope();
    private final ReconnectSession reconnect = new ReconnectSession();
    private class_642 reconnectServer;

    @Override
    public void onInitializeClient() {
        ClientPlayConnectionEvents.JOIN.register((handler, sender, current) -> {
            if (!connection.join(handler.method_48296())) return;
            client = current;
            account = null;
            session = null;
            reconnectServer = null;
            reconnect.block();
            class_642 server = current.method_1558();
            if (server == null) return;
            try {
                Path configFile = FabricLoader.getInstance().getConfigDir().resolve("cortico-client-login.json");
                if (!Files.isRegularFile(configFile)) return;
                Config config = new Gson().fromJson(Files.readString(configFile), Config.class);
                if (config == null || !config.enabled || config.accounts == null) return;
                for (Account entry : config.accounts) {
                    if (entry == null || entry.server == null || entry.username == null
                            || !LoginSession.matchesAccount(entry.server, entry.username,
                                server.field_3761, current.method_1548().method_1676())) continue;
                    if (account != null) throw new IllegalArgumentException("Duplicate matching accounts");
                    if (entry.credentialFile == null || entry.command == null || entry.requestMarkers == null
                            || entry.successMarkers == null || entry.failureMarkers == null)
                        throw new IllegalArgumentException("Incomplete account configuration");
                    account = entry;
                }
                if (account != null) {
                    session = new LoginSession(account.requestMarkers, account.successMarkers, account.failureMarkers);
                    reconnectServer = account.reconnect ? server : null;
                    if (account.reconnect) reconnect.arm(); else reconnect.block();
                    System.out.println("[CorticoClientLogin] Armed for " + account.username + " at " + account.server);
                }
            } catch (Exception error) {
                account = null;
                session = null;
                reconnectServer = null;
                reconnect.block();
                System.out.println("[CorticoClientLogin] Configuration unavailable; no credential submitted ("
                    + error.getClass().getSimpleName() + ")");
            }
        });
        ClientPlayConnectionEvents.DISCONNECT.register((handler, current) -> {
            if (!connection.disconnect(handler.method_48296())) return;
            session = null;
            account = null;
            client = null;
        });
        ClientReceiveMessageEvents.ALLOW_GAME.register((message, overlay) -> {
            if (session == null || account == null || client == null) return true;
            LoginSession.Result result = session.observe(message.getString());
            if (result == LoginSession.Result.CONFIRMED)
                System.out.println("[CorticoClientLogin] Server confirmed login for " + account.username);
            else if (result == LoginSession.Result.BLOCKED) {
                reconnect.block();
                System.out.println("[CorticoClientLogin] Authentication requires intervention; no retry");
            }
            else if (result == LoginSession.Result.SUBMIT) {
                Account selected = account;
                class_310 current = client;
                long generation = connection.generation();
                current.execute(() -> submit(selected, current, generation));
            }
            return true;
        });
        ClientTickEvents.END_CLIENT_TICK.register(current -> {
            if (current.method_1562() != null) { reconnect.online(); return; }
            if (!reconnect.tick(current.field_1755 instanceof class_419 ? current.field_1755 : null,
                    System.nanoTime() / 1_000_000)) return;
            class_642 target = reconnectServer;
            if (target == null) { reconnect.block(); return; }
            try {
                Path configFile = FabricLoader.getInstance().getConfigDir().resolve("cortico-client-login.json");
                Config config = new Gson().fromJson(Files.readString(configFile), Config.class);
                boolean allowed = config != null && config.enabled && config.accounts != null
                    && config.accounts.stream().anyMatch(entry -> entry != null && entry.reconnect
                        && entry.server != null && entry.username != null
                        && LoginSession.matchesAccount(entry.server, entry.username, target.field_3761,
                            current.method_1548().method_1676()));
                if (!allowed) { reconnect.block(); return; }
                System.out.println("[CorticoClientLogin] Reconnecting configured account, attempt " + reconnect.attempts());
                // A non-null cookie storage marks the 1.20.6 handshake as TRANSFER.
                // This is a fresh reconnect to the configured server, not a server-directed transfer.
                class_412.method_36877(current.field_1755, current, class_639.method_2950(target.field_3761),
                    target, false, null);
            } catch (Exception error) {
                reconnect.block();
                System.out.println("[CorticoClientLogin] Reconnect configuration unavailable; no retry");
            }
        });
        System.out.println("[CorticoClientLogin] Active; login commands and credentials are never logged");
    }

    private void submit(Account selected, class_310 current, long generation) {
        if (generation != connection.generation() || client != current || account != selected || current.method_1562() == null) return;
        byte[] plain = null;
        try {
            if (!Platform.isWindows()) throw new IllegalStateException("Windows user credential required");
            byte[] cipher = Files.readAllBytes(Path.of(selected.credentialFile));
            if (cipher.length < 1 || cipher.length > 16384) throw new IllegalArgumentException("Credential size");
            plain = Crypt32Util.cryptUnprotectData(cipher);
            String command = LoginSession.command(selected.command, new String(plain, StandardCharsets.UTF_8));
            current.method_1562().method_45730(command);
            System.out.println("[CorticoClientLogin] Submitted one login command for " + selected.username
                + "; waiting for server confirmation");
        } catch (Exception error) {
            reconnect.block();
            System.out.println("[CorticoClientLogin] Login not submitted; no retry (" + error.getClass().getSimpleName() + ")");
        } finally {
            if (plain != null) Arrays.fill(plain, (byte) 0);
        }
    }
}
