# 主村庄刷怪配置

这两份文件是 `server/mc/config/incontrol/areas.json` 与 `spawn.json` 的可提交源，部署时只复制对应两份文件。其余 InControl 规则保持现役原样。此前仓库没有安全区配置生成器，故直接保存原生 JSON，不增加运行服务或第二套规则系统。

本次语义按生产 **Minecraft 1.21.1 / InControl 1.21-10.2.7** 的实际 JAR 核对，JAR SHA-256 为 `af673d816df02b00f8c5eb787fa72cf10e540bfe3ce00d4b87d08d73455080ed`。升级该模组时须复核以下语义，不能套用旧版 `onjoin: true` 写法：

- `Area.isInBox` 使用各轴 `abs(position-center) <= dim`，`dim` 是含边界的半尺寸。横向保留现役 **X -715～-375、Z 695～1035**；`y=128, dimy=192` 覆盖 **Y -64～320**，包含原版主世界全部可建造层 -64～319 及其上边界。它不宣称覆盖任意无限高度或未来自定义维度。
- `SpawnRule.parse` 未写 `when` 时仅默认 `position`。`ForgeEventHandlers` 分别调度 `position`、`finalize`、`onjoin`；因此每个拒绝条件明确配置三个入口。原 phantom 规则保留。
- `hostile` 在该版本按实体是否实现原生 `Enemy` 判断；普通村民、铁傀儡、动物、宠物不在此条件中。未实现 `Enemy` 的自定义攻击型实体不应凭名称擅自加入清理名单。
- `onjoin` 能拒绝进入世界的匹配实体，包括相关区块实体重新加载；它不是持续移动边界或伤害屏障。已加载、从外围走进村庄的敌对实体仍需另按真实类型/UUID审查。配置不会扫描或批量清理存量实体。

2026-09-20 检查到现役原配置在 10:06:06 被 MC 正常读取，主村中心没有错位，但只有默认 position 两条规则、Y=25～125。当天 12:00:54 禾叔在区域内被僵尸杀死，前一天另外三名村民有僵尸/掠夺者死亡记录。这证实有实际战斗死亡；日志不能判定凶手究竟通过哪条生成或移动路径到达，亦不能解释全部铁傀儡缺失。细节与本机 JAR 反汇编证据保存在忽略目录 `runtime/village-recovery-20260920`。

## 部署与读回

由主维护流程备份原两文件、核对版本和源哈希、复制两文件；本目录不自动修改生产。该版本 `CmdReload.run` 先调用 `getPlayerOrException`，所以裸 RCON `incontrol reload` 不可用。可借用一个已确认在线的ServerPlayer命令身份执行 `execute as <玩家名> run incontrol reload`；本服实际使用现有Goddess，不传送身体、不触发模型。

`Reloaded InControl rules` 消息在实际加载前发出，不能单独作为成功依据。必须核对随后 MC 日志重新读取 `areas.json` / `spawn.json` 且无解析错误，并核对生产文件哈希。`execute as <主村内现有在线玩家> run incontrol area` 可读取该身体所在区域；`CmdArea` 直接读取玩家身体位置，`execute positioned` 无法伪造边界测试。`incontrol showstats` 可从 RCON 只读将计数输出到 MC 日志；自然发生的拒绝计数可作后续观察，零计数不能证明配置失效或永远无怪。

`tests/test_village_safe_zone.py` 固定原生条件/钩子、历史死亡位置、完整高度及边界内外行为；它验证配置契约，不冒充生产实际刷怪验收。

本轮已部署并完成四个实际高度的加入测试、精确残留清理和后续观测；证据、恢复身份及限制见 `docs/VILLAGE-RECOVERY.md`。
