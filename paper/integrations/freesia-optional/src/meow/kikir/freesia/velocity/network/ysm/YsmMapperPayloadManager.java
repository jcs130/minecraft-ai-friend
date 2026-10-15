/* SPDX-License-Identifier: MPL-2.0
 * Original: YesSteveModel/Freesia v2.5.1+2.4.1 (5ca1e0e).
 * Local changes: optional Worker failure isolation and reconnection, 2026-10-10.
 * Full modified source is provided here; see LICENSE and README.md.
 */
package meow.kikir.freesia.velocity.network.ysm;

import com.github.retrooper.packetevents.protocol.nbt.NBTCompound;
import com.github.retrooper.packetevents.protocol.nbt.NBTLimiter;
import com.github.retrooper.packetevents.protocol.nbt.serializer.DefaultNBTSerializer;
import com.google.common.collect.Maps;
import com.google.common.collect.Sets;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
import meow.kikir.freesia.velocity.FreesiaConstants;
import meow.kikir.freesia.velocity.Freesia;
import meow.kikir.freesia.velocity.FreesiaConfig;
import meow.kikir.freesia.velocity.YsmProtocolMetaFile;
import net.kyori.adventure.key.Key;
import net.kyori.adventure.text.Component;
import org.geysermc.mcprotocollib.auth.GameProfile;
import org.geysermc.mcprotocollib.network.BuiltinFlags;
import org.geysermc.mcprotocollib.network.tcp.TcpClientSession;
import org.geysermc.mcprotocollib.protocol.MinecraftProtocol;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.net.InetSocketAddress;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.locks.ReadWriteLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.function.Function;

public class YsmMapperPayloadManager {
    // Ysm channel key name
    public static final Key YSM_CHANNEL_KEY_ADVENTURE = Key.key(YsmProtocolMetaFile.getYsmChannelNamespace() + ":" + YsmProtocolMetaFile.getYsmChannelPath());
    public static final MinecraftChannelIdentifier YSM_CHANNEL_KEY_VELOCITY = MinecraftChannelIdentifier.create(YsmProtocolMetaFile.getYsmChannelNamespace(), YsmProtocolMetaFile.getYsmChannelPath());

    // Used for virtual players like NPCs
    private final Map<UUID, YsmPacketProxy> virtualProxies = Maps.newHashMap();
    private final Function<UUID, YsmPacketProxy> packetProxyCreatorVirtual;

    // Player to worker mappers connections
    private final Map<Player, MapperSessionProcessor> mapperSessions = Maps.newConcurrentMap();

    // Backend connect infos
    private final ReadWriteLock backendIpsAccessLock = new ReentrantReadWriteLock(false);
    private final Map<InetSocketAddress, Integer> backend2Players = Maps.newLinkedHashMap();
    private final Function<Player, YsmPacketProxy> packetProxyCreator;

    // The players who installed ysm(Used for packet sending reduction)
    private final Set<UUID> ysmInstalledPlayers = Sets.newConcurrentHashSet();
    private final Map<UUID, MapperSessionProcessor> observersResynced = Maps.newConcurrentMap();
    private final YsmPlayGate playGate = new YsmPlayGate();
    private final Set<MapperSessionProcessor> startedMappers = java.util.concurrent.ConcurrentHashMap.newKeySet();

    public void beginBackendChange(Player player, String backend) {
        this.playGate.begin(player.getUniqueId(), backend);
        this.backendEntityIds.remove(player.getUniqueId());
        this.unavailableMappers.remove(player.getUniqueId());
        this.observersResynced.remove(player.getUniqueId());
    }

    public long backendEpoch(Player player) { return this.playGate.epoch(player.getUniqueId()); }

    public boolean isPlayReady(Player player, long epoch) {
        return this.playGate.canSend(player.getUniqueId(), epoch) && this.clientIsPlaying(player);
    }

    public boolean acceptsWorkerPayload(MapperSessionProcessor processor) {
        final Player player = processor.getBindPlayer();
        return this.mapperSessions.get(player) == processor && this.isPlayReady(player, this.backendEpoch(player));
    }

    private boolean clientIsPlaying(Player player) {
        return player.isActive() && player instanceof com.velocitypowered.proxy.connection.client.ConnectedPlayer connected
                && connected.getConnection().getState() == com.velocitypowered.proxy.protocol.StateRegistry.PLAY;
    }

