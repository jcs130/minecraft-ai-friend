# /mycli：统一发现，精简反馈

状态：候选，尚未更新正式服。当前线上版本仍见 [实际部署清单](../manifests/current-deployment.json)。

本轮不增加顶层命令，不改玩家职业、背包、任务或权限。目标是先看状态、按需查一个能力，再明确执行和核对结果。

## 为什么要改

Vortex 接管后，`NativeRpg` 把根帮助、`list` 和 `capabilities` 都截成了简短的 RPG 帮助，绕过原命令目录；分组详情仍可能描述旧职业的学习、升级和准备槽。`progress training` 等参数被忽略，实际返回了 RPG 任务；`tasks list --page 2` 又被误送到旧公会路线解析。原生参数校验只限制最大数量，一些动作多余参数到执行时才发现。

此外真实测试复现了技能菜单 `NoSuchMethodError`：`CustomItemService.applyCustomModelData` 在设置整数模型编号后，还调用当前 Paper 1.21.1 没有的 component API。这会使菜单和它的结果回执都中断。

## 使用方式

Agent 先记 `/mycli status` 和 `/mycli --help` 即可。默认精炼中文，程序明确需要字段时才使用帮助标明支持的 `--json`。

- 首页七项：status、tasks、skills、dungeon、profession、inventory、rules。其他原有功能保留在后续页；别名不重复占位置。
- 每组使用 `list/info/status` 查询，使用 `choose/learn/prepare/accept/claim` 明确执行。帮助给用法、条件、费用和核对命令。
- `inventory --help` 指向随身背包、大背包、远程个人箱和公会共享补给。`arena stash --help` 明示裸命令开箱、费用及页码；不再建议重新学通用 travel。
- 原生任务 `list/status` 每页最多七项，下一页返回完整可复制命令；`tasks status <ID>` 聚焦一项。未知或超范围页码不执行动作。
- 裸 `progress` 汇总 RPG 任务和冒险进度；显式 `main/training/guild/challenge/story` 保留原分区和分页，不把专项完成冒充主线毕业。
- 错误说明原因、是否尚未执行和一个恢复命令。参数错误在查询角色或执行前拒绝。超时及保存冲突属于待确认，不自动重放动作。

## 兼容范围

`class/quests/spells`、`skills explain/status <ID>/equip`、`guide magic`、`list/explain/capabilities`、`status full` 与旧分类任务继续兼容。归档旧技能仍按 `skill_retired` 拒绝。共用原 Vortex API，不建立第二套职业或任务状态。

当前 Vortex JSON 仍使用 `MC_RPG`，保留 class/level/xp/mana 等旧字段，补充真实生命、饱食、pending、nextCommand；不替换成另一种状态包。任务列表增加分页字段，查询更大结果必须跟随 nextCommand。原生格式旗标可前置或后置，选职/学习/领奖语义不随格式改变。通用技能施法及其他尚未迁移的旧入口仍可能不支持 JSON，帮助明确标示，执行前拒绝不支持格式。

菜单回执只确认“请求打开”，不代表已选职业或已学习；真实窗口另外核对。旧 `help full/status full` 和课程要求的旧阅读入口保留原行为，不能把全历史命令一概称为严格只读。

原生任务的仓储 future 完成才确认接取/交付成功，成功时 `saved=true/saveState=saved`。原来的 `saved` 只看是否额外保存角色资料，造成已保存的任务仍报 false；这次按任务实际保存修正。即时施法不冒称持久化，使用 `saveState=not_applicable`；失败先标 unverified，不重放动作。

## 验证与发布

验收计划与运行程序在 [probe/agent-cli](../probe/agent-cli/TEST.md)。固定基线的 AF 窄构建只替换 NativeRpg、AgentCliCatalog、AgentCliText，保留其余 585 条目；Vortex 窄补只改上述一个物品模型方法，保留其余 2852 条目和所有资源。自托管通用 CLI 测试已纳入原生帮助目录检查。

最终同包通过 **366 项规则、92 项真实联机和 8 项正常冷启动检查**；含非 OP 角色、两人私有回执、原生选职/施法/任务、真实菜单、1.21.11 经 ViaVersion 连接与原 UUID/职业/任务持久化。测试服原有地图掩码、相机和上游更新检查告警仍存在，本轮不把它们算成已修复，也未做手机/Xbox真机验收。

正式发布需当次重启确认、提前提醒、身份及活动副本检查、E/F 完整冷备份，再正常停启安装。原玩家文件不迁移、不从 QA 回写。回退使用同次备份内原 AF/RPG/Vortex 三个 JAR，保留之后产生的玩家进度，不回滚世界。此补丁不新增存档格式。

Skill/MCP 参考源同步了真实原生任务、通用技能与个人箱说明；本轮尚未重新发布官网下载包，也不把文档维护冒充远端 Agent 已更新。

设计参考：[CLI-Anything HARNESS](https://github.com/HKUDS/CLI-Anything/blob/main/cli-anything-plugin/HARNESS.md) 的分组发现、先查询后动作和格式旗标。这里沿用 Minecraft 命令及私有回执，不模拟操作系统退出码或添加另一套 REPL。
