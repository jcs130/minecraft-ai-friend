# 附近聊天：复用官方 EssentialsXChat

状态：2026-10-29 隔离候选，**尚未安装正式服**。主服已有官方 EssentialsX 2.22.0，新增同版 Chat 模块；不自行实现聊天分发器。

普通聊天默认只到同一 Bukkit 世界实例的 48 格球形范围内。`!内容` 为本次全服喊话，不切换下一条的默认频道。原版 `/msg 玩家 内容` 继续私聊，可跨世界。格式包含来源世界；附近无人时由原插件私发下一步。Java/Mineflayer 不要求客户端模组，基岩经现有 Geyser 转换，实际基岩显示尚待真机验证。

## 官方产物

- [EssentialsX 2.22.0](https://github.com/EssentialsX/Essentials/releases/tag/2.22.0)
- [Chat 模块下载](https://github.com/EssentialsX/Essentials/releases/download/2.22.0/EssentialsXChat-2.22.0.jar)
- 21,800 字节；SHA256 `e5b0211f98af1eaba712d9294997639a39209db1fc842394a0923820073ec65a`，已与官方 Release 摘要核对。
- 当前核心 SHA256 `bda4685105977fca2e209820a9f0ad24275bd103390a03236f38e59bfdac58e6`，同样与官方产物相符。

上游当前支持列表没有逐项列出 1.21.1；本项目已在实际 Paper 1.21.1 build133 上联机验证，不能因此宣称所有 Essentials 命令都已兼容。

## 合并配置

将 `essentials-chat.yml` 的 **chat 子键**合并到现有 `plugins/Essentials/config.yml`，保留其他设置、账号资料和原版私聊别名。频道格式的 `local` 是真实配置键，不能只填 `normal`。

将 `messages_zh.properties` 合并到 **`plugins/Essentials/messages/messages_zh.properties`**；不是 Essentials 根目录。现役语言为中文，发布时仍需核实 `locale` 与 `per-player-locale`，不覆盖完整语言资源。

通过现有 LuckPerms 授予普通身份 `essentials.chat.local`、`essentials.chat.shout`、`essentials.chat.receive.local`、`essentials.chat.receive.shout`。显式关闭 `essentials.chat.spy`、`essentials.toggleshout` 和 `essentials.chat.question`，避免 OP 的默认权限让普通 Agent 听见跨世界内容。服主女神确有全局巡查职责时，按真实 UUID 单独授予 spy；监听不等于在场。不要仅按 ag_ 名字分组。

首次候选不收费；以后需要喇叭费用时使用原生 `command-costs.chat-shout` 和现有 Vault 金币账户，再验证余额、豁免、取消与真实扣款。该键是费用，不是频道冷却。若需要独立频道限频，先评估 Carbon/ChatControl，不在 AgentFriend 另写聊天系统。

现有 `/msg`、`/tell`、`/w` 保持映射到 `minecraft:*`。Chat 模块不接管这些命令。不要恢复 Essentials 的私聊实现或用系统消息代替原生 whisper。

## Agent 接口边界

现代 `player_chat` 同时带原文、真实发送者 UUID 和服务器装饰组件。Mineflayer 的 `messagestr` 可能只显示签名原文；要读频道和世界标签，应读取 `message.unsigned`，保留原数据包身份，不能从标签猜 UUID。原版 whisper 类型及其翻译参数仍是私聊的主要证据。

`/mycli locate list` 已包含世界。新的桥 0.2.10 候选为 `status`、`intro`、原生队伍查询补真实 world key、Bukkit world UUID、位置；仅在同世界计算距离。没有新增一套组队服务、地图或顶层 CLI。

## 验证

`paper/probe/proximity-chat/check.mjs` 只接受带专用标记的本机 29086/29087。官方插件负责全部聊天；`ChatQA.java` 只摆放测试角色、调用现有 API，不实现分发。基础 18 项真实 Mineflayer 检查通过：近远/高度/边界、同坐标跨世界、无人反馈、显式喊话及默认恢复、原版私聊和旁人隔离、真实 UUID、Player.chat 路径、OP 显式拒绝监听及导演主动监听。

`--rpg` 另验真实 Vortex 与桥的世界/队伍查询。QA 使用新存档、新玩家、新数据库，不复制生产账号、背包或角色。

早期夹具失败已保留：曾把 Mineflayer 签名正文误当装饰文本，又把 Bukkit 临时权限当作 Essentials 的 LuckPerms 权限；纠正夹具后再验证，不归咎为插件缺陷。

正式安装 JAR 须按既有流程正常停启和发布验收；当前文档及源码提交均不代表附近聊天已经生效。
