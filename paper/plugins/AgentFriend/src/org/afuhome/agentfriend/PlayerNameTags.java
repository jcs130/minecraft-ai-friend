package org.afuhome.agentfriend;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.scheduler.BukkitTask;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.scoreboard.Team;

/** Vanilla scoreboard prefixes for Agent identity and adventurer guild rank. */
final class PlayerNameTags implements Listener {
    private static final String AGENT_TEAM = "qd_agents";
    private static final String[] RANKS = {"青铜", "黑铁", "白银", "黄金", "白金", "钻石"};
    private static final NamedTextColor[] COLORS = {NamedTextColor.GOLD, NamedTextColor.GRAY,
            NamedTextColor.WHITE, NamedTextColor.YELLOW, NamedTextColor.LIGHT_PURPLE,
            NamedTextColor.AQUA};
    private static final Set<String> OWN_TEAMS = teamNames();
    private final AgentFriendPlugin plugin;
    private final Set<Scoreboard> touchedBoards = new HashSet<>();
    private final Set<UUID> agentUuids = new HashSet<>();
    private Component agentPrefix;
    private BukkitTask task;

    PlayerNameTags(AgentFriendPlugin plugin) { this.plugin = plugin; }

    private static Set<String> teamNames() {
        Set<String> names = new HashSet<>();
        names.add(AGENT_TEAM);
        for (int rank = 0; rank < RANKS.length; rank++) {
            names.add("qd_rank_" + rank);
            names.add("qd_arank_" + rank);
        }
        return Set.copyOf(names);
    }

    void start() {
        String label = plugin.getConfig().getString("nametags.agent-prefix", "[Agent] ");
        if (label == null || label.isBlank() || label.length() > 20
                || label.indexOf('\n') >= 0 || label.indexOf('\r') >= 0) {
            plugin.getLogger().warning("Invalid nametags.agent-prefix; using [Agent]");
            label = "[Agent] ";
        }
        agentPrefix = Component.text(label, NamedTextColor.AQUA);
        for (String raw : plugin.getConfig().getStringList("nametags.agent-uuids")) {
            try { agentUuids.add(UUID.fromString(raw)); }
            catch (IllegalArgumentException invalid) {
                plugin.getLogger().warning("Ignoring invalid nametags.agent-uuids entry: " + raw);
            }
        }
        Bukkit.getPluginManager().registerEvents(this, plugin);
        // A viewer can receive a custom sidebar later. Update their actual board
        // without replacing objectives or another plugin's gameplay team.
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::reconcile, 2L, 40L);
    }

    void stop() {
        if (task != null) task.cancel();
        for (Scoreboard board : touchedBoards) removeOwnedTeams(board);
        touchedBoards.clear();
        agentUuids.clear();
    }

    @EventHandler public void onJoin(PlayerJoinEvent event) {
        Bukkit.getScheduler().runTaskLater(plugin, this::reconcile, 2L);
    }

    @EventHandler public void onQuit(PlayerQuitEvent event) {
        Bukkit.getScheduler().runTask(plugin, this::reconcile);
    }

    private void removeOwnedTeams(Scoreboard board) {
        for (String name : OWN_TEAMS) {
            Team team = board.getTeam(name);
            if (team != null) team.unregister();
        }
    }

    private String desiredTeam(Player player) {
        if (player.getGameMode() == GameMode.SPECTATOR) return null;
        boolean agent = agentUuids.contains(player.getUniqueId());
        if (plugin.guildMember(player)) {
            int rank = Math.max(0, Math.min(RANKS.length - 1, plugin.adventurerRank(player)));
            return (agent ? "qd_arank_" : "qd_rank_") + rank;
        }
        return agent ? AGENT_TEAM : null;
    }

    private Component prefix(String teamName) {
        if (AGENT_TEAM.equals(teamName)) return agentPrefix;
        boolean agent = teamName.startsWith("qd_arank_");
        int rank = teamName.charAt(teamName.length() - 1) - '0';
        Component badge = Component.text("◆" + RANKS[rank] + " ", COLORS[rank]);
        return agent ? badge.append(agentPrefix) : badge;
    }

    private void reconcile() {
        Set<Scoreboard> boards = new HashSet<>();
        for (Player viewer : Bukkit.getOnlinePlayers()) boards.add(viewer.getScoreboard());
        for (Scoreboard previous : new HashSet<>(touchedBoards)) {
            if (boards.contains(previous)) continue;
            removeOwnedTeams(previous);
            touchedBoards.remove(previous);
        }
        for (Scoreboard board : boards) {
            touchedBoards.add(board);
            Map<String, Set<String>> wanted = new HashMap<>();
            for (Player player : Bukkit.getOnlinePlayers()) {
                String entry = player.getName();
                Team current = board.getEntryTeam(entry);
                if (current != null && !OWN_TEAMS.contains(current.getName())) continue;
                String desired = desiredTeam(player);
                if (desired == null) {
                    if (current != null) current.removeEntry(entry);
                    continue;
                }
                Team target = board.getTeam(desired);
                if (target == null) target = board.registerNewTeam(desired);
                Component label = prefix(desired);
                if (!label.equals(target.prefix())) target.prefix(label);
                wanted.computeIfAbsent(desired, ignored -> new HashSet<>()).add(entry);
                if (current != target) {
                    if (current != null) current.removeEntry(entry);
                    target.addEntry(entry);
                }
            }
            for (String name : OWN_TEAMS) {
                Team team = board.getTeam(name);
                if (team == null) continue;
                Set<String> keep = wanted.getOrDefault(name, Set.of());
                for (String entry : new HashSet<>(team.getEntries())) {
                    if (!keep.contains(entry)) team.removeEntry(entry);
                }
            }
        }
    }
}
