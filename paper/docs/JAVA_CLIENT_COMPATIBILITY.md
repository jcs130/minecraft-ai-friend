# Java 客户端多版本接入

2026-10-11：**已正式上线；没有排队重启。** 正式游戏服仍为 Paper 1.20.6，AgentFriend 0.4.22，原 Agent 客户端保持。

## 实查结果

Paper 已启用 ViaVersion / ViaBackwards **5.12.1-SNAPSHOT**，不是缺少游戏服兼容插件。正式 `192.168.3.163:25565` 入口已实测 1.12.2、1.16.5、1.20.1、1.20.6 登录、世界实体与 `/mycli inventory` 成功；1.21.4、1.21.11 在 LibreLogin 的 NanoLimbo 等候区被 `Unsupported client version` 拒绝。

## 已上线配置

在现有 Velocity 登录代理加入官方稳定 **ViaVersion 5.12.1**、**ViaBackwards 5.12.1**，并将该代理的 **PacketEvents 2.8.0 更新为 2.14.0**。只增加两个兼容插件和一份配置、更换一个依赖；原 Paper 的 Via 插件与 Geyser/Floodgate 保留。

代理配置的 `auth` 与 `paper` 均固定为实际后端协议 **766（1.20.5/1.20.6）**，关闭定时探测覆盖。Java 在代理处转换成后端协议，游戏服的 Via 对这条已转换连接不再次降级；Geyser 直接接 Paper，仍使用游戏服原有 Via。模型 Worker 的独立 1.21.1 连接保持。

八个隔离实际协议客户端均完成密码登录、世界区块/实体加载和玩法库存查询：

| 实测版本 | 结果 |
| --- | --- |
| 1.9.4、1.12.2、1.16.5 | 通过 |
| 1.20.1、1.20.6 | 通过 |
| 1.21.1、1.21.4、1.21.11 | 通过 |

1.20.6 与 1.21.4 另各通过四项：现有自动登录门禁、真实 Minepacks 打开/关闭、原 UUID 与实体对应的 Worker 模型确认、网页/相机原模型资源及每份源文件 SHA256。测试仅给隔离 QA 角色绑定 `neko_yui/default`，没有改正式玩家模型。两项额外认证检查通过：新版未登录客户端不能进入 Paper 或使用 `/mycli`、`/backpack`；`corti` 独立强密码与原 UUID 保留。

初始失败均留证：只加 ViaVersion 会破坏部分老版本等候区，故加入 ViaBackwards；PacketEvents 2.8.0 误解新版 JoinGame 导致 1.21.11 连接中断，更新后通过。旧 Mineflayer 测试驱动在配置切换期间继续发送移动包，即使 `physicsEnabled=false` 也如此；最终使用禁用 physics 插件的被动协议夹具。原正式 Agent 仍用 1.20.6；不能将这些测试说成任意 Mineflayer 版本的完整自主行为验收。

## 使用边界

- 版本兼容用于接入现有 1.20.6 世界，不会增加新版本玩法；旧客户端可能看到物品/方块替代外观。
- 1.16.5 及更早客户端不能完整显示 Y<0、Y>255 的世界，建议真人使用 1.20.6 或较新的已验证版本。
- 当前配置不覆盖 1.8 及更早版本，也不承诺 26.x；现役 Velocity 的最高协议为 1.21.11。
- 基岩版继续由 Geyser/Floodgate 接入，版本范围看 [基岩兼容](BEDROCK_COMPATIBILITY.md)。
- YSM 模组本身仍需与 Java 客户端版本匹配。网页/相机资源传输通过，不等于所有 Java/手机/Xbox 外观已实机验收。

## 发布与回退

服主确认“现在通知并上线”后，已发送180/60/10秒预告，确认无真人及活动副本，沿原维护锁暂停 Watchdog，正常停启代理及模型服务。Paper 技术上无需重启，Java 连接会短暂断开；不得通过免密或修改 UUID 绕过认证。

替换前须将当前代理插件/认证数据库及模型保存数据做 E/F 双盘停服前像并校验；原全量冷备 `20261011-211820` 另行保留。只应用私有 `prepared-plan.json` 的五个已固定摘要操作，不能在线换类、不能保留两个 PacketEvents JAR 同时加载。重连后重新核对多版本登录、基岩入口、背包、原模型与玩家身份，再发送实际更新说明。

回退时正常停止代理/Worker，保全当前数据库与模型存档；移走新增 ViaVersion、ViaBackwards、配置和 PacketEvents 2.14.0，恢复原 PacketEvents 2.8.0。保留玩家在更新后产生的世界、物资和密码变更，不以旧数据库覆盖新进度。由原维护流程恢复并确认原 1.20.6/基岩接入。

发布清单：[固定版本及验证](../manifests/java-client-compat-20261011.json)；配置：[代理 ViaVersion](../config/viaversion-velocity.yml)。私有验证/停机前像在 `E:/MC/ops/repairs/via-compat-20261011`，不包含在 Git 中；没有写入自动发布标记。

官方来源：[ViaVersion 5.12.1](https://github.com/ViaVersion/ViaVersion/releases/tag/5.12.1)、[ViaBackwards 5.12.1](https://github.com/ViaVersion/ViaBackwards/releases/tag/5.12.1)、[PacketEvents 2.14.0](https://github.com/retrooper/packetevents/releases/tag/v2.14.0)、[Via 安装说明](https://github.com/ViaVersion/ViaVersion/wiki/Installation)。

## 正式发布回执

2026-10-11 22:49完成五个固定摘要操作：加入两个Via插件、固定后端配置、更新PacketEvents并移走旧2.8.0。替换前503文件约347MB代理/模型快照在E/F均校验完成，原全量世界冷备20261011-211820保持。23:13另按服主追加要求上线正版免密码/Eye自动观战，见[登录新规则](PREMIUM_EYE_LOGIN.md)。两轮Paper均保持PID36640、原网关PID23456及全部游戏服JAR，维护标记已清除。

最终两轮配置下八个正式协议客户端全部完成登录、解析主世界实际列与脚下圆石、加载实体和库存查询；不是仅收到chunk包就宣称世界加载。老版本在空白等候区打印过块实体警告，正式世界实读通过；原始回执保留。真实Minepacks与模型/资源分别在1.20.6/1.21.4最终隔离服通过，正式基岩UDP入口正常。手机/Xbox画面、远端Web更新和真人正版成功仍须独立核验。
