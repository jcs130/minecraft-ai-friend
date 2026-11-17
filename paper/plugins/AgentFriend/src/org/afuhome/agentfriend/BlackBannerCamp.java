package org.afuhome.agentfriend;

import java.util.List;
import java.util.function.IntPredicate;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.type.Door;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Villager;

/** The two original cages in the surveyed Nova Structures camp. */
final class BlackBannerCamp {
    static final String SITE = "illager_camp";
    static final String MARKER = "dungeon:" + SITE;
    static final String RESCUE_HINT = "清掉值守怪物后，用「使用」打开牢笼围栏。";

    private record Cage(int x, int z, BlockFace exit, int room) {
        boolean matches(Block block) {
            int height = block.getY();
            return (height == 67 || height == 68)
                    && Math.abs(block.getX() - x) + Math.abs(block.getZ() - z) == 1
                    && (block.getType() == Material.DARK_OAK_FENCE || block.getType() == Material.DARK_OAK_DOOR);
        }

        Block doorway(World world) {
            return world.getBlockAt(x, 67, z).getRelative(exit);
        }
    }

    private static final List<Cage> CAGES = List.of(
            new Cage(-1075, -1117, BlockFace.NORTH, 0),
            new Cage(-1069, -1111, BlockFace.SOUTH, 1));

    static boolean isLatch(Block block) {
        return CAGES.stream().anyMatch(cage -> cage.matches(block));
    }

    static void interact(AgentFriendPlugin plugin, Player player, Block clicked, IntPredicate cleared) {
        Cage cage = CAGES.stream().filter(c -> c.matches(clicked)).findFirst().orElseThrow();
        World world = clicked.getWorld();
        Block lower = cage.doorway(world);
        Block upper = lower.getRelative(BlockFace.UP);
        boolean alreadyReleased = rescueDoor(lower, cage.exit, Bisected.Half.BOTTOM)
                && rescueDoor(upper, cage.exit, Bisected.Half.TOP);
        if (!alreadyReleased && !cleared.test(cage.room)) {
            player.sendMessage("§e先用营地入口路牌开始清剿，清掉这座牢笼附近的守卫，再回来开门。");
            return;
        }
        if (!alreadyReleased && (lower.getType() != Material.DARK_OAK_FENCE || upper.getType() != Material.DARK_OAK_FENCE)) {
            player.sendMessage("§e这处牢门结构已变动，请联系服主检查。");
            return;
        }
        Location inside = new Location(world, cage.x + .5, 67.5, cage.z + .5);
        var captives = world.getNearbyEntitiesByType(Villager.class, inside, .48, 1, .48);
        if (!alreadyReleased && captives.isEmpty()) {
            player.sendMessage("§e这处牢笼内没有看到被困村民。");
            return;
        }
        Block safe = lower.getRelative(cage.exit);
        if (!AgentFriendPlugin.safeLanding(safe)) {
            player.sendMessage("§e牢门外的落脚处被堵住了。先让开门口，若通道被方块堵住，请联系服主。");
            return;
        }
        lower.setBlockData(openDoor(cage.exit, Bisected.Half.BOTTOM), false);
        upper.setBlockData(openDoor(cage.exit, Bisected.Half.TOP), false);
        Location outside = safe.getLocation().add(.5, 0, .5);
        // The original villager takes the short exit path using its native AI.
        for (Villager captive : captives) {
            captive.getPathfinder().moveTo(outside);
            Bukkit.getScheduler().runTaskLater(plugin, () -> finishRescue(captive, inside, lower, safe), 60L);
        }
        world.playSound(outside, Sound.BLOCK_WOODEN_DOOR_OPEN, .8f, 1);
        player.sendMessage(alreadyReleased ? "§a牢门已打开。" : "§a牢门已解锁，给村民留出出路。");
    }

    private static void finishRescue(Villager captive, Location inside, Block doorway, Block exit) {
        if (!captive.isValid() || !captive.getWorld().equals(inside.getWorld())
                || !(doorway.getBlockData() instanceof Door door) || !door.isOpen()) return;
        Location position = captive.getLocation();
        if (Math.abs(position.getX() - inside.getX()) > .49 || Math.abs(position.getZ() - inside.getZ()) > .49
                || Math.abs(position.getY() - inside.getY()) > 1.5) return;

        for (Block landing : List.of(exit, exit.getRelative(BlockFace.EAST), exit.getRelative(BlockFace.WEST))) {
            if (!AgentFriendPlugin.safeLanding(landing)) continue;
            Location at = landing.getLocation().add(.5, 0, .5);
            boolean occupied = at.getWorld().getNearbyEntities(at, .5, 1, .5).stream().anyMatch(LivingEntity.class::isInstance);
            if (!occupied && captive.teleport(at)) break;
        }
    }

    private static boolean rescueDoor(Block block, BlockFace facing, Bisected.Half half) {
        return block.getBlockData() instanceof Door door && block.getType() == Material.DARK_OAK_DOOR
                && door.getFacing() == facing && door.getHalf() == half;
    }

    private static Door openDoor(BlockFace facing, Bisected.Half half) {
        Door door = (Door) Material.DARK_OAK_DOOR.createBlockData();
        door.setFacing(facing);
        door.setHalf(half);
        door.setOpen(true);
        return door;
    }
}
