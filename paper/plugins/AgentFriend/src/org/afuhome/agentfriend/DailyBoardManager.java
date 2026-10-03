package org.afuhome.agentfriend;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import io.netty.buffer.Unpooled;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;
import net.minecraft.network.protocol.common.custom.DiscardedPayload;
import net.minecraft.resources.ResourceLocation;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.bukkit.Statistic;
import org.bukkit.World;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.craftbukkit.entity.CraftPlayer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.CraftItemEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/** YAML-backed daily overlay for the unchanged adventurer guild contracts. All mutation is on the server thread. */
final class DailyBoardManager implements Listener {
    static final String CHANNEL = "mcagent:board";
    private static final String ROOT = "dynamic-board";
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    private static final Map<String, Integer> CHESTS = Map.of("weapons", 0, "armor", 1,
            "supplies", 2, "misc", 3);
    private static final Set<String> SOURCES = Set.of("always", "shared_stock", "rainy",
            "calendar", "village_alert");
    private static final Set<String> GOALS = Set.of("donate", "craft", "fish", "lanterns",
            "floor", "party_floor", "kills", "claims");

    record Card(String id, String templateId, String signature, String date, String title,
            String description, String beneficiary, Material icon, String goal, Material item,
            int target, int floor, int fame, int emeralds, Material bonus, int bonusCount,
            int chest) {
        GuildManager.Contract contract() {
            GuildManager.Goal kind = GuildManager.Goal.valueOf(goal.toUpperCase(Locale.ROOT));
            int dim = switch (kind) {
                case DONATE, LANTERNS, CRAFT, FISH -> 2;
                case PARTY_FLOOR -> 3;
                default -> 1;
            };
            return new GuildManager.Contract(id, title, description, icon, kind, target, floor, 0,
                    fame, emeralds, bonus, bonusCount, item == null ? null : item.name(), dim);
        }
        Map<String, Object> save() {
            Map<String, Object> value = new HashMap<>();
            value.put("id", id); value.put("template", templateId); value.put("signature", signature);
            value.put("date", date); value.put("title", title); value.put("description", description);
            value.put("beneficiary", beneficiary); value.put("icon", icon.name());
            value.put("goal", goal); value.put("item", item == null ? "" : item.name());
            value.put("target", target); value.put("floor", floor); value.put("fame", fame);
            value.put("emeralds", emeralds); value.put("bonus", bonus.name());
            value.put("bonus-count", bonusCount); value.put("chest", chest);
            return value;
        }
    }

    private record Template(String id, String source, String goal, Material item, Material icon,
            String title, String description, String beneficiary, int target, int floor,
            int triggerBelow, int maxRequest, int chest, int priority, int fame, int emeralds,
            Material bonus, int bonusCount, List<Integer> months) { }

    private final AgentFriendPlugin plugin;
    private final File file;
    private Map<String, Template> templates = Map.of();
    private List<Card> cards = List.of();
    private String date = "";
    private int revision;
    private int cardsPerDay = 4;

    DailyBoardManager(AgentFriendPlugin plugin) {
        this.plugin = plugin;
        file = new File(plugin.getDataFolder(), "dynamic-board.yml");
        if (!file.exists()) plugin.saveResource("dynamic-board.yml", false);
        if (!reloadTemplates()) plugin.getLogger().severe("Dynamic board templates invalid; board disabled until reload");
        restore();
        ensureDay();
        Bukkit.getPluginManager().registerEvents(this, plugin);
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
        Bukkit.getScheduler().runTaskTimer(plugin, this::ensureDay, 20L, 20L);
    }

    String boardDate() { return ZonedDateTime.now(ZONE).minusHours(5).toLocalDate().toString(); }
    List<Card> cards() { ensureDay(); return cards; }
    Card card(String id) {
        ensureDay();
        for (Card card : cards) if (card.id().equals(id)) return card;
        return null;
    }
    int revision() { return revision; }

