# 千灯纪女仆身份与身体桥

独立扩展，面向当前 TLM 1.5.3 / NeoForge 21.1.248 / Minecraft 1.21.1 / Java 21。它不创建女仆、分配主人、重命名、复制 Qwen 角色或注册后台模型任务。新站点默认关闭，构建工具不修改运行配置或部署 JAR。

## 构建与安装边界

`python -X utf8 tools/build_maid_bridge.py` 使用实际安装的 TLM JAR 和项目库编译，运行纯协议/持久回执测试及真实 TLM codec 往返测试。产物和依赖哈希记录在本目录被忽略的 `build/` 中。

同一 JAR 需要安装到服务端和客户端：身体/命令/HTTP 逻辑只在服务端执行，但 TLM 的设置同步需要客户端同样认识专用站点 codec。没有加入任何自定义物品、实体或客户端渲染器。

离线编译、codec 测试不证明实机注册、正常进服、回调/TTS 或原生工作已验收。`python tools/smoke_maid_bridge.py --run-isolated` 使用全新临时世界、当前安装模组、内部 Docker 网络与确定性假 NPC 服务做真实启动、原生回调和存档重启验证，不挂载生产配置、存档或密钥，不发布游戏/RCON端口，不调用 LLM/TTS。仅 QA JAR 会生成两个临时 Numen 主人与女仆；其 `qa/` 代码不会进入发布 JAR。运行报告保存在被忽略的 `runtime/maid-bridge-qa-*/result.json`，包含 JAR、工具及 fixture 哈希；容器和网络在 finally 中精确移除。

当前候选通过 99 个离线 Java 断言、原有 20 项隔离实机检查和 51 项专属伙伴检查，包括共享 codec、旧 deepseek ID、七种原生能力、正常蛋糕认领、状态恢复、跨主人拒绝、两个角色同时签名请求及各自聊天历史、保存重启后 UUID/主人/幂等回执保留。Windows 的日志测试不把未执行的符号链接断言计入通过；另有 Linux 路径测试。它证明受控环境中的原生状态和回调链路，不证明玩家客户端实际进服、能听到音频、农耕/战斗任务完成或长期自主运行。生产集成仍应保留原实体 UUID、主人和进度，不强制加载旧区域。

## 可信聊天请求

`@LittleMaidExtension` 注册 `api_type: qiandeng-qwen`，以组合方式实现 `LLMSite` 与 `SupportModelSelect`，沿用原 `LLMOpenAISite` codec 的站点 ID、图标、enabled 与模型标签字段。它不是 OpenAI 站点子类，因而旧 `deepseek` ID 不会被原生供应商空密钥校验误拦截，也无需设置假密钥。默认站点 `id: qiandeng-qwen`、模型标签 `qd-maid-dialogue`、`enabled:false`；模型标签不选择供应商，具体 Qwen 人物与模型由 Python 注册表决定。

选择该站点后，`BridgeClient` 在 Minecraft 主线程从 `LLMCallback.getMaid()` 读取实际身份和消息，必须是活着、已加载、已绑定主人的女仆，并且主人当前在线。只快照数据，不从聊天正文、模型名或站点 headers 猜身份。

现有 `codingplan` 条目的完整迁移后示例（保留原 ID，因而无需改实体的 llmSite）：

```json
{
  "codingplan": {
    "id": "codingplan",
    "api_type": "qiandeng-qwen",
    "enabled": true,
    "icon": "touhou_little_maid:textures/gui/ai_chat/openai.png",
    "url": "http://npc:8091/v1/maid/chat/completions",
    "secret_key": "",
    "headers": {},
    "models": ["qd-maid-dialogue"]
  }
}
```

`tools/configure_maid_bridge.py --check` 只检查；`--apply qiandengji` 在确认精确的 `qiandengji-mc-1` 已停止后才应用。迁移所有现有站点，保留十四个既有 ID、各自 enabled、icon 和原模型标签，不按示例覆盖整个文件。先在被忽略的 `runtime/maid-bridge-backups/` 保存原 JSON 完整字节，再原子替换协议字段，若不存在则创建服务端 identity.key，已有 key 绝不覆盖。它不会读写实体、人格、历史、TTS/ASR 站点、旧共享 HTTP 入口的 token 或 Qwen 配置。文件并发变化会拒绝覆盖。

