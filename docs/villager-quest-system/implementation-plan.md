# 村民派发任务系统：实现方案

> 配套文档：[设计文档](design.md)。状态：2026-11-20。MVP 的 Python 部分已经在本分支实现，只做过本地单元测试；Bukkit 侧的编剧器插件**还没写**。正式服没有任何改动。

## 阶段总览

| 阶段 | 范围 | 验收标准 |
|---|---|---|
| **MVP** | 1 到 2 个村民、1 个英雄；讨伐（`slay`）为主，附带收集交付（`gather`）；本机文件 spool 传输 | 隔离测试服上：村民发委托 → 英雄接到意图 → 服务器击杀信号累计满额 → 委托 completed → 村民播报、发奖励请求，奖励只发一次 |
| **扩展** | 多村民、多任务类型（护送、守夜、调查）；HTTP 传输；委托物化成 AgentFriend 卡片；Vortex 职业派单；Shopkeepers 奖励 | 多村民并发不串单；限额生效；重启后状态不丢 |
| **完整** | 剧情驱动：剧情弧大纲（大模型离线）→ 剧情节点 → 多步委托；BetonQuest 标签；村庄编年史进入 prompt | 一条剧情弧从开始到结束，全程只需要人工审阅大纲 |

---

## 阶段一：MVP

### 1.1 Python 桥接层（本分支已实现）

| 文件 | 内容 |
|---|---|
| `packages/agent-harness-py/src/agent_mc_harness/quests/models.py` | Pydantic 模型：`Commission`（村民侧输入）、`Quest`（含状态机）、`Reward`、`QuestSignal`（服务器证据）、`Feedback`；`quest_json_schema()` |
| `.../quests/policy.py` | `QuestPolicy`：村民白名单、目标白名单、各难度的数量上限和奖励表、期限范围、开放数和每日限额、文本清洗 |
| `.../quests/store.py` | `QuestStore`：SQLite（标准库 `sqlite3`），按 `commissionId` 幂等，带版本号的乐观写 |
| `.../quests/intake.py` | `parse_commission_line()` 解析 `[委托]{...}`；`SpoolIntake` 读目录里的 `*.json`，处理后移到 `done/` 或 `rejected/`；`SignalLog` 增量读取证据 JSONL（跳过未写完的行） |
| `.../quests/feedback.py` | `FeedbackSink` 协议、`MemoryFeedback`、`JsonlFeedback`（追加写 outbox）；中文台词模板 |
| `.../quests/bridge.py` | `QuestBridge`：摄入 → 校验 → 存储 → 派发 → 证据跟踪 → 反馈；`IntentSink` 协议和 `RuntimeIntentSink`（包装 `HarnessRuntime.submit_intent` 和 `control("cancel")`）；`HeroSlot` 英雄名单 |
| `.../quests/__main__.py` | 命令行：`schema` 输出 JSON Schema；`once` 用文件 spool 离线跑一轮，用于演示和本地联调 |
| `packages/agent-harness-py/schemas/villager_quest.schema.json` | 从模型生成的 JSON Schema，测试会核对它和代码是否一致 |
| `packages/agent-harness-py/examples/villager_quests/` | `policy.example.json`、`commission.example.json`、`signals.example.jsonl` |
| `packages/agent-harness-py/tests/test_villager_quests.py` | 单元测试：不联网，不连服务器 |
| `.github/workflows/agent-harness-py.yml` | 增加本模块的 pytest、ruff、mypy |

**接线方式**（宿主进程里，和现有 `NpcHost` 放在同一个事件循环）：

```python
from agent_mc_harness.quests import QuestBridge, QuestPolicy, QuestStore, RuntimeIntentSink, HeroSlot, JsonlFeedback, SpoolIntake

bridge = QuestBridge(
    store=QuestStore("runtime/villager-quests.sqlite3"),
    policy=QuestPolicy.load("config/villager-quests.json"),
    intents=RuntimeIntentSink(runtime),          # 现有 HarnessRuntime
    feedback=JsonlFeedback("runtime/villager-quests/outbox.jsonl"),
    heroes=[HeroSlot(agent="kirito", body_id="<Numen 身体 UUID>", name="桐人", types=("slay", "gather"))],
)
intake = SpoolIntake("runtime/villager-quests/inbox")
# 每隔几秒：
await bridge.pump(intake)                         # 新委托 → offered → 派发
for event in runtime.pull_events(after=cursor)["events"]:
    await bridge.on_harness_event(event)          # 意图 active → in_progress；failed/cancelled → 委托 failed
await bridge.on_signal(signal)                    # 服务器击杀或交付证据
await bridge.on_snapshot("kirito", await body.snapshot())  # 只更新"已备齐"，不判完成
await bridge.tick()                               # 超时 → expired，并取消意图
```

### 1.2 Bukkit 编剧器插件 `qiandeng-villager-quests`（待写，下一个 PR）