    /** Check again on the client's Netty event loop, at the actual write.
     * A Worker reply queued before a transfer must not be sent during CONFIG,
     * or replayed into a new world/session. Native YSM bytes remain unchanged. */
    public void sendWhenReady(Player target, YsmPacketProxy source, MinecraftChannelIdentifier channel, byte[] data) {
        if (!(target instanceof com.velocitypowered.proxy.connection.client.ConnectedPlayer connected)) return;
        final long epoch = this.playGate.epoch(target.getUniqueId());
        connected.getConnection().eventLoop().execute(() -> {
            if (!this.playGate.canSend(target.getUniqueId(), epoch) || !this.clientIsPlaying(target)) return;
            final Player owner = source.getOwner();
            if (owner != null) {
                final MapperSessionProcessor current = this.mapperSessions.get(owner);
                if (current == null || current.getPacketProxy() != source) return;
            }
            target.sendPluginMessage(channel, data);
        });
    }

    public YsmMapperPayloadManager(Function<Player, YsmPacketProxy> packetProxyCreator, Function<UUID, YsmPacketProxy> packetProxyCreatorVirtual) {
        this.packetProxyCreator = packetProxyCreator;
        this.packetProxyCreatorVirtual = packetProxyCreatorVirtual;
        this.backend2Players.put(FreesiaConfig.workerMSessionAddress, 1); //TODO Load balance
    }

    public void onClientYsmHandshakePacketReply(@NotNull Player target) {
        this.ysmInstalledPlayers.add(target.getUniqueId());
    }

    public void onClientModelCacheInitialized(@NotNull MapperSessionProcessor observer) {
        final Player target = observer.getBindPlayer();
        final long epoch = this.backendEpoch(target);
        if (this.mapperSessions.get(target) != observer || !this.isPlayerInstalledYsm(target)
                || !this.isPlayReady(target, epoch)
                || this.observersResynced.put(target.getUniqueId(), observer) == observer) return;

        // Initial entity tracking usually precedes the native client's handshake.
        // Its callbacks were skipped while the observer was not YSM-capable.
        // Replay once after forwarding the Worker's actual cache initialization,
        // retaining the existing native state encoding and final PLAY checks.
        Freesia.PROXY_SERVER.getScheduler().buildTask(Freesia.INSTANCE, () -> {
            if (this.mapperSessions.get(target) != observer || !this.isPlayReady(target, epoch)
                    || !this.isPlayerInstalledYsm(target) || target.getCurrentServer().isEmpty()) return;
            final var backend = target.getCurrentServer().get().getServerInfo();
            for (final var entry : this.mapperSessions.entrySet()) {
                final Player owner = entry.getKey();
                if (owner == target || owner.getCurrentServer().isEmpty()
                        || !backend.equals(owner.getCurrentServer().get().getServerInfo())
                        || !this.acceptsWorkerPayload(entry.getValue())) continue;
                this.onRealPlayerTrackerUpdate(owner, target);
            }
        }).schedule();
    }

    public void updateWorkerPlayerEntityId(Player target, int entityId){
        final MapperSessionProcessor mapper = this.mapperSessions.get(target);

        if (mapper == null) {
            return;
        }

        mapper.getPacketProxy().setPlayerWorkerEntityId(entityId);
    }

    public void updateRealPlayerEntityId(Player target, int entityId){
        this.backendEntityIds.put(target.getUniqueId(), entityId);
        final MapperSessionProcessor mapper = this.mapperSessions.get(target);

        if (mapper == null) {
            return;
        }

        mapper.getPacketProxy().setPlayerEntityId(entityId);
    }

    public CompletableFuture<Boolean> setVirtualPlayerEntityState(UUID playerUUID, NBTCompound nbt) {
        final YsmPacketProxy virtualProxy;

        synchronized (this.virtualProxies) {
            virtualProxy = this.virtualProxies.get(playerUUID);
        }

        if (virtualProxy == null) {
            return CompletableFuture.completedFuture(false);
        }

        virtualProxy.setEntityDataRaw(nbt);
        virtualProxy.notifyFullTrackerUpdates();

        final NBTCompound entityData = virtualProxy.getCurrentEntityState();

        //Probably be reset
        if (entityData == null) {
            return CompletableFuture.completedFuture(true);
        }

        // Async io
        final CompletableFuture<Boolean> callback = new CompletableFuture<>();

        Freesia.PROXY_SERVER.getScheduler().buildTask(Freesia.INSTANCE, () -> {
            try {
                final DefaultNBTSerializer serializer = new DefaultNBTSerializer();
                final ByteArrayOutputStream bos = new ByteArrayOutputStream();
                final DataOutputStream dos = new DataOutputStream(bos);

                serializer.serializeTag(dos, entityData, true);
                dos.flush();

                Freesia.virtualPlayerDataStorageManager.save(playerUUID, bos.toByteArray()).whenComplete((unused, ex) -> {
                    if (ex != null) {
                        callback.completeExceptionally(ex);
                        return;
                    }

                    callback.complete(true);
                });
            } catch (Exception e) {
                callback.completeExceptionally(e);
            }
        }).schedule();

        return callback;
    }

