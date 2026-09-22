package dev.god.botgate.chest;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.Set;

/** Pure, stable categorized layout; native metadata never grants a spell. */
public final class SkillChestLayout {
    public static final int ROWS = 6, COLS = 9, SIZE = 54, SKILL_ROW = 1, WAYPOINT_ROW = 0;
    public static final int SKILLS_PER_PAGE = 28, ITEMS_PER_PAGE = 36, WAYPOINTS_PER_PAGE = 36;
    public static final int WHEEL_SIZE = SIZE, WHEEL_PER_PAGE = SKILLS_PER_PAGE, WHEEL_WARP_SLOT = 8;
    public static final int NATIVE_SLOT = 6, INFO_SLOT = 49, WARP_SLOT = 8;
    public static final int SKILLBAR_HUB_SLOT = 47, SKILLBAR_SLOTS = 8, SKILLBAR_FIRST_SLOT = 19;
    public static final int PREVIOUS_SLOT = 45, ARCHIVE_SLOT = 46, HOME_SLOT = 48, REFRESH_SLOT = 50, CLOSE_SLOT = 52, NEXT_SLOT = 53;
    public static final List<String> FILTERS = List.of("known", "combat", "support", "movement", "life", "passive", "native", "all");
    private static final List<String> FILTER_NAMES = List.of("我的技能", "战斗招式", "恢复防御", "移动探索", "生活造物", "被动天赋", "铁魔法", "学习图鉴");
    private static final List<String> FILTER_ICONS = List.of("minecraft:compass", "minecraft:iron_sword", "minecraft:golden_apple",
            "minecraft:ender_pearl", "minecraft:crafting_table", "minecraft:nether_star", "minecraft:enchanted_book", "minecraft:bookshelf");
    public enum Kind { SKILL, WAYPOINT, MORE, BACK, EMPTY, ITEM, NATIVE, WARP_HUB, ARCHIVE_HUB, ARCHIVED, INFO, REFRESH, CLOSE, HOME,
        SKILLBAR_HUB, SKILLBAR_SLOT, SKILLBAR_EDIT, CATEGORY, NATIVE_SPELL, PASSIVE, LOCKED, GUIDE }

