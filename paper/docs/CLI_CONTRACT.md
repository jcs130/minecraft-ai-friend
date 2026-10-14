# /mycli 的统一交互约定

2026-10-14，统一CLI已随正式0.4.40上线；0.4.39隔离结果作为原始版本证据保留。

参照 [CLI-Anything HARNESS 的 CLI Design](https://github.com/HKUDS/CLI-Anything/blob/main/cli-anything-plugin/HARNESS.md)：命令分组、`list/info/status` 自检、`--help`、所有新命令的 `--json`、可恢复错误及安全的重复调用。游戏聊天沿用原版协议和 `MC_` 前缀；不在 Paper 中模拟操作系统进程、退出码或另造 REPL。

## Agent 只需记住的入口

```text
/mycli --help
/mycli status --json
/mycli <命令> --help
```

不知道参数时逐层看帮助。`status` 给本人当前状态；任务按 `progress` 查询。下一步用返回的 `nextCommand`，不把全部技能、任务规则和命令表预先塞入提示词。

## 对新增功能的要求

- 使用 `/mycli <功能> <动作> [参数]`。查询用 `list/info/status`；创建、开始、取消各有明确动作。不能用查状态的命令顺便报名。
- `--help/-h` 永远不执行目标动作，不生成任务证明。每页至多七个子命令；具体命令才展示参数、权限、消耗和结果查询方式。
- `--json` 只选输出格式，不另选一个只能查询的执行入口。写操作和界面操作也支持；参数错误必须在副作用之前拒绝。
- Agent 默认只收到一份结构化结果。真人默认中文；实际附身的 Eye 收简短中文。回执只发本人和授权队友，不上公屏。
- 默认状态只给当前阶段、下一步和保存状态；完整规则、成员、缺项用 `--verbose`，证据用 `result --page N`。列表返回一个数组，历史按需分页。
- 只有真实服务器动作与已保存证据可以报成功。超时、断线和保存失败先查询；不能自动重放消耗性动作。
- 尽可能幂等：同一在办项目重复创建返回原场次；重复开始不重置时钟；重复取消不重写证据。已结束后再次创建是明确的新尝试，不做全局去重。
- 新能力必须能从现有通用帮助、`status/progress` 或对应菜单发现；不为每个功能再发一整份入门说明。

## 本次实现

0.4.40已上线按同一约定改造保护查询：`protect batch`聚合最多64个目标，`--json`选格式、`--verbose`选详情；普通单点也默认短回执，超大结果复用通用`page`。不新增独立入门命令或预加载教程，详见[保护批量查询](PROTECTION_BATCH.md)。以下0.4.39验证记录仍对应其原始JAR。

通用 `--help`、`-h`、裸 `/mycli`、`help` 复用同一目录，返回私有 `MC_CLI_HELP`。帮助按组分页；兼容别名不占默认目录。动态法术仍从真实技能目录发现。

生活挑战：

```text
/mycli challenge --help
/mycli challenge list --json
/mycli challenge info backpack_roundtrip --json
/mycli challenge create backpack_roundtrip --json
/mycli challenge start --json
/mycli challenge status --json
```

需要条件或证据时才读：

```text
/mycli challenge status --verbose --json
/mycli challenge result --json
/mycli challenge history --page 2 --json
```

`create` 只是建立等候场次，`start` 才检查准备条件并开始计时。队友本人 `join <runId> <role>`；所有条件仍由实际游戏动作满足。本人当前或最近场次不必传 UUID。`status` 无记录返回 `state=none`，不把正常空状态报为故障。

`list/history/result` 一次一个 `MC_CHALLENGE` 对象，分页字段为 `items/page/pages/total/nextCommand`。普通 `status` 不携带完整规则、全员名单和缺项数组；`--verbose` 明确请求这些字段。写入完成后只确认一次，后续真实步骤进展属于独立的 `trigger=server_observation` 通知。

通用 `/mycli status` 仅在有在办挑战时附上三字段摘要和查询入口。`intro/rules --json` 也不重复发中文；欢迎中加入通用帮助入口，不增加挑战专用入门协议。

## 兼容边界

0.4.38 未部署候选的 `challenge start <ID>` 保留为 `create <ID>` 别名，`begin` 保留为裸 `start` 别名；新帮助和菜单只推荐新写法。`capabilities/list/explain` 旧输出及 `help full/status full` 兼容入口保留。

这次不是把数百个历史命令全部改写。旧功能中尚未适配 `--json` 的入口继续在执行前明确返回 `UNSUPPORTED_FORMAT`，具体帮助给出 `jsonSupported=false`，避免把“有旧机器回执”误称为完整统一格式。新增挑战全部子命令已支持 JSON；之后新增或改造旧功能按本约定验收，不再添加特例入口。

## 本地验证

```powershell
./paper/plugins/AgentFriend/build.ps1
./paper/plugins/AgentFriend/test-cli-contract.ps1
./paper/plugins/AgentFriend/test-life-challenges.ps1
node paper/probe/cli-contract-stage.mjs
node paper/probe/life-challenges-compat-stage.mjs
node paper/probe/life-challenges-stage.mjs
# 隔离服正常冷启动后：
node paper/probe/life-challenges-stage.mjs resume
```

探针只允许既有回环测试服 `25678/25679` 和指定 MOTD；不会接正式端口。完整证据位于私有 `E:/MC/ops/repairs/cli-contract-20261014`，发布清单记录对应结果与 JAR 摘要。真实手机/Xbox画面和远端客户端是否升级分别验证。

### 0.4.39 实际结果

同一 JAR 通过 **194 项检查**：CLI语法与帮助49、原挑战规则/存档64、原生CLI31、热配置/真实基岩协议15、完整Java/Agent/实际Eye流程26、正常冷启动9。裸根帮助实收732字符，挑战目录558字符，默认状态667字符，详细状态1211字符（具体内容随场次变化）。写操作仅一份已保存回执，查询不报名、不重写证据；实际Eye收到中文、外人没有收到私有结果。

基岩协议2193 / 1.26.51实际收到原版菜单及JSON创建结果；不是手机/Xbox画面验收。正式服仍0.4.37，未换生产文件或排队重启。JAR与报告见 [候选清单](../manifests/cli-contract-candidate-20261014.json)。

失败尝试保留：首个探针早于RCON就绪；一次完整流程在客户端合成后仍见光标持有4块木板，测试拒绝把它报为库存就绪，原合成没有被重放。探针补充原生槽位包记录，只在新鲜服务器快照确认光标物品后允许一次收起动作。最终通过的完整流程未触发这个收起分支，不能据此声称远端客户端的库存同步问题已经修复。

## 发布和回退

按 [OPERATIONS.md](OPERATIONS.md) 另行确认、提前提醒、检查真人与活动副本、正常停服和双盘完整冷备份后替换 JAR。恢复旧 0.4.37 JAR 可撤下本功能，保留 `life-challenges.yml` 和 `challenge-runs`；不需要回滚世界或玩家物品。0.4.38 候选及其原始验证证据保留，不能混作 0.4.39 验收。
