package org.afuhome.agentfriend;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.scoreboard.Team;
import sun.misc.Unsafe;

/** In-process scoreboard and Eye tests; does not initialize or connect to a server. */
public final class PlayerNameTagsRegression {
    public static void main(String[] args) throws Exception {
        CountingConfig config = new CountingConfig();
        AgentFriendPlugin plugin = allocate(AgentFriendPlugin.class);
        field(JavaPlugin.class, "newConfig").set(plugin, config);
        GuildManager guild = allocate(GuildManager.class);
        field(GuildManager.class, "plugin").set(guild, plugin);
        field(AgentFriendPlugin.class, "guild").set(plugin, guild);
        PlayerNameTags tags = new PlayerNameTags(plugin);
        field(PlayerNameTags.class, "agentPrefix").set(tags, Component.text("[Agent] "));
        field(PlayerNameTags.class, "registeredAgentNames").set(tags, Set.of("fulu", "newagent"));

        World world = world(), otherWorld = world();
        List<Person> people = new ArrayList<>();
        people.add(new Person("fulu", world));
        people.add(new Person("HumanGuild", world));
        people.add(new Person("Ordinary", world));
        people.add(new Person("MixedCase_EYE", world));
        people.add(new Person("ForeignTeam", world));
        people.add(new Person("newagent", world));
        people.get(3).mode = GameMode.SPECTATOR;
        for (Person person : List.of(people.get(0), people.get(1))) {
            String path = "guild-players." + person.id;
            config.set(path + ".joined", "test"); config.set(path + ".fame", 0);
            config.set(path + ".rituals.certified", 0);
        }
        for (Person person : people) {
            person.board.foreign("ForeignTeam");
            person.board.owned("qd_agents", "Ordinary", "MixedCase_EYE", "goneOffline");
        }
        Server server = (Server) Proxy.newProxyInstance(Server.class.getClassLoader(), new Class<?>[] {Server.class},
                (proxy, method, values) -> switch (method.getName()) {
                    case "getOnlinePlayers" -> people.stream().map(person -> person.player).toList();
                    case "getPlayerExact" -> people.stream().filter(person -> person.name.equalsIgnoreCase((String) values[0]))
                            .map(person -> person.player).findFirst().orElse(null);
                    default -> throw new AssertionError("Unexpected server call: " + method.getName());
                });
        field(Bukkit.class, "server").set(null, server);
        Method reconcile = method("reconcile");
        reconcile.invoke(tags);
        check(config.joinReads == 4, "identity was recalculated per board, or foreign-only player was consulted: " + config.joinReads);
        for (Person person : people) {
            check(person.board.teamFor("fulu").equals("qd_arank_0"), "guild Agent rank missing");
            check(person.board.teamFor("HumanGuild").equals("qd_rank_0"), "human guild rank missing");
            check(person.board.teamFor("newagent").equals("qd_agents"), "registered Agent prefix missing");
            check(person.board.teamFor("Ordinary") == null, "ordinary player acquired Agent prefix");
            check(person.board.teamFor("MixedCase_EYE") == null, "spectator acquired prefix");
            check(person.board.teamFor("goneOffline") == null, "offline stale entry remained");
            check(person.board.teamFor("ForeignTeam").equals("another_plugin"), "foreign gameplay team overwritten");
        }
        Method prefix = method("prefix", String.class);
        for (String team : List.of("qd_agents", "qd_rank_0", "qd_arank_0", "qd_rank_5", "qd_arank_5")) {
            Object first = prefix.invoke(tags, team);
            check(first == prefix.invoke(tags, team), "prefix reconstructed: " + team);
        }
        // A fresh reconcile must notice a mode/identity change immediately.
        people.get(5).mode = GameMode.SPECTATOR; config.joinReads = 0;
        config.set("guild-players." + people.get(0).id + ".fame", 350);
        config.set("guild-players." + people.get(0).id + ".rituals.certified", 5);
        reconcile.invoke(tags);
        check(config.joinReads == 3, "null spectator identity wasn't cached across boards");
        for (Person person : people) {
            check(person.board.teamFor("newagent") == null, "mode change retained prefix");
            check(person.board.teamFor("fulu").equals("qd_arank_5"), "rank change remained cached across reconciles");
        }

        Person agent = people.get(0), eye = people.get(3);
        field(PlayerNameTags.class, "registeredEyes").set(tags, Map.of("fulu", "mixedcase_eye"));
        eye.target = agent.player;
        check(tags.attachedEye(agent.player) == eye.player, "mixed-case exact Eye registration failed");
        eye.mode = GameMode.SURVIVAL;
        check(tags.attachedEye(agent.player) == null, "non-spectator forwarded private state");
        eye.mode = GameMode.SPECTATOR; eye.world = otherWorld;
        check(tags.attachedEye(agent.player) == null, "different-world Eye forwarded private state");
        eye.world = world; eye.target = people.get(1).player;
        check(tags.attachedEye(agent.player) == null, "wrong spectator target forwarded private state");
        eye.target = null;
        check(tags.attachedEye(agent.player) == null, "detached Eye forwarded private state");
        field(PlayerNameTags.class, "registeredEyes").set(tags, Map.of("fulu", "mixedcase"));
        check(tags.attachedEye(agent.player) == null, "partial-name Eye matched");
        field(PlayerNameTags.class, "registeredEyes").set(tags, Map.of("fulu", "OfflineEye"));
        check(tags.attachedEye(agent.player) == null, "offline Eye matched");
        tags.stop();
        check(((Map<?, ?>) field(PlayerNameTags.class, "prefixes").get(tags)).isEmpty(), "stop retained prefix cache");
        for (Person person : people) check(person.board.teamFor("ForeignTeam").equals("another_plugin"), "stop removed foreign team");
        System.out.println("PASS: six independent boards use four identity/config reads; prefixes reused,"
                + " guild/Agent/spectator/foreign-team rules and mixed-case private Eye guards passed.");
    }

