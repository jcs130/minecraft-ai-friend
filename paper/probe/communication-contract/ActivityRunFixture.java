package org.qdqa;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.plugin.java.JavaPlugin;

/** Loopback QA only. The fixture never synthesizes a protocol receipt. */
public final class ActivityRunFixture extends JavaPlugin {
    private static final Set<String> ACTORS = Set.of("ag_AttrAlice", "ag_AttrBob", "ag_AttrEye");
    private static final String SITE = "qa_attribution";
    private JavaPlugin owner;

    @Override public void onEnable() {
        try {
            if (!Bukkit.getIp().equals("127.0.0.1") || Bukkit.getPort() != 25976
                    || !Files.readString(Path.of(".activity-run-qa")).strip().equals("activity-run-attribution-loopback"))
                throw new IllegalStateException("isolated_qa_only");
        } catch (java.io.IOException e) { throw new IllegalStateException(e); }
        owner = (JavaPlugin) Objects.requireNonNull(Bukkit.getPluginManager().getPlugin("AgentFriend"));
    }

    private static Object call(Object object, String name) throws Exception {
        var method = object.getClass().getDeclaredMethod(name);
        method.setAccessible(true);
        return method.invoke(object);
    }
    private static Object field(Object object, String name) throws Exception {
        var field = object.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(object);
    }
    private static void set(Object object, String name, Object value) throws Exception {
        var field = object.getClass().getDeclaredField(name);
        field.setAccessible(true);
        field.set(object, value);
    }
    private static Player player(String name) {
        if (!ACTORS.contains(name)) throw new IllegalArgumentException("qa_actor_only");
        return Objects.requireNonNull(Bukkit.getPlayerExact(name));
    }
    private static void ownParty(Iterable<?> ids) {
        for (Object id : ids)
            if (ACTORS.stream().noneMatch(name -> UUID.nameUUIDFromBytes(
                    ("OfflinePlayer:" + name).getBytes(java.nio.charset.StandardCharsets.UTF_8)).equals(id)))
                throw new IllegalArgumentException("foreign_participant");
    }
    private static void clearMobs(Iterable<?> ids) {
        if (!ids.iterator().hasNext()) throw new IllegalStateException("no_native_wave");
        for (Object id : List.copyOf((java.util.Collection<?>) ids))
            if (Bukkit.getEntity((UUID) id) instanceof LivingEntity mob) mob.setHealth(0);
    }
    private static void room(World world, int minX, int maxX, int y, int minZ, int maxZ) {
        for (int x = minX; x <= maxX; x++) for (int z = minZ; z <= maxZ; z++) {
            world.getBlockAt(x, y, z).setType(Material.STONE, false);
            for (int dy = 1; dy <= 6; dy++) world.getBlockAt(x, y + dy, z).setType(Material.AIR, false);
        }
    }

    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof ConsoleCommandSender) && !(sender instanceof RemoteConsoleCommandSender)) return true;
        try {
            Object trial = call(owner, "dungeon"), site = call(owner, "siteDungeons");
            World world = Objects.requireNonNull(Bukkit.getWorld("world"));
            Object run = ((Map<?, ?>) field(site, "runs")).get(SITE);
            switch (args[0]) {
                case "setup" -> {
                    if (Boolean.TRUE.equals(field(trial, "active")) || run != null)
                        throw new IllegalStateException("use_fresh_qa_state");
                    world.setGameRule(GameRule.DO_MOB_SPAWNING, false);
                    room(world, -605, -580, 90, -323, -300);
                    room(world, -602, -578, 68, -317, -293);
                    room(world, -602, -578, 56, -317, -293);
                    room(world, 4193, 4255, 80, 4193, 4207);
                    set(trial, "built", true);
                    owner.getConfig().set("dungeon-built", true);
                    owner.getConfig().set("dungeon-building", false);
                    for (String name : ACTORS) {
                        Player p = player(name);
                        p.setGameMode(name.endsWith("Eye") ? GameMode.SPECTATOR : GameMode.SURVIVAL);
                        p.setInvulnerable(true);
                        p.setFoodLevel(20);
                        p.getInventory().clear();
                        p.getInventory().setHelmet(new ItemStack(Material.DIAMOND_HELMET));
                        p.getInventory().setChestplate(new ItemStack(Material.DIAMOND_CHESTPLATE));
                        p.getInventory().setLeggings(new ItemStack(Material.DIAMOND_LEGGINGS));
                        p.getInventory().setBoots(new ItemStack(Material.DIAMOND_BOOTS));
                        p.getInventory().setItem(0, new ItemStack(Material.DIAMOND_SWORD));
                        p.getInventory().setHeldItemSlot(0);
                        p.teleport(new Location(world, 4250.5, 81, 4200.5));
                    }
                    owner.saveConfig();
                }
                case "trial_ready" -> {
                    set(trial, "lastRun", 0L);
                    player(args[1]).teleport(new Location(world, -595.5, 91, -312.5));
                }
                case "trial_kill" -> {
                    ownParty((Set<?>) field(trial, "participants"));
                    clearMobs((Set<?>) field(trial, "mobs"));
                }
                case "trial_timeout" -> {
                    ownParty((Set<?>) field(trial, "participants"));
                    set(trial, "runStartedAt", System.currentTimeMillis() - 86_400_000);
                }
                case "site_in" -> {
                    if (!player(args[1]).teleport(new Location(world,
                            args[1].endsWith("Bob") ? 4203.5 : 4200.5, 81, 4200.5)))
                        throw new IllegalStateException("qa_site_entry_teleport_failed");
                }
                case "out" -> {
                    if (!player(args[1]).teleport(new Location(world, 4250.5, 81, 4200.5)))
                        throw new IllegalStateException("qa_site_exit_teleport_failed");
                }
                case "site_kill" -> {
                    ownParty((Set<?>) field(run, "party"));
                    clearMobs(((Map<?, ?>) field(run, "mobs")).keySet());
                }
                case "site_fault" -> {
                    ownParty((Set<?>) field(run, "party"));
                    set(run, "fault", "qa_explicit_pause");
                    set(run, "pausedAt", System.currentTimeMillis());
                    call(site, "persist");
                }
                case "site_ready" -> {
                    owner.getConfig().set("site-dungeons.cooldowns." + SITE, 0);
                    owner.saveConfig();
                }
                case "trial_revision" -> {
                    sender.sendMessage("ATTR_REVISION " + owner.getConfig().getLong("dungeon-active-run.revision"));
                    return true;
                }
                default -> throw new IllegalArgumentException("unknown_qa_action");
            }
            sender.sendMessage("ATTR_OK " + args[0]);
        } catch (Exception e) {
            getLogger().log(java.util.logging.Level.WARNING, "QA fixture failure", e);
            sender.sendMessage("ATTR_ERROR " + e);
        }
        return true;
    }
}
