package org.afuhome.agentfriend;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.World;
import org.bukkit.boss.BarColor;
import org.bukkit.boss.BarStyle;
import org.bukkit.boss.BossBar;
import org.bukkit.entity.BlockDisplay;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

/** Server-authoritative prospecting; only the caster sees the temporary outline. */
final class ProspectingSpell {
    private static final int BASE_RANGE = 24;
    private static final int MAX_LEVEL_BONUS = 16;
    private static final int IMPRINT_BONUS = 8;
    private static final int DURATION_TICKS = 240;
    private static final long COOLDOWN_MS = 30_000L;
    private static final long ATTEMPT_INTERVAL_MS = 5_000L;
    private static final double MANA_COST = 6.0;
    private static final Map<Material, String> ORES = Map.ofEntries(
            Map.entry(Material.COAL_ORE, "煤矿"), Map.entry(Material.DEEPSLATE_COAL_ORE, "煤矿"),
            Map.entry(Material.IRON_ORE, "铁矿"), Map.entry(Material.DEEPSLATE_IRON_ORE, "铁矿"),
            Map.entry(Material.COPPER_ORE, "铜矿"), Map.entry(Material.DEEPSLATE_COPPER_ORE, "铜矿"),
            Map.entry(Material.GOLD_ORE, "金矿"), Map.entry(Material.DEEPSLATE_GOLD_ORE, "金矿"),
            Map.entry(Material.REDSTONE_ORE, "红石矿"), Map.entry(Material.DEEPSLATE_REDSTONE_ORE, "红石矿"),
            Map.entry(Material.LAPIS_ORE, "青金石矿"), Map.entry(Material.DEEPSLATE_LAPIS_ORE, "青金石矿"),
            Map.entry(Material.DIAMOND_ORE, "钻石矿"), Map.entry(Material.DEEPSLATE_DIAMOND_ORE, "钻石矿"),
            Map.entry(Material.EMERALD_ORE, "绿宝石矿"), Map.entry(Material.DEEPSLATE_EMERALD_ORE, "绿宝石矿"),
            Map.entry(Material.NETHER_GOLD_ORE, "下界金矿"), Map.entry(Material.NETHER_QUARTZ_ORE, "下界石英"),
            Map.entry(Material.ANCIENT_DEBRIS, "远古残骸"));

    private record Trace(Location ore, long expiresAt, long durationMs, BossBar bar, BlockDisplay outline) { }
    private final AgentFriendPlugin plugin;
    private final Map<UUID, Long> lastCast = new HashMap<>();
    private final Map<UUID, Long> lastAttempt = new HashMap<>();
    private final Map<UUID, Trace> traces = new HashMap<>();
    private BukkitTask task;

