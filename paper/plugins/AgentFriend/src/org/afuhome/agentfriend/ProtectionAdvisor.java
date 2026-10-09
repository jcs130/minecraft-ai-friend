package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.sk89q.worldedit.bukkit.BukkitAdapter;
import com.sk89q.worldguard.WorldGuard;
import com.sk89q.worldguard.bukkit.WorldGuardPlugin;
import com.sk89q.worldguard.protection.flags.Flags;
import com.sk89q.worldguard.protection.RegionResultSet;
import com.sk89q.worldguard.protection.flags.StateFlag;
import com.sk89q.worldguard.protection.regions.ProtectedRegion;
import io.netty.buffer.Unpooled;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.ArrayList;
import java.util.UUID;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.DiscardedPayload;
import net.minecraft.resources.ResourceLocation;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockDamageEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerInteractEvent;

/** A bounded, per-player preflight hint. The actual block event remains authoritative. */
final class ProtectionAdvisor implements Listener {
    static final String CHANNEL = "mcagent:protection";
    private static final int MAX_DISTANCE = 16;
    private static final long MIN_INTERVAL_MS = 100;
    private final AgentFriendPlugin plugin;
    private final Map<UUID, Long> lastQuery = new HashMap<>();
    private final Map<UUID, Notice> notices = new HashMap<>();
    private record Notice(String key, long at) { }

    ProtectionAdvisor(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }

    void stop() {
        Bukkit.getMessenger().unregisterOutgoingPluginChannel(plugin, CHANNEL);
        lastQuery.clear();
        notices.clear();
    }

    void forget(Player player) { lastQuery.remove(player.getUniqueId()); notices.remove(player.getUniqueId()); }

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
        String reason;
        try { reason = check(player, action, x, y, z); }
        catch (RuntimeException | LinkageError unavailable) { reason = "unknown_worldguard"; }
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
        if (reason != null) {
            enrich(player, result, new Location(player.getWorld(), x, y, z));
            explain(player, result);
        }
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

    static String actionLabel(String action) {
        return switch (action) {
            case "break" -> "拆除方块"; case "place" -> "放置方块";
            case "container", "inventory" -> "打开或取放箱内物品"; case "use", "interact" -> "使用设施";
            case "bucket" -> "倒出或舀取液体"; case "fertilize" -> "施肥改动方块";
            case "harvest" -> "收获作物"; case "display", "damage" -> "操作展示物或伤害实体";
            case "drop" -> "丢放物品"; case "pickup" -> "拾取物品"; default -> "执行此操作";
        };
    }

