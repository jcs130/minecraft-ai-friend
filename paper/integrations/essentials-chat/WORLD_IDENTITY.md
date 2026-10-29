# 世界身份与频道：当前契约

## 实际证据与上线边界

- 正式已为桥 **0.2.10** 与官方附近聊天；没有新增世界事件通道。
- 桥 **0.2.10** + 官方 EssentialsXChat 已正式发布，34 项真实联机、248 项原生规则通过；源码范围是 `PlayerLocationView.java`、`VortexBridge.java`、`NativeParties.java`。
- 另4项独立原版协议检查通过。直连同版本 Paper 1.21.1 的 `login.worldState` 为 `{name:"minecraft:overworld",dimension:0}`；换世界后的 `respawn.worldState` 为 `{name:"minecraft:aincrad",dimension:0}`，换回恢复原名。该 Mineflayer 的 `bot.game.dimension` 三次均是 `overworld`。因此 dimension type 不能作为容器/地标/附近事实的唯一索引。
- 上述原始数据包是在隔离服直接捕获。正式服真实 Bukkit 世界已只读核对，但本轮没有借用真实角色重新登录捕获代理后的完整线上协议；不能把隔离结果说成代理每条路径均已验收。

原版已提供独立 world name，核心优先保存原始 `login/respawn.worldState.name`，复用既有连接/世界切换生命周期清除旧事实，避免另加服务器轮询或模型任务。不要要求普通原版服务器安装本桥才能分清两个世界。

## 候选已有字段

`/mycli status --json`、`intro --json` 及 `guild party status --json` 的 `location`：

```json
{
  "world": {
    "name": "aincrad",
    "key": "minecraft:aincrad",
    "uuid": "cd220377-ee41-48db-8602-2b32f18cb1f1",
    "label": "艾恩葛朗特"
  },
  "position": {"x": -500, "y": 69, "z": -475}
}
```

`name` 是 Bukkit 世界名；`key` 是真实世界 key，不能由 `dimensionType` 猜出；`uuid` 是 `World.getUID()`。位置信息在主线程、实际查询完成时读取，块坐标采用 Bukkit 负坐标向下取整。默认人类文本保留世界名/key与XYZ，不铺满 UUID。

队伍 `members` 继续使用原生管理器的真实 UUID/名称/角色，并附 `online`：

- 在线同世界：`location`、`sameWorld:true`、实际三维 `distance`（一位小数）。
- 在线不同世界：`location`、`sameWorld:false`、`distanceUnavailableReason:"different_world"`；**不提供 distance，不能当0**。文本明确“不同世界，不能比较距离”。
- 离线：`online:false`，不提供 location/distance，不复用旧坐标。若原生队伍已移除离线成员，直接沿用其实际名单。

当前没有提供 `dimensionType`、统一 `instanceId`、采样时间或切换 revision；未知不能补假值。原生包的 `dimension` 索引可由客户端当前注册表解析类型。这里的 Bukkit UUID 是世界实例身份，不是副本场次 ID；现有同世界遗迹场次继续查原地下城状态里的 run ID，不新造一套实例机制。

这些扩充限于已存在的状态/队伍查询。登录、传送、重生和重连仍走原版 login/respawn；还没有实现新的主动广播、容器交接回执扩充或全生命周期 revision，不能宣称客户端旧容器事实已自动修复。

## 聊天

官方插件在同实际世界的48格范围内选择收件人。`!内容` 明确全服，下一条普通聊天仍是附近；原版 `/msg` 保持 incoming/outgoing whisper。

`player_chat.senderUuid` 保留真实发送者，`unsignedChatContent`/Mineflayer `message.unsigned` 装饰里含 `[附近]` 或 `[大喇叭]` 与来源世界别名；签名正文与装饰分开，`messagestr` 不一定带标签。插件没有另附原始 world UUID 频道字段，不能把世界别名当权威实例键，也不能从正文里的名字猜 UUID。女神 spy 的旁听不是附近或可见证明。

完整客户端闭环仍须验证：按真实世界索引不同坐标事实/容器，同世界重生身份稳定，切世界/重连清理旧会话事实，真实物品/交易回执才算交接成功。当前联机检查覆盖世界查询、同坐标不同世界、组队距离、切换后即时查询及离线读数，不冒充这些客户端能力已经全验。

## 复现

带标记的专用本机 29086/29087：`paper/probe/proximity-chat/check.mjs --rpg` 和 `native-world.mjs`。只使用 QA 自建角色，不传送真实角色、不变更正式组队/背包，也不重新登录借用真实账号。测试结束正常停服。
