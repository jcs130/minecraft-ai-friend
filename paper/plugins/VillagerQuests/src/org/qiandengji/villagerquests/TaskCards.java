package org.qiandengji.villagerquests;

import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;
import org.qiandengji.villagerquests.core.Board;

/**
 * Optional AgentFriend integration point (task cards / shared reward queue).
 *
 * <p>AgentFriend 0.4.47 in this repo does not expose a public Java or Bukkit-service API for task cards or rewards
 * (its {@code resident-contracts.yml} cards are internal), so the only implementation today is a no-op that keeps
 * this plugin standalone. TODO: once AgentFriend registers a service (e.g. {@code ServicesManager}), add an
 * implementation that mirrors open commissions as cards and closes them here; completion must still come from
 * this plugin's evidence rules, never from AgentFriend's chat or self-reports.
 */
interface TaskCards {
    void published(Board.Quest quest);

    void closed(Board.Quest quest);

    TaskCards NONE = new TaskCards() {
        public void published(Board.Quest quest) { }
        public void closed(Board.Quest quest) { }
    };

    static TaskCards detect(VillagerQuestsPlugin plugin) {
        Plugin af = Bukkit.getPluginManager().getPlugin("AgentFriend");
        if (af != null && af.isEnabled())
            plugin.getLogger().info("AgentFriend " + af.getDescription().getVersion() + " found; it has no public task-card API yet, so commissions stay on this plugin's board");
        return NONE;
    }
}