    private boolean reloadTemplates() {
        YamlConfiguration yaml = YamlConfiguration.loadConfiguration(file);
        ConfigurationSection section = yaml.getConfigurationSection("templates");
        if (yaml.getInt("schema-version") != 1 || section == null) return false;
        int count = yaml.getInt("cards-per-day", 4);
        if (count < 3 || count > 5) return false;
        Map<String, Template> parsed = new HashMap<>();
        try {
            for (String id : section.getKeys(false)) {
                ConfigurationSection data = section.getConfigurationSection(id);
                if (!id.matches("[a-z0-9_]{2,40}") || data == null) throw new IllegalArgumentException(id);
                String source = data.getString("source", "").toLowerCase(Locale.ROOT);
                String goal = data.getString("goal", "").toLowerCase(Locale.ROOT);
                if (!SOURCES.contains(source) || !GOALS.contains(goal)) throw new IllegalArgumentException(id + " source/goal");
                String itemName = data.getString("item", "");
                Material item = itemName.equalsIgnoreCase("ANY_FISH") ? null : material(itemName);
                if ((goal.equals("donate") || goal.equals("craft")) && item == null)
                    throw new IllegalArgumentException(id + " needs item");
                if (goal.equals("fish") && !itemName.isBlank() && !itemName.equalsIgnoreCase("ANY_FISH")
                        && item == null) throw new IllegalArgumentException(id + " fish item");
                if (goal.equals("fish") && item != null && !Set.of(Material.COD, Material.SALMON,
                        Material.TROPICAL_FISH, Material.PUFFERFISH).contains(item))
                    throw new IllegalArgumentException(id + " fish item");
                if (source.equals("shared_stock") && !goal.equals("donate"))
                    throw new IllegalArgumentException(id + " shared_stock needs donate");
                int chest = source.equals("shared_stock")
                        ? CHESTS.getOrDefault(data.getString("chest", ""), -1) : -1;
                if (source.equals("shared_stock") && chest < 0) throw new IllegalArgumentException(id + " chest");
                int target = data.getInt("target", 0), below = data.getInt("trigger-below", 0);
                int request = data.getInt("max-request", 0), floor = data.getInt("floor", 0);
                if (source.equals("shared_stock") ? below < 1 || below > 4096 || request < 1 || request > 64
                        : target < 1 || target > 64) throw new IllegalArgumentException(id + " target");
                if ((goal.equals("floor") || goal.equals("party_floor")) && (floor < 1 || floor > 15))
                    throw new IllegalArgumentException(id + " floor");
                String title = data.getString("title", "");
                String description = data.getString("description", "");
                if (title.isBlank() || title.length() > 64 || description.isBlank() || description.length() > 180)
                    throw new IllegalArgumentException(id + " text");
                ConfigurationSection reward = data.getConfigurationSection("reward");
                if (reward == null) throw new IllegalArgumentException(id + " reward");
                int fame = reward.getInt("fame"), emeralds = reward.getInt("emeralds");
                int bonusCount = reward.getInt("bonus-count");
                Material bonus = material(reward.getString("bonus", ""));
                Material icon = material(data.getString("icon", ""));
                if (fame < 1 || fame > 50 || emeralds < 1 || emeralds > 32 || bonusCount < 1
                        || bonusCount > 64 || bonus == null || icon == null)
                    throw new IllegalArgumentException(id + " reward/icon");
                List<Integer> months = data.getIntegerList("months");
                if (source.equals("calendar") && (months.isEmpty() || months.stream().anyMatch(m -> m < 1 || m > 12)))
                    throw new IllegalArgumentException(id + " months");
                parsed.put(id, new Template(id, source, goal, item, icon, title, description,
                        data.getString("beneficiary", "公会伙伴"), target, floor, below, request,
                        chest, data.getInt("priority", 0), fame, emeralds, bonus, bonusCount, months));
            }
            if (parsed.size() < 6) throw new IllegalArgumentException("too few templates");
        } catch (IllegalArgumentException error) {
            plugin.getLogger().warning("Dynamic board YAML rejected: " + error.getMessage());
            return false;
        }
        templates = Map.copyOf(parsed);
        cardsPerDay = count;
        plugin.getLogger().info("Dynamic board loaded " + templates.size() + " templates");
        return true;
    }

    private Material material(String name) {
        Material value = Material.matchMaterial(name == null ? "" : name);
        return value != null && value.isItem() && !value.isAir() ? value : null;
    }

