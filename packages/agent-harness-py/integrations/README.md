# 用自己的 Agent 接入千灯纪居民

在接入页选一个已登记的角色。角色绑定的身体可以是车万女仆或 Numen。桌面 Agent 收到每次决策所需的现场、相关记忆、当前日程和上轮动作回执，用自己的人设作答。服务端持有原角色的身体租约，校验并执行决策。女仆能按原生工作模式持续活动，Numen 使用该身体公布的游戏能力。

## 玩家接入

1. 登录千灯纪，打开「加入千灯纪 → 使用已有女仆或 Numen 居民身体」，选择角色，下载 `resident-session.json`。在线轮询会续期，停用约 12 小时后需重新签发。重新签发或在该页撤销会立即使旧连接失效。
2. **N.E.K.O.** 在本机安装 `neko_resident` 插件，将插件设置中 `[resident]` 的 `role` 填为接收事件的本机角色名，`session_file` 填连接文件的绝对路径，然后启动插件。对应角色的工具是 `qd_resident_decide`。
3. **Cortico** 在本机扩展管理中选择 `cortico-resident` 目录并重启宿主，给目标 bot 启用 World `qiandengji-resident`，在 `worlds.qiandengji-resident.sessionFile` 配置连接文件的绝对路径。两种宿主均支持通过实例环境变量 `QD_RESIDENT_SESSION_FILE` 指定文件。每个宿主实例使用自己选择的角色文件。

连接文件含临时凭据。客户端向官网发起 HTTPS 出站请求。读到待处理的回合便唤醒角色，玩家无需先说话。官网最多等待 35 秒；客户端离线、超时或撤销时，服务端使用已配置的托管规划器。角色的原生行动可在等待下一次规划时继续。收到 `accepted` 表示规划器拿到了答复，动作结果以下一轮的游戏回执为准。

## 接入其他 Agent

读取文件的 `endpoint`、`token`。每 2 秒向 `endpoint/poll` 发送 JSON 空对象。两个接口都使用 `POST`、`Content-Type: application/json` 和 `Authorization: Bearer <token>`。凭据留在适配器中。适配器把回合数据送入本地角色的正常会话，只暴露一个回合答复工具。

| 接口 | 请求 | 响应 |
| --- | --- | --- |
| `poll` | `{}` | `{"turn":null}` 或带有 `id`、`until`、`resident`、`kind`、`instructions` 和 `scene` 的回合。按 `id` 去重，`until` 是 Unix 毫秒时间。 |
| `reply` | `{"id":"当前回合 ID","answer":{"steps":[]}}` | `{"accepted":true}`。过期或已答复返回 409。撤权或到期返回 401。 |

`kind=dialogue` 的答复形如 `{"reply":"我在营地等你。"}`。在 `kind=plan` 回合，仅从当前身体实际公布且获准的能力中选最多三个步骤。空步骤让正在进行的原生任务继续。空闲且还没有日程时，Agent 可随答复提交最多六个互不重叠的时间段。例如本轮先继续工作，十分钟后重新看营地入口。

```json
{
  "steps": [],
  "agenda": [
    {"afterMinutes": 0, "forMinutes": 10, "goal": "照看当前农田", "evidence": "观察农作物或背包的变化"},
    {"afterMinutes": 10, "forMinutes": 5, "goal": "看看营地入口是否需要帮忙", "evidence": "观察入口附近的玩家和敌对实体"}
  ]
}
```

日程采用未来 24 小时内的现实时间，从接受规划时计时。服务端按角色将它保存在动作账本中。重启会恢复尚未过去的时间段。主人在游戏中向角色提出改期时，可以用新的 `agenda` 替换余下安排，空数组表示取消。对话、险情和正在等待原始回执的动作继续遵循同一套调度规则。女仆原生的昼夜作息可通过该身体公布的 `body:native:schedule` 设置。

## 服主配置

官网配置增加 `residentTurns` 数组。每项需要 `id`、`name`、`bodyKind`、`bodyId`、`characterId`、`ownerGameId` 和 `workerHash`。前五项取自现有居民角色记录，`ownerGameId` 对应已在千灯纪账号系统绑定的游戏身份。每次签发、轮询和答复都会检查官网所有权。每个角色使用独立的服务端凭据，以 `rwt_` 加 32 个随机字节的无填充 base64url 编码构成；官网仅持有完整凭据的 SHA-256 十六进制摘要。

在现有 NPC 服务配置增加同名 `residentTurns` 对象，以居民 `id` 为键。对应值为 `{"endpoint":"https://你的官网域名/api/v1/resident-turns/居民id","tokenFile":"该角色服务端凭据的私有文件路径"}`。官网和 NPC 服务都须加载新代码及对应登记项，客户端入口才可使用。旧有女仆控制授权和游戏服凭据分别使用各自原有入口。
