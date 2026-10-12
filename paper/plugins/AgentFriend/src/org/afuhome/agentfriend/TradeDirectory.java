package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.io.File;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.boss.BarColor;
import org.bukkit.boss.BarStyle;
import org.bukkit.boss.BossBar;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Villager;
import org.bukkit.entity.WanderingTrader;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.Merchant;
import org.bukkit.inventory.MerchantRecipe;
import org.bukkit.inventory.meta.EnchantmentStorageMeta;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.inventory.meta.MapMeta;
import org.bukkit.inventory.meta.PotionMeta;

/** Read-only directory. Never opens a remote trade, sets recipes, loads chunks or touches stock.
 * Entity indexing is shared for 3 seconds; quotes are cached separately per viewer so
 * Shopkeepers permissions/stock/prices cannot leak from another player's result.
 */
final class TradeDirectory implements Listener {
    private static final int MAX_MERCHANTS = 128, MAX_RECIPES = 32, MAX_OFFERS = 2048;
    private static final int TEXT_PAGE = 4, MENU_PAGE = 36;
    private static final long TTL = 3000;
    private record Trader(UUID id, UUID entityId, String name, String profession, boolean shop) {
        String key() { return (shop ? "s-" : "v-") + id.toString().substring(0, 8); }
        Entity entity() { return Bukkit.getEntity(entityId); }
        boolean alive() { Entity e = entity(); return e != null && e.isValid() && !e.isDead(); }
    }
    private record Offer(Trader trader, int recipe, List<ItemStack> costs, ItemStack result,
                         boolean outOfStock, Integer remaining, long observedAt) {
        boolean buys() { return result.getType() == Material.EMERALD && costs.stream().anyMatch(i -> i.getType() != Material.EMERALD); }
        boolean sells() { return result.getType() != Material.EMERALD && costs.stream().anyMatch(i -> i.getType() == Material.EMERALD); }
    }
    private record Snapshot(long at, List<Offer> offers, boolean truncated, int unavailable) { }
    private record Menu(UUID owner, String mode, String query, int page, List<Offer> rows) implements InventoryHolder {
        @Override public Inventory getInventory() { return null; }
    }
    private record Tracking(Trader trader, BossBar bar) { }
    private final AgentFriendPlugin plugin;
    private final YamlConfiguration labels;
    private final ShopApi shops;
    private final Map<UUID, Snapshot> snapshots = new HashMap<>();
    private final Map<UUID, Long> requestedAt = new HashMap<>();
    private final Map<UUID, Tracking> tracking = new HashMap<>();
    private final NamespacedKey dungeonMerchant;
    private List<Trader> index = List.of();
    private long indexedAt;
    private boolean indexTruncated;

