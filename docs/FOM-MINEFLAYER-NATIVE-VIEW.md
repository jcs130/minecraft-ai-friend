# FOM 的原生 Mineflayer 观察与网页画面

2026-10-21。目标版本为 FOM 2.42 / Minecraft 1.21.1 / NeoForge 21.1.250。

已发布到现有 TCP 28977。交付目录为 `E:\MC\integrations\fom-native-view-20261021-v2`，包含 SDK tgz、冻结 renderer、原素材与 `client.example.json`。示例默认 `enabled:false`；为自己的账号配置后再启用，不会恢复既有暂停 Agent。源码核心 c61e4fca、共享可视化 c6626047；[发布证据](evidence/fom-native-mineflayer-20261021.json) 记录了正式 SDK/普通 Mineflayer 只读登录、双盘备份、健康与覆盖缺口。

## 数据路径

继续用 TCP 28977、`ag_` 账号和既有 MixAuth 策略。网关先捕获本连接收到的原生包，再生成普通 Mineflayer 所需的兼容投影。原生副本通过私有 clientbound `mcviewer:native_packet` 发回同一连接；不增加观察者账号，不需要公网 MCP、网页管理端口或 OP。

`agent-mc-world` 的可选 `nativeView` 模块在登录包之前附着到动作 bot。共享 `mc-visual-console` 用原生注册表、原始资源和相同账号的容器状态渲染，不拿兼容 `paper`、替代方块或另一个账号的背包当原始数据。不同账号不共享状态缓存；重连、维度切换、序列缺失和断开均清理本连接缓存。

二进制 v1 是 `MCNP` + deflateRaw(v8.serialize(envelope))，不是技能状态频道的 UTF-8 JSON。envelope 包含 schemaVersion、Minecraft 版本、原生 block-states SHA-256、连续 sequence、包名和 params。最大压缩帧 1 MiB、解压 16 MiB，接收端拒绝版本/哈希/序列不符的数据。只镜像明确支持的游戏包及特定菜单/女仆动画载荷，不开放任意服务器文件或配置。

## Agent 用法

配置例子，路径按 Agent 所在电脑调整：

```json
{
  "enabled": true,
  "host": "192.168.3.163",
  "port": 28977,
  "username": "ag_MyAgent",
  "version": "1.21.1",
  "keepAliveTimeoutMs": 180000,
  "viewerPort": 3007,
  "nativeView": {
    "module": "file:///E:/MC/integrations/fom-native-view-20261021-v2/renderer/host/native-mineflayer.mjs",
    "assetsDir": "E:/MC/integrations/fom-native-view-20261021-v2/assets"
  }
}
```

外网仍用 `micro.kangqiang.site:28977`。首次登录和已设密码账号的登录规则不变。此例不包含凭据；保持原来的账号私有凭据配置。`module` 是本机受信任代码，必须由操作者明确安装；不会自动发现或下载执行远程 JS。`viewerPort: 0` 可仅启用结构化观察。网页绑定 Agent 本机回环地址，浏览器源为 `http://127.0.0.1:3007/`，不是服务器新增的公网入口。

本入口两次实测心跳间隔为约 120 秒，测试客户端默认 30 秒会主动超时；FOM 示例显式设 180 秒。未调整核心的通用默认值，也不通过游戏命令心跳掩盖断线。

新增只读工具：

| 调用 | 结果 |
| --- | --- |
| `mc_native {"action":"status"}` | 当前账号、维度、时间、注册表哈希、流状态和覆盖限制 |
| `mc_native {"action":"inventory"}` | 本人的原生物品 ID、数量、组件可解码性、当前原生菜单 |
| `mc_native {"action":"block","position":{"x":10,"y":64,"z":20}}` | 绝对坐标的原生方块/状态/属性，及可用的静态碰撞参考 |
| `mc_native {"action":"entities"}` | 本连接实际跟踪、16 格内可见实体的原始类型、UUID、坐标及元数据 |

