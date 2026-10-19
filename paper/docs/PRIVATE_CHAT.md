# 原版私聊与命令权限

## 2026-10-20 显式原版路由已上线

本轮隔离冷启动发现 Essentials 的禁用 `/msg` 仍可能占据命令名，因此 `paper/config/commands.yml` 把 `/msg`、`/tell`、`/w` 显式绑定 `minecraft:msg`，沿用原玩家权限与认证门禁。不再依赖插件注册先后。正式1.20.6／1.21.1经原登录网关的实际收发包已核对最终聊天类型表及发送者 UUID，不拼接英文或中文文本来冒充 whisper。现有 `/whisper` 的 Denizen 入口保留。部署结果与降噪协议见 [AGENT_MESSAGE_TRANSPORT.md](AGENT_MESSAGE_TRANSPORT.md)。

## 2026-10-17 原版数据包复核

当前正式核心是 **Paper 1.21.1 build133**，离线身份由现有登录代理验证；1.20.6 客户端经 ViaBackwards 接入。私聊继续执行原版命令。自动发信优先明确使用 `/minecraft:msg <完整用户名> <正文>`，避免未来插件注册顺序影响未加命名空间的命令。原 `/msg`、`/w`、`/tell`、`/whisper` 和原版命名空间别名保持兼容。

现役 `/msg` 使用原版处理；三个短别名的既有 Denizen 脚本仅以玩家本人的身份和权限执行 `minecraft:msg`。它不拼接私聊文本，不另发普通聊天。Essentials 的 `msg` 保持禁用，不能重新启用其私聊格式化替代这条路径。AgentFriend 仅清理名字组件中的称号，保留原版类型、正文和身份。

真实登录代理连接下，1.20.6、1.21.1 各检查七个入口，44项联机检查通过；另逐包验证28个原始收发包及9项回归测试。实测结果：

- 离线原版私聊使用 `profileless_chat` 包；该包有独立聊天类型，不能仅凭包名将它归为公屏。最终类型为 `minecraft:msg_command_incoming` / `minecraft:msg_command_outgoing`，翻译键分别为 `commands.message.display.incoming` / `commands.message.display.outgoing`。
- 实测该次正式世界类型索引是收信2、发信3。**索引不应写死**，客户端必须使用当前配置阶段收到的完整聊天类型表。登录等候区与正式世界先后下发两份表，后者替换前者。只保存第一份表会将相同数值识别为别的消息类型；这是已观察到的兼容风险，尚未取得第三方 Agent 内部日志来认定其具体根因。
- 1.20.6 解码后的字段为 `type: 2/3`；1.21.1 为 `type: {chatType: 2/3}`。这些是本次协议库的解码形态，不是另外定义的私聊协议。
- 原版无签名包没有顶层 `senderUuid`，真实 UUID 保留在名字组件 `hoverEvent.contents.id` 中，当前编码为四个有符号整数；有签名的 `player_chat` 才可直接读取其 `senderUuid`。不要为了补顶层字段而伪造玩家签名。
- 当前玩家私聊名字不带 `◆黑铁 [Agent]` 等称号；英文客户端显示 `ag_CorMy whispers to you: 正文` / `You whisper to ag_CorMy: 正文`。游戏客户端可以按原版语言包翻译，不能要求它们永远保持同一种显示文字。正文中的标签保持原样。

可复核原始抓包：`node paper/probe/verify-native-chat-capture.mjs <capture.json>`；回归：`node --test paper/probe/native-chat-capture.test.mjs`。验证器检查最终类型表、消息类型、真实UUID、正文、收发方向及重复送达，不以文字里含“whisper”作为成功依据。本次未改私聊发送代码或重启服务。

## 名字清理已随0.4.36上线（2026-10-14）

服主授权并等真人退出后，180/60/10秒预告、原维护任务正常停启；E/F完整冷备份 20261014-000758 均在替换前完成。AgentFriend **0.4.36** / CortiEyeMirror **0.1.15** 已上线，登录/YSM和其他插件保持。正式状态30项、真实认证Java/Agent/Eye联机20项和玩家保存8项检查通过。旧墓穴凭据有独立领取命令和菜单，不再被“无结束记录”误导；小鱼此前旧奖励已按原流程准确到账，重启后原日期和场次保存。组队救援新增本队范围粒子、连续10秒进度与复活反馈；私聊按UUID核对真实账号名后清理称号。普通难度/三维度keepInventory及原背包、领地、技能、传送点保留。背包初验字节比较发现可米圆石21→22，逐槽NBT核对仅此数量增加、无物品减少或元数据变化；未追踪增加来源，原失败报告保留，未回写存档。手机/Xbox和远端Web画面未实测，基岩YSM高清0.2.0仍为独立未发布候选。

原版私聊的名字组件带上了 scoreboard 的段位和 `[Agent]` 标签，造成长前缀，也会误导 Mineflayer 默认的私聊正则。AgentFriend 的 `PrivateChatNames` 只处理原版 incoming/outgoing 私聊类型：按名字组件中的玩家 UUID 核对在线账号，再将名字替换为真实登录名。例如显示 `ag_CorMy whispers to you: 正文`。角色头顶称号、公屏格式、消息正文和原始私聊收件人保持。

`PrivateChatIdentity` 支持 1.20.6 的四整数 UUID 及旧字符串格式，也保留 Floodgate 的点号用户名。无法确认身份或组件格式不支持时保留原包，不猜测姓名。ProtocolLib HIGH 先清理，CortiEyeMirror HIGHEST 再镜像，所以本人和已附身 Eye 收到同一条干净私聊；不重新发消息、不广播、不改 OP 或权限。

