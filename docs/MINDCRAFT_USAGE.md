# Mindcraft 正确使用方式

这份文档记录本项目如何正确接入 Mindcraft。结论来自 Mindcraft 官方仓库、MineCollab 资料和本机 Mindcraft 源码。

## 核心结论

Mindcraft 不是一个“每轮发长提示词就会稳定行动”的黑盒。它有两类能力：

1. 稳定内置命令：例如 `!goToCoordinates`、`!searchForBlock`、`!collectBlocks`、`!viewChest`、`!putInChest`、`!goToBed`、`!goal`。
2. 代码生成命令：`!newAction` 会让 LLM 走 coder 生成代码再执行，能力强，但慢、昂贵、容易被上下文和路径问题影响。

因此本项目的默认策略是：

- 常驻自治：用 `!goal(...)` 给每个居民设置长期职业目标。
- 短动作心跳：用 Mindcraft 内置命令做可见动作，例如移动、开箱、采集、放置、搜索实体。
- 村长调度：只给高层目标、坐标、材料缺口和安全边界，不逐格遥控。
- `!newAction(...)`：受控用于复杂行为、高级建造、复合采集、脱困或缺少内置命令的场景；它不是禁用项，但不能作为每轮常规任务入口。
- 服务端能力：传送、改模式、RCON、玩家定位这类全局能力由控制台或服务端插件处理，不塞给居民用自然语言猜。

## 为什么不能滥用 `!newAction`

本机 `C:\Users\lzl19\Documents\mindcraft\src\agent\commands\actions.js` 里，`!newAction` 的实现会忽略传入 prompt 的直接参数，改用聊天历史让 `agent.coder.generateCode(agent.history)` 生成代码。它依赖 `settings.js` 里的 `allow_insecure_coding`。

这意味着：

- 它不是普通任务命令，而是代码生成入口。
- 连续调用会积累上下文噪声，容易变成“说得多、做得少”。
- 执行慢时看起来像 AI 原地不动。
- 安全风险高，官方也建议启用 coding 时使用隔离环境。

本机 `action_manager.js` 还会在新动作开始前尝试中断当前动作，所以控制台如果太频繁下发 `!newAction`，会把本来还在执行的动作打断。

## 什么时候应该用代码生成

代码生成是 Mindcraft 的高级能力，应该保留。适合这些情况：

- 建筑师需要一次完成很小的结构组件，例如 4-8 个方块的家具、墙角、门口、屋顶边缘或灯位。
- 矿工需要整理矿点入口、补光、采少量矿物并准备回库，内置单条命令表达不完整。
- 农夫需要把找动物、获取羊毛/食物、回库和上报组合成一个短闭环。
- 侦察员需要记录资源点、路线和危险点，而不是只移动到坐标。
- Alex 这类强模型需要做材料包、装备制作、公共箱整理和跨居民资源调度。
- 脱困时内置移动命令无法表达“上浮、朝岸边、停止下潜、失败上报”这类复合行为。

受控条件：生命和饥饿安全、没有落水、非矿工不在地下、距离上次代码生成有足够间隔、目标必须是一个短时可见成果。代码生成不得读写主机文件、发网络请求、调用 RCON/服务器命令、无限循环、破坏玩家或居民建筑。

## 推荐命令分层

| 场景 | 优先方式 | 说明 |
| --- | --- | --- |
| 常驻居民自我循环 | `!goal("长期职业目标...")` | Mindcraft 原生 self-prompting，适合居民长期做事 |
| 到基地/箱子/施工点 | `!goToCoordinates(x,y,z,closeness)` | 可预测，方便直播和日志观察 |
| 找方块/采集 | `!searchForBlock` + `!collectBlocks` | 适合矿工、建筑材料收集 |
| 找动物/打猎 | `!searchForEntity` + `!attack` | 适合农夫/侦察员获取肉和羊毛 |
| 公共箱 | `!viewChest`、`!putInChest`、`!takeFromChest` | 适合公共资源协作 |
| 睡觉 | `!goToBed` | 夜晚居民生活化行为 |
| 脱困/复杂建造/复合动作 | 受控 `!newAction` | 内置命令不够、需要短时代码组合动作时使用 |
| 传送/改模式/RCON | 控制台 API 或服务端命令 | 不让 bot 自己用自然语言执行 |

## 多 Agent 社会的用法

### 村长

村长应该读取全局信息后下达高层策略：