    private static final class CountingConfig extends YamlConfiguration {
        int joinReads;
        @Override public boolean contains(String path) {
            if (path.startsWith("guild-players.") && path.endsWith(".joined")) joinReads++;
            return super.contains(path);
        }
    }

    private static final class Person {
        final String name;
        final UUID id = UUID.randomUUID();
        final Board board = new Board();
        final Player player;
        GameMode mode = GameMode.SURVIVAL;
        World world;
        Player target;
        Person(String name, World world) {
            this.name = name; this.world = world;
            player = (Player) Proxy.newProxyInstance(Player.class.getClassLoader(), new Class<?>[] {Player.class},
                    (proxy, method, values) -> switch (method.getName()) {
                        case "getName" -> this.name;
                        case "getUniqueId" -> id;
                        case "getGameMode" -> mode;
                        case "getWorld" -> this.world;
                        case "getSpectatorTarget" -> target;
                        case "getScoreboard" -> board.proxy;
                        default -> throw new AssertionError("Unexpected player call: " + method.getName());
                    });
        }
    }

    private static final class Board {
        final Map<String, TeamState> teams = new HashMap<>();
        final Scoreboard proxy;
        Board() {
            proxy = (Scoreboard) Proxy.newProxyInstance(Scoreboard.class.getClassLoader(), new Class<?>[] {Scoreboard.class},
                    (self, method, values) -> switch (method.getName()) {
                        case "hashCode" -> System.identityHashCode(self);
                        case "equals" -> self == values[0];
                        case "getTeam" -> teams.containsKey(values[0]) ? teams.get(values[0]).proxy : null;
                        case "getEntryTeam" -> { String name = teamFor((String) values[0]); yield name == null ? null : teams.get(name).proxy; }
                        case "registerNewTeam" -> create((String) values[0]).proxy;
                        default -> throw new AssertionError("Unexpected scoreboard call: " + method.getName());
                    });
        }
        TeamState create(String name) { TeamState team = new TeamState(name, this); teams.put(name, team); return team; }
        void foreign(String entry) { create("another_plugin").entries.add(entry); }
        void owned(String teamName, String... entries) { create(teamName).entries.addAll(List.of(entries)); }
        String teamFor(String entry) { return teams.values().stream().filter(team -> team.entries.contains(entry)).map(team -> team.name).findFirst().orElse(null); }
    }

    private static final class TeamState {
        final String name;
        final Set<String> entries = new HashSet<>();
        Component prefix = Component.empty();
        final Team proxy;
        TeamState(String name, Board board) {
            this.name = name;
            proxy = (Team) Proxy.newProxyInstance(Team.class.getClassLoader(), new Class<?>[] {Team.class},
                    (self, method, values) -> switch (method.getName()) {
                        case "getName" -> name;
                        case "getEntries" -> Set.copyOf(entries);
                        case "prefix" -> { if (values == null || values.length == 0) yield prefix; prefix = (Component) values[0]; yield null; }
                        case "addEntry" -> { entries.add((String) values[0]); yield null; }
                        case "removeEntry" -> entries.remove(values[0]);
                        case "unregister" -> { board.teams.remove(name); yield null; }
                        default -> throw new AssertionError("Unexpected team call: " + method.getName());
                    });
        }
    }

    private static World world() {
        return (World) Proxy.newProxyInstance(World.class.getClassLoader(), new Class<?>[] {World.class},
                (proxy, method, values) -> { throw new AssertionError("Unexpected world call: " + method.getName()); });
    }
    private static Method method(String name, Class<?>... parameters) throws Exception {
        Method method = PlayerNameTags.class.getDeclaredMethod(name, parameters); method.setAccessible(true); return method;
    }
    private static Field field(Class<?> type, String name) throws Exception {
        Field field = type.getDeclaredField(name); field.setAccessible(true); return field;
    }
    private static <T> T allocate(Class<T> type) throws Exception {
        Unsafe unsafe = (Unsafe) field(Unsafe.class, "theUnsafe").get(null);
        return type.cast(unsafe.allocateInstance(type));
    }
    private static void check(boolean valid, String message) { if (!valid) throw new AssertionError(message); }
}