    /** Appends guidance only. The cancelling event and the old reason remain authoritative. */
    void enrich(Player player, JsonObject data, Location at, ProtectionArea... forced) {
        String action = data.get("action").getAsString(), reason = data.get("reason").getAsString();
        data.addProperty("actionLabel", actionLabel(action));
        JsonArray commands = new JsonArray();
        if (reason.startsWith("unknown_")) {
            String hint = switch (reason) {
                case "unknown_rate_limited" -> "查询太快；至少等0.1秒后再查询同一方块。";
                case "unknown_invalid_y" -> "Y坐标越界；使用 " + at.getWorld().getMinHeight() + " 至 " + (at.getWorld().getMaxHeight() - 1) + " 的整数Y坐标重新查询。";
                case "unknown_out_of_range" -> "目标超过16格；先步行到目标16格内再查询，不要隔空操作。";
                case "unknown_unloaded_chunk" -> "目标区块未加载；先沿安全道路靠近，再查询目标方块。";
                case "unknown_not_container" -> "目标不是实体储物方块；核对箱子坐标，开机关请改用 protect use 查询。";
                case "unknown_generated_structure_bounds" -> "此区块关联的建筑起点尚未载入或结构数据不可用；停止拆建，沿原有门、楼梯或梯井通行，恢复可读边界后重查；不要拆墙探路。";
                default -> "保护服务暂不可用；停止拆建或取物，联系服主检查WorldGuard，恢复后再查询。";
            };
            data.addProperty("nextAction", hint); commands.add("/mycli help protect");
            data.add("nextCommands", commands); return;
        }
        Map<String, ProtectionArea> areas = new LinkedHashMap<>();
        for (ProtectionArea area : forced) if (area != null) areas.put(area.id(), area);
        boolean edit = List.of("break", "place", "bucket", "fertilize", "harvest", "damage", "display").contains(action);
        ProtectionArea land = plugin.lands().protectionArea(at);
        if (land != null) {
            try { if (!plugin.lands().allows(player, action, at) || reason.startsWith("land_")) areas.put(land.id(), land); }
            catch (RuntimeException | LinkageError unavailable) { areas.put(land.id(), land); data.addProperty("boundsIncomplete", true); }
        }
        if (reason.startsWith("guild_owner") || reason.equals("guild_hall")) {
            ProtectionArea guild = plugin.guildHall().protectionArea(at);
            if (guild == null && reason.startsWith("guild_owner")) guild = plugin.guildHall().propertyArea();
            if (guild != null) areas.put(guild.id(), guild);
        }
        if (at.getWorld().isChunkLoaded(at.getBlockX() >> 4, at.getBlockZ() >> 4) && edit) {
            Block block = at.getBlock();
            add(areas, plugin.villageProtection().deniesEdit(player, block) || reason.equals("village_structure") ? plugin.villageProtection().protectionArea(at) : null);
            add(areas, plugin.lifeBuildings().deniesEdit(block) || reason.equals("life_guild_building") ? plugin.lifeBuildings().protectionArea(at) : null);
            add(areas, plugin.guildHall().deniesEdit(player, block) || reason.equals("guild_hall") ? plugin.guildHall().protectionArea(at) : null);
            add(areas, (action.equals("place") ? plugin.trialRoad().deniesPlace(block) : plugin.trialRoad().deniesBreak(block)) || reason.equals("trial_road") ? plugin.trialRoad().protectionArea(at) : null);
            add(areas, plugin.arenaProtectionArea(at)); add(areas, plugin.pvpProtectionArea(at));
            add(areas, plugin.dungeon().protectionArea(at));
            if (plugin.siteDungeons() != null) add(areas, plugin.siteDungeons().protectionArea(at));
            if (plugin.generatedStructures() != null) add(areas, plugin.generatedStructures().protectionArea(at));
        }
        if (action.equals("container") && at.getWorld().isChunkLoaded(at.getBlockX() >> 4, at.getBlockZ() >> 4))
            add(areas, plugin.lands().containerArea(player, at.getBlock()));
        try { worldGuardAreas(player, action, at, areas, data); }
        catch (RuntimeException | LinkageError unavailable) { data.addProperty("boundsIncomplete", true); }
        JsonArray entries = new JsonArray(); areas.values().forEach(area -> entries.add(area.json())); data.add("areas", entries);
        data.addProperty("boundaryInclusive", true);
        data.addProperty("retrySameAction", false);
        boolean guild = reason.startsWith("guild_owner") || data.has("landId") && data.get("landId").getAsString().equals(LandManager.GUILD);
        boolean tagged = List.of("pickup", "display", "inventory").contains(action)
                && !areas.isEmpty() && areas.values().stream().noneMatch(a -> a.contains(at));
        String next;
        if (reason.equals("land_unavailable") || reason.equals("guild_owner_unavailable") || data.has("boundsIncomplete"))
            next = "权限数据未就绪；停止操作并联系服主恢复保护服务，再重新查询。";
        else if (reason.equals("land_notice_board")) {
            next = "领地公告牌及支撑方块受保护，不能拆改；右键查看主人和完整协作者名单，主人从公告页管理授权。位置调整请联系服主。";
            commands.add("/mycli land here");
        }
        else if (tagged) next = "这件物品仍归原主人；移出保护区也不会解除归属，请取得主人授权。";
        else if (List.of("generated_structure", "village_structure", "life_guild_building").contains(reason)) {
            next = "不要拆建筑墙、门、梯子或垫方块；沿原有门、楼梯、梯井通行。木门用使用键/原有方块交互打开，铁门找按钮或拉杆；贴梯面向前移动或跳跃上爬。施工请另选上述结构片段范围外位置并重新查权限。";
            commands.add("/mycli world practice start"); commands.add("/mycli protect use <门或机关x> <y> <z>");
        }
        else if (guild && !edit && !action.equals("drop")) {
            next = "不要取放公会私产；需要物资装备请到门口公共箱，先用 /mycli guild shared 查看准确位置。";
            commands.add("/mycli guild shared");
        } else if (data.has("globalProtection") && data.get("globalProtection").getAsBoolean())
            next = "当前世界有全局权限限制，不能靠跨越局部边界解决；联系服主确认可施工地点或授权。";
        else if (!areas.isEmpty()) {
            int minX = areas.values().stream().mapToInt(ProtectionArea::minX).min().orElseThrow();
            int maxX = areas.values().stream().mapToInt(ProtectionArea::maxX).max().orElseThrow();
            int minZ = areas.values().stream().mapToInt(ProtectionArea::minZ).min().orElseThrow();
            int maxZ = areas.values().stream().mapToInt(ProtectionArea::maxZ).max().orElseThrow();
            next = "停止" + actionLabel(action) + "；另选同世界 X≤" + (minX - 1) + " 或 X≥" + (maxX + 1)
                    + " 或 Z≤" + (minZ - 1) + " 或 Z≥" + (maxZ + 1) + " 的区外目标。";
            if (!edit) next += "区外只能操作公共或自己的物品；私产须由主人授权。";
            next += "那里可能还有其他保护，靠近后先查询目标，得到 allow_likely 再操作。";
        } else next = "停止操作；用 /mycli land here 核对归属，联系主人或服主确认允许的位置后重新查询。";
        if (guild && (edit || action.equals("drop"))) { next += "领物资请用 /mycli guild shared；不要拆公共箱。"; commands.add("/mycli guild shared"); }
        if (data.has("landCommand")) commands.add(data.get("landCommand").getAsString());
        if (edit) commands.add("/mycli protect " + (action.equals("place") ? "place" : "break") + " <目标x> <目标y> <目标z>");
        else commands.add("/mycli protect " + (action.equals("container") || action.equals("inventory") ? "container" : "use") + " <目标x> <目标y> <目标z>");
        data.addProperty("nextAction", next); data.add("nextCommands", commands);
    }

