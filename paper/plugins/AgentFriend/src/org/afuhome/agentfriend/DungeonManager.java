package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.boss.BarColor;
import org.bukkit.boss.BarStyle;
import org.bukkit.boss.BossBar;
import org.bukkit.block.Block;
import org.bukkit.block.Sign;
import org.bukkit.block.TileState;
import org.bukkit.block.data.type.Switch;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.MagmaCube;
import org.bukkit.entity.Monster;
import org.bukkit.entity.Player;
import org.bukkit.entity.Ravager;
import org.bukkit.entity.Villager;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockFromToEvent;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.MerchantRecipe;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

/** Vanilla-protocol trial tower with an optional deep wing and rest floor. */
final class DungeonManager implements Listener {
    private static final int X = -590, Z = -305, WING_X = -510, WING_Z = -305;
    private static final int LOBBY_Y = 90, RADIUS = 12, BASE_FLOORS = 6, REST_FLOOR = 7, BOSS_FLOOR = 10;
    private static final int[] Y = {68, 56, 44, 32, 20, 8, -4, -16, -28, -40};
    private static final int[] RADII = {12, 12, 12, 12, 12, 12, 16, 18, 18, 20};
    private static final double BUTTON_GROUP_RADIUS_SQUARED = 12.0 * 12.0;
    private static final long COOLDOWN_MS = 180_000L;
    private static final long RUN_TIMEOUT_MS = 3_600_000L;
    private static final long FLOOR_TIMEOUT_MS = 480_000L;
    private static final long NEXT_FLOOR_DELAY_MS = 10_000L;
    private static final long REST_DURATION_MS = 180_000L;
    private static final long REJOIN_GRACE_MS = 600_000L;
    private static final String RUN_STATE = "dungeon-active-run";
    private static final String MOB_TAG = "afu_dungeon_mob";
    private static final String REWARDS = "dungeon-rewards.";
    private static final String BONUS_ITEMS = "dungeon-bonus-items.";
    private static final String RARE_MISSES = "dungeon-rare-misses.";
    private static final String DEATH_GUIDE = "dungeon-death-guide.";
    private static final int MAX_BONUS_QUEUE = 128;
    private static final Material[] REWARD_TYPES = {
            Material.EMERALD, Material.IRON_INGOT, Material.BREAD,
            Material.EXPERIENCE_BOTTLE, Material.GOLDEN_APPLE,
            Material.LAPIS_LAZULI, Material.ARROW, Material.DIAMOND};
    private record Loot(Material material, int amount) { }
    private record Theme(String name, Material floor, Material wall, Material pillar,
                         EntityType[] mobs, Loot[] rewards) { }
    private static final List<Theme> THEMES = List.of(
            new Theme("苔藓洞穴", Material.MOSS_BLOCK, Material.MOSSY_STONE_BRICKS, Material.OAK_LOG,
                    new EntityType[]{EntityType.ZOMBIE, EntityType.ZOMBIE, EntityType.ZOMBIE},
                    new Loot[]{new Loot(Material.IRON_INGOT, 1), new Loot(Material.BREAD, 2), new Loot(Material.EXPERIENCE_BOTTLE, 1)}),
            new Theme("沙漠遗迹", Material.SANDSTONE, Material.CHISELED_SANDSTONE, Material.CUT_SANDSTONE,
                    new EntityType[]{EntityType.HUSK, EntityType.HUSK, EntityType.SPIDER, EntityType.SPIDER},
                    new Loot[]{new Loot(Material.EMERALD, 1), new Loot(Material.IRON_INGOT, 1), new Loot(Material.BREAD, 2), new Loot(Material.EXPERIENCE_BOTTLE, 1)}),
            new Theme("冰雪洞窟", Material.PACKED_ICE, Material.SNOW_BLOCK, Material.BLUE_ICE,
                    new EntityType[]{EntityType.STRAY, EntityType.STRAY, EntityType.ZOMBIE, EntityType.SPIDER},
                    new Loot[]{new Loot(Material.EMERALD, 2), new Loot(Material.GOLDEN_APPLE, 1), new Loot(Material.EXPERIENCE_BOTTLE, 2)}),
            new Theme("赤焰堡垒", Material.NETHER_BRICKS, Material.RED_NETHER_BRICKS, Material.BLACKSTONE,
                    new EntityType[]{EntityType.MAGMA_CUBE, EntityType.MAGMA_CUBE, EntityType.HUSK, EntityType.HUSK, EntityType.BLAZE},
                    new Loot[]{new Loot(Material.EMERALD, 2), new Loot(Material.LAPIS_LAZULI, 4), new Loot(Material.ARROW, 8), new Loot(Material.EXPERIENCE_BOTTLE, 2)}),
            new Theme("海晶遗迹", Material.PRISMARINE_BRICKS, Material.DARK_PRISMARINE, Material.PRISMARINE,
                    new EntityType[]{EntityType.DROWNED, EntityType.DROWNED, EntityType.DROWNED, EntityType.SKELETON, EntityType.SKELETON, EntityType.SPIDER},
                    new Loot[]{new Loot(Material.EMERALD, 3), new Loot(Material.IRON_INGOT, 2), new Loot(Material.GOLDEN_APPLE, 1), new Loot(Material.EXPERIENCE_BOTTLE, 3)}),
            new Theme("深层宝库", Material.DEEPSLATE_BRICKS, Material.POLISHED_BLACKSTONE_BRICKS, Material.CHISELED_DEEPSLATE,
                    new EntityType[]{EntityType.ZOMBIE, EntityType.ZOMBIE, EntityType.HUSK, EntityType.HUSK, EntityType.SKELETON, EntityType.SKELETON, EntityType.WITCH},
                    new Loot[]{new Loot(Material.DIAMOND, 1), new Loot(Material.EMERALD, 5), new Loot(Material.GOLDEN_APPLE, 1), new Loot(Material.EXPERIENCE_BOTTLE, 4)}),
            new Theme("灯火驿站", Material.CHERRY_PLANKS, Material.POLISHED_DEEPSLATE, Material.CHERRY_LOG,
                    new EntityType[]{}, new Loot[]{}),
            new Theme("幽荧矿井", Material.TUFF_BRICKS, Material.DEEPSLATE_TILES, Material.COPPER_BLOCK,
                    new EntityType[]{EntityType.ZOMBIE, EntityType.ZOMBIE, EntityType.SKELETON, EntityType.SKELETON,
                            EntityType.CAVE_SPIDER, EntityType.CAVE_SPIDER, EntityType.HUSK, EntityType.HUSK},
                    new Loot[]{new Loot(Material.EMERALD, 5), new Loot(Material.DIAMOND, 1),
                            new Loot(Material.GOLDEN_APPLE, 1), new Loot(Material.EXPERIENCE_BOTTLE, 5)}),
            new Theme("星辉秘殿", Material.AMETHYST_BLOCK, Material.PURPUR_BLOCK, Material.CALCITE,
                    new EntityType[]{EntityType.PILLAGER, EntityType.PILLAGER, EntityType.VINDICATOR,
                            EntityType.SKELETON, EntityType.SKELETON, EntityType.WITCH,
                            EntityType.ZOMBIE, EntityType.ZOMBIE, EntityType.SPIDER},
                    new Loot[]{new Loot(Material.EMERALD, 7), new Loot(Material.DIAMOND, 2),
                            new Loot(Material.GOLDEN_APPLE, 1), new Loot(Material.EXPERIENCE_BOTTLE, 6)}),
            new Theme("深渊守卫之殿", Material.POLISHED_BLACKSTONE_BRICKS, Material.CRYING_OBSIDIAN, Material.GILDED_BLACKSTONE,
                    new EntityType[]{EntityType.RAVAGER, EntityType.PILLAGER, EntityType.PILLAGER,
                            EntityType.ZOMBIE, EntityType.ZOMBIE},
                    new Loot[]{new Loot(Material.EMERALD, 10), new Loot(Material.DIAMOND, 3),
                            new Loot(Material.GOLDEN_APPLE, 2), new Loot(Material.EXPERIENCE_BOTTLE, 10)}));

