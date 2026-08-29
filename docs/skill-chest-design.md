# 设计文档：宝箱技能面板（SkillChest）

> 版本 v1.0 · 2026-08-30 · 造物主拍板：萌萌（5 岁，PC Java + 手柄）专属交互升级
> 状态：已批准开工 · 工程分两期（一期技能+传送，二期按实测反馈迭代）

## 0. 一句话

右键 ✦书匣（或说「技能」）→ 弹出一个 27 格箱子界面，技能/传送点都是**图标物品**；
**十字键上下左右选格子、RT/A 确认** → 自动关箱 → 施法/传送。手柄原生导航，零识字要求，
vanilla 客户端零安装。

## 1. 背景与动机

- 萌萌是重点看护对象：5 岁、PC Java 客户端、手柄输入、识字量有限。设计铁律
  「零读字、零打字、手柄可完成」。
- 现有施法路径：✦书翻页点文字行（clickEvent）——手柄要移虚拟光标点小字，对 5 岁孩子精度差；
  语音祈愿——依赖语音识别与女神在线。
- Java 版**容器界面（箱子）自带十字键/摇杆格子导航 + RT 确认**，与「选物品」同款操作，
  孩子天天在用 → 本设计将其作为技能选择的载体。
- 服务端全控：不需要客户端 mod；vanilla/基岩(Geyser)客户端均可点。

## 2. 目标与非目标

**目标**
1. G1 手柄友好：十字键移动高亮、RT 确认，全程不开聊天框、不点文字。
2. G2 零识字：图标物品为主，物品名 tooltip 为辅（可选阅读）。
3. G3 与既有体系复用：点击动作最终走 `/mycli` 服务端命令（与书页点击同链路），
   不另造施法后端。
4. G4 每个功能有测试、CI 有 gate（造物主明确要求）。
5. G5 布局数据驱动：技能/传送点清单来自 magic-state + waypoints.json（运行态），
   不硬编码在 Java 里。

**非目标**
- 不做自定义 MenuType（vanilla 客户端没有对应 screen 会崩——必须用 vanilla
  `generic_9x3`）。
- 不做拖拽/shift 快移等花哨交互；点击即确认。
- 不改书页体系（书页保留：看状态、翻目录、领书参悟）。

## 3. 交互设计

### 3.1 触发（三种，渐进）
| 触发 | 路径 | 备注 |
|---|---|---|
| T1 右键 ✦书匣物品 | SkillBookUseMixin 已拦 use；书匣（custom_data skillbox=panel）时不再发书，改开面板 | 主通道，物理直觉 |
| T2 说「技能」/「打开技能」 | mc-god 聊天监听 → RCON `skillchest open <player>` | 语音友好（萌萌主输入=说话） |
| T3 服务端命令 `/skillchest open <player>` | RCON/OP 用 | 测试与女神代开 |

### 3.2 布局（27 格，三行九列）
```
行0: [技能×8]  [?翻更多/关闭]
行1: [传送点×8] [?]
行2: （预留二期：帮助/收纳/宠物…）
```
- 每格 = 物品图标 + `display.Name`（中文名）+ lore（一行说明：耗魔/等级/坐标）。
- 图标映射（数据文件配置，可调）：
  螺旋丸=snowball · 火球=fire_charge · 圣愈=glistering_melon_slice · 归乡=compass ·
  照明=glowstone_dust · 传送点=nether_star · 更多/关闭=barrier。
- 超过 8 个技能：行0 末格「更多」→ 翻页（重开面板换页）。
- 空格 = 灰色玻璃板（gray_stained_glass_pane），点了没反应。

### 3.3 确认与执行
1. 点技能格 → 关箱 → `performCommand("/mycli cast <player> <咒语词>")`
   （书页同款；施法成败的反馈走既有私语/title/particle 通道）。
2. 点传送格 → 关箱 → `performCommand("/mycli goto <player> <序号|名字>")`
   （复用传送阵页的 goto 动词）。
3. 防抖：同玩家 0.8s 内多次点击只执行第一次（孩子手抖连点）。
4. 施法冷却/魔力不足等失败信息由 mycli 既有回执链走私语+actionbar——**不改**。

## 4. 技术设计

