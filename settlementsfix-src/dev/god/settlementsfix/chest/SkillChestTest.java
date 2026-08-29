package dev.god.settlementsfix.chest;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * 宝箱技能面板 · 纯逻辑单测（docs/skill-chest-design.md §5.1）。
 *
 * 运行：java -cp <settlementsfix-classes>:<gson> dev.god.settlementsfix.chest.SkillChestTest
 * （需要 gson 在 cp——CI 提供，本地从 mc-server/libraries 取。）
 * 断言失败 → System.exit(1)；全过 → 打印 PASS 总数 exit 0。
 *
 * 覆盖：T-REG-1 布局落格 / T-REG-2 分页 / T-REG-3 图标回退 /
 *       T-REG-4 坏配置兜底 / T-REG-5 防抖 / T-REG-6 咒语词映射 / T-IO-* 运行态聚合。
 */
public final class SkillChestTest {

    private static int passed = 0;
    private static int failed = 0;

    public static void main(String[] args) throws Exception {
        tReg1Layout();
        tReg2Paging();
        tReg3IconFallback();
        tReg4BadConfig();
        tReg5Debounce();
        tReg6ChantAlias();  // 合并 T-IO：load 聚合+未入册兜底
        tItemsGrid();       // 造物扩展（2026-08-30）：子面板网格+造物格特判
        tWheel();           // 技能轮盘（2026-08-30）：9x1 一行 8 技能+翻轮
        System.out.println("passed=" + passed + " failed=" + failed);
        if (failed > 0) {
            System.exit(1);
        }
    }

    // T-REG-1：8 技能 + 9 传送 → 行0 8格技能+末格空（单页无翻页），行1 8格传送+末格空
    static void tReg1Layout() {
        SkillChestLayout.Config cfg = new SkillChestLayout.Config();
        cfg.skillNames.put("s1", "螺旋丸");
        cfg.skillIcons.put("s1", "minecraft:snowball");
        cfg.chantAlias.put("s1", "螺旋丸");
        List<SkillChestLayout.SkillInfo> sk = new ArrayList<>();
        for (int i = 0; i < 8; i++) sk.add(new SkillChestLayout.SkillInfo("s" + (i + 1)));
        List<SkillChestLayout.WaypointInfo> wp = new ArrayList<>();
        for (int i = 0; i < 9; i++) wp.add(new SkillChestLayout.WaypointInfo(i + 1, "点" + (i + 1)));
        List<SkillChestLayout.Entry> out = SkillChestLayout.build(cfg, sk, wp, 0);

        eq("T-REG-1 size", 27, out.size());
        eq("T-REG-1 r0c0 kind", SkillChestLayout.Kind.SKILL, out.get(0).kind);
        eq("T-REG-1 r0c0 name", "螺旋丸", out.get(0).name);
        eq("T-REG-1 r0c0 cmd", "/mycli cast 螺旋丸", out.get(0).command);
        eq("T-REG-1 r0c7 kind", SkillChestLayout.Kind.SKILL, out.get(7).kind);
        eq("T-REG-1 单页末格无翻页", SkillChestLayout.Kind.EMPTY, out.get(8).kind);
        eq("T-REG-1 r1c0 kind", SkillChestLayout.Kind.WAYPOINT, out.get(9).kind);
        eq("T-REG-1 r1c0 cmd 序号", "/mycli 传送去 1", out.get(9).command);
        eq("T-REG-1 r1c8 第9点不显示", SkillChestLayout.Kind.EMPTY, out.get(17).kind);
        eq("T-REG-1 行2 全空", SkillChestLayout.Kind.EMPTY, out.get(18).kind);
        eq("T-REG-1 行2 末空", SkillChestLayout.Kind.EMPTY, out.get(26).kind);
    }

