package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

/** Read actual ledgers, suggest one next step, and keep all actions player initiated. */
final class OnboardingGuide implements Listener {
    private static final List<String> STEPS = List.of("register", "guide_start", "catalog", "cast",
            "life_accept", "life_progress", "life_claim", "guild_accept", "guild_progress", "complete");
    private static final class Session {
        final long joined;
        long nextCheck;
        String pendingStep = "";
        long changedAt;
        Session(long now, long delay) { joined = now; nextCheck = now + delay; }
    }
    private static final class Holder implements InventoryHolder {
        final UUID owner;
        boolean consumed;
        Holder(UUID owner) { this.owner = owner; }
        @Override public Inventory getInventory() { return null; }
    }
    private record Step(String id, String detail, List<String> commands) { }
    private final AgentFriendPlugin plugin;
    private final File file;
    private final Map<UUID, Session> sessions = new HashMap<>();
    private final NamespacedKey welcomeRevision, welcomeAt, reminderAt, lastStep, mutedUntil, deliveredAt;
    private YamlConfiguration settings;

    OnboardingGuide(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        file = new File(plugin.getDataFolder(), "onboarding.yml");
        if (!file.exists()) plugin.saveResource("onboarding.yml", false);
        welcomeRevision = key("onboarding_welcome_revision"); welcomeAt = key("onboarding_welcome_at");
        reminderAt = key("onboarding_reminder_at"); lastStep = key("onboarding_last_step");
        mutedUntil = key("onboarding_muted_until"); deliveredAt = key("coach_delivered_at");
        if (!reload().equals("success")) {
            settings = YamlConfiguration.loadConfiguration(new InputStreamReader(
                    java.util.Objects.requireNonNull(plugin.getResource("onboarding.yml")), StandardCharsets.UTF_8));
            validate(settings);
        }
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }
    private NamespacedKey key(String name) { return new NamespacedKey(plugin, name); }
    private long ms(String name) { return settings.getLong(name) * 1000L; }
    private int revision() { return settings.getInt("welcome-revision"); }
    private void validate(YamlConfiguration c) {
        if (c.getInt("schema-version") != 1 || c.getInt("welcome-revision") < 1)
            throw new IllegalArgumentException("schema_or_revision");
        for (String key : List.of("enabled", "agents-only")) if (!c.isBoolean(key)) throw new IllegalArgumentException(key);
        for (String key : List.of("poll-seconds", "welcome-delay-seconds", "welcome-cooldown-seconds",
                "session-grace-seconds", "reminder-seconds", "progress-delay-seconds", "min-gap-seconds",
                "combat-quiet-seconds", "complete-reminder-seconds", "pause-seconds"))
            if (!c.isInt(key) && !c.isLong(key) || c.getLong(key) < 1 || c.getLong(key) > 604800)
                throw new IllegalArgumentException(key);
        List<String> intro = c.getStringList("welcome");
        if (intro.isEmpty() || intro.size() > 4) throw new IllegalArgumentException("welcome");
        for (String line : intro) validateText(line, 240);
        for (String id : STEPS) {
            validateText(c.getString("steps." + id + ".title", ""), 50);
            validateText(c.getString("steps." + id + ".message", ""), 360);
        }
    }
    private void validateText(String value, int maximum) {
        if (value.isBlank() || value.length() > maximum || value.indexOf('\n') >= 0
                || value.indexOf('\r') >= 0 || value.indexOf('\u0000') >= 0)
            throw new IllegalArgumentException("text");
    }
    String reload() {
        try {
            YamlConfiguration candidate = new YamlConfiguration(); candidate.load(file); validate(candidate);
            settings = candidate; sessions.values().forEach(s -> s.nextCheck = 0); return "success";
        } catch (Exception error) {
            plugin.getLogger().warning("Onboarding settings retained: " + error.getClass().getSimpleName());
            return "invalid_configuration";
        }
    }
    void joined(Player p) { sessions.put(p.getUniqueId(), new Session(System.currentTimeMillis(), ms("welcome-delay-seconds"))); }
    void forget(Player p) { sessions.remove(p.getUniqueId()); }
    void stop() { sessions.clear(); }
    long quietMillis() { return ms("combat-quiet-seconds"); }
    private long time(Player p, NamespacedKey key) { return p.getPersistentDataContainer().getOrDefault(key, PersistentDataType.LONG, 0L); }
    boolean gapReady(Player p, long now) { return now - time(p, deliveredAt) >= ms("min-gap-seconds"); }
    boolean paused(Player p, long now) { return now < time(p, mutedUntil); }
    void resume(Player p) { p.getPersistentDataContainer().remove(mutedUntil); }
    void delivered(Player p, long now) { p.getPersistentDataContainer().set(deliveredAt, PersistentDataType.LONG, now); }
    private boolean observer(Player p) { return plugin.isObserver(p); }
    private boolean target(Player p) {
        return !observer(p) && settings.getBoolean("enabled")
                && (!settings.getBoolean("agents-only") || plugin.isRegisteredAgent(p));
    }
    private boolean safe(Player p, long now, long quietUntil) {
        return p.getGameMode() == GameMode.SURVIVAL && !p.isDead() && !plugin.isDowned(p)
                && !plugin.dungeonParticipant(p) && !plugin.pvpParticipant(p) && now >= quietUntil
                && p.getOpenInventory().getTopInventory().getType() == InventoryType.CRAFTING;
    }
    boolean poll(Player p, long now, long quietUntil) {
        Session session = sessions.computeIfAbsent(p.getUniqueId(), id -> new Session(now, ms("welcome-delay-seconds")));
        if (now < session.nextCheck) return false;
        if (!target(p) || now < time(p, mutedUntil)) {
            session.nextCheck = now + ms("poll-seconds"); return false;
        }
        boolean welcomeDue = p.getPersistentDataContainer().getOrDefault(welcomeRevision, PersistentDataType.INTEGER, 0) != revision()
                || now - time(p, welcomeAt) >= ms("welcome-cooldown-seconds");
        // A new arrival closing their first menu should not have to wait a whole polling minute.
        // This only checks a player's safety/PDC; ledgers are read after the checks pass.
        session.nextCheck = now + (welcomeDue ? 1000L : ms("poll-seconds"));
        if (!safe(p, now, quietUntil) || !gapReady(p, now)) return false;
        session.nextCheck = now + ms("poll-seconds");
        JsonObject state = state(p); String current = state.get("step").getAsString();
        String stored = p.getPersistentDataContainer().getOrDefault(lastStep, PersistentDataType.STRING, "");
        if (welcomeDue) {
            show(p, state, "welcome", true);
            p.getPersistentDataContainer().set(welcomeRevision, PersistentDataType.INTEGER, revision());
            p.getPersistentDataContainer().set(welcomeAt, PersistentDataType.LONG, now);
        } else {
            if (now - session.joined < ms("session-grace-seconds")) return false;
            if (!stored.equals(current)) {
                if (!session.pendingStep.equals(current)) { session.pendingStep = current; session.changedAt = now; return false; }
                if (now - session.changedAt < ms("progress-delay-seconds")) return false;
            } else if (now - time(p, reminderAt) < ms(current.equals("complete") ? "complete-reminder-seconds" : "reminder-seconds")) return false;
            show(p, state, "reminder", false);
        }
        p.getPersistentDataContainer().set(lastStep, PersistentDataType.STRING, current);
        p.getPersistentDataContainer().set(reminderAt, PersistentDataType.LONG, now);
        session.pendingStep = ""; delivered(p, now); return true;
    }
    private boolean flag(JsonObject o, String key) { return o.has(key) && o.get(key).getAsBoolean(); }
    private String value(JsonObject o, String key) { return o.has(key) ? o.get(key).getAsString() : ""; }
    JsonObject state(Player p) {
        JsonObject out = new JsonObject(); out.addProperty("eligible", !observer(p));
        out.addProperty("player", p.getName()); out.addProperty("playerUuid", p.getUniqueId().toString());
        out.addProperty("automaticTarget", target(p)); out.addProperty("revision", revision());
        out.addProperty("mutedUntil", time(p, mutedUntil));
        if (observer(p)) { out.addProperty("reason", "observer"); return out; }
        JsonObject guide = plugin.worldLife().guideState(p), life = plugin.lifeGuild().onboardingState(p), guild = plugin.guild().onboardingState(p);
        boolean enrolled = flag(guide, "started"), catalog = flag(guide, "catalog"), cast = flag(guide, "cast"), lived = flag(guide, "life");
        boolean registered = flag(guild, "joined"), commissioned = guild.get("completed").getAsInt() > 0;
        Step step;
        if (!registered) step = new Step("register", "", List.of("/mycli guild join", "/mycli guild trader"));
        else if (!enrolled) step = new Step("guide_start", "", List.of("/mycli world guide start"));
        else if (!catalog) step = new Step("catalog", "", List.of("/mycli skills list common", "/mycli skills info fireworks"));
        else if (!cast) {
            boolean known = plugin.professions().level(p, "fireworks") > 0;
            step = new Step("cast", known ? "已学烟花术，可用 /mycli cast fireworks；1魔力，10秒冷却。也可成功施放任一已学技能。"
                    : "例如先 /mycli skills info fireworks；愿意花1技能点时 /mycli skills learn fireworks，再 cast fireworks（1魔力）。也可选别的已学技能。",
                    known ? List.of("/mycli cast fireworks", "/mycli status")
                            : List.of("/mycli skills info fireworks", "/mycli skills points", "/mycli skills learn fireworks", "/mycli cast fireworks"));
        } else if (!lived) {
            String id = value(life, "activeId");
            if (id.isEmpty()) {
                String available = value(life, "availableId");
                step = new Step("life_accept", available.isEmpty() ? "今日七项生活委托都已交付，可明天继续；已完成的旧委托不会追记为报名后的实习。"
                        : "可先接 " + available + "；生活任务与冒险委托使用不同任务槽。",
                        available.isEmpty() ? List.of("/mycli life status") : List.of("/mycli life board", "/mycli life accept " + available));
            } else if (flag(life, "ready")) step = new Step("life_claim", value(life, "title") + " " + life.get("progress") + "/" + life.get("target"), List.of("/mycli life claim"));
            else step = new Step("life_progress", value(life, "title") + " " + life.get("progress") + "/" + life.get("target") + "；" + value(life, "instruction"), List.of("/mycli life status", "/mycli life locations"));
        } else if (!commissioned) {
            if (!value(guild, "activeId").isEmpty()) step = new Step("guild_progress", "当前委托 " + value(guild, "activeId") + "；先查真实阶段，完成一阶段后交付。", List.of("/mycli guild status", "/mycli guild claim"));
            else if (plugin.taskMarket().offered("tm_first_spell") != null) step = new Step("guild_accept", "推荐小满的实操委托 tm_first_spell：先接单，再成功施法并到补给商真实交易；每阶段 guild claim。", List.of("/mycli guild market tm_first_spell", "/mycli guild accept tm_first_spell"));
            else step = new Step("guild_accept", "选择一张符合当前等级的委托，先读条件再接单。", List.of("/mycli guild board"));
        } else step = new Step("complete", "已完成登记、实习三项证明和首张冒险委托。可按兴趣探索、做居民事务、结伴挑战、聊村民或记录生活。", List.of("/mycli world board", "/mycli world npcs", "/mycli world events", "/mycli world photos", "/mycli skills list profession"));
        out.addProperty("step", step.id()); out.addProperty("title", settings.getString("steps." + step.id() + ".title"));
        out.addProperty("message", settings.getString("steps." + step.id() + ".message") + (step.detail().isEmpty() ? "" : " " + step.detail()));
        out.addProperty("nextCommand", step.commands().getFirst()); JsonArray commands = new JsonArray(); step.commands().forEach(commands::add); out.add("commands", commands);
        out.addProperty("completed", step.id().equals("complete"));
        JsonArray checklist = new JsonArray();
        milestone(checklist, "register", "冒险者登记", registered); milestone(checklist, "guide_start", "报名新手实习", enrolled);
        milestone(checklist, "catalog", "读取技能目录", catalog); milestone(checklist, "cast", "成功施放一次技能", cast);
        milestone(checklist, "life", "完成并交付生活委托", lived); milestone(checklist, "commission", "交付首张冒险委托", commissioned);
        out.add("serverFeatures", plugin.featureTutorials().state(p));
        out.add("checklist", checklist); out.add("guide", guide); out.add("life", life); out.add("guild", guild);
        return out;
    }
    private void milestone(JsonArray list, String id, String title, boolean done) {
        JsonObject item = new JsonObject(); item.addProperty("id", id); item.addProperty("title", title); item.addProperty("done", done); list.add(item);
    }
    private void show(Player p, JsonObject state, String type, boolean full) {
        if (!flag(state, "eligible")) { p.sendMessage("§7观战账号不参加新手引导。 "); return; }
        if (full) for (String line : settings.getStringList("welcome")) p.sendMessage("§6[系统·迎新] §f" + line);
        p.sendMessage("§b[系统·旅途导师] " + state.get("title").getAsString() + "：§f" + state.get("message").getAsString());
        p.sendMessage(Component.text("[查看下一步]", NamedTextColor.AQUA).clickEvent(ClickEvent.runCommand("/mycli coach next"))
                .append(Component.text("  /mycli coach menu 打开入门页；coach later 暂停" + ms("pause-seconds") / 60_000 + "分钟，coach off 关闭。", NamedTextColor.GRAY)));
        JsonObject result = state.deepCopy(); result.addProperty("schemaVersion", 1); result.addProperty("type", type);
        result.addProperty("reason", "onboarding"); result.addProperty("source", "server_observed_state");
        result.addProperty("statusCommand", "/mycli coach next"); result.addProperty("menuCommand", "/mycli coach menu");
        result.addProperty("helpCommand", "/mycli help"); result.addProperty("listCommand", "/mycli list");
        result.addProperty("featureLessonsCommand", "/mycli coach lessons");
        result.addProperty("backpackCommand", "/minepacks:backpack open");
        result.addProperty("stateCommand", "/mycli status"); result.addProperty("skillsCommand", "/mycli skills list common");
        JsonObject tasks = new JsonObject(); tasks.addProperty("adventureBoard", "/mycli guild board");
        tasks.addProperty("adventureStatus", "/mycli guild status"); tasks.addProperty("lifeBoard", "/mycli life board");
        tasks.addProperty("lifeStatus", "/mycli life status"); tasks.addProperty("tutorial", "/mycli world guide start");
        result.add("taskCommands", tasks);
        if (!full) { result.remove("checklist"); result.remove("guide"); result.remove("life"); result.remove("guild"); }
        p.sendMessage("MC_COACH " + result);
    }
    void guide(Player p, boolean full) { show(p, state(p), full ? "guide" : "next", full); }
    void pause(Player p) {
        p.getPersistentDataContainer().set(mutedUntil, PersistentDataType.LONG, System.currentTimeMillis() + ms("pause-seconds"));
        p.sendMessage("§7个人提醒已暂停 " + ms("pause-seconds") / 60_000 + " 分钟；仍可主动 coach next/menu 查询。");
    }
    void admin(CommandSender sender, String[] args) {
        if (args.length != 3) { sender.sendMessage("用法：mycli admin coach reload|audit"); return; }
        if (args[2].equalsIgnoreCase("reload")) { sender.sendMessage("MC_COACH_RELOAD status=" + reload() + " revision=" + revision()); return; }
        if (!args[2].equalsIgnoreCase("audit")) { sender.sendMessage("用法：mycli admin coach reload|audit"); return; }
        int targets = 0;
        for (Player p : Bukkit.getOnlinePlayers()) if (target(p)) {
            targets++; JsonObject state = state(p);
            sender.sendMessage("MC_COACH_PLAYER name=" + p.getName() + " step=" + value(state, "step")
                    + " completed=" + flag(state, "completed") + " muted=" + (System.currentTimeMillis() < time(p, mutedUntil)));
        }
        sender.sendMessage("MC_COACH_AUDIT ready=true revision=" + revision() + " targets=" + targets + " pollSeconds=" + ms("poll-seconds") / 1000);
    }
    private ItemStack icon(Material material, String name, String... lore) {
        ItemStack stack = new ItemStack(material); ItemMeta meta = stack.getItemMeta(); meta.setDisplayName(name);
        java.util.ArrayList<String> lines = new java.util.ArrayList<>();
        for (String line : lore) {
            for (int offset = 0; offset < line.length();) {
                int end = line.offsetByCodePoints(offset, Math.min(26, line.codePointCount(offset, line.length())));
                lines.add(line.substring(offset, end)); offset = end;
            }
        }
        meta.setLore(lines); stack.setItemMeta(meta); return stack;
    }
    void menu(Player p) {
        JsonObject state = state(p); if (!flag(state, "eligible")) { p.sendMessage("§7观战账号不参加新手引导。"); return; }
        Inventory inv = Bukkit.createInventory(new Holder(p.getUniqueId()), 27, "千灯纪 · 新手入门与下一步");
        JsonArray milestones = state.getAsJsonArray("checklist");
        for (int i = 0; i < milestones.size(); i++) {
            JsonObject milestone = milestones.get(i).getAsJsonObject(); boolean done = flag(milestone, "done");
            inv.setItem(i, icon(done ? Material.LIME_DYE : Material.PAPER, (done ? "§a✓ " : "§7○ ") + value(milestone, "title"), "服务器实际进度；查看不会代完成"));
        }
        inv.setItem(13, icon(Material.COMPASS, "§b下一步：" + value(state, "title"), value(state, "message"), value(state, "nextCommand"), "点击只显示指引，不自动执行建议"));
        inv.setItem(18, icon(Material.CHEST, "§e服务器特色实练与大背包", "报名六项可选实践；大背包54格，先存再取，不是任务袋"));
        inv.setItem(19, icon(Material.NAME_TAG, "§6冒险者登记", "点击登记；已登记时只查看状态，不花魔力"));
        inv.setItem(20, icon(Material.WRITABLE_BOOK, "§a报名新手实习", "点击自愿开始；不代学技能，不发完成奖励"));
        inv.setItem(21, icon(Material.BOOK, "§d读取基础技能目录", "只读目录；报名后记第一项实习证明"));
        inv.setItem(22, icon(Material.WHEAT, "§a生活公会看板", "先接单，再亲自完成，最后交付"));
        inv.setItem(23, icon(Material.BELL, "§6居民事务板", "实际进度、任务详情与接单入口"));
        inv.setItem(24, icon(Material.CLOCK, "§7暂停提醒", "暂停" + ms("pause-seconds") / 60_000 + "分钟，查询照常"));
        inv.setItem(26, icon(Material.BARRIER, "§c关闭")); p.openInventory(inv);
    }
    @EventHandler public void onClick(InventoryClickEvent event) {
        if (!(event.getView().getTopInventory().getHolder() instanceof Holder holder)) return;
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player p) || !p.getUniqueId().equals(holder.owner) || holder.consumed
                || event.isShiftClick() || event.getRawSlot() < 0 || event.getRawSlot() >= 27) return;
        int slot = event.getRawSlot(); if (!List.of(13,18,19,20,21,22,23,24,26).contains(slot)) return;
        holder.consumed = true; p.closeInventory();
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (!p.isOnline() || observer(p)) return;
            switch (slot) {
                case 13 -> guide(p, false);
                case 18 -> plugin.featureTutorials().show(p);
                case 19 -> plugin.guild().command(p, new String[]{"guild", "join"});
                case 20 -> plugin.worldLife().command(p, new String[]{"world", "guide", "start"});
                case 21 -> p.performCommand("mycli skills list common");
                case 22 -> plugin.openLifeGuildMenu(p);
                case 23 -> plugin.worldLife().command(p, new String[]{"world", "board", "menu"});
                case 24 -> pause(p);
                default -> { }
            }
        });
    }
    @EventHandler public void onDrag(InventoryDragEvent event) {
        if (event.getView().getTopInventory().getHolder() instanceof Holder) event.setCancelled(true);
    }
}