TLM 原生聊天还要求模型有可识别的 CharacterSetting，否则先走原生“生成设定”回调，回答不会作为正常聊天入历史。`tools/prepare_maid_settings.py --check` 读取真实保存实体及已有设定元数据，在 `runtime/maid-native-settings-plan.json` 生成只针对正在使用且缺失模型的增量候选；保留已有 `.yml`，不输出私人正文。确认唯一有主女仆当前确实未加载后，另生成 `runtime/maid-production-identity.json` 供管理员显式预注册，不改变实体或主人。`--apply qiandengji` 只在 MC 停止时重新核对候选并以独占新建方式写入 `tlm_custom_pack/qiandeng-native-chat-1.0.0/assets/qiandeng_bridge/settings`，备份记录在 `runtime/maid-native-settings-backups`。依赖 `nbtlib==2.0.4` 和 PyYAML；本机已有依赖可用 `PYTHONPATH=runtime/survival-test-deps`。通用设定只接通原生聊天，独立人格与记忆仍在 UUID 绑定的 Qwen Agent 中。TLM 1.5.3 只读取 `.yml`；其 CharacterSetting.save 当前未输出 model_id，不能以保存成功代替识别检查。

TLM 1.5.3 的原生包加载会先清空 SettingReader，再读取自定义资源包，启动时先读入的 `config/settings` 因而可能丢失。生产已复现：只放 config 时两位已加载女仆的 `nativeChatSetting` 为 false，`tlm ai_chat reload` 后恢复。持久方案为上面的独立 settings 小包，不新增模型或覆盖其他包。对早期 helper 已生成的配置，`--persist qiandengji --plan <原候选路径>` 只复制内容及 SHA 与原始通用模板完全一致的文件，保留原文件；遇到用户修改或目标冲突立即停止。然后运行原生 `tlm pack reload`，无需重启 Minecraft、无模型调用。生产该命令清空并重新加载后，两位已加载女仆依然识别正常，回执在 `reports/maid-native-settings-reload.json`；未加载人物仍待现场验证。健康检查同时核对生成的 config 副本是否有一致的原生包副本，避免当前内存正常却下次重载丢失。

QwenPaw 2.2 原生 MCP API 创建的是统一 DriverCard，不一定回写旧 `agent.json.mcp.clients`。健康检查以实际卡、加密凭据及原生 MCP/策略/工具 API 为准；旧客户端副本如存在必须一致，七项工具均限 `console` 来源，未知客户端或额外规则不能通过。其新客户端先探测可选 `server/discover`，桥接在验证 Bearer 后按 JSON-RPC 返回 `-32601 Method not found`，客户端才会回退标准 initialize；正常能力仍要求绑定同一人物的会话。生产原生七项工具发现与完整游戏 Qwen 健康已验证，未发模型请求；报告为 `reports/maid-qwen-driver-readiness.json`。

TLM 原生 `AvailableSites.init` 会自动添加每个 serializer 的默认站点，因此启用 addon 后可能自然多出第十五个 `qiandeng-qwen` 项（默认关闭）；十四个旧 ID 仍在，不以总项数严格等于14作为成功条件。

```text
POST http://npc:8091/v1/maid/chat/completions
Content-Type: application/json
X-QD-Request-Id: 随机 UUID
X-QD-Issued-At: epoch 毫秒字符串
X-QD-Signature: 小写十六进制 HMAC-SHA256
```

签名消息精确为 `requestId + '\n' + issuedAt + '\n' + sha256(rawBody).hex()`，UTF-8 编码。密钥只从 MC 工作目录 `config/qiandeng_maid_bridge/identity.key` 读取，ASCII 去首尾空白后 32–256 bytes；不进入站点 codec、客户端同步、HTTP 正文或日志。站点任意 headers、secret_key 和 URL 不参与出站请求，目标固定且不跟随 HTTP 重定向。Python 应按同一 key 验证原始请求字节、五分钟时差，并用 requestId/body hash 处理重放；签名证明来源，不把名字和消息内容升级为指令权限。

正文形状：

