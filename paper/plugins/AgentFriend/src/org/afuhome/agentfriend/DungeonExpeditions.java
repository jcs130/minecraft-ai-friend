package org.afuhome.agentfriend;

import java.util.List;
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
        Site site = site(id);
        if (site == null) {
            player.sendMessage(ChatColor.RED + "没有这个遗迹；可选 "
                    + String.join("、", SITES.stream().map(Site::id).toList()) + "；复制准确ID后 /mycli guild travel <ID>。");
            return;
        }
        if (player.getGameMode() == org.bukkit.GameMode.SPECTATOR) {
            player.sendMessage(ChatColor.RED + "旁观者不参与遗迹远征。"); return;
        }
        World world = Bukkit.getWorld("world");
        if (world == null) { player.sendMessage(ChatColor.RED + "主世界尚未加载；请服主检查世界启动日志并恢复加载，再重试，不重新生成原世界。"); return; }
        player.sendMessage(ChatColor.YELLOW + "正在寻找「" + site.name() + "」附近的安全落脚处……");
        world.getChunkAtAsync(site.approachX() >> 4, site.approachZ() >> 4)
                .whenComplete((chunk, error) -> Bukkit.getScheduler().runTask(plugin, () -> {
                    if (!player.isOnline()) return;
                    if (error != null || chunk == null) {
                        player.sendMessage(ChatColor.RED + "遗迹附近地形暂时无法加载，请稍后再试。"); return;
                    }
                    Location landing = safeLanding(world, site);
                    if (landing == null) {
                        player.sendMessage(ChatColor.RED + "没有找到安全落脚处，传送已取消；不要拆开保护建筑。/mycli guide explore 查看遗迹探索与路线，或联系服主检查入口。"); return;
                    }
                    if (!plugin.travelMagic().teleport(player, landing, "expedition:" + site.id(),
                            "遗迹远征术", TravelMagic.DISTANT_MANA)) return;
                    player.sendMessage(ChatColor.GREEN + "已到「" + site.name() + "」附近；遗迹中心约在 "
                            + site.x() + ", " + site.z() + "。向那里探索约 70 格，留意怪物和入口。");
                    player.sendMessage("MC_SITE id=" + site.id() + " " + LocationOutput.fields(landing)
                            + " centerX=" + site.x() + " centerZ=" + site.z());
                }));
    }

    private Location safeLanding(World world, Site site) {
        int x0 = site.approachX(), z0 = site.approachZ();
        for (int radius = 0; radius <= 4; radius++) for (int dx = -radius; dx <= radius; dx++)
            for (int dz = -radius; dz <= radius; dz++) {
                int x = x0 + dx, z = z0 + dz;
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
