package dev.god.botgate.chest;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/** Read-only runtime snapshots. Catalog controls presentation; it never rewrites learned progress. */
public final class SkillChestIO {
    public static final class PanelData {
        public final SkillChestLayout.Config config;
        public final List<SkillChestLayout.SkillInfo> skills, archivedSkills;
        public final List<SkillChestLayout.WaypointInfo> waypoints;
        /** Original slot positions from the existing lowercase skillbar field; never persisted here. */
        public final List<String> skillbar;
        public final boolean skillbarAvailable;
        public final Integer mana, maxMana;
        PanelData(SkillChestLayout.Config config, List<SkillChestLayout.SkillInfo> skills,
                  List<SkillChestLayout.SkillInfo> archivedSkills, List<SkillChestLayout.WaypointInfo> waypoints,
                  Integer mana, Integer maxMana, List<String> skillbar, boolean skillbarAvailable) {
            this.config = config; this.skills = skills; this.archivedSkills = archivedSkills;
            this.waypoints = waypoints; this.mana = mana; this.maxMana = maxMana;
            this.skillbar = List.copyOf(skillbar); this.skillbarAvailable = skillbarAvailable;
        }
    }

    public static PanelData load(Path state, Path atoms, Path waypoints, Path panel, String player) {
        return load(state, atoms, waypoints, panel, panel.resolveSibling("skill-catalog.json"), player);
    }
    public static PanelData load(Path statePath, Path atomsPath, Path waypointPath, Path panelPath, Path catalogPath, String player) {
        SkillChestLayout.Config cfg = loadConfig(panelPath);
        loadCatalog(cfg, catalogPath);
        Map<String, JsonObject> atoms = new HashMap<>();
        JsonArray definitions = arr(readJson(atomsPath), "atoms");
        if (definitions != null) for (JsonElement el : definitions) {
            if (!el.isJsonObject()) continue;
            JsonObject atom = el.getAsJsonObject(); String id = strOf(atom, "id", null);
            if (SkillChestLayout.validSkillId(id)) atoms.putIfAbsent(id, atom);
        }
        JsonObject me = obj(obj(readJson(statePath), "players"), player);
        Integer mana = nullableInt(me, "mana"), maxMana = nullableInt(me, "maxMana");
        if (me != null) cfg.stateSummary = "秘术魔力：" + (mana == null ? "—" : mana) + "/" + (maxMana == null ? "—" : maxMana)
                + "（同步快照）\n等级：" + strOf(me, "level", "—");
        LinkedHashSet<String> learned = new LinkedHashSet<>();
        JsonArray learnedArray = arr(me, "learned");
        if (learnedArray != null) for (JsonElement el : learnedArray) {
            String id = primitiveString(el, null);
            if (SkillChestLayout.validSkillId(id)) learned.add(id);
        }
        String innate = strOf(me, "innateSkill", null);
        if (SkillChestLayout.validSkillId(innate)) learned.add(innate);
        for (String id : learned) {
            JsonObject atom = atoms.get(id);
            cfg.skillNames.put(id, clean(strOf(atom, "name", id), 80));
            String icon = strOf(atom, "icon", null);
            if (SkillChestLayout.validItemId(icon)) cfg.skillIcons.putIfAbsent(id, icon);
            JsonObject cost = obj(atom, "cost");
            String manaCost = number(cost, "mana");
            String lore = manaCost.startsWith("-") ? "恢复：" + manaCost.substring(1) + " 秘术魔力" : "基础消耗：" + manaCost + " 秘术魔力";
            if (positive(cost, "hp")) lore += " / " + number(cost, "hp") + " 生命";
            if (positive(cost, "food")) lore += " / " + number(cost, "food") + " 饥饿";
            JsonObject parameters = obj(atom, "params");
            if (parameters != null && !parameters.isEmpty()) {
                List<String> defaults = new ArrayList<>();
                for (var parameter : parameters.entrySet()) {
                    String value = strOf(parameter.getValue().isJsonObject() ? parameter.getValue().getAsJsonObject() : null, "default", null);
                    if (value == null) continue;
                    String label = switch (parameter.getKey()) {
                        case "distance" -> "距离"; case "direction" -> "方向"; case "count" -> "数量";
                        case "duration" -> "时长"; case "item" -> "物品"; default -> parameter.getKey();
                    };
                    defaults.add(clean(label + " " + value, 70));
                }
                if (!defaults.isEmpty()) lore += "\n默认：" + String.join(" / ", defaults);
            }
            if (obj(atom, "paramCosts") != null) lore += "\n参数消耗另计，确认时由服务器结算";
            lore += id.equals(innate) ? "\n已掌握 · 出生天赋免等级门槛" : "\n需要等级：" + strOf(atom, "requiredLevel", "1") + "\n已学主动秘术";
            cfg.skillLore.put(id, atom == null ? "旧定义暂不可读取，进度记录保留" : lore);
        }
        List<SkillChestLayout.SkillInfo> skills = new ArrayList<>(), archived = new ArrayList<>();
        // Never turn a missing catalog into the old 72-skill menu.
        if (cfg.catalogAvailable) for (String id : cfg.featured) {
            JsonObject atom = atoms.get(id);
            if (learned.contains(id) && atom != null && !"passive".equals(strOf(atom, "type", "active")) && !cfg.archived.containsKey(id))
                skills.add(new SkillChestLayout.SkillInfo(id));
        }
        for (String id : learned) {
            if ("passive".equals(strOf(atoms.get(id), "type", "active"))) continue;
            if (!cfg.catalogAvailable || !cfg.featured.contains(id) || cfg.archived.containsKey(id) || !atoms.containsKey(id))
                archived.add(new SkillChestLayout.SkillInfo(id));
        }
        JsonArray storedBar = arr(me, "skillbar");
        List<String> skillbar = new ArrayList<>();
        for (int slot = 0; slot < SkillChestLayout.SKILLBAR_SLOTS; slot++) {
            String id = storedBar != null && slot < storedBar.size() ? primitiveString(storedBar.get(slot), null) : "";
            // Keep holes and disabled old IDs visible. Malformed values are labels only, never commands.
            skillbar.add(id != null && (id.isEmpty() || SkillChestLayout.validSkillId(id)) ? id : "（记录异常）");
        }
        return new PanelData(cfg, skills, archived, loadWaypoints(waypointPath, player), mana, maxMana,
                skillbar, storedBar != null && !storedBar.isEmpty());
    }

