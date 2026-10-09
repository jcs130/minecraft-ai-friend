package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import io.netty.buffer.Unpooled;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.DiscardedPayload;
import net.minecraft.resources.ResourceLocation;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/** Configurable multi-step work and leisure, sharing the guild slot, action hooks and reward ledger. */
final class TaskMarketManager implements Listener {
    static final String CHANNEL = "mcagent:market";
    private static final String ROOT = "task-market";
    private static final Set<GuildManager.Goal> ACTIONS = Set.of(GuildManager.Goal.DONATE,
            GuildManager.Goal.CRAFT, GuildManager.Goal.FISH, GuildManager.Goal.LANTERNS,
            GuildManager.Goal.FLOOR, GuildManager.Goal.PARTY_FLOOR, GuildManager.Goal.KILLS,
            GuildManager.Goal.WITCH_KILLS, GuildManager.Goal.CLAIMS, GuildManager.Goal.EXPLORE,
            GuildManager.Goal.PEAK, GuildManager.Goal.DIMENSION, GuildManager.Goal.STRUCTURE,
            GuildManager.Goal.BIOME, GuildManager.Goal.RETURN, GuildManager.Goal.MELEE_KILLS,
            GuildManager.Goal.PARRY, GuildManager.Goal.HEALING, GuildManager.Goal.MARK_KILLS, GuildManager.Goal.MAP_HUNT,
            GuildManager.Goal.HARVEST, GuildManager.Goal.REPLANT, GuildManager.Goal.TRADE,
            GuildManager.Goal.PHOTO, GuildManager.Goal.PHOTO_HANG, GuildManager.Goal.SITE_CLEAR, GuildManager.Goal.SKILL_CAST);
    private static final Map<String, Integer> CHESTS = Map.of("weapons", 0, "armor", 1, "supplies", 2, "misc", 3);
    record Step(String title, String description, GuildManager.Goal goal, int target, int floor,
            String site, int chest, ExplorationObjectives.Target exploration, MapObjectives.Rules map) { }
    record Task(String key, String title, String description, String beneficiary, Material icon,
            boolean enabled, boolean project, boolean repeatOnce, boolean repeatDestination, int minRank, int fame, int emeralds,
            Material bonus, int bonusCount, List<Step> steps, ProjectHandovers.Grant grant, String definition) {
        String id() { return "tm_" + key; }
        GuildManager.Contract contract(int index) {
            Step step = steps.get(index);
            return new GuildManager.Contract(id(), title + " · " + (index + 1) + "/" + steps.size() + " " + step.title,
                    step.description, icon, step.goal, step.target, step.floor, minRank, fame,
                    emeralds, bonus, bonusCount, step.site, EngineeringSites.GOALS.contains(step.goal) ? 2
                    : step.goal == GuildManager.Goal.PARTY_FLOOR || step.goal == GuildManager.Goal.TRADE ? 3
                    : step.goal == GuildManager.Goal.REPLANT ? 5 : step.goal == GuildManager.Goal.EXPLORE
                    || step.goal == GuildManager.Goal.PHOTO || step.goal == GuildManager.Goal.PHOTO_HANG
                    || step.goal == GuildManager.Goal.PEAK || step.map != null || ExplorationObjectives.GOALS.contains(step.goal) ? 0 : ACTIONS.contains(step.goal)
                    && Set.of(GuildManager.Goal.CRAFT, GuildManager.Goal.DONATE, GuildManager.Goal.FISH,
                    GuildManager.Goal.LANTERNS, GuildManager.Goal.HARVEST).contains(step.goal) ? 2 : 1);
        }
        Set<String> sites() {
            Set<String> ids = new LinkedHashSet<>();
            for (Step step : steps) if (EngineeringSites.GOALS.contains(step.goal)) ids.add(step.site);
            return ids;
        }
    }
    private record Menu(Inventory inventory, List<String> ids, int page, int pages) { }
    private record Frozen(String definition, Task task) { }
    private final AgentFriendPlugin plugin;
    private final EngineeringSites engineering;
    private final ProjectHandovers handovers;
    private final ExplorationObjectives exploration;
    private final MapObjectives maps;
    private final File file;
    private Map<String, Task> tasks = Map.of();
    private Map<String, EngineeringSites.Site> drafts = Map.of();
    private final Map<UUID, Menu> menus = new HashMap<>();
    private final Set<UUID> checking = new java.util.HashSet<>();
    private final Map<UUID, Long> lastCheck = new HashMap<>();
    private final Map<UUID, Frozen> frozenTasks = new HashMap<>();
    private int surveyCursor;

    TaskMarketManager(AgentFriendPlugin plugin) {
        this.plugin = plugin; engineering = new EngineeringSites(plugin); exploration = new ExplorationObjectives(plugin); maps = new MapObjectives(plugin, exploration);
        handovers = new ProjectHandovers(plugin, engineering);
        file = new File(plugin.getDataFolder(), "task-market.yml");
        if (!file.exists()) plugin.saveResource("task-market.yml", false);
        if (!new File(plugin.getDataFolder(), "resident-contracts.yml").exists()) plugin.saveResource("resident-contracts.yml", false);
        reload(); Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
        registerStartupSites();
        Bukkit.getScheduler().runTask(plugin, () -> handovers.recover(Bukkit.getConsoleSender()));
        Bukkit.getScheduler().runTaskTimer(plugin, this::surveyPlayers, 5L, 5L);
        Bukkit.getScheduler().runTaskTimer(plugin, exploration::flush, 600L, 600L);
    }
    void shutdown() { exploration.flush(); }
    void surveyStatus(Player player) {
        Task task = frozen(player);
        if (task == null) return;
        Step step = task.steps.get(index(player));
        if (step.map != null) { EngineeringSites.Result result = observe(player, task); player.sendMessage("§7" + MapObjectives.hint(result.reason())); mapInfo(player); return; }
        if (step.exploration == null) return;
        EngineeringSites.Result result = observe(player, task); JsonObject e = result.evidence();
        if (step.goal == GuildManager.Goal.RETURN) {
            player.sendMessage("§7返程目标：" + step.exploration.dimension() + "；" + (result.ready() ? "已返回，可 guild claim 完成委托。" : "请先实际返回目标维度。"));
            return;
        }
        player.sendMessage("§7探索路线：不同区域 " + e.get("distinctZones") + "/" + step.target + "，有效行进 " + e.get("distance")
                + "/" + step.exploration.minDistance() + " 格、" + e.get("movingSeconds") + "/" + step.exploration.minSeconds() + " 秒；区段 "
                + e.get("distinctSections") + "/" + step.exploration.minParts() + "，群系 " + e.getAsJsonArray("biomes").size()
                + "/" + step.exploration.minBiomes() + "，高差 " + e.get("heightSpan") + "/" + step.exploration.minHeightSpan() + "。");
        if (!result.ready()) player.sendMessage("§7所有条件齐全才可交付；/mycli guild verify 读取完整证据与缺项。");
    }
    private void surveyPlayers() {
        List<Player> online = new ArrayList<>(Bukkit.getOnlinePlayers());
        if (online.isEmpty()) return;
        long deadline = System.nanoTime() + 2_000_000;
        for (int n = 0; n < Math.min(4, online.size()); n++) {
            Player player = online.get(Math.floorMod(surveyCursor++, online.size()));
            Task task = frozen(player);
            if (task != null && player.getGameMode() == GameMode.SURVIVAL && !player.isDead()) observe(player, task);
            if (System.nanoTime() >= deadline) break;
        }
    }
    private EngineeringSites.Result observe(Player player, Task task) {
        Step step = task.steps.get(index(player));
        if (step.exploration == null && step.map == null) return null;
        int previous = plugin.getConfig().getInt(activePath(player) + ".progress", 0);
        EngineeringSites.Result result = step.map != null ? maps.observe(player, step.map, step.target, run(player))
                : exploration.observe(player, step.exploration, step.target, run(player) + ":" + index(player));
        plugin.getConfig().set(activePath(player) + ".progress", result.progress());
        if (result.ready() && previous < step.target) {
            JsonObject data = new JsonObject(); data.addProperty("task", task.id()); data.addProperty("step", index(player) + 1);
            data.add("evidence", result.evidence()); send(player, "MC_MARKET_SURVEY", data);
            player.sendMessage("§a本阶段探索证据已齐全。/mycli guild claim 交付阶段并查看后续行程。");
        }
        return result;
    }
    @EventHandler(ignoreCancelled = true, priority = org.bukkit.event.EventPriority.MONITOR)
    public void surveyTeleport(org.bukkit.event.player.PlayerTeleportEvent event) { exploration.resetMovement(event.getPlayer()); }
    @EventHandler public void surveyDeath(org.bukkit.event.entity.PlayerDeathEvent event) { exploration.resetMovement(event.getEntity()); }
    @EventHandler(ignoreCancelled = true, priority = org.bukkit.event.EventPriority.MONITOR)
    public void surveyMode(org.bukkit.event.player.PlayerGameModeChangeEvent event) { exploration.resetMovement(event.getPlayer()); }
    /** Explicit operator deployment option. Never recaptures an existing baseline or loads chunks. */
    private void registerStartupSites() {
        List<String> requested = YamlConfiguration.loadConfiguration(file).getStringList("register-once");
        if (requested.isEmpty()) return;
        if (requested.size() > 32 || requested.stream().anyMatch(id -> !drafts.containsKey(id))) {
            plugin.getLogger().warning("Task market register-once rejected: unknown site or more than 32 sites"); return;
        }
        java.util.ArrayDeque<String> queue = new java.util.ArrayDeque<>(new LinkedHashSet<>(requested));
        new org.bukkit.scheduler.BukkitRunnable() {
            boolean pending; int ticks;
            @Override public void run() {
                if (queue.isEmpty()) { cancel(); return; }
                if (++ticks > 120) { plugin.getLogger().warning("Task market sites still unavailable: " + queue); cancel(); return; }
                if (pending) return;
                String id = queue.peek();
                if (plugin.getConfig().contains(EngineeringSites.ROOT + "." + id)) { queue.remove(); return; }
                EngineeringSites.Site site = drafts.get(id);
                if (site == null) { queue.remove(); return; }
                pending = true;
                engineering.register(site, answer -> {
                    pending = false;
                    if (answer.startsWith("area_unloaded") || answer.startsWith("scan_busy")) return;
                    queue.remove(id); plugin.getLogger().info("Task market initial site: " + answer);
                    if (answer.startsWith("registered：")) publishAll();
                });
            }
        }.runTaskTimer(plugin, 20L, 20L);
    }
    boolean isMarket(String id) { return id != null && id.startsWith("tm_"); }
    private String activePath(Player player) { return "guild-players." + player.getUniqueId() + ".active"; }
    private String marketPath(Player player) { return activePath(player) + ".market"; }
    private int index(Player player) { return plugin.getConfig().getInt(marketPath(player) + ".step", 0); }
    private String run(Player player) { return plugin.getConfig().getString(marketPath(player) + ".run", ""); }

