package org.afuhome.agentfriend;

import java.util.*;
import java.util.function.Predicate;
import org.bukkit.*;
import org.bukkit.entity.Player;

/** Vanilla, private party feedback; attached Eyes use the existing packet mirror. */
final class TrialRescueVisuals {
    private record Marker(Player viewer, Player target, Location at, double progress, boolean paused) { }
    private final List<Marker> pending = new ArrayList<>();
    private int cursor;
    private static final int POINTS = 16;
    // A full circle is sent together. Bound packets and rotate recipients under load.
    private static final int MAX_FRAMES = 256 / (POINTS + 1);
    private static final Particle.DustOptions GOLD = new Particle.DustOptions(Color.fromRGB(255, 190, 65), 1.4f);
    private static final Particle.DustOptions GREEN = new Particle.DustOptions(Color.fromRGB(65, 230, 135), 1.4f);
    private static final Particle.DustOptions GREY = new Particle.DustOptions(Color.fromRGB(160, 170, 180), 1.4f);

    void marker(Player target, Collection<UUID> members, double progress, boolean paused) {
        for (Player viewer : viewers(target, members))
            pending.add(new Marker(viewer, target, target.getLocation(), progress, paused));
    }
    void flush(Predicate<UUID> stillDowned) {
        pending.removeIf(m -> !m.viewer.isOnline() || !m.target.isOnline()
                || !stillDowned.test(m.target.getUniqueId()) || m.viewer.getWorld() != m.at.getWorld());
        int size = pending.size();
        if (size == 0) return;
        int count = Math.min(size, MAX_FRAMES);
        for (int n = 0; n < count; n++) {
            Marker m = pending.get(Math.floorMod(cursor + n, size));
            for (int i = 0; i < POINTS; i++) {
                double angle = 2 * Math.PI * i / POINTS;
                Particle.DustOptions colour = m.paused ? GREY : i < m.progress * POINTS ? GREEN : GOLD;
                m.viewer.spawnParticle(Particle.DUST, m.at.clone().add(
                        Math.cos(angle) * TrialRescueManager.RADIUS, .15,
                        Math.sin(angle) * TrialRescueManager.RADIUS), 1, 0, 0, 0, 0, colour);
            }
            m.viewer.spawnParticle(Particle.END_ROD, m.at.clone().add(0, 1.2, 0), 10, .15, .8, .15, .01);
        }
        cursor = Math.floorMod(cursor + count, size);
        pending.clear();
    }
    void revived(Player target, Collection<UUID> members) {
        for (Player viewer : viewers(target, members)) {
            Location at = target.getLocation().add(0, 1, 0);
            viewer.spawnParticle(Particle.HAPPY_VILLAGER, at, 24, .6, .8, .6, .02);
            viewer.spawnParticle(Particle.END_ROD, at, 24, .5, .8, .5, .06);
            viewer.spawnParticle(Particle.HEART, at, 6, .4, .4, .4, 0);
            viewer.playSound(at, Sound.BLOCK_BEACON_ACTIVATE, .7f, 1.5f);
        }
    }
    private List<Player> viewers(Player target, Collection<UUID> members) {
        return members.stream().map(Bukkit::getPlayer).filter(Objects::nonNull)
                .filter(p -> p.isOnline() && p.getWorld() == target.getWorld() && p.canSee(target)
                        && p.getLocation().distanceSquared(target.getLocation()) <= 48 * 48)
                .toList();
    }
}
