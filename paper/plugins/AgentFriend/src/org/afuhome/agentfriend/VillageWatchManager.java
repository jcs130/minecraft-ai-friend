package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import io.netty.buffer.Unpooled;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.DiscardedPayload;
import net.minecraft.resources.ResourceLocation;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.FluidCollisionMode;
import org.bukkit.HeightMap;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Raid;
import org.bukkit.World;
import org.bukkit.command.CommandSender;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Raider;
import org.bukkit.entity.Villager;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.MerchantRecipe;

/** One private alert per nearby raid/patrol, plus read-only village help for Agents. */
final class VillageWatchManager implements Listener {
    static final String CHANNEL = "mcagent:village";
    private static final int MIN_X = -630, MAX_X = -470, MIN_Z = -530, MAX_Z = -380;
    private static final int WATCH_MARGIN = 48;
    private static final int MIN_CHUNK_X = (MIN_X - WATCH_MARGIN) >> 4;
    private static final int MAX_CHUNK_X = (MAX_X + WATCH_MARGIN) >> 4;
    private static final int MIN_CHUNK_Z = (MIN_Z - WATCH_MARGIN) >> 4;
    private static final int MAX_CHUNK_Z = (MAX_Z + WATCH_MARGIN) >> 4;
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    static final int SUPPORT_MANA = TravelMagic.DISTANT_MANA;
    static final long SUPPORT_COOLDOWN_MS = 20_000L;
    private static final long CONFIRM_MS = 4_000L, REGROUP_MS = 20_000L;
    private static final int SURFACE_TOLERANCE = 10;

    private record Threat(boolean active, String source, Location at, int count, List<Raider> enemies) { }
    private final AgentFriendPlugin plugin;
    private final DungeonManager dungeon;
    private Threat current = emptyThreat();
    private String incidentId = "";
    private long enemySeenAt, missingSince;
    private boolean announced;
    private final Map<UUID, Long> supportAt = new HashMap<>();
    private final Map<UUID, String> lastAlert = new HashMap<>();
    private boolean scanPending;
    boolean activeThreat() { return current.active() && (announced || current.source().equals("raid")); }
    long remainingSupportCooldownMs(Player player) {
        return Math.max(0, supportAt.getOrDefault(player.getUniqueId(), 0L)
                + SUPPORT_COOLDOWN_MS - System.currentTimeMillis());
    }
    private static Threat emptyThreat() { return new Threat(false, "none", null, 0, List.of()); }

    VillageWatchManager(AgentFriendPlugin plugin, DungeonManager dungeon) {
        this.plugin = plugin;
        this.dungeon = dungeon;
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
        Bukkit.getScheduler().runTaskTimer(plugin, this::scan, 40L, 40L);
    }

    private World villageWorld() { return Bukkit.getWorld("world"); }

    private boolean nearVillage(Location at) {
        if (at == null || at.getWorld() != villageWorld()) return false;
        int dx = Math.max(Math.max(MIN_X - at.getBlockX(), 0), at.getBlockX() - MAX_X);
        int dz = Math.max(Math.max(MIN_Z - at.getBlockZ(), 0), at.getBlockZ() - MAX_Z);
        return dx <= WATCH_MARGIN && dz <= WATCH_MARGIN && dx * dx + dz * dz <= WATCH_MARGIN * WATCH_MARGIN;
    }

    private Threat snapshot() {
        World world = villageWorld();
        if (world == null) return emptyThreat();
        List<Raider> nearby = nearbyRaiders(world);
        Raid raid = world.getRaids().stream().filter(candidate ->
                candidate.getStatus() == Raid.RaidStatus.ONGOING && nearVillage(candidate.getLocation()))
                .findFirst().orElse(null);
        nearby.sort(Comparator.comparing(raider -> raider.getUniqueId().toString()));
        Location at = nearby.isEmpty() ? raid == null ? null : raid.getLocation() : nearby.get(0).getLocation();
        if (raid != null) return new Threat(true, "raid", at, nearby.size(), List.copyOf(nearby));
        if (!nearby.isEmpty()) return new Threat(true, "patrol", at, nearby.size(), List.copyOf(nearby));
        return emptyThreat();
    }

