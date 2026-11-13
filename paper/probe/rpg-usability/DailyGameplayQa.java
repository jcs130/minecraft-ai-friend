import io.vortexcore.VortexCorePlugin;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockFadeEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.entity.LivingEntity;
import org.bukkit.potion.PotionEffectType;

/** Fixture commands are available only on the marked, loopback-only QA server. */
public final class DailyGameplayQa extends JavaPlugin implements Listener {
    private VortexCorePlugin vortex;

    @Override public void onEnable() {
        try {
            if (!Files.readString(Path.of(".daily-shop-qa")).equals("ISOLATED_DAILY_SHOP_FROST_ONLY")
                    || !Bukkit.getIp().equals("127.0.0.1") || Bukkit.getPort() != 25928)
                throw new IllegalStateException("Isolated stage required");
            vortex = (VortexCorePlugin) Bukkit.getPluginManager().getPlugin("VortexRPG");
            Bukkit.getPluginManager().registerEvents(this, this);
        } catch (Exception invalid) {
            throw new IllegalStateException(invalid);
        }
    }

    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (sender instanceof Player || args.length < 2) return false;
        Player player = Bukkit.getPlayerExact(args[1]);
        try {
            switch (args[0]) {
                case "clock" -> {
                    var agent = Bukkit.getPluginManager().getPlugin("AgentFriend");
                    Object dungeon = field(agent, "dungeon");
                    Object stock = field(field(dungeon, "economy"), "dailyShop");
                    var clock = stock.getClass().getDeclaredField("clock");
                    clock.setAccessible(true);
                    clock.set(stock, Clock.fixed(Instant.parse(args[1]), ZoneOffset.UTC));
                    sender.sendMessage("clock=" + args[1]);
                }
                case "health" -> {
                    if (args.length > 2) player.setHealth(Math.min(player.getMaxHealth(), Double.parseDouble(args[2])));
                    sender.sendMessage("health=" + player.getHealth());
                }
                case "entity-health" -> {
                    var entities = Bukkit.selectEntities(sender, args[1]);
                    if (entities.isEmpty()) sender.sendMessage("health=0.0");
                    else if (entities.size() == 1 && entities.getFirst() instanceof LivingEntity living)
                        sender.sendMessage("health=" + living.getHealth());
                    else throw new IllegalStateException("expected at most one fixture target");
                }
                case "fire" -> {
                    if (args.length > 2) player.setFireTicks(Integer.parseInt(args[2]));
                    sender.sendMessage("fire=" + player.getFireTicks());
                }
                case "effects" -> {
                    var entities = Bukkit.selectEntities(sender, args[1]);
                    if (entities.size() != 1 || !(entities.getFirst() instanceof LivingEntity living))
                        throw new IllegalStateException("expected one fixture target");
                    var slow = living.getPotionEffect(PotionEffectType.SLOWNESS);
                    var weak = living.getPotionEffect(PotionEffectType.WEAKNESS);
                    var guard = living.getPotionEffect(PotionEffectType.RESISTANCE);
                    sender.sendMessage("slow=" + (slow == null ? -1 : slow.getAmplifier())
                            + " weak=" + (weak == null ? -1 : weak.getAmplifier())
                            + " guard=" + (guard == null ? -1 : guard.getAmplifier()));
                }
                case "block" -> {
                    var block = Bukkit.getWorld("world").getBlockAt(Integer.parseInt(args[1]),
                            Integer.parseInt(args[2]), Integer.parseInt(args[3]));
                    if (args.length > 4) block.setType(Material.valueOf(args[4]), false);
                    sender.sendMessage("block=" + block.getType().name());
                }
                case "party" -> {
                    var party = vortex.expeditionPartyManager();
                    if (party.partyOf(player.getUniqueId()).isEmpty()) party.createParty(player.getUniqueId());
                    for (int i = 2; i < args.length; i++) {
                        var ally = Bukkit.getPlayerExact(args[i]).getUniqueId();
                        party.invite(player.getUniqueId(), ally);
                        party.acceptInvite(ally);
                    }
                    sender.sendMessage("party=" + party.membersOf(player.getUniqueId()).size());
                }
                case "trial-team" -> {
                    var agent = Bukkit.getPluginManager().getPlugin("AgentFriend");
                    Object dungeon = field(agent, "dungeon");
                    set(dungeon, "floor", 13);
                    set(dungeon, "active", args.length > 2);
                    if (args.length > 2) {
                        set(dungeon, "pausedAt", 0L);
                        set(dungeon, "runStartedAt", System.currentTimeMillis());
                        set(dungeon, "floorStartedAt", System.currentTimeMillis());
                    }
                    trialGroup(dungeon, args);
                    sender.sendMessage("trial=" + (args.length > 2));
                }
                case "assist" -> {
                    var agent = Bukkit.getPluginManager().getPlugin("AgentFriend");
                    var access = Class.forName("org.afuhome.agentfriend.GroupSpellAccess", false, agent.getClass().getClassLoader());
                    var canAssist = access.getMethod("canAssist", Player.class, Player.class, boolean.class);
                    sender.sendMessage("assist=" + canAssist.invoke(null, player, Bukkit.getPlayerExact(args[2]), false));
                }
                case "level" -> {
                    var profiles = vortex.playerProfileService();
                    long xp = profiles.experienceCurve().totalExperienceToReach(Integer.parseInt(args[2]));
                    profiles.setExperience(player, xp, "synthetic-qagameplay");
                    sender.sendMessage("level=" + vortex.playerProfileService().profile(player).level());
                }
                default -> { return false; }
            }
        } catch (Exception failure) {
            sender.sendMessage("fixture_error=" + failure);
        }
        return true;
    }

    private static Object field(Object object, String name) throws ReflectiveOperationException {
        var field = object.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(object);
    }

    private static void set(Object object, String name, Object value) throws ReflectiveOperationException {
        var field = object.getClass().getDeclaredField(name);
        field.setAccessible(true);
        field.set(object, value);
    }

    @SuppressWarnings("unchecked")
    private static void trialGroup(Object dungeon, String[] args) throws ReflectiveOperationException {
        var group = (java.util.Set<java.util.UUID>) field(dungeon, "participants");
        group.clear();
        if (args.length > 2) {
            for (int i = 1; i < args.length; i++) group.add(Bukkit.getPlayerExact(args[i]).getUniqueId());
        }
    }

    @EventHandler public void protectedFire(BlockFadeEvent event) {
        if (event.getBlock().getX() == 179 && event.getBlock().getY() == 90 && event.getBlock().getZ() == 180)
            event.setCancelled(true);
    }
}
