package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/** Read-only, paged discovery. Selecting a route does not enroll, change profession or replace a task. */
final class TaskRoutes implements Listener {
    private static final int PAGE_SIZE = 7;
    private static final String CHANNEL = "mcagent:tasks";
    private record Request(String action, String value, int page, boolean json) { }
    private record Menu(Inventory inventory, String kind, String route, int page, List<String> ids) { }
    private final AgentFriendPlugin plugin;
    private final TaskMarketManager market;
    private final Map<UUID, Menu> menus = new HashMap<>();
    TaskRoutes(AgentFriendPlugin plugin, TaskMarketManager market) {
        this.plugin = plugin; this.market = market;
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
    }
    private static Request parse(String[] args) {
        List<String> words = new ArrayList<>(); boolean json = false; int page = 1; boolean pageSet = false;
        for (int i = 1; i < args.length; i++) {
            String word = args[i];
            if (word.equals("--json")) { json = true; continue; }
            if (word.equals("--page")) {
                if (pageSet || i + 1 >= args.length) throw new IllegalArgumentException("页码格式为 --page 正整数");
                try { page = Integer.parseInt(args[++i]); }
                catch (NumberFormatException invalid) { throw new IllegalArgumentException("页码必须是正整数"); }
                pageSet = true; continue;
            }
            if (word.startsWith("-")) throw new IllegalArgumentException("未知参数 " + word);
            words.add(word);
        }
        String action = words.isEmpty() ? "list" : words.removeFirst().toLowerCase(Locale.ROOT);
        if (!List.of("list", "info", "status", "menu", "pause", "resume").contains(action) || words.size() > 1 || page < 1
                || List.of("info", "status", "pause", "resume").contains(action) && pageSet
                || action.equals("info") && words.size() != 1 || List.of("status", "pause", "resume").contains(action) && !words.isEmpty())
            throw new IllegalArgumentException("格式：tasks list [路线|all] [--page 页码]；info <任务ID>；status；menu [路线]；pause；resume");
        String value = words.isEmpty() ? "" : words.getFirst().toLowerCase(Locale.ROOT);
        if (!action.equals("info") && !value.isEmpty() && !value.equals("all") && TaskRouteCatalog.find(value) == null)
            throw new IllegalArgumentException("路线为 combat/crafting/exploration/supply/engineering/life");
        return new Request(action, value, page, json);
    }
    void command(Player p, String[] args) {
        boolean machine = Arrays.asList(args).contains("--json");
        try {
            Request q = parse(args);
            switch (q.action) {
                case "list" -> list(p, q, machine);
                case "info" -> {
                    var task = market.find(p, q.value);
                    if (task == null || !task.enabled()) throw new IllegalArgumentException("任务ID不存在；先 tasks list <路线> 查询实际ID");
                    emit(p, detail(p, task), machine);
                }
                case "status" -> {
                    JsonObject out = base("status"); JsonObject adventure = plugin.guild().progressState(p); out.add("adventure", adventure);
                    JsonObject life = plugin.lifeGuild().onboardingState(p); life.remove("availableId");
                    if (!life.get("activeId").getAsString().isEmpty()) {
                        life.addProperty("remaining", Math.max(0, life.get("target").getAsInt() - life.get("progress").getAsInt()));
                        life.addProperty("nextCommand", life.has("retired") ? "/mycli tasks list exploration" : life.get("ready").getAsBoolean() ? "/mycli life claim" : "/mycli life status");
                        life.addProperty("nextAction", life.has("retired") ? RetiredActivities.HINT : life.get("ready").getAsBoolean() ? "本生活委托条件已满足，用 /mycli life claim 本人交付。"
                                : life.get("instruction").getAsString() + "；" + (life.has("missingAdvice") ? life.get("missingAdvice").getAsString() : "按真实行动累计，库存搬运不能代替；完成后 life claim。"));
                    }
                    out.add("life", life);
                    out.add("pausedExploration", market.pausedState(p));
                    out.addProperty("nextCommand", "/mycli progress guild 1");
                    out.addProperty("advice", "委托按当前任务槽分别查询；每阶段交付，全部阶段完成才发最终奖。路线可随兴趣选择，不必先种田。");
                    if (adventure.has("market") && adventure.getAsJsonObject("market").has("guidance")) {
                        out.addProperty("nextCommand", adventure.get("nextCommand").getAsString());
                        out.addProperty("advice", adventure.get("advice").getAsString());
                    }
                    emit(p, out, machine);
                }
                case "pause", "resume" -> emit(p, market.pauseOrResume(p, q.action.equals("pause")), machine);
                case "menu" -> {
                    open(p, q.value, q.page);
                    JsonObject out = base("menu"); out.addProperty("status", "opened");
                    out.addProperty("nextCommand", "/mycli tasks status");
                    out.addProperty("advice", "选择路线、查看任务，再点击明确的接单按钮；浏览不会接单。"); emit(p, out, machine);
                }
                default -> throw new IllegalArgumentException();
            }
        } catch (IllegalArgumentException invalid) {
            JsonObject out = base("error"); out.addProperty("status", "denied"); out.addProperty("errorCode", "INVALID_ARGUMENT");
            out.addProperty("retryable", false); out.addProperty("advice", invalid.getMessage());
            out.addProperty("nextCommand", "/mycli tasks --help"); emit(p, out, machine);
        }
    }
    private JsonObject base(String type) {
        JsonObject out = new JsonObject(); out.addProperty("schemaVersion", 1); out.addProperty("type", type);
        out.addProperty("readOnly", !type.equals("menu")); out.addProperty("scope", "self");
        out.addProperty("suppliesCommand", "/mycli guild shared"); return out;
    }
    private List<TaskMarketManager.Task> offers(Player p, String route) {
        Map<String, String> states = new HashMap<>();
        for (var task : market.offers()) states.put(task.id(), market.offerState(task, p));
        return market.offers().stream().filter(t -> route.equals("all") || route.equals(t.route()))
                .sorted(Comparator.comparingInt((TaskMarketManager.Task t) -> TaskRouteCatalog.discoveryOrder(states.get(t.id()),
                                plugin.getConfig().contains("guild-players." + p.getUniqueId() + ".everDone." + t.id()), t.beginner()))
                        .thenComparingInt(TaskMarketManager.Task::minRank).thenComparing(TaskMarketManager.Task::id)).toList();
    }
    private JsonObject card(Player p, TaskMarketManager.Task task) {
        JsonObject row = new JsonObject(); row.addProperty("id", task.id()); row.addProperty("title", task.title());
        row.addProperty("route", task.route()); row.addProperty("beginner", task.beginner());
        row.addProperty("status", market.offerState(task, p)); row.addProperty("minRank", task.minRank());
        row.addProperty("stages", task.steps().size()); row.addProperty("fame", task.fame());
        row.addProperty("emeralds", task.emeralds()); row.addProperty("nextCommand", "/mycli tasks info " + task.id()); return row;
    }
    private void list(Player p, Request q, boolean machine) {
        JsonObject out = base(q.value.isEmpty() ? "routes" : "list"); JsonArray items = new JsonArray();
        if (q.value.isEmpty()) {
            if (q.page != 1) throw new IllegalArgumentException("路线目录只有一页；tasks list <路线> 查看该路线的任务");
            for (var route : TaskRouteCatalog.ROUTES) {
                JsonObject row = new JsonObject(); row.addProperty("id", route.id()); row.addProperty("title", route.title());
                row.addProperty("description", route.description()); row.addProperty("tasks", market.offers().stream().filter(t -> route.id().equals(t.route())).count());
                row.addProperty("nextCommand", "/mycli tasks list " + route.id()); items.add(row);
            }
            out.addProperty("page", 1); out.addProperty("pages", 1); out.addProperty("total", items.size());
            out.addProperty("advice", "先探索附近村路与画廊，再试普通试炼塔或遗迹地下城；制造、补给、工程、田园也可自选。tasks info <ID> 查条件，每阶段 guild claim。已有农事不妨碍独立参加 arena/dungeon；副本结算和委托交付分开。guild shared 查门口公共装备，门内私产不可取。");
        } else {
            var all = offers(p, q.value); int pages = Math.max(1, (all.size() + PAGE_SIZE - 1) / PAGE_SIZE);
            if (q.page > pages) throw new IllegalArgumentException("任务页码为 1–" + pages);
            for (var task : all.subList((q.page - 1) * PAGE_SIZE, Math.min(all.size(), q.page * PAGE_SIZE))) items.add(card(p, task));
            out.addProperty("route", q.value); out.addProperty("page", q.page); out.addProperty("pages", pages); out.addProperty("total", all.size());
            if (q.page < pages) out.addProperty("nextCommand", "/mycli tasks list " + q.value + " --page " + (q.page + 1));
            out.addProperty("advice", all.isEmpty() ? "本路线暂未开放委托；可选其他路线，旧生活委托见 life board。" : "在途、可接及未体验任务优先，已完成日常靠后；排序不改变资格。先 tasks info <ID> 读条件；beginner 是入门推荐，不自动接单。");
        }
        out.add("items", items); emit(p, out, machine);
    }
    private JsonObject detail(Player p, TaskMarketManager.Task task) {
        JsonObject out = base("info"); out.add("task", card(p, task));
        out.addProperty("title", task.title());
        out.addProperty("description", TaskGuidance.description(task.description()));
        out.addProperty("beneficiary", task.beneficiary()); out.addProperty("repeat", task.project() || task.repeatOnce() ? "once" : task.repeatDestination() ? "destination" : "daily");
        out.addProperty("acceptCommand", market.offerState(task, p).equals("paused") ? "/mycli tasks resume" : "/mycli guild accept " + task.id()); out.addProperty("submitCommand", "/mycli guild claim");
        out.addProperty("statusCommand", "/mycli tasks status"); out.addProperty("detailsCommand", "/mycli guild market " + task.id());
        out.addProperty("advice", "查看不接单、不换职业、不消耗资源。领取公共补给请到门口箱体，按需取用；回补按本单指定物资交付，满仓不扣物、不完成。");
        JsonArray steps = new JsonArray(); int n = 0;
        JsonObject current = market.progressState(p);
        for (var step : task.steps()) {
            JsonObject row = new JsonObject(); row.addProperty("stage", ++n); row.addProperty("title", step.title());
            row.addProperty("condition", TaskGuidance.step(step.goal(), step.description()));
            row.addProperty("goal", step.goal().name().toLowerCase(Locale.ROOT)); row.addProperty("target", step.target());
            if (step.site() != null) row.addProperty("itemOrSite", step.site());
            if (step.chest() >= 0) row.addProperty("publicChest", step.chest());
            if (step.floor() > 0) row.addProperty("floor", step.floor());
            if (step.combat() != null) row.add("combat", step.combat().json());
            if (step.exploration() != null) {
                row.add("exploration", step.exploration().json());
                row.addProperty("walkthrough", step.exploration().conditions(step.target()));
                boolean active = current.has("id") && current.get("id").getAsString().equals(task.id()) && current.get("stage").getAsInt() == n;
                // Local chains already expose the route in condition and the
                // frozen bounds/thresholds in exploration. Don't repeat a full
                // journal for every future stage in one info response.
                if (active || step.exploration().area() == null)
                    row.add("guidance", active ? current.getAsJsonObject("guidance") : market.planningGuidance(p, step));
            }
            if (step.map() != null) {
                row.add("mapHunt", step.map().json());
                if(current.has("id")&&current.get("id").getAsString().equals(task.id())&&current.get("stage").getAsInt()==n&&current.has("guidance"))row.add("guidance",current.get("guidance"));
            }
            if (step.exploration() == null && step.map() == null) {
                boolean active = current.has("id") && current.get("id").getAsString().equals(task.id()) && current.get("stage").getAsInt() == n;
                JsonObject guide = active ? current.getAsJsonObject("guidance") : TaskProgressGuidance.guide(task.contract(n - 1), 0,
                        step.combat() == null ? null : step.combat().json(), "", new JsonObject());
                if (!active) guide.addProperty("scope", "planning");
                row.add("guidance", guide);
            }
            steps.add(row);
        }
        out.add("steps", steps); return out;
    }
    private void emit(Player p, JsonObject out, boolean machine) {
        plugin.communication().stamp(p, out); byte[] bytes = out.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length <= 32_766) p.sendPluginMessage(plugin, CHANNEL, bytes);
        if (machine && out.toString().length() > 3200) {
            String refresh = out.has("task") ? "/mycli tasks info " + out.getAsJsonObject("task").get("id").getAsString() : "/mycli tasks status";
            plugin.communication().list(p, "tasks", refresh, List.of(out), 1);
        } else if (machine) p.sendMessage("MC_TASKS " + out);
        else human(p, out);
    }
    private void human(Player p, JsonObject out) {
        if (out.has("task")) p.sendMessage("§6【委托】" + out.getAsJsonObject("task").get("title").getAsString() + "：" + out.get("description").getAsString());
        if (out.has("items")) for (var element : out.getAsJsonArray("items")) {
            var row = element.getAsJsonObject();
            p.sendMessage("§b" + row.get("title").getAsString() + (row.has("status") ? " [" + TaskRouteCatalog.stateText(row.get("status").getAsString()) + "] " + row.get("id").getAsString() : " §7" + row.get("nextCommand").getAsString()));
        }
        if (out.has("steps")) for (var element : out.getAsJsonArray("steps")) {
            var step = element.getAsJsonObject(); p.sendMessage("§f" + step.get("stage").getAsInt() + ". " + step.get("condition").getAsString() + "（" + step.get("target").getAsInt() + "）");
            if (step.has("walkthrough")) p.sendMessage("§7" + step.get("walkthrough").getAsString());
            if (step.has("guidance")) TaskRouteCatalog.guidanceText(step.getAsJsonObject("guidance")).forEach(p::sendMessage);
        }
        if (out.has("adventure")) {
            var adventure = out.getAsJsonObject("adventure");
            p.sendMessage("§b【当前公会委托】" + adventure.get("title").getAsString()
                    + (adventure.has("progress") ? " " + adventure.get("progress") + "/" + adventure.get("target")
                    : adventure.get("activeId").getAsString().isEmpty() ? "：尚未接单" : "：在途记录暂不可读，请联系服主核对"));
            var life = out.getAsJsonObject("life");
            if (!life.get("activeId").getAsString().isEmpty()) p.sendMessage("§b【生活委托】" + life.get("title").getAsString() + " " + life.get("progress") + "/" + life.get("target"));
            if (life.has("nextAction")) p.sendMessage("§a生活下一步：" + life.get("nextAction").getAsString());
        }
        JsonObject paused = out.has("pausedExploration") ? out.getAsJsonObject("pausedExploration") : out.has("paused") ? out.getAsJsonObject("paused") : null;
        if (paused != null && paused.has("title")) p.sendMessage("§e【暂存远征】" + paused.get("title").getAsString() + "，第" + paused.get("stage") + "阶段；完成当前委托后 /mycli tasks resume 继续。");
        if (out.has("adventure") && out.getAsJsonObject("adventure").has("market")
                && out.getAsJsonObject("adventure").getAsJsonObject("market").has("guidance"))
            TaskRouteCatalog.guidanceText(out.getAsJsonObject("adventure").getAsJsonObject("market").getAsJsonObject("guidance")).forEach(p::sendMessage);
        else if (out.has("adventure") && out.getAsJsonObject("adventure").has("guidance"))
            TaskRouteCatalog.guidanceText(out.getAsJsonObject("adventure").getAsJsonObject("guidance")).forEach(p::sendMessage);
        else if (out.has("advice")) p.sendMessage("§7" + out.get("advice").getAsString());
        if (out.has("acceptCommand")) p.sendMessage("§a接单：" + out.get("acceptCommand").getAsString() + "；进度 /mycli tasks status");
        if (out.has("nextCommand")) p.sendMessage("§7下一步：" + out.get("nextCommand").getAsString());
    }
    private ItemStack item(String material, String title, String... lore) {
        ItemStack item = new ItemStack(Material.valueOf(material)); var meta = item.getItemMeta();
        meta.setDisplayName(title); List<String> lines = new ArrayList<>();
        for (String text : lore) for (int i = 0; i < text.length(); i += 32) lines.add("§7" + text.substring(i, Math.min(text.length(), i + 32)));
        meta.setLore(lines); item.setItemMeta(meta); return item;
    }
    void open(Player p, String route, int page) {
        Inventory inv; List<String> ids = new ArrayList<>(); String kind;
        if (route.isEmpty()) {
            if (page != 1) throw new IllegalArgumentException("路线菜单只有一页");
            inv = Bukkit.createInventory(null, 27, "选择委托路线 · 自由生活"); kind = "routes";
            for (var r : TaskRouteCatalog.ROUTES) { ids.add(r.id()); inv.setItem(10 + ids.size() - 1, item(r.icon(), "§e" + r.title(), r.description(), "点击查看；不会自动接单或转职")); }
            inv.setItem(22, item("BOOK", "§b我的委托进度", "主线、生活与冒险分开保存"));
            inv.setItem(23, item("CHEST", "§a门口公共补给", "查询武器、护甲、补给和杂物箱坐标", "门内私产不可拿；公共物资按需使用"));
            inv.setItem(24, item("ARROW", "§7返回公会", "返回原公会菜单"));
        } else {
            var all = offers(p, route); int pages = Math.max(1, (all.size() + 35) / 36);
            if (page > pages) throw new IllegalArgumentException("任务菜单页码超出范围");
            inv = Bukkit.createInventory(null, 45, "委托 · " + (route.equals("all") ? "全部" : TaskRouteCatalog.find(route).title()) + " " + page + "/" + pages); kind = "tasks";
            for (var task : all.subList((page - 1) * 36, Math.min(all.size(), page * 36))) {
                ids.add(task.id()); inv.setItem(ids.size() - 1, item(task.icon().name(), "§e" + task.title(), task.description(), "声望+" + task.fame() + "；" + task.steps().size() + "阶段", "点击看条件，下一页明确接单"));
            }
            inv.setItem(36, item("ARROW", "§b返回路线", "可随兴趣选择，没有种田前置"));
            if (page > 1) inv.setItem(37, item("ARROW", "§e上一页", "查看上一页"));
            if (page < pages) inv.setItem(38, item("ARROW", "§e下一页", "查看下一页"));
            inv.setItem(40, item("BOOK", "§b当前委托进度", "实际步骤及下一步"));
            inv.setItem(41, item("CHEST", "§a门口公共补给", "查询可用公共箱坐标"));
            if (route.equals("life")) inv.setItem(42, item("WHEAT", "§a七类生活公会", "旧生活委托也可完成新手任选实践"));
        }
        p.openInventory(inv); menus.put(p.getUniqueId(), new Menu(inv, kind, route, page, List.copyOf(ids)));
    }
    private void detailMenu(Player p, String id, String route, int page) {
        var task = market.find(p, id); if (task == null || !task.enabled()) return;
        Inventory inv = Bukkit.createInventory(null, 27, "委托详情 · " + task.title());
        List<String> lines = new ArrayList<>(); lines.add(task.description());
        for (var step : task.steps()) {
            lines.add(TaskGuidance.step(step.goal(), step.description()) + (step.exploration() == null ? " ×" + step.target() : ""));
            if (step.exploration() != null) {
                lines.add(step.exploration().conditions(step.target()));
                lines.add(market.planningGuidance(p, step).get("nextAction").getAsString());
            }
        }
        inv.setItem(13, item(task.icon().name(), "§e" + task.title(), lines.toArray(String[]::new)));
        inv.setItem(11, item("EMERALD", "§a接取这张委托", "主动接单才占公会任务槽", "当前有任务时保留原任务，不会覆盖"));
        inv.setItem(15, item("ARROW", "§b返回任务列表", "仅浏览不接单"));
        if (market.pausedState(p).has("id")) inv.setItem(22, item("BOOK", "§e恢复暂存远征", "仅空任务槽可恢复，保留原规则和进度", "/mycli tasks resume"));
        else if (market.frozen(p) != null) inv.setItem(22, item("BOOK", "§e暂存当前远征", "仅一次性纯探索个人委托可用", "先结束本人考试；不放弃、不清进度", "/mycli tasks pause"));
        p.openInventory(inv); menus.put(p.getUniqueId(), new Menu(inv, "detail", route, page, List.of(id)));
    }
    @EventHandler public void click(InventoryClickEvent event) {
        if (!(event.getWhoClicked() instanceof Player p)) return; Menu m = menus.get(p.getUniqueId());
        if (m == null || event.getView().getTopInventory() != m.inventory) return;
        event.setCancelled(true); int slot = event.getRawSlot();
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (!p.isOnline() || p.getOpenInventory().getTopInventory() != m.inventory) return;
            if (m.kind.equals("routes")) {
                if (slot >= 10 && slot < 10 + m.ids.size()) open(p, m.ids.get(slot - 10), 1);
                else if (slot == 22) command(p, new String[]{"tasks", "status"});
                else if (slot == 23) plugin.guildHall().storageInfo(p);
                else if (slot == 24) plugin.openGuildMenu(p);
            } else if (m.kind.equals("tasks")) {
                if (slot >= 0 && slot < m.ids.size()) detailMenu(p, m.ids.get(slot), m.route, m.page);
                else if (slot == 36) open(p, "", 1);
                else if (slot == 37 && m.inventory.getItem(slot) != null) open(p, m.route, m.page - 1);
                else if (slot == 38 && m.inventory.getItem(slot) != null) open(p, m.route, m.page + 1);
                else if (slot == 40) command(p, new String[]{"tasks", "status"});
                else if (slot == 41) plugin.guildHall().storageInfo(p);
                else if (slot == 42 && m.route.equals("life")) plugin.openLifeGuildMenu(p);
            } else if (m.kind.equals("detail")) {
                if (slot == 11) { p.closeInventory(); plugin.guild().command(p, new String[]{"guild", "accept", m.ids.getFirst()}); }
                else if (slot == 15) open(p, m.route, m.page);
                else if (slot == 22 && m.inventory.getItem(slot) != null) { p.closeInventory(); command(p, new String[]{"tasks", market.pausedState(p).has("id") ? "resume" : "pause"}); }
            }
        });
    }
    @EventHandler public void drag(InventoryDragEvent event) {
        Menu m = menus.get(event.getWhoClicked().getUniqueId());
        if (m != null && event.getView().getTopInventory() == m.inventory) event.setCancelled(true);
    }
    @EventHandler public void close(InventoryCloseEvent event) {
        Menu m = menus.get(event.getPlayer().getUniqueId());
        if (m != null && event.getInventory() == m.inventory) menus.remove(event.getPlayer().getUniqueId());
    }
}
