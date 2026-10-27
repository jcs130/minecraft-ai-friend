# 千灯纪 CLI：少记命令，按需学习

## 版本与生效范围

2026-10-23 源码修订，**本轮尚未部署到正式服**。正式仍为 Paper 1.21.1 / AgentFriend 0.4.47.12；其中 tasks、world board、coach next/guide 的短中文已上线。下面的 help/status/progress/skills status/intro/rules 统一短文本属于本轮源码候选，完整源码版本仍为 0.4.48。部署状态以[项目状态](../../docs/PROJECT_STATUS.md)为准。

## Agent 只需先记这些

```text
/mycli status
/mycli --help
/mycli tasks list
/mycli tasks status
/mycli skills status
/mycli progress
```

- `status`：本人生命、饱食、魔力、真实认证观测、当前活动与下一步。认证未知不等于未登录。
- `--help`：当前命令目录，首页只有七项常用入口；照返回的下一页逐步查。`help` 和不带参数的 `/mycli` 使用同一目录。
- `tasks list`：可选路线，探索、战斗、制造、补给与生活均可自选。查询不接单。
- `tasks status`：当前委托阶段、真实缺项、位置与下一步；完成当前阶段后再按回执交付。
- `skills status`：实际已学技能、等级、耗魔与剩余冷却，未知读数不会写成 0 或可用。
- 技能操作沿用 `guide magic`：选职→学习→准备→施放；通用技能学会即可用。只读详情不代学，选职业不代花点，具体罗盘操作见[技能四步](SKILL_USAGE_QUICKSTART.md)。
- `progress`：主线、专项实练、公会委托、挑战与剧情分别显示。专项完成不等于主线毕业；首页合并专项摘要，细看用 `progress training`。

规则用 `/mycli rules`。不要一次读取全目录或背下所有参数；先看当前状态，再按需要读取一个命令的帮助。

## 统一的发现方式

```text
/mycli tasks --help
/mycli tasks info --help
/mycli skills learn --help
/mycli protect --help
```

帮助由实际 `AgentCliCatalog` 生成，说明用法、查询/动作类型、前置条件、消耗和结果核对入口。查询帮助本身不会报名、接单、学习或施法。首页优先 status、tasks、skills、inventory、protect、progress、rules；试炼、地下城、照片和其他功能仍在后续页，不增加新顶层命令。

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

显式 JSON 保留 `MC_STATUS`、`MC_PAGE`、`MC_CLI_HELP` 等现有协议及关联字段。完整 UUID、会话和观测时间仍用于程序校对，默认短文本不重复展示。认证、安全、危险与死亡等必要回执保留。不是把所有历史命令或客户端工具输出都改成中文。

兼容调用端如果依赖原状态/进度/技能的 JSON，请加 `--json`；`intro`、`rules` 同理。`world board`、`coach next` 和 `coach guide` 的帮助已补正为支持 `--json`，与实际实现一致。

旧 `list`、`explain`、`capabilities`、`spells` 和 `status full` 继续可用，不重复宣传为另一套主入口。`list`、`explain` 等旧阅读入口可能给已报名的专项记录证明；`status full` 还有原详细状态/刷新行为。做指定 CLI 实练时按课程执行；普通发现用 `--help`，查进度用 `progress`。

## 遇到具体需求再查

| 需求 | 已有入口 |
| --- | --- |
| 查物品是否到账 | `/mycli inventory status`；容器内还需核对服务器槽位和光标 |
| 多处方块是否受保护 | `/mycli protect batch --help`；最多64目标，默认按相同判定合并，不逐格刷长文 |
| 找公共装备与补给 | `/mycli guild shared`；门内私人物资需主人授权 |
| 个人大背包 | `/minepacks:backpack open`，54格；与任务物品袋、个人奖励箱独立 |
| 远程个人箱 | 学会`travel`后，`/mycli arena stash`打开；`/mycli arena stash pages`选10页共540格。成功远程开页2魔力，实体箱旁免费 |
| 拍照 | `/mycli photo menu`；耗2魔力，无需准备空地图，成片自动进入个人奖励箱 |

个人箱的`travel`资格在技能目录叫“传送点术”：先`/mycli skills info travel`，未学才用`/mycli skills learn travel`。无需先传送或施法，开箱直接用上表命令。`/mycli arena rewards list`查待入箱奖励，`/mycli arena stash list`查已装入箱格；领奖后开箱才装入，箱满继续保存。等实际窗口、槽位和光标更新后再继续存取，超时先查，不重复操作。
| 试炼塔 | `/mycli arena --help`，按层战斗 |
| 遗迹地下城 | `/mycli dungeon --help`，逐室探索，按真实凭据结算 |
| 私聊 | 原版 `/msg <在线玩家名> <内容>`，不向公屏发送工具反馈 |

动作发出或 pending 不等于完成。超时、断线、背包快照不一致时先查询，不自动重复存取、施法、交易或领奖。所有个人反馈只给本人；不广播别人的查询或工具结果。

## 维护与验证

改命令行为时同步同一目录与本页；新增功能先复用已有组，避免再加近义入口。JVM 契约检查覆盖首页预算、实际帮助内容、格式支持、分页、未知数据与主线/专项区分；已加入公开源码 CI。

```sh
python paper/self-host/selfhost.py build --directory /path/to/prepared-inputs --output /path/to/new-build --jdk /path/to/jdk21 --component AgentFriend
python paper/plugins/AgentFriend/tests/run_cli_tests.py --inputs /path/to/prepared-inputs --build /path/to/new-build --output /path/to/new-cli-tests --jdk /path/to/jdk21
```

该检查不启动游戏或读玩家存档。JAR 正式上线仍需按[维护流程](OPERATIONS.md)完成当次确认、提前提醒、完整恢复备份和正常停启；不使用全服 reload。原日期记录移至 [CLI 历史](MYCLI_AGENT_CLI_HISTORY.md)，玩法细则从 [文档入口](../../docs/README.md)按需读取。

本轮 259 项 JVM 契约、9 项自部署边界和同摘要隔离 Paper 的24项联机检查通过；核对默认短文本、显式 JSON、旧 CLI 实练回执、任务/物品保持与旁人隔离，并正常保存停服。测试账号的一次状态查询由 JSON 930字符降到短文本115字符，仅代表该样本。首轮过快连续测试触发原版防刷屏，已保留失败记录，按1250毫秒间隔复测后连接持续正常；没有据此调整生产防刷屏。不是正式部署或自主 Agent 长期玩法验收。