    private boolean actionableRaider(Raider raider) {
        // A genuine ongoing raid can have a combatant in a cave. Unrelated cave
        // structure mobs and wild witches are not a surface patrol alarm.
        Raid raid = raider.getRaid();
        if (raid != null && raid.getStatus() == Raid.RaidStatus.ONGOING && nearVillage(raid.getLocation())) return true;
        if (raider.getType() == EntityType.WITCH) return false;
        Location at = raider.getLocation();
        int surface = at.getWorld().getHighestBlockYAt(at.getBlockX(), at.getBlockZ(), HeightMap.MOTION_BLOCKING_NO_LEAVES) + 1;
        return Math.abs(at.getY() - surface) <= SURFACE_TOLERANCE;
    }

    private List<Raider> nearbyRaiders(World world) {
        List<Raider> nearby = new ArrayList<>();
        // A fixed 17 x 17 footprint covers the existing rounded boundary. Query
        // loaded chunks only; heightmaps are read only for local Raider columns.
        for (int x = MIN_CHUNK_X; x <= MAX_CHUNK_X; x++) {
            for (int z = MIN_CHUNK_Z; z <= MAX_CHUNK_Z; z++) {
                if (!world.isChunkLoaded(x, z)) continue;
                for (Entity entity : world.getChunkAt(x, z).getEntities()) {
                    if (entity instanceof Raider raider && raider.isValid() && !raider.isDead()
                            && nearVillage(raider.getLocation()) && actionableRaider(raider)) nearby.add(raider);
                }
            }
        }
        return nearby;
    }

