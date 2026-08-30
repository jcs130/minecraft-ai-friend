package dev.god.settlementsfix.chest;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 宝箱技能面板 · 纯逻辑层（无 Minecraft import，可独立单测/CI）。
 *
 * 设计见 docs/skill-chest-design.md：
 *   行0 = 已学技能（图标物品，点击施法）
 *   行1 = 传送点（点击传送）
 *   行2 = 预留（一期空格子）
 *
 * 本类只做数据编排：配置解析、分页布局、咒语词映射。
 * MC 侧（菜单/命令/点击）在 SkillChestMenu / SkillChestCommands 薄壳里。
 */
public final class SkillChestLayout {

    public static final int ROWS = 3;
    public static final int COLS = 9;
    public static final int SIZE = ROWS * COLS;      // 27
    public static final int SKILL_ROW = 0;
    public static final int WAYPOINT_ROW = 1;
    public static final int SKILLS_PER_PAGE = COLS - 1; // 行0 前 8 格技能，末格翻页/关闭

    /** 格子种类。ITEM = 造物物品子面板的可造物格（2026-08-30 造物扩展）。 */
    public enum Kind { SKILL, WAYPOINT, MORE, BACK, EMPTY, ITEM }

    /** 一个格子的全部数据（薄壳据此构造 ItemStack）。 */
    public static final class Entry {
        public final Kind kind;
        /** atom id（SKILL）或传送点序号字符串（WAYPOINT）。 */
        public final String id;
        /** 展示名（中文，tooltip 用）。 */
        public final String name;
        /** 物品图标 id（如 minecraft:snowball）。 */
        public final String icon;
        /** lore 一行说明（可为空）。 */
        public final String lore;
        /** 确认后要执行的服务端命令（null=点击无动作）。 */
        public final String command;

        Entry(Kind kind, String id, String name, String icon, String lore, String command) {
            this.kind = kind;
            this.id = id;
            this.name = name;
            this.icon = icon;
            this.lore = lore;
            this.command = command;
        }

        public static Entry empty(String defaultIcon) {
            return new Entry(Kind.EMPTY, "", "", defaultIcon, "", null);
        }

        @Override
        public String toString() {
            return kind + "(" + id + ")";
        }
    }

    /** 面板配置（skill-chest.json 解析产物；缺省全有兜底）。字段非 final：IO 层合并配置时写入。 */
    public static final class Config {
        public String defaultIcon;
        public String closeIcon;
        public String moreIcon;
        public String backIcon;
        public String waypointIcon;
        public final Map<String, String> skillIcons = new HashMap<>();
        public final Map<String, String> chantAlias = new HashMap<>();
        /** atom id → 中文名（来自 magic-atoms.json，由 IO 层填好传入）。 */
        public final Map<String, String> skillNames = new HashMap<>();
        public final Map<String, String> skillLore = new HashMap<>();
        /** 造物子面板物品清单（skill-chest.json items 段；与 TS GIVE_WHITELIST 镜像，CI 对账）。 */
        public final List<GiveItem> giveItems = new ArrayList<>();
        public long debounceMs = 800;

        public Config() {
            this.defaultIcon = "minecraft:gray_stained_glass_pane";
            this.closeIcon = "minecraft:barrier";
            this.moreIcon = "minecraft:paper";
            this.backIcon = "minecraft:paper";
            this.waypointIcon = "minecraft:nether_star";
        }
    }

    /** 单个技能的入参（IO 层从 magic-state+atoms 抽出）。 */
    public static final class SkillInfo {
        public final String id;
        public SkillInfo(String id) { this.id = id; }
    }

    /** 单个传送点的入参（IO 层从 waypoints.json 抽出）。 */
    public static final class WaypointInfo {
        public final String name;
        public final int index; // 全局序号（与书页/公屏数字同铁律）
        public WaypointInfo(int index, String name) { this.name = name; this.index = index; }
    }

