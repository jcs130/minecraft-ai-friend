# Agent 消息传输与降噪

## 2026-10-21 接收范围候选，尚未部署

0.4.47.10 / Eye0.1.17候选将保护、任务路线、验收和生活挑战反馈留给操作本人，不再另给Eye/live发文本副本。旧委托裸JSON的本人聊天格式保持；带 `schemaVersion:1` 与 `type:MC_*` 的回执也支持既有 `qiandengji:agent` 私有信封，选此通道后不重复发聊天。127项策略及两协议各55项真实连接通过；服主选择暂不重启，当前正式仍0.4.47.9/Eye0.1.16。说明、边界与复现见 [聊天接收范围](CHAT_AUDIENCE.md)；下方是已发布记录。

## 已正式上线

2026-10-20 已上线：Paper 1.21.1 build 133，AgentFriend **0.4.47.8**、登录代理 LoginGuard **0.1.3**，Numen 同批启用。原维护流程 E/F 完整冷备份 `20261020-023549` 均先于替换；正式状态/保存 53 项、实际网关双版本原生联机 60 项及大背包对账通过。发布记录见 `paper/manifests/agent-message-release-20261020.json`。

本次只回补消息展示。AgentFriend 以现役 0.4.47.6 固定摘要为基础，其他 382 个 ZIP 条目逐字节保持；不捎带未发布的档案馆、格挡补丁或 YSM af4。

## 默认行为

- `ag_`（不区分大小写）登录时不推整段技能、物品、照片或 GUIDE/STATUS 新手说明。真人每个存档 UUID 首次只收到：`[提示] 新手说明与玩法按需查看。命令：/mycli --help`。记录在玩家 PDC，正常保存后跨重连、重启保留。
- 原技能罗盘、命格书、大背包及其发放不变。详细说明仍可主动读取 `/mycli --help`、`/mycli intro`、`/mycli coach guide`、`/mycli skills info <ID>`、`/photohelp`。
- 取消 ConditionalEvents 的第二组登录推送。同一个新手阶段不按定时器重复提醒；实际阶段改变后的私有下一步仍保留，包括保护范围、引路人位置与 `nextCommand`。
- 未改客户端仍收到本人命令的 `MC_*` 私有系统回执。`MC_AUTH_STATE` 自动最终回执及默认 `MC_STATUS` / `MC_GUIDE` / `MC_GUIDE_NEXT` 文本移除 `playerUuid/sessionId/authSessionId/observedAt/sequence`，字段名、错误码、操作 ID、下一步和保护几何保持。显式 `--json` 和插件通道保留完整关联字段，便于连接与快照核对。
- 真人默认 `/mycli status` 只显示中文摘要；主动 `--json` 查询仍可读取完整结构。机器回执不广播给其他人，也不转发到实际附身 Eye 的聊天栏。
- `[MC_AUTH_SUCCESS] 登录成功，可以开始游戏。` 保持原文，每个实际完成认证并进入 Paper 的连接只自动发送一次最终状态。`pending` 只在主动 `/authstatus` 时返回。失败、锁定、注册与设密码提示保留；没有放宽任何授权条件。
- 仅对 `ag_` 隐藏 SkinsRestorer 的第三方启动器皮肤警告，按官方通知中的两个固定链接识别，兼容中英文。皮肤错误和其他故障提示保留。

## 可选插件通道

不增加公网端口。通道名 **`qiandengji:agent`**，UTF-8 JSON，协议 **1**，单包最多 32,700 字节。没有选择此传输的客户端继续使用兼容的私人聊天回执，不能直接删除客户端原登录识别逻辑。

1. 客户端先发原版 `minecraft:register`，载荷为 `qiandengji:agent` 的 UTF-8 字节。
2. 再向 `qiandengji:agent` 发：

```json
{"op":"hello","protocol":1,"transport":"payload"}
```

3. Paper 返回 `{"protocol":1,"type":"hello_ack","transport":"payload"}`。此后该连接的 `MC_* {JSON}` 改为下列私人载荷，聊天栏不重复发送：

```json
{"protocol":1,"type":"MC_STATUS","data":{"schemaVersion":1,"scope":"self","sessionId":"…","sequence":1,"observedAt":1,"nextCommand":"/mycli guild join"}}
```

`data` 是原始完整对象，示例只省略了展示字段。登录代理对同一握手也记下选择，随后主动 `/authstatus` 使用相同信封。若首次握手在自动登录成功之后发生，首次最终状态仍会走精简聊天，这是兼容回退。退出即清除选择；重连和每次进入正式世界需重新登记。只发 `hello` 而不做原版频道登记，可能收不到回包。

