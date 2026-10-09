package org.afuhome.agentfriend;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.command.ConsoleCommandSender;
import org.bukkit.command.RemoteConsoleCommandSender;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.server.RemoteServerCommandEvent;
import org.bukkit.event.server.ServerCommandEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerTeleportEvent;

/** Charges voluntary, non-vanilla travel only after an accepted teleport. */
final class TravelMagic implements Listener {
    static final int LOCAL_MANA = 6;
    static final int DISTANT_MANA = 8;
    private static final long COMMAND_WINDOW_MS = 15_000L;
    private static final Set<String> TELEPORT_COMMANDS = Set.of(
            "warp", "home", "back", "spawn", "tp", "teleport", "tpaccept", "tpyes", "tpaaccept",
            "ewarp", "ehome", "eback", "espawn", "etp", "eteleport", "etpaccept");

    private record Pending(String id, String name, int mana, Location expected, long expiresAt) {
        boolean matches(Location to) {
            return System.currentTimeMillis() <= expiresAt && (expected == null || to != null
                    && expected.getWorld() == to.getWorld() && expected.distanceSquared(to) <= 16);
        }
    }

    private final AgentFriendPlugin plugin;
    private final Map<UUID, Pending> pending = new HashMap<>();
    private final Map<UUID, Long> adminTeleports = new HashMap<>();
    private final Map<UUID, Long> spellTeleports = new HashMap<>();
    private final Set<UUID> internal = new java.util.HashSet<>();

    TravelMagic(AgentFriendPlugin plugin) { this.plugin = plugin; }

    void exemptBlink(Player player) {
        spellTeleports.put(player.getUniqueId(), System.currentTimeMillis() + 2000L);
    }

    boolean teleport(Player player, Location destination, String id, String name, int mana) {
        if (!plugin.professions().basicAllowed(player,id.equals("home") ? "home" : id.equals("support") ? "support" : "travel")) return false;
        if (player.getGameMode() == GameMode.SPECTATOR) {
            player.sendMessage(ChatColor.RED + "旁观者不能使用传送术；请使用对应的生存角色，/mycli status 核对状态。"); return false;
        }
        if (!plugin.hasMana(player, mana)) return false;
        Location departure = player.getLocation().clone();
        internal.add(player.getUniqueId());
        boolean moved;
        try { moved = player.teleport(destination); }
        finally { internal.remove(player.getUniqueId()); }
        if (!moved) {
            player.sendMessage(ChatColor.RED + "传送被保护规则取消；未耗魔。先 /mycli land here 核对权限，再 /mycli waypoint 另选公开安全目标；持续异常联系服主。"); return false;
        }
        if (!plugin.spendMana(player, mana)) {
            plugin.getLogger().severe("Accepted travel could not be charged: " + player.getUniqueId());
            player.teleport(departure);
            return false;
        }
        succeeded(player, departure, id, name, mana);
        return true;
    }

