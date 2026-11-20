package org.qiandengji.villagerquests;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonPrimitive;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadLocalRandom;
import java.util.logging.Level;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Enemy;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;
import org.qiandengji.villagerquests.core.Area;
import org.qiandengji.villagerquests.core.Board;
import org.qiandengji.villagerquests.core.Commission;
import org.qiandengji.villagerquests.core.Policy;
import org.qiandengji.villagerquests.core.QuestType;
import org.qiandengji.villagerquests.core.Spool;
import org.qiandengji.villagerquests.core.StoryAuthor;
import org.qiandengji.villagerquests.core.StoryParser;
import org.qiandengji.villagerquests.core.Templates;
import org.qiandengji.villagerquests.core.Text;

/**
 * 千灯纪村民委托插件. Villagers post commissions on rules; players accept them here, and commissions nobody
 * takes are handed to the resident heroes through the Python bridge's file spool. Board state is touched only on
 * the main thread; story generation and durable file operations have separate workers.
 */
public final class VillagerQuestsPlugin extends JavaPlugin {
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
    private static final DateTimeFormatter ID_TIME = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss", Locale.ROOT);

    Board board;
    Villagers villagers;
    Rewards rewards;
    private VillagerDialogue dialogue;
    TaskCards taskCards;
    Listeners listeners;
    QuestCommand questCommand;
    private Spool spool;
    private StoryAuthor author;
    private ExecutorService io;
    private ExecutorService storyIo;
    private volatile boolean closing;
    private Path statePath;
    private long outboxOffset;
    private boolean dirty, outboxBusy;
    private final Map<String, Integer> llmCalls = new HashMap<>();
    private LocalDate llmDay = LocalDate.now();
    private final Set<String> authoring = new HashSet<>();
    private long storyGeneration, nextStoryNanos;
    private long nextTriggerAt;