```json
{
  "qd_identity": {
    "schema": 1,
    "maidUuid": "实际实体 UUID",
    "ownerUuid": "实际主人 UUID",
    "entityId": 123,
    "displayName": "当前显示名字",
    "hasCustomName": false,
    "modelId": "实际模型 ID",
    "dimension": "minecraft:overworld",
    "position": [0, 64, 0],
    "loaded": true,
    "observedAt": 1
  },
  "model": "qd-maid-dialogue",
  "stream": false,
  "messages": [{"role": "user", "content": "当前请求"}]
}
```

UUID 是路由依据；数值 entityId 只是当前进程中的观察字段。最多 48 条消息、合计 12000 个 Java UTF-16 字符、65536 UTF-8 bytes，不悄悄丢弃最后消息。HTTP 在异步线程发送，单次 60 秒，不自动重试；每女仆一次在途请求、全桥最多四次。Qwen 侧仍须执行已有用途预算，四次上限不代表允许四个并发模型调用。

响应只接受 HTTP 200、一个 `choices[0].message`、role 为 assistant、非空 content（最多 8000 字符），拒绝 tool_calls/function_call；接收期间限制整体 16384 bytes。回到主线程后重新核对原实体对象、UUID、主人和在线状态，再调用原生 `LLMCallback.onSuccess(ResponseChat)` 保留其聊天历史、气泡及 TTS 行为。桥不调用 `onFunctionCall`，不增加原生工具循环。模型预算和真实用量在 Qwen/Python 侧统计，不把任务数伪造为 token 数。

## 身体观察与状态切换

仅 RCON/服务端管理源（permission 4 且无实体）可用：

```text
qdmaid list <offset>
qdmaid invoke <base64url(JSON)，不带 padding>
```

`list` 只分页发现已加载女仆；不扫描存档、不加载区块，也不应导出为单人物 MCP。每页最多四位，返回 `maids、totalLoaded、nextOffset、truncated、unloadedNotScanned:true`。列表里无主女仆的 ownerUuid 为 null；观察不自动注册或绑定它们。

列表各项与 identity 回执 state 中的 `nativeChatSetting` 是布尔诊断，不传出人格正文。`tools/maid_bridge_health.py` 只读检查真实已加载列表、该诊断、客户端/服务端 JAR 与源码哈希、固定站点配置、NPC 挂载密钥是否一致、签名接口就绪及注册表计数；输出不含名字、UUID、角色正文或凭据。独立实机报告复制到 `reports/maid-bridge-smoke.json` 后，探针核对二十项行为及产物/测试源码哈希。未加载人物明确标记为尚未现场核验，不把预注册当作已在线。

`invoke` 最多 1400 个 base64url 字符、解码最多 1024 bytes。JSON 字段必须为：

```json
{"schema":1,"requestId":"客户端生成的16到80位安全ID","maidUuid":"标准小写UUID","ownerUuid":"标准小写UUID","operation":"identity","args":{}}
```

请求中多余字段拒绝。Python MCP 必须从固定人物凭据注入 UUID/ownerUuid，不向模型开放这些参数。桥每次重新查找实际加载实体并核对当前 owner；无主、未加载或换主不能通过旧绑定执行。身体查询与原生状态切换不要求主人在线；聊天回调要求主人在线。

| operation | args | 结果 / 原生实现 |
| --- | --- | --- |
| identity | `{}` | `identity、state、contextCategories`；精确身体属性与状态 |
| context | `{"category":"identity 返回的类别 ID"}` | 原生 `GameContextRegister.getContext`，最多八行、每行400字符并按字节裁剪；`lines、truncated、trustedInstructions:false` |
| task_catalog | `{"offset":0}`，可省 offset | 原生非隐藏工作目录；每页最多四项，含 taskId/name/enabled/summary，nextOffset/total/truncated |
| sit | `{"sit":true}` | 原生 `setInSittingPose`，之后读回实际姿态 |
| follow | `{"follow":true}` | 复用原生跟随/家园范围切换语义；关闭跟随会把当前位置设为家园范围，不等同于坐下 |
| schedule | `{"schedule":"DAY"}` | 仅 DAY/NIGHT/ALL 三个原生枚举 |
| work | `{"taskId":"namespace:path"}` | 重新检查已注册、非隐藏且 isEnable，切工作模式并复用原生准备钩子；没有任意攻击目标参数 |