    private boolean reload() {
        try {
            YamlConfiguration yaml = new YamlConfiguration(); yaml.load(file);
            if (yaml.getInt("schema-version") != 1) throw new IllegalArgumentException("schema-version");
            YamlConfiguration residents = new YamlConfiguration(); residents.load(new File(plugin.getDataFolder(), "resident-contracts.yml"));
            if (residents.getInt("schema-version") != 1 || residents.getConfigurationSection("tasks") == null)
                throw new IllegalArgumentException("resident schema-version/tasks");
            for (String key : residents.getConfigurationSection("tasks").getKeys(false)) {
                if (yaml.contains("tasks." + key)) throw new IllegalArgumentException("duplicate resident contract " + key);
                yaml.createSection("tasks." + key, residents.getConfigurationSection("tasks." + key).getValues(false));
            }
            ConfigurationSection siteRows = yaml.getConfigurationSection("sites"), taskRows = yaml.getConfigurationSection("tasks");
            if (siteRows == null || taskRows == null || taskRows.getKeys(false).size() > 64
                    || siteRows.getKeys(false).size() > 32) throw new IllegalArgumentException("max 64 tasks / 32 sites");
            Map<String, EngineeringSites.Site> nextSites = new LinkedHashMap<>();
            for (String id : siteRows.getKeys(false)) {
                EngineeringSites.Site site = EngineeringSites.parse(id, siteRows.getConfigurationSection(id));
                if (engineering.exists(id) && !engineering.site(id).equals(site))
                    throw new IllegalArgumentException(id + " 已登记，不能改变旧快照的范围或验收定义；请用新场地 ID。");
                nextSites.put(id, site);
            }
            Map<String, Task> nextTasks = new LinkedHashMap<>();
            Set<String> landIds = new LinkedHashSet<>();
            for (String key : taskRows.getKeys(false)) {
                ConfigurationSection row = taskRows.getConfigurationSection(key);
                Task task = parse(key, row);
                if (task.grant != null && !landIds.add(task.grant.landId())) throw new IllegalArgumentException("duplicate handover land ID");
                if (task.enabled) for (Step step : task.steps) if (EngineeringSites.GOALS.contains(step.goal)) {
                    EngineeringSites.Site site = nextSites.getOrDefault(step.site, engineering.site(step.site));
                    if (site == null) throw new IllegalArgumentException(task.id() + " missing site " + step.site);
                    if (step.goal == GuildManager.Goal.BRIDGE && site.start() == null)
                        throw new IllegalArgumentException(task.id() + " bridge needs start/end");
                    if (step.goal == GuildManager.Goal.BRIDGE && (site.start().y() < site.deckY()
                            || site.start().y() > site.deckY() + 4 || site.end().y() < site.deckY() || site.end().y() > site.deckY() + 4))
                        throw new IllegalArgumentException(task.id() + " bridge endpoints outside deck height band");
                    if (step.goal == GuildManager.Goal.REDSTONE && (site.components().isEmpty() || site.outputs().isEmpty()))
                        throw new IllegalArgumentException(task.id() + " redstone needs components/outputs");
                    if (step.goal == GuildManager.Goal.ROAD && site.box().min().y() != site.box().max().y())
                        throw new IllegalArgumentException(task.id() + " road bounds must have one deck layer");
                }
                nextTasks.put(task.id(), task);
            }
            drafts = java.util.Collections.unmodifiableMap(nextSites);
            tasks = java.util.Collections.unmodifiableMap(nextTasks);
            plugin.getLogger().info("Task market loaded " + tasks.size() + " tasks, " + drafts.size() + " site definitions");
            publishAll();
            return true;
        } catch (Exception error) {
            plugin.getLogger().warning("Task market reload rejected; previous definitions retained: " + error.getMessage());
            return false;
        }
    }
    private Task parse(String key, ConfigurationSection row) {
        if (!key.matches("[a-z0-9_]{2,40}") || row == null) throw new IllegalArgumentException("task " + key);
        plugin.professions().validateTask(row);
        String title = text(row, "title", 60), description = text(row, "description", 180);
        String beneficiary = row.getString("beneficiary", "千灯纪居民");
        if (beneficiary.length() > 40) throw new IllegalArgumentException(key + " beneficiary");
        String scope = row.getString("scope", "personal");
        if (!scope.equals("personal") && !scope.equals("project")) throw new IllegalArgumentException(key + " scope");
        String repeat = row.getString("repeat", "daily");
        if (!Set.of("daily", "once", "destination").contains(repeat)) throw new IllegalArgumentException(key + " repeat");
        int rank = row.getInt("min-rank", 0), fame = row.getInt("reward.fame"), emeralds = row.getInt("reward.emeralds");
        int bonusCount = row.getInt("reward.bonus-count");
        Material icon = item(row.getString("icon", "")), bonus = item(row.getString("reward.bonus", ""));
        if (rank < 0 || rank > 5 || fame < 1 || fame > 100 || emeralds < 1 || emeralds > 64
                || bonusCount < 1 || bonusCount > 64) throw new IllegalArgumentException(key + " reward/rank");
        List<Step> steps = new ArrayList<>();
        for (Map<?, ?> raw : row.getMapList("steps")) {
            YamlConfiguration stepYaml = new YamlConfiguration(); raw.forEach((k, v) -> stepYaml.set(String.valueOf(k), v));
            GuildManager.Goal goal = GuildManager.Goal.valueOf(stepYaml.getString("goal", "").toUpperCase(Locale.ROOT));
            if (!ACTIONS.contains(goal) && !EngineeringSites.GOALS.contains(goal)) throw new IllegalArgumentException(key + " goal");
            int target = stepYaml.getInt("target", 1), floor = stepYaml.getInt("floor", 0);
            if (target < 1 || target > 4096 || goal == GuildManager.Goal.ROAD && target > 100
                    || Set.of(GuildManager.Goal.FLOOR, GuildManager.Goal.PARTY_FLOOR).contains(goal) && (floor < 1 || floor > 15))
                throw new IllegalArgumentException(key + " step target/floor");
            String site = stepYaml.getString("site", "");
            if (Set.of(GuildManager.Goal.HARVEST, GuildManager.Goal.REPLANT).contains(goal)) {
                site = stepYaml.getString("crop", "WHEAT").toUpperCase(Locale.ROOT);
                if (!Set.of("WHEAT", "CARROTS", "POTATOES", "BEETROOTS", "NETHER_WART").contains(site))
                    throw new IllegalArgumentException(key + " crop");
                String requiredCrop = site;
                if (goal == GuildManager.Goal.REPLANT && steps.stream().filter(s -> s.goal == GuildManager.Goal.HARVEST && requiredCrop.equals(s.site)).mapToInt(Step::target).sum() < target)
                    throw new IllegalArgumentException(key + " replant needs an earlier matching harvest");
            }
            if (goal == GuildManager.Goal.TRADE) {
                site = stepYaml.getString("shop", "");
                try { site = UUID.fromString(site).toString(); } catch (IllegalArgumentException e) { throw new IllegalArgumentException(key + " shop UUID"); }
            }
            if ((goal == GuildManager.Goal.PHOTO || goal == GuildManager.Goal.PHOTO_HANG) && target > 64
                    || goal == GuildManager.Goal.PHOTO_HANG && steps.stream().filter(s -> s.goal == GuildManager.Goal.PHOTO).mapToInt(Step::target).sum() < target)
                throw new IllegalArgumentException(key + " hanging needs enough earlier new photos (max 64)");
            if (goal == GuildManager.Goal.SITE_CLEAR && !site.matches("[a-z0-9_]{2,40}"))
                throw new IllegalArgumentException(key + " dungeon site");
            if (goal == GuildManager.Goal.SKILL_CAST && !site.isEmpty() && !site.matches("[a-z0-9_]{1,40}"))
                throw new IllegalArgumentException(key + " skill ID");
            if (EngineeringSites.GOALS.contains(goal) && (!scope.equals("project") || !site.matches("[a-z0-9_]{2,40}")))
                throw new IllegalArgumentException(key + " engineering needs project scope + site");
            if (goal == GuildManager.Goal.DONATE || goal == GuildManager.Goal.CRAFT) site = item(stepYaml.getString("item", "")).name();
            if (goal == GuildManager.Goal.FISH) {
                site = stepYaml.getString("item", "ANY_FISH").toUpperCase(Locale.ROOT);
                if (site.equals("ANY_FISH")) site = null;
                else if (!Set.of("COD", "SALMON", "TROPICAL_FISH", "PUFFERFISH").contains(site)) throw new IllegalArgumentException(key + " fish");
            }
            if (goal == GuildManager.Goal.EXPLORE && DungeonExpeditions.site(site) == null)
                throw new IllegalArgumentException(key + " unknown expedition site");
            int chest = stepYaml.contains("chest") ? CHESTS.getOrDefault(stepYaml.getString("chest"), -2) : -1;
            if (chest == -2 || chest >= 0 && goal != GuildManager.Goal.DONATE) throw new IllegalArgumentException(key + " chest");
            ExplorationObjectives.Target survey = ExplorationObjectives.parse(goal, stepYaml, target);
            MapObjectives.Rules map = goal == GuildManager.Goal.MAP_HUNT ? MapObjectives.parse(stepYaml, target) : null;
            if (goal == GuildManager.Goal.RETURN && (steps.isEmpty() || steps.getLast().exploration == null
                    || steps.getLast().exploration.goal() == GuildManager.Goal.RETURN
                    || steps.getLast().exploration.dimension().equals(survey.dimension())))
                throw new IllegalArgumentException(key + " return must follow exploration in another dimension");
            steps.add(new Step(text(stepYaml, "title", 50), text(stepYaml, "description", 180), goal, target, floor,
                    site == null || site.isBlank() ? null : site, chest, survey, map));
        }
        if (steps.isEmpty() || steps.size() > 8 || scope.equals("project") && steps.stream().noneMatch(s -> EngineeringSites.GOALS.contains(s.goal)))
            throw new IllegalArgumentException(key + " steps (1..8; project must contain engineering)");
        long mapSteps = steps.stream().filter(s -> s.map != null).count();
        if (mapSteps > 1 || mapSteps == 1 && (scope.equals("project") || steps.getLast().map == null)
                || repeat.equals("destination") && mapSteps != 1)
            throw new IllegalArgumentException(key + " map_hunt must be the last personal step; destination repeat requires it");
        YamlConfiguration frozen = new YamlConfiguration(); frozen.set("task", row.getValues(false));
        return new Task(key, title, description, beneficiary, icon, row.getBoolean("enabled", true), scope.equals("project"), repeat.equals("once"), repeat.equals("destination"),
                rank, fame, emeralds, bonus, bonusCount, List.copyOf(steps), ProjectHandovers.parse(row, scope.equals("project"), steps), frozen.saveToString());
    }
    private static String text(ConfigurationSection row, String key, int limit) {
        String value = row.getString(key, "");
        if (value.isBlank() || value.length() > limit) throw new IllegalArgumentException(key + " text"); return value;
    }
    private static Material item(String name) {
        Material type = Material.matchMaterial(name);
        if (type == null || !type.isItem() || type.isAir()) throw new IllegalArgumentException("item " + name); return type;
    }
    Task frozen(Player player) {
        if (!isMarket(plugin.getConfig().getString(activePath(player) + ".id", ""))) return null;
        String definition = plugin.getConfig().getString(marketPath(player) + ".definition", "");
        Frozen cached = frozenTasks.get(player.getUniqueId());
        if (cached != null && cached.definition.equals(definition)) return cached.task;
        try {
            YamlConfiguration yaml = new YamlConfiguration(); yaml.loadFromString(definition);
            String id = plugin.getConfig().getString(activePath(player) + ".id", "");
            Task task = parse(id.substring(3), yaml.getConfigurationSection("task"));
            if (index(player) < 0 || index(player) >= task.steps.size()) throw new IllegalArgumentException("step index");
            frozenTasks.put(player.getUniqueId(), new Frozen(definition, task)); return task;
        } catch (Exception error) {
            frozenTasks.put(player.getUniqueId(), new Frozen(definition, null));
            plugin.getLogger().warning("Invalid active task snapshot retained for " + player.getUniqueId()); return null;
        }
    }
    GuildManager.Contract offered(String id) { Task task = tasks.get(id); return task == null || !task.enabled ? null : task.contract(0); }
    GuildManager.Contract active(Player player) { Task task = frozen(player); return task == null ? null : task.contract(index(player)); }
    List<Task> offers() { return tasks.values().stream().filter(Task::enabled).toList(); }
    boolean onceCompleted(String id) {
        return plugin.getConfig().getBoolean(ROOT + ".projects." + id + ".completed", false);
    }
    boolean onceCompleted(Player player, String id) {
        if (onceCompleted(id)) return true;
        Task active = frozen(player), task = active != null && active.id().equals(id) ? active : tasks.get(id);
        return task != null && task.repeatOnce && plugin.getConfig().contains("guild-players." + player.getUniqueId() + ".everDone." + id);
    }
    boolean destinationRepeat(Player player, String id) {
        Task active = frozen(player), task = active != null && active.id().equals(id) ? active : tasks.get(id);
        return task != null && task.repeatDestination;
    }
    String gate(Task task) {
        if (onceCompleted(task.id())) return "project_completed";
        if (task.project && !plugin.getConfig().getString(ROOT + ".projects." + task.id() + ".owner", "").isEmpty()) return "project_reserved";
        for (String site : task.sites()) if (!engineering.available(site)) return "site_unavailable:" + site;
        String handover = handovers.available(task, "");
        if (!handover.equals("available")) return handover;
        return "available";
    }
    private String state(Task task, Player player) {
        String gate = gate(task);
        if (task.id().equals(plugin.getConfig().getString(activePath(player) + ".id", ""))) return "in_progress";
        if (task.repeatOnce && onceCompleted(player, task.id())) return "completed_once";
        if (!task.repeatDestination && gate.equals("available") && java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai")).toString()
                .equals(plugin.getConfig().getString("guild-players." + player.getUniqueId() + ".daily." + task.id(), ""))) return "done_today";
        return gate;
    }
    boolean canAccept(Player player, GuildManager.Contract contract) {
        Task task = tasks.get(contract.id());
        if (task == null || !task.enabled) return false;
        String qualification = plugin.professions().taskDenial(player, task.definition);
        if (!qualification.equals("available")) { player.sendMessage("§e不能接单：" + qualification); return false; }
        if (task.repeatOnce && onceCompleted(player, task.id())) { player.sendMessage("§e这张远行履历已完成；每人仅结算一次。可以选择其他探索委托。"); return false; }
        String gate = gate(task);
        if (!gate.equals("available")) { player.sendMessage("§e不能接这张任务：" + gate + "。/mycli guild engineering 查看场地状态。"); return false; }
        if (player.getGameMode() != GameMode.SURVIVAL) { player.sendMessage("§e任务市场需要生存模式；旁观者不能施工或领奖。"); return false; }
        if (task.steps.stream().anyMatch(s -> s.map != null)) {
            String denial = maps.denial(player);
            if (!denial.equals("available")) { player.sendMessage("§e不能接寻宝委托：" + denial + "。" + MapObjectives.hint(denial)); return false; }
        }
        return true;
    }
    void accepted(Player player, String id) {
        exploration.clear(player);
        maps.clear(player);
        Task task = tasks.get(id); String run = UUID.randomUUID().toString(); String path = marketPath(player);
        plugin.getConfig().set(path + ".definition", task.definition);
        plugin.getConfig().set(path + ".skill-rewards", plugin.professions().rewards("guild_contract", id));
        frozenTasks.put(player.getUniqueId(), new Frozen(task.definition, task));
        plugin.getConfig().set(path + ".run", run); plugin.getConfig().set(path + ".step", 0);
        plugin.getConfig().set(path + ".started-at", System.currentTimeMillis());
        plugin.getConfig().set(path + ".step-started-at", System.currentTimeMillis());
        for (int i = 0; i < task.steps.size(); i++) if (task.steps.get(i).map != null) maps.accepted(player, run, i);
        if (task.project) {
            plugin.getConfig().set(ROOT + ".projects." + id + ".owner", player.getUniqueId().toString());
            plugin.getConfig().set(ROOT + ".projects." + id + ".run", run);
            for (String site : task.sites()) engineering.reserve(site, player, run);
        }
    }
    int chest(Player player) { Task task = frozen(player); return task == null ? -1 : task.steps.get(index(player)).chest; }
    void mapInfo(Player player) {
        JsonObject data = maps.info(player);
        Task task = frozen(player);
        if (task != null) for (Step step : task.steps) if (step.map != null) data.add("requirements", step.map.json());
        if (data.get("success").getAsBoolean()) {
            JsonObject map = data.getAsJsonObject("map");
            player.sendMessage("§6地图目标：" + map.get("title").getAsString() + "；" + map.get("dimension").getAsString()
                    + " X=" + map.get("x") + " Z=" + map.get("z") + "（图上标记，不提供藏宝深度）。");
            player.sendMessage("MC_TREASURE_TARGET mapId=" + map.get("mapId") + " dimension=" + map.get("dimension").getAsString()
                    + " x=" + map.get("x") + " z=" + map.get("z") + " heightKnown=false");
            if (data.has("returnTo")) {
                JsonObject at = data.getAsJsonObject("returnTo");
                player.sendMessage("MC_TREASURE_RETURN dimension=" + at.get("dimension").getAsString() + " x=" + at.get("x")
                        + " y=" + at.get("y") + " z=" + at.get("z"));
            }
            player.sendMessage("§7" + (data.has("returnTo") ? "已绑定接单时的地图；换主手物品不改变目的地。" : "主手持此图后接 tm_map_hunt；先找目标、探索，再回接单点交付。"));
        } else player.sendMessage("§e" + MapObjectives.hint(data.get("reason").getAsString()));
        send(player, "MC_TREASURE_MAP", data);
    }
    boolean engineering(GuildManager.Contract contract) { return contract != null && EngineeringSites.GOALS.contains(contract.goal()); }

