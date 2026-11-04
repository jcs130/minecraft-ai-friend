import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.*;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/** Test-only fault injection. The launcher gives this plugin a disposable world. */
public final class PvpEscrowFixture extends JavaPlugin implements Listener {
    private final Map<UUID, String> deaths = new HashMap<>();
    private Object arena;
    private Path escrow;

    @Override public void onEnable() {
        try {
            if (Bukkit.getPort() != 25966 || !Bukkit.getIp().equals("127.0.0.1")
                    || !Files.readString(Path.of(".pvp-escrow-qa")).trim().equals("disposable local PvP test only"))
                throw new IllegalStateException("Isolated escrow fixture only");
            var plugin = Objects.requireNonNull(Bukkit.getPluginManager().getPlugin("AgentFriend"));
            arena = field(plugin, "pvpArena").get(plugin);
            escrow = (Path) field(arena, "escrowPath").get(arena);
            Bukkit.getPluginManager().registerEvents(this, this);
            getCommand("pvpqa").setExecutor((sender, cmd, alias, args) -> {
                if (!(sender instanceof ConsoleCommandSender || sender instanceof RemoteConsoleCommandSender)) return false;
                try {
                    sender.sendMessage(run(args));
                } catch (Throwable failure) {
                    getLogger().log(java.util.logging.Level.SEVERE, "Escrow fixture error", failure);
                    sender.sendMessage("FIXTURE_ERROR " + failure);
                }
                return true;
            });
        } catch (Exception failure) { throw new IllegalStateException(failure); }
    }

    private String run(String[] args) throws Exception {
        if (args.length < 2 || !args[1].matches("PvpQa[A-Z][a-z]+")) throw new IllegalArgumentException("Fixture player required");
        Player p = Objects.requireNonNull(Bukkit.getPlayerExact(args[1]));
        Path temp = escrow.resolveSibling("pvp-escrow.yml.tmp");
        var root = "players." + p.getUniqueId();
        switch (args[0]) {
            case "prime", "prime-empty" -> {
                seed(p);
                if (args[0].equals("prime-empty")) p.getInventory().clear();
                try {
                    // Baseline snapshot writes its own file.
                    call("snapshot", new Class<?>[]{Player.class}, p);
                } catch (NoSuchMethodException changedSignature) {
                    YamlConfiguration data = (YamlConfiguration) call("escrow", new Class<?>[]{});
                    call("snapshot", new Class<?>[]{YamlConfiguration.class, Player.class}, data, p);
                    call("writeEscrow", new Class<?>[]{YamlConfiguration.class}, data);
                }
                call("equip", new Class<?>[]{Player.class}, p);
                p.saveData(); // Prove the last vanilla image contained only the arena kit.
            }
            case "pair", "pair-write-fault" -> {
                Player b = Objects.requireNonNull(Bukkit.getPlayerExact(args[2]));
                if (!b.getName().matches("PvpQa[A-Z][a-z]+")) throw new IllegalArgumentException("Fixture player required");
                seed(p); seed(b);
                // A disposable flat world has no built PvP ring at y=160.
                World ring = Objects.requireNonNull(Bukkit.getWorld("world"));
                for (int x = -710; x <= -690; x++)
                    for (int z = -552; z <= -548; z++)
                        ring.getBlockAt(x, 160, z).setType(Material.STONE, false);
                @SuppressWarnings("unchecked") var queue = (List<UUID>) field(arena, "queue").get(arena);
                queue.addAll(List.of(p.getUniqueId(), b.getUniqueId()));
                if (args[0].equals("pair-write-fault")) {
                    Files.createDirectory(temp);
                    try { call("pair", new Class<?>[]{}); }
                    finally { Files.delete(temp); }
                } else call("pair", new Class<?>[]{});
            }
            case "finish" -> call("finish", new Class<?>[]{UUID.class, String.class}, p.getUniqueId(), "fixture");
            case "death" -> p.setHealth(0);
            case "recover" -> call("restore", new Class<?>[]{Player.class}, p);
            case "delayed-resume" -> call("resumeRecovery", new Class<?>[]{Player.class}, p);
            case "write-fault" -> {
                var data = YamlConfiguration.loadConfiguration(escrow.toFile());
                if (data.contains(root + ".phase")) {
                    data.set(root + ".phase", "restoring");
                    call("writeEscrow", new Class<?>[]{YamlConfiguration.class}, data);
                }
                Files.createDirectory(temp);
                try { call("restore", new Class<?>[]{Player.class}, p); }
                finally { Files.delete(temp); }
            }
            case "transfer" -> {
                var stack = Objects.requireNonNull(p.getInventory().getItem(0));
                var item = p.getWorld().dropItem(p.getLocation(), stack.clone());
                try {
                    var event = new PlayerDropItemEvent(p, item);
                    Bukkit.getPluginManager().callEvent(event);
                    if (!event.isCancelled()) p.getInventory().setItem(0, null);
                    return "transfer=" + !event.isCancelled() + " " + inspect(p);
                } finally { item.remove(); }
            }
            case "silent-save", "throw-save", "crash-before-save", "crash-after-save", "crash-after-commit" -> {
                String mode = args[0];
                Player intercepted = (Player) Proxy.newProxyInstance(Player.class.getClassLoader(), new Class<?>[]{Player.class}, (proxy, method, values) -> {
                    if (method.getName().equals("saveData")) {
                        switch (mode) {
                            case "silent-save" -> { return null; }
                            case "throw-save" -> throw new IllegalStateException("injected save failure");
                            case "crash-before-save" -> Runtime.getRuntime().halt(83);
                            case "crash-after-save" -> { p.saveData(); Runtime.getRuntime().halt(84); }
                            default -> { }
                        }
                    }
                    try { return method.invoke(p, values); }
                    catch (InvocationTargetException failure) { throw failure.getCause(); }
                });
                call("restore", new Class<?>[]{Player.class}, intercepted);
                if (mode.startsWith("crash-")) Runtime.getRuntime().halt(85);
            }
            case "missing-slot" -> {
                var data = YamlConfiguration.loadConfiguration(escrow.toFile());
                data.set(root + ".slots.0", null);
                data.save(escrow.toFile());
            }
            case "legacy" -> {
                var data = YamlConfiguration.loadConfiguration(escrow.toFile());
                data.set(root + ".phase", null);
                data.set(root + ".transaction", null);
                data.set(root + ".inventory-size", null);
                data.save(escrow.toFile());
            }
            case "state" -> { }
            default -> throw new IllegalArgumentException(args[0]);
        }
        return inspect(p);
    }