    // T-REG-2：11 技能 → 首页 8+更多（id=目标页1），第二页 3+返回（id=0）
    static void tReg2Paging() {
        SkillChestLayout.Config cfg = new SkillChestLayout.Config();
        List<SkillChestLayout.SkillInfo> sk = new ArrayList<>();
        for (int i = 0; i < 11; i++) sk.add(new SkillChestLayout.SkillInfo("x" + i));
        eq("T-REG-2 pagesFor 11 -> 2", 2, SkillChestLayout.pagesFor(sk));
        List<SkillChestLayout.Entry> p0 = SkillChestLayout.build(cfg, sk, null, 0);
        eq("T-REG-2 p0 末格 MORE", SkillChestLayout.Kind.MORE, p0.get(8).kind);
        eq("T-REG-2 p0 MORE 目标页", 1, SkillChestLayout.navTarget(p0.get(8)));
        List<SkillChestLayout.Entry> p1 = SkillChestLayout.build(cfg, sk, null, 1);
        eq("T-REG-2 p1 c2=第11技", SkillChestLayout.Kind.SKILL, p1.get(2).kind);
        eq("T-REG-2 p1 c3 空", SkillChestLayout.Kind.EMPTY, p1.get(3).kind);
        eq("T-REG-2 p1 末格 BACK", SkillChestLayout.Kind.BACK, p1.get(8).kind);
        eq("T-REG-2 p1 BACK 目标页", 0, SkillChestLayout.navTarget(p1.get(8)));
        eq("T-REG-2 9技也两页", 2, SkillChestLayout.pagesFor(
                java.util.Arrays.asList(new SkillChestLayout.SkillInfo("a"),
                        new SkillChestLayout.SkillInfo("b"), new SkillChestLayout.SkillInfo("c"),
                        new SkillChestLayout.SkillInfo("d"), new SkillChestLayout.SkillInfo("e"),
                        new SkillChestLayout.SkillInfo("f"), new SkillChestLayout.SkillInfo("g"),
                        new SkillChestLayout.SkillInfo("h"), new SkillChestLayout.SkillInfo("i"))));
        eq("T-REG-2 0技一页", 1, SkillChestLayout.pagesFor(new ArrayList<>()));
    }

    // T-WHEEL（2026-08-30 轮盘）：9 格一行=8 技能+翻轮；页数=⌈n/8⌉
    static void tWheel() {
        SkillChestLayout.Config cfg = new SkillChestLayout.Config();
        cfg.skillNames.put("s1", "螺旋丸");
        cfg.chantAlias.put("s1", "螺旋丸");
        List<SkillChestLayout.SkillInfo> sk9 = new ArrayList<>();
        for (int i = 0; i < 9; i++) sk9.add(new SkillChestLayout.SkillInfo("s" + (i + 1)));
        eq("T-WHEEL wheelPagesFor 9 -> 2", 2, SkillChestLayout.wheelPagesFor(sk9));
        eq("T-WHEEL wheelPagesFor 8 -> 1", 1, SkillChestLayout.wheelPagesFor(
                java.util.Arrays.asList(new SkillChestLayout.SkillInfo("a"),
                        new SkillChestLayout.SkillInfo("b"), new SkillChestLayout.SkillInfo("c"),
                        new SkillChestLayout.SkillInfo("d"), new SkillChestLayout.SkillInfo("e"),
                        new SkillChestLayout.SkillInfo("f"), new SkillChestLayout.SkillInfo("g"),
                        new SkillChestLayout.SkillInfo("h"))));
        List<SkillChestLayout.Entry> w0 = SkillChestLayout.buildWheel(cfg, sk9, 0);
        eq("T-WHEEL size", 9, w0.size());
        eq("T-WHEEL c0 name", "螺旋丸", w0.get(0).name);
        eq("T-WHEEL c0 cmd", "/mycli cast 螺旋丸", w0.get(0).command);
        eq("T-WHEEL c7 第8技", SkillChestLayout.Kind.SKILL, w0.get(7).kind);
        eq("T-WHEEL c8 MORE", SkillChestLayout.Kind.MORE, w0.get(8).kind);
        eq("T-WHEEL MORE 目标页", 1, SkillChestLayout.navTarget(w0.get(8)));
        List<SkillChestLayout.Entry> w1 = SkillChestLayout.buildWheel(cfg, sk9, 1);
        eq("T-WHEEL p1 c0 第9技", SkillChestLayout.Kind.SKILL, w1.get(0).kind);
        eq("T-WHEEL p1 c1 空", SkillChestLayout.Kind.EMPTY, w1.get(1).kind);
        eq("T-WHEEL p1 c8 BACK", SkillChestLayout.Kind.BACK, w1.get(8).kind);
        eq("T-WHEEL BACK 目标页", 0, SkillChestLayout.navTarget(w1.get(8)));
        // 8 技整：单页、末格无翻页
        List<SkillChestLayout.SkillInfo> sk8 = new ArrayList<>(sk9.subList(0, 8));
        List<SkillChestLayout.Entry> wOnly = SkillChestLayout.buildWheel(cfg, sk8, 0);
        eq("T-WHEEL 8技单页末格空", SkillChestLayout.Kind.EMPTY, wOnly.get(8).kind);
        // 越界页安全
        List<SkillChestLayout.Entry> wBad = SkillChestLayout.buildWheel(cfg, sk8, 5);
        eq("T-WHEEL 越界页不炸", 9, wBad.size());
    }