    // settings
    boolean heroesEnabled;
    private long handoffGraceMs;
    private boolean speakHeroOffered;
    double speakRadius, deliverRadius;
    String speakFormat, privateFormat;
    private int llmDailyPerVillager;
    private long checkIntervalMs, storyIntervalNanos;
    private Map<String, String> heroNames = Map.of();
    private ConfigurationSection triggerConfig;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        closing = false;
        io = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "VillagerQuests-io");
            t.setDaemon(true);
            return t;
        });
        storyIo = Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "VillagerQuests-story");
            t.setDaemon(true);
            return t;
        });
        villagers = new Villagers(this);
        dialogue = new VillagerDialogue(this);
        rewards = new Rewards(this);
        statePath = getDataFolder().toPath().resolve("state.json");
        if (!reloadAll()) {
            getLogger().severe("Configuration invalid; plugin disabled. Nothing was changed.");
            Bukkit.getPluginManager().disablePlugin(this);
            return;
        }
        loadState();
        listeners = new Listeners(this);
        Bukkit.getPluginManager().registerEvents(listeners, this);
        questCommand = new QuestCommand(this);
        var vq = getCommand("vq");
        if (vq != null) { vq.setExecutor(questCommand); vq.setTabCompleter(questCommand); }
        Bukkit.getScheduler().runTaskTimer(this, this::tick, 40L, 40L);
    }

    /** Optional plugin-local bridge for the Adventurers' Guild menu and commands. */
    public String guildCommissions(Player player, String action, String questId) {
        return GuildBoard.request(this, player, action, questId).toString();
    }

    @Override
    public void onDisable() {
        closing = true;
        if (dialogue != null) dialogue.close();
        if (storyIo != null) storyIo.shutdownNow();
        if (board != null) {
            String snapshot = snapshot();
            try { writeState(snapshot, true); } catch (IOException e) { getLogger().log(Level.WARNING, "state not saved", e); }
        }
        if (io != null) io.shutdown();
    }

    // ---- configuration -------------------------------------------------------------------------------
    boolean reloadAll() {
        reloadConfig();
        var cfg = getConfig();
        try {
            JsonObject policyJson = toJson(cfg.getConfigurationSection("policy")).getAsJsonObject();
            JsonObject villagerJson = toJson(cfg.getConfigurationSection("villagers")).getAsJsonObject();
            policyJson.add("villagers", villagerJson);
            Policy policy = Policy.fromJson(policyJson);
            Map<String, Villagers.Spot> spots = new LinkedHashMap<>();
            Set<UUID> nativeVillagers = new HashSet<>();
            for (String id : policy.villagers.keySet()) {
                ConfigurationSection v = cfg.getConfigurationSection("villagers." + id);
                Location fallback = null;
                ConfigurationSection l = v.getConfigurationSection("location");
                if (l != null) {
                    World w = Bukkit.getWorld(l.getString("world", "world"));
                    if (w != null) fallback = new Location(w, l.getDouble("x"), l.getDouble("y"), l.getDouble("z"));
                }
                String npcId = policy.villagers.get(id).npcId();
                String entityId = v.getString("entityUuid");
                UUID entityUuid = null;
                if (entityId != null) {
                    entityUuid = UUID.fromString(entityId);
                    if (!entityUuid.toString().equals(entityId) || npcId != null || !nativeVillagers.add(entityUuid))
                        throw new IllegalArgumentException("villagers." + id + ".entityUuid must be a unique canonical UUID and replace npcId");
                }
                spots.put(id, new Villagers.Spot(id, policy.villagers.get(id).name(), npcId, entityUuid, fallback,
                        v.getDouble("areaRadius", 32), v.getString("persona", "")));
            }
            Map<String, String> heroes = new LinkedHashMap<>();
            ConfigurationSection hb = cfg.getConfigurationSection("heroes.bodies");
            if (hb != null) for (String uuid : hb.getKeys(false)) {
                UUID.fromString(uuid); // validates
                heroes.put(uuid, Text.clean(hb.getString(uuid, "英雄"), 32));
            }
            Path root = Path.of(cfg.getString("bridge.spoolDir", "villager-quests-spool"));
            root = (root.isAbsolute() ? root : getDataFolder().toPath().resolve(root)).toAbsolutePath().normalize();
            if (spool != null && !spool.root.equals(root)) {
                getLogger().warning("bridge.spoolDir cannot be changed by reload while the current spool has a live cursor");
                return false;
            }
            heroNames = Map.copyOf(heroes);
            if (board == null) board = new Board(policy, heroes.keySet()); else board.reconfigure(policy, heroes.keySet());
            villagers.configure(spots);
            heroesEnabled = cfg.getBoolean("heroes.enabled", false);
            handoffGraceMs = Math.max(0, cfg.getLong("heroes.handoffAfterMinutes", 10)) * 60_000L;
            speakHeroOffered = cfg.getBoolean("heroes.speakBridgeOffered", false);
            if (spool == null) spool = new Spool(root);
            speakRadius = cfg.getDouble("speech.radius", 32);
            deliverRadius = cfg.getDouble("speech.deliverRadius", 6);
            speakFormat = ChatColor.translateAlternateColorCodes('&', cfg.getString("speech.format", "&a{text}"));
            privateFormat = ChatColor.translateAlternateColorCodes('&', cfg.getString("speech.privateFormat", "&7[委托] &f{text}"));
            checkIntervalMs = Math.max(10, cfg.getInt("triggers.checkIntervalSeconds", 300)) * 1000L;
            nextTriggerAt = System.currentTimeMillis() + checkIntervalMs;
            triggerConfig = cfg.getConfigurationSection("villagers");
            llmDailyPerVillager = cfg.getInt("llm.dailyCallsPerVillager", 20);
            storyIntervalNanos = Math.max(10, cfg.getInt("llm.minIntervalSeconds", 10)) * 1_000_000_000L;
            author = buildAuthor(cfg.getConfigurationSection("llm"));
            storyGeneration++;
            rewards.configure(cfg.getConfigurationSection("rewards"));
            dialogue.configure(cfg.getConfigurationSection("dialogue"));
            taskCards = TaskCards.detect(this);
            getLogger().info("Loaded " + policy.villagers.size() + " villagers, " + heroes.size() + " hero bodies; story author: "
                    + (author == null ? "templates only" : author.name()) + "; spool: " + spool.root);
            return true;
        } catch (RuntimeException e) {
            getLogger().log(Level.SEVERE, "Bad configuration: " + e.getMessage(), e);
            return false;
        }
    }

    private StoryAuthor buildAuthor(ConfigurationSection llm) {
        if (llm == null) return null;
        String provider = llm.getString("provider", "none").toLowerCase(Locale.ROOT);
        Duration timeout = Duration.ofSeconds(Math.max(2, llm.getInt("timeoutSeconds", 15)));
        try {
            switch (provider) {
                case "mifan", "deepseek-plugin" -> {
                    Plugin ds = Bukkit.getPluginManager().getPlugin("DeepSeek");
                    if (ds == null || !ds.isEnabled()) { getLogger().warning("llm.provider=mifan but DeepSeek plugin is not enabled; using templates"); return null; }
                    return new StoryAuthor.MifanDeepSeek(ds.getClass().getClassLoader(), llm.getString("mifan.role", "委托编剧"));
                }
                case "openai", "openai-compatible", "http" -> {
                    String envName = llm.getString("http.apiKeyEnv", "VILLAGER_QUESTS_LLM_KEY");
                    String key = envName == null || envName.isBlank() ? null : System.getenv(envName);
                    if (key == null || key.isBlank()) key = llm.getString("http.apiKey", "");
                    if ((key == null || key.isBlank()) && llm.getBoolean("http.requireApiKey", true)) {
                        getLogger().warning("llm.provider=http but no key was configured in " + envName + "; using templates");
                        return null;
                    }
                    Boolean thinking = llm.isBoolean("http.enableThinking") ? llm.getBoolean("http.enableThinking") : null;
                    return new StoryAuthor.OpenAiCompatible(llm.getString("http.endpoint", "https://api.deepseek.com/chat/completions"), key,
                            llm.getString("http.model", "deepseek-chat"), llm.getDouble("temperature", 0.8), llm.getInt("maxTokens", 300),
                            timeout, llm.getBoolean("http.jsonMode", true), thinking);
                }
                default -> { return null; }
            }
        } catch (ReflectiveOperationException | RuntimeException e) {
            getLogger().warning("Story author unavailable (" + e.getClass().getSimpleName() + "); using templates");
            return null;
        }
    }

    static JsonElement toJson(Object value) {
        if (value instanceof ConfigurationSection s) {
            JsonObject o = new JsonObject();
            for (String k : s.getKeys(false)) o.add(k, toJson(s.get(k)));
            return o;
        }
        if (value instanceof Map<?, ?> m) {
            JsonObject o = new JsonObject();
            m.forEach((k, v) -> o.add(String.valueOf(k), toJson(v)));
            return o;
        }
        if (value instanceof List<?> l) {
            JsonArray a = new JsonArray();
            l.forEach(v -> a.add(toJson(v)));
            return a;
        }
        if (value instanceof Number n) return new JsonPrimitive(n);
        if (value instanceof Boolean b) return new JsonPrimitive(b);
        if (value == null) return new JsonObject();
        return new JsonPrimitive(String.valueOf(value));
    }

    // ---- state ---------------------------------------------------------------------------------------
    private void loadState() {
        if (!Files.exists(statePath)) return;
        try {
            JsonObject root = JsonParser.parseString(Files.readString(statePath, StandardCharsets.UTF_8)).getAsJsonObject();
            board.load(root.getAsJsonObject("board"));
            if (root.get("dialogue") instanceof JsonArray turns) dialogue.load(turns);
            outboxOffset = root.has("outboxOffset") ? root.get("outboxOffset").getAsLong() : 0;
        } catch (IOException | RuntimeException e) {
            getLogger().log(Level.SEVERE, "state.json unreadable; keeping it aside and starting empty", e);
            try { Files.move(statePath, statePath.resolveSibling("state.json.bad-" + System.currentTimeMillis())); } catch (IOException ignored) { }
        }
    }

    private String snapshot() {
        JsonObject root = new JsonObject();
        root.add("board", board.toJson());
        root.add("dialogue", dialogue.snapshot());
        root.addProperty("outboxOffset", outboxOffset);
        return GSON.toJson(root);
    }

    private synchronized void writeState(String json, boolean finalSave) throws IOException {
        if (closing && !finalSave) return;
        Files.createDirectories(statePath.getParent());
        Path tmp = statePath.resolveSibling("state.json.tmp");
        Files.writeString(tmp, json, StandardCharsets.UTF_8);
        Files.move(tmp, statePath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    void markDirty() { dirty = true; }

    // ---- main loop (main thread) ---------------------------------------------------------------------
    private void tick() {
        dialogue.heartbeat();
        long now = System.currentTimeMillis();
        for (Board.Quest q : board.expire(now)) {
            say(q.commission.issuer(), Templates.expired(name(q.commission.issuer())));
            taskCards.closed(q);
            dirty = true;
        }
        if (heroesEnabled && !heroNames.isEmpty()) for (Board.Quest q : board.dueForHandoff(now, handoffGraceMs)) handoff(q.id, now);
        for (Player p : Bukkit.getOnlinePlayers()) payOwed(p);
        pollOutbox();
        board.prune(now, 7L * 24 * 60 * 60 * 1000);
        if (now >= nextTriggerAt) {
            nextTriggerAt = now + checkIntervalMs;
            runTriggers();
        }
        if (dirty) {
            dirty = false;
            String json = snapshot();
            io.execute(() -> {
                try {
                    writeState(json, false);
                } catch (IOException e) {
                    getLogger().log(Level.WARNING, "state not saved", e);
                    if (!closing) Bukkit.getScheduler().runTask(this, this::markDirty);
                }
            });
        }
    }

    boolean handoff(String questId, long now) {
        if (!heroesEnabled || heroNames.isEmpty()) return false;
        Commission c;
        try { c = board.handoff(questId, now); } catch (Policy.Violation v) { return false; }
        dirty = true;
        say(c.issuer(), Templates.handedToHeroes(name(c.issuer())));
        io.execute(() -> {
            try {
                spool.writeCommission(c);
            } catch (IOException e) {
                getLogger().log(Level.WARNING, "inbox write failed for " + questId + "; commission goes back on the board", e);
                Bukkit.getScheduler().runTask(this, () -> { board.revertHandoff(questId); dirty = true; });
            }
        });
        return true;
    }

    private void pollOutbox() {
        if (outboxBusy || !heroesEnabled) return;
        outboxBusy = true;
        long from = outboxOffset;
        io.execute(() -> {
            Spool.Batch batch;
            try { batch = spool.readOutbox(from); } catch (IOException e) { batch = null; getLogger().log(Level.FINE, "outbox read failed", e); }
            Spool.Batch b = batch;
            Bukkit.getScheduler().runTask(this, () -> {
                outboxBusy = false;
                if (b == null) return;
                if (b.bad() > 0) getLogger().warning(b.bad() + " unreadable outbox line(s) skipped");
                for (Spool.OutboxLine line : b.lines()) applyOutbox(line);
                if (b.offset() != outboxOffset) { outboxOffset = b.offset(); dirty = true; }
            });
        });
    }

    private void applyOutbox(Spool.OutboxLine line) {
        Board.Quest q = board.get(line.questId());
        if (q == null || !q.commission.issuer().equals(line.villager())) return; // not ours, or villager mismatch
        boolean speak = !line.text().isEmpty() && (!"offered".equals(line.kind()) || speakHeroOffered);
        Board.Outcome o = board.heroFeedback(line.questId(), line.kind(), line.grantKey(), line.recipientBody());
        if ("not_hero_quest".equals(o.code())) return;
        if (speak) say(line.villager(), line.text());
        if (o.quest() != null && !o.quest().status.open()) taskCards.closed(o.quest());
        if ("recipient_not_hero".equals(o.code())) getLogger().warning("bridge asked to reward a body that is not a configured hero: " + line.questId());
        dirty = true;
        if (line.recipientBody() != null) {
            Player hero = Bukkit.getPlayer(UUID.fromString(line.recipientBody()));
            if (hero != null) payOwed(hero);
        }
    }

    /** Pays every reward owed to this player, once each. Main thread only. */
    void payOwed(Player p) {
        for (Board.Grant g : board.owedTo(p.getUniqueId().toString())) {
            if (!board.markPaid(g.key())) continue;
            rewards.give(p, g);
            dirty = true;
        }
    }

    // ---- authoring -----------------------------------------------------------------------------------
    private void runTriggers() {
        if (triggerConfig == null) return;
        for (String id : villagers.all().keySet()) {
            ConfigurationSection t = triggerConfig.getConfigurationSection(id + ".triggers");
            if (t == null) continue;
            try { trigger(id, t, false); } catch (RuntimeException e) { getLogger().log(Level.WARNING, "trigger for " + id + " failed", e); }
        }
    }

    /** Evaluates one villager's rules; {@code force} (admin) skips the random chance. Returns a status for the admin. */
    String trigger(String id, ConfigurationSection t, boolean force) {
        Location at = villagers.location(id);
        if (at == null || at.getWorld() == null) return "no_location";
        Villagers.Spot spot = villagers.spot(id);
        ConfigurationSection raid = t == null ? null : t.getConfigurationSection("nightRaid");
        if (raid != null && raid.getBoolean("enabled", true)) {
            long time = at.getWorld().getTime();
            boolean night = time >= 13000 && time <= 23000;
            if (night || force) {
                // The detection area is also the area where a kill counts.
                double r = Math.min(64, Math.min(raid.getDouble("radius", 48), spot.areaRadius()));
                if (!Double.isFinite(r) || r <= 0) return "bad_raid_radius";
                Map<String, Integer> counts = new HashMap<>();
                Set<String> allowed = board.policy().targets.getOrDefault(QuestType.SLAY, Set.of());
                for (Entity e : at.getWorld().getNearbyEntities(at, r, r, r)) {
                    if (!(e instanceof Enemy) || e.getLocation().distanceSquared(at) > r * r) continue;
                    String key = e.getType().getKey().toString();
                    if (allowed.contains(key)) counts.merge(key, 1, Integer::sum);
                }
                int total = counts.values().stream().mapToInt(Integer::intValue).sum();
                if (total >= raid.getInt("minHostiles", 6) && !counts.isEmpty()) {
                    String target = counts.entrySet().stream()
                            .max(Map.Entry.<String, Integer>comparingByValue().thenComparing(Map.Entry.comparingByKey())).orElseThrow().getKey();
                    String difficulty = raid.getString("difficulty", "easy");
                    int qty = Math.min(counts.get(target), board.policy().maxQuantity.getOrDefault(difficulty, 5));
                    return draft(id, QuestType.SLAY, target, qty, difficulty, raid.getInt("deadlineMinutes", 60),
                            new Area(at.getWorld().getName(), at.getX(), at.getY(), at.getZ(), r),
                            "夜里村子附近聚了 " + total + " 只怪物");
                }
            }
        }
        List<Map<?, ?>> requests = t == null ? List.of() : t.getMapList("requests");
        if (!requests.isEmpty()) {
            Map<?, ?> pick = requests.get(ThreadLocalRandom.current().nextInt(requests.size()));
            double chance = number(pick.get("chance"), 0.1);
            if (force || ThreadLocalRandom.current().nextDouble() < chance) {
                QuestType type = QuestType.parse(String.valueOf(pick.get("type")));
                Area area = type == QuestType.GATHER ? null : areaFrom(pick, at, spot.areaRadius());
                String target = type == QuestType.REACH ? "qiandengji:place" : String.valueOf(pick.get("target"));
                return draft(id, type, target, type == QuestType.REACH ? 1 : (int) number(pick.get("quantity"), 1),
                        String.valueOf(pick.containsKey("difficulty") ? pick.get("difficulty") : "easy"), (int) number(pick.get("deadlineMinutes"), 60),
                        area, pick.containsKey("reason") ? String.valueOf(pick.get("reason")) : "");
            }
        }
        return "no_rule_matched";
    }

    private static Area areaFrom(Map<?, ?> pick, Location at, double radius) {
        if (pick.get("area") instanceof Map<?, ?> a)
            return new Area(String.valueOf(a.containsKey("world") ? a.get("world") : at.getWorld().getName()), number(a.get("x"), at.getX()),
                    number(a.get("y"), at.getY()), number(a.get("z"), at.getZ()), number(a.get("radius"), radius));
        return new Area(at.getWorld().getName(), at.getBlockX(), at.getBlockY(), at.getBlockZ(), radius);
    }

    private static double number(Object o, double fallback) {
        return o instanceof Number n ? n.doubleValue() : fallback;
    }

    /** Builds a commission from rules, checks caps first (no model call if it would be rejected), then writes the story. */
    String draft(String villager, QuestType type, String target, int quantity, String difficulty, int minutes, Area area, String reason) {
        if (authoring.contains(villager)) return "busy";
        long now = System.currentTimeMillis();
        String commissionId = villager + "-" + LocalDateTime.now().format(ID_TIME) + "-" + Integer.toHexString(ThreadLocalRandom.current().nextInt(0x1000, 0x10000));
        String name = name(villager);
        Commission skeleton;
        try {
            skeleton = new Commission(commissionId, villager, type, target, quantity, area, difficulty, minutes, "委托", "");
            board.policy().check(skeleton, board.openCount(villager), board.openCount(null), board.issuedSince(villager, now - 86_400_000L));
        } catch (Policy.Violation v) {
            return v.code;
        } catch (IllegalArgumentException e) {
            return "invalid: " + e.getMessage();
        }
        StoryParser.Story fallback = Templates.fallback(skeleton, name, reason);
        StoryAuthor a = author;
        long storyNow = System.nanoTime();
        if (!LocalDate.now().equals(llmDay)) { llmDay = LocalDate.now(); llmCalls.clear(); }
        if (a == null || !authoring.isEmpty() || (nextStoryNanos != 0L && storyNow - nextStoryNanos < 0)
                || llmCalls.getOrDefault(villager, 0) >= llmDailyPerVillager) {
            publish(skeleton.withText(fallback.title(), fallback.story()), now);
            return "posted (template)";
        }
        llmCalls.merge(villager, 1, Integer::sum);
        authoring.add(villager);
        nextStoryNanos = storyNow + storyIntervalNanos;
        long generation = storyGeneration;
        String persona = villagers.spot(villager).persona();
        storyIo.execute(() -> {
            StoryParser.Story story = null;
            try {
                story = StoryParser.parse(a.complete(StoryAuthor.systemPrompt(persona), StoryAuthor.userPrompt(skeleton, name, reason))).orElse(null);
                if (story == null) getLogger().info("model reply for " + commissionId + " rejected by the strict parser; using template");
            } catch (Exception e) {
                getLogger().info("story author failed for " + commissionId + " (" + e.getClass().getSimpleName() + "); using template");
            }
            StoryParser.Story s = story != null ? story : fallback;
            if (!closing) Bukkit.getScheduler().runTask(this, () -> {
                authoring.remove(villager);
                if (storyGeneration != generation || villagers.location(villager) == null) return;
                publish(skeleton.withText(s.title(), s.story()), System.currentTimeMillis());
            });
        });
        return "authoring";
    }

    private void publish(Commission c, long now) {
        Board.Quest q;
        try { q = board.post(c, now); } catch (Policy.Violation v) { getLogger().info("commission " + c.commissionId() + " not posted: " + v.code); return; }
        dirty = true;
        say(c.issuer(), Templates.offered(name(c.issuer()), c));
        if (!c.story().isEmpty()) say(c.issuer(), name(c.issuer()) + "：" + c.story());
        taskCards.published(q);
        if (heroesEnabled && handoffGraceMs == 0 && c.type().heroCapable() && !heroNames.isEmpty()) handoff(q.id, now);
    }

    // ---- helpers -------------------------------------------------------------------------------------
    String name(String villager) {
        Villagers.Spot s = villagers.spot(villager);
        return s == null ? villager : s.name();
    }

    String heroName(String uuid) { return heroNames.getOrDefault(uuid, "英雄"); }

    void say(String villager, String text) { villagers.say(villager, text, speakRadius, speakFormat); }

    void tell(Player p, String text) { villagers.tell(p, text, privateFormat); }

    void writeSignal(Board.Evidence e, int counted) {
        JsonObject signal = Spool.signal(e, Math.max(1, counted));
        io.execute(() -> {
            try { spool.appendSignal(signal); } catch (IOException ex) { getLogger().log(Level.WARNING, "signal write failed for " + e.id(), ex); }
        });
    }

    Spool spool() { return spool; }

    StoryAuthor author() { return author; }

    List<String> villagerIds() { return new ArrayList<>(villagers.all().keySet()); }
}
