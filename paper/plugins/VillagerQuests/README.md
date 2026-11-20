# qiandeng-villager-quests：村民委托服务端插件

> 状态：0.1.0 候选，2026-11-20。只在本地单元测试、和 Python 桥接层的离线往返测试，以及一台本机隔离的 Paper 1.21.1 冒烟服上跑过。**没有在 Youer 上跑过，也没有部署到千灯纪正式服。**

村民按规则发委托，**玩家和常驻英雄都能接**。服务器只凭自己观察到的证据验收，奖励只按配置表发放。设计见 [design.md](../../../docs/villager-quest-system/design.md)，实施阶段见 [implementation-plan.md](../../../docs/villager-quest-system/implementation-plan.md)。

## 流程

```
触发器（夜里怪多 / 随机需求 / 管理员 /vq trigger）
  → 规则定好类型、目标、数量、难度、期限、区域；先查上限，不合规就不调模型
  → 模型只写 title/story（严格 JSON；失败、超时、超预算就用模板）
  → 上板：村民在附近喊话
       ├─ 玩家：/vq、/委托 打开菜单，或右键村民 NPC → 接取 → 击杀 / 交付 / 到达 → 证据累计 → 完成 → 发奖励
       └─ 10 分钟（可配）没人接 → 写入桥接层 inbox → Python 桥派给英雄
              → 英雄击杀 / 交付时插件写 signals.jsonl → 桥接层判完成 → outbox.jsonl
              → 插件读 outbox：村民说话，按本插件的表给英雄发奖励
```

## 规则（和桥接层一致）

- **证据**只认服务器事件：`EntityDeathEvent`（凶手是 `getKiller()`，没有时用 15 秒内最后一次伤害者，箭矢算射手，宠物算主人）、右键村民 NPC 或 `/vq deliver` 时真正扣掉的物品、玩家走进区域。
- 证据只算给**接取人**；必须在**接取之后、期限之前**，讨伐和到达必须在**区域内**（同世界、球形半径），交付必须交给**发委托的村民**；每条证据 ID（实体 UUID、交付流水号）**只算一次**，重启后仍记得。交付只扣真正计入的数量。
- **奖励只来自 `policy.rewards`**（按难度）。模型回复里出现 `reward`、`quantity` 等任何多余字段，整条回复作废；桥接层 outbox 里的奖励数额也不读，只用它的 `idempotencyKey` 和收件身体 UUID（必须是配置里的英雄）。奖励在主线程发放，按 key 只发一次；离线的人上线后补发。
- **上限**：每个村民同时开放数 `maxOpen`、滚动 24 小时的 `dailyQuota`、全服 `maxOpenTotal`、每个玩家同时接取数 `maxActivePerPlayer`。
- **文本清洗**：`&`/`§` 颜色码、`&#rrggbb`、MiniMessage 标签、控制字符、开头的 `/` 全部去掉，并限制长度。广播格式只用配置里的颜色。
- 村民身份只来自配置（`villagers.<id>`、Citizens `npcId`），不从聊天或模型输出里取。
- `reach`（到达）类型只给玩家；桥接层 schema 只有 `slay`/`gather`，所以只有这两种会转给英雄。

## 命令

| 命令 | 作用 |
|---|---|
| `/vq`、`/委托` | 打开委托菜单（点击接取）；右键村民 NPC 打开该村民的菜单 |
| `/vq list` / `accept <编号>` / `abandon [编号]` / `status` / `deliver` | 列表、接取（编号可用前 4 位以上）、放弃（回到板上，进度清零）、进度、在村民身边交付背包里的物品 |
| `/vq trigger <村民>` | 管理员：立刻按规则出一个委托（跳过随机概率，仍受上限约束） |
| `/vq handoff <编号>` / `cancel <编号>` / `reload` / `info` | 管理员：转给英雄、取消、重载配置、查看状态 |

权限：`villagerquests.use`（默认所有人）、`villagerquests.admin`（默认 OP）。

## 模型接入（二选一，默认关闭）

