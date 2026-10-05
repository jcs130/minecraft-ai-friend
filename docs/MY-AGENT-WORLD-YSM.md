# My Agent World：YSM 模型试换（2026-10-05）

常驻实验服 `E:\QiandengJiSocietyLab\server\world-life` 已安装 YSM 2.6.5（NeoForge / Minecraft 1.21.1）。普通玩家 MawExplorer 使用 `misc/3_default_boy`、`blue` 贴图；原 UUID `e371227c-09fa-3722-84f4-f3228a552c3c`、非 OP 身份与原世界保留。原女仆继续使用 TLM 灵梦模型。没有修改旧 Paper 服务、路由器或公网端口。

来源：[官方 Modrinth 版本 HZWaR0LY](https://modrinth.com/mod/yes-steve-model/version/HZWaR0LY)。JAR 为 63,463,229 字节，SHA256 `b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb`，下载时与官方 SHA1、SHA512 逐项一致。Default Boy 的原 `ysm.json` 声明 CC0 / free；模型与 PNG 来自该 JAR，没有改图、另造人体或解密模型。

## 当前显示范围

网页使用同一 Mineflayer 账号连接接收的原生 `maw_agent:menu_state / self.ysm`，由服务器读取本人的既有 `yes_steve_model:model_id` attachment。字段包括本人 UUID、模型、贴图、启用与强制显示状态；不初始化 attachment，也不传授权、缓存或密钥。YSM 整个 JAR 与实际 attachment class、getter 签名只在首次读取时验证，后续快照读取缓存方法。

网页 provider 目前只支持 Default Boy 的 `blue` / `red`：58 骨骼、156 方块、936 面，使用原始 128×128 PNG、几何与恒定 idle 姿态。页面明确显示“YSM 外形预览 · 动画与装备暂未显示”。眼神、完整动作、装备、第一人称手臂及背包人物预览尚未适配；几何烘焙、材质与 Java 客户端完整一致性未验。原资源校验通过不等于完整 1:1 渲染通过。

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

显示入口：[常驻服俯视](http://127.0.0.1:28984/dungeon/)、[第三人称](http://127.0.0.1:28984/third/)。本次站位紧挨女仆与建筑，第三人称相机可能被挤到女仆体内；俯视已经实见蓝衣玩家。这是镜头遮挡，不能靠替换模型或管理员传送冒充自主移动解决。

## 验收与维护记录

- 隔离端口 28978/28979/28986：普通 `MawYsmQA` 通过 Mineflayer 网关实际登录，原生命令切蓝、红；网页无刷新完成切色；关闭 YSM 后恢复原皮肤。一次站桩被女仆精灵击杀保留为测试事件，随后只把该测试账号置 creative 展示，不计自主能力。自然 QA 主账号未上线执行决策。
- 常驻 28976/28977/28984/28985：保存后正常停止，三子进程 exit 0；备份 `E:\QiandengJiSocietyLab\backups\ysm-model-switch-20261005`，原世界未重生成。恢复后原账号实际在线、真实 attachment 确认蓝款；原生截图 `research/ysm-model-switch-20261005/main-blue.png`。隔离监督已正常 shutdown。
- 新桥 SHA256 `91b7281c4ed5f092f6eaa74960de834c32fa73025971b7b5b5636cde16223538`；29 个运行 JAR 与锁一致。资产 `native-20261005-v10-ysm` 全部 39,767 文件校验通过（新增 640 个 YSM assets），原冲突与完整渲染未验标记保留。后续部署从当前锁使用原生资产导出器；不可混用旧 JAR、旧模型资源或号表。
- Java21 编译与 29 项独立 attachment/hash 边界断言通过；6 项安装保护回归通过；网页原资源回归 394/394，无 skip。初次测试误把 codec 配成 datatypes 模块导致 1 个测试失败，改为运行目录 `minecraft-protocol/src/transforms/serializer.js` 后通过；失败原证据保留。
- `society_lab.check_runtime` 的初始化检查仍假定 `level-name=world-lab`，对现有 `world-life` 会拒绝；本次单独逐项核验全部 JAR/额外文件，未改世界名以通过旧初始化检查。

**现存决策暂停保留：** 本次维护创建暂停标记前，Agent 于 13:14:38 已因导航动作 `7927420b-0a39-46a5-b172-907e5c3a5598` 结果不明自行暂停。原 `autonomy.paused` 字节已备份并保持，旧行动与模型账本没有删改或重投；最后模型任务已终态。服务维护暂停已解除，游戏连接在线，但自主决策仍暂停。此轮只更换模型，没有把该导航算成功，也没有清除未知行动保护。
