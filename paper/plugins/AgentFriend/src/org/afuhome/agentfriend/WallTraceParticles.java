package org.afuhome.agentfriend;

import org.bukkit.FluidCollisionMode;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.block.BlockFace;
import org.bukkit.entity.Player;
import org.bukkit.util.RayTraceResult;
import org.bukkit.util.Vector;

/** Private, bounded vanilla particles pointing at a target without crossing solid blocks. */
final class WallTraceParticles {
    private WallTraceParticles() { }

    static void guide(Player player, Location target, boolean targetIsBlock) {
        if (target.getWorld() != player.getWorld()) return;
        Location eye = player.getEyeLocation();
        Vector ray = target.toVector().subtract(eye.toVector());
        double length = ray.length();
        if (length < 0.5) return;
        Vector direction = ray.normalize();
        double traceLength = length + (targetIsBlock ? 1.0 : -0.2);
        RayTraceResult hit = player.getWorld().rayTraceBlocks(eye, direction,
                Math.max(0.01, traceLength), FluidCollisionMode.NEVER, true);
        double visibleLength = hit == null ? length : eye.toVector().distance(hit.getHitPosition());
        for (double distance = 1.2; distance < Math.min(visibleLength - 0.2, 10.0); distance += 1.4) {
            Vector spot = eye.toVector().add(direction.clone().multiply(distance));
            player.spawnParticle(Particle.END_ROD, spot.getX(), spot.getY(), spot.getZ(),
                    1, 0, 0, 0, 0);
        }
        if (hit != null && hit.getHitBlockFace() != null) {
            outlineWall(player, hit);
        } else if (!targetIsBlock) {
            player.spawnParticle(Particle.END_ROD, target, 5, 0.35, 0.55, 0.35, 0.01);
        }
    }

    private static void outlineWall(Player player, RayTraceResult hit) {
        BlockFace face = hit.getHitBlockFace();
        Vector normal = face.getDirection();
        Vector center = hit.getHitPosition().add(normal.clone().multiply(0.08));
        Vector right = switch (face) {
            case UP, DOWN, NORTH, SOUTH -> new Vector(1, 0, 0);
            default -> new Vector(0, 0, 1);
        };
        Vector up = switch (face) {
            case UP, DOWN -> new Vector(0, 0, 1);
            default -> new Vector(0, 1, 0);
        };
        double[][] points = {{-1,-1},{0,-1},{1,-1},{1,0},{1,1},{0,1},{-1,1},{-1,0}};
        for (double[] point : points) {
            Vector spot = center.clone().add(right.clone().multiply(point[0] * 0.23))
                    .add(up.clone().multiply(point[1] * 0.23));
            player.spawnParticle(Particle.END_ROD, spot.getX(), spot.getY(), spot.getZ(),
                    1, 0, 0, 0, 0);
        }
    }
}
