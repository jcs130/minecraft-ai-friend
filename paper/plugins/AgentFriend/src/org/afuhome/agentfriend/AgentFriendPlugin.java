package org.afuhome.agentfriend;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import com.earth2me.essentials.Essentials;
import com.earth2me.essentials.User;
import com.earth2me.essentials.Warps;
import com.nisovin.magicspells.Spell;
import com.nisovin.magicspells.events.SpellCastEvent;
import com.nisovin.magicspells.events.SpellCastedEvent;
import com.nisovin.magicspells.util.SpellData;
import dev.aurelium.auraskills.api.AuraSkillsApi;
import dev.aurelium.auraskills.api.skill.Skills;
import dev.aurelium.auraskills.api.user.SkillsUser;
import org.bukkit.Bukkit;
import org.bukkit.boss.BarColor;
import org.bukkit.boss.BarStyle;
import org.bukkit.boss.BossBar;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.Statistic;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.TileState;
import org.bukkit.block.data.type.Switch;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Monster;
import org.bukkit.entity.Player;
import org.bukkit.entity.Villager;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockDamageEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockFromToEvent;
import org.bukkit.event.block.BlockIgniteEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerLoginEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.event.player.PlayerGameModeChangeEvent;
import org.bukkit.plugin.Plugin;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.BookMeta;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.java.JavaPlugin;

/** A vanilla-protocol command/compass bridge and bounded family arena for Paper 1.20.6. */
public final class AgentFriendPlugin extends JavaPlugin implements Listener, CommandExecutor, TabCompleter {
    private static final int X = -590, Z = -305, FLOOR = 90, RADIUS = 12;
    private static final UUID GODDESS_UUID = UUID.fromString("b2f9ceb0-8271-3470-b99f-e1c3ffe4edbd");
    private static final Set<Material> FORBIDDEN_GIFTS = Set.of(
            Material.BEDROCK, Material.BARRIER, Material.COMMAND_BLOCK,
            Material.CHAIN_COMMAND_BLOCK, Material.REPEATING_COMMAND_BLOCK,
            Material.COMMAND_BLOCK_MINECART, Material.STRUCTURE_BLOCK,
            Material.STRUCTURE_VOID, Material.JIGSAW, Material.DEBUG_STICK,
            Material.LIGHT, Material.SPAWNER, Material.END_PORTAL_FRAME);
    private static final long RUN_COOLDOWN_MS = 180_000L;
    private static final long RUN_TIMEOUT_MS = 360_000L;
    private static final long TEAM_TELEPORT_COOLDOWN_MS = 20_000L;
    private static final long FIREWORKS_COOLDOWN_MS = 10_000L;
    private static final long STARLIGHT_COOLDOWN_MS = 10_000L;
    private static final long GROUP_HEAL_COOLDOWN_MS = 12_000L;
    private static final long FEATHER_COOLDOWN_MS = 90_000L;
    private static final long NIGHT_COOLDOWN_MS = 180_000L;
    private static final String ARENA_TAG = "afu_agentfriend_arena";
    private static final Set<Material> VILLAGE_WEEDS = Set.of(Material.SHORT_GRASS, Material.TALL_GRASS,
            Material.FERN, Material.LARGE_FERN, Material.DEAD_BUSH);
    private static final Map<String, Double> SPELL_MANA_COSTS = Map.ofEntries(
            Map.entry("blink", 4.0), Map.entry("food", 3.0),
            Map.entry("selfheal", 6.0),
            Map.entry("conjure_bread", 4.0), Map.entry("conjure_torch", 4.0),
            Map.entry("conjure_oak_log", 4.0), Map.entry("conjure_cobblestone", 4.0),
            Map.entry("conjure_crafting_table", 4.0), Map.entry("conjure_chest", 4.0),
            Map.entry("conjure_cake", 4.0), Map.entry("conjure_glass", 4.0));
    // Every public compass destination has a matching Essentials warp. Keep the
    // whitelist here so player commands cannot turn arbitrary warp names into skills.
    private record PublicPlace(String id, int slot, Material icon, String title, String hint) { }
    private record GiftIdea(String id, Material icon, String title) { }
    private record FocusSpell(String id, int slot, Material icon, String title, String hint) { }
    private static final List<FocusSpell> FOCUS_SPELLS = List.of(
            new FocusSpell("prospect", 10, Material.SPYGLASS, "§d探附近矿脉", "24–40 格；刻印工具再 +8"),
            new FocusSpell("home", 1, Material.RED_BED, "§a回村庄", "安全传送到出生村庄"),
            new FocusSpell("heal", 2, Material.GLISTERING_MELON_SLICE, "§a范围治疗", "治疗 8 格内受伤玩家；6 魔力"),
            new FocusSpell("feather", 3, Material.FEATHER, "§f羽落", "需要先学会"),
            new FocusSpell("fireworks", 4, Material.FIREWORK_ROCKET, "§6烟花术", "原版烟花粒子；1 魔力"),
            new FocusSpell("starlight", 5, Material.GLOWSTONE_DUST, "§e星尘术", "照亮周围"),
            new FocusSpell("leap", 6, Material.RABBIT_FOOT, "§b跃空术", "高跳缓降；4 魔力"),
            new FocusSpell("flight", 7, Material.ELYTRA, "§d飞行术", "飞行 15 秒；10 魔力"),
            new FocusSpell("golem", 8, Material.IRON_BLOCK, "§6守护傀儡", "召唤铁傀儡 45 秒；12 魔力"),
            new FocusSpell("sense", 9, Material.RECOVERY_COMPASS, "§b探敌术", "寻找周围 24 格怪物；3 魔力"),
            new FocusSpell("prospect iron", 11, Material.RAW_IRON, "§f探铁矿", "范围随挖矿等级成长；6 魔力"),
            new FocusSpell("prospect diamond", 12, Material.DIAMOND, "§b探钻石", "范围随挖矿等级成长；6 魔力"),
            new FocusSpell("prospect gems", 13, Material.EMERALD, "§a探宝石", "钻石、绿宝石、青金石"),
            new FocusSpell("prospect coal", 14, Material.COAL, "§8探煤矿", "范围随挖矿等级成长；6 魔力"),
            new FocusSpell("prospect ancient", 15, Material.NETHERITE_SCRAP, "§6探远古残骸", "下界探矿"),
            new FocusSpell("prospect copper", 16, Material.RAW_COPPER, "§6探铜矿", "范围随挖矿等级成长；6 魔力"),
            new FocusSpell("prospect gold", 17, Material.RAW_GOLD, "§e探金矿", "范围随挖矿等级成长；6 魔力"),
            new FocusSpell("prospect redstone", 18, Material.REDSTONE, "§c探红石", "范围随挖矿等级成长；6 魔力"),
            new FocusSpell("starbolt", 19, Material.AMETHYST_SHARD, "§d星芒箭", "自动锁敌；4 魔力"),
            new FocusSpell("frostnova", 20, Material.SNOWBALL, "§b霜环", "近身群攻；7 魔力"),
            new FocusSpell("flamewave", 21, Material.BLAZE_POWDER, "§6焰浪", "前方群攻；8 魔力"),
            new FocusSpell("selfheal", 22, Material.GOLDEN_APPLE, "§a治疗自己", "回复 4 颗心；6 魔力"),
            new FocusSpell("blink", 23, Material.ENDER_PEARL, "§d闪现", "短距离移动；4 魔力"),
            new FocusSpell("food", 24, Material.BREAD, "§e饱食", "恢复饥饿；3 魔力"),
            new FocusSpell("night", 25, Material.LANTERN, "§b夜视", "需要先学会；2 魔力"));
    private static final List<GiftIdea> GIFT_IDEAS = List.of(
            new GiftIdea("cherry_sapling", Material.CHERRY_SAPLING, "樱花树苗"),
            new GiftIdea("oak_boat", Material.OAK_BOAT, "橡木船"),
            new GiftIdea("lantern", Material.LANTERN, "灯笼"),
            new GiftIdea("lead", Material.LEAD, "拴绳"),
            new GiftIdea("name_tag", Material.NAME_TAG, "命名牌"),
            new GiftIdea("saddle", Material.SADDLE, "鞍"),
            new GiftIdea("map", Material.MAP, "地图"),
            new GiftIdea("flower_pot", Material.FLOWER_POT, "花盆"));
    private static final List<PublicPlace> PUBLIC_PLACES = List.of(
            new PublicPlace("yellowstone", 0, Material.CALCITE, "§e黄石奇境", "白色岩石与温泉地貌"),
            new PublicPlace("snow", 1, Material.SNOW_BLOCK, "§b雪原", "冰雪与雪地探险"),
            new PublicPlace("bamboo", 2, Material.BAMBOO, "§a竹林", "高高的竹子与雨林"),
            new PublicPlace("oasis", 3, Material.CACTUS, "§6沙漠绿洲", "沙漠里的水与绿意"),
            new PublicPlace("lavender", 4, Material.LILAC, "§d薰衣草谷", "紫色山谷与树林"),
            new PublicPlace("mushroom", 5, Material.RED_MUSHROOM, "§c蘑菇岛", "巨型蘑菇；留意山坡"),
            new PublicPlace("white_cliffs", 6, Material.QUARTZ_BLOCK, "§f白色峭壁", "白色山崖；留意脚下"),
            new PublicPlace("moonlight", 7, Material.GLOW_BERRIES, "§5月光林", "高地树林与夜色"),
            new PublicPlace("ship", 8, Material.OAK_BOAT, "§9海上大船", "落在甲板，别跳进海里"),
            new PublicPlace("guild", 9, Material.LECTERN, "§6冒险者公会", "村庄大厅；右键任务板接单"),
            new PublicPlace("village", 10, Material.BELL, "§a出生村庄", "安全出生点"),
            new PublicPlace("cherry", 11, Material.CHERRY_SAPLING, "§d樱花林", "探索樱花树林"),
            new PublicPlace("plains", 12, Material.MAP, "§e平原村庄", "探索另一座村庄"));
    private final Map<Inventory, String> menus = new HashMap<>();
    private final Map<Inventory, Map<Integer, UUID>> playerMenuTargets = new HashMap<>();
    private final Map<UUID, UUID> trackedPlayers = new HashMap<>();
    private final Map<UUID, BossBar> trackingBars = new HashMap<>();
    private final Map<UUID, Location> savedCompassTargets = new HashMap<>();
    private final Map<UUID, UUID> automaticCompassTargets = new HashMap<>();
    private final Set<UUID> compassAutoPaused = new HashSet<>();
    private final Map<UUID, Long> teamTeleportAt = new HashMap<>();
    private final Map<UUID, Long> focusUseAt = new HashMap<>();
    private final Set<UUID> participants = new HashSet<>();
    private final Set<UUID> mobs = new HashSet<>();
    private final Map<UUID, Long> fireworksCooldown = new HashMap<>();
    private final Map<String, Long> goddessCooldown = new HashMap<>();
    private final Map<String, Long> giftNonces = new HashMap<>();
    private NamespacedKey compassKey;
    private NamespacedKey focusKey;
    private NamespacedKey focusSpellKey;
    private NamespacedKey imprintSpellKey;
    private NamespacedKey statusBookKey;
    private NamespacedKey guideSeenKey;
    private NamespacedKey mobKey;
    private NamespacedKey featherKey;
    private NamespacedKey nightKey;
    private boolean arenaBuilt;
    private boolean active;
    private int wave;
    private long startedAt;
    private long nextWaveAt;
    private long lastRun;
    private DungeonManager dungeon;
    private GuildManager guild;
    private LifeGuildManager lifeGuild;
    private GuildHallManager guildHall;
    private PvpArenaManager pvpArena;
    private TrialRoadManager trialRoad;
    private CombatSpells combatSpells;
    private ProspectingSpell prospectingSpell;
    private UtilitySpells utilitySpells;
    private SpellMastery spellMastery;
    private VillageStructureProtection villageStructureProtection;
    private VillageTrades villageTrades;
    private ViewerStatePublisher viewerStatePublisher;
    private AgentStatePublisher agentStatePublisher;
    private SkillEventPublisher skillEventPublisher;
    private ProtectionAdvisor protectionAdvisor;
    private AgentCoach agentCoach;
    private PlayerNameTags playerNameTags;
    private SoulboundGear soulboundGear;
    private DungeonGearAura dungeonGearAura;

    boolean isSoulbound(ItemStack item) {
        return soulboundGear != null && soulboundGear.owner(item) != null;
    }
    private final SpellPresentation spellPresentation = new SpellPresentation(this);
    private final Map<UUID, Long> pendingHomeChants = new HashMap<>();

    @Override public void onEnable() {
        saveDefaultConfig();
        arenaBuilt = getConfig().getBoolean("arena-built", false);
        lastRun = getConfig().getLong("last-run", 0L);
        compassKey = new NamespacedKey(this, "skill_compass");
        focusKey = new NamespacedKey(this, "spell_focus");
        focusSpellKey = new NamespacedKey(this, "focus_spell");
        imprintSpellKey = new NamespacedKey(this, "imprint_spell");
        statusBookKey = new NamespacedKey(this, "status_book");
        guideSeenKey = new NamespacedKey(this, "guide_seen");
        mobKey = new NamespacedKey(this, "arena_mob");
        featherKey = new NamespacedKey(this, "learned_feather");
        nightKey = new NamespacedKey(this, "learned_night");
        getServer().getPluginManager().registerEvents(this, this);
        getCommand("mycli").setExecutor(this);
        getCommand("mycli").setTabCompleter(this);
        dungeon = new DungeonManager(this);
        guild = new GuildManager(this, dungeon);
        lifeGuild = new LifeGuildManager(this, dungeon);
        guildHall = new GuildHallManager(this);
        pvpArena = new PvpArenaManager(this);
        trialRoad = new TrialRoadManager(this);
        spellMastery = new SpellMastery(this);
        combatSpells = new CombatSpells(this);
        prospectingSpell = new ProspectingSpell(this);
        utilitySpells = new UtilitySpells(this);
        villageStructureProtection = new VillageStructureProtection(this);
        protectionAdvisor = new ProtectionAdvisor(this);
        agentCoach = new AgentCoach(this);
        agentCoach.start();
        playerNameTags = new PlayerNameTags(this);
        playerNameTags.start();
        soulboundGear = new SoulboundGear(this);
        getServer().getPluginManager().registerEvents(soulboundGear, this);
        dungeonGearAura = new DungeonGearAura(this);
        dungeonGearAura.start();
        villageTrades = new VillageTrades(this);
        viewerStatePublisher = new ViewerStatePublisher(this, combatSpells, prospectingSpell, utilitySpells);
        viewerStatePublisher.start();
        agentStatePublisher = new AgentStatePublisher(this, combatSpells, prospectingSpell, utilitySpells);
        agentStatePublisher.start();
        skillEventPublisher = new SkillEventPublisher(this);
        skillEventPublisher.start();
        if (arenaBuilt) cleanupMobs();
        Bukkit.getScheduler().runTaskTimer(this, this::tickArena, 20L, 20L);
        Bukkit.getScheduler().runTaskTimer(this, this::tickPlayerTracking, 20L, 20L);
        Bukkit.getScheduler().runTaskTimer(this, () -> {
            for (Player player : Bukkit.getOnlinePlayers()) {
                if (player.getGameMode() != GameMode.SPECTATOR)
                    BackpackShortcutMigration.restoreMissing(player, dungeon);
            }
        }, 1200L, 1200L);
        getLogger().info("Ready; arena-built=" + arenaBuilt + ", Paper 1.20.6 vanilla protocol");
    }

    @Override public void onDisable() {
        if (pvpArena != null) pvpArena.shutdown();
        if (dungeonGearAura != null) dungeonGearAura.stop();
        if (agentCoach != null) agentCoach.stop();
        if (playerNameTags != null) playerNameTags.stop();
        if (dungeon != null) dungeon.shutdown();
        if (active) {
            lastRun = System.currentTimeMillis();
            getConfig().set("last-run", lastRun);
            saveConfig();
        }
        cleanupMobs();
        menus.clear();
        playerMenuTargets.clear();
        trackedPlayers.clear();
        trackingBars.values().forEach(BossBar::removeAll);
        trackingBars.clear();
        for (UUID id : new HashSet<>(savedCompassTargets.keySet())) {
            Player player = Bukkit.getPlayer(id);
            if (player != null) restoreCompass(player);
        }
        savedCompassTargets.clear();
        automaticCompassTargets.clear();
        compassAutoPaused.clear();
        teamTeleportAt.clear();
        focusUseAt.clear();
        giftNonces.clear();
        pendingHomeChants.clear();
        if (viewerStatePublisher != null) viewerStatePublisher.stop();
        if (agentStatePublisher != null) agentStatePublisher.stop();
        if (skillEventPublisher != null) skillEventPublisher.stop();
        if (spellMastery != null) spellMastery.shutdown();
        if (protectionAdvisor != null) protectionAdvisor.stop();
        if (combatSpells != null) combatSpells.clear();
        if (prospectingSpell != null) prospectingSpell.clear();
        if (utilitySpells != null) utilitySpells.clear();
    }

    private World world() { return Bukkit.getWorld("world"); }
    VillageStructureProtection villageProtection() { return villageStructureProtection; }
    GuildHallManager guildHall() { return guildHall; }
    TrialRoadManager trialRoad() { return trialRoad; }
    DungeonManager dungeon() { return dungeon; }
    boolean dungeonParticipant(Player player) { return dungeon != null && dungeon.isParticipant(player); }
    void openPvpMenu(Player player) { openMenu(player, "pvp"); }
    void openDungeonDifficultyMenu(Player player) {
        if (dungeon != null && dungeon.isBuilt()) openMenu(player, "arena_difficulty");
        else player.sendMessage(ChatColor.RED + "试炼塔尚未建成。");
    }
    boolean deniesArenaEdit(Block block) { return arenaBuilt && inBuild(block.getLocation()); }
    void guildMobDefeated(Player player, org.bukkit.entity.EntityType type) { if (guild != null) guild.onDungeonMobDefeated(player, type); }
    void guildFloorCleared(Player player, int floor, int partySize) {
        if (guild != null) guild.onDungeonFloorCleared(player, floor, partySize);
    }
    void guildRewardClaimed(Player player) { if (guild != null) guild.onDungeonRewardClaimed(player); }
    int adventurerRank(Player player) { return guild == null ? 0 : guild.adventurerRank(player); }
    String adventurerRankName(Player player) { return guild == null ? "青铜" : guild.adventurerRankName(player); }
    boolean guildMember(Player player) { return guild != null && guild.hasJoined(player); }
    void openGuildMenu(Player player) { openMenu(player, "guild"); }
    void openLifeGuildMenu(Player player) { openMenu(player, "life"); }
    void guildHallTeleport(Player player) { guildHall.teleport(player); }
    private boolean sameWorld(Location at) { return at != null && at.getWorld() != null && at.getWorld().equals(world()); }
    private boolean inVillage(Location at) {
        return sameWorld(at) && at.getBlockX() >= -630 && at.getBlockX() <= -470
                && at.getBlockZ() >= -530 && at.getBlockZ() <= -380;
    }
    private boolean inside(Location at) {
        return sameWorld(at) && Math.abs(at.getBlockX() - X) <= 11 && Math.abs(at.getBlockZ() - Z) <= 11
                && at.getY() >= FLOOR && at.getY() <= FLOOR + 8;
    }
    private boolean inBuild(Location at) {
        if (!sameWorld(at) || at.getY() < 75 || at.getY() > 100) return false;
        int dx = Math.abs(at.getBlockX() - X), dz = at.getBlockZ() - Z;
        return (dx <= 13 && Math.abs(dz) <= 13) || (dx <= 3 && dz >= -23 && dz < -12);
    }
    private boolean button(Block b) {
        return b != null && sameWorld(b.getLocation()) && b.getX() == X - 6
                && b.getY() == FLOOR + 2 && b.getZ() == Z - 8 && b.getType() == Material.STONE_BUTTON;
    }

    private SkillsUser skillsUser(Player p) {
        SkillsUser user = AuraSkillsApi.get().getUser(p.getUniqueId());
        return user != null && user.isLoaded() ? user : null;
    }

    int miningLevel(Player player) {
        SkillsUser user = skillsUser(player);
        return user == null ? 0 : user.getSkillLevel(Skills.MINING);
    }

