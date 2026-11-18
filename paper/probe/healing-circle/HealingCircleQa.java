package local.healingcircleqa;

import com.google.gson.*;
import io.vortexcore.VortexCorePlugin;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/** Test-only fixture. It cannot operate on real player profiles or a normal server. */
public final class HealingCircleQa extends JavaPlugin {
    @Override public void onEnable() {
        try {
            if (Bukkit.getPort() != 26914 || !Bukkit.getIp().equals("127.0.0.1")
                    || !Files.readString(Path.of(".healing-circle-qa")).strip().equals("SYNTHETIC_HEALING_CIRCLE_ONLY"))
                throw new IllegalStateException("isolated stage required");
            getCommand("circleqa").setExecutor(this::command);
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    private boolean command(CommandSender sender, Command command, String label, String[] args) {
        try {
            if (!(sender instanceof RemoteConsoleCommandSender || sender instanceof ConsoleCommandSender))
                throw new IllegalArgumentException("console only");
            if (args.length == 1 && args[0].equals("world")) {
                World world = new WorldCreator("aincrad").type(WorldType.FLAT).generateStructures(false).createWorld();
                if (world == null) throw new IllegalStateException("world unavailable");
                world.setGameRule(GameRule.DO_MOB_SPAWNING, false);
                world.setGameRule(GameRule.NATURAL_REGENERATION, false);
                sender.sendMessage("CIRCLE_QA_WORLD");
                return true;
            }
            if (args.length < 2 || !args[1].matches("CircleQA[1-8]")) throw new IllegalArgumentException("synthetic name required");
            Player p = Bukkit.getPlayerExact(args[1]);
            if (p == null || !p.getUniqueId().equals(UUID.nameUUIDFromBytes(("OfflinePlayer:"+p.getName()).getBytes(StandardCharsets.UTF_8))))
                throw new IllegalArgumentException("synthetic body required");
            var vortex = (VortexCorePlugin) Bukkit.getPluginManager().getPlugin("VortexRPG");
            var profile = vortex.playerProfileService().profile(p.getUniqueId()).orElseThrow();
            var af = (JavaPlugin) Bukkit.getPluginManager().getPlugin("AgentFriend");
            var rpg = Bukkit.getPluginManager().getPlugin("QiandengjiRpg");
            switch (args[0]) {
                case "read" -> {
                    var read = rpg.getClass().getMethod("selfState", Player.class);
                    var row = JsonParser.parseString(read.invoke(rpg, p).toString()).getAsJsonObject();
                    row.addProperty("health", p.getHealth());
                    row.addProperty("maxHealth", p.getMaxHealth());
                    row.addProperty("world", p.getWorld().getName());
                    row.add("wheel", new Gson().toJsonTree(af.getConfig().getList(wheelKey(p))));
                    row.addProperty("altarProof", af.getConfig().isString("site-dungeons.healing-circle-proofs."+p.getUniqueId()));
                    row.addProperty("lootPending", af.getConfig().isConfigurationSection("site-dungeons.receipts."+p.getUniqueId()+".jungle_covenant"));
                    row.addProperty("lootClaimed", af.getConfig().isString("site-dungeons.claimed-runs."+p.getUniqueId()+".jungle_covenant"));
                    sender.sendMessage(row.toString());
                    return true;
                }
                case "train" -> {
                    profile.setExperience(10_000, vortex.playerProfileService().experienceCurve());
                    vortex.classSkillService().adjustSkillPoints(p, profile, 4);
                }
                case "health" -> {
                    if (args.length != 3) throw new IllegalArgumentException("health required");
                    p.setHealth(Math.clamp(Double.parseDouble(args[2]), 1, p.getMaxHealth()));
                }
                case "mana" -> {
                    if (args.length != 3) throw new IllegalArgumentException("mana required");
                    vortex.qiandengjiMana().setMana(p.getUniqueId(), Double.parseDouble(args[2]));
                }
                case "gear" -> {
                    var inventory = p.getInventory();
                    inventory.setArmorContents(new ItemStack[]{new ItemStack(Material.IRON_BOOTS), new ItemStack(Material.IRON_LEGGINGS),
                        new ItemStack(Material.IRON_CHESTPLATE), new ItemStack(Material.IRON_HELMET)});
                    inventory.setItem(0, new ItemStack(Material.DIAMOND_SWORD));
                    inventory.setItem(1, new ItemStack(Material.BOW));
                    inventory.setItem(2, new ItemStack(Material.ARROW, 64));
                }
                case "empty-slot" -> af.getConfig().set(wheelKey(p), List.of("home", "selfheal", "blink", "frostnova", "night", "food", "starbolt", ""));
                case "full-wheel" -> af.getConfig().set(wheelKey(p), List.of("home", "selfheal", "blink", "frostnova", "night", "food", "starbolt", "feather"));
                default -> throw new IllegalArgumentException("unknown fixture");
            }
            sender.sendMessage("CIRCLE_QA_OK");
        } catch (Exception failure) {
            sender.sendMessage("CIRCLE_QA_ERROR " + failure);
        }
        return true;
    }
    private static String wheelKey(Player p) { return "spell-wheel.players."+p.getUniqueId()+".slots"; }
}
