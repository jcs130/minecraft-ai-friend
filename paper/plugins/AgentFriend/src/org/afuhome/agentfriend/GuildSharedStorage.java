package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Chest;
import org.bukkit.block.DoubleChest;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/** Physical, publicly accessible overflow boxes; the original four boxes keep their IDs and slots. */
final class GuildSharedStorage {
    static final List<String> IDS = List.of("weapons", "armor", "supplies", "misc");
    private record Point(int x, int y, int z) {
        Location at(World world) { return new Location(world, x, y, z); }
        String key() { return x + "," + y + "," + z; }
    }
    private final AgentFriendPlugin plugin;
    private final Path file;
    private List<List<Point>> extras = List.of(List.of(), List.of(), List.of(), List.of());
    private boolean ready;

    GuildSharedStorage(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        file = plugin.getDataFolder().toPath().resolve("guild-shared-chests.yml");
        if (!Files.exists(file)) plugin.saveResource("guild-shared-chests.yml", false);
        reload(Bukkit.getConsoleSender());
    }

    private Point point(Object value) {
        if (!(value instanceof List<?> values) || values.size() != 3)
            throw new IllegalArgumentException("箱子坐标需要三个整数");
        int[] xyz = new int[3];
        for (int i = 0; i < 3; i++) {
            if (!(values.get(i) instanceof Number n) || !Double.isFinite(n.doubleValue())
                    || n.doubleValue() != n.intValue()) throw new IllegalArgumentException("箱子坐标需要整数");
            xyz[i] = n.intValue();
        }
        int x = plugin.getConfig().getInt("guild-hall.x"), y = plugin.getConfig().getInt("guild-hall.y"),
                z = plugin.getConfig().getInt("guild-hall.z");
        if (Math.abs((long) xyz[0] - (x + 16)) > 24 || Math.abs((long) xyz[2] - (z + 10)) > 24
                || xyz[1] < y || xyz[1] > y + 16)
            throw new IllegalArgumentException("共享箱须在公会服务区附近（水平24格、高度16格内）");
        return new Point(xyz[0], xyz[1], xyz[2]);
    }

    private Inventory extraInventory(Point point) {
        World world = Bukkit.getWorld("world");
        if (world == null || !world.isChunkGenerated(point.x() >> 4, point.z() >> 4)
                || !(world.getBlockAt(point.x(), point.y(), point.z()).getState() instanceof Chest chest))
            throw new IllegalArgumentException("共享箱不存在：" + point.key());
        Inventory inventory = chest.getInventory();
        if (inventory.getSize() != 54 || !(inventory.getHolder() instanceof DoubleChest doubleChest)
                || !(doubleChest.getLeftSide() instanceof Chest left) || !(doubleChest.getRightSide() instanceof Chest right))
            throw new IllegalArgumentException("扩容箱须为完整双箱：" + point.key());
        for (Chest half : List.of(left, right)) {
            if (!plugin.lands().publicContainer(half.getLocation()))
                throw new IllegalArgumentException("扩容箱两半须先登记为领地公共箱：" + point.key());
        }
        return inventory;
    }

