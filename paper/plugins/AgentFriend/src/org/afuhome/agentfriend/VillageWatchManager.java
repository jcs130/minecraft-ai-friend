package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import io.netty.buffer.Unpooled;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.DiscardedPayload;
import net.minecraft.resources.ResourceLocation;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Raid;
import org.bukkit.World;
import org.bukkit.craftbukkit.entity.CraftPlayer;
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
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    private record Threat(boolean active, String source, Location at, int count) { }
    private final AgentFriendPlugin plugin;
    private final DungeonManager dungeon;
    private Threat current = new Threat(false, "none", null, 0);

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
        if (world == null) return new Threat(false, "none", null, 0);
        List<Raider> nearby = world.getEntitiesByClass(Raider.class).stream()
                .filter(raider -> raider.isValid() && !raider.isDead() && nearVillage(raider.getLocation()))
                .toList();
        Raid raid = world.getRaids().stream().filter(candidate ->
                candidate.getStatus() == Raid.RaidStatus.ONGOING && nearVillage(candidate.getLocation()))
                .findFirst().orElse(null);
        if (raid != null) return new Threat(true, "raid", raid.getLocation(), nearby.size());
        if (!nearby.isEmpty()) return new Threat(true, "patrol", nearby.get(0).getLocation(), nearby.size());
        return new Threat(false, "none", null, 0);
    }

    private void scan() {
        Threat next = snapshot();
        if (!current.active() && next.active()) {
            for (Player player : Bukkit.getOnlinePlayers()) {
                publish(player, "alert", next);
                alertChat(player, next);
            }
            plugin.getLogger().info("Village threat detected: source=" + next.source()
                    + " count=" + next.count() + " at=" + coords(next.at()));
        } else if (current.active() && !next.active()) {
            for (Player player : Bukkit.getOnlinePlayers()) publish(player, "clear", next);
            plugin.getLogger().info("Village threat cleared");
        }
        current = next;
    }

    private String coords(Location at) {
        return at == null ? "none" : at.getBlockX() + " " + at.getBlockY() + " " + at.getBlockZ();
    }

    private void alertChat(Player player, Threat threat) {
        if (player.getGameMode() == GameMode.SPECTATOR) return;
        if (plugin.getConfig().getStringList("nametags.agent-uuids")
                .contains(player.getUniqueId().toString())) {
            // Cortico treats vanilla whispers as urgent input; plain system chat is only rendered.
            // Player names are restricted before they enter a console command.
            if (player.getName().matches("[A-Za-z0-9_]{1,16}")) {
                JsonObject wake = new JsonObject();
                wake.addProperty("kind", "village_alert");
                wake.addProperty("source", threat.source());
                wake.addProperty("count", threat.count());
                if (threat.at() != null) {
                    wake.addProperty("x", threat.at().getBlockX());
                    wake.addProperty("y", threat.at().getBlockY());
                    wake.addProperty("z", threat.at().getBlockZ());
                }
                wake.addProperty("action", "check_health_then_defend");
                Bukkit.dispatchCommand(Bukkit.getConsoleSender(),
                        "minecraft:tell " + player.getName() + " MC_VILLAGE_ALERT " + wake);
            } else {
                plugin.getLogger().warning("Invalid Agent player name for village alert: " + player.getUniqueId());
            }
            return;
        }
        player.sendMessage(ChatColor.GOLD + "村庄外围出现掠夺者！请先确认生命与装备，能支援就优先支援。"
                + "位置 " + coords(threat.at()) + "；/mycli village threat 查看实时敌情。");
    }

    void command(Player player, String[] args) {
        String action = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "threat";
        switch (action) {
            case "threat", "status", "守望", "状态" -> {
                Threat threat = snapshot();
                publish(player, "status", threat);
                player.sendMessage(threat.active()
                        ? ChatColor.GOLD + "村庄外围敌情：" + threat.source() + "，已见 " + threat.count()
                                + " 名掠夺者，坐标 " + coords(threat.at())
                                + "。优先保护自身，再结伴支援；安全区内不刷敌怪。"
                        : ChatColor.GREEN + "村庄外围当前没有已加载的掠夺者或正在进行的袭击。"
                                + "安全区外仍请留意环境。 未加载区域无法判断。 ");
            }
            case "villagers", "trades", "村民", "交易" -> villagers(player);
            default -> player.sendMessage(ChatColor.YELLOW + "用法：/mycli village threat|villagers"
                    + "；生活公会收购任务用 /mycli life accept trader_supply。");
        }
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
            if (threat.active()) {
                publish(player, "alert", threat);
                alertChat(player, threat);
            }
        }, 40L);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onRaiderDeath(EntityDeathEvent event) {
        if (!(event.getEntity() instanceof Raider raider) || !nearVillage(raider.getLocation())) return;
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
        Bukkit.getScheduler().runTaskLater(plugin, this::scan, 1L);
    }

    private JsonObject publish(Player player, String kind, Threat threat) {
        JsonObject data = new JsonObject();
        data.addProperty("schemaVersion", 1);
        data.addProperty("kind", kind);
        data.addProperty("active", threat.active());
        data.addProperty("source", threat.source());
        data.addProperty("count", threat.count());
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
