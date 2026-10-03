package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
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
    private Set<String> registeredAgentNames = Set.of();
    private Path pairsFile;
    private String pairsError = "";
    private int refreshTicks;
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
        pairsFile = Path.of(plugin.getConfig().getString("nametags.eye-pairs-file",
                "E:/MC/ops/agent-eye-pairs.json"));
        refreshAgentNames();
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
        registeredAgentNames = Set.of();
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
        boolean agent = isAgent(player);
        if (plugin.guildMember(player)) {
            int rank = Math.max(0, Math.min(RANKS.length - 1, plugin.adventurerRank(player)));
            return (agent ? "qd_arank_" : "qd_rank_") + rank;
        }
        return agent ? AGENT_TEAM : null;
    }

    boolean isAgent(Player player) {
        return player.getGameMode() != GameMode.SPECTATOR
                && (agentUuids.contains(player.getUniqueId())
                || registeredAgentNames.contains(player.getName().toLowerCase(Locale.ROOT)));
    }

    private void refreshAgentNames() {
        try {
            JsonObject root = JsonParser.parseString(Files.readString(pairsFile, StandardCharsets.UTF_8))
                    .getAsJsonObject();
            if (root.get("schemaVersion").getAsInt() != 1) throw new IllegalArgumentException("schemaVersion");
            JsonArray entries = root.getAsJsonArray("pairs");
            if (entries == null || entries.size() > 16) throw new IllegalArgumentException("pairs");
            Set<String> names = new HashSet<>();
            Set<String> eyes = new HashSet<>();
            for (JsonElement element : entries) {
                JsonObject pair = element.getAsJsonObject();
                String agent = pair.get("agent").getAsString();
                String eye = pair.has("eye") ? pair.get("eye").getAsString() : agent + "_eye";
                String name = agent.toLowerCase(Locale.ROOT);
                String camera = eye.toLowerCase(Locale.ROOT);
                if (!agent.matches("[A-Za-z0-9_]{1,16}") || !eye.matches("[A-Za-z0-9_]{1,16}")
                        || name.equals(camera) || name.equals("goddess") || camera.equals("goddess")
                        || !names.add(name) || !eyes.add(camera))
                    throw new IllegalArgumentException("invalid pair");
            }
            if (names.stream().anyMatch(eyes::contains)) throw new IllegalArgumentException("Agent is an Eye");
            registeredAgentNames = Set.copyOf(names);
            pairsError = "";
        } catch (Exception error) {
            registeredAgentNames = Set.of();
            String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            if (!message.equals(pairsError)) plugin.getLogger().warning("Agent pairs rejected: " + message);
            pairsError = message;
        }
    }

    private Component prefix(String teamName) {
        if (AGENT_TEAM.equals(teamName)) return agentPrefix;
        boolean agent = teamName.startsWith("qd_arank_");
        int rank = teamName.charAt(teamName.length() - 1) - '0';
        Component badge = Component.text("◆" + RANKS[rank] + " ", COLORS[rank]);
        return agent ? badge.append(agentPrefix) : badge;
    }

    private void reconcile() {
        if (++refreshTicks % 3 == 0) refreshAgentNames();
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
