package org.afuhome.agentfriend;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Registry;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.inventory.ItemStack;

/** Server-wide limited stock. Both buyers and the midnight rollover run on the server thread. */
final class DailyShop {
    static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    private static final String DAY = "daily-rpg-shop.day";
    private static final String STOCK = "daily-rpg-shop.stock";
    private static final String STOCK_PREFIX = "daily_";
    private static final int SIZE = 6;

    private record Gear(Material material, String primary, int price) { }
    private static final List<Gear> RANGED = List.of(
            new Gear(Material.BOW, "power", 68), new Gear(Material.CROSSBOW, "quick_charge", 74));
    private static final List<Gear> MELEE = List.of(
            new Gear(Material.DIAMOND_SWORD, "sharpness", 130), new Gear(Material.DIAMOND_AXE, "sharpness", 142),
            new Gear(Material.TRIDENT, "loyalty", 152));
    private static final List<Gear> ARMOR = List.of(
            new Gear(Material.DIAMOND_HELMET, "protection", 113), new Gear(Material.DIAMOND_CHESTPLATE, "protection", 170),
            new Gear(Material.DIAMOND_LEGGINGS, "protection", 152), new Gear(Material.DIAMOND_BOOTS, "protection", 113));
    private static final List<Gear> UTILITY = List.of(
            new Gear(Material.DIAMOND_PICKAXE, "efficiency", 143), new Gear(Material.DIAMOND_SHOVEL, "efficiency", 83),
            new Gear(Material.DIAMOND_HOE, "efficiency", 76), new Gear(Material.SHIELD, "unbreaking", 52));

    record Entry(String id, ItemStack item, int price, String state, String requestId, String buyer) {
        boolean available() { return state.equals("open"); }
        String reason() {
            return switch (state) {
                case "sold" -> "shop_sold_out";
                case "reserved" -> "shop_stock_pending";
                default -> "ok";
            };
        }
    }
    record Shelf(LocalDate day, List<Entry> entries) {
        long refreshAt() { return day.plusDays(1).atStartOfDay(ZONE).toInstant().toEpochMilli(); }
        Entry find(String id) {
            return entries.stream().filter(entry -> entry.id().equals(id)).findFirst().orElse(null);
        }
    }

    private final AgentFriendPlugin plugin;
    private final Runnable persist;
    private final Clock clock;

    DailyShop(AgentFriendPlugin plugin, Runnable persist, Clock clock) {
        this.plugin = plugin;
        this.persist = persist;
        this.clock = clock;
    }

    static boolean isDaily(String id) { return id.startsWith(STOCK_PREFIX); }

    static String missingReason(Shelf shelf, String id) {
        if (shelf == null) return "shop_stock_unavailable";
        if (id.matches("daily_[0-9]{8}_[a-z_]+") && !id.startsWith(prefix(shelf.day()))) return "shop_offer_expired";
        return "invalid_offer_or_quantity";
    }

    Shelf current() {
        FileConfiguration config = plugin.getConfig();
        LocalDate today = LocalDate.now(clock.withZone(ZONE));
        String storedDay = config.getString(DAY);
        if (storedDay == null && !config.contains(DAY) && !config.contains(STOCK)) return refresh(config, today);
        if (storedDay == null) throw new IllegalStateException("daily_shop_missing_date");
        LocalDate day = LocalDate.parse(storedDay);
        Shelf saved = read(config, day);
        return day.isBefore(today) ? refresh(config, today) : saved;
    }

    private Shelf refresh(FileConfiguration config, LocalDate day) {
        // Fixed world/date seed; repeated attempts to create the same day do not reroll its prices or equipment.
        long seed = day.toEpochDay() ^ plugin.getServer().getWorlds().getFirst().getSeed();
        var random = new SplittableRandom(seed);
        List<Gear> selection = new ArrayList<>();
        select(selection, RANGED, 1, random);
        select(selection, MELEE, 1, random);
        select(selection, ARMOR, 2, random);
        select(selection, UTILITY, 2, random);
        List<Entry> entries = new ArrayList<>();
        for (Gear gear : selection) {
            ItemStack item = new ItemStack(gear.material());
            Map<String, Integer> enchants = DungeonEnchantments.roll(gear.material().name(),
                    10, 0, "rare", Set.of(gear.primary()), random);
            for (var affix : enchants.entrySet()) {
                Enchantment enchantment = Registry.ENCHANTMENT.get(NamespacedKey.minecraft(affix.getKey()));
                if (enchantment == null || !enchantment.canEnchantItem(item))
                    throw new IllegalStateException("daily_shop_invalid_enchantment");
                item.addEnchantment(enchantment, affix.getValue());
            }
            int price = gear.price() + enchants.values().stream().mapToInt(Integer::intValue).sum() * 8;
            entries.add(new Entry(prefix(day) + gear.material().getKey().getKey(), item, price, "open", "", ""));
        }
        Shelf shelf = new Shelf(day, List.copyOf(entries));
        write(config, shelf);
        return shelf;
    }

