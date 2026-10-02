package org.afuhome.agentfriend;

import com.google.gson.JsonObject;
import io.netty.buffer.Unpooled;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.block.data.Ageable;
import org.bukkit.block.data.Lightable;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.inventory.CraftItemEvent;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerEditBookEvent;
import org.bukkit.event.player.PlayerFishEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.BookMeta;
import org.bukkit.inventory.meta.ItemMeta;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.DiscardedPayload;
import net.minecraft.resources.ResourceLocation;
import org.bukkit.craftbukkit.entity.CraftPlayer;

/** Small daily life contracts using only vanilla actions and items on every client. */
final class LifeGuildManager implements Listener {
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    private static final String CHANNEL = "mcagent:life";
    private record Contract(String id, String guildId, String guild, String title, String description,
            Material icon, int target, int reputation, int emeralds, Material gift, int giftCount) { }
    private static final List<Contract> CONTRACTS = List.of(
            new Contract("farmer_harvest", "farmer", "田园公会", "丰收的一天", "收获 12 株成熟小麦；同一块田只计一次",
                    Material.WHEAT, 12, 3, 2, Material.BONE_MEAL, 4),
            new Contract("gourmet_bread", "gourmet", "美食家公会", "给大家烤面包", "亲手合成 3 次面包",
                    Material.BREAD, 3, 3, 2, Material.HONEY_BOTTLE, 1),
            new Contract("angler_catch", "angler", "钓客公会", "河畔小憩", "用鱼竿钓起 3 条鱼",
                    Material.FISHING_ROD, 3, 3, 2, Material.CAMPFIRE, 1),
            new Contract("builder_home", "builder", "建筑家公会", "搭一间小屋", "在可建造处放置 12 个不同位置的木板、砖、玻璃或灯",
                    Material.CHERRY_PLANKS, 12, 4, 3, Material.FLOWER_POT, 2),
            new Contract("author_story", "author", "故事公会", "旅途的一页", "签署一本至少 40 字的原创游记；书留在自己手中",
                    Material.WRITABLE_BOOK, 1, 4, 2, Material.BOOKSHELF, 1),
            new Contract("tinkerer_light", "tinkerer", "机关工匠公会", "点亮第一盏灯", "亲手放置红石灯，再用附近拉杆点亮它",
                    Material.REDSTONE_LAMP, 1, 4, 3, Material.REDSTONE, 4));

    private final AgentFriendPlugin plugin;
    private final DungeonManager dungeon;

    LifeGuildManager(AgentFriendPlugin plugin, DungeonManager dungeon) {
        this.plugin = plugin;
        this.dungeon = dungeon;
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
    }

    private String today() { return LocalDate.now(ZONE).toString(); }
    private String base(Player player) { return "life-guild." + player.getUniqueId(); }
    private Contract byId(String id) {
        for (Contract contract : CONTRACTS) if (contract.id().equals(id)) return contract;
        return null;
    }
    private Contract active(Player player) {
        return byId(plugin.getConfig().getString(base(player) + ".active.id", ""));
    }
    private int progress(Player player) { return plugin.getConfig().getInt(base(player) + ".active.progress"); }
    private boolean completedToday(Player player, Contract contract) {
        return today().equals(plugin.getConfig().getString(base(player) + ".done." + contract.id()));
    }

    void command(Player player, String[] args) {
        String action = args.length > 1 ? args[1].toLowerCase(Locale.ROOT) : "board";
        switch (action) {
            case "board", "list", "看板" -> board(player);
            case "menu", "菜单" -> plugin.openLifeGuildMenu(player);
            case "status", "状态" -> status(player);
            case "accept", "接单" -> {
                if (args.length < 3) player.sendMessage(ChatColor.YELLOW + "用法：/mycli life accept <任务ID>");
                else accept(player, args[2].toLowerCase(Locale.ROOT));
            }
            case "claim", "交付" -> claim(player);
            case "abandon", "放弃" -> abandon(player);
            case "write", "写书" -> write(player, args);
            default -> player.sendMessage(ChatColor.YELLOW
                    + "用法：/mycli life board|menu|status|accept <任务ID>|claim|abandon|write <书名>|<正文>");
        }
    }