    void verify(Player player, GuildManager.Contract contract, Consumer<Boolean> finish) {
        Task task = frozen(player);
        if (task == null || !contract.id().equals(task.id()) || player.getGameMode() != GameMode.SURVIVAL || player.isDead()) {
            player.sendMessage("§c任务状态无效；没有交付或领奖。"); finish.accept(false); return;
        }
        long now = System.currentTimeMillis();
        if (!checking.add(player.getUniqueId())) { player.sendMessage("§e正在验收，请等待当前结果。"); return; }
        if (now - lastCheck.getOrDefault(player.getUniqueId(), 0L) < 1000) {
            checking.remove(player.getUniqueId()); player.sendMessage("§e请等待一秒再验收。"); return;
        }
        lastCheck.put(player.getUniqueId(), now);
        String run = run(player); int step = index(player);
        if (task.steps.get(step).exploration != null || task.steps.get(step).map != null) {
            EngineeringSites.Result result = observe(player, task);
            if (result.ready() && step + 1 == task.steps.size()) recheckEarlier(player, task, run, step, 0, result, finish);
            else checked(player, task, run, step, result, finish);
            return;
        }
        if (!engineering(contract)) {
            int progress = plugin.guild().marketProgress(player);
            JsonObject evidence = new JsonObject(); evidence.addProperty("source", "server_action_events");
            evidence.addProperty("goal", contract.goal().name().toLowerCase(Locale.ROOT));
            evidence.addProperty("observedProgress", progress); evidence.addProperty("target", contract.target());
            evidence.addProperty("itemOrSite", contract.siteId() == null ? "" : contract.siteId());
            evidence.addProperty("floor", contract.floor());
            EngineeringSites.Result result = new EngineeringSites.Result(progress >= contract.target(), progress,
                    progress >= contract.target() ? "ready" : "action_progress_incomplete", evidence);
            if (result.ready() && step + 1 == task.steps.size())
                recheckEarlier(player, task, run, step, 0, result, finish);
            else checked(player, task, run, step, result, finish);
            return;
        }
        player.sendMessage("§7正在验收实际方块；请暂停施工。");
        engineering.verify(player, contract, run, result -> {
            if (result.ready() && step + 1 == task.steps.size())
                recheckEarlier(player, task, run, step, 0, result, finish);
            else checked(player, task, run, step, result, finish);
        });
    }
    private void recheckEarlier(Player player, Task task, String run, int currentStep, int earlier,
            EngineeringSites.Result current, Consumer<Boolean> finish) {
        while (earlier < currentStep && !engineering(task.contract(earlier))) earlier++;
        if (earlier >= currentStep) { checked(player, task, run, currentStep, current, finish); return; }
        int previous = earlier;
        engineering.recheck(player, task.contract(previous), run, result -> {
            if (!result.ready()) {
                result.evidence().addProperty("failedEarlierStep", previous + 1);
                checked(player, task, run, currentStep, new EngineeringSites.Result(false, 0,
                        result.reason(), result.evidence()), finish);
            } else recheckEarlier(player, task, run, currentStep, previous + 1, current, finish);
        });
    }
    private void checked(Player player, Task task, String run, int step, EngineeringSites.Result result, Consumer<Boolean> finish) {
        checking.remove(player.getUniqueId());
        if (!run.equals(run(player)) || step != index(player) || !player.isOnline()) return;
        String path = marketPath(player);
        if (engineering(task.contract(step))) plugin.getConfig().set(activePath(player) + ".progress", result.progress());
        plugin.getConfig().set(path + ".last-evidence", result.evidence().toString());
        plugin.getConfig().set(path + ".last-reason", result.reason());
        plugin.getConfig().set(path + ".last-verified-at", System.currentTimeMillis());
        // Busy / unloaded / distance errors are availability, not failed ability tests.
        boolean judged = Set.of("insufficient_road_coverage", "insufficient_new_blocks", "bridge_not_connected",
                "missing_components", "signal_not_observed", "action_progress_incomplete").contains(result.reason());
        if (!result.ready() && judged) {
            int failed = plugin.getConfig().getInt(path + ".failed-checks", 0) + 1;
            plugin.getConfig().set(path + ".failed-checks", failed);
            int judgedStep = result.evidence().has("failedEarlierStep") ? result.evidence().get("failedEarlierStep").getAsInt() - 1 : step;
            increment(player, task.steps.get(judgedStep).goal, "failed-checks");
        }
        plugin.saveConfig();
        JsonObject data = new JsonObject(); data.addProperty("task", task.id()); data.addProperty("step", step + 1);
        data.addProperty("ready", result.ready()); data.addProperty("progress", result.progress());
        data.addProperty("target", task.steps.get(step).target); data.addProperty("reason", result.reason());
        data.add("evidence", result.evidence()); send(player, "MC_MARKET_CHECK", data);
        player.sendMessage((result.ready() ? "§a验收通过：" : "§e验收未通过：") + result.reason()
                + "（" + result.progress() + "/" + task.steps.get(step).target + "）。");
        if (task.steps.get(step).map != null) player.sendMessage("§7" + MapObjectives.hint(result.reason()));
        JsonObject evidence = result.evidence();
        if (evidence.has("distinctZones") && task.steps.get(step).goal != GuildManager.Goal.RETURN) player.sendMessage("§7探索：不同区域 " + evidence.get("distinctZones") + "/" + task.steps.get(step).target
                + "，有效行进 " + evidence.get("distance") + " 格 / " + evidence.get("movingSeconds") + " 秒，建筑区段 "
                + evidence.get("distinctSections") + "，高差 " + evidence.get("heightSpan") + "；生物群系 " + evidence.get("biomes") + "。条件见 guild market " + task.id());
        if (result.reason().equals("different_structure_or_world")) player.sendMessage("§e本阶段记录属于同一座遗迹；要调查另一座，请放弃后重接，旧阶段路线会清空。");
        if (evidence.has("newBlocks")) player.sendMessage("§7施工证据：新增 " + evidence.get("newBlocks")
                + " 格，可走路面覆盖 " + evidence.get("coveragePercent") + "%，两端连通=" + evidence.get("connected") + "。");
        if (evidence.has("missingComponents")) {
            JsonObject missing = evidence.getAsJsonObject("missingComponents");
            player.sendMessage("§7实际通断输出：" + evidence.get("signalOutputsVerified") + "/" + evidence.get("signalOutputsRequired") + "。");
            missing.entrySet().forEach(part -> player.sendMessage("§e还缺新增构件：" + part.getKey() + " ×" + part.getValue()));
        }
        if (evidence.has("failedEarlierStep")) player.sendMessage("§e前面第 " + evidence.get("failedEarlierStep") + " 阶段已不满足，请先修复再交付。");
        finish.accept(result.ready());
    }
    /** The guild calls this after donation transfer and before rewards. Returns true if another step follows. */
    boolean advanceStep(Player player) {
        Task task = frozen(player); int index = index(player);
        if (task == null || index + 1 >= task.steps.size()) return false;
        recordStep(player, task, index);
        exploration.clear(player);
        String path = marketPath(player);
        plugin.getConfig().set(path + ".step", index + 1);
        plugin.getConfig().set(path + ".step-started-at", System.currentTimeMillis());
        plugin.getConfig().set(path + ".last-evidence", null); plugin.getConfig().set(path + ".last-reason", null);
        plugin.getConfig().set(activePath(player) + ".progress", 0);
        plugin.getConfig().set(path + ".action-evidence", null); plugin.getConfig().set(path + ".action-amount", null);
        plugin.saveConfig();
        GuildManager.Contract next = task.contract(index + 1);
        player.sendMessage("§a阶段已交付，继续：" + next.title() + "。" + next.description()
                + "；全部阶段完成后统一领奖，已交付材料不会因放弃返还。");
        detail(player, task); return true;
    }
    void completed(Player player) {
        Task task = frozen(player); if (task == null) return;
        if (task.steps.get(index(player)).map != null) maps.completed(player);
        recordStep(player, task, index(player));
        finishRun(player, task, "completed");
        plugin.professions().queue(player.getUniqueId(), "guild_contract:" + task.id(), run(player),
                plugin.getConfig().getStringList(marketPath(player) + ".skill-rewards"));
        if (task.project) {
            plugin.getConfig().set(ROOT + ".projects." + task.id() + ".completed", true);
            plugin.getConfig().set(ROOT + ".projects." + task.id() + ".completed-by", player.getUniqueId().toString());
            plugin.getConfig().set(ROOT + ".projects." + task.id() + ".completed-name", player.getName());
            plugin.getConfig().set(ROOT + ".projects." + task.id() + ".completed-at", System.currentTimeMillis());
            plugin.getConfig().set(ROOT + ".projects." + task.id() + ".completed-run", run(player));
            handovers.record(task, player.getUniqueId(), run(player));
        }
        release(player, task, true);
        exploration.clear(player);
        maps.clear(player);
        player.sendMessage("§a" + task.beneficiary + "收到了这份帮助。能力记录已保存：/mycli guild assessment");
    }
    boolean beforeComplete(Player player) {
        Task task = frozen(player);
        if (task != null && task.steps.get(index(player)).map != null
                && !maps.observe(player, task.steps.get(index(player)).map, task.steps.get(index(player)).target, run(player)).ready()) return false;
        if (task != null && !plugin.professions().taskDenial(player, task.definition).equals("available")) {
            player.sendMessage("§e交付需要接单时约定的职业资格；进度保留。"); return false;
        }
        return task != null && handovers.beforeComplete(player, task, run(player));
    }
    void afterComplete(Player player, String id) { handovers.apply(id, player); plugin.professions().recover(); }