    ProspectingSpell(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 10L, 10L);
    }

    Long remainingCooldownMs(Player player) {
        return Math.max(0L, lastCast.getOrDefault(player.getUniqueId(), 0L) + COOLDOWN_MS - System.currentTimeMillis());
    }

    static long totalCooldownMs() { return COOLDOWN_MS; }

    static int rangeFor(int miningLevel, boolean imprintedTool) {
        return BASE_RANGE + Math.min(MAX_LEVEL_BONUS, Math.max(0, miningLevel) / 5 * 2)
                + (imprintedTool ? IMPRINT_BONUS : 0);
    }

    void cast(Player player, String requested) {
        String category = requested.isBlank() ? "all" : requested.toLowerCase(Locale.ROOT);
        if (!category.equals("all") && !category.equals("coal") && !category.equals("iron")
                && !category.equals("copper") && !category.equals("gold") && !category.equals("gems")
                && !category.equals("diamond") && !category.equals("redstone")
                && !category.equals("ancient")) {
            player.sendMessage(ChatColor.RED + "探矿类型：all|coal|iron|copper|gold|gems|diamond|redstone|ancient。");
            return;
        }
        long wait = remainingCooldownMs(player);
        if (wait > 0) {
            player.sendMessage(ChatColor.YELLOW + "探矿术冷却还剩 " + ((wait + 999) / 1000) + " 秒。");
            return;
        }
        Location source = player.getLocation();
        World world = source.getWorld();
        if (world == null || world.getEnvironment() == World.Environment.THE_END) {
            player.sendMessage(ChatColor.YELLOW + "这里没有可探测的矿脉。");
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastAttempt.getOrDefault(player.getUniqueId(), 0L) < ATTEMPT_INTERVAL_MS) {
            player.sendMessage(ChatColor.YELLOW + "探矿术请稍等 5 秒再试。");
            return;
        }
        lastAttempt.put(player.getUniqueId(), now);
        int miningLevel = plugin.miningLevel(player);
        boolean imprintedTool = plugin.hasImprintedProspectTool(player.getInventory().getItemInMainHand());
        int range = rangeFor(miningLevel, imprintedTool);
        Location closest = null;
        String oreName = null;
        Material oreMaterial = null;
        int bestDistanceSquared = range * range + 1;
        int sx = source.getBlockX(), sy = source.getBlockY(), sz = source.getBlockZ();
        // Scan expanding cubic shells. Once shell r has a hit closer than r+1,
        // all remaining shells are farther away, so ordinary casts stay cheap.
        for (int shell = 0; shell <= range && shell * shell < bestDistanceSquared; shell++) {
            for (int dx = -shell; dx <= shell; dx++) for (int dz = -shell; dz <= shell; dz++) {
                if (!world.isChunkLoaded((sx + dx) >> 4, (sz + dz) >> 4)) continue;
                for (int dy = -shell; dy <= shell; dy++) {
                if (Math.max(Math.max(Math.abs(dx), Math.abs(dy)), Math.abs(dz)) != shell) continue;
                int distanceSquared = dx * dx + dy * dy + dz * dz;
                if (distanceSquared >= bestDistanceSquared || distanceSquared > range * range) continue;
                int y = sy + dy;
                if (y < world.getMinHeight() || y >= world.getMaxHeight()) continue;
                Material material = world.getBlockAt(sx + dx, y, sz + dz).getType();
                if (!ORES.containsKey(material) || !matches(material, category)) continue;
                bestDistanceSquared = distanceSquared;
                closest = new Location(world, sx + dx + 0.5, y + 0.5, sz + dz + 0.5);
                oreName = ORES.get(material);
                oreMaterial = material;
                }
            }
        }
        if (closest == null) {
            player.sendMessage(ChatColor.YELLOW + "周围 " + range + " 格内没有发现这种矿脉；未消耗魔力，也未进入冷却。");
            return;
        }
        if (!plugin.spendMana(player, MANA_COST)) return;
        lastCast.put(player.getUniqueId(), now);
        remove(player.getUniqueId());
        BossBar bar = Bukkit.createBossBar("§d✦ 探矿 " + oreName + "  §fX=" + closest.getBlockX()
                + " Y=" + closest.getBlockY() + " Z=" + closest.getBlockZ(),
                BarColor.PURPLE, BarStyle.SOLID);
        bar.addPlayer(player);
        BlockDisplay outline = null;
        if (!plugin.floodgatePlayer(player.getUniqueId())) {
            Location blockCorner = closest.getBlock().getLocation();
            outline = world.spawn(blockCorner, BlockDisplay.class, display -> {
                display.setBlock(Material.GLASS.createBlockData());
                display.setGlowing(true);
                display.setPersistent(false);
                display.setVisibleByDefault(false);
            });
            player.showEntity(plugin, outline);
        }
        int durationTicks = DURATION_TICKS + (plugin.mastery().rank(player, "prospect") - 1) * 60;
        traces.put(player.getUniqueId(), new Trace(closest, now + durationTicks * 50L,
                durationTicks * 50L, bar, outline));
        plugin.presentSpell(player, "prospect");
        plugin.mastery().successfulCast(player, "prospect");
        plugin.publishSkill(player, "prospect", "发现" + oreName, closest);
        player.sendMessage(ChatColor.LIGHT_PURPLE + "✦ 探矿术找到" + oreName
                + "：dimension=" + world.getKey() + " X=" + closest.getBlockX()
                + " Y=" + closest.getBlockY() + " Z=" + closest.getBlockZ()
                + " ore=" + oreMaterial.getKey() + "（方块坐标）。");
        player.sendMessage(ChatColor.GRAY + "范围 " + range + " 格，挖矿等级 " + miningLevel
                + (imprintedTool ? "，刻印工具 +8" : "")
                + "；轮廓/墙面光框和粒子指向线持续 " + (durationTicks / 20)
                + " 秒；消耗 6 魔力，冷却 30 秒。");
        update(player, traces.get(player.getUniqueId()), now);
    }

    private static boolean matches(Material ore, String category) {
        String name = ore.name();
        return switch (category) {
            case "all" -> true;
            case "coal" -> name.contains("COAL_ORE");
            case "iron" -> name.contains("IRON_ORE");
            case "copper" -> name.contains("COPPER_ORE");
            case "gold" -> name.contains("GOLD_ORE");
            case "gems" -> name.contains("DIAMOND_ORE") || name.contains("EMERALD_ORE") || name.contains("LAPIS_ORE");
            case "diamond" -> name.contains("DIAMOND_ORE");
            case "redstone" -> name.contains("REDSTONE_ORE");
            case "ancient" -> ore == Material.ANCIENT_DEBRIS;
            default -> false;
        };
    }

    private void tick() {
        long now = System.currentTimeMillis();
        for (UUID id : new java.util.ArrayList<>(traces.keySet())) {
            Player player = Bukkit.getPlayer(id);
            Trace trace = traces.get(id);
            if (player == null || trace == null || !player.isOnline() || now >= trace.expiresAt()
                    || player.getWorld() != trace.ore().getWorld()
                    || !ORES.containsKey(trace.ore().getBlock().getType())) {
                remove(id);
                continue;
            }
            update(player, trace, now);
        }
    }

    private void update(Player player, Trace trace, long now) {
        trace.bar().setProgress(Math.max(0.0, Math.min(1.0, (trace.expiresAt() - now) / (double) trace.durationMs())));
        WallTraceParticles.guide(player, trace.ore(), true);
    }

    private void remove(UUID id) {
        Trace trace = traces.remove(id);
        if (trace != null) {
            trace.bar().removeAll();
            if (trace.outline() != null && trace.outline().isValid()) trace.outline().remove();
        }
    }

    void clear() {
        if (task != null) task.cancel();
        for (UUID id : new java.util.ArrayList<>(traces.keySet())) remove(id);
        lastCast.clear();
        lastAttempt.clear();
    }
}