固定回执前缀 `QD_MAID_JSON `，JSON 最大3500 UTF-8 bytes。通用字段为 `schema、engine:qiandeng_maid_bridge、ok、code、phase、observedAt、requestId、maidUuid、ownerUuid、operation`。状态切换带 `before/after、workCompleted:false`；`code:state_applied、phase:applied` 仅证明读回状态符合要求。工作可能返回 `nativePreparation:OK/NO_CHANGE/MISSING_REQUIRED_ITEM/PARTIAL_OK`，装备、日程、工具和环境仍影响真正工作。

副作用之前在 `data/qiandeng-maid-bridge/receipts` 持久登记 requestId 与请求指纹，完成后原子写入回执。相同 ID/字节请求只返回历史回执（`replayedReceipt:true`），不重新操作。只剩 claim 的中断请求返回 outcome_unknown，不重放；同 ID 不同请求返回 request_id_conflict。日志目录达到4096文件时拒绝新状态切换，保留记录，不自动清理未知结果。只读观察不写该账本。

主要拒绝码：`maid_not_loaded、unowned_maid、owner_changed、unknown_context_category、unknown_task、native_task_disabled、invalid_*、unexpected_field、request_id_conflict`。异常发生在可能有副作用之后、持久最终回执失败或读回状态不匹配时，phase 为 outcome_unknown；调用方应查询，不自动补偿或重放。此第一层不提供移动、任意攻击、物品赠予、经验修改、主人变更、人物资料改写或模组知识技能的额外 LLM 调用。

## Numen 专属女仆接入

当前 Numen 的 `interact_entity` 会自动寻路再右键；它已在隔离世界完成原生蛋糕认领，但生产初始化时出现远距离寻路并遇敌死亡。专属伙伴初始化改用下列仅控制台/权限 4 的有界命令，不加入人物的七项 MCP 权限：

```text
qdmaid companion_adopt <16到80位唯一requestId> <已加载女仆UUID> <在线Numen主人UUID>
```

它要求生存模式、女仆无主、同维度距离不超过 3 格、有视线、无打开菜单和光标物品，且主手或副手已经持有原生驯服物品。调用一次正常 `EntityMaid.interact`，进入原生 `tameMaid`，核验物品 -1、数量 +1 与真实主人；保留原生数量上限、事件和成就。不寻路、不换手、不发物品、不直接调用基类 `tame` 或设置 owner UUID。发起前应停止并发身体动作。`data/qiandeng-maid-bridge/adoption-receipts` 在交互前持久登记，重复 ID 返回历史回执；未知结果不重放，已经有主时新 ID 也拒绝交互。失败后需观察实际身体和库存，不能把受理当作成功。

主人是 Numen 玩家时可用仅控制台/权限 4 的配置入口：

```text
qdmaid companion_chat <女仆的标准小写UUID> <Numen主人的标准小写UUID>
```

该命令要求已加载、已拥有的女仆，在线且真实匹配的 NumenPlayer 主人，以及已启用的全局原生 AI 聊天和模型 CharacterSetting。优先保留该女仆当前已启用且支持 `qd-maid-dialogue` 的真实 BridgeSite，否则选择唯一符合条件的桥接站点；没有候选或候选有歧义时拒绝，不自动启用旧站点。它只设置该女仆原生序列化字段 `llmSite/llmModel`；重复执行返回 `already_configured`。不修改主人、名字、模型外观、自定义人格、原生历史或 TTS，不发送聊天、不打开全局功能，也不允许输入供应商地址。变化随正常世界保存落盘，配置成功并不等于独立 Qwen 角色已注册。此入口需要安装新 JAR 后使用，构建和 QA 不会部署或重启生产服。

`python -X utf8 tools/smoke_maid_bridge.py --run-isolated --companion` 使用独立 `CompanionQa.java` 和当前真实 Numen/TLM 模组。2026-09-08 的 24 项实测通过：蛋糕 3→2、女仆数量 0→1、一次原生认领事件、Numen 实际步行与女仆原生跟随、坐下阻止跟随、解除后的远距会合、主人离线与同 UUID 恢复、独立服保存重启后的归属/物资/聊天配置保留，以及配置拒绝和幂等。对应报告为 `runtime/maid-bridge-qa-76dca19660e3/result.json`。该 QA 不调用模型或 TTS，测试角色不进入生产；尚未测试载具、跨维度会合、真人进服、双方人格交流和协作产出。远距会合复用原生传送，不能宣称全程徒步。