    private void add(Map<String, ProtectionArea> areas, ProtectionArea area) { if (area != null) areas.putIfAbsent(area.id(), area); }

    private void worldGuardAreas(Player player, String action, Location at, Map<String, ProtectionArea> areas, JsonObject data) {
        var manager = WorldGuard.getInstance().getPlatform().getRegionContainer().get(BukkitAdapter.adapt(at.getWorld()));
        if (manager == null) throw new IllegalStateException("WorldGuard regions unavailable");
        if (plugin.lands().stateAllows(player, action, at)) return;
        var set = manager.getApplicableRegions(com.sk89q.worldedit.math.BlockVector3.at(at.getBlockX(), at.getBlockY(), at.getBlockZ()));
        var local = WorldGuardPlugin.inst().wrapPlayer(player);
        StateFlag flag = switch (action) {
            case "break", "harvest", "damage", "display" -> Flags.BLOCK_BREAK;
            case "place", "bucket", "fertilize" -> Flags.BLOCK_PLACE;
            case "container", "inventory" -> Flags.CHEST_ACCESS; case "drop" -> Flags.ITEM_DROP;
            case "pickup" -> Flags.ITEM_PICKUP; case "interact" -> Flags.INTERACT; default -> Flags.USE;
        };
        boolean edit = List.of("break", "harvest", "damage", "display", "place", "bucket", "fertilize").contains(action);
        boolean physicalDenial = false;
        for (ProtectedRegion region : set) {
            if (!region.isPhysicalArea()) continue;
            var single = new RegionResultSet(new ArrayList<>(List.of(region)), null);
            boolean build = single.testState(local, Flags.BUILD); StateFlag.State value = single.queryState(local, flag);
            if ((!edit || build) && (value == null ? build : value == StateFlag.State.ALLOW)) continue;
            physicalDenial = true;
            var min = region.getMinimumPoint(); var max = region.getMaximumPoint();
            add(areas, new ProtectionArea(region.getId(), "区域 " + region.getId(), at.getWorld(), min.x(), min.y(), min.z(),
                    max.x(), max.y(), max.z(), region.getType().name().equals("CUBOID") ? "cuboid" : "polygon_envelope"));
        }
        if (!physicalDenial && manager.getRegion("__global__") != null) data.addProperty("globalProtection", true);
    }