仅真实连接名为 `ag_` 的玩家可选择此通道。这个入口只选择消息展示，不接受坐标、玩家 UUID、任意命令、授权声明或游戏动作。普通玩家发同样握手不会启用通道。未知协议、超长或额外字段被忽略。

Mineflayer 示例（应在客户端自己的认证和任务屏障中接入）：

```js
bot._client.on('custom_payload', ({channel, data}) => {
  if (channel !== 'qiandengji:agent') return;
  const frame = JSON.parse(data.toString('utf8'));
  if (frame.protocol !== 1) return;
  if (frame.type === 'hello_ack') return;
  // 按 frame.type 分流；MC_AUTH_STATE 的授权仍按真实服务器来源核对。
  receiveServerReceipt(frame.type, frame.data);
});
bot.on('spawn', () => {
  bot._client.write('custom_payload', {
    channel: 'minecraft:register', data: Buffer.from('qiandengji:agent')
  });
  bot._client.write('custom_payload', {
    channel: 'qiandengji:agent',
    data: Buffer.from('{"op":"hello","protocol":1,"transport":"payload"}')
  });
});
```

协议不是普通聊天提示，不建议直接把整份载荷交给语言模型。客户端可以把关联字段用于校验，向模型只呈现稳定的状态和下一步。原版粒子、实体、物品及私聊协议不变。无 JSON 的历史 `MC_* key=value` 回执继续原路径。

## 村庄活动条

只处理“星灯夜巡／丰收时节／旅人顺风”。进度按 100%→75%→50%→25%→0% 更新；标题去掉秒表，只在进入最后一分钟时改变一次，结束沿原 REMOVE。突袭、战斗 Boss、救援、任务导航条保持原样。

WorldEvents 1.8.30 的实际计时器写死在 `EventManager`，当前 `boss-bar.update-interval-ticks` 配置未控制它。服务端出站限制作用于真实 Boss 包，也兼容 Adventure 先发空 ADD、再更新名字的顺序。配置只保留一次 30 秒聊天提醒，不再发 10 秒、5 秒。

## 原版私聊

`commands.yml` 将 `/msg`、`/tell`、`/w` 显式指向 `/minecraft:msg`，避免插件加载顺序和 Essentials 的禁用命令占位。以原玩家身份执行，原权限与认证门禁仍有效。已有 `/whisper` 的 Denizen 兼容入口保留。

离线模式原版通常是 `profileless_chat` 加聊天类型 `minecraft:msg_command_incoming/outgoing`；正文可能按客户端语言显示。无签名包的真实 UUID 在名字组件的 `hoverEvent`，不伪造顶层签名。客户端应使用进入正式世界后最后收到的聊天类型表。详见 [PRIVATE_CHAT.md](PRIVATE_CHAT.md)。

## 验证与回退

构建：`scripts/build-message-release.py --server <只读正式目录> --base-jar <0.4.47.6> --jdk <Java21> --output <新的仓库外目录>`。构建自动运行消息策略测试，并核对无关条目。

实际包检查为 `paper/probe/agent-messages-stage.mjs` 和 `agent-messages-auth-stage.mjs`，仅允许带所有权标记的回环隔离服。覆盖首次／重连、默认／完整／通道输出、真实 Eye、保护说明、原版私聊、伤害、活动包数及实际代理认证。隔离失败记录也保留，不把发出命令算完成。

已通过的认证整链路采用现役 Mineflayer 4.37.1／1.20.6，经 Via 转换；1.21.1 直接后端通过。早期隔离代理中，Mineflayer 4.37.1 的原生 1.21.1 配置阶段解析失败，记录保留；没有将其计为通过，也未据此扩大现役兼容补丁范围。正式发布后，经原 LAN 网关、认证代理和模型链路的 Mineflayer 1.20.6／1.21.1 两种连接均已实际通过，包含 Numen 协议3非管理员握手；原隔离失败仍保留。完整 Java 图形客户端、手机／Xbox 真机和外网图形客户端画面不属于本次验证。

发布沿原维护通知、真人／活动门禁、正常停止及 E/F 全量冷备份。回退只恢复旧 AgentFriend、LoginGuard 和本次配置前像；保留玩家背包、进度和 Numen 资料，不覆盖世界。Numen 的独立安装与个人 Key 入口见 [NUMEN_PAPER.md](NUMEN_PAPER.md)。