    boolean reload(CommandSender sender) {
        try {
            if (Files.size(file) > 65536) throw new IllegalArgumentException("共享箱配置超过64KiB");
            YamlConfiguration yaml = new YamlConfiguration();
            yaml.loadFromString(Files.readString(file, StandardCharsets.UTF_8));
            if (yaml.getInt("schema-version", 0) != 1) throw new IllegalArgumentException("schema-version 必须为1");
            ConfigurationSection section = yaml.getConfigurationSection("extras");
            if (section == null || !IDS.containsAll(section.getKeys(false)))
                throw new IllegalArgumentException("extras 只支持 weapons/armor/supplies/misc");
            List<List<Point>> proposed = new ArrayList<>();
            Set<String> used = new HashSet<>();
            for (int c = 0; c < 4; c++) {
                Inventory original = plugin.guildHall().sharedInventory(c);
                // An unopened hall may retain an empty expansion configuration.
                if (original != null) reserve(original, used);
                String id = IDS.get(c);
                if (section.contains(id) && !section.isList(id)) throw new IllegalArgumentException(id + "需要坐标列表");
                List<?> values = section.getList(id, List.of());
                if (values.size() > 16) throw new IllegalArgumentException("每类最多16组扩容双箱");
                List<Point> points = new ArrayList<>();
                for (Object value : values) {
                    Point p = point(value); reserve(extraInventory(p), used); points.add(p);
                }
                if (!points.isEmpty() && original == null) throw new IllegalArgumentException("原公共双箱尚不可用：" + id);
                proposed.add(List.copyOf(points));
            }
            extras = List.copyOf(proposed); ready = true;
            sender.sendMessage("MC_GUILD_SHARED_RELOAD {\"schemaVersion\":1,\"status\":\"success\",\"extraGroups\":"
                    + extras.stream().mapToInt(List::size).sum() + "}");
            return true;
        } catch (Exception error) {
            JsonObject result = new JsonObject(); result.addProperty("schemaVersion", 1);
            result.addProperty("status", "denied"); result.addProperty("detail", error.getMessage());
            result.addProperty("retainedPrevious", ready);
            sender.sendMessage("MC_GUILD_SHARED_RELOAD " + result);
            plugin.getLogger().warning("Public storage configuration rejected: " + error.getMessage());
            return false;
        }
    }

    private void reserve(Inventory inventory, Set<String> used) {
        if (!(inventory.getHolder() instanceof DoubleChest pair)
                || !(pair.getLeftSide() instanceof Chest left) || !(pair.getRightSide() instanceof Chest right))
            throw new IllegalArgumentException("共享箱不是完整双箱");
        for (Chest half : List.of(left, right)) {
            Location at = half.getLocation();
            if (!used.add(at.getWorld().getUID() + ":" + at.getBlockX() + "," + at.getBlockY() + "," + at.getBlockZ()))
                throw new IllegalArgumentException("同一个箱子不能重复登记或跨类别复用");
        }
    }

    /** Recheck physical pairing and public ownership after any online land change. */
    List<Inventory> inventories(int category) {
        if (!ready || category < 0 || category >= 4) return null;
        Inventory original = plugin.guildHall().sharedInventory(category);
        if (original == null) return null;
        List<Inventory> result = new ArrayList<>(); result.add(original);
        try {
            Set<String> used = new HashSet<>(); reserve(original, used);
            for (Point point : extras.get(category)) { Inventory inventory = extraInventory(point); reserve(inventory, used); result.add(inventory); }
            return List.copyOf(result);
        } catch (IllegalArgumentException unavailable) { return null; }
    }

    int plainStock(int category, Material material) {
        List<Inventory> pool = inventories(category);
        if (pool == null) return -1;
        int total = 0; ItemStack plain = new ItemStack(material);
        for (Inventory inventory : pool) for (ItemStack item : inventory.getContents())
            if (item != null && item.isSimilar(plain)) total += item.getAmount();
        return total;
    }

    static final class Receipt {
        private final Map<Inventory, ItemStack[]> before;
        private Receipt(Map<Inventory, ItemStack[]> before) { this.before = before; }
        void rollback() { before.forEach(Inventory::setContents); }
        void announce(Player player, int category, Material material, int amount) {
            JsonObject data = new JsonObject(); data.addProperty("schemaVersion", 1); data.addProperty("status", "success");
            data.addProperty("category", IDS.get(category)); data.addProperty("item", material.getKey().toString()); data.addProperty("amount", amount);
            JsonArray boxes = new JsonArray();
            for (Inventory inventory : before.keySet()) {
                Location at = inventory.getLocation();
                if (at != null) {
                    JsonObject box = new JsonObject(); box.addProperty("x", at.getBlockX()); box.addProperty("y", at.getBlockY()); box.addProperty("z", at.getBlockZ()); boxes.add(box);
                }
            }
            data.add("boxes", boxes); player.sendMessage("MC_GUILD_DELIVERY " + data);
        }
    }

