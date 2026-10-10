# 头顶文字气泡

0.4.9 已于2026-10-10正式上线，包含0.4.8玩家气泡与NPC对白；发布状态见 SERVER_UPDATES.md。这是文字功能，语音尚未接入。

## 玩家和 Agent

- 正常公开聊天即可；Agent 也可调用 `/mycli say 大家好，准备出发了`，沿用普通聊天的取消、接收者及 NPC 输入规则。
- 默认在角色头顶显示 8 秒，跟随移动；附近 24 格、同维度、有视线且收到该条公开聊天的在线玩家可见。
- 气泡最多三行正文加向下指示符。连续发言更新同一个气泡，过长内容省略；完整公开正文仍在聊天栏。
- 玩家私聊、命令、任务回执、传送点/地标命名等被取消的输入不生成玩家气泡。隐身角色、女神和观战 Eye 不生成自己的气泡；Eye 可观看其他有实体角色的公开气泡。
- `/mycli bubbles` 查看 `MC_BUBBLES` 状态；`/mycli explain say` 与 `/mycli explain bubbles` 查询准确入口。普通说话不属于魔法，不耗技能点或魔力。

Java 1.20.6、Mineflayer 与原 Agent 客户端使用原版 TextDisplay 协议，无需安装客户端模组。现役 Geyser 将 TextDisplay 转为无实体身体的文字标签供基岩显示；背景框、缩放和排版不保证与 Java 一样。手机/Xbox 画面需真机验收。Web 查看器还须自身渲染 TextDisplay，服务器能发出协议不等于任意查看器已经渲染。

## NPC 对话（0.4.9）

首批支持聊天村民阿卷（`storyteller`）、青禾（`botanist`）、冒险者公会接待员阿莉娅，以及七位生活公会导师。

- 到村民旁右键，或在8格内 `/mycli world talk botanist 你好`；NPC 的问候和实际回答出现在其头顶。NPC 对话中的普通聊天仍是私有输入；`/mycli world end` 结束后恢复公屏。
- 右键接待员/导师打开原菜单，同时收到简短玩法指引和气泡；不会代为接单、交付、授权或交易。
- 私有对白只显示给本次对话者及其当时已登记、实际附身的 Eye。Eye 脱离或改附其他角色时隐藏；重新登录不获得旧正文。附近玩家不会收到正文或显示实体。
- 同一 NPC 同时回答不同玩家，按「NPC实体UUID＋对话者UUID」保存独立气泡。后续答复只更新该对话者的气泡，互不覆盖，也不共享答案。
- 默认8秒、24格、视线可达；气泡过长省略，完整回答仍在本人的聊天栏。NPC 移动时跟随；隐藏、卸载、移除、死亡、跨维度，以及对话者下线/跨维度时清理。

NPCSpeak 1.0 的问候/答复由现役 ProtocolLib 观察真实发送位置：同时验证插件的格式化类、对话管理类及稳定 NPC ID，再使用已加载实体UUID。加载中、报错、普通系统消息、相同前缀的伪造消息和取消发送不作为 NPC 发言。未修改第三方 JAR 或推理后端；不把模型请求当成已答复。插件版本/接口不符时关闭该桥并记录告警，其余气泡继续工作。

NPC 和玩家共用一个5tick刷新任务、32个显示实体和64条待发上限；每个私有对话占用一个名额，不增加轮询模型或每个 NPC 的定时器。运行配置可按稳定 ID 增加现有 NPCSpeak 村民，无须改代码；当前其他提供者的独立故事/箱式对话尚未接入气泡。

## 配置和维护

`plugins/AgentFriend/text-bubbles.yml` 为独立配置；控制台 `mycli admin bubbles reload` 热更新，`audit` 查预算。普通玩家不能修改。无效配置拒绝并保留上一份；成功重载清空当前气泡，`enabled: false` 可即时停用；`npc-enabled: false` 仅停用NPC气泡，原对话仍可使用。0.4.8旧配置缺少NPC字段时使用下列默认值。

| 配置 | 默认 | 允许范围 |
| --- | --- | --- |
| view-distance | 24格 | 8–48 |
| duration-seconds | 8秒 | 2–15 |
| max-active / max-pending | 32 / 64 | 1–32 / 1–64 |
| max-characters | 120个码点 | 16–160 |
| line-columns / max-lines | 36 / 3 | 16–48 / 1–3 |
| update-ticks | 5 tick | 4–20 |
| replace-cooldown-ms | 650毫秒 | 500–5000 |
| require-line-of-sight | true | 布尔值 |
| npc-enabled | true | 布尔值 |
| npc-speakers | storyteller、botanist、guild-receptionist、life-mentors | 最多16个不重复稳定ID；空列表停用NPC气泡 |

中文/非拉丁字符按两列换行；实际可见字数还受三行上限约束。格式码、控制符和文本方向控制符不会带入气泡。多人限流只影响气泡，不取消正常聊天。

单个主线程任务负责所有气泡；聊天线程只提交有界不可变快照，每位玩家及每个NPC私有对话最多一条待显示发言、一个显示实体。会话/世界变化使旧输入失效；下线、死亡、观战、隐身、超时、停用和插件关闭都清理实体。显示实体不持久化、不强制加载区块、不替代角色铭牌。默认隐藏后才按接收者显式显示；更换受限聊天接收者时先撤销旧接收者再更新正文。

`MC_BUBBLES` schemaVersion=1：enabled、viewDistance、durationSeconds、active/pending、maxActive/maxPending、admitted/replaced/expired/throttled/errors、frames/peakFrameMicros、publicChatOnly、clientModRequired；0.4.9新增 playerPublicChatOnly、npcEnabled、npcAudience、npcActive、npcSpeakHook。publicChatOnly=false 表示还支持明确寻址的NPC对白；玩家输入仍仅接受公开聊天。峰值耗时包含帧内全部跟随/可见性工作，不代表持续平均 CPU。

回退：先设 `enabled: false` 并 reload。需要回退版本时，按 OPERATIONS.md 正常停服，用本次维护回退目录恢复旧自研 JAR；不要回放世界或其他玩家数据。

## 验证

原版协议夹具：`plugins/AgentFriend/text-bubbles-stage.mjs`，只允许固定回环隔离服及专用 QA 身份。覆盖实际显示/移动/替换/到期、附身 Eye、距离/遮挡/隐藏/受限接收者、私聊与取消输入、CLI 命令注入拒绝、目录发现、配置拒绝/热停用、维度/下线，以及 16 人同时发言。私有原始回执位于 E/F `repairs/text-bubbles-20261010`；实际通过项与耗时以发布回执为准。隔离 QA 插件不能部署正式服。

NPC夹具：`plugins/AgentFriend/npc-text-bubbles-stage.mjs`，验证实际NPCSpeak问候/答复、原菜单与导师接待、并发私有对话、Eye脱离、系统前缀伪造拒绝、NPC隐藏/移除、对话者跨维度及独立停用；模拟后端只存在于固定回环隔离QA插件。证据位于 E/F `repairs/npc-text-bubbles-20261010`。

协议依据：[Paper TextDisplay API](https://jd.papermc.io/paper/1.20.6/org/bukkit/entity/TextDisplay.html)、[Paper AsyncChatEvent](https://jd.papermc.io/paper/1.20.6/io/papermc/paper/event/player/AsyncChatEvent.html)、[Geyser TextDisplay 转换](https://github.com/GeyserMC/Geyser/blob/master/core/src/main/java/org/geysermc/geyser/entity/type/TextDisplayEntity.java)。后续语音方案见 [近距离语音调研](PROXIMITY_VOICE_RESEARCH.md)。