建议放在 `paper/plugins/VillagerQuests/`，结构参照 `paper/plugins/AgentFriend`：

| 位置 | 作用 |
|---|---|
| `src/.../VillagerQuestsPlugin.java` | 读取配置；每 5 分钟（可配置）在**异步线程**跑一次触发器 |
| `src/.../Triggers.java` | `night_raid`：统计村庄半径内的敌对生物；`shortage`：检查补给箱 |
| `src/.../Author.java` | 调用 `cn.handyplus.deep.seek.api.DeepSeekApi.chat("委托编剧", prompt)`；解析 `[委托]{...}`；补上配置里的 `issuer`；原子写入 `inbox/<commissionId>.json` |
| `src/.../Signals.java` | 监听 `EntityDeathEvent`（MVP）和 `MythicMobDeathEvent`（扩展），killer 在英雄名单里时，向 `signals.jsonl` 追加一行 |
| `src/.../Outbox.java` | 轮询 `outbox.jsonl`：让村民说出 `text`；`rewardGrant` 交给 AgentFriend 或 Vortex 发放，以 `questId` 去重 |
| `plugin.yml` | `softdepend: [Citizens, DeepSeek, MythicMobs, AgentFriend, VortexRPG]` |

Maven 依赖（米饭官方 API 页）：

```xml
<repository><id>handyplus-maven</id><url>https://maven.cnb.cool/handyplus/maven/-/packages/</url></repository>
<dependency><groupId>cn.handyplus.deep.seek</groupId><artifactId>DeepSeek</artifactId><version>1.4.0</version><scope>provided</scope></dependency>
```

### 1.3 配置示例

#### Citizens NPC

在**测试服**用命令创建，不要直接改 `saves.yml`：

```
/npc create 青禾 --type VILLAGER
/npc id                      # 记下编号，例如 7，填到米饭插件的 npcId
/npc profession FARMER
/npc lookclose
/npc path                    # 按需配置路点
```

`plugins/Citizens/saves.yml` 会自动生成。下面是**示意**，具体字段以 Citizens 2.0.35 实际写出的为准，不要手写：

```yaml
npc:
  '7':
    name: 青禾
    traits:
      type: VILLAGER
      location: {world: world, x: '-547.5', y: '67.0', z: '-445.5'}
```

#### 米饭 DeepSeek（`plugins/DeepSeek/config.yml`）

下面的键名都取自 DeepSeek-1.4.0.jar 自带的默认 `config.yml`（2026-11-20 从 Modrinth 下载，SHA256 `64c8b85d…`）。**apiKey 只写在服务器上，不进 Git。**

```yaml
baseUrl: "https://api.deepseek.com/chat/completions"
apiKey: ""                    # 部署时填写；不要提交
model: "deepseek-v4-flash"    # 待验证：官方文档示例是 deepseek-v4-pro；Flash 模型的确切 ID 以提供商为准
temperature: 0.7

playerChatAi: []              # 不在公共聊天里随机触发村民
playerChatAiName: true
playerChatAiSize: 6           # 上下文条数，越少越省
duration: 10

chatSystem:
  青禾:
    name: "&a麦田的青禾"
    npcId: '7'                # Citizens2 填数字编号
    greeting: '${name}: &f旅人，今天的麦子长得不错。'
    prompt: "qinghe"          # 读取 prompt/qinghe.yml：人设、村庄设定、编年史摘要
    tools:
      - "village_open_quests" # 在 tools.yml 里定义，读取 PAPI 变量
    loading:
      - '${name}: &f嗯……让我想想。'
    format:
      - '${name}: &f${message}'
  委托编剧:                   # 不绑定 NPC，只给编剧器插件通过 DeepSeekApi.chat 调用
    role: "你是艾恩葛朗特第一层村庄的委托书记。只输出一行，以 [委托] 开头，后面紧跟一个 JSON，字段只能是 commissionId,type,target,quantity,difficulty,deadlineMinutes,title,story。不要写奖励。"
```

`tools.yml`（结构同 1.4.0 自带示例）：

```yaml
village_open_quests:
  description: "查询本村当前开放的委托数量"
  parameters: {}
  result:
    - "本村开放委托: %villagerquests_open%"   # 这个 PAPI 变量要由编剧器插件提供，目前还不存在
```

#### 桥接层策略（`config/villager-quests.json`）

完整示例见 `packages/agent-harness-py/examples/villager_quests/policy.example.json`：