随后新增 `companion_adopt` 的 32 项实际回归通过，报告 `runtime/maid-bridge-qa-4d649c01636a/result.json`：补充了超距、视线阻挡、未持物拒绝，副手蛋糕消耗而主手铁剑保留，同 ID 回执重放、已拥有后新 ID 拒绝、回执随服务器重启保留；原生事件、数量、跟随、聊天字段和零模型调用一并重验。早期报告中的 Numen 自动寻路交互与这次有界命令是两个不同的入口。最终候选的 `runtime/maid-bridge-qa-6fafd13572fa/result.json` 通过 51 项：重验上述能力并加入 nearby 双向游戏事件、拒绝与重启防重，以及 `codingplan` 启用、`deepseek` 禁用时的正确站点选择；同产物的原桥 20 项在 `runtime/maid-bridge-qa-f7431df1a2ea/result.json`。全部为零真实模型、零 TTS 调用的独立世界测试。

生产新增专属身体可使用原版管理员 `summon touhou_little_maid:maid`，指定预先记录的新 UUID、附近已加载安全位置及 `PersistenceRequired:1b`，不填写 Owner/Tame 等归属 NBT；重复执行前先按 UUID 查询，已有身体则复用，不能换 UUID 再召唤。其后由原桐人正常持蛋糕交互。具体名字、外观和位置由项目管理流程决定，不从现有真人女仆复制或转移归属。QA 的固定 UUID/坐标只属于全新隔离世界，不能作为生产运行参数。

生产初始化按以下顺序记账，不能用重新召唤或回滚存档处理失败：

1. 暂停桐人调度，确认没有未决身体动作；记录唯一新女仆 UUID、原桐人 UUID、位置、库存和物品来源。更新 JAR 前保存并停止 D 项目 MC，备份完整当前存档与服务端/客户端产物，同步后一次启动。
2. 新身体可在初始化期间暂用 `NoAI:1b` 稳定位置，仅限这位新人物；检查加载、地面、空气和占用后放置。仍无主时允许在初始化范围调整她的位置，不传送桐人或挪用旧女仆。按真实蛋糕账目继续，本轮唯一初始化蛋糕已给过，不再发放。
3. 认领写入唯一 requestId，检查回执中的 owner、物品 -1 和原生女仆数 +1。超时或未知先查实际状态与回执；即使进程重启也不改 ID 重试副作用。死亡角色先走同 UUID 原生死亡恢复，保留死亡原因和当前库存，不能恢复旧玩家数据冒充复活。
4. 成功后配置 `companion_chat`，经已有 `sit:false`、`follow:true` 设置原生模式，**将这位新女仆的 `NoAI` 恢复为 `0b` 并读回确认**，然后保存身份供独立 Qwen 注册。原生保存会省略 false 的 NoAI 字段，可用 `execute as <精确女仆 UUID> unless entity @s[nbt={NoAI:1b}]` 核验；字段缺失不等于仍然禁用。正常跟随、真人声音与双方自主产出分别验收。

失败时保留当前世界、角色和未知回执，停止依赖动作，记录临时 `NoAI` 尚未解除，不能宣称人物已经运行。产物更新失败可在停服状态恢复该次备份的原 JAR；不自动回滚世界、清死亡账本、删新身体或转移主人。2026-09-08 本机初始化命令、停止时快照、正常死亡恢复、蛋糕 0→1→0 与真实认领回执位于 `runtime/maid-companion-production-20260908/`，不进入公开仓库。小灯已经属于原桐人，NoAI 已解除、follow 已启用；这枚蛋糕是伙伴初始化供给，不能计为桐人自主合成成果。双方真实自主出行与共同产出另行验收。

原生声音桥可继续复用 `BridgeClient` 的真实 owner/maid 身份校验；但 TLM 原生 `TTSCallback` 只将音频发往主人连接，Numen 主人不会自动让附近真人听到。队伍消息和附近播放仍需接入现有 `GodVoice` 角色语音队列，按女仆 UUID 和真实位置绑定；本改动未增加 TTS 转发，也未把语音入队视作真人听到。

