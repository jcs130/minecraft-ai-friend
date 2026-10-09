# 试炼入口三个难度按钮

AgentFriend 0.4.4。发布、快照与验收见 [维护记录](OPERATIONS.md)。三个原版石按钮配彩色底座、双面上蜡告示牌。

## 玩家操作

从村庄沿路到试炼塔大厅，或使用原有耗魔传送。主世界坐标：

| 难度 | 底座 | 按钮 XYZ | 告示牌 XYZ |
| --- | --- | --- | --- |
| 普通 | 绿 | `-596,92,-313` | `-597,92,-313` |
| 冒险 | 橙 | `-596,92,-310` | `-597,92,-310` |
| 末日 | 紫 | `-596,92,-307` | `-597,92,-307` |

**按对应按钮选择难度 → 核对菜单 → 点「开始」。**选择免费，不会直接启动或传送队友。发起者的选择决定全队难度；原入口12格范围内符合参赛条件的队友一起进入，请先等队友到场。菜单仍能改选难度或自动匹配。原普通配怪、冒险/末日增强、救援、耗费和奖励限制保留。原按钮明确选择普通，其他已保存偏好由本人点击或命令改变。观战者和 Eye 不能使用实体按钮发起试炼。

Java/基岩使用原版方块、牌子、聊天和箱式菜单，无须安装客户端模组；手机/Xbox实际排版和手柄体验仍须真机确认。

## Agent 入口

`/mycli arena entrance` 只读列出三个坐标、难度和确认规则，可从 `/mycli list arena` 或 `/mycli explain arena.entrance` 发现。命令操作仍为 `arena difficulty normal|adventure|apocalypse|auto` → `arena start`；`arena difficulty list`、`arena status` 查询本人选择和场次。

原 `MC_DUNGEON_DIFFICULTY`、`MC_DUNGEON_START`、`MC_DUNGEON status` 字段保持。新增私有 `MC_TRIAL_BUTTONS` JSON，`schemaVersion:1`，含 `buttons`、`confirmationRequired:true`、`selectionCommand`、`startCommand`。每个按钮含 `difficulty/label/world/x/y/z/command`。

实际区块已加载才核对实体布局，返回 `ready:true/false,verification:loaded_blocks`；未加载返回 `ready:null,verification:unknown_unloaded`，仍给固定坐标。远处查询不会加载区块，未知不等于按钮被拆；靠近重查。查询不代选、不传送、不扣费，开始才进入原开场检查。

## 维护

仅控制台/RCON：`mycli admin trialbuttons survey|build|audit`。先隔离验证，在无真人、试炼空闲、E/F完整施工前快照完成后勘察并构建。固定12格只接受空格与原普通按钮/石砖底座；容器、其他方块、近距离角色或异常施工记录拒绝覆盖。大厅原保护继续生效。

12格原方块数据和世界 UUID 先写 `trial-entrance-controls.building`，成功核验后移为 `trial-entrance-controls.before.yml`。完整布局重复构建返回 `already_ready,changedBlocks=0`。中断保留现场和标记，按施工前配套完整备份恢复，不删标记硬重试。完成后 `save-all flush`，再做施工后 E/F 完整快照与正常重启核对。隔离世界、玩家和前像不部署。

回退走正常维护并核对这12格与世界 UUID；旧版只认原按钮，应避免留下无效新增按钮误导玩家。保存前像，遇到后续玩家改动先核实，不为回退界面覆盖其他玩家进度。原版协议隔离验收脚本：`plugins/AgentFriend/trial-buttons-onboarding-stage.mjs`。
