package org.afuhome.agentfriend;

import java.util.List;
import java.util.function.Consumer;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.HeightMap;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;

/** Safe approach points for existing vanilla-protocol worldgen dungeons. */
final class DungeonExpeditions {
    record Site(String id, String name, Material icon, String hint,
            int x, int z, int approachX, int approachZ) { }
    static final List<Site> SITES = List.of(
            new Site("undead_crypt", "亡灵墓穴", Material.BONE, "古墓探险",
                    -416, 672, -344, 680),
            new Site("creeping_crypt", "蔓生墓穴", Material.MOSS_BLOCK, "植被迷宫",
                    1168, 224, 1096, 232),
            new Site("desert_ruins", "沙漠遗迹", Material.CHISELED_SANDSTONE, "沙海寻宝",
                    -3296, -2096, -3224, -2088),
            new Site("illager_camp", "掠夺者营地", Material.CROSSBOW, "战斗挑战；推荐结伴",
                    -1072, -1120, -1000, -1120),
            new Site("ruin_town", "失落古镇", Material.MAP, "废墟寻宝",
                    -1248, -1392, -1176, -1404),
            new Site("bunker", "地下堡垒", Material.STONE_BRICKS, "地下探索；推荐带火把",
                    -1184, -1552, -1112, -1552));

    private final AgentFriendPlugin plugin;

    DungeonExpeditions(AgentFriendPlugin plugin) { this.plugin = plugin; }

    static Site site(String id) {
        return SITES.stream().filter(site -> site.id().equals(id)).findFirst().orElse(null);
    }

    static boolean reached(Location at, String id) {
        Site site = site(id);
        return site != null && at != null && at.getWorld() != null
                && at.getWorld().getName().equals("world")
                && Math.abs(at.getX() - site.x()) <= 36
                && Math.abs(at.getZ() - site.z()) <= 36;
    }

    void travel(Player player, String id) {
        travel(player, id, outcome -> {
            if (!outcome.success() && !outcome.reason().equals("loading"))
                player.sendMessage(ChatColor.RED + "[" + outcome.reason() + "] 遗迹传送未完成、未耗魔。"
                        + "下一步：/mycli dungeon " + (site(id) == null ? "list" : "info " + id)
                        + "；检查活动状态与安全落点后再决定是否重试，不要连续重发。");
        });
    }

    void travel(Player player, String id, Consumer<WaypointManager.Outcome> reply) {
        Site site = site(id);
        if (site == null) {
            player.sendMessage(ChatColor.RED + "没有这个遗迹；可选 "
                    + String.join("、", SITES.stream().map(Site::id).toList()) + "；复制准确ID后 /mycli guild travel <ID>。");
            reply.accept(new WaypointManager.Outcome(false, "unknown_site"));
            return;
        }
        if (player.getGameMode() == org.bukkit.GameMode.SPECTATOR) {
            player.sendMessage(ChatColor.RED + "旁观者不参与遗迹远征。");
            reply.accept(new WaypointManager.Outcome(false, "spectator")); return;
        }
        World world = Bukkit.getWorld("world");
        if (world == null) { player.sendMessage(ChatColor.RED + "主世界尚未加载；请服主检查世界启动日志并恢复加载，再重试，不重新生成原世界。"); reply.accept(new WaypointManager.Outcome(false, "world_unavailable")); return; }
        player.sendMessage(ChatColor.YELLOW + "正在寻找「" + site.name() + "」附近的安全落脚处……");
        Location approach = new Location(world, site.approachX() + .5, 0, site.approachZ() + .5);
        plugin.waypoints().travel(player, "expedition:" + site.id(), "遗迹远征·" + site.name(), approach,
                () -> true, TravelMagic.DISTANT_MANA, () -> safeLanding(world, site), outcome -> {
                    if (outcome.success()) {
                    Location landing = player.getLocation();
                    player.sendMessage(ChatColor.GREEN + "已到「" + site.name() + "」附近；遗迹中心约在 "
                            + site.x() + ", " + site.z() + "。向那里探索约 70 格，留意怪物和入口。");
                    player.sendMessage("MC_SITE id=" + site.id() + " " + LocationOutput.fields(landing)
                            + " centerX=" + site.x() + " centerZ=" + site.z());
                    }
                    reply.accept(outcome);
                });
    }

    private Location safeLanding(World world, Site site) {
        int x0 = site.approachX(), z0 = site.approachZ();
        for (int radius = 0; radius <= 4; radius++) for (int dx = -radius; dx <= radius; dx++)
            for (int dz = -radius; dz <= radius; dz++) {
                int x = x0 + dx, z = z0 + dz;
                if (!world.isChunkLoaded(x >> 4, z >> 4)) continue;
                int top = Math.min(world.getMaxHeight() - 3,
                        world.getHighestBlockYAt(x, z, HeightMap.MOTION_BLOCKING_NO_LEAVES) + 2);
                for (int y = top; y >= top - 8 && y > world.getMinHeight(); y--) {
                    Block floor = world.getBlockAt(x, y, z);
                    Block feet = world.getBlockAt(x, y + 1, z);
                    Block head = world.getBlockAt(x, y + 2, z);
                    Material material = floor.getType();
                    if (!material.isSolid() || material == Material.MAGMA_BLOCK
                            || material == Material.CACTUS || material == Material.CAMPFIRE
                            || material == Material.SOUL_CAMPFIRE || material == Material.POWDER_SNOW
                            || !feet.isPassable() || !head.isPassable()
                            || feet.isLiquid() || head.isLiquid()
                            || feet.getType() == Material.POWDER_SNOW) continue;
                    return new Location(world, x + 0.5, y + 1, z + 0.5, 0, 0);
                }
            }
        return null;
    }
}
