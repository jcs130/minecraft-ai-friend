package org.afuhome.auth;

import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.nio.file.Path;
import java.util.Properties;
import java.util.UUID;

import com.velocitypowered.api.event.player.GameProfileRequestEvent;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.proxy.VelocityServer;
import com.velocitypowered.proxy.connection.MinecraftConnection;
import com.velocitypowered.proxy.connection.backend.VelocityServerConnection;
import com.velocitypowered.proxy.connection.client.ConnectedPlayer;
import com.velocitypowered.proxy.connection.client.LoginInboundConnection;
import com.velocitypowered.proxy.network.ConnectionManager;
import com.velocitypowered.proxy.protocol.packet.HandshakePacket;
import io.netty.channel.Channel;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.ChannelOutboundHandlerAdapter;
import io.netty.channel.ChannelPromise;
import io.netty.util.AttributeKey;
import org.afuhome.identity.IdentityHandoff;
import org.afuhome.identity.PlatformIdentity;

/** Preserves LibreLogin's UUID and carries the official proof only to the local game server. */
final class VerifiedJavaIdentity {
    private static final AttributeKey<UUID> OFFICIAL_PROFILE = AttributeKey.valueOf("qiandengji-official-identity");
    private final PlatformIdentity link;
    private final IdentityHandoff handoff;
    private final Method loginConnection;

    private VerifiedJavaIdentity(PlatformIdentity link, IdentityHandoff handoff) throws ReflectiveOperationException {
        this.link = link;
        this.handoff = handoff;
        // Velocity's player and profile event refer to the same MinecraftConnection.
        // Keep the proof on that channel so address or connection reuse cannot inherit it.
        loginConnection = LoginInboundConnection.class.getDeclaredMethod("delegatedConnection");
        loginConnection.setAccessible(true);
    }

    static VerifiedJavaIdentity load(ProxyServer server, Properties config) throws Exception {
        String file = config.getProperty("identity.link");
        String key = config.getProperty("identity.key-file");
        if (file == null && key == null) return null;
        PlatformIdentity link = PlatformIdentity.read(Path.of(file));
        InetSocketAddress target = server.getServer("paper").orElseThrow().getServerInfo().getAddress();
        if (target.getAddress() == null || !target.getAddress().isLoopbackAddress()) {
            throw new IllegalArgumentException("The identity handoff requires a loopback game server");
        }
        var identity = new VerifiedJavaIdentity(link, IdentityHandoff.read(Path.of(key), link));
        identity.install(server);
        return identity;
    }

    String javaName() {
        return link.javaName();
    }

    boolean isJavaName(String name) {
        return link.isJavaName(name);
    }

    boolean isBedrockOperator(String name, String uuid) {
        return link.isBedrockName(name) && link.bedrockUuid().toString().equalsIgnoreCase(uuid);
    }

    boolean matchesLoginRecord(UUID storage, UUID premium) {
        return link.javaStorageUuid().equals(storage) && link.premiumUuid().equals(premium);
    }

    void capture(GameProfileRequestEvent event) {
        if (!event.isOnlineMode() || event.getOriginalProfile() == null
                || !link.javaName().equals(event.getOriginalProfile().getName())
                || !link.premiumUuid().equals(event.getOriginalProfile().getId())
                || !(event.getConnection() instanceof LoginInboundConnection connection)) return;
        try {
            var transport = (MinecraftConnection) loginConnection.invoke(connection);
            transport.getChannel().attr(OFFICIAL_PROFILE).set(event.getOriginalProfile().getId());
        } catch (ReflectiveOperationException failure) {
            throw new IllegalStateException("Cannot attach verified Java proof", failure);
        }
    }

    boolean verified(Player player) {
        return player instanceof ConnectedPlayer connected && player.isOnlineMode()
            && link.javaName().equals(player.getUsername())
            && matchesLoginRecord(player.getUniqueId(), connected.getConnection().getChannel().attr(OFFICIAL_PROFILE).get());
    }

    private void install(ProxyServer proxy) throws ReflectiveOperationException {
        // This private Velocity field is validated against the pinned runtime in build.py.
        var managerField = VelocityServer.class.getDeclaredField("cm");
        managerField.setAccessible(true);
        var manager = (ConnectionManager) managerField.get(proxy);
        var holder = manager.getBackendChannelInitializer();
        var previous = holder.get();
        holder.set(new ChannelInitializer<Channel>() {
            @Override protected void initChannel(Channel channel) {
                channel.pipeline().addLast(previous);
                channel.pipeline().addLast("qiandengji-identity-handoff", outbound());
            }
        });
    }

    private ChannelOutboundHandlerAdapter outbound() {
        return new ChannelOutboundHandlerAdapter() {
            @Override public void write(ChannelHandlerContext context, Object message, ChannelPromise promise) throws Exception {
                if (!(message instanceof HandshakePacket handshake)) {
                    super.write(context, message, promise);
                    return;
                }
                var transport = context.pipeline().get(MinecraftConnection.class);
                if (transport != null && transport.getAssociation() instanceof VelocityServerConnection backend
                        && backend.getServerInfo().getName().equals("paper") && link.isJavaName(backend.getPlayer().getUsername())) {
                    if (!verified(backend.getPlayer()) || !isLoopback(context.channel())) {
                        backend.getPlayer().disconnect(net.kyori.adventure.text.Component.text("连接的正版身份未通过校验。[MC_AUTH_LINK_REQUIRED]"));
                        promise.tryFailure(new IllegalStateException("Unverified identity handoff"));
                        context.close();
                        return;
                    }
                    handshake.setServerAddress(handoff.signHostname(handshake.getServerAddress(), System.currentTimeMillis()));
                }
                super.write(context, message, promise);
            }
        };
    }

    private static boolean isLoopback(Channel channel) {
        return channel.remoteAddress() instanceof InetSocketAddress remote
            && remote.getAddress() != null && remote.getAddress().isLoopbackAddress();
    }
}