    /** Same server tick as the debit/reward; failed or partially fitting additions restore every box. */
    static Receipt place(List<Inventory> pool, ItemStack offered) {
        if (pool == null || offered == null || offered.getAmount() <= 0) return null;
        long free = 0;
        for (Inventory inventory : pool) for (ItemStack existing : inventory.getContents()) {
            int limit = Math.min(inventory.getMaxStackSize(), offered.getMaxStackSize());
            if (existing == null || existing.getType().isAir()) free += limit;
            else if (existing.isSimilar(offered)) free += Math.max(0, limit - existing.getAmount());
        }
        if (free < offered.getAmount()) return null;
        Map<Inventory, ItemStack[]> before = new LinkedHashMap<>();
        Receipt receipt = new Receipt(before); ItemStack remaining = offered.clone();
        try {
            for (Inventory inventory : pool) {
                ItemStack[] copy = inventory.getContents();
                for (int i = 0; i < copy.length; i++) if (copy[i] != null) copy[i] = copy[i].clone();
                before.put(inventory, copy);
                Map<Integer, ItemStack> left = inventory.addItem(remaining);
                if (java.util.Arrays.equals(copy, inventory.getContents())) before.remove(inventory);
                if (left.isEmpty()) return receipt;
                remaining = left.values().iterator().next();
            }
        } catch (RuntimeException error) { receipt.rollback(); throw error; }
        receipt.rollback(); return null;
    }

    Receipt deposit(int category, ItemStack item) { return place(inventories(category), item); }

    void storageInfo(Player player) {
        for (int c = 0; c < 4; c++) {
            List<Inventory> pool = inventories(c);
            if (pool == null) { player.sendMessage("§e" + IDS.get(c) + "公共仓库暂不可用；请联系服主检查箱体和公共权限。"); continue; }
            if (pool.size() > 1) player.sendMessage("§6" + IDS.get(c) + "公共仓库：" + pool.size() + "组双箱 / " + (pool.size() * 54) + "格；同类委托自动分流。");
            for (int i = 0; i < extras.get(c).size(); i++) {
                Point p = extras.get(c).get(i);
                player.sendMessage("MC_GUILD_SHARED_OVERFLOW category=" + IDS.get(c) + " group=" + (i + 2)
                        + " dimension=minecraft:overworld x=" + p.x() + " y=" + p.y() + " z=" + p.z() + " scope=public slots=54");
            }
        }
    }

    void audit(CommandSender sender) {
        JsonObject data = new JsonObject(); data.addProperty("schemaVersion", 1); data.addProperty("ready", ready);
        JsonArray categories = new JsonArray(); int slots = 0, occupied = 0;
        for (int c = 0; c < 4; c++) {
            List<Inventory> pool = inventories(c); JsonObject row = new JsonObject(); row.addProperty("id", IDS.get(c));
            row.addProperty("available", pool != null); JsonArray boxes = new JsonArray(); int used = 0;
            if (pool != null) for (Inventory inventory : pool) {
                int count = 0; for (ItemStack item : inventory.getContents()) if (item != null && !item.getType().isAir()) count++;
                Location at = inventory.getLocation(); JsonObject box = new JsonObject();
                box.addProperty("x", at.getBlockX()); box.addProperty("y", at.getBlockY()); box.addProperty("z", at.getBlockZ());
                box.addProperty("used", count); boxes.add(box); used += count;
            }
            int capacity = pool == null ? 0 : pool.size() * 54; slots += capacity; occupied += used;
            row.addProperty("slots", capacity); row.addProperty("used", used); row.add("boxes", boxes); categories.add(row);
        }
        data.addProperty("slots", slots); data.addProperty("used", occupied); data.add("categories", categories);
        sender.sendMessage("MC_GUILD_SHARED_AUDIT " + data);
    }
}
