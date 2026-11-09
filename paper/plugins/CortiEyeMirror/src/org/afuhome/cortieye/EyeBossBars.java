package org.afuhome.cortieye;

import com.comphenix.protocol.PacketType;
import com.comphenix.protocol.ProtocolManager;
import com.comphenix.protocol.events.ListenerPriority;
import com.comphenix.protocol.events.PacketAdapter;
import com.comphenix.protocol.events.PacketContainer;
import com.comphenix.protocol.events.PacketEvent;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundBossEventPacket;
import net.minecraft.server.network.ServerGamePacketListenerImpl;
import net.minecraft.world.BossEvent;
import org.bukkit.Bukkit;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;
import org.afuhome.shared.ActivityBarSemantics;

/** Mirrors the active bars from one attached target while leaving camera-native bars alone. */
final class EyeBossBars {
    private enum Action { ADD, UPDATE, REMOVE }

    private record Wire(UUID recipient, ServerGamePacketListenerImpl connection, ClientboundBossEventPacket packet) { }
    private record Change(UUID id, Action action, ClientboundBossEventPacket packet) { }

    private static final class Bar extends BossEvent {
        Bar(UUID id, Component name, float progress, BossBarColor color, BossBarOverlay overlay,
                boolean dark, boolean music, boolean fog) {
            super(id, name.copy(), color, overlay);
            setProgress(progress);
            setDarkenScreen(dark);
            setPlayBossMusic(music);
            setCreateWorldFog(fog);
        }
    }

    private static final class Feed {
        final ServerGamePacketListenerImpl connection;
        final Map<UUID, Bar> bars = new LinkedHashMap<>();

        Feed(ServerGamePacketListenerImpl connection) {
            this.connection = connection;
        }
    }

    private static final class View {
        final ServerGamePacketListenerImpl connection;
        final Set<UUID> sent = new HashSet<>();
        final Set<String> reportedActivities = new HashSet<>();
        UUID source;

        View(ServerGamePacketListenerImpl connection) {
            this.connection = connection;
        }
    }

    private final CortiEyeMirrorPlugin plugin;
    private final ProtocolManager protocol;
    private final ConcurrentLinkedQueue<Wire> incoming = new ConcurrentLinkedQueue<>();
    // All feed and view state is owned by the server thread.
    private final Map<UUID, Feed> nativeFeeds = new HashMap<>();
    private final Map<UUID, View> views = new HashMap<>();
    private final ThreadLocal<Boolean> sendingMirror = new ThreadLocal<>();
    private long nextWarning;

    EyeBossBars(CortiEyeMirrorPlugin plugin, ProtocolManager protocol) {
        this.plugin = plugin;
        this.protocol = protocol;
    }

    void start() {
        protocol.addPacketListener(new PacketAdapter(plugin, ListenerPriority.MONITOR, PacketType.Play.Server.BOSS) {
            @Override public void onPacketSending(PacketEvent event) {
                if (Boolean.TRUE.equals(sendingMirror.get()) || event.isCancelled() || event.isPlayerTemporary()) return;
                if (event.getPlayer() instanceof CraftPlayer player
                        && event.getPacket().getHandle() instanceof ClientboundBossEventPacket packet) {
                    incoming.add(new Wire(player.getUniqueId(), player.getHandle().connection, packet));
                }
            }
        });
    }

    void tick(Map<UUID, UUID> routes) {
        Map<UUID, List<Change>> changes = drain();
        for (var route : routes.entrySet()) {
            Player camera = Bukkit.getPlayer(route.getKey());
            if (camera == null) continue;
            var connection = connection(camera);
            View existing = views.get(route.getKey());
            if (existing == null || existing.connection != connection) {
                views.put(route.getKey(), new View(connection));
            }
        }
        var iterator = views.entrySet().iterator();
        while (iterator.hasNext()) {
            var entry = iterator.next();
            UUID cameraId = entry.getKey();
            View view = entry.getValue();
            Player camera = Bukkit.getPlayer(cameraId);
            if (camera == null || connection(camera) != view.connection) {
                iterator.remove();
                continue;
            }
            UUID source = routes.get(cameraId);
            Map<UUID, Bar> own = bars(cameraId);
            // Native ADD or REMOVE may already have reached the camera before this tick.
            if (!java.util.Objects.equals(source, view.source)) {
                withdraw(camera, view, own);
                if (!view.sent.isEmpty()) continue; // Retry failed old removals before sending the next feed.
                view.source = source;
            } else if (source != null) {
                Map<UUID,Bar> active=bars(source);
                for (var change : changes.getOrDefault(source, List.of())) {
                    if (own.containsKey(change.id())) continue;
                    if(change.action()!=Action.REMOVE&&duplicateActivity(own,active.get(change.id()))) {
                        if(!view.sent.contains(change.id())||send(camera,ClientboundBossEventPacket.createRemovePacket(change.id()))){view.sent.remove(change.id());noteDuplicate(camera,view,active.get(change.id()));}
                        continue;
                    }
                    if (change.action() == Action.ADD) {
                        if (send(camera, change.packet())) view.sent.add(change.id());
                    } else if (view.sent.contains(change.id()) && send(camera, change.packet())
                            && change.action() == Action.REMOVE) {
                        view.sent.remove(change.id());
                    }
                }
            }
            if (source == null) {
                if (view.sent.isEmpty()) iterator.remove();
                continue;
            }
            Map<UUID, Bar> active = bars(source);
            // A late attach, or a native REMOVE of a shared UUID, needs a full ADD.
            for (var activeBar : active.entrySet()) {
                UUID id = activeBar.getKey();
                if(!own.containsKey(id)&&duplicateActivity(own,activeBar.getValue())){
                    if(!view.sent.contains(id)||send(camera,ClientboundBossEventPacket.createRemovePacket(id))){view.sent.remove(id);noteDuplicate(camera,view,activeBar.getValue());}
                    continue;
                }
                if (!own.containsKey(id) && !view.sent.contains(id)
                        && send(camera, ClientboundBossEventPacket.createAddPacket(activeBar.getValue()))) {
                    view.sent.add(id);
                }
            }
            view.sent.removeIf(id -> own.containsKey(id)
                    || (!active.containsKey(id) && send(camera, ClientboundBossEventPacket.createRemovePacket(id))));
        }
    }

