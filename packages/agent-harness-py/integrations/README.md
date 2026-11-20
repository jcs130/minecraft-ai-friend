# 用自己的角色接入千灯纪

你可以让本机的 N.E.K.O. 角色或 Cortico bot 在游戏里拥有一具车万女仆或 Numen 身体。角色在本机接收游戏消息、用自己的人设说话和做决定。Minecraft 服务器持有身体，负责寻路、原生任务、背包、动作回执和日程。玩家使用这条接入方式只需桌面 Agent 和相应插件。

## 在另一台电脑下载安装

登录 GitHub，打开居民插件构建记录，选择与验收服务端兼容的成功运行，在页面底部 **Artifacts** 下载 `qiandengji-resident-desktop`，解压后选用下表中的一份。仓库保留每个包的文件名、大小和 SHA-256，便于校验下载。[GitHub Actions 构建记录](https://github.com/jcs130/minecraft-ai-friend/actions/workflows/resident-plugins.yml) · [安装包清单](../../../paper/integrations/agent-portal/src/resident-downloads.json)

| 本机使用的 Agent | 安装包 | 安装方式 |
| --- | --- | --- |
| N.E.K.O. | `qiandengji-resident-0.3.1.neko-plugin` | 在插件中心导入文件，打开「连接千灯纪居民」。 |
| Cortico World API 5 | `cortico-world-qiandengji-resident-0.3.0.tgz` | 解压到固定目录，在扩展管理选择「从本机目录安装」，选中内含 `package.json` 的 `package` 文件夹，重启 Cortico。 |
| Cortico World API 6 | `cortico-world-qiandengji-resident-api6-0.3.0.tgz` | 同上。 |

本版已通过隔离服验收。换机器连接测试服时，在 N.E.K.O. 插件的 `[resident]` 设置中填写 `portal_origin`，或在 Cortico 的 `worlds.qiandengji-resident.portalOrigin` 填写该服的 HTTPS 门户地址，然后重启插件。两者默认访问千灯纪正式官网。正式服需另行部署并启用居民能力；官网启用安装包分发后，也可从下载页的居民栏领取。[千灯纪下载页](https://mc.kangqiang.site/downloads.html)

## 第一次连接

1. **选本机人设。** N.E.K.O. 在插件管理器安装千灯纪居民包，打开插件面板，选择本机角色。想用新的人设，可以从面板打开 N.E.K.O. 自带的角色管理，创建后刷新。Cortico 在自己新建或已有的 bot 上启用「千灯纪居民」World，打开「连接游戏身体」。[Cortico 安装说明](cortico-resident/README.md)
2. **授权。** 在插件点「网页登录并授权」。N.E.K.O. 会直接打开浏览器，Cortico 会显示「打开千灯纪授权页」。在官网登录，核对账号后输入插件显示的六位数字，确认后返回插件。插件会自动加载角色列表。网页登录请求有效 5 分钟。旧版门户可使用面板里的「改用授权码」。
3. **在插件里选择「新建角色」或「连接已有角色」。** 新建时选身体，输入名字，可填写托管人设。游戏服绑定原生身体后即可连接。已有角色会显示游戏名和身体类型，选中后沿用同一角色的身体、背包和日程。创建期间关掉面板后，可在已有角色列表找回。身体满额时面板会显示可用情况。
4. **试着交谈。** 在游戏里靠近角色，打字点名或使用 Java 版 Simple Voice Chat 说话。也可以先在桌面跟自己的 Agent 说「看看游戏里附近有谁」，桌面角色可以主动请求一次身体回合。游戏内语音由服务器识别、合成，并按实际听众范围投递。玩家设备需要启用兼容的语音模组才能收听空间音频。

玩家可以在官网「已有居民管理」撤销单个角色的桌面连接。重新连接会接替同一身体的旧桌面会话。官网不可达、桌面关闭或本轮超时，游戏服仍按托管人设和已有日程继续规划。桌面人设的私有聊天记录保存在各自的宿主中；想让离线时也保有某种说话方式，可在新建居民时填写托管人设。

## 三种接入方式如何取舍

| 方式 | 人设和决策在哪里 | 游戏侧与玩家体验 |
| --- | --- | --- |
| 千灯纪居民插件 | 在线时用本机 N.E.K.O. 或 Cortico。托管规划器负责离线回合 | 女仆和 Numen 使用游戏服内已经登记的原生能力。玩家在插件内建角或接入，桌面无需维持 Minecraft 玩家连接。 |
| 可米现有的 Cortico + Mineflayer | 可米的 Cortico 实例 | Mineflayer 使用 Minecraft 玩家协议登录和感知世界，适合依赖玩家身份与客户端行为的玩法。需要维护游戏账号、连接及客户端依赖。 |
| Player2 | Player2 提供角色、模型对话和语音服务，游戏模组对接其 API | 可借鉴它在游戏内建伙伴、直接开口交谈和按角色收回复的体验。千灯纪的方案允许玩家选择自己的 Agent 和身体。[官方 Minecraft 示例](https://blog.player2.game/p/building-ai-npcs-with-player2-api) · [官方 NPC 接口](https://blog.player2.game/p/say-hello-to-the-player2-npc-api) |

N.E.K.O. 通过定向消息把回合交给指定角色，用运行时工具收回决定；管理面板单独处理授权。Cortico World 将同一回合投递到所属 bot 的事件流，并向它公布行动和发言工具。两个适配器都从服务器接收游戏麦克风的转写；桌面麦克风仍可通过宿主正常和角色交流。当前协议不传原始麦克风录音或桌面合成的音频。[N.E.K.O. 插件 SDK](https://github.com/Project-N-E-K-O/N.E.K.O/blob/main/docs/plugins/sdk-reference.md) · [Cortico World 扩展规范](https://github.com/Pal-AI-Lab/Cortico/blob/cba606f6aa9f5d56af033529cfc652fda9918709/docs/extensions.md)

## 接入其他 Agent

所有客户端请求都向官网出站，使用 HTTPS 和 JSON。桌面可以使用普通 HTTP 客户端。授权期间调用下列接口，业务前缀为 `/api/v1/`。

| POST 路径 | 请求与结果 |
| --- | --- |
| `resident-onboarding/browser-start` | 插件提交 `{}`，保存返回的 `secret` 到内存，显示 `code`，打开同源网页 `/resident-connect.html?flow=browser#<id>`。玩家在官网登录并输入插件里的六位数字，请求有效 5 分钟。 |
| `resident-onboarding/browser-status` | 使用 `secret` 作 Bearer token，每 3 秒提交 `{}`。返回 `pending` 或 `authorized`。已授权时返回 `onboardingToken` 和 `expiresAt`，有效 15 分钟。 |
| `resident-onboarding/pair` | 兼容旧授权方式。插件提交 `{"code":"XXXX-XXXX-XXXX"}`，取得 `onboardingToken` 和 `expiresAt`。网站登录后签发的码兑换一次，账号授权有效 15 分钟。 |
| `resident-onboarding/list` | 使用账号授权的 Bearer token，提交空对象。返回本人的 `residents` 和可新建的 `availableBodies`。 |
| `resident-onboarding/create` | 提交 `requestId`、`bodyKind`（`maid` 或 `numen`）、`name` 和可选的 `persona`。同一次创建的重试沿用相同 UUID 和内容。通过 `list` 等待状态由 `preparing` 变为 `available`。 |
| `resident-onboarding/connect` | 用选中项的 `id` 和 `characterId` 换取单角色 `endpoint` 和 `token`。持久化到本机宿主的私有存储。已兑换的账号授权不能再列举或新建角色。 |

后续请求向返回的 `endpoint` 添加以下后缀，使用角色 Bearer token。机器接口不使用浏览器 Cookie。桌面连接活跃时自动续期，连续停用约 12 小时会过期。兼容已有部署的角色连接码和 `resident-session.json` 也可以直接建立同一类会话。

| POST 后缀 | 用途 |
| --- | --- |
| `/poll` | 每约 2 秒提交 `{}`，按 `turn.id` 去重，收到回合即唤醒本机角色。回合包含身份、截止时间、原始现场、相关记忆、日程、`scene.bodyTools` 和 `scene.communication`。 |
| `/begin` | 桌面角色主动要看现场、发言或调整日程时提交 `{}`。相同未处理请求会合并，继续轮询。服务端待身体可用时提供基于当前观察的回合。 |
| `/reply` | 提交 `{"id":"回合 ID","answer":{...}}`。常规回合最多等待 35 秒。`accepted` 说明决策已交给服务器。检查后续的游戏回执，才能确定身体执行了什么。 |

发言时，从 `scene.communication.outputs` 选一项，原样使用它的 `mode`。该项有 `sourceEventId` 时一并传入。列表为空时，请选择本回合公布的其他动作，或用空计划继续当前安排。下面的示例回复一条允许文字答复的私聊，接收人和频道由服务器按原消息确定。

```json
{
  "id": "当前回合的 ID",
  "answer": {
    "communication": {
      "sourceEventId": "本轮私聊消息的 ID",
      "mode": "text",
      "text": "我到了，在营地门口等你。"
    }
  }
}
```

`text`、`speech` 和 `native` 分别表示发文字、请求游戏端发声和使用身体默认方式。部分附近发言原生同时发送字幕和语音，部分私聊、队伍或旧版身体只提供其中一种。输入的声源、说话者和听众由游戏标记。角色可读取回执中的字幕人数、语音提交状态或收包数量（若有），这些值不能证明某位玩家耳机里实际听到了声音。

女仆在自主回合能看到八格内的玩家且已过发言冷却时，可获得 `native` 和 `nearby` 选项。执行前会再次检查附近是否还有听众。规划回合发起并执行的身体发言回执会在后续 `scene.communication.receipts` 携带 `turnHash`，其值是原始回合 ID 的 SHA-256 前 12 位。

行动答复使用 `{"steps":[{"tool":"本轮公布的工具","args":{}}]}`，一次最多三步。`{"steps":[]}` 可以让当前工作继续。服务端校验动作、参数和现场条件。车万女仆可持续执行已解锁的原生工作和昼夜作息。Numen 可以按其角色许可进行观察、走动、使用物品等活动。LLM 可以规划未来 24 小时内最多六个互不重叠的时段。日程以角色身份持久化，可随主动安排或授权的主人对话改期。

```json
{
  "steps": [],
  "agenda": [
    {"afterMinutes": 0, "forMinutes": 10, "goal": "照看菜园", "evidence": "看看作物和背包的变化"},
    {"afterMinutes": 10, "forMinutes": 5, "goal": "回营地", "evidence": "确认自己抵达入口"}
  ]
}
```

### 排查 N.E.K.O. 发言

在插件进程日志里搜索 `resident_communication`。提交前拒绝会记录 `detail`、回合 ID 的 SHA-256 前 12 位及本次使用的模式和范围。访问官网后的结果会另记为 `portal_result`、`portal_rejected` 或 `portal_unconfirmed`。官网接单后，用游戏端回执确认发声状态。

## 给服主

已有角色和新角色复用同一个 NPC 服务、游戏身体适配器和语音服务。官网 `residentTurns` 登记已有角色；`residentCreationSlots` 登记专门用于新建的身体名额。未配置名额的类型不会向玩家提供新建选项。准备、授权、连接和撤销都在服务运行时生效。

1. **官网。** 备份现有 SQLite，部署包含 `resident-connect.html` 的门户版本，并为网页与 API 使用同一个 HTTPS 域名。首次启动会在现有库创建网页登录表。在私有配置中登记身体唯一的 `id`、`bodyKind`、`bodyId`、`ownerGameId` 和 `workerHash`。已有角色再填写 `name`、`characterId`。每个 worker 的凭据使用 `rwt_` 加 32 个随机字节的无填充 base64url 编码，`workerHash` 为整个凭据的 SHA-256 十六进制。已有角色按官网账号绑定的游戏身份鉴权，新建角色归创建它的官网账号。游戏里主人专用权限仍取决于原生 `ownerGameId`。
2. **NPC 服务。** `residentTurns` 对象按同一 `id` 提供官网角色端点和私有 `tokenFile`，`bodies` 沿用原生身体的回环端点、控制器和传输配置。已有角色继续放在常规角色表。新角色放在服务配置的 `residentCreationSlots` 对象中，由玩家创建时填入角色 UUID、名字和托管人设。每个角色使用独立的记忆、动作和日程账本。备份官网数据库和 NPC 的 `stateDirectory`，二者分别保存账号归属和已绑定身份。
3. **游戏与语音。** 女仆名额使用专门准备、绑定了原生主人的空白女仆。Numen 可以使用准备好的 hosted 身体，也可按下文配置在分配时原生创建。如果 `ownerGameId` 已绑定某个官网账号，该名额只对本人开放；给公共名额使用专用的游戏主人。为每个身体在 `plugins/QiandengVoice/npc-voices.json` 登记技术名、UUID、原生主人和音色，并将 NPC 服务的 `residentNamesDirectory` 指向该插件下的 `resident-names`。这样玩家取的名字可用于语音插件的字幕与寻址。专用名额应使用无玩家进度的身体和独立原生身份。游戏服首次确认绑定正确且身体存活后，官网才允许连接。
4. **分发与验收。** 本次服务端配套版本为 QiandengVoice 0.1.14 与 QiandengjiMaidBridge 0.1.58，部署时配合官网和 NPC 服务使用。新的居民包可以列在官网的现有下载目录。配置好以后，用普通账号在桌面分别新建、重连，在附近打字和用游戏麦克风点名，再到另一位玩家处核实私聊听众范围。[官网安装包发布步骤](../../../paper/docs/WEBSITE_SECURITY_DOWNLOADS.md) · [原生游戏服与角色配置](../../../paper/integrations/unified-npc/README.md)

已有居民的原生主人若是游戏服服务账号，服主可在对应的 `residentTurns` 条目填写已核对的官网账号 UUID `websiteOwnerId`。这个授权只覆盖配置里的单个居民。若原生主人已被其他官网账号认领，明确授权也会拒绝连接。游戏内主人和官网游戏账号归属仍使用原有记录。

例如，下面是 NPC 服务配置中一个女仆名额的相关部分。UUID、地址、路径和服主使用的模型均为示例；同样的身份需预先登记在官网和原生女仆桥。

```json
{
  "residentCreationSlots": {
    "maid01": {
      "bodyKind": "maid",
      "bodyId": "10000000-0000-4000-8000-000000000011",
      "ownerGameId": "20000000-0000-4000-8000-000000000021",
      "roleDefaults": {
        "provider": "tokenplan", "model": "已配置的模型", "persona": "喜欢照看营地。",
        "allowed_tools": ["body:observe", "body:chat", "body:follow", "body:native:task", "body:native:schedule"]
      }
    }
  },
  "residentTurns": {
    "maid01": {"endpoint": "https://mc.kangqiang.site/api/v1/resident-turns/maid01", "tokenFile": "/srv/private/maid01-worker"}
  },
  "bodies": {
    "maid01": {"endpoint": "http://127.0.0.1:19086/maid-body", "controllerId": "30000000-0000-4000-8000-000000000031", "tokenFile": "/srv/private/native-maid"}
  },
  "residentNamesDirectory": "/srv/minecraft/plugins/QiandengVoice/resident-names"
}
```

对于需要按需生成的 Numen 名额，在对应的 `residentCreationSlots.<id>` 增加 `numenAdmission`，内容为 `{"endpoint":"http://127.0.0.1:19085/v1/hosted-role","controlKeyFile":"/srv/private/hosted-model.key"}`。在 `bodies.<id>` 填写原生 MCP 端点、控制器 UUID 和唯一的技术名 `name`。服务先持久化新角色身份，再向本机 Numen 的入场接口申请该身体和短期会话。控制密钥留在服主机器。