    private void board(Player player) {
        status(player);
        for (Contract contract : CONTRACTS) {
            String state = completedToday(player, contract) ? "今日已完成" : "可接";
            player.sendMessage(ChatColor.GOLD + contract.guild() + ChatColor.WHITE + " "
                    + contract.id() + " · " + contract.title() + " · " + contract.description()
                    + " · 声望+" + contract.reputation() + " [" + state + "]");
        }
        player.sendMessage(ChatColor.GRAY + "接单 /mycli life accept <ID>；完成后 /mycli life claim。"
                + "手柄可用 /mycli life menu 或技能罗盘进入看板。");
    }

    private void status(Player player) {
        String base = base(player);
        Contract contract = active(player);
        player.sendMessage(ChatColor.AQUA + "生活公会：" + (contract == null ? "当前没有委托"
                : contract.guild() + "「" + contract.title() + "」 " + progress(player) + "/" + contract.target()));
        JsonObject reputations = new JsonObject();
        for (Contract guild : CONTRACTS) {
            int reputation = plugin.getConfig().getInt(base + ".reputation." + guild.guildId());
            player.sendMessage(ChatColor.GRAY + guild.guild() + " · " + rank(reputation) + " · 声望 " + reputation);
            reputations.addProperty(guild.guildId(), reputation);
        }
        JsonObject json = new JsonObject();
        json.addProperty("schemaVersion", 1);
        json.addProperty("kind", "status");
        json.addProperty("activeId", contract == null ? "" : contract.id());
        json.addProperty("progress", contract == null ? 0 : progress(player));
        json.addProperty("target", contract == null ? 0 : contract.target());
        json.add("reputation", reputations);
        send(player, json);
    }

    private String rank(int reputation) {
        if (reputation >= 50) return "大师";
        if (reputation >= 20) return "匠人";
        if (reputation >= 6) return "熟手";
        return "学徒";
    }

    private void accept(Player player, String id) {
        Contract contract = byId(id);
        if (contract == null) { player.sendMessage(ChatColor.RED + "未知生活委托；/mycli life board 查看任务 ID。"); return; }
        if (player.getGameMode() == GameMode.SPECTATOR) { player.sendMessage(ChatColor.RED + "旁观者不能接委托。"); return; }
        if (active(player) != null) { player.sendMessage(ChatColor.YELLOW + "先交付或放弃当前生活委托。"); return; }
        if (completedToday(player, contract)) { player.sendMessage(ChatColor.YELLOW + "这项委托今日已完成，明天再来。"); return; }
        String path = base(player) + ".active";
        plugin.getConfig().set(path + ".id", contract.id());
        plugin.getConfig().set(path + ".progress", 0);
        plugin.getConfig().set(path + ".seen", null);
        plugin.saveConfig();
        player.sendMessage(ChatColor.GREEN + "已接「" + contract.title() + "」：" + contract.description());
        if (contract.id().equals("author_story")) starter(player, Material.WRITABLE_BOOK, "书与笔");
        if (contract.id().equals("angler_catch")) starter(player, Material.FISHING_ROD, "鱼竿");
        receipt(player, "accept", contract, true, "accepted");
    }

    private void starter(Player player, Material material, String label) {
        String key = base(player) + ".starter." + material.name().toLowerCase(Locale.ROOT);
        if (plugin.getConfig().getBoolean(key) || player.getInventory().contains(material)) return;
        if (player.getInventory().firstEmpty() < 0) {
            player.sendMessage(ChatColor.YELLOW + "背包满了；" + label + "可自行准备，或空出一格后放弃并重接。");
            return;
        }
        player.getInventory().addItem(new ItemStack(material));
        plugin.getConfig().set(key, true);
        plugin.saveConfig();
        player.sendMessage(ChatColor.GREEN + "公会送你一件入门工具：" + label + "。");
    }

    private void abandon(Player player) {
        Contract contract = active(player);
        if (contract == null) { player.sendMessage(ChatColor.YELLOW + "没有在办的生活委托。"); return; }
        plugin.getConfig().set(base(player) + ".active", null);
        plugin.saveConfig();
        player.sendMessage(ChatColor.YELLOW + "已放弃「" + contract.title() + "」。");
        receipt(player, "abandon", contract, true, "abandoned");
    }

