# 头顶文字气泡

0.4.8 已于2026-10-10正式上线；发布状态见 SERVER_UPDATES.md。这是文字功能，语音尚未接入。

## 玩家和 Agent

- 正常公开聊天即可；Agent 也可调用 `/mycli say 大家好，准备出发了`，沿用普通聊天的取消、接收者及 NPC 输入规则。
- 默认在角色头顶显示 8 秒，跟随移动；附近 24 格、同维度、有视线且收到该条公开聊天的在线玩家可见。
- 气泡最多三行正文加向下指示符。连续发言更新同一个气泡，过长内容省略；完整公开正文仍在聊天栏。
- 私聊、命令、任务回执、传送点/地标命名等被取消的输入不生成气泡。隐身角色、女神和观战 Eye 不生成自己的气泡；Eye 可观看其他有实体角色的公开气泡。
- `/mycli bubbles` 查看 `MC_BUBBLES` 状态；`/mycli explain say` 与 `/mycli explain bubbles` 查询准确入口。普通说话不属于魔法，不耗技能点或魔力。

Java 1.20.6、Mineflayer 与原 Agent 客户端使用原版 TextDisplay 协议，无需安装客户端模组。现役 Geyser 将 TextDisplay 转为无实体身体的文字标签供基岩显示；背景框、缩放和排版不保证与 Java 一样。手机/Xbox 画面需真机验收。Web 查看器还须自身渲染 TextDisplay，服务器能发出协议不等于任意查看器已经渲染。

## 配置和维护

`plugins/AgentFriend/text-bubbles.yml` 为独立配置；控制台 `mycli admin bubbles reload` 热更新，`audit` 查预算。普通玩家不能修改。无效配置拒绝并保留上一份；成功重载清空当前气泡，`enabled: false` 可即时停用。

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

中文/非拉丁字符按两列换行；实际可见字数还受三行上限约束。格式码、控制符和文本方向控制符不会带入气泡。多人限流只影响气泡，不取消正常聊天。

单个主线程任务负责所有气泡；聊天线程只提交有界不可变快照，每人最多一条待显示发言、一个显示实体。会话/世界变化使旧输入失效；下线、死亡、观战、隐身、超时、停用和插件关闭都清理实体。显示实体不持久化、不强制加载区块、不替代角色铭牌。默认隐藏后才按接收者显式显示；更换受限聊天接收者时先撤销旧接收者再更新正文。

`MC_BUBBLES` schemaVersion=1：enabled、viewDistance、durationSeconds、active/pending、maxActive/maxPending、admitted/replaced/expired/throttled/errors、frames/peakFrameMicros、publicChatOnly、clientModRequired。峰值耗时包含帧内全部跟随/可见性工作，不代表持续平均 CPU。

回退：先设 `enabled: false` 并 reload。需要回退版本时，按 OPERATIONS.md 正常停服，用本次维护回退目录恢复旧自研 JAR；不要回放世界或其他玩家数据。

## 验证

原版协议夹具：`plugins/AgentFriend/text-bubbles-stage.mjs`，只允许固定回环隔离服及专用 QA 身份。覆盖实际显示/移动/替换/到期、附身 Eye、距离/遮挡/隐藏/受限接收者、私聊与取消输入、CLI 命令注入拒绝、目录发现、配置拒绝/热停用、维度/下线，以及 16 人同时发言。私有原始回执位于 E/F `repairs/text-bubbles-20261010`；实际通过项与耗时以发布回执为准。隔离 QA 插件不能部署正式服。

协议依据：[Paper TextDisplay API](https://jd.papermc.io/paper/1.20.6/org/bukkit/entity/TextDisplay.html)、[Paper AsyncChatEvent](https://jd.papermc.io/paper/1.20.6/io/papermc/paper/event/player/AsyncChatEvent.html)、[Geyser TextDisplay 转换](https://github.com/GeyserMC/Geyser/blob/master/core/src/main/java/org/geysermc/geyser/entity/type/TextDisplayEntity.java)。后续语音方案见 [近距离语音调研](PROXIMITY_VOICE_RESEARCH.md)。