## 游戏内附近交流

`qdmaid party_say <base64url JSON>` 和 `qdmaid party_speech_status <eventId>` 都只允许控制台、权限 4，不改变人物的七项身体 MCP。说话输入固定为：

```json
{"schema":1,"eventId":"标准小写UUID","speakerUuid":"真实身体UUID","listenerUuid":"真实身体UUID","text":"不超过160个Unicode字符的单行原文","textSha256":"原文UTF8的64位小写SHA256","channel":"nearby"}
```

无控制符、不截断原文；身份与文本摘要不匹配拒绝。`channel` 可省，默认 `nearby`；另一取值为 `msg`。双方必须是实际在线存活的 NumenPlayer 和其已拥有、已加载的女仆。nearby 支持两个说话方向，服务端同一 tick 检查实际位置：同维度、距离不超过 24 格，不要求视线。远处、跨维度、缺失身体或归属不匹配即终态拒绝，不先私下投递、不排队等待走近。

通过检查后，向说话者附近 24 格内普通玩家发送带 `[附近]` 标记的游戏聊天文字；排除 Numen 和 NeoForge FakePlayer 连接，避免旧 guard 收件箱再次唤醒。随后同 tick 持久化接收身体的空间听觉事件，NPC 桥只能在 `heard:true` 原生回执后把这件已发生的游戏事件提供给相应 Qwen 人格。这里不调用模型或 TLM 聊天回调，也不写无标记的全服聊天日志。可选 GodVoice 配音在听见确认之后发送；音频播放状态不作为 AI 听见的依据。

`msg` 字段保留，但**本版未开放私聊投递**。原版 `/msg` 的目标是玩家，桐人向女仆私聊返回 `unsupported_player_target`；女仆向玩家返回 `native_msg_unavailable`。隔离测试中的真实实体命令源薄接线未取得可验证的原生命令成功回调，因此没有把它宣称为已经听见，也未部署该实验发令代码。没有公共字幕或公共 TTS，不把失败私聊偷偷改为 nearby；不制造虚拟玩家、不用会触发额外 LLM 循环的 TLM 私聊回调代替。真人正常使用游戏原版 `/msg` 不受此桥影响。

回执继续以 `QD_MAID_JSON ` 开头，固定字段为 `schema、eventId、speakerUuid、listenerUuid、textSha256、channel、ok、heard、phase、code、dimension、speakerPosition、listenerPosition、distance、radius、emittedAt、observedAt`。nearby 的 `radius` 为 24，msg 为 null；位置是原生 `[x,y,z]`，`dimension` 为说话者维度 ID，跨维度时 distance 为 null，时间为毫秒。尚无数据的字段为 null，回执不含原文。nearby 成功 `phase:heard/code:nearby_speech_heard`，确认时 observedAt 不早于 emittedAt；msg 在本版始终拒绝。未知结果只能查询 status，不能重新发命令。

相同事件重复查询或提交不重播，提交返回 `already_heard`。同 ID 改身份、原文摘要或 channel 返回 `request_id_conflict`。已拒绝的同一事件也不能重新排队。

`data/qiandeng-maid-bridge/party-speech/<eventId>.json` 在任何发包前强制写入 claim，完成后以单个原子文件保存 `input` 原文和服务端 `receipt`（事件类型 `nearby_speech_heard`、`nearby_speech_rejected` 或 `private_message_rejected`）。仅有 claim 或持久化失败时返回 `phase:unknown/code:outcome_unknown`，不得重发。status 只读；没有事件为 `phase:not_found/code:event_not_found`，仅保留 eventId，其余身份、channel 和位置为空。重启后仍读取原回执，观察时间更新而发声时间保留。对话请求与回答必须分别使用各自 UUID 走同一游戏入口；无法支持的收件类型明确失败。

## 核查来源

编译与 codec 测试以本机实际 TLM JAR 为准；官方源码以 `207647c85740b1d0971de6040d6dd57cea62528c` 的 1.21 实现对照：

- [扩展标记](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/api/LittleMaidExtension.java)
- [LLM 客户端与回调接口](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/ai/service/llm/openai/LLMOpenAIClient.java)
- [原生跟随语义](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/ai/agent/tool/implement/SwitchFollowStateTool.java)