    private void restore() {
        date = plugin.getConfig().getString(ROOT + ".today.date", "");
        revision = plugin.getConfig().getInt(ROOT + ".today.revision", 0);
        List<Card> found = new ArrayList<>();
        try {
            for (Map<?, ?> row : plugin.getConfig().getMapList(ROOT + ".today.cards")) {
                found.add(savedCard(row));
            }
            cards = List.copyOf(found);
        } catch (RuntimeException error) {
            plugin.getLogger().warning("Dynamic board saved cards invalid; will regenerate");
            date = "";
            cards = List.of();
        }
    }

    Card savedCard(Map<?, ?> row) {
        String goal = String.valueOf(row.get("goal"));
        if (!GOALS.contains(goal)) throw new IllegalArgumentException("goal");
        String itemName = String.valueOf(row.get("item"));
        Card card = new Card(String.valueOf(row.get("id")), String.valueOf(row.get("template")),
                String.valueOf(row.get("signature")), String.valueOf(row.get("date")),
                String.valueOf(row.get("title")), String.valueOf(row.get("description")),
                String.valueOf(row.get("beneficiary")), material(String.valueOf(row.get("icon"))),
                goal, itemName.isEmpty() ? null : material(itemName), integer(row.get("target")),
                integer(row.get("floor")), integer(row.get("fame")), integer(row.get("emeralds")),
                material(String.valueOf(row.get("bonus"))), integer(row.get("bonus-count")),
                integer(row.get("chest")));
        if (card.icon() == null || card.bonus() == null || card.target() < 1 || card.target() > 64
                || card.fame() < 1 || card.emeralds() < 1 || card.bonusCount() < 1 || card.bonusCount() > 64)
            throw new IllegalArgumentException("bad card");
        return card;
    }

    private int integer(Object value) { return value instanceof Number number ? number.intValue() : Integer.parseInt(String.valueOf(value)); }

    private void ensureDay() {
        String day = boardDate();
        if (day.equals(date) || templates.isEmpty()) return;
        Set<String> excluded = new HashSet<>(plugin.getConfig().getStringList(ROOT + ".previous.signatures"));
        if (!date.isEmpty()) for (Card card : cards) excluded.add(card.signature());
        List<Card> generated = generate(day, excluded);
        if (generated.size() < 3) {
            plugin.getLogger().warning("Dynamic board could not generate three cards for " + day);
            return;
        }
        if (!date.isEmpty()) plugin.getConfig().set(ROOT + ".previous.signatures",
                cards.stream().map(Card::signature).toList());
        persist(day, generated);
    }

    private List<Card> generate(String day, Set<String> excluded) {
        List<Template> eligible = new ArrayList<>();
        for (Template template : templates.values()) {
            String signature = signature(template);
            if (!excluded.contains(signature) && enabled(template, day)) eligible.add(template);
        }
        Collections.shuffle(eligible, new java.util.Random(day.hashCode() + revision));
        eligible.sort(Comparator.comparingInt(Template::priority).reversed());
        List<Card> result = new ArrayList<>();
        for (Template template : eligible) {
            Card card = resolve(template, day);
            if (card != null) result.add(card);
            if (result.size() >= cardsPerDay) break;
        }
        return result;
    }

    private String signature(Template template) {
        return template.id() + ":" + (template.item() == null ? "-" : template.item().name());
    }

    private boolean enabled(Template template, String day) {
        return switch (template.source()) {
            case "always" -> true;
            case "shared_stock" -> {
                Inventory chest = plugin.guildHall().sharedInventory(template.chest());
                yield chest != null && stock(chest, template.item()) < template.triggerBelow();
            }
            case "rainy" -> {
                World world = Bukkit.getWorld("world");
                yield world != null && world.hasStorm();
            }
            case "calendar" -> template.months().contains(LocalDate.parse(day).getMonthValue());
            case "village_alert" -> plugin.villageWatch().activeThreat();
            default -> false;
        };
    }

    private int stock(Inventory inventory, Material item) {
        int total = 0;
        ItemStack plain = new ItemStack(item);
        for (ItemStack stack : inventory.getContents()) if (stack != null && stack.isSimilar(plain)) total += stack.getAmount();
        return total;
    }

