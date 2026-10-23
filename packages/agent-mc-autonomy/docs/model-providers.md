# 模型服务接入

此接口属于共享 `agent-mc-autonomy` 的可选模型端口。`agent-mc-world` 继续只负责 Minecraft 身体、任务、现场事实与游戏记忆，不引入模型供应商依赖。N.E.K.O 等插件只选择端口和保存配置。使用宿主模型时，宿主仍管理凭据、人格和模型选择；选择直连不会改变高层目标与原生动作队列。

## 厂商与协议

| provider | 默认协议 | 默认地址 / 密钥环境变量 |
| --- | --- | --- |
| `openai-compatible` | Chat Completions | 地址与环境变量显式填写；适用于自建或其他兼容服务 |
| `openai` | Responses | `https://api.openai.com/v1` / `OPENAI_API_KEY` |
| `anthropic` | Messages | `https://api.anthropic.com/v1` / `ANTHROPIC_API_KEY` |
| `google` | Gemini generateContent | `https://generativelanguage.googleapis.com/v1beta` / `GEMINI_API_KEY` |
| `qwen` | Chat Completions | `https://dashscope.aliyuncs.com/compatible-mode/v1` / `DASHSCOPE_API_KEY` |
| `deepseek` | Chat Completions | `https://api.deepseek.com/v1` / `DEEPSEEK_API_KEY` |
| `kimi` | Chat Completions | `https://api.moonshot.cn/v1` / `MOONSHOT_API_KEY` |
| `glm` | Chat Completions | `https://open.bigmodel.cn/api/paas/v4` / `ZAI_API_KEY` |
| `doubao` | Chat Completions | `https://ark.cn-beijing.volces.com/api/v3` / `ARK_API_KEY` |
| `siliconflow` | Chat Completions | `https://api.siliconflow.cn/v1` / `SILICONFLOW_API_KEY` |

预设只在用户选择后生效。推理和保存直连运行配置时模型 ID 必填；登录、读取模型列表可以暂不填模型名。不默认选最新型号，不探测局域网服务、不自动换厂商。`base_url` 可覆盖地域、自建代理或百炼业务空间域名；百炼目前推荐业务空间域名，旧域名仍受支持。填写根地址，不附加 `/chat/completions` 等方法名。Gemini 路径中的模型 ID 自动编码。

## 配置示例

