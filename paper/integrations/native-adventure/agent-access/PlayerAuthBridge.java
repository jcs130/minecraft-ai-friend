package dev.qiandeng.maw.taunative;

import java.nio.file.Files;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;

/** Adapter for the existing authority; QA fallback is restricted to an owned loopback lab. */
final class PlayerAuthBridge {
    private static final Set<UUID> JOINING = new HashSet<>();
    static void register() {
        NeoForge.EVENT_BUS.addListener(EventPriority.HIGHEST, (PlayerEvent.PlayerLoggedInEvent e) -> JOINING.add(e.getEntity().getUUID()));
        NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, (PlayerEvent.PlayerLoggedInEvent e) -> JOINING.remove(e.getEntity().getUUID()));
        NeoForge.EVENT_BUS.addListener((PlayerEvent.PlayerLoggedOutEvent e) -> JOINING.remove(e.getEntity().getUUID()));
    }
    static boolean authenticated(ServerPlayer p) {
        var s = p.getServer();
        if (s == null) return false;
        boolean present = net.neoforged.fml.ModList.get().isLoaded("mixauth"), authorized = false;
        if (present) {
            try {
                authorized = Class.forName("io.github.truscdo.mixauth.offline.OfflineAuthSessionService")
                    .getMethod("getPendingAuth", ServerPlayer.class).invoke(null, p) == null;
            } catch (ReflectiveOperationException | RuntimeException unavailable) { authorized = false; }
        }
        return SessionPolicy.allowed(p.connection != null && s.getPlayerList().getPlayer(p.getUUID()) == p,
            JOINING.contains(p.getUUID()), present, authorized, s.usesAuthentication(),
            Boolean.getBoolean("qiandeng.native.qa"), Files.isRegularFile(s.getServerDirectory().resolve(".twilight-lootr-qa")),
            "127.0.0.1".equals(s.getLocalIp()) && s.getPort() == 39761,
            s.getPlayerList().isUsingWhitelist(), s.getPlayerList().isWhiteListed(p.getGameProfile()));
    }
}
