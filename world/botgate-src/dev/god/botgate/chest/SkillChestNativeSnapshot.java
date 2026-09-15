package dev.god.botgate.chest;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.LinkedHashMap;

/** Pure validation of the optional Iron bridge's actor-scoped, read-only list. */
public final class SkillChestNativeSnapshot {
    public static boolean apply(SkillChestLayout.Config cfg, Object response, String actorUuid, String actorName) {
        cfg.nativeAvailable = false; cfg.nativeSpells.clear(); cfg.nativeSummary = "原生法术状态暂不可读取，请刷新";
        try {
            if (!(response instanceof JsonObject root) || root.toString().length() > 262144
                    || integer(root, "schema", 1, 1) != 1 || !bool(root, "ok")
                    || !text(root, "engine", 40).equals("irons_spellbooks") || !text(root, "action", 20).equals("list")
                    || !text(root, "actorUuid", 36).equals(actorUuid) || !text(root, "actor", 16).equals(actorName)
                    || !root.has("spells") || !root.get("spells").isJsonArray()) return false;
            var rows = root.getAsJsonArray("spells");
            int total = integer(root, "total", 0, 100000);
            if (rows.size() > 256 || total < rows.size() || bool(root, "truncated") != (total > rows.size())) return false;
            var spells = new LinkedHashMap<String, SkillChestLayout.NativeSpell>();
            for (JsonElement value : rows) {
                if (!value.isJsonObject()) return false;
                JsonObject row = value.getAsJsonObject();
                String id = text(row, "id", 128), school = text(row, "school", 128), nameKey = text(row, "nameKey", 160);
                if (!SkillChestLayout.validNativeId(id) || !SkillChestLayout.validNativeId(school)
                        || !nameKey.matches("[A-Za-z0-9_.:-]{1,160}")) return false;
                boolean ready = bool(row, "ready");
                String reason = ready ? "" : text(row, "reasonKey", 160);
                var spell = new SkillChestLayout.NativeSpell(id, text(row, "name", 160), nameKey, school,
                        integer(row, "level", 1, 100000), number(row, "mana", 0, 1e12),
                        (long) number(row, "cooldownMs", 0, 1e12), text(row, "source", 80), text(row, "sourceSlot", 100), ready, reason);
                // Match the native ID-only casting order, not the highest level or lowest cooldown.
                spells.putIfAbsent(id, spell);
            }
            double mana = number(root, "mana", 0, 1e12), maxMana = number(root, "maxMana", 0, 1e12);
            cfg.nativeSpells.putAll(spells); cfg.nativeAvailable = true;
            cfg.nativeSummary = "原生法力：" + mana + "/" + maxMana + " · 已装备 " + spells.size() + " 种法术"
                    + (total > rows.size() ? "\n原生列表已截断，请精简装备后刷新" : "");
            return true;
        } catch (RuntimeException ignored) { return false; }
    }
    private static String text(JsonObject object, String key, int max) {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) throw new IllegalArgumentException();
        String text = value.getAsString();
        if (text.isEmpty() || text.length() > max || text.chars().anyMatch(c -> c < 32 || c == 127 || c == '§')) throw new IllegalArgumentException();
        return text;
    }
    private static boolean bool(JsonObject object, String key) {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isBoolean()) throw new IllegalArgumentException();
        return value.getAsBoolean();
    }
    private static double number(JsonObject object, String key, double min, double max) {
        JsonElement value = object.get(key);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) throw new IllegalArgumentException();
        double number = value.getAsDouble();
        if (!Double.isFinite(number) || number < min || number > max) throw new IllegalArgumentException();
        return number;
    }
    private static int integer(JsonObject object, String key, int min, int max) {
        double number = number(object, key, min, max);
        if (number != Math.floor(number)) throw new IllegalArgumentException();
        return (int)number;
    }
    private SkillChestNativeSnapshot() {}
}