    boolean hasImprintedProspectTool(ItemStack item) {
        String id = imprintedSpell(item);
        return id != null && (id.equals("prospect") || id.startsWith("prospect "));
    }

    boolean spendMana(Player p, double amount) {
        SkillsUser user = skillsUser(p);
        if (user == null) { p.sendMessage(ChatColor.RED + "魔力数据还没加载，请稍后再试。"); return false; }
        if (user.getMana() + 0.0001 < amount) {
            p.sendMessage(ChatColor.RED + "魔力不足：当前 " + Math.round(user.getMana()) + "/"
                    + Math.round(user.getMaxMana()) + "，需要 " + Math.round(amount) + "。");
            return false;
        }
        boolean consumed = user.consumeMana(amount);
        if (consumed && agentStatePublisher != null) agentStatePublisher.afterCast(p);
        return consumed;
    }

    void presentSpell(Player player, String spell) {
        spellPresentation.show(player, spell);
    }

    void publishSkill(Player player, String spell, String body, Location position) {
        if (skillEventPublisher != null) skillEventPublisher.publish(player, spell, body, position);
    }

    long totalBuiltinCooldownMs(String spell) {
        return switch (spell) {
            case "home" -> 0L;
            case "fireworks" -> FIREWORKS_COOLDOWN_MS;
            case "starlight" -> STARLIGHT_COOLDOWN_MS;
            case "heal" -> GROUP_HEAL_COOLDOWN_MS;
            case "feather" -> FEATHER_COOLDOWN_MS;
            case "night" -> NIGHT_COOLDOWN_MS;
            default -> throw new IllegalArgumentException("Unknown built-in spell " + spell);
        };
    }

    long remainingBuiltinCooldownMs(Player player, String spell) {
        long until = spell.equals("fireworks")
                ? fireworksCooldown.getOrDefault(player.getUniqueId(), 0L)
                : goddessCooldown.getOrDefault(player.getUniqueId() + ":" + spell, 0L);
        return Math.max(0L, until - System.currentTimeMillis());
    }

    boolean hasLearnedSkill(Player player, String spell) {
        NamespacedKey key = skillKey(spell);
        return key != null && learned(player, key);
    }

    SpellMastery mastery() { return spellMastery; }

