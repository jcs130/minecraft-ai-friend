# 任务放弃与退出指引：候选，尚未上线

本批在最新 main 的独立工作树上，只移植 `31f7199c` 的服务端改动，并补本会话提出的任务放弃入口。正式服仍为 AgentFriend 0.4.47.30 / QiandengjiRpg 0.2.10；没有重启、改玩家职业或替任何人放弃任务、传送。城市热更新保持。

## 当前能用什么

| 目的 | 现役命令 | 含义 |
| --- | --- | --- |
| 放弃旧公会委托 | `/mycli guild abandon` | 放弃本人当前旧单 |
| 放弃接到的玩家委托 | `/mycli commission abandon <ID>` | 接单者退出，原托管报酬仍保留 |
| 撤回自己发布、尚未被接的委托 | `/mycli commission cancel <ID>` | 发布者撤单，按原托管规则退还 |
| 退出当前遗迹副本 | `/mycli dungeon leave` | 不带ID；退出本人场次，留在原地 |
| 回出生村庄 | `/mycli cast home` | 归乡术，成功耗6魔力；不是放弃任务或退出副本 |
| 返回已知村庄地点 | `/mycli goto village` | 已有命名地点传送，成功耗6魔力 |

当前 `/mycli tasks` **尚未开放原生任务放弃入口**，但已安装 Vortex 的 `QuestService.abandonQuest` 本身支持。本候选补接 `/mycli tasks abandon <ID>`，保持一个 tasks 分组，不另造根命令或第二套任务账本。发布前应以服内帮助为准，不能提前让 Agent 使用候选命令。

## 新候选行为

原生任务沿 `list → info → accept → status → claim`；主动不做时用 `abandon <ID>`。必须明确ID，避免误退另一项任务。再次接取会重新计数；未领取奖励不发放，已获物品、金币与已完成历史保留。此操作不退出副本，也不回城。

复用 Vortex 原生放弃与原子保存，回执在保存完成后返回 `success/saved/changed/id/state/nextCommand`。未接取、已放弃或已交付的任务明确 `quest_not_active / changed:false / outcome:not_executed`；未知存储故障保持 unknown，不能当成确定未执行后重放。下一步聚焦 `/mycli tasks status <ID>`。

`dungeon abandon <ID>` 和 `dungeon leave <ID>` 继续拒绝，但会直接返回 `/mycli dungeon leave`，说明留原地与回城区别；不会忽略错误参数、替玩家退出或传送。退出成功的文本给出归乡术与6魔力费用。回城要核对本人倒地、活动状态、魔力、安全落点及实际传送回执；发命令不等于抵达，不应靠凿开副本墙返程。

帮助仍来自既有 CLI 目录，正文短文本；机器需要时显式 `--json`。Skill/MCP 文档只说明如何查询与传递，不复制职业规则或在客户端自动改写消耗命令。

## 通信与技能调用修正

- 候选原接线遗漏 Vortex `status/intro/status full` 的提前返回路径，已改到它们共用的查询路径发布聊天事实；旧后端仍从 MC_STATUS 提供。
- 实际读取启用的 Essentials/EssentialsChat Settings，附近范围、默认频道、喊话前缀与真实世界UUID/key分开。persist-shout 和服务不可用保持 unknown；权限节点标注来自 Bukkit，不能当作原生提供器的全部权限或送达保证。
- 正文 status 显示短聊天说明，显式JSON才发 MC_COMMUNICATION。`@`不扩大范围，`!`不是私聊，发送成功不等于对方收到或读到。
- 通用技能单项返回 `invocation.kind/command`。travel 是 `/mycli waypoint menu`，不是 cast。错入口只给纠正，不拼原参数、不执行、不耗魔。
- JSON技能列表的调用索引只保留ID与调用信息，并附稳定 revision；正文不追加整份JSON。该revision只描述调用路由，不宣称已经解决全技能配置、学习状态与实时冷却的缓存版本。

## 构建和隔离验证边界

完整编译入口补上现役 SkinsRestorer API 依赖；初始完整构建因此失败，不是候选四个 Essentials API 不存在。实际 Essentials 2.22.0 的四个 Settings 方法签名已核对。

集成使用相同摘要的现役 AgentFriend .30 基包，仅替换所属类，在独立 `127.0.0.1:29395` 场地运行。普通非OP测试账号与NPC夹具只存在于QA；未接入正式账号、未调用模型。测试不能把模仿消息、受理回执或初始客户端配置错误当作真实效果或生产故障。

测试记录、最终摘要和已知边界在同批验证清单中。早期夹具的Javac参数、Paper lookAt签名、welcome方法名、过快查询触发spam以及把英文食物反馈误当作失败的记录均保留；这些不是正式服的新故障。

最终窄候选为 AgentFriend `0.4.47.31-vortex` / QiandengjiRpg `0.2.11`，基于现役 `.30/.10`，Vortex qd29保持。AgentFriend实际只有10个条目不同，585个原条目逐字保持，完整源码构建中的所属类与候选一致；RPG桥除四个所属类族和版本外，20个其他条目保持。没有把完整源码构建的旧资源覆盖到生产候选。

完整源码编译、102项纯规则、73项真实Paper检查通过：原生Vortex48、原生中文目录8、正常冷启9、旧后端8。放弃通过原生服务保存，重启后未重新激活，重复放弃明确未执行；饱食、造物、星芒箭用实际状态变化验证。默认错入口只发短文本，显式JSON才返回结构回执；反馈不发旁观者。四次QA均正常停机，29395/29396已关闭，没有正式连接或模型调用。

QA未装LuckPerms，原生Essentials权限回退与Bukkit单节点观测不完全相同；正式权限组合仍需发布后复核。QA还保留无关的旧结构/相机/更新检查告警，不声称全日志无异常或已验收自主Agent长期行为。

最终摘要见 [固定清单](../manifests/cli-lifecycle-candidate-20261030.json)，测试入口见 [隔离验收说明](../probe/communication-contract/README.md)。E/F两盘候选、现役前像及结果已逐项核对；这里只是静态文件回退材料，不是新全世界冷备。Skill/MCP仅更新参考源码，下载包1.3.4和女神现役资料未在本批替换。

候选上线仍需正常维护停启及双盘最新备份，不能用全服 `/reload` 替换JAR，也不能把旧QA世界或角色数据复制回生产。
