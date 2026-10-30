# 智能闪现：MagicSpells 扩展

候选已验证，尚未部署。发布范围和验证见 [2026-10-31 说明](../../docs/SMART_BLINK_20261031.md)。

继续使用 `/mycli cast blink` 或 `/mycli cast 闪现术`。准星指向可站立的安全地面时，优先到该点；没有明确落点时沿水平朝向选择最远的安全地面。25格、4魔力、8秒冷却由原技能配置及Vortex魔力桥管理。失败只给本人原因和改法，不扣费或开始冷却，不在公屏广播。

## 结构

`SmartBlinkSpell` 是官方 [MagicSpells 扩展类加载器](https://github.com/TheComputerGeek2/MagicSpells) 加载的法术类，沿用原施法、目标、传送和成功事件。不是另一个 Bukkit 插件，也没有新的角色、魔力、冷却或任务存档。Beta15 会继续后处理已取消的预施法，本扩展把取消同步到原生 `CANCELLED` 状态，避免拒绝仍收费。

`BlinkLanding` 用 [Bukkit 原生碰撞形状](https://jd.papermc.io/paper/1.21.1/org/bukkit/block/Block.html#getCollisionShape()) 检查整个站立身体、真实支撑高度、世界边界和眼部路径。半砖按实际高度处理；禁止封闭天花板穿越、穿墙和危险地面。前向候选按半格采样，优先较远位置及接近原高度的支撑；总位移不超过范围。每次至多读取4096个已加载方块，过于复杂或未加载时明确拒绝，不生成区块或修改地形。没有实体伤害豁免。

## 自建服务器

需要 JDK21、Python3、Minecraft1.21.1/Paper兼容API和 MagicSpells4.0-Beta-15。为明确依赖，构建从传入的服务器目录读取 `libraries` 和 `plugins`，不自动读取家服位置。

```text
python build.py --server /your/server --jdk /your/jdk21 --output /new/output --addon-only
```

把产物 `QiandengjiSmartBlink-0.1.0.jar` 放入 **`plugins/MagicSpells/` 数据目录**，不要放入顶层 `plugins/`。将原 blink 的 `spell-class` 改为 `org.qiandengji.magic.SmartBlinkSpell`，其他法术配置保留，再正常重启。千灯纪原生魔力桥负责4魔力，自建服需自行保持原 MagicSpells 成本配置；扩展不单独建立魔力系统。外部只安装扩展不会自动获得千灯纪的 `/mycli` 和职业玩法。

不带 `--addon-only` 的模式仅供本轮生产维护：必须是固定SHA的现役AF.37，生成AF.38的三方法窄补丁、扩展及仅改blink段的配置，避免将仓库内尚未发布的其他玩法混入家服。不是通用自建包。

## 验证

- `tests/BlinkLandingUnavailableTest.java`：未加载世界不读方块、不请求区块，不接受无效显式位置。
- `tests/BlinkFixture.java` 和 `tests/stage.mjs`：真实Mineflayer身体、耗魔、冷却及取消事件；仅允许标记匹配的127.0.0.1:29397隔离服，QA夹具不得发往生产。
- `../../ops/tests/content-smart-blink*.test.ps1`：精确安装路径白名单和真实E:/C:安装、回退、运行中及前像变更拒绝。

扩展源码和随包完整许可证使用GPL-3.0-or-later，见 [COPYING](COPYING)；不改变仓库其他独立组件的许可证。
