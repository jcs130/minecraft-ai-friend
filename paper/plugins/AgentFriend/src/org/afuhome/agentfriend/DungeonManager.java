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
import java.util.concurrent.ThreadLocalRandom;
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
import org.bukkit.entity.Mob;
import org.bukkit.entity.Monster;
import org.bukkit.entity.Player;
import org.bukkit.entity.Ravager;
import org.bukkit.entity.Villager;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
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
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.entity.EntityTargetLivingEntityEvent;
import org.bukkit.event.entity.PotionSplashEvent;
import org.bukkit.event.entity.ProjectileLaunchEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.MerchantRecipe;
import org.bukkit.projectiles.ProjectileSource;
import org.bukkit.entity.Projectile;
import org.bukkit.persistence.PersistentDataType;

/** Vanilla-protocol trial tower with optional deep and challenge wings. */
final class DungeonManager implements Listener {
    private static final int X = -590, Z = -305, WING_X = -510, WING_Z = -305, CHALLENGE_X = -350;
    private static final int LOBBY_Y = 90, RADIUS = 12, BASE_FLOORS = 6, REST_FLOOR = 7,
            BOSS_FLOOR = 10, OLD_MAX_FLOOR = 10, FINAL_FLOOR = 15;
    private static final int[] Y = {68, 56, 44, 32, 20, 8, -4, -16, -28, -40,
            -40, -28, -16, -4, 8};
    private static final int[] RADII = {12, 12, 12, 12, 12, 12, 16, 18, 18, 20,
            22, 22, 22, 22, 24};
    private static final double BUTTON_GROUP_RADIUS_SQUARED = 12.0 * 12.0;
    private static final long COOLDOWN_MS = 180_000L;
    private static final long RUN_TIMEOUT_MS = 3_600_000L;
    private static final long FLOOR_TIMEOUT_MS = 480_000L;
    private static final long NEXT_FLOOR_DELAY_MS = 10_000L;
    private static final long REST_DURATION_MS = 180_000L;
    private static final long REJOIN_GRACE_MS = 600_000L;
    private static final long OUTSIDE_GRACE_MS = 15_000L;
    private static final String RUN_STATE = "dungeon-active-run";
    private static final String MOB_TAG = "afu_dungeon_mob";
    private static final String REWARDS = "dungeon-rewards.";
    private static final String BONUS_ITEMS = "dungeon-bonus-items.";
    private static final String STASH = "dungeon-personal-stash.";
    private static final int STASH_SIZE = 54;
    private static final String RARE_MISSES = "dungeon-rare-misses.";
    private static final String DIAMOND_SET_INDEX = "dungeon-diamond-set-index.";
    private static final String BOSS_CLEARS = "dungeon-boss-clears.";
    private static final String FINAL_CLEARS = "dungeon-final-clears.";
    private static final String DAILY_CLAIMS = "dungeon-daily-claims.";
    private static final String DIFFICULTY_CHOICE = "dungeon-difficulty.";
    private static final String DEATH_GUIDE = "dungeon-death-guide.";
    private static final int MAX_BONUS_QUEUE = 128;
    private static final Material[] REWARD_TYPES = {
            Material.EMERALD, Material.IRON_INGOT, Material.BREAD,
            Material.EXPERIENCE_BOTTLE, Material.GOLDEN_APPLE,
            Material.LAPIS_LAZULI, Material.ARROW, Material.DIAMOND};
    private record Loot(Material material, int amount) { }
    private record Theme(String name, Material floor, Material wall, Material pillar,
                         EntityType[] mobs, Loot[] rewards) { }
    private enum Difficulty {
        NORMAL("normal", "普通", 1.0, 1.0, 0, 0, 0),
        ADVENTURE("adventure", "冒险", 1.5, 1.25, 0.025, 2, 2),
        APOCALYPSE("apocalypse", "末日", 2.2, 1.6, 0.05, 4, 5);
        final String id, label;
        final double health, damage, speed, armor;
        final int walletBonus;
        Difficulty(String id, String label, double health, double damage,
                double speed, double armor, int walletBonus) {
            this.id = id; this.label = label; this.health = health;
            this.damage = damage; this.speed = speed; this.armor = armor;
            this.walletBonus = walletBonus;
        }
        static Difficulty parse(String raw) {
            for (Difficulty value : values()) if (value.id.equalsIgnoreCase(raw)) return value;
            return null;
        }
    }
    private record RewardScale(int gap, int percent) {
        static RewardScale forRun(Difficulty recommended, Difficulty played) {
            int gap = Math.max(0, recommended.ordinal() - played.ordinal());
            return new RewardScale(gap, gap == 0 ? 100 : gap == 1 ? 60 : 30);
        }
        int stack(int amount) { return Math.max(1, (amount * percent + 99) / 100); }
        int wallet(int amount) { return amount * percent / 100; }
        boolean bonusRoll() { return gap == 0 || ThreadLocalRandom.current().nextInt(100) < percent; }
    }
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
                            new Loot(Material.GOLDEN_APPLE, 2), new Loot(Material.EXPERIENCE_BOTTLE, 10)}),
            new Theme("断桥要塞", Material.STONE_BRICKS, Material.MOSSY_STONE_BRICKS, Material.POLISHED_ANDESITE,
                    new EntityType[]{EntityType.PILLAGER, EntityType.PILLAGER, EntityType.VINDICATOR,
                            EntityType.VINDICATOR, EntityType.ZOMBIE, EntityType.ZOMBIE, EntityType.SPIDER},
                    new Loot[]{new Loot(Material.EMERALD, 5), new Loot(Material.IRON_INGOT, 5), new Loot(Material.ARROW, 24)}),
            new Theme("沉潮书库", Material.PRISMARINE_BRICKS, Material.DARK_PRISMARINE, Material.SEA_LANTERN,
                    new EntityType[]{EntityType.DROWNED, EntityType.DROWNED, EntityType.DROWNED,
                            EntityType.SKELETON, EntityType.SKELETON, EntityType.WITCH, EntityType.SPIDER},
                    new Loot[]{new Loot(Material.EMERALD, 6), new Loot(Material.DIAMOND, 1), new Loot(Material.GOLDEN_APPLE, 1)}),
            new Theme("赤铜熔炉", Material.POLISHED_BLACKSTONE, Material.TUFF_BRICKS, Material.COPPER_BLOCK,
                    new EntityType[]{EntityType.BLAZE, EntityType.BLAZE, EntityType.MAGMA_CUBE,
                            EntityType.MAGMA_CUBE, EntityType.VINDICATOR, EntityType.ZOMBIE, EntityType.ZOMBIE},
                    new Loot[]{new Loot(Material.EMERALD, 7), new Loot(Material.DIAMOND, 1), new Loot(Material.GOLDEN_APPLE, 2)}),
            new Theme("机关回廊", Material.CHISELED_STONE_BRICKS, Material.DEEPSLATE_TILES, Material.IRON_BLOCK,
                    new EntityType[]{EntityType.PILLAGER, EntityType.PILLAGER, EntityType.STRAY,
                            EntityType.STRAY, EntityType.VINDICATOR, EntityType.VINDICATOR, EntityType.WITCH},
                    new Loot[]{new Loot(Material.EMERALD, 8), new Loot(Material.DIAMOND, 2), new Loot(Material.EXPERIENCE_BOTTLE, 8)}),
            new Theme("星灯主宰之庭", Material.PURPUR_BLOCK, Material.POLISHED_BLACKSTONE_BRICKS, Material.AMETHYST_BLOCK,
                    new EntityType[]{EntityType.RAVAGER, EntityType.WITCH, EntityType.PILLAGER,
                            EntityType.PILLAGER, EntityType.VINDICATOR, EntityType.VINDICATOR},
                    new Loot[]{new Loot(Material.EMERALD, 12), new Loot(Material.DIAMOND, 3),
                            new Loot(Material.GOLDEN_APPLE, 2), new Loot(Material.EXPERIENCE_BOTTLE, 12)}));

    private final AgentFriendPlugin plugin;
    private final NamespacedKey mobKey;
    private final NamespacedKey checkpointKey;
    private final NamespacedKey merchantKey;
    private final Set<UUID> participants = new HashSet<>();
    private final Set<UUID> mobs = new HashSet<>();
    private final Map<Inventory, UUID> stashMenus = new IdentityHashMap<>();
    private final Map<UUID, String> lastMobDamage = new HashMap<>();
    private final Map<UUID, Location> lastMobPosition = new HashMap<>();
    private final Map<UUID, Long> lastMobMovedAt = new HashMap<>();
    private final Map<UUID, Long> lastMobAttackAt = new HashMap<>();
    private final Map<UUID, Long> lastMobProjectileAt = new HashMap<>();
    private final ArenaEconomy economy;
    private boolean built;
    private boolean expanded;
    private boolean challengeBuilt;
    private boolean active;
    private boolean spawned;
    private boolean cleared;
    private int floor;
    private Difficulty difficulty = Difficulty.NORMAL;
    private long runStartedAt;
    private long floorStartedAt;
    private long spawnAt;
    private long advanceAt;
    private long pausedAt;
    private long outsideSince;
    private long lastRun;
    private UUID bossId;
    private BossBar bossBar;

    DungeonManager(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        mobKey = new NamespacedKey(plugin, "dungeon_mob");
        checkpointKey = new NamespacedKey(plugin, "dungeon_rest_unlocked");
        merchantKey = new NamespacedKey(plugin, "dungeon_merchant");
        economy = new ArenaEconomy(plugin, this);
        built = plugin.getConfig().getBoolean("dungeon-built", false);
        expanded = plugin.getConfig().getBoolean("dungeon-expanded", false);
        challengeBuilt = plugin.getConfig().getBoolean("dungeon-challenge-built", false);
        lastRun = plugin.getConfig().getLong("dungeon-last-run", 0L);
        if (plugin.getConfig().getBoolean("dungeon-building", false) && !built)
            plugin.getLogger().severe("Interrupted dungeon construction: inspect or restore the world before retrying.");
        if (plugin.getConfig().getBoolean("dungeon-expansion-building", false) && !expanded)
            plugin.getLogger().severe("Interrupted deep-wing construction: inspect or restore before retrying.");
        if (plugin.getConfig().getBoolean("dungeon-challenge-building", false) && !challengeBuilt)
            plugin.getLogger().severe("Interrupted challenge-wing construction: inspect or restore before retrying.");
        plugin.getServer().getPluginManager().registerEvents(this, plugin);
        if (built) {
            cleanupMobs();
            updateFloorGuides();
            if (expanded) ensureMerchants();
            restoreRun();
        }
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 20L, 20L);
        plugin.getLogger().info("Dungeon ready; built=" + built + ", floors=" + maxFloor());
    }

    boolean isBuilt() { return built; }
    boolean isExpanded() { return expanded; }
    private int maxFloor() { return challengeBuilt ? FINAL_FLOOR : expanded ? OLD_MAX_FLOOR : BASE_FLOORS; }
    private int floorX(int number) { return number <= BASE_FLOORS ? X : number <= OLD_MAX_FLOOR ? WING_X : CHALLENGE_X; }
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
        for (Map.Entry<Inventory, UUID> entry : stashMenus.entrySet()) saveStash(entry.getKey(), entry.getValue());
        stashMenus.clear();
    }

    private World world() { return Bukkit.getWorld("world"); }
    private boolean sameWorld(Location at) { return at != null && at.getWorld() != null && at.getWorld().equals(world()); }

    private void persistRun() {
        if (!active) return;
        plugin.getConfig().set(RUN_STATE + ".floor", floor);
        plugin.getConfig().set(RUN_STATE + ".difficulty", difficulty.id);
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
        Difficulty savedDifficulty = Difficulty.parse(plugin.getConfig().getString(RUN_STATE + ".difficulty", "normal"));
        difficulty = savedDifficulty == null ? Difficulty.NORMAL : savedDifficulty;
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
        outsideSince = 0;
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
        outsideSince = 0;
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
                // Floors 12 and 13 have recessed water/lava one block below the walking surface.
                // A living participant standing in either trench still belongs to this floor.
                && at.getY() >= y && at.getY() <= y + 7;
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
        if (challengeBuilt) for (int number = OLD_MAX_FLOOR + 1; number <= FINAL_FLOOR; number++)
            if (at.getY() >= Y[number - 1] && at.getY() <= Y[number - 1] + 7
                    && Math.abs(at.getBlockX() - CHALLENGE_X) <= radius(number)
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
            case "status" -> {
                boolean participant = active && participants.contains(player.getUniqueId());
                int selfFloor = floorAt(player.getLocation());
                int remaining = 0, missing = 0, outside = 0;
                if (active && spawned && !cleared) for (UUID id : mobs) {
                    Entity entity = Bukkit.getEntity(id);
                    if (!(entity instanceof LivingEntity living) || !entity.isValid() || living.isDead()) missing++;
                    else {
                        remaining++;
                        if (!inFloor(entity.getLocation(), floor)) outside++;
                    }
                }
                String anomaly = !active ? "none" : participant && selfFloor != floor
                        ? "participant_outside_floor" : outside > 0 ? "mob_outside_floor"
                        : missing > 0 ? "missing_mob_entity" : "none";
                String searchAdvice = !active ? "stop_no_active_run" : !participant ? "not_participating"
                        : selfFloor != floor ? "return_to_floor" : cleared ? "wait_next_floor"
                        : pausedAt > 0 ? "wait_reconnect" : !spawned ? "wait_spawn"
                        : remaining == 0 ? "wait_clear" : "search_remaining_mobs";
                String globalState = !active ? "idle" : pausedAt > 0 ? "waiting_reconnect"
                        : cleared ? "cleared" : spawned ? "fighting" : "preparing";
                String globalDescription = !active ? "待命" : "第 " + floor + "/" + maxFloor()
                        + " 层 · " + THEMES.get(floor - 1).name()
                        + (pausedAt > 0 ? "，队伍暂离，等待重连"
                            : cleared ? "，约 " + Math.max(0, (advanceAt - System.currentTimeMillis() + 999) / 1000)
                                + " 秒后自动下楼" : spawned ? "，战斗中" : "，准备刷怪");
                player.sendMessage(ChatColor.GOLD + "本人试炼：" + (participant ? "参赛中" : "未参赛")
                        + "；全服试炼：" + globalDescription + (active ? "〔" + difficulty.label + "〕" : "") + "。"
                        + (participant ? "奖励存进你的个人箱子，不自动进入背包。" : "只有参赛者获得本轮奖励。")
                        + (!active ? "当前没有进行中的试炼，无需继续搜怪。"
                            : participant && spawned && !cleared ? "本层剩余 " + remaining + " 只怪物。" : ""));
                player.sendMessage("MC_DUNGEON status participant=" + participant
                        + " selfState=" + (participant ? "participating" : "not_participating")
                        + " globalActive=" + active + " globalState=" + globalState
                        + " globalDifficulty=" + (active ? difficulty.id : "none")
                        + " selectedDifficulty=" + chosenDifficulty(player).id
                        + " difficultyMode=" + difficultyMode(player)
                        + " recommendedDifficulty=" + recommendedDifficulty(player).id
                        + " adventurerRank=" + plugin.adventurerRank(player)
                        + " globalFloor=" + (active ? floor : 0) + " maxFloor=" + maxFloor()
                        + " selfFloor=" + selfFloor + " remainingMobs=" + remaining
                        + " trackedMobs=" + (active && spawned && !cleared ? mobs.size() : 0)
                        + " missingMobs=" + missing + " outsideMobs=" + outside
                        + " anomaly=" + anomaly + " searchAdvice=" + searchAdvice
                        + " lastOutcome=" + plugin.getConfig().getString("dungeon-last-outcome", "none")
                        + " lastFloor=" + plugin.getConfig().getInt("dungeon-last-finish-floor", 0)
                        + " lastReason=" + plugin.getConfig().getString("dungeon-last-finish-reason", "none")
                        + " lastRunParticipant=" + plugin.getConfig().getStringList("dungeon-last-participants")
                                .contains(player.getUniqueId().toString()));
                player.sendMessage("MC_DUNGEON entrance " + LocationOutput.fields(lobbyButton())
                        + " chestX=-594 chestY=91 chestZ=-313 scope=public participant=" + participant);
                if (active) player.sendMessage("MC_DUNGEON floor=" + floor + " "
                        + LocationOutput.fields(new Location(world(), floorX(floor), Y[floor - 1] + 1, floorZ(floor)))
                        + " chestX=" + chestX(floor) + " chestY=" + (Y[floor - 1] + 1)
                        + " chestZ=" + chestZ(floor) + " scope=global participant=" + participant);
            }
            case "start" -> start(player);
            case "difficulty", "难度" -> chooseDifficulty(player, args);
            case "rest", "checkpoint", "驿站" -> startAtRest(player);
            case "next" -> next(player);
            case "shop", "商人" -> {
                if (args.length == 2) openShop(player);
                else if (args.length == 3 && args[2].equalsIgnoreCase("merchant")) openLegacyMerchant(player);
                else economy.shop(player, args);
            }
            case "recycle" -> economy.recycle(player, args);
            case "wallet" -> economy.wallet(player);
            case "loot" -> lootProgress(player);
            case "layout" -> layout(player);
            case "rewards", "reward", "箱子" -> rewardCommand(player, args);
            case "stash", "储物" -> stashCommand(player, args);
            case "leave" -> leave(player);
            default -> player.sendMessage(ChatColor.RED + "用法：/mycli arena difficulty normal|adventure|apocalypse；arena start|rest|status|rewards|stash|leave");
        }
    }

    private Difficulty recommendedDifficulty(Player player) {
        int rank = plugin.adventurerRank(player);
        return rank >= 4 ? Difficulty.APOCALYPSE : rank >= 2 ? Difficulty.ADVENTURE : Difficulty.NORMAL;
    }
    String recommendedDifficultyLabel(Player player) { return recommendedDifficulty(player).label; }

    private String difficultyMode(Player player) {
        String saved = plugin.getConfig().getString(DIFFICULTY_CHOICE + player.getUniqueId(), "auto");
        return Difficulty.parse(saved) == null ? "auto" : "manual";
    }

    private Difficulty chosenDifficulty(Player player) {
        Difficulty choice = Difficulty.parse(plugin.getConfig().getString(DIFFICULTY_CHOICE + player.getUniqueId(), "auto"));
        return choice == null ? recommendedDifficulty(player) : choice;
    }

    private void chooseDifficulty(Player player, String[] args) {
        if (args.length == 2 || args.length == 3 && args[2].equalsIgnoreCase("list")) {
            player.sendMessage(ChatColor.GOLD + "试炼难度：普通（适合首次挑战）、冒险（生命 ×1.5 / 伤害 ×1.25）、末日（生命 ×2.2 / 伤害 ×1.6）。"
                    + "默认按冒险者等级自动匹配；高等级打低难度，重复物资和装备会减少。"
                    + "每游戏日每层仍只领一次。开场前由按钮发起者决定全队难度。"
                    + "你的等级：" + plugin.adventurerRankName(player) + "；推荐：" + recommendedDifficulty(player).label
                    + "；当前选择：" + chosenDifficulty(player).label + "（" + difficultyMode(player) + "）。");
            player.sendMessage("MC_DUNGEON_DIFFICULTY selected=" + chosenDifficulty(player).id
                    + " mode=" + difficultyMode(player)
                    + " recommended=" + recommendedDifficulty(player).id
                    + " adventurerRank=" + plugin.adventurerRank(player)
                    + " available=auto,normal,adventure,apocalypse active=" + active
                    + " runDifficulty=" + (active ? difficulty.id : "none")
                    + " dailyLimitPerFloor=1");
            return;
        }
        boolean auto = args.length == 3 && args[2].equalsIgnoreCase("auto");
        Difficulty choice = args.length == 3 ? Difficulty.parse(args[2]) : null;
        if (!auto && choice == null) {
            player.sendMessage(ChatColor.RED + "用法：/mycli arena difficulty auto|normal|adventure|apocalypse");
            return;
        }
        plugin.getConfig().set(DIFFICULTY_CHOICE + player.getUniqueId(), auto ? "auto" : choice.id);
        plugin.saveConfig();
        player.sendMessage(ChatColor.GREEN + (auto ? "已启用自动匹配；当前推荐" + recommendedDifficulty(player).label
                + "。你发起下一场试炼时按当时冒险者等级选择全队难度。"
                : "已选择" + choice.label + "难度；你发起下一场试炼时全队采用该难度。"));
        if (!auto && choice.ordinal() < recommendedDifficulty(player).ordinal()) {
            RewardScale scale = RewardScale.forRun(recommendedDifficulty(player), choice);
            player.sendMessage(ChatColor.YELLOW + "你的冒险者等级推荐" + recommendedDifficulty(player).label
                    + "；重复挑战" + choice.label + "时奖励按 " + scale.percent() + "% 结算，"
                    + "重复保底装备和首领宝藏不再掉落。");
        }
        player.sendMessage("MC_DUNGEON_DIFFICULTY selected=" + chosenDifficulty(player).id
                + " mode=" + difficultyMode(player) + " recommended=" + recommendedDifficulty(player).id
                + " adventurerRank=" + plugin.adventurerRank(player) + " changed=true active=" + active
                + " runDifficulty=" + (active ? difficulty.id : "none"));
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
            openStash(event.getPlayer());
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
            starter.sendMessage(ChatColor.RED + "请站到地面入口石按钮附近 12 格内再启动。 "
                    + LocationOutput.fields(lobbyButton())); return;
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
        difficulty = chosenDifficulty(starter);
        if (enterFloor(1, group) == 0) {
            starter.sendMessage(ChatColor.RED + "地下城入口传送失败，试炼未启动。"); return;
        }
        active = true;
        runStartedAt = now;
        persistRun();
        announce(ChatColor.GOLD + "" + maxFloor() + " 层" + difficulty.label + "试炼开始！入口按钮附近 " + participants.size()
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
        difficulty = chosenDifficulty(starter);
        if (enterFloor(REST_FLOOR, group) == 0) {
            starter.sendMessage(ChatColor.RED + "驿站传送失败，挑战未启动。"); return;
        }
        active = true;
        runStartedAt = now;
        persistRun();
        announce(ChatColor.GOLD + "已从检查点直达第七层驿站〔" + difficulty.label + "〕；队伍可补给，再继续深入。");
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
                if (number == 13) {
                    player.sendMessage(ChatColor.GOLD + "第 13 层岩浆会造成伤害；本层不再自动给予抗火，请观察地形并绕行。");
                    player.sendMessage("MC_DUNGEON_HAZARD floor=13 type=minecraft:lava autoFireResistance=false");
                }
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
        outsideSince = 0;
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
                finish(false, "reconnect_timeout", "断线重连等待已满 10 分钟；已赢得的奖励保存在个人箱子里。");
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
            else if (participants.stream().anyMatch(id -> {
                Player player = Bukkit.getPlayer(id);
                return player != null && player.isOnline() && !player.isDead();
            })) {
                if (outsideSince == 0) {
                    outsideSince = now;
                    for (UUID id : participants) {
                        Player player = Bukkit.getPlayer(id);
                        if (player != null && player.isOnline()) player.sendMessage(ChatColor.YELLOW
                                + "已离开本层范围；15 秒内返回，否则试炼结束。可用 /mycli arena status 查看状态。");
                    }
                    plugin.getLogger().warning("Dungeon participant outside floor: floor=" + floor
                            + ", participants=" + participants);
                } else if (now - outsideSince >= OUTSIDE_GRACE_MS)
                    finish(false, "party_outside_floor", "队伍离开本层超过 15 秒；已赢得的奖励保存在个人箱子里。");
            } else finish(false, "party_defeated", "队伍全部倒下；已赢得的奖励保存在个人箱子里。");
            return;
        }
        outsideSince = 0;
        if (now - runStartedAt > RUN_TIMEOUT_MS || now - floorStartedAt > FLOOR_TIMEOUT_MS) {
            finish(false, "timeout", "试炼超时；已赢得的奖励保存在个人箱子里。"); return;
        }
        if (cleared) {
            if (floor < maxFloor() && now >= advanceAt) {
                List<Player> group = participants.stream().map(Bukkit::getPlayer)
                        .filter(p -> p != null && p.isOnline() && !p.isDead()
                                && inFloor(p.getLocation(), floor)).toList();
                if (enterFloor(floor + 1, group) == 0)
                    finish(false, "advance_failed", "自动下楼失败；已赢得的奖励保存在个人箱子里。");
            }
            return;
        }
        if (!spawned && now >= spawnAt) spawn();
        if (!spawned) return;
        updateBossBar();
        mobs.removeIf(id -> {
            Entity e = Bukkit.getEntity(id);
            if (!(e instanceof LivingEntity living) || living.isDead() || !e.isValid()) {
                lastMobPosition.remove(id);
                lastMobMovedAt.remove(id);
                lastMobAttackAt.remove(id);
                lastMobProjectileAt.remove(id);
                plugin.getLogger().info("Dungeon mob removed from count: floor=" + floor
                        + ", id=" + id + ", state=" + (e == null ? "missing" : e.isDead() ? "dead" : "invalid")
                        + ", lastDamage=" + lastMobDamage.getOrDefault(id, "none"));
                return true;
            }
            if (!inFloor(e.getLocation(), floor)) {
                Location before = e.getLocation();
                boolean rescued = e.teleport(center(floor));
                plugin.getLogger().warning("Dungeon mob outside floor: floor=" + floor + ", id=" + id
                        + ", type=" + e.getType() + ", at=" + LocationOutput.fields(before)
                        + ", rescued=" + rescued);
            }
            if (living instanceof Mob mob) {
                Player nearest = nearestParticipant(mob.getLocation());
                if (nearest != null && !validParticipantTarget(mob.getTarget())) mob.setTarget(nearest);
                recoverStuckMob(mob, nearest, now);
            }
            return false;
        });
        if (!mobs.isEmpty()) return;
        cleared = true;
        int credited = rewardFloor();
        announce(ChatColor.GREEN + "第 " + floor + "/" + maxFloor() + " 层已通关！奖励已放进个人箱子（" + credited + " 人）。");
        if (floor == maxFloor()) finish(true, "cleared", maxFloor() + " 层完成！打开奖励箱领取，再按红色木按钮回地面。");
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
        player.sendMessage(hasPersonalChestContents(id)
                ? ChatColor.GREEN + "[试炼指引] 个人箱里的物品和待入箱奖励不会因死亡清空。"
                : ChatColor.YELLOW + "[试炼指引] 当前个人箱没有物品或待入箱奖励；未通关的楼层不结算奖励。");
        player.sendMessage(ChatColor.AQUA + "[试炼指引] 去试炼场地面入口奖励箱 "
                + LocationOutput.fields(new Location(world(), -594, 91, -313)) + " 领取；"
                + "或输入 /mycli arena rewards 直接打开同一个个人箱。");
    }

    private boolean hasPendingRewards(UUID id) {
        for (Material material : REWARD_TYPES) if (pending(id, material) > 0) return true;
        return !bonusItems(id).isEmpty();
    }
    private boolean hasPersonalChestContents(UUID id) {
        if (hasPendingRewards(id)) return true;
        for (int slot = 0; slot < STASH_SIZE; slot++)
            if (plugin.getConfig().getItemStack(stashPath(id, slot)) != null) return true;
        return false;
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
        lastMobPosition.clear();
        lastMobMovedAt.clear();
        lastMobAttackAt.clear();
        lastMobProjectileAt.clear();
        Theme theme = THEMES.get(floor - 1);
        int[][] spots = floor == BOSS_FLOOR
                ? new int[][]{{0,10},{-9,-7},{9,-7},{-9,7},{9,7}}
                : floor == FINAL_FLOOR
                    ? new int[][]{{0,12},{-13,-11},{13,-11},{-13,11},{13,11},{0,-14}}
                : floor >= 8
                    ? new int[][]{{-12,-10},{12,-10},{-12,10},{12,10},{0,13},{0,-13},
                            {-14,0},{14,0},{-9,13},{9,13},{-9,-13},{9,-13}}
                    : new int[][]{{-6,-5},{6,-5},{-6,5},{6,5},{0,7},{0,-7},
                            {-8,0},{8,0},{-10,-8},{10,-8},{-10,8},{10,8}};
        for (int i = 0; i < theme.mobs().length; i++) {
            int[] spot = spots[i];
            Location at = center(floor).add(spot[0], 0, spot[1]);
            // Raised platforms are deliberate terrain; spawn atop their surface.
            while (at.getBlock().getType().isSolid() && at.getY() < Y[floor - 1] + 5)
                at.add(0, 1, 0);
            Entity e = world().spawnEntity(at, theme.mobs()[i]);
            e.addScoreboardTag(MOB_TAG);
            e.getPersistentDataContainer().set(mobKey, PersistentDataType.BYTE, (byte) 1);
            if (e instanceof MagmaCube cube) cube.setSize(1); // No untagged split children after a clear.
            if (e instanceof LivingEntity living) {
                living.setRemoveWhenFarAway(false);
                if (living instanceof Mob mob) {
                    mob.setAI(true);
                    Material weapon = switch (e.getType()) {
                        case SKELETON, STRAY -> Material.BOW;
                        case PILLAGER -> Material.CROSSBOW;
                        case VINDICATOR -> Material.IRON_AXE;
                        case ZOMBIE -> i % 2 == 0 ? Material.STONE_SWORD : Material.STONE_AXE;
                        case HUSK -> Material.IRON_SHOVEL;
                        case DROWNED -> Material.STONE_SWORD;
                        default -> Material.AIR;
                    };
                    if (mob.getEquipment() != null) {
                        mob.getEquipment().setItemInMainHand(weapon == Material.AIR ? null : new ItemStack(weapon));
                        mob.getEquipment().setItemInMainHandDropChance(0);
                    }
                    Player nearest = nearestParticipant(mob.getLocation());
                    if (nearest != null) mob.setTarget(nearest);
                    if (floor >= 11 && !(mob instanceof Ravager) && i < 2) {
                        double baseHealth = mob.getAttribute(Attribute.GENERIC_MAX_HEALTH) == null ? 20
                                : mob.getAttribute(Attribute.GENERIC_MAX_HEALTH).getBaseValue();
                        if (mob.getAttribute(Attribute.GENERIC_MAX_HEALTH) != null) {
                            mob.getAttribute(Attribute.GENERIC_MAX_HEALTH).setBaseValue(baseHealth + 12 + floor - 11);
                            mob.setHealth(baseHealth + 12 + floor - 11);
                        }
                        mob.setCustomName(ChatColor.GOLD + "精英 · " + mob.getType().name().toLowerCase(Locale.ROOT));
                        mob.setCustomNameVisible(true);
                    }
                }
            }
            if (e instanceof Ravager ravager) {
                bossId = ravager.getUniqueId();
                String bossName = floor == FINAL_FLOOR ? "星灯主宰" : "深渊守卫";
                ravager.setCustomName(ChatColor.DARK_PURPLE + bossName);
                ravager.setCustomNameVisible(true);
                if (ravager.getAttribute(Attribute.GENERIC_MAX_HEALTH) != null) {
                    double health = floor == FINAL_FLOOR ? 150 : 90;
                    ravager.getAttribute(Attribute.GENERIC_MAX_HEALTH).setBaseValue(health);
                    ravager.setHealth(health);
                }
                if (ravager.getAttribute(Attribute.GENERIC_ATTACK_DAMAGE) != null)
                    ravager.getAttribute(Attribute.GENERIC_ATTACK_DAMAGE).setBaseValue(floor == FINAL_FLOOR ? 7 : 5);
                bossBar = Bukkit.createBossBar(ChatColor.DARK_PURPLE + bossName,
                        BarColor.PURPLE, BarStyle.SOLID);
                for (UUID id : participants) {
                    Player player = Bukkit.getPlayer(id);
                    if (player != null && inFloor(player.getLocation(), floor)) bossBar.addPlayer(player);
                }
            }
            if (e instanceof Mob mob) applyDifficulty(mob);
            mobs.add(e.getUniqueId());
            lastMobPosition.put(e.getUniqueId(), e.getLocation().clone());
            lastMobMovedAt.put(e.getUniqueId(), System.currentTimeMillis());
            plugin.getLogger().info("Dungeon mob spawned: floor=" + floor + ", id=" + e.getUniqueId()
                    + ", type=" + e.getType() + ", at=" + LocationOutput.fields(e.getLocation()));
        }
        announce(ChatColor.RED + "第 " + floor + "/" + maxFloor() + " 层〔" + difficulty.label + "〕：" + theme.name()
                + "，" + theme.mobs().length + " 只怪物！");
    }

    private void applyDifficulty(Mob mob) {
        if (difficulty == Difficulty.NORMAL) return;
        if (mob.getAttribute(Attribute.GENERIC_MAX_HEALTH) != null) {
            double max = mob.getAttribute(Attribute.GENERIC_MAX_HEALTH).getBaseValue() * difficulty.health;
            mob.getAttribute(Attribute.GENERIC_MAX_HEALTH).setBaseValue(max);
            mob.setHealth(max);
        }
        if (mob.getAttribute(Attribute.GENERIC_MOVEMENT_SPEED) != null)
            mob.getAttribute(Attribute.GENERIC_MOVEMENT_SPEED).setBaseValue(
                    mob.getAttribute(Attribute.GENERIC_MOVEMENT_SPEED).getBaseValue() + difficulty.speed);
        if (mob.getAttribute(Attribute.GENERIC_ARMOR) != null)
            mob.getAttribute(Attribute.GENERIC_ARMOR).setBaseValue(
                    mob.getAttribute(Attribute.GENERIC_ARMOR).getBaseValue() + difficulty.armor);
    }

    private void recoverStuckMob(Mob mob, Player target, long now) {
        if (target == null) return;
        UUID id = mob.getUniqueId();
        Location current = mob.getLocation();
        Location prior = lastMobPosition.put(id, current.clone());
        if (prior == null || prior.getWorld() != current.getWorld() || prior.distanceSquared(current) > 0.25) {
            lastMobMovedAt.put(id, now);
            return;
        }
        if (current.distanceSquared(target.getLocation()) <= 36
                || now - lastMobAttackAt.getOrDefault(id, 0L) < 12_000
                || now - lastMobMovedAt.getOrDefault(id, now) < 12_000) return;
        // Line of sight and launched projectiles do not prove the mob can hit.
        // A witch may stand in view and lob potions that always land short.
        // Keep recent hits in place; rescue a stationary mob that has not hit.
        // Never teleport onto a player or into a hazard.
        int[][] offsets = {{5,0},{-5,0},{0,5},{0,-5},{4,4},{-4,4},{4,-4},{-4,-4}};
        for (int[] offset : offsets) {
            Location candidate = target.getLocation().getBlock().getLocation()
                    .add(offset[0] + 0.5, 0, offset[1] + 0.5);
            if (!inFloor(candidate, floor)) continue;
            Block feet = candidate.getBlock();
            Material below = feet.getRelative(0, -1, 0).getType();
            if (!below.isSolid() || below == Material.MAGMA_BLOCK
                    || feet.getType() == Material.LAVA || feet.getType() == Material.FIRE
                    || !feet.isPassable() || !feet.getRelative(0, 1, 0).isPassable()) continue;
            if (mob.teleport(candidate)) {
                mob.setTarget(target);
                lastMobPosition.put(id, candidate.clone());
                lastMobMovedAt.put(id, now);
                plugin.getLogger().warning("Dungeon stationary mob repositioned: floor=" + floor
                        + ", id=" + id + ", type=" + mob.getType()
                        + ", from=" + LocationOutput.fields(current)
                        + ", to=" + LocationOutput.fields(candidate));
            }
            return;
        }
        lastMobMovedAt.put(id, now);
    }

    private boolean validParticipantTarget(LivingEntity target) {
        return target instanceof Player player && participants.contains(player.getUniqueId())
                && player.isOnline() && !player.isDead() && inFloor(player.getLocation(), floor);
    }

    private Player nearestParticipant(Location at) {
        Player nearest = null;
        double distance = Double.MAX_VALUE;
        for (UUID id : participants) {
            Player player = Bukkit.getPlayer(id);
            if (!validParticipantTarget(player)) continue;
            double candidate = player.getLocation().distanceSquared(at);
            if (candidate < distance) { nearest = player; distance = candidate; }
        }
        return nearest;
    }

    private boolean trialMob(Entity entity) {
        return entity != null && entity.getScoreboardTags().contains(MOB_TAG)
                && entity.getPersistentDataContainer().has(mobKey, PersistentDataType.BYTE);
    }

    private Entity attacker(Entity damager) {
        if (damager instanceof Projectile projectile) {
            ProjectileSource source = projectile.getShooter();
            return source instanceof Entity entity ? entity : null;
        }
        return damager;
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onTrialTarget(EntityTargetLivingEntityEvent event) {
        if (trialMob(event.getEntity()) && event.getTarget() != null
                && !validParticipantTarget(event.getTarget())) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onTrialFriendlyDamage(EntityDamageByEntityEvent event) {
        if (trialMob(event.getEntity()) && trialMob(attacker(event.getDamager()))) {
            event.setCancelled(true);
            lastMobDamage.put(event.getEntity().getUniqueId(), "blocked_friendly_" + event.getCause());
        }
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onTrialOutgoingDamage(EntityDamageByEntityEvent event) {
        if (difficulty == Difficulty.NORMAL || !trialMob(attacker(event.getDamager()))
                || !validParticipantTarget(event.getEntity() instanceof LivingEntity living ? living : null)) return;
        event.setDamage(event.getDamage() * difficulty.damage);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onTrialPotion(PotionSplashEvent event) {
        if (!trialMob(attacker(event.getPotion()))) return;
        for (LivingEntity affected : event.getAffectedEntities())
            if (trialMob(affected)) event.setIntensity(affected, 0);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onTrialProjectileLaunch(ProjectileLaunchEvent event) {
        Entity source = attacker(event.getEntity());
        if (trialMob(source)) lastMobProjectileAt.put(source.getUniqueId(), System.currentTimeMillis());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onTrialDamageAudit(EntityDamageEvent event) {
        if (!trialMob(event.getEntity())) return;
        String source = event.getCause().name();
        if (event instanceof EntityDamageByEntityEvent attack) {
            Entity actor = attacker(attack.getDamager());
            source += actor == null ? ":unknown" : ":" + actor.getType().name();
        }
        lastMobDamage.put(event.getEntity().getUniqueId(), source);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onTrialAttackAudit(EntityDamageByEntityEvent event) {
        Entity source = attacker(event.getDamager());
        if (trialMob(source) && event.getEntity() instanceof Player player
                && validParticipantTarget(player))
            lastMobAttackAt.put(source.getUniqueId(), System.currentTimeMillis());
    }

    void audit(CommandSender sender) {
        sender.sendMessage("MC_DUNGEON_AUDIT floor=" + floor + " active=" + active + " spawned=" + spawned);
        int count = 0;
        for (UUID id : mobs) {
            Entity entity = Bukkit.getEntity(id);
            if (!(entity instanceof Mob mob) || !entity.isValid() || mob.isDead()) continue;
            ItemStack hand = mob.getEquipment() == null ? null : mob.getEquipment().getItemInMainHand();
            LivingEntity target = mob.getTarget();
            sender.sendMessage("MC_DUNGEON_MOB floor=" + floor + " id=" + id + " type=" + mob.getType()
                    + " " + LocationOutput.fields(mob.getLocation()) + " inFloor=" + inFloor(mob.getLocation(), floor)
                    + " hand=" + (hand == null ? Material.AIR : hand.getType()) + " ai=" + mob.hasAI()
                    + " target=" + (target == null ? "none" : target.getType() + ":" + target.getUniqueId())
                    + " health=" + String.format(Locale.ROOT, "%.2f", mob.getHealth())
                    + " lastDamage=" + lastMobDamage.getOrDefault(id, "none")
                    + " lastProjectileMs=" + ageMs(lastMobProjectileAt.get(id))
                    + " lastDirectHitMs=" + ageMs(lastMobAttackAt.get(id)));
            count++;
        }
        sender.sendMessage("MC_DUNGEON_AUDIT_END floor=" + floor + " count=" + count);
    }

    private String ageMs(Long timestamp) {
        return timestamp == null ? "never" : Long.toString(Math.max(0L, System.currentTimeMillis() - timestamp));
    }

    void pruneChestDuplicates(Player player, boolean apply, CommandSender sender) {
        economy.pruneChestDuplicates(player, apply, sender);
    }

    void pruneBagDuplicates(Player player, boolean apply, CommandSender sender) {
        economy.pruneBagDuplicates(player, apply, sender);
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

    private static boolean bossRelic(ItemStack item) {
        return item != null && item.hasItemMeta() && item.getItemMeta().hasDisplayName()
                && "深渊裁决".equals(ChatColor.stripColor(item.getItemMeta().getDisplayName()));
    }

    private boolean hasBossRelic(UUID id, Player player) {
        for (ItemStack item : bonusItems(id)) if (bossRelic(item)) return true;
        for (ItemStack item : player.getInventory().getContents()) if (bossRelic(item)) return true;
        for (int slot = 0; slot < STASH_SIZE; slot++)
            if (bossRelic(plugin.getConfig().getItemStack(stashPath(id, slot)))) return true;
        return false;
    }

    private void lootProgress(Player player) {
        UUID id = player.getUniqueId();
        int index = Math.max(0, plugin.getConfig().getInt(DIAMOND_SET_INDEX + id, 0));
        int clears = Math.max(0, plugin.getConfig().getInt(BOSS_CLEARS + id, 0));
        String[] pieces = {"头盔", "胸甲", "护腿", "靴子"};
        long gameDay = world().getFullTime() / 24000L;
        List<String> claimedFloors = new ArrayList<>();
        for (int n = 1; n <= maxFloor(); n++)
            if (plugin.getConfig().getLong(DAILY_CLAIMS + id + "." + n, Long.MIN_VALUE) == gameDay)
                claimedFloors.add(Integer.toString(n));
        player.sendMessage(ChatColor.GOLD + "前三层给材料、恢复品、酿药材料和弓；第四、五、八、九层保底集齐铁甲；第六、十层依次给星辉钻石甲。"
                + "下一件：" + pieces[index % 4] + "，第 " + (Math.min(2, index / 4) + 1) + " 阶。"
                + "已完成首领挑战 " + clears + " 次。奖励在个人箱；重复装备可在入口或七层回收。"
                + "本游戏日 " + gameDay + " 已领奖 " + claimedFloors.size() + " 层，每层每天最多一次。");
        player.sendMessage("MC_DUNGEON_SET schemaVersion=1 diamondIndex=" + index
                + " next=minecraft:" + new Material[]{Material.DIAMOND_HELMET, Material.DIAMOND_CHESTPLATE,
                    Material.DIAMOND_LEGGINGS, Material.DIAMOND_BOOTS}[index % 4].name().toLowerCase(Locale.ROOT)
                + " tier=" + (Math.min(2, index / 4) + 1) + " bossClears=" + clears
                + " pendingItems=" + queuedItems(id) + " gameDay=" + gameDay
                + " claimedFloors=" + String.join(",", claimedFloors) + " dailyLimitPerFloor=1");
    }

    private void layout(Player player) {
        boolean participant = active && participants.contains(player.getUniqueId());
        int room = participant ? floorAt(player.getLocation()) : 0;
        if (room == 0 || room != floor) {
            player.sendMessage("MC_DUNGEON_LAYOUT participant=false reason=not_in_active_room");
            return;
        }
        String hazard = switch (room) {
            case 12 -> "shallow_water";
            case 13 -> "contained_lava";
            case 14 -> "magma_and_pressure_lamps";
            default -> room >= 11 ? "cover_and_raised_platforms" : "none";
        };
        player.sendMessage("MC_DUNGEON_LAYOUT participant=true floor=" + room
                + " theme=" + THEMES.get(room - 1).name() + " dimension=minecraft:overworld"
                + " centerX=" + floorX(room) + " floorY=" + Y[room - 1] + " centerZ=" + floorZ(room)
                + " radius=" + radius(room) + " hazard=" + hazard
                + " centerLaneX=" + floorX(room) + " chestX=" + chestX(room)
                + " chestY=" + (Y[room - 1] + 1) + " chestZ=" + chestZ(room));
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
            long gameDay = world().getFullTime() / 24000L;
            String claimPath = DAILY_CLAIMS + id + "." + floor;
            if (plugin.getConfig().getLong(claimPath, Long.MIN_VALUE) == gameDay) {
                p.sendMessage(ChatColor.YELLOW + "第 " + floor + " 层今天已领奖；明天（游戏日 "
                        + (gameDay + 1) + "）可再次获得奖励。仍可继续挑战和使用商人。");
                p.sendMessage("MC_DUNGEON_LOOT floor=" + floor + " category=daily_limit gameDay="
                        + gameDay + " nextDay=" + (gameDay + 1) + " credited=false");
                continue;
            }
            boolean firstClear = !plugin.getConfig().contains(claimPath);
            Difficulty recommended = recommendedDifficulty(p);
            RewardScale scale = RewardScale.forRun(recommended, difficulty);
            if (scale.gap() > 0) p.sendMessage(ChatColor.YELLOW + "你的冒险者等级是"
                    + plugin.adventurerRankName(p) + "，推荐" + recommended.label + "试炼；本层"
                    + difficulty.label + "奖励按 " + scale.percent() + "% 结算。首次通关解锁与剧情奖励保留，"
                    + "重复装备仅在匹配难度中发放。");
            p.sendMessage("MC_DUNGEON_LOOT floor=" + floor + " category=level_scaling"
                    + " adventurerRank=" + plugin.adventurerRank(p)
                    + " recommendedDifficulty=" + recommended.id
                    + " runDifficulty=" + difficulty.id + " rewardPercent=" + scale.percent()
                    + " firstClear=" + firstClear + " repeatedGear=" + (scale.gap() == 0 || firstClear));
            for (Loot loot : THEMES.get(floor - 1).rewards()) {
                String path = rewardPath(id, loot.material());
                plugin.getConfig().set(path, plugin.getConfig().getInt(path, 0)
                        + scale.stack(loot.amount()));
            }
            if (scale.bonusRoll()) {
                DungeonLoot.Bonus bonus = DungeonLoot.roll(floor,
                        plugin.getConfig().getInt(RARE_MISSES + id, 0), difficulty.ordinal());
                List<ItemStack> queue = bonusItems(id);
                // The queue limit only converts ordinary supplies. Rare and guaranteed gear
                // must not disappear merely because a player has not emptied a full chest.
                if (queue.size() < MAX_BONUS_QUEUE || bonus.rare()) {
                    queue.add(bonus.item());
                    plugin.getConfig().set(BONUS_ITEMS + id, queue);
                    plugin.getConfig().set(RARE_MISSES + id,
                            bonus.rare() ? 0 : plugin.getConfig().getInt(RARE_MISSES + id, 0) + 1);
                    p.sendMessage((bonus.rare() ? ChatColor.LIGHT_PURPLE : ChatColor.AQUA)
                            + "本层额外战利品：" + bonus.label() + "，已存入个人箱子。");
                    p.sendMessage("MC_DUNGEON_LOOT floor=" + floor + " category="
                            + (bonus.rare() ? "rare" : "extra") + " item=minecraft:"
                            + bonus.item().getType().name().toLowerCase(Locale.ROOT));
                } else {
                    String path = rewardPath(id, Material.EMERALD);
                    plugin.getConfig().set(path, plugin.getConfig().getInt(path, 0) + 1);
                    p.sendMessage(ChatColor.YELLOW + "个人宝箱普通奖励队列已满，本层普通额外战利品折成绿宝石 ×1 保存。"
                            + "稀有与保底装备仍会留在待领取队列；请及时清理个人箱。");
                    p.sendMessage("MC_DUNGEON_LOOT floor=" + floor
                            + " category=converted item=minecraft:emerald");
                }
            } else {
                p.sendMessage("MC_DUNGEON_LOOT floor=" + floor
                        + " category=bonus_skipped reason=below_recommended_difficulty");
            }
            List<DungeonLoot.Bonus> supplies = scale.gap() == 0 || firstClear
                    ? DungeonLoot.supplies(floor) : List.of();
            if (!supplies.isEmpty()) {
                List<ItemStack> guaranteed = bonusItems(id);
                for (DungeonLoot.Bonus supply : supplies) {
                    ItemStack item = supply.item().clone();
                    item.setAmount(scale.stack(item.getAmount()));
                    guaranteed.add(item);
                    p.sendMessage(ChatColor.GREEN + "本层补给：" + supply.label()
                            + (item.getAmount() == supply.item().getAmount() ? "" : "（按等级调整为 ×" + item.getAmount() + "）")
                            + "，已存入个人箱子。");
                    p.sendMessage("MC_DUNGEON_LOOT floor=" + floor + " category=supply item=minecraft:"
                            + item.getType().name().toLowerCase(Locale.ROOT)
                            + " count=" + item.getAmount());
                }
                plugin.getConfig().set(BONUS_ITEMS + id, guaranteed);
            }
            int setIndex = Math.max(0, plugin.getConfig().getInt(DIAMOND_SET_INDEX + id, 0));
            DungeonLoot.Bonus milestone = scale.gap() == 0 || firstClear
                    ? DungeonLoot.milestone(floor, setIndex) : null;
            if (milestone != null) {
                List<ItemStack> guaranteed = bonusItems(id);
                guaranteed.add(milestone.item());
                plugin.getConfig().set(BONUS_ITEMS + id, guaranteed);
                if (floor == 6 || floor == BOSS_FLOOR)
                    plugin.getConfig().set(DIAMOND_SET_INDEX + id, setIndex + 1);
                p.sendMessage((milestone.rare() ? ChatColor.LIGHT_PURPLE : ChatColor.GREEN)
                        + "本层保底装备：" + milestone.label() + "，已存入个人箱子。"
                        + (floor == 6 || floor == BOSS_FLOOR ? " /mycli arena loot 可查套装进度。" : ""));
                p.sendMessage("MC_DUNGEON_LOOT floor=" + floor + " category=milestone item=minecraft:"
                        + milestone.item().getType().name().toLowerCase(Locale.ROOT)
                        + " diamondIndex=" + (floor == 6 || floor == BOSS_FLOOR ? setIndex : -1));
            }
            if (floor == 3) plugin.teachArenaSkills(p);
            if (floor == BASE_FLOORS && expanded) {
                p.getPersistentDataContainer().set(checkpointKey, PersistentDataType.BYTE, (byte) 1);
                p.saveData();
                p.sendMessage(ChatColor.GOLD + "已解锁第七层灯火驿站直达；今后可在罗盘或 /mycli arena rest 进入。");
            }
            if (floor == BOSS_FLOOR && (scale.gap() == 0 || firstClear)) {
                int clears = plugin.getConfig().getInt(BOSS_CLEARS + id, -1);
                if (clears < 0) clears = hasBossRelic(id, p) ? 1 : 0;
                DungeonLoot.Bonus cache = DungeonLoot.bossCache(clears);
                List<ItemStack> relics = bonusItems(id);
                relics.add(0, cache.item());
                plugin.getConfig().set(BONUS_ITEMS + id, relics);
                plugin.getConfig().set(BOSS_CLEARS + id, clears + 1);
                p.sendMessage(ChatColor.LIGHT_PURPLE + "首领宝藏：" + cache.label() + "，已存入个人箱子。");
                p.sendMessage("MC_DUNGEON_LOOT floor=10 category=boss item=minecraft:"
                        + cache.item().getType().name().toLowerCase(Locale.ROOT) + " clear=" + (clears + 1));
            }
            if (floor == FINAL_FLOOR && (scale.gap() == 0 || firstClear)) {
                int clears = plugin.getConfig().getInt(FINAL_CLEARS + id, 0);
                DungeonLoot.Bonus cache = DungeonLoot.finalCache(clears);
                List<ItemStack> relics = bonusItems(id);
                relics.add(0, cache.item());
                plugin.getConfig().set(BONUS_ITEMS + id, relics);
                plugin.getConfig().set(FINAL_CLEARS + id, clears + 1);
                p.sendMessage(ChatColor.LIGHT_PURPLE + "星灯首领宝藏：" + cache.label() + "，已存入个人箱子。");
                p.sendMessage("MC_DUNGEON_LOOT floor=15 category=final_boss item=minecraft:"
                        + cache.item().getType().name().toLowerCase(Locale.ROOT) + " clear=" + (clears + 1));
            }
            if (difficulty.walletBonus > 0) {
                int bonusBalance = difficulty.walletBonus * (floor >= 11 ? 2 : 1);
                int creditedBalance = economy.creditDifficulty(id, scale.wallet(bonusBalance));
                p.sendMessage(ChatColor.GREEN + difficulty.label + "难度奖励：绿宝石余额 +" + creditedBalance
                        + "；可在入口商人购买补给，不占背包。");
                p.sendMessage("MC_DUNGEON_LOOT floor=" + floor + " category=difficulty_wallet difficulty="
                        + difficulty.id + " amount=" + creditedBalance);
            }
            plugin.getConfig().set(claimPath, gameDay);
            plugin.guildFloorCleared(p, floor, partySize);
            plugin.saveConfig();
            p.sendTitle(ChatColor.GOLD + "第 " + floor + " 层过关", ChatColor.YELLOW + "奖励已存入个人箱子", 5, 55, 10);
            p.sendMessage(ChatColor.GOLD + "奖励在本层宝箱或地面大厅的个人箱里；像普通箱子一样取放。");
            credited++;
        }
        plugin.saveConfig();
        plugin.getLogger().info("Dungeon floor reward: floor=" + floor + ", difficulty=" + difficulty.id
                + ", credited=" + credited);
        return credited;
    }

    private void finish(boolean won, String reason, String message) {
        if (!active) return;
        plugin.getLogger().info("Dungeon finished: won=" + won + ", floor=" + floor
                + ", reason=" + reason + ", remaining=" + mobs.size() + ", message=" + message);
        plugin.getConfig().set("dungeon-last-outcome", won ? "won" : "failed");
        plugin.getConfig().set("dungeon-last-finish-floor", floor);
        plugin.getConfig().set("dungeon-last-finish-reason", reason);
        plugin.getConfig().set("dungeon-last-participants", participants.stream().map(UUID::toString).toList());
        // Termination must reach participants who are outside the narrow floor volume.
        for (UUID id : participants) {
            Player player = Bukkit.getPlayer(id);
            if (player != null && player.isOnline()) player.sendMessage((won ? ChatColor.GREEN : ChatColor.YELLOW) + message);
        }
        cleanupMobs();
        active = false;
        advanceAt = 0;
        pausedAt = 0;
        outsideSince = 0;
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
    boolean queuePurchased(UUID id, ItemStack item) {
        List<ItemStack> queue = bonusItems(id);
        if (queue.size() >= MAX_BONUS_QUEUE) return false;
        queue.add(item.clone());
        plugin.getConfig().set(BONUS_ITEMS + id, queue);
        return true;
    }
    int queuedItems(UUID id) { return bonusItems(id).size(); }
    private void rewardCommand(Player player, String[] args) {
        if (args.length == 2) { openStash(player); return; }
        if (args[2].equalsIgnoreCase("list") && args.length == 3) {
            UUID id = player.getUniqueId();
            int entries = 0;
            for (int slot = 0; slot < REWARD_TYPES.length; slot++) {
                int count = pending(id, REWARD_TYPES[slot]);
                if (count <= 0) continue;
                player.sendMessage("MC_REWARD slot=" + slot + itemFields(new ItemStack(REWARD_TYPES[slot], count)));
                entries++;
            }
            List<ItemStack> bonus = bonusItems(id);
            for (int index = 0; index < Math.min(9, bonus.size()); index++) {
                ItemStack item = bonus.get(index);
                player.sendMessage("MC_REWARD slot=" + (index + 9) + itemFields(item));
                entries++;
            }
            player.sendMessage("MC_REWARD_SUMMARY visible=" + entries + " queuedBonus=" + bonus.size());
            player.sendMessage("这些是箱满后尚未装入的奖励；清出箱格并重新开箱，或用 /mycli arena rewards take <槽位|all>。");
            return;
        }
        if (args[2].equalsIgnoreCase("take") && args.length == 4) {
            UUID id = player.getUniqueId();
            if (args[3].equalsIgnoreCase("all")) {
                for (Material material : REWARD_TYPES) {
                    for (int stack = 0; stack < 128 && pending(id, material) > 0; stack++)
                        if (!claimStandard(player, id, material)) break;
                }
                for (int index = 0; index < MAX_BONUS_QUEUE && !bonusItems(id).isEmpty(); index++)
                    if (!claimBonus(player, id, 0)) break;
                return;
            }
            try {
                int slot = Integer.parseInt(args[3]);
                if (slot >= 0 && slot < REWARD_TYPES.length) claimStandard(player, id, REWARD_TYPES[slot]);
                else if (slot >= 9 && slot < 18) claimBonus(player, id, slot - 9);
                else player.sendMessage("奖励槽位为 0–7 或 9–17；先用 /mycli arena rewards list 查看。");
            } catch (NumberFormatException invalid) {
                player.sendMessage("用法：/mycli arena rewards take <槽位|all>");
            }
            return;
        }
        player.sendMessage("用法：/mycli arena rewards [list|take <槽位|all>]；/mycli arena stash 管理私人储物。");
    }
    private String stashPath(UUID id, int slot) { return STASH + id + "." + slot; }
    private String itemFields(ItemStack item) {
        String name = item.hasItemMeta() && item.getItemMeta().hasDisplayName()
                ? ChatColor.stripColor(item.getItemMeta().getDisplayName()).replace(' ', '_') : "-";
        String enchants = String.join(",", item.getEnchantments().entrySet().stream()
                .map(entry -> entry.getKey().getKey().getKey() + ":" + entry.getValue()).sorted().toList());
        return " id=minecraft:" + item.getType().name().toLowerCase(Locale.ROOT)
                + " count=" + item.getAmount() + " name=" + name
                + " enchants=" + (enchants.isEmpty() ? "-" : enchants);
    }
    Inventory liveStash(UUID id) {
        for (Map.Entry<Inventory, UUID> entry : stashMenus.entrySet())
            if (entry.getValue().equals(id)) return entry.getKey();
        Inventory inv = Bukkit.createInventory(null, STASH_SIZE, ChatColor.GOLD + "个人试炼箱");
        for (int slot = 0; slot < inv.getSize(); slot++) {
            ItemStack saved = plugin.getConfig().getItemStack(stashPath(id, slot));
            if (saved != null) inv.setItem(slot, saved.clone());
        }
        return inv;
    }
    void saveStash(Inventory inv, UUID id) {
        for (int slot = 0; slot < inv.getSize(); slot++) {
            ItemStack item = inv.getItem(slot);
            plugin.getConfig().set(stashPath(id, slot), item == null || item.getType().isAir() ? null : item.clone());
        }
        plugin.saveConfig();
    }
    /** Make one inventory slot available without discarding a player's belongings. */
    boolean storeItemForBackpackRecovery(Player player) {
        Inventory stash = liveStash(player.getUniqueId());
        int free = stash.firstEmpty();
        if (free < 0) return false;
        int chosen = -1;
        for (int slot = 0; slot < 36; slot++) {
            ItemStack item = player.getInventory().getItem(slot);
            if (item != null && item.getType() == Material.ROTTEN_FLESH) { chosen = slot; break; }
        }
        if (chosen < 0) {
            for (int slot = 35; slot >= 0; slot--) {
                ItemStack item = player.getInventory().getItem(slot);
                if (item != null && !item.getType().isAir() && !BackpackShortcutMigration.isShortcut(item)) {
                    chosen = slot; break;
                }
            }
        }
        if (chosen < 0) return false;
        ItemStack item = player.getInventory().getItem(chosen);
        stash.setItem(free, item.clone());
        saveStash(stash, player.getUniqueId());
        player.getInventory().setItem(chosen, null);
        player.sendMessage(ChatColor.YELLOW + "随身物品栏已满；一组 " + item.getType().name().toLowerCase(Locale.ROOT)
                + " 已安全转存到个人试炼箱，以补回大背包快捷物品。");
        return true;
    }
    /** Move ledger rewards into the real chest before opening it. Keep overflow in the ledger. */
    private void materializeRewards(Inventory inv, UUID id) {
        boolean moved = false;
        List<ItemStack> bonus = bonusItems(id);
        if (!bonus.isEmpty()) {
            List<ItemStack> overflow = new ArrayList<>();
            for (ItemStack saved : bonus) {
                ItemStack item = saved.clone();
                int amount = item.getAmount();
                int remaining = inv.addItem(item).values().stream().mapToInt(ItemStack::getAmount).sum();
                if (remaining < amount) moved = true;
                if (remaining > 0) {
                    ItemStack leftover = saved.clone();
                    leftover.setAmount(remaining);
                    overflow.add(leftover);
                }
            }
            if (moved) plugin.getConfig().set(BONUS_ITEMS + id, overflow);
        }
        for (Material material : REWARD_TYPES) {
            int remaining = pending(id, material);
            while (remaining > 0) {
                int amount = Math.min(remaining, material.getMaxStackSize());
                int leftover = inv.addItem(new ItemStack(material, amount)).values().stream()
                        .mapToInt(ItemStack::getAmount).sum();
                int added = amount - leftover;
                if (added == 0) break;
                remaining -= added;
                moved = true;
                if (leftover > 0) break;
            }
            if (remaining != pending(id, material)) plugin.getConfig().set(rewardPath(id, material), remaining);
        }
        if (moved) saveStash(inv, id);
    }
    void openStash(Player player) {
        UUID id = player.getUniqueId();
        Inventory inv = liveStash(id);
        materializeRewards(inv, id);
        if (player.getOpenInventory().getTopInventory() == inv && stashMenus.containsKey(inv)) return;
        stashMenus.put(inv, id);
        player.openInventory(inv);
        if (hasPendingRewards(id)) player.sendMessage(ChatColor.YELLOW
                + "个人箱已满，部分奖励仍待入箱；腾出格子后重新打开即可。");
    }
    private void stashCommand(Player player, String[] args) {
        if (args.length == 2) { openStash(player); return; }
        UUID id = player.getUniqueId();
        Inventory inv = liveStash(id);
        String action = args[2].toLowerCase(Locale.ROOT);
        if (action.equals("inventory") && args.length == 3) {
            for (int slot = 0; slot < 36; slot++) {
                ItemStack item = player.getInventory().getItem(slot);
                if (item != null && !item.getType().isAir())
                    player.sendMessage("MC_INVENTORY slot=" + slot + itemFields(item));
            }
            player.sendMessage("MC_INVENTORY_SUMMARY slots=0-35");
            return;
        }
        if (action.equals("list") && args.length == 3) {
            int entries = 0;
            for (int slot = 0; slot < inv.getSize(); slot++) {
                ItemStack item = inv.getItem(slot);
                if (item == null || item.getType().isAir()) continue;
                player.sendMessage("MC_STASH slot=" + (slot + 1) + itemFields(item));
                entries++;
            }
            player.sendMessage("MC_STASH_SUMMARY occupied=" + entries + "/" + STASH_SIZE);
            return;
        }
        if (action.equals("putslot") && args.length == 5) {
            int slot, wanted;
            try { slot = Integer.parseInt(args[3]); }
            catch (NumberFormatException invalid) { slot = -1; }
            wanted = positiveCount(args[4]);
            if (slot < 0 || slot >= 36 || wanted < 1) {
                player.sendMessage("用法：/mycli arena stash putslot <背包槽位 0–35> <1–64>"); return;
            }
            ItemStack source = player.getInventory().getItem(slot);
            if (source == null || source.getType().isAir()) {
                player.sendMessage("MC_STASH_PUT slot=" + slot + " moved=0 reason=empty"); return;
            }
            Material material = source.getType();
            ItemStack part = source.clone();
            part.setAmount(Math.min(source.getAmount(), wanted));
            int attempted = part.getAmount();
            int left = inv.addItem(part).values().stream().mapToInt(ItemStack::getAmount).sum();
            int moved = attempted - left;
            if (moved > 0) {
                source.setAmount(source.getAmount() - moved);
                player.getInventory().setItem(slot, source.getAmount() > 0 ? source : null);
                saveStash(inv, id);
                player.saveData();
            }
            player.sendMessage("MC_STASH_PUT slot=" + slot + " id=minecraft:"
                    + material.name().toLowerCase(Locale.ROOT) + " moved=" + moved);
            return;
        }
        if (action.equals("put") && args.length == 5) {
            Material material = Material.matchMaterial(args[3]);
            int wanted = positiveCount(args[4]);
            if (material == null || !material.isItem() || wanted < 1) {
                player.sendMessage("用法：/mycli arena stash put <英文物品ID> <1–64>"); return;
            }
            int moved = 0;
            for (int slot = 0; slot < 36 && moved < wanted; slot++) {
                ItemStack source = player.getInventory().getItem(slot);
                if (source == null || source.getType() != material) continue;
                ItemStack part = source.clone();
                part.setAmount(Math.min(source.getAmount(), wanted - moved));
                int attempted = part.getAmount();
                int left = inv.addItem(part).values().stream().mapToInt(ItemStack::getAmount).sum();
                int deposited = attempted - left;
                if (deposited <= 0) break;
                source.setAmount(source.getAmount() - deposited);
                player.getInventory().setItem(slot, source.getAmount() > 0 ? source : null);
                moved += deposited;
            }
            if (moved > 0) { saveStash(inv, id); player.saveData(); }
            player.sendMessage("MC_STASH_PUT id=minecraft:" + material.name().toLowerCase(Locale.ROOT)
                    + " moved=" + moved + " requested=" + wanted);
            return;
        }
        if (action.equals("take") && (args.length == 4 || args.length == 5)) {
            int slot, wanted;
            try { slot = Integer.parseInt(args[3]) - 1; }
            catch (NumberFormatException invalid) { slot = -1; }
            wanted = args.length == 5 ? positiveCount(args[4]) : 64;
            if (slot < 0 || slot >= STASH_SIZE || wanted < 1) {
                player.sendMessage("用法：/mycli arena stash take <1–54 槽位> [1–64 数量]"); return;
            }
            ItemStack source = inv.getItem(slot);
            if (source == null || source.getType().isAir()) {
                player.sendMessage("MC_STASH_TAKE slot=" + (slot + 1) + " moved=0 reason=empty"); return;
            }
            ItemStack part = source.clone();
            part.setAmount(Math.min(wanted, source.getAmount()));
            int attempted = part.getAmount();
            int left = player.getInventory().addItem(part).values().stream().mapToInt(ItemStack::getAmount).sum();
            int moved = attempted - left;
            if (moved > 0) {
                source.setAmount(source.getAmount() - moved);
                inv.setItem(slot, source.getAmount() > 0 ? source : null);
                saveStash(inv, id);
                player.saveData();
                plugin.guildRewardClaimed(player);
            }
            player.sendMessage("MC_STASH_TAKE slot=" + (slot + 1) + " id=minecraft:"
                    + part.getType().name().toLowerCase(Locale.ROOT) + " moved=" + moved);
            return;
        }
        player.sendMessage("用法：/mycli arena stash [inventory|list|put <物品ID> <数量>|putslot <背包槽位> <数量>|take <箱槽位> [数量]]");
    }
    private int positiveCount(String raw) {
        try { int count = Integer.parseInt(raw); return count >= 1 && count <= 64 ? count : -1; }
        catch (NumberFormatException invalid) { return -1; }
    }
    private boolean claimStandard(Player p, UUID owner, Material material) {
        int count = Math.min(64, pending(owner, material));
        if (count <= 0) return false;
        Map<Integer, ItemStack> leftover = p.getInventory().addItem(new ItemStack(material, count));
        int unclaimed = leftover.values().stream().mapToInt(ItemStack::getAmount).sum();
        int delivered = count - unclaimed;
        if (delivered <= 0) { p.sendMessage(ChatColor.YELLOW + "背包已满，奖励仍在箱子里。"); return false; }
        String path = rewardPath(owner, material);
        plugin.getConfig().set(path, pending(owner, material) - delivered);
        plugin.saveConfig();
        p.saveData();
        plugin.guildRewardClaimed(p);
        p.sendMessage(ChatColor.GREEN + "从奖励箱领取了 " + delivered + " × " + rewardName(material) + "。"
                + (unclaimed > 0 ? "剩余物品仍在箱中。" : ""));
        plugin.getLogger().info("Dungeon reward claimed: player=" + owner + ", item=" + material + ", count=" + delivered);
        return true;
    }

    private boolean claimBonus(Player player, UUID owner, int index) {
        List<ItemStack> queue = bonusItems(owner);
        if (index >= queue.size()) return false;
        ItemStack item = queue.get(index).clone();
        Map<Integer, ItemStack> leftover = player.getInventory().addItem(item.clone());
        int remaining = leftover.values().stream().mapToInt(ItemStack::getAmount).sum();
        int delivered = item.getAmount() - remaining;
        if (delivered <= 0) {
            player.sendMessage(ChatColor.YELLOW + "背包已满，随机战利品仍在箱子里。"); return false;
        }
        if (remaining == 0) queue.remove(index);
        else {
            item.setAmount(remaining);
            queue.set(index, item);
        }
        plugin.getConfig().set(BONUS_ITEMS + owner, queue);
        plugin.saveConfig();
        player.saveData();
        plugin.guildRewardClaimed(player);
        player.sendMessage(ChatColor.GREEN + "从个人箱子领取了随机战利品 " + delivered + " 件。");
        plugin.getLogger().info("Dungeon bonus claimed: player=" + owner + ", item="
                + item.getType() + ", count=" + delivered);
        return true;
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
    private int itemCount(Inventory inv) {
        int count = 0;
        for (ItemStack item : inv.getContents())
            if (item != null && !item.getType().isAir()) count += item.getAmount();
        return count;
    }
    @EventHandler(priority = EventPriority.MONITOR) public void onStashClick(InventoryClickEvent event) {
        Inventory inv = event.getView().getTopInventory();
        UUID owner = stashMenus.get(inv);
        if (owner == null) return;
        if (!event.getWhoClicked().getUniqueId().equals(owner)) { event.setCancelled(true); return; }
        int before = itemCount(inv);
        boolean fromChest = event.getRawSlot() >= 0 && event.getRawSlot() < inv.getSize();
        if (!event.isCancelled()) Bukkit.getScheduler().runTask(plugin, () -> {
            if (stashMenus.containsKey(inv)) saveStash(inv, owner);
            if (fromChest && itemCount(inv) < before && event.getWhoClicked() instanceof Player player)
                plugin.guildRewardClaimed(player);
        });
    }
    @EventHandler(priority = EventPriority.MONITOR) public void onStashDrag(InventoryDragEvent event) {
        Inventory inv = event.getView().getTopInventory();
        UUID owner = stashMenus.get(inv);
        if (owner != null && !event.isCancelled()) Bukkit.getScheduler().runTask(plugin, () -> {
            if (stashMenus.containsKey(inv)) saveStash(inv, owner);
        });
    }
    @EventHandler public void onRewardClose(InventoryCloseEvent event) {
        UUID owner = stashMenus.remove(event.getInventory());
        if (owner != null) saveStash(event.getInventory(), owner);
    }

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
        lastMobDamage.clear();
        lastMobPosition.clear();
        lastMobMovedAt.clear();
        lastMobAttackAt.clear();
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
                || !event.getEntity().getPersistentDataContainer().has(mobKey, PersistentDataType.BYTE)) return;
        plugin.getLogger().info("Dungeon mob died: floor=" + floor + ", id=" + event.getEntity().getUniqueId()
                + ", type=" + event.getEntity().getType() + ", at=" + LocationOutput.fields(event.getEntity().getLocation())
                + ", lastDamage=" + lastMobDamage.getOrDefault(event.getEntity().getUniqueId(), "none"));
        if (floorAt(event.getEntity().getLocation()) != floor) return;
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
        ensureMerchants();
        updateFloorGuides();
        sender.sendMessage("深层四层已建成：第七层驿站、第八九层大房间和第十层首领殿。");
        plugin.getLogger().info("Deep dungeon wing built at " + WING_X + "," + WING_Z + ", y=-40..3");
    }

    void surveyChallenge(CommandSender sender) { surveyChallengeSite(sender, CHALLENGE_X, WING_Z); }

    void scanChallengeCandidate(CommandSender sender, int x, int z) {
        if (Math.abs(x - WING_X) < 65 || Math.abs(x - X) < 65) {
            sender.sendMessage("候选侧翼距现有试炼建筑太近。"); return;
        }
        surveyChallengeSite(sender, x, z);
    }

    private boolean surveyChallengeSite(CommandSender sender, int centerX, int centerZ) {
        if (!built || !expanded || !plugin.getConfig().getBoolean("dungeon-expanded", false)) {
            sender.sendMessage("十层试炼尚未建成，不能施工新侧翼。"); return false;
        }
        if (challengeBuilt || plugin.getConfig().getBoolean("dungeon-challenge-built", false)) {
            sender.sendMessage("挑战侧翼已经建成，拒绝重复覆盖。"); return false;
        }
        if (active || plugin.getConfig().isConfigurationSection(RUN_STATE)) {
            sender.sendMessage("有试炼或重连检查点，不能施工。"); return false;
        }
        if (plugin.getConfig().getBoolean("dungeon-challenge-building", false)) {
            sender.sendMessage("施工中断标记仍在；先检查并恢复施工前快照。"); return false;
        }
        World w = world();
        if (w == null || Y[10] < w.getMinHeight() + 4 || Y[14] + 7 >= w.getMaxHeight()) {
            sender.sendMessage("主世界未加载或高度不足。"); return false;
        }
        for (Player player : Bukkit.getOnlinePlayers()) {
            if (player.getGameMode() == GameMode.SPECTATOR || !sameWorld(player.getLocation())) continue;
            Location at = player.getLocation();
            if (Math.abs(at.getBlockX() - centerX) <= 25
                    && Math.abs(at.getBlockZ() - centerZ) <= 25
                    && at.getY() >= Y[10] && at.getY() <= Y[14] + 7) {
                sender.sendMessage("施工区域里有玩家：" + player.getName()); return false;
            }
        }
        for (int number = OLD_MAX_FLOOR + 1; number <= FINAL_FLOOR; number++) {
            int r = radius(number), y = Y[number - 1];
            for (int dx = -r; dx <= r; dx++) for (int dz = -r; dz <= r; dz++)
                for (int dy = 0; dy <= 7; dy++) {
                    Block block = w.getBlockAt(centerX + dx, y + dy, centerZ + dz);
                    if (block.getState() instanceof TileState || suspicious(block.getType())) {
                        sender.sendMessage("挑战侧翼发现容器或结构，拒绝施工：" + block.getLocation()
                                + " " + block.getType()); return false;
                    }
                }
        }
        sender.sendMessage("挑战侧翼勘察通过：第 11–15 层，中心 X=" + centerX
                + " Z=" + centerZ + "，Y=-40..15，无容器/人工结构/在场玩家。");
        return true;
    }

    void buildChallenge(CommandSender sender) {
        if (!surveyChallengeSite(sender, CHALLENGE_X, WING_Z)) return;
        plugin.getConfig().set("dungeon-challenge-building", true);
        plugin.saveConfig();
        for (int number = OLD_MAX_FLOOR + 1; number <= FINAL_FLOOR; number++) buildFloor(world(), number);
        challengeBuilt = true;
        plugin.getConfig().set("dungeon-challenge-built", true);
        plugin.getConfig().set("dungeon-challenge-building", false);
        plugin.saveConfig();
        ensureMerchants();
        updateFloorGuides();
        sender.sendMessage("第 11–15 层已建成；第 10 层现为中途首领，第 15 层为终点。");
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

    private void ensureMerchants() {
        for (byte kind = 1; kind <= 4; kind++) ensureMerchant(kind);
    }

    private Villager ensureMerchant(byte kind) {
        if (!expanded || world() == null) return null;
        Location at = switch (kind) {
            case 1 -> new Location(world(), WING_X + 7.5, Y[REST_FLOOR - 1] + 1, WING_Z - 4.5);
            case 2 -> new Location(world(), WING_X + 10.5, Y[REST_FLOOR - 1] + 1, WING_Z - 4.5);
            case 3 -> new Location(world(), X + 2.5, LOBBY_Y + 1, Z - 5.5);
            default -> new Location(world(), X + 5.5, LOBBY_Y + 1, Z - 5.5);
        };
        Villager merchant = null;
        for (Entity entity : world().getNearbyEntities(at, 1.5, 2, 1.5)) {
            if (!(entity instanceof Villager villager)
                    || !Byte.valueOf(kind).equals(villager.getPersistentDataContainer()
                            .get(merchantKey, PersistentDataType.BYTE))) continue;
            if (merchant == null) merchant = villager;
            else villager.remove();
        }
        if (merchant == null) {
            merchant = world().spawn(at, Villager.class);
            merchant.getPersistentDataContainer().set(merchantKey, PersistentDataType.BYTE, kind);
        }
        merchant.setProfession(kind % 2 == 0 ? Villager.Profession.ARMORER : Villager.Profession.WEAPONSMITH);
        merchant.setVillagerLevel(5);
        merchant.setCustomName(ChatColor.GOLD + (kind >= 3 ? "入口" : "驿站")
                + (kind % 2 == 0 ? "装备回收商" : "武备补给商"));
        merchant.setCustomNameVisible(true);
        merchant.setAI(false);
        merchant.setInvulnerable(true);
        merchant.setRemoveWhenFarAway(false);
        merchant.setRecipes(merchantRecipes());
        return merchant;
    }

    private boolean nearMerchant(Player player) {
        return expanded && (inLobby(player.getLocation())
                || active && floor == REST_FLOOR && participants.contains(player.getUniqueId())
                    && inFloor(player.getLocation(), REST_FLOOR));
    }

    private void openShop(Player player) {
        if (!nearMerchant(player)) {
            player.sendMessage(ChatColor.YELLOW + "前往试炼场入口或第七层驿站与商人交易。"); return;
        }
        economy.openShopMenu(player);
    }

    void openLegacyMerchant(Player player) {
        if (!nearMerchant(player)) {
            player.sendMessage(ChatColor.YELLOW + "前往试炼场入口或第七层驿站与商人交易。"); return;
        }
        Villager merchant = ensureMerchant((byte) (inLobby(player.getLocation()) ? 3 : 1));
        if (merchant == null) player.sendMessage(ChatColor.RED + "驿站商人暂时不在，请联系服主。");
        else player.openMerchant(merchant, true);
    }

    @EventHandler public void onRestMerchant(PlayerInteractEntityEvent event) {
        if (event.getHand() != EquipmentSlot.HAND || !expanded) return;
        Byte kind = event.getRightClicked().getPersistentDataContainer().get(merchantKey, PersistentDataType.BYTE);
        if (kind == null || kind < 1 || kind > 4) return;
        event.setCancelled(true);
        if (!nearMerchant(event.getPlayer())) {
            event.getPlayer().sendMessage(ChatColor.YELLOW + "需要在入口或驿站使用商人。"); return;
        }
        if (kind % 2 == 0) economy.openRecycleMenu(event.getPlayer());
        else economy.openShopMenu(event.getPlayer());
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
        if (number > OLD_MAX_FLOOR) buildChallengeTerrain(w, number);
    }

    private void buildChallengeTerrain(World w, int number) {
        int fx = floorX(number), fz = floorZ(number), y = Y[number - 1];
        Material cover = THEMES.get(number - 1).pillar();
        // Low, spaced cover remains walkable for Mineflayer; central lane stays clear.
        for (int dx : new int[]{-9, 9}) for (int dz : new int[]{-7, 7}) {
            for (int x = dx - 1; x <= dx + 1; x++)
                w.getBlockAt(fx + x, y + 1, fz + dz).setType(cover, false);
        }
        for (int dx : new int[]{-6, 6}) for (int dz : new int[]{-12, 12}) {
            for (int x = dx - 2; x <= dx + 2; x++) for (int z = dz - 2; z <= dz + 2; z++)
                w.getBlockAt(fx + x, y + 1, fz + z).setType(THEMES.get(number - 1).floor(), false);
            for (int z = dz - 2; z <= dz + 2; z++)
                w.getBlockAt(fx + dx, y + 2, fz + z).setType(THEMES.get(number - 1).floor(), false);
        }
        if (number == 12) {
            // Shallow flooded shelves, with dry crossings at z = -4, 0, +4.
            for (int dx : new int[]{-4, 4}) for (int dz = -15; dz <= 15; dz++) {
                if (dz == -4 || dz == 0 || dz == 4) continue;
                w.getBlockAt(fx + dx, y, fz + dz).setType(Material.WATER, false);
                w.getBlockAt(fx + dx, y - 1, fz + dz).setType(Material.PRISMARINE_BRICKS, false);
            }
        }
        if (number == 13) {
            // Contained, visible lava strips; three broad stone bridges remain.
            for (int dx : new int[]{-5, 5}) for (int dz = -14; dz <= 14; dz++) {
                if (Math.abs(dz) <= 2 || Math.abs(dz) >= 10 && Math.abs(dz) <= 12) continue;
                w.getBlockAt(fx + dx, y, fz + dz).setType(Material.LAVA, false);
                w.getBlockAt(fx + dx, y - 1, fz + dz).setType(Material.POLISHED_BLACKSTONE, false);
            }
        }
        if (number == 14) {
            // Magma/pressure-plate hazard lanes can be read from ordinary block state.
            for (int dx : new int[]{-5, 5}) for (int dz = -13; dz <= 13; dz++) {
                if (Math.abs(dz) <= 2 || dz % 7 == 0) continue;
                boolean pad = dz % 4 == 0;
                w.getBlockAt(fx + dx, y, fz + dz).setType(
                        pad ? Material.REDSTONE_LAMP : Material.MAGMA_BLOCK, false);
                if (pad) w.getBlockAt(fx + dx, y + 1, fz + dz).setType(Material.STONE_PRESSURE_PLATE, false);
            }
        }
        if (number == 15) for (int dx = -3; dx <= 3; dx++) for (int dz = 9; dz <= 15; dz++)
            w.getBlockAt(fx + dx, y + 1, fz + dz).setType(Material.PURPUR_BLOCK, false);
        placeSign(w.getBlockAt(chestX(number) + 2, y + 1, chestZ(number) - 1),
                number == 12 ? "浅水与干桥" : number == 13 ? "熔炉与石桥" : number == 14 ? "踏板与热砖" : "利用掩体",
                "中央可通行", "留意高低差");
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