    boolean explain(Player player, JsonObject data) {
        String key = data.get("action").getAsString() + ":" + data.get("world").getAsString() + ":" + data.get("x") + ":" + data.get("y") + ":" + data.get("z");
        long now = System.currentTimeMillis(); Notice last = notices.get(player.getUniqueId());
        if (last != null && last.key().equals(key) && now - last.at() < 1500) return false;
        notices.put(player.getUniqueId(), new Notice(key, now));
        player.sendMessage("§c【操作未执行】" + data.get("actionLabel").getAsString()
                + (data.get("reason").getAsString().startsWith("unknown_") ? "尚未确认权限；目标 " : "被保护规则拒绝；目标 ") + data.get("world").getAsString()
                + " (" + data.get("x") + "," + data.get("y") + "," + data.get("z") + ")。"
                + (data.has("owner") ? "归属：" + data.get("owner").getAsString() + "。" : ""));
        if (data.has("globalProtection")) player.sendMessage("§e【保护范围】" + data.get("world").getAsString() + " 全世界权限限制；没有可跨出的局部坐标边界。");
        if (data.has("areas")) for (var entry : data.getAsJsonArray("areas")) {
            JsonObject area = entry.getAsJsonObject(); var min = area.getAsJsonArray("min"); var max = area.getAsJsonArray("max");
            player.sendMessage("§e【保护范围】" + area.get("name").getAsString() + "：" + area.get("world").getAsString()
                    + " (" + min.get(0) + "," + min.get(1) + "," + min.get(2) + ") 至 (" + max.get(0) + "," + max.get(1) + "," + max.get(2) + ")，含边界。"
                    + (area.get("envelopeOnly").getAsBoolean() ? "这是外包范围，具体按原建筑方块/净空或区域形状保护。" : ""));
        }
        player.sendMessage("§a【正确做法】" + data.get("nextAction").getAsString());
        return true;
    }

    void denied(Player player, String action, Location at, String reason, ProtectionArea... forced) {
        JsonObject data = new JsonObject(); data.addProperty("schemaVersion", 1); data.addProperty("kind", "building");
        data.addProperty("action", action); data.addProperty("status", "deny"); data.addProperty("allowed", false); data.addProperty("reason", reason);
        data.addProperty("world", at.getWorld().getKey().toString());
        data.addProperty("x", at.getBlockX()); data.addProperty("y", at.getBlockY()); data.addProperty("z", at.getBlockZ());
        plugin.lands().fields(data, at); enrich(player, data, at, forced);
        if (!explain(player, data)) return;
        send(player, data); player.sendMessage("MC_PROTECTION " + data);
    }

    // Includes WorldGuard-only denials (bells, extra regions). Never cancel or un-cancel an event here.
    private void cancelled(Player p, String action, Block b) {
        try {
            if (!plugin.lands().stateAllows(p, action, b.getLocation())) denied(p, action, b.getLocation(), "worldguard");
        } catch (RuntimeException | LinkageError unavailable) { /* Existing cancelling handler remains authoritative. */ }
    }
    @EventHandler(priority = EventPriority.MONITOR) public void onDamage(BlockDamageEvent e) { if (e.isCancelled()) cancelled(e.getPlayer(), "break", e.getBlock()); }
    @EventHandler(priority = EventPriority.MONITOR) public void onBreak(BlockBreakEvent e) { if (e.isCancelled()) cancelled(e.getPlayer(), "break", e.getBlock()); }
    @EventHandler(priority = EventPriority.MONITOR) public void onPlace(BlockPlaceEvent e) { if (e.isCancelled()) cancelled(e.getPlayer(), "place", e.getBlock()); }
    @EventHandler(priority = EventPriority.MONITOR) public void onUse(PlayerInteractEvent e) {
        if (e.getClickedBlock() != null && e.useInteractedBlock() == org.bukkit.event.Event.Result.DENY
                && e.getAction() == org.bukkit.event.block.Action.RIGHT_CLICK_BLOCK)
            cancelled(e.getPlayer(), plugin.guildStorage().physicalContainer(e.getClickedBlock()) ? "container" : "use", e.getClickedBlock());
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
        if (plugin.lands().access() != null) {
            if (action.equals("use") && plugin.lands().access().isBoard(block)) return null;
            if (!action.equals("use") && !action.equals("container") && plugin.lands().access().protectsBoard(block)) return "land_notice_board";
        }
        if (!plugin.lands().allows(player, action, block.getLocation()))
            return plugin.guildHall().containsProperty(block.getLocation()) ? "guild_owner_only" : "land_permission_denied";
        if (action.equals("container")) {
            if (!plugin.guildStorage().physicalContainer(block)) return "unknown_not_container";
            if (plugin.guildStorage().deniesContainer(player, block)) return "guild_owner_only";
            if (plugin.lands().deniesContainer(player, block)) return "land_permission_denied";
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
        if (plugin.pvpProtectionArea(block.getLocation()) != null) return "pvp_arena";
        if (plugin.siteDungeons() != null && plugin.siteDungeons().protectionArea(block.getLocation()) != null) return "site_dungeon";
        if (plugin.generatedStructures() != null && plugin.generatedStructures().deniesEdit(block)) return plugin.generatedStructures().reason(block.getLocation());
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
