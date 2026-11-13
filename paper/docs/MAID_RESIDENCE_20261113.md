# 肥鱼驻点与女仆附属调研

千灯纪现役组合为 Minecraft 1.21.1、Youer、NeoForge 21.1.252、车万女仆 1.5.3 和 YSM 2.6.5。隔离服使用同版服务端、车万女仆、协议兼容模组及女仆桥。未改动正式服。

| 附属 | 能力 | 隔离结果 |
| --- | --- | --- |
| [Promaid 1.3.4.1](https://github.com/fadersketch/Promaid-mod/releases/tag/v1.3.4.1) | 排班、自保、战术、烧制、挖矿和建造 | 启动成功，未修改的 Mineflayer 在 NeoForge 握手阶段被拒绝 |
| [Touhou Little Maid Custom Workspace 2.0.0](https://www.curseforge.com/minecraft/mc-mods/touhou-little-maid-custom-workspace/files/9286389) | 工作、休息区域及固定路线 | 启动成功，未修改的 Mineflayer 被拒绝 |
| [LittleMaidSomeInstructions 1.0.2](https://modrinth.com/mod/littlemaidsomeinstructions/version/euRMfkWt) | 定点移动、采集和递送 | 启动成功，未修改的 Mineflayer 被拒绝 |
| [Maid Self-Talk 1.4.1](https://modrinth.com/mod/touhoulittlemaid-self-talk/version/JuhLgpSw) | 欢迎语、主动开口和女仆互聊 | 启动成功，未修改的 Mineflayer 被拒绝 |
| [Maid Storage Manager 1.15.6](https://www.curseforge.com/minecraft/mc-mods/maid-storage-manager) | 拿放物品和真实工位制作 | 原生任务已实做，未修改的 Mineflayer 被拒绝 |
| [Maid Function Extension 0.1.1](https://modrinth.com/mod/maid-function-extension/version/ZT0y4tkX) | 通过对话按物品名称递东西 | Mineflayer 能进游戏。实现以抛出掉落物交付，缺少收件确认。千灯纪使用已有背包转移回执 |
| [Maid Cute Activity 1.0.1](https://www.curseforge.com/minecraft/mc-mods/maid-cute-activity/files/8968953) | 表情、闲置演出和互动 | 该 JAR 声明还需要 Kaleidoscope Cookery，现役组合启动因缺依赖而停止 |
| [MaidReform](https://www.curseforge.com/minecraft/mc-mods/maidreform) | YSM 闲置动作、指挥和倒地救援 | 作者页面仅发布 Forge 1.20.1 |

同环境基线可以通过未修改的 Mineflayer 进入游戏。安装前须核对整个客户端链路，服务端成功启动只证明模组可加载。

## 0.1.28-residence

驻点方案采用 Promaid 的限定范围巡逻和 Custom Workspace 的预设路线设计，复用车万女仆原生寻路、待机姿态及挥手动画。千灯纪现有女仆桥继续负责原实体、聊天、背包和工作台。

在女仆桥的数据目录创建 `residence.json`。管理员填写已经绑定的女仆及伙伴 UUID。按 XYZ 顺序列出 2–6 个走路点，第一点是驻点。每点须处在同一现有区块并距第一点小于 8 格，脚下需要干燥实心地面，上方留两格净空。

```json
{
  "schema": 1,
  "maidId": "00000000-0000-0000-0000-000000000001",
  "ownerId": "00000000-0000-0000-0000-000000000002",
  "dimension": "minecraft:overworld",
  "route": [[300, 90, 303], [296, 90, 303], [296, 90, 298]]
}
```

- 伙伴离线时，已核实身份的空闲随行女仆回驻点。源实体卸载时只尝试最近确认过的一处现有区块。生死和坐标未知时等待原实体出现。
- 驻点巡逻使用原生路径，路径节点限制在已配置区块内。路堵时换下一点。休息、手选任务、正在战斗和原工位订单拥有优先级。
- 访客进入 6 格内且视线畅通时，女仆转身、挥手并播放少量粒子。动作冷却 40 秒。访客可在附近点名交谈，沿用现有范围、权限及频率控制。
- 伙伴回到驻点 24 格内时恢复原随行与作息。新加的驻点区块票在恢复随行或停用时释放。全程不占玩家连接。

上线需一次正常停启来加载桥和驻点配置。回退前先在驻点让原伙伴通过已有随行入口结束驻点状态、读回原作息，再正常停服撤下驻点文件并恢复上一版桥。保留最新世界、原实体、背包和回执。原实体暂时不可用时先保留标记和备份，待能观察到原实体后处理。
