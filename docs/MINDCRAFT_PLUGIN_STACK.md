# Mindcraft 增强插件栈

本项目把 Mindcraft 当作具身执行层。增强插件要先服务于稳定行动，再服务于更复杂的 AI 社会玩法。

## 当前已安装并加载

这些依赖已经在 `C:\Users\lzl19\Documents\mindcraft\package.json` 中存在，并且 `src/utils/mcdata.js` 已经加载：

| 能力 | 插件 | 当前用途 |
| --- | --- | --- |
| 常规寻路 | `mineflayer-pathfinder` | `!goToCoordinates`、跟随、靠近箱子、躲避危险等基础移动。 |
| 采集方块 | `mineflayer-collectblock` | `!collectBlocks`，用于砍树、挖石头、采煤铁。 |
| 自动进食 | `mineflayer-auto-eat` | 低饥饿时自动补食。 |
| 自动装备护甲 | `mineflayer-armor-manager` | 合成或获得护甲后自动穿戴。 |
| 自动选择工具 | `mineflayer-tool` | 挖掘方块时自动换合适工具，避免用剑砍树。 |
| 合成辅助 | `mineflayer-crafting-util` | 简化合成流程。 |
| 战斗 | `mineflayer-pvp` | 自卫和狩猎。 |
| 任务队列 | `mineflayer-task-manager` | 防止多个异步动作互相踩踏。 |
| schematic 建造 | `mineflayer-schem` | 支持从 schematic 文件建造结构，适合后续“标准小屋/仓库/农场”模板。 |
| AI 视角 | `prismarine-viewer` | 每个 bot 的 3D 视角页面和直播观察。 |

## 已安装但暂不默认切换

| 能力 | 插件 | 处理策略 |
| --- | --- | --- |
| 更强寻路 | `@miner-org/mineflayer-baritone` | 依赖已安装，项目里已有 `src/utils/baritone-wrapper.js`，但当前没有默认替换 `mineflayer-pathfinder`。Baritone 支持破坏/放置辅助寻路，适合远距离、复杂地形和脱困；切换前必须单独压测 `goToCoordinates`、采矿、箱子入库、观众直播视角。 |

## 建议新增或产品化的能力

### 标准建筑模板

优先级最高。不要让 LLM 每次凭空生成房子，而是准备一批可复用模板：

- `starter_house_5x5`
- `storage_hut`
- `farm_plot`
- `mine_entrance`
- `watch_tower`
- `resident_room`

接入方式：

1. 把模板保存成 schematic 或内部 blueprint。
2. 控制台提供“建筑任务”表单：模板、朝向、起点、负责人、材料清单。
3. 村长先检查公共箱材料，再派 Luna 建造、Alex 供料、Milo 补石头、Ivy 补木头/羊毛。
4. 建造完成后写入公共设施和居民记忆。

### Baritone 寻路实验模式

目标不是全局替换，而是给特定任务使用：

- 长距离回基地
- 卡住后返回公共箱
- 陆地侦察
- 远距离资源点返回

建议开关：

- `MINDCRAFT_PATHFINDER_ENGINE=classic|baritone`
- 默认 `classic`
- 单个 agent 可覆盖

### 库存可视化

`mineflayer-web-inventory` 可以给单个 bot 开网页库存视图。但控制台已经能通过状态和 RCON 汇总库存，所以它不是第一优先级。更适合直播后台后续做“点开某个居民背包”的专用面板。

## 不建议现在加

- 自动破坏大范围建筑的插件：容易拆坏玩家和居民已有建筑。
- 自动战斗增强插件：当前核心目标是建镇、采矿、生活，不是刷怪效率。
- 高权限 WorldEdit 类插件：适合管理员建图，不适合 AI 居民日常生存。

## 当前落地顺序

1. 先稳定 MCP 和局域网接入。
2. 把全员脱困升级为“确认卡住后村长传送”，避免 `climbToSurface` 跳跃循环。
3. 做标准建筑模板任务，而不是让 LLM 自由发挥大建筑。
4. 给 Baritone 做实验开关，只在压测通过后用于远距离/脱困路径。
5. 最后再考虑库存专用网页和更多直播可视化。