    public CompletableFuture<Boolean> addVirtualPlayer(UUID playerUUID, int playerEntityId) {
        if (Freesia.PROXY_SERVER.getPlayer(playerUUID).isPresent()) {
            return CompletableFuture.completedFuture(false);
        }

        synchronized (this.virtualProxies) {
            if (this.virtualProxies.containsKey(playerUUID)) {
                return CompletableFuture.completedFuture(false);
            }

            final CompletableFuture<Boolean> callback = new CompletableFuture<>();

            final YsmPacketProxy createdVirtualProxy = this.virtualProxies.computeIfAbsent(playerUUID, this.packetProxyCreatorVirtual);

            //Load from data storage
            Freesia.virtualPlayerDataStorageManager.loadPlayerData(playerUUID).whenComplete((data, ex) -> {
                if (ex != null) {
                    callback.completeExceptionally(ex);
                }

                if (data == null) {
                    callback.complete(true);
                    return;
                }

                try {
                    final DefaultNBTSerializer serializer = new DefaultNBTSerializer();
                    final NBTCompound read = (NBTCompound) serializer.deserializeTag(NBTLimiter.forBuffer(data, Integer.MAX_VALUE), new DataInputStream(new ByteArrayInputStream(data)), true);

                    createdVirtualProxy.setEntityDataRaw(read);
                    createdVirtualProxy.setPlayerEntityId(playerEntityId); // Will fired tracker update when entity id changed
                } catch (Exception ex1) {
                    callback.completeExceptionally(ex1);
                    return;
                }

                callback.complete(true);
            });

            return callback;
        }
    }

    public CompletableFuture<Boolean> removeVirtualPlayer(UUID playerUUID) {
        final YsmPacketProxy removedProxy;

        synchronized (this.virtualProxies) {
            removedProxy = this.virtualProxies.remove(playerUUID);

            if (removedProxy == null) {
                return CompletableFuture.completedFuture(false);
            }
        }

        final NBTCompound entityData = removedProxy.getCurrentEntityState();

        if (entityData == null) {
            return CompletableFuture.completedFuture(true);
        }

        final CompletableFuture<Boolean> callback = new CompletableFuture<>();

        Freesia.PROXY_SERVER.getScheduler().buildTask(Freesia.INSTANCE, () -> {
            try {
                final DefaultNBTSerializer serializer = new DefaultNBTSerializer();
                final ByteArrayOutputStream bos = new ByteArrayOutputStream();
                final DataOutputStream dos = new DataOutputStream(bos);

                serializer.serializeTag(dos, entityData, true);
                dos.flush();

                Freesia.virtualPlayerDataStorageManager.save(playerUUID, bos.toByteArray()).whenComplete((r, e) -> {
                    if (e != null) {
                        callback.completeExceptionally(e);
                        return;
                    }

                    callback.complete(true);
                });
            } catch (Exception e) {
                callback.completeExceptionally(e);
            }
        }).schedule();

        return callback;
    }

    private void disconnectMapperWithoutKickingMaster(@NotNull MapperSessionProcessor connection) {
        connection.setKickMasterWhenDisconnect(false);
        connection.destroyAndAwaitDisconnected();
    }

    public void autoCreateMapper(Player player) {
        if (!this.playGate.ready(player.getUniqueId()) || !this.clientIsPlaying(player)) return;
        final MapperSessionProcessor processor = this.mapperSessions.get(player);
        if (processor == null || !this.startedMappers.add(processor)) return;
        final InetSocketAddress worker = Freesia.registedWorkers.isEmpty() ? null : this.selectLessPlayer();
        if (worker == null) {
            this.startedMappers.remove(processor);
            this.unavailableMappers.add(player.getUniqueId());
            if (FreesiaConfig.kickIfYsmNotInstalled) player.disconnect(Component.text("YSM Worker unavailable"));
            return;
        }
        this.unavailableMappers.remove(player.getUniqueId());
        try {
            this.createMapperSession(player, worker);
        } catch (RuntimeException failure) {
            this.startedMappers.remove(processor);
            this.unavailableMappers.add(player.getUniqueId());
            Freesia.LOGGER.warn("Optional YSM session failed to start for {}", player.getUsername(), failure);
            if (FreesiaConfig.kickIfYsmNotInstalled) player.disconnect(Component.text("YSM Worker unavailable"));
        }
    }