    /**
     * 构建一页布局。
     *
     * @param skills    已学技能（有序；越前越靠左）
     * @param waypoints 传送点（shared 前 personal 后，序号由 IO 层编好）
     * @param page      技能页号（0 起）
     */
    public static List<Entry> build(Config cfg, List<SkillInfo> skills,
                                    List<WaypointInfo> waypoints, int page) {
        List<Entry> out = new ArrayList<>(SIZE);
        for (int i = 0; i < SIZE; i++) {
            out.add(Entry.empty(cfg.defaultIcon));
        }
        // 行0：技能（每页 8 个），末格 = 更多/返回
        if (skills != null && !skills.isEmpty() && page >= 0) {
            int from = page * SKILLS_PER_PAGE;
            for (int i = 0; i < SKILLS_PER_PAGE; i++) {
                int at = from + i;
                if (at >= skills.size()) break;
                String id = skills.get(at).id;
                String name = cfg.skillNames.getOrDefault(id, id);
                String icon = cfg.skillIcons.getOrDefault(id, cfg.defaultIcon);
                String lore = cfg.skillLore.getOrDefault(id, "");
                if ("give".equals(id)) {
                    // 造物术（2026-08-30 造物扩展）：不直接施法，开「可造物」子面板
                    // （图标=物品本身，点击才定物品——CLI 底层 /mycli cast 造物 <名>）。
                    out.set(SKILL_ROW * COLS + i, new Entry(Kind.SKILL, id, name, icon,
                            "选一个变出来", null));
                    continue;
                }
                String chant = cfg.chantAlias.getOrDefault(id, name);
                // mycli 以玩家为执行者（SkillChestMenu 用 player.createCommandSourceStack()），
                // 参数不带玩家名——与书页 clickEvent "/mycli cast <名>" 同格式。
                String cmd = "/mycli cast " + chant;
                out.set(SKILL_ROW * COLS + i, new Entry(Kind.SKILL, id, name, icon, lore, cmd));
            }
        }
        // 行0 末格：多页→更多/返回；单页→无动作空格（不放大红 barrier，避免孩子误点慌）
        int totalPages = pagesFor(skills);
        if (totalPages > 1) {
            boolean hasNext = page + 1 < totalPages;
            Entry nav = hasNext
                    ? new Entry(Kind.MORE, String.valueOf(page + 1), "更多 ▶", cfg.moreIcon,
                            "第" + (page + 2) + "/" + totalPages + "页", null)
                    : new Entry(Kind.BACK, "0", "◀ 返回", cfg.backIcon,
                            "回到第1页", null);
            out.set(SKILL_ROW * COLS + COLS - 1, nav);
        }
        // 行1：传送点（最多 8 个，超出的二期再分页；与书页序号同源）。
        // 命令同书页 "/mycli 传送去 <序号>"（玩家执行者，无玩家名参数）。
        if (waypoints != null) {
            for (int i = 0; i < waypoints.size() && i < COLS - 1; i++) {
                WaypointInfo w = waypoints.get(i);
                String cmd = "/mycli 传送去 " + w.index;
                out.set(WAYPOINT_ROW * COLS + i,
                        new Entry(Kind.WAYPOINT, String.valueOf(w.index), w.name,
                                cfg.waypointIcon, "第" + w.index + "号", cmd));
            }
            // 溢出提示（2026-08-30）：>8 个点时末格亮提示，语音说序号照样能传。
            if (waypoints.size() > COLS - 1) {
                int more = waypoints.size() - (COLS - 1);
                out.set(WAYPOINT_ROW * COLS + COLS - 1,
                        new Entry(Kind.EMPTY, "", "还有 " + more + " 个",
                                cfg.moreIcon, "说出数字也能传", null));
            }
        }
        return out;
    }

    /** 技能需要几页。 */
    public static int pagesFor(List<SkillInfo> skills) {
        if (skills == null || skills.isEmpty()) return 1;
        return (skills.size() + SKILLS_PER_PAGE - 1) / SKILLS_PER_PAGE;
    }

    /** 可造物格（2026-08-30 造物扩展）：cn=中文名（咒语词），icon=物品id，count=默认数量。 */
    public static final class GiveItem {
        public final String cn;
        public final String icon;
        public final int count;
        public GiveItem(String cn, String icon, int count) {
            this.cn = cn;
            this.icon = icon;
            this.count = count;
        }
    }

    /** 造物子面板每页物品数：三行全用（27 格），末格留给导航。 */
    public static final int ITEMS_PER_PAGE = SIZE - 1;

    /**
     * 造物物品子面板（2026-08-30 造物扩展，docs/skill-chest-design.md §3.4）：
     * 三行网格铺可造物（图标=物品本身，零识字门槛），每页 26 格 + 末格导航。
     * 点击 → "/mycli cast 造物 <中文名>"（mc-magic extractItem 白名单转 id，
     * 数量由 GIVE_DEFAULT_COUNT 分类默认——CLI 层裁断，面板不管数量）。
     */
    public static List<Entry> buildItemGrid(Config cfg, List<GiveItem> items, int page) {
        List<Entry> out = new ArrayList<>(SIZE);
        for (int i = 0; i < SIZE; i++) {
            out.add(Entry.empty(cfg.defaultIcon));
        }
        if (items != null && !items.isEmpty() && page >= 0) {
            int from = page * ITEMS_PER_PAGE;
            for (int i = 0; i < ITEMS_PER_PAGE; i++) {
                int at = from + i;
                if (at >= items.size()) break;
                GiveItem g = items.get(at);
                String lore = g.count > 1 ? ("一次 " + g.count + " 个") : "一次 1 个";
                // icon 冒号兼容（2026-08-30 背包造物）：mod 物品 id 自带命名空间
                // （如 sophisticatedbackpacks:backpack）不能硬拼 minecraft: 前缀。
                String icon = g.icon.contains(":") ? g.icon : "minecraft:" + g.icon;
                out.set(i, new Entry(Kind.ITEM, g.cn, g.cn, icon, lore, "/mycli cast 造物 " + g.cn));
            }
        }
        int totalPages = itemPagesFor(items);
        if (totalPages > 1) {
            boolean hasNext = page + 1 < totalPages;
            Entry nav = hasNext
                    ? new Entry(Kind.MORE, String.valueOf(page + 1), "更多 ▶", cfg.moreIcon,
                            "第" + (page + 2) + "/" + totalPages + "页", null)
                    : new Entry(Kind.BACK, "0", "◀ 返回", cfg.backIcon, "回到第1页", null);
            out.set(SIZE - 1, nav);
        }
        return out;
    }

