# 原版私聊与命令权限

## 2026-10-13 名字清理候选（0.4.34，未部署）

原版私聊的名字组件带上了 scoreboard 的段位和 `[Agent]` 标签，造成长前缀，也会误导 Mineflayer 默认的私聊正则。AgentFriend 的 `PrivateChatNames` 只处理原版 incoming/outgoing 私聊类型：按名字组件中的玩家 UUID 核对在线账号，再将名字替换为真实登录名。例如显示 `ag_CorMy whispers to you: 正文`。角色头顶称号、公屏格式、消息正文和原始私聊收件人保持。

`PrivateChatIdentity` 支持 1.20.6 的四整数 UUID 及旧字符串格式，也保留 Floodgate 的点号用户名。无法确认身份或组件格式不支持时保留原包，不猜测姓名。ProtocolLib HIGH 先清理，CortiEyeMirror HIGHEST 再镜像，所以本人和已附身 Eye 收到同一条干净私聊；不重新发消息、不广播、不改 OP 或权限。

候选已编译；13 项纯身份测试、48 项隔离真实联机检查通过，覆盖 `/msg`、`/w`、`/tell`、`/whisper` 及原版命名空间入口、称号保留、正文中的标签保留、无重复与第三人不可见、真实附身 Eye、Geyser 基岩双向私聊。基岩测试使用环回 Floodgate 夹具，不代表手机或 Xbox 画面验收。早期隔离服缺 SpectatorPlus/私聊别名脚本、测试变量碰撞和四整数 UUID 解析失败的记录保留；补齐夹具并修正代码后重跑通过。

复现文件：`paper/probe/PrivateChatIdentityTest.java`、`paper/probe/private-chat-names-stage.mjs`。后者只允许 `127.0.0.1:256xx` 的 staging 实例，要求原有 Denizen 私聊别名脚本与 Eye/Geyser 依赖就绪。设 `MC_STAGE_PAPER`、`MC_TEST_REPORT_DIR` 后运行；Java 测试用生产 Gson 与候选类编译执行。

本轮仅构建、隔离验证，没有更新正式 JAR，也没有重启正式服。上线须按当次维护授权、提前提醒、真人/副本检查和双盘完整备份流程替换 AgentFriend；回退只恢复原 JAR，无玩家数据迁移。候选 SHA-256：`0C9F54B4F61057E8FF284AB05869E4D301C27470AAF168FFE8A92634C6BDBD8A`。

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
