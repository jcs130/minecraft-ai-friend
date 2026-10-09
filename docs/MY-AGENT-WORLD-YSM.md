# My Agent World：YSM 接入与原模型展示

## 当前更新（2026-10-09）

普通玩家现在可通过本人的 SDK 调用 `ysm.catalog` 分页读取原模组模型、纹理 ID、授权与当前外形，再以 `ysm.select` 切换本人外形。服务端调用锁定 YSM 2.6.5 原生 serverbound 处理器，保留原授权、服主强制模型及允许换模配置；不授予模型、不修改他人 attachment。选择必须携带当前模型、纹理、enabled、mandatory 四项 CAS，失败或未知不能自动重投。

```js
const catalog = await sdk.call('ysm.catalog', { offset: 0, limit: 12 })
if (!catalog.ok) throw new Error(catalog.code)
const current = catalog.state.current
const result = await sdk.call('ysm.select', {
  modelId: 'misc/2_steve', texture: 'tartaric_acid',
  expectedModelId: current.modelId, expectedTexture: current.texture,
  expectedEnabled: current.enabled, expectedMandatory: current.mandatory
})
```

目标 ID 必须从真实目录发现；示例并不为任意模型授予权限。统一调用目录现为 60 项（25 只读、35 变更），仍使用 19 个 SDK 频道。选择成功只证明原生外形状态已改变，不能作为该模型网页渲染通过的证明。

网页已绑定三套原资源：`misc/1_alex / gsl`（61 骨骼、47 方块、64×64 PNG），`misc/2_steve / tartaric_acid`（61 骨骼、46 方块、64×64 PNG），以及 `misc/3_default_boy / blue|red`（58 骨骼、156 方块、128×128 PNG）。不使用别名或替代人体。Alex 原资源没有 idle clip，页面明确报告这一缺口；原 `default/default` 及其他模型、装备、第一人称手臂和完整动画仍未适配。原有 `parity=false` 与严格完整场景验收限制保留。

本轮普通非 OP `MawVisualQA1009` 通过真实 mc-agent-neko Mineflayer 身体与上游 WebSocket 调用完成 Steve → Alex → Boy/red，实际浏览器显示原模型；错误纹理、过期 CAS 被拒绝，同 callId 仅返回既有回执。重连与新服正常重启后 Boy/red 保留，MawExplorer 的 Boy/blue 不变。测试未启动 `Agent.start`、没有模型调用或 QwenPaw 连接。测试站位和切割台材料有明确管理员夹具，仅证明普通接口和画面可用，不声称自主生存获得材料。

当前桥 SHA256 为 `576c911f0ba2b9f07c7a03f246e21a2497c9d36646e55ca0959be9a2372dfe28`；资产目录为 `native-20261008-v14-mod-operations`，27 个运行 JAR。下方 2026-10-05 的 v10/v11 数量、哈希、显示范围和维护记录均为历史，不能用作当前锁。

## 2026-10-05 历史实现

常驻实验服 `E:\QiandengJiSocietyLab\server\world-life` 已安装 YSM 2.6.5（NeoForge / Minecraft 1.21.1）。普通玩家 MawExplorer 使用 `misc/3_default_boy`、`blue` 贴图；原 UUID `e371227c-09fa-3722-84f4-f3228a552c3c`、非 OP 身份与原世界保留。原女仆继续使用 TLM 灵梦模型。没有修改旧 Paper 服务、路由器或公网端口。

