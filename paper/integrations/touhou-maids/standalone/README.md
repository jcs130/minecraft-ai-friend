# TLM Maid Agents 0.1.1

为车万女仆里的已有女仆配置可切换的模型、音色和访客对白。女仆用自己的身体、背包和工作 AI。凭据、授权和主人对话记忆按实体 UUID 隔离。一台服可登记多位女仆，共用 DSH 或 Qwen Code 网关。

## 安装

1. 服务器使用 Minecraft Java 1.21.1、Java 21、NeoForge 21.1 和车万女仆官方 NeoForge 1.5.3。把 `tlm-maid-agents-0.1.1.jar` 放入服务器 `mods`。服务端实测使用 NeoForge 21.1.252。游戏内界面需要对应的车万女仆客户端。 [官方车万女仆 1.5.3](https://modrinth.com/mod/touhou-little-maid/version/tXG1TkGx)
2. 先在游戏内驯服并命名女仆。以服务器管理员身份读取原实体的 `UUID` 和 `Owner`，填入 `config/tlm-maid-agents.json`。同一主人可登记多位女仆，每个 `maidagent_` 站点别名只分给一个实体。
3. 在 `config/touhou_little_maid/sites/llm.json` 的现有对象中按别名加入启用的 OpenAI 兼容站点。可连接自己的兼容模型、DSH 或 Qwen Code。`examples` 提供多位角色的配置。扩展与千灯纪 `qiandengji_maid_brain` 互斥。
4. 正常重启游戏服后，让主人或服控制台运行 `/maidagent list` 和 `/maidagent brain <uuid> dsh`。使用 `/maidagent status <uuid>` 回读。女仆未加载时，先到实体所在区块。

## 人和 Agent 能怎么用

| 能力 | 入口 |
| --- | --- |
| 私人对话 | 主人在车万女仆原生界面用文字，也可配置 STT 后使用原生麦克风。 |
| 公开对白 | 设置 `visitorPersona` 后，访客在同维度、可见、8 格内用 `/maidagent nearby` 找到女仆，再用 `/maidagent say <uuid> <话>`。每次为一轮短对话，用原生气泡和所配音色回应。 |
| 音色 | 在车万女仆 `sites/tts.json` 配置可用服务，在登记项填 `voice.site/model/language`，用 `/maidagent voice <uuid>` 应用。中文区域格式可用 `zh_cn`。 |
| 跟随、停下、在家工作 | `/maidagent mode <uuid> follow\|stay\|home`。主人的模型对话也可调用原生跟随、坐下和工作工具。 |
| 查工作、切工作 | `/maidagent tasks <uuid>` 返回当前实体可选的原生工作 ID，`/maidagent task <uuid> <id>` 选择。任务结果以原实体的实际行为为准。 |
| 武器与装备 | 主人用原生界面或 `/maidagent status <uuid>` 看真背包和六个槽位。用 `/maidagent equip <uuid> mainhand\|offhand\|head\|chest\|legs\|feet <背包格>`，也可让模型通过 `equip_from_backpack` 使用已观察的物品。一次转移一件，旧装备回来源格。 |
| 模型切换 | `/maidagent brain <uuid> <choice>` 选择已登记的后端。切换后的迟到响应会失去动作权限。 |

主人和服务器控制台有管理权限。游戏内改变状态需靠近自己的女仆。公开对白仅使用角色介绍和本次访客问题。工作工具、主人历史和装备信息在主人链路中可用。每位 NPC 同时处理一笔访客对话，公开入口有 8 秒间隔。

日常工作由原生 AI 执行，模型在有对话时调用。Minecraft 原版客户端和基岩版的投影、Simple Voice Chat 附近转写、千灯纪工单和 RPG 技能由千灯纪现有桥提供。

## 启用 DSH

1. 在已有 HarnessRouter 中确认 DSH 和所选模型可用。为这些 NPC 使用独立的受限凭据和推理环境，游戏管理密钥留在各自服务中。Hub 地址使用本机环回和已配置的 API 前缀。 [HarnessRouter 自托管指南](https://github.com/HarnessRouter/harnessrouter/blob/main/docs/self-hosting-guide.md)
2. 将 `examples/dsh.example.json` 复制成私有 `dsh.json`。填入 Hub 地址及 `keyFile`。密钥文件格式为 `{"key":"…"}`。给每位女仆生成独立传输 token，同时填入 DSH 配置和对应 `sites/llm.json` 站点。UUID、选择名与模型别名需一致。
3. 用 Python 3.11 或更新版本启动。安装包的 `gateway/` 目录已把两个脚本放在一起。从该目录运行以下命令。

```sh
python -m pip install -r requirements.txt
python dsh_gateway.py /path/to/private/dsh.json
```

每个 DSH 站点填写完整地址 `http://127.0.0.1:19105/v1/<maidId>/<choice>/chat/completions`。网关只监听环回并逐实体校验 token。可登记 64 位女仆，默认同时向 Hub 提交至多 4 笔推理。每位女仆有独立的请求锁。超时与格式异常结束当轮，旧请求按原响应 ID 处理。

停用 DSH 前，可让主人选择已配好的其他后端。卸载时正常停服，移出扩展 JAR，清理自己加入的 `maidagent_` 站点，并用车万女仆原生设置选一个可用站点。原实体、背包和对话历史由世界存档保管。

## 启用 Qwen Code

使用已验证的 [Qwen Code 1.0.0-preview.1](https://github.com/QwenLM/qwen-code/releases/tag/v1.0.0-preview.1)。准备独立的用户配置目录，在 `settings.json` 中配置自己的模型。使用兼容网关时，可以在 `providers` 下登记提供方，填入 `type: "openai-compatible"`、`protocol: "openai"`、`baseUrl`、`apiKey` 和 `models: [{"model":"qwen3.8-flash"}]`。先用 `qwen --config-dir <配置目录> --list-models` 核对完整模型名。密钥保存在私有配置中。

1. 复制 `examples/qwen-code.example.json` 和 `examples/tlm-maid-agents.qwen.example.json`，填入原实体和主人 UUID、每位女仆独立的随机传输 token、Qwen Code 可执行文件和配置目录的绝对路径。Windows 选解压后的 `qwen.exe`。`cliModel` 选 Qwen Code 的完整模型名，`model` 用于匹配女仆站点。
2. 给每位 NPC 配独立的站点。站点名用角色配置里的 `site`，`api_type` 设为 `openai`，`enabled` 设为 `true`，`url` 为 `http://127.0.0.1:19105/v1/<maidId>/qwen/chat/completions`，`secret_key` 与该角色的传输 token 一致。`models` 只需包含角色的 `model`。
3. 用 `python dsh_gateway.py /path/to/private/qwen-code.json` 启动网关。要在同一个网关保留 DSH，可以同时填写 `hub` 和 DSH 选择。进入游戏后用 `/maidagent brain <uuid> qwen` 选择。

| 岗位 | 必要装备与场地 | 原生工作 |
| --- | --- | --- |
| 禾穗 · 苗圃管事 | 锄头、种子和可达农田 | `touhou_little_maid:farm` 收割和补种 |
| 绒铃 · 牧场看护 | 剪刀、可达的羊群 | `touhou_little_maid:shears` 剪取羊毛 |
| 灯守 · 驿站守卫 | 剑、可达的敌对生物 | `touhou_little_maid:attack` 近战 |

用 `/maidagent mode <uuid> home` 设置在家工作，按日程选择工作段。已选定的工作由原生 AI 在实体加载时持续运行，也可以在主人离线时执行。闲置和日常工作没有模型轮询。一次模型请求保留最近的对话和原生回执，最多提议一个实际可用的工具。后续对白可依据真实回执，模式选择与工作成果分别核对。Qwen Code 使用独立配置和短会话，角色的对话历史继续由车万女仆保存。

需要较低推理开销时，为 NPC 使用独立的模型路由。千问混合思考模型的隔离验收在该路由显式设置了 `enable_thinking=false` 和短输出预算。部署时用服务商的用量回执核对两个参数是否生效。 [千问兼容 API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)

三位 NPC 的隔离验收使用 Qwen Code 预览版和线上 `qwen3.8-flash`。三次岗位指令和各自的回执回复共调用模型六次。之后两批成熟小麦、待剪的羊和敌对怪物均有现场结果，期间游戏没有在线玩家，模型调用数为零。复测入口为 `tests/qwen-stock-stage.py --help`，需要一份新鲜的官方 NeoForge 隔离安装、独立端口和可用的本机 LiteLLM 模型权限。

## 构建

在官方 NeoForge 21.1 安装器准备的服务端目录和官方车万女仆 JAR 上构建。源码目录下运行以下命令。

```sh
python build.py --server /path/to/neoforge-server --maid /path/to/touhou-little-maid.jar --javac /path/to/javac --output tlm-maid-agents-0.1.1.jar
```

源码的 `dsh_gateway.py` 与父集成目录 `harness/gateway.py` 搭配。安装包已把脚本放在同一目录。 [车万女仆 AI 扩展文档](https://tlmwiki.cfpa.team/wiki/dev/ai/overview/)