    public static List<SkillChestLayout.WaypointInfo> loadWaypoints(Path waypointPath, String player) {
        List<SkillChestLayout.WaypointInfo> points = new ArrayList<>();
        JsonObject waypointRoot = readJson(waypointPath);
        appendWaypoints(points, arr(waypointRoot, "shared"), true);
        appendWaypoints(points, arr(obj(waypointRoot, "players"), player), false);
        Map<String, Integer> counts = new HashMap<>();
        for (var point : points) if (point.reference != null) counts.merge(point.reference, 1, Integer::sum);
        for (int i = 0; i < points.size(); i++) {
            var point = points.get(i);
            if (point.reference != null && counts.get(point.reference) > 1)
                points.set(i, new SkillChestLayout.WaypointInfo(point.index, point.name, null, point.lore + "\n标识重复，请修复地点记录", point.shared));
        }
        return points;
    }

    private static void appendWaypoints(List<SkillChestLayout.WaypointInfo> out, JsonArray entries, boolean shared) {
        if (entries == null) return;
        for (JsonElement el : entries) {
            if (!el.isJsonObject()) continue;
            JsonObject wp = el.getAsJsonObject(); String ref = null;
            try {
                JsonElement id = wp.get("id");
                double value = id.getAsDouble();
                if (id.isJsonPrimitive() && id.getAsJsonPrimitive().isNumber() && Double.isFinite(value)
                        && value >= 0 && value <= 9_007_199_254_740_991d && value == Math.floor(value))
                    ref = (shared ? "shared:" : "personal:") + id.getAsLong();
            } catch (Exception ignored) { }
            String lore = clean(strOf(wp, "dim", "维度未登记"), 96) + "\n坐标：" + coordinate(wp, "x") + ", " + coordinate(wp, "y") + ", " + coordinate(wp, "z");
            out.add(new SkillChestLayout.WaypointInfo(out.size() + 1, clean(strOf(wp, "name", "未命名地点"), 80), ref, lore, shared));
        }
    }
    private static String coordinate(JsonObject o, String key) {
        try { double value = o.get(key).getAsDouble(); return Double.isFinite(value) ? String.valueOf((long)Math.floor(value)) : "?"; }
        catch (Exception e) { return "?"; }
    }
    public static SkillChestLayout.Config loadConfig(Path path) {
        SkillChestLayout.Config cfg = new SkillChestLayout.Config();
        JsonObject root = readJson(path), icons = obj(root, "icons");
        cfg.defaultIcon = icon(icons, "default", cfg.defaultIcon); cfg.closeIcon = icon(icons, "close", cfg.closeIcon);
        // Navigation keeps arrows even when an old skin used identical paper icons.
        cfg.waypointIcon = icon(icons, "waypoint", cfg.waypointIcon);
        copyIcons(cfg, obj(icons, "skill"));
        JsonArray items = arr(root, "items");
        if (items != null) for (JsonElement el : items) {
            if (!el.isJsonObject()) continue;
            JsonObject item = el.getAsJsonObject(); String cn = strOf(item, "cn", null), id = strOf(item, "icon", null);
            if (cn != null && id != null) cfg.giveItems.add(new SkillChestLayout.GiveItem(cn, id, Math.max(1, intOf(item, "count", 1))));
        }
        cfg.debounceMs = Math.max(200, Math.min(3000, intOf(root, "debounceMs", 800)));
        return cfg;
    }
    private static void loadCatalog(SkillChestLayout.Config cfg, Path path) {
        JsonObject root = readJson(path); JsonArray featured = arr(root, "featured");
        if (featured == null) return;
        cfg.catalogAvailable = true;
        for (JsonElement el : featured) {
            String id = primitiveString(el, null);
            if (SkillChestLayout.validSkillId(id) && !cfg.featured.contains(id)) cfg.featured.add(id);
        }
        copyIcons(cfg, obj(root, "icons"));
        JsonObject archive = obj(root, "archived");
        if (archive != null) for (var item : archive.entrySet()) {
            if (!SkillChestLayout.validSkillId(item.getKey()) || !item.getValue().isJsonObject()) continue;
            JsonObject value = item.getValue().getAsJsonObject(); List<String> hints = new ArrayList<>();
            JsonArray nativeHints = arr(value, "nativeHints");
            if (nativeHints != null) for (JsonElement hint : nativeHints) {
                String id = primitiveString(hint, null); if (SkillChestLayout.validItemId(id)) hints.add(id);
            }
            cfg.archived.put(item.getKey(), new SkillChestLayout.ArchiveInfo(clean(strOf(value, "reason", "已归档，旧进度仍保留"), 200), hints));
        }
    }
    private static void copyIcons(SkillChestLayout.Config cfg, JsonObject icons) {
        if (icons != null) for (var entry : icons.entrySet()) {
            String id = primitiveString(entry.getValue(), null);
            if (SkillChestLayout.validSkillId(entry.getKey()) && SkillChestLayout.validItemId(id)) cfg.skillIcons.put(entry.getKey(), id);
        }
    }
    private static String icon(JsonObject o, String key, String fallback) { String id = strOf(o, key, null); return SkillChestLayout.validItemId(id) ? id : fallback; }
    static JsonObject readJson(Path path) {
        if (path == null) return null;
        try {
            if (Files.size(path) > 16 * 1024 * 1024) return null;
            try (var reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
                JsonElement el = JsonParser.parseReader(reader); return el != null && el.isJsonObject() ? el.getAsJsonObject() : null;
            }
        } catch (Exception ex) { return null; }
    }
    static JsonObject obj(JsonObject o, String key) { return o != null && o.has(key) && o.get(key).isJsonObject() ? o.getAsJsonObject(key) : null; }
    static JsonArray arr(JsonObject o, String key) { return o != null && o.has(key) && o.get(key).isJsonArray() ? o.getAsJsonArray(key) : null; }
    private static String primitiveString(JsonElement value, String fallback) {
        try { return value != null && value.isJsonPrimitive() && value.getAsJsonPrimitive().isString() ? value.getAsString() : fallback; } catch (Exception e) { return fallback; }
    }
    static String strOf(JsonObject o, String key, String fallback) {
        try { JsonElement value = o.get(key); return value.isJsonPrimitive() ? value.getAsString() : fallback; }
        catch (Exception e) { return fallback; }
    }
    static int intOf(JsonObject o, String key, int fallback) { Integer value = nullableInt(o, key); return value == null ? fallback : value; }
    private static Integer nullableInt(JsonObject o, String key) {
        try { double value = o.get(key).getAsDouble(); return Double.isFinite(value) && value >= 0 && value <= Integer.MAX_VALUE ? (int)value : null; }
        catch (Exception e) { return null; }
    }
    private static boolean positive(JsonObject o, String key) { try { return o.get(key).getAsDouble() > 0; } catch (Exception e) { return false; } }
    private static String number(JsonObject o, String key) {
        try { double value = o.get(key).getAsDouble(); return Double.isFinite(value) ? (value == Math.floor(value) ? Long.toString((long)value) : Double.toString(value)) : "—"; }
        catch (Exception e) { return "—"; }
    }
    private static String clean(String value, int max) {
        String clean = value.replaceAll("[\\p{Cntrl}§]", " ");
        return clean.substring(0, Math.min(max, clean.length()));
    }
    private SkillChestIO() {}
}