    /** 造物子面板页数。 */
    public static int itemPagesFor(List<GiveItem> items) {
        if (items == null || items.isEmpty()) return 1;
        return (items.size() + ITEMS_PER_PAGE - 1) / ITEMS_PER_PAGE;
    }

    // ── 技能轮盘（2026-08-30 造物主谕「技能太多占格子，用圆盘施法」）──
    // 9x1 一行轻量轮：7 技能 + 传送阵格 + 翻轮格；潜行+右键命格书秒开秒关，
    // 比 9x3 全面板更贴近「圆盘施法」的手感（服务端容器 UI 能做的极限形态）。
    // 2026-08-30 造物主谕「方便传送」：倒数第二格固定「传送阵」入口——点击开
    // 9x3 全面板（第二行=全部传送点），手柄十字键直达。
    public static final int WHEEL_SIZE = 9;

    /** 轮盘每页技能数（末两格留传送阵+导航）。 */
    public static final int WHEEL_PER_PAGE = WHEEL_SIZE - 2;

    /** 传送阵入口格位（倒数第二格，永远在）。 */
    public static final int WHEEL_WARP_SLOT = WHEEL_SIZE - 2;

    public static int wheelPagesFor(List<SkillInfo> skills) {
        if (skills == null || skills.isEmpty()) return 1;
        return (skills.size() + WHEEL_PER_PAGE - 1) / WHEEL_PER_PAGE;
    }

    /** 一行技能轮盘：7 技能格 + 传送阵格 + 翻轮格。 */
    public static List<Entry> buildWheel(Config cfg, List<SkillInfo> skills, int page) {
        List<Entry> out = new ArrayList<>(WHEEL_SIZE);
        for (int i = 0; i < WHEEL_SIZE; i++) out.add(Entry.empty(cfg.defaultIcon));
        if (skills != null && !skills.isEmpty() && page >= 0) {
            int from = page * WHEEL_PER_PAGE;
            for (int i = 0; i < WHEEL_PER_PAGE; i++) {
                int at = from + i;
                if (at >= skills.size()) break;
                String id = skills.get(at).id;
                String name = cfg.skillNames.getOrDefault(id, id);
                String icon = cfg.skillIcons.getOrDefault(id, cfg.defaultIcon);
                String lore = cfg.skillLore.getOrDefault(id, "");
                if ("give".equals(id)) {
                    out.set(i, new Entry(Kind.SKILL, id, name, icon, "选一个变出来", null));
                    continue;
                }
                String chant = cfg.chantAlias.getOrDefault(id, name);
                out.set(i, new Entry(Kind.SKILL, id, name, icon, lore, "/mycli cast " + chant));
            }
        }
        // 传送阵入口（永远在倒数第二格）：开 9x3 全面板——第二行是全部传送点。
        // command 走玩家身份（{PLAYER} 由 SkillChestMenu 替换），panel 校验自己==自己放行。
        out.set(WHEEL_WARP_SLOT, new Entry(Kind.WAYPOINT, "waypoints-hub", "传送阵",
                "minecraft:compass", "看看记过的地方", "skillchest panel {PLAYER} 0"));
        int totalPages = wheelPagesFor(skills);
        if (totalPages > 1) {
            boolean hasNext = page + 1 < totalPages;
            out.set(WHEEL_SIZE - 1, hasNext
                    ? new Entry(Kind.MORE, String.valueOf(page + 1), "更多 ▶", cfg.moreIcon,
                            (page + 2) + "/" + totalPages, null)
                    : new Entry(Kind.BACK, "0", "◀ 回头", cfg.backIcon, "回到第1轮", null));
        }
        return out;
    }

    /** MORE/BACK 格：目标页号（entry.id 存的就是目标页）。 */
    public static int navTarget(Entry e) {
        try {
            return Integer.parseInt(e.id);
        } catch (NumberFormatException ex) {
            return 0;
        }
    }

    /** 点击防抖（800ms 默认，孩子手抖连点只执行第一次）。 */
    public static final class Debouncer {
        private final Map<String, Long> last = new HashMap<>();
        private final long ms;

        public Debouncer(long ms) { this.ms = ms <= 0 ? 800 : ms; }

        /** 返回 true = 放行本次。 */
        public synchronized boolean allow(String player) {
            long now = System.currentTimeMillis();
            Long at = last.get(player);
            if (at != null && now - at < ms) {
                return false;
            }
            last.put(player, now);
            return true;
        }

        public synchronized void clear() { last.clear(); }
    }

    private SkillChestLayout() {}
}