来源：[官方 Modrinth 版本 HZWaR0LY](https://modrinth.com/mod/yes-steve-model/version/HZWaR0LY)。JAR 为 63,463,229 字节，SHA256 `b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb`，下载时与官方 SHA1、SHA512 逐项一致。Default Boy 的原 `ysm.json` 声明 CC0 / free；模型与 PNG 来自该 JAR，没有改图、另造人体或解密模型。

## 当前显示范围

网页使用同一 Mineflayer 账号连接接收的原生 `maw_agent:menu_state / self.ysm`，由服务器读取本人的既有 `yes_steve_model:model_id` attachment。字段包括本人 UUID、模型、贴图、启用与强制显示状态；不初始化 attachment，也不传授权、缓存或密钥。YSM 整个 JAR 与实际 attachment class、getter 签名只在首次读取时验证，后续快照读取缓存方法。

网页 provider 只支持 Default Boy 的 `blue` / `red`：58 骨骼、156 方块、936 面，使用原始 128×128 PNG、几何及 `main.animation.json`。本轮已实现原 `idle` / `walk` / `run` / `jump` 关键帧的有限预览、身体与相对头部方向、原眼神与眨眼表达式，以及原页面背包中本人实际 YSM actor 的镜像预览。背包不另造默认人体，不销毁场景共享的原材质或贴图。本轮有限动作与背包预览已在隔离服实际验收，并部署常驻实验服；Java 完整一致性仍未验收。

同一账号的 `maw_agent:menu_state / self.motion` 每 250ms 提供 schema 1 的真实 `same_player_server_tick` 观测：本人 UUID、服务器 tick/gameTime、身体和头部当前/前一 yaw、pitch、位置、速度及实际姿势/动作标志。客户端接入会校验 UUID、source、完整字段与新鲜度。身体用原 renderer 的 `Ry(180-bodyYaw)` 基线，相对头角独立叠加；相机仍使用本人连接的 look yaw，不把相机方向重复算入身体。服务器观测不是匹配 Java 客户端的插值或动画状态。

动作时间仅在同连接已收到的 50ms physics tick 插值窗口内有界推进；窗口结束保留已知姿态，不凭浏览器时间补造后续 tick。缺失/过期运动、未知动作、teleport 基线或断流会明确不可用并重置动画或销毁旧 actor；epoch 和模型/贴图切换不能复活旧异步加载结果。原 controller 更高优先级的死亡、睡眠、游泳、攀爬、飞行、受击等姿势，以及使用物品/挥手动作目前拒绝有限主动作成功声明，不以 idle 替代已知未适配姿势。眨眼使用从本次浏览器 actor 基线开始、由真实 physics tick 限制的 animatable 时钟，不能声称与另一个 Java 客户端绝对相位一致。

原主动作的 0.1 秒过渡期间，新 clip 时间保持零；过渡混合、打断与未激活骨骼恢复未实现。JSON-to-runtime 通道符号、几何烘焙、材质、客户端头部/眨眼相位及整体画面尚未与匹配 Java 客户端验收。`channelTransformParityVerified`、`transitionRenderingAvailable`、`blinkPhaseParityVerified`、`headPhaseParityVerified`、`animationParityVerified`、`completeEntityParityVerified` 均保持 `false`。装备、第一人称 YSM 手臂和其余姿势未实现；资源哈希或单元测试通过不等于完整 1:1 渲染通过。

模型身份或资源未知会明确不可用。缺失本人状态时等待；只有服务器明确 `enabled=false` 或未安装 YSM 时才使用原玩家皮肤。不能把未知 YSM 静默画成原版人体。基岩新实验服仍未验，不能据此宣称基岩能显示 YSM。

## 切换与回退

由当前实验服的 owned console 操作；不使用历史 `world/tools/ysm_assign.py` 的旧 RCON 默认端口，不授权全部模型，不加 `ignore_auth`。带斜杠的模型 ID 保留引号。以下是原生控制台命令：

```text
execute run ysm model set MawExplorer "misc/3_default_boy" blue
execute run ysm model set MawExplorer "misc/3_default_boy" red
execute run ysm model disable MawExplorer true
execute run ysm model disable MawExplorer false
```

执行入口为 `tools/maw_service.py console --config E:\QiandengJiSocietyLab\services\service.json --command <上述单条命令> --request-id <每次操作唯一ID> --reason <原因>`。投递 stdin 的回执只代表已投递；必须在 `http://127.0.0.1:28984/status` 读回本人的 `selfPlayer.ysm`，并检查实际网页。

显示入口：[常驻服俯视](http://127.0.0.1:28984/dungeon/)、[第三人称](http://127.0.0.1:28984/third/)。此前 v10 静态试换时站位紧挨女仆与建筑，第三人称相机可能被挤到女仆体内；当时俯视已经实见蓝衣玩家。这是历史镜头遮挡记录，不能靠替换模型或管理员传送冒充自主移动解决，也不作为本轮动画验收证据。

## 本轮部署与维护边界

本轮已部署桥 SHA256 为 `12f68471235ace812aab4608212f69c97ece3580d48252be9f6ae02738624ebb`，配套资产目录为 `E:\QiandengJiSocietyLab\assets\native-20261005-v11-ysm-motion`，共 39,767 文件。部署须逐字核对当前锁、桥、资源清单与 YSM JAR；资源优先级冲突和严格完整渲染 guard 保留，不复用旧导出目录来冒充新桥配套证据。

沿用正常维护暂停、保存世界、owned supervisor stop/resume 与同账号读回流程；维护暂停和导航 unknown 导致的自主暂停是两种状态。前者结束不能清除后者，也不能重投未知动作、补造成功回执或改写旧账本。只读健康、服务器连接在线或模型可见都不代表自主决策已恢复。模型命令仅改变外形选择，不授予 OP、材料或技能。

新动作验收应分别记录：本人 `self.ysm` / `self.motion` UUID/source/采样时间、实际原 clip 及 unavailable 原因、蓝/红与断流重连、body/head 独立转角、眼神/眨眼、本人背包镜像，以及未适配姿势的明确提示。真实 Java 客户端通道、材质与相位对照另行验收；有限浏览器预览不能代替这份证明。

## 历史静态试换验收与维护记录（v10）

- 隔离端口 28978/28979/28986：普通 `MawYsmQA` 通过 Mineflayer 网关实际登录，原生命令切蓝、红；网页无刷新完成切色；关闭 YSM 后恢复原皮肤。一次站桩被女仆精灵击杀保留为测试事件，随后只把该测试账号置 creative 展示，不计自主能力。自然 QA 主账号未上线执行决策。
- 常驻 28976/28977/28984/28985：保存后正常停止，三子进程 exit 0；备份 `E:\QiandengJiSocietyLab\backups\ysm-model-switch-20261005`，原世界未重生成。恢复后原账号实际在线、真实 attachment 确认蓝款；原生截图 `research/ysm-model-switch-20261005/main-blue.png`。隔离监督已正常 shutdown。
- 新桥 SHA256 `91b7281c4ed5f092f6eaa74960de834c32fa73025971b7b5b5636cde16223538`；29 个运行 JAR 与锁一致。资产 `native-20261005-v10-ysm` 全部 39,767 文件校验通过（新增 640 个 YSM assets），原冲突与完整渲染未验标记保留。后续部署从当前锁使用原生资产导出器；不可混用旧 JAR、旧模型资源或号表。
- Java21 编译与 29 项独立 attachment/hash 边界断言通过；6 项安装保护回归通过；网页原资源回归 394/394，无 skip。初次测试误把 codec 配成 datatypes 模块导致 1 个测试失败，改为运行目录 `minecraft-protocol/src/transforms/serializer.js` 后通过；失败原证据保留。
- `society_lab.check_runtime` 的初始化检查仍假定 `level-name=world-lab`，对现有 `world-life` 会拒绝；本次单独逐项核验全部 JAR/额外文件，未改世界名以通过旧初始化检查。

**现存决策暂停保留：** 本次维护创建暂停标记前，Agent 于 13:14:38 已因导航动作 `7927420b-0a39-46a5-b172-907e5c3a5598` 结果不明自行暂停。原 `autonomy.paused` 字节已备份并保持，旧行动与模型账本没有删改或重投；最后模型任务已终态。服务维护暂停已解除，游戏连接在线，但自主决策仍暂停。此轮只更换模型，没有把该导航算成功，也没有清除未知行动保护。

## 本轮实际 QA / main 验收记录（v11）

- 隔离普通玩家 MawYsmQA 同连接脚本实际行走、跑步、跳跃、转头，浏览器识别原 clip 并看到骨骼姿态变化；本人背包显示蓝款原 actor。蹲伏明确“当前动作未适配”。这些是无模型调用的脚本视觉验收，不计 Agent 自主游玩。原眼神表达式和体头独立转角已通过真实资源数值回归，眨眼 Java 相位未验。
- 测试平台仅建在隔离副本；初次 fill 因区块未加载失败，一次测试传送后落地死亡保留原日志，平台加载后重新验证；没有在常驻服 TP/heal/give 或更改 OP。此轮未重复实际切红，旧 v10 切色记录只证明历史外形，当前身份/异步切换隔离由回归覆盖。
- 14:27 正常停止常驻服，java/gate/worker 均 exit 0，完整备份世界、配置及 Agent 状态/行动/模型账本至 E:\QiandengJiSocietyLab\backups\ysm-motion-20261005。14:28 恢复后原 MawExplorer UUID、蓝款原 attachment、本人运动来源与新鲜度读回成功，原世界未重生成。随后仅收尾等待插值帧的文字提示并正常重打包；已知姿态冻结与数据过期有不同提示，不改变 unknown 账本。
- 39767 文件校验通过，桥 SHA、当前锁与 v11 资源清单一致。Java21 编译成功；网页完整原资源回归414/414无skip、服务端健康/安装保护16/16通过；末次提示调整4项定向回归通过。
- 私有证据目录 research/ysm-motion-20261005：qa-walk.png、qa-run.png、qa-jump.png、qa-inventory.png、qa-unsupported.png、main-inventory.png、asset-proof.json、main-native-state.json、main-health.json。隔离监督正常shutdown，三子进程 exit0，28978/28979/28986/28987关闭。旧Paper及8088进程保持原PID。
- 运行健康检查中所有连接、原生状态、YSM身份与运动就绪项目为true；仅autonomy-active=false，因此整体ok仍false，原因是原导航unknown暂停，不是服务断线。动画/材质/装备/第一人称/完整画面parity继续false。

性能边界：self.motion仍搭载现有menu_state，5 server ticks一次；sampledAt/tickCount使完整菜单稳态去重失效，20TPS为4Hz，最大60000字节负载的理论上限约240KB/s/订阅连接。当前小规模验收不等于多人压力测试。后续应将运动快照拆为有界私有增量消息；不可增加聊天刷屏或Qwen模型任务。