    TradeDirectory(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        File file = new File(plugin.getDataFolder(), "trade-directory.yml");
        if (!file.exists()) plugin.saveResource("trade-directory.yml", false);
        labels = YamlConfiguration.loadConfiguration(file);
        dungeonMerchant = new NamespacedKey(plugin, "dungeon_merchant");
        shops = new ShopApi(plugin);
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 10, 10);
    }

    void command(Player p, String[] args) {
        String sub = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "menu";
        if (sub.equals("stop") || sub.equals("off")) {
            stop(p, true); JsonObject out = new JsonObject(); out.addProperty("status", "stopped"); emit(p, "result", out); return;
        }
        long now = System.currentTimeMillis();
        if (now - requestedAt.getOrDefault(p.getUniqueId(), 0L) < 250) {
            denied(p, "too_fast", "请稍候再查询；同一报价最多缓存3秒。"); return;
        }
        requestedAt.put(p.getUniqueId(), now);
        switch (sub) {
            case "menu", "交易板" -> open(p, "all", "", 1, false);
            case "list", "find", "buy", "sell" -> {
                int end = args.length, page = 1;
                if (end > 2 && args[end - 1].matches("[0-9]{1,5}")) page = Integer.parseInt(args[--end]);
                String query = sub.equals("list") ? "" : String.join(" ", Arrays.copyOfRange(args, 2, end)).trim();
                if ((sub.equals("find") && query.isEmpty()) || query.length() > 64
                        || (sub.equals("list") && end > 2)) {
                    denied(p, "usage", "用法：/mycli trade list [页]；find <物品> [页]；buy|sell [物品] [页]。buy是买入，sell是卖出。"); return;
                }
                show(p, sub.equals("buy") || sub.equals("sell") ? sub : "all", query, page);
            }
            case "info", "locate" -> {
                if (args.length < 3 || args.length > (sub.equals("info") ? 4 : 3)) {
                    denied(p, "usage", "先 /mycli trade find <物品>，再 trade info|locate <返回的商人ID>。"); return;
                }
                Trader trader = find(p, args[2]);
                if (trader == null) { missing(p); return; }
                if (sub.equals("locate")) locate(p, trader);
                else {
                    int page = args.length > 3 && args[3].matches("[0-9]{1,5}") ? Integer.parseInt(args[3]) : 1;
                    showOffers(p, "merchant", trader.key(), page, snapshot(p, false),
                            snapshot(p, false).offers().stream().filter(o -> o.trader().id().equals(trader.id()) && trader.alive()).toList());
                }
            }
            case "hall" -> {
                Location hall = plugin.lifeBuildings().tradeHall();
                if (hall == null) { denied(p, "hall_unavailable", "溪畔商栈尚未登记；现在可直接 /mycli trade menu 查看交易板。"); return; }
                p.sendMessage("§6商旅公会 · 溪畔商栈 §f" + locationText(hall)
                        + "；到门牌或掌柜处查看交易板。步行前往，或使用原有收费 /mycli life visit harbor。");
                JsonObject out = new JsonObject(); out.add("location", position(hall)); emit(p, "hall", out);
            }
            default -> denied(p, "usage", "交易板：/mycli trade menu；list [页]；find <物品>；buy|sell [物品]；info|locate <商人ID>；stop；hall。");
        }
    }

    private List<Trader> index() {
        long now = System.currentTimeMillis();
        if (now - indexedAt < TTL) return index;
        Map<UUID, Trader> next = new LinkedHashMap<>();
        indexTruncated = false;
        for (Object shop : shops.active()) {
            try {
                // Public admin shops only. Player-owned shops are not implicitly published.
                if (!shops.admin(shop)) continue;
                Entity e = shops.entity(shop);
                if (e == null || !e.isValid() || e.isDead()) continue;
                UUID id = (UUID) shops.get("Shopkeeper", shop, "getUniqueId");
                Trader t = new Trader(id, e.getUniqueId(), clean(String.valueOf(shops.get("Shopkeeper", shop, "getDisplayName"))), "商店", true);
                if (next.size() < MAX_MERCHANTS) next.put(id, t); else indexTruncated = true;
            } catch (ReflectiveOperationException | RuntimeException error) { shops.failed(); }
        }
        for (World world : Bukkit.getWorlds()) for (Entity e : world.getEntitiesByClasses(Villager.class, WanderingTrader.class)) {
            if (!e.isValid() || e.isDead() || e.getPersistentDataContainer().has(dungeonMerchant) || shops.isShop(e)) continue;
            if (e instanceof Villager v && (!v.isAdult() || v.getProfession() == Villager.Profession.NONE || v.getProfession() == Villager.Profession.NITWIT)) continue;
            String job = e instanceof Villager v ? profession(v.getProfession()) : "流浪商人";
            String name = e.getCustomName() == null ? job + "·" + e.getUniqueId().toString().substring(0, 4) : clean(e.getCustomName());
            Trader t = new Trader(e.getUniqueId(), e.getUniqueId(), name, job, false);
            if (next.size() < MAX_MERCHANTS) next.put(t.id(), t); else indexTruncated = true;
        }
        index = List.copyOf(next.values()); indexedAt = now;
        return index;
    }

    private Snapshot snapshot(Player p, boolean force) {
        Snapshot previous = snapshots.get(p.getUniqueId());
        long now = System.currentTimeMillis();
        if (!force && previous != null && now - previous.at() < TTL) return previous;
        List<Offer> offers = new ArrayList<>(); int unavailable = 0; boolean limited = false;
        for (Trader trader : index()) {
            if (!trader.alive()) continue;
            try {
                if (trader.shop()) {
                    Object shop = shops.byId(trader.id());
                    if (shop == null || !Boolean.TRUE.equals(shops.get("Shopkeeper", shop, "hasTradingRecipes", Player.class, p))) continue;
                    List<?> recipes = (List<?>) shops.get("Shopkeeper", shop, "getTradingRecipes", Player.class, p);
                    if (recipes.size() > MAX_RECIPES) limited = true;
                    for (int i = 0; i < Math.min(MAX_RECIPES, recipes.size()) && offers.size() < MAX_OFFERS; i++) {
                        Object recipe = recipes.get(i);
                        List<ItemStack> costs = new ArrayList<>();
                        add(costs, shops.stack(shops.get("TradingRecipe", recipe, "getItem1")));
                        if (Boolean.TRUE.equals(shops.get("TradingRecipe", recipe, "hasItem2"))) add(costs, shops.stack(shops.get("TradingRecipe", recipe, "getItem2")));
                        ItemStack result = shops.stack(shops.get("TradingRecipe", recipe, "getResultItem"));
                        if (result != null && !result.getType().isAir() && !costs.isEmpty()) offers.add(new Offer(trader, i, List.copyOf(costs), result,
                                Boolean.TRUE.equals(shops.get("TradingRecipe", recipe, "isOutOfStock")), null, now));
                    }
                } else if (trader.entity() instanceof Merchant merchant) {
                    List<MerchantRecipe> recipes = merchant.getRecipes();
                    if (recipes.size() > MAX_RECIPES) limited = true;
                    for (int i = 0; i < Math.min(MAX_RECIPES, recipes.size()) && offers.size() < MAX_OFFERS; i++) {
                        MerchantRecipe recipe = recipes.get(i);
                        List<ItemStack> costs = new ArrayList<>();
                        List<ItemStack> ingredients = recipe.getIngredients();
                        if (!ingredients.isEmpty()) add(costs, recipe.getAdjustedIngredient1());
                        for (int j = 1; j < ingredients.size(); j++) add(costs, ingredients.get(j));
                        if (!costs.isEmpty() && !recipe.getResult().getType().isAir()) offers.add(new Offer(trader, i, List.copyOf(costs), recipe.getResult().clone(),
                                recipe.getUses() >= recipe.getMaxUses(), Math.max(0, recipe.getMaxUses() - recipe.getUses()), now));
                    }
                }
            } catch (ReflectiveOperationException | RuntimeException error) { unavailable++; }
            if (offers.size() >= MAX_OFFERS) { limited = true; break; }
        }
        Snapshot next = new Snapshot(now, List.copyOf(offers), indexTruncated || limited, unavailable);
        snapshots.put(p.getUniqueId(), next); return next;
    }
    private static void add(List<ItemStack> to, ItemStack item) { if (item != null && !item.getType().isAir()) to.add(item.clone()); }

    private Trader find(Player p, String key) {
        List<Trader> matches = index().stream().filter(t -> t.alive() && (t.key().equalsIgnoreCase(key) || t.id().toString().equalsIgnoreCase(key))).toList();
        if (matches.size() != 1) return null;
        Trader trader = matches.getFirst();
        if (trader.shop()) try {
            Object shop = shops.byId(trader.id());
            if (shop == null || !Boolean.TRUE.equals(shops.get("Shopkeeper", shop, "hasTradingRecipes", Player.class, p))) return null;
        } catch (ReflectiveOperationException | RuntimeException unavailable) { return null; }
        return trader;
    }
    private List<Offer> filter(Player p, Snapshot snapshot, String mode, String query) {
        return snapshot.offers().stream().filter(o -> o.trader().alive())
                .filter(o -> switch (mode) { case "buy" -> o.sells() && matches(o.result(), query); case "sell" -> o.buys() && o.costs().stream().anyMatch(i -> i.getType() != Material.EMERALD && matches(i, query));
                    default -> matches(o.result(), query) || o.costs().stream().anyMatch(i -> matches(i, query)); })
                // Stable groups avoid villagers reordering pages merely by walking.
                .sorted(Comparator.comparing((Offer o) -> !o.trader().shop()).thenComparing(o -> o.trader().profession())
                        .thenComparing(o -> o.trader().key()).thenComparingInt(Offer::recipe)).toList();
    }
    private boolean matches(ItemStack item, String query) {
        String text = query.toLowerCase(Locale.ROOT).replace("minecraft:", "").replace(" ", "");
        if (text.isEmpty()) return true;
        String raw = item.getItemMeta().getEnchants().keySet().stream().map(e -> e.getKey().toString()).toList().toString();
        if (item.getItemMeta() instanceof EnchantmentStorageMeta stored) raw += stored.getStoredEnchants().keySet().stream().map(e -> e.getKey().toString()).toList();
        return (item.getType().getKey().getKey() + " " + itemName(item) + " " + details(item) + " " + raw).toLowerCase(Locale.ROOT).replace(" ", "").contains(text);
    }
    private String itemName(ItemStack item) {
        ItemMeta meta = item.getItemMeta();
        return meta.hasDisplayName() ? clean(meta.getDisplayName()) : labels.getString("items." + item.getType().getKey().getKey(), item.getType().getKey().getKey());
    }
    private String details(ItemStack item) {
        ItemMeta meta = item.getItemMeta(); List<String> values = new ArrayList<>();
        var enchantments = new LinkedHashMap<>(meta.getEnchants());
        if (meta instanceof EnchantmentStorageMeta stored) enchantments.putAll(stored.getStoredEnchants());
        enchantments.forEach((e, level) -> values.add(labels.getString("enchantments." + e.getKey().getKey(), e.getKey().getKey()) + " " + level));
        if (meta instanceof PotionMeta potion && potion.getBasePotionType() != null) values.add(potion.getBasePotionType().name().toLowerCase(Locale.ROOT));
        if (meta instanceof MapMeta map && map.hasMapId()) values.add("地图#" + map.getMapId());
        return String.join("、", values);
    }
    private String itemText(ItemStack item) {
        String detail = details(item); return itemName(item) + "×" + item.getAmount() + (detail.isEmpty() ? "" : "（" + detail + "）");
    }
    private String quote(Offer o) { return String.join(" + ", o.costs().stream().map(this::itemText).toList()) + " → " + itemText(o.result()); }
    private static String kind(Offer o) { return o.sells() ? "卖给你" : o.buys() ? "向你收购" : "物物交换"; }

    private void show(Player p, String mode, String query, int page) {
        Snapshot snapshot = snapshot(p, false); showOffers(p, mode, query, page, snapshot, filter(p, snapshot, mode, query));
    }
    private void showOffers(Player p, String mode, String query, int page, Snapshot snapshot, List<Offer> rows) {
        // Prismarine-chat truncates messagestr at 4096 characters. Budget rows as
        // serialized JSON, leaving room for the envelope, rather than truncating JSON.
        List<List<Offer>> batches = new ArrayList<>(); List<Offer> batch = new ArrayList<>(); int chars = 0;
        for (Offer row : rows) {
            int length = json(row).toString().length() + 1;
            if (!batch.isEmpty() && (batch.size() == TEXT_PAGE || chars + length > 3000)) { batches.add(List.copyOf(batch)); batch.clear(); chars = 0; }
            batch.add(row); chars += length;
        }
        if (!batch.isEmpty() || batches.isEmpty()) batches.add(List.copyOf(batch));
        int pages = batches.size();
        if (page < 1 || page > pages) { denied(p, "page_out_of_range", "共有" + pages + "页，请指定1到" + pages + "之间的页码。"); return; }
        p.sendMessage("§6商旅公会交易板 §f" + page + "/" + pages + "页 · " + rows.size() + "条报价；仅统计已加载商人，最多缓存3秒，实际交易窗口为准。");
        JsonObject out = new JsonObject(); out.addProperty("mode", mode); out.addProperty("query", query);
        out.addProperty("page", page); out.addProperty("pages", pages); out.addProperty("total", rows.size());
        out.addProperty("merchantCount", rows.stream().map(o -> o.trader().id()).distinct().count());
        out.addProperty("observedAt", snapshot.at()); out.addProperty("scope", "loaded_merchants_only");
        out.addProperty("truncated", snapshot.truncated()); out.addProperty("unavailableMerchants", snapshot.unavailable());
        out.addProperty("shopkeepers", shops.status); out.addProperty("nextStep", rows.isEmpty()
                ? "换物品名或等商人所在区块加载后重查；这不代表全世界无人出售。" : "trade info <商人ID> 查看，trade locate <商人ID> 定位，步行到场右键交易。");
        JsonArray offers = new JsonArray();
        for (Offer offer : batches.get(page - 1)) {
            offers.add(json(offer));
            p.sendMessage("§e" + offer.trader().name() + " §7[" + offer.trader().key() + "] §f" + kind(offer) + "：" + quote(offer)
                    + (offer.outOfStock() ? " §c已售罄" : " §a可交易") + " §7" + locationText(offer.trader().entity().getLocation()));
        }
        out.add("offers", offers); emit(p, "offers", out);
        if (rows.isEmpty() || snapshot.truncated() || snapshot.unavailable() > 0 || shops.status.equals("unavailable")) p.sendMessage("§e" + out.get("nextStep").getAsString()
                + (snapshot.truncated() ? " 已达查询上限，结果不完整。" : "") + (snapshot.unavailable() > 0 || shops.status.equals("unavailable") ? " 部分商店读取失败，请稍后再查并向服主提供时间。" : ""));
    }
    private JsonObject json(Offer o) {
        JsonObject row = new JsonObject(); row.addProperty("merchantId", o.trader().key()); row.addProperty("uuid", o.trader().id().toString());
        row.addProperty("entityUuid", o.trader().entityId().toString()); row.addProperty("name", o.trader().name()); row.addProperty("profession", o.trader().profession());
        row.addProperty("source", o.trader().shop() ? "shopkeepers" : "vanilla"); row.addProperty("recipe", o.recipe());
        row.addProperty("direction", o.sells() ? "player_buys" : o.buys() ? "player_sells" : "barter");
        JsonArray costs = new JsonArray(); o.costs().forEach(i -> costs.add(itemJson(i))); row.add("costs", costs); row.add("result", itemJson(o.result()));
        row.addProperty("outOfStock", o.outOfStock()); if (o.remaining() != null) row.addProperty("remainingUses", o.remaining());
        row.addProperty("observedAt", o.observedAt()); row.addProperty("priceScope", o.trader().shop() ? "viewer_quote" : "current_recipe_reference");
        row.add("location", position(o.trader().entity().getLocation()));
        if (row.toString().length() > 2800) {
            // Exceptionally rich plugin items remain exact in the native GUI. Keep
            // IDs/counts/costs usable over chat and explicitly mark omitted metadata.
            for (var item : costs) { item.getAsJsonObject().remove("enchantments"); item.getAsJsonObject().remove("details"); }
            row.getAsJsonObject("result").remove("enchantments"); row.getAsJsonObject("result").remove("details");
            row.addProperty("metadataTruncated", true);
        }
        return row;
    }
    private JsonObject itemJson(ItemStack item) {
        JsonObject out = new JsonObject(); out.addProperty("id", item.getType().getKey().toString()); out.addProperty("count", item.getAmount());
        String name = itemName(item), detail = details(item);
        out.addProperty("name", name.substring(0, Math.min(96, name.length()))); out.addProperty("details", detail.substring(0, Math.min(160, detail.length())));
        if (detail.length() > 160) out.addProperty("detailsTruncated", true);
        JsonObject enchants = new JsonObject(); item.getItemMeta().getEnchants().forEach((k, v) -> enchants.addProperty(k.getKey().toString(), v));
        if (item.getItemMeta() instanceof EnchantmentStorageMeta stored) stored.getStoredEnchants().forEach((k, v) -> enchants.addProperty(k.getKey().toString(), v));
        out.add("enchantments", enchants); return out;
    }
    private static JsonObject position(Location at) {
        JsonObject out = new JsonObject(); out.addProperty("world", at.getWorld().getName());
        out.addProperty("x", at.getBlockX()); out.addProperty("y", at.getBlockY()); out.addProperty("z", at.getBlockZ()); return out;
    }

    void open(Player p, String mode, String query, int requestedPage, boolean refresh) {
        Snapshot snapshot = snapshot(p, refresh); List<Offer> rows = filter(p, snapshot, mode, query);
        int pages = Math.max(1, (rows.size() + MENU_PAGE - 1) / MENU_PAGE), page = Math.clamp(requestedPage, 1, pages);
        List<Offer> visible = rows.subList((page - 1) * MENU_PAGE, Math.min(page * MENU_PAGE, rows.size()));
        Inventory inv = Bukkit.createInventory(new Menu(p.getUniqueId(), mode, query, page, List.copyOf(visible)), 45, "商旅公会 · 交易板 " + page + "/" + pages);
        for (int i = 0; i < visible.size(); i++) {
            Offer offer = visible.get(i);
            ItemStack displayed = offer.buys() ? offer.costs().stream().filter(item -> item.getType() != Material.EMERALD).findFirst().orElse(offer.result()) : offer.result();
            ItemStack icon = displayed.clone(); ItemMeta meta = icon.getItemMeta();
            // Preserve the real item name/enchantment/potion metadata; append directory lore to a copy.
            List<String> lore = new ArrayList<>(meta.hasLore() ? meta.getLore() : List.of());
            lore.addAll(List.of("§6" + kind(offer) + " · " + offer.trader().name(), "§f" + quote(offer),
                    offer.outOfStock() ? "§c已售罄，等商人补货" : "§a当前可交易", "§7" + locationText(offer.trader().entity().getLocation()),
                    "§7编号 " + offer.trader().key(), "§b点击定位；到场右键商人成交", "§7报价最多缓存3秒，实际交易窗口为准"));
            meta.setLore(lore); icon.setItemMeta(meta); inv.setItem(i, icon);
        }
        inv.setItem(36, button(Material.ARROW, "§e上一页", "当前 " + page + "/" + pages));
        inv.setItem(37, button(Material.CLOCK, "§b刷新报价", "仅已加载商人 · " + rows.size() + "条", "不代表全世界交易", snapshot.truncated() ? "§c已达上限，结果不完整" : "实际成交窗口为准",
                snapshot.unavailable() > 0 || shops.status.equals("unavailable") ? "§c部分商店读取失败，请稍后再查" : "报价只读，不取放物品"));
        inv.setItem(38, button(Material.EMERALD, "§a我要买", "商人卖给你物品"));
        inv.setItem(39, button(Material.BOOK, "§f全部交易", "包括物物交换"));
        inv.setItem(40, button(Material.WHEAT, "§6我要卖", "商人收购你的物品"));
        inv.setItem(41, button(Material.COMPASS, "§b按物品查询", "/mycli trade find 面包", "/mycli trade buy 附魔书", "/mycli trade sell 小麦"));
        inv.setItem(42, button(Material.BARRIER, "§7停止定位", "/mycli trade stop"));
        inv.setItem(43, button(Material.OAK_SIGN, "§6溪畔商栈 · 商旅公会", "查看门牌位置与到达方法"));
        inv.setItem(44, button(Material.ARROW, "§e下一页", "当前 " + page + "/" + pages)); p.openInventory(inv);
    }
    private static ItemStack button(Material material, String name, String... lore) {
        ItemStack item = new ItemStack(material); ItemMeta meta = item.getItemMeta(); meta.setDisplayName(name); meta.setLore(List.of(lore)); item.setItemMeta(meta); return item;
    }
    @EventHandler public void click(InventoryClickEvent event) {
        if (!(event.getView().getTopInventory().getHolder() instanceof Menu menu)) return;
        event.setCancelled(true); // Includes shift, number key, double click, drop and offhand swaps in both inventories.
        if (!(event.getWhoClicked() instanceof Player p) || !menu.owner().equals(p.getUniqueId())) return;
        int slot = event.getRawSlot(); if (slot < 0 || slot >= 45) return;
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (!p.isOnline() || p.getOpenInventory().getTopInventory() != event.getView().getTopInventory()) return;
            if (slot < menu.rows().size()) {
                Trader t = find(p, menu.rows().get(slot).trader().key()); p.closeInventory();
                if (t == null) missing(p); else locate(p, t); return;
            }
            switch (slot) {
                case 36 -> open(p, menu.mode(), menu.query(), menu.page() - 1, false);
                case 37 -> open(p, menu.mode(), menu.query(), menu.page(), true);
                case 38 -> open(p, "buy", menu.query(), 1, false);
                case 39 -> open(p, "all", "", 1, false);
                case 40 -> open(p, "sell", menu.query(), 1, false);
                case 41 -> { p.closeInventory(); p.sendMessage(Component.text("按物品查：/mycli trade find <物品名或ID>（例如面包、小麦、经验修补）；buy买入、sell卖出。点击此条填写。")
                        .clickEvent(ClickEvent.suggestCommand("/mycli trade find "))); }
                case 42 -> { p.closeInventory(); stop(p, true); }
                case 43 -> { p.closeInventory(); command(p, new String[]{"trade", "hall"}); }
                case 44 -> open(p, menu.mode(), menu.query(), menu.page() + 1, false);
                default -> { }
            }
        });
    }
    @EventHandler public void drag(InventoryDragEvent event) {
        if (event.getView().getTopInventory().getHolder() instanceof Menu) event.setCancelled(true);
    }

    private void locate(Player p, Trader trader) {
        if (!trader.alive()) { missing(p); return; }
        stop(p, false); plugin.beginTradeTracking(p);
        BossBar bar = Bukkit.createBossBar("寻找商人", BarColor.GREEN, BarStyle.SOLID); bar.addPlayer(p); bar.setProgress(1);
        tracking.put(p.getUniqueId(), new Tracking(trader, bar)); tick(p, tracking.get(p.getUniqueId()));
        JsonObject out = new JsonObject(); out.addProperty("merchantId", trader.key()); out.add("location", position(trader.entity().getLocation())); emit(p, "locate", out);
        p.sendMessage("§a已定位 " + trader.name() + "；粒子线从你当前位置连向商人，商人移动时更新；直线不代表可通行，请结合罗盘和顶部提示安全前往。到场右键交易；/mycli trade stop 停止定位。");
    }
    boolean tracking(Player p) { return tracking.containsKey(p.getUniqueId()); }
    void stop(Player p, boolean notify) {
        plugin.targetGuides().remove(p.getUniqueId(), "trade");
        Tracking old = tracking.remove(p.getUniqueId());
        if (old != null) { old.bar().removeAll(); plugin.restoreCompass(p); }
        if (notify) p.sendMessage("§7已停止商人定位。可 /mycli trade find <物品> 查找其他交易。");
    }
    private void tick() {
        for (var row : new HashMap<>(tracking).entrySet()) {
            Player p = Bukkit.getPlayer(row.getKey());
            if (p == null) { row.getValue().bar().removeAll(); tracking.remove(row.getKey()); continue; }
            tick(p, row.getValue());
        }
    }
    private void tick(Player p, Tracking target) {
        Trader trader = target.trader();
        if (!trader.alive()) { stop(p, false); p.sendMessage("§e商人已离开已加载范围或不再可交易，定位结束。/mycli trade find <物品> 重新查询，不会强行加载远方区块。"); return; }
        Location at = trader.entity().getLocation(), here = p.getLocation();
        if (here.getWorld().equals(at.getWorld())) {
            int distance = (int) Math.ceil(here.distance(at));
            target.bar().setTitle("§a" + trader.name() + " §e" + AgentFriendPlugin.direction(here.getYaw(), at.getX() - here.getX(), at.getZ() - here.getZ())
                    + " " + distance + "格 §7" + locationText(at) + (distance <= 4 ? " · 右键商人交易" : ""));
            plugin.targetGuides().show(p, "trade", at.clone().add(0, 1.2, 0));
        } else { target.bar().setTitle("§a" + trader.name() + " §7不同世界 · " + locationText(at)); plugin.targetGuides().remove(p.getUniqueId(), "trade"); }
        plugin.syncCompass(p, at);
    }
    @EventHandler public void quit(PlayerQuitEvent event) {
        stop(event.getPlayer(), false); snapshots.remove(event.getPlayer().getUniqueId()); requestedAt.remove(event.getPlayer().getUniqueId());
    }
    void shutdown() { for (Player p : Bukkit.getOnlinePlayers()) stop(p, false); snapshots.clear(); requestedAt.clear(); }
    private void missing(Player p) { denied(p, "merchant_unavailable", "商人已离开已加载范围、编号不存在或有歧义。请 /mycli trade find <物品> 刷新后使用返回的准确商人ID。"); }
    private void denied(Player p, String reason, String next) {
        p.sendMessage("§e" + next); JsonObject out = new JsonObject(); out.addProperty("status", "denied"); out.addProperty("reason", reason); out.addProperty("nextStep", next); emit(p, "result", out);
    }
    private static void emit(Player p, String type, JsonObject out) { out.addProperty("schema", 1); out.addProperty("type", type); p.sendMessage("MC_TRADE " + out); }
    private static String clean(String text) { String value = ChatColor.stripColor(text).replaceAll("[\\p{Cntrl}]", " "); return value.substring(0, Math.min(96, value.length())); }
    private static String locationText(Location at) {
        String world = switch (at.getWorld().getEnvironment()) { case NORMAL -> "主世界"; case NETHER -> "下界"; case THE_END -> "末地"; default -> at.getWorld().getName(); };
        return world + "(" + at.getWorld().getName() + ") " + LocationOutput.shortForm(at);
    }
    private static String profession(Villager.Profession job) {
        return switch (job) { case FARMER -> "农民"; case FISHERMAN -> "渔夫"; case LIBRARIAN -> "图书管理员"; case TOOLSMITH -> "工具匠";
            case ARMORER -> "盔甲匠"; case BUTCHER -> "屠夫"; case CARTOGRAPHER -> "制图师"; case CLERIC -> "牧师"; case FLETCHER -> "制箭师";
            case LEATHERWORKER -> "皮匠"; case MASON -> "石匠"; case SHEPHERD -> "牧羊人"; case WEAPONSMITH -> "武器匠"; default -> "村民"; };
    }

    /** Optional Shopkeepers API: public interfaces avoid non-public implementation reflection.
     * Use copy(), never expose a mutable stack owned by a shop. No offline/private player shops.
     */
    private static final class ShopApi {
        private final Map<String, Class<?>> types = new HashMap<>();
        private Object registry;
        private String status = "not_installed";
        ShopApi(AgentFriendPlugin plugin) {
            var owner = Bukkit.getPluginManager().getPlugin("Shopkeepers");
            if (owner == null || !owner.isEnabled()) return;
            try {
                ClassLoader loader = owner.getClass().getClassLoader();
                String base = "com.nisovin.shopkeepers.api.";
                for (String name : List.of("ShopkeepersAPI", "shopkeeper.ShopkeeperRegistry", "shopkeeper.Shopkeeper", "shopkeeper.admin.AdminShopkeeper", "shopkeeper.TradingRecipe", "shopobjects.entity.EntityShopObject", "util.UnmodifiableItemStack")) {
                    Class<?> type = Class.forName(base + name, true, loader); types.put(type.getSimpleName(), type);
                }
                registry = types.get("ShopkeepersAPI").getMethod("getShopkeeperRegistry").invoke(null); status = "ready";
            } catch (ReflectiveOperationException | RuntimeException e) { status = "unavailable"; plugin.getLogger().warning("交易板无法识别Shopkeepers商人，暂不展示不确定的报价：" + e.getClass().getSimpleName()); }
        }
        Object get(String type, Object obj, String method) throws ReflectiveOperationException { return types.get(type).getMethod(method).invoke(obj); }
        Object get(String type, Object obj, String method, Class<?> argument, Object value) throws ReflectiveOperationException {
            Method m = types.get(type).getMethod(method, argument); return m.invoke(obj, value);
        }
        boolean admin(Object shop) { return types.get("AdminShopkeeper").isInstance(shop); }
        Iterable<?> active() {
            if (registry == null) return List.of();
            try { Iterable<?> result = (Iterable<?>) get("ShopkeeperRegistry", registry, "getActiveShopkeepers"); status = "ready"; return result; }
            catch (ReflectiveOperationException | RuntimeException e) { failed(); return List.of(); }
        }
        Object byId(UUID id) throws ReflectiveOperationException { return get("ShopkeeperRegistry", registry, "getShopkeeperByUniqueId", UUID.class, id); }
        Entity entity(Object shop) throws ReflectiveOperationException {
            Object object = get("Shopkeeper", shop, "getShopObject");
            return types.get("EntityShopObject").isInstance(object) ? (Entity) get("EntityShopObject", object, "getEntity") : null;
        }
        boolean isShop(Entity entity) {
            if (registry == null) return !status.equals("not_installed");
            try { return Boolean.TRUE.equals(get("ShopkeeperRegistry", registry, "isShopkeeper", Entity.class, entity)); }
            catch (ReflectiveOperationException | RuntimeException e) { failed(); return true; } // Avoid presenting empty/incorrect shop-entity recipes on API failure.
        }
        ItemStack stack(Object item) throws ReflectiveOperationException { return item == null ? null : (ItemStack) get("UnmodifiableItemStack", item, "copy"); }
        void failed() { status = "unavailable"; }
    }
}
