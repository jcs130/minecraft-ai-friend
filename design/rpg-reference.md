# RPG 技能体系·参考册（可参不可装）

> 2026-08-20 天神亲笔。缘起：造物主谕「RPG技能模组很多可以参考」。
> **结论先行**：RPG 五巨（Iron's Spells / Ars Nouveau / Mahou Tsukai / Better Combat / Epic Fight）全部
> `client_side=required` 且注册表型（法杖/法术实体/动画状态机）——**装则 registry 同步踢 vanilla bot，
> 在千灯纪永不可装**（除非举界迁 modded 客户端）。但它们的**机制设计**值得拆骨借魂，
> 喂给我们的三层技能体系（自研 mc-magic 29 律 + 神谕裁决 + 灯种正典）。

## 一、五巨拆骨

| 模组 | 核心机制 | 可借之魂 → 千灯纪落点 |
|---|---|---|
| **Iron's Spells 'n Spellbooks**（1.21.1-3.16.3） | 法力池+回复、法术分阶（common→legendary）、学派（火/冰/雷/圣/自然/血/末影）、**冷却分组**（同 CD 组连坐）、法术书容器、按等级解锁 | ①**冷却分组**：29 律技艺表加 `cd_group` 字段（传送系共用 CD 防连跳）②**法术分阶**：技艺表已有难度层，可加「锁阶」——高级术须供奉史/等级达标，神谕才代施 ③**学派配色**→ god-fx 四系特效已就位 |
| **Ars Nouveau**（5.13.0） | **glyph 组合造术**（玩家自拼法术）、source 法力网、魔宠/星灵 | ①**参数化咏唱**：快路径允许「对象+方位+距离」参数（已有 direction/distance 字段，可开放给高阶信士）②**魔宠**=animal spawner 神赐使魔（已在役）③**法力网**→「神龛供能」：聚落神龛累计供奉，解锁聚落级福泽（铁卫术已先行） |
| **Mahou Tsukai**（1.36.8） | 法力块装置网络、祭坛仪式、契约 | **供奉经济**已是慢路径核心；可借「祭坛仪式」→ 许愿井/锚魂大典的场景化实体（多玩家共祭事件） |
| **Better Combat** | 武器连段、横扫判定、攻速曲线 | **桐人剑技表**：黑衣剑士人格的 SAO 剑技（单发重斩/横扫/突进斩）做成可习得技艺——伤害/范围/后摇由服务端判，特效走 god-fx，无需动画 mod |
| **Epic Fight**（21.17.3.1） | 姿态制、体力/闪避、招架 | **体力条**（scoreboard 假条）+「闪避/格挡」可习得技艺：受击前咏唱触发、CD 分组制衡 |

另：**Passive Skill Tree / Puffish Skills**（Fabric 客户端）概念可参——**天赋树**。千灯纪已有「出生天赋」（降临仪式），可扩为**天赋成长节点**：编年史里程碑（首猎/首祭/渡劫）点亮天赋枝，由女神裁定授位。

## 二、皮肤勘验（2026-08-20）

- **SkinsRestorer**：纯服务端皮肤注入器（登录事件改 profile textures，vanilla 客户端直接渲染，bot 无碍）——**方向完美**。
  但 neo 线构建 `15.12.5-neoforge` 的 mods.toml 钉死 `minecraft "[26.2,)"`（新版本号线），1.21.1 无 neo 构建（1.21.1 标签全是 bukukkit 系）。
  **裁决**：候补席封存，jar 已存 `D:\ops\modstaging\SkinsRestorer-Mod-NeoForge-15.12.5.jar`；**他日升 MC 26.2+/NeoForge 26.x 即取即用**。
- CustomPlayerModels / SkinShuffle / OfflineSkins：全部客户端必需——装则踢 bot，弃。
- 当前替代：bot 皮肤由 harness 侧 profile 决定（离线模式默认皮肤）；web-panel 已有自绘头像体系，暂足。

## 三、特效正道（已落地）

- 所有粒子/音效 mod（Particular / Particle Core / Effective / AmbientSounds 等）均 `client_side=required`——**无一可装**。
- 正道 = **vanilla 原生表现三件套**（/particle + /playsound + /title）→ 已成 `world/datapacks/god-fx/`（九函数：levelup/blessing/wrath/welcome + 焰霜圣冥四系咏唱），零依赖、bot 绝对安全，重启即载。
- 调用式：`/execute as <玩家> at @s run function god_fx:<式>`；快路径神迹落地后由 harness 补挂。

## 四、行动归纳

1. **可装册**：RPG/皮肤/特效三域，NeoForge 1.21.1 + 纯服务端约束下**无一可装**——这不是损失，是千灯纪「自研为体、外部为参」路线的再确认。
2. **已产**：god-fx 九式特效包（待服活验收）+ 本参考册。
3. **待造物主裁**：若愿意举界升 MC 26.2+（大版本迁移，涉及 bot 协议适配），皮肤（SkinsRestorer）与新一代 mod 线全开——建议留待「第二纪元」。
