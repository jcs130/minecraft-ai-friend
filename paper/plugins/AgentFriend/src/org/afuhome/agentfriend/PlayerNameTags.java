package org.afuhome.agentfriend;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.scheduler.BukkitTask;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.scoreboard.Team;

/** Adds a short vanilla nameplate prefix without replacing a viewer's scoreboard. */
final class PlayerNameTags implements Listener {
    private static final String TEAM_NAME = "qd_agents";
    private final AgentFriendPlugin plugin;
    private final Set<Scoreboard> touchedBoards = new HashSet<>();
    private final Set<UUID> agentUuids = new HashSet<>();
    private Component prefix;
    private BukkitTask task;

    PlayerNameTags(AgentFriendPlugin plugin) {
        this.plugin = plugin;
    }

    void start() {
        String label = plugin.getConfig().getString("nametags.agent-prefix", "[Agent] ");
        if (label == null || label.isBlank() || label.length() > 20
                || label.indexOf('\n') >= 0 || label.indexOf('\r') >= 0) {
            plugin.getLogger().warning("Invalid nametags.agent-prefix; using [Agent]");
            label = "[Agent] ";
        }
        prefix = Component.text(label, NamedTextColor.AQUA);
        for (String raw : plugin.getConfig().getStringList("nametags.agent-uuids")) {
            try {
                agentUuids.add(UUID.fromString(raw));
            } catch (IllegalArgumentException invalid) {
                plugin.getLogger().warning("Ignoring invalid nametags.agent-uuids entry: " + raw);
            }
        }
        Bukkit.getPluginManager().registerEvents(this, plugin);
        // A viewer can be given a custom scoreboard after joining. Reconcile the
        // board they actually use, preserving its objectives and sidebar.
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::reconcile, 2L, 40L);
    }

    void stop() {
        if (task != null) task.cancel();
        for (Scoreboard board : touchedBoards) {
            Team team = board.getTeam(TEAM_NAME);
            if (team != null) team.unregister();
        }
        touchedBoards.clear();
        agentUuids.clear();
    }

    @EventHandler public void onJoin(PlayerJoinEvent event) {
        Bukkit.getScheduler().runTaskLater(plugin, this::reconcile, 2L);
    }

    @EventHandler public void onQuit(PlayerQuitEvent event) {
        Bukkit.getScheduler().runTask(plugin, this::reconcile);
    }

    private void reconcile() {
        Set<Scoreboard> boards = new HashSet<>();
        for (Player viewer : Bukkit.getOnlinePlayers()) boards.add(viewer.getScoreboard());
        for (Scoreboard previous : new HashSet<>(touchedBoards)) {
            if (boards.contains(previous)) continue;
            Team abandoned = previous.getTeam(TEAM_NAME);
            if (abandoned != null) abandoned.unregister();
            touchedBoards.remove(previous);
        }
        for (Scoreboard board : boards) {
            Team team = board.getTeam(TEAM_NAME);
            if (team == null) team = board.registerNewTeam(TEAM_NAME);
            touchedBoards.add(board);
            if (!prefix.equals(team.prefix())) team.prefix(prefix);
            Set<String> wanted = new HashSet<>();
            for (Player player : Bukkit.getOnlinePlayers()) {
                if (!agentUuids.contains(player.getUniqueId())) continue;
                String name = player.getName();
                Team current = board.getEntryTeam(name);
                // Another plugin's team may carry gameplay rules. Do not steal it.
                if (current == null || current == team) {
                    wanted.add(name);
                    if (current == null) team.addEntry(name);
                }
            }
            for (String entry : new HashSet<>(team.getEntries())) {
                if (!wanted.contains(entry)) team.removeEntry(entry);
            }
        }
    }

}
