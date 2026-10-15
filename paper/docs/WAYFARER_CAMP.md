# 城西旅人营地

2026-10-15：在线建设和设置，无 Paper、登录代理或模型服务重启。沿用 Paper 1.21.1 / AgentFriend 0.4.41 / CortiEyeMirror 0.1.16；这是世界内容与迎新配置更新。

## 出生和引导

| 项目 | 设置 |
| --- | --- |
| 世界出生中心 | 主世界 `(-1116, 64, -600)`，朝东 |
| 随机范围 | 原版 `spawnRadius=12`；X `-1128..-1104`、Z `-612..-588`，25×25 个地面列 |
| 主城 | 东偏南约600格，中心约 `(-543, 67, -439)` |
| 引导 NPC | 引路人·阿晴，`(-1098.5, 65, -600.5)`，内部 ID `qd_wayfarer_guide` |
| 入口 | 右键 NPC 或技能罗盘；命令仍为 `/mycli --help`、`intro`、`rules`、`status`、`progress` |

新角色首次进入实际主世界，以及没有有效个人重生点的普通重生，使用原版随机出生。登录验证大厅是独立阶段，不能把大厅的出生事件当作已进入营地。已有角色重连保留保存的位置；有效的床、重生锚及原有副本恢复逻辑按原规则处理，没有新增强制登录传送。

NPC 私发三段简短中文，说明野外采集建造、主城方向、公共补给和54格个人大背包，然后以访客本人的普通权限执行 `mycli intro`、`mycli guide menu`。不报名、接单、施法或授予 OP。点击间隔3秒，48格内可见；原小满导师和其他 NPC 保留。

欢迎修订9通过 `mycli admin coach reload` 热加载。仅补充营地坐标和入门建议，继续使用现有主线、技能罗盘、大背包和按需帮助；没有增加顶层命令。大背包仍独立于任务袋、个人奖励箱。

## 地标与权限

| 地标 | 蓝图来源 | 放置原点 | 大小 |
| --- | --- | --- | --- |
| 瞭望塔 | 已安装 Structory Towers `small_firetower` | `(-1092,66,-636)` | 11×29×11 |
| 红帐篷 | 已安装 Structory `harvest/camp/tent` | `(-1144,63,-579)` | 13×7×11 |
| 清泉井 | 已安装 Structory `harvest/camp/well` | `(-1088,66,-594)` | 9×8×9 |

位置和来源清单在 [wayfarer-camp.json](../content/wayfarer-camp.json)。这是部署清单，不是自动执行的世界生成数据包；第三方 ZIP/NBT 和世界存档不进入 Git。

蓝图实体列表、容器战利品及指令 NBT 已清理；拼图块替换为声明的最终方块，旧草方块名称转换为短草，装饰营火熄灭，浅井下方补实。塔门、21格连续梯子及帐篷床保留原版功能。避免了含 TNT 和深地下室的大房屋蓝图。

清理出生方格上方树冠，保留原有63～65高度的缓坡地面，修整短步道、基础和照明。只有三座建筑与迎新亭四个明确范围归 Goddess 管理，`visitor-use: true`，门、床和指引可用，建筑和私有箱不能拆拿。随机出生方格和周边野地没有整片领地保护，可以正常采集建造。

四处登记为公开地标范围。女神的地点查询用 `query: 旅人营地`，可取得四处真实边界；默认不带筛选只返回前24项，不能把未列出解释为不存在。`complete=false` 保留现有保守语义，不代表四处营地记录缺失。未替 Goddess 到场注册额外魔法传送点。

## 验证

- 隔离 Java 1.20.6 / 1.21.1 与 Mineflayer 实际连接：20项，包括6个新账号随机落点、625个地面列、实际放置/挖掘、门和梯子、NPC 菜单、旁人不收到私有说明、有床/无床重生及原位重连。
- 同一可重复探针 [wayfarer-camp-stage.mjs](../probe/wayfarer-camp-stage.mjs) 另实跑20项。只接受带隔离标记的 loopback 副本，拒绝正式 Java/RCON 端口；每次新建不同名字的测试角色。
- 正式认证 Agent 与真实配对 Eye 检查真实地形、保护、开门、NPC、原版菜单和私有转发；核对保存后的出生设置、原领地与建筑保护快照及普通难度/三维度死亡保留物品。
- 女神现役资料已同步；实际问答任务 `task-52f4cd340c73` 读取更新说明和营地手册，正确回答坐标、随机半径、保护、床/锚及未重启事实。不是仅复制文件就宣称问答已接通。
- 基岩只使用原版方块、村民实体和容器菜单。本轮离线协议测试被现役 Xbox 登录校验拒绝，保留失败记录，没有绕过或降低正式认证。不能宣称手机/Xbox 的实际 NPC 画面与手柄操作已验收。

运营机上的探针示例（仅隔离副本）：

先启动已隔离的副本，再运行探针；探针不会启动服务。完工后正式服原生抽样为20 TPS、平均11.0ms/tick（100次样本，2位在线），不代表16个自主Agent的长期负载验收。

```powershell
$env:MC_CAMP_STAGE = 'E:/MC/ops/repairs/wayfarer-spawn-20261015/lab/paper'
$env:MC_CAMP_EVIDENCE = 'E:/MC/ops/repairs/wayfarer-spawn-20261015'
# 克隆并隔离端口后，lab/.wayfarer-isolated 标记才可存在。
node paper/probe/wayfarer-camp-stage.mjs
```

该探针会给临时测试角色两块泥土，实际放置/挖掘，并击杀这些测试角色验证重生。不要指向正式服，也不要使用真实玩家名字。按需用 `MC_CAMP_MINEFLAYER_PACKAGE` 指定含 Mineflayer 的测试 package.json。

## 备份与回退

本次没有替换 JAR，按既有在线地表维护方式处理：`save-off`、`save-all flush` 后复制受影响区块、实体、POI、level.dat 和相关配置，`finally` 恢复 `save-on`。施工前12文件已在 E/F 两盘逐文件核对，另保存6039格实时前像和逐命令发送/接收记录。临时加载的49个区块全部释放，没有新增永久 forceload。

私有前像、施工日志、验收及完工快照：

- `E:/MC/ops/repairs/wayfarer-spawn-20261015`
- `F:/MC-backups/repairs/wayfarer-spawn-20261015`

仅撤回出生设置，可通过控制台执行：

```text
minecraft:execute in minecraft:overworld run setworldspawn -544 67 -440 0
minecraft:execute in minecraft:overworld run gamerule spawnRadius 0
```

同时按前像恢复本次修改的迎新文字并 `mycli admin coach reload`，避免仍把营地说成出生点；已有角色不搬家。营地建筑可保留为公开地标。

要拆回建筑，先停用新出生点、确认施工范围无人，再按逐块前像和施工后状态条件恢复；后续玩家改过的方块要保留并人工核对。用 `fancynpcs:npc remove qd_wayfarer_guide` 删除本次唯一新增 NPC、保存，再只移除四个 `wayfarer_*` 领地并热加载。不要在线覆盖整份 region、level.dat、NPC 或 lands 文件。整套世界恢复需要正常停服及另行确认，并会回退快照之后的进度。