- `llm.provider: mifan`：通过反射调用米饭 DeepSeek 插件 1.4.0 的静态方法 `cn.handyplus.deep.seek.api.DeepSeekApi.chat(String role, String message)`（已用 Modrinth 上 DeepSeek-1.4.0.jar 的字节码核对签名，SHA256 `64c8b85d…`）。`role` 对应它 `config.yml` 里的 `chatSystem.<role>`，默认 `委托编剧`。
- `llm.provider: http`：任意 OpenAI 兼容 `/chat/completions`。DeepSeek 官方填 `https://api.deepseek.com/chat/completions`，硅基流动填 `https://api.siliconflow.cn/v1/chat/completions`，模型名以提供商列表为准。**密钥从环境变量读取**（默认 `VILLAGER_QUESTS_LLM_KEY`），不要写进 Git。只允许 https，回环地址（本机 LiteLLM）可用 http。
- 两种方式都在后台线程调用，超时默认 15 秒；每个村民每天最多 `dailyCallsPerVillager` 次，超过就用模板。

## 与 Python 桥接层对接

`bridge.spoolDir` 指向桥接层 `SpoolIntake` 的同一个目录：

| 文件 | 谁写 | 内容 |
|---|---|---|
| `inbox/<commissionId>.json` | 插件（先写 `.json.tmp` 再原子改名） | `Commission`，字段与 `packages/agent-harness-py/schemas/villager_quest.schema.json` 一致；`deadlineMinutes` 是转交时剩余的分钟数 |
| `signals.jsonl` | 插件（追加一整行并 fsync） | `QuestSignal`：只写配置里英雄身体的、匹配已转交委托的击杀/交付 |
| `outbox.jsonl` | 桥接层 | `Feedback`；插件增量读取（未写完的行留到下次），偏移量存在 `state.json` |

委托编号与桥接层一致：`vq_` + sha256(commissionId) 前 16 位。插件这边的 `policy` 要和桥接层的 `config/villager-quests.json` 保持同样的村民、目标、数量上限和期限范围，否则桥接层会拒收（被拒的委托会在期限到时在插件里过期）。

## AgentFriend

独立插件，`softdepend` AgentFriend，但仓库里的 AgentFriend 0.4.47 没有公开的任务卡 / 奖励 Java API（也没注册 Bukkit 服务），所以 `TaskCards` 目前是空实现，只在日志里说明。Vortex 经验和声望没有可调用的 Java API，用 `rewards.commands` 里管理员写的控制台命令模板发放（默认空，需要在测试服核对真实命令后再填）。

## 构建与测试

需要 JDK 21 和 Paper 1.21.1 API（Youer 1.21.1 混合核心提供同一套 API）。

```sh
# 用隔离服目录（读取 versions/ libraries/ plugins/ 里的 jar）
python build.py --server /isolated/server --jdk /path/to/jdk21 --output /new/output
# 或者用一个装着 paper-api-1.21.1-R0.1-SNAPSHOT 及其依赖的目录
python build.py --classpath-dir /path/to/jars --jdk /path/to/jdk21 --output /new/output

# 只跑规则测试（CI 同款，只需要 gson）
javac -encoding UTF-8 -cp gson-2.10.1.jar -d out src/org/qiandengji/villagerquests/core/*.java tests/org/qiandengji/villagerquests/core/CoreRulesTest.java
java -ea -cp out:gson-2.10.1.jar org.qiandengji.villagerquests.core.CoreRulesTest ../../../packages/agent-harness-py/schemas/villager_quest.schema.json

# 与 Python 桥接层的离线往返（需要 packages/agent-harness-py 的依赖）
python tests/run_bridge_roundtrip.py --jdk /path/to/jdk21 --gson gson-2.10.1.jar --python /path/to/venv/bin/python
```

产物 `qiandeng-villager-quests-0.1.0.jar` 放进 `plugins/`。回滚：停服后删掉这个 jar（以及可选的 `plugins/qiandeng-villager-quests/` 数据目录），其他插件不受影响。

## 尚未验证

- Youer build920 上能否加载；中文命令别名 `/委托` 在 Youer 的命令桥上是否可用。
- 米饭 DeepSeek 1.4.0 在 Youer 上能否工作，`DeepSeekApi.chat` 实际阻塞多久。
- Numen 身体击杀时 `getKiller()` 是否是英雄（若 Numen 身体不是 Player，靠最后伤害者兜底，也未实测）；英雄奖励只能发给在线的 Player 实体。
- Citizens 2.0.35 的反射调用（`getNPCRegistry/getById/isNPC/getNPC`），以及右键 NPC 事件在 Youer 上的分发。
- Vortex 经验 / 声望发放命令。
