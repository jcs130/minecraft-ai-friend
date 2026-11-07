# 女仆选择原生或 HarnessRouter

**0.1.10-harness 候选，尚未部署。** 正式服仍为0.1.9-follow。复用已安装的 HarnessRouter 与 Numen 使用的规划适配器，不新建 Minecraft 账号、MCP 身体或常驻决策循环。

主人先查 `/qdmaid brain <maidId>`，得到当前选择、可用选项及各自模型。切换使用 `/qdmaid brain <maidId> <requestId> <返回的choice>`；真人用 `/qdmaid brain-menu <maidId>` 的普通背包菜单。Agent 的 `mc_maids` 使用 `action:"brain"`，省略 `choice` 查询，填写 `choice` 时须保留独立 `requestId`。对话仍走原 `chat → receipt`，不是给每种 Harness 再造一套命令。

| 候选选项 | 执行方式 | 本机已验证的模型别名 |
| --- | --- | --- |
| native | 原生女仆配置的模型客户端 | 保留当前配置，不替换玩家私有设置 |
| dsh | 现有 HarnessRouter 的 DSH | qwen3.7-plus |
| codex | 现有 HarnessRouter 的 Codex | qwen3.7-plus-responses |

Harness 名称与模型是两个概念；选择 Codex 不等于换成 OpenAI 的模型。可用项来自本机明确配置和实测，不把 `/v1/models` 的全部目录当成可调用模型。`/v1/harnesses` 是自建预设；为空不代表 `/v1/bases` 中的后端没有安装。

## 接线

`原主人连接 → 原 TLM 历史/上下文 → loopback 网关 → 已有 HarnessRouterPlanner → 原 TLM 工具 → 原女仆 AI`。

TLM 的工具与序列化注册表在初始化后不可变。服务端小扩展通过官方 `registerAITool`、`registerAIChatSerializer` 生命周期接入；不能在 Bukkit 启动后重新初始化或反射修改注册表。只包装原有七项工具，保持原工具 ID、参数、原生工作及路径 AI，不增加物品、实体或自定义客户端包。客户端仍按原 `openai` 类型解码，网络同步剔除服务端密钥和私有请求头；磁盘配置与服务端调用保留原值。

共享配置仅绑定服主指定的原肥鱼 UUID 和原主人 UUID；其他女仆保留原生工作，不能选用这些共享站点。切换保留女仆、记忆、模型外观和装备；对话未结束时拒绝切换。工具真正执行前再次检查原身份、存活状态及运行方式，迟到的旧响应不得执行动作。没有定时模型调用、失败重投或自动切换服务商。

原工具结果按 call ID 续接；向 Harness 明示已返回的真实执行证据。当前用户轮中重复提交相同模式设置会返回 `NATIVE_TOOL_ALREADY_RETURNED_QUERY_STATE`，不再执行；后续独立用户轮可重新设置。查询及 `use_skill` 不套用这个模式去重规则。模式已设置不代表已经到达地点或完成工作。

Codex偶发在同次UHP响应的多个assistant帧中重复输出相同完整规划。只对完全一致的完整JSON帧合并一次，再交原适配器严格解码；不同规划、任意文本或不完整JSON不据此放行。该兼容层仅在女仆网关的请求子类中生效，不修改安装目录、原Numen配置或其运行进程，也不额外调用模型修复JSON。

网络或模型错误保留原请求回执，返回 `unknown` 和实际安全原因码。终止标记明确为服务器状态，不能伪装成女仆回答；不清空原历史、不补造工具成功结果。查询原回执和世界状态，不换 ID 自动重试。明确开始的新对话可以在终止后继续。

## 构建和配置

使用 Java21、现役0.1.9-follow固定摘要及原TLM1.5.3编译依赖，执行 `build-harness-bridge.py`。输出原桥0.1.10-harness和服务端扩展0.1.0。构建校验基底，保留40项无关JAR内容。扩展无需客户端安装；本机原生序列化已验证，远端设备画面需分别验收。

网关用现有 Python 环境运行 `gateway.py <私有配置路径>`。配置结构：

```json
{
  "schema": 1,
  "host": "127.0.0.1",
  "port": 19089,
  "token": "在私有文件中生成至少32字符的随机传输密钥",
  "maidId": "原女仆UUID",
  "ownerId": "原主人UUID",
  "hub": {"base_url": "http://127.0.0.1:29150/api/harness", "keyFile": "既有Hub私有密钥文件路径"},
  "choices": {
    "dsh": {"harness_id": "dsh", "model": "qwen3.7-plus"},
    "codex": {"harness_id": "codex", "model": "qwen3.7-plus-responses"}
  },
  "timeoutSeconds": 40,
  "plannerModule": "本机已安装的agent_mc_autonomy/harness_router.py",
  "plannerSha256": "27ea1f77e68c7054ac8a8e8cbff766f57470a28e48bf6feac3e9126233bdbc67",
  "journalFile": "私有诊断目录/hub-requests.jsonl"
}
```

此处是格式示例，不可原样作为配置。网关只绑定loopback，检查精确Host、Bearer、请求大小及已配置模型；不接浏览器Cookie/Origin，不回显底层供应商错误。Hub Key仅由网关读取，不复制到女仆或玩家。诊断只保存请求/响应编号与状态，不保存思考过程、聊天正文或密钥。

原TLM `sites/llm.json` 添加对应OpenAI兼容站点，地址为 `http://127.0.0.1:<端口>/v1/<maidId>/<choice>/chat/completions`，密钥为独立传输token。原桥私有 `brain-routing.json` 使用 `schema:1,maidId,ownerId,choices`，每个选项含 `site,model,label`，且必须包含指向原生站点的 `native`。先准备完整配置/回退并正常重启加载扩展，不能在线注入类或使用 Bukkit `/reload`。后台须通过现有独立进程、单实例和Watchdog管理；本候选尚未安装正式自启。

## 验证和边界

离线：`python -m unittest discover -s paper/integrations/touhou-maids/tests -p test_harness_gateway.py -v`；`node --test paper/integrations/touhou-maids/tests/maid-port.test.mjs`。真实服夹具 `tests/brain-harness-stage.mjs` 只允许指定fresh localhost合成存档，显式提供QA目录/连接锚点/RCON/报告根目录；每轮唯一ID，不重放失败动作或复制真实玩家数据。QA wire/迟到响应探针仅装在隔离服，禁止放入正式包。

已完成真实DSH/Codex工具及回复、行走主人跟随、故障终态/同ID去重、普通菜单、原客户端解码和密钥剔除检查。最终重启检查与正式部署状态见候选发布记录。附近聊天/ASR自动触发、主动社交、TTS声线统一及原肥鱼正式客户端验收不属于已完成能力；本轮没有启用这些功能。

上游依据：[TLM AI扩展](https://tlmwiki.cfpa.team/wiki/dev/ai/overview/)、[工具扩展](https://tlmwiki.cfpa.team/wiki/dev/ai/tool/)、[HarnessRouter自托管](https://github.com/HarnessRouter/harnessrouter/blob/main/docs/self-hosting-guide.md)。