    private Card resolve(Template template, String day) {
        int count = template.target(), stock = 0;
        if (template.chest() >= 0) {
            Inventory chest = plugin.guildHall().sharedInventory(template.chest());
            if (chest == null) return null;
            stock = stock(chest, template.item());
            count = Math.min(template.maxRequest(), Math.max(1, template.triggerBelow() - stock));
        }
        String itemText = template.item() == null ? "" : template.item().name().toLowerCase(Locale.ROOT);
        String title = expand(template.title(), itemText, count, stock, template.beneficiary());
        String description = expand(template.description(), itemText, count, stock, template.beneficiary());
        String id = "db_" + day.replace("-", "") + "_" + template.id();
        return new Card(id, template.id(), signature(template), day, title, description,
                template.beneficiary(), template.icon(), template.goal(), template.item(), count,
                template.floor(), Math.max(1, Math.round(template.fame() * 1.2f)),
                template.emeralds(), template.bonus(), template.bonusCount(), template.chest());
    }

    private String expand(String text, String item, int count, int stock, String beneficiary) {
        return text.replace("{item}", item).replace("{count}", Integer.toString(count))
                .replace("{stock}", Integer.toString(stock)).replace("{beneficiary}", beneficiary);
    }

    private void persist(String day, List<Card> next) {
        date = day;
        cards = List.copyOf(next);
        revision++;
        plugin.getConfig().set(ROOT + ".today.date", date);
        plugin.getConfig().set(ROOT + ".today.generated-at", ZonedDateTime.now(ZONE).toString());
        plugin.getConfig().set(ROOT + ".today.revision", revision);
        plugin.getConfig().set(ROOT + ".today.cards", cards.stream().map(Card::save).toList());
        plugin.saveConfig();
        plugin.getLogger().info("Dynamic board " + day + " revision=" + revision + " cards="
                + cards.stream().map(Card::id).toList());
        for (Player player : Bukkit.getOnlinePlayers()) sendFor(player);
    }

    void command(CommandSender sender, String[] args) {
        if (args.length < 3) { usage(sender); return; }
        ensureDay();
        String action = args[2].toLowerCase(Locale.ROOT);
        if (action.equals("list")) {
            sender.sendMessage("今日 " + date + " revision=" + revision + " cards=" + cards.size());
            for (int i = 0; i < cards.size(); i++) sender.sendMessage((i + 1) + " " + cards.get(i).id()
                    + " " + cards.get(i).title() + " x" + cards.get(i).target());
            return;
        }
        if (action.equals("reload")) {
            sender.sendMessage(reloadTemplates() ? "模板已热加载；当日卡片保持不变，可执行 regenerate。" : "模板校验失败，仍使用上次有效配置。");
            return;
        }
        if (action.equals("regenerate")) {
            Set<String> excluded = new HashSet<>(plugin.getConfig().getStringList(ROOT + ".previous.signatures"));
            for (Card card : cards) excluded.add(card.signature());
            List<Card> next = generate(boardDate(), excluded);
            if (next.size() < 3) { sender.sendMessage("可用且不重复的模板不足 3 张；保留当前看板。"); return; }
            persist(boardDate(), next);
            sender.sendMessage("今日看板已重新生成 " + next.size() + " 张。");
            return;
        }
        if (action.equals("clear")) {
            persist(boardDate(), List.of());
            sender.sendMessage("已清空今日动态卡片；静态委托仍可用，明日 05:00 恢复自动生成。");
            return;
        }
        if (action.equals("remove") && args.length == 4) {
            int index = index(args[3]);
            if (index < 0 || index >= cards.size()) { usage(sender); return; }
            List<Card> next = new ArrayList<>(cards); next.remove(index);
            persist(boardDate(), next); sender.sendMessage("已移除第 " + (index + 1) + " 张。"); return;
        }
        if ((action.equals("add") && args.length == 4) || (action.equals("replace") && args.length == 5)) {
            int index = action.equals("replace") ? index(args[3]) : cards.size();
            String templateId = args[action.equals("replace") ? 4 : 3];
            Template template = templates.get(templateId);
            if (template == null || index < 0 || index > cards.size()
                    || action.equals("replace") && index == cards.size()
                    || action.equals("add") && cards.size() >= 5) { usage(sender); return; }
            Card card = resolve(template, boardDate());
            if (card == null) { sender.sendMessage("目标公共箱不可用；不能发布这张供货卡。"); return; }
            List<Card> next = new ArrayList<>(cards);
            if (next.stream().anyMatch(c -> c.id().equals(card.id()) && (action.equals("add") || !c.equals(next.get(index))))) {
                sender.sendMessage("这张模板已在今日看板中。"); return;
            }
            if (action.equals("add")) next.add(card); else next.set(index, card);
            persist(boardDate(), next); sender.sendMessage("今日看板已更新：" + card.id()); return;
        }
        usage(sender);
    }