    private void claim(Player player) {
        Contract contract = active(player);
        if (contract == null) { player.sendMessage(ChatColor.YELLOW + "没有可交付的生活委托。"); return; }
        if (progress(player) < contract.target()) {
            player.sendMessage(ChatColor.YELLOW + "还需完成 " + progress(player) + "/" + contract.target()); return;
        }
        if (completedToday(player, contract)) { player.sendMessage(ChatColor.RED + "今日已结算，请联系服主核对。"); return; }
        if (!dungeon.queueGuildRewards(player.getUniqueId(), contract.emeralds(), contract.gift(), contract.giftCount())) {
            player.sendMessage(ChatColor.RED + "奖励箱数据异常，暂不交付，请联系服主。");
            receipt(player, "claim", contract, false, "reward_storage_error");
            return;
        }
        String base = base(player);
        int reputation = plugin.getConfig().getInt(base + ".reputation." + contract.guildId()) + contract.reputation();
        plugin.getConfig().set(base + ".reputation." + contract.guildId(), reputation);
        plugin.getConfig().set(base + ".done." + contract.id(), today());
        plugin.getConfig().set(base + ".active", null);
        plugin.saveConfig();
        player.sendMessage(ChatColor.GREEN + contract.guild() + "委托完成！声望 +" + contract.reputation()
                + "（" + rank(reputation) + "）；绿宝石与小礼物已进入个人试炼箱。");
        receipt(player, "claim", contract, true, "claimed");
        plugin.getLogger().info("Life guild claim: player=" + player.getUniqueId() + ", id=" + contract.id());
    }

    private void advance(Player player, String id, String uniquePosition) {
        Contract contract = active(player);
        if (contract == null || !contract.id().equals(id) || progress(player) >= contract.target()) return;
        String path = base(player) + ".active";
        if (uniquePosition != null) {
            Set<String> seen = new HashSet<>(plugin.getConfig().getStringList(path + ".seen"));
            if (!seen.add(uniquePosition)) return;
            plugin.getConfig().set(path + ".seen", List.copyOf(seen));
        }
        int next = progress(player) + 1;
        plugin.getConfig().set(path + ".progress", next);
        plugin.saveConfig();
        if (next == contract.target()) player.sendMessage(ChatColor.GOLD + "「" + contract.title()
                + "」已达成！在看板点击交付，或 /mycli life claim。");
        else player.sendMessage(ChatColor.AQUA + "「" + contract.title() + "」 " + next + "/" + contract.target());
        receipt(player, "progress", contract, true, "progressed");
    }

