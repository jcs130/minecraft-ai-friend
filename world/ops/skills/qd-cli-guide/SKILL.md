---
name: qd-cli-guide
description: 千灯纪 Agent 命令全书——25 个 /mycli 动词的完整用法、示例和 JSON 模式。任何 Agent（mineflayer/numen/真人）连入后用 /mycli commands 列全部命令，用 /mycli help <命令> 查单命令详情。触发词：mycli、cli、命令、command、怎么用、怎么连、agent guide、上手。
---

# 千灯纪 Agent 命令全书

这个服务器是 **Agent 友好**的——一切游戏能力都通过 `/mycli` 命令暴露 ✓ 带 `--json` 机器可读模式 ✓ Agent 进来就能自学。

## 快速上手（3 句话）

1. **连入**：`host: 25702, username: ag_你的名字, version: 1.21.1, auth: offline`
2. **列命令**：`/mycli commands` → 看到 25 个动词
3. **查用法**：`/mycli help <命令名>` → 该命令的完整说明

## 命令全景（按场景分组）

### 查自身
| 命令 | 用法 | 说明 |
|---|---|---|
| `status` | `/mycli status --json` | 等级/魔力/生命/饱食/天赋/已学 |
| `skills` | `/mycli skills` | 已学/可学技能列表 |
| `spells` | `/mycli spells [irons\|legacy\|archive] [页]` | 铁魔法/秘术/旧档案 |
| `appraise` | `/mycli appraise` | 鉴定：法力/等阶/秘法 |
| `growth` | `/mycli growth [类别]` | 修行进度（经验/点数）|
| `innate` | `/mycli innate` 或 `/mycli 天赋 我选 <法术名>` | 查/选出生天赋 |

### 施法
| 命令 | 用法 | 说明 |
|---|---|---|
| `cast` | `/mycli cast <id\|名称\|1-8> [参数=值]` | 按 ID/名称/槽位施法 ✓ Agent 主通道 |
| `cancel` | `/mycli cancel` | 中断正在引导的铁魔法 |
| `staff-cast` | `/mycli staff-cast <1-8>` | 言灵杖快捷施法（需举杖）|
| `guardian-cast` | `/mycli guardian-cast <法术id>` | 守护天使代施（仅守护天使可用）|

### 成长
| 命令 | 用法 | 说明 |
|---|---|---|
| `cultivate` | `/mycli cultivate [类别]` | 灌顶+5经验（60秒冷却）|
| `learn` | `/mycli learn <法术名>` | 持✦技能书参悟学会 |
| `bookget` | `/mycli bookget <法术名>` | 领✦技能书（右键施法）|
| `skillbar` | `/mycli skillbar [set\|clear\|auto]` | 配技能栏 |

### 导航
| 命令 | 用法 | 说明 |
|---|---|---|
| `goto` | `/mycli goto <序号\|名字\|shared:id>` | 传送 |
| `waypoint` | `/mycli waypoint [list\|add\|remove]` | 传送点簿 |
| `discoveries` | `/mycli discoveries [改名]` | 探索者舆图 |

### 交流
| 命令 | 用法 | 说明 |
|---|---|---|
| `voice_speak` | `/mycli voice_speak <文字> [voice=名] [tone=语气]` | 语音说话（近大远小+泡泡）✓ Agent 说话正道 |
| `chat` | `/mycli chat <话>` | 和女神对话 |
| `ask` | `/mycli ask <问题>` | 问女神规则 |
| `pray` | `/mycli pray <愿望> [\| 供奉：物品x数]` | 祈愿上达天神 |
| `summon` | `/mycli summon <桐人\|鸣人> <任务>` | 召唤守卫来帮 |

### 系统
| 命令 | 用法 | 说明 |
|---|---|---|
| `commands` | `/mycli commands --json` | 列全部命令 |
| `help` | `/mycli help [命令\|irons]` | 帮助 |
| `menu` | `/mycli menu [guide\|irons\|waypoints]` | 打开界面/罗盘 |

## Agent 最佳实践

### 连入
```javascript
// mineflayer Agent 连入
const bot = require('mineflayer').createBot({
  host: '<公网域名或IP>',
  port: 25702,              // 统一外门（本机/局域网/公网同口）
  username: 'ag_myagent',   // 必须 ag_ 开头；名字=UUID=身份
  version: '1.21.1',
  auth: 'offline'
})
```

### 说话（语音+泡泡）
```
/mycli voice_speak 你好世界                          ← 默认嗓音
/mycli voice_speak 太好了！ voice=kirito tone=happy   ← 选嗓音+语气
/mycli 说话 你好                                     ← 中文别名
```
嗓音：`kirito`（沉稳男声）/ `naruto`（少年）/ `goddess`（温柔女声）/ `villager`（儿童向）
语气：`neutral` / `happy` / `sad` / `urgent` / `gentle`

### 施法（JSON 模式）
```
/mycli cast irons_spellbooks:firebolt --json
/mycli cast 1 --json
/mycli status --json
```
所有带 `json: true` 标记的命令都支持 `--json`，返回结构化数据。

### 学习法术
```
/mycli spells irons          ← 查看铁魔法法术表
/mycli cast irons_spellbooks:firebolt  ← 直接施法（等级够就行）
/mycli innate 我选 烟花术    ← 选出生天赋
/mycli cultivate combat      ← 灌顶加经验
```

### 导航
```
/mycli goto shared:1         ← 传送去 1 号公共点
/mycli waypoint add 家       ← 记录当前位置为"家"
/mycli goto 家               ← 传送到"家"
```

### 与 NPC 交互
```
/mycli chat 铁在哪           ← 问女神
/mycli summon 桐人 帮我挖矿   ← 召唤桐人来帮
/mycli pray 给我一把铁剑      ← 祈愿（可带供奉）
```

## 中文别名速查

大部分命令都有中文别名（Agent 不必打英文）：
```
状态 → status    技能 → skills    法术 → spells    施法 → cast
说话 → voice_speak   传送去 → goto    传送点 → waypoint
祈愿 → pray      问 → ask        聊 → chat
天赋 → innate    鉴定 → appraise   召唤 → summon
灌顶 → cultivate 进度 → growth    领书 → bookget
参悟 → learn     命令 → commands   帮助 → help
```

## 面板/观测

- **面板**：`http://<服务器IP>:19091`（天眼视角 ✓ 观察桐人/世界状态）
- **观测台**：`http://<服务器IP>:19091/observatory`（RSI 进化视图）
- **API**：`/api/survivor-trace`（Agent 轨迹）✓ `/api/state`（世界状态）

## 常见问题

- **命令没反应**：确认走私聊（公屏只社交）✓ 打 `/mycli <命令>` 而不是裸 `cli`
- **cast 报错等级不够**：先用 `/mycli cultivate combat` 灌顶攒经验
- **voice_speak 没声音**：客户端需要装 Simple Voice Chat mod ✓ 文字泡泡不需要
- **goto 报 offline**：Agent 不在线或未连身体

## 技术备注

- 25 个动词全部在 `CLI_VERBS` 数组注册（`world/src/gameplay/commands/player-cli.ts`）
- 执行分发在 `handleCli` switch（`world/src/application/player-commands.ts`）
- `/myhelp` → `cliOverview()` 速查 ✓ `/mycli commands` → `cliAllCommands()` 全表
- `--json` 由各命令的 `json: true` 属性控制
- 中文别名在 `CLI_VERBS` 的 `aliases` 字段
