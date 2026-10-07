# 命名传送点

AgentFriend 0.3.89 提供按玩家 UUID 保存的探索地点。玩家亲自到达主世界、下界或末地的安全位置后，可以起中文名字；默认私有。记录、改名、列表和分享免费，**成功传送每次消耗 6 魔力**，沿用传送术的标题、粒子、音效和本人技能事件。地点不会随正常重启消失。

## 玩家入口

技能罗盘 → 传送地点 → **新建传送点**。接着在聊天框输入名字，这条输入由服务器接收，不进入公共聊天；输入「取消」退出，60 秒后恢复普通聊天。记录的是输入名字时站立的位置。

同一页的「我的传送点」可传送、改名、更新当前位置、分享、撤回分享和删除；删除有二次确认。「大家分享的传送点」列出其他探索者主动公开的地点，只允许传送。

菜单使用原版容器和物品协议，Java、Geyser 基岩与 Mineflayer 共用服务端规则；Java 协议菜单和聊天命名经过隔离测试。基岩真机及 Xbox 手柄画面需实际客户端验收，不能以 Pong 代替。

## Agent 与文字指令

```text
/mycli waypoint add 下界营地
/mycli goto personal:下界营地
/mycli waypoint share 下界营地
/mycli waypoint shared
/mycli goto shared:<回执里的分享码>
```

| 指令 | 行为 |
| --- | --- |
| `waypoint add <名字>` | 记录本人当前位置；同名拒绝，不覆盖 |
| `waypoint update <名字>` | 明确把本人已有地点更新为当前位置 |
| `waypoint rename <旧名> <新名>` | 改名，保留地点身份和分享码 |
| `waypoint remove <名字>` | 删除本人地点，分享码同时失效 |
| `waypoint share <名字>` | 公开名字、发现者、维度和坐标，返回分享码 |
| `waypoint unshare <名字>` | 立即撤回；再次分享会产生新码 |
| `waypoint list [页码]` | 仅列本人的命名地点，每页 36 个 |
| `waypoint shared [页码]` | 仅列已主动分享的地点 |
| `waypoint menu` / `waypoint cancel` | 打开菜单 / 取消本人命名输入 |
| `waypoint` | 只读列出公共、本人地点及旧 Essentials home |

以上 `waypoint` 均加 `/mycli` 前缀。名字支持 1–24 个中文字、Unicode 字母或数字、`_`、`-`，不含空格和点；按 NFKC 规范化，同一人忽略大小写检查重名。不同玩家可以使用相同名字。默认每人最多 32 个，配置 `waypoints.max-per-player` 范围 1–256。

分享不会复制一份不受控制的坐标。`shared:<12位分享码>` 总是引用发现者当前有效的地点；改名、更新落点保留码，撤回或删除立即使旧码失效。他人不能凭分享码修改、删除或再次授权原主人的地点。

### 机器回执

`MC_WAYPOINT_LIST ` 后接 JSON，包含 `schemaVersion/scope/page/pages/total/limit/points[]`。每个点有 `id/name/owner/ownerName/dimension/world/x/y/z/shared/available/target`，已分享时另有 `shareCode`。维度使用服务端世界键，世界身份使用 UUID。读取不加载区块，不执行移动。

`MC_WAYPOINT_RESULT ` 后接 JSON，包含 `action/status/success/reason/manaCost/spentMana` 和可选 `point`。传送先返回 `status=pending,reason=loading`；Agent 应等待最终 `status=success` 或 `denied`。最终成功另有 `MC_TRAVEL` 和 `mcagent:event` 的 `travel`；`MC_DESTINATION` 本身不证明抵达。`mcagent:state` 提供实际魔力及 `mycli:travel` 能力，`spells explain travel`、`explain waypoint.share` 可发现用法。

原 `MC_WAYPOINT id=personal:<名字> dimension=... x=... y=... z=...` 保留，命名地点的操作回执只发本人连接；已登记并附身的 Eye 沿用私有消息镜像。

## 落点与活动规则

- 只记录实际当前位置，不能输入任意坐标生成地点。
- 旁观者、死亡、乘坐载具、飞行或滑翔期间不能记录或传送；试炼、PvP 匹配/恢复和活动场地不能用自定义地点绕过流程。
- 记录和抵达都检查世界边界、安全实心地面、脚部/头部空间、火与岩浆等危险方块、下界顶层及 WorldGuard entry；传送还检查出发地 exit。
- 只异步加载已经生成的目的地区块，不借传送点生成新区域；每人最多一个待处理请求，10 秒超时，等待时移动超过 2 格取消。
- 到达前重新核对地点身份、分享是否撤回、角色状态和落点。不会挖开方块，也不会换到墙另一侧的邻近房间。失败不扣费、不播放成功提示。
- 传送位移沿用玩家传送事件，不能被任务市场算作步行探索路线。

## 数据、发布与回退

运行数据为 `plugins/AgentFriend/waypoints.yml`，schema 1；包含主人和世界 UUID、名字、落点/朝向及分享码。每次成功修改以 UTF-8 临时文件原子替换，保存失败不改变内存中的有效数据。文件格式错误时停用命名地点并保留原件，不用空列表覆盖损坏文件。

新地点独立保存，不写入 Essentials home，也不受其单 home 数量设置限制。旧 home 仍可用 `/mycli goto personal:<旧名>`、原 `/home`，并在无参数列表中显示；旧删除沿用 Essentials 权限。新地点通过新菜单或 `/mycli waypoint` 管理。

首次部署需要按 [维护流程](OPERATIONS.md) 完整备份并正常重启，之后玩家新建、改名、分享均在线立即生效。备份须把世界和 `waypoints.yml` 一起保留。回退到旧插件不会删除文件，但旧插件无法使用新地点；不得把新地点当作已迁移到旧 home，或为回退清空玩家数据。隔离脚本为 `plugins/AgentFriend/named-waypoints-stage.mjs`，私有回执与候选 JAR 在 E/F `repairs/named-waypoints-20261007`。

## 发布验收

2026-10-07 23:54 已正式生效，正常双盘备份 `20261007-235346` 后发布 0.3.89。最终功能 39、冷区块/16连接 10、重启 4、正式只读 17 项通过；真实原生 Eye 私有转发和原机恢复已核验。具体性能、失败材料与回退见 [维护记录](OPERATIONS.md)。