    private final AgentFriendPlugin plugin;
    private final NamespacedKey mobKey;
    private final NamespacedKey checkpointKey;
    private final NamespacedKey merchantKey;
    private final Set<UUID> participants = new HashSet<>();
    private final Set<UUID> mobs = new HashSet<>();
    private final Map<Inventory, UUID> rewardMenus = new IdentityHashMap<>();
    private boolean built;
    private boolean expanded;
    private boolean active;
    private boolean spawned;
    private boolean cleared;
    private int floor;
    private long runStartedAt;
    private long floorStartedAt;
    private long spawnAt;
    private long advanceAt;
    private long pausedAt;
    private long lastRun;
    private UUID bossId;
    private BossBar bossBar;

    DungeonManager(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        mobKey = new NamespacedKey(plugin, "dungeon_mob");
        checkpointKey = new NamespacedKey(plugin, "dungeon_rest_unlocked");
        merchantKey = new NamespacedKey(plugin, "dungeon_merchant");
        built = plugin.getConfig().getBoolean("dungeon-built", false);
        expanded = plugin.getConfig().getBoolean("dungeon-expanded", false);
        lastRun = plugin.getConfig().getLong("dungeon-last-run", 0L);
        if (plugin.getConfig().getBoolean("dungeon-building", false) && !built)
            plugin.getLogger().severe("Interrupted dungeon construction: inspect or restore the world before retrying.");
        if (plugin.getConfig().getBoolean("dungeon-expansion-building", false) && !expanded)
            plugin.getLogger().severe("Interrupted deep-wing construction: inspect or restore before retrying.");
        plugin.getServer().getPluginManager().registerEvents(this, plugin);
        if (built) {
            cleanupMobs();
            updateFloorGuides();
            if (expanded) ensureMerchant();
            restoreRun();
        }
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 20L, 20L);
        plugin.getLogger().info("Dungeon ready; built=" + built + ", floors=" + maxFloor());
    }

    boolean isBuilt() { return built; }
    boolean isExpanded() { return expanded; }
    private int maxFloor() { return expanded ? Y.length : BASE_FLOORS; }
    private int floorX(int number) { return number <= BASE_FLOORS ? X : WING_X; }
    private int floorZ(int number) { return number <= BASE_FLOORS ? Z : WING_Z; }
    private int radius(int number) { return RADII[number - 1]; }
    private int chestX(int number) { return floorX(number) - radius(number) + 3; }
    private int chestZ(int number) { return floorZ(number) - radius(number) + 3; }
    private int nextX(int number) { return floorX(number) + radius(number) - 3; }
    private int leaveX(int number) { return floorX(number) - radius(number) + 5; }

    void shutdown() {
        if (active) {
            if (pausedAt == 0) pausedAt = System.currentTimeMillis();
            persistRun();
        }
        cleanupMobs();
        rewardMenus.clear();
    }

    private World world() { return Bukkit.getWorld("world"); }
    private boolean sameWorld(Location at) { return at != null && at.getWorld() != null && at.getWorld().equals(world()); }

    private void persistRun() {
        if (!active) return;
        plugin.getConfig().set(RUN_STATE + ".floor", floor);
        plugin.getConfig().set(RUN_STATE + ".participants",
                participants.stream().map(UUID::toString).toList());
        plugin.getConfig().set(RUN_STATE + ".run-started-at", runStartedAt);
        plugin.getConfig().set(RUN_STATE + ".floor-started-at", floorStartedAt);
        plugin.getConfig().set(RUN_STATE + ".advance-at", advanceAt);
        plugin.getConfig().set(RUN_STATE + ".cleared", cleared);
        plugin.getConfig().set(RUN_STATE + ".paused-at", pausedAt);
        plugin.getConfig().set(RUN_STATE + ".saved-at", System.currentTimeMillis());
        plugin.saveConfig();
    }

    private void restoreRun() {
        if (!plugin.getConfig().isConfigurationSection(RUN_STATE)) return;
        long now = System.currentTimeMillis();
        int savedFloor = plugin.getConfig().getInt(RUN_STATE + ".floor", 0);
        long savedAt = plugin.getConfig().getLong(RUN_STATE + ".saved-at", 0);
        long savedPause = plugin.getConfig().getLong(RUN_STATE + ".paused-at", 0);
        List<String> savedPlayers = plugin.getConfig().getStringList(RUN_STATE + ".participants");
        Set<UUID> savedIds = new HashSet<>();
        try {
            for (String raw : savedPlayers) savedIds.add(UUID.fromString(raw));
        } catch (IllegalArgumentException invalid) {
            savedIds.clear();
        }
        long interruptedAt = savedPause > 0 ? savedPause : savedAt;
        if (savedFloor < 1 || savedFloor > maxFloor() || savedIds.isEmpty()
                || interruptedAt <= 0 || interruptedAt > now
                || now - interruptedAt > REJOIN_GRACE_MS) {
            plugin.getLogger().warning("Discarded expired or invalid dungeon run checkpoint.");
            plugin.getConfig().set(RUN_STATE, null);
            lastRun = now;
            plugin.getConfig().set("dungeon-last-run", lastRun);
            plugin.saveConfig();
            return;
        }
        participants.clear();
        participants.addAll(savedIds);
        floor = savedFloor;
        runStartedAt = plugin.getConfig().getLong(RUN_STATE + ".run-started-at", now);
        floorStartedAt = plugin.getConfig().getLong(RUN_STATE + ".floor-started-at", now);
        advanceAt = plugin.getConfig().getLong(RUN_STATE + ".advance-at", 0);
        cleared = plugin.getConfig().getBoolean(RUN_STATE + ".cleared", false);
        spawned = false; // The old wave was removed at shutdown or startup; retry it once.
        pausedAt = interruptedAt;
        active = true;
        plugin.getLogger().info("Dungeon run checkpoint restored: floor=" + floor
                + ", participants=" + participants.size() + ", waiting for reconnect.");
    }

    private void pauseRun(long now) {
        if (pausedAt != 0) return;
        pausedAt = now;
        if (!cleared) {
            cleanupMobs();
            spawned = false;
        }
        persistRun();
        plugin.getLogger().info("Dungeon paused for reconnect: floor=" + floor
                + ", participants=" + participants.size() + ", graceSeconds=" + REJOIN_GRACE_MS / 1000);
    }

    private void resumeRun(long now) {
        if (pausedAt == 0) return;
        long pausedFor = Math.max(0, now - pausedAt);
        runStartedAt += pausedFor;
        floorStartedAt += pausedFor;
        if (cleared) advanceAt += pausedFor;
        else spawnAt = now + 3000L;
        pausedAt = 0;
        persistRun();
        plugin.getLogger().info("Dungeon resumed after reconnect: floor=" + floor
                + ", participants=" + participants.size());
    }
    private boolean inLobby(Location at) {
        return sameWorld(at) && Math.abs(at.getBlockX() - X) <= 11 && Math.abs(at.getBlockZ() - Z) <= 11
                && at.getY() >= LOBBY_Y && at.getY() <= LOBBY_Y + 8;
    }
    private boolean inFloor(Location at, int number) {
        if (!sameWorld(at) || number < 1 || number > maxFloor()) return false;
        int y = Y[number - 1];
        return Math.abs(at.getBlockX() - floorX(number)) < radius(number)
                && Math.abs(at.getBlockZ() - floorZ(number)) < radius(number)
                && at.getY() >= y + 1 && at.getY() <= y + 7;
    }
    private int floorAt(Location at) {
        for (int n = 1; n <= maxFloor(); n++) if (inFloor(at, n)) return n;
        return 0;
    }
    private boolean inBuild(Location at) {
        if (!built || !sameWorld(at)) return false;
        if (at.getY() >= Y[BASE_FLOORS - 1] && at.getY() <= Y[0] + 7
                && Math.abs(at.getBlockX() - X) <= RADIUS && Math.abs(at.getBlockZ() - Z) <= RADIUS) return true;
        if (!expanded) return false;
        for (int number = REST_FLOOR; number <= BOSS_FLOOR; number++)
            if (at.getY() >= Y[number - 1] && at.getY() <= Y[number - 1] + 7
                    && Math.abs(at.getBlockX() - WING_X) <= radius(number)
                    && Math.abs(at.getBlockZ() - WING_Z) <= radius(number)) return true;
        return false;
    }

    boolean deniesEdit(Location at) { return inBuild(at); }

    private Location lobbyButton() {
        return new Location(world(), X - 5.5, LOBBY_Y + 2.5, Z - 7.5);
    }

    private boolean nearLobbyButton(Player player, Location button) {
        Location at = player.getLocation();
        return player.isOnline() && !player.isDead() && player.getGameMode() != GameMode.SPECTATOR
                && sameWorld(at) && Math.abs(at.getY() - button.getY()) <= 4
                && at.distanceSquared(button) <= BUTTON_GROUP_RADIUS_SQUARED;
    }

    private List<Player> groupNearLobbyButton(Location button) {
        List<Player> group = new ArrayList<>();
        for (Player player : Bukkit.getOnlinePlayers())
            if (nearLobbyButton(player, button)) group.add(player);
        return group;
    }

    void command(Player player, String[] args) {
        String sub = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "status";
        switch (sub) {
            case "status" -> player.sendMessage(ChatColor.GOLD + "" + maxFloor() + " 层试炼：" + (active
                    ? "第 " + floor + "/" + maxFloor() + " 层 · " + THEMES.get(floor - 1).name()
                        + (pausedAt > 0 ? "，队伍暂离，等待重连"
                            : cleared ? "，约 " + Math.max(0, (advanceAt - System.currentTimeMillis() + 999) / 1000)
                                + " 秒后自动下楼" : "，战斗中")
                    : "待命") + "。奖励存进个人箱子，不自动进入背包。");
            case "start" -> start(player);
            case "rest", "checkpoint", "驿站" -> startAtRest(player);
            case "next" -> next(player);
            case "shop", "商人" -> openShop(player);
            case "rewards", "reward", "箱子" -> openRewards(player);
            case "leave" -> leave(player);
            default -> player.sendMessage(ChatColor.RED + "用法：/mycli arena start|rest|next|shop|status|rewards|leave");
        }
    }

    boolean handleInteract(PlayerInteractEvent event) {
        if (!built || event.getHand() != EquipmentSlot.HAND || event.getAction() != Action.RIGHT_CLICK_BLOCK) return false;
        Block block = event.getClickedBlock();
        if (block == null || !sameWorld(block.getLocation())) return false;
        int n = floorAt(block.getLocation());
        boolean lobbyChest = block.getX() == X - 4 && block.getY() == LOBBY_Y + 1 && block.getZ() == Z - 8;
        if ((lobbyChest || (n > 0 && block.getX() == chestX(n) && block.getY() == Y[n - 1] + 1
                && block.getZ() == chestZ(n))) && block.getType() == Material.CHEST) {
            event.setCancelled(true);
            openRewards(event.getPlayer());
            return true;
        }
        if (block.getX() == X - 6 && block.getY() == LOBBY_Y + 2 && block.getZ() == Z - 8
                && block.getType() == Material.STONE_BUTTON) {
            event.setCancelled(true);
            start(event.getPlayer());
            return true;
        }
        if (n > 0 && block.getX() == nextX(n) && block.getY() == Y[n - 1] + 1
                && block.getZ() == chestZ(n) && block.getType() == Material.STONE_BUTTON) {
            event.setCancelled(true);
            next(event.getPlayer());
            return true;
        }
        if (n > 0 && block.getX() == leaveX(n) && block.getY() == Y[n - 1] + 1
                && block.getZ() == chestZ(n) && block.getType() == Material.OAK_BUTTON) {
            event.setCancelled(true);
            leave(event.getPlayer());
            return true;
        }
        return false;
    }

    private void start(Player starter) {
        if (starter.getGameMode() == GameMode.SPECTATOR) { starter.sendMessage(ChatColor.RED + "旁观者不能启动。"); return; }
        if (!nearLobbyButton(starter, lobbyButton())) {
            starter.sendMessage(ChatColor.RED + "请站到地面入口石按钮附近 12 格内再启动。"); return;
        }
        if (active) { starter.sendMessage(ChatColor.YELLOW + "已有队伍在挑战试炼塔。"); return; }
        long now = System.currentTimeMillis();
        if (now - lastRun < COOLDOWN_MS) {
            starter.sendMessage(ChatColor.YELLOW + "试炼场休息中，还需 " + ((COOLDOWN_MS - (now - lastRun) + 999) / 1000) + " 秒。");
            return;
        }
        List<Player> group = groupNearLobbyButton(lobbyButton());
        if (group.isEmpty()) return;
        participants.clear(); mobs.clear();
        if (enterFloor(1, group) == 0) {
            starter.sendMessage(ChatColor.RED + "地下城入口传送失败，试炼未启动。"); return;
        }
        active = true;
        runStartedAt = now;
        persistRun();
        announce(ChatColor.GOLD + "" + maxFloor() + " 层试炼开始！入口按钮附近 " + participants.size()
                + " 人已组队进入。每层清怪后 10 秒自动下楼并补满生命；奖励留在个人箱子，红色木按钮可返回地面。");
    }

    private void startAtRest(Player starter) {
        if (!expanded) { starter.sendMessage(ChatColor.YELLOW + "深层驿站尚未开放。"); return; }
        if (starter.getGameMode() == GameMode.SPECTATOR || starter.isDead()) {
            starter.sendMessage(ChatColor.RED + "旁观者或倒下的玩家不能进入驿站。"); return;
        }
        if (!starter.getPersistentDataContainer().has(checkpointKey, PersistentDataType.BYTE)) {
            starter.sendMessage(ChatColor.YELLOW + "先通关第六层，即可解锁深层驿站直达。"); return;
        }
        if (active) { starter.sendMessage(ChatColor.YELLOW + "已有队伍在挑战试炼塔，稍后再来。"); return; }
        long now = System.currentTimeMillis();
        if (now - lastRun < COOLDOWN_MS) {
            starter.sendMessage(ChatColor.YELLOW + "试炼场休息中，还需 "
                    + ((COOLDOWN_MS - (now - lastRun) + 999) / 1000) + " 秒。"); return;
        }
        List<Player> group = nearLobbyButton(starter, lobbyButton())
                ? groupNearLobbyButton(lobbyButton()) : List.of(starter);
        participants.clear(); mobs.clear();
        if (enterFloor(REST_FLOOR, group) == 0) {
            starter.sendMessage(ChatColor.RED + "驿站传送失败，挑战未启动。"); return;
        }
        active = true;
        runStartedAt = now;
        persistRun();
        announce(ChatColor.GOLD + "已从检查点直达第七层驿站；队伍可补给，再继续深入。");
    }

    private int enterFloor(int number, List<Player> group) {
        Set<UUID> arrived = new HashSet<>();
        Set<UUID> disconnected = new HashSet<>();
        if (active) for (UUID id : participants)
            if (Bukkit.getPlayer(id) == null) disconnected.add(id);
        Location destination = center(number);
        int[][] offsets = {{0,0},{2,0},{-2,0},{0,2},{0,-2},{2,2},{-2,2},{2,-2}};
        int position = 0;
        for (Player player : group) {
            int[] offset = offsets[position++ % offsets.length];
            if (player.isOnline() && !player.isDead()
                    && player.teleport(destination.clone().add(offset[0], 0, offset[1]))) {
                arrived.add(player.getUniqueId());
                double maxHealth = player.getMaxHealth();
                if (maxHealth > 0 && player.getHealth() < maxHealth) player.setHealth(maxHealth);
                player.setFireTicks(0);
            } else player.sendMessage(ChatColor.RED + "传送未成功，你没有进入本层队伍。");
        }
        if (arrived.isEmpty()) return 0;
        for (UUID id : participants) {
            Player player = Bukkit.getPlayer(id);
            if (!arrived.contains(id) && player != null && player.isOnline() && !player.isDead()
                    && inFloor(player.getLocation(), floor))
                player.sendMessage(ChatColor.YELLOW + "队友已下楼；你不在按钮附近 12 格内，本次未传送。可按红色按钮回地面。");
        }
        participants.clear();
        participants.addAll(arrived);
        participants.addAll(disconnected);
        floor = number;
        spawned = false;
        cleared = number == REST_FLOOR;
        floorStartedAt = System.currentTimeMillis();
        spawnAt = cleared ? 0 : floorStartedAt + 3000L;
        advanceAt = cleared ? floorStartedAt + REST_DURATION_MS : 0;
        announce(ChatColor.AQUA + "附近 " + arrived.size() + " 人进入第 " + number + "/" + maxFloor() + " 层："
                + THEMES.get(number - 1).name() + "；生命已补满。");
        if (cleared) announce(ChatColor.GOLD + "这里可使用工作台与商人，领取个人箱奖励。"
                + "三分钟后自动下楼，或按绿色按钮／输入 /mycli arena next 提前出发。");
        persistRun();
        return arrived.size();
    }

    private Location center(int number) {
        return new Location(world(), floorX(number) + 0.5, Y[number - 1] + 1,
                floorZ(number) + 0.5, 0, 0);
    }

    private void next(Player player) {
        if (!active || floorAt(player.getLocation()) != floor) {
            player.sendMessage(ChatColor.YELLOW + "当前无需操作下一层按钮。"); return;
        }
        if (floor == REST_FLOOR && cleared) {
            long now = System.currentTimeMillis();
            if (advanceAt - now > NEXT_FLOOR_DELAY_MS) {
                advanceAt = now + NEXT_FLOOR_DELAY_MS;
                persistRun();
                announce(ChatColor.GOLD + "驿站出发！10 秒后全队进入第八层，生命会补满。");
            } else player.sendMessage(ChatColor.AQUA + "队伍已准备出发，请稍候。");
        } else if (!cleared) player.sendMessage(ChatColor.YELLOW + "打败本层怪物后会自动下楼，不用按绿色按钮。");
        else player.sendMessage(ChatColor.AQUA + "约 "
                + Math.max(0, (advanceAt - System.currentTimeMillis() + 999) / 1000)
                + " 秒后自动下楼并补满生命；奖励留在个人箱子里。");
    }

    private void leave(Player player) {
        if (!inLobby(player.getLocation()) && floorAt(player.getLocation()) == 0) {
            player.sendMessage(ChatColor.RED + "你目前不在试炼场内。"); return;
        }
        Location landing = new Location(world(), X + 0.5, LOBBY_Y + 1.0, Z - 17 + 0.5, 0, 0);
        if (landing.getBlock().getType() != Material.AIR || landing.clone().add(0, 1, 0).getBlock().getType() != Material.AIR) {
            player.sendMessage(ChatColor.RED + "地面入口受阻，返回已取消。"); return;
        }
        if (player.teleport(landing)) {
            if (participants.remove(player.getUniqueId())) persistRun();
            player.sendMessage(ChatColor.GREEN + "已返回地面，未领取的奖励留在个人箱子里。");
        }
    }

    private void tick() {
        if (!active) return;
        long now = System.currentTimeMillis();
        if (pausedAt > 0) {
            if (now - pausedAt > REJOIN_GRACE_MS)
                finish(false, "断线重连等待已满 10 分钟；已赢得的奖励保存在个人箱子里。");
            return;
        }
        boolean anyone = false;
        for (UUID id : participants) {
            Player p = Bukkit.getPlayer(id);
            if (p != null && p.isOnline() && !p.isDead() && inFloor(p.getLocation(), floor)) {
                anyone = true; break;
            }
        }
        if (!anyone) {
            if (participants.stream().anyMatch(id -> Bukkit.getPlayer(id) == null)) pauseRun(now);
            else finish(false, "队伍离开或倒下；已赢得的奖励保存在个人箱子里。");
            return;
        }
        if (now - runStartedAt > RUN_TIMEOUT_MS || now - floorStartedAt > FLOOR_TIMEOUT_MS) {
            finish(false, "试炼超时；已赢得的奖励保存在个人箱子里。"); return;
        }
        if (cleared) {
            if (floor < maxFloor() && now >= advanceAt) {
                List<Player> group = participants.stream().map(Bukkit::getPlayer)
                        .filter(p -> p != null && p.isOnline() && !p.isDead()
                                && inFloor(p.getLocation(), floor)).toList();
                if (enterFloor(floor + 1, group) == 0)
                    finish(false, "自动下楼失败；已赢得的奖励保存在个人箱子里。");
            }
            return;
        }
        if (!spawned && now >= spawnAt) spawn();
        if (!spawned) return;
        updateBossBar();
        mobs.removeIf(id -> {
            Entity e = Bukkit.getEntity(id);
            if (!(e instanceof LivingEntity living) || living.isDead() || !e.isValid()) return true;
            if (!inFloor(e.getLocation(), floor)) e.teleport(center(floor));
            return false;
        });
        if (!mobs.isEmpty()) return;
        cleared = true;
        int credited = rewardFloor();
        announce(ChatColor.GREEN + "第 " + floor + "/" + maxFloor() + " 层已通关！奖励已放进个人箱子（" + credited + " 人）。");
        if (floor == maxFloor()) finish(true, maxFloor() + " 层完成！打开奖励箱领取，再按红色木按钮回地面。");
        else {
            advanceAt = now + NEXT_FLOOR_DELAY_MS;
            persistRun();
            announce(ChatColor.YELLOW + "10 秒后全队自动进入下一层并补满生命；奖励留在个人箱子，不必现在领取。");
        }
    }

    @EventHandler public void onParticipantQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        if (!active || !participants.contains(player.getUniqueId())) return;
        if (player.isDead() || !inFloor(player.getLocation(), floor)) {
            participants.remove(player.getUniqueId());
            persistRun();
        }
    }

    @EventHandler public void onParticipantDeath(PlayerDeathEvent event) {
        Player player = event.getEntity();
        if (!active || !participants.contains(player.getUniqueId())
                || !inFloor(player.getLocation(), floor)) return;
        UUID id = player.getUniqueId();
        plugin.getConfig().set(DEATH_GUIDE + id, true);
        plugin.saveConfig(); // Retain the guidance if the player disconnects before respawning.
        sendDeathGuide(player);
    }

    @EventHandler public void onParticipantRespawn(PlayerRespawnEvent event) {
        scheduleDeathGuide(event.getPlayer().getUniqueId(), 10L);
    }

    private void scheduleDeathGuide(UUID id, long delayTicks) {
        if (!plugin.getConfig().getBoolean(DEATH_GUIDE + id, false)) return;
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            Player player = Bukkit.getPlayer(id);
            if (player == null || !player.isOnline() || player.isDead()
                    || !plugin.getConfig().getBoolean(DEATH_GUIDE + id, false)) return;
            sendDeathGuide(player);
            player.sendTitle(ChatColor.GOLD + "试炼奖励在入口",
                    ChatColor.YELLOW + "不用返回死亡地点", 5, 70, 15);
            plugin.getConfig().set(DEATH_GUIDE + id, null);
            plugin.saveConfig();
        }, delayTicks);
    }

    private void sendDeathGuide(Player player) {
        UUID id = player.getUniqueId();
        player.sendMessage(ChatColor.GOLD + "[试炼指引] " + ChatColor.YELLOW
                + "试炼奖励只在楼层通关后存入个人奖励箱，不会掉在死亡地点。");
        player.sendMessage(hasPendingRewards(id)
                ? ChatColor.GREEN + "[试炼指引] 你已有未领取奖励，死亡不会清空。"
                : ChatColor.YELLOW + "[试炼指引] 当前个人箱没有待领奖励；未通关的楼层不结算奖励。");
        player.sendMessage(ChatColor.AQUA + "[试炼指引] 去试炼场地面入口奖励箱 (-594, 91, -313) 领取；"
                + "或输入 /mycli arena rewards 直接打开同一个个人箱。");
    }

    private boolean hasPendingRewards(UUID id) {
        for (Material material : REWARD_TYPES) if (pending(id, material) > 0) return true;
        return !bonusItems(id).isEmpty();
    }

    @EventHandler public void onParticipantJoin(PlayerJoinEvent event) {
        UUID id = event.getPlayer().getUniqueId();
        scheduleDeathGuide(id, 30L);
        if (!active || !participants.contains(id)) return;
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            Player player = Bukkit.getPlayer(id);
            if (!active || !participants.contains(id) || player == null || !player.isOnline()
                    || player.isDead()) return;
            if (pausedAt > 0 && System.currentTimeMillis() - pausedAt > REJOIN_GRACE_MS) return;
            boolean advancedWhileAway = floorAt(player.getLocation()) > 0
                    && floorAt(player.getLocation()) != floor;
            if (!inFloor(player.getLocation(), floor) && !player.teleport(center(floor))) {
                player.sendMessage(ChatColor.RED + "地下城重连传送失败；请联系服主，试炼仍保留到宽限期结束。");
                return;
            }
            if (advancedWhileAway) player.setHealth(player.getMaxHealth());
            player.setNoDamageTicks(60);
            if (pausedAt > 0) resumeRun(System.currentTimeMillis());
            player.sendMessage(ChatColor.GREEN + "已恢复第 " + floor + "/" + maxFloor() + " 层试炼。"
                    + (cleared ? "自动下楼倒计时继续。" : "当前层怪物会重新出现；已领取的奖励不会重复结算。"));
        }, 10L);
    }

    private void spawn() {
        spawned = true;
        Theme theme = THEMES.get(floor - 1);
        int[][] spots = floor == BOSS_FLOOR
                ? new int[][]{{0,10},{-9,-7},{9,-7},{-9,7},{9,7}}
                : floor >= 8
                    ? new int[][]{{-12,-10},{12,-10},{-12,10},{12,10},{0,13},{0,-13},
                            {-14,0},{14,0},{-9,13},{9,13},{-9,-13},{9,-13}}
                    : new int[][]{{-6,-5},{6,-5},{-6,5},{6,5},{0,7},{0,-7},
                            {-8,0},{8,0},{-10,-8},{10,-8},{-10,8},{10,8}};
        for (int i = 0; i < theme.mobs().length; i++) {
            int[] spot = spots[i];
            Location at = center(floor).add(spot[0], 0, spot[1]);
            Entity e = world().spawnEntity(at, theme.mobs()[i]);
            e.addScoreboardTag(MOB_TAG);
            e.getPersistentDataContainer().set(mobKey, PersistentDataType.BYTE, (byte) 1);
            if (e instanceof MagmaCube cube) cube.setSize(1); // No untagged split children after a clear.
            if (e instanceof LivingEntity living) living.setRemoveWhenFarAway(false);
            if (e instanceof Ravager ravager) {
                bossId = ravager.getUniqueId();
                ravager.setCustomName(ChatColor.DARK_PURPLE + "深渊守卫");
                ravager.setCustomNameVisible(true);
                if (ravager.getAttribute(Attribute.GENERIC_MAX_HEALTH) != null) {
                    ravager.getAttribute(Attribute.GENERIC_MAX_HEALTH).setBaseValue(90);
                    ravager.setHealth(90);
                }
                if (ravager.getAttribute(Attribute.GENERIC_ATTACK_DAMAGE) != null)
                    ravager.getAttribute(Attribute.GENERIC_ATTACK_DAMAGE).setBaseValue(5);
                bossBar = Bukkit.createBossBar(ChatColor.DARK_PURPLE + "深渊守卫",
                        BarColor.PURPLE, BarStyle.SOLID);
                for (UUID id : participants) {
                    Player player = Bukkit.getPlayer(id);
                    if (player != null && inFloor(player.getLocation(), floor)) bossBar.addPlayer(player);
                }
            }
            mobs.add(e.getUniqueId());
        }
        announce(ChatColor.RED + "第 " + floor + "/" + maxFloor() + " 层：" + theme.name()
                + "，" + theme.mobs().length + " 只怪物！");
    }

    private void updateBossBar() {
        if (bossBar == null || bossId == null) return;
        for (UUID id : participants) {
            Player player = Bukkit.getPlayer(id);
            if (player != null && inFloor(player.getLocation(), floor)) bossBar.addPlayer(player);
        }
        Entity entity = Bukkit.getEntity(bossId);
        if (!(entity instanceof Ravager ravager) || !ravager.isValid() || ravager.isDead()) {
            bossBar.setProgress(0);
            return;
        }
        bossBar.setProgress(Math.max(0, Math.min(1, ravager.getHealth() / ravager.getMaxHealth())));
    }

    private int rewardFloor() {
        int credited = 0;
        int partySize = 0;
        for (UUID id : participants) {
            Player player = Bukkit.getPlayer(id);
            if (player != null && !player.isDead() && inFloor(player.getLocation(), floor)) partySize++;
        }
        for (UUID id : participants) {
            Player p = Bukkit.getPlayer(id);
            if (p == null || p.isDead() || !inFloor(p.getLocation(), floor)) continue;
            for (Loot loot : THEMES.get(floor - 1).rewards()) {
                String path = rewardPath(id, loot.material());
                plugin.getConfig().set(path, plugin.getConfig().getInt(path, 0) + loot.amount());
            }
            DungeonLoot.Bonus bonus = DungeonLoot.roll(floor,
                    plugin.getConfig().getInt(RARE_MISSES + id, 0));
            List<ItemStack> queue = bonusItems(id);
            if (queue.size() < MAX_BONUS_QUEUE) {
                queue.add(bonus.item());
                plugin.getConfig().set(BONUS_ITEMS + id, queue);
                plugin.getConfig().set(RARE_MISSES + id,
                        bonus.rare() ? 0 : plugin.getConfig().getInt(RARE_MISSES + id, 0) + 1);
                p.sendMessage((bonus.rare() ? ChatColor.LIGHT_PURPLE : ChatColor.AQUA)
                        + "本层额外战利品：" + bonus.label() + "，已存入个人箱子。");
            } else {
                String path = rewardPath(id, bonus.rare() ? Material.DIAMOND : Material.EMERALD);
                plugin.getConfig().set(path, plugin.getConfig().getInt(path, 0) + 1);
                p.sendMessage(ChatColor.YELLOW + "个人宝箱特殊物品已满，额外战利品折成 "
                        + (bonus.rare() ? "钻石" : "绿宝石") + " ×1 保存。请先领取箱内物品。");
            }
            if (floor == 3) plugin.teachArenaSkills(p);
            if (floor == BASE_FLOORS && expanded) {
                p.getPersistentDataContainer().set(checkpointKey, PersistentDataType.BYTE, (byte) 1);
                p.saveData();
                p.sendMessage(ChatColor.GOLD + "已解锁第七层灯火驿站直达；今后可在罗盘或 /mycli arena rest 进入。");
            }
            if (floor == BOSS_FLOOR) {
                List<ItemStack> relics = bonusItems(id);
                if (relics.size() < MAX_BONUS_QUEUE) {
                    relics.add(0, DungeonLoot.bossRelic());
                    plugin.getConfig().set(BONUS_ITEMS + id, relics);
                    p.sendMessage(ChatColor.LIGHT_PURPLE + "首领战利品「深渊裁决」已存入个人箱子。");
                } else plugin.getConfig().set(rewardPath(id, Material.DIAMOND),
                        pending(id, Material.DIAMOND) + 3);
            }
            plugin.guildFloorCleared(p, floor, partySize);
            p.sendTitle(ChatColor.GOLD + "第 " + floor + " 层过关", ChatColor.YELLOW + "奖励已存入个人箱子", 5, 55, 10);
            p.sendMessage(ChatColor.GOLD + "奖励在本层宝箱或地面大厅的宝箱里；打开后点物品领取。");
            credited++;
        }
        plugin.saveConfig();
        plugin.getLogger().info("Dungeon floor reward: floor=" + floor + ", credited=" + credited);
        return credited;
    }

    private void finish(boolean won, String message) {
        if (!active) return;
        plugin.getLogger().info("Dungeon finished: won=" + won + ", floor=" + floor + ", message=" + message);
        cleanupMobs();
        announce((won ? ChatColor.GREEN : ChatColor.YELLOW) + message);
        active = false;
        advanceAt = 0;
        pausedAt = 0;
        participants.clear();
        lastRun = System.currentTimeMillis();
        plugin.getConfig().set("dungeon-last-run", lastRun);
        plugin.getConfig().set(RUN_STATE, null);
        plugin.saveConfig();
    }

    private void announce(String message) {
        for (Player p : Bukkit.getOnlinePlayers()) if (inFloor(p.getLocation(), floor)) p.sendMessage(message);
    }

    private String rewardPath(UUID id, Material material) {
        return REWARDS + id + "." + material.name().toLowerCase(Locale.ROOT);
    }

    private List<ItemStack> bonusItems(UUID id) {
        List<ItemStack> result = new ArrayList<>();
        List<?> saved = plugin.getConfig().getList(BONUS_ITEMS + id);
        if (saved != null) for (Object entry : saved) {
            if (entry instanceof ItemStack item) result.add(item.clone());
            else plugin.getLogger().warning("Ignored invalid personal dungeon item: player=" + id);
        }
        return result;
    }
    boolean queueGuildRewards(UUID id, int emeralds, Material bonus, int bonusCount) {
        if (emeralds <= 0 || bonus == null || !bonus.isItem() || bonusCount <= 0 || bonusCount > 64) return false;
        long emeraldTotal = (long) pending(id, Material.EMERALD) + emeralds;
        boolean standardBonus = List.of(REWARD_TYPES).contains(bonus);
        long bonusTotal = standardBonus ? (long) pending(id, bonus) + bonusCount : 0;
        if (bonus == Material.EMERALD) emeraldTotal += bonusCount;
        if (emeraldTotal < 0 || bonusTotal < 0
                || emeraldTotal > Integer.MAX_VALUE || bonusTotal > Integer.MAX_VALUE) return false;
        List<ItemStack> extra = null;
        if (!standardBonus) {
            extra = bonusItems(id);
            if (extra.size() >= MAX_BONUS_QUEUE) return false;
            extra.add(new ItemStack(bonus, bonusCount));
        }
        plugin.getConfig().set(rewardPath(id, Material.EMERALD), (int) emeraldTotal);
        if (standardBonus && bonus != Material.EMERALD)
            plugin.getConfig().set(rewardPath(id, bonus), (int) bonusTotal);
        if (extra != null) plugin.getConfig().set(BONUS_ITEMS + id, extra);
        return true;
    }
    private int pending(UUID id, Material material) {
        return plugin.getConfig().getInt(rewardPath(id, material), 0);
    }
    private void openRewards(Player player) {
        Inventory inv = Bukkit.createInventory(null, 27, ChatColor.GOLD + "个人试炼奖励箱");
        rewardMenus.put(inv, player.getUniqueId());
        refreshRewards(inv, player.getUniqueId());
        player.openInventory(inv);
        player.sendMessage(ChatColor.YELLOW + "点击箱内物品领取；背包满时物品留在箱中。离线或重启后也能再领。");
    }
    private void refreshRewards(Inventory inv, UUID id) {
        for (int slot = 0; slot < REWARD_TYPES.length; slot++) {
            int count = pending(id, REWARD_TYPES[slot]);
            inv.setItem(slot, count > 0 ? new ItemStack(REWARD_TYPES[slot], Math.min(64, count)) : null);
        }
        List<ItemStack> bonus = bonusItems(id);
        for (int slot = 9; slot < 18; slot++)
            inv.setItem(slot, slot - 9 < bonus.size() ? bonus.get(slot - 9).clone() : null);
        ItemStack guide = new ItemStack(Material.BOOK);
        ItemMeta meta = guide.getItemMeta();
        meta.setDisplayName(ChatColor.YELLOW + "点击上排物品领取");
        meta.setLore(List.of(ChatColor.GRAY + "上排为保底物资；中排为随机战利品",
                ChatColor.GRAY + "特殊物品待领 " + bonus.size() + " 件，先显示前 9 件",
                ChatColor.GRAY + "背包满时奖励留在箱中"));
        guide.setItemMeta(meta);
        inv.setItem(22, guide);
    }
    @EventHandler public void onRewardClick(InventoryClickEvent event) {
        Inventory inv = event.getView().getTopInventory();
        UUID owner = rewardMenus.get(inv);
        if (owner == null) return;
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player p) || !p.getUniqueId().equals(owner)) return;
        int slot = event.getRawSlot();
        if (slot >= 9 && slot < 18) {
            claimBonus(p, inv, owner, slot - 9);
            return;
        }
        if (slot < 0 || slot >= REWARD_TYPES.length) return;
        Material material = REWARD_TYPES[slot];
        int count = Math.min(64, pending(owner, material));
        if (count <= 0) return;
        Map<Integer, ItemStack> leftover = p.getInventory().addItem(new ItemStack(material, count));
        int unclaimed = leftover.values().stream().mapToInt(ItemStack::getAmount).sum();
        int delivered = count - unclaimed;
        if (delivered <= 0) { p.sendMessage(ChatColor.YELLOW + "背包已满，奖励仍在箱子里。"); return; }
        String path = rewardPath(owner, material);
        plugin.getConfig().set(path, pending(owner, material) - delivered);
        plugin.saveConfig();
        p.saveData();
        refreshRewards(inv, owner);
        plugin.guildRewardClaimed(p);
        p.sendMessage(ChatColor.GREEN + "从奖励箱领取了 " + delivered + " × " + rewardName(material) + "。"
                + (unclaimed > 0 ? "剩余物品仍在箱中。" : ""));
        plugin.getLogger().info("Dungeon reward claimed: player=" + owner + ", item=" + material + ", count=" + delivered);
    }

    private void claimBonus(Player player, Inventory inv, UUID owner, int index) {
        List<ItemStack> queue = bonusItems(owner);
        if (index >= queue.size()) return;
        ItemStack item = queue.get(index).clone();
        Map<Integer, ItemStack> leftover = player.getInventory().addItem(item.clone());
        int remaining = leftover.values().stream().mapToInt(ItemStack::getAmount).sum();
        int delivered = item.getAmount() - remaining;
        if (delivered <= 0) {
            player.sendMessage(ChatColor.YELLOW + "背包已满，随机战利品仍在箱子里。"); return;
        }
        if (remaining == 0) queue.remove(index);
        else {
            item.setAmount(remaining);
            queue.set(index, item);
        }
        plugin.getConfig().set(BONUS_ITEMS + owner, queue);
        plugin.saveConfig();
        player.saveData();
        refreshRewards(inv, owner);
        plugin.guildRewardClaimed(player);
        player.sendMessage(ChatColor.GREEN + "从个人箱子领取了随机战利品 " + delivered + " 件。");
        plugin.getLogger().info("Dungeon bonus claimed: player=" + owner + ", item="
                + item.getType() + ", count=" + delivered);
    }
    private String rewardName(Material material) {
        return switch (material) {
            case EMERALD -> "绿宝石";
            case IRON_INGOT -> "铁锭";
            case BREAD -> "面包";
            case EXPERIENCE_BOTTLE -> "附魔之瓶";
            case GOLDEN_APPLE -> "金苹果";
            case LAPIS_LAZULI -> "青金石";
            case ARROW -> "箭";
            case DIAMOND -> "钻石";
            default -> material.name();
        };
    }
    @EventHandler public void onRewardDrag(InventoryDragEvent event) {
        if (rewardMenus.containsKey(event.getView().getTopInventory())) event.setCancelled(true);
    }
    @EventHandler public void onRewardClose(InventoryCloseEvent event) { rewardMenus.remove(event.getInventory()); }

    private void cleanupMobs() {
        if (bossBar != null) {
            bossBar.removeAll();
            bossBar = null;
        }
        bossId = null;
        for (UUID id : mobs) {
            Entity e = Bukkit.getEntity(id);
            if (e != null) e.remove();
        }
        mobs.clear();
        World w = world();
        if (w == null || !built) return;
        // The arena's four chunks may have unloaded while every player was disconnected.
        // Load them before looking for tagged mobs, or old mobs return beside the retried wave.
        for (int number = 1; number <= maxFloor(); number++) {
            int radius = radius(number), fx = floorX(number), fz = floorZ(number);
            for (int cx = (fx - radius) >> 4; cx <= (fx + radius) >> 4; cx++)
                for (int cz = (fz - radius) >> 4; cz <= (fz + radius) >> 4; cz++)
                    w.getChunkAt(cx, cz);
            for (Entity e : w.getNearbyEntities(new Location(w, fx + 0.5, Y[number - 1] + 4,
                    fz + 0.5), radius + 2, 8, radius + 2))
                if (e.getScoreboardTags().contains(MOB_TAG)) e.remove();
        }
    }

    @EventHandler public void onDungeonMobDeath(EntityDeathEvent event) {
        if (!active || !mobs.contains(event.getEntity().getUniqueId())
                || !event.getEntity().getPersistentDataContainer().has(mobKey, PersistentDataType.BYTE)
                || floorAt(event.getEntity().getLocation()) != floor) return;
        for (UUID id : participants) {
            Player player = Bukkit.getPlayer(id);
            if (player != null && !player.isDead() && inFloor(player.getLocation(), floor))
                plugin.guildMobDefeated(player);
        }
    }

    void build(CommandSender sender) {
        if (built) { sender.sendMessage("六层基础试炼已经建成；拒绝重复覆盖。"); return; }
        if (!plugin.getConfig().getBoolean("arena-built", false)) { sender.sendMessage("请先建原有地面试炼场。"); return; }
        if (plugin.getConfig().getBoolean("dungeon-building", false)) {
            sender.sendMessage("上次施工中断；必须检查世界或从备份恢复，不可重试覆盖。"); return;
        }
        World w = world();
        if (w == null) { sender.sendMessage("主世界尚未加载。"); return; }
        for (Player p : Bukkit.getOnlinePlayers()) if (p.getGameMode() != GameMode.SPECTATOR
                && sameWorld(p.getLocation()) && Math.abs(p.getLocation().getBlockX() - X) <= RADIUS
                && Math.abs(p.getLocation().getBlockZ() - Z) <= RADIUS
                && p.getLocation().getY() >= Y[BASE_FLOORS - 1] && p.getLocation().getY() <= LOBBY_Y + 8) {
            sender.sendMessage("施工范围内有人：" + p.getName()); return;
        }
        for (int number = 1; number <= BASE_FLOORS; number++) for (int dx = -RADIUS; dx <= RADIUS; dx++)
            for (int dz = -RADIUS; dz <= RADIUS; dz++)
            for (int dy = 0; dy <= 7; dy++) {
                Block b = w.getBlockAt(X + dx, Y[number - 1] + dy, Z + dz);
                if (b.getState() instanceof TileState || suspicious(b.getType())) {
                    sender.sendMessage("地下发现建筑或容器，未施工：" + b.getLocation() + " " + b.getType()); return;
                }
            }
        for (int[] pos : new int[][]{{X - 4, LOBBY_Y + 1, Z - 8},{X - 4, LOBBY_Y + 1, Z - 9}})
            if (w.getBlockAt(pos[0], pos[1], pos[2]).getType() != Material.AIR) {
                sender.sendMessage("地面大厅奖励箱位置不是空气，未施工。"); return;
            }
        plugin.getConfig().set("dungeon-building", true);
        plugin.saveConfig();
        for (int i = 0; i < BASE_FLOORS; i++) buildFloor(w, i + 1);
        w.getBlockAt(X - 4, LOBBY_Y, Z - 8).setType(Material.GOLD_BLOCK, false);
        w.getBlockAt(X - 4, LOBBY_Y + 1, Z - 8).setType(Material.CHEST, false);
        placeSign(w.getBlockAt(X - 4, LOBBY_Y + 1, Z - 9), "奖励箱", "每人独立", "手动领取");
        built = true;
        plugin.getConfig().set("dungeon-built", true);
        plugin.getConfig().set("dungeon-building", false);
        plugin.saveConfig();
        sender.sendMessage("六层试炼已建于原试炼场地下；入口仍使用原石按钮。");
        plugin.getLogger().info("Dungeon built at " + X + "," + Z + " floors=6, y=68..8");
    }

    private boolean suspicious(Material material) {
        String name = material.name();
        return material == Material.BEDROCK || name.contains("CHEST") || name.contains("BARREL")
                || name.contains("PLANKS") || name.contains("BRICKS") || name.contains("DOOR")
                || name.contains("SIGN") || name.contains("BED") || name.contains("LECTERN")
                || name.contains("SPAWNER") || name.contains("RAIL") || name.contains("TORCH")
                || name.contains("FURNACE") || name.contains("GLASS") || name.contains("WOOL")
                || name.contains("BANNER") || name.contains("FENCE") || name.contains("TRAPDOOR")
                || name.contains("LADDER") || name.contains("BOOKSHELF") || name.contains("LANTERN")
                || name.contains("HOPPER") || name.contains("DISPENSER") || name.contains("DROPPER")
                || name.endsWith("_CHAIN") || material == Material.CHAIN;
    }

    void surveyExpansion(CommandSender sender) { surveyExpansionSite(sender); }

    private boolean surveyExpansionSite(CommandSender sender) {
        if (!built || !plugin.getConfig().getBoolean("dungeon-built", false)) {
            sender.sendMessage("六层基础试炼未建成，不能扩建。"); return false;
        }
        if (expanded) { sender.sendMessage("深层分区已经建成，拒绝重复覆盖。"); return false; }
        if (active || plugin.getConfig().isConfigurationSection(RUN_STATE)) {
            sender.sendMessage("当前有活动试炼或重连检查点，不能施工。"); return false;
        }
        if (plugin.getConfig().getBoolean("dungeon-expansion-building", false)) {
            sender.sendMessage("上次深层施工中断；先核查并从施工前备份恢复。"); return false;
        }
        World w = world();
        if (w == null || Y[BOSS_FLOOR - 1] < w.getMinHeight() + 4) {
            sender.sendMessage("主世界未加载或深度不足。"); return false;
        }
        for (Player player : Bukkit.getOnlinePlayers()) {
            if (player.getGameMode() == GameMode.SPECTATOR || !sameWorld(player.getLocation())) continue;
            Location at = player.getLocation();
            if (Math.abs(at.getBlockX() - WING_X) <= radius(BOSS_FLOOR)
                    && Math.abs(at.getBlockZ() - WING_Z) <= radius(BOSS_FLOOR)
                    && at.getY() >= Y[BOSS_FLOOR - 1] && at.getY() <= Y[REST_FLOOR - 1] + 7) {
                sender.sendMessage("施工区域里有玩家：" + player.getName()); return false;
            }
        }
        for (int number = REST_FLOOR; number <= BOSS_FLOOR; number++) {
            int radius = radius(number), y = Y[number - 1];
            for (int dx = -radius; dx <= radius; dx++) for (int dz = -radius; dz <= radius; dz++)
                for (int dy = 0; dy <= 7; dy++) {
                    Block block = w.getBlockAt(WING_X + dx, y + dy, WING_Z + dz);
                    if (block.getState() instanceof TileState || suspicious(block.getType())) {
                        sender.sendMessage("深层发现容器或结构，拒绝施工：" + block.getLocation()
                                + " " + block.getType()); return false;
                    }
                }
        }
        sender.sendMessage("深层勘察通过：四层位于 " + WING_X + "," + WING_Z
                + "，Y=-4..-40；未发现容器、人工结构或在场玩家。");
        return true;
    }

    void buildExpansion(CommandSender sender) {
        if (!surveyExpansionSite(sender)) return;
        World w = world();
        plugin.getConfig().set("dungeon-expansion-building", true);
        plugin.saveConfig();
        for (int number = REST_FLOOR; number <= BOSS_FLOOR; number++) buildFloor(w, number);
        expanded = true;
        plugin.getConfig().set("dungeon-expanded", true);
        plugin.getConfig().set("dungeon-expansion-building", false);
        plugin.saveConfig();
        ensureMerchant();
        updateFloorGuides();
        sender.sendMessage("深层四层已建成：第七层驿站、第八九层大房间和第十层首领殿。");
        plugin.getLogger().info("Deep dungeon wing built at " + WING_X + "," + WING_Z + ", y=-40..3");
    }

    private void buildRestWorkstations(World w) {
        int y = Y[REST_FLOOR - 1] + 1;
        int[][] positions = {{-5,0},{-5,2},{-5,-2},{-2,-5},{0,-5},{2,-5},{5,0},{5,2}};
        Material[] blocks = {Material.CRAFTING_TABLE, Material.FURNACE, Material.BLAST_FURNACE,
                Material.ANVIL, Material.SMITHING_TABLE, Material.GRINDSTONE,
                Material.ENCHANTING_TABLE, Material.STONECUTTER};
        for (int i = 0; i < blocks.length; i++)
            w.getBlockAt(WING_X + positions[i][0], y, WING_Z + positions[i][1]).setType(blocks[i], false);
        for (int dx = -3; dx <= 3; dx++)
            w.getBlockAt(WING_X + dx, y, WING_Z + 7).setType(Material.CHERRY_SLAB, false);
        placeSign(w.getBlockAt(WING_X + 8, y, WING_Z - 5),
                "灯火驿站", "商人和工位", "物品请带走");
    }

    private List<MerchantRecipe> merchantRecipes() {
        List<MerchantRecipe> recipes = new ArrayList<>();
        for (Object[] offer : new Object[][]{
                {Material.TORCH, 16, 1}, {Material.ARROW, 16, 2},
                {Material.COOKED_BEEF, 8, 2}, {Material.SHIELD, 1, 4},
                {Material.IRON_SWORD, 1, 5}, {Material.GOLDEN_APPLE, 1, 8}}) {
            MerchantRecipe recipe = new MerchantRecipe(new ItemStack((Material) offer[0], (int) offer[1]), 100000);
            recipe.addIngredient(new ItemStack(Material.EMERALD, (int) offer[2]));
            recipes.add(recipe);
        }
        return recipes;
    }

    private Villager ensureMerchant() {
        if (!expanded || world() == null) return null;
        Location at = new Location(world(), WING_X + 7.5, Y[REST_FLOOR - 1] + 1, WING_Z - 4.5);
        Villager merchant = null;
        for (Entity entity : world().getNearbyEntities(at, 12, 6, 12)) {
            if (!(entity instanceof Villager villager)
                    || !villager.getPersistentDataContainer().has(merchantKey, PersistentDataType.BYTE)) continue;
            if (merchant == null) merchant = villager;
            else villager.remove();
        }
        if (merchant == null) {
            merchant = world().spawn(at, Villager.class);
            merchant.getPersistentDataContainer().set(merchantKey, PersistentDataType.BYTE, (byte) 1);
        }
        merchant.setProfession(Villager.Profession.CLERIC);
        merchant.setVillagerLevel(5);
        merchant.setCustomName(ChatColor.GOLD + "灯火驿站商人");
        merchant.setCustomNameVisible(true);
        merchant.setAI(false);
        merchant.setInvulnerable(true);
        merchant.setRemoveWhenFarAway(false);
        merchant.setRecipes(merchantRecipes());
        return merchant;
    }

    private void openShop(Player player) {
        if (!expanded || !active || floor != REST_FLOOR || !participants.contains(player.getUniqueId())
                || !inFloor(player.getLocation(), REST_FLOOR)) {
            player.sendMessage(ChatColor.YELLOW + "在第七层灯火驿站内才能与商人交易。"); return;
        }
        Villager merchant = ensureMerchant();
        if (merchant == null) player.sendMessage(ChatColor.RED + "驿站商人暂时不在，请联系服主。");
        else player.openMerchant(merchant, true);
    }

    private void buildFloor(World w, int number) {
        Theme theme = THEMES.get(number - 1);
        int y = Y[number - 1], r = radius(number), fx = floorX(number), fz = floorZ(number);
        for (int dx = -r; dx <= r; dx++) for (int dz = -r; dz <= r; dz++)
            for (int dy = 0; dy <= 7; dy++) {
                Material material = dy == 0 ? theme.floor() : dy == 7 ? theme.wall()
                        : Math.abs(dx) == r || Math.abs(dz) == r ? theme.wall() : Material.AIR;
                Block b = w.getBlockAt(fx + dx, y + dy, fz + dz);
                if (b.getType() != material) b.setType(material, false);
            }
        int pillar = r - 4;
        for (int dx : new int[]{-pillar, pillar}) for (int dz : new int[]{-pillar, pillar}) {
            for (int dy = 1; dy <= 2; dy++) w.getBlockAt(fx + dx, y + dy, fz + dz).setType(theme.pillar(), false);
            w.getBlockAt(fx + dx, y + 6, fz + dz).setType(Material.SEA_LANTERN, false);
        }
        w.getBlockAt(chestX(number), y, chestZ(number)).setType(Material.GOLD_BLOCK, false);
        w.getBlockAt(chestX(number), y + 1, chestZ(number)).setType(Material.CHEST, false);
        w.getBlockAt(nextX(number), y, chestZ(number)).setType(Material.EMERALD_BLOCK, false);
        placeButton(w.getBlockAt(nextX(number), y + 1, chestZ(number)), Material.STONE_BUTTON);
        w.getBlockAt(leaveX(number), y, chestZ(number)).setType(Material.REDSTONE_BLOCK, false);
        placeButton(w.getBlockAt(leaveX(number), y + 1, chestZ(number)), Material.OAK_BUTTON);
        placeSign(w.getBlockAt(chestX(number), y + 1, chestZ(number) - 1), "奖励箱", "每人独立", "手动领取");
        placeSign(w.getBlockAt(nextX(number), y + 1, chestZ(number) - 1), "下一层", "绿色按钮", "自动下楼");
        placeSign(w.getBlockAt(leaveX(number), y + 1, chestZ(number) - 1), "回地面", "红色按钮", "奖励保留");
        if (number == REST_FLOOR) buildRestWorkstations(w);
        if (number == BOSS_FLOOR) {
            for (int dx = -5; dx <= 5; dx++) for (int dz = 8; dz <= 12; dz++)
                w.getBlockAt(fx + dx, y, fz + dz).setType(Material.GILDED_BLACKSTONE, false);
        }
    }
    private void placeButton(Block block, Material material) {
        Switch data = (Switch) Bukkit.createBlockData(material);
        data.setAttachedFace(Switch.AttachedFace.FLOOR);
        block.setBlockData(data, false);
    }
    private void placeSign(Block block, String a, String b, String c) {
        block.setType(Material.OAK_SIGN, false);
        if (block.getState() instanceof Sign sign) {
            sign.setLine(0, a);
            sign.setLine(1, b);
            sign.setLine(2, c);
            sign.update(true, false);
        }
    }

    private void updateFloorGuides() {
        World w = world();
        if (w == null) return;
        for (int number = 1; number <= maxFloor(); number++) {
            Block block = w.getBlockAt(nextX(number), Y[number - 1] + 1, chestZ(number) - 1);
            if (!(block.getState() instanceof Sign sign)) continue;
            if (number == maxFloor()) {
                sign.setLine(0, "最终宝库");
                sign.setLine(1, "清怪后完成");
                sign.setLine(2, "领取奖励");
                sign.setLine(3, "红钮离开");
            } else if (number == REST_FLOOR) {
                sign.setLine(0, "灯火驿站");
                sign.setLine(1, "休息补给");
                sign.setLine(2, "绿钮提前出发");
                sign.setLine(3, "三分钟自动下楼");
            } else {
                sign.setLine(0, "自动下楼");
                sign.setLine(1, "清怪后等待");
                sign.setLine(2, "10秒");
                sign.setLine(3, "无需按键");
            }
            sign.update(true, false);
        }
    }

    @EventHandler public void onNaturalSpawn(CreatureSpawnEvent event) {
        if (built && event.getEntity() instanceof Monster && floorAt(event.getLocation()) > 0
                && event.getSpawnReason() != CreatureSpawnEvent.SpawnReason.CUSTOM) event.setCancelled(true);
    }
    @EventHandler public void onBreak(BlockBreakEvent event) { if (inBuild(event.getBlock().getLocation())) event.setCancelled(true); }
    @EventHandler public void onPlace(BlockPlaceEvent event) { if (inBuild(event.getBlock().getLocation())) event.setCancelled(true); }
    @EventHandler public void onChange(EntityChangeBlockEvent event) { if (inBuild(event.getBlock().getLocation())) event.setCancelled(true); }
    @EventHandler public void onBurn(BlockBurnEvent event) { if (inBuild(event.getBlock().getLocation())) event.setCancelled(true); }
    @EventHandler public void onIgnite(BlockIgniteEvent event) { if (inBuild(event.getBlock().getLocation())) event.setCancelled(true); }
    @EventHandler public void onFlow(BlockFromToEvent event) { if (inBuild(event.getToBlock().getLocation())) event.setCancelled(true); }
    @EventHandler public void onExplosion(EntityExplodeEvent event) { if (built) event.blockList().removeIf(b -> inBuild(b.getLocation())); }
    @EventHandler public void onBlockExplosion(BlockExplodeEvent event) { if (built) event.blockList().removeIf(b -> inBuild(b.getLocation())); }
}
