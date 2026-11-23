package local.hosting;

/** Visible on the transformed game PlayerList so witnesses cannot silently use an older bridge. */
public interface HostedPlayerLoginFence {
    boolean qdj$admitsNumen(com.mojang.authlib.GameProfile profile, java.util.UUID nativeOwner);
    boolean qdj$acceptsNumenGameplay(net.minecraft.server.level.ServerPlayer original);
}