候选已编译；13 项纯身份测试、48 项隔离真实联机检查通过，覆盖 `/msg`、`/w`、`/tell`、`/whisper` 及原版命名空间入口、称号保留、正文中的标签保留、无重复与第三人不可见、真实附身 Eye、Geyser 基岩双向私聊。基岩测试使用环回 Floodgate 夹具，不代表手机或 Xbox 画面验收。早期隔离服缺 SpectatorPlus/私聊别名脚本、测试变量碰撞和四整数 UUID 解析失败的记录保留；补齐夹具并修正代码后重跑通过。

复现文件：`paper/probe/PrivateChatIdentityTest.java`、`paper/probe/private-chat-names-stage.mjs`。后者只允许 `127.0.0.1:256xx` 的 staging 实例，要求原有 Denizen 私聊别名脚本与 Eye/Geyser 依赖就绪。设 `MC_STAGE_PAPER`、`MC_TEST_REPORT_DIR` 后运行；Java 测试用生产 Gson 与候选类编译执行。

0.4.34最初只构建和隔离验证；现已随0.4.36正常维护上线，上述机制生效。上线须按当次维护授权、提前提醒、真人/副本检查和双盘完整备份流程替换 AgentFriend；回退只恢复原 JAR，无玩家数据迁移。候选 SHA-256：`0C9F54B4F61057E8FF284AB05869E4D301C27470AAF168FFE8A92634C6BDBD8A`。

## 2026-10-11 已上线修复

普通玩家和 Agent 使用 `/msg <在线玩家完整名字> <消息>`，也可使用 `/w`、`/tell`、`/whisper`。三个别名现在经 Denizen 转交 `minecraft:msg`，保留实际发信玩家及原版私聊事件；Mineflayer 无须修改客户端。

可米 `ag_CorMy` 当日 47 次 Essentials 命令拒绝全部对应 `/w`。她本来就具有 `minecraft.command.msg`，没有 OP。根因是 Essentials 的 `msg` 被禁用，但仍占用 `w/tell/whisper` 别名；这会拒绝发送，收信人确实收不到。NEKO 的 `/tell` 受到同一问题影响。

不要把私聊拒绝与其他玩法条件混在一起：领地、建筑保护、试炼倒地和物品托管等限制仍以当次服务器回执为准。需要帮助先用 `/mycli help`、`/mycli list` 或对应子命令查看说明。地下城出行入口是 `/mycli dungeon travel <ID>`，不是 `/mycli travel <ID>`；资格、资源和场次条件仍要满足。

## 实现与权限

- 源文件：`paper/content/world-life/Denizen/scripts/qd_private_chat.dsc`。
- 正式文件：`E:/MC/server/plugins/Denizen/scripts/qd_private_chat.dsc`。
- 仅注册 `w`、`tell`、`whisper`，不接管原有 `/msg`；Essentials 的禁用列表保持。
- 发信玩家必须具有 `minecraft.command.msg`。检查放在脚本内，避免命令树把禁用权限显示成不明命令；失败明确提示联系房管核对该节点。
- 使用 `execute as_player`，不会临时 OP；原版命令再次检查权限，并再次触发正常命令预处理事件。禁止改成 `as_op` 或用控制台代玩家发信。
- 控制台调用别名使用服务器身份；不冒充在线玩家。正文中的标签和斜杠作为文本处理，不执行。
- 缺少参数、找不到在线玩家沿用原版错误。消息不是离线邮箱；不要把未送达当成对方已经收到。

## 热更新与回退

先在隔离服验证，再保存正式脚本前像到 E/F 两盘，只添加或更新这一个文件。通过控制台 `denizen reload scripts` 重载 Denizen 脚本；它不是 Paper 的 `/reload`，本次没有重启 Paper、网关或 YSM。保留现有 `qd_wayfarer.dsc` 和所有 NPC/玩家存档。

回退只移走新增的 `qd_private_chat.dsc`，再重载 Denizen 脚本，原命令归属会恢复；不要删除 Denizen 目录或覆盖 NPC 数据。回退会恢复原先三个别名被 Essentials 拒绝的行为，原版 `/msg` 仍可用。

## 验证与边界

隔离服复现了三个别名被禁用、原 `/msg` 正常。修复后验证中文、字面标签/引号、实际 Mineflayer `whisper`、不重复送达、不泄漏给第三人、明确禁用节点仍拒绝、命令预处理取消仍有效、热回退/重上及正常冷启动。原有 `village-story` 保持注册，普通玩家不能借此获得 OP。

正式服普通测试账号的五个私聊入口和三个控制台别名实际送达，原 `/mycli` 可用，控制台专用观测仍拒绝普通玩家。Paper 仍为 AgentFriend 0.4.19 / CortiEyeMirror 0.1.12。手机/Xbox 真机未测，不把原版协议验证称为真机验收。

可重复的协议检查为 `paper/probe/private-chat-alias-stage.mjs`，仅允许环回隔离端口 25567。完整私有收发、权限、热加载及冷启动回执在 E/F `repairs/cormy-command-permissions-20261011`；首次断言误把 Mineflayer 的原版引号/空白显示差异当成正文变化，第二次发现权限树隐藏命令，失败回执均保留，最终脚本已复验。
