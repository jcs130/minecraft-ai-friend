package org.afuhome.identity.paper;

import net.kyori.adventure.text.Component;
import org.afuhome.identity.IdentityHandoff;
import org.afuhome.identity.PlatformIdentity;
import org.bukkit.Bukkit;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerPreLoginEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.geysermc.floodgate.api.FloodgateApi;

/** Validates both sign-in paths before the game loads the existing Bedrock player. */
public final class PlatformIdentityPlugin extends JavaPlugin implements Listener {
    private PlatformIdentity identity;
    private IdentityHandoff handoff;
    private volatile boolean playing;

    @Override public void onEnable() {
        try {
            var directory = getDataFolder().toPath();
            identity = PlatformIdentity.read(directory.resolve("link.properties"));
            playing = Bukkit.getPlayer(identity.bedrockUuid()) != null;
            handoff = IdentityHandoff.read(directory.resolve("handoff.key"), identity);
        } catch (Exception failure) {
            // Remain enabled to keep the managed identities locked if the key
            // cannot be read. No configured secrets or handshake hosts are logged.
            getLogger().severe("Platform identity unavailable: " + failure.getClass().getSimpleName());
        }
        getServer().getPluginManager().registerEvents(this, this);
        if (handoff != null) getLogger().info("Verified Java and Floodgate identity handoff ready");
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void authenticate(AsyncPlayerPreLoginEvent event) {
        if (identity == null || event.getLoginResult() != AsyncPlayerPreLoginEvent.Result.ALLOWED) return;
        if (identity.isJavaName(event.getName())) {
            acceptJava(event);
        } else if (identity.isBedrockName(event.getName()) || identity.bedrockUuid().equals(event.getUniqueId())) {
            acceptBedrock(event);
        }
    }

    private void acceptJava(AsyncPlayerPreLoginEvent event) {
        if (handoff == null || !identity.javaName().equals(event.getName())
                || !identity.javaStorageUuid().equals(event.getUniqueId())
                || event.getRawAddress() == null || !event.getRawAddress().isLoopbackAddress()
                || !handoff.consumeHostname(event.getHostname(), System.currentTimeMillis())) {
            deny(event);
            return;
        }
        if (alreadyPlaying(event)) return;
        // Make the profile canonical before LuckPerms and the server open any
        // player data. Preserve the Bedrock name used by WorldGuard and /home tools.
        var profile = Bukkit.createProfileExact(identity.bedrockUuid(), identity.bedrockName());
        profile.clearProperties();
        profile.setProperties(event.getPlayerProfile().getProperties());
        event.setPlayerProfile(profile);
    }

    private void acceptBedrock(AsyncPlayerPreLoginEvent event) {
        var api = FloodgateApi.getInstance();
        var player = api == null ? null : api.getPlayer(event.getUniqueId());
        if (player == null || player.isLinked() || !identity.bedrockName().equals(event.getName())
                || !identity.bedrockName().equals(player.getCorrectUsername())
                || !identity.bedrockUuid().equals(event.getUniqueId())
                || !identity.bedrockUuid().equals(player.getJavaUniqueId())) {
            deny(event);
            return;
        }
        alreadyPlaying(event);
    }

    private boolean alreadyPlaying(AsyncPlayerPreLoginEvent event) {
        if (!playing) return false;
        event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER,
            Component.text("这个角色已在线，请先退出另一台设备再切换。[MC_AUTH_LINK_IN_USE]"));
        return true;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void joined(PlayerJoinEvent event) {
        if (identity != null && identity.bedrockUuid().equals(event.getPlayer().getUniqueId())) playing = true;
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void quit(PlayerQuitEvent event) {
        if (identity != null && identity.bedrockUuid().equals(event.getPlayer().getUniqueId())) playing = false;
    }

    private static void deny(AsyncPlayerPreLoginEvent event) {
        event.disallow(AsyncPlayerPreLoginEvent.Result.KICK_OTHER,
            Component.text("此角色需要本人微软或 Xbox 账号验证，请重新登录。[MC_AUTH_LINK_REQUIRED]"));
    }
}