    boolean command(Player player, String command, Location expected, String id, String name, int mana) {
        if (!plugin.professions().basicAllowed(player,id.equals("home") ? "home" : "travel")) return false;
        if (player.getGameMode() == GameMode.SPECTATOR) {
            player.sendMessage(ChatColor.RED + "旁观者不能使用传送术；请使用对应的生存角色，/mycli status 核对状态。"); return false;
        }
        if (!plugin.hasMana(player, mana)) return false;
        UUID uuid = player.getUniqueId();
        Pending request = new Pending(id, name, mana, expected == null ? null : expected.clone(),
                System.currentTimeMillis() + COMMAND_WINDOW_MS);
        pending.put(uuid, request);
        if (player.performCommand(command)) return true;
        pending.remove(uuid, request);
        return false;
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onPlayerCommand(PlayerCommandPreprocessEvent event) {
        String line = event.getMessage().stripLeading();
        if (!line.startsWith("/")) return;
        String root = line.substring(1).split("\\s+", 2)[0].toLowerCase(Locale.ROOT);
        root = root.substring(root.lastIndexOf(':') + 1);
        if (!TELEPORT_COMMANDS.contains(root)) return;
        if (!plugin.professions().basicAllowed(event.getPlayer(),"travel")) { event.setCancelled(true); return; }
        pending.put(event.getPlayer().getUniqueId(), new Pending("command", "指令传送", LOCAL_MANA,
                null, System.currentTimeMillis() + COMMAND_WINDOW_MS));
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onServerCommand(ServerCommandEvent event) {
        trackAdminTeleport(event);
    }

    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onRemoteCommand(RemoteServerCommandEvent event) {
        trackAdminTeleport(event);
    }

    private void trackAdminTeleport(ServerCommandEvent event) {
        if (!(event.getSender() instanceof ConsoleCommandSender)
                && !(event.getSender() instanceof RemoteConsoleCommandSender)) return;
        String[] parts = event.getCommand().stripLeading().split("\\s+", 3);
        if (parts.length < 2) return;
        String root = parts[0].toLowerCase(Locale.ROOT);
        root = root.substring(root.lastIndexOf(':') + 1);
        if (!root.equals("tp") && !root.equals("teleport")) return;
        Player target = Bukkit.getPlayerExact(parts[1]);
        if (target != null) adminTeleports.put(target.getUniqueId(), System.currentTimeMillis() + 5000L);
    }

    private Pending request(PlayerTeleportEvent event) {
        Player player = event.getPlayer();
        if (player.getGameMode() == GameMode.SPECTATOR || internal.contains(player.getUniqueId())) return null;
        if (event.getCause() != PlayerTeleportEvent.TeleportCause.COMMAND
                && event.getCause() != PlayerTeleportEvent.TeleportCause.PLUGIN) return null;
        long now = System.currentTimeMillis();
        if (adminTeleports.getOrDefault(player.getUniqueId(), 0L) >= now
                || spellTeleports.getOrDefault(player.getUniqueId(), 0L) >= now) return null;
        Pending saved = pending.get(player.getUniqueId());
        if (saved != null) {
            if (event.getCause() == PlayerTeleportEvent.TeleportCause.COMMAND
                    && now <= saved.expiresAt()) return saved;
            if (saved.expected() != null && saved.matches(event.getTo())) return saved;
        }
        return event.getCause() == PlayerTeleportEvent.TeleportCause.COMMAND
                ? new Pending("command", "指令传送", LOCAL_MANA, null, now + COMMAND_WINDOW_MS) : null;
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onTeleportCheck(PlayerTeleportEvent event) {
        Pending request = request(event);
        if (request != null && (!plugin.professions().basicAllowed(event.getPlayer(),request.id().equals("home") ? "home" : "travel") || !plugin.hasMana(event.getPlayer(), request.mana()))) {
            event.setCancelled(true);
            pending.remove(event.getPlayer().getUniqueId());
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onTeleportAccepted(PlayerTeleportEvent event) {
        UUID id = event.getPlayer().getUniqueId();
        long now = System.currentTimeMillis();
        if ((event.getCause() == PlayerTeleportEvent.TeleportCause.COMMAND
                || event.getCause() == PlayerTeleportEvent.TeleportCause.PLUGIN)
                && (adminTeleports.getOrDefault(id, 0L) >= now
                    || spellTeleports.getOrDefault(id, 0L) >= now)) {
            adminTeleports.remove(id);
            spellTeleports.remove(id);
            return;
        }
        Pending request = request(event);
        if (request == null) return;
        Player player = event.getPlayer();
        pending.remove(player.getUniqueId());
        if (!plugin.spendMana(player, request.mana())) {
            plugin.getLogger().severe("Accepted command travel could not be charged: " + player.getUniqueId());
            return;
        }
        Location departure = event.getFrom().clone();
        succeeded(player, departure, request.id(), request.name(), request.mana());
    }

    private void succeeded(Player player, Location departure, String id, String name, int mana) {
        if (departure.getWorld() != null) {
            departure.getWorld().spawnParticle(Particle.PORTAL, departure.clone().add(0, 1, 0),
                    24, .35, .7, .35, .05);
            departure.getWorld().playSound(departure, Sound.ENTITY_ENDERMAN_TELEPORT, .6f, 1.05f);
        }
        UUID uuid = player.getUniqueId();
        Bukkit.getScheduler().runTask(plugin, () -> {
            Player current = Bukkit.getPlayer(uuid);
            if (current == null || !current.isOnline()) return;
            String spell = id.equals("home") ? "home" : "travel";
            plugin.presentSpell(current, spell);
            plugin.publishSkill(current, spell, name + "已生效，消耗 " + mana + " 魔力", current.getLocation());
            current.sendMessage(ChatColor.LIGHT_PURPLE + "✦ " + name + "已生效，消耗 " + mana + " 魔力。 "
                    + LocationOutput.fields(current.getLocation()));
            current.sendMessage("MC_TRAVEL id=" + id + " mana=" + mana + " "
                    + LocationOutput.fields(current.getLocation()));
        });
    }

    @EventHandler public void onQuit(PlayerQuitEvent event) {
        pending.remove(event.getPlayer().getUniqueId());
        adminTeleports.remove(event.getPlayer().getUniqueId());
        spellTeleports.remove(event.getPlayer().getUniqueId());
    }
}
