package org.afuhome.agentfriend;

import org.afuhome.eye.EyePairs;
import java.util.List;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
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
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.scheduler.BukkitTask;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.scoreboard.Team;

/** Vanilla scoreboard prefixes for Agent identity and adventurer guild rank. */
final class PlayerNameTags implements Listener {
    private static final String PHOTO_OBSERVER_NAME = "ag_PhotoLens";
    private static final UUID PHOTO_OBSERVER_UUID = UUID.fromString("ff58a81b-f033-3b74-a7cf-58ac4e798bb0");
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
    private Map<String, String> registeredEyes = Map.of();
    private JsonObject eyeRules;
    private Path pairsFile;
    private String pairsError = "";
    private int refreshTicks;
    private Component agentPrefix;
    private final Map<String, Component> prefixes = new HashMap<>();
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
        registeredEyes = Map.of();
        prefixes.clear();
    }

    // EssentialsX can capture this message for a separate, delayed broadcast.
    @EventHandler(priority = EventPriority.LOWEST) public void onJoin(PlayerJoinEvent event) {
        if (isServiceObserver(event.getPlayer())) event.joinMessage(null);
        Bukkit.getScheduler().runTaskLater(plugin, this::reconcile, 2L);
    }

    @EventHandler(priority = EventPriority.HIGHEST) public void onQuit(PlayerQuitEvent event) {
        if (isServiceObserver(event.getPlayer())) event.quitMessage(null);
        Bukkit.getScheduler().runTask(plugin, this::reconcile);
    }

    private void removeOwnedTeams(Scoreboard board) {
        for (String name : OWN_TEAMS) {
            Team team = board.getTeam(name);
            if (team != null) team.unregister();
        }
    }

    private String desiredTeam(Player player) {
        if (isObserver(player)) return null;
        boolean agent = isAgent(player);
        if (plugin.guildMember(player)) {
            int rank = Math.max(0, Math.min(RANKS.length - 1, plugin.adventurerRank(player)));
            return (agent ? "qd_arank_" : "qd_rank_") + rank;
        }
        return agent ? AGENT_TEAM : null;
    }

    boolean isAgent(Player player) {
        return !isObserver(player)
                && (agentUuids.contains(player.getUniqueId())
                || registeredAgentNames.contains(player.getName().toLowerCase(Locale.ROOT)));
    }
    boolean isObserver(Player player) {
        return player.getGameMode() == GameMode.SPECTATOR || player.getName().equalsIgnoreCase("Goddess")
                || isServiceObserver(player);
    }

    private boolean isServiceObserver(Player player) {
        return isPhotoObserver(player)
                || eyeRules != null && (EyePairs.freeObserver(eyeRules, player.getName())
                || registeredEyes.containsKey(player.getName().toLowerCase(Locale.ROOT)));
    }

    private static boolean isPhotoObserver(Player player) {
        return PHOTO_OBSERVER_UUID.equals(player.getUniqueId()) || PHOTO_OBSERVER_NAME.equalsIgnoreCase(player.getName());
    }

    Player observedPlayer(Player eye) {
        if (eye == null || eyeRules == null || eye.getGameMode() != GameMode.SPECTATOR
                || !(eye.getSpectatorTarget() instanceof Player target) || !target.isOnline()
                || target.getWorld() != eye.getWorld() || isObserver(target)) return null;
        String expected = registeredEyes.get(eye.getName().toLowerCase(Locale.ROOT));
        return EyePairs.freeObserver(eyeRules, eye.getName())
                || expected != null && target.getName().equalsIgnoreCase(expected) ? target : null;
    }

    List<Player> attachedEyes(Player agent) {
        if (agent == null) return List.of();
        return Bukkit.getOnlinePlayers().stream().filter(eye -> observedPlayer(eye) == agent)
                .map(eye -> (Player) eye).toList();
    }

    Player attachedEye(Player agent) {
        return attachedEyes(agent).stream().findFirst().orElse(null);
    }

    private void refreshAgentNames() {
        try {
            JsonObject root = JsonParser.parseString(Files.readString(pairsFile, StandardCharsets.UTF_8))
                    .getAsJsonObject();
            var bindings = EyePairs.resolve(root, Bukkit.getOnlinePlayers().stream().map(Player::getName).toList());
            Set<String> names = new HashSet<>(); Map<String, String> eyes = new HashMap<>();
            for (var pair : bindings) {
                names.add(pair.agent().toLowerCase(Locale.ROOT));
                eyes.put(pair.eye().toLowerCase(Locale.ROOT), pair.agent());
            }
            registeredAgentNames = Set.copyOf(names); registeredEyes = Map.copyOf(eyes); eyeRules = root;
            pairsError = "";
        } catch (Exception error) {
            registeredAgentNames = Set.of(); registeredEyes = Map.of(); eyeRules = null;
            String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            if (!message.equals(pairsError)) plugin.getLogger().warning("Agent pairs rejected: " + message);
            pairsError = message;
        }
    }

    private Component prefix(String teamName) {
        return prefixes.computeIfAbsent(teamName, this::buildPrefix);
    }

    private Component buildPrefix(String teamName) {
        if (AGENT_TEAM.equals(teamName)) return agentPrefix;
        boolean agent = teamName.startsWith("qd_arank_");
        int rank = teamName.charAt(teamName.length() - 1) - '0';
        Component badge = Component.text("◆" + RANKS[rank] + " ", COLORS[rank]);
        return agent ? badge.append(agentPrefix) : badge;
    }

    private void reconcile() {
        ++refreshTicks; refreshAgentNames();
        var online = new ArrayList<>(Bukkit.getOnlinePlayers());
        // Only hide the player-list entry. The camera still receives world
        // data and can keep its spectator target and native rendering.
        online.stream().filter(PlayerNameTags::isPhotoObserver).findFirst().ifPresent(camera -> {
            for (Player viewer : online) if (viewer != camera && viewer.isListed(camera)) viewer.unlistPlayer(camera);
        });
        Map<UUID, String> desiredTeams = new HashMap<>();
        Set<Scoreboard> boards = new HashSet<>();
        for (Player viewer : online) boards.add(viewer.getScoreboard());
        for (Scoreboard previous : new HashSet<>(touchedBoards)) {
            if (boards.contains(previous)) continue;
            removeOwnedTeams(previous);
            touchedBoards.remove(previous);
        }
        for (Scoreboard board : boards) {
            touchedBoards.add(board);
            Map<String, Set<String>> wanted = new HashMap<>();
            for (Player player : online) {
                String entry = player.getName();
                Team current = board.getEntryTeam(entry);
                if (current != null && !OWN_TEAMS.contains(current.getName())) continue;
                UUID id = player.getUniqueId();
                // Resolve identity/rank once for this reconcile, only when at
                // least one board allows our team. Null spectator results are cached too.
                if (!desiredTeams.containsKey(id)) desiredTeams.put(id, desiredTeam(player));
                String desired = desiredTeams.get(id);
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