    /** Verified combat/healing events only; identifiers prevent reusing a defeated entity within a step. */
    long stepStarted(Player player) {
        return frozen(player) == null ? Long.MAX_VALUE : plugin.getConfig().getLong(marketPath(player) + ".step-started-at", Long.MAX_VALUE);
    }
    String stepToken(Player player) { return frozen(player) == null ? "" : run(player) + ":" + index(player); }
    /** Only native event adapters call this. No command or NPC/model text can submit proof. */
    void worldAction(Player player, GuildManager.Goal goal, String subject, String evidence, long occurredAt) {
        worldAction(player, goal, subject, evidence, occurredAt, true);
    }
    void worldAction(Player player, GuildManager.Goal goal, String subject, String evidence, long occurredAt, boolean persist) {
        Task task = frozen(player);
        if (task == null || occurredAt < stepStarted(player)) return;
        Step step = task.steps.get(index(player));
        if (step.goal != goal || step.site != null && !step.site.equals(subject)) return;
        action(player, goal, 1, evidence, persist);
    }
    boolean harvest(Player player, String crop, String location) {
        Task task = frozen(player);
        if (task == null || player.getGameMode() != GameMode.SURVIVAL || player.isDead()) return false;
        Step step = task.steps.get(index(player));
        if (step.goal != GuildManager.Goal.HARVEST || !crop.equals(step.site)) return false;
        String path = marketPath(player) + ".harvested";
        List<String> harvested = new ArrayList<>(plugin.getConfig().getStringList(path));
        String key = crop + ":" + location;
        if (harvested.contains(key) || harvested.size() >= 4096) return false;
        harvested.add(key); plugin.getConfig().set(path, harvested);
        worldAction(player, GuildManager.Goal.HARVEST, crop, key, System.currentTimeMillis());
        return true;
    }
    boolean harvested(Player player, String crop, String location) {
        return frozen(player) != null && plugin.getConfig().getStringList(marketPath(player) + ".harvested").contains(crop + ":" + location);
    }
    boolean createdPhoto(Player player, String evidence) {
        return frozen(player) != null && plugin.getConfig().getStringList(marketPath(player) + ".photos").contains(evidence);
    }
    void professionAction(Player player, GuildManager.Goal goal, double amount, String evidenceId) {
        action(player, goal, amount, evidenceId, true);
    }
    private void action(Player player, GuildManager.Goal goal, double amount, String evidenceId, boolean persist) {
        Task task = frozen(player);
        if (task == null || player.getGameMode() != GameMode.SURVIVAL || player.isDead()
                || task.steps.get(index(player)).goal != goal || !Double.isFinite(amount) || amount <= 0) return;
        if (!plugin.professions().taskDenial(player, task.definition).equals("available")) return;
        String path = marketPath(player);
        List<String> evidence = new ArrayList<>(plugin.getConfig().getStringList(path + ".action-evidence"));
        if (!evidenceId.isEmpty()) {
            if (evidence.contains(evidenceId) || evidence.size() >= 4096) return;
            evidence.add(evidenceId); plugin.getConfig().set(path + ".action-evidence", evidence);
        }
        int target = task.steps.get(index(player)).target;
        if (goal == GuildManager.Goal.PHOTO && !evidenceId.isEmpty()) {
            List<String> photos = new ArrayList<>(plugin.getConfig().getStringList(path + ".photos"));
            if (!photos.contains(evidenceId) && photos.size() < 64) photos.add(evidenceId);
            plugin.getConfig().set(path + ".photos", photos);
        }
        double total = Math.min(target, plugin.getConfig().getDouble(path + ".action-amount", 0) + amount);
        int before = plugin.getConfig().getInt(activePath(player) + ".progress");
        plugin.getConfig().set(path + ".action-amount", total);
        plugin.getConfig().set(activePath(player) + ".progress", (int) Math.floor(total + .0001));
        if (persist) plugin.saveConfig();
        if (persist && before < target && total >= target) player.sendMessage("§a本阶段实际行动已达成；/mycli guild claim 交付。");
    }
    void abandoned(Player player) {
        Task task = frozen(player); if (task == null) return;
        finishRun(player, task, "abandoned"); release(player, task, false); exploration.clear(player);
        maps.clear(player);
    }
    private void release(Player player, Task task, boolean complete) {
        if (!task.project) return;
        String project = ROOT + ".projects." + task.id();
        if (run(player).equals(plugin.getConfig().getString(project + ".run", ""))) {
            plugin.getConfig().set(project + ".owner", null); plugin.getConfig().set(project + ".run", null);
        }
        for (String site : task.sites()) engineering.release(site, run(player), complete);
    }
    private void increment(Player player, GuildManager.Goal goal, String metric) {
        String key = ROOT + ".assessments." + player.getUniqueId() + ".goals." + goal.name().toLowerCase(Locale.ROOT) + "." + metric;
        plugin.getConfig().set(key, plugin.getConfig().getLong(key, 0L) + 1);
    }
    private void recordStep(Player player, Task task, int index) {
        Step step = task.steps.get(index); increment(player, step.goal, "verified-steps");
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("step", index + 1); row.put("goal", step.goal.name().toLowerCase(Locale.ROOT));
        row.put("target", step.target); row.put("site", step.site == null ? "" : step.site);
        row.put("elapsed-ms", System.currentTimeMillis() - plugin.getConfig().getLong(marketPath(player) + ".step-started-at"));
        row.put("evidence", plugin.getConfig().getString(marketPath(player) + ".last-evidence", "{}"));
        List<Map<?, ?>> stages = new ArrayList<>(plugin.getConfig().getMapList(marketPath(player) + ".verified-steps"));
        stages.add(row); plugin.getConfig().set(marketPath(player) + ".verified-steps", stages);
    }
    private void finishRun(Player player, Task task, String outcome) {
        String key = ROOT + ".assessments." + player.getUniqueId() + ".history";
        List<Map<?, ?>> history = new ArrayList<>(plugin.getConfig().getMapList(key));
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("run", run(player)); row.put("task", task.id()); row.put("title", task.title);
        row.put("outcome", outcome); row.put("at", System.currentTimeMillis());
        row.put("elapsed-ms", System.currentTimeMillis() - plugin.getConfig().getLong(marketPath(player) + ".started-at"));
        row.put("failed-checks", plugin.getConfig().getInt(marketPath(player) + ".failed-checks", 0));
        row.put("steps", plugin.getConfig().getMapList(marketPath(player) + ".verified-steps"));
        history.add(row); if (history.size() > 50) history = new ArrayList<>(history.subList(history.size() - 50, history.size()));
        plugin.getConfig().set(key, history);
    }

