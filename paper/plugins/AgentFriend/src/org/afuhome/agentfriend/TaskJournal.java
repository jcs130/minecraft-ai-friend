package org.afuhome.agentfriend;

import com.google.gson.*;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.inventory.*;
import org.bukkit.inventory.*;

/** Own-player journal. Observation never enrolls, pays, verifies or dispatches commands. */
final class TaskJournal implements Listener {
    private final AgentFriendPlugin plugin;
    private record Menu(UUID owner, List<String> ids, String filter, int page) { }
    private final Map<Inventory, Menu> menus = new IdentityHashMap<>();
    TaskJournal(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }
    static boolean matches(String[] args) {
        List<String> words = Arrays.stream(args).filter(s -> !s.equals("--json")).toList();
        return !words.isEmpty() && (words.getFirst().equalsIgnoreCase("journal")
                || words.size() >= 2 && words.getFirst().equalsIgnoreCase("tasks") && words.get(1).equalsIgnoreCase("overview"));
    }
    private static String text(JsonObject row, String key, String fallback) { return TaskJournalModel.text(row, key, fallback); }
    private static boolean flag(JsonObject row, String key) { return TaskJournalModel.flag(row, key); }
    private void add(List<JsonObject> rows, String group, String system, String id, String title,
                     JsonObject source, String read, String submit) {
        rows.add(TaskJournalModel.item(group, system, id, title, source, read, submit));
    }
    List<JsonObject> rows(Player p) {
        List<JsonObject> rows = new ArrayList<>();
        JsonObject academy = plugin.skillAssessments().summary(p);
        add(rows, "guild", "assessment", text(academy, "examId", "promotion"),
                academy.has("examId") ? "当前实操与晋级" : "公会声望与段位", academy,
                academy.has("examId") ? "/mycli guild exam status" : "/mycli guild exam promotion",
                academy.has("examId") ? "/mycli guild exam submit" : "");
        JsonObject life = plugin.lifeGuild().taskState(p);
        String lifeId = text(life, "activeId", text(life, "id", ""));
        if (!lifeId.isEmpty()) add(rows, "guild", "contract", lifeId, text(life, "title", "生活委托"), life,
                "/mycli guild status", "/mycli guild claim");
        JsonObject guild = plugin.guild().progressState(p);
        String guildId = text(guild, "activeId", "");
        if (!guildId.isEmpty()) add(rows, "guild", "contract", guildId, text(guild, "title", "公会委托"), guild,
                "/mycli guild status", "/mycli guild claim");
        if (plugin.playerContracts() != null) for (JsonObject row : plugin.playerContracts().journalRows(p))
            add(rows, "guild", "commission", text(row, "id", "unknown"), text(row, "title", "玩家委托"), row,
                    "/mycli guild commission info " + text(row, "id", ""),
                    flag(row, "isRunner") ? "/mycli guild commission claim " + text(row, "id", "") : "");
        if (plugin.siteDungeons() != null) for (JsonObject row : plugin.siteDungeons().journalRows(p)) {
            String id = text(row, "id", "unknown");
            boolean reward = text(row, "kind", "").equals("reward");
            add(rows, "guild", reward ? "site_reward" : "dungeon", id, text(row, "title", "遗迹攻略"), row,
                    "/mycli dungeon status " + id, reward ? "/mycli dungeon claim " + id : "");
        }
        JsonObject trial = plugin.dungeon().guidance(p);
        if (flag(trial, "participant") || trial.has("lastOutcome")) {
            if (!flag(trial, "participant") && trial.get("lastOutcome").isJsonObject()) {
                JsonObject last = trial.getAsJsonObject("lastOutcome");
                trial.addProperty("state", text(last, "outcome", "unknown").equals("won") ? "completed" : "failed");
            }
            add(rows, "guild", "trial", text(trial, "run", "last"), "试炼塔", trial,
                    "/mycli arena status", "");
        }
        for (JsonObject row : plugin.nativeRpg().taskRows(p)) {
            String id = text(row, "id", "unknown");
            add(rows, "guild", "native_task", id, text(row, "title", "职业委托"), row,
                    flag(row,"available") ? "/mycli tasks status " + id : "/mycli tasks status", "/mycli tasks claim " + id);
        }
        if (plugin.worldLife() != null && plugin.worldLife().story() != null) {
            JsonObject story = plugin.worldLife().story().state(p);
            add(rows, "guild", "story", text(story, "chapter", "current"), "剧情手记", story,
                    "/mycli world story status", "");
        }
        JsonObject lifeSkills = plugin.lifeGuild().skillState(p);
        add(rows, "skills", "skill_progress", "life", "生活技艺熟练度", lifeSkills, "/mycli skills", "");
        JsonObject foundation;
        try { foundation = FoundationGrowth.view(p); }
        catch (RuntimeException unavailable) { foundation = new JsonObject(); foundation.addProperty("available", false); foundation.addProperty("reason", "foundation_unavailable"); }
        JsonObject brief = new JsonObject();
        brief.addProperty("available", flag(foundation, "available"));
        brief.addProperty("authority", "AuraSkills");
        if (foundation.has("skills")) {
            List<String> values = new ArrayList<>();
            for (JsonElement value : foundation.getAsJsonArray("skills")) {
                JsonObject row = value.getAsJsonObject();
                values.add(text(row, "name", text(row, "id", "")) + " " + text(row, "level", "未知"));
            }
            brief.addProperty("nextAction", String.join("、", values));
        }
        add(rows, "skills", "skill_progress", "foundation", "基础熟练度与被动", brief, "/mycli skills", "");
        JsonObject profession = plugin.nativeRpg().professionOverview(p);
        add(rows, "skills", "skill_progress", "profession", "职业、技能、天赋与学习点", profession, "/mycli profession", "");
        for (JsonObject row : plugin.agentEntry().progressRows(p, "training")) {
            if (flag(row, "done")) continue;
            add(rows, "skills", "training", text(row, "id", "practice"), text(row, "title", "特色实练"), row,
                    "/mycli progress training", "");
        }
        return TaskJournalModel.unique(rows);
    }
    void command(Player p, String[] raw) {
        boolean json = Arrays.asList(raw).contains("--json");
        List<String> args = new ArrayList<>(Arrays.stream(raw).filter(s -> !s.equals("--json")).toList());
        if (!args.isEmpty() && args.getFirst().equalsIgnoreCase("tasks")) args.remove(1);
        if (Arrays.stream(raw).anyMatch(s -> s.equals("--help") || s.equals("-h"))) {
            p.sendMessage("/mycli journal [all|guild|skills] [页码] [--json]；journal menu；journal submit <itemId>。查询不接单、不领奖。");
            return;
        }
        if (args.size() == 3 && args.get(1).equalsIgnoreCase("submit")) {
            if(json){plugin.communication().error(p,"UNSUPPORTED_FORMAT","提交沿用原生领域回执，本次未执行；去掉--json后由你确认。",false,"/mycli journal");return;}
            submit(p, args.get(2)); return;
        }
        boolean gui = args.size() > 1 && args.get(1).equalsIgnoreCase("menu");
        String filter = args.size() > 1 && !gui ? args.get(1).toLowerCase(Locale.ROOT) : "all";
        int page = 1;
        try {
            if (args.size() > (gui ? 4 : 3)) throw new IllegalArgumentException("arguments");
            if (gui && args.size() > 2) filter = args.get(2).toLowerCase(Locale.ROOT);
            if (args.size() > (gui ? 3 : 2)) page = Integer.parseInt(args.get(gui ? 3 : 2));
            JsonObject out = TaskJournalModel.page(rows(p), filter, page);
            out.addProperty("subjectUuid", p.getUniqueId().toString()); out.addProperty("scope", "self");
            out.addProperty("storageUncertain", Boolean.TRUE.equals(DurableConfigStore.audit(plugin).get("commitUnknown")));
            plugin.communication().stamp(p, out);
            if (gui) { menu(p, out, filter, page); return; }
            if (json) { p.sendMessage("MC_JOURNAL " + out); return; }
            p.sendMessage("§6【任务中心 · 公会 / 技能】第 " + page + "/" + out.get("pages") + " 页");
            for (JsonElement value : out.getAsJsonArray("items")) {
                JsonObject row = value.getAsJsonObject();
                p.sendMessage("§e[" + (text(row, "group", "guild").equals("guild") ? "公会" : "技能") + "] "
                        + row.get("title").getAsString() + " · " + text(row, "state", "unknown"));
                p.sendMessage("§7" + shortText(text(row, "nextAction", "")) + " §a" + text(row, "nextCommand", "/mycli journal"));
                if (row.has("journalSubmitCommand")) p.sendMessage("§a验收并提交：" + row.get("journalSubmitCommand").getAsString());
            }
            if (out.has("nextCommand")) p.sendMessage("§a下一页：" + out.get("nextCommand").getAsString());
        } catch (IllegalArgumentException invalid) {
            plugin.communication().error(p, "INVALID_ARGUMENT", "任务中心只接受 all|guild|skills 与有效页码；查询不会修改进度。", false, "/mycli journal");
        }
    }
    private static String shortText(String text) { return text.length() > 180 ? text.substring(0, 180) + "…" : text; }
    private void submit(Player p, String id) {
        JsonObject row = rows(p).stream().filter(r -> r.get("itemId").getAsString().equals(id)).findFirst().orElse(null);
        if (row == null || !row.has("submitCommand") || Boolean.TRUE.equals(DurableConfigStore.audit(plugin).get("commitUnknown"))) {
            plugin.communication().error(p, "TASK_NOT_SUBMITTABLE", "当前没有可提交的本人事项；先查询任务中心，不重放旧领取。", false, "/mycli journal");
            return;
        }
        String system = row.get("sourceSystem").getAsString();
        String source = row.get("sourceId").getAsString();
        switch (system) {
            case "assessment" -> plugin.skillAssessments().command(p, new String[]{"guild", "exam", "submit"});
            case "contract" -> plugin.guild().command(p, new String[]{"guild", "claim"});
            case "commission" -> plugin.playerContracts().command(p, new String[]{"commission", "claim", source});
            case "site_reward" -> plugin.siteDungeons().command(p, new String[]{"dungeon", "claim", source});
            case "native_task" -> plugin.nativeRpg().delegate(p, "tasks", "claim", source);
            default -> throw new IllegalStateException("Unsupported server-owned journal action");
        }
        // Keep the original domain receipt authoritative: an async enqueue is not a completed goal.
        p.sendMessage("§7已按当前事项进入原生验收；是否交付以原回执为准。/mycli journal 复查，未知结果不要重复提交。");
    }
    private ItemStack icon(Material material, String title, String... lore) {
        ItemStack item = new ItemStack(material); var meta = item.getItemMeta();
        meta.setDisplayName(title); meta.setLore(List.of(lore)); item.setItemMeta(meta); return item;
    }
    private void menu(Player p, JsonObject out, String filter, int page) {
        Inventory inventory = Bukkit.createInventory(null, 27, "任务中心 · 公会 / 技能");
        List<String> ids = new ArrayList<>(); int slot = 0;
        for (JsonElement value : out.getAsJsonArray("items")) {
            JsonObject row = value.getAsJsonObject(); ids.add(row.get("itemId").getAsString());
            inventory.setItem(slot++, icon(row.has("submitCommand") ? Material.EMERALD : Material.BOOK,
                    row.get("title").getAsString(), text(row, "state", "unknown"), shortText(text(row, "nextAction", "")),
                    text(row, "nextCommand", "/mycli journal"), row.has("submitCommand") ? "点击进入原生验收；不会跳过缺项" : "只读事项；点击查看详情"));
        }
        inventory.setItem(18, icon(Material.ARROW, "上一页"));
        inventory.setItem(20, icon(Material.WRITABLE_BOOK, "公会事项"));
        inventory.setItem(22, icon(Material.BOOK, "技能进度"));
        inventory.setItem(26, icon(Material.ARROW, "下一页"));
        menus.put(inventory, new Menu(p.getUniqueId(), List.copyOf(ids), filter, page)); p.openInventory(inventory);
    }
    @EventHandler(priority = EventPriority.HIGHEST)
    public void click(InventoryClickEvent event) {
        Menu menu = menus.get(event.getView().getTopInventory()); if (menu == null) return;
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player p) || !menu.owner().equals(p.getUniqueId())) return;
        int slot = event.getRawSlot(); if (slot < 0 || slot >= event.getView().getTopInventory().getSize()) return;
        p.closeInventory();
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (!p.isOnline()) return;
            if (slot < menu.ids().size()) {
                String id = menu.ids().get(slot);
                JsonObject row = rows(p).stream().filter(r -> r.get("itemId").getAsString().equals(id)).findFirst().orElse(null);
                if (row != null && row.has("submitCommand")) submit(p, id);
                else command(p, new String[]{"journal", menu.filter(), Integer.toString(menu.page())});
            } else if (slot == 20 || slot == 22) command(p, new String[]{"journal", "menu", slot == 20 ? "guild" : "skills", "1"});
            else if (slot == 18 || slot == 26) command(p, new String[]{"journal", "menu", menu.filter(), Integer.toString(Math.max(1, menu.page() + (slot == 18 ? -1 : 1)))});
        });
    }
    @EventHandler(priority = EventPriority.HIGHEST)
    public void drag(InventoryDragEvent event) { if (menus.containsKey(event.getView().getTopInventory())) event.setCancelled(true); }
    @EventHandler public void close(InventoryCloseEvent event) { menus.remove(event.getInventory()); }
}