    private Map<UUID, List<Change>> drain() {
        Map<UUID, List<Change>> changes = new HashMap<>();
        Wire wire;
        while ((wire = incoming.poll()) != null) {
            Player player = Bukkit.getPlayer(wire.recipient());
            if (player == null || connection(player) != wire.connection()) continue;
            Feed feed = nativeFeeds.get(wire.recipient());
            if (feed == null || feed.connection != wire.connection()) {
                feed = new Feed(wire.connection());
                nativeFeeds.put(wire.recipient(), feed);
            }
            List<Change> recipientChanges = changes.computeIfAbsent(wire.recipient(), ignored -> new ArrayList<>());
            apply(wire.packet(), feed.bars, views.get(wire.recipient()), recipientChanges);
            if (feed.bars.isEmpty()) nativeFeeds.remove(wire.recipient());
        }
        return changes;
    }

    private static void apply(ClientboundBossEventPacket packet, Map<UUID, Bar> bars, View ownView,
            List<Change> changes) {
        packet.dispatch(new ClientboundBossEventPacket.Handler() {
            private void ownPacket(UUID id, Action action) {
                if (ownView != null) ownView.sent.remove(id);
                changes.add(new Change(id, action, packet));
            }

            @Override public void add(UUID id, Component name, float progress, BossEvent.BossBarColor color,
                    BossEvent.BossBarOverlay overlay, boolean dark, boolean music, boolean fog) {
                bars.put(id, new Bar(id, name, progress, color, overlay, dark, music, fog));
                ownPacket(id, Action.ADD);
            }

            @Override public void remove(UUID id) {
                bars.remove(id);
                ownPacket(id, Action.REMOVE);
            }

            private void update(UUID id, java.util.function.Consumer<Bar> mutation) {
                Bar bar = bars.get(id);
                if (bar == null) return;
                mutation.accept(bar);
                changes.add(new Change(id, Action.UPDATE, packet));
            }

            @Override public void updateProgress(UUID id, float progress) {
                update(id, bar -> bar.setProgress(progress));
            }

            @Override public void updateName(UUID id, Component name) {
                update(id, bar -> bar.setName(name.copy()));
            }

            @Override public void updateStyle(UUID id, BossEvent.BossBarColor color, BossEvent.BossBarOverlay overlay) {
                update(id, bar -> { bar.setColor(color); bar.setOverlay(overlay); });
            }

            @Override public void updateProperties(UUID id, boolean dark, boolean music, boolean fog) {
                update(id, bar -> { bar.setDarkenScreen(dark); bar.setPlayBossMusic(music); bar.setCreateWorldFog(fog); });
            }
        });
    }

    private Map<UUID, Bar> bars(UUID playerId) {
        Feed feed = nativeFeeds.get(playerId);
        return feed == null ? Map.of() : feed.bars;
    }
    private static boolean duplicateActivity(Map<UUID,Bar> own,Bar target){
        return target!=null&&own.values().stream().anyMatch(bar->ActivityBarSemantics.sameActivity(bar.getName().getString(),target.getName().getString()));
    }
    private void noteDuplicate(Player camera,View view,Bar target){
        var activity=ActivityBarSemantics.identify(target.getName().getString());
        if(activity!=null&&view.reportedActivities.add(activity.id()))plugin.getLogger().info("Eye activity bar deduplicated: camera="+camera.getName()+" activity="+activity.id()+" native=retained mirrored=suppressed");
    }

    private void withdraw(Player camera, View view, Map<UUID, Bar> own) {
        view.sent.removeIf(id -> own.containsKey(id)
                || send(camera, ClientboundBossEventPacket.createRemovePacket(id)));
    }

    private boolean send(Player camera, ClientboundBossEventPacket packet) {
        try {
            // ProtocolLib still calls MONITOR for sends with filters disabled.
            sendingMirror.set(true);
            protocol.sendServerPacket(camera, new PacketContainer(PacketType.Play.Server.BOSS, packet), false);
            return true;
        } catch (RuntimeException failure) {
            long now = System.currentTimeMillis();
            if (now >= nextWarning) {
                nextWarning = now + 5_000L;
                plugin.getLogger().warning("Eye BossBar delivery failed for " + camera.getName() + ": " + failure);
            }
            return false;
        } finally {
            sendingMirror.remove();
        }
    }

    void quit(Player player) {
        UUID id = player.getUniqueId();
        nativeFeeds.remove(id);
        views.remove(id);
    }

    void stop() {
        drain();
        for (var entry : views.entrySet()) {
            Player camera = Bukkit.getPlayer(entry.getKey());
            if (camera != null && connection(camera) == entry.getValue().connection) {
                withdraw(camera, entry.getValue(), bars(entry.getKey()));
            }
        }
        views.clear();
        nativeFeeds.clear();
        incoming.clear();
    }

    private static ServerGamePacketListenerImpl connection(Player player) {
        return ((CraftPlayer) player).getHandle().connection;
    }
}
