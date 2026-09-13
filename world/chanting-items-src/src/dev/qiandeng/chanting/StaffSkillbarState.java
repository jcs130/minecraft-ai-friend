package dev.qiandeng.chanting;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.ArrayList;
import java.util.List;

/** A display cache populated only by the server payload. Never authorizes casts. */
public final class StaffSkillbarState {
    public record Slot(int slot, String id, String name, String icon, String chant) {}
    private static List<Slot> slots = empty();
    private static long receivedAt;
    private static List<Slot> empty() {
        var result = new ArrayList<Slot>();
        for (int i = 1; i <= 8; i++) result.add(new Slot(i, "", "", "minecraft:paper", ""));
        return List.copyOf(result);
    }
    public static List<Slot> parse(String json) {
        if (json.length() > 8192) throw new IllegalArgumentException("bar_too_large");
        JsonArray rows = JsonParser.parseString(json).getAsJsonArray();
        if (rows.size() != 8) throw new IllegalArgumentException("eight_slots_required");
        var result = new ArrayList<Slot>();
        for (int i = 0; i < 8; i++) {
            JsonObject row = rows.get(i).getAsJsonObject();
            if (row.get("slot").getAsInt() != i + 1) throw new IllegalArgumentException("invalid_slot");
            result.add(new Slot(i + 1, text(row, "id", 128), text(row, "name", 80),
                    text(row, "icon", 128), text(row, "chant", 160)));
        }
        return List.copyOf(result);
    }
    private static String text(JsonObject row, String key, int max) {
        var value = row.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) throw new IllegalArgumentException("invalid_bar_text");
        String text = value.getAsString();
        if (text.length() > max || text.chars().anyMatch(c -> c < 32 || c == 127 || c == 167)) throw new IllegalArgumentException("invalid_bar_text");
        return text;
    }
    public static synchronized void accept(String json) { slots = parse(json); receivedAt = System.currentTimeMillis(); }
    public static synchronized List<Slot> slots() { return slots; }
    public static synchronized long receivedAt() { return receivedAt; }
    public static synchronized void clear() { slots = empty(); receivedAt = 0; }
}
