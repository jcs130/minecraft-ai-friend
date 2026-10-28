# 千灯纪 CLI：少记命令，按需学习

## 版本与生效范围

Vortex 为当前职业、技能和原生任务的唯一权威。本文描述精简入口；`.24 / RPG 0.2.3` 候选接续帮助统一与任务分页，并补齐组队、技能详情和失败指引，仍未部署，见 [RPG 可用性](RPG_USABILITY_20261028.md)。生产版本以 [部署清单](../manifests/current-deployment.json) 为准，源码更新不等于已上线。

## Agent 只需先记这些

```text
/mycli status
/mycli --help
/mycli tasks list
/mycli tasks status
/mycli skills status
/mycli progress
```

- `status`：本人生命、饱食、职业等级、魔力、当前活动与下一步；不自动选职、接任务或领奖。它不是登录验收，认证仍以真实 `MC_AUTH_SUCCESS` 和可用世界为准。
- `--help`：当前命令目录，首页只有七项常用入口；照返回的下一页逐步查。`help` 和不带参数的 `/mycli` 使用同一目录。
- `tasks list`：当前原生 RPG 冒险任务，查询不接单；新候选每页最多七项，按返回的下一页继续。旧分类查询仍兼容原公会路线。
- `tasks status`：进行中原生任务的真实缺项；新候选可加一个任务 ID 聚焦查询。旧探索单用 `progress guild` / `guild status`，不会因查原生任务而被取消。
- `skills status`：本人当前后端的技能概览；单项用 `skills info <ID>`，`skills status <ID>` 保持兼容。以实际返回字段为准，未返回的冷却不能推成零。
- Vortex选职后初始主动技可用，learn按详情学习节点，prepare设置点击技能，cast施放主动技；通用技能无需重学。只读详情不代学，选职业不代花点，具体罗盘操作见[技能四步](SKILL_USAGE_QUICKSTART.md)。
- `progress`：裸命令汇总原生任务与冒险者段位、考试、在途公会委托；`progress main/training/guild/challenge/story` 按原分区查询与分页，专项完成不等于主线毕业。

规则用 `/mycli rules`。不要一次读取全目录或背下所有参数；先看当前状态，再按需要读取一个命令的帮助。

## 统一的发现方式

```text
/mycli tasks --help
/mycli tasks info --help
/mycli skills learn --help
/mycli protect --help
```

帮助由同一个 `AgentCliCatalog` 按实际后端生成，说明用法、查询/动作类型、前置条件、消耗和结果核对入口。查询帮助不会报名、接单、学习或施法。首页为 status、tasks、skills、dungeon、profession、inventory、rules；其他功能在后续页，未删功能，也不增加顶层命令。`inventory --help` 可找到个人箱和公共补给；`arena stash --help` 明示裸命令会开箱及费用。

- 默认帮助、状态、进度和技能状态为精炼中文，真人和 Agent 相同。
- 分页复用现有参数或返回的下一页命令，不增加第二套分页语法。
- `--help` / `-h` 只读；`--json` 只选输出格式，不是执行许可，也不改变任务条件。
- 不保证每条旧命令都支持 `--json`。帮助详情明确标记；不支持时按原回执操作。

## 需要程序数据时

```text
/mycli status --json
/mycli progress --json
/mycli skills status --json
/mycli tasks status --json
/mycli tasks info --help --json
```

显式 JSON 按实际后端保留 `MC_RPG`（当前 Vortex）、`MC_STATUS`（旧后端）、`MC_PAGE`、`MC_CLI_HELP` 等协议，不能写死所有状态都是 `MC_STATUS`。默认短文本不重复 UUID、会话和时间戳。认证、安全、危险与死亡等必要回执保留。

旧入口仅在帮助明确支持时使用 `--json`，不支持会在动作前拒绝。新候选的原生 RPG 查询/动作支持格式旗标前置或后置；`intro --json` 返回简短只读 `MC_INTRO`。通用施法仍沿原回执，不冒称全部旧动作均已支持 JSON。

旧 `list`、`explain`、`capabilities`、`spells` 和 `status full` 继续可用，不重复宣传为另一套主入口。`list`、`explain` 等旧阅读入口可能给已报名的专项记录证明；`status full` 还有原详细状态/刷新行为。做指定 CLI 实练时按课程执行；普通发现用 `--help`，查进度用 `progress`。

## 遇到具体需求再查

| 需求 | 已有入口 |
| --- | --- |
| 查物品是否到账 | `/mycli inventory status`；容器内还需核对服务器槽位和光标 |
| 多处方块是否受保护 | `/mycli protect batch --help`；最多64目标，默认按相同判定合并，不逐格刷长文 |
| 找公共装备与补给 | `/mycli guild shared`；门内私人物资需主人授权 |
| 个人大背包 | `/minepacks:backpack open`，54格；与任务物品袋、个人奖励箱独立 |
| 远程个人箱 | `/mycli arena stash`打开；`/mycli arena stash pages`选10页共540格。通用travel已可用，无需学习；成功远程开页2魔力，实体箱旁免费 |
| 拍照 | `/mycli photo menu`；耗2魔力，无需准备空地图，成片自动进入个人奖励箱 |
| 练习试炼塔 | `/mycli arena --help`，与正式攻略通关分开 |
| 遗迹地下城 | `/mycli dungeon --help`；先看难度与装备，主动开场或加入 |
| 私聊 | 原版 `/minecraft:msg <在线玩家名> <内容>` |

个人箱无需先传送或施法；`travel` 是“传送点术”，当前 Vortex 下不用学习。`arena rewards list`查待入箱队列，`arena stash list`查已装入箱格；领奖后开箱才装入，箱满继续保存。等实际窗口、槽位和光标更新后再继续存取，超时先查，不重复操作。

动作发出或 pending 不等于完成。超时、断线、背包快照不一致时先查询，不自动重复存取、施法、交易或领奖。所有个人反馈只给本人；不广播别人的查询或工具结果。

## 维护与验证

改命令行为时同步同一目录与本页；新增功能先复用已有组，避免再加近义入口。JVM 契约检查覆盖首页预算、实际帮助内容、格式支持、分页、未知数据与主线/专项区分；已加入公开源码 CI。

```sh
python paper/self-host/selfhost.py build --directory /path/to/prepared-inputs --output /path/to/new-build --jdk /path/to/jdk21 --component AgentFriend
python paper/plugins/AgentFriend/tests/run_cli_tests.py --inputs /path/to/prepared-inputs --build /path/to/new-build --output /path/to/new-cli-tests --jdk /path/to/jdk21
```

该检查不启动游戏或读玩家存档。JAR 正式上线仍需按[维护流程](OPERATIONS.md)完成当次确认、提前提醒、完整恢复备份和正常停启；不使用全服 reload。原日期记录移至 [CLI 历史](MYCLI_AGENT_CLI_HISTORY.md)，玩法细则从 [文档入口](../../docs/README.md)按需读取。

本轮 259 项 JVM 契约、9 项自部署边界和同摘要隔离 Paper 的24项联机检查通过；核对默认短文本、显式 JSON、旧 CLI 实练回执、任务/物品保持与旁人隔离，并正常保存停服。测试账号的一次状态查询由 JSON 930字符降到短文本115字符，仅代表该样本。首轮过快连续测试触发原版防刷屏，已保留失败记录，按1250毫秒间隔复测后连接持续正常；没有据此调整生产防刷屏。不是正式部署或自主 Agent 长期玩法验收。