    public static final class Entry {
        public final Kind kind;
        public final String id, name, icon, lore, command;
        public final String nameKey, namePrefix;
        public final boolean selected;
        Entry(Kind kind, String id, String name, String icon, String lore, String command) {
            this(kind, id, name, icon, lore, command, null, "", false);
        }
        Entry(Kind kind, String id, String name, String icon, String lore, String command, String nameKey, String namePrefix, boolean selected) {
            this.kind = kind; this.id = id; this.name = name; this.icon = icon; this.lore = lore; this.command = command;
            this.nameKey = nameKey; this.namePrefix = namePrefix; this.selected = selected;
        }
        private Entry localized(String key, String prefix) {
            return new Entry(kind, id, name, icon, lore, command, key, prefix, selected);
        }
        public static Entry empty(String icon) { return new Entry(Kind.EMPTY, "", "", icon, "", null); }
        public boolean actionable() {
            return switch (kind) {
                case EMPTY, INFO, ARCHIVED, PASSIVE, LOCKED -> false;
                case SKILL -> command != null || "give".equals(id);
                case WAYPOINT, ITEM, NATIVE, NATIVE_SPELL, SKILLBAR_EDIT -> command != null;
                default -> true;
            };
        }
        @Override public String toString() { return kind + "(" + id + ")"; }
    }
    public static final class ArchiveInfo {
        public final String reason;
        public final List<String> nativeHints;
        public ArchiveInfo(String reason, List<String> hints) { this.reason = reason; this.nativeHints = List.copyOf(hints); }
    }
    public static final class Config {
        public String defaultIcon = "minecraft:gray_stained_glass_pane", closeIcon = "minecraft:oak_door";
        public String moreIcon = "minecraft:arrow", backIcon = "minecraft:arrow", waypointIcon = "minecraft:lodestone";
        public boolean catalogAvailable;
        public String stateSummary = "秘术状态尚未同步";
        public final List<String> featured = new ArrayList<>();
        public final Map<String, Integer> order = new LinkedHashMap<>();
        public final Map<String, String> groups = new HashMap<>(), nativeMappings = new HashMap<>();
        public final Set<String> passives = new LinkedHashSet<>();
        public final Set<String> learned = new LinkedHashSet<>();
        public boolean learningSnapshotAvailable;
        public int playerLevel = -1;
        public final Map<String, Integer> requiredLevels = new HashMap<>();
        public final Map<String, NativeSpell> nativeSpells = new LinkedHashMap<>();
        public boolean nativeAvailable;
        public String nativeSummary = "原生法术状态暂不可读取";
        public final Map<String, ArchiveInfo> archived = new LinkedHashMap<>();
        public final Map<String, String> skillIcons = new HashMap<>(), chantAlias = new HashMap<>();
        public final Map<String, String> skillNames = new HashMap<>(), skillLore = new HashMap<>();
        public final List<GiveItem> giveItems = new ArrayList<>();
        public long debounceMs = 800;
    }
    public static final class SkillInfo {
        public final String id;
        public SkillInfo(String id) { this.id = id; }
    }
    public static final class NativeSpell {
        public final String id, name, nameKey, school, source, sourceSlot, reason;
        public final int level;
        public final double mana;
        public final long cooldownMs;
        public final boolean ready;
        public NativeSpell(String id, String name, String nameKey, String school, int level, double mana,
                           long cooldownMs, String source, String sourceSlot, boolean ready, String reason) {
            this.id=id; this.name=name; this.nameKey=nameKey; this.school=school; this.level=level; this.mana=mana;
            this.cooldownMs=cooldownMs; this.source=source; this.sourceSlot=sourceSlot; this.ready=ready; this.reason=reason;
        }
        public String lore() { return "原生等级 " + level + " · 法力 " + mana + "\n冷却剩余 " + cooldownMs / 1000.0
                + " 秒\n装备来源：" + sourceLabel(source) + "\n" + (ready ? "可尝试施法，命中与消耗以实际结果为准" : unavailableReason(reason)); }
    }
    public static final class WaypointInfo {
        public final String name, reference, lore;
        public final int index;
        public final boolean shared;
        public WaypointInfo(int index, String name) { this(index, name, null, "地点尚未登记稳定标识", false); }
        public WaypointInfo(int index, String name, String reference, String lore, boolean shared) {
            this.index = index; this.name = name; this.reference = reference; this.lore = lore; this.shared = shared;
        }
    }
    public static final class GiveItem {
        public final String cn, icon;
        public final int count;
        public GiveItem(String cn, String icon, int count) { this.cn = cn; this.icon = icon; this.count = count; }
    }
    public static boolean validSkillId(String id) { return id != null && id.matches("[a-z0-9_./-]{1,96}"); }
    public static boolean validNativeId(String id) { return id != null && id.length() <= 128 && validItemId(id); }
    public static boolean validBarId(String id) { return validSkillId(id) || validNativeId(id); }
    public static boolean validItemId(String id) { return id != null && id.matches("[a-z0-9_.-]+:[a-z0-9_./-]+"); }
    public static boolean validWaypointRef(String ref) { return ref != null && ref.matches("(?:shared|personal):[0-9]{1,16}"); }
    private static int size(List<?> list) { return list == null ? 0 : list.size(); }
    private static int pages(int size, int per) { return Math.max(1, (size + per - 1) / per); }
    public static int pagesFor(List<SkillInfo> skills) { return pages(size(skills), SKILLS_PER_PAGE); }
    public static int wheelPagesFor(List<SkillInfo> skills) { return pagesFor(skills); }
    public static int itemPagesFor(List<GiveItem> items) { return pages(size(items), ITEMS_PER_PAGE); }
    public static int waypointPagesFor(List<WaypointInfo> points) { return pages(size(points), WAYPOINTS_PER_PAGE); }
    public static int skillbarChoicePagesFor(List<SkillInfo> skills) { return pages(size(skills), ITEMS_PER_PAGE); }
    public static int skillSlot(int index) { return 10 + (index / 7) * 9 + index % 7; }
    public static String validFilter(String value) { return FILTERS.contains(value) ? value : "known"; }
    public static String filterName(String value) { return FILTER_NAMES.get(FILTERS.indexOf(validFilter(value))); }
    public static List<SkillInfo> sortSkills(Config cfg, List<SkillInfo> skills) {
        return skills.stream().sorted(Comparator.comparingInt((SkillInfo skill) -> cfg.order.getOrDefault(skill.id,
                        cfg.featured.contains(skill.id) ? 10000 + cfg.featured.indexOf(skill.id) : 20000))
                .thenComparing(skill -> skill.id)).toList();
    }
    public static List<SkillInfo> compassSkills(Config cfg, List<SkillInfo> skills, List<SkillInfo> passives) {
        List<SkillInfo> all = new ArrayList<>(skills); all.addAll(passives);
        List<SkillInfo> out = new ArrayList<>(sortSkills(cfg, all));
        cfg.nativeSpells.values().stream().sorted(Comparator.comparing((NativeSpell s) -> s.school).thenComparing(s -> s.id))
                .forEach(spell -> out.add(new SkillInfo(spell.id)));
        return out;
    }
    public static List<SkillInfo> filtered(Config cfg, List<SkillInfo> skills, String filter) {
        String group = validFilter(filter);
        return skills.stream().filter(skill -> {
            String id = skill.id;
            if (group.equals("all")) return !validNativeId(id);
            if (group.equals("known")) return validNativeId(id) ||
                    (!cfg.passives.contains(id) && !cfg.nativeMappings.containsKey(id) && cfg.learned.contains(id));
            return group.equals(group(cfg, id));
        }).toList();
    }
    private static String group(Config cfg, String id) {
        if (cfg.passives.contains(id)) return "passive";
        if (validNativeId(id)) return "native";
        return cfg.groups.getOrDefault(id, "life");
    }
    private static int clampPage(int page, int pages) { return Math.max(0, Math.min(page, pages - 1)); }
    private static List<Entry> blank(Config cfg) {
        List<Entry> out = new ArrayList<>(SIZE);
        for (int i = 0; i < SIZE; i++) out.add(Entry.empty(cfg.defaultIcon));
        return out;
    }
    private static Entry nativeEntry() {
        return new Entry(Kind.NATIVE, "native-spells", "铁魔法 · 法术书", "minecraft:enchanted_book",
                "选择已装备的原生法术\n使用铁魔法自身法力与冷却\n打开菜单，不会立即施法", "qdspell self menu");
    }
    private static void header(List<Entry> out, Config cfg, int page, int pages, boolean archive, String filter) {
        for (int i = 0; i < 7; i++) out.set(i, new Entry(Kind.CATEGORY, FILTERS.get(i), FILTER_NAMES.get(i), FILTER_ICONS.get(i),
                (!archive && FILTERS.get(i).equals(filter) ? "当前分类\n" : "切换分类，不会施法\n")
                + (FILTERS.get(i).equals("native") ? cfg.nativeSummary : "目录顺序固定，刷新不会按法力或学习时间重排"), null,
                null, "", !archive && FILTERS.get(i).equals(filter)));
        out.set(7, new Entry(Kind.GUIDE, "guide", "施法入门与排障", "minecraft:book", "铁魔法怎么装备？\n女神秘术怎么学？\n点击查看三步指引", null));
        out.set(WARP_SLOT, new Entry(Kind.WARP_HUB, "waypoints", "传送阵 · 选择地点", "minecraft:ender_eye",
                "查看公共与个人传送点\n独立分页，不会直接传送", null));
    }
    private static void footer(List<Entry> out, Config cfg, int page, int pages, boolean root) {
        out.set(PREVIOUS_SLOT, page > 0 ? new Entry(Kind.BACK, String.valueOf(page - 1), "上一页", cfg.backIcon, "第 " + page + " / " + pages + " 页", null)
                : new Entry(Kind.INFO, "", "已在第一页", cfg.defaultIcon, "", null));
        out.set(NEXT_SLOT, page + 1 < pages ? new Entry(Kind.MORE, String.valueOf(page + 1), "下一页", cfg.moreIcon, "第 " + (page + 2) + " / " + pages + " 页", null)
                : new Entry(Kind.INFO, "", "已在最后一页", cfg.defaultIcon, "", null));
        out.set(HOME_SLOT, new Entry(Kind.HOME, "home", "返回我的技能", "minecraft:compass", "已学女神秘术与已装备法术\n同一原生法术只显示一个入口", null));
        out.set(51, new Entry(Kind.CATEGORY, "all", "学习图鉴", "minecraft:bookshelf", "查看学习条件、装备要求和旧主题别名", null));
        out.set(CLOSE_SLOT, new Entry(Kind.CLOSE, "close", "关闭罗盘", cfg.closeIcon, "也可按 B / Esc 返回游戏", null));
        out.set(INFO_SLOT, new Entry(Kind.INFO, "status", "第 " + (page + 1) + " / " + pages + " 页", "minecraft:experience_bottle",
                cfg.stateSummary + "\n" + cfg.nativeSummary + "\n确认时由服务器检查消耗与状态", null));
        out.set(SKILLBAR_HUB_SLOT, skillbarHub("编辑快捷栏", "配置 8 个快捷技能槽\n保留空槽和原位置，编辑不会施法"));
        out.set(REFRESH_SLOT, new Entry(Kind.REFRESH, String.valueOf(page), "刷新状态", "minecraft:clock", "重新读取目录与已同步状态", null));
    }
    public static List<Entry> build(Config cfg, List<SkillInfo> skills, List<WaypointInfo> ignored, int page) { return buildFiltered(cfg, skills, page, "all"); }
    public static List<Entry> buildWheel(Config cfg, List<SkillInfo> skills, int page) { return buildFiltered(cfg, skills, page, "all"); }
    public static List<Entry> buildArchive(Config cfg, List<SkillInfo> skills, int page) { return buildCompass(cfg, skills, page, true, "all"); }
    public static List<Entry> buildFiltered(Config cfg, List<SkillInfo> skills, int page, String filter) {
        return buildCompass(cfg, filtered(cfg, skills, filter), page, false, validFilter(filter));
    }
    private static List<Entry> buildCompass(Config cfg, List<SkillInfo> skills, int requested, boolean archive, String filter) {
        int pages = pagesFor(skills), page = clampPage(requested, pages);
        List<Entry> out = blank(cfg);
        header(out, cfg, page, pages, archive, filter); footer(out, cfg, page, pages, !archive);
        if (!archive) out.set(ARCHIVE_SLOT, new Entry(Kind.ARCHIVE_HUB, "archive", "旧技能档案", "minecraft:bookshelf", "查阅已保存的旧技能说明\n档案图标不触发施法", null));
        if (!archive) out.set(SKILLBAR_HUB_SLOT, skillbarHub("编辑快捷栏", "配置 8 个快捷技能槽\n点选槽位，再选择已学秘术\n编辑不会释放技能"));
        for (int slot = 0; slot < SKILLS_PER_PAGE && page * SKILLS_PER_PAGE + slot < size(skills); slot++) {
            String id = skills.get(page * SKILLS_PER_PAGE + slot).id;
            if (!validBarId(id)) continue;
            if (!archive && validNativeId(id)) { out.set(skillSlot(slot), nativeSkill(cfg, id)); continue; }
            String name = cfg.skillNames.getOrDefault(id, id), icon = skillIcon(cfg, id);
            if (!validItemId(icon)) icon = "minecraft:amethyst_shard";
            String lore = cfg.skillLore.getOrDefault(id, "已学秘术") + "\n技能：" + id;
            if (archive) {
                ArchiveInfo info = cfg.archived.get(id);
                lore += "\n" + (info == null ? "不在精选目录，旧记录仍保留" : info.reason);
                if (info != null && !info.nativeHints.isEmpty()) lore += "\n原生替代：" + String.join("、", info.nativeHints);
                out.set(skillSlot(slot), new Entry(Kind.ARCHIVED, id, name + " · 待整理", icon, lore + "\n只读档案 · 不可点击施法", null));
            } else if (cfg.nativeMappings.containsKey(id)) {
                NativeSpell spell = cfg.nativeSpells.get(cfg.nativeMappings.get(id));
                boolean ready = spell != null && spell.ready;
                out.set(skillSlot(slot), new Entry(ready ? Kind.SKILL : Kind.LOCKED, id, name + (ready ? " · 已装备" : " · 待装备/恢复"), icon,
                        "铁魔法主题别名，不重复扣秘术魔力\n对应法术：" + cfg.nativeMappings.get(id)
                        + "\n" + (spell == null ? "请在铭文台把对应卷轴装入法术书，再装备法术书\n或手持卷轴（施放会消耗卷轴）" : spell.lore())
                        + "\n不需要先解锁旧别名；原生装备才是来源", ready ? "/mycli cast " + id : null));
            } else if ((!cfg.learningSnapshotAvailable || !cfg.learned.contains(id)) &&
                    (cfg.passives.contains(id) || cfg.playerLevel < cfg.requiredLevels.getOrDefault(id, Integer.MAX_VALUE))) {
                String label = cfg.learningSnapshotAvailable ? "未解锁" : "学习状态未同步";
                String mapping = cfg.nativeMappings.get(id);
                out.set(skillSlot(slot), new Entry(Kind.LOCKED, id, name + " · " + label, icon,
                        lore + "\n" + label + "：提升经验等级或按技能书规则参悟\n被动无需主动释放；右上角可查看入门"
                        + (mapping == null ? "" : "\n原生主题映射：" + mapping + "\n解锁后仍需装备对应法术书/装备或手持卷轴"), null));
            } else if (cfg.passives.contains(id)) {
                out.set(skillSlot(slot), new Entry(Kind.PASSIVE, id, name + " · 已学被动", icon,
                        lore + "\n持续/条件生效，以原规则为准\n不占主动快捷槽，不可点击施法", null));
            } else {
                String mapped = cfg.nativeMappings.get(id);
                NativeSpell nativeSpell = cfg.nativeSpells.get(mapped);
                if (mapped != null) lore += "\n主题映射：" + mapped + "\n使用原生装备、法力、冷却和目标规则\n"
                        + (nativeSpell != null ? nativeSpell.lore() : cfg.nativeAvailable ? "尚未装备对应原生法术；请先装备法术书/法术装备或手持卷轴" : cfg.nativeSummary);
                Entry entry = new Entry(Kind.SKILL, id, name + (cfg.learned.contains(id) ? "" : " · 可尝试学习"), icon, lore + ("give".equals(id) ? "\n先选择要造出的物品" : "\n确认后尝试施放，成功后按原规则学习")
                        + "\n真实等级、资源、冷却和目标将在施放时检查",
                        "give".equals(id) ? null : "/mycli cast " + id);
                if (nativeSpell != null) entry = entry.localized(nativeSpell.nameKey, name + " → ");
                out.set(skillSlot(slot), entry);
            }
        }
        if (size(skills) == 0) out.set(22, new Entry(Kind.INFO, "empty", archive ? "尚无归档技能" : "此分类暂无已学能力", "minecraft:book",
                filter.equals("native") ? cfg.nativeSummary + "\n装备法术书/法术装备，或在手中持有卷轴，再刷新"
                : cfg.catalogAvailable ? "学习进度仍按原世界规则保留" : "技能目录暂不可读取，请稍后刷新", null));
        return out;
    }
    private static String nativeIcon(String school) {
        return switch (school) {
            case "irons_spellbooks:fire" -> "minecraft:blaze_powder";
            case "irons_spellbooks:ice" -> "minecraft:packed_ice";
            case "irons_spellbooks:lightning" -> "minecraft:lightning_rod";
            case "irons_spellbooks:holy" -> "minecraft:golden_apple";
            case "irons_spellbooks:ender" -> "minecraft:ender_eye";
            case "irons_spellbooks:blood" -> "minecraft:redstone";
            case "irons_spellbooks:nature" -> "minecraft:oak_sapling";
            case "irons_spellbooks:evocation" -> "minecraft:totem_of_undying";
            default -> "minecraft:enchanted_book";
        };
    }
    private static String skillIcon(Config cfg, String id) {
        NativeSpell nativeSpell = cfg.nativeSpells.get(id);
        String fallback = nativeSpell == null ? FILTER_ICONS.get(FILTERS.indexOf(validFilter(group(cfg, id)))) : nativeIcon(nativeSpell.school);
        String icon = cfg.skillIcons.getOrDefault(id, fallback);
        return validItemId(icon) ? icon : fallback;
    }
    private static Entry nativeSkill(Config cfg, String id) {
        NativeSpell spell = cfg.nativeSpells.get(id);
        if (spell == null) return new Entry(Kind.INFO, id, id, "minecraft:barrier", "原生法术来源不可读取，请刷新", null);
        return new Entry(spell.ready ? Kind.NATIVE_SPELL : Kind.LOCKED, id, spell.name, skillIcon(cfg, id), "铁魔法\n" + spell.lore()
                + "\n法术：" + id + "\n恢复后点下方时钟刷新", spell.ready ? "qdspell self cast " + id : null).localized(spell.nameKey, spell.ready ? "" : "暂不可用 · ");
    }
    public static String sourceLabel(String source) {
        return switch (source) { case "scroll" -> "手持卷轴（一次性，施放会消耗）";
            case "spellbook" -> "已装备法术书（可重复使用）"; default -> "原生法术装备（" + source + "）"; };
    }
    public static String unavailableReason(String reason) {
        if (reason.contains("cooldown")) return "冷却未结束：等待后刷新";
        if (reason.contains("mana")) return "铁魔法法力不足：等待恢复后刷新";
        if (reason.contains("learn")) return "原生学习条件未满足：查看该法术的原生说明";
        if (reason.equals("busy")) return "正在施法：等待结束，或用 /mycli cancel 取消";
        return "当前不可用：" + reason + "\n查看角色状态后刷新，勿反复点击";
    }
    public static List<String> loreLines(String text) {
        List<String> lines = new ArrayList<>();
        for (String source : text.split("\n")) {
            StringBuilder line = new StringBuilder(); int width = 0;
            for (int ch : source.codePoints().toArray()) {
                int size = ch < 128 ? 1 : 2;
                if (width + size > 44) { lines.add(line.toString()); line.setLength(0); width = 0; }
                line.appendCodePoint(ch); width += size;
            }
            lines.add(line.toString());
        }
        return lines;
    }
    public static List<Entry> buildGuide(Config cfg) {
        List<Entry> out = blank(cfg); footer(out, cfg, 0, 1, false);
        out.set(11, new Entry(Kind.INFO,"iron-guide","铁魔法 · 三步上手","minecraft:enchanted_book",
                "① 获取原生法术卷轴与法术书\n② 在铭文台将卷轴装入书，再装备法术书\n③ 回到铁魔法页刷新，瞄准目标后选择施放\n也可手持卷轴直接施放，但会消耗卷轴\n空书、背包里的卷轴、旧技能名称都不等于已装备",null));
        out.set(13, new Entry(Kind.INFO,"legacy-guide","女神秘术 · 学习与资源","minecraft:amethyst_shard",
                "① 打开学习图鉴，查看经验等级与参数\n② 达到条件后尝试施放，成功按原规则学习\n③ 已学技能可放入八槽快捷栏\n女神秘术消耗秘术魔力；铁魔法使用原生法力\n燃血术不会恢复铁魔法法力；被动无需点击",null));
        out.set(15, new Entry(Kind.INFO,"controls-guide","操作与常见问题","minecraft:spyglass",
                "我的技能：已学秘术和已装备法术\n学习图鉴：未学条目、旧主题别名与条件\n灰色条目只读：查看原因，满足条件后刷新\n言灵杖长按举起，选槽/咏唱，松手释放\n举杖时可保持瞄准；不要在菜单里连点施法",null));
        out.set(31, nativeEntry());
        return out;
    }
    private static Entry skillbarHub(String name, String lore) {
        return new Entry(Kind.SKILLBAR_HUB, "skillbar", name, "minecraft:chest", lore, null);
    }
    private static boolean selectable(Config cfg, List<SkillInfo> skills, String id) {
        if (validNativeId(id)) return cfg.nativeAvailable && cfg.nativeSpells.containsKey(id);
        return cfg.catalogAvailable && validSkillId(id) && cfg.featured.contains(id) && !cfg.archived.containsKey(id) && !cfg.passives.contains(id)
                && skills != null && skills.stream().anyMatch(skill -> id.equals(skill.id));
    }
    private static String barId(List<String> bar, int slot) {
        return bar != null && slot < bar.size() && bar.get(slot) != null ? bar.get(slot) : "";
    }
    /** Pure view of stored positions: missing snapshots never become a fabricated recommended bar. */
    public static List<Entry> buildSkillbar(Config cfg, List<SkillInfo> skills, List<String> bar, boolean available) {
        List<Entry> out = blank(cfg); footer(out, cfg, 0, 1, false);
        out.set(INFO_SLOT, new Entry(Kind.INFO, "skillbar-status", "快捷栏 · 8 槽", "minecraft:book",
                (available ? "已保存的槽位（同步快照）" : "快捷栏尚未同步或初始化")
                + "\n选择槽位后可更换或清空\n推荐排列由世界服务生成，编辑不会施法", null));
        for (int slot = 0; slot < SKILLBAR_SLOTS; slot++) {
            String id = barId(bar, slot);
            boolean enabled = selectable(cfg, skills, id);
            String name = !available ? "尚未同步" : id.isEmpty() ? "空" : cfg.nativeSpells.containsKey(id) ? cfg.nativeSpells.get(id).name : cfg.skillNames.getOrDefault(id, id);
            String icon = enabled ? skillIcon(cfg, id)
                    : id.isEmpty() ? "minecraft:light_gray_stained_glass_pane" : "minecraft:barrier";
            if (!validItemId(icon)) icon = "minecraft:amethyst_shard";
            String lore = "快捷槽 " + (slot + 1) + "\n" + (enabled ? cfg.skillLore.getOrDefault(id, "已学主动秘术")
                    : !available ? "请等待同步，或使用下方推荐排列" : id.isEmpty() ? "此位置未绑定技能" : "此旧绑定当前不可用，原记录未改写");
            if (!id.isEmpty()) lore += "\n技能：" + id;
            Entry entry = new Entry(Kind.SKILLBAR_SLOT, String.valueOf(slot + 1), "槽 " + (slot + 1) + " · " + name, icon, lore + "\n打开选择页，不会施法", null);
            if (cfg.nativeSpells.containsKey(id)) entry = entry.localized(cfg.nativeSpells.get(id).nameKey, "槽 " + (slot + 1) + " · ");
            out.set(SKILLBAR_FIRST_SLOT + slot, entry);
        }
        out.set(ARCHIVE_SLOT, new Entry(Kind.SKILLBAR_EDIT, "auto", "恢复推荐排列", "minecraft:hopper",
                "将这 8 槽重置为已学精选秘术的推荐顺序\n会替换当前自定义排列\n确认后等待世界服务回执，再重新打开查看", "/mycli skillbar auto"));
        return out;
    }
    /** Assignment choices carry only validated canonical IDs; no cast command is generated. */
    public static List<Entry> buildSkillbarChoices(Config cfg, List<SkillInfo> skills, List<String> bar, int selectedSlot, int requested) {
        if (selectedSlot < 1 || selectedSlot > SKILLBAR_SLOTS) throw new IllegalArgumentException("skillbar slot must be 1..8");
        List<SkillInfo> choices = skills == null ? List.of() : skills.stream().filter(skill -> selectable(cfg, skills, skill.id)).toList();
        int pages = skillbarChoicePagesFor(choices), page = clampPage(requested, pages);
        List<Entry> out = blank(cfg); footer(out, cfg, page, pages, false);
        out.set(HOME_SLOT, skillbarHub("返回快捷栏", "返回 8 槽配置，不修改当前绑定"));
        for (int slot = 0; slot < ITEMS_PER_PAGE && page * ITEMS_PER_PAGE + slot < choices.size(); slot++) {
            String id = choices.get(page * ITEMS_PER_PAGE + slot).id;
            String icon = skillIcon(cfg, id);
            if (!validItemId(icon)) icon = "minecraft:amethyst_shard";
            int existing = bar == null ? -1 : bar.indexOf(id);
            String action = existing == selectedSlot - 1 ? "此技能已在该槽，确认仍保持此绑定"
                    : existing >= 0 && existing < SKILLBAR_SLOTS ? "从槽 " + (existing + 1) + " 移到此槽，原位置将清空" : "绑定到此槽";
            Entry entry = new Entry(Kind.SKILLBAR_EDIT, id, "槽 " + selectedSlot + " ← " + cfg.skillNames.getOrDefault(id, id), icon,
                    cfg.skillLore.getOrDefault(id, "已学主动秘术") + "\n技能：" + id + "\n" + action
                    + "\n只配置快捷栏，不会释放技能\n确认后等待回执，再重新打开查看", "/mycli skillbar set " + selectedSlot + " " + id);
            if (cfg.nativeSpells.containsKey(id)) entry = entry.localized(cfg.nativeSpells.get(id).nameKey, "槽 " + selectedSlot + " ← ");
            out.set(slot, entry);
        }
        if (choices.isEmpty()) out.set(INFO_SLOT, new Entry(Kind.INFO, "empty", "暂无可绑定的已学精选秘术", "minecraft:book",
                cfg.catalogAvailable ? "被动和归档技能不会进入快捷栏" : "技能目录暂不可读取，请稍后刷新", null));
        out.set(ARCHIVE_SLOT, new Entry(Kind.SKILLBAR_EDIT, "clear", "清空槽 " + selectedSlot, "minecraft:barrier",
                "只清除此位置的绑定，其他槽不会前移\n已学进度与技能效果不受影响\n确认后等待回执，再重新打开查看", "/mycli skillbar clear " + selectedSlot));
        return out;
    }
    public static List<Entry> buildWaypoints(Config cfg, List<WaypointInfo> points, int requested) {
        int pages = waypointPagesFor(points), page = clampPage(requested, pages);
        List<Entry> out = blank(cfg); footer(out, cfg, page, pages, false); out.set(ARCHIVE_SLOT, nativeEntry());
        for (int slot = 0; slot < WAYPOINTS_PER_PAGE && page * WAYPOINTS_PER_PAGE + slot < size(points); slot++) {
            WaypointInfo point = points.get(page * WAYPOINTS_PER_PAGE + slot);
            boolean valid = validWaypointRef(point.reference);
            out.set(slot, new Entry(valid ? Kind.WAYPOINT : Kind.INFO, point.reference == null ? "" : point.reference, point.name,
                    valid ? (point.shared ? cfg.waypointIcon : "minecraft:red_bed") : cfg.defaultIcon,
                    (point.shared ? "公共传送点" : "个人传送点") + "\n" + point.lore + (valid ? "\n确认后检查传送条件" : "\n缺少稳定标识，暂不可传送"), valid ? "/mycli goto " + point.reference : null));
        }
        if (size(points) == 0) out.set(4, new Entry(Kind.INFO, "empty", "还没有传送点", "minecraft:map", "地点同步后可在这里选择", null));
        return out;
    }
    private static String quoteArgument(String value) { return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""; }
    public static List<Entry> buildItemGrid(Config cfg, List<GiveItem> items, int requested) {
        int pages = itemPagesFor(items), page = clampPage(requested, pages);
        List<Entry> out = blank(cfg); footer(out, cfg, page, pages, false); out.set(ARCHIVE_SLOT, nativeEntry());
        for (int slot = 0; slot < ITEMS_PER_PAGE && page * ITEMS_PER_PAGE + slot < size(items); slot++) {
            GiveItem item = items.get(page * ITEMS_PER_PAGE + slot);
            String icon = item.icon.contains(":") ? item.icon : "minecraft:" + item.icon;
            if (!validItemId(icon) || item.cn.isBlank() || item.cn.length() > 80 || item.cn.chars().anyMatch(c -> c < 32)) continue;
            out.set(slot, new Entry(Kind.ITEM, item.cn, item.cn, icon, "默认数量：" + item.count + "\n造物消耗由服务器检查", "/mycli cast give item=" + quoteArgument(item.cn)));
        }
        return out;
    }
    public static int navTarget(Entry entry) { try { return Integer.parseInt(entry.id); } catch (NumberFormatException e) { return 0; } }
    public static final class ActionGate {
        private boolean dispatched;
        public synchronized boolean accept(boolean owner, boolean current, boolean primaryPickup, boolean actionable) {
            if (!owner || !current || !primaryPickup || !actionable || dispatched) return false;
            dispatched = true; return true;
        }
    }
    public static final class Debouncer {
        private final Map<String, Long> last = new HashMap<>(); private final long ms;
        public Debouncer(long ms) { this.ms = ms <= 0 ? 800 : ms; }
        public synchronized boolean allow(String player) {
            long now = System.currentTimeMillis(); Long at = last.get(player);
            if (at != null && now - at < ms) return false;
            last.put(player, now); return true;
        }
        public synchronized void clear() { last.clear(); }
    }
    private SkillChestLayout() {}
}
