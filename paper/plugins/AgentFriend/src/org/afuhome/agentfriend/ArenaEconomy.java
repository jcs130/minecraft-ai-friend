package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.JsonNull;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.IdentityHashMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.bukkit.ChatColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.command.CommandSender;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

/** Existing per-UUID RPG shop/recycling; one Vortex bank, shared by text and native menus. */
final class ArenaEconomy implements Listener {
    private static final String WALLET = "dungeon-emerald-wallet.";
    static final long QUOTE_LIFETIME_MS = 300_000L;
    private static final int MAX_BALANCE = 1_000_000_000;
    private static final String TRIAL_LORE = "千灯纪试炼战利品";
    private static final Set<String> NAMED_REWARDS = Set.of("冒险者铁剑", "守护铁靴", "迅发弩",
            "晨光之刃", "星弦", "千灯·破晓", "星矿镐", "夜空之弦", "海渊之矛",
            "苔原旅盔", "遗迹守护甲", "雪行护腿", "焰路行靴", "潮汐守盾",
            "幽荧猎弓", "秘殿破阵弩", "星辉冠", "星辉甲", "星辉护腿", "星辉靴",
            "冒险者铁盔", "冒险者胸甲", "冒险者护腿", "冒险者矿镐", "冒险者战斧", "远征盾",
            "潮汐探路冠", "回廊踏影靴", "赤铜纹战盾", "踏影铁靴",
            "铜纹守护甲", "机关弩", "深渊破壁斧", "赤铜柄·闪现匕首", "寒霜剑");
    private record Offer(String id, Material material, int count, int price, ItemStack featuredItem) {
        Offer(String id, Material material, int count, int price) { this(id, material, count, price, null); }
        Offer(DailyShop.Entry entry) { this(entry.id(), entry.item().getType(), 1, entry.price(), entry.item()); }
        boolean daily() { return featuredItem != null; }
        int maxQuantity() { return Math.min(16, material.getMaxStackSize() / count); }
        ItemStack stack(int quantity) {
            return daily() ? featuredItem.clone() : new ItemStack(material, count * quantity);
        }
    }
    private record Quote(UUID owner, String id, boolean stash, int slot, int quantity, int price,
                         byte[] fingerprint, long expiresAt) { }
    private record Candidate(boolean stash, int slot, String fingerprint) {
        Candidate(boolean stash,int slot){this(stash,slot,null);}
    }
    private record Menu(UUID owner, String kind, int page, List<Candidate> candidates, String quoteId,
                        Map<Integer, String> offersBySlot) {
        Menu(UUID owner, String kind, int page, List<Candidate> candidates, String quoteId) {
            this(owner, kind, page, candidates, quoteId, Map.of());
        }
    }
    private record ShopStock(DailyShop.Shelf shelf, String unavailableReason) {
        List<Offer> featured() {
            return shelf == null ? List.of() : shelf.entries().stream().filter(DailyShop.Entry::available).map(Offer::new).toList();
        }
        String refreshLabel() {
            return DateTimeFormatter.ofPattern("MM月dd日 HH:mm").withZone(DailyShop.ZONE)
                    .format(Instant.ofEpochMilli(shelf.refreshAt())) + "（北京时间）";
        }
    }
    private static final List<Offer> OFFERS = List.of(
            new Offer("iron_helmet", Material.IRON_HELMET, 1, 8),
            new Offer("iron_chestplate", Material.IRON_CHESTPLATE, 1, 14),
            new Offer("iron_leggings", Material.IRON_LEGGINGS, 1, 12),
            new Offer("iron_boots", Material.IRON_BOOTS, 1, 8),
            new Offer("iron_sword", Material.IRON_SWORD, 1, 12),
            new Offer("iron_axe", Material.IRON_AXE, 1, 12),
            new Offer("bow", Material.BOW, 1, 12),
            new Offer("crossbow", Material.CROSSBOW, 1, 14),
            new Offer("shield", Material.SHIELD, 1, 7),
            new Offer("arrows", Material.ARROW, 16, 3),
            new Offer("arrows_stack", Material.ARROW, 64, 12),
            new Offer("spectral_arrows", Material.SPECTRAL_ARROW, 16, 9),
            new Offer("food", Material.COOKED_BEEF, 8, 4),
            new Offer("golden_carrots", Material.GOLDEN_CARROT, 8, 14),
            new Offer("golden_apple", Material.GOLDEN_APPLE, 1, 10),
            new Offer("diamond_sword", Material.DIAMOND_SWORD, 1, 38),
            new Offer("diamond_helmet", Material.DIAMOND_HELMET, 1, 34),
            new Offer("diamond_chestplate", Material.DIAMOND_CHESTPLATE, 1, 52),
            new Offer("diamond_leggings", Material.DIAMOND_LEGGINGS, 1, 46),
            new Offer("diamond_boots", Material.DIAMOND_BOOTS, 1, 34),
            new Offer("torches", Material.TORCH, 32, 4),
            // Keep bought wood above the existing wooden-gear resale value, including crafted sticks.
            new Offer("planks", Material.OAK_PLANKS, 32, 64),
            new Offer("cobblestone", Material.COBBLESTONE, 32, 2),
            new Offer("glass", Material.GLASS, 16, 4),
            new Offer("ladders", Material.LADDER, 16, 3),
            new Offer("chest", Material.CHEST, 1, 3),
            new Offer("crafting_table", Material.CRAFTING_TABLE, 1, 1),
            new Offer("water_bucket", Material.WATER_BUCKET, 1, 5));

    private final AgentFriendPlugin plugin;
    static List<String> offerIds(){return OFFERS.stream().map(Offer::id).toList();}
    private final DungeonManager dungeon;
    private final NativeRpg nativeRpg;
    private final DailyShop dailyShop;
    private boolean loggedShelfFailure;
    private final ItemIdentity identity;
    // Only scoped on the server thread. Async settlement explicitly captures its request format.
    private boolean textReply;
    private final Map<UUID, JsonObject> recyclingReads = new HashMap<>();
    private final Map<UUID, LinkedHashMap<String, Quote>> quotes = new HashMap<>();

    private void rememberQuote(Quote quote) {
        long now = System.currentTimeMillis();
        quotes.values().forEach(book -> book.values().removeIf(q -> q.expiresAt() < now));
        quotes.values().removeIf(Map::isEmpty);
        var book = quotes.computeIfAbsent(quote.owner(), ignored -> new LinkedHashMap<>());
        // Repricing one slot invalidates only that slot, not other selected equipment.
        book.values().removeIf(q -> q.stash() == quote.stash() && q.slot() == quote.slot());
        while (book.size() >= 32) book.remove(book.keySet().iterator().next());
        book.put(quote.id(), quote);
    }

    private Quote findQuote(UUID owner, String id) {
        var book = quotes.get(owner);
        return book == null ? null : book.get(id);
    }

    private Quote slotQuote(UUID owner, boolean stash, int slot) {
        var book = quotes.get(owner);
        return book == null ? null : book.values().stream().filter(q -> q.stash() == stash && q.slot() == slot).findFirst().orElse(null);
    }

    private void consumeQuote(UUID owner, String id) {
        var book = quotes.get(owner);
        if (book != null) { book.remove(id); if (book.isEmpty()) quotes.remove(owner); }
    }
    private final Map<Inventory, Menu> menus = new IdentityHashMap<>();

    ArenaEconomy(AgentFriendPlugin plugin, DungeonManager dungeon) {
        this.plugin = plugin;
        this.dungeon = dungeon;
        this.nativeRpg = new NativeRpg(plugin);
        this.dailyShop = new DailyShop(plugin, nativeRpg::saveConfigVerified, Clock.systemUTC());
        this.identity = new ItemIdentity(plugin);
        Bukkit.getPluginManager().registerEvents(this, plugin);
    }

