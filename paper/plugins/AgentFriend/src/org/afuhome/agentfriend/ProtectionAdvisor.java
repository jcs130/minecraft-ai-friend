package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.bukkit.WorldGuardPlugin;
import com.sk89q.worldguard.protection.flags.Flags;
import com.sk89q.worldguard.protection.regions.RegionQuery;
import io.netty.buffer.Unpooled;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.DiscardedPayload;
import net.minecraft.resources.ResourceLocation;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;

/** A bounded, per-player preflight hint. The actual block event remains authoritative. */
final class ProtectionAdvisor {
    static final String CHANNEL = "mcagent:protection";
    private static final int MAX_DISTANCE = 16;
    private static final long MIN_INTERVAL_MS = 100;
    private final AgentFriendPlugin plugin;
    private final Map<UUID, Long> lastQuery = new HashMap<>();

    ProtectionAdvisor(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
    }

    void stop() {
        Bukkit.getMessenger().unregisterOutgoingPluginChannel(plugin, CHANNEL);
        lastQuery.clear();
    }

    void forget(Player player) { lastQuery.remove(player.getUniqueId()); }

    void command(Player player, String[] args) {
        if (args.length != 5 || !(args[1].equalsIgnoreCase("break") || args[1].equalsIgnoreCase("place") || args[1].equalsIgnoreCase("container") || args[1].equalsIgnoreCase("use"))) {
            player.sendMessage("用法：/mycli protect break|place|container|use <x> <y> <z>；只查询自己附近已加载的方块。");
            return;
        }
        String action = args[1].toLowerCase(java.util.Locale.ROOT);
        int x, y, z;
        try {
            x = Integer.parseInt(args[2]); y = Integer.parseInt(args[3]); z = Integer.parseInt(args[4]);
        } catch (NumberFormatException invalid) {
            player.sendMessage("坐标必须是整数：/mycli protect break|place|container|use <x> <y> <z>");
            return;
        }
        JsonObject result = new JsonObject();
        result.addProperty("schemaVersion", 1);
        result.addProperty("action", action);
        result.addProperty("world", player.getWorld().getKey().toString());
        result.addProperty("x", x);
        result.addProperty("y", y);
        result.addProperty("z", z);
        String reason = check(player, action, x, y, z);
        if (reason == null) {
            result.addProperty("status", "allow_likely");
            result.addProperty("allowed", true);
            result.addProperty("reason", "no_known_protection");
        } else if (reason.startsWith("unknown_")) {
            result.addProperty("status", "unknown");
            result.add("allowed", com.google.gson.JsonNull.INSTANCE);
            result.addProperty("reason", reason);
        } else {
            result.addProperty("status", "deny");
            result.addProperty("allowed", false);
            result.addProperty("reason", reason);
        }
        if ((reason != null && reason.startsWith("guild_owner")) || plugin.guildHall().containsProperty(new Location(player.getWorld(), x, y, z)))
            plugin.guildStorage().ownershipFields(result);
        plugin.lands().fields(result, new Location(player.getWorld(), x, y, z));
        send(player, result);
        player.sendMessage("MC_PROTECTION " + result);
    }

    void send(Player player, JsonObject result) {
        send(player, result, CHANNEL);
    }

    void send(Player player, JsonObject result, String channel) {
        byte[] bytes = result.toString().getBytes(StandardCharsets.UTF_8);
        if (player.getListeningPluginChannels().contains(channel)) {
            player.sendPluginMessage(plugin, channel, bytes);
        } else {
            // CraftPlayer.sendPluginMessage silently skips clients that did not
            // register the channel. CortiLan's current Mineflayer connection is
            // one of them. Send the same vanilla custom payload directly.
            CraftPlayer craft = (CraftPlayer) player;
            craft.getHandle().connection.send(new ClientboundCustomPayloadPacket(
                    new DiscardedPayload(new ResourceLocation(channel), Unpooled.wrappedBuffer(bytes))));
        }
    }

    private String check(Player player, String action, int x, int y, int z) {
        long now = System.currentTimeMillis();
        long previous = lastQuery.getOrDefault(player.getUniqueId(), 0L);
        if (now - previous < MIN_INTERVAL_MS) return "unknown_rate_limited";
        lastQuery.put(player.getUniqueId(), now);
        if (y < player.getWorld().getMinHeight() || y >= player.getWorld().getMaxHeight())
            return "unknown_invalid_y";
        Location eye = player.getEyeLocation();
        double dx = x + .5 - eye.getX(), dy = y + .5 - eye.getY(), dz = z + .5 - eye.getZ();
        if (dx * dx + dy * dy + dz * dz > MAX_DISTANCE * MAX_DISTANCE)
            return "unknown_out_of_range";
        if (!player.getWorld().isChunkLoaded(x >> 4, z >> 4)) return "unknown_unloaded_chunk";
        Block block = player.getWorld().getBlockAt(x, y, z);
        if (!plugin.lands().allows(player, action, block.getLocation()))
            return plugin.guildHall().containsProperty(block.getLocation()) ? "guild_owner_only" : "land_permission_denied";
        if (action.equals("container")) {
            if (!plugin.guildStorage().physicalContainer(block)) return "unknown_not_container";
            if (plugin.guildStorage().deniesContainer(player, block)) return "guild_owner_only";
            try {
                if (!plugin.lands().stateAllows(player, "container", block.getLocation())) return "worldguard";
            } catch (RuntimeException | LinkageError unavailable) { return "unknown_worldguard"; }
            return null;
        }
        if (action.equals("use")) {
            try {
                if (!plugin.lands().stateAllows(player, "use", block.getLocation())) return "worldguard";
            } catch (RuntimeException | LinkageError unavailable) { return "unknown_worldguard"; }
            return null;
        }
        if (plugin.guildStorage().deniesEdit(player, block)) return "guild_owner_only";
        if (plugin.villageProtection().deniesEdit(player, block)) return "village_structure";
        if (plugin.guildHall().deniesEdit(player, block)) return "guild_hall";
        if (plugin.lifeBuildings().deniesEdit(block)) return "life_guild_building";
        if (action.equals("break") ? plugin.trialRoad().deniesBreak(block)
                : plugin.trialRoad().deniesPlace(block)) return "trial_road";
        if (plugin.deniesArenaEdit(block)) return "arena";
        if (plugin.dungeon().deniesEdit(block.getLocation())) return "dungeon";
        try {
            boolean allowed = plugin.lands().stateAllows(player, action, block.getLocation());
            if (!allowed) return "worldguard";
        } catch (RuntimeException | LinkageError unavailable) {
            plugin.getLogger().warning("Protection query unavailable: " + unavailable);
            return "unknown_worldguard";
        }
        return null;
    }
}