    private int index(String text) {
        try { return Integer.parseInt(text) - 1; } catch (NumberFormatException error) { return -1; }
    }
    private void usage(CommandSender sender) {
        sender.sendMessage("用法：/mycli admin board list|reload|regenerate|clear|add <模板ID>|replace <序号> <模板ID>|remove <序号>");
    }

    void sendFor(Player player) {
        if (player.getGameMode() == GameMode.SPECTATOR || !plugin.isRegisteredAgent(player)) return;
        JsonObject full = new JsonObject();
        full.addProperty("schemaVersion", 1);
        full.addProperty("type", "MC_BOARD_TODAY");
        full.addProperty("date", date);
        full.addProperty("revision", revision);
        JsonArray array = new JsonArray();
        for (Card card : cards) {
            JsonObject data = new JsonObject();
            data.addProperty("id", card.id()); data.addProperty("title", card.title());
            data.addProperty("description", card.description()); data.addProperty("goal", card.goal());
            data.addProperty("item", card.item() == null ? "" : card.item().name());
            data.addProperty("target", card.target()); data.addProperty("floor", card.floor());
            data.addProperty("fame", card.fame()); data.addProperty("emeralds", card.emeralds());
            data.addProperty("beneficiary", card.beneficiary());
            array.add(data);
        }
        full.add("cards", array);
        byte[] bytes = full.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length <= 16_384) {
            if (player.getListeningPluginChannels().contains(CHANNEL)) player.sendPluginMessage(plugin, CHANNEL, bytes);
            else ((CraftPlayer) player).getHandle().connection.send(new ClientboundCustomPayloadPacket(
                    new DiscardedPayload(new ResourceLocation(CHANNEL), Unpooled.wrappedBuffer(bytes))));
        }
        JsonObject shortJson = new JsonObject();
        shortJson.addProperty("type", "MC_BOARD_TODAY");
        shortJson.addProperty("schemaVersion", 1);
        shortJson.addProperty("date", date);
        shortJson.addProperty("revision", revision);
        shortJson.addProperty("count", cards.size());
        shortJson.addProperty("command", "/mycli guild board");
        String notice = shortJson.toString();
        if (notice.length() <= 256) player.sendMessage(notice);
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (event.getPlayer().isOnline()) sendFor(event.getPlayer());
        }, 40L);
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onCraft(CraftItemEvent event) {
        if (!(event.getWhoClicked() instanceof Player player) || event.getCurrentItem() == null
                || event.getCurrentItem().getType() != Material.IRON_PICKAXE) return;
        String marker = ROOT + ".milestones." + player.getUniqueId() + ".iron-pickaxe";
        if (plugin.getConfig().getBoolean(marker, false)) return;
        // Existing players' historic crafting statistics must not be announced as a first.
        boolean first = player.getStatistic(Statistic.CRAFT_ITEM, Material.IRON_PICKAXE) <= 1;
        plugin.getConfig().set(marker, true);
        plugin.saveConfig();
        if (first) announce(player, "第一次做出了铁镐");
    }

    void onFloorCleared(Player player, int floor) {
        if (floor != 10 || plugin.getConfig().getInt("dungeon-boss-clears." + player.getUniqueId()) != 1) return;
        announce(player, "第一次通过了试炼首领关");
    }

    private void announce(Player player, String text) {
        if (player.getGameMode() == GameMode.SPECTATOR) return;
        String key = ROOT + ".milestones." + player.getUniqueId() + ".announced";
        if (boardDate().equals(plugin.getConfig().getString(key, ""))) return;
        plugin.getConfig().set(key, boardDate());
        plugin.saveConfig();
        Bukkit.broadcastMessage("§6✦ 今日村报：" + player.getName() + text + "！大家为这一步鼓掌。");
    }
}