    // T-REG-3：未知技能无图标配置 → default 灰玻璃
    static void tReg3IconFallback() {        SkillChestLayout.Config cfg = new SkillChestLayout.Config();
        List<SkillChestLayout.Entry> out = SkillChestLayout.build(cfg,
                java.util.Arrays.asList(new SkillChestLayout.SkillInfo("unknown_spell")), null, 0);
        eq("T-REG-3 fallback icon", "minecraft:gray_stained_glass_pane", out.get(0).icon);
        eq("T-REG-3 未知技能名回退id", "unknown_spell", out.get(0).name);
        // T-REG-6 顺带：无别名时 chant=中文名（回退 id）
        eq("T-REG-3 chant 回退", "/mycli cast unknown_spell", out.get(0).command);
    }

    // T-REG-4：坏 JSON 配置 → 默认布局不崩
    static void tReg4BadConfig() throws Exception {
        Path tmp = Files.createTempFile("skill-chest-bad", ".json");
        Files.writeString(tmp, "{ not valid json !!!", StandardCharsets.UTF_8);
        SkillChestLayout.Config cfg = SkillChestIO.loadConfig(tmp);
        eq("T-REG-4 坏json默认图标", "minecraft:gray_stained_glass_pane", cfg.defaultIcon);
        eq("T-REG-4 坏json防抖默认", 800L, cfg.debounceMs);
        Files.deleteIfExists(tmp);
        // 不存在文件
        SkillChestLayout.Config cfg2 = SkillChestIO.loadConfig(Path.of("Z:/no/such/file.json"));
        eq("T-REG-4 缺文件不崩", "minecraft:barrier", cfg2.closeIcon);
    }

    // T-REG-5：防抖 800ms 内第二次点击被吞
    static void tReg5Debounce() {
        SkillChestLayout.Debouncer d = new SkillChestLayout.Debouncer(800);
        ok("T-REG-5 首点放行", d.allow("MengMeng"));
        ok("T-REG-5 连点吞掉", !d.allow("MengMeng"));
        ok("T-REG-5 他人不受影响", d.allow("Kirito"));
        d.clear();
        ok("T-REG-5 清后放行", d.allow("MengMeng"));
    }

    // T-REG-6：atoms words[0] 优先作咒语词（与书页 /mycli cast 同词）
    static void tReg6ChantAlias() throws Exception {
        Path tmp = Files.createTempDirectory("skillchest-io");
        Files.writeString(tmp.resolve("magic-atoms.json"), """
            {"atoms":[{"id":"rasengan","name":"螺旋丸","words":["螺旋丸","spx"],"cost":{"mana":10},"requiredLevel":0}]}
            """, StandardCharsets.UTF_8);
        Files.writeString(tmp.resolve("magic-state.json"), """
            {"players":{"Kirito":{"mana":100,"maxMana":151,"learned":["rasengan"]}}}
            """, StandardCharsets.UTF_8);
        Files.writeString(tmp.resolve("waypoints.json"), """
            {"shared":[{"name":"村庄广场"}],"players":{"Kirito":[{"name":"我家"}]}}
            """, StandardCharsets.UTF_8);
        SkillChestIO.PanelData pd = SkillChestIO.load(
                tmp.resolve("magic-state.json"), tmp.resolve("magic-atoms.json"),
                tmp.resolve("waypoints.json"), null, "Kirito");
        eq("T-REG-6 技能数", 1, pd.skills.size());
        eq("T-REG-6 魔力", 100, pd.mana);
        List<SkillChestLayout.Entry> out = SkillChestLayout.build(pd.config, pd.skills, pd.waypoints, 0);
        eq("T-REG-6 cast 咒语词=words[0]", "/mycli cast 螺旋丸", out.get(0).command);
        eq("T-REG-6 lore 含耗魔", true, out.get(0).lore.contains("10"));
        eq("T-REG-6 传送点数 shared+personal", 2, pd.waypoints.size());
        eq("T-REG-6 传送序号全局连续", 2, pd.waypoints.get(1).index);
        eq("T-REG-6 传送命令序号", "/mycli 传送去 2", out.get(10).command);
        // IO：玩家不在册 → 空面板不崩
        SkillChestIO.PanelData nobody = SkillChestIO.load(
                tmp.resolve("magic-state.json"), tmp.resolve("magic-atoms.json"),
                tmp.resolve("waypoints.json"), null, "Nobody");
        eq("T-REG-6 未入册0技", 0, nobody.skills.size());
        eq("T-REG-6 未入册共享点仍在", 1, nobody.waypoints.size());
        // 清理
        for (String f : new String[]{"magic-atoms.json", "magic-state.json", "waypoints.json"}) {
            Files.deleteIfExists(tmp.resolve(f));
        }
        Files.deleteIfExists(tmp);
    }