- 世界状态：时间、天气、难度、在线玩家、居民状态。
- 村庄状态：基地、公共箱、资源目标、项目、设施上报。
- 居民状态：位置、生命、饥饿、背包、当前动作、最近输出。
- 任务事件：谁在做什么、哪里受阻、哪些资源已经入库。

村长不应该每轮替每个居民写完整动作脚本。村长只管目标和约束，例如“Alex 负责采矿并把铁带回公共箱”，“Luna 继续住宅地板和照明”。

### 居民

每个居民都有自己的循环：

1. 接收一次 `!goal`，明确长期职业、基地、公共箱、资源缺口和上报规则。
2. 空闲时由控制台下发短动作心跳，避免只聊天。
3. 完成、发现、受阻时用 `VILLAGE_REPORT` 上报公共事实。
4. 个人记忆记录长期发现和职业偏好，村庄记忆记录公共设施和资源点。

### 通信

MineCollab 资料说明，多 Agent 详细自然语言沟通会带来明显开销，并容易出现无效闲聊、互相干扰建筑等问题。因此本项目要求：

- 公开聊天使用中文短句。
- 只在有用时说“已有、需要、正在做、完成、受阻”。
- 观众能看到行动意图，但不展示隐藏系统提示或长篇推理。
- 实际协作事实通过结构化 `VILLAGE_REPORT` 和控制台事件库保存。

## 本项目当前映射

- `src/autopilot.js`
  - `residentSelfLoopDecision()`：每个居民优先进入自治循环。
  - `buildResidentSelfGoalPrompt()`：生成 `!goal` 长期目标。
  - `directResidentSelfCommand()` / `directSettlementCommand()`：生成短动作心跳。
  - `controlledResidentCodeAction()`：在安全、间隔和角色条件满足时，允许居民使用受控 `!newAction` 完成复杂小动作。
  - `buildResidentSelfLoopTask()`：作为 `!newAction` 兜底。
- `src/commander-policy.js`
  - 做安全兜底和村长干预，避免把闲聊当完成。
  - 区分矿工地下采矿和非矿工地下卡住。
- `src/village-state.js`
  - 保存居民、项目、资源、设施、任务事件和共享记忆。
- `src/mindcraft-config.js`
  - 读写 Mindcraft `settings.js` 和 profile，不保存真实 key。

## 运行配置建议

- Node 使用 v18 或 v20 LTS。
- Minecraft Java 版本按 Mindcraft 官方支持范围配置。
- profile 里的 bot 名必须和 Minecraft 登录名一致，否则 bot 可能自言自语。
- `model` 用于聊天和普通决策，`code_model` 用于 `!newAction` 代码生成，`vision_model` 用于视觉理解，`embedding` 用于例子选择。
- 本项目允许不同居民使用不同模型：Alex 可用线上强模型，其他居民可用局域网 Ollama。
- `allow_insecure_coding=true` 只适合私服和可信环境；对公网服务器应关闭或用 Docker 隔离。
- `max_messages` 不宜过大，否则本地模型上下文容易被历史噪声拖慢。

## 反模式

- 每 30 秒给所有居民发一段长 prompt。
- 把 `!newAction` 当作所有任务的入口，或者连续刷新代码生成导致当前动作被打断。
- 要求居民先输出完整思考再行动。
- 在自然语言任务里写“tp/瞬移/RCON/服务器命令”。
- 村长每轮重写居民目标，导致 `!goal` 无法持续。
- 让非矿工钻地下，让侦察员过水，让建筑师远离材料点。
- 只靠聊天上报库存，不做真实移动、采集、入库或建造。

## 后续改进

1. 为常见任务建立 task schema：目标、起点、材料、成功条件、超时、可用命令。
2. 把公共箱和真实方块状态接入服务端插件，减少 AI 自报误差。
3. 引入每个居民的向量记忆检索，把“资源点、失败路线、建筑计划”作为长期记忆。
4. 给直播页展示村长决策、居民 goal、当前动作、资源目标和完成进度。
5. 继续完善 `!newAction` 的频率限制、失败回退和成功评估，避免生成代码卡住整轮行动。

## 参考资料

- Mindcraft 官方仓库：<https://github.com/mindcraft-bots/mindcraft>
- Mindcraft README 配置说明：<https://github.com/mindcraft-bots/mindcraft#configuration>
- MineCollab 项目页：<https://mindcraft-minecollab.github.io/>
- MineCollab 任务说明：<https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/minecollab.md>
- Mindcraft FAQ：<https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/FAQ.md>
