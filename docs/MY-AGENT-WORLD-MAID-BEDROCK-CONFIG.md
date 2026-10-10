# 车万女仆 LLM 基岩配置

适配 My Agent World 的 Minecraft 1.21.1 / NeoForge 21.1.248 / Touhou Little Maid 1.5.3。基岩版使用游戏内原生按钮、下拉列表、开关和输入框，支持触屏和手柄。Java 版仍使用模组自己的界面。

## 使用

登录后欢迎面板可直接点“我的车万女仆”或“我的 Agent 同伴”。游玩时选空的快捷栏，靠近自己的女仆，对她按交互键（手机点交互、手柄用交互键），即可再次打开面板。空手点击自己的服务端 Numen 同伴也会打开该同伴面板。手持魂符、命名牌等物品时保留物品原来的交互用途。命令 `/mawagent maid` 和 `/mawagent menu` 保留作备用入口。

女仆面板显示实际生命、饱食、工作、跟随/拾取状态和当前模型。点“模型 / 人格 / 聊天语言”，选择服主已启用的模型服务，再通过下拉列表选模型、输入中文人格。空人格使用女仆模型原有的人设。点“工作 / 跟随 / 拾取”，可选择原生可用工作、开关跟随和自动拾取；工具、材料、原生工作条件仍需要满足，睡觉时不调整工作。工作名称已提供中文；新增第三方工作没有中文映射时显示其原生 ID。

列表只包含 32 格内本人已驯服、存活且已加载的女仆，点击入口还要求在 5 格内。每次保存重新核对实体 UUID、本人所有权、距离、存活和修订值，不生成女仆或强制加载区块。

专用服务器沿用 TLM 的 `GameModeUtil.canEditSite`：权限等级至少 2 的 OP 才能管理全服 LLM 服务。进入“管理全服 LLM 服务 / API Key”，添加或修改 OpenAI 兼容服务：

```text
服务 ID：maw_qwen
完整聊天 URL：https://coding.dashscope.aliyuncs.com/v1/chat/completions
模型 ID：qwen3.7-plus
API Key：在本人表单内填写自己的 Key
```

TLM 要带 `/chat/completions` 的完整地址，和 Numen 的 `/v1` 基址字段不同。多个模型 ID 用英文逗号分隔，最多 24 个；新服务默认关闭，配置完再启用。支持接口 `thinking` 字段开关。已有请求头和保留模型的 reasoning 标记不改动。

已有 Key 从不发回表单，只返回“已配置”；留空保留原 Key。基岩表单没有密码输入控件，新填的 Key 会在自己的输入框显示，请避开直播录屏，不要发到聊天。服务地址沿用现有 HTTPS 主机白名单。保存不会请求模型；之后女仆原生聊天会使用全服服务的 Key。

## 原生接线与权限

`MaidConfigBridge.java` 依附现有 `maw_numen_server` 和受管 Java 进程；基岩表单位于现有 `MawAgents.jar`，沿用仅回环 `/ui` 私有桥。没有新增进程、外部端口或女仆推理循环。

使用实际安装的 TLM 1.5.3 API 和原生 `LLMSite` 编解码器，保存至 `server/config/touhou_little_maid/sites/llm.json`。先序列化、读回校验全部服务、刷盘并原子替换，再更新原生 `AvailableSites.LLM_SITES`。不重写 TTS/STT 文件，Java 客户端重新打开原生设置可读取同一配置。

女仆设置直接修改原生 `MaidAIChat` 的 `LLMSite`、`LLMModel`、`CustomSetting`、`ChatLanguage` 和本人 `OwnerName`，沿用实体存档。保留女仆所有者、外观、工作、历史和 TTS。服务和女仆设置均带修订值，旧表单不能覆盖新修改；每次操作重查在线身份、OP 或本人女仆所有权、距离及存活。普通玩家回执不含 URL、Key、请求头；OP 也不会收到已有 Key。配置不进聊天或公屏。

工作控制调用原生 `TaskManager`、`MaidTaskEnableEvent`、`setTask`、坐姿/家模式和拾取开关，使用独立的工作修订值，不能用旧面板覆盖新工作。工作切换会保留模型、人格和语音设置。这里的工作设置与原生任务 AI 是同一份状态。

`BedrockMenus` 只为已有私有桥认证、实际在线的基岩连接临时绑定界面。Geyser 每秒通过原有回环 `/ui` 拉取本人的 UI 事件，不调用模型；事件只包含本人/目标 UUID 与事件 ID，不进入游戏聊天。普通和精准实体交互均覆盖，750ms 内重复交互合并；事件保留 5 秒并按 ID 确认，重连换会话时旧事件作废。绑定 20 秒没有心跳自动清除，最多 64 个绑定、每人一个待打开事件。HTTP 和世界访问沿用原有有界队列，全部实体操作在服务器线程；没有新增频道、外部端口或常驻服务。Java 连接未绑定时仍走原生女仆容器，不能把这个服务端路径测试称为 Java 页面画面实测。