### 4.1 组件与代码落点
| 组件 | 位置 | 职责 |
|---|---|---|
| SkillChestMenu | `settlementsfix-src/dev/god/settlementsfix/chest/SkillChestMenu.java` | 继承 vanilla `ChestMenu`（MenuType.GENERIC_9x3），覆写 `clicked`：拦下点击→关箱→执行命令；不真的拿物品 |
| SkillChestRegistry | 同包 `SkillChestRegistry.java` | 从 `/mcdata/skill-chest.json` 读布局配置（图标映射/行列语义）；含 JSON 校验与默认布局 |
| SkillChestCommand | 同包 `SkillChestCommand.java` | 注册 `/skillchest open <player>`（OP）；构造 SkillChestMenu 并 `player.openMenu` |
| SkillChestLiveInfo | 同包 `SkillChestLiveInfo.java` | 开面板瞬间读 `/mcdata/magic-state.json`（已学技能+魔力）与 `/mcdata/waypoints.json`（共享+个人传送点），动态决定格子内容 |
| SkillBookUseMixin 扩展 | 现有 mixin | ✦书匣右键分支：`custom_data.skillbox == "panel"` → 开面板（原发书逻辑不动） |

### 4.2 关键技术决策
- **vanilla MenuType.GENERIC_9x3**：客户端零 mod。服务端构造 `new ChestMenu(
  MenuType.GENERIC_9x3, containerId, playerInv, container(27), 3)` 子类；openMenu 走
  NeoForge `ServerPlayer.openMenu(MenuProvider, buf)`（buf 写 dummy pos 即可，
  vanilla 客户端 chest screen 不读 pos）。
- **点击处理**：覆写 `clicked(ItemStack, int slot, int button, ClickType)`——所有
  ClickType 直接 `broadcastChanges + player.closeContainer()`（或记 pending 动作，
  在 `removed` 时执行——避免在 menu 回调里直接 performCommand 的重入问题，
  先用直接执行+0.8s 防抖，若实测重入再加 pending 队列）。
- **不落任何物品到玩家背包**：格内物品是 `SimpleContainer` 内存数据；`clicked` 不调
  `super.clicked`（不做拿取），防止把「技能图标」真拿走。
- **数据双卷铁律**：布局配置读 `/mcdata`（mixin 卷，容器内路径同 spell-requests），
  与 skillbook/waypoints 一致；仓库正本进 `packaging/mc-world/assets/data/`，
  部署脚本同步。**修改配置五份同步**（见 LESSONS 双卷坑）。
- **命令执行上下文**：`server.getCommands().performPrefixedCommand(source, cmd)`，
  source = `server.createCommandSourceStack().withSuppressedOutput()`
  （静默，不刷屏）。命令以 OP 权限跑（内部命令，非玩家输入，无注入面；
  玩家名/咒语词经 Brigadier 字面参数传入）。

### 4.3 数据流
```
玩家右键书匣 / 说"技能" / RCON skillchest open
        │
        ▼
SkillChestCommand ──► SkillChestLiveInfo（读 magic-state + waypoints + skill-chest.json）
        │                      │
        ▼                      ▼
player.openMenu ◄── SkillChestRegistry.buildLayout(已学技能, 传送点, 页号)
        │
        ▼
vanilla 客户端渲染箱子（27 格图标）—— 十字键导航 + RT 确认
        │
        ▼
SkillChestMenu.clicked(slot) ──► 防抖 ──► closeContainer
        │
        ▼
performCommand("/mycli cast MengMeng 螺旋丸")  ←（书页同款，已验证链路）
        │
        ▼
既有施法链：mc-magic 结算 → 粒子/音效/私语回执
```

### 4.4 配置文件（skill-chest.json）
```json
{
  "version": 1,
  "icons": {
    "default": "minecraft:gray_stained_glass_pane",
    "close": "minecraft:barrier",
    "more": "minecraft:paper",
    "skill": { "rasengan": "minecraft:snowball", "fireball": "minecraft:fire_charge",
               "heal": "minecraft:glistering_melon_slice", "home": "minecraft:compass" },
    "waypoint": "minecraft:nether_star"
  },
  "chantAlias": { "rasengan": "螺旋丸", "fireball": "火球术", "heal": "圣愈术" },
  "debounceMs": 800,
  "rows": { "0": "skills", "1": "waypoints", "2": "reserved" }
}
```
- `icons.skill` 缺项回退 `default`；`chantAlias` 把 atom id 映射到咒语词（cast 用词）。
- 面板只展示**已学习**技能（magic-state.learned ∩ atoms 可施法）。

