package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import java.util.*;
import org.bukkit.Bukkit;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;

/** Completion receipts are saved with the guild ledger, then applied to the land registry. */
final class ProjectHandovers {
    record Grant(String landId, String site, boolean landmark) { }
    private static final String ROOT = "task-market.projects.";
    private final AgentFriendPlugin plugin;
    private final EngineeringSites engineering;
    ProjectHandovers(AgentFriendPlugin plugin, EngineeringSites engineering) {
        this.plugin = plugin; this.engineering = engineering;
    }
    static Grant parse(ConfigurationSection task, boolean project, List<TaskMarketManager.Step> steps) {
        if (!task.contains("handover")) return null;
        ConfigurationSection row = task.getConfigurationSection("handover");
        if (!project || row == null || !Set.of("land-id", "site", "landmark").containsAll(row.getKeys(false)))
            throw new IllegalArgumentException("handover requires a project and land-id/site/landmark fields");
        String id = row.getString("land-id", ""), site = row.getString("site", "");
        if (!id.matches("[a-z0-9][a-z0-9_-]{0,39}") || id.equals(LandManager.GUILD)
                || steps.stream().noneMatch(s -> s.goal() == GuildManager.Goal.BUILD && site.equals(s.site())))
            throw new IllegalArgumentException("handover must name this task's BUILD site and a distinct land ID");
        if (row.contains("landmark") && !row.isBoolean("landmark")) throw new IllegalArgumentException("handover.landmark must be boolean");
        return new Grant(id, site, row.getBoolean("landmark", true));
    }
    String available(TaskMarketManager.Task task, String run) {
        if (task.grant() == null) return "available";
        EngineeringSites.Site site = engineering.site(task.grant().site());
        if (site == null) return "site_unavailable";
        if (Bukkit.getWorld(site.world()) == null || !Bukkit.getWorld(site.world()).getUID().toString().equals(
                plugin.getConfig().getString(EngineeringSites.ROOT + "." + site.id() + ".world-id", ""))) return "site_world_changed";
        return plugin.lands().projectAvailability(task.grant().landId(), task.id(), run, site);
    }
    boolean beforeComplete(Player player, TaskMarketManager.Task task, String run) {
        String gate = available(task, run);
        if (task.grant() != null && gate.equals("available")) {
            String denial = plugin.lands().projectConfigurationDenial(); if (denial != null) gate = denial;
        }
        if (gate.equals("available") || gate.equals("already_applied")) return true;
        player.sendMessage("§c建筑管理权暂不能交接（" + gate + "），任务和奖励保留待交付；请联系女神检查领地配置。");
        return false;
    }
    void record(TaskMarketManager.Task task, UUID owner, String run) {
        Grant grant = task.grant(); if (grant == null) return;
        EngineeringSites.Site site = engineering.site(grant.site());
        String base = ROOT + task.id() + ".handover.";
        plugin.getConfig().set(base + "state", "pending");
        plugin.getConfig().set(base + "land-id", grant.landId());
        plugin.getConfig().set(base + "title", task.title());
        plugin.getConfig().set(base + "landmark", grant.landmark());
        plugin.getConfig().set(base + "owner", owner.toString());
        plugin.getConfig().set(base + "run", run);
        plugin.getConfig().set(base + "site", grant.site());
        plugin.getConfig().createSection(base + "definition", site.save());
        plugin.getConfig().set(base + "world-id", plugin.getConfig().getString(EngineeringSites.ROOT + "." + site.id() + ".world-id", ""));
    }
    void apply(String task, CommandSender sender) {
        String base = ROOT + task;
        ConfigurationSection receipt = plugin.getConfig().getConfigurationSection(base + ".handover");
        if (receipt == null) return;
        String result = "invalid_receipt";
        try {
            if (!plugin.getConfig().getBoolean(base + ".completed") || !task.matches("tm_[a-z0-9_]{2,40}"))
                throw new IllegalArgumentException("project has not completed");
            UUID owner = UUID.fromString(receipt.getString("owner", ""));
            String run = receipt.getString("run", ""); UUID.fromString(run);
            if (!owner.toString().equals(plugin.getConfig().getString(base + ".completed-by"))
                    || !run.equals(plugin.getConfig().getString(base + ".completed-run", run)))
                throw new IllegalArgumentException("completion identity changed");
            String id = receipt.getString("land-id", ""), title = receipt.getString("title", "");
            if (!id.matches("[a-z0-9][a-z0-9_-]{0,39}") || id.equals(LandManager.GUILD)) throw new IllegalArgumentException("invalid land ID");
            EngineeringSites.Site site = EngineeringSites.parse(receipt.getString("site", ""), receipt.getConfigurationSection("definition"));
            if (!site.equals(engineering.site(site.id())) || !engineering.completed(site.id())
                    || Bukkit.getWorld(site.world()) == null
                    || !Bukkit.getWorld(site.world()).getUID().toString().equals(receipt.getString("world-id"))
                    || !receipt.getString("world-id", "").equals(plugin.getConfig().getString(EngineeringSites.ROOT + "." + site.id() + ".world-id", "")))
                throw new IllegalArgumentException("site or world no longer matches receipt");
            result = plugin.lands().grantProject(id, title, owner, task, run, site, receipt.getBoolean("landmark"));
            if (result.equals("applied") || result.equals("already_applied")) {
                plugin.getConfig().set(base + ".handover.state", "applied");
                plugin.getConfig().set(base + ".handover.applied-at", System.currentTimeMillis());
            }
            plugin.getConfig().set(base + ".handover.last-result", result);
            plugin.saveConfig();
            if (sender instanceof Player player) player.sendMessage((result.equals("applied") || result.equals("already_applied") ? "§a" : "§e")
                    + (result.equals("applied") || result.equals("already_applied")
                    ? "建筑已登记为领地「" + id + "」；主人可管理建造和储物。" + (receipt.getBoolean("landmark")
                    ? "站到建筑内安全平地，用 /mycli landmark publish " + id + " <名字> 登记公共传送落点；也可用罗盘的公共地标菜单。" : "")
                    : "奖励已结算，管理权交接待重试：" + result + "；请联系女神，不要重复领奖。"));
        } catch (Exception error) {
            plugin.getLogger().warning("Project handover retained for retry: " + task + " " + error.getMessage());
        }
        JsonObject json = new JsonObject(); json.addProperty("task", task);
        json.addProperty("status", result.equals("applied") || result.equals("already_applied") ? "success" : "pending");
        json.addProperty("reason", result); json.addProperty("landId", receipt.getString("land-id", ""));
        json.addProperty("ownerUuid", receipt.getString("owner", ""));
        sender.sendMessage("MC_PROJECT_HANDOVER " + json);
    }
    void recover(CommandSender sender) {
        ConfigurationSection all = plugin.getConfig().getConfigurationSection("task-market.projects");
        if (all == null) return;
        for (String id : all.getKeys(false)) if (all.contains(id + ".handover")
                && !all.getString(id + ".handover.state", "pending").equals("applied")) apply(id, sender);
    }
    /** Explicit legacy adoption: requires the original completed run and a verified BUILD step. */
    void adopt(TaskMarketManager.Task task, CommandSender sender) {
        String base = ROOT + task.id();
        if (plugin.getConfig().contains(base + ".handover")) { apply(task.id(), sender); return; }
        if (task.grant() == null || !plugin.getConfig().getBoolean(base + ".completed")) {
            sender.sendMessage("MC_PROJECT_HANDOVER {\"status\":\"denied\",\"reason\":\"completed_project_with_handover_required\"}"); return;
        }
        try {
            UUID owner = UUID.fromString(plugin.getConfig().getString(base + ".completed-by", ""));
            long at = plugin.getConfig().getLong(base + ".completed-at");
            List<Map<?, ?>> history = plugin.getConfig().getMapList("task-market.assessments." + owner + ".history");
            for (Map<?, ?> row : history) {
                if (!task.id().equals(row.get("task")) || !"completed".equals(row.get("outcome"))
                        || !(row.get("at") instanceof Number number) || Math.abs(at - number.longValue()) > 5000
                        || !(row.get("steps") instanceof List<?> steps)) continue;
                boolean verified = steps.stream().anyMatch(value -> {
                    if (!(value instanceof Map<?, ?> step) || !"build".equals(step.get("goal"))
                            || !task.grant().site().equals(step.get("site")) || !(step.get("target") instanceof Number n)) return false;
                    try { return com.google.gson.JsonParser.parseString(String.valueOf(step.get("evidence"))).getAsJsonObject()
                            .get("newBlocks").getAsInt() >= n.intValue(); } catch (Exception invalid) { return false; }
                });
                if (!verified) continue;
                String run = String.valueOf(row.get("run")); UUID.fromString(run);
                if (!engineering.completed(task.grant().site())) break;
                record(task, owner, run); plugin.getConfig().set(base + ".completed-run", run);
                plugin.saveConfig(); apply(task.id(), sender); return;
            }
        } catch (Exception invalid) { plugin.getLogger().warning("Legacy handover refused: " + invalid); }
        sender.sendMessage("MC_PROJECT_HANDOVER {\"status\":\"denied\",\"reason\":\"verified_completion_history_required\"}");
    }
}
