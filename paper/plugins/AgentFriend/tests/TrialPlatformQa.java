import com.google.gson.Gson;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.*;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.player.PlayerTeleportEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/** Console-only synthetic fixture; never loads on a public/production server. */
public final class TrialPlatformQa extends JavaPlugin implements Listener {
    private Object dungeon;
    private JavaPlugin af;
    private String teleportFault = "none";
    private static final List<String> NAMES = List.of("PlatformHostQA", "PlatformMateQA", "PlatformAwayQA");
    private static Object call(Object o, String name, Object... args) throws Exception {
        Method m = Arrays.stream(o.getClass().getDeclaredMethods())
            .filter(x -> x.getName().equals(name) && x.getParameterCount() == args.length).findFirst().orElseThrow();
        m.setAccessible(true); return m.invoke(o, args);
    }
    private void set(String name, Object value) throws Exception {
        Field f = dungeon.getClass().getDeclaredField(name); f.setAccessible(true); f.set(dungeon, value);
    }
    @Override public void onEnable() {
        try {
            if (!Bukkit.getIp().equals("127.0.0.1") || Bukkit.getPort() != 26461
                || !Files.readString(Path.of(".trial-platform-qa")).equals("SYNTHETIC_TRIAL_PLATFORM_ONLY"))
                throw new IllegalStateException("Marked loopback fixture required");
            af = (JavaPlugin)Bukkit.getPluginManager().getPlugin("AgentFriend");
            dungeon = call(af, "dungeon");
        } catch (Exception e) { throw new IllegalStateException(e); }
        Bukkit.getPluginManager().registerEvents(this, this);
        Bukkit.getCommandMap().register("platformqa", new Command("platformqa") {
            @Override public boolean execute(CommandSender sender, String label, String[] args) {
                if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender) || args.length != 1) return false;
                try { run(args[0]); sender.sendMessage("PLATFORM_QA " + new Gson().toJson(state())); }
                catch (Exception e) { sender.sendMessage("PLATFORM_QA_ERROR " + e); }
                return true;
            }
        });
    }
    private Player player(int i) { return Objects.requireNonNull(Bukkit.getPlayerExact(NAMES.get(i))); }
    private void reset() throws Exception {
        if (Bukkit.getOnlinePlayers().stream().anyMatch(p -> !NAMES.contains(p.getName())))
            throw new IllegalStateException("Unrelated connection present");
        teleportFault = "none";
        if ((boolean)call(dungeon, "hasActiveRun")) call(dungeon, "finish", false, "synthetic_cleanup", "QA cleanup");
        set("lastRun", 0L);
        for (int i = 0; i < NAMES.size(); i++) {
            Player p = player(i); p.closeInventory(); p.setOp(false); p.setGameMode(GameMode.SURVIVAL);
            // Keep the four existing server-issued menu tools. Deleting them would
            // trigger normal login reissuance and invalidate an inventory comparison.
            List<ItemStack> menus = Arrays.stream(p.getInventory().getStorageContents()).filter(Objects::nonNull)
                .filter(item -> item.hasItemMeta() && Set.of(Material.PLAYER_HEAD, Material.COMPASS,
                    Material.WRITTEN_BOOK, Material.BLAZE_ROD).contains(item.getType())).map(ItemStack::clone).toList();
            p.setInvulnerable(true); p.getInventory().clear(); p.getInventory().setItemInOffHand(null);
            p.getInventory().setArmorContents(new ItemStack[]{new ItemStack(Material.IRON_BOOTS),
                new ItemStack(Material.IRON_LEGGINGS), new ItemStack(Material.IRON_CHESTPLATE), new ItemStack(Material.IRON_HELMET)});
            p.getInventory().setItem(0, new ItemStack(Material.IRON_SWORD));
            p.getInventory().setItem(1, new ItemStack(Material.BOW));
            p.getInventory().setItem(2, new ItemStack(Material.ARROW, 16));
            menus.forEach(item -> p.getInventory().addItem(item));
            p.teleport(new Location(Bukkit.getWorld("world"), -595.5 + i, 91, -311.5));
        }
        player(2).teleport(new Location(Bukkit.getWorld("world"), -590.5, 91, -322.5));
    }
    private void run(String action) throws Exception {
        if (action.equals("status")) return;
        if (action.equals("menu")) { call(af, "openDungeonDifficultyMenu", player(0)); return; }
        if (action.equals("cleanup")) { reset(); return; }
        reset();
        switch (action) {
            case "far" -> player(1).teleport(new Location(Bukkit.getWorld("world"), -578.5, 91, -293.5));
            case "missing" -> { player(1).getInventory().setHelmet(null); player(1).getInventory().setItem(2, null); }
            case "starter-missing" -> player(0).getInventory().setBoots(null);
            case "cancel", "redirect", "all-cancel" -> teleportFault = action;
            case "other-world" -> player(1).teleport(new Location(Bukkit.getWorld("world_nether"), -594.5, 91, -311.5));
            case "above" -> player(1).teleport(new Location(Bukkit.getWorld("world"), -594.5, 100, -311.5));
            case "outside" -> player(1).teleport(new Location(Bukkit.getWorld("world"), -577.5, 91, -311.5));
            case "spectator" -> player(1).setGameMode(GameMode.SPECTATOR);
            case "creative" -> player(1).setGameMode(GameMode.CREATIVE);
            case "near" -> { }
            case "bridge" -> player(0).teleport(new Location(Bukkit.getWorld("world"), -590.5, 91, -321.5));
            default -> throw new IllegalArgumentException(action);
        }
    }
    @EventHandler(priority = EventPriority.HIGHEST)
    public void teleport(PlayerTeleportEvent e) {
        if ((!e.getPlayer().getName().equals(NAMES.get(1)) && !teleportFault.equals("all-cancel"))
            || e.getTo() == null || e.getTo().getY() != 69) return;
        if (teleportFault.equals("all-cancel")) e.setCancelled(true);
        if (teleportFault.equals("cancel")) e.setCancelled(true);
        if (teleportFault.equals("redirect")) e.setTo(e.getFrom());
    }
    private Map<String,Object> state() throws Exception {
        List<Object> players = new ArrayList<>();
        for (String name : NAMES) {
            Player p = Bukkit.getPlayerExact(name); if (p == null) continue;
            var at = p.getLocation();
            String inventory = HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
                .digest(Arrays.toString(p.getInventory().getContents()).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            players.add(Map.of("name",name,"world",p.getWorld().getName(),"x",at.getX(),"y",at.getY(),"z",at.getZ(),
                "participant",call(dungeon,"isParticipant",p), "inventory",inventory));
        }
        return Map.of("active",call(dungeon,"hasActiveRun"),"players",players);
    }
}