    // Periodic optional retry also covers controller-before-Minecraft startup.
    public synchronized void retryOptionalMappers() {
        if (FreesiaConfig.kickIfYsmNotInstalled || Freesia.registedWorkers.isEmpty()) return;
        int attempted = 0;
        for (UUID uuid : Set.copyOf(this.unavailableMappers)) {
            if (attempted >= 40) break;
            final Player player = Freesia.PROXY_SERVER.getPlayer(uuid).orElse(null);
            if (player == null || player.getCurrentServer().isEmpty() || !this.playGate.ready(uuid) || !this.clientIsPlaying(player)) continue;
            final Integer entityId = this.backendEntityIds.get(uuid);
            if (entityId == null) continue;
            if (!this.mapperSessions.containsKey(player)) this.initMapperPacketProcessor(player);
            this.updateRealPlayerEntityId(player, entityId);
            this.autoCreateMapper(player);
            this.onBackendReady(player);
            attempted++;
        }
    }

    /** Read-only, real backend entity binding for the optional appearance bridge. */
    public record AppearanceState(UUID playerUuid, int entityId, NBTCompound state) {}

    public AppearanceState appearanceState(Player player) {
        if (this.unavailableMappers.contains(player.getUniqueId())) return null;
        final MapperSessionProcessor mapper = this.mapperSessions.get(player);
        if (mapper == null) return null;
        final YsmPacketProxy proxy = mapper.getPacketProxy();
        final NBTCompound state = proxy.getCurrentEntityState();
        final int entityId = proxy.getPlayerEntityId();
        return state == null || entityId < 0 ? null : new AppearanceState(player.getUniqueId(), entityId, state.copy());
    }

    public boolean isPlayerInstalledYsm(@NotNull Player target) {
        return this.ysmInstalledPlayers.contains(target.getUniqueId());
    }

    public boolean isPlayerInstalledYsm(UUID target) {
        return this.ysmInstalledPlayers.contains(target);
    }

    private final Set<UUID> unavailableMappers = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private final Map<UUID, Integer> backendEntityIds = new java.util.concurrent.ConcurrentHashMap<>();

    public void onPlayerDisconnect(@NotNull Player player) {
        this.playGate.remove(player.getUniqueId());
        this.unavailableMappers.remove(player.getUniqueId());
        this.backendEntityIds.remove(player.getUniqueId());
        this.ysmInstalledPlayers.remove(player.getUniqueId());
        this.observersResynced.remove(player.getUniqueId());

        final MapperSessionProcessor mapperSession = this.mapperSessions.remove(player);

        if (mapperSession != null) {
            this.startedMappers.remove(mapperSession);
            this.disconnectMapperWithoutKickingMaster(mapperSession);
        }
    }

    protected void onWorkerSessionDisconnect(@NotNull MapperSessionProcessor mapperSession, boolean kickMaster, @Nullable Component reason) {
        this.startedMappers.remove(mapperSession);
        // A late callback from an old session cannot invalidate its replacement.
        if (!this.mapperSessions.remove(mapperSession.getBindPlayer(), mapperSession)) return;
        // Kick the master it binds
        if (kickMaster && FreesiaConfig.kickIfYsmNotInstalled)
            mapperSession.getBindPlayer().disconnect(Freesia.languageManager.i18n(
                    FreesiaConstants.LanguageConstants.WORKER_TERMINATED_CONNECTION,
                    List.of("reason"),
                    List.of(reason == null ? Component.text("DISCONNECTED MANUAL") : reason)
            ));

        if (kickMaster && !FreesiaConfig.kickIfYsmNotInstalled && mapperSession.getBindPlayer().isActive())
            this.unavailableMappers.add(mapperSession.getBindPlayer().getUniqueId());
    }

    public void onPluginMessageIn(@NotNull Player player, @NotNull MinecraftChannelIdentifier channel, byte[] packetData) {
        // Check if it is the message of ysm
        if (!channel.equals(YSM_CHANNEL_KEY_VELOCITY)) {
            return;
        }
        if (!this.isPlayReady(player, this.backendEpoch(player))) return;

        final MapperSessionProcessor mapperSession = this.mapperSessions.get(player);
        if (mapperSession == null || this.unavailableMappers.contains(player.getUniqueId())) return;

        mapperSession.processPlayerPluginMessage(packetData);
    }

    public void onBackendReady(Player player) {
        this.onBackendReady(player, this.playGate.epoch(player.getUniqueId()));
    }

