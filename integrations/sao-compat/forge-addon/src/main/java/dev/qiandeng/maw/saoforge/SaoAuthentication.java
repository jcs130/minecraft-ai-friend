package dev.qiandeng.maw.saoforge;

import net.minecraft.server.level.ServerPlayer;

/** Optional native auth integration. Public deployments require the pinned mod. */
public final class SaoAuthentication {
    public static com.google.gson.JsonObject status(ServerPlayer player) {
        var out = new com.google.gson.JsonObject();
        boolean required = net.minecraftforge.fml.ModList.get().isLoaded("directauth");
        out.addProperty("provider", required ? "directauth" : "none");
        out.addProperty("required", required);
        out.addProperty("authenticated", loggedIn(player));
        return out;
    }
    public static boolean loggedIn(ServerPlayer player) {
        if (player.getServer() == null || player.getServer().getPlayerList().getPlayer(player.getUUID()) != player) return false;
        if (player instanceof net.minecraftforge.common.util.FakePlayer) return true;
        if (!net.minecraftforge.fml.ModList.get().isLoaded("directauth")) return true;
        try {
            Class<?> entry = Class.forName("com.marcp.directauth.DirectAuth");
            Object manager = entry.getMethod("getLoginManager").invoke(null);
            return manager != null && Boolean.TRUE.equals(manager.getClass().getMethod("isAuthenticated", ServerPlayer.class).invoke(manager, player));
        } catch (ReflectiveOperationException | LinkageError failure) { return false; }
    }
    private SaoAuthentication() {}
}