## 5. 测试计划（每个功能可测）

### 5.1 单元测试（Java，JUnit 不引入——用轻量 main 断言，进 CI）
`settlementsfix-src/test/chest/SkillChestTest.java`（纯逻辑，不依赖 server runtime）：
- T-REG-1 布局构建：8 技能+9 传送 → 行0/行1 正确落格、行2 全空格。
- T-REG-2 分页：11 技能 → 首页 8+「更多」，第二页 3+「返回」。
- T-REG-3 图标回退：未知技能 id → default 图标。
- T-REG-4 配置解析：坏 JSON → 默认布局不崩。
- T-REG-5 防抖：800ms 内两次点击 → 第二次被吞。
- T-REG-6 咒语词映射：atom id → chantAlias 词（cast 参数正确性）。
- 运行方式：`java -cp settlementsfix-classes SkillChestTest`（javac 管线同款，
  CI 用 setup-java 21 跑；断言失败 exit 1）。

### 5.2 集成测试（部署后 RCON 驱动，脚本化）
`ops/test-skill-chest.py`（Python+RCON，幂等，供 CI nightly 与本地跑）：
- T-E2E-1 开面板：`skillchest open Kirito` → `data get` Kirito `CurrentWindow`/openContainer
  断言（或日志 `[settlementsfix] skill chest opened for Kirito`）。
- T-E2E-2 点击施法：模拟点击（服务端侧测试钩子命令 `skillchest click <player> <slot>`，
  仅测试模式注册）→ 断言 shadow-world 日志出现 `cast rasengan by Kirito`。
- T-E2E-3 点击传送：slot=行1 首格 → Kirito Pos 变为村庄广场。
- T-E2E-4 防抖连点：两次 click 同 slot → 日志 cast 只出现一次。
- T-E2E-5 vanilla 兼容：面板打开时（若有人工客户端）无 payload 异常——CI 中以
  日志 grep `UnsupportedOperationException|payload` 兜底。

### 5.3 CI gate（GitHub Actions，扩展现有 ci.yml）
- 新 job `settlementsfix`：checkout → setup-java 21 → javac（复用 settlementsfix-src
  的 javac-args 模式，脚本 `settlementsfix-src/build-ci.sh` 从 `mc-server/libraries`
  组 classpath——**CI 环境无 mc-server 库 → 仓库内提供 `settlementsfix-src/vendor-libs.md`
  清单 + setup 步骤从 Mojang/NeoForge 官方 URL 下载**（版本钉死 21.1.73/1.21.1，
  sha256 校验）；跑 SkillChestTest → 失败即红。
- 现 17 node/py 测试不动；Java job 与 unit job 并行。

## 6. 里程碑
- M1 设计文档（本文档）评审通过 —— 造物主已拍板。
- M2 Java 三件套 + 单测（T-REG-*）绿 + CI settlementsfix job 上线。
- M3 部署 shadow-mc，集成测试（T-E2E-*）全绿，Kirito 冒烟。
- M4 萌萌实测（她上线时）：观察十字键导航顺畅度、图标辨识度，收集反馈。
- M5 二期迭代候选（不承诺）：技能物品球（手持 RT 即施法）、行2 功能位、
  基岩访客适配验证。

## 7. 风险与对策
| 风险 | 对策 |
|---|---|
| openMenu 对 vanilla 客户端行为不符预期（Geyser/基岩） | 先在 Java vanilla 验证；Geyser 单独列 M5 |
| clicked 里直接 performCommand 重入/崩 | 防抖+try/catch 全包+日志；必要时改 pending 队列（removed 时执行） |
| 技能多于一页萌萌迷路 | 默认只放她已学的前 8 个常用（配置 `pinned` 列表可钉） |
| 书匣右键语义变化（原来是发书） | custom_data 区分：`skillbox=panel` 才开面板；存量书匣不受影响 |
| CI 需下载 MC 官方库 | 版本+sha256 钉死，下载失败 CI 显式红（不静默跳过） |
