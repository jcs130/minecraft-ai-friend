package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.List;
import org.bukkit.FluidCollisionMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.block.Block;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Player;
import org.bukkit.event.block.BlockFadeEvent;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.util.Vector;

/** Frost can clear exposed fire without editing terrain or neutralizing the lava hazard. */
final class FrostControl {
    static final double RADIUS = 5.5;
    private static final double RADIUS_SQUARED = RADIUS * RADIUS;
    private static final int HEIGHT = 3;
    private static final int SLOWNESS_III = 2;
    private static final int WEAKNESS_TICKS = 40;

    record Targets(List<Player> players, List<Block> fire) {
        boolean empty() { return players.isEmpty() && fire.isEmpty(); }
    }

    static Targets find(AgentFriendPlugin plugin, Player caster) {
        List<Player> players = new ArrayList<>();
        if (!plugin.nativeRpgMayAct(caster)) return new Targets(players, List.of());
        if (caster.getFireTicks() > 0) players.add(caster);
        Location center = caster.getLocation();
        for (var entity : caster.getNearbyEntities(RADIUS, HEIGHT, RADIUS)) {
            if (entity instanceof Player player && player.getFireTicks() > 0 && plugin.nativeRpgMayAct(player)
                    && center.distanceSquared(player.getLocation()) <= RADIUS_SQUARED && caster.hasLineOfSight(player))
                players.add(player);
        }
        List<Block> fire = new ArrayList<>();
        var world = caster.getWorld();
        var eye = caster.getEyeLocation();
        for (int x = center.getBlockX() - 6; x <= center.getBlockX() + 6; x++) {
            for (int z = center.getBlockZ() - 6; z <= center.getBlockZ() + 6; z++) {
                if (!world.isChunkLoaded(x >> 4, z >> 4)) continue;
                for (int y = Math.max(world.getMinHeight(), center.getBlockY() - HEIGHT);
                        y <= Math.min(world.getMaxHeight() - 1, center.getBlockY() + HEIGHT); y++) {
                    Location at = new Location(world, x + .5, y + .5, z + .5);
                    if (center.distanceSquared(at) > RADIUS_SQUARED) continue;
                    Block block = world.getBlockAt(x, y, z);
                    if (!isFire(block.getType()) || !visible(eye, at)) continue;
                    if (!plugin.dungeon().mayExtinguishTrialFire(caster, at) && !mayRemove(plugin, caster, block)) continue;
                    var air = block.getState();
                    air.setType(Material.AIR);
                    if (new BlockFadeEvent(block, air).callEvent()) fire.add(block);
                }
            }
        }
        return new Targets(players, fire);
    }

    private static boolean mayRemove(AgentFriendPlugin plugin, Player caster, Block block) {
        var verdict = plugin.protectionAdvisor().observe(caster, "break", block.getX(), block.getY(), block.getZ());
        return verdict.has("allowed") && !verdict.get("allowed").isJsonNull() && verdict.get("allowed").getAsBoolean();
    }

    private static boolean visible(Location eye, Location at) {
        Vector line = at.toVector().subtract(eye.toVector());
        double distance = line.length();
        return distance < .01 || eye.getWorld().rayTraceBlocks(eye, line.normalize(), distance,
                FluidCollisionMode.NEVER, true) == null;
    }

    private static boolean isFire(Material material) {
        return material == Material.FIRE || material == Material.SOUL_FIRE;
    }

    static String extinguish(Targets targets) {
        int players = 0, fires = 0;
        for (Player player : targets.players()) {
            if (player.getFireTicks() <= 0) continue;
            player.setFireTicks(0);
            players++;
        }
        for (Block block : targets.fire()) {
            if (!isFire(block.getType())) continue;
            block.setType(Material.AIR, false);
            block.getWorld().spawnParticle(Particle.CLOUD, block.getLocation().add(.5, .3, .5),
                    4, .14, .12, .14, .01);
            fires++;
        }
        if (players + fires == 0) return "";
        return "熄灭 " + players + " 名玩家身上的火、" + fires + " 处明火";
    }

    static void slow(Enemy enemy, int slowTicks) {
        enemy.addPotionEffect(new PotionEffect(PotionEffectType.SLOWNESS, slowTicks, SLOWNESS_III, false, true));
        enemy.addPotionEffect(new PotionEffect(PotionEffectType.WEAKNESS, WEAKNESS_TICKS, 0, false, true));
    }
}