    private ShopStock stock() {
        if (!nativeRpg.selected()) return new ShopStock(null, "economy_unavailable");
        try {
            ShopStock stock = new ShopStock(dailyShop.current(), null);
            loggedShelfFailure = false;
            return stock;
        } catch (RuntimeException invalid) {
            if (!loggedShelfFailure) {
                plugin.getLogger().warning("RPG daily shop unavailable: " + invalid.getClass().getSimpleName()
                        + ": " + invalid.getMessage());
                loggedShelfFailure = true;
            }
            return new ShopStock(null, "shop_stock_unavailable");
        }
    }

    private ItemStack shopIcon(Offer offer, ShopStock stock) {
        ItemStack icon = offer.stack(1);
        ItemMeta meta = icon.getItemMeta();
        meta.setDisplayName((offer.daily() ? ChatColor.LIGHT_PURPLE : ChatColor.GOLD) + identity.describe(icon).name());
        meta.setLore(List.of(ChatColor.YELLOW + "价格 " + offer.price() + " " + recycleCurrency(),
                ChatColor.GRAY + (offer.daily() ? "全服限购 1 件 · 刷新 " + stock.refreshLabel()
                        : "每份 " + offer.count() + " 件 · 点击选数量并确认"),
                ChatColor.GRAY + "购买不耗魔力 · 商品送入个人箱"));
        icon.setItemMeta(meta);
        return icon;
    }

    void openShopMenu(Player player) {
        ShopStock stock = stock();
        List<Offer> featured = stock.featured();
        Inventory inv = Bukkit.createInventory(null, 45, "金币商城 · 补给与每日装备");
        Map<Integer, String> offersBySlot = new LinkedHashMap<>();
        int slot = 0;
        for (Offer offer : OFFERS) {
            inv.setItem(slot, shopIcon(offer, stock));
            offersBySlot.put(slot++, offer.id());
        }
        for (Offer offer : featured) {
            inv.setItem(slot, shopIcon(offer, stock));
            offersBySlot.put(slot++, offer.id());
        }
        if (nativeRpg.selected()) showDailyStock(inv, stock.shelf() == null ? -1 : featured.size());
        inv.setItem(36, icon(Material.HOPPER, "卖出多余装备", "逐件报价后确认；不收绑定、穿戴和当前手持装备"));
        inv.setItem(38, icon(Material.CHEST, "取货 / 整理个人箱", "540格；成功远程开箱2魔力；物资满时仍保存在箱中"));
        JsonObject bank=nativeRpg.selected()?nativeRpg.recyclingState(player):null;
        inv.setItem(40, icon(Material.GOLD_INGOT, "金币：" + (bank==null?balance(player.getUniqueId()):EconomyPresentation.balance(bank)), "与任务、公会、回收共用；点击查询"));
        inv.setItem(42, icon(Material.EMERALD_BLOCK, "村民以物易物", "需要前往商人身边；与金币商城分别结算"));
        inv.setItem(43, icon(Material.CHEST_MINECART, "玩家交易行", "玩家间金币买卖，保留附魔耐久；商品送个人箱"));
        inv.setItem(44, icon(Material.BARRIER, "关闭", "不会购买或卖出任何物品"));
        menus.put(inv, new Menu(player.getUniqueId(), "shop", 0, List.of(), null, Map.copyOf(offersBySlot)));
        player.openInventory(inv);
    }

    private void showDailyStock(Inventory menu, int remaining) {
        String label = remaining < 0 ? "暂时无法读取每日装备"
                : remaining == 0 ? "今日装备已下架" : "每日精选 · " + remaining + " 件在售";
        menu.setItem(35, icon(Material.CLOCK, label, remaining < 0
                ? "常用补给仍可购买" : "每日北京时间 00:00 刷新 · 点击刷新货架"));
    }

    private void removeFromOpenShelves(String id) {
        for (var window : menus.entrySet()) {
            Inventory inventory = window.getKey();
            Menu menu = window.getValue();
            if (!menu.kind().equals("shop")) continue;
            int remaining = 0;
            boolean removed = false;
            for (var slot : menu.offersBySlot().entrySet()) {
                if (!DailyShop.isDaily(slot.getValue())) continue;
                if (slot.getValue().equals(id)) {
                    inventory.setItem(slot.getKey(), null);
                    removed = true;
                } else if (inventory.getItem(slot.getKey()) != null) remaining++;
            }
            if (removed) showDailyStock(inventory, remaining);
        }
    }

    private void openRecycleMenu(Player player, int page) {
        List<Candidate> candidates = new ArrayList<>();
        Inventory stash = dungeon.liveStash(player.getUniqueId());
        for (int slot = 0; slot < dungeon.stashCapacity(); slot++)
            if (eligible(dungeon.stashItem(player.getUniqueId(),slot))) candidates.add(new Candidate(true, slot,hex(digest(dungeon.stashItem(player.getUniqueId(),slot).serializeAsBytes()))));
        for (int slot = 0; slot < 36; slot++)
            if (eligibleSource(player, false, slot, player.getInventory().getItem(slot)))
                candidates.add(new Candidate(false, slot,hex(digest(player.getInventory().getItem(slot).serializeAsBytes()))));
        int selectedPage = Math.max(0, Math.min(page, Math.max(0, (candidates.size() - 1) / 45)));
        Inventory inv = Bukkit.createInventory(null, 54, "装备回收 · 第 " + (selectedPage + 1) + " 页");
        for (int slot = 0; slot < 45 && selectedPage * 45 + slot < candidates.size(); slot++) {
            Candidate candidate = candidates.get(selectedPage * 45 + slot);
            ItemStack source = source(player, candidate.stash(), candidate.slot());
            ItemStack icon = source.clone();
            ItemMeta meta = icon.getItemMeta();
            List<String> lore = new ArrayList<>(meta.hasLore() ? meta.getLore() : List.of());
            lore.add(ChatColor.YELLOW + "回收价 " + unitPrice(source) + " " + recycleCurrency() + "/件");
            lore.add(ChatColor.GRAY + (candidate.stash() ? "个人箱 " + (candidate.slot() + 1) : "背包 " + candidate.slot()));
            lore.add(ChatColor.GRAY + "点击获取报价，再确认回收");
            meta.setLore(lore);
            icon.setItemMeta(meta);
            inv.setItem(slot, icon);
        }
        inv.setItem(45, icon(Material.ARROW, "上一页", ""));
        inv.setItem(49, icon(Material.CHEST, "返回商店", ""));
        if(candidates.isEmpty())inv.setItem(22,icon(Material.BOOK,"没有可回收装备","材料可存个人箱；手持、穿戴、绑定和自定义装备保留"));
        inv.setItem(53, icon(Material.ARROW, "下一页", ""));
        menus.put(inv, new Menu(player.getUniqueId(), "recycle", selectedPage, candidates, null));
        player.openInventory(inv);
    }

    void openRecycleMenu(Player player) { openRecycleMenu(player, 0); }

    private void openBuyMenu(Player player,String id,int requested){
        Offer offer = shopOffer(player, id);
        if (offer == null) {
            openShopMenu(player);
            return;
        }
        int max=offer.maxQuantity();
        int count=Math.max(1,Math.min(max,requested));
        Inventory inv=Bukkit.createInventory(null,27,"确认购买 · 金币商城");
        inv.setItem(4,offer.stack(count));
        inv.setItem(10,icon(Material.RED_WOOL,"取消 / 返回","未确认不会扣金币"));
        if(max>1)inv.setItem(12,icon(Material.ARROW,"减少一份","每份 "+offer.count()+" 件；最多 "+max+" 份"));
        inv.setItem(13,icon(Material.GOLD_INGOT,"共 "+count+" 份 / "+(offer.count()*count)+" 件","总价 "+(offer.price()*count)+" 金币；不耗魔力"));
        if(max>1)inv.setItem(14,icon(Material.ARROW,"增加一份","每份 "+offer.count()+" 件；最多 "+max+" 份"));
        inv.setItem(16,icon(Material.LIME_WOOL,"确认购买","商品送入个人箱；背包满也不会掉在地上"));
        menus.put(inv,new Menu(player.getUniqueId(),"buy",count,List.of(),id));
        player.openInventory(inv);
    }

