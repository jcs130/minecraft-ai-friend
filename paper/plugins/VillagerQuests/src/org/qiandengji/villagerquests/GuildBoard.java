package org.qiandengji.villagerquests;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.qiandengji.villagerquests.core.Board;
import org.qiandengji.villagerquests.core.Commission;
import org.qiandengji.villagerquests.core.QuestType;
import org.qiandengji.villagerquests.core.Templates;

/** A read-through view of the native commission board, with actions delegated to its existing authority. */
final class GuildBoard {
    private static final int LIST_SIZE = 12;
    private static final int MENU_SIZE = 24;

    private GuildBoard() { }

    static JsonObject request(VillagerQuestsPlugin plugin, Player player, String action, String id) {
        if (!Bukkit.isPrimaryThread() || player == null || !player.isOnline() || plugin.board == null)
            return result("unavailable");
        if (!player.hasPermission("villagerquests.use")) return result("permission_denied");
        String actor = player.getUniqueId().toString();
        long now = System.currentTimeMillis();
        return switch (action) {
            case "list" -> listing(plugin, player, now, id);
            case "menu" -> {
                int requested = page(id);
                if (requested < 1) yield result("invalid_page");
                List<Board.Quest> offered = cards(plugin, player, now);
                int pages = pages(offered, MENU_SIZE);
                int current = Math.min(requested, pages);
                QuestCommand.openGuildMenu(plugin, player, slice(offered, current, MENU_SIZE), current, pages);
                yield result(offered.isEmpty() ? "empty" : "opened");
            }
            case "status" -> {
                JsonObject value = result("observed");
                JsonArray active = new JsonArray();
                plugin.board.activeFor(actor).stream().filter(q -> now < q.deadlineAt && nativeIssuer(plugin, q))
                        .forEach(q -> active.add(card(plugin, q)));
                value.add("active", active);
                yield value;
            }
            case "info", "accept" -> select(plugin, player, action, id, actor, now);
            case "deliver" -> {
                if (player.getGameMode() == GameMode.SPECTATOR) yield result("spectator");
                Board.Quest selected = plugin.board.activeFor(actor).stream()
                        .filter(q -> now < q.deadlineAt && nativeIssuer(plugin, q)
                                && q.commission.type() == QuestType.GATHER && (id == null || id.equals(q.id)))
                        .findFirst().orElse(null);
                if (selected == null) yield result("no_delivery");
                int before = selected.progress;
                String status = plugin.questCommand.deliver(player, selected.id);
                JsonObject value = result(status);
                value.add("card", card(plugin, selected));
                value.addProperty("counted", selected.progress - before);
                yield value;
            }
            default -> result("unknown_action");
        };
    }

    private static JsonObject listing(VillagerQuestsPlugin plugin, Player player, long now, String id) {
        int requested = page(id);
        if (requested < 1) return result("invalid_page");
        List<Board.Quest> all = cards(plugin, player, now);
        int pages = pages(all, LIST_SIZE);
        int current = Math.min(requested, pages);
        JsonObject value = result("observed");
        value.addProperty("page", current);
        value.addProperty("pageSize", LIST_SIZE);
        value.addProperty("pages", pages);
        value.addProperty("total", all.size());
        JsonArray entries = new JsonArray();
        slice(all, current, LIST_SIZE).forEach(q -> entries.add(card(plugin, q)));
        value.add("cards", entries);
        return value;
    }

    private static int page(String input) {
        if (input == null) return 1;
        return input.matches("[1-9][0-9]{0,3}") ? Integer.parseInt(input) : -1;
    }

    private static int pages(List<?> entries, int size) { return Math.max(1, (entries.size() + size - 1) / size); }

    private static <T> List<T> slice(List<T> entries, int page, int size) {
        int from = (page - 1) * size;
        return entries.subList(from, Math.min(from + size, entries.size()));
    }

    private static JsonObject select(VillagerQuestsPlugin plugin, Player player, String action, String id, String actor, long now) {
        if (id == null || !id.matches("vq_[a-f0-9]{16}")) return result("invalid_id");
        Board.Quest selected = plugin.board.get(id);
        if (selected == null || !nativeIssuer(plugin, selected)) return result("missing");
        boolean mine = actor.equals(selected.assignee);
        if (!mine && !posted(plugin, selected, now)) return result("offer_unavailable");
        String status = "observed";
        if (action.equals("accept")) {
            if (player.getGameMode() == GameMode.SPECTATOR) return result("spectator");
            status = mine && selected.status == Board.Status.ACCEPTED && now < selected.deadlineAt ? "already_accepted"
                    : QuestCommand.accept(plugin, player, selected.id);
        }
        JsonObject value = result(status);
        value.add("card", card(plugin, selected));
        return value;
    }

    private static List<Board.Quest> cards(VillagerQuestsPlugin plugin, Player player, long now) {
        Location observer = player.getLocation();
        return plugin.board.open().stream().filter(q -> nativeIssuer(plugin, q) && now < q.deadlineAt)
                .map(q -> new java.util.AbstractMap.SimpleImmutableEntry<>(q, plugin.villagers.location(q.commission.issuer())))
                .filter(entry -> entry.getValue() != null)
                .sorted(Comparator.comparingDouble((Map.Entry<Board.Quest, Location> entry) ->
                                entry.getValue().getWorld() == observer.getWorld()
                                        ? entry.getValue().distanceSquared(observer) : Double.POSITIVE_INFINITY)
                        .thenComparingLong(entry -> entry.getKey().deadlineAt).thenComparing(entry -> entry.getKey().id))
                .map(Map.Entry::getKey).toList();
    }

    private static boolean nativeIssuer(VillagerQuestsPlugin plugin, Board.Quest q) {
        Villagers.Spot spot = plugin.villagers.spot(q.commission.issuer());
        return spot != null && spot.entityUuid() != null;
    }

    private static boolean posted(VillagerQuestsPlugin plugin, Board.Quest q, long now) {
        return q.status == Board.Status.OPEN && now < q.deadlineAt && plugin.villagers.location(q.commission.issuer()) != null;
    }

    private static JsonObject card(VillagerQuestsPlugin plugin, Board.Quest q) {
        Commission c = q.commission;
        JsonObject value = new JsonObject();
        value.addProperty("id", q.id);
        value.addProperty("title", c.title());
        value.addProperty("story", c.story());
        value.addProperty("issuer", plugin.name(c.issuer()));
        value.addProperty("type", c.type().wire());
        value.addProperty("target", c.target());
        value.addProperty("objective", Templates.ask(c));
        value.addProperty("quantity", c.quantity());
        value.addProperty("progress", q.progress);
        value.addProperty("deadlineAt", q.deadlineAt);
        value.addProperty("status", q.status.name().toLowerCase(java.util.Locale.ROOT));
        if (c.area() != null) value.add("workArea", c.area().toWire());
        Location at = plugin.villagers.location(c.issuer());
        if (at != null) {
            JsonObject point = new JsonObject();
            point.addProperty("world", at.getWorld().getKey().toString());
            point.addProperty("x", at.getBlockX());
            point.addProperty("y", at.getBlockY());
            point.addProperty("z", at.getBlockZ());
            value.add("location", point);
        }
        return value;
    }

    private static JsonObject result(String status) {
        JsonObject value = new JsonObject();
        value.addProperty("schemaVersion", 1);
        value.addProperty("status", status);
        value.addProperty("observedAt", System.currentTimeMillis());
        return value;
    }
}