```json
{
  "villagers": {
    "qinghe": {"name": "麦田的青禾", "npcId": "7", "types": ["slay", "gather"], "maxOpen": 1, "dailyQuota": 3}
  },
  "targets": {
    "slay": ["minecraft:zombie", "minecraft:skeleton", "minecraft:spider"],
    "gather": ["minecraft:wheat", "minecraft:bread"]
  },
  "maxQuantity": {"easy": 5, "normal": 10, "hard": 20},
  "rewards": {
    "easy": {"emeralds": 2, "vortexXp": 20, "fame": 2},
    "normal": {"emeralds": 4, "vortexXp": 50, "fame": 4},
    "hard": {"emeralds": 8, "vortexXp": 120, "fame": 8}
  },
  "deadlineMinutes": {"min": 10, "max": 1440},
  "maxOpenTotal": 6
}
```

#### 委托 JSON

Schema 是 `packages/agent-harness-py/schemas/villager_quest.schema.json`，由 `python -m agent_mc_harness.quests schema` 生成。示例：

```json
{
  "commissionId": "qinghe-20261120-night-01",
  "issuer": "qinghe",
  "type": "slay",
  "target": "minecraft:zombie",
  "quantity": 5,
  "area": {"x": -547, "y": 67, "z": -445, "radius": 32},
  "difficulty": "easy",
  "deadlineMinutes": 60,
  "title": "麦田边的夜客",
  "story": "昨夜有僵尸踩坏了东边的麦田，青禾不敢再去收割。"
}
```

证据信号（`signals.jsonl` 里的一行）：

```json
{"signalId": "kill-7f3a", "kind": "mob_kill", "actor": "<英雄身体 UUID>", "target": "minecraft:zombie", "count": 1, "position": {"x": -540, "y": 67, "z": -450}}
```

### 1.4 MVP 测试步骤

1. **本地单元测试**（已完成，见 PR）：

   ```sh
   cd packages/agent-harness-py
   python -m pytest -q tests/test_villager_quests.py
   python -m ruff check src/agent_mc_harness/quests tests/test_villager_quests.py
   python -m mypy src/agent_mc_harness/quests
   ```

2. **离线演示：** 用 `python -m agent_mc_harness.quests once --policy examples/villager_quests/policy.example.json --spool /tmp/vq` 跑一轮。英雄派发会打印出来，不连接任何服务器。
3. **隔离测试服（下一步，需要用户同意）：** Youer build920 副本，装 Citizens、DeepSeek 1.4.0 和编剧器插件，再加 1 个 Numen 测试身体，验证设计文档第 6 节的第 1、2、4 项。
4. **正式服：** 只有用户明确指定停机窗口后才部署。

---

## 阶段二：扩展

| 修改点 | 内容 |
|---|---|
| `quests/models.py` | 增加 `escort`、`guard`、`investigate` 类型，以及对应的 `QuestSignal.kind`（`npc_arrived`、`night_survived`、`location_reached`） |
| `quests/policy.py` | 按 Vortex 职业派单（`HeroSlot.vortex_class`）；每个村民的 token 预算字段（由插件侧执行） |
| `quests/transport_http.py`（新增） | 只绑 127.0.0.1 的 HTTP 接口：`POST /commissions`、`POST /signals`、`GET /feedback?after=`；共享密钥从 `.secrets` 读取，不写进命令行参数 |
| `quests/agentfriend.py`（新增） | 把委托物化成 `resident-contracts.yml` 风格的卡片（`goal: kills`/`donate`），由 AgentFriend 做验收；桥接层改为读取它的完成回执 |
| `paper/plugins/VillagerQuests` | MythicMobs 刷怪和死亡事件；Shopkeepers 奖励；PAPI 变量 `%villagerquests_open%` |
| Graphiti | 英雄完成或失败委托时写一条记忆事件 |

## 阶段三：完整（剧情驱动）

| 修改点 | 内容 |
|---|---|
| `quests/story.py`（新增） | `StoryArc` 模型：节点、前置条件、每个节点允许的委托模板；状态存进同一个 SQLite |
| `tools/author_story_arc.py`（新增） | 离线调用大模型生成剧情弧大纲 JSON，输出到 `content/story-arcs/` 等待审阅，**不自动启用** |
| 编剧器插件 | `story_beat` 触发器：读取当前剧情节点，只允许发该节点白名单里的委托 |
| BetonQuest | 节点完成后打标签，例如 `qiandeng.villager_arc_1_done`，让手写主线可以引用 |
| QiandengjiRpg | 当前层数和 Boss 进度作为触发条件 |
| 村庄编年史 | 桥接层反馈里的 `chronicle` 汇总成 `prompt/<村民>.yml` 的一段，由编剧器定期重写 |

## 未决问题

1. 编剧器插件用 Java 单独写，还是并进 AgentFriend？独立插件更容易回滚，并进去能直接复用奖励队列。
2. 委托最后要不要都物化成 AgentFriend 卡片，由它统一验收？这样玩家也能接村民委托。
3. Flash 模型的确切 ID 和价格以提供商为准。是用官方 DeepSeek API 还是硅基流动？
4. Numen 身体的击杀归属，需要在测试服上确认。