此入口适配 LLM 配置、女仆人格/模型选择和基础工作控制。STT/TTS 配置、基岩语音播放、聊天气泡、聊天窗口及女仆原生背包/饰品格子界面另行适配；保留语音设置不等于基岩音频已接通。Numen 每人私有模型和 TLM 全服服务是各自原生的不同配置，不自动共享 Key。

超长原生人格超过 4000 字符时拒绝简化表单改写，避免截断，请用 Java 原生编辑器。简化表单暂不提供删除服务、编辑请求头、编辑模型级 reasoning 标记或清空已有 Key；原生 Java 编辑器或本机受管维护仍可使用。

## 验证和维护

构建：`python tools/build_numen_server.py`、`python tools/build_bedrock_agents.py --smoke`。编译钉住原 Numen core/API 0.1.4.1 及 TLM SHA-256 `f6db04195820c8508704277ea76d63723804ff236a7b780369ba59ebe5cd9c27`，第三方 JAR 不改。运行时 TLM 适配器可选，没装 TLM 仍可使用纯服务端 Numen。

隔离测试：`tools/smoke_numen_server.py --full-pack --maid-config --node <node.exe> --output <runtime/research/全新目录>`；去掉两个开关可测无 TLM 的最小环境。`tools/smoke_bedrock_agents.py --output <全新目录>` 实际加载 Geyser 并测 RakNet。Cumulus 冒烟真实编码表单、执行回调，不代替手机画面验收。

健康：`python tools/maw_numen_server.py health` 或 `python world/ops/health/health_mon.py --society-numen-server-smoke`。包含原生适配器、当前构建及源文件、两套受管服务和女仆菜单注册。基岩守护按契约检查菜单实际注册，失败不报 ready。

发布沿用零真人、正常停止两个受管服务、冷备完整世界/配置/原 JAR/基岩资源并逐 CRC/SHA 核验、替换自有 JAR/契约、恢复的流程。基岩 owner 须正常 shutdown 后重建，重新校验文件戳。保留旧 Paper、路由、防火墙、QwenPaw、Agent 人工暂停和未知动作账本。

本次可视入口证据目录：`E:/QiandengJiSocietyLab/research/maid-visual-ui-20261010`，最终发布以该目录 `final-audit.json` 为准；凭据、世界、日志不上传。真实手机、云模型推理、Java 原生页面画面仍需实机验收，付费模型调用 0。

本次已经发布并恢复：隔离全包 57 项、无女仆最小环境 25 项、真实 Cumulus 32 断言、真实 Geyser 加载/RakNet 5 项、正式基岩兼容链和私有菜单 API 8 项（45 区块、4 库存包）、原 Native SDK 8 项、健康 14 项、最终审计 31 项全部通过。原生 Java 开屏包路径和基岩私有事件互斥已由真实交互包验证，尚未通过手机亲自点击或观察 Java 原生页面。

1,163 文件、386,759,323 字节冷备逐 CRC/SHA 校验通过。自有 addon SHA-256 `fcb4d1f3d98b52167d15d0e70d196c96fd5cb4ba8da63465e7ca8de789a9189d`，表单扩展 `ab913d724841db157ddcbbb08ce86462b8f2adc95f27abf75afa86e5792069cf`。五份保护文件、8 份原生/凭据配置、其他 28 个 JAR、原账本前缀及旧未知动作保持；只追加正常停启生命周期。主服务原 owner 恢复，基岩 owner 正常重建，两套服务均健康，维护已结束，不重放本次停启或部署脚本。当前启动日志原生 ERROR 为 0，仅代表本轮采样。

首轮隔离测试拿着新玩家默认魂符，实际执行了物品原来的交互，随后已改为空手夹具。第二轮有两条测试错误地用原版 `open_window` 判断 Java 原生开屏，实际 NeoForge 使用 `neoforge:advanced_open_screen`；已检查实际字节码、修正观测并完整复测。两轮原始失败证据均保留，没有把失败报告覆写成通过。

下面是此前配置适配发布的历史记录，不代表本次新构建的哈希：

此前证据：`E:/QiandengJiSocietyLab/research/maid-bedrock-config-20261010`。隔离全包 41 项、Cumulus 22 断言和真实 Geyser 加载 4 项通过。

正式服已发布：无 TLM 的最小环境 25 项、正式基岩兼容链及私有配置回执 5 项、原 Native SDK 8 项、健康探针 12 项通过。1154 文件、386704291 字节冷备已逐 CRC/SHA 校验；生产女仆三类配置、OP、五份保护文件、其他 28 个 JAR、279 基岩模型/两套模型包及原账本前缀保持。新增 JAR SHA 为 `b26f88a6da7cd413e677ab088603037768841986122a8d3d69b6dcc9d06f7dcb`，表单扩展为 `f737d7e07e36dc99ae75428b68f8edcdcf64028926638e2b540a801b18efecc2`。

13:51:07 启动日志有一条原生 Yggdrasil 获取 `api.minecraftservices.com/publickeys` 的 TLS 握手失败，本轮实际离线登录成功，未改 TLS/认证设置；不声称日志零 ERROR。首次隔离权限拒绝被记成 503/ERROR，已修正为 400 私有回执并重测；最初失败报告保留。初次最终审计的“零 ERROR”断言失败也保留，后续按实际来源分类记录，并不抹除原错误。