    // 造物扩展（2026-08-30）：造物子面板网格 + 主面板 give 格特判 + items 配置解析
    static void tItemsGrid() throws Exception {
        // 子面板：76 物 → 3 页（26/页）；物品格命令=造物咒语；数量进 lore
        SkillChestLayout.Config cfg = new SkillChestLayout.Config();
        List<SkillChestLayout.GiveItem> items = new ArrayList<>();
        for (int i = 0; i < 76; i++) items.add(new SkillChestLayout.GiveItem("物" + i, "item_" + i, i % 4 == 0 ? 1 : 4));
        eq("T-ITEM pages 76 -> 3", 3, SkillChestLayout.itemPagesFor(items));
        List<SkillChestLayout.Entry> p0 = SkillChestLayout.buildItemGrid(cfg, items, 0);
        eq("T-ITEM p0 size", 27, p0.size());
        eq("T-ITEM p0 c0 kind", SkillChestLayout.Kind.ITEM, p0.get(0).kind);
        eq("T-ITEM p0 c0 cmd", "/mycli cast 造物 物0", p0.get(0).command);
        eq("T-ITEM p0 c25 kind", SkillChestLayout.Kind.ITEM, p0.get(25).kind);
        eq("T-ITEM p0 c26 MORE", SkillChestLayout.Kind.MORE, p0.get(26).kind);
        eq("T-ITEM count=1 无数量词", "一次 1 个", p0.get(0).lore);
        eq("T-ITEM count=4 lore", "一次 4 个", p0.get(1).lore);
        List<SkillChestLayout.Entry> p2 = SkillChestLayout.buildItemGrid(cfg, items, 2);
        eq("T-ITEM p2 c23=第76物", SkillChestLayout.Kind.ITEM, p2.get(23).kind);
        eq("T-ITEM p2 c24 空", SkillChestLayout.Kind.EMPTY, p2.get(24).kind);
        eq("T-ITEM p2 末格 BACK", SkillChestLayout.Kind.BACK, p2.get(26).kind);
        // 主面板 give 格特判：command=null（点击开子面板而非施法）
        SkillChestLayout.Config cfg2 = new SkillChestLayout.Config();
        cfg2.skillNames.put("give", "造物术");
        cfg2.skillIcons.put("give", "minecraft:chest");
        List<SkillChestLayout.Entry> main = SkillChestLayout.build(cfg2,
                java.util.Arrays.asList(new SkillChestLayout.SkillInfo("give"),
                        new SkillChestLayout.SkillInfo("heal")), null, 0);
        eq("T-ITEM give 格 command=null（开子面板）", null, main.get(0).command);
        eq("T-ITEM give 格 lore", "选一个变出来", main.get(0).lore);
        eq("T-ITEM 非 give 技能照常施法", "/mycli cast heal", main.get(1).command.replace("{PLAYER} ", "").replace("  ", " "));
        // items 配置解析：坏段跳过不炸
        Path tmp = Files.createTempFile("skill-chest-items", ".json");
        Files.writeString(tmp, "{\"items\":[{\"cn\":\"火把\",\"icon\":\"torch\",\"count\":4},{\"bad\":1},{\"cn\":\"煤\",\"icon\":\"coal\"}]}",
                StandardCharsets.UTF_8);
        SkillChestLayout.Config cfg3 = SkillChestIO.loadConfig(tmp);
        eq("T-ITEM items 解析 2 条（坏条跳过）", 2, cfg3.giveItems.size());
        eq("T-ITEM 火把 count", 4, cfg3.giveItems.get(0).count);
        eq("T-ITEM 煤 缺 count 默认 1", 1, cfg3.giveItems.get(1).count);
        Files.deleteIfExists(tmp);
    }

    static void eq(String what, Object expect, Object got) {
        if (expect == null ? got == null : expect.equals(got)) {
            passed++;
        } else {
            failed++;
            System.out.println("FAIL " + what + ": expect=" + expect + " got=" + got);
        }
    }

    static void ok(String what, boolean cond) {
        if (cond) passed++; else { failed++; System.out.println("FAIL " + what); }
    }

    private SkillChestTest() {}
}