    private String inspect(Player p) throws Exception {
        var data = YamlConfiguration.loadConfiguration(escrow.toFile());
        var root = "players." + p.getUniqueId();
        var locked = (Set<?>) field(arena, "recovering").get(arena);
        Object match = field(arena, "match").get(arena);
        boolean live = match != null && field(match, "live").getBoolean(match);
        return "live=" + live + " diamonds=" + count(p, Material.DIAMOND) + " swords=" + count(p, Material.IRON_SWORD)
                + " boots=" + count(p, Material.GOLDEN_BOOTS) + " offhand=" + p.getInventory().getItemInOffHand().getType()
                + " pending=" + data.contains(root) + " locked=" + locked.contains(p.getUniqueId())
                + " phase=" + data.getString(root + ".phase", "none")
                + " rating=" + call("rating", new Class<?>[]{UUID.class}, p.getUniqueId())
                + " " + deaths.getOrDefault(p.getUniqueId(), "deathDrops=unknown deathKeep=unknown");
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void death(PlayerDeathEvent event) {
        deaths.put(event.getEntity().getUniqueId(), "deathDrops=" + event.getDrops().size()
                + " deathKeep=" + event.getKeepInventory());
    }

    private static void seed(Player p) {
        p.getInventory().clear();
        p.getInventory().setItem(0, new ItemStack(Material.DIAMOND, 5));
        p.getInventory().setBoots(new ItemStack(Material.GOLDEN_BOOTS));
        p.getInventory().setItemInOffHand(new ItemStack(Material.TORCH, 3));
        p.setGameMode(GameMode.SURVIVAL);
        p.updateInventory();
    }

    private static int count(Player p, Material type) {
        return Arrays.stream(p.getInventory().getContents()).filter(Objects::nonNull)
                .filter(stack -> stack.getType() == type).mapToInt(ItemStack::getAmount).sum();
    }

    private static Field field(Object o, String name) throws ReflectiveOperationException {
        var field = o.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field;
    }

    private Object call(String name, Class<?>[] types, Object... args) throws Exception {
        var method = arena.getClass().getDeclaredMethod(name, types);
        method.setAccessible(true);
        return method.invoke(arena, args);
    }
}
