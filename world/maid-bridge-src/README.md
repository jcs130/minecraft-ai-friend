# 千灯纪女仆身份与身体桥

独立扩展，面向当前 TLM 1.5.3 / NeoForge 21.1.248 / Minecraft 1.21.1 / Java 21。它不创建女仆、分配主人、重命名、复制 Qwen 角色或注册后台模型任务。新站点默认关闭，构建工具不修改运行配置或部署 JAR。

## 构建与安装边界

`python -X utf8 tools/build_maid_bridge.py` 使用实际安装的 TLM JAR 和项目库编译，运行纯协议/持久回执测试及真实 TLM codec 往返测试。产物和依赖哈希记录在本目录被忽略的 `build/` 中。

同一 JAR 需要安装到服务端和客户端：身体/命令/HTTP 逻辑只在服务端执行，但 TLM 的设置同步需要客户端同样认识专用站点 codec。没有加入任何自定义物品、实体或客户端渲染器。

离线编译、codec 测试不证明实机注册、正常进服、回调/TTS 或原生工作已验收。`python tools/smoke_maid_bridge.py --run-isolated` 使用全新临时世界、当前安装模组、内部 Docker 网络与确定性假 NPC 服务做真实启动、原生回调和存档重启验证，不挂载生产配置、存档或密钥，不发布游戏/RCON端口，不调用 LLM/TTS。仅 QA JAR 会生成两个临时 Numen 主人与女仆；其 `qa/` 代码不会进入发布 JAR。运行报告保存在被忽略的 `runtime/maid-bridge-qa-*/result.json`，包含 JAR、工具及 fixture 哈希；容器和网络在 finally 中精确移除。

当前候选通过 59 个 Java 断言和 20 项隔离实机检查，包括共享 codec、旧 deepseek ID、七种原生能力、状态恢复、跨主人拒绝、两个角色同时签名请求及各自聊天历史、保存重启后 UUID/主人/幂等回执保留。它证明受控环境中的原生状态和回调链路，不证明玩家客户端实际进服、能听到音频、农耕/战斗任务完成或长期自主运行。生产集成仍应保留原实体 UUID、主人和进度，不强制加载旧区域。

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

## 核查来源

编译与 codec 测试以本机实际 TLM JAR 为准；官方源码以 `207647c85740b1d0971de6040d6dd57cea62528c` 的 1.21 实现对照：

- [扩展标记](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/api/LittleMaidExtension.java)
- [LLM 客户端与回调接口](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/ai/service/llm/openai/LLMOpenAIClient.java)
- [原生跟随语义](https://github.com/TartaricAcid/TouhouLittleMaid/blob/207647c85740b1d0971de6040d6dd57cea62528c/src/main/java/com/github/tartaricacid/touhoulittlemaid/ai/agent/tool/implement/SwitchFollowStateTool.java)