    private static void select(List<Gear> selection, List<Gear> pool, int count, SplittableRandom random) {
        List<Gear> shuffled = new ArrayList<>(pool);
        Collections.shuffle(shuffled, random);
        selection.addAll(shuffled.subList(0, count));
    }

    private static String prefix(LocalDate day) { return STOCK_PREFIX + day.format(DateTimeFormatter.BASIC_ISO_DATE) + "_"; }

    private static Shelf read(FileConfiguration config, LocalDate day) {
        List<?> raw = config.getList(STOCK);
        if (raw == null || raw.size() != SIZE) throw new IllegalStateException("daily_shop_invalid_stock");
        List<Entry> entries = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Object value : raw) {
            if (!(value instanceof Map<?, ?> row) || !(row.get("id") instanceof String id)
                    || !(row.get("item") instanceof String item) || item.length() > 8000
                    || !(row.get("price") instanceof Integer price) || price < 1 || price > 1000
                    || !(row.get("state") instanceof String state) || !Set.of("open", "reserved", "sold").contains(state)
                    || !(row.get("requestId") instanceof String requestId) || !(row.get("buyer") instanceof String buyer)
                    || !seen.add(id)) throw new IllegalStateException("daily_shop_invalid_entry");
            if (state.equals("open") ? !requestId.isEmpty() || !buyer.isEmpty()
                    : !requestId.startsWith("shop:") || !UUID.fromString(buyer).toString().equals(buyer))
                throw new IllegalStateException("daily_shop_invalid_receipt");
            ItemStack stack = ItemStack.deserializeBytes(Base64.getDecoder().decode(item));
            if (stack.getAmount() != 1 || stack.getEnchantments().isEmpty()
                    || !id.equals(prefix(day) + stack.getType().getKey().getKey()))
                throw new IllegalStateException("daily_shop_invalid_item");
            entries.add(new Entry(id, stack, price, state, requestId, buyer));
        }
        return new Shelf(day, List.copyOf(entries));
    }

    private static void set(FileConfiguration config, Shelf shelf) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Entry entry : shelf.entries()) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", entry.id());
            row.put("item", Base64.getEncoder().encodeToString(entry.item().serializeAsBytes()));
            row.put("price", entry.price());
            row.put("state", entry.state());
            row.put("requestId", entry.requestId());
            row.put("buyer", entry.buyer());
            rows.add(row);
        }
        config.set(DAY, shelf.day().toString());
        config.set(STOCK, rows);
    }

    private void write(FileConfiguration config, Shelf shelf) {
        Object previousDay = config.get(DAY), previousStock = config.get(STOCK);
        try {
            set(config, shelf);
            persist.run();
        } catch (RuntimeException failure) {
            config.set(DAY, previousDay);
            config.set(STOCK, previousStock);
            throw failure;
        }
    }

    private static Shelf update(Shelf shelf, Entry previous, Entry next) {
        return new Shelf(shelf.day(), shelf.entries().stream()
                .map(entry -> entry.id().equals(previous.id()) ? next : entry).toList());
    }

    void reserve(Shelf shelf, Entry entry, String requestId, UUID owner) {
        write(plugin.getConfig(), update(shelf, entry,
                new Entry(entry.id(), entry.item(), entry.price(), "reserved", requestId, owner.toString())));
    }

    void release(String id, String requestId) {
        FileConfiguration config = plugin.getConfig();
        Shelf shelf = read(config, LocalDate.parse(config.getString(DAY)));
        Entry reserved = reserved(shelf, id, requestId);
        write(config, update(shelf, reserved, new Entry(id, reserved.item(), reserved.price(), "open", "", "")));
    }

    private static Entry reserved(Shelf shelf, String id, String requestId) {
        Entry entry = shelf.find(id);
        if (entry == null || !entry.state().equals("reserved") || !entry.requestId().equals(requestId))
            throw new IllegalStateException("daily_shop_reservation_changed");
        return entry;
    }

    /** The queued item and the stock decrement share the same durable config revision. */
    void deliver(String id, String requestId, UUID owner, Runnable queueItem) {
        FileConfiguration config = plugin.getConfig();
        Shelf shelf = read(config, LocalDate.parse(config.getString(DAY)));
        Entry reserved = reserved(shelf, id, requestId);
        if (!reserved.buyer().equals(owner.toString())) throw new IllegalStateException("daily_shop_buyer_changed");
        String queue = "dungeon-bonus-items." + owner;
        Object previousQueue = config.get(queue);
        try {
            queueItem.run();
            write(config, update(shelf, reserved,
                    new Entry(id, reserved.item(), reserved.price(), "sold", requestId, reserved.buyer())));
        } catch (RuntimeException failure) {
            config.set(queue, previousQueue);
            throw failure;
        }
    }
}
