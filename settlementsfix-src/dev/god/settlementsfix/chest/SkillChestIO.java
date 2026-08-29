package dev.god.settlementsfix.chest;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 宝箱技能面板 · IO 层（纯逻辑：gson 读运行态 JSON，无 Minecraft import）。
 *
 * 输入（容器内路径，与 spell-requests 同卷 /mcdata）：
 *   magic-state.json  → players.<name>.learned（已学技能，面板只放已学的）
 *   magic-atoms.json  → atoms[]（id→name/cost/requiredLevel/words[0] 咒语词）
 *   waypoints.json    → shared[] + players.<name>[]（传送点，shared 前 personal 后，
 *                       全局序号与书页/公屏数字同铁律）
 *   skill-chest.json  → 图标/别名/防抖配置（缺省全兜底）
 *
 * 输出：SkillChestLayout.build() 的入参三件套 + Config。
 */
public final class SkillChestIO {

    /** 打开面板所需的一切（一次聚合，供薄壳一次性构建）。 */
    public static final class PanelData {
        public final SkillChestLayout.Config config;
        public final List<SkillChestLayout.SkillInfo> skills;
        public final List<SkillChestLayout.WaypointInfo> waypoints;
        public final int mana;
        public final int maxMana;

        PanelData(SkillChestLayout.Config config,
                  List<SkillChestLayout.SkillInfo> skills,
                  List<SkillChestLayout.WaypointInfo> waypoints,
                  int mana, int maxMana) {
            this.config = config;
            this.skills = skills;
            this.waypoints = waypoints;
            this.mana = mana;
            this.maxMana = maxMana;
        }
    }

    /** 聚合一个玩家的面板数据。任何文件缺失/损坏都有兜底，绝不抛出。 */
    public static PanelData load(Path magicState, Path magicAtoms, Path waypoints,
                                 Path panelConfig, String playerName) {
        SkillChestLayout.Config cfg = loadConfig(panelConfig);
        List<SkillChestLayout.SkillInfo> skills = new ArrayList<>();
        List<SkillChestLayout.WaypointInfo> wps = new ArrayList<>();
        int[] mana = { 0, 0 };

        // magic-atoms.json 的 atoms[] → id→atom 索引
        JsonObject atomsRoot = readJson(magicAtoms);
        Map<String, JsonObject> atomsById = new HashMap<>();
        if (atomsRoot != null) {
            JsonArray atoms = arr(atomsRoot, "atoms");
            if (atoms != null) {
                for (JsonElement el : atoms) {
                    if (!el.isJsonObject()) continue;
                    JsonObject a = el.getAsJsonObject();
                    String id = strOf(a, "id", null);
                    if (id != null) {
                        atomsById.put(id, a);
                    }
                }
            }
        }
        JsonObject state = readJson(magicState);
        if (state != null) {
            JsonObject players = obj(state, "players");
            JsonObject me = players == null ? null : obj(players, playerName);
            if (me != null) {
                mana[0] = intOf(me, "mana", 0);
                mana[1] = intOf(me, "maxMana", 0);
                JsonArray learned = arr(me, "learned");
                if (learned != null) {
                    for (JsonElement el : learned) {
                        String id = el.getAsString();
                        skills.add(new SkillChestLayout.SkillInfo(id));
                        // atom 元数据：名/图标别名/咒语词/lore
                        JsonObject atom = atomsById.get(id);
                        if (atom != null) {
                            String name = strOf(atom, "name", id);
                            cfg.skillNames.put(id, name);
                            // 咒语词：words[0] 优先（书页 cast 用中文名，atoms 的 words[0]
                            // 即中文名——与 SkillBookUseMixin "/mycli cast " + n 同源）
                            JsonArray words = arr(atom, "words");
                            String chant = words != null && words.size() > 0
                                    ? words.get(0).getAsString() : name;
                            cfg.chantAlias.put(id, chant);
                            JsonObject cost = obj(atom, "cost");
                            int m = cost == null ? 0 : intOf(cost, "mana", 0);
                            int lv = intOf(atom, "requiredLevel", 0);
                            cfg.skillLore.put(id, "魔 " + m + (lv > 0 ? " · Lv" + lv : ""));
                        }
                    }
                }
            }
        }

        JsonObject wp = readJson(waypoints);
        if (wp != null) {
            int idx = 0;
            JsonArray shared = arr(wp, "shared");
            if (shared != null) {
                for (JsonElement el : shared) {
                    idx++;
                    wps.add(new SkillChestLayout.WaypointInfo(idx, strOf(el.getAsJsonObject(), "name", "?" + idx)));
                }
            }
            JsonObject pw = obj(wp, "players");
            JsonArray mine = pw == null ? null : arr(pw, playerName);
            if (mine != null) {
                for (JsonElement el : mine) {
                    idx++;
                    wps.add(new SkillChestLayout.WaypointInfo(idx, strOf(el.getAsJsonObject(), "name", "?" + idx)));
                }
            }
        }
        return new PanelData(cfg, skills, wps, mana[0], mana[1]);
    }