    void command(Player player, String[] args) {
        String action = args.length > 2 ? args[2] : "list";
        if (action.equalsIgnoreCase("menu")) { openMenu(player); return; }
        if (action.equalsIgnoreCase("list")) { list(player); return; }
        Task active = frozen(player);
        Task task = active != null && active.id().equals(action) ? active : tasks.get(action);
        if (task == null) { player.sendMessage("§e用法：/mycli guild engineering list|menu|<任务ID>"); return; }
        detail(player, task);
    }
    void list(Player player) {
        player.sendMessage("§6【任务市场 · 千灯纪委托】工程、远征与生活；探索履历每人一次，日常按任务说明。");
        for (Task task : offers()) player.sendMessage("§e" + task.id() + " §f" + task.title + " · " + task.description
                + " §7[" + state(task, player) + "] · 声望+" + task.fame + " / 绿宝石×" + task.emeralds);
        player.sendMessage("§7/mycli guild engineering <ID> 看步骤与坐标；guild accept <ID> 接单；guild verify 验收；guild claim 交付。");
        publish(player);
    }
    private void publish(Player player) {
        JsonObject data = new JsonObject(); JsonArray array = new JsonArray();
        for (Task task : offers()) { JsonObject row = summary(task); row.addProperty("state", state(task, player)); array.add(row); }
        data.add("tasks", array); send(player, "MC_MARKET_BOARD", data);
    }
    private void publishAll() {
        for (Player player : Bukkit.getOnlinePlayers())
            if (player.getGameMode() != GameMode.SPECTATOR && plugin.isRegisteredAgent(player)) publish(player);
    }
    @EventHandler public void join(org.bukkit.event.player.PlayerJoinEvent event) {
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            Player player = event.getPlayer();
            if (player.isOnline() && player.getGameMode() != GameMode.SPECTATOR && plugin.isRegisteredAgent(player)) publish(player);
        }, 40L);
    }
    private JsonObject summary(Task task) {
        JsonObject row = new JsonObject(); row.addProperty("id", task.id()); row.addProperty("title", task.title);
        row.addProperty("description", task.description); row.addProperty("scope", task.project ? "project" : "personal");
        row.addProperty("repeat", task.project || task.repeatOnce ? "once" : task.repeatDestination ? "destination" : "daily");
        row.addProperty("stepCount", task.steps.size()); row.addProperty("fame", task.fame); row.addProperty("emeralds", task.emeralds);
        row.addProperty("minRank", task.minRank); return row;
    }
    JsonObject residentCard(Player player, String id) {
        Task task = tasks.get(id);
        if (task == null || !task.enabled) return null;
        JsonObject row = summary(task); row.addProperty("state", state(task, player));
        row.addProperty("beneficiary", task.beneficiary); row.addProperty("icon", task.icon.name());
        row.addProperty("detailCommand", "/mycli guild market " + id);
        row.addProperty("acceptCommand", "/mycli guild accept " + id);
        return row;
    }
    private void detail(Player player, Task task) {
        JsonObject data = summary(task); JsonArray steps = new JsonArray();
        List<String> rewards = task.id().equals(plugin.getConfig().getString(activePath(player) + ".id"))
                ? plugin.getConfig().getStringList(marketPath(player) + ".skill-rewards") : plugin.professions().rewards("guild_contract", task.id());
        data.add("skillRewards", new com.google.gson.Gson().toJsonTree(rewards));
        if (!rewards.isEmpty()) player.sendMessage("§d全部阶段验收后学习：" + String.join(",", rewards) + "；接单时冻结奖励。");
        if (task.grant != null) {
            JsonObject grant = new JsonObject(); grant.addProperty("landId", task.grant.landId()); grant.addProperty("site", task.grant.site());
            grant.addProperty("ownerPolicy", "verified_completing_contractor"); grant.addProperty("landmarkEnabled", task.grant.landmark()); data.add("handover", grant);
            player.sendMessage("§a完工交接：验收完成者管理领地「" + task.grant.landId() + "」，访客可参观，私人储物仍受保护。"
                    + (task.grant.landmark() ? "主人可亲自到安全落点登记公共地标，供大家消耗 6 魔力传送。" : ""));
        }
        for (int i = 0; i < task.steps.size(); i++) {
            Step step = task.steps.get(i); JsonObject row = new JsonObject();
            row.addProperty("index", i + 1); row.addProperty("title", step.title); row.addProperty("description", step.description);
            row.addProperty("goal", step.goal.name().toLowerCase(Locale.ROOT)); row.addProperty("target", step.target);
            row.addProperty("floor", step.floor); row.addProperty("site", step.site == null ? "" : step.site);
            row.addProperty("chest", step.chest);
            if (step.map != null) {
                row.add("mapHunt", step.map.json());
                player.sendMessage("§7寻宝：主手持现有目标地图接单；天然藏宝箱须亲自新开，遗迹须深入走查；"
                        + step.target + "区域/" + step.map.minDistance() + "格/" + step.map.minSeconds() + "秒有效路线，再返回接单点。地图不消耗，同一目的地每人一次。");
                if (task.id().equals(plugin.getConfig().getString(activePath(player) + ".id"))) mapInfo(player);
            }
            if (step.exploration != null) {
                row.add("exploration", step.exploration.json());
                player.sendMessage("§7探索验收：" + step.exploration.conditions(step.target));
            }
            player.sendMessage("§b" + (i + 1) + ". " + step.title + "：" + step.description + "（" + step.target + "）");
            player.sendMessage("§7条件：goal=" + step.goal.name().toLowerCase(Locale.ROOT) + " target=" + step.target
                    + (step.site == null ? "" : " itemOrSite=" + step.site) + (step.floor > 0 ? " floor=" + step.floor : "")
                    + (step.chest >= 0 ? " publicChest=" + step.chest : ""));
            EngineeringSites.Site site = EngineeringSites.GOALS.contains(step.goal) ? engineering.site(step.site) : null;
            if (site != null) {
                JsonObject area = new JsonObject(); area.addProperty("world", site.world());
                area.addProperty("min", site.box().min().key()); area.addProperty("max", site.box().max().key());
                area.addProperty("deckY", site.deckY());
                if (site.start() != null) { area.addProperty("start", site.start().key()); area.addProperty("end", site.end().key()); }
                JsonArray materials = new JsonArray(); site.materials().stream().map(Material::name).sorted().forEach(materials::add);
                area.add("materials", materials);
                JsonObject parts = new JsonObject(); site.components().forEach((m, n) -> parts.addProperty(m.name(), n)); area.add("components", parts);
                JsonArray outputs = new JsonArray(); site.outputs().forEach((at, m) -> {
                    JsonObject output = new JsonObject(); output.addProperty("at", at.key()); output.addProperty("material", m.name()); outputs.add(output);
                }); area.add("outputs", outputs); row.add("area", area);
                player.sendMessage("§7场地 " + site.id() + " " + site.world() + "：" + site.box().min().key() + " 至 " + site.box().max().key()
                        + "；材料 " + String.join(",", site.materials().stream().map(Material::name).sorted().toList()));
                player.sendMessage("§7路面基准高度 y=" + site.deckY() + "；实际方块必须在场地内，桥/路要求头顶两格净空。");
                if (site.start() != null) player.sendMessage("§7桥两端锚点：" + site.start().key() + " → " + site.end().key() + "。");
                if (step.goal == GuildManager.Goal.REDSTONE) {
                    site.components().entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(part ->
                            player.sendMessage("§7需新增构件：" + part.getKey().name() + " ×" + part.getValue()));
                    site.outputs().entrySet().stream().sorted(Map.Entry.comparingByKey(java.util.Comparator.comparing(EngineeringSites.Pos::key)))
                            .forEach(output -> player.sendMessage("§7通断目标：" + output.getValue().name() + " @ " + output.getKey().key()));
                    player.sendMessage("§7安装后由接单者操作场内按钮/拉杆，让所有目标实际通断；改动方块后须重新调试。");
                }
            }
            steps.add(row);
        }
        data.add("steps", steps); data.addProperty("beneficiary", task.beneficiary);
        if (task.id().equals(plugin.getConfig().getString(activePath(player) + ".id"))) data.addProperty("currentStep", index(player) + 1);
        send(player, "MC_MARKET_DETAIL", data);
        player.sendMessage("§7备料可用公会门口公共箱 /mycli guild shared；门内物品归萌萌。每阶段 guild claim 交付，末阶段统一领奖。");
    }
    void assessment(Player player) {
        JsonObject data = new JsonObject(); JsonObject goals = new JsonObject();
        ConfigurationSection section = plugin.getConfig().getConfigurationSection(ROOT + ".assessments." + player.getUniqueId() + ".goals");
        player.sendMessage("§6【本人任务能力记录】服务器已验收的动作、工程与探索证据。");
        if (section != null) for (String goal : section.getKeys(false)) {
            JsonObject row = new JsonObject(); row.addProperty("verifiedSteps", section.getLong(goal + ".verified-steps"));
            row.addProperty("failedChecks", section.getLong(goal + ".failed-checks")); goals.add(goal, row);
            player.sendMessage("§b" + goal + "：已验收阶段 " + section.getLong(goal + ".verified-steps") + "，未通过验收 " + section.getLong(goal + ".failed-checks"));
        }
        data.add("goals", goals);
        var history = plugin.getConfig().getMapList(ROOT + ".assessments." + player.getUniqueId() + ".history");
        data.add("recent", new com.google.gson.Gson().toJsonTree(history.subList(Math.max(0, history.size() - 10), history.size())));
        data.addProperty("elapsedIncludesOffline", true); data.addProperty("scope", "self");
        send(player, "MC_MARKET_ASSESSMENT", data);
        player.sendMessage("§7耗时含离线、失败和放弃都留档；这些记录不代表未经测试的综合能力。");
    }
    private void send(Player player, String type, JsonObject data) {
        data.addProperty("schemaVersion", 1); data.addProperty("type", type);
        byte[] bytes = data.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length <= 32_768) {
            if (player.getListeningPluginChannels().contains(CHANNEL)) player.sendPluginMessage(plugin, CHANNEL, bytes);
            else ((CraftPlayer) player).getHandle().connection.send(new ClientboundCustomPayloadPacket(
                    new DiscardedPayload(new ResourceLocation(CHANNEL), Unpooled.wrappedBuffer(bytes))));
        }
        JsonObject shortNotice = new JsonObject(); shortNotice.addProperty("type", type);
        shortNotice.addProperty("schemaVersion", 1); shortNotice.addProperty("command", "/mycli guild engineering");
        if (data.has("task")) shortNotice.add("task", data.get("task"));
        if (data.has("ready")) shortNotice.add("ready", data.get("ready"));
        if (data.has("reason")) shortNotice.add("reason", data.get("reason"));
        if (shortNotice.toString().length() <= 256) player.sendMessage(shortNotice.toString());
    }
    void admin(CommandSender sender, String[] args) {
        String action = args.length > 2 ? args[2].toLowerCase(Locale.ROOT) : "list";
        if (action.equals("handovers") && args.length == 3) { handovers.recover(sender); sender.sendMessage("已检查待交接账本；成功项目不会重复发奖或重置主人。"); return; }
        if (action.equals("handover") && args.length == 4) {
            Task task = tasks.get(args[3]);
            if (task == null) sender.sendMessage("任务不存在。"); else handovers.adopt(task, sender);
            return;
        }
        if (action.equals("reload")) { sender.sendMessage(reload() ? "任务市场已热加载；在途任务保留接单快照。" : "配置校验失败，保留上次有效任务市场。"); return; }
        if (action.equals("list")) {
            for (Task task : tasks.values()) sender.sendMessage(task.id() + " enabled=" + task.enabled + " " + gate(task));
            for (String id : drafts.keySet()) sender.sendMessage("site=" + id + " registered=" + engineering.exists(id)
                    + " owner=" + engineering.owner(id) + " completed=" + engineering.completed(id)); return;
        }
        if (action.equals("register") && args.length == 4) {
            EngineeringSites.Site site = drafts.get(args[3]);
            if (site == null) { sender.sendMessage("未定义场地；先编辑 task-market.yml 并 reload。"); return; }
            engineering.register(site, answer -> { sender.sendMessage(answer); if (answer.startsWith("registered：")) publishAll(); });
            sender.sendMessage("已申请逐格场地登记；请等待 registered 或拒绝回执。"); return;
        }
        if (action.equals("retire") && args.length == 4) {
            sender.sendMessage(engineering.retire(args[3]) ? "场地已撤下，原快照/完成账本保留。" : "不能撤下：场地不存在、在办或正在扫描。"); return;
        }
        sender.sendMessage("用法：mycli admin market list|reload|register <场地ID>|retire <场地ID>|handovers|handover <已完成任务ID>");
    }

    void openMenu(Player player) {
        openMenu(player, 0);
    }
    private void openMenu(Player player, int page) {
        Inventory inventory = Bukkit.createInventory(null, 45, "任务市场 · 千灯纪委托");
        List<String> all = offers().stream().map(Task::id).toList();
        int pages = Math.max(1, (all.size() + 35) / 36); page = Math.max(0, Math.min(page, pages - 1));
        List<String> ids = all.subList(page * 36, Math.min(all.size(), page * 36 + 36));
        for (int i = 0; i < ids.size(); i++) {
            Task task = tasks.get(ids.get(i)); ItemStack item = new ItemStack(task.icon);
            var meta = item.getItemMeta(); meta.setDisplayName("§e" + task.title);
            meta.setLore(List.of(task.description, task.steps.size() + " 个阶段 · " + (task.project ? "公共工程仅结算一次" : task.repeatOnce ? "本人远行履历仅一次" : task.repeatDestination ? "每个新目的地一次，换图可继续" : "本人每日一次"),
                    "声望 +" + task.fame + " / 绿宝石 ×" + task.emeralds, "状态：" + state(task, player), "左键接单，右键看步骤"));
            item.setItemMeta(meta); inventory.setItem(i, item);
        }
        menuItem(inventory, 36, Material.BOOK, "§b当前任务", "查看当前进度");
        menuItem(inventory, 37, Material.SPYGLASS, "§b验收当前阶段", "真实方块/动作验收");
        menuItem(inventory, 38, Material.EMERALD, "§a交付当前阶段", "全部阶段完成后统一领奖");
        menuItem(inventory, 39, Material.BARRIER, "§c放弃任务", "已交付材料不返还；保留评估记录");
        menuItem(inventory, 40, Material.WRITABLE_BOOK, "§6我的能力记录", "已验收步骤、失败和耗时");
        menuItem(inventory,41,Material.WRITABLE_BOOK,"§6玩家委托","自行发布物资、讨伐与探索招募");
        menuItem(inventory,42,Material.CHEST,"§6个人箱分页","10页共540格，保留原槽位");
        if (page + 1 < pages) menuItem(inventory, 43, Material.ARROW, "§e下一页", (page + 1) + "/" + pages);
        menuItem(inventory, 44, Material.ARROW, page == 0 ? "§7返回公会" : "§e上一页", (page + 1) + "/" + pages);
        player.openInventory(inventory); menus.put(player.getUniqueId(), new Menu(inventory, ids, page, pages));
    }
    private void menuItem(Inventory inventory, int slot, Material material, String title, String lore) {
        ItemStack item = new ItemStack(material); var meta = item.getItemMeta(); meta.setDisplayName(title); meta.setLore(List.of(lore));
        item.setItemMeta(meta); inventory.setItem(slot, item);
    }
    @EventHandler public void click(InventoryClickEvent event) {
        if (!(event.getWhoClicked() instanceof Player player)) return;
        Menu menu = menus.get(player.getUniqueId());
        if (menu == null || event.getView().getTopInventory() != menu.inventory) return;
        event.setCancelled(true); int slot = event.getRawSlot();
        if (slot >= 0 && slot < menu.ids.size()) {
            if (event.isRightClick()) { Task task = tasks.get(menu.ids.get(slot)); if (task != null) detail(player, task); }
            else plugin.guild().command(player, new String[]{"guild", "accept", menu.ids.get(slot)});
        } else switch (slot) {
            case 36 -> plugin.guild().command(player, new String[]{"guild", "status"});
            case 37 -> plugin.guild().command(player, new String[]{"guild", "verify"});
            case 38 -> plugin.guild().command(player, new String[]{"guild", "claim"});
            case 39 -> plugin.guild().command(player, new String[]{"guild", "abandon"});
            case 40 -> assessment(player);
            case 41 -> Bukkit.getScheduler().runTask(plugin,()->plugin.playerContracts().open(player,1));
            case 42 -> Bukkit.getScheduler().runTask(plugin,()->plugin.dungeon().openStashPages(player));
            case 43 -> { if (menu.page + 1 < menu.pages) Bukkit.getScheduler().runTask(plugin, () -> openMenu(player, menu.page + 1)); }
            case 44 -> Bukkit.getScheduler().runTask(plugin, () -> { if (menu.page > 0) openMenu(player, menu.page - 1); else plugin.openGuildMenu(player); });
            default -> { }
        }
    }
    @EventHandler public void drag(InventoryDragEvent event) {
        Menu menu = menus.get(event.getWhoClicked().getUniqueId());
        if (menu != null && event.getView().getTopInventory() == menu.inventory) event.setCancelled(true);
    }
    @EventHandler public void close(InventoryCloseEvent event) {
        Menu menu = menus.get(event.getPlayer().getUniqueId());
        if (menu != null && event.getInventory() == menu.inventory) menus.remove(event.getPlayer().getUniqueId());
    }
    @EventHandler public void quit(org.bukkit.event.player.PlayerQuitEvent event) {
        maps.forget(event.getPlayer());
        exploration.quit(event.getPlayer());
        UUID id = event.getPlayer().getUniqueId(); menus.remove(id); lastCheck.remove(id); frozenTasks.remove(id);
    }
}
