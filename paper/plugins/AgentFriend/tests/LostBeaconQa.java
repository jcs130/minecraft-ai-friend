import com.google.gson.Gson;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/** Synthetic setup and readback for the loopback chapter test. */
public final class LostBeaconQa extends JavaPlugin {
    private static final List<String> NAMES = List.of("BeaconHostQA", "BeaconMateQA", "BeaconVisitorQA");
    private static final Gson JSON = new Gson();
    private JavaPlugin friend;

    @Override public void onEnable() {
        try {
            if (!Bukkit.getIp().equals("127.0.0.1") || Bukkit.getPort() != 26471
                    || !Files.readString(Path.of(".lost-beacon-qa")).equals("SYNTHETIC_LOST_BEACON_ONLY"))
                throw new IllegalStateException("Marked loopback fixture required");
        } catch (Exception failure) { throw new IllegalStateException(failure); }
        friend = (JavaPlugin) Bukkit.getPluginManager().getPlugin("AgentFriend");
        getServer().getCommandMap().register("beaconqa", new Command("beaconqa") {
            @Override public boolean execute(CommandSender sender, String label, String[] args) {
                if (!(sender instanceof ConsoleCommandSender || sender instanceof RemoteConsoleCommandSender) || args.length == 0)
                    return false;
                try {
                    if (Bukkit.getOnlinePlayers().stream().anyMatch(player -> !NAMES.contains(player.getName())))
                        throw new IllegalStateException("Unexpected live player");
                    Object result = run(args);
                    sender.sendMessage("BEACON_QA " + JSON.toJson(result));
                } catch (RuntimeException error) { sender.sendMessage("BEACON_QA_ERROR " + error); }
                return true;
            }
        });
    }

    private World world() { return Objects.requireNonNull(Bukkit.getWorld("aincrad")); }
    private Player player(String name) {
        if (!NAMES.contains(name)) throw new IllegalArgumentException("Not a synthetic role");
        return Objects.requireNonNull(Bukkit.getPlayerExact(name));
    }

    private static void outfit(Player p, boolean armed) {
        p.setGameMode(GameMode.SURVIVAL);
        p.getInventory().setArmorContents(new ItemStack[]{
            new ItemStack(Material.IRON_BOOTS), new ItemStack(Material.IRON_LEGGINGS),
            new ItemStack(Material.IRON_CHESTPLATE), new ItemStack(Material.IRON_HELMET)
        });
        if (armed) {
            ItemStack sword = new ItemStack(Material.DIAMOND_SWORD);
            sword.addEnchantment(Enchantment.SHARPNESS, 3);
            p.getInventory().setItem(0, sword);
            p.getInventory().setItem(1, new ItemStack(Material.BOW));
            p.getInventory().setItem(2, new ItemStack(Material.ARROW, 48));
        }
    }

    private Object run(String[] args) {
        return switch (args[0]) {
            case "equip" -> {
                outfit(player(args[1]), !args[1].equals(NAMES.getLast()));
                yield Map.of("equipped", true);
            }
            case "move" -> {
                Player p = player(args[1]);
                World target = args[2].equals("world") ? Objects.requireNonNull(Bukkit.getWorld("world")) : world();
                Location at = new Location(target, Double.parseDouble(args[3]), Double.parseDouble(args[4]), Double.parseDouble(args[5]));
                yield Map.of("moved", p.teleport(at));
            }
            case "damage" -> {
                Player p = player(args[1]);
                int count = 0;
                for (Entity entity : world().getEntities()) if (entity instanceof LivingEntity mob
                        && entity.getScoreboardTags().contains("afu_site_aincrad_01")) {
                    mob.damage(1000, p);
                    if (mob.isDead()) count++;
                }
                yield Map.of("killed", count);
            }
            case "steady" -> {
                Player p = player(args[1]);
                p.setInvulnerable(Boolean.parseBoolean(args[2]));
                p.setHealth(p.getMaxHealth());
                yield Map.of("health", p.getHealth());
            }
            case "escort-fail" -> {
                int count = 0;
                for (Entity entity : world().getEntities()) if (entity instanceof LivingEntity mob
                        && entity.getScoreboardTags().contains("qd_lost_beacon_escort")) { mob.setHealth(0); count++; }
                yield Map.of("terminated", count);
            }
            case "status" -> state();
            default -> throw new IllegalArgumentException("Unknown fixture operation");
        };
    }

    private Object state() {
        var players = new ArrayList<Object>();
        for (Player p : Bukkit.getOnlinePlayers()) {
            String id = p.getUniqueId().toString(), site = ".aincrad_01";
            var at = p.getLocation();
            String receipt = "site-dungeons.receipts." + id + site;
            players.add(Map.of("name", p.getName(), "world", p.getWorld().getName(), "health", p.getHealth(),
                "position", List.of(at.getX(),at.getY(),at.getZ()), "rewardCount", friend.getConfig().getInt(receipt + ".count"),
                "rewardRun", friend.getConfig().getString(receipt + ".run", ""),
                "claimedRun", friend.getConfig().getString("site-dungeons.claimed-runs." + id + site, "")));
        }
        var actors = new ArrayList<Object>();
        for (Entity entity : world().getEntities()) if (entity instanceof LivingEntity mob) {
            String role = mob.getScoreboardTags().contains("qd_lost_beacon_escort") ? "escort"
                : mob.getScoreboardTags().contains("afu_site_aincrad_01") ? "enemy" : "";
            if (role.isEmpty()) continue;
            var at = mob.getLocation();
            actors.add(Map.of("role", role, "type", mob.getType().name(), "health", mob.getHealth(),
                "id", mob.getUniqueId().toString(), "position", List.of(at.getX(),at.getY(),at.getZ())));
        }
        return Map.of("players", players, "actors", actors);
    }
}