    /** 解析 skill-chest.json（缺失/损坏 → 默认配置，图标映射合并 skill-icons 段）。 */
    public static SkillChestLayout.Config loadConfig(Path p) {
        SkillChestLayout.Config cfg = new SkillChestLayout.Config();
        JsonObject root = readJson(p);
        if (root == null) {
            return cfg;
        }
        try {
            JsonObject icons = obj(root, "icons");
            if (icons != null) {
                String d = strOf(icons, "default", null);
                if (d != null) setField(cfg, "defaultIcon", d);
                String c = strOf(icons, "close", null);
                if (c != null) setField(cfg, "closeIcon", c);
                String m = strOf(icons, "more", null);
                if (m != null) setField(cfg, "moreIcon", m);
                String b = strOf(icons, "back", null);
                if (b != null) setField(cfg, "backIcon", b);
                String w = strOf(icons, "waypoint", null);
                if (w != null) setField(cfg, "waypointIcon", w);
                JsonObject sk = obj(icons, "skill");
                if (sk != null) {
                    for (Map.Entry<String, JsonElement> e : sk.entrySet()) {
                        cfg.skillIcons.put(e.getKey(), e.getValue().getAsString());
                    }
                }
            }
            JsonObject alias = obj(root, "chantAlias");
            if (alias != null) {
                for (Map.Entry<String, JsonElement> e : alias.entrySet()) {
                    cfg.chantAlias.put(e.getKey(), e.getValue().getAsString());
                }
            }
            long db = root.has("debounceMs") ? root.get("debounceMs").getAsLong() : cfg.debounceMs;
            cfg.debounceMs = db;
        } catch (Exception ignore) {
            // 坏配置 → 保持默认
        }
        return cfg;
    }

    // ───────────────────── json helpers（与 SkillBookUseMixin 同风格） ─────────────────────

    static JsonObject readJson(Path p) {
        if (p == null) return null;
        try (var fr = Files.newBufferedReader(p, StandardCharsets.UTF_8)) {
            JsonElement el = JsonParser.parseReader(fr);
            return el != null && el.isJsonObject() ? el.getAsJsonObject() : null;
        } catch (Exception ex) {
            // 文件缺失/坏 JSON/非对象根 → null（上层兜底默认配置，绝不炸）
            return null;
        }
    }

    static JsonObject obj(JsonObject o, String k) {
        try {
            return o != null && o.has(k) && o.get(k).isJsonObject() ? o.getAsJsonObject(k) : null;
        } catch (Exception e) {
            return null;
        }
    }

    static JsonArray arr(JsonObject o, String k) {
        try {
            return o != null && o.has(k) && o.get(k).isJsonArray() ? o.getAsJsonArray(k) : null;
        } catch (Exception e) {
            return null;
        }
    }

    static int intOf(JsonObject o, String k, int dft) {
        try {
            return o != null && o.has(k) ? o.get(k).getAsInt() : dft;
        } catch (Exception e) {
            return dft;
        }
    }

    static String strOf(JsonObject o, String k, String dft) {
        try {
            return o != null && o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : dft;
        } catch (Exception e) {
            return dft;
        }
    }

    /** 反射写字段（Config 内部字段 final 不可反——改用直接赋值路径的轻量桥）。 */
    private static void setField(SkillChestLayout.Config cfg, String name, String v) {
        // Config 字段 package-private 非反射直写不可行——此桥仅同包可信输入使用。
        switch (name) {
            case "defaultIcon" -> cfg.defaultIcon = v;
            case "closeIcon" -> cfg.closeIcon = v;
            case "moreIcon" -> cfg.moreIcon = v;
            case "backIcon" -> cfg.backIcon = v;
            case "waypointIcon" -> cfg.waypointIcon = v;
            default -> { }
        }
    }

    private SkillChestIO() {}
}
