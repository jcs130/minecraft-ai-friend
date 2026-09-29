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
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;
import org.bukkit.util.Vector;

/** Server-authoritative, short-range prospecting; never sends hidden block positions to clients. */
final class ProspectingSpell {
    private static final int RANGE = 12;
    private static final int DURATION_TICKS = 240;
    private static final long COOLDOWN_MS = 30_000L;
    private static final long ATTEMPT_INTERVAL_MS = 2_000L;
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

    private record Trace(Location ore, String name, long expiresAt, BossBar bar) { }
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
            player.sendMessage(ChatColor.YELLOW + "探矿术请稍等 2 秒再试。");
            return;
        }
        lastAttempt.put(player.getUniqueId(), now);
        Location closest = null;
        String oreName = null;
        int bestDistanceSquared = RANGE * RANGE + 1;
        int sx = source.getBlockX(), sy = source.getBlockY(), sz = source.getBlockZ();
        for (int dx = -RANGE; dx <= RANGE; dx++) for (int dz = -RANGE; dz <= RANGE; dz++) {
            if (!world.isChunkLoaded((sx + dx) >> 4, (sz + dz) >> 4)) continue;
            for (int dy = -RANGE; dy <= RANGE; dy++) {
                int distanceSquared = dx * dx + dy * dy + dz * dz;
                if (distanceSquared >= bestDistanceSquared) continue;
                int y = sy + dy;
                if (y < world.getMinHeight() || y >= world.getMaxHeight()) continue;
                Material material = world.getBlockAt(sx + dx, y, sz + dz).getType();
                if (!ORES.containsKey(material) || !matches(material, category)) continue;
                bestDistanceSquared = distanceSquared;
                closest = new Location(world, sx + dx + 0.5, y + 0.5, sz + dz + 0.5);
                oreName = ORES.get(material);
            }
        }
        if (closest == null) {
            player.sendMessage(ChatColor.YELLOW + "12 格内没有发现这种矿脉；未消耗魔力，也未进入冷却。");
            return;
        }
        if (!plugin.spendMana(player, MANA_COST)) return;
        lastCast.put(player.getUniqueId(), now);
        remove(player.getUniqueId());
        BossBar bar = Bukkit.createBossBar("探矿术", BarColor.PURPLE, BarStyle.SOLID);
        bar.addPlayer(player);
        traces.put(player.getUniqueId(), new Trace(closest, oreName, now + DURATION_TICKS * 50L, bar));
        player.sendMessage(ChatColor.LIGHT_PURPLE + "✦ 探矿术找到" + oreName + "。看屏幕顶部的方向提示；持续 12 秒。消耗 6 魔力，冷却 30 秒。");
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
        Location at = player.getLocation(), ore = trace.ore();
        double dx = ore.getX() - at.getX(), dz = ore.getZ() - at.getZ();
        double distance = at.distance(ore);
        String direction;
        if (Math.hypot(dx, dz) < 1.25) direction = "脚下附近";
        else {
            double targetYaw = Math.toDegrees(Math.atan2(-dx, dz));
            double delta = ((targetYaw - at.getYaw() + 540) % 360) - 180;
            String[] sectors = {"前方 ↑", "右前 ↗", "右侧 →", "右后 ↘", "后方 ↓", "左后 ↙", "左侧 ←", "左前 ↖"};
            direction = sectors[Math.floorMod((int) Math.round(delta / 45), 8)];
        }
        int dy = ore.getBlockY() - at.getBlockY();
        String height = Math.abs(dy) <= 1 ? "同层" : (dy > 0 ? "上方" : "下方") + Math.abs(dy) + "格";
        trace.bar().setTitle("§d✦ 探矿 " + trace.name() + "  §f" + direction + " · " + Math.round(distance) + "格 · " + height);
        trace.bar().setProgress(Math.max(0.0, Math.min(1.0, (trace.expiresAt() - now) / (double) (DURATION_TICKS * 50L))));
        Location eye = player.getEyeLocation();
        Vector towardOre = ore.toVector().subtract(eye.toVector());
        if (towardOre.lengthSquared() > 0.001) {
            Location spark = eye.add(towardOre.normalize().multiply(1.1));
            player.spawnParticle(Particle.END_ROD, spark, 1, 0.12, 0.12, 0.12, 0.0);
        }
    }

    private void remove(UUID id) {
        Trace trace = traces.remove(id);
        if (trace != null) trace.bar().removeAll();
    }

    void clear() {
        if (task != null) task.cancel();
        for (UUID id : new java.util.ArrayList<>(traces.keySet())) remove(id);
        lastCast.clear();
        lastAttempt.clear();
    }
}
