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

    // T-REG-3：未知技能无图标配置 → default 灰玻璃
    static void tReg3IconFallback() {
        SkillChestLayout.Config cfg = new SkillChestLayout.Config();
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