    public void onBackendReady(Player player, long epoch) {
        if (!this.clientIsPlaying(player) || !this.playGate.markReady(player.getUniqueId(), epoch)) return;
        final MapperSessionProcessor mapperSession = this.mapperSessions.get(player);

        if (mapperSession == null) {
            return; // A Worker outage must not interrupt vanilla play.
        }

        mapperSession.onBackendReady();
        this.autoCreateMapper(player);
    }

    public boolean disconnectAlreadyConnected(Player player) {
        final MapperSessionProcessor current = this.mapperSessions.get(player);

        // Not exists or created
        if (current == null) {
            return false;
        }

        // Remove before awaiting close: late callbacks must not remove the new
        // processor, and old Worker replies must fail the source identity check.
        this.mapperSessions.remove(player, current);
        this.startedMappers.remove(current);
        this.disconnectMapperWithoutKickingMaster(current);
        return true;
    }

    public void initMapperPacketProcessor(@NotNull Player player) {
        final MapperSessionProcessor possiblyExisting = this.mapperSessions.get(player);

        if (possiblyExisting != null) {
            throw new IllegalStateException("Mapper session already exists for player " + player.getUsername());
        }

        final YsmPacketProxy packetProxy = this.packetProxyCreator.apply(player);
        final MapperSessionProcessor processor = new MapperSessionProcessor(player, packetProxy, this);

        packetProxy.setParentHandler(processor);

        this.mapperSessions.put(player, processor);
    }

    public void createMapperSession(@NotNull Player player, @NotNull InetSocketAddress backend) {
        // Instance new session
        final TcpClientSession mapperSession = new TcpClientSession(
                backend.getHostName(),
                backend.getPort(),
                new MinecraftProtocol(
                        new GameProfile(
                                player.getUniqueId(),
                                player.getUsername()),
                        null
                )
        );

        // Our packet processor for packet forwarding
        final MapperSessionProcessor packetProcessor = this.mapperSessions.get(player);

        if (packetProcessor == null) {
            // Should be created in ServerPreConnectEvent
            throw new IllegalStateException("Mapper session not found or ready for player " + player.getUsername());
        }

        packetProcessor.setSession(mapperSession);
        mapperSession.addListener(packetProcessor);

        // Default as Minecraft client
        mapperSession.setFlag(BuiltinFlags.READ_TIMEOUT,30_000);
        mapperSession.setFlag(BuiltinFlags.WRITE_TIMEOUT,30_000);

        // Do connect
        mapperSession.connect(true,false);
    }

    public void onVirtualPlayerTrackerUpdate(UUID owner, Player watcher) {
        final YsmPacketProxy virtualProxy = this.virtualProxies.get(owner);

        //There is no specified virtual proxy for the owner
        if (virtualProxy == null) {
            return;
        }

        if (this.isPlayerInstalledYsm(watcher)) {
            virtualProxy.sendEntityStateTo(watcher);
        }
    }

    public void onRealPlayerTrackerUpdate(Player beingWatched, Player watcher) {
        final MapperSessionProcessor mapperSession = this.mapperSessions.get(beingWatched);

        // The mapper was created earlier than the player's connection turned in-game state
        // so as the result, we could simply pass it down directly
        if (mapperSession == null) {
            // Should not be happened
            // We use random player as the payload of custom payload of freesia tracker, so there is a possibility
            // that race condition would happen between the disconnect logic and tracker update logic
            //throw new IllegalStateException("???");
            return;
        }

        if (this.isPlayerInstalledYsm(watcher)) { // Skip players who don't install ysm
            // Check if ready
            if (!mapperSession.queueTrackerUpdate(watcher.getUniqueId())) {
                mapperSession.getPacketProxy().sendEntityStateTo(watcher);
            }
        }
    }

    @Nullable
    private InetSocketAddress selectLessPlayer() {
        this.backendIpsAccessLock.readLock().lock();
        try {
            InetSocketAddress result = null;

            int idx = 0;
            int lastCount = 0;
            for (Map.Entry<InetSocketAddress, Integer> entry : this.backend2Players.entrySet()) {
                final InetSocketAddress currAddress = entry.getKey();
                final int currPlayerCount = entry.getValue();

                if (idx == 0) {
                    lastCount = currPlayerCount;
                    result = currAddress;
                }

                if (currPlayerCount < lastCount) {
                    lastCount = currPlayerCount;
                    result = currAddress;
                }

                idx++;
            }

            return result;
        } finally {
            this.backendIpsAccessLock.readLock().unlock();
        }
    }
}
