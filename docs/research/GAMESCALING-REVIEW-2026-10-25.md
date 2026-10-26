# GameScaling 用于千灯纪的评估与隔离试验（2026-10-25）

## 结论

GameScaling **能在本机加载并从 Minecraft 画面生成可解析键鼠动作**，但当前不能直接接管桐人的持续运动。0.8B-S1 在 RTX 3090 上的官方 vLLM 服务对模拟新帧、512×288 输入测得中位 173 毫秒、p95 187 毫秒；这尚未包含截图与身体执行。桐人保存的两张现有渲染画面却频繁产生空动作或不合目标的动作。2B-S1 在相同 512×288 试验中为 332/335 毫秒，也未改善前进判断。故推荐保留现有 QwenPaw/Numen 快慢架构，只把 0.8B-S1 作为后续改进画面与原生控制接口后的受监控候选；还不能称已通过实服闭环。它也不能替代 QwenPaw 的长期目标、工具、记忆、直播解说与社交层。公开客户端与检查点足以试推理，官方没有提供本项目 Numen 假玩家适配器，论文没有验证千灯纪模组服连续直播。[官方模型卡](https://huggingface.co/THUSI-Lab/GameScaling#overview) · [论文](https://arxiv.org/pdf/2610.28698) · [本项目截图代码](../../world/survival/frame_view.py)

## 模型实际做什么

- 基础是 Qwen3.5 视觉语言模型，经游戏轨迹继续预训练。每次输入一张当前游戏帧，并默认携带过去五个“帧 + 动作”回合；输出未来 200 毫秒的动作包：6 组各约 33 毫秒的按键保持状态，加整包鼠标位移与滚轮。它可以输出简短思考，也可以直接行动。[模型卡：Overview / Reasoning modes](https://huggingface.co/THUSI-Lab/GameScaling#overview) · [推理客户端](https://github.com/THUSI-Lab/GameScaling/blob/main/gamescaling/policy.py)
- 输出格式为动作标签内的 X、Y、Z 与 6 组键；按键词表区分字母、数字行、鼠标按钮等。官方解析失败时执行空动作，历史中记录规范空动作。鼠标 X/Y 使用画面宽高的千分比；同一键跨连续分组时持续按住。[动作协议](https://github.com/THUSI-Lab/GameScaling/blob/main/gamescaling/action.py) · [模型卡：Action format](https://huggingface.co/THUSI-Lab/GameScaling#5-action-format)
- 标准系统提示词只填游戏名称、规则/目标和键位表三个位置，格式段须沿用；没有现成 Minecraft 专用提示词或千灯纪任务规划器。官方推理仓库提供 Doom 示例、通用客户端与离线解析测试，未提供训练代码或游戏端适配器。[提示词模板](https://github.com/THUSI-Lab/GameScaling/blob/main/prompts/system_prompt_template.txt) · [模型卡：File tree / System prompt](https://huggingface.co/THUSI-Lab/GameScaling#file-tree)

## 公开检查点与运行要求

| 检查点 | bf16 权重体积 | 官方建议 GPU 数 | 对 Minecraft 的相关性 |
| --- | ---: | ---: | --- |
| 0.8B-S1 / S3 | 2.2 GB | 1 | S1 的游戏训练部分全部来自 Minecraft；S3 约 27% |
| 2B-S1 / S3 | 5.4 GB | 1 | 同上 |
| 9B-S1 / S3 | 18.8 GB | 1 | 同上 |
| 27B-S1 / S3 | 54.7 GB | 2，张量并行 | 同上 |

八个公开检查点均使用 1,600 小时游戏预算；THUSI-Lab/GameScaling 主仓库存放客户端和索引，本身没有权重。表中数字是权重文件大小，不是运行时显存上限；图像上下文、KV 缓存和 vLLM 也占显存。[模型卡：Checkpoints / File tree](https://huggingface.co/THUSI-Lab/GameScaling#checkpoints)

官方路径是 vLLM 0.17.0 已测试、推荐 0.17 及以上；启动脚本使用 bf16、32,768 token 上下文、每请求最多 8 图、默认 0.85 显存利用率，并将服务模型名设为 gamescaling。Python 客户端依赖 requests 与 Pillow。接入时须沿用检查点自己的 chat_template.jinja、assistant 预填和官方客户端的 `skip_special_tokens=false` 设置；历史消息结构也须保持。默认可选择“模型自行决定是否思考”或“预填空思考，直接出动作”。[模型卡：Download and serve](https://huggingface.co/THUSI-Lab/GameScaling#1-download-and-serve) · [服务脚本](https://github.com/THUSI-Lab/GameScaling/blob/main/scripts/serve_vllm.sh) · [客户端请求构造](https://github.com/THUSI-Lab/GameScaling/blob/main/gamescaling/policy.py)

## 论文证据及边界

- Minecraft 结果来自 MCU 的 30 个任务，覆盖导航、生存、战斗、制作和 GUI。标准协议上限为每条轨迹 600 个动作步。在时间暂停设置下，S1 的 0.8B、2B、9B、27B 平均任务成功率分别为 44.0%、49.3%、54.7%、63.3%；0.8B-S1 的 GUI 子类仅 8.0%。该 benchmark 不能直接代表开放世界、模组服和直播场景。[论文表 1](https://arxiv.org/pdf/2610.28698) · [论文附录 B.1](https://arxiv.org/pdf/2610.28698)
- 实时表格使用的是 S3 检查点：MCU 上 0.8B、2B、9B、27B 分别为 37.3%、44.0%、36.7%、16.7%。较大模型在实时设置中未必更好；延迟是关键变量。论文中的实时 0.8B/2B 用一张 H200，9B/27B 用四张 H200；它没有给出本地家庭 GPU 上的延迟保证。[论文表 2、附录 B.4](https://arxiv.org/pdf/2610.28698)
- 作者报告模型动作步约 0.13–0.69 秒；小模型在所用 H200 配置中可接近或低于 200 毫秒。论文明确说，当推理明显超过 200 毫秒时，无论等待期间停住还是续播旧包，成绩都明显变差；所以这套短包策略仍须配合可靠的异步电机、时序与降级策略。[论文附录 B.4 / C.5](https://arxiv.org/pdf/2610.28698)
- S1 追求 Minecraft 内能力，S3 偏向跨游戏迁移；跨游戏继续预训练对远离训练分布的世界效果有限。将 MCU 上的成功率推广到千灯纪的特殊模组方块、战斗、GUI 和多人互动，仍需要本地验证。[论文第 4–6 节](https://arxiv.org/pdf/2610.28698)

## 与现有桐人栈的接口差距

当前项目的 FrameView 从世界服务取得已绑定桐人的 Prismarine 第一人称 640×360、120° FOV 截图，带可选 HUD，并允许采样图像在 5 秒内；GameScaling 的闭环实验按每 200 毫秒观察一次、每 33 毫秒执行一组键。当前截图路径是单次工具读取，不能仅凭“有图”断言已经具备 5 Hz 持续帧流。现有电机通过 Numen gateway 发送具名动作/程序；它需要一个从键鼠包到假玩家移动、视角、点击、热键的转换层，并且要验证服务器 tick 与 33 毫秒子步的关系。这是从两边代码接口得出的待验证项。[本项目 FrameView](../../world/survival/frame_view.py) · [本项目 motor_loop](../../world/survival/motor_loop.py) · [GameScaling 动作协议](https://github.com/THUSI-Lab/GameScaling/blob/main/gamescaling/action.py) · [论文第 3.1 节](https://arxiv.org/pdf/2610.28698)

建议先隔离试验 0.8B-S1 的离线画面→动作解析与延迟；若有效再试 2B-S1。评价至少记录真实帧刷新率、端到端推理延迟 p50/p95、动作解析率、实际位移/视角变化、遭遇威胁后的反应、30 分钟持续活动与目标进度。先让原慢层给出目标，让 GameScaling 仅承担受限定的视觉动作修正，且保留 Numen 原有身体控制作为回退；这是一项工程试验方案，不是已部署结论。[模型卡：Running it in a game / Tests](https://huggingface.co/THUSI-Lab/GameScaling#6-running-it-in-a-game) · [论文实时评测配置](https://arxiv.org/pdf/2610.28698)

## 许可与可复现性

作者将项目定位为科研；公开的模型权重与推理代码标注 Apache-2.0，基座 Qwen3.5 也标为 Apache-2.0。训练游戏语料不公开，推理客户端和权重公开；因此可以试推理和接入，但无法仅凭公开材料复训论文的完整 120 组实验。[项目页 License](https://gamescaling.github.io/#license) · [模型卡 License](https://huggingface.co/THUSI-Lab/GameScaling#license)

## 本机隔离试验（2026-10-25）

用户同意暂停正在运行的 Neko 后，通过其原生 `standalone.py stop` 发出一次停止请求，读取到 `delivery=delivered`、`stop_requested=true`；外部游戏身体进程退出。Neko 的 `minecraft_autonomous` 插件停止接口返回 `success=true`，后续状态读回 `stopped`。原 Neko 唯一连到 18046 的客户端消失后，按进程命令行、监听端口核对并停止对应的 Occamy `llama-server`，3090 显存空余由约 1.5 GiB 恢复到约 23 GiB。未改 Neko 配置、千灯纪生产代码或 Minecraft 存档。Neko 桌面 UI 和主程序仍可打开，但本次确认其自主生存插件和外部身体已停止。

从 [官方 GitHub 仓库](https://github.com/THUSI-Lab/GameScaling) `6764efab` 下载推理客户端，从 [0.8B-S1 检查点](https://huggingface.co/THUSI-Lab/GameScaling-0.8B-S1) `511d00b3` 下载 2,214,590,296 字节权重；文件与实验脚本都留在 Git 忽略的 `runtime/gamescaling-trial/`。`PYTHONUTF8=1 python tests/test_core.py` 的 14 项离线测试通过，官方 Doom 示例的参考动作正常解析。Windows 默认 GBK 下原测试读取 UTF-8 示例文件会抛 `UnicodeDecodeError`，这是测试脚本环境问题，不表示模型故障。

用隔离的 Transformers 5.17 / PyTorch 2.11.0 对真实保存的画面做单帧推理，沿用检查点聊天模板与官方空思考预填，贪心解码并解析动作：

| 输入画面 | 设备 | 输出 | 推理时间 |
| --- | --- | --- | ---: |
| `runtime/livestream-continuity-20260925/kirito-frame-probe.png`，640×360，近墙 | i9-13900K CPU | 六段全空，无位移 | 9.26 秒 |
| 同上 | RTX 3090，bf16 | 六段全空；五次独立同图调用热身后仍全空 | 单次约 2.93 秒；后续 2.62–2.74 秒 |
| `runtime/kirito-frame.png`，640×360，抬头看室外 | RTX 3090，bf16 | 六段全空 | 3.00 秒 |
| Neko 保存的煤矿石准星画面，1280×720 | RTX 3090，bf16 | `LB` 按住六段，动作可解析 | 3.00 秒 |
| 桐人近墙画面加五个**人为复制**的历史帧/空动作 | RTX 3090，bf16 | 六段全空 | 热身后 2.55 秒 |

上述 GPU 测试使用 Transformers 的 `causal_conv1d` / `flash-linear-attention` 参考回退内核，因而不能当作官方 vLLM 的延迟；单图 GPU 峰值 PyTorch 分配约 1,822 MiB，六图约 2,245 MiB，亦不等于完整服务的显存。旧截图不是当前实服帧，重复历史并非真实运动轨迹。煤矿石的挖掘动作只证明权重能从画面与目标产生非空指令，**没有执行到游戏，也没有验证破坏方块或闭环生存**。这些输出与本机条件下的时间数据来自本次命令实测，而论文成绩来自其独立测试设备。

检查点 `tokenizer.encode('<|action_start|>')` 和 `tokenizer.encode('<|action_end|>')` 各得 6 个普通 token，`convert_tokens_to_ids('<|action_end|>')` 返回空值；这与官方文档将动作标签称为特殊 token 的表述不一致。试验通过字符串停止并保留完整解码文本，实际动作解析成功。正式接入仍应沿用官方客户端的请求字段，并在服务端核对标签是否完整。[动作协议](https://github.com/THUSI-Lab/GameScaling/blob/main/gamescaling/action.py) · [客户端](https://github.com/THUSI-Lab/GameScaling/blob/main/gamescaling/policy.py)

### 官方 vLLM 路径：0.8B-S1

Neko 停止后，以 `vllm/vllm-openai:v0.17.0`、RTX 3090、模型本地挂载、bf16、32k 上下文、8 图上限和 0.85 显存利用率启动官方兼容服务。容器模型列表返回 `gamescaling`，官方 `GameScalingPolicy` 能通过 `/v1/chat/completions` 调用。服务启动占用显存约 22.4 GiB，主要因预留 KV/运行空间；这不是 0.8B 权重本身大小。首个新请求曾有 42 秒的编译/暖机尖峰；随后的同图轮次为 141–196 毫秒，第五轮也曾有约 10 秒的形状编译尖峰，热身后重复未复现。WSL 日志提示 `pin_memory=False` 可能拖慢性能。[官方服务脚本](https://github.com/THUSI-Lab/GameScaling/blob/main/scripts/serve_vllm.sh)

| 640×360 煤矿画面试验 | 轮次 | 动作解析 | 中位 / p95 | 峰值 | 边界 |
| --- | ---: | ---: | ---: | ---: | --- |
| 同一 JPEG 重复，默认五回合历史滚动 | 30 | 30/30 | 190 / 191 ms | 228 ms | 多模态缓存 212/213 命中，过于理想 |
| 同源画面每轮换 JPEG 压缩质量，逼出新的图像处理 | 20 | 20/20 | 204 / 209 ms | 404 ms（首轮） | 19 次新增缓存未命中；没有真实场景变化 |
| 同上，送入 512×288 | 20 | 20/20 | 173 / 187 ms | 464 ms（首轮） | 全部为非空挖掘动作；较低分辨率的场景泛化未验 |

缓存指标来自 `/metrics`：第一组几乎全是同图命中；两组“新帧”分别使图像缓存查询增加 105、命中增加 86，即各约 19 次新图处理。缩放/压缩是官方客户端支持的输入预处理，原始截图未被修改。所有延迟均为本机 Python 客户端发起 HTTP 至收到完整动作的耗时；没有包含游戏帧采集、控制转换、服务器 tick 和世界结果，不能将 173 毫秒直接称为实服 5 Hz 闭环。

对实际保存的两张桐人画面做额外质量检查：近墙图即使提示“按 S 后退”，三轮仍全空；室外抬头图提示“按 W 前进”，十次重置的独立首帧在 512 输出上限下只有 3 次含 W、5 次空动作、2 次格式未解析。作为对照，带原版热键栏与手持工具的煤矿画面十次独立首帧全部解析并含 `LB`。两组都使用每次重置历史、不同 JPEG 压缩以避免图像缓存。这是**同一目标及画面的重复采样**，不是正式准确率、任务成功率或 Neko 与桐人可互换的证明；但足以提示现有 Prismarine 120° FOV、仅简易 HUD 的桐人截图与训练画面可能失配。还需排查渲染视角、原版 HUD、画面清晰度和安全动作回执，而不是仅因 0.8B 挖煤有效就替换现有身体控制。[桐人截图实现](../../world/survival/frame_view.py) · [模型客户端](https://github.com/THUSI-Lab/GameScaling/blob/main/gamescaling/policy.py)

### 官方 vLLM 路径：2B-S1 对照

同机下载 [2B-S1 检查点](https://huggingface.co/THUSI-Lab/GameScaling-2B-S1) `cd9a88d1`（权重 5,443,677,680 字节），沿用 vLLM 0.17.0、bf16、32k 上下文、8 图上限和官方客户端。首次请求有约 42 秒暖机/编译尖峰。每次清空历史的桐人室外旧截图、明确要求 W 前进，十次均能解析，但 **0/10 含 W，2/10 含 `LB`，其余为空动作**；煤矿画面 10/10 可解析并含 `LB`，热身后单次约 283–323 毫秒。512×288、逐轮不同 JPEG 编码、历史最多五帧的 20 轮测试为 20/20 解析、20/20 非空挖掘，中位 332 毫秒、p95 335 毫秒、首轮最大 594 毫秒。2B 在这些样本上更慢，未解决桐人现有画面的行为失配。以上是本机受控试验，不代表所有地图、任务或自然截图的成功率。

试验后两个 vLLM 容器均正常停止并移除，端口 8000 已释放；Neko 的自主生存插件继续保持 `stopped`、外部身体进程不在、Occamy 18046 服务不在。保留本机 Git 忽略目录中的下载权重和试验脚本供复测；未改游戏世界、桐人生产控制器或 Neko 配置。
