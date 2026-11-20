# 千灯纪活村民

村民用原版实体的职业和活动能力，玩家可以看到他们上下班、散步、回屋和交易。农夫、渔夫、图书管理员用各自的身份处理工作，也会对附近的玩家作出回应。千灯纪现有的女仆和英雄仍然使用各自的身体接口。村民有独立的身份，玩家在一位村民面前聊过的内容只能由这位村民在与同一玩家的会话中提取。

## 生活与工作

现有 VillagerLife 已包含各职业的行走和工作地点选择。首批从已经有 AI 的实体中挑选住得下、有工作站，且道路实际能走的村民。实体注册使用管理配置中的 UUID，任务和对话共用这个 UUID。暂时离开加载范围时，委托等它回来，后台无需强制加载区块。

| 行为 | 动作来源 | 如何验收 |
| --- | --- | --- |
| 散步、回家、休息 | 原版村民日程和 VillagerLife 寻路 | 观察绝对坐标的改变，在床边核对实际睡眠状态 |
| 农夫种收 | 原版农夫行为，沿用现有农地和保护规则 | 对比作物熟度和实际种下的方块，记录一次可核对的收成 |
| 渔夫钓鱼 | 复用 VillagerLife 去水边的路线，增加真实钓获和登记库存是下一步 | 钓钩、咬钩、产物入指定公共库存都要有服务器证据 |
| 商店与交付 | 村民原版交易，潜行右键读委托或交付 | 普通交易列表能打开，背包只扣掉已交付的数量 |

工作长期用原生逻辑。将来允许 Harness 选择「去工作」「散步」「回家」这类目标时，交给原生调度器找路，记录是否到达。区块卸载、天黑、敌人靠近、正在交易或寻路失败需要能让当前计划让步。

## 人设、记忆与距离语音

用 `/npcsocial 青禾 tell 你好` 可给已登记且已加载的村民发私聊，玩家可以在另一维度。村民决定回应时，只有发起玩家收到文字。接入 SVC 的玩家也能单独听见该村民的音色。回话前断线时，旧回复不会送到重连后的角色。

游戏会返回请求编号。用 `/npcsocial 青禾 receipt <请求编号>` 查看原请求。宿主选择继续日常时显示 `silent`，只计算实际发给玩家的答复。即使是同一位玩家，附近交谈与私聊也各自保留最近四轮，村民在附近回应时读不到之前的私聊。

私聊短期记忆位于 `state.json` 的 `privateDialogue` 字段。回退前保全最新文件和原请求回执。0.1.2 只读取 `dialogue`，保存时会丢弃未知字段。重新升级时可从保全副本单独取回 `privateDialogue`，保留现有委托、附近对话和游标。

候选插件的 `villagers.<id>.entityUuid` 与 QiandengVoice 的 `npc-voices.json` 对应同一个原版实体。语音配置用 `kind: villager`、`residentId`、`name`、`voice` 和对话距离。用玩家自然呼名或附近对话机制唤起。SVC 只转交实际在距离内的声音，身份和位置在回话时再次检查。文字发给对话者，Java SVC 可从村民的位置听到答复。

每次把村民的人设、职业、游戏时刻、是否在休息和同一玩家最近四轮交流发给对话模型。候选记忆保存到插件的 `state.json`，每对身份最多四轮，有效期七天，最多保留 128 对有效会话。只存成功回过的对话，不录音，也不持续把整个村庄的聊天送给模型。较长的村庄记忆可以在后续沿用 Harness Hub 的角色记忆存储，按村民 UUID 与世界分作用域，把真实工作和委托结算另记事件。

首批对话由独立村民 Harness 处理。它接收已登记 UUID 的现场与对话，使用真实 `HarnessRuntime` 和角色受限的身体适配器形成回话决定。只接受当前事件的短回复或继续日常。游戏服重新检查听者、距离和时间，再发文字与 SVC。Java 保存已经实际发出的对话，下一轮才把同一对身份的记录交给 Harness。

## 委托

附近的敌对生物可以触发夜间求援。只要在可计数区域内的敌人数量达到条件，就按规则确定目标、数量、期限和奖励。规则决定任务，模型只写中文标题和缘由。道路损坏、公共库存不足、护送等需求等有相应的实际验收和库存归属后再开启。首批使用独立委托板，原游戏交易、生活委托与公会进度可继续使用。

公会看板汇总各村已加载的活村民发布的委托，本世界较近的村民优先显示。纸张入口显示现有委托，进入后可查看详情或接取。也可用 `/mycli guild village list [页码]`、`info <编号>`、`accept <编号>`、`status` 和 `deliver [编号]`，收到只发给本人的 `MC_VILLAGE_GUILD` schema 1 回执。接取与交付走村民原来的账本，同一张委托只可结算一次。交付需要到发布的村民身边。原公会订单仍从原来的入口交付。

首批暂时关闭英雄自动转交。当前 Java 一侧的英雄进度允许其他已登记英雄提交证据，Python 一侧只认实际被派到任务的英雄。启用前双方要就同一个接单身体完成确认，并支持原 ID 查询、取消、重启恢复与离线奖励。

## LiteLLM 配置

真正的插件目录为 `plugins/qiandeng-villager-quests/`。叙事插件和对话 Harness 各用限制到 `codingplan-qwen3.7-plus` 的 LiteLLM key，分别预算。Java 到 Harness 使用独立的本机环回令牌。

```yaml
llm:
  provider: http
  timeoutSeconds: 15
  minIntervalSeconds: 10
  dailyCallsPerVillager: 12
  http:
    endpoint: http://127.0.0.1:4000/v1/chat/completions
    model: codingplan-qwen3.7-plus
    apiKeyEnv: VILLAGER_QUESTS_LLM_KEY
    jsonMode: true
    enableThinking: false

dialogue:
  enabled: true
  provider: harness
  harness:
    endpoint: http://127.0.0.1:19122/v1/villager/decide
    apiKeyEnv: VILLAGER_HARNESS_KEY
```

在安装了 `agent-mc-harness-py[server-npc]` 的环境中启动，私有配置样式见[示例](../../packages/agent-harness-py/examples/villager_quests/harness.example.json)。

```shell
python -m agent_mc_harness.villager_service --config /path/to/private-harness.json
python -m agent_mc_harness.villager_service --config /path/to/private-harness.json --check
```

JVM 启动时继承 `VILLAGER_QUESTS_LLM_KEY` 和 `VILLAGER_HARNESS_KEY`。对话 Harness 的 LiteLLM 凭据由私有配置指定文件，或继承 `VILLAGER_DIALOGUE_LLM_KEY`。已有 JVM 可用 `/vq reload` 重读配置，环境变量更新需要重启。每条模型链路最多一并发，最短间隔十秒。委托文案超时或格式不符时按模板上板，对话失败时继续原有活动。