工具目录在发给模型之前按名称去重，保留与原生执行校验一致的首个声明。原生元组会投影为供应商兼容的 `items`，保留长度和逐位置说明；派发仍校验原始 schema。`$defs` / `$ref` 不会被盲目删除，也不会联网解析引用。旧 `items: [...]` 与新 `prefixItems` 的区别见 [JSON Schema 官方数组文档](https://json-schema.org/understanding-json-schema/reference/array)。

HTTP 拒绝只保留状态码和受限原因类别，例如 `duplicate_tool_name`、`tool_schema_incompatible`、`context_limit`、`credentials_rejected`。错误体最多读取 16 KiB，不写入公共状态或异常文本；成功的 SSE 流继续逐步读取。已知拒绝不代表身体执行失败，原生队列继续运行，配置错误按 5 分钟退避；请修正配置，不要反复重连游戏。

直连 API Key 的环境变量必须由启动 Neko 的进程继承。设置用户环境变量不会更新已运行的 Steam/Neko 进程；请由本人正常退出并重新打开对应启动器，或在启动前注入环境。插件不修改系统环境，也不要求在 TOML 中保存明文密钥。

`context_tokens` 默认 65536（64K）；服务实际支持时可设为 131072（128K）。显式配置的其他有效数值会保留。该值不会探测或扩大服务的实际上下文容量；32K 服务应保留显式 32768。未注入模型计数器时，运行时使用 UTF-8 字节上界加输出与消息封装预留，预算不足会明确拒绝调用。

```toml
[autonomy]
max_output_tokens = 4096
context_tokens = 65536
model_timeout_seconds = 120

[planner]
# Neko 嵌入模式默认 route="host"。只有 direct 才使用下面的直连配置。
# standalone 本身就是显式直连；可以省略 route。
route = "direct"
provider = "qwen"
model = "在账户中已开通的模型ID"
api_key_env = "DASHSCOPE_API_KEY"
stream = true
image_input = false

[planner.parameters]
enable_thinking = true
thinking_budget = 2048

[planner.auth]
mode = "api_key"
```

原有 `base_url`、`model`、`api_key_env`、`output_parameter`、`image_input` 五字段配置继续可用。密钥、令牌不写入插件设置。可选环境变量只在运行机器读取。

## 参数与能力

显式使用 NInfer 的 Chat 服务时可设置 `[planner] cache_strategy = "ninfer"`。
框架只在发送时给最新现场之前的固定前缀及最近三个历史文本边界增加 `prompt_cache_breakpoint`。
相邻请求重复其中的历史边界，便于缓存满时识别真实的重复需求；原始消息、回执和当前事实不变。
仍然替换现场的调用使用显式写入模式，不为无法复用的末尾自动生成缓存。
0.2.42 的 full 调度保留完整的「现场输入—模型回复—工具结果」交换；下一轮确实追加在原输入之后，
因此这条文字通路可使用隐式末尾缓存及私有长锚点。未变化的非关键事实、知识和已选记忆用请求内
精确引用复用，生命、位置、队列和带来源的事件仍为原文。窗口淘汰时从完整内部快照重新物化引用，
不会留下悬空引用；切换人格/来源会撤去旧的私有输入历史，但不改变原生队列与回执。
历史现场与目标仅说明当时的情况，当前事实与任务以最后一条现场为准；相机帧保持仅当轮使用。
这适用于需要保存循环状态边界的混合模型；默认 `none` 不发送该厂商标记，也不会通过模型名或端口自动开启。
`planner.parameters.prompt_cache_key` 仍可显式用于只追加历史的 NInfer 客户端，或单独用于支持该参数的 Chat 服务。缓存命中只说明计算复用，不证明事实、决策或动作正确。
服务窗口、显存、工具调用和思考预算仍须独立验证；不要用强制 JSON 内容输出代替真实工具协议验收。

未配置的采样参数不发送，保留模型默认值。不根据模型名猜测能力；模型拒绝参数时明确返回失败，不暗中删除思考设置。

| 协议 | `parameters` 中可配置的主要字段 |
| --- | --- |
| Chat | `temperature`, `top_p`, `top_k`, `seed`, `stop`, `presence_penalty`, `frequency_penalty`, `reasoning_effort`, `thinking`, `enable_thinking`, `thinking_budget`, `reasoning_budget_tokens`, `response_format`, `min_p`, `repetition_penalty`, `chat_template_kwargs` |
| Responses | `temperature`, `top_p`, `reasoning`, `text`, `service_tier`, `prompt_cache_key`, `prompt_cache_retention` |
| Claude Messages | `temperature`, `top_p`, `top_k`, `stop_sequences`, `thinking`, `output_config`, `service_tier` |
| Gemini | `temperature`, `topP`, `topK`, `seed`, `stopSequences`, `presencePenalty`, `frequencyPenalty`, `thinkingConfig`, `responseMimeType`, `responseSchema`, `responseJsonSchema`, `mediaResolution` |

使用 HTTP 原生字段。不要将参数包在 SDK 的 `extra_body` 里。每个具体模型支持的字段和组合以厂商文档为准，例如 Claude 手动 thinking 的 `budget_tokens` 至少 1024 且小于输出预算；支持 adaptive 的模型可使用 `thinking={type="adaptive"}` 和 `output_config={effort="high"}`。Gemini 在 `thinkingConfig` 中设置预算或等级。DeepSeek 思考模式可能忽略部分采样参数，这并不代表参数起效。

某些兼容 Chat 的本地服务另支持 `reasoning_budget_tokens` 硬预算；只有确认服务支持后才显式配置，例如 512，并保留更大的 `max_output_tokens` 供最终工具参数使用。它与 `reasoning_effort` 的等级提示、其他服务的 `thinking_budget` 不等价。必须为非负整数，正值须小于输出预算，0 表示不设该硬预算；未配置时不发送，不改变其他用户或服务的默认值。预算到达后如何收束思考由所选服务实现，仍需验证完整终态与实际动作质量。

完整上下文的驻留历史与请求装配都使用注入的模型 token 计数器；没有可用计数器时才采用保守字节上界。动态事实仍在请求末尾，未满窗口时追加历史不会因字节/token 单位混用提前挤掉可缓存前缀。窗口真正不足时仍整体移除旧交换，原始日志不删除。

### 本地 vLLM 的工具参数顺序

接入自建服务时，还要验收服务端的工具解码约束，而不只是工具名和 JSON 是否可解析。
在 vLLM 0.31.0 / Qwen3 Coder 工具解析器的一次实测中，全局
`--tool-strict-level parameter` 使用的 XGrammar 默认按 schema 声明顺序生成对象字段。
原生动作有较多可选字段；当模型先输出 `item` 后，声明在它之前的 `count`、`at`
就可能被约束排除。表现可以是思考中数量正确，实际调用缺少数量、坐标，甚至出现无关字段。
这是已验证部署组合的兼容性问题，不代表所有模型或所有严格输出服务都如此。

若服务确实复现这个问题，可在请求排空后将该独立服务改为
`--tool-strict-level function`，保留工具名和调用封装约束。
这不是插件的 TOML 参数；HyperQwen 启动器相应使用 `TOOL_STRICT=function`。
不要因此关闭原生 schema、技能参数、权限、队列和未知回执校验，也不要补猜缺失参数。
显式标记 `strict=true` 的单个工具仍可能启用参数约束，应独立验证。
其他服务保持各自设置，不通过模型名自动套用此配置。

验收时使用真实工具声明，分别以 schema 顺序和自然顺序提交同一组期望参数，例如
`{"steps":[{"skill":"take","item":"arrow","count":64,"at":[10,64,-2]}],"queue":"append"}`。
仅收集回复，不派发游戏动作；对照原始生成文本、非流式解析以及实际 SSE 收集结果。
若能取得相同的渲染后输入 token，再比较有无参数约束，才能区分模型生成、解码约束与流式拼接问题。
还需确认不合法的数量仍被原生执行校验拒绝。合成协议用例通过以后，继续观察自然任务的原生终态；
模型能输出正确参数并不等于已经完成取物或长期生存。

### 显式本地 NInfer Chat 计数器

0.2.40 增加 `planner.context_counter`，由共享 HttpPlanner 自动接入现有计数端口。
它只使用本机 CPU，不调用推理、计数 HTTP 接口、游戏或宿主 SDK。依赖可选的
`agent-mc-autonomy[context]`（tokenizers、Jinja2）；未配置时不加载这些库。

```toml
[planner.context_counter]
mode = "ninfer_chat"
model = "与 planner.model 完全相同的模型 ID"
base_url = "http://127.0.0.1:8000/v1" # 必须与 planner.base_url 相同
tokenizer = {path = "/absolute/path/tokenizer.json", sha256 = "该文件的64位小写SHA256"}
template = {path = "/absolute/path/chat_template.jinja", sha256 = "该文件的64位小写SHA256"}

[planner.context_counter.template_parameters]
enable_thinking = true
preserve_thinking = true
reasoning_effort = "low"
```

两个资源必须来自**当前实际提供服务的 NInfer 模型产物**，并核对该服务的模板默认参数；
不能凭模型名复用另一部署的 tokenizer。参数使用真实请求值覆盖上述服务默认值。
模型或端点不匹配会拒绝配置；资源散列不符、运行期间文件替换、可选库缺失、未知模板语义、
媒体历史或数据中的特殊控制 token 会整轮回退保守计数，并在 `context.counter_fallback`
显示无私有内容的原因类型。替换服务产物时也必须重新核对绑定，散列本身不是远端鉴权证明。

NInfer 的工具定义规范化（含默认 `strict=false`）、JSON 参数和原生思考历史都纳入计数。
所选模型的 128K 上限仍是 token 上限，不能当成 128K UTF-8 字节。full 模式还会在同一条
事件内部复用完全相同的回执文本，附相对该事件对象的 `context_value_refs`；不同玩家、事件、
尝试仍分别保留，原始归档和查询入口不变。以上优化不改变思考预算或动作判定。

- 输出预算由 `autonomy.max_output_tokens` 统一提供；Chat 可选 `max_tokens` 或 `max_completion_tokens`。其他协议自动使用各自字段。
- 上下文预算仍由共享调度器计算，包含原生重放数据；保留完整工具交换，整体裁剪。预算上限可配置到 2,097,152，默认仍为 32,768。输出配置上限 131,072，默认仍为 1,024；这些是配置范围，不承诺所选模型有此容量。
- 四协议均支持非流式与 SSE 流式。流式仅用于接收和测量首个输出时间；全部回复完成、参数校验后才允许执行工具。截断、内容过滤、错误事件和缺少终态会拒绝整条结果，不能执行半个工具。
- `image_input=true` 才发送真实图像。原生 Claude/Gemini 使用核心的内联 PNG/JPEG 等，不额外下载图片；文字模式会剥离图片。图片被接口拒绝时保留原有一次文字回退，其他推理错误不在模型端口自动重试。
- DeepSeek/Kimi 的 `reasoning_content`、Claude 的 thinking/signature、Gemini 的 thoughtSignature、Responses 的 reasoning/encrypted_content 跟随原始交换保留。切换端点、协议、模型或授权记录时不会转发另一服务的原生状态。
- 使用量包含厂商实际返回的输入、输出、缓存和思考 token，缺失字段不补零。`first_output_ms` 是收到首个内容/思考/工具片段的时间，非流式保持未知。
- `organization`、`project` 用于 OpenAI；`anthropic_version` 默认 `2023-06-01`，`anthropic_beta` 显式开启供应商测试特性。模型自主游戏调用仍只使用共享框架提供的工具，不自动开通厂商网页搜索、计算机等额外工具。

## API Key、Bearer 与 OAuth

`auth.mode` 支持：

- `api_key`：OpenAI/国产兼容接口发送 Bearer；Claude 发送 `x-api-key`；Gemini 发送 `x-goog-api-key`。
- `none`：显式无认证的自建服务。
- `bearer`：由外部凭据管理器提供短期令牌，环境变量名仍用 `api_key_env`。每次调用重新读环境；此模式不负责刷新。适用于服务允许的 OAuth/WIF 等 Bearer 凭据。
- `oauth`：此项目自己发起的 OpenAI 或 Google 官方浏览器授权。PKCE S256、一次性 state、OIDC nonce 与签名、issuer/audience/expiry/sub 全部核验。授权记录按 `credential_id` 隔离，旧账户凭据只在新授权完整验证后替换。刷新按记录跨进程互斥，旋转 refresh token 与访问令牌一起更新。
- `google_adc`：使用 Google 官方 Application Default Credentials，通过 `google-auth` 续期。可选 `auth.quota_project` 对应 `x-goog-user-project`。ADC 登录仍按 Google 官方工具进行。

OAuth 是可选依赖，基础 API Key 接入无需安装全部云端 SDK：

```text
pip install 'agent-mc-autonomy[auth] @ git+https://github.com/jcs130/minecraft-ai-friend.git@<已验证提交>#subdirectory=packages/agent-mc-autonomy'
# ADC 另外安装同一提交的 [google] extra
```

在运行 Agent 的机器使用相同 TOML 配置执行：

```text
agent-mc-autonomy model-config --config models.local.toml
agent-mc-autonomy auth-login --config models.local.toml
agent-mc-autonomy model-list --config models.local.toml
agent-mc-autonomy model-check --config models.local.toml
```

`model-config` 只校验，不联网；`auth-login` 在本机临时监听 `127.0.0.1` 的随机端口并打开系统浏览器，180 秒内等待 `/auth/callback`；它不启动游戏。令牌仅写入 Windows Credential Manager、macOS Keychain 或受支持的系统密钥库；没有可用的安全后端会明确失败，不退回明文文件。`model-list` 显式读取最多 1000 个列表项，分页未读完会标记 `has_more`，不做推理。`model-check` 会使用一次推理额度，只核对无副作用的测试工具，不证明游戏能力。

OpenAI OAuth 配置需 `provider="openai"`、`protocol="responses"`、`stream=true` 和官方地址。请求固定 `store=false`，收到 `response.completed` 后才接受结果。首次登录走官方 `dynamic_agent_client` 动态注册，交换令牌使用回调中的 issued client ID。API Key 不要求 OAuth；账号是否具备 ChatGPT plan usage 许可必须看实际授权的 scopes 和服务返回。

Google OAuth 需要用户自己的 Desktop OAuth Client ID，并按其项目要求提供 `client_secret_env`；先在 Google Cloud 启用 API、配置同意屏幕和权限。Google OAuth/ADC 固定官方 Gemini 地址，避免把用户授权发给自定义代理。

Claude 此轮按官方 API Key，以及由外部管理的有效 Bearer 凭据接入。**没有把 Claude 订阅登录伪装成通用 API OAuth，也不读取 Claude Code、Codex、Gemini CLI 的本地账户文件。** `auth-forget` 只删除本项目的本机记录，不宣称完成云端撤销；远端解除授权在厂商账户管理中进行。

## 验证范围

供应商请求格式、SSE 终态、连续工具签名、图像转换、参数拒绝、OIDC 验签、OAuth 轮换、取消和超时均有离线假传输测试。无厂商真实密钥/用户授权时，不声称真实云端登录或推理已成功。Neko 页面只保存和显式测试配置，不自动启动或重载游戏；可米现役模型仍按原宿主配置运行。

## 官方资料（核对于 2026-10-14）

- [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create)、[官方动态注册与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[OAuth 推理约束](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[令牌刷新](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)。
- [Claude Messages](https://platform.claude.com/docs/en/api/messages/create)、[流式事件](https://platform.claude.com/docs/en/build-with-claude/streaming)。
- [Google OAuth](https://ai.google.dev/gemini-api/docs/oauth)、[generateContent](https://ai.google.dev/api/generate-content)、[Thinking](https://ai.google.dev/gemini-api/docs/thinking)。
- [百炼兼容接口及参数](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions/)、[DeepSeek 思考与回传](https://api-docs.deepseek.com/guides/thinking_mode/)、[Kimi 思考模型](https://platform.kimi.com/docs/guide/use-thinking-models)、[智谱兼容接口](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)、[火山方舟认证](https://docs.volcengine.com/docs/ark/base-url-and-authentication?lang=zh)、[硅基流动](https://docs.siliconflow.cn/docs/userguide/quickstart)。
