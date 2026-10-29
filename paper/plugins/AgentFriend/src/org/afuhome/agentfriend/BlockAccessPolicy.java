package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldedit.math.BlockVector3;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.domains.DefaultDomain;
import com.sk89q.worldguard.protection.flags.Flags;
import com.sk89q.worldguard.protection.flags.RegionGroup;
import com.sk89q.worldguard.protection.flags.StateFlag;
import com.sk89q.worldguard.protection.managers.RegionManager;
import com.sk89q.worldguard.protection.regions.ProtectedCuboidRegion;
import com.sk89q.worldguard.protection.regions.ProtectedRegion;
import java.io.File;
import java.util.*;
import org.bukkit.*;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.*;
import org.bukkit.event.world.WorldLoadEvent;

/** One explicit policy shared by actual block events, preflight and WorldGuard.
 * Only BUILD/BLOCK_BREAK/BLOCK_PLACE are overridden. No OP, permission wildcard,
 * inventory grant, event un-cancellation, chunk loading or terrain editing.
 */
final class BlockAccessPolicy implements Listener {
    static final String PREFIX = "qd_block_access_";
    private final AgentFriendPlugin plugin;
    private final File file;
    private BlockAccessRules rules = new BlockAccessRules(false, Set.of(), List.of());
    BlockAccessPolicy(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        file = new File(plugin.getDataFolder(), "block-access.yml");
        if (!file.exists()) plugin.saveResource("block-access.yml", false);
        reload(Bukkit.getConsoleSender());
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }
    boolean allows(Player player, Location at) {
        if (player == null || at == null || at.getWorld() == null || plugin.isObserver(player)) return false;
        // Free wilderness construction must not override authored dungeon buildings.
        if (plugin.siteDungeons() != null && plugin.siteDungeons().activityArea(at)) return trustedEditor(player);
        if (plugin.dungeon() != null && plugin.dungeon().deniesEdit(at)) return trustedEditor(player);
        return rules.open(player.getUniqueId(), at.getWorld().getName(), at.getBlockX(), at.getBlockZ());
    }
    boolean trustedEditor(Player player) {
        return player!=null&&!plugin.isObserver(player)&&rules.enabled&&rules.editors.contains(player.getUniqueId());
    }
    private static int integer(Map<?, ?> row, String key) {
        if (!(row.get(key) instanceof Integer value)) throw new IllegalArgumentException(key + " 需要整数");
        return value;
    }
    private BlockAccessRules parse() throws Exception {
        YamlConfiguration yaml = new YamlConfiguration(); yaml.load(file);
        if (yaml.getInt("schema-version") != 1 || !yaml.isBoolean("enabled"))
            throw new IllegalArgumentException("需要 schema-version: 1 和 enabled: true/false");
        Set<UUID> editors = new LinkedHashSet<>();
        if (!yaml.isList("editors") || !yaml.isList("villages")) throw new IllegalArgumentException("editors/villages 需要列表");
        for (Object value : yaml.getList("editors")) {
            String text = String.valueOf(value); UUID id = UUID.fromString(text);
            if (!id.toString().equalsIgnoreCase(text) || id.equals(new UUID(0, 0)) || !editors.add(id))
                throw new IllegalArgumentException("建设者需要不重复的完整非零 UUID，不能填玩家显示名");
        }
        List<BlockAccessRules.Area> areas = new ArrayList<>();
        for (Object value : yaml.getList("villages")) {
            if (!(value instanceof Map<?, ?> row) || !(row.get("world") instanceof String world)
                    || Bukkit.getWorld(world) == null) throw new IllegalArgumentException("村庄的 world 必须是已加载世界");
            areas.add(new BlockAccessRules.Area(world, integer(row,"min-x"), integer(row,"min-z"), integer(row,"max-x"), integer(row,"max-z")));
        }
        return new BlockAccessRules(yaml.getBoolean("enabled"), editors, areas);
    }
    private static ProtectedCuboidRegion region(String id, World world, BlockAccessRules.Area a, int priority, Set<UUID> members) {
        ProtectedCuboidRegion r = new ProtectedCuboidRegion(id,
                BlockVector3.at(a.minX(), world.getMinHeight(), a.minZ()),
                BlockVector3.at(a.maxX(), world.getMaxHeight() - 1, a.maxZ()));
        r.setPriority(priority); r.setFlag(Flags.PASSTHROUGH, StateFlag.State.ALLOW);
        if (members != null) { DefaultDomain domain = new DefaultDomain(); members.forEach(domain::addPlayer); r.setMembers(domain); }
        for (StateFlag flag : List.of(Flags.BUILD, Flags.BLOCK_BREAK, Flags.BLOCK_PLACE)) {
            r.setFlag(flag, StateFlag.State.ALLOW);
            r.setFlag(flag.getRegionGroupFlag(), members == null ? RegionGroup.ALL : RegionGroup.MEMBERS);
        }
        return r;
    }
    boolean reload(CommandSender sender) {
        Map<RegionManager, Map<String, ProtectedRegion>> before = new LinkedHashMap<>();
        try {
            BlockAccessRules proposed = parse();
            Map<RegionManager, Map<String, ProtectedRegion>> after = new LinkedHashMap<>();
            for (World world : Bukkit.getWorlds()) {
                RegionManager manager = WorldGuard.getInstance().getPlatform().getRegionContainer().get(BukkitAdapter.adapt(world));
                if (manager == null) throw new IllegalStateException("WorldGuard 世界尚未就绪：" + world.getName());
                before.put(manager, new HashMap<>(manager.getRegions()));
                Map<String, ProtectedRegion> next = new HashMap<>(manager.getRegions());
                next.keySet().removeIf(id -> id.startsWith(PREFIX));
                if (proposed.enabled) {
                    int index = 0;
                    for (var area : proposed.outside(world.getName())) {
                        ProtectedRegion r = region(PREFIX + "outside_" + index++, world, area, 1_000_000, null);
                        next.put(r.getId(), r);
                    }
                    if (!proposed.editors.isEmpty()) {
                        var all = new BlockAccessRules.Area(world.getName(), -BlockAccessRules.LIMIT, -BlockAccessRules.LIMIT, BlockAccessRules.LIMIT, BlockAccessRules.LIMIT);
                        ProtectedRegion r = region(PREFIX + "editors", world, all, 1_000_001, proposed.editors);
                        next.put(r.getId(), r);
                    }
                }
                after.put(manager, next);
            }
            // Validate all worlds before touching any live manager; retain original
            // region objects/ownership/other flags, including container restrictions.
            for (var entry : after.entrySet()) entry.getKey().setRegions(entry.getValue());
            for (RegionManager manager : after.keySet()) manager.save();
            rules = proposed;
            emit(sender, "success", null); return true;
        } catch (Exception error) {
            for (var entry : before.entrySet()) {
                entry.getKey().setRegions(entry.getValue());
                try { entry.getKey().save(); } catch (Exception failure) { plugin.getLogger().severe("Block access rollback could not save: " + failure.getClass().getSimpleName()); }
            }
            plugin.getLogger().warning("Block access reload rejected: " + error.getMessage());
            emit(sender, "denied", "invalid_configuration"); return false;
        }
    }
    private void emit(CommandSender sender, String status, String reason) {
        JsonObject out = new JsonObject(); out.addProperty("schemaVersion",1);
        out.addProperty("status",status); out.addProperty("enabled",rules.enabled);
        out.addProperty("editors",rules.editors.size()); out.addProperty("villages",rules.villages.size());
        out.addProperty("scope","block_break_and_place");
        if (reason != null) { out.addProperty("reason",reason); out.addProperty("nextAction","修正 block-access.yml 后重载；当前有效权限已保留。"); }
        sender.sendMessage("MC_BLOCK_ACCESS " + out);
    }
    void admin(CommandSender sender, String action) {
        if (action.equals("reload")) reload(sender); else emit(sender,"ready",null);
    }
    @EventHandler public void worldLoaded(WorldLoadEvent event) { reload(Bukkit.getConsoleSender()); }
}