方块查询只读收到的区块，并检查距离、遮挡；未加载或不可见返回 unknown/unavailable，不把它当空气，不加载远方地形。物理形状来自原生 EmptyBlockGetter 导出，`playerContextVerified:false`，不能当作所有位置/玩家碰撞条件都已验证。

启用原生适配后 `mc_bag` 返回原生库存 JSON；有 `item` 时按精确资源 ID 列出匹配槽位。该模式不声称支持中文别名、自定义显示名或历史代理箱子检索。普通装备/计数选择器可用原生 ID；只给原 Prismarine Item 附加同连接、同 stateId/槽位/数量的可撤销身份标签，不更改其 wire ID、组件、数量或 `.name`，容器操作仍走原 Mineflayer 协议。

**普通 `bot.blockAt`、原有环境快照与 pathfinder 仍读兼容投影**；原生查询结果不代表已改完路径规划、模组配方或所有技能。进行复杂机器、载具和未适配菜单操作时继续用完整客户端桥或对应原生模组接口，不能凭原始 ID 猜按钮。

## 素材、菜单与覆盖范围

使用本服 103 个实际 JAR、锁定的 Mojang 1.21.1 客户端及 NeoForge 21.1.250 导出原资源；原始模型、PNG、UV、命名空间和 mcmeta 保留。186696 状态与原生库存分别从当前真实表读取。`tools/build_fom_native_view.py` 可复现导出，并可合并逐状态核验的原生碰撞参考；`tools/build_fom_gateway.py --native-viewer` 冻结网关与原生注册表。

原生菜单先保留真实菜单 ID/内容，再隔离不认识的 vanilla parser；不能因为数字恰巧等于原版菜单就伪造界面。无法确认自定义菜单的玩家库存布局时，库存明确标为陈旧，保留带时间的历史快照；不把未知槽位清空。原始附魔/药水动态注册表及未知模组组件尚未全部转成完整 SNBT，会保留真实 ID/数量并说明缺失 codec。

本轮实际网页验证覆盖安山机壳、番茄箱、经验方块的原模型，以及安山机壳/稻米原图标、魂符七帧动画图标、本人背包与视角。魂符附魔光效缺原图集 UV，仍明确 partial。Create 机壳与 Farmer 稻米按锁定 JAR 的真实构造/类行为加入静态物品 provider，不按 JSON 文件存在就开放所有物品。

全局 `renderParityVerified` / complete 保持 false：45 处原素材优先级冲突仍未全部审计，复杂机器动画、所有怪物/女仆模型、自定义 GUI、全物品渲染、原版 HUD 全部属性和 Java 像素一致性未全部通过。未支持内容显示具体原因，不能补成近似原版外观。

## 运维与验收

网关继续由现有 FOM owner/watchdog 管理；原生网页由该 Agent 连接生命周期管理，不另留裸进程。健康探针验证冻结目录和原生注册表，panel smoke 沿用 `--society-fom-smoke`。旧 35 模组服与暂停 Agent 不恢复。

隔离工具 `tools/smoke_fom_native_view.mjs` 只允许带标记的回环研究服。用一个普通非 OP 账号核对原生方块、物品存取/装备、UUID 和资源，测试材料及临时方块均在私有夹具台账记录；清理需读回真实库存/空气。断线后清理不能冒充完成，应重连同 UUID 对账。浏览器测试是经用户授权的无头 Edge/WebGL；不等于完整 Java 对照或长期自主玩法验收。

原资源、JAR、世界、认证数据库、原始帧、库存截图和完整回执均留在 Git 外。发布只更新冻结网关、受守护的控制工具和 SDK/renderer 交付目录；正常停止、双盘校验备份后再修改活动配置，原有 Java/基岩端口、账号和存档保留。回退选回旧网关及控制工具，不回滚玩家的新存档。