    private String position(org.bukkit.Location location) {
        return location.getWorld().getUID() + ":" + location.getBlockX() + ":"
                + location.getBlockY() + ":" + location.getBlockZ();
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onHarvest(BlockBreakEvent event) {
        if (event.getBlock().getType() != Material.WHEAT
                || !(event.getBlock().getBlockData() instanceof Ageable age)
                || age.getAge() != age.getMaximumAge()) return;
        advance(event.getPlayer(), "farmer_harvest", position(event.getBlock().getLocation()));
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onCraft(CraftItemEvent event) {
        if (!(event.getWhoClicked() instanceof Player player) || event.getCurrentItem() == null
                || event.getCurrentItem().getType() != Material.BREAD) return;
        advance(player, "gourmet_bread", null);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onFish(PlayerFishEvent event) {
        if (event.getState() != PlayerFishEvent.State.CAUGHT_FISH
                || !(event.getCaught() instanceof Item item)) return;
        Material type = item.getItemStack().getType();
        if (type == Material.COD || type == Material.SALMON || type == Material.TROPICAL_FISH
                || type == Material.PUFFERFISH) advance(event.getPlayer(), "angler_catch", null);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBuild(BlockPlaceEvent event) {
        Material type = event.getBlockPlaced().getType();
        if (type == Material.REDSTONE_LAMP) {
            Contract current = active(event.getPlayer());
            if (current != null && current.id().equals("tinkerer_light")) {
                plugin.getConfig().set(base(event.getPlayer()) + ".active.lamp", position(event.getBlockPlaced().getLocation()));
                plugin.saveConfig();
                event.getPlayer().sendMessage(ChatColor.AQUA + "红石灯已登记；在 4 格内用拉杆点亮它。");
            }
        }
        String name = type.name();
        if (!(name.endsWith("_PLANKS") || name.endsWith("_BRICKS")
                || name.endsWith("_GLASS") || type == Material.GLASS
                || type == Material.LANTERN || type == Material.SOUL_LANTERN)) return;
        advance(event.getPlayer(), "builder_home", position(event.getBlockPlaced().getLocation()));
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onLever(PlayerInteractEvent event) {
        if (event.getAction() != Action.RIGHT_CLICK_BLOCK || event.getClickedBlock() == null
                || event.getClickedBlock().getType() != Material.LEVER) return;
        Player player = event.getPlayer();
        Contract current = active(player);
        if (current == null || !current.id().equals("tinkerer_light")) return;
        String lampKey = plugin.getConfig().getString(base(player) + ".active.lamp", "");
        if (lampKey.isEmpty()) return;
        org.bukkit.Location lever = event.getClickedBlock().getLocation();
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (!player.isOnline()) return;
            for (int dx = -4; dx <= 4; dx++) for (int dy = -4; dy <= 4; dy++) for (int dz = -4; dz <= 4; dz++) {
                if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 4) continue;
                org.bukkit.block.Block block = lever.getBlock().getRelative(dx, dy, dz);
                if (block.getType() == Material.REDSTONE_LAMP && position(block.getLocation()).equals(lampKey)
                        && block.getBlockData() instanceof Lightable light && light.isLit()) {
                    advance(player, "tinkerer_light", null);
                    return;
                }
            }
        }, 2L);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBook(PlayerEditBookEvent event) {
        if (event.isSigning() && validBook(event.getNewBookMeta()))
            advance(event.getPlayer(), "author_story", null);
    }

    private boolean validBook(BookMeta meta) {
        if (meta.getTitle() == null || meta.getTitle().isBlank()) return false;
        String body = String.join("", meta.getPages()).replaceAll("\\s+", "");
        return body.codePointCount(0, body.length()) >= 40;
    }

    /** Mineflayer fallback: creates the same real, signed vanilla book as the client editor. */
    private void write(Player player, String[] args) {
        String joined = args.length < 3 ? "" : String.join(" ", java.util.Arrays.copyOfRange(args, 2, args.length));
        int separator = joined.indexOf('|');
        if (separator < 1) {
            player.sendMessage(ChatColor.YELLOW + "用法：/mycli life write <书名>|<至少40字的正文>"); return;
        }
        String title = joined.substring(0, separator).trim();
        String body = joined.substring(separator + 1).trim();
        if (title.isBlank() || title.length() > 32 || body.length() > 256
                || body.replaceAll("\\s+", "").codePointCount(0, body.replaceAll("\\s+", "").length()) < 40) {
            player.sendMessage(ChatColor.RED + "书名需 1–32 字，正文需 40–256 字。"); return;
        }
        if (player.getGameMode() == GameMode.SPECTATOR || player.getInventory().firstEmpty() < 0
                || !player.getInventory().containsAtLeast(new ItemStack(Material.WRITABLE_BOOK), 1)) {
            player.sendMessage(ChatColor.RED + "请准备一本书与笔，并空出一个背包格；旁观者不能写书。"); return;
        }
        ItemStack book = new ItemStack(Material.WRITTEN_BOOK);
        BookMeta meta = (BookMeta) book.getItemMeta();
        meta.setTitle(title);
        meta.setAuthor(player.getName());
        meta.setPages(body);
        book.setItemMeta(meta);
        player.getInventory().removeItem(new ItemStack(Material.WRITABLE_BOOK));
        player.getInventory().addItem(book);
        player.sendMessage(ChatColor.GREEN + "已写成游记《" + title + "》，留在你的背包里。");
        if (validBook(meta)) advance(player, "author_story", null);
    }

    void fillMenu(Player player, Inventory inventory) {
        Contract active = active(player);
        inventory.setItem(0, icon(Material.BOOK, "§6生活公会", active == null ? "当前无委托"
                : active.title() + " " + progress(player) + "/" + active.target()));
        for (int i = 0; i < CONTRACTS.size(); i++) {
            Contract contract = CONTRACTS.get(i);
            int rep = plugin.getConfig().getInt(base(player) + ".reputation." + contract.guildId());
            inventory.setItem(10 + i, icon(contract.icon(), "§e" + contract.guild(), contract.title(),
                    contract.description(), "等级：" + rank(rep) + " · 声望 " + rep,
                    completedToday(player, contract) ? "今日已完成" : "点击接单"));
        }
        inventory.setItem(18, icon(Material.EMERALD, "§a交付委托", "进度达成后点击领取"));
        inventory.setItem(19, icon(Material.BARRIER, "§c放弃委托", "进度清零"));
        inventory.setItem(21, icon(Material.WRITABLE_BOOK, "§d写一本书", "用原版书与笔写满 40 字后签署",
                "Agent 可用 /mycli life write <书名>|<正文>"));
        inventory.setItem(22, icon(Material.ARROW, "§7返回技能罗盘", "生活任务每天可各完成一次"));
    }

    void click(Player player, int slot) {
        if (slot >= 10 && slot < 10 + CONTRACTS.size()) accept(player, CONTRACTS.get(slot - 10).id());
        else if (slot == 0) status(player);
        else if (slot == 18) claim(player);
        else if (slot == 19) abandon(player);
        else if (slot == 21) player.sendMessage(ChatColor.YELLOW
                + "拿一本书与笔，在原版界面写至少 40 字并签署。Agent 可用 /mycli life write <书名>|<正文>。");
    }

    String bookPage(Player player) {
        StringBuilder page = new StringBuilder("§a生活公会§r\n\n");
        for (Contract guild : CONTRACTS) {
            int reputation = plugin.getConfig().getInt(base(player) + ".reputation." + guild.guildId());
            page.append(guild.guild().replace("公会", "")).append("：")
                    .append(rank(reputation)).append(" ").append(reputation).append("\n");
        }
        Contract current = active(player);
        page.append("\n当前：").append(current == null ? "无" : current.title() + " "
                + progress(player) + "/" + current.target());
        page.append("\n罗盘向日葵打开看板。");
        return page.toString();
    }

    private ItemStack icon(Material type, String title, String... lore) {
        ItemStack item = new ItemStack(type);
        ItemMeta meta = item.getItemMeta();
        meta.setDisplayName(title);
        meta.setLore(List.of(lore));
        item.setItemMeta(meta);
        return item;
    }

    private void receipt(Player player, String action, Contract contract, boolean success, String reason) {
        JsonObject json = new JsonObject();
        json.addProperty("schemaVersion", 1);
        json.addProperty("kind", action);
        json.addProperty("id", contract.id());
        json.addProperty("guild", contract.guild());
        json.addProperty("guildId", contract.guildId());
        json.addProperty("success", success);
        json.addProperty("reason", reason);
        json.addProperty("progress", progress(player));
        json.addProperty("target", contract.target());
        if (action.equals("claim") && success) {
            json.addProperty("emeralds", contract.emeralds());
            json.addProperty("gift", contract.gift().getKey().toString());
            json.addProperty("giftCount", contract.giftCount());
            json.addProperty("rewardLocation", "personal_trial_stash");
        }
        send(player, json);
    }

    private void send(Player player, JsonObject json) {
        byte[] data = json.toString().getBytes(StandardCharsets.UTF_8);
        if (data.length > 16_384) return;
        if (player.getListeningPluginChannels().contains(CHANNEL)) {
            player.sendPluginMessage(plugin, CHANNEL, data);
        } else {
            // Mineflayer does not register channels by default. Paper's messenger
            // silently drops those messages, so send the same bytes to this
            // connection via the normal clientbound custom-payload packet.
            CraftPlayer craft = (CraftPlayer) player;
            craft.getHandle().connection.send(new ClientboundCustomPayloadPacket(
                    new DiscardedPayload(new ResourceLocation(CHANNEL), Unpooled.wrappedBuffer(data))));
        }
    }
}