    int auraLevel(Player player, Skills skill) {
        SkillsUser user = skillsUser(player);
        return user == null ? 0 : user.getSkillLevel(skill);
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onSpellPreCast(SpellCastEvent event) {
        if (!(event.getCaster() instanceof Player p)) return;
        if (event.getSpell().getInternalName().equalsIgnoreCase("heal")
                && event.getSpellCastState() == Spell.SpellCastState.NORMAL) {
            event.setCancelled(true);
            Bukkit.getScheduler().runTask(this, () -> {
                if (p.isOnline()) groupHeal(p);
            });
            return;
        }
        Double cost = SPELL_MANA_COSTS.get(event.getSpell().getInternalName());
        if (cost == null || event.getSpellCastState() != Spell.SpellCastState.NORMAL) return;
        if (p.getGameMode() == GameMode.SPECTATOR) {
            event.setCancelled(true);
            p.sendMessage(ChatColor.RED + "旁观者不能施法。");
            return;
        }
        SkillsUser user = skillsUser(p);
        if (user == null || user.getMana() + 0.0001 < cost) {
            event.setCancelled(true);
            p.sendMessage(ChatColor.RED + "魔力不足：需要 " + Math.round(cost) + "。用罗盘的命格书查看当前魔力。");
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onSpellCasted(SpellCastedEvent event) {
        if (!(event.getCaster() instanceof Player p)) return;
        Double cost = SPELL_MANA_COSTS.get(event.getSpell().getInternalName());
        if (cost == null || event.getSpellCastState() != Spell.SpellCastState.NORMAL
                || event.getPostCastAction() != Spell.PostCastAction.HANDLE_NORMALLY) return;
        SkillsUser user = skillsUser(p);
        if (user == null || !user.consumeMana(cost)) {
            getLogger().severe("Successful spell was not charged in AuraSkills: "
                    + event.getSpell().getInternalName() + " caster=" + p.getUniqueId());
        }
        if (agentStatePublisher != null) agentStatePublisher.afterCast(p);
        presentSpell(p, event.getSpell().getInternalName());
        String spellId = event.getSpell().getInternalName();
        SpellData data = event.getSpellData();
        Location effectPosition = data == null ? null : data.location();
        if (data != null && data.target() != null) effectPosition = data.target().getLocation();
        else if (data != null && data.recipient() != null) effectPosition = data.recipient().getLocation();
        Location capturedPosition = effectPosition == null ? null : effectPosition.clone();
        Bukkit.getScheduler().runTask(this, () -> {
            if (!p.isOnline()) return;
            Location position = spellId.equals("blink") || capturedPosition == null
                    ? p.getLocation() : capturedPosition;
            publishSkill(p, spellId, "生效", position);
        });
    }

    boolean floodgatePlayer(UUID uuid) {
        Plugin floodgate = Bukkit.getPluginManager().getPlugin("floodgate");
        if (floodgate == null || !floodgate.isEnabled()) return true; // fail closed for reserved OP identity
        try {
            Class<?> apiClass = floodgate.getClass().getClassLoader().loadClass("org.geysermc.floodgate.api.FloodgateApi");
            Object api = apiClass.getMethod("getInstance").invoke(null);
            return (boolean) apiClass.getMethod("isFloodgatePlayer", UUID.class).invoke(api, uuid);
        } catch (ReflectiveOperationException | RuntimeException error) {
            getLogger().warning("Floodgate identity check unavailable for reserved Goddess login: " + error);
            return true;
        }
    }

    @EventHandler(priority = EventPriority.HIGHEST) public void onGoddessLogin(PlayerLoginEvent event) {
        if (!event.getPlayer().getName().equalsIgnoreCase("Goddess")) return;
        if (!event.getPlayer().getName().equals("Goddess")
                || !event.getAddress().isLoopbackAddress()
                || !event.getPlayer().getUniqueId().equals(GODDESS_UUID)
                || floodgatePlayer(event.getPlayer().getUniqueId())) {
            event.disallow(PlayerLoginEvent.Result.KICK_OTHER, "Goddess is a reserved local server account.");
            getLogger().warning("Rejected reserved Goddess login from " + event.getAddress());
        }
    }

    @EventHandler public void onGoddessJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        if (!player.getName().equals("Goddess")) return;
        Bukkit.getScheduler().runTask(this, () -> {
            if (!player.isOnline()) return;
            player.setGameMode(GameMode.SPECTATOR);
            player.setCollidable(false);
            player.setInvulnerable(true);
            getLogger().info("Goddess joined as protected spectator " + player.getUniqueId());
        });
    }

    @EventHandler public void onStarterJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        Bukkit.getScheduler().runTaskLater(this, () -> {
            if (!player.isOnline()) return;
            int backpackChanges = BackpackShortcutMigration.migrate(player);
            if (backpackChanges > 0) getLogger().info("Updated Minepacks shortcut for "
                    + player.getUniqueId() + "; slots=" + backpackChanges);
            if (player.getGameMode() == GameMode.SPECTATOR) return;
            soulboundGear.bindMengmengKit(player);
            BackpackShortcutMigration.restoreMissing(player, dungeon);
            if (!hasCompass(player)) giveCompass(player);
            if (!hasStatusBook(player)) giveStatusBook(player);
            if (!hasFocus(player)) giveFocus(player);
            if (!player.getPersistentDataContainer().has(guideSeenKey, PersistentDataType.BYTE)) {
                player.getPersistentDataContainer().set(guideSeenKey, PersistentDataType.BYTE, (byte) 1);
                player.sendMessage(ChatColor.GOLD + "欢迎来到千灯纪！手持技能罗盘按使用键，选择「旅途指南」开始冒险。");
                player.sendMessage(ChatColor.AQUA + "手柄无需打字；命格书可翻页阅读。Agent 可输入 /mycli guide 查看操作指令。");
            }
        }, 40L);
    }

    @EventHandler public void onPlayerQuit(PlayerQuitEvent event) {
        if (protectionAdvisor != null) protectionAdvisor.forget(event.getPlayer());
        UUID id = event.getPlayer().getUniqueId();
        trackedPlayers.remove(id);
        automaticCompassTargets.remove(id);
        compassAutoPaused.remove(id);
        savedCompassTargets.remove(id);
        teamTeleportAt.remove(id);
        focusUseAt.remove(id);
        pendingHomeChants.remove(id);
        removeTrackingBar(id);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onHomeTeleport(PlayerTeleportEvent event) {
        Player player = event.getPlayer();
        Long deadline = pendingHomeChants.get(player.getUniqueId());
        Location target = event.getTo();
        if (deadline == null || target == null || System.currentTimeMillis() > deadline
                || !sameWorld(target)
                || target.distanceSquared(new Location(world(), -543.5, 66.9375, -439.5)) >= 12 * 12) return;
        pendingHomeChants.remove(player.getUniqueId());
        Bukkit.getScheduler().runTask(this, () -> {
            if (player.isOnline() && sameWorld(player.getLocation())
                    && player.getLocation().distanceSquared(new Location(world(), -543.5, 66.9375, -439.5)) < 12 * 12) {
                presentSpell(player, "home");
                publishSkill(player, "home", "已抵达出生村庄", player.getLocation());
            }
        });
    }

    @EventHandler public void onGoddessMode(PlayerGameModeChangeEvent event) {
        if (event.getPlayer().getName().equals("Goddess") && event.getNewGameMode() != GameMode.SPECTATOR)
            event.setCancelled(true);
    }

    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length >= 2 && args[0].equalsIgnoreCase("admin")
                && args[1].equalsIgnoreCase("lootaudit")) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台抽样奖池。"); return true;
            }
            if (args.length != 5) {
                sender.sendMessage("用法：/mycli admin lootaudit <楼层1–15> <难度0–2> <抽样次数100–10000>"); return true;
            }
            try {
                int floor = Integer.parseInt(args[2]), difficulty = Integer.parseInt(args[3]);
                int draws = Integer.parseInt(args[4]);
                if (floor < 1 || floor > 15 || difficulty < 0 || difficulty > 2
                        || draws < 100 || draws > 10000) throw new NumberFormatException();
                Map<String, Integer> tiers = new HashMap<>();
                int tomes = 0, enchantedBooks = 0, pearls = 0, paintings = 0;
                for (int i = 0; i < draws; i++) {
                    DungeonLoot.Bonus bonus = DungeonLoot.roll(floor, 0, difficulty);
                    tiers.merge(bonus.tier(), 1, Integer::sum);
                    if (SkillTome.isTome(bonus.item())) tomes++;
                    if (bonus.item().getType() == Material.ENCHANTED_BOOK) enchantedBooks++;
                    if (bonus.item().getType() == Material.ENDER_PEARL) pearls++;
                    if (bonus.item().getType() == Material.PAINTING) paintings++;
                }
                sender.sendMessage("MC_LOOT_AUDIT floor=" + floor + " difficulty=" + difficulty
                        + " draws=" + draws + " common=" + tiers.getOrDefault("common", 0)
                        + " uncommon=" + tiers.getOrDefault("uncommon", 0)
                        + " rare=" + tiers.getOrDefault("rare", 0)
                        + " legendary=" + tiers.getOrDefault("legendary", 0)
                        + " skillTomes=" + tomes + " enchantedBooks=" + enchantedBooks
                        + " enderPearls=" + pearls + " paintings=" + paintings);
            } catch (NumberFormatException bad) { sender.sendMessage("楼层、难度或次数超出允许范围。"); }
            return true;
        }
        if (args.length >= 2 && args[0].equalsIgnoreCase("admin")
                && args[1].equalsIgnoreCase("givetome")) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台发研习书。 "); return true;
            }
            if (args.length != 5) {
                sender.sendMessage("用法：/mycli admin givetome <在线玩家> <技能ID> <4|8>"); return true;
            }
            Player target = Bukkit.getPlayerExact(args[2]);
            if (target == null) { sender.sendMessage("目标玩家必须在线。"); return true; }
            try {
                int practice = Integer.parseInt(args[4]);
                ItemStack tome = SkillTome.create(args[3].toLowerCase(Locale.ROOT), practice);
                if (!target.getInventory().addItem(tome).isEmpty()) {
                    sender.sendMessage("目标背包已满，未发放。"); return true;
                }
                sender.sendMessage("研习书发放成功：" + target.getUniqueId() + " " + args[3] + " +" + practice);
                getLogger().info("Console granted skill tome " + args[3] + " +" + practice
                        + " to " + target.getUniqueId());
            } catch (IllegalArgumentException bad) { sender.sendMessage("技能 ID 无效或熟练度只允许 4|8。"); }
            return true;
        }
        if ((args.length == 4 || args.length == 5) && args[0].equalsIgnoreCase("admin")
                && args[1].equalsIgnoreCase("bindgear")) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台绑定专属装备。"); return true;
            }
            if (args.length == 5 && !args[4].equalsIgnoreCase("apply")) {
                sender.sendMessage("用法：/mycli admin bindgear <在线玩家> <背包槽位0–40> [apply]"); return true;
            }
            Player target = Bukkit.getPlayerExact(args[2]);
            if (target == null) { sender.sendMessage("目标玩家必须在线。"); return true; }
            soulboundGear.adminBind(sender, target, args[3], args.length == 5);
            return true;
        }
        if (args.length == 3 && args[0].equalsIgnoreCase("admin")
                && args[1].equalsIgnoreCase("protectchannel")) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台检查频道。"); return true;
            }
            Player target = Bukkit.getPlayerExact(args[2]);
            if (target == null) { sender.sendMessage("玩家不在线。"); return true; }
            sender.sendMessage("Protection channel " + target.getName() + " registered="
                    + target.getListeningPluginChannels().contains(ProtectionAdvisor.CHANNEL));
            return true;
        }
        if (args.length > 1 && args[0].equalsIgnoreCase("admin") && args[1].equalsIgnoreCase("villagers")) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台检查村民交易。"); return true;
            }
            villageTrades.report(sender);
            return true;
        }
        if (args.length > 1 && args[0].equalsIgnoreCase("admin") && args[1].equalsIgnoreCase("gift")) {
            goddessGift(sender, args);
            return true;
        }
        if (args.length == 4 && args[0].equalsIgnoreCase("admin") && args[1].equalsIgnoreCase("teach")) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台授课。"); return true;
            }
            Player target = Bukkit.getPlayerExact(args[2]);
            NamespacedKey key = skillKey(args[3].toLowerCase(Locale.ROOT));
            if (target == null || key == null) { sender.sendMessage("玩家必须在线；技能仅 feather|night。"); return true; }
            if (learned(target, key)) { sender.sendMessage("已学会，未重复授课。"); return true; }
            target.getPersistentDataContainer().set(key, PersistentDataType.BYTE, (byte) 1);
            target.sendMessage(ChatColor.LIGHT_PURPLE + "女神传授了 " + args[3] + "；/mycli spells 查看技能。");
            sender.sendMessage("授课成功：" + target.getUniqueId() + " " + args[3]);
            getLogger().info("Console taught " + args[3] + " to " + target.getUniqueId());
            return true;
        }
        if (args.length > 1 && args[0].equalsIgnoreCase("admin") && args[1].equalsIgnoreCase("buildarena")) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台安装试炼场。"); return true;
            }
            buildArena(sender);
            return true;
        }
        if (args.length > 1 && args[0].equalsIgnoreCase("admin") && args[1].equalsIgnoreCase("builddungeon")) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台安装多层试炼场。"); return true;
            }
            dungeon.build(sender);
            return true;
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("admin")
                && (args[1].equalsIgnoreCase("surveypvp") || args[1].equalsIgnoreCase("buildpvp"))) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台勘察或建造 PvP 竞技场。"); return true;
            }
            if (args[1].equalsIgnoreCase("surveypvp")) pvpArena.survey(sender);
            else pvpArena.build(sender);
            return true;
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("admin") && args[1].equalsIgnoreCase("dungeonaudit")) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台检查试炼怪物。"); return true;
            }
            dungeon.audit(sender);
            return true;
        }
        if ((args.length == 3 || args.length == 4) && args[0].equalsIgnoreCase("admin")
                && args[1].equalsIgnoreCase("prunetrial")) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台整理试炼箱。"); return true;
            }
            Player target = Bukkit.getPlayerExact(args[2]);
            if (target == null) { sender.sendMessage("目标玩家必须在线。"); return true; }
            if (args.length == 4 && !args[3].equalsIgnoreCase("apply")) {
                sender.sendMessage("用法：mycli admin prunetrial <玩家> [apply]"); return true;
            }
            dungeon.pruneChestDuplicates(target, args.length == 4, sender);
            return true;
        }
        if ((args.length == 3 || args.length == 4) && args[0].equalsIgnoreCase("admin")
                && args[1].equalsIgnoreCase("prunetrialbag")) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台整理试炼装备。"); return true;
            }
            Player target = Bukkit.getPlayerExact(args[2]);
            if (target == null) { sender.sendMessage("目标玩家必须在线。"); return true; }
            if (args.length == 4 && !args[3].equalsIgnoreCase("apply")) {
                sender.sendMessage("用法：mycli admin prunetrialbag <玩家> [apply]"); return true;
            }
            dungeon.pruneBagDuplicates(target, args.length == 4, sender);
            return true;
        }
        if ((args.length == 3 || args.length == 4) && args[0].equalsIgnoreCase("admin")
                && args[1].equalsIgnoreCase("sharetrial")) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台预览或转移个人试炼箱普通物资。"); return true;
            }
            if (args.length == 4 && !args[3].equalsIgnoreCase("apply")) {
                sender.sendMessage("用法：mycli admin sharetrial <在线玩家> [apply]"); return true;
            }
            Player target = Bukkit.getPlayerExact(args[2]);
            if (target == null) { sender.sendMessage("目标玩家必须在线。"); return true; }
            dungeon.donatePlainStash(target, guildHall, args.length == 4, sender);
            return true;
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("admin")
                && (args[1].equalsIgnoreCase("surveydeep") || args[1].equalsIgnoreCase("builddeep"))) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台勘察或扩建试炼塔深层分区。"); return true;
            }
            if (args[1].equalsIgnoreCase("surveydeep")) dungeon.surveyExpansion(sender);
            else dungeon.buildExpansion(sender);
            return true;
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("admin")
                && (args[1].equalsIgnoreCase("surveychallenge") || args[1].equalsIgnoreCase("buildchallenge"))) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台勘察或建造挑战侧翼。"); return true;
            }
            if (args[1].equalsIgnoreCase("surveychallenge")) dungeon.surveyChallenge(sender);
            else dungeon.buildChallenge(sender);
            return true;
        }
        if (args.length == 4 && args[0].equalsIgnoreCase("admin")
                && args[1].equalsIgnoreCase("scanchallenge")) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许控制台勘察候选区。"); return true;
            }
            try { dungeon.scanChallengeCandidate(sender, Integer.parseInt(args[2]), Integer.parseInt(args[3])); }
            catch (NumberFormatException bad) { sender.sendMessage("x 和 z 必须是整数。"); }
            return true;
        }
        if (args.length >= 2 && args[0].equalsIgnoreCase("admin")
                && (args[1].equalsIgnoreCase("surveyguild") || args[1].equalsIgnoreCase("buildguild"))) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台勘察或建造公会大厅。"); return true;
            }
            if (args.length != 4) { sender.sendMessage("用法：/mycli admin surveyguild|buildguild <x> <z>"); return true; }
            try {
                int gx = Integer.parseInt(args[2]), gz = Integer.parseInt(args[3]);
                if (args[1].equalsIgnoreCase("surveyguild")) guildHall.survey(sender, gx, gz);
                else guildHall.build(sender, gx, gz);
            } catch (NumberFormatException error) { sender.sendMessage("x、z 必须是整数。"); }
            return true;
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("admin")
                && (args[1].equalsIgnoreCase("surveyservices") || args[1].equalsIgnoreCase("buildservices"))) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台勘察或建造公会服务区。"); return true;
            }
            if (args[1].equalsIgnoreCase("surveyservices")) guildHall.surveyServices(sender);
            else guildHall.buildServices(sender);
            return true;
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("admin")
                && (args[1].equalsIgnoreCase("surveyroad") || args[1].equalsIgnoreCase("buildroad"))) {
            if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) {
                sender.sendMessage("只允许服务器控制台勘察或建造道路。"); return true;
            }
            if (args[1].equalsIgnoreCase("surveyroad")) trialRoad.survey(sender);
            else trialRoad.build(sender);
            return true;
        }
        if (!(sender instanceof Player player)) {
            sender.sendMessage("玩家子命令需要玩家身份；控制台可用 /mycli admin surveydeep|builddeep|builddungeon|surveyguild|buildguild|surveyroad|buildroad。");
            return true;
        }
        if (agentCoach != null) agentCoach.mycliUsed(player);
        if (args.length == 0) { help(player); return true; }
        if (args[0].equalsIgnoreCase("help")) {
            if (args.length == 1) help(player);
            else AgentCliCatalog.explain(player, args, 1);
            return true;
        }
        String action = args[0].toLowerCase(Locale.ROOT);
        switch (action) {
            case "list" -> AgentCliCatalog.list(player, args);
            case "explain" -> AgentCliCatalog.explain(player, args, 1);
            case "coach" -> agentCoach.command(player, args);
            case "menu", "compassmenu", "罗盘" -> openMenu(player, "skills");
            case "compass", "指南针" -> giveCompass(player);
            case "focus", "法杖" -> focusCommand(player, args);
            case "imprint", "刻印" -> imprintCommand(player, args);
            case "guide", "指引", "指南" -> guide(player, args);
            case "book", "命格书" -> giveStatusBook(player);
            case "kit", "入门" -> { giveCompass(player); giveStatusBook(player); }
            case "spells", "skills", "技能" -> spells(player);
            case "mastery", "熟练度" -> spellMastery.report(player);
            case "skillbook", "技能书" -> SkillTome.command(player, args, spellMastery);
            case "status", "状态" -> status(player);
            case "protect", "保护" -> protectionAdvisor.command(player, args);
            case "cast", "咏唱", "施法" -> cast(player, tail(args, 1));
            case "goto", "传送" -> gotoPlace(player, tail(args, 1));
            case "waypoint", "传送点" -> waypoint(player, args);
            case "locate", "找队友" -> locate(player, args);
            case "arena", "试炼" -> {
                if (dungeon.isBuilt()) dungeon.command(player, args);
                else arenaCommand(player, args);
            }
            case "pvp", "duel", "决斗" -> pvpArena.command(player, args);
            case "guild", "公会", "工会" -> guild.command(player, args);
            case "life", "生活" -> lifeGuild.command(player, args);
            case "goddess", "女神" -> goddess(player, args);
            default -> player.sendMessage(ChatColor.RED + "未知子命令。先用 /mycli list 发现命令，再用 /mycli explain <ID> 查看用法；不会猜测并执行其他命令。");
        }
        return true;
    }

    private static String tail(String[] args, int from) {
        if (from >= args.length) return "";
        return String.join(" ", java.util.Arrays.copyOfRange(args, from, args.length)).trim();
    }
    private void help(Player p) {
        p.sendMessage(ChatColor.GOLD + "千灯纪技能接口 /mycli" + ChatColor.GRAY + " · Java / 基岩 / Agent 共用");
        p.sendMessage("Agent：/mycli list [分类|命令] [页码] 发现能力；/mycli explain <ID> 或 /mycli help <ID> 查询准确用法，不会执行。");
        p.sendMessage("/mycli coach status|on|off  查看或调整个人提醒；连续死亡、久未行动或久未使用 /mycli 时低频提示。");
        p.sendMessage("/mycli spells  查看技能；/mycli cast selfheal|starbolt|frostnova|flamewave|prospect  咏唱");
        p.sendMessage("/mycli protect break|place <x> <y> <z>  查询附近方块能否操作；Agent 挖掘前先查");
        p.sendMessage(ChatColor.LIGHT_PURPLE + "造物术没有想要的物品时，会向女神提交申请；也可从罗盘选择更多造物。");
        p.sendMessage("/mycli compass  补领罗盘；/mycli book  补领命格书；/mycli menu  打开罗盘");
        p.sendMessage("/mycli guide [start|explore|magic|gear|guild|dungeon|team]  分步指引；手柄从罗盘选旅途指南");
        p.sendMessage("/mycli focus give|list|bind <技能ID>  领取、查看或绑定法杖；手持使用即施法");
        p.sendMessage("/mycli mastery  查看战斗、探索、采集法术的个人熟练度与下一级门槛");
        p.sendMessage("/mycli skillbook list|use [槽位]  查看并研习试炼掉落的实体技能书；手柄可手持使用");
        p.sendMessage("/mycli imprint [list|技能ID]  在附魔台附近给手持工具刻印；潜行使用工具施法");
        p.sendMessage("/mycli cast leap|flight|golem|sense  跃空、限时飞行、守护傀儡、探测怪物");
        p.sendMessage("/mycli goto <地点ID>|arena|personal:<名字>；/mycli waypoint 列出地点");
        p.sendMessage("/mycli waypoint [add|remove <名字>]  管理私人地点");
        p.sendMessage("/mycli locate [list|nearest|玩家名|off]  追踪队友；/mycli locate tp <玩家名|nearest> 安全传送");
        p.sendMessage(dungeon.isBuilt()
                ? "/mycli arena difficulty auto|normal|adventure|apocalypse；start|rest|next|shop|recycle|wallet|loot|status|rewards|stash|leave"
                : "/mycli arena start|status|leave  试炼场；也可按场内按钮启动");
        p.sendMessage("/mycli guild hall|board|menu|join|status|accept <ID>|abandon|claim|rewards|stash  公会大厅、任务与声望");
        p.sendMessage("/mycli life board|menu|status|accept <ID>|claim|write <书名>|<正文>  生活公会");
        p.sendMessage("/mycli pvp status|join|leave|lobby|board|menu  同款装备一对一竞技场；罗盘可用");
        p.sendMessage("/mycli goddess skills|learn <技能>|pray <话>  女神技艺与祈愿");
    }
    private void guide(Player p, String[] args) {
        String topic = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "start";
        switch (topic) {
            case "menu", "目录" -> openMenu(p, "guide");
            case "start", "开始" -> {
                p.sendMessage(ChatColor.GOLD + "【千灯纪 · 从这里开始】1 读命格书；2 用技能罗盘选地点；3 到公会看板接一张任务。");
                p.sendMessage(ChatColor.GRAY + "Agent：/mycli status 查看本人状态；/mycli waypoint 列地点；/mycli goto <地点ID> 前往；/mycli guide <主题> 看下一步。");
                p.sendMessage(ChatColor.AQUA + "主题：explore、magic、gear、guild、dungeon、team。手柄：罗盘 → 旅途指南，选图标即可进入对应菜单。");
            }
            case "explore", "探索" -> {
                p.sendMessage(ChatColor.GOLD + "【探索】先去出生村庄、樱花林等公共地点；遗迹落点在外围，需要步行探索。罗盘可保存自己的营地。");
                p.sendMessage(ChatColor.GRAY + "Agent：/mycli waypoint；/mycli goto cherry；/mycli waypoint add camp；/mycli goto personal:camp。传送前先确认周围安全。");
                p.sendMessage(ChatColor.GRAY + "挖掘/放置前：/mycli protect break|place <x> <y> <z>；deny 不动、unknown 暂缓、allow_likely 可尝试。");
            }
            case "magic", "魔法" -> {
                p.sendMessage(ChatColor.LIGHT_PURPLE + "【魔法】在罗盘选法术图标；法杖手持使用可瞬发，潜行使用可换绑定。未学会的羽落、夜视先选图标学习。");
                p.sendMessage(ChatColor.GRAY + "Agent：/mycli spells；/mycli cast selfheal|starbolt|prospect；/mycli focus list；/mycli focus bind <技能ID>。用 /mycli status 看魔力。");
            }
            case "gear", "装备", "刻印" -> {
                p.sendMessage(ChatColor.LIGHT_PURPLE + "【工具刻印】手持镐、剑等工具，在附魔台旁潜行使用附魔台，选择要刻印的法术；之后潜行对方块使用工具施法。");
                p.sendMessage(ChatColor.GRAY + "需要 3 原版经验等级和 1 青金石。Agent：靠近附魔台后 /mycli imprint list，再用 /mycli imprint <技能ID>；也可直接 /mycli cast <技能ID>。");
            }
            case "guild", "公会", "工会" -> {
                p.sendMessage(ChatColor.GOLD + "【公会】罗盘 → 冒险者公会 → 看板选任务。完成后回看板交付；声望提升冒险者等级，物资进个人奖励箱。");
                p.sendMessage(ChatColor.GRAY + "Agent：/mycli guild board；/mycli guild accept <任务ID>；/mycli guild status；/mycli guild claim；/mycli arena rewards list；/mycli arena stash list。");
            }
            case "dungeon", "地下城", "试炼" -> {
                p.sendMessage(ChatColor.GOLD + "【试炼塔】从村庄沿道路走到入口；按石按钮打开难度菜单，选普通／冒险／末日或自动，再点「开始」。附近队友会一起进入；清怪 10 秒后自动下楼并补满生命。");
                p.sendMessage(ChatColor.GRAY + "奖励在入口个人箱，死亡后也到那里拿。Agent 可像普通箱子一样 openContainer/withdraw/deposit；/mycli arena rewards 远程开箱。");
            }
            case "team", "队友" -> {
                p.sendMessage(ChatColor.AQUA + "【结伴】罗盘 → 找队友，可让指针追踪队友，也可安全传送到她身边。女神是旁观服主，不在队友列表。");
                p.sendMessage(ChatColor.GRAY + "Agent：/mycli locate list；/mycli locate nearest；/mycli locate tp nearest；/mycli locate off。");
            }
            default -> p.sendMessage(ChatColor.RED + "指南主题：start|explore|magic|gear|guild|dungeon|team；/mycli guide menu 打开手柄菜单。");
        }
    }
    private void spells(Player p) {
        p.sendMessage(ChatColor.LIGHT_PURPLE + "守护/恢复：圣愈术(selfheal，治疗自己)、范围治疗(heal，8 格内所有受伤玩家)、饱食(food)；位移：归乡(home)、闪现(blink)；创造/观赏：造物术(give)、烟花术(fireworks)、星尘术(starlight)。");
        p.sendMessage(ChatColor.GOLD + "战斗咏唱：星芒箭(starbolt，自动锁敌、4 魔力)、霜环(frostnova，7 魔力)、焰浪(flamewave，8 魔力)；仅攻击怪物，不破坏方块。");
        p.sendMessage(ChatColor.LIGHT_PURPLE + "探矿术(prospect)：基础 24 格，挖矿每 5 级 +2 格、最多 40 格；手持探矿刻印工具再 +8 格。可选 iron|coal|copper|gold|gems|diamond|redstone|ancient；6 魔力，30 秒冷却。");
        p.sendMessage(ChatColor.AQUA + "探索咏唱：跃空(leap，4 魔力/8 秒，需站在地上)、飞行(flight，10 魔力/90 秒，持续 15 秒)、守护傀儡(golem，12 魔力/75 秒，持续 45 秒)、探敌(sense，3 魔力/15 秒，搜索 24 格)。");
        p.sendMessage(ChatColor.GRAY + "Agent 用 /mycli cast <英文ID> 施法；/mycli focus list 查看可绑定 ID，/mycli focus bind <ID> 将法杖改为单次使用即施放。无目标的探敌不扣魔力。");
        p.sendMessage(ChatColor.GRAY + "附魔台旁手持镐/剑等工具，潜行使用附魔台打开刻印菜单；Agent 可用 /mycli imprint <英文ID>。普通附魔、魔力与技能冷却照常保留。");
        p.sendMessage(ChatColor.AQUA + "可学习：羽落(feather) " + learnedLabel(p, featherKey) + "、夜视(night) " + learnedLabel(p, nightKey));
        p.sendMessage(ChatColor.GRAY + "每项可用原版经验 5 级学习，炼金等级 2 免费学习，或首次通过试炼第三层自动学会。");
        p.sendMessage(ChatColor.GRAY + "魔力统一使用 AuraSkills；MagicSpells 处理生活法术，AgentFriend 处理战斗、探矿与探索法术。");
        p.sendMessage(ChatColor.GRAY + "技能分战斗、探索、采集；/mycli mastery 看每项熟练度和下一级所需次数。罗盘也可点技能成长。");
    }
    private void status(Player p) {
        SkillsUser user = skillsUser(p);
        p.sendMessage(ChatColor.AQUA + "生命 " + Math.round(p.getHealth()) + "/" + Math.round(p.getMaxHealth())
                + " · 饥饿 " + p.getFoodLevel() + "/20 · 原版经验等级 " + p.getLevel());
        if (user != null) p.sendMessage(ChatColor.LIGHT_PURPLE + "魔力 " + Math.round(user.getMana())
                + "/" + Math.round(user.getMaxMana()) + " · 炼金等级 " + user.getSkillLevel(Skills.ALCHEMY)
                + " · 挖矿等级 " + user.getSkillLevel(Skills.MINING)
                + " · 探矿 " + ProspectingSpell.rangeFor(user.getSkillLevel(Skills.MINING),
                        hasImprintedProspectTool(p.getInventory().getItemInMainHand())) + " 格");
        if (dungeon.isBuilt()) dungeon.command(p, new String[]{"arena", "status"});
        else p.sendMessage(ChatColor.GRAY + "试炼场 " + (active ? "第 " + wave + "/3 波" : "待命"));
        guild.command(p, new String[]{"guild", "status"});
        p.sendMessage(ChatColor.GRAY + "生活法术由 MagicSpells 管冷却，战斗、探矿与探索法术由 AgentFriend 管冷却。");
    }
    private void cast(Player p, String raw) {
        if (p.getGameMode() == GameMode.SPECTATOR) { p.sendMessage(ChatColor.RED + "旁观者不能施法。"); return; }
        String id = raw.toLowerCase(Locale.ROOT);
        if (id.equals("leap") || id.equals("flight") || id.equals("golem") || id.equals("sense")) {
            utilitySpells.cast(p, id);
            return;
        }
        if (id.equals("prospect") || id.equals("探矿") || id.equals("探矿术") || id.startsWith("prospect ")) {
            prospectingSpell.cast(p, id.startsWith("prospect ") ? id.substring("prospect ".length()).trim() : "all");
            return;
        }
        if (id.equals("give") || id.equals("造物") || id.equals("造物术")) { openMenu(p, "conjure"); return; }
        if (id.startsWith("give ") || id.startsWith("造物术 ")) {
            conjure(p, id.substring(id.indexOf(' ') + 1).trim()); return;
        }
        id = switch (id) {
            case "归乡", "归乡术", "回乡", "回乡术", "回家", "茴香", "home" -> "home";
            case "闪现", "空间传送", "blink" -> "blink";
            case "治疗队友", "治疗术", "范围治疗", "群体治疗", "治愈", "治疗", "heal" -> "heal";
            case "圣愈术", "自愈", "自疗", "治疗自己", "selfheal", "heal_self" -> "selfheal";
            case "饱食", "食物", "food" -> "food";
            case "烟花", "烟花术", "fireworks" -> "fireworks";
            case "星尘", "星尘术", "starlight" -> "starlight";
            case "星芒", "星芒箭", "starbolt" -> "starbolt";
            case "霜环", "冰霜", "frostnova" -> "frostnova";
            case "焰浪", "火焰", "flamewave" -> "flamewave";
            case "羽落", "羽落术", "feather" -> "feather";
            case "夜视", "夜视术", "night" -> "night";
            default -> "";
        };
        if (id.isEmpty()) { p.sendMessage(ChatColor.RED + "没有这项技能。输入 /mycli spells 查看精确名称。"); return; }
        if (id.equals("home")) {
            UUID uuid = p.getUniqueId();
            long deadline = System.currentTimeMillis() + 10_000L;
            pendingHomeChants.put(uuid, deadline);
            Bukkit.getScheduler().runTaskLater(this,
                    () -> pendingHomeChants.remove(uuid, deadline), 200L);
            gotoPlace(p, "village");
            return;
        }
        if (id.equals("heal")) { groupHeal(p); return; }
        if (id.equals("fireworks")) { fireworks(p); return; }
        if (id.equals("starlight")) { starlight(p); return; }
        if (id.equals("feather") || id.equals("night")) { goddessSpell(p, id); return; }
        if (id.equals("starbolt") || id.equals("frostnova") || id.equals("flamewave")) {
            combatSpells.cast(p, id); return;
        }
        // Dispatch as the same player: MagicSpells retains its own permission, mana and cooldown checks.
        if (!p.performCommand("cast " + id)) p.sendMessage(ChatColor.RED + "MagicSpells 当前未受理，请联系管理员。");
    }

    private void conjure(Player p, String raw) {
        String id = switch (raw.toLowerCase(Locale.ROOT)) {
            case "bread", "面包" -> "bread";
            case "torch", "火把" -> "torch";
            case "oak_log", "橡木", "木头" -> "oak_log";
            case "cobblestone", "圆石" -> "cobblestone";
            case "crafting_table", "工作台" -> "crafting_table";
            case "chest", "箱子" -> "chest";
            case "cake", "蛋糕" -> "cake";
            case "glass", "玻璃" -> "glass";
            default -> "";
        };
        if (id.isEmpty()) {
            requestCreation(p, raw);
            return;
        }
        if (!p.performCommand("cast conjure_" + id)) p.sendMessage(ChatColor.RED + "造物术当前未受理，请联系管理员。");
    }
    private void requestCreation(Player p, String raw) {
        String wanted = raw.replaceAll("[\\p{Cntrl}\\u00a7]", " ").replaceAll("\\s+", " ").trim();
        if (wanted.isEmpty() || wanted.length() > 60) {
            p.sendMessage(ChatColor.RED + "请用 1–60 字说明想要的物品：/mycli cast give <物品>。");
            return;
        }
        if (Bukkit.getPlayerExact("Goddess") == null) {
            p.sendMessage(ChatColor.YELLOW + "女神暂未上线，造物申请没有送出；稍后再试。");
            return;
        }
        if (!ready(p, "creation-request", 60)) return;
        if (!p.performCommand("minecraft:msg Goddess [造物申请] " + wanted)) {
            p.sendMessage(ChatColor.RED + "造物申请发送失败，请稍后再试。");
            return;
        }
        p.sendMessage(ChatColor.LIGHT_PURPLE + "已把“" + wanted + "”交给女神判断；她会在游戏里答复，不会自动造出物品。");
        getLogger().info("Creation request delivered from " + p.getUniqueId() + ", chars=" + wanted.length());
    }

    private void goddessGift(CommandSender sender, String[] args) {
        if (!(sender instanceof Player goddess) || !goddess.getName().equals("Goddess")
                || !goddess.getUniqueId().equals(GODDESS_UUID) || !goddess.isOp()) {
            sender.sendMessage("仅限在线的女神服主发放造物礼物。");
            return;
        }
        if (args.length != 6 || !args[2].matches("[a-f0-9]{16}")) {
            sender.sendMessage("QDJ-GIFT INVALID FAIL format");
            return;
        }
        String nonce = args[2];
        if (!args[3].matches("[A-Za-z0-9_.-]{1,32}") || !args[4].matches("minecraft:[a-z0-9_]+")) {
            sender.sendMessage("QDJ-GIFT " + nonce + " FAIL argument");
            return;
        }
        Player target = Bukkit.getPlayerExact(args[3]);
        if (target == null || target.getGameMode() == GameMode.SPECTATOR) {
            sender.sendMessage("QDJ-GIFT " + nonce + " FAIL offline");
            return;
        }
        Material material = Material.getMaterial(args[4].substring("minecraft:".length()).toUpperCase(Locale.ROOT));
        if (material == null || !material.isItem() || FORBIDDEN_GIFTS.contains(material)
                || material.name().endsWith("_SPAWN_EGG")) {
            sender.sendMessage("QDJ-GIFT " + nonce + " FAIL item");
            return;
        }
        int amount;
        try { amount = Integer.parseInt(args[5]); }
        catch (NumberFormatException error) { sender.sendMessage("QDJ-GIFT " + nonce + " FAIL amount"); return; }
        int stackSize = material.getMaxStackSize();
        if (amount < 1 || amount > 16 || amount > stackSize) {
            sender.sendMessage("QDJ-GIFT " + nonce + " FAIL amount");
            return;
        }
        long now = System.currentTimeMillis();
        giftNonces.entrySet().removeIf(entry -> now - entry.getValue() > 86_400_000L);
        if (giftNonces.putIfAbsent(nonce, now) != null) {
            sender.sendMessage("QDJ-GIFT " + nonce + " FAIL duplicate");
            return;
        }
        int capacity = 0;
        for (ItemStack existing : target.getInventory().getStorageContents()) {
            if (existing == null || existing.getType().isAir()) capacity += stackSize;
            else if (existing.getType() == material && !existing.hasItemMeta())
                capacity += Math.max(0, stackSize - existing.getAmount());
        }
        if (capacity < amount) {
            sender.sendMessage("QDJ-GIFT " + nonce + " FAIL inventory");
            target.sendMessage(ChatColor.YELLOW + "女神想送你礼物，但背包没有空位；请先腾出空间再申请。");
            return;
        }
        if (!target.getInventory().addItem(new ItemStack(material, amount)).isEmpty()) {
            sender.sendMessage("QDJ-GIFT " + nonce + " FAIL inventory-changed");
            getLogger().severe("Goddess gift partially applied to " + target.getUniqueId() + "; do not retry blindly");
            return;
        }
        target.sendMessage(ChatColor.LIGHT_PURPLE + "女神批准了造物申请：" + material.name().toLowerCase(Locale.ROOT)
                + " ×" + amount + " 已放进你的背包。");
        sender.sendMessage("QDJ-GIFT " + nonce + " OK");
        getLogger().info("Goddess gift " + material + " x" + amount + " to " + target.getUniqueId());
    }
    private void fireworks(Player p) {
        long now = System.currentTimeMillis();
        long ready = fireworksCooldown.getOrDefault(p.getUniqueId(), 0L);
        if (now < ready) { p.sendMessage(ChatColor.RED + "烟花术还需 " + ((ready - now + 999) / 1000) + " 秒。"); return; }
        if (!spendMana(p, 1)) return;
        fireworksCooldown.put(p.getUniqueId(), now + FIREWORKS_COOLDOWN_MS);
        Location at = p.getLocation().add(0, 2, 0);
        p.getWorld().spawnParticle(Particle.END_ROD, at, 45, 0.7, 0.7, 0.7, 0.08);
        p.getWorld().playSound(at, Sound.ENTITY_FIREWORK_ROCKET_BLAST, 0.7f, 1.4f);
        presentSpell(p, "fireworks");
        publishSkill(p, "fireworks", "光芒绽放", at);
        p.sendMessage(ChatColor.LIGHT_PURPLE + "烟花术释放了光芒。");
    }

    private boolean ready(Player p, String id, long seconds) {
        long now = System.currentTimeMillis();
        String key = p.getUniqueId() + ":" + id;
        long until = goddessCooldown.getOrDefault(key, 0L);
        if (now < until) {
            p.sendMessage(ChatColor.RED + "此技能还需 " + ((until - now + 999) / 1000) + " 秒。");
            return false;
        }
        goddessCooldown.put(key, now + seconds * 1000);
        return true;
    }

    private void starlight(Player p) {
        long now = System.currentTimeMillis();
        String key = p.getUniqueId() + ":starlight";
        long until = goddessCooldown.getOrDefault(key, 0L);
        if (now < until) { p.sendMessage(ChatColor.RED + "此技能还需 " + ((until - now + 999) / 1000) + " 秒。"); return; }
        if (!spendMana(p, 1)) return;
        goddessCooldown.put(key, now + STARLIGHT_COOLDOWN_MS);
        Location at = p.getLocation().add(0, 1.4, 0);
        p.getWorld().spawnParticle(Particle.END_ROD, at, 36, 0.8, 0.7, 0.8, 0.02);
        p.getWorld().playSound(at, Sound.BLOCK_AMETHYST_BLOCK_CHIME, 0.8f, 1.4f);
        presentSpell(p, "starlight");
        publishSkill(p, "starlight", "星光环绕", at);
        p.sendMessage(ChatColor.LIGHT_PURPLE + "星尘术：一束星光环绕着你。");
    }

    private boolean learned(Player p, NamespacedKey key) {
        return p.getPersistentDataContainer().has(key, PersistentDataType.BYTE);
    }

    private String learned(Player p, NamespacedKey key, String yes, String no) {
        return learned(p, key) ? yes : no;
    }

    private String learnedLabel(Player p, NamespacedKey key) {
        return learned(p, key, "已学", "未学");
    }

    private NamespacedKey skillKey(String id) {
        return id.equals("feather") ? featherKey : id.equals("night") ? nightKey : null;
    }

    private boolean learnSkill(Player p, String id) {
        NamespacedKey key = skillKey(id);
        if (key == null) { p.sendMessage(ChatColor.RED + "只能学习 feather 或 night。"); return false; }
        if (learned(p, key)) { p.sendMessage(ChatColor.YELLOW + "你已经学会了。"); return false; }
        SkillsUser user = skillsUser(p);
        boolean alchemyUnlock = user != null && user.getSkillLevel(Skills.ALCHEMY) >= 2;
        if (!alchemyUnlock && p.getLevel() < 5) {
            p.sendMessage(ChatColor.RED + "需要原版经验 5 级，或炼金等级 2；首次通关试炼也会自动学会。");
            return false;
        }
        if (!alchemyUnlock) p.setLevel(p.getLevel() - 5);
        p.getPersistentDataContainer().set(key, PersistentDataType.BYTE, (byte) 1);
        p.sendMessage(ChatColor.GREEN + "已学会 " + (id.equals("feather") ? "羽落" : "夜视")
                + (alchemyUnlock ? "（炼金等级奖励）" : "（已消耗原版经验 5 级）")
                + "；再次点击罗盘中的图标即可咏唱。");
        return true;
    }

    private void castOrLearn(Player p, String id) {
        if (learned(p, skillKey(id))) cast(p, id);
        else if (learnSkill(p, id)) openMenu(p, "skills");
    }

    private void goddessSpell(Player p, String id) {
        NamespacedKey key = skillKey(id);
        if (key == null || !learned(p, key)) {
            p.sendMessage(ChatColor.RED + "还没学会这项女神技艺；输入 /mycli goddess skills。");
            return;
        }
        long now = System.currentTimeMillis();
        String cooldownKey = p.getUniqueId() + ":" + id;
        long until = goddessCooldown.getOrDefault(cooldownKey, 0L);
        if (now < until) { p.sendMessage(ChatColor.RED + "此技能还需 " + ((until - now + 999) / 1000) + " 秒。"); return; }
        if (!spendMana(p, 2)) return;
        goddessCooldown.put(cooldownKey, now + totalBuiltinCooldownMs(id));
        if (id.equals("feather")) {
            p.addPotionEffect(new PotionEffect(PotionEffectType.SLOW_FALLING, 45 * 20, 0, true, true, true));
            p.sendMessage(ChatColor.AQUA + "羽落术生效 45 秒，脚步会变得轻盈。");
        } else {
            p.addPotionEffect(new PotionEffect(PotionEffectType.NIGHT_VISION, 120 * 20, 0, true, true, true));
            p.sendMessage(ChatColor.AQUA + "夜视术生效 120 秒，黑暗里也能看清道路。");
        }
        presentSpell(p, id);
        publishSkill(p, id, "生效", p.getLocation());
    }

    private void goddess(Player p, String[] args) {
        String sub = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "skills";
        if (sub.equals("skills") || sub.equals("技能")) { spells(p); return; }
        if (sub.equals("learn") || sub.equals("学习")) {
            if (args.length != 3) { p.sendMessage(ChatColor.RED + "用法：/mycli goddess learn feather|night"); return; }
            String id = args[2].toLowerCase(Locale.ROOT);
            id = switch (id) { case "羽落" -> "feather"; case "夜视" -> "night"; default -> id; };
            learnSkill(p, id);
            return;
        }
        if (sub.equals("pray") || sub.equals("祈愿")) {
            String wish = tail(args, 2).replaceAll("[\\p{Cntrl}\\u00a7]", " ").trim();
            if (wish.isEmpty() || wish.length() > 100) { p.sendMessage(ChatColor.RED + "祈愿需要 1–100 字；/mycli goddess pray <话>。"); return; }
            Player agent = Bukkit.getPlayerExact("Goddess");
            if (agent == null) { p.sendMessage(ChatColor.YELLOW + "女神暂未上线，祈愿没有送出；可以先用 /mycli goddess skills。"); return; }
            if (!ready(p, "pray", 30)) return;
            // Vanilla /msg creates the whisper event consumed by Cortico's Minecraft World.
            // The sender is the real player, so the bot can answer that player directly.
            if (!p.performCommand("minecraft:msg Goddess [祈愿] " + wish)) {
                p.sendMessage(ChatColor.RED + "祈愿发送失败，请稍后再试。");
                return;
            }
            p.sendMessage(ChatColor.LIGHT_PURPLE + "祈愿已送达女神；她会在游戏内回应。");
            getLogger().info("Prayer delivered from " + p.getUniqueId() + " to Goddess");
            if (guild != null) guild.onPrayer(p);
            return;
        }
        p.sendMessage(ChatColor.RED + "用法：/mycli goddess skills|learn feather|night|pray <话>");
    }
    private void gotoPlace(Player p, String raw) {
        String id = raw.toLowerCase(Locale.ROOT);
        if (id.equals("guild") || id.equals("公会") || id.equals("工会")) {
            guildHall.teleport(p);
            return;
        }
        if (id.equals("arena") || id.equals("试炼场")) {
            if (!arenaBuilt) { p.sendMessage(ChatColor.RED + "试炼场尚未建成。"); return; }
            Location landing = new Location(world(), X + 0.5, FLOOR + 1.0, Z - 17 + 0.5, 0, 0);
            if (landing.getBlock().getType() != Material.AIR || landing.clone().add(0, 1, 0).getBlock().getType() != Material.AIR) {
                p.sendMessage(ChatColor.RED + "试炼场入口受阻，传送已取消。"); return;
            }
            if (p.teleport(landing)) p.sendMessage(ChatColor.GREEN + "已到试炼场入口；按石按钮选难度，再点菜单里的「开始」。 "
                    + LocationOutput.fields(landing));
            else p.sendMessage(ChatColor.RED + "传送被其他保护规则取消。");
            return;
        }
        if (PUBLIC_PLACES.stream().anyMatch(place -> place.id().equals(id))) {
            if (!p.performCommand("warp " + id)) p.sendMessage(ChatColor.RED + "公共传送点不可用。");
            else {
                Location destination = publicWarp(id);
                if (destination != null) p.sendMessage("MC_DESTINATION id=" + id + " " + LocationOutput.fields(destination));
            }
            return;
        }
        if (id.startsWith("personal:")) {
            String name = raw.substring("personal:".length());
            if (!name.matches("[A-Za-z0-9_-]{1,24}")) { p.sendMessage(ChatColor.RED + "私人传送点名只用英文、数字、_、-，最长 24 字符。"); return; }
            if (!p.performCommand("home " + name)) p.sendMessage(ChatColor.RED + "私人传送点不可用。");
            else {
                Location destination = personalHome(p, name);
                if (destination != null) p.sendMessage("MC_DESTINATION id=personal:" + name + " "
                        + LocationOutput.fields(destination));
            }
            return;
        }
        p.sendMessage(ChatColor.RED + "未知地点。输入 /mycli help。重名地点不会自动选择。");
    }
    private void waypoint(Player p, String[] args) {
        if (args.length == 1) {
            p.performCommand("homes");
            p.sendMessage("公共地点：" + String.join("、", PUBLIC_PLACES.stream().map(PublicPlace::id).toList()) + "、arena");
            p.sendMessage("MC_WAYPOINT id=arena " + LocationOutput.fields(
                    new Location(world(), X + 0.5, FLOOR + 1, Z - 17 + 0.5)));
            for (PublicPlace place : PUBLIC_PLACES) {
                Location at = publicWarp(place.id());
                if (at != null) p.sendMessage("MC_WAYPOINT id=" + place.id() + " " + LocationOutput.fields(at));
            }
            if (essentials() != null) {
                Essentials essentials = essentials();
                User user = essentials.getUser(p);
                if (user != null) for (String name : user.getHomes()) {
                    if (!name.matches("[A-Za-z0-9_-]{1,24}")) continue;
                    Location at = user.getHome(name);
                    if (at != null) p.sendMessage("MC_WAYPOINT id=personal:" + name + " " + LocationOutput.fields(at));
                }
            }
            return;
        }
        if (args.length != 3 || !args[2].matches("[A-Za-z0-9_-]{1,24}")) {
            p.sendMessage(ChatColor.RED + "用法：/mycli waypoint add|remove <英文名字>"); return;
        }
        String op = args[1].toLowerCase(Locale.ROOT);
        if (op.equals("add")) {
            if (p.performCommand("sethome " + args[2])) {
                Location at = personalHome(p, args[2]);
                if (at != null) p.sendMessage("MC_WAYPOINT id=personal:" + args[2] + " " + LocationOutput.fields(at));
            }
        }
        else if (op.equals("remove")) p.performCommand("delhome " + args[2]);
        else p.sendMessage(ChatColor.RED + "用法：/mycli waypoint add|remove <英文名字>");
    }

    private void groupHeal(Player caster) {
        if (caster.getGameMode() == GameMode.SPECTATOR || caster.isDead()) {
            caster.sendMessage(ChatColor.RED + "旁观者或倒下的玩家不能施法。");
            return;
        }
        long now = System.currentTimeMillis();
        String key = caster.getUniqueId() + ":heal";
        long until = goddessCooldown.getOrDefault(key, 0L);
        if (now < until) {
            caster.sendMessage(ChatColor.RED + "范围治疗还需 " + ((until - now + 999) / 1000) + " 秒。");
            return;
        }
        List<Player> wounded = new ArrayList<>();
        if (caster.getHealth() < caster.getMaxHealth()) wounded.add(caster);
        for (Entity entity : caster.getNearbyEntities(8.0, 8.0, 8.0)) {
            if (entity instanceof Player player && !player.isDead()
                    && player.getGameMode() != GameMode.SPECTATOR
                    && caster.getLocation().distanceSquared(player.getLocation()) <= 64.0
                    && player.getHealth() < player.getMaxHealth()) wounded.add(player);
        }
        if (wounded.isEmpty()) {
            caster.sendMessage(ChatColor.YELLOW + "8 格内没有需要治疗的玩家；未消耗魔力或冷却。");
            return;
        }
        if (!spendMana(caster, 6)) return;
        goddessCooldown.put(key, now + GROUP_HEAL_COOLDOWN_MS);
        for (Player player : wounded) {
            player.setHealth(Math.min(player.getMaxHealth(), player.getHealth() + 6.0));
            player.getWorld().spawnParticle(Particle.HEART, player.getLocation().add(0, 1.4, 0),
                    8, 0.45, 0.5, 0.45, 0.01);
        }
        presentSpell(caster, "heal");
        publishSkill(caster, "heal", "治疗 " + wounded.size() + " 人", caster.getLocation());
        caster.sendMessage(ChatColor.GREEN + "范围治疗：8 格内 " + wounded.size() + " 名受伤玩家恢复最多 3 颗心。");
    }

    private Essentials essentials() {
        Plugin installed = Bukkit.getPluginManager().getPlugin("Essentials");
        return installed instanceof Essentials essentials ? essentials : null;
    }

    private Location publicWarp(String id) {
        Essentials essentials = essentials();
        if (essentials == null) return null;
        try {
            Warps warps = essentials.getWarps();
            return warps.getWarp(id);
        } catch (Exception missing) {
            getLogger().fine("Warp unavailable: " + id);
            return null;
        }
    }

    private Location personalHome(Player player, String name) {
        Essentials essentials = essentials();
        if (essentials == null) return null;
        User user = essentials.getUser(player);
        return user != null && user.hasHome(name) ? user.getHome(name) : null;
    }

    private static String worldLabel(World world) {
        return switch (world.getEnvironment()) {
            case NORMAL -> "主世界";
            case NETHER -> "下界";
            case THE_END -> "末地";
            default -> world.getName();
        };
    }

    private List<Player> trackablePlayers(Player viewer) {
        return Bukkit.getOnlinePlayers().stream()
                .map(target -> (Player) target)
                .filter(target -> !target.getUniqueId().equals(viewer.getUniqueId()))
                .filter(target -> target.getGameMode() != GameMode.SPECTATOR)
                .filter(target -> !target.getName().equals("Goddess") && viewer.canSee(target))
                .sorted(Comparator.comparing(Player::getName, String.CASE_INSENSITIVE_ORDER))
                .toList();
    }

    private void locate(Player viewer, String[] args) {
        if (args.length == 1) { openMenu(viewer, "players"); return; }
        if (args.length == 3 && (args[1].equalsIgnoreCase("tp") || args[1].equals("传送"))) {
            if (args[2].equalsIgnoreCase("nearest")) { teleportNearest(viewer); return; }
            trackablePlayers(viewer).stream().filter(target -> target.getName().equalsIgnoreCase(args[2]))
                    .findFirst().ifPresentOrElse(target -> teleportToTeammate(viewer, target.getUniqueId()),
                            () -> viewer.sendMessage(ChatColor.RED + "队友不在线或不可传送：" + args[2]));
            return;
        }
        if (args.length != 2) {
            viewer.sendMessage(ChatColor.RED + "用法：/mycli locate [list|nearest|玩家名|off|tp <玩家名|nearest>]"); return;
        }
        String choice = args[1];
        if (choice.equalsIgnoreCase("off")) { stopTracking(viewer); return; }
        if (choice.equalsIgnoreCase("nearest")) { trackNearest(viewer); return; }
        List<Player> visible = trackablePlayers(viewer);
        if (choice.equalsIgnoreCase("list")) {
            if (visible.isEmpty()) { viewer.sendMessage(ChatColor.GRAY + "当前没有可定位的在线队友。"); return; }
            viewer.sendMessage(ChatColor.AQUA + "在线队友：");
            for (Player target : visible) {
                Location at = target.getLocation();
                viewer.sendMessage(ChatColor.YELLOW + target.getName() + ChatColor.GRAY + " · "
                        + worldLabel(target.getWorld()) + " " + at.getBlockX() + ", "
                        + at.getBlockY() + ", " + at.getBlockZ());
                viewer.sendMessage("MC_PLAYER name=" + target.getName() + " " + LocationOutput.fields(at));
            }
            return;
        }
        visible.stream().filter(target -> target.getName().equalsIgnoreCase(choice)).findFirst()
                .ifPresentOrElse(target -> trackPlayer(viewer, target.getUniqueId()),
                        () -> viewer.sendMessage(ChatColor.RED + "没有找到可定位的在线玩家：" + choice));
    }

    private void trackNearest(Player viewer) {
        trackablePlayers(viewer).stream()
                .filter(target -> target.getWorld().equals(viewer.getWorld()))
                .min(Comparator.comparingDouble(target -> target.getLocation().distanceSquared(viewer.getLocation())))
                .ifPresentOrElse(target -> trackPlayer(viewer, target.getUniqueId()),
                        () -> viewer.sendMessage(ChatColor.YELLOW + "当前世界没有可定位的在线队友。"));
    }

    private void teleportNearest(Player viewer) {
        trackablePlayers(viewer).stream()
                .filter(target -> target.getWorld().equals(viewer.getWorld()))
                .min(Comparator.comparingDouble(target -> target.getLocation().distanceSquared(viewer.getLocation())))
                .ifPresentOrElse(target -> teleportToTeammate(viewer, target.getUniqueId()),
                        () -> viewer.sendMessage(ChatColor.YELLOW + "当前世界没有可传送的在线队友。"));
    }

    private static boolean safeLanding(Block feet) {
        Block head = feet.getRelative(0, 1, 0), floor = feet.getRelative(0, -1, 0);
        if (!feet.isPassable() || !head.isPassable() || feet.isLiquid() || head.isLiquid()
                || !floor.getType().isSolid()) return false;
        return switch (floor.getType()) {
            case MAGMA_BLOCK, CAMPFIRE, SOUL_CAMPFIRE, CACTUS -> false;
            default -> !landingHazard(feet.getType()) && !landingHazard(head.getType());
        };
    }

    private static boolean landingHazard(Material type) {
        return switch (type) {
            case FIRE, SOUL_FIRE, POWDER_SNOW, SWEET_BERRY_BUSH, WITHER_ROSE, NETHER_PORTAL,
                    END_PORTAL, END_GATEWAY, COBWEB, POINTED_DRIPSTONE -> true;
            default -> false;
        };
    }

    private Location safeNear(Player target) {
        Location at = target.getLocation();
        int[][] offsets = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {-1, 1}, {1, -1}, {-1, -1},
                {2, 0}, {-2, 0}, {0, 2}, {0, -2}, {0, 0}};
        for (int dy : new int[]{0, 1, -1, 2, -2}) for (int[] offset : offsets) {
            int x = at.getBlockX() + offset[0], y = at.getBlockY() + dy, z = at.getBlockZ() + offset[1];
            if (y < at.getWorld().getMinHeight() + 1 || y > at.getWorld().getMaxHeight() - 2) continue;
            Block feet = at.getWorld().getBlockAt(x, y, z);
            if (safeLanding(feet)) return new Location(at.getWorld(), x + 0.5, y, z + 0.5, at.getYaw(), 0);
        }
        return null;
    }

    private void teleportToTeammate(Player viewer, UUID targetId) {
        Player target = Bukkit.getPlayer(targetId);
        if (target == null || !trackablePlayers(viewer).contains(target)) {
            viewer.sendMessage(ChatColor.RED + "队友已离线或不可传送，请重新打开罗盘。"); return;
        }
        long now = System.currentTimeMillis();
        long wait = teamTeleportAt.getOrDefault(viewer.getUniqueId(), 0L) + TEAM_TELEPORT_COOLDOWN_MS - now;
        if (wait > 0) {
            viewer.sendMessage(ChatColor.YELLOW + "传送冷却还剩 " + ((wait + 999) / 1000) + " 秒。"); return;
        }
        Location landing = safeNear(target);
        if (landing == null) {
            viewer.sendMessage(ChatColor.YELLOW + "队友附近没有安全落脚点，请等她走到平地再试。"); return;
        }
        teamTeleportAt.put(viewer.getUniqueId(), now);
        viewer.teleportAsync(landing).whenComplete((success, error) -> Bukkit.getScheduler().runTask(this, () -> {
            if (!viewer.isOnline()) return;
            if (error != null || !success) {
                teamTeleportAt.remove(viewer.getUniqueId());
                viewer.sendMessage(ChatColor.RED + "传送失败；请稍后再试。");
            } else viewer.sendMessage(ChatColor.GREEN + "已安全抵达 " + target.getName() + " 身边。 "
                    + LocationOutput.fields(viewer.getLocation()));
        }));
    }

    private void trackPlayer(Player viewer, UUID targetId) {
        Player target = Bukkit.getPlayer(targetId);
        if (target == null || !trackablePlayers(viewer).contains(target)) {
            viewer.sendMessage(ChatColor.YELLOW + "队友已离线或暂时不可定位，请重新打开罗盘。");
            return;
        }
        trackedPlayers.put(viewer.getUniqueId(), targetId);
        automaticCompassTargets.remove(viewer.getUniqueId());
        compassAutoPaused.remove(viewer.getUniqueId());
        ensureTrackingBar(viewer);
        viewer.sendMessage(ChatColor.GREEN + "正在追踪 " + target.getName()
                + "；手持技能罗盘时指针会指向她。罗盘菜单中可停止追踪。");
        viewer.sendMessage("MC_PLAYER name=" + target.getName() + " " + LocationOutput.fields(target.getLocation()));
        showTracking(viewer, target);
        syncCompass(viewer, target.getLocation());
    }

    private void ensureTrackingBar(Player viewer) {
        trackingBars.computeIfAbsent(viewer.getUniqueId(), ignored -> {
            BossBar bar = Bukkit.createBossBar("找队友", BarColor.BLUE, BarStyle.SOLID);
            bar.setProgress(1.0);
            bar.addPlayer(viewer);
            return bar;
        });
    }

    private void removeTrackingBar(UUID viewerId) {
        BossBar bar = trackingBars.remove(viewerId);
        if (bar != null) bar.removeAll();
    }

    private void stopTracking(Player viewer) {
        trackedPlayers.remove(viewer.getUniqueId());
        automaticCompassTargets.remove(viewer.getUniqueId());
        compassAutoPaused.add(viewer.getUniqueId());
        removeTrackingBar(viewer.getUniqueId());
        restoreCompass(viewer);
        viewer.sendMessage(ChatColor.GRAY + "已停止追踪队友。");
    }

    private void tickPlayerTracking() {
        for (Map.Entry<UUID, UUID> tracking : new HashMap<>(trackedPlayers).entrySet()) {
            Player viewer = Bukkit.getPlayer(tracking.getKey());
            if (viewer == null) {
                trackedPlayers.remove(tracking.getKey());
                removeTrackingBar(tracking.getKey());
                continue;
            }
            Player target = Bukkit.getPlayer(tracking.getValue());
            if (target == null || !trackablePlayers(viewer).contains(target)) {
                trackedPlayers.remove(tracking.getKey());
                removeTrackingBar(tracking.getKey());
                viewer.sendMessage(ChatColor.YELLOW + "追踪已结束：队友离线或暂时不可定位。");
                continue;
            }
            showTracking(viewer, target);
        }
        tickCompassTargets();
    }

    private void syncCompass(Player viewer, Location target) {
        if (target.getWorld() == null || !target.getWorld().equals(viewer.getWorld())) {
            restoreCompass(viewer);
            return;
        }
        UUID id = viewer.getUniqueId();
        savedCompassTargets.putIfAbsent(id, viewer.getCompassTarget().clone());
        Location current = viewer.getCompassTarget();
        if (!current.getWorld().equals(target.getWorld()) || current.getBlockX() != target.getBlockX()
                || current.getBlockY() != target.getBlockY() || current.getBlockZ() != target.getBlockZ()) {
            viewer.setCompassTarget(target);
        }
    }

    private void restoreCompass(Player viewer) {
        Location old = savedCompassTargets.remove(viewer.getUniqueId());
        if (old != null && old.getWorld() != null) viewer.setCompassTarget(old);
    }

    private void tickCompassTargets() {
        for (Player viewer : Bukkit.getOnlinePlayers()) {
            UUID id = viewer.getUniqueId();
            UUID selected = trackedPlayers.get(id);
            if (selected != null) {
                Player target = Bukkit.getPlayer(selected);
                if (target != null && target.getWorld().equals(viewer.getWorld())) syncCompass(viewer, target.getLocation());
                else restoreCompass(viewer);
                continue;
            }
            if (!isCompass(viewer.getInventory().getItemInMainHand())) {
                if (automaticCompassTargets.remove(id) != null) removeTrackingBar(id);
                compassAutoPaused.remove(id);
                restoreCompass(viewer);
                continue;
            }
            if (compassAutoPaused.contains(id)) continue;
            Player nearest = trackablePlayers(viewer).stream()
                    .filter(target -> target.getWorld().equals(viewer.getWorld()))
                    .min(Comparator.comparingDouble(target -> target.getLocation().distanceSquared(viewer.getLocation())))
                    .orElse(null);
            if (nearest == null) {
                if (automaticCompassTargets.remove(id) != null) removeTrackingBar(id);
                restoreCompass(viewer);
                continue;
            }
            automaticCompassTargets.put(id, nearest.getUniqueId());
            ensureTrackingBar(viewer);
            showTracking(viewer, nearest);
            syncCompass(viewer, nearest.getLocation());
        }
    }

    private void showTracking(Player viewer, Player target) {
        Location here = viewer.getLocation(), there = target.getLocation();
        BossBar bar = trackingBars.get(viewer.getUniqueId());
        if (bar == null) return;
        if (!here.getWorld().equals(there.getWorld())) {
            bar.setTitle("§b追踪 " + target.getName() + " §7· " + worldLabel(there.getWorld())
                    + "（不同维度） · " + LocationOutput.shortForm(there));
            return;
        }
        double dx = there.getX() - here.getX(), dz = there.getZ() - here.getZ();
        int distance = (int) Math.round(here.distance(there));
        int height = there.getBlockY() - here.getBlockY();
        String vertical = Math.abs(height) <= 2 ? "同一高度" : (height > 0 ? "高 " + height + " 格" : "低 " + -height + " 格");
        bar.setTitle("§b追踪 " + target.getName() + " §e" + direction(here.getYaw(), dx, dz)
                + " " + distance + " 格 §7· " + vertical + " · " + LocationOutput.shortForm(there));
    }

    private static String direction(float yaw, double dx, double dz) {
        if (dx * dx + dz * dz < 9) return "●";
        double targetYaw = Math.toDegrees(Math.atan2(-dx, dz));
        double relative = ((targetYaw - yaw + 540) % 360) - 180;
        if (relative >= -22.5 && relative < 22.5) return "↑";
        if (relative >= 22.5 && relative < 67.5) return "↖";
        if (relative >= 67.5 && relative < 112.5) return "←";
        if (relative >= 112.5 && relative < 157.5) return "↙";
        if (relative >= -67.5 && relative < -22.5) return "↗";
        if (relative >= -112.5 && relative < -67.5) return "→";
        if (relative >= -157.5 && relative < -112.5) return "↘";
        return "↓";
    }
    private void arenaCommand(Player p, String[] args) {
        String sub = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "status";
        switch (sub) {
            case "status" -> p.sendMessage(ChatColor.GOLD + "试炼场 " + (active ? "第 " + wave + "/3 波" : "待命")
                    + "，坐标 " + LocationOutput.fields(new Location(world(), X, FLOOR, Z))
                    + "。/mycli goto arena 前往。");
            case "start" -> startArena(p);
            case "leave" -> {
                if (!inside(p.getLocation())) { p.sendMessage("你目前不在试炼场内。"); return; }
                gotoPlace(p, "arena");
            }
            default -> p.sendMessage(ChatColor.RED + "用法：/mycli arena start|status|leave");
        }
    }

    private boolean isFocus(ItemStack stack) {
        return stack != null && stack.getType() == Material.BLAZE_ROD && stack.hasItemMeta()
                && stack.getItemMeta().getPersistentDataContainer().has(focusKey, PersistentDataType.BYTE);
    }
    private boolean imprintable(ItemStack stack) {
        if (stack == null || stack.getType().isAir() || stack.getAmount() != 1 || isFocus(stack)) return false;
        String type = stack.getType().name();
        return type.endsWith("_PICKAXE") || type.endsWith("_AXE") || type.endsWith("_SHOVEL")
                || type.endsWith("_HOE") || type.endsWith("_SWORD")
                || Set.of(Material.SPYGLASS, Material.COMPASS, Material.BOW, Material.CROSSBOW,
                        Material.TRIDENT, Material.SHIELD, Material.FISHING_ROD, Material.BRUSH).contains(stack.getType());
    }
    private String imprintedSpell(ItemStack stack) {
        if (stack == null || !stack.hasItemMeta()) return null;
        String id = stack.getItemMeta().getPersistentDataContainer().get(imprintSpellKey, PersistentDataType.STRING);
        return id != null && FOCUS_SPELLS.stream().anyMatch(spell -> spell.id().equals(id)) ? id : null;
    }
    private boolean nearEnchantingTable(Player player) {
        Location at = player.getLocation();
        World world = player.getWorld();
        for (int dx = -4; dx <= 4; dx++) for (int dy = -4; dy <= 4; dy++) for (int dz = -4; dz <= 4; dz++) {
            if (dx * dx + dy * dy + dz * dz > 16) continue;
            if (world.getBlockAt(at.getBlockX() + dx, at.getBlockY() + dy, at.getBlockZ() + dz)
                    .getType() == Material.ENCHANTING_TABLE) return true;
        }
        return false;
    }
    private void imprintCommand(Player player, String[] args) {
        if (args.length >= 2 && args[1].equalsIgnoreCase("list")) {
            listFocus(player);
            player.sendMessage(ChatColor.GRAY + "在附魔台 4 格内手持工具，用 /mycli imprint <技能ID> 刻印。每次需 3 经验等级和 1 青金石。");
            return;
        }
        if (args.length >= 2) imprint(player, tail(args, 1).toLowerCase(Locale.ROOT));
        else openImprintMenu(player);
    }
    private void openImprintMenu(Player player) {
        if (!imprintable(player.getInventory().getItemInMainHand())) {
            player.sendMessage(ChatColor.RED + "请先手持一把镐、剑或其他可刻印的工具。"); return;
        }
        if (!nearEnchantingTable(player)) {
            player.sendMessage(ChatColor.RED + "要在附魔台 4 格内刻印法术。"); return;
        }
        openMenu(player, "imprint");
    }
    private void imprint(Player player, String id) {
        FocusSpell spell = FOCUS_SPELLS.stream().filter(entry -> entry.id().equals(id)).findFirst().orElse(null);
        if (spell == null) { player.sendMessage(ChatColor.RED + "没有这个可刻印法术；/mycli imprint list 查看 ID。"); return; }
        if (player.getGameMode() == GameMode.SPECTATOR) { player.sendMessage(ChatColor.RED + "旁观者不能刻印。"); return; }
        ItemStack stack = player.getInventory().getItemInMainHand();
        if (!imprintable(stack)) { player.sendMessage(ChatColor.RED + "这件物品不能刻印；请手持镐、剑、工具或望远镜。"); return; }
        if (!nearEnchantingTable(player)) { player.sendMessage(ChatColor.RED + "要在附魔台 4 格内刻印法术。"); return; }
        if (id.equals(imprintedSpell(stack))) { player.sendMessage(ChatColor.YELLOW + "这件物品已经刻印了 " + ChatColor.stripColor(spell.title()) + "。"); return; }
        boolean creative = player.getGameMode() == GameMode.CREATIVE;
        if (!creative && (player.getLevel() < 3 || !player.getInventory().contains(Material.LAPIS_LAZULI, 1))) {
            player.sendMessage(ChatColor.RED + "刻印需要 3 经验等级和 1 青金石；普通附魔不受影响。"); return;
        }
        if (!creative) {
            player.setLevel(player.getLevel() - 3);
            player.getInventory().removeItem(new ItemStack(Material.LAPIS_LAZULI, 1));
        }
        ItemMeta meta = stack.getItemMeta();
        List<String> lore = meta.hasLore() ? new ArrayList<>(meta.getLore()) : new ArrayList<>();
        lore.removeIf(line -> line.startsWith("§5✦ 法术刻印：") || line.startsWith("§7潜行使用：施放刻印法术"));
        lore.add("§5✦ 法术刻印：" + ChatColor.stripColor(spell.title()));
        lore.add("§7潜行使用：施放刻印法术");
        meta.setLore(lore);
        meta.getPersistentDataContainer().set(imprintSpellKey, PersistentDataType.STRING, id);
        meta.setEnchantmentGlintOverride(true);
        stack.setItemMeta(meta);
        player.getInventory().setItemInMainHand(stack);
        player.playSound(player.getLocation(), Sound.BLOCK_ENCHANTMENT_TABLE_USE, 0.8f, 1.2f);
        player.spawnParticle(Particle.ENCHANT, player.getLocation().add(0, 1, 0), 30, 0.5, 0.5, 0.5, 0.3);
        player.sendMessage(ChatColor.LIGHT_PURPLE + "✦ 已给手持物品刻印 " + ChatColor.stripColor(spell.title())
                + "。潜行使用即可施放；仍消耗原法术的魔力并遵守冷却。");
    }
    private boolean hasFocus(Player p) {
        for (ItemStack stack : p.getInventory().getContents()) if (isFocus(stack)) return true;
        return false;
    }
    private FocusSpell focusSpell(ItemStack stack) {
        if (!isFocus(stack)) return null;
        String id = stack.getItemMeta().getPersistentDataContainer().get(focusSpellKey, PersistentDataType.STRING);
        return FOCUS_SPELLS.stream().filter(spell -> spell.id().equals(id)).findFirst().orElse(null);
    }
    private ItemStack focusItem(FocusSpell spell) {
        ItemStack stack = item(Material.BLAZE_ROD, "§d✦ 灵纹法杖 · " + ChatColor.stripColor(spell.title()),
                "手持使用：立即施放", "潜行并使用：切换技能", "消耗和冷却仍按技能本身计算");
        ItemMeta meta = stack.getItemMeta();
        meta.getPersistentDataContainer().set(focusKey, PersistentDataType.BYTE, (byte) 1);
        meta.getPersistentDataContainer().set(focusSpellKey, PersistentDataType.STRING, spell.id());
        stack.setItemMeta(meta);
        return stack;
    }
    private void giveFocus(Player p) {
        if (hasFocus(p)) { p.sendMessage(ChatColor.YELLOW + "灵纹法杖已在背包；手持潜行使用可切换技能。"); return; }
        Map<Integer, ItemStack> extra = p.getInventory().addItem(focusItem(FOCUS_SPELLS.get(0)));
        if (extra.isEmpty()) p.sendMessage(ChatColor.LIGHT_PURPLE + "已领取灵纹法杖。拿在手上按使用键立即探矿；潜行使用可换技能。");
        else p.sendMessage(ChatColor.RED + "背包已满；腾出一格后输入 /mycli focus give 领取法杖。");
    }
    private void bindFocus(Player p, String id) {
        FocusSpell spell = FOCUS_SPELLS.stream().filter(entry -> entry.id().equals(id)).findFirst().orElse(null);
        if (spell == null) { p.sendMessage(ChatColor.RED + "没有这个可绑定技能；使用 /mycli focus list 查看 ID。"); return; }
        ItemStack[] storage = p.getInventory().getStorageContents();
        for (int slot = 0; slot < storage.length; slot++) {
            if (!isFocus(storage[slot])) continue;
            p.getInventory().setItem(slot, focusItem(spell));
            p.sendMessage(ChatColor.LIGHT_PURPLE + "法杖已绑定 " + ChatColor.stripColor(spell.title()) + "；手持按使用键施放。");
            return;
        }
        p.sendMessage(ChatColor.RED + "背包中没有灵纹法杖；先用 /mycli focus give 领取。");
    }
    private void listFocus(Player p) {
        p.sendMessage(ChatColor.LIGHT_PURPLE + "可绑定的法杖技能 ID（均可用于 /mycli focus bind <ID>）：");
        for (int start = 0; start < FOCUS_SPELLS.size(); start += 8) {
            String ids = FOCUS_SPELLS.subList(start, Math.min(start + 8, FOCUS_SPELLS.size()))
                    .stream().map(FocusSpell::id).collect(java.util.stream.Collectors.joining(", "));
            p.sendMessage(ChatColor.GRAY + ids);
        }
    }
    private void focusCommand(Player p, String[] args) {
        if (args.length == 1) {
            if (hasFocus(p)) openMenu(p, "focus");
            else giveFocus(p);
            return;
        }
        switch (args[1].toLowerCase(Locale.ROOT)) {
            case "give", "领取" -> giveFocus(p);
            case "list", "列表" -> listFocus(p);
            case "menu", "选择" -> { if (hasFocus(p)) openMenu(p, "focus"); else giveFocus(p); }
            case "bind", "绑定" -> bindFocus(p, tail(args, 2).toLowerCase(Locale.ROOT));
            default -> p.sendMessage(ChatColor.RED + "用法：/mycli focus give|list|menu|bind <技能ID>。");
        }
    }
    private void giveCompass(Player p) {
        for (ItemStack stack : p.getInventory().getContents()) if (isCompass(stack)) {
            p.sendMessage(ChatColor.YELLOW + "技能罗盘已经在背包里；也可随时用 /mycli menu。"); return;
        }
        ItemStack stack = item(Material.COMPASS, ChatColor.LIGHT_PURPLE + "✦ 技能罗盘", "手持时自动指向最近的队友", "右键选定队友或打开技能与传送");
        ItemMeta meta = stack.getItemMeta();
        meta.getPersistentDataContainer().set(compassKey, PersistentDataType.BYTE, (byte) 1);
        stack.setItemMeta(meta);
        Map<Integer, ItemStack> extra = p.getInventory().addItem(stack);
        if (extra.isEmpty()) p.sendMessage(ChatColor.GREEN + "已领取技能罗盘，右键打开。");
        else p.sendMessage(ChatColor.RED + "背包已满；请腾出一个格子再领取。");
    }
    private boolean hasCompass(Player p) {
        for (ItemStack stack : p.getInventory().getContents()) if (isCompass(stack)) return true;
        return false;
    }
    private boolean isCompass(ItemStack stack) {
        return stack != null && stack.getType() == Material.COMPASS && stack.hasItemMeta()
                && stack.getItemMeta().getPersistentDataContainer().has(compassKey, PersistentDataType.BYTE);
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onKeepsakeDrop(PlayerDropItemEvent event) {
        ItemStack stack = event.getItemDrop().getItemStack();
        if (!isCompass(stack) && !isStatusBook(stack) && !BackpackShortcutMigration.isShortcut(stack)) return;
        event.setCancelled(true);
        event.getPlayer().sendMessage(ChatColor.YELLOW + (isCompass(stack) ? "技能罗盘"
                        : isStatusBook(stack) ? "命格书" : "大背包")
                + "会留在身上；可移动到其他快捷栏格子。");
    }
    private boolean isStatusBook(ItemStack stack) {
        return stack != null && stack.getType() == Material.WRITTEN_BOOK && stack.hasItemMeta()
                && stack.getItemMeta().getPersistentDataContainer().has(statusBookKey, PersistentDataType.BYTE);
    }
    private boolean hasStatusBook(Player p) {
        for (ItemStack stack : p.getInventory().getContents()) if (isStatusBook(stack)) return true;
        return false;
    }
    private ItemStack statusBook(Player p) {
        ItemStack stack = new ItemStack(Material.WRITTEN_BOOK);
        BookMeta meta = (BookMeta) stack.getItemMeta();
        meta.setTitle("命格书");
        meta.setAuthor("千灯纪");
        meta.setDisplayName(ChatColor.GOLD + "❖ 命格书 ❖");
        meta.setLore(List.of("使用键：查看状态与旅途指引", "手柄可用翻页键；未找到时可用 /mycli book 补领"));
        SkillsUser user = skillsUser(p);
        String manaLine = user == null ? "魔力数据加载中" : "魔力 " + Math.round(user.getMana())
                + "/" + Math.round(user.getMaxMana());
        String auraLine = user == null ? "技能数据加载中" : "战斗 " + user.getSkillLevel(Skills.FIGHTING)
                + " · 挖矿 " + user.getSkillLevel(Skills.MINING)
                + "\n炼金 " + user.getSkillLevel(Skills.ALCHEMY)
                + " · 探矿 " + ProspectingSpell.rangeFor(user.getSkillLevel(Skills.MINING),
                        hasImprintedProspectTool(p.getInventory().getItemInMainHand())) + " 格";
        meta.setPages(
                "§6❖ 千灯纪 · 命格书 ❖§r\n" + p.getName() + "\n\n生命 " + Math.round(p.getHealth())
                        + "/" + Math.round(p.getMaxHealth()) + "\n饥饿 " + p.getFoodLevel()
                        + "/20\n原版经验等级 " + p.getLevel() + "\n" + manaLine + "\n\n向右翻页，查看战绩与任务 →",
                "§c冒险战绩§r\n\n击败怪物 " + p.getStatistic(Statistic.MOB_KILLS)
                        + "\n击败玩家 " + p.getStatistic(Statistic.PLAYER_KILLS)
                        + "\n死亡次数 " + p.getStatistic(Statistic.DEATHS)
                        + "\n\n公会等级、声望、已完成委托和当前任务请看后面的「冒险者公会」页。",
                guild.bookPage(p),
                lifeGuild.bookPage(p),
                "§d角色成长§r\n\n" + auraLine
                        + "\n\n当前没有可手动分配的属性点。AuraSkills 技能随活动获取经验并升级；法术靠成功施放提高熟练度。",
                "§d法术熟练度 · 战斗§r\n\n" + masteryBookLine(p, "starbolt") + "\n"
                        + masteryBookLine(p, "frostnova") + "\n" + masteryBookLine(p, "flamewave")
                        + "\n\n成功施放 8 次升 2 级，24 次升 3 级。",
                "§d法术熟练度 · 探索§r\n\n" + masteryBookLine(p, "leap") + "\n"
                        + masteryBookLine(p, "flight") + "\n" + masteryBookLine(p, "golem") + "\n"
                        + masteryBookLine(p, "sense") + "\n" + masteryBookLine(p, "prospect"),
                "§6第一步：打开罗盘§r\n\n把技能罗盘拿在手上，按使用键。\n\n选「旅途指南」可直接进入地点、魔法、公会与队友菜单。\n\n想先逛逛？选「传送地点」去樱花林。",
                "§b手柄也能玩§r\n\n罗盘：使用键打开。\n方向键：选择图标。\n确认键：使用或进入。\n返回键：关闭菜单。\n\n命格书用页面左右箭头翻页；不用打字。",
                "§a探索与队友§r\n\n罗盘「传送地点」选村庄、樱花林与遗迹。去遗迹后还要步行探索。\n\n「找队友」可追踪方向或传送过去。\n\n在地点页保存自己的营地，方便回家。",
                "§d魔法与技能§r\n\n罗盘选图标施法。圣愈术治自己；星芒箭自动锁敌。\n\n法杖使用键瞬发，潜行使用换招。魔力会恢复。\n\n羽落 " + learnedLabel(p, featherKey)
                        + " · 夜视 " + learnedLabel(p, nightKey) + "\n未学时选图标学习。",
                "§d技能成长§r\n\n战斗：星芒箭、霜环、焰浪。\n探索：跃空、飞行、守护傀儡、探敌。\n采集：探矿。\n\n成功施放 8 次升 2 级、24 次升 3 级。罗盘选「技能成长」看本人进度；失败不计数。",
                "§5给工具刻印魔法§r\n\n手持镐、剑等工具，潜行使用附魔台，再选技能图标。\n\n需要经验 3 级和青金石 1 个。\n\n刻印后潜行对方块使用工具施法；原附魔保留。",
                "§c试炼塔与奖励§r\n\n从村庄沿路走到塔。按入口石按钮选难度，再点「开始」；附近队友一起进入。\n\n清怪后 10 秒自动下楼并补满生命。\n\n奖励在入口个人箱；死亡后也去那里拿。",
                "§6给旅人的话§r\n\n村庄里安全，村外有怪。先选一个公会任务，再结伴探险。\n\nAgent 用 /mycli guide 看指令；遇到困难可联系女神。\n\n命格书每次打开都会更新你的状态。");
        meta.getPersistentDataContainer().set(statusBookKey, PersistentDataType.BYTE, (byte) 1);
        stack.setItemMeta(meta);
        return stack;
    }
    private String masteryBookLine(Player p, String id) {
        int level = spellMastery.rank(p, id);
        int uses = spellMastery.uses(p, id);
        return SpellMastery.NAMES.get(id) + " " + level + "/3 (" + uses
                + (level == 3 ? " 次)" : "/" + spellMastery.nextRequired(p, id) + " 次)");
    }
    private void giveStatusBook(Player p) {
        if (hasStatusBook(p)) {
            p.sendMessage(ChatColor.YELLOW + "命格书已经在背包里；也可输入 /mycli status 查看当前状态。"); return;
        }
        Map<Integer, ItemStack> extra = p.getInventory().addItem(statusBook(p));
        if (extra.isEmpty()) p.sendMessage(ChatColor.GOLD + "命格书已来到你的行囊，拿在手上右键翻阅。");
        else p.sendMessage(ChatColor.RED + "背包已满；腾出一格后输入 /mycli book 补领。");
    }
    private ItemStack item(Material material, String name, String... lore) {
        ItemStack stack = new ItemStack(material);
        ItemMeta meta = stack.getItemMeta();
        meta.setDisplayName(name);
        meta.setLore(List.of(lore));
        stack.setItemMeta(meta);
        return stack;
    }
    private void openMenu(Player p, String page) {
        String title = switch (page) {
            case "skills" -> "§5✦ 技能罗盘";
            case "mastery" -> "§d✦ 技能成长";
            case "guide" -> "§6✦ 旅途指南";
            case "places" -> "§b✦ 传送罗盘";
            case "expeditions" -> "§6✦ 遗迹远征";
            case "players" -> "§b✦ 找队友";
            case "combat" -> "§c✦ 战斗法术";
            case "prospect" -> "§d✦ 探矿术";
            case "focus" -> "§d✦ 灵纹法杖绑定";
            case "imprint" -> "§5✦ 附魔台法术刻印";
            case "utility" -> "§b✦ 探索法术";
            case "creation" -> "§d✦ 向女神申请";
            case "guild" -> "§6✦ 冒险者公会";
            case "life" -> "§a✦ 生活公会";
            case "pvp" -> "§c✦ PvP竞技场";
            case "arena_difficulty" -> "§6✦ 试炼难度与开场";
            default -> "§6✦ 造物术";
        };
        Inventory inv = Bukkit.createInventory(null, page.equals("guild") ? 54 : page.equals("imprint") ? 54 : 27, title);
        if (page.equals("skills")) {
            inv.setItem(3, item(Material.SUNFLOWER, "§a生活公会", "种田、烹饪、钓鱼、建筑、写书和红石工坊", "手柄点击接单；Agent 用 /mycli life board"));
            inv.setItem(4, item(Material.WRITTEN_BOOK, "§6❖ 旅途指南", "从这里开始：手柄可选图标，不必打字", "也可以拿起命格书，翻页阅读"));
            inv.setItem(7, item(Material.WRITABLE_BOOK, "§6冒险者公会", "接地下城委托，获得声望与等级"));
            inv.setItem(8, item(Material.ELYTRA, "§b探索法术", "跃空、飞行、守护傀儡、探敌术"));
            inv.setItem(9, item(Material.BLAZE_ROD, "§d灵纹法杖", "手持使用瞬发技能；潜行使用可换绑定"));
            inv.setItem(10, item(Material.COMPASS, "§d归乡", "回到出生村庄"));
            inv.setItem(11, item(Material.ENDER_PEARL, "§d闪现", "朝视线短距离移动；消耗 4 魔力"));
            inv.setItem(12, item(Material.GLISTERING_MELON_SLICE, "§d范围治疗", "8 格内受伤玩家全部恢复 3 颗心；消耗 6 魔力"));
            inv.setItem(13, item(Material.BREAD, "§d饱食", "恢复饥饿；消耗 3 魔力"));
            inv.setItem(14, item(Material.FIREWORK_ROCKET, "§d烟花术", "无伤害光效；消耗 1 魔力；10 秒冷却"));
            inv.setItem(15, item(Material.GLOWSTONE_DUST, "§d星尘术", "无伤害星光；消耗 1 魔力；10 秒冷却"));
            String learning = "未学；原版经验 5 级或炼金等级 2，点击学习";
            inv.setItem(19, item(Material.FEATHER, "§b羽落", learned(p, featherKey, "已学会；点击咏唱；消耗 2 魔力", learning)));
            inv.setItem(20, item(Material.LANTERN, "§b夜视", learned(p, nightKey, "已学会；点击咏唱；消耗 2 魔力", learning)));
            inv.setItem(21, item(Material.GOLDEN_APPLE, "§a圣愈术·治疗自己", "回复 4 颗心；消耗 6 魔力"));
            inv.setItem(18, item(Material.BLAZE_POWDER, "§c战斗法术", "星芒箭、霜环、焰浪；只伤怪物"));
            inv.setItem(17, item(Material.SPYGLASS, "§d探矿术", "基础 24 格；挖矿等级提高范围", "刻印工具再 +8 格；点击选择矿种"));
            inv.setItem(16, item(Material.LODESTONE, "§b传送地点", "公共地点与私人 home"));
            inv.setItem(22, item(Material.IRON_SWORD, "§6试炼场", dungeon.isBuilt() ? "前往村外六层试炼" : "前往村外三波战斗场"));
            inv.setItem(23, item(Material.CRAFTING_TABLE, "§6造物术", "选择生活物资；每次消耗 4 魔力"));
            inv.setItem(24, item(Material.PLAYER_HEAD, "§b找队友", "追踪方向，或传送到队友身边"));
            inv.setItem(25, item(Material.LEATHER_CHESTPLATE, "§d换装皮肤", "打开皮肤画廊，手柄也可选择"));
            inv.setItem(5, item(Material.EXPERIENCE_BOTTLE, "§d技能成长", "战斗、探索、采集三类熟练度", "成功施法 8/24 次升级；点击查看"));
            inv.setItem(6, item(Material.IRON_SWORD, "§cPvP竞技场", "双方自愿匹配；同款装备 1v1", "自动倒数与记录胜负；点击打开"));
        } else if (page.equals("mastery")) {
            String[] ids = {"starbolt", "frostnova", "flamewave", "leap", "flight", "golem", "sense", "prospect"};
            Material[] icons = {Material.AMETHYST_SHARD, Material.SNOWBALL, Material.BLAZE_POWDER,
                    Material.RABBIT_FOOT, Material.ELYTRA, Material.IRON_BLOCK,
                    Material.RECOVERY_COMPASS, Material.SPYGLASS};
            int[] slots = {9, 10, 11, 13, 14, 15, 16, 17};
            for (int i = 0; i < ids.length; i++) {
                String id = ids[i];
                int uses = spellMastery.uses(p, id);
                inv.setItem(slots[i], item(icons[i], "§d" + SpellMastery.NAMES.get(id)
                        + " §e" + spellMastery.rank(p, id) + "/3",
                        "成功施放 " + uses + "/" + spellMastery.nextRequired(p, id) + " 次",
                        "类别 " + switch (spellMastery.category(id)) {
                            case "combat" -> "战斗"; case "gathering" -> "采集"; default -> "探索";
                        } + "；点击查看文字说明"));
            }
            inv.setItem(4, item(Material.WRITTEN_BOOK, "§6成长规则", "8 次升 2 级；24 次升 3 级", "AuraSkills 属性和公会声望另算"));
            inv.setItem(22, item(Material.ARROW, "§7返回技能", "打开技能罗盘"));
        } else if (page.equals("guide")) {
            inv.setItem(10, item(Material.COMPASS, "§a① 先去探索", "打开地点页；选村庄、樱花林或遗迹", "营地也能保存在地点页"));
            inv.setItem(11, item(Material.BLAZE_ROD, "§d② 学会魔法", "打开技能罗盘；选图标直接施法", "法杖可绑定喜欢的技能"));
            inv.setItem(12, item(Material.ENCHANTING_TABLE, "§5③ 给工具刻印", "拿着镐或剑到附魔台旁", "潜行使用附魔台，选要刻印的技能"));
            inv.setItem(13, item(Material.LECTERN, "§6④ 接公会任务", "打开任务看板；选一张委托", "完成后在看板交付，奖励进个人箱"));
            inv.setItem(14, item(Material.IRON_SWORD, "§c⑤ 结伴打试炼塔", "从村庄沿路走到入口石按钮", "选难度后点开始；附近队友一起进入"));
            inv.setItem(15, item(Material.PLAYER_HEAD, "§b⑥ 找队友", "追踪方向，或安全传送到队友身边"));
            inv.setItem(16, item(Material.WRITTEN_BOOK, "§e翻开命格书", "查看本人状态与全部旅途指引", "页面箭头可用手柄选择"));
            inv.setItem(17, item(Material.SUNFLOWER, "§a⑦ 生活公会", "钓鱼、种田、烹饪、建筑、写书与红石机关", "每日小委托；不必打怪也能成长"));
            inv.setItem(22, item(Material.ARROW, "§7返回技能罗盘", "回到技能罗盘"));
        } else if (page.equals("combat")) {
            inv.setItem(11, item(Material.AMETHYST_SHARD, "§d星芒箭·自动锁敌", "优先准星 18 格；否则锁定 12 格内最近怪物", "瞬发；伤害 5；4 魔力；3 秒冷却"));
            inv.setItem(13, item(Material.SNOWBALL, "§b霜环", "身边最多 4 只怪物；伤害 2 并减速；7 魔力；14 秒冷却"));
            inv.setItem(15, item(Material.BLAZE_POWDER, "§6焰浪", "前方最多 4 只怪物；伤害 4 并燃烧；8 魔力；10 秒冷却"));
            inv.setItem(22, item(Material.ARROW, "§7返回技能", "打开技能罗盘"));
        } else if (page.equals("utility")) {
            inv.setItem(10, item(Material.RABBIT_FOOT, "§b跃空术", "高高跳起并缓降；4 魔力；8 秒冷却"));
            inv.setItem(12, item(Material.ELYTRA, "§d飞行术", "自由飞行 15 秒；10 魔力；90 秒冷却"));
            inv.setItem(14, item(Material.IRON_BLOCK, "§6守护傀儡", "铁傀儡协战 45 秒；12 魔力；75 秒冷却"));
            inv.setItem(16, item(Material.RECOVERY_COMPASS, "§b探敌术", "探测 24 格内怪物；3 魔力；15 秒冷却"));
            inv.setItem(22, item(Material.ARROW, "§7返回技能", "打开技能罗盘"));
        } else if (page.equals("prospect")) {
            inv.setItem(10, item(Material.RAW_IRON, "§f探铁矿", "范围随挖矿等级成长；6 魔力；30 秒冷却"));
            inv.setItem(11, item(Material.COAL, "§8探煤矿", "范围随挖矿等级成长；6 魔力；30 秒冷却"));
            inv.setItem(12, item(Material.RAW_COPPER, "§6探铜矿", "范围随挖矿等级成长；6 魔力；30 秒冷却"));
            inv.setItem(13, item(Material.RAW_GOLD, "§e探金矿", "范围随挖矿等级成长；6 魔力；30 秒冷却"));
            inv.setItem(14, item(Material.DIAMOND, "§b探宝石", "钻石、绿宝石、青金石"));
            inv.setItem(15, item(Material.REDSTONE, "§c探红石", "范围随挖矿等级成长；6 魔力；30 秒冷却"));
            inv.setItem(16, item(Material.AMETHYST_SHARD, "§d探附近矿脉", "寻找最近的任意矿物"));
            inv.setItem(22, item(Material.ARROW, "§7返回技能", "打开技能罗盘"));
        } else if (page.equals("focus")) {
            for (FocusSpell spell : FOCUS_SPELLS)
                inv.setItem(spell.slot(), item(spell.icon(), spell.title(), spell.hint(), "点击绑定；之后手持法杖一按即施放"));
            inv.setItem(0, item(Material.ARROW, "§7返回技能", "打开技能罗盘"));
        } else if (page.equals("imprint")) {
            for (int i = 0; i < FOCUS_SPELLS.size(); i++) {
                FocusSpell spell = FOCUS_SPELLS.get(i);
                inv.setItem(i, item(spell.icon(), spell.title(), spell.hint(),
                        "点击刻印手中工具；3 经验等级 + 1 青金石"));
            }
            inv.setItem(45, item(Material.ENCHANTING_TABLE, "§5刻印说明",
                    "手持工具潜行使用附魔台打开此页", "刻印后潜行使用工具施法；普通附魔保留"));
        } else if (page.equals("places")) {
            for (PublicPlace place : PUBLIC_PLACES) {
                inv.setItem(place.slot(), item(place.icon(), place.title(), place.hint()));
            }
            inv.setItem(13, item(Material.IRON_SWORD, "§6试炼场", dungeon.isBuilt() ? "入口按钮选难度并组队，清怪后自动下楼" : "按钮启动三波战斗"));
            inv.setItem(14, item(Material.RED_BED, "§b保存当前位置", "保存或覆盖自己的 camp 地点"));
            inv.setItem(15, item(Material.ENDER_EYE, "§b回到保存位置", "返回自己的 camp 地点"));
            inv.setItem(16, item(Material.FILLED_MAP, "§6遗迹远征", "六处自然遗迹：墓穴、营地、古镇与堡垒", "选择目标后落在遗迹外围，仍需步行探索"));
            if (dungeon.isExpanded()) inv.setItem(17, item(Material.CAMPFIRE, "§6深层驿站", "通关第六层后解锁直达", "工作台、商人和深层首领战"));
            if (dungeon.isBuilt()) {
                inv.setItem(18, item(Material.WOODEN_SWORD, "§a普通试炼", "适合第一次挑战；到入口按按钮确认并开始"));
                inv.setItem(19, item(Material.IRON_SWORD, "§6冒险试炼", "怪物更强；稀有战利品概率和余额提高"));
                inv.setItem(20, item(Material.DIAMOND_SWORD, "§5末日试炼", "高强度挑战；更好的战利品和余额"));
                inv.setItem(21, item(Material.COMPASS, "§b自动匹配难度",
                        "你的公会等级：" + adventurerRankName(p) + "；推荐：" + dungeon.recommendedDifficultyLabel(p),
                        "按发起者等级选全队难度；低档重复奖励会减少"));
            }
            inv.setItem(22, item(Material.ARROW, "§7返回技能", "打开技能罗盘"));
        } else if (page.equals("expeditions")) {
            for (int i = 0; i < DungeonExpeditions.SITES.size(); i++) {
                DungeonExpeditions.Site site = DungeonExpeditions.SITES.get(i);
                inv.setItem(10 + i, item(site.icon(), "§e" + site.name(), site.hint(),
                        "传送到外围后步行约 70 格；可先在公会接调查委托"));
            }
            inv.setItem(22, item(Material.ARROW, "§7返回地点", "打开传送罗盘"));
        } else if (page.equals("players")) {
            inv.setItem(0, item(Material.ARROW, "§7返回技能", "打开技能罗盘"));
            inv.setItem(4, item(Material.COMPASS, "§a追踪最近队友", "同一世界；罗盘指针跟随她"));
            inv.setItem(6, item(Material.BARRIER, "§c停止追踪", "关闭画面上的队友方向提示"));
            inv.setItem(8, item(Material.ENDER_PEARL, "§d传送到最近队友", "安全落脚；20 秒冷却"));
            int[] headSlots = {10, 11, 12, 13, 14, 15, 16};
            Map<Integer, UUID> targets = new HashMap<>();
            List<Player> visible = trackablePlayers(p);
            for (int i = 0; i < Math.min(headSlots.length, visible.size()); i++) {
                Player target = visible.get(i);
                Location at = target.getLocation();
                String where = target.getWorld().equals(p.getWorld())
                        ? "距离约 " + Math.round(p.getLocation().distance(at)) + " 格"
                        : "在另一维度";
                inv.setItem(headSlots[i], item(Material.PLAYER_HEAD, "§b追踪 " + target.getName(),
                        worldLabel(target.getWorld()) + "  " + at.getBlockX() + ", " + at.getBlockY() + ", " + at.getBlockZ(),
                        where + "；罗盘指针跟随"));
                inv.setItem(headSlots[i] + 9, item(Material.ENDER_PEARL, "§d传送至 " + target.getName(),
                        "在队友附近安全落脚；20 秒冷却"));
                targets.put(headSlots[i], target.getUniqueId());
                targets.put(headSlots[i] + 9, target.getUniqueId());
            }
            if (visible.isEmpty()) inv.setItem(13, item(Material.BARRIER, "§7暂时没有其他在线玩家", "女神旁观者不会显示在这里"));
            playerMenuTargets.put(inv, targets);
        } else if (page.equals("pvp")) {
            inv.setItem(10, item(Material.IRON_SWORD, "§a加入匹配", "第二位玩家加入后自动倒数开战"));
            inv.setItem(11, item(Material.BARRIER, "§c退出匹配/认输", "排队时退出；战斗中认输"));
            inv.setItem(12, item(Material.COMPASS, "§b前往观众平台", "可看比赛；旁观者不能攻击选手"));
            inv.setItem(14, item(Material.WRITTEN_BOOK, "§e本人战绩", "胜负、积分与对局状态"));
            inv.setItem(16, item(Material.GOLD_INGOT, "§6排行榜", "同款装备 1v1 的积分"));
            inv.setItem(22, item(Material.ARROW, "§7返回技能罗盘"));
        } else if (page.equals("arena_difficulty")) {
            String mode = dungeon.selectedDifficultyMode(p);
            String selected = dungeon.selectedDifficultyLabel(p);
            String current = "当前选择：" + selected + (mode.equals("auto") ? "（自动）" : "（手动）");
            inv.setItem(10, item(Material.COMPASS, "§b自动匹配" + (mode.equals("auto") ? " §a✔" : ""),
                    "你的公会等级：" + adventurerRankName(p),
                    "推荐：" + dungeon.recommendedDifficultyLabel(p), "开场时按发起者等级决定"));
            inv.setItem(11, item(Material.WOODEN_SWORD, "§a普通" + (mode.equals("manual") && selected.equals("普通") ? " §a✔" : ""),
                    "首次挑战适用；生命 ×1.15，伤害 ×1.10"));
            inv.setItem(12, item(Material.IRON_SWORD, "§6冒险" + (mode.equals("manual") && selected.equals("冒险") ? " §a✔" : ""),
                    "更强的怪物；生命 ×1.7，伤害 ×1.4", "稀有奖励机会提高"));
            inv.setItem(13, item(Material.DIAMOND_SWORD, "§5末日" + (mode.equals("manual") && selected.equals("末日") ? " §a✔" : ""),
                    "高强度挑战；生命 ×2.5，伤害 ×1.85", "稀有奖励和余额提高"));
            inv.setItem(15, item(Material.WRITTEN_BOOK, "§e" + current,
                    "推荐：" + dungeon.recommendedDifficultyLabel(p),
                    "按下开始的人决定全队难度", "高等级刷低档时重复奖励会减少"));
            inv.setItem(16, dungeon.hasActiveRun()
                    ? item(Material.BARRIER, "§c已有队伍在挑战", "当前：" + dungeon.activeDifficultyLabel() + "；请等本轮结束")
                    : item(Material.LIME_CONCRETE, "§a开始" + selected + "试炼",
                            "附近玩家一起进入；按下即开场", "全队采用你当前选定的难度"));
            inv.setItem(22, item(Material.ARROW, "§7返回传送罗盘"));
        } else if (page.equals("guild")) {
            guild.fillBoard(p, inv);
        } else if (page.equals("life")) {
            lifeGuild.fillMenu(p, inv);
        } else if (page.equals("creation")) {
            for (int i = 0; i < GIFT_IDEAS.size(); i++) {
                GiftIdea idea = GIFT_IDEAS.get(i);
                inv.setItem(10 + i, item(idea.icon(), "§d申请 " + idea.title(), "由女神判断能否赠送；不会自动发放"));
            }
            inv.setItem(21, item(Material.WRITABLE_BOOK, "§e其他物品", "可输入 /mycli cast give <物品> 向女神申请"));
            inv.setItem(22, item(Material.ARROW, "§7返回造物术", "查看固定生活物资"));
        } else {
            inv.setItem(10, item(Material.BREAD, "§e面包 ×4", "消耗 4 魔力"));
            inv.setItem(11, item(Material.TORCH, "§e火把 ×4", "消耗 4 魔力"));
            inv.setItem(12, item(Material.OAK_LOG, "§e橡木 ×8", "消耗 4 魔力"));
            inv.setItem(13, item(Material.COBBLESTONE, "§e圆石 ×16", "消耗 4 魔力"));
            inv.setItem(14, item(Material.CRAFTING_TABLE, "§e工作台 ×1", "消耗 4 魔力"));
            inv.setItem(15, item(Material.CHEST, "§e箱子 ×1", "消耗 4 魔力"));
            inv.setItem(16, item(Material.CAKE, "§e蛋糕 ×1", "消耗 4 魔力"));
            inv.setItem(17, item(Material.GLASS, "§e玻璃 ×8", "消耗 4 魔力"));
            inv.setItem(20, item(Material.AMETHYST_SHARD, "§d申请更多物品", "由女神判断；手柄可选择常见愿望"));
            inv.setItem(22, item(Material.ARROW, "§7返回技能", "打开技能罗盘"));
        }
        inv.setItem(inv.getSize() - 1, item(Material.BARRIER, "§c关闭", "关闭菜单"));
        menus.put(inv, page);
        p.openInventory(inv);
    }

    @EventHandler public void onInteract(PlayerInteractEvent event) {
        if (event.getHand() != EquipmentSlot.HAND) return;
        if (event.getAction() != Action.RIGHT_CLICK_AIR && event.getAction() != Action.RIGHT_CLICK_BLOCK) return;
        if (SkillTome.isTome(event.getItem())) {
            event.setCancelled(true);
            SkillTome.use(event.getPlayer(), event.getPlayer().getInventory().getHeldItemSlot(), spellMastery);
            return;
        }
        if (guildHall != null && guildHall.handleInteract(event)) return;
        if (dungeon != null && dungeon.handleInteract(event)) return;
        if (event.getClickedBlock() != null && button(event.getClickedBlock())) {
            startArena(event.getPlayer()); return;
        }
        Player player = event.getPlayer();
        if (player.isSneaking() && event.getAction() == Action.RIGHT_CLICK_BLOCK
                && event.getClickedBlock().getType() == Material.ENCHANTING_TABLE
                && imprintable(event.getItem())) {
            event.setCancelled(true);
            openImprintMenu(player);
            return;
        }
        String imprinted = imprintedSpell(event.getItem());
        if (player.isSneaking() && imprinted != null) {
            event.setCancelled(true);
            long now = System.currentTimeMillis();
            if (now - focusUseAt.getOrDefault(player.getUniqueId(), 0L) < 300L) return;
            focusUseAt.put(player.getUniqueId(), now);
            cast(player, imprinted);
            return;
        }
        if (isFocus(event.getItem())) {
            event.setCancelled(true);
            if (player.isSneaking()) { openMenu(player, "focus"); return; }
            long now = System.currentTimeMillis();
            if (now - focusUseAt.getOrDefault(player.getUniqueId(), 0L) < 300L) return;
            focusUseAt.put(player.getUniqueId(), now);
            FocusSpell spell = focusSpell(event.getItem());
            if (spell == null) player.sendMessage(ChatColor.RED + "法杖绑定已失效；潜行使用重新选择技能。");
            else cast(player, spell.id());
        } else if (isCompass(event.getItem())) {
            event.setCancelled(true);
            openMenu(event.getPlayer(), "skills");
        } else if (isStatusBook(event.getItem())) {
            event.setCancelled(true);
            ItemStack updated = statusBook(player);
            player.getInventory().setItemInMainHand(updated);
            player.openBook(updated);
        }
    }
    @EventHandler public void onMenuClick(InventoryClickEvent event) {
        Inventory top = event.getView().getTopInventory();
        String page = menus.get(top);
        if (page == null) return;
        Map<Integer, UUID> targets = playerMenuTargets.get(top);
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player p)) return;
        int slot = event.getRawSlot();
        if (slot < 0 || slot >= top.getSize() || event.getClick().isShiftClick()) return;
        menus.remove(top); // A second click packet cannot cast from this menu.
        p.closeInventory();
        Bukkit.getScheduler().runTask(this, () -> {
            if (!p.isOnline()) return;
            if (slot == top.getSize() - 1) return;
            if (page.equals("skills")) {
                switch (slot) {
                    case 3 -> openMenu(p, "life");
                    case 5 -> openMenu(p, "mastery");
                    case 6 -> openMenu(p, "pvp");
                    case 4 -> openMenu(p, "guide");
                    case 7 -> openMenu(p, "guild");
                    case 8 -> openMenu(p, "utility");
                    case 9 -> openMenu(p, "focus");
                    case 10 -> cast(p, "home"); case 11 -> cast(p, "blink");
                    case 12 -> cast(p, "heal"); case 13 -> cast(p, "food");
                    case 14 -> cast(p, "fireworks"); case 15 -> cast(p, "starlight");
                    case 19 -> castOrLearn(p, "feather"); case 20 -> castOrLearn(p, "night");
                    case 21 -> cast(p, "selfheal");
                    case 18 -> openMenu(p, "combat");
                    case 17 -> openMenu(p, "prospect");
                    case 16 -> openMenu(p, "places");
                    case 22 -> gotoPlace(p, "arena"); case 23 -> openMenu(p, "conjure");
                    case 24 -> openMenu(p, "players");
                    case 25 -> { if (!p.performCommand("skins")) p.sendMessage(ChatColor.RED + "皮肤画廊暂时不可用。"); }
                    default -> { }
                }
            } else if (page.equals("mastery")) {
                if (slot == 22) openMenu(p, "skills");
                else spellMastery.report(p);
            } else if (page.equals("guide")) {
                switch (slot) {
                    case 10 -> openMenu(p, "places");
                    case 11 -> openMenu(p, "skills");
                    case 12 -> {
                        if (imprintable(p.getInventory().getItemInMainHand()) && nearEnchantingTable(p))
                            openImprintMenu(p);
                        else guide(p, new String[]{"guide", "gear"});
                    }
                    case 13 -> openMenu(p, "guild");
                    case 14 -> { guide(p, new String[]{"guide", "dungeon"}); openMenu(p, "places"); }
                    case 15 -> openMenu(p, "players");
                    case 16 -> p.openBook(statusBook(p));
                    case 17 -> openMenu(p, "life");
                    case 22 -> openMenu(p, "skills");
                    default -> { }
                }
            } else if (page.equals("combat")) {
                switch (slot) {
                    case 11 -> cast(p, "starbolt");
                    case 13 -> cast(p, "frostnova");
                    case 15 -> cast(p, "flamewave");
                    case 22 -> openMenu(p, "skills");
                    default -> { }
                }
            } else if (page.equals("utility")) {
                switch (slot) {
                    case 10 -> cast(p, "leap"); case 12 -> cast(p, "flight");
                    case 14 -> cast(p, "golem"); case 16 -> cast(p, "sense");
                    case 22 -> openMenu(p, "skills"); default -> { }
                }
            } else if (page.equals("prospect")) {
                switch (slot) {
                    case 10 -> cast(p, "prospect iron"); case 11 -> cast(p, "prospect coal");
                    case 12 -> cast(p, "prospect copper"); case 13 -> cast(p, "prospect gold");
                    case 14 -> cast(p, "prospect gems"); case 15 -> cast(p, "prospect redstone");
                    case 16 -> cast(p, "prospect"); case 22 -> openMenu(p, "skills");
                    default -> { }
                }
            } else if (page.equals("focus")) {
                if (slot == 0) openMenu(p, "skills");
                else FOCUS_SPELLS.stream().filter(spell -> spell.slot() == slot).findFirst()
                        .ifPresent(spell -> bindFocus(p, spell.id()));
            } else if (page.equals("imprint")) {
                if (slot >= 0 && slot < FOCUS_SPELLS.size()) imprint(p, FOCUS_SPELLS.get(slot).id());
            } else if (page.equals("places")) {
                switch (slot) {
                    case 13 -> gotoPlace(p, "arena");
                    case 14 -> { if (!p.performCommand("sethome camp")) p.sendMessage(ChatColor.RED + "保存位置失败。"); }
                    case 15 -> gotoPlace(p, "personal:camp");
                    case 16 -> openMenu(p, "expeditions");
                    case 17 -> { if (dungeon.isExpanded()) dungeon.command(p, new String[]{"arena", "rest"}); }
                    case 18 -> { if (dungeon.isBuilt()) dungeon.command(p, new String[]{"arena", "difficulty", "normal"}); }
                    case 19 -> { if (dungeon.isBuilt()) dungeon.command(p, new String[]{"arena", "difficulty", "adventure"}); }
                    case 20 -> { if (dungeon.isBuilt()) dungeon.command(p, new String[]{"arena", "difficulty", "apocalypse"}); }
                    case 21 -> { if (dungeon.isBuilt()) dungeon.command(p, new String[]{"arena", "difficulty", "auto"}); }
                    case 22 -> openMenu(p, "skills");
                    default -> PUBLIC_PLACES.stream().filter(place -> place.slot() == slot).findFirst()
                            .ifPresent(place -> gotoPlace(p, place.id()));
                }
            } else if (page.equals("expeditions")) {
                if (slot == 22) openMenu(p, "places");
                else if (slot >= 10 && slot < 10 + DungeonExpeditions.SITES.size())
                    guild.command(p, new String[]{"guild", "travel", DungeonExpeditions.SITES.get(slot - 10).id()});
            } else if (page.equals("players")) {
                if (slot == 0) openMenu(p, "skills");
                else if (slot == 4) trackNearest(p);
                else if (slot == 6) stopTracking(p);
                else if (slot == 8) teleportNearest(p);
                else if (targets != null && targets.containsKey(slot)) {
                    if (slot >= 19) teleportToTeammate(p, targets.get(slot));
                    else trackPlayer(p, targets.get(slot));
                }
            } else if (page.equals("pvp")) {
                switch (slot) {
                    case 10 -> pvpArena.command(p, new String[]{"pvp", "join"});
                    case 11 -> pvpArena.command(p, new String[]{"pvp", "leave"});
                    case 12 -> pvpArena.command(p, new String[]{"pvp", "lobby"});
                    case 14 -> pvpArena.command(p, new String[]{"pvp", "status"});
                    case 16 -> pvpArena.command(p, new String[]{"pvp", "board"});
                    case 22 -> openMenu(p, "skills");
                    default -> { }
                }
            } else if (page.equals("arena_difficulty")) {
                switch (slot) {
                    case 10 -> { dungeon.command(p, new String[]{"arena", "difficulty", "auto"}); openMenu(p, page); }
                    case 11 -> { dungeon.command(p, new String[]{"arena", "difficulty", "normal"}); openMenu(p, page); }
                    case 12 -> { dungeon.command(p, new String[]{"arena", "difficulty", "adventure"}); openMenu(p, page); }
                    case 13 -> { dungeon.command(p, new String[]{"arena", "difficulty", "apocalypse"}); openMenu(p, page); }
                    case 15 -> { dungeon.command(p, new String[]{"arena", "difficulty", "list"}); openMenu(p, page); }
                    case 16 -> { if (!dungeon.hasActiveRun()) dungeon.command(p, new String[]{"arena", "start"}); }
                    case 22 -> openMenu(p, "places");
                    default -> { }
                }
            } else if (page.equals("guild")) {
                if (slot == 51) gotoPlace(p, "arena");
                else if (slot == 52) openMenu(p, "skills");
                else if (slot == 47) openMenu(p, "life");
                else {
                    guild.click(p, slot);
                    if (slot == 0 || (slot >= 10 && slot < 10 + GuildManager.contractCount()) || slot == 48 || slot == 49)
                        openMenu(p, "guild");
                }
            } else if (page.equals("life")) {
                if (slot == 22) openMenu(p, "skills");
                else {
                    lifeGuild.click(p, slot);
                    if (slot != 21) openMenu(p, "life");
                }
            } else if (page.equals("creation")) {
                if (slot >= 10 && slot < 10 + GIFT_IDEAS.size()) requestCreation(p, GIFT_IDEAS.get(slot - 10).id());
                else if (slot == 21) p.sendMessage(ChatColor.LIGHT_PURPLE + "其他物品请用 /mycli cast give <物品>，女神会判断能否赠送。");
                else if (slot == 22) openMenu(p, "conjure");
            } else {
                switch (slot) {
                    case 10 -> conjure(p, "bread"); case 11 -> conjure(p, "torch");
                    case 12 -> conjure(p, "oak_log"); case 13 -> conjure(p, "cobblestone");
                    case 14 -> conjure(p, "crafting_table"); case 15 -> conjure(p, "chest");
                    case 16 -> conjure(p, "cake"); case 17 -> conjure(p, "glass");
                    case 20 -> openMenu(p, "creation"); case 22 -> openMenu(p, "skills"); default -> { }
                }
            }
        });
    }
    @EventHandler public void onMenuDrag(InventoryDragEvent event) {
        if (menus.containsKey(event.getView().getTopInventory())) event.setCancelled(true);
    }
    @EventHandler public void onMenuClose(InventoryCloseEvent event) {
        menus.remove(event.getInventory());
        playerMenuTargets.remove(event.getInventory());
    }

    private void buildArena(CommandSender sender) {
        World w = world();
        if (w == null) { sender.sendMessage("主世界尚未加载。"); return; }
        if (arenaBuilt) { sender.sendMessage("试炼场已登记。拒绝重复覆盖；先审查并手动维护。"); return; }
        // Refuse unexpected buildings or tall terrain before touching any block.
        for (int dx = -RADIUS; dx <= RADIUS; dx++) for (int dz = -RADIUS; dz <= RADIUS; dz++) {
            int bx = X + dx, bz = Z + dz;
            if (w.getHighestBlockYAt(bx, bz) >= FLOOR) { sender.sendMessage("场地过高：" + bx + "," + bz); return; }
            for (int y = 78; y <= 95; y++) {
                Block b = w.getBlockAt(bx, y, bz);
                if (b.getState() instanceof TileState || suspicious(b.getType())) {
                    sender.sendMessage("场地有人工建筑：" + bx + "," + y + "," + bz + " " + b.getType()); return;
                }
            }
        }
        for (int dz = -23; dz < -12; dz++) for (int dx = -2; dx <= 2; dx++) {
            if (w.getHighestBlockYAt(X + dx, Z + dz) >= FLOOR) {
                sender.sendMessage("入口地形过高，未施工。"); return;
            }
        }
        for (int dx = -RADIUS; dx <= RADIUS; dx++) for (int dz = -RADIUS; dz <= RADIUS; dz++) {
            int bx = X + dx, bz = Z + dz;
            int ground = w.getHighestBlockYAt(bx, bz);
            for (int y = Math.max(ground + 1, 78); y <= FLOOR; y++) w.getBlockAt(bx, y, bz).setType(Material.STONE_BRICKS, false);
            for (int y = FLOOR + 1; y <= FLOOR + 7; y++) w.getBlockAt(bx, y, bz).setType(Material.AIR, false);
            if (Math.abs(dx) == RADIUS || Math.abs(dz) == RADIUS) {
                for (int y = FLOOR + 1; y <= FLOOR + 4; y++) {
                    Material mat = (y == FLOOR + 2 && (dx + dz) % 3 == 0) ? Material.IRON_BARS : Material.STONE_BRICKS;
                    w.getBlockAt(bx, y, bz).setType(mat, false);
                }
            } else if (dx * dx + dz * dz <= 25) w.getBlockAt(bx, FLOOR, bz).setType(Material.POLISHED_ANDESITE, false);
        }
        // Open-air gate, bridge and safe lighting. The player operates the button inside.
        for (int y = FLOOR + 1; y <= FLOOR + 3; y++) w.getBlockAt(X, y, Z - RADIUS).setType(Material.AIR, false);
        w.getBlockAt(X, FLOOR + 1, Z - RADIUS).setType(Material.OAK_FENCE_GATE, false);
        for (int dz = -23; dz < -12; dz++) for (int dx = -2; dx <= 2; dx++) {
            int bx = X + dx, bz = Z + dz;
            int ground = w.getHighestBlockYAt(bx, bz);
            for (int y = Math.max(ground + 1, 78); y <= FLOOR; y++) w.getBlockAt(bx, y, bz).setType(Material.STONE_BRICKS, false);
            for (int y = FLOOR + 1; y <= FLOOR + 3; y++) w.getBlockAt(bx, y, bz).setType(Material.AIR, false);
            if (Math.abs(dx) == 2) w.getBlockAt(bx, FLOOR + 1, bz).setType(Material.OAK_FENCE, false);
        }
        for (int dx : new int[]{-9, 9}) for (int dz : new int[]{-9, 9})
            w.getBlockAt(X + dx, FLOOR, Z + dz).setType(Material.SEA_LANTERN, false);
        w.getBlockAt(X - 6, FLOOR + 1, Z - 8).setType(Material.CHISELED_STONE_BRICKS, false);
        Block startButton = w.getBlockAt(X - 6, FLOOR + 2, Z - 8);
        Switch data = (Switch) Bukkit.createBlockData(Material.STONE_BUTTON);
        data.setAttachedFace(Switch.AttachedFace.FLOOR);
        startButton.setBlockData(data, false);
        arenaBuilt = true;
        getConfig().set("arena-built", true);
        saveConfig();
        sender.sendMessage("试炼场已建于 " + X + "," + FLOOR + "," + Z + "；按钮 " + startButton.getLocation());
        getLogger().info("Arena built by console at " + X + "," + FLOOR + "," + Z);
    }
    private boolean suspicious(Material type) {
        String name = type.name();
        return name.contains("CHEST") || name.contains("BARREL") || name.contains("PLANKS")
                || name.contains("BRICKS") || name.contains("DOOR") || name.contains("SIGN")
                || name.contains("BED") || name.contains("LECTERN") || name.contains("SPAWNER");
    }

    private void startArena(Player starter) {
        if (!arenaBuilt) { starter.sendMessage(ChatColor.RED + "试炼场尚未建成。"); return; }
        if (!inside(starter.getLocation())) { starter.sendMessage(ChatColor.RED + "请站在试炼场内启动。"); return; }
        if (starter.getGameMode() == GameMode.SPECTATOR) { starter.sendMessage(ChatColor.RED + "旁观者不能启动。"); return; }
        if (active) { starter.sendMessage(ChatColor.YELLOW + "当前试炼还在进行。"); return; }
        long now = System.currentTimeMillis();
        if (now - lastRun < RUN_COOLDOWN_MS) {
            starter.sendMessage(ChatColor.YELLOW + "试炼场休息中，还需 " + ((RUN_COOLDOWN_MS - (now - lastRun) + 999) / 1000) + " 秒。");
            return;
        }
        participants.clear(); mobs.clear();
        for (Player p : Bukkit.getOnlinePlayers()) if (inside(p.getLocation()) && p.getGameMode() != GameMode.SPECTATOR)
            participants.add(p.getUniqueId());
        if (participants.isEmpty()) return;
        active = true; wave = 0; startedAt = now; nextWaveAt = now + 3000L;
        announce(ChatColor.GOLD + "试炼开始！每打完一波立即领取该波奖励；倒下也能保留已获得的奖励。");
    }
    private void tickArena() {
        if (!active) return;
        long now = System.currentTimeMillis();
        if (now - startedAt > RUN_TIMEOUT_MS) { finish(false, "试炼超时，怪物已清理。"); return; }
        mobs.removeIf(id -> {
            Entity e = Bukkit.getEntity(id);
            if (!(e instanceof LivingEntity living) || living.isDead() || !e.isValid()) return true;
            if (!inside(e.getLocation())) e.teleport(new Location(world(), X + 0.5, FLOOR + 1, Z + 0.5));
            return false;
        });
        if (mobs.isEmpty() && wave > 0 && nextWaveAt == 0L) {
            // Pay at the clear, rather than only after the whole run. A child who
            // falls in wave three keeps the rewards earned in waves one and two.
            rewardWave(wave);
            if (wave >= 3) { finish(true, "三波完成，全部奖励已发放！"); return; }
            nextWaveAt = now + 4000L;
            announce(ChatColor.GREEN + "这一波结束，下一波即将开始。");
        }
        boolean anyone = false;
        for (UUID id : participants) {
            Player p = Bukkit.getPlayer(id);
            if (p != null && !p.isDead() && inside(p.getLocation())) { anyone = true; break; }
        }
        if (!anyone) { finish(false, "队伍已离开或倒下，试炼结束；已领的波次奖励会保留。"); return; }
        if (mobs.isEmpty() && nextWaveAt != 0L && now >= nextWaveAt) spawnWave();
    }
    private void spawnWave() {
        wave++; nextWaveAt = 0L;
        EntityType[] types = switch (wave) {
            case 1 -> new EntityType[]{EntityType.ZOMBIE, EntityType.ZOMBIE, EntityType.ZOMBIE};
            case 2 -> new EntityType[]{EntityType.ZOMBIE, EntityType.ZOMBIE, EntityType.SPIDER, EntityType.SPIDER};
            default -> new EntityType[]{EntityType.ZOMBIE, EntityType.HUSK, EntityType.HUSK, EntityType.SPIDER, EntityType.SKELETON};
        };
        int[][] spots = {{-7, -5}, {7, -5}, {-7, 6}, {7, 6}, {0, 7}};
        for (int i = 0; i < types.length; i++) {
            Location at = new Location(world(), X + spots[i][0] + 0.5, FLOOR + 1, Z + spots[i][1] + 0.5);
            Entity e = world().spawnEntity(at, types[i]);
            e.addScoreboardTag(ARENA_TAG);
            e.getPersistentDataContainer().set(mobKey, PersistentDataType.BYTE, (byte) 1);
            if (e instanceof LivingEntity living) living.setRemoveWhenFarAway(false);
            mobs.add(e.getUniqueId());
        }
        announce(ChatColor.RED + "第 " + wave + "/3 波：" + types.length + " 只怪物！");
    }
    private void announce(String message) {
        for (Player p : Bukkit.getOnlinePlayers()) if (inside(p.getLocation())) p.sendMessage(message);
    }
    private void rewardWave(int clearedWave) {
        ItemStack[] rewards = switch (clearedWave) {
            case 1 -> new ItemStack[]{new ItemStack(Material.IRON_INGOT), new ItemStack(Material.BREAD, 2)};
            case 2 -> new ItemStack[]{new ItemStack(Material.EMERALD), new ItemStack(Material.IRON_INGOT), new ItemStack(Material.BREAD, 2)};
            case 3 -> new ItemStack[]{new ItemStack(Material.EMERALD, 2)};
            default -> throw new IllegalArgumentException("Unexpected arena wave: " + clearedWave);
        };
        int experience = clearedWave == 3 ? 10 : 5;
        String items = switch (clearedWave) {
            case 1 -> "1 铁锭、2 面包";
            case 2 -> "1 绿宝石、1 铁锭、2 面包";
            case 3 -> "2 绿宝石";
            default -> throw new IllegalArgumentException("Unexpected arena wave: " + clearedWave);
        };
        int paid = 0;
        for (UUID id : participants) {
            Player p = Bukkit.getPlayer(id);
            if (p == null || p.isDead() || !inside(p.getLocation())) continue;
            ItemStack[] copies = new ItemStack[rewards.length];
            for (int i = 0; i < rewards.length; i++) copies[i] = rewards[i].clone();
            Map<Integer, ItemStack> leftover = p.getInventory().addItem(copies);
            for (ItemStack item : leftover.values()) p.getWorld().dropItemNaturally(p.getLocation(), item);
            p.giveExp(experience);
            p.sendMessage(ChatColor.GOLD + "第 " + clearedWave + "/3 波奖励：" + items + "、" + experience + " 经验，已入背包！"
                    + (leftover.isEmpty() ? "" : "背包已满，剩余物品掉在脚边。"));
            p.sendTitle(ChatColor.GOLD + "第 " + clearedWave + " 波过关", ChatColor.YELLOW + "奖励已领取", 5, 45, 10);
            p.saveData();
            paid++;
        }
        getLogger().info("Arena wave reward: wave=" + clearedWave + ", recipients=" + paid);
    }
    private void finish(boolean won, String message) {
        if (!active) return;
        StringBuilder positions = new StringBuilder();
        for (UUID id : participants) {
            Player p = Bukkit.getPlayer(id);
            positions.append(id).append('=').append(p == null ? "offline" : p.getLocation().toVector()).append(';');
        }
        getLogger().info("Arena finished: won=" + won + ", wave=" + wave + ", reason=" + message + ", players=" + positions);
        if (won) for (UUID id : participants) {
            Player p = Bukkit.getPlayer(id);
            if (p == null || p.isDead() || !inside(p.getLocation())) continue;
            teachArenaSkills(p);
        }
        cleanupMobs();
        announce((won ? ChatColor.GREEN : ChatColor.YELLOW) + message);
        active = false; wave = 0; nextWaveAt = 0L;
        participants.clear();
        lastRun = System.currentTimeMillis();
        getConfig().set("last-run", lastRun);
        saveConfig();
    }
    void teachArenaSkills(Player p) {
        boolean taught = false;
        for (NamespacedKey key : new NamespacedKey[]{featherKey, nightKey}) if (!learned(p, key)) {
            p.getPersistentDataContainer().set(key, PersistentDataType.BYTE, (byte) 1);
            taught = true;
        }
        if (taught) {
            p.sendMessage(ChatColor.LIGHT_PURPLE + "女神传授了羽落与夜视；输入 /mycli goddess skills 查看。");
            p.saveData();
        }
    }
    private void cleanupMobs() {
        for (UUID id : mobs) {
            Entity e = Bukkit.getEntity(id);
            if (e != null) e.remove();
        }
        mobs.clear();
        World w = world();
        if (w != null && arenaBuilt) {
            for (Entity e : w.getNearbyEntities(new Location(w, X + 0.5, FLOOR + 1, Z + 0.5), 20, 12, 20))
                if (e.getScoreboardTags().contains(ARENA_TAG)) e.remove();
        }
    }
    @EventHandler public void onNaturalSpawn(CreatureSpawnEvent event) {
        if (arenaBuilt && event.getEntity() instanceof Monster && inside(event.getLocation())
                && event.getSpawnReason() != CreatureSpawnEvent.SpawnReason.CUSTOM) event.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.LOWEST) public void onWeedStart(BlockDamageEvent event) {
        Block block = event.getBlock();
        if (event.getPlayer().getGameMode() != GameMode.SURVIVAL
                || !inVillage(block.getLocation()) || !VILLAGE_WEEDS.contains(block.getType())) return;
        event.setCancelled(true);
        block.breakNaturally(event.getPlayer().getInventory().getItemInMainHand());
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onBreak(BlockBreakEvent event) {
        if (arenaBuilt && inBuild(event.getBlock().getLocation())) event.setCancelled(true);
        else if (event.isCancelled() && event.getPlayer().getGameMode() == GameMode.SURVIVAL
                && inVillage(event.getBlock().getLocation()) && VILLAGE_WEEDS.contains(event.getBlock().getType()))
            event.setCancelled(false);
    }
    @EventHandler(priority = EventPriority.HIGHEST) public void onVillagerDamage(EntityDamageEvent event) {
        if (event.getEntity() instanceof Villager && inVillage(event.getEntity().getLocation()))
            event.setCancelled(true);
    }
    @EventHandler public void onPlace(BlockPlaceEvent event) {
        if (arenaBuilt && inBuild(event.getBlock().getLocation())) event.setCancelled(true);
    }
    @EventHandler public void onEntityChange(EntityChangeBlockEvent event) {
        if (arenaBuilt && inBuild(event.getBlock().getLocation())) event.setCancelled(true);
    }
    @EventHandler public void onBurn(BlockBurnEvent event) {
        if (arenaBuilt && inBuild(event.getBlock().getLocation())) event.setCancelled(true);
    }
    @EventHandler public void onIgnite(BlockIgniteEvent event) {
        if (arenaBuilt && inBuild(event.getBlock().getLocation())) event.setCancelled(true);
    }
    @EventHandler public void onFlow(BlockFromToEvent event) {
        if (arenaBuilt && inBuild(event.getToBlock().getLocation())) event.setCancelled(true);
    }
    @EventHandler public void onExplosion(EntityExplodeEvent event) {
        if (arenaBuilt) event.blockList().removeIf(b -> inBuild(b.getLocation()));
    }
    @EventHandler public void onBlockExplosion(BlockExplodeEvent event) {
        if (arenaBuilt) event.blockList().removeIf(b -> inBuild(b.getLocation()));
    }
    @Override public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (args.length == 1) return AgentCliCatalog.roots();
        if (args.length == 2 && args[0].equalsIgnoreCase("list")) return AgentCliCatalog.filters();
        if (args.length == 2 && args[0].equalsIgnoreCase("coach")) return List.of("status", "on", "off");
        if (args.length == 2 && args[0].equalsIgnoreCase("pvp"))
            return List.of("status", "join", "leave", "lobby", "board", "menu");
        if (args.length == 2 && args[0].equalsIgnoreCase("skillbook")) return List.of("list", "use");
        if (args.length == 2 && (args[0].equalsIgnoreCase("explain") || args[0].equalsIgnoreCase("help")))
            return AgentCliCatalog.ids();
        if (args.length == 2 && args[0].equalsIgnoreCase("protect")) return List.of("break", "place");
        if (args.length == 2 && args[0].equalsIgnoreCase("guide"))
            return List.of("start", "explore", "magic", "gear", "guild", "dungeon", "team", "menu");
        if (args.length == 2 && args[0].equalsIgnoreCase("imprint")) {
            List<String> choices = new ArrayList<>(List.of("list"));
            choices.addAll(FOCUS_SPELLS.stream().map(FocusSpell::id).filter(id -> !id.contains(" ")).toList());
            return choices;
        }
        if (args.length == 3 && args[0].equalsIgnoreCase("imprint") && args[1].equalsIgnoreCase("prospect"))
            return FOCUS_SPELLS.stream().map(FocusSpell::id).filter(id -> id.startsWith("prospect "))
                    .map(id -> id.substring("prospect ".length())).toList();
        if (args.length == 2 && args[0].equalsIgnoreCase("focus")) return List.of("give", "list", "menu", "bind");
        if (args.length == 3 && args[0].equalsIgnoreCase("focus") && args[1].equalsIgnoreCase("bind"))
            return FOCUS_SPELLS.stream().map(FocusSpell::id).filter(id -> !id.contains(" ")).toList();
        if (args.length == 4 && args[0].equalsIgnoreCase("focus") && args[1].equalsIgnoreCase("bind")
                && args[2].equalsIgnoreCase("prospect"))
            return FOCUS_SPELLS.stream().map(FocusSpell::id).filter(id -> id.startsWith("prospect "))
                    .map(id -> id.substring("prospect ".length())).toList();
        if (args.length == 2 && args[0].equalsIgnoreCase("locate")) {
            List<String> choices = new ArrayList<>(List.of("list", "nearest", "off", "tp"));
            if (sender instanceof Player viewer) trackablePlayers(viewer).forEach(target -> choices.add(target.getName()));
            return choices;
        }
        if (args.length == 3 && args[0].equalsIgnoreCase("locate") && args[1].equalsIgnoreCase("tp")) {
            List<String> choices = new ArrayList<>(List.of("nearest"));
            if (sender instanceof Player viewer) trackablePlayers(viewer).forEach(target -> choices.add(target.getName()));
            return choices;
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("cast")) return List.of("home", "blink", "selfheal", "heal", "food", "give", "fireworks", "starlight", "starbolt", "frostnova", "flamewave", "prospect", "leap", "flight", "golem", "sense", "feather", "night");
        if (args.length == 3 && args[0].equalsIgnoreCase("cast") && args[1].equalsIgnoreCase("prospect")) return List.of("all", "coal", "iron", "copper", "gold", "gems", "diamond", "redstone", "ancient");
        if (args.length == 3 && args[0].equalsIgnoreCase("cast") && args[1].equalsIgnoreCase("give")) return List.of("bread", "torch", "oak_log", "cobblestone", "crafting_table", "chest", "cake", "glass");
        if (args.length == 2 && args[0].equalsIgnoreCase("goddess")) return List.of("skills", "learn", "pray");
        if (args.length == 3 && args[0].equalsIgnoreCase("goddess") && args[1].equalsIgnoreCase("learn")) return List.of("feather", "night");
        if (args.length == 2 && args[0].equalsIgnoreCase("goto")) {
            List<String> places = new ArrayList<>(PUBLIC_PLACES.stream().map(PublicPlace::id).toList());
            places.add("arena"); places.add("personal:");
            return places;
        }
        if (args.length == 2 && args[0].equalsIgnoreCase("arena"))
            return dungeon != null && dungeon.isBuilt()
                    ? List.of("difficulty", "start", "rest", "status", "next", "shop", "rewards", "leave") : List.of("start", "status", "leave");
        if (args.length == 3 && args[0].equalsIgnoreCase("arena") && args[1].equalsIgnoreCase("difficulty"))
            return List.of("auto", "normal", "adventure", "apocalypse");
        if (args.length == 2 && args[0].equalsIgnoreCase("guild"))
            return List.of("hall", "board", "menu", "join", "status", "accept", "abandon", "claim", "rewards");
        if (args.length == 2 && args[0].equalsIgnoreCase("life"))
            return List.of("board", "menu", "status", "accept", "claim", "abandon", "write");
        if (args.length == 3 && args[0].equalsIgnoreCase("life") && args[1].equalsIgnoreCase("accept"))
            return List.of("farmer_harvest", "gourmet_bread", "angler_catch", "builder_home", "author_story", "tinkerer_light");
        if (args.length == 3 && args[0].equalsIgnoreCase("guild") && args[1].equalsIgnoreCase("accept"))
            return List.of("first_step", "pest_control", "deep_explorer", "treasure_vault");
        if (args.length == 2 && args[0].equalsIgnoreCase("waypoint")) return List.of("add", "remove");
        return new ArrayList<>();
    }
}
