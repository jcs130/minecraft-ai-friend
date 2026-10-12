package org.afuhome.agentfriend;

import com.comphenix.protocol.ProtocolLibrary;
import com.comphenix.protocol.events.PacketContainer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.minecraft.network.protocol.game.ClientboundLevelParticlesPacket;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.craftbukkit.CraftParticle;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

/** Private vanilla guide lines. Complete frames are spread over ticks, never clipped at a wall. */
final class TargetGuideParticles {
    private static final int MAX_GUIDES = 128, MAX_VIEWERS = 4;
    private static final int FRAME_INTERVAL = 8, HEARTBEAT_TTL = 32;
    private static final int PACKETS_PER_TICK = 256, PACKETS_PER_VIEWER = 128;
    private record Key(UUID caster, String kind) { }
    private static final class Guide {
        Location target;
        int expires, rendered;
        Guide(Location target, int now) { this.target = target; expires = now + HEARTBEAT_TTL; rendered = now - FRAME_INTERVAL; }
    }
    private final AgentFriendPlugin plugin;
    private final Map<Key, Guide> active = new LinkedHashMap<>();
    private final BukkitTask task;
    private int cursor;

    TargetGuideParticles(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 1, 1);
    }

    void show(Player caster, String kind, Location target) {
        if (target == null || target.getWorld() != caster.getWorld()) { remove(caster.getUniqueId(), kind); return; }
        Key key = new Key(caster.getUniqueId(), kind);
        Guide guide = active.get(key);
        int now = Bukkit.getCurrentTick();
        if (guide == null) {
            if (active.size() >= MAX_GUIDES) return;
            active.put(key, new Guide(target.clone(), now));
        } else { guide.target = target.clone(); guide.expires = now + HEARTBEAT_TTL; }
    }

    void remove(UUID caster, String kind) { active.remove(new Key(caster, kind)); }
    void remove(UUID caster) { active.keySet().removeIf(key -> key.caster.equals(caster)); }
    void stop() { task.cancel(); active.clear(); }

    private void tick() {
        int now = Bukkit.getCurrentTick();
        active.entrySet().removeIf(entry -> {
            Player caster = Bukkit.getPlayer(entry.getKey().caster);
            return now >= entry.getValue().expires || caster == null || !caster.isOnline() || caster.isDead()
                    || caster.getGameMode() == GameMode.SPECTATOR || caster.getWorld() != entry.getValue().target.getWorld();
        });
        if (active.isEmpty()) return;
        List<Map.Entry<Key, Guide>> entries = new ArrayList<>(active.entrySet());
        Map<UUID, Integer> used = new HashMap<>();
        int budget = PACKETS_PER_TICK, first = Math.floorMod(cursor++, entries.size());
        for (int i = 0; i < entries.size(); i++) {
            var entry = entries.get((first + i) % entries.size());
            Guide guide = entry.getValue();
            if (now - guide.rendered < FRAME_INTERVAL) continue;
            Player caster = Bukkit.getPlayer(entry.getKey().caster);
            if (caster == null) continue;
            // Recompute from the live body, not the position saved when the spell was cast.
            Location start = caster.getLocation().add(0, Math.min(1.2, caster.getEyeHeight() * .8), 0);
            List<GuideLine.Point> points = GuideLine.points(new GuideLine.Point(start.getX(), start.getY(), start.getZ()),
                    new GuideLine.Point(guide.target.getX(), guide.target.getY(), guide.target.getZ()));
            if (points.isEmpty()) { active.remove(entry.getKey()); continue; }
            List<Player> viewers = new ArrayList<>(); viewers.add(caster);
            for (Player eye : plugin.attachedEyes(caster)) {
                if (viewers.size() >= MAX_VIEWERS) break;
                if (eye.isOnline() && eye.getWorld() == caster.getWorld() && eye.canSee(caster) && !viewers.contains(eye)) viewers.add(eye);
            }
            int cost = points.size() * viewers.size();
            // Defer the whole line: a packet limit must not cut off its target end.
            if (cost > budget || viewers.stream().anyMatch(viewer -> used.getOrDefault(viewer.getUniqueId(), 0) + points.size() > PACKETS_PER_VIEWER)) continue;
            for (GuideLine.Point point : points) {
                // longDistance affects the vanilla particle distance limit, not terrain depth testing.
                PacketContainer packet = PacketContainer.fromPacket(new ClientboundLevelParticlesPacket(
                        CraftParticle.createParticleParam(Particle.END_ROD, null), true,
                        point.x(), point.y(), point.z(), 0, 0, 0, 0, 1));
                for (Player viewer : viewers) {
                    // Explicit private recipients, bypassing the old Eye effect mirror's 128/s clipping.
                    ProtocolLibrary.getProtocolManager().sendServerPacket(viewer, packet, false);
                }
            }
            for (Player viewer : viewers) used.merge(viewer.getUniqueId(), points.size(), Integer::sum);
            budget -= cost;
            guide.rendered = now;
        }
    }
}
