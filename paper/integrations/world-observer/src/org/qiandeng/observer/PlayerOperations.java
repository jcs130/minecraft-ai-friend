package org.qiandeng.observer;

import java.util.ArrayDeque;
import java.util.List;
import java.util.Locale;
import java.util.StringTokenizer;

/** Public summaries contain only a known operation code and its time. */
final class PlayerOperations {
    private static final int LIMIT = 12;
    private static final long RETENTION_MS = 30_000;
    record Entry(String kind, long at) {}

    private final ArrayDeque<Entry> entries = new ArrayDeque<>();

    void record(String kind, long now) {
        var last = entries.peekLast();
        if (last != null && last.kind().equals(kind) && now - last.at() < 750) return;
        if (entries.size() == LIMIT) entries.removeFirst();
        entries.addLast(new Entry(kind, now));
    }

    List<Entry> recent(long now) {
        while (!entries.isEmpty() && now - entries.peekFirst().at() >= RETENTION_MS) entries.removeFirst();
        return List.copyOf(entries);
    }

    static String command(String input) {
        var words = new StringTokenizer(input);
        return switch (word(words)) {
            case "/mycli", "/agentfriend:mycli" -> switch (word(words)) {
                case "inventory" -> "inventory_query";
                case "arena", "guild" -> switch (word(words)) {
                    case "stash" -> switch (word(words)) {
                        case "inventory" -> "inventory_query";
                        case "list" -> "stash_query";
                        case "put", "putslot" -> "stash_deposit_request";
                        case "take" -> "stash_withdraw_request";
                        default -> "stash_request";
                    };
                    case "party" -> "party_request";
                    case "rewards" -> "reward_request";
                    default -> "activity_request";
                };
                case "dungeon", "pvp", "progress", "commission", "tasks", "quest" -> "activity_request";
                case "goto", "waypoint" -> "travel_request";
                case "cast", "skills", "profession" -> "skill_request";
                case "trade" -> "trade_request";
                case "photo" -> "photo_request";
                case "help", "status" -> "guide_query";
                default -> null;
            };
            case "/backpack", "/minepacks:backpack" -> "inventory_query";
            default -> null;
        };
    }

    private static String word(StringTokenizer words) {
        return words.hasMoreTokens() ? words.nextToken().toLowerCase(Locale.ROOT) : "";
    }
}