    private void openConfirmMenu(Player player, Quote quote) {
        Inventory inv = Bukkit.createInventory(null, 27, "确认回收 · "+(QUOTE_LIFETIME_MS/60_000)+"分钟有效");
        ItemStack original = source(player, quote.stash(), quote.slot());
        if (original == null) return;
        inv.setItem(11, icon(Material.RED_WOOL, "取消", "不会消耗装备"));
        inv.setItem(13, original.clone());
        inv.setItem(15, icon(Material.LIME_WOOL, "确认回收", "获得 " + quote.price() + " " + recycleCurrency()));
        menus.put(inv, new Menu(player.getUniqueId(), "confirm", 0, List.of(), quote.id()));
        player.openInventory(inv);
    }

    private static ItemStack icon(Material type, String name, String hint) {
        ItemStack stack = new ItemStack(type);
        ItemMeta meta = stack.getItemMeta();
        meta.setDisplayName(ChatColor.GOLD + name);
        meta.setLore(List.of(ChatColor.GRAY + hint));
        stack.setItemMeta(meta);
        return stack;
    }

    @EventHandler public void onMenuClick(InventoryClickEvent event) {
        Menu menu = menus.get(event.getView().getTopInventory());
        if (menu == null) return;
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player)
                || !player.getUniqueId().equals(menu.owner())) return;
        int slot = event.getRawSlot();
        if (slot < 0 || slot >= event.getView().getTopInventory().getSize()) return;
        if (menu.kind().equals("shop")) {
            String id = menu.offersBySlot().get(slot);
            if (id != null && event.getCurrentItem() != null)
                Bukkit.getScheduler().runTask(plugin, () -> withReplyMode(true, () -> openBuyMenu(player,id,1)));
            else if (slot == 35 && nativeRpg.selected()) Bukkit.getScheduler().runTask(plugin, () -> openShopMenu(player));
            else if (slot == 36) Bukkit.getScheduler().runTask(plugin, () -> openRecycleMenu(player, 0));
            else if (slot == 38) Bukkit.getScheduler().runTask(plugin, () -> dungeon.command(player,new String[]{"arena","stash","page","1"}));
            else if (slot == 42) Bukkit.getScheduler().runTask(plugin, () -> dungeon.openLegacyMerchant(player));
            else if (slot == 43) Bukkit.getScheduler().runTask(plugin, () -> player.performCommand("mycli trade auction menu"));
            else if (slot == 40) withReplyMode(true,()->wallet(player));
            else if (slot == 44) Bukkit.getScheduler().runTask(plugin,()->player.closeInventory());
        } else if(menu.kind().equals("buy")) {
            if(slot==10)Bukkit.getScheduler().runTask(plugin,()->openShopMenu(player));
            else if((slot==12||slot==14)&&event.getCurrentItem()!=null)Bukkit.getScheduler().runTask(plugin,
                    ()->withReplyMode(true,()->openBuyMenu(player,menu.quoteId(),menu.page()+(slot==14?1:-1))));
            else if(slot==16){
                // Consume this exact confirmation before touching the bank: duplicate clicks do not buy twice.
                menus.put(event.getView().getTopInventory(),new Menu(menu.owner(),"busy",0,List.of(),null));
                Bukkit.getScheduler().runTask(plugin, () -> {
                    if (!player.isOnline()) return;
                    withReplyMode(true, () -> buy(player, new String[]{"arena", "shop", "buy", menu.quoteId(), Integer.toString(menu.page())}));
                    if (player.getOpenInventory().getTopInventory() == event.getView().getTopInventory()) openShopMenu(player);
                });
            }
        } else if (menu.kind().equals("recycle")) {
            int index = menu.page() * 45 + slot;
            if (slot < 45 && index < menu.candidates().size()) {
                Candidate candidate = menu.candidates().get(index);
                ItemStack current=source(player,candidate.stash(),candidate.slot());
                if(current==null||!hex(digest(current.serializeAsBytes())).equals(candidate.fingerprint())){
                    player.sendMessage("§e[item_changed] 该槽物品已改变，未报价或出售。正在刷新回收列表，请重新选择。");
                    Bukkit.getScheduler().runTask(plugin,()->openRecycleMenu(player,menu.page()));return;
                }
                Quote previous = slotQuote(player.getUniqueId(),candidate.stash(),candidate.slot());
                if(previous != null) consumeQuote(player.getUniqueId(),previous.id());
                withReplyMode(true,()->quote(player, new String[]{"arena", "recycle", "quote", candidate.stash() ? "chest" : "bag",
                        Integer.toString(candidate.stash() ? candidate.slot() + 1 : candidate.slot())}));
                Quote issued = slotQuote(player.getUniqueId(),candidate.stash(),candidate.slot());
                if (issued != null && issued.stash() == candidate.stash() && issued.slot() == candidate.slot())
                    Bukkit.getScheduler().runTask(plugin, () -> openConfirmMenu(player, issued));
            } else if (slot == 45) Bukkit.getScheduler().runTask(plugin, () -> openRecycleMenu(player, menu.page() - 1));
            else if (slot == 53) Bukkit.getScheduler().runTask(plugin, () -> openRecycleMenu(player, menu.page() + 1));
            else if (slot == 49) Bukkit.getScheduler().runTask(plugin, () -> openShopMenu(player));
        } else if (menu.kind().equals("confirm")) {
            if (slot == 15) {
                menus.put(event.getView().getTopInventory(),new Menu(menu.owner(),"busy",0,List.of(),null));
                withReplyMode(true,()->sell(player, new String[]{"arena", "recycle", "sell", menu.quoteId()}));
            }
            if (slot == 11 || slot == 15) Bukkit.getScheduler().runTask(plugin, () -> openRecycleMenu(player, 0));
        }
    }

    @EventHandler public void onMenuDrag(InventoryDragEvent event) {
        if (menus.containsKey(event.getView().getTopInventory())) event.setCancelled(true);
    }

    @EventHandler public void onMenuClose(InventoryCloseEvent event) {
        menus.remove(event.getInventory());
    }

    void wallet(Player player) {
        JsonObject state=nativeRpg.selected()?nativeRpg.recyclingState(player):null;
        boolean ready=state==null||state.get("available").getAsBoolean();
        reply(player, "wallet", ready, ready?"ok":"economy_unavailable", null, 0, balance(player.getUniqueId()), false, state);
    }

    /** Console-only maintenance: recycle exact duplicate named trial gear in a player's chest. */
    void pruneChestDuplicates(Player player, boolean apply, CommandSender sender) {
        if(nativeRpg.selected()){sender.sendMessage("旧批量回收已停用；由本人 /mycli arena recycle list 逐笔报价回收为金币，避免误卖。");return;}
        UUID owner = player.getUniqueId();
        Inventory stash = dungeon.liveStash(owner);
        int usedSlots = (int) java.util.Arrays.stream(dungeon.stashContents(owner))
                .filter(item -> item != null && !item.getType().isAir()).count();
        List<Integer> remove = new ArrayList<>();
        int total = 0;
        for (int slot = 0; slot < dungeon.stashCapacity(); slot++) {
            ItemStack item = dungeon.stashItem(owner,slot);
            if (item == null || item.getAmount() != 1 || !eligible(item)
                    || !item.hasItemMeta() || !item.getItemMeta().hasDisplayName()
                    || !item.getItemMeta().hasLore()) continue;
            boolean kept = false;
            for (ItemStack bag : player.getInventory().getContents())
                if (bag != null && bag.isSimilar(item)) { kept = true; break; }
            for (int previous = 0; !kept && previous < slot; previous++) {
                ItemStack other = dungeon.stashItem(owner,previous);
                if (other != null && other.isSimilar(item) && !remove.contains(previous)) kept = true;
            }
            if (!kept) continue;
            int price = unitPrice(item);
            if ((long) balance(owner) + total + price > MAX_BALANCE) {
                sender.sendMessage("MC_ARENA_PRUNE success=false reason=wallet_cap player=" + player.getName());
                sender.sendMessage("正确做法：目标钱包已到上限，停止回收；先让玩家 arena wallet 核对余额并自行购买需要的物品，再重新预览回收。");
                return;
            }
            remove.add(slot);
            total += price;
            sender.sendMessage("MC_ARENA_PRUNE_ITEM slot=" + (slot + 1) + " id=minecraft:"
                    + item.getType().name().toLowerCase(Locale.ROOT) + " name="
                    + ChatColor.stripColor(item.getItemMeta().getDisplayName()).replace(' ', '_')
                    + " price=" + price);
        }
        sender.sendMessage("MC_ARENA_PRUNE player=" + player.getName() + " apply=" + apply
                + " count=" + remove.size() + " credited=" + total
                + " chestUsedBefore=" + usedSlots
                + " chestUsedAfter=" + (usedSlots - remove.size())
                + " balanceBefore=" + balance(owner) + " balanceAfter=" + (balance(owner) + total));
        if (!apply || remove.isEmpty()) return;
        for (int slot : remove) dungeon.setStashItem(owner,slot,null);
        plugin.getConfig().set(WALLET + owner, balance(owner) + total);
        dungeon.saveStash(stash, owner);
        sender.sendMessage("MC_ARENA_PRUNE success=true player=" + player.getName() + " removed=" + remove.size());
    }

    /** Console-only cleanup of repeated trial gear in non-hotbar inventory slots. */
    void pruneBagDuplicates(Player player, boolean apply, CommandSender sender) {
        if(nativeRpg.selected()){sender.sendMessage("旧批量回收已停用；由本人 /mycli arena recycle list 逐笔报价回收为金币，避免误卖。");return;}
        UUID owner = player.getUniqueId();
        Inventory stash = dungeon.liveStash(owner);
        List<Integer> remove = new ArrayList<>();
        int total = 0;
        for (int slot = 9; slot < 36; slot++) {
            ItemStack item = player.getInventory().getItem(slot);
            if (item == null || item.getAmount() != 1 || !eligible(item)
                    || !item.hasItemMeta() || !item.getItemMeta().hasDisplayName()
                    || !item.getItemMeta().hasLore()) continue;
            boolean kept = false;
            for (ItemStack chestItem : dungeon.stashContents(owner))
                if (chestItem != null && chestItem.isSimilar(item)) { kept = true; break; }
            for (int previous = 0; !kept && previous < slot; previous++) {
                ItemStack other = player.getInventory().getItem(previous);
                if (other != null && other.isSimilar(item) && !remove.contains(previous)) kept = true;
            }
            if (!kept) continue;
            int price = unitPrice(item);
            if ((long) balance(owner) + total + price > MAX_BALANCE) {
                sender.sendMessage("MC_ARENA_PRUNE_BAG success=false reason=wallet_cap player=" + player.getName());
                sender.sendMessage("正确做法：目标钱包已到上限，停止回收；先让玩家 arena wallet 核对余额并自行购买需要的物品，再重新预览。");
                return;
            }
            remove.add(slot);
            total += price;
            sender.sendMessage("MC_ARENA_PRUNE_BAG_ITEM slot=" + slot + " id=minecraft:"
                    + item.getType().name().toLowerCase(Locale.ROOT) + " name="
                    + ChatColor.stripColor(item.getItemMeta().getDisplayName()).replace(' ', '_')
                    + " price=" + price);
        }
        int used = 0;
        for (int slot = 0; slot < 36; slot++) {
            ItemStack item = player.getInventory().getItem(slot);
            if (item != null && !item.getType().isAir()) used++;
        }
        sender.sendMessage("MC_ARENA_PRUNE_BAG player=" + player.getName() + " apply=" + apply
                + " count=" + remove.size() + " credited=" + total
                + " bagUsedBefore=" + used + " bagUsedAfter=" + (used - remove.size())
                + " balanceBefore=" + balance(owner) + " balanceAfter=" + (balance(owner) + total));
        if (!apply || remove.isEmpty()) return;
        for (int slot : remove) player.getInventory().setItem(slot, null);
        player.updateInventory();
        player.saveData();
        plugin.getConfig().set(WALLET + owner, balance(owner) + total);
        plugin.saveConfig();
        sender.sendMessage("MC_ARENA_PRUNE_BAG success=true player=" + player.getName() + " removed=" + remove.size());
    }

    private static int countEmpty(Inventory inv) {
        int count = 0;
        for (ItemStack item : inv.getContents()) if (item == null || item.getType().isAir()) count++;
        return count;
    }

    void recycle(Player player, String[] args) {
        boolean text=Arrays.asList(args).contains("--text");
        String[] words=Arrays.stream(args).filter(v->!v.equals("--text")&&!v.equals("--json")).toArray(String[]::new);
        withReplyMode(text,()->recycleCommand(player,words));
    }
    private void withReplyMode(boolean text,Runnable work){
        boolean previous=textReply;textReply=text;
        try{work.run();}finally{textReply=previous;}
    }
    private void recycleCommand(Player player,String[] args){
        if(nativeRpg.selected())recyclingReads.put(player.getUniqueId(),nativeRpg.recyclingState(player));
        try{
        String action = args.length > 2 ? args[2].toLowerCase(Locale.ROOT) : "list";
        switch (action) {
            case "menu" -> {if(args.length==3)openRecycleMenu(player);else reply(player,"recycle",false,"usage_recycle_list_quote_sell",null,0,0,false,null);}
            case "list" -> list(player, args);
            case "quote" -> quote(player, args);
            case "sell" -> sell(player, args);
            case "status" -> {
                if(args.length!=3){reply(player,"recycle",false,"usage_recycle_list_quote_sell",null,0,0,false,null);return;}
                if(nativeRpg.selected()){
                    JsonObject state=nativeRpg.recyclingState(player);
                    boolean available=state.has("available")&&state.get("available").getAsBoolean(),pending=state.has("pending")&&state.get("pending").getAsBoolean();
                    reply(player,"recycle_status",available,pending?"recycle_pending":available?"ok":"economy_unavailable",null,0,balance(player.getUniqueId()),pending,state);
                }else wallet(player);
            }
            default -> reply(player, "recycle", false, "usage_recycle_list_quote_sell", null, 0,
                    balance(player.getUniqueId()), false, null);
        }
        }finally{recyclingReads.remove(player.getUniqueId());}
    }
    private String recycleCurrency(){return nativeRpg.selected()?"RPG金币":"试炼绿宝石余额";}

    void shop(Player player, String[] args) {
        boolean text=Arrays.asList(args).contains("--text");
        String[] words=Arrays.stream(args).filter(v->!v.equals("--text")&&!v.equals("--json")).toArray(String[]::new);
        withReplyMode(text,()->shopCommand(player,words));
    }
    private void shopCommand(Player player,String[] args){
        if(args.length<3){reply(player,"shop",false,"usage_shop_list_buy_wallet",null,0,0,false,null);return;}
        String action = args[2].toLowerCase(Locale.ROOT);
        if(action.equals("menu")&&args.length==3){openShopMenu(player);return;}
        if (action.equals("list") && (args.length == 3 || args.length == 4
                && (args[3].equalsIgnoreCase("daily") || args[3].equalsIgnoreCase("supplies")))) {
            String requestId = UUID.randomUUID().toString();
            String section = args.length == 4 ? args[3].toLowerCase(Locale.ROOT) : "all";
            ShopStock stock = section.equals("supplies") ? null : stock();
            List<Offer> offers = new ArrayList<>();
            if (!section.equals("daily")) offers.addAll(OFFERS);
            if (stock != null) offers.addAll(stock.featured());
            if (nativeRpg.selected()) recyclingReads.put(player.getUniqueId(), nativeRpg.recyclingState(player));
            int legacyBalance = nativeRpg.selected() ? 0 : balance(player.getUniqueId());
            try {
                for (Offer offer : offers) {
                    JsonObject details = new JsonObject();
                    details.addProperty("offerId", offer.id());
                    details.addProperty("unitPrice", offer.price());
                    details.addProperty("daily", offer.daily());
                    if (offer.daily()) {
                        details.addProperty("stock", 1);
                        details.addProperty("refreshAt", stock.shelf().refreshAt());
                    }
                    details.addProperty("buyCommand", "/mycli trade shop buy " + offer.id());
                    reply(player, "shop_list", true, "ok", item(offer.stack(1)), 0, legacyBalance, false, details, requestId);
                }
                JsonObject summary = new JsonObject();
                summary.addProperty("section", section);
                if (stock != null && stock.shelf() != null) {
                    summary.addProperty("stockDate", stock.shelf().day().toString());
                    summary.addProperty("dailyInStock", offers.stream().filter(Offer::daily).count());
                    summary.addProperty("refreshAt", stock.shelf().refreshAt());
                    summary.addProperty("refreshTimezone", DailyShop.ZONE.getId());
                    summary.addProperty("refreshLabel", stock.refreshLabel());
                } else if (stock != null) {
                    summary.addProperty("dailyUnavailableReason", stock.unavailableReason());
                }
                reply(player, "shop_list_end", true, "ok", null, offers.size(), legacyBalance, false, summary, requestId);
            } finally {
                recyclingReads.remove(player.getUniqueId());
            }
            return;
        }
        if (action.equals("buy") && (args.length == 4 || args.length == 5)) {
            buy(player, args);
            return;
        }
        reply(player, "shop", false, "usage_shop_list_buy_wallet", null, 0,
                balance(player.getUniqueId()), false, null);
    }

    private void list(Player player, String[] args) {
        UUID owner = player.getUniqueId();
        int page = args.length == 4 ? parsePositive(args[3]) : 1;
        if (args.length > 4 || page < 1 || page > 48) {
            reply(player, "recycle_list", false, "usage_recycle_list_page", null, 0, balance(owner), false, null);
            return;
        }
        List<Candidate> candidates = new ArrayList<>();
        Inventory stash = dungeon.liveStash(owner);
        for (int slot = 0; slot < dungeon.stashCapacity(); slot++) {
            ItemStack stack = dungeon.stashItem(owner,slot);
            if (eligible(stack)) candidates.add(new Candidate(true, slot));
        }
        for (int slot = 0; slot < 36; slot++) {
            ItemStack stack = player.getInventory().getItem(slot);
            if (eligibleSource(player, false, slot, stack)) candidates.add(new Candidate(false, slot));
        }
        int start = (page - 1) * 12;
        String requestId = UUID.randomUUID().toString();
        for (int index = start; index < Math.min(start + 12, candidates.size()); index++) {
            Candidate candidate = candidates.get(index);
            ItemStack stack = source(player, candidate.stash(), candidate.slot());
            JsonObject details = new JsonObject();
            details.addProperty("source", candidate.stash() ? "chest" : "bag");
            details.addProperty("slot", candidate.stash() ? candidate.slot() + 1 : candidate.slot());
            details.addProperty("unitPrice", unitPrice(stack));
            reply(player, "recycle_list", true, "ok", item(stack), 0, balance(owner), false, details, requestId);
        }
        JsonObject details = new JsonObject();
        details.addProperty("page", page);
        details.addProperty("total", candidates.size());
        details.addProperty("pages", Math.max(1, (candidates.size() + 11) / 12));
        reply(player, "recycle_list_end", true, "ok", null, candidates.size(), balance(owner), false, details, requestId);
    }

    private void quote(Player player, String[] args) {
        UUID owner = player.getUniqueId();
        if (args.length != 5 && args.length != 6) {
            reply(player, "quote", false, "usage_quote_chest_or_bag_slot_count", null, 0, balance(owner), false, null);
            return;
        }
        boolean stash = args[3].equalsIgnoreCase("chest");
        if (!stash && !args[3].equalsIgnoreCase("bag")) {
            reply(player, "quote", false, "invalid_source", null, 0, balance(owner), false, null);
            return;
        }
        int slot = parseNonnegative(args[4]) - (stash ? 1 : 0);
        if (slot < 0 || slot >= (stash ? dungeon.stashCapacity() : 36)) {
            reply(player, "quote", false, "invalid_slot", null, 0, balance(owner), false, null);
            return;
        }
        ItemStack stack = source(player, stash, slot);
        if (!eligibleSource(player, stash, slot, stack)) {
            reply(player, "quote", false, "not_recyclable_or_protected", null, 0, balance(owner), false, null);
            return;
        }
        int quantity = args.length == 6 ? parsePositive(args[5]) : stack.getAmount();
        if (quantity < 1 || quantity > stack.getAmount()) {
            reply(player, "quote", false, "invalid_quantity", item(stack), 0, balance(owner), false, null);
            return;
        }
        int price = unitPrice(stack) * quantity;
        String quoteId = UUID.randomUUID().toString();
        long expiresAt = System.currentTimeMillis() + QUOTE_LIFETIME_MS;
        rememberQuote(new Quote(owner, quoteId, stash, slot, quantity, price,
                digest(stack.serializeAsBytes()), expiresAt));
        JsonObject details = new JsonObject();
        details.addProperty("quoteId", quoteId);
        details.addProperty("source", stash ? "chest" : "bag");
        details.addProperty("slot", stash ? slot + 1 : slot);
        details.addProperty("price", price);
        details.addProperty("expiresAt", expiresAt);
        details.addProperty("validForSeconds", QUOTE_LIFETIME_MS / 1000);
        details.addProperty("confirmCommand", "/mycli trade recycle sell " + quoteId);
        details.addProperty("refreshCommand", "/mycli trade recycle quote " + (stash ? "chest" : "bag") + " " + (stash ? slot + 1 : slot) + " " + quantity);
        details.addProperty("maxOutstandingQuotes", 32);
        reply(player, "quote", true, "ok", item(stack), quantity, balance(owner), false, details);
    }

    private void sell(Player player, String[] args) {
        UUID owner = player.getUniqueId();
        if (args.length != 4) {
            reply(player, "sell", false, "usage_sell_quote_id", null, 0, balance(owner), false, null);
            return;
        }
        Quote quote = findQuote(owner, args[3]);
        if (quote == null || !quote.id().equals(args[3])) {
            if(nativeRpg.selected()&&nativeRpg.recyclingState(player).get("pending").getAsBoolean()){
                reply(player,"sell",false,"recycle_pending",null,0,balance(owner),true,null);return;
            }
            reply(player, "sell", false, "quote_unknown_or_consumed", null, 0, balance(owner), false, null);
            return;
        }
        consumeQuote(owner, quote.id()); // Consume this exact quote first; retries never sell twice.
        if (System.currentTimeMillis() > quote.expiresAt()) {
            JsonObject expired = new JsonObject();
            expired.addProperty("nextCommand", "/mycli trade recycle quote " + (quote.stash() ? "chest" : "bag") + " " + (quote.stash() ? quote.slot() + 1 : quote.slot()) + " " + quote.quantity());
            expired.addProperty("nextAction", "本次未出售；重新查询此槽报价，核对物品后再确认，不自动重卖");
            reply(player, "sell", false, "quote_expired", null, 0, balance(owner), false, expired);
            return;
        }
        ItemStack current = source(player, quote.stash(), quote.slot());
        if (!eligibleSource(player, quote.stash(), quote.slot(), current)
                || current.getAmount() < quote.quantity()
                || !Arrays.equals(digest(current.serializeAsBytes()), quote.fingerprint())) {
            reply(player, "sell", false, "item_changed", current == null ? null : item(current),
                    0, balance(owner), false, null);
            return;
        }
        if(nativeRpg.selected()){
            JsonObject state=nativeRpg.recyclingState(player);
            if(!state.has("available")||!state.get("available").getAsBoolean()||state.get("pending").getAsBoolean()){
                boolean ready=state.has("available")&&state.get("available").getAsBoolean();
                reply(player,"sell",false,ready?"recycle_pending":"economy_unavailable",null,0,balance(owner),ready,null);return;
            }
            JsonObject snapshot=new JsonObject();snapshot.addProperty("source",quote.stash()?"chest":"bag");
            snapshot.addProperty("slot",quote.slot());snapshot.addProperty("quantity",quote.quantity());
            snapshot.addProperty("originalStack",Base64.getEncoder().encodeToString(current.serializeAsBytes()));
            snapshot.addProperty("balanceBefore",state.get("balance").getAsDouble());
            ItemStack remainder=current.clone();remainder.setAmount(current.getAmount()-quote.quantity());
            Runnable removal=()->{
                ItemStack actual=source(player,quote.stash(),quote.slot());
                if(!eligibleSource(player,quote.stash(),quote.slot(),actual)||!Arrays.equals(digest(actual.serializeAsBytes()),quote.fingerprint()))throw new IllegalStateException("quote changed before escrow");
                if(quote.stash()){
                    Inventory inv=dungeon.liveStash(owner);dungeon.setStashItem(owner,quote.slot(),remainder.getAmount()==0?null:remainder);
                    dungeon.saveStash(inv,owner);
                    nativeRpg.saveConfigVerified();
                }else{
                    player.getInventory().setItem(quote.slot(),remainder.getAmount()==0?null:remainder);player.saveData();
                }
            };
            boolean requestedText=textReply;
            try{nativeRpg.settleRecycling(player,quote.id(),quote.price(),snapshot.toString(),removal,raw->{
                JsonObject result=JsonParser.parseString(raw).getAsJsonObject();
                result.addProperty("requestedQuantity",quote.quantity());result.addProperty("requestedCredit",quote.price());
                if(result.get("pending").getAsBoolean()){result.add("earned",JsonNull.INSTANCE);result.add("quantity",JsonNull.INSTANCE);}
                else{result.addProperty("earned",result.get("success").getAsBoolean()?quote.price():0);result.addProperty("quantity",result.get("success").getAsBoolean()?quote.quantity():0);}
                withReplyMode(requestedText,()->reply(player,"sell",result.get("success").getAsBoolean(),result.get("reason").getAsString(),item(current),quote.quantity(),balance(owner),result.get("pending").getAsBoolean(),result));
                if(!requestedText&&result.get("success").getAsBoolean())player.sendMessage("§a【回收】金币已入账 +"+quote.price()+"；物品已按报价回收。购买补给：/mycli trade shop list");
            });}catch(RuntimeException unavailable){reply(player,"sell",false,"recycle_unverified",null,0,balance(owner),true,null);}
            return;
        }
        int oldBalance = balance(owner);
        if (oldBalance > MAX_BALANCE - quote.price()) {
            reply(player, "sell", false, "wallet_limit", item(current), 0, oldBalance, false, null);
            return;
        }
        JsonObject sold = item(current);
        ItemStack remainder = current.clone();
        remainder.setAmount(current.getAmount() - quote.quantity());
        if (quote.stash()) {
            Inventory inv = dungeon.liveStash(owner);
            dungeon.setStashItem(owner,quote.slot(),remainder.getAmount() == 0 ? null : remainder);
            plugin.getConfig().set(WALLET + owner, oldBalance + quote.price());
            dungeon.saveStash(inv, owner);
        } else {
            player.getInventory().setItem(quote.slot(), remainder.getAmount() == 0 ? null : remainder);
            plugin.getConfig().set(WALLET + owner, oldBalance + quote.price());
            plugin.saveConfig();
            player.saveData();
        }
        JsonObject details = new JsonObject();
        details.addProperty("quoteId", quote.id());
        details.addProperty("earned", quote.price());
        reply(player, "sell", true, "ok", sold, quote.quantity(), oldBalance + quote.price(), false, details);
    }

    private Offer shopOffer(Player player, String id) {
        if (!DailyShop.isDaily(id)) {
            Offer offer = OFFERS.stream().filter(row -> row.id().equals(id)).findFirst().orElse(null);
            if (offer == null) shopFailure(player, "invalid_offer_or_quantity", id);
            return offer;
        }
        return dailyOffer(player, id, stock());
    }

    private Offer dailyOffer(Player player, String id, ShopStock stock) {
        DailyShop.Shelf shelf = stock.shelf();
        DailyShop.Entry entry = shelf == null ? null : shelf.find(id);
        if (entry == null || !entry.available()) {
            String reason = shelf == null ? stock.unavailableReason()
                    : entry == null ? DailyShop.missingReason(shelf, id) : entry.reason();
            shopFailure(player, reason, id);
            return null;
        }
        return new Offer(entry);
    }

    private void shopFailure(Player player, String reason, String id) {
        JsonObject details = new JsonObject();
        if (id.matches("[a-z0-9_]{1,80}")) details.addProperty("offerId", id);
        details.addProperty("spent", 0);
        if (reason.startsWith("shop_")) {
            details.addProperty("retrySameAction", false);
            details.addProperty("nextCommand", reason.equals("shop_stock_unavailable") ? "/mycli trade shop list supplies"
                    : reason.equals("shop_survival_required") ? "/mycli status" : "/mycli trade shop list daily");
        }
        reply(player, "buy", false, reason, null, 0, 0, false, details);
    }

    private void buy(Player player, String[] args) {
        UUID owner = player.getUniqueId();
        String id = args[3].toLowerCase(Locale.ROOT);
        ShopStock stock = DailyShop.isDaily(id) ? stock() : null;
        Offer offer = stock == null ? shopOffer(player, id) : dailyOffer(player, id, stock);
        if (offer == null) return;
        int count = args.length == 5 ? parsePositive(args[4]) : 1;
        if (count < 1 || count > offer.maxQuantity()) {
            shopFailure(player, "invalid_offer_or_quantity", id);
            return;
        }
        int price = offer.price() * count;
        if(nativeRpg.selected()){
            ItemStack purchased=offer.stack(count);
            if(dungeon.queuedItems(owner)>=1024){reply(player,"buy",false,"pending_queue_full",item(purchased),0,0,true,null);return;}
            JsonObject evidence=new JsonObject();evidence.addProperty("offerId",offer.id());evidence.addProperty("price",price);
            evidence.addProperty("item",Base64.getEncoder().encodeToString(purchased.serializeAsBytes()));
            String requestId = "shop:" + UUID.randomUUID();
            if (offer.daily()) {
                JsonObject bank = nativeRpg.recyclingState(player);
                if (!plugin.nativeRpgMayAct(player)) { shopFailure(player, "shop_survival_required", id); return; }
                if (!bank.get("available").getAsBoolean()) { shopFailure(player, "economy_unavailable", id); return; }
                if (bank.get("pending").getAsBoolean()) { shopFailure(player, "money_pending", id); return; }
                if (!bank.has("balance") || bank.get("balance").getAsDouble() < price) {
                    shopFailure(player, "insufficient_balance", id);
                    return;
                }
                try {
                    dailyShop.reserve(stock.shelf(), stock.shelf().find(id), requestId, owner);
                } catch (RuntimeException failure) {
                    plugin.getLogger().warning("Could not reserve daily stock " + id + ": " + failure.getMessage());
                    shopFailure(player, "shop_stock_unavailable", id);
                    return;
                }
            }
            Runnable queueItem = () -> {
                if(!dungeon.queuePurchased(owner,purchased))throw new IllegalStateException("queue changed");
            };
            JsonObject result;
            try {
                result = nativeRpg.settleMoney(player,requestId,-price,evidence.toString(),()->{
                    if (offer.daily()) dailyShop.deliver(id, requestId, owner, queueItem);
                    else {
                        queueItem.run();
                        nativeRpg.saveConfigVerified();
                    }
                });
            } catch (RuntimeException failure) {
                result = new JsonObject();
                result.addProperty("success", false);
                result.addProperty("reason", "money_unverified");
                result.addProperty("pending", true);
                plugin.getLogger().warning("Shop settlement unconfirmed: " + requestId + " (" + failure.getClass().getSimpleName() + ")");
            }
            boolean ok=result.get("success").getAsBoolean();
            if (offer.daily() && !ok && Set.of("insufficient_balance", "economy_unavailable", "money_pending")
                    .contains(result.get("reason").getAsString())) {
                try { dailyShop.release(id, requestId); }
                catch (RuntimeException failure) {
                    plugin.getLogger().warning("Daily stock remains reserved: " + requestId + " (" + failure.getClass().getSimpleName() + ")");
                }
            }
            result.addProperty("offerId", id);
            result.addProperty("daily", offer.daily());
            result.addProperty("transactionId", requestId);
            if (offer.daily() && (ok || result.get("reason").getAsString().equals("money_unverified"))) removeFromOpenShelves(id);
            if (offer.daily() && ok) result.addProperty("stock", 0);
            result.addProperty("requestedSpend",price);result.addProperty("pendingCount",dungeon.queuedItems(owner));
            if(result.get("pending").getAsBoolean()){result.add("spent",JsonNull.INSTANCE);result.add("quantity",JsonNull.INSTANCE);}
            else result.addProperty("spent",ok?price:0);
            reply(player,"buy",ok,ok?"queued_for_personal_chest":result.get("reason").getAsString(),item(purchased),ok?purchased.getAmount():0,0,ok||result.get("pending").getAsBoolean(),result);
            if(ok&&!textReply)player.sendMessage("§a【商店】已扣 "+price+" 金币；商品在个人奖励箱。取物：/mycli arena stash page 1");
            return;
        }
        int oldBalance = balance(owner);
        if (oldBalance < price) {
            reply(player, "buy", false, "insufficient_balance", item(new ItemStack(offer.material(), offer.count())),
                    0, oldBalance, false, null);
            return;
        }
        ItemStack purchased = new ItemStack(offer.material(), offer.count() * count);
        if (!dungeon.queuePurchased(owner, purchased)) {
            reply(player, "buy", false, "pending_queue_full", item(purchased), 0, oldBalance, true, null);
            return;
        }
        plugin.getConfig().set(WALLET + owner, oldBalance - price);
        plugin.saveConfig(); // Wallet and pending item are saved in the same plugin state write.
        JsonObject details = new JsonObject();
        details.addProperty("offerId", offer.id());
        details.addProperty("spent", price);
        details.addProperty("pendingCount", dungeon.queuedItems(owner));
        reply(player, "buy", true, "queued_for_personal_chest", item(purchased), purchased.getAmount(),
                oldBalance - price, true, details);
    }

    private int balance(UUID owner) {
        if(nativeRpg.selected()){
            try{return (int)Math.min(Integer.MAX_VALUE,Math.max(0,nativeRpg.goldBalance(owner)));}
            catch(RuntimeException unavailable){return 0;} // Never exposed as verified: reply uses availability + null.
        }
        return Math.max(0, plugin.getConfig().getInt(WALLET + owner, 0));
    }

    int creditDifficulty(UUID owner, int amount) {
        if(nativeRpg.selected()){
            Player p=Bukkit.getPlayer(owner);if(p==null||amount<=0)return 0;
            String run=plugin.getConfig().getString("dungeon-active-run.id","");
            int floor=plugin.getConfig().getInt("dungeon-active-run.floor",0);
            if(run.isEmpty()||floor<1){p.sendMessage("§e[reward_unverified] 缺少试炼场次证明，金币未发放；联系服主核对，不重复领奖。");return 0;}
            JsonObject receipt=nativeRpg.settleMoney(p,"trial:"+run+":"+floor,amount,"trialFloor="+floor+";coins="+amount,()->{});
            if(receipt.get("success").getAsBoolean())return amount;
            p.sendMessage("§e["+receipt.get("reason").getAsString()+"] 试炼金币未确认；查询 /mycli arena recycle status，勿重复领奖。");
            return 0;
        }
        int credited = Math.min(Math.max(0, amount), MAX_BALANCE - balance(owner));
        if (credited > 0) plugin.getConfig().set(WALLET + owner, balance(owner) + credited);
        return credited;
    }

    private ItemStack source(Player player, boolean stash, int slot) {
        return stash ? dungeon.stashItem(player.getUniqueId(),slot) : player.getInventory().getItem(slot);
    }

    private static int parsePositive(String raw) {
        try { int value = Integer.parseInt(raw); return value > 0 ? value : -1; }
        catch (NumberFormatException invalid) { return -1; }
    }
    private static int parseNonnegative(String raw) {
        try { int value = Integer.parseInt(raw); return value >= 0 ? value : -1; }
        catch (NumberFormatException invalid) { return -1; }
    }

    static boolean eligible(ItemStack stack) {
        if (stack == null || stack.getType().isAir() || stack.getAmount() < 1) return false;
        String type = stack.getType().name();
        boolean gear = type.endsWith("_SWORD") || type.endsWith("_AXE") || type.endsWith("_PICKAXE")
                || type.endsWith("_HELMET") || type.endsWith("_CHESTPLATE")
                || type.endsWith("_LEGGINGS") || type.endsWith("_BOOTS")
                || Set.of("BOW", "CROSSBOW", "TRIDENT", "SHIELD").contains(type);
        if (!gear || !stack.hasItemMeta()) return gear;
        ItemMeta meta = stack.getItemMeta();
        if (meta.isUnbreakable()) return false;
        Set<NamespacedKey> keys = meta.getPersistentDataContainer().getKeys();
        if (!keys.isEmpty()) {
            NamespacedKey imprint = NamespacedKey.fromString("agentfriend:imprint_spell");
            if (keys.size() != 1 || !meta.hasDisplayName()) return false;
            String name = ChatColor.stripColor(meta.getDisplayName());
            if (keys.contains(DungeonGearAura.KEY)) {
                String aura = meta.getPersistentDataContainer().get(DungeonGearAura.KEY, PersistentDataType.STRING);
                if (!(stack.getType() == Material.IRON_CHESTPLATE && "熔心护甲".equals(name)
                        && DungeonGearAura.EMBER.equals(aura)
                        || stack.getType() == Material.GOLDEN_CHESTPLATE && "春灯愈甲".equals(name)
                        && DungeonGearAura.RENEWAL.equals(aura)
                        || stack.getType() == Material.CHAINMAIL_CHESTPLATE && "血誓锁甲".equals(name)
                        && DungeonGearAura.LEECH.equals(aura))) return false;
                if (!meta.hasLore() || meta.getLore().size() != 3) return false;
                List<String> lore = meta.getLore();
                return TRIAL_LORE.equals(ChatColor.stripColor(lore.get(0)))
                        && ChatColor.stripColor(lore.get(1)).startsWith("✦ 被动：")
                        && (ChatColor.stripColor(lore.get(2)).startsWith("穿戴时每")
                            || ChatColor.stripColor(lore.get(2)).startsWith("双方脱战")
                            || ChatColor.stripColor(lore.get(2)).startsWith("攻击敌怪"));
            }
            if (!keys.contains(imprint)) return false;
            String spell = meta.getPersistentDataContainer().get(imprint, PersistentDataType.STRING);
            if (!(name.equals("赤铜柄·闪现匕首") && "blink".equals(spell)
                    || name.equals("寒霜剑") && "frostnova".equals(spell)
                    || name.equals("炎纹双刃斧") && "flamewave".equals(spell)
                    || name.equals("星轨猎弓") && "starbolt".equals(spell)
                    || name.equals("影步连弩") && "blink".equals(spell)
                    || name.equals("潮汐战矛") && "frostnova".equals(spell))) return false;
            if (!meta.hasLore() || meta.getLore().size() != 3) return false;
            List<String> lore = meta.getLore();
            return TRIAL_LORE.equals(ChatColor.stripColor(lore.get(0)))
                    && (lore.get(1).startsWith("§5✦ 法术刻印：")
                        || lore.get(1).startsWith("§d✦ 法术刻印："))
                    && lore.get(2).startsWith("§7潜行使用：");
        }
        if (meta.hasDisplayName()) {
            String name = ChatColor.stripColor(meta.getDisplayName());
            if (!NAMED_REWARDS.contains(name)) return false;
            if (!meta.hasLore() || meta.getLore().size() != 1
                    || !TRIAL_LORE.equals(ChatColor.stripColor(meta.getLore().get(0)))) return false;
        } else if (meta.hasLore()) return false;
        return true;
    }

    private static boolean eligibleSource(Player player, boolean stash, int slot, ItemStack stack) {
        // Armor and off-hand are outside bag slots 0–35; the currently held hotbar item is also equipped.
        return (stash || slot != player.getInventory().getHeldItemSlot()) && eligible(stack);
    }

    private static int unitPrice(ItemStack stack) {
        String type = stack.getType().name();
        int base = type.startsWith("NETHERITE_") ? 16 : type.startsWith("DIAMOND_") ? 11
                : type.startsWith("IRON_") ? 5 : type.startsWith("GOLDEN_") ? 3
                : type.startsWith("STONE_") || type.startsWith("LEATHER_") ? 1 : 4;
        int enchant = stack.getEnchantments().values().stream().mapToInt(Integer::intValue).sum();
        int damage = stack.hasItemMeta() && stack.getItemMeta() instanceof Damageable worn ? worn.getDamage() : 0;
        int max = stack.getType().getMaxDurability();
        int condition = max > 0 ? Math.max(1, (base * (max - Math.min(max, damage))) / max) : base;
        return Math.max(1, Math.min(32, condition + Math.min(8, enchant)));
    }

    private JsonObject item(ItemStack stack) {
        JsonObject result = new JsonObject();
        result.addProperty("id", "minecraft:" + stack.getType().name().toLowerCase(Locale.ROOT));
        result.addProperty("quantity", stack.getAmount());
        ItemMeta meta = stack.hasItemMeta() ? stack.getItemMeta() : null;
        result.addProperty("name", meta != null && meta.hasDisplayName()
                ? ChatColor.stripColor(meta.getDisplayName()) : identity.describe(stack).name());
        JsonArray enchants = new JsonArray();
        for (Map.Entry<Enchantment, Integer> enchant : stack.getEnchantments().entrySet()) {
            JsonObject entry = new JsonObject();
            entry.addProperty("id", enchant.getKey().getKey().toString());
            entry.addProperty("level", enchant.getValue());
            enchants.add(entry);
        }
        result.add("enchantments", enchants);
        int damage = meta instanceof Damageable worn ? worn.getDamage() : 0;
        int max = stack.getType().getMaxDurability();
        result.addProperty("damage", damage);
        result.addProperty("maxDurability", max);
        result.addProperty("remainingDurability", max > 0 ? Math.max(0, max - damage) : 0);
        byte[] serialized = stack.serializeAsBytes();
        result.addProperty("componentHash", hex(digest(serialized)));
        result.addProperty("serializedItemBase64", Base64.getEncoder().encodeToString(serialized));
        return result;
    }

    private static byte[] digest(byte[] bytes) {
        try { return MessageDigest.getInstance("SHA-256").digest(bytes); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) out.append(String.format("%02x", value & 0xff));
        return out.toString();
    }

    private void reply(Player player, String action, boolean success, String reason, JsonObject item,
                       int quantity, int balance, boolean pending, JsonObject details) {
        reply(player, action, success, reason, item, quantity, balance, pending, details,
                UUID.randomUUID().toString());
    }

    private void reply(Player player, String action, boolean success, String reason, JsonObject item,
                       int quantity, int balance, boolean pending, JsonObject details, String requestId) {
        JsonObject response = new JsonObject();
        response.addProperty("schemaVersion", 1);
        response.addProperty("requestId", requestId);
        response.addProperty("action", action);
        response.addProperty("queryOnly",action.equals("recycle_status")||action.startsWith("recycle_list")||action.startsWith("shop_list")||action.equals("wallet"));
        response.addProperty("success", success);
        response.addProperty("reason", reason);
        response.add("item", item);
        response.addProperty("quantity", quantity);
        response.addProperty("balance", balance);
        response.addProperty("pending", pending);
        boolean gold=nativeRpg.selected();
        response.addProperty("currency",gold?"金币":"试炼绿宝石余额");
        if(gold){
            JsonObject state=recyclingReads.containsKey(player.getUniqueId())?recyclingReads.get(player.getUniqueId()):nativeRpg.recyclingState(player);
            response.add("balance",state.has("balance")?state.get("balance"):JsonNull.INSTANCE);
            response.addProperty("balanceAvailable",state.has("available")&&state.get("available").getAsBoolean());
            response.addProperty("balanceCommand","/mycli trade wallet");
            response.addProperty("walletAlias","/mycli arena wallet");
        }
        if (details != null) for (Map.Entry<String, com.google.gson.JsonElement> field : details.entrySet())
            response.add(field.getKey(), field.getValue());
        boolean unresolved=Set.of("recycle_pending","recycle_unverified","money_pending","money_unverified").contains(reason);
        if(unresolved){response.addProperty("nextCommand","/mycli arena recycle status");response.addProperty("nextAction","交易待对账，保留原报价与物品证据，联系服主；不重复交易或补发金币");}
        ActionFeedback.Advice advice = success||unresolved ? null : ActionFeedback.advice("economy", reason, "");
        if (advice != null && !response.has("nextCommand")) advice.add(response);
        if(textReply){player.sendMessage(EconomyPresentation.text(response));return;}
        // Player#sendMessage is point-to-point: never publish economy state to public chat.
        player.sendMessage("MC_ARENA_ECONOMY " + response);
        if (advice != null) advice.send(player);
        if(unresolved)player.sendMessage("§e【交易待对账】结果未确认，保留原记录，不重复交易；/mycli arena recycle status 后联系服主。");
    }
}
