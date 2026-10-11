package dev.qiandeng.maw.numenserver;

import com.dwinovo.numen.entity.CompanionRegistry;
import com.dwinovo.numen.entity.NumenPlayer;
import net.minecraft.network.Connection;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.fml.ModList;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;

/** Only actual server-created, persisted Numen entities have a trusted body context. */
final class HeadlessAuth {
    private HeadlessAuth() {}

    @SuppressWarnings({"unchecked", "rawtypes"})
    static void join(PlayerEvent.PlayerLoggedInEvent event) {
        if (!ModList.get().isLoaded("mixauth") || !(event.getEntity() instanceof NumenPlayer body)) return;
        var entry = CompanionRegistry.get(body.getServer()).find(body.getUUID());
        if (entry == null || !entry.owner().equals(body.getOwnerUuid()) ||
                !entry.name().equals(body.getGameProfile().getName())) {
            body.connection.disconnect(Component.literal("Numen body identity is not registered"));
            return;
        }
        try {
            Class mode = Class.forName("io.github.truscdo.mixauth.online.OnlineAuthService$LoginMode");
            Class<?> context = Class.forName("io.github.truscdo.mixauth.login.LoginContext");
            Object trusted = context.getConstructor(mode, java.util.UUID.class, java.util.UUID.class, String.class, long.class)
                    .newInstance(Enum.valueOf(mode, "ONLINE"), body.getUUID(), body.getUUID(), body.getGameProfile().getName(), System.currentTimeMillis());
            Object accepted = Class.forName("io.github.truscdo.mixauth.login.LoginContexts")
                    .getMethod("publish", Connection.class, context).invoke(null, body.connection.getConnection(), trusted);
            if (!Boolean.TRUE.equals(accepted)) throw new IllegalStateException("existing_login_context");
        } catch (ReflectiveOperationException | RuntimeException failed) {
            body.connection.disconnect(Component.literal("Numen authentication integration unavailable"));
        }
    }

    static void requireAuthenticated(ServerPlayer player) {
        if (!ModList.get().isLoaded("mixauth")) return;
        try {
            Object pending = Class.forName("io.github.truscdo.mixauth.offline.OfflineAuthSessionService")
                    .getMethod("getPendingAuth", ServerPlayer.class).invoke(null, player);
            if (pending != null) throw new IllegalArgumentException("authentication_required");
        } catch (ReflectiveOperationException unavailable) {
            throw new IllegalArgumentException("authentication_unavailable");
        }
    }
}