    private void scheduleScan() {
        if (scanPending) return;
        scanPending = true;
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            scanPending = false;
            scan();
        }, 1L);
    }

    private void scan() {
        long now = System.currentTimeMillis();
        supportAt.entrySet().removeIf(entry -> now - entry.getValue() >= SUPPORT_COOLDOWN_MS);
        refresh(snapshot(), now);
    }

    private void refresh(Threat next, long now) {
        if (!next.active()) {
            enemySeenAt = 0;
            if (current.active() && announced) {
                for (Player player : Bukkit.getOnlinePlayers()) publish(player, "clear", next);
                plugin.getLogger().info("Village threat cleared: event=" + incidentId);
            }
            if (missingSince == 0) missingSince = now;
            if (now - missingSince >= REGROUP_MS) { incidentId = ""; announced = false; lastAlert.clear(); }
            current = next;
            return;
        }
        missingSince = 0;
        if (incidentId.isEmpty()) incidentId = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        if (next.count() == 0) enemySeenAt = 0;
        else if (enemySeenAt == 0) enemySeenAt = now;
        if (!announced && next.count() > 0 && now - enemySeenAt >= CONFIRM_MS) {
            announced = true;
            for (Player player : Bukkit.getOnlinePlayers()) {
                publish(player, "alert", next);
                alertChat(player, next);
            }
            plugin.getLogger().info("Village threat detected: event=" + incidentId + " source=" + next.source()
                    + " count=" + next.count() + " at=" + coords(next.at()));
        } else if (announced && (current.count() == 0) != (next.count() == 0)) {
            for (Player player : Bukkit.getOnlinePlayers()) publish(player, "update", next);
        }
        current = next;
    }

    private String coords(Location at) {
        return at == null ? "none" : at.getBlockX() + " " + at.getBlockY() + " " + at.getBlockZ();
    }

    private void alertChat(Player player, Threat threat) {
        if (player.getGameMode() == GameMode.SPECTATOR) return;
        if (incidentId.equals(lastAlert.put(player.getUniqueId(), incidentId))) return;
        if (plugin.isRegisteredAgent(player)) {
            // Cortico treats vanilla whispers as urgent input; plain system chat is only rendered.
            // Player names are restricted before they enter a console command.
            if (player.getName().matches("[A-Za-z0-9_]{1,16}")) {
                JsonObject wake = new JsonObject();
                wake.addProperty("kind", "village_alert");
                wake.addProperty("eventId", incidentId);
                wake.addProperty("source", threat.source());
                wake.addProperty("count", threat.count());
                if (threat.at() != null) {
                    wake.addProperty("x", threat.at().getBlockX());
                    wake.addProperty("y", threat.at().getBlockY());
                    wake.addProperty("z", threat.at().getBlockZ());
                }
                wake.addProperty("action", "check_health_then_defend");
                wake.addProperty("cmd", supportCommand());
                Bukkit.dispatchCommand(Bukkit.getConsoleSender(),
                        "minecraft:tell " + player.getName() + " MC_VILLAGE_ALERT " + wake);
            } else {
                plugin.getLogger().warning("Invalid Agent player name for village alert: " + player.getUniqueId());
            }
            return;
        }
        player.sendMessage(ChatColor.GOLD + "村庄外围出现掠夺者！位置 " + coords(threat.at())
                + "；/mycli village threat 查看实时敌情；支援传送术 8 魔力、20 秒冷却。");
        player.sendMessage(Component.text("[支援传送] ", NamedTextColor.AQUA)
                .clickEvent(ClickEvent.runCommand(supportCommand()))
                .hoverEvent(HoverEvent.showText(Component.text("重查敌情，传到敌人附近安全落点；8 魔力")))
                .append(Component.text(supportCommand(), NamedTextColor.GRAY)));
    }

    private String supportCommand() { return "/mycli village support " + incidentId; }

    void command(Player player, String[] args) {
        String action = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "threat";
        switch (action) {
            case "threat", "status", "守望", "状态" -> {
                Threat threat = snapshot();
                refresh(threat, System.currentTimeMillis());
                publish(player, "status", threat);
                player.sendMessage(threat.active()
                        ? ChatColor.GOLD + "村庄外围敌情：" + threat.source() + "，已见 " + threat.count()
                                + " 名掠夺者，坐标 " + coords(threat.at())
                                + (threat.count() == 0 ? "。袭击等待下一波，没有可直达的已加载敌人。"
                                : "。支援用 " + supportCommand() + "；8 魔力、20 秒冷却。")
                        : ChatColor.GREEN + "村庄外围当前没有已加载的地表巡逻队或正在进行的袭击。"
                                + "安全区外仍请留意环境。 未加载区域无法判断。 ");
            }
            case "support", "defend", "支援", "援护" -> {
                if (args.length > 3) { supportResult(player, false, "invalid_argument", null); return; }
                support(player, args.length == 3 ? args[2] : null);
            }
            case "villagers", "trades", "村民", "交易" -> villagers(player);
            default -> player.sendMessage(ChatColor.YELLOW + "用法：/mycli village threat|support [事件ID]|villagers"
                    + "；生活公会收购任务用 /mycli life accept trader_supply。");
        }
    }

    void support(Player player, String expectedIncident) {
        Threat live = snapshot();
        refresh(live, System.currentTimeMillis());
        if (player.getGameMode() != GameMode.SURVIVAL && player.getGameMode() != GameMode.ADVENTURE) {
            supportResult(player, false, "survival_only", null); return;
        }
        if (plugin.dungeonParticipant(player) || plugin.pvpParticipant(player)) {
            supportResult(player, false, "activity_active", null); return;
        }
        if (expectedIncident != null && !expectedIncident.equals(incidentId)) {
            supportResult(player, false, "stale_event", null); return;
        }
        if (!live.active() || live.count() == 0) { supportResult(player, false, "no_live_enemy", null); return; }
        if (!announced) { supportResult(player, false, "confirming", null); return; }
        if (player.isDead() || player.getHealth() < 6) { supportResult(player, false, "low_health", null); return; }
        if (player.isInsideVehicle() || player.isGliding()) { supportResult(player, false, "unstable_travel", null); return; }
        if (remainingSupportCooldownMs(player) > 0) { supportResult(player, false, "cooldown", null); return; }
        if (!plugin.hasMana(player, SUPPORT_MANA)) { supportResult(player, false, "insufficient_mana", null); return; }
        for (Raider enemy : live.enemies()) {
            Location landing = supportLanding(enemy, live.enemies());
            if (landing == null) continue;
            if (!enemy.isValid() || enemy.isDead()) continue;
            if (!plugin.travelMagic().teleport(player, landing, "support", "支援传送术", SUPPORT_MANA)) {
                supportResult(player, false, "teleport_rejected", null); return;
            }
            supportAt.put(player.getUniqueId(), System.currentTimeMillis());
            plugin.refreshAgentState(player);
            supportResult(player, true, "arrived", enemy);
            return;
        }
        supportResult(player, false, "no_safe_landing", null);
    }

    private Location supportLanding(Raider enemy, List<Raider> enemies) {
        Location at = enemy.getLocation();
        World world = at.getWorld();
        int[][] offsets = {{8,0},{-8,0},{0,8},{0,-8},{6,6},{-6,6},{6,-6},{-6,-6},
                {10,0},{-10,0},{0,10},{0,-10},{6,0},{-6,0},{0,6},{0,-6},
                {8,4},{-8,4},{8,-4},{-8,-4},{4,8},{-4,8},{4,-8},{-4,-8}};
        for (int[] offset : offsets) for (int dy : new int[]{0,1,-1,2,-2,3,-3}) {
            int x = at.getBlockX() + offset[0], y = at.getBlockY() + dy, z = at.getBlockZ() + offset[1];
            if (y < world.getMinHeight() + 1 || y >= world.getMaxHeight() - 1 || !world.isChunkLoaded(x >> 4, z >> 4)) continue;
            Location landing = new Location(world, x + .5, y, z + .5);
            if (!world.getWorldBorder().isInside(landing) || !AgentFriendPlugin.safeLanding(landing.getBlock())) continue;
            if (enemies.stream().anyMatch(mob -> mob.getLocation().distanceSquared(landing) < 16)) continue;
            if (!world.getNearbyEntities(landing, .6, 1, .6, other -> other instanceof LivingEntity
                    && (!(other instanceof Player viewer) || viewer.getGameMode() != GameMode.SPECTATOR)).isEmpty()) continue;
            Location eyes = landing.clone().add(0, 1.62, 0);
            org.bukkit.util.Vector direction = enemy.getEyeLocation().toVector().subtract(eyes.toVector());
            double distance = direction.length();
            if (world.rayTraceBlocks(eyes, direction, distance, FluidCollisionMode.NEVER, true) != null) continue;
            landing.setDirection(direction);
            return landing;
        }
        return null;
    }

    private void supportResult(Player player, boolean success, String reason, Raider enemy) {
        JsonObject data = new JsonObject();
        data.addProperty("schemaVersion", 1);
        data.addProperty("kind", "support");
        data.addProperty("success", success);
        data.addProperty("reason", reason);
        data.addProperty("eventId", incidentId);
        data.addProperty("requiredMana", SUPPORT_MANA);
        data.addProperty("spentMana", success ? SUPPORT_MANA : 0);
        data.addProperty("cooldownRemainingMs", remainingSupportCooldownMs(player));
        if (success) {
            data.add("position", position(player.getLocation()));
            data.addProperty("dimension", player.getWorld().getKey().toString());
            data.add("enemy", enemyData(enemy));
            player.sendMessage(ChatColor.GREEN + "支援传送术已抵达；敌人在 " + coords(enemy.getLocation()) + "，请确认目标后参战。");
        } else player.sendMessage(ChatColor.YELLOW + "支援传送未施放：" + switch (reason) {
            case "stale_event" -> "这条警报已过期，请重查 /mycli village threat。";
            case "no_live_enemy" -> "敌人已消失或尚未加载，不传送、不扣魔力。";
            case "confirming" -> "正在确认敌情，稍后重查。";
            case "low_health" -> "生命少于3颗心，先治疗。";
            case "activity_active" -> "先安全退出试炼/PvP。";
            case "cooldown" -> "还需等待 " + ((remainingSupportCooldownMs(player) + 999) / 1000) + " 秒。";
            case "no_safe_landing" -> "敌人附近没有可见且安全的落点，不扣魔力。";
            case "insufficient_mana" -> "需要8魔力。";
            case "survival_only" -> "仅生存/冒险玩家可用。";
            default -> "当前位置或参数不允许传送。";
        });
        send(player, data);
        player.sendMessage("MC_VILLAGE_SUPPORT " + data);
    }

    private static JsonObject position(Location at) {
        JsonObject data = new JsonObject();
        data.addProperty("x", at.getBlockX()); data.addProperty("y", at.getBlockY()); data.addProperty("z", at.getBlockZ());
        return data;
    }
    private static JsonObject enemyData(Raider enemy) {
        JsonObject data = position(enemy.getLocation());
        data.addProperty("uuid", enemy.getUniqueId().toString());
        data.addProperty("type", enemy.getType().getKey().toString());
        return data;
    }

    void audit(CommandSender sender) {
        Threat live = snapshot();
        JsonObject data = new JsonObject();
        data.addProperty("schemaVersion", 1);
        data.addProperty("active", live.active());
        data.addProperty("source", live.source());
        data.addProperty("count", live.count());
        data.addProperty("eventId", incidentId);
        data.addProperty("confirmed", announced && live.count() > 0);
        data.addProperty("loadedOnly", true);
        data.addProperty("surfaceTolerance", SURFACE_TOLERANCE);
        if (live.at() != null) data.add("position", position(live.at()));
        JsonArray enemies = new JsonArray();
        live.enemies().stream().limit(8).forEach(enemy -> enemies.add(enemyData(enemy)));
        data.add("enemies", enemies);
        sender.sendMessage("MC_VILLAGE_AUDIT " + data);
    }

    private void villagers(Player player) {
        List<Villager> nearby = new ArrayList<>(player.getWorld().getEntitiesByClass(Villager.class).stream()
                .filter(v -> v.isValid() && v.isAdult() && v.getProfession() != Villager.Profession.NONE
                        && v.getProfession() != Villager.Profession.NITWIT
                        && v.getLocation().distanceSquared(player.getLocation()) <= 96 * 96)
                .toList());
        nearby.sort(Comparator.comparingDouble(v -> v.getLocation().distanceSquared(player.getLocation())));
        JsonArray list = new JsonArray();
        for (Villager villager : nearby.subList(0, Math.min(12, nearby.size()))) {
            JsonObject item = new JsonObject();
            item.addProperty("uuid", villager.getUniqueId().toString());
            item.addProperty("profession", villager.getProfession().name().toLowerCase(Locale.ROOT));
            item.addProperty("x", villager.getLocation().getBlockX());
            item.addProperty("y", villager.getLocation().getBlockY());
            item.addProperty("z", villager.getLocation().getBlockZ());
            JsonArray buys = new JsonArray();
            for (MerchantRecipe recipe : villager.getRecipes()) {
                if (recipe.getResult().getType() != Material.EMERALD || recipe.getIngredients().isEmpty()) continue;
                ItemStack cost = recipe.getIngredients().get(0);
                if (cost.getType() == Material.EMERALD) continue;
                JsonObject buy = new JsonObject();
                buy.addProperty("item", cost.getType().getKey().toString());
                buy.addProperty("count", cost.getAmount());
                buy.addProperty("emeralds", recipe.getResult().getAmount());
                buys.add(buy);
                if (buys.size() == 4) break;
            }
            item.add("buys", buys);
            list.add(item);
            player.sendMessage(ChatColor.AQUA + "村民 " + item.get("profession").getAsString()
                    + " @ " + coords(villager.getLocation()) + "；收购 "
                    + (buys.isEmpty() ? "当前无绿宝石报价" : buys.toString()));
        }
        if (list.size() == 0) player.sendMessage(ChatColor.YELLOW + "96 格内没有已加载的成年职业村民。");
        JsonObject data = new JsonObject();
        data.addProperty("schemaVersion", 1);
        data.addProperty("kind", "villagers");
        data.addProperty("loadedOnly", true);
        data.add("villagers", list);
        send(player, data);
    }

    @EventHandler public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (!player.isOnline()) return;
            Threat threat = snapshot();
            refresh(threat, System.currentTimeMillis());
            if (threat.active() && threat.count() > 0 && announced) {
                publish(player, incidentId.equals(lastAlert.get(player.getUniqueId())) ? "status" : "alert", threat);
                alertChat(player, threat);
            }
        }, 40L);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onRaiderDeath(EntityDeathEvent event) {
        if (!(event.getEntity() instanceof Raider raider) || !nearVillage(raider.getLocation()) || !actionableRaider(raider)) return;
        Player killer = raider.getKiller();
        if (killer == null || killer.getGameMode() == GameMode.CREATIVE
                || killer.getGameMode() == GameMode.SPECTATOR) return;
        String day = LocalDate.now(ZONE).toString();
        String path = "village-defense." + killer.getUniqueId() + "." + day;
        int kills = plugin.getConfig().getInt(path + ".kills") + 1;
        plugin.getConfig().set(path + ".kills", kills);
        boolean rewarded = plugin.getConfig().getBoolean(path + ".rewarded");
        if (!rewarded && dungeon.queueGuildRewards(killer.getUniqueId(), 2, Material.BREAD, 2)) {
            plugin.getConfig().set(path + ".rewarded", true);
            killer.sendMessage(ChatColor.GREEN + "守望村庄有功！今日首位掠夺者支援奖励："
                    + "绿宝石 ×2、面包 ×2，已送入个人试炼箱。更多敌人仍请协助清除。");
            rewarded = true;
        }
        plugin.saveConfig();
        JsonObject data = new JsonObject();
        data.addProperty("schemaVersion", 1);
        data.addProperty("kind", "defense");
        data.addProperty("killedType", raider.getType().getKey().toString());
        data.addProperty("dayKills", kills);
        data.addProperty("rewardedToday", rewarded);
        send(killer, data);
        scheduleScan();
    }

    private JsonObject publish(Player player, String kind, Threat threat) {
        JsonObject data = new JsonObject();
        data.addProperty("schemaVersion", 1);
        data.addProperty("kind", kind);
        data.addProperty("active", threat.active());
        data.addProperty("source", threat.source());
        data.addProperty("count", threat.count());
        data.addProperty("eventId", incidentId);
        data.addProperty("phase", !threat.active() ? "clear" : threat.count() == 0 ? "waiting_wave" : announced ? "active" : "confirming");
        data.addProperty("loadedOnly", true);
        data.addProperty("supportAvailable", threat.active() && threat.count() > 0 && announced);
        data.addProperty("supportCommand", threat.active() && threat.count() > 0 && announced ? supportCommand() : "");
        data.addProperty("supportMana", SUPPORT_MANA);
        data.addProperty("supportCooldownRemainingMs", remainingSupportCooldownMs(player));
        JsonArray enemies = new JsonArray();
        threat.enemies().stream().limit(8).forEach(enemy -> enemies.add(enemyData(enemy)));
        data.add("enemies", enemies);
        data.addProperty("priority", threat.active() ? "village_defense" : "none");
        data.addProperty("recommendedAction", threat.active() ? "check_health_gear_then_defend_village" : "none");
        data.addProperty("dimension", "minecraft:overworld");
        if (threat.at() != null) {
            JsonObject position = new JsonObject();
            position.addProperty("x", threat.at().getBlockX());
            position.addProperty("y", threat.at().getBlockY());
            position.addProperty("z", threat.at().getBlockZ());
            data.add("position", position);
        }
        String path = "village-defense." + player.getUniqueId() + "." + LocalDate.now(ZONE);
        data.addProperty("dayKills", plugin.getConfig().getInt(path + ".kills"));
        data.addProperty("rewardedToday", plugin.getConfig().getBoolean(path + ".rewarded"));
        send(player, data);
        return data;
    }

    private void send(Player player, JsonObject data) {
        byte[] bytes = data.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 16_384) return;
        if (player.getListeningPluginChannels().contains(CHANNEL))
            player.sendPluginMessage(plugin, CHANNEL, bytes);
        else ((CraftPlayer) player).getHandle().connection.send(new ClientboundCustomPayloadPacket(
                new DiscardedPayload(new ResourceLocation(CHANNEL), Unpooled.wrappedBuffer(bytes))));
    }
}
