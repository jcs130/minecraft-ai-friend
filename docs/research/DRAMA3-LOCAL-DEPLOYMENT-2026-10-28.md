# Fish Audio Drama 3：单张 RTX 3090 本地试验（2026-10-28）

范围：Windows、RTX 3090 24GB、系统内存 64GB。本文先比较上游，再记录 2026-10-28 在本机的中文实测。上游作者的时延与本机测量在文中分别标明。

检索快照：官方 [fish-speech v3.0.0-beta（10 月 13 日）](https://github.com/fishaudio/fish-speech/releases/tag/v3.0.0-beta)，主分支 [5415669（10 月 14 日）](https://github.com/fishaudio/fish-speech/commit/541566932abbaebcb0a40e562a1f846738383f38)；官方 [模型 b2b5ee9（10 月 17 日）](https://huggingface.co/fishaudio/drama-3/commit/b2b5ee998034b2975720906c815e7fb0e9f007bd)；Pedro 节点 [0.1.0 / 8cb3c64（10 月 25 日）](https://github.com/PedroMarinhoDev/ComfyUI-Drama3/blob/8cb3c64379d4988b9693cae9f3436b8fd54b22ad/pyproject.toml)、[权重 681e2fa（10 月 16 日）](https://huggingface.co/PedroMarinhoDev/Drama-3-ComfyUI/commit/681e2fae64af1f12e64b9c19c82930a5f3bba1a4)；mara [1c1592d（10 月 17 日）](https://github.com/dwain-barnes/mara-drama3/commit/1c1592d3175a8f046725d23b055b4fdb0311ff5a)；CT2 文档 4.8.4。未锁定的主分支及模型文件之后可能变化。

## 结论

**本机首选试验结果是 speech.cpp 0.9.0 + Drama 3 Q4_K GGUF。** 单文件 20.79GB，3090 上通过 Vulkan 常驻运行；已验证两个人物参考音、中文流式输出和 `/v1/audio/speech`。热请求生成 4.13 秒结衣语音用 2.22 秒，首字节 0.27 秒；第二句桐人 2.46 秒语音用 1.38 秒，首字节 0.28 秒。它比本机 ComfyUI W6A8 的 25–35 秒热请求更适合试验直播接口；但独立 ASR 将专名识别为同音或近音词，另有一句明显偏离目标文本，实际发音和音色还需人工试听。下列数据仅代表这台机器、这些短句和参考音。[speech.cpp 服务接口](https://github.com/nyosegawa/speech.cpp/blob/main/docs/server.md)、[模型文件](https://huggingface.co/sakasegawa/drama-3-GGUF)

**资源冲突是上线的主要阻碍。** 现有 `qwen38-27b-lan` 在同一张卡上约用 22GB 显存，speech.cpp 测试峰值 23,646MiB，ComfyUI 克隆峰值 22,644MiB。实测必须临时停 LLM，结束后已启动并验证健康；本次没有改动生产 TTS。现有 3090 不能同时常驻这个 LLM 和 Drama 3，不能把试验成功当作直播链路已可直接替换。ComfyUI `/prompt` 只给排队回执，也没有现成的 TTS 播放回执适配。[ComfyUI 官方 API 示例](https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/basic_api_example.py)

## 本机实测：RTX 3090 24GB

试验安装在 `E:\ai-models\drama3-20261028`，与项目运行目录隔离。两套实现都用项目已有的角色参考音截取片段，未改原文件：桐人 6.4 秒、结衣 2.95 秒，均是日语音频，先核对逐字稿再编码。speech.cpp 官方 v0.9.0 Windows x64 Vulkan 可执行文件和 `sakasegawa/drama-3-GGUF` Q4_K 文件的 SHA-256 均与发布方校验值一致；使用 `--top-k 4097`、固定 seed 123。ComfyUI 为 v0.43.0、Pedro 节点 0.1.0、W6A8 + codec、`--disable-pinned-memory`、专家放 RAM、16GB 专家缓存、固定 seed 12345；API 图使用 `voices.voice0` 连到编码音色。未连接音色的早期样本已排除在克隆结论之外。

| 本机路径 | 生成/音频长度 | 首包/总耗时 | 峰值显存 | 内容核对 |
| --- | --- | --- | --- | --- |
| speech.cpp 首次桐人，流式 PCM | 3.76 秒 | 3.92 / 6.03 秒；服务加载及 warmup 另需 21.17 秒 | 整次试验 23,646MiB | Qwen3-ASR：`大家晚上好，我是同仁，今天继续在这个世界冒险。` |
| speech.cpp 热结衣，流式 PCM | 4.13 秒 | 0.27 / 2.22 秒 | 同上 | `走，我看到前面有怪物。先别急，我来帮你。`，开头 `桐人` 漏/错 |
| speech.cpp 热桐人，流式 PCM | 2.46 秒 | 0.28 / 1.38 秒 | 同上 | 目标 `结衣，跟紧我，我们先去那边看看。`；ASR 为 `你别进我，往县城那边看看。`，明显错词 |
| speech.cpp 双人单请求，预编码 `cast` 音色 | 3.81 秒 | 0.36 / 2.08 秒；本轮热文件缓存下服务另加载 7.61 秒 | 请求后约 22,916MiB | 两行都生成；ASR 为 `绿叶，我们先去那座山上看看。好呀，众人，我会跟着你。`，专名不准；需试听确认两人音色有区分 |
| ComfyUI W6A8 真参考音桐人 | 4.00 秒 | 非流式，总 63.61 秒，含首次模型加载 | 22,644MiB | `大家晚上好，我是董仁，今天继续在这个世界冒险。` |
| ComfyUI W6A8 真参考音结衣 | 4.55 秒 | 非流式，总 34.52 秒，模型缓存命中 | 22,602MiB | `这里哟，我看到前面有怪物。先别急，我来帮你。` |

本机 ComfyUI 无参考音热短句另测得 3.30 秒音频用 24.92 秒。启用默认 pinned memory 时，ComfyUI 进程私有内存超过 52GB、系统可用内存低于 1GB，未完成生成；改用 `--disable-pinned-memory` 后完成。speech.cpp 四段与 ComfyUI 两段均为非静音 44.1kHz 单声道音频，使用独立 Qwen3-ASR-0.6B Q8_0 在 CPU 上转写，故 ASR 错词也可能包含识别误差，需人工试听确认发音和音色。试听文件：`E:\ai-models\drama3-20261028\speechcpp\output\kirito_first_stream.wav`、`yui_first_stream.wav`、`kirito_second_stream.wav`、`kirito_yui_dialogue.wav`；ComfyUI 在 `E:\ai-models\drama3-20261028\ComfyUI\output\drama3_trial\` 下有 `kirito_clone_linked_00001.wav`、`yui_clone_linked_00001.wav`。两种运行时的音色编码文件也都保存到了各自试验目录。

可复核 speech.cpp 服务启动方式（先释放 3090 的现有 LLM 占用；默认仅监听本机）：

    E:\ai-models\drama3-20261028\speechcpp\runtime\speech.exe serve E:\ai-models\drama3-20261028\speechcpp\models\Drama-35B-A3B-v3-Q4_K.gguf --host 127.0.0.1 --port 18120 --device Vulkan0 --threads 12 --top-k 4097 --add-voice kirito=E:\ai-models\drama3-20261028\speechcpp\kirito.voice.gguf --add-voice yui=E:\ai-models\drama3-20261028\speechcpp\yui.voice.gguf

HTTP 请求为 `POST /v1/audio/speech`，JSON 示例 `{"input":"<|speaker:0|> 大家晚上好，我是桐人。","voice":"kirito","response_format":"pcm","seed":123,"top_k":4097}`；返回 44.1kHz 16-bit 单声道 PCM，可边收边播。服务每个模型一次只处理一个请求，桐人和结衣同时说话需上层排队。[speech.cpp 服务文档](https://github.com/nyosegawa/speech.cpp/blob/main/docs/server.md)

双人单请求可先用 `speech voice` 将 `kirito.voice.gguf` 和 `yui.voice.gguf` 分别映射到 speaker 0、1，输出 `cast.voice.gguf`；在服务里以 `--add-voice cast=...` 加载，再发送 `<|speaker:0|> ... <|speaker:1|> ...`。本机已验证这条路径能生成两行内容，但单条音频中声线区分和串音仍待人工复听；这种模式也不能同时处理两个 HTTP 请求。[模型卡多说话人示例](https://huggingface.co/sakasegawa/drama-3-GGUF)

## 方案比较

| 路线 | 单张 3090 / 资源 | 克隆与接口 | 此次判断 |
| --- | --- | --- | --- |
| Fish 官方 fish-speech v3.0.0-beta、原始 fishaudio/drama-3 | 原始仓库约 41.5GB；官方要求 **至少 48GB 显存**，系统为 Linux/WSL；单卡 3090 不满足。 | 有完整参考音克隆、CLI、msgpack POST /v1/tts、保存参考音及流式输出。 | 官方原生服务不作为单张 3090 试验入口。[安装要求](https://github.com/fishaudio/fish-speech/blob/main/docs/en/install.md)、[推理/API](https://github.com/fishaudio/fish-speech/blob/main/docs/en/inference.md)、[原始文件](https://huggingface.co/fishaudio/drama-3/tree/main) |
| Fish 机构发布的 drama-3-int4 + SGLang-Omni | 22.1GB 下载、20.8GB 引擎权重占用；卡片说明是由 AK 制作的**非官方量化**。发布者在 A100 80GB 的指定显存配额下量得启动 57.3GB、五种样本峰值 57.9GB；无实体 24GB 证据。 | 有标准 /v1/audio/speech、参考音克隆和中文样例，但其英文学术测量在 H200 上。 | **文件小于 24GB 不能推出服务器能在 3090 启动。**[模型卡、A100 显存数据](https://huggingface.co/fishaudio/drama-3-int4)、[SGLang-Omni 食谱](https://github.com/sgl-project/sglang-omni/blob/main/docs/cookbook/fishaudio_drama3.md) |
| Pedro ComfyUI-Drama3 0.1.0 | NVIDIA、ComfyUI ≥0.40；W6A8 32.7GB + codec 1.6GB、约 40GB RAM；3090 实测。FP8 38.6GB/约 48GB RAM、INT8 38.7GB/约 48GB RAM；W4A8 24.6GB/约 32GB RAM，但作者报告真实参考音更易静音。 | 参考音 + 精确逐字文本，经 Encode Voice → Generate → Decode；可保存几 KB 的已编码声音。ComfyUI 可导出 API 格式工作流并 POST /prompt；不是 Fish 原生 /v1/tts。 | 本机 W6A8 确认可用，但中文克隆短句 34.52 秒热耗时，不适合当前直播实时播报；作者 9 秒英语克隆句在另一 3090、16GB 缓存下测得 6.2 秒，两台机器和软件环境不能等同。[README](https://github.com/PedroMarinhoDev/ComfyUI-Drama3)、[衍生权重](https://huggingface.co/PedroMarinhoDev/Drama-3-ComfyUI/tree/main) |
| T8mars/Comfyui-Drama-3 | 作者验证的是实体 Windows RTX 5090 Laptop **24GB** / 64GB RAM、12GiB 专家缓存、FP8 权重在系统内存；生成**慢于实时**。没有实体 3090 结果。 | 完整多参考音克隆、修订/填补、17 个 ComfyUI 节点及独立本地 studio；FP8 文件 38.58GB，另需 1.03GB 文本头和 1.57GB codec。 | 说明 24GB 容量可尝试，不能把不同 GPU 与实现的速度外推给 3090；此路线比 Pedro 首试更重。[作者 README](https://github.com/T8mars/Comfyui-Drama-3) |
| dwain-barnes/mara-drama3 + EryriLabs GGUF | Windows Docker Desktop + NVIDIA 24GB；GGUF backbone 20.82GB、mmproj 1.67GB。作者在普通 3090 测得 12 层 CPU 专家时约 16.6GiB 显存；演示还下载 Gemma、ASR 等，总量约 28GB。 | 支持参考音预编码、流式 PCM；现成 Web 服务是单用户语音聊天演示，say.exe 用自有 stdin 协议，不是通用 Fish TTS HTTP 服务。 | 显存更宽松的备选研发路径。作者实测、转写与试听均以英文为主；没有 3090 中文克隆证据；避免把演示页误当生产 API。[项目](https://github.com/dwain-barnes/mara-drama3)、[演示说明](https://github.com/dwain-barnes/mara-drama3/blob/master/demo/README.md)、[设计/测量](https://github.com/dwain-barnes/mara-drama3/blob/master/DESIGN.md)、[GGUF 文件](https://huggingface.co/EryriLabs/drama-3-llamacpp-GGUF/tree/main) |
| nyosegawa/speech.cpp + sakasegawa GGUF | v0.9.0 Windows Vulkan；Q4_K 单文件含模型和 codec，20.79GB。本机实体 RTX 3090 峰值 23,646MiB，三句中文均成功生成。作者 H100 数据不作本机速度依据。 | 支持参考音逐字稿预编码、流式音频、OpenAI 风格 `/v1/audio/speech`、常驻 worker；对现有 TTS 网关的适配最直接。 | 目前最合适的独立试验接口，热请求已低于生成语音时长；ASR 对专名识别不稳，一句普通短句也与目标文本偏离，须人工试听和改进参考音/文本。试验将 top_k 提至 4097；当前发行版默认 30。[项目与接口](https://github.com/nyosegawa/speech.cpp)、[模型和测量](https://huggingface.co/sakasegawa/drama-3-GGUF)、[Drama 3 说明](https://github.com/nyosegawa/speech.cpp/blob/main/docs/models/drama3.md) |
| audio.cpp 社区端口 | 提供 Q2/Q3/Q4 专家包；文档示例 Q2 15.88GiB，Windows CUDA CLI 和 127.0.0.1 上的 POST /v1/audio/speech。作者明确说 16GB/24GB 是在 96GB 卡上测量的配置，**未在物理 3090 验证**。 | 文档支持参考音、文本、流式 HTTP、长文本和历史；中文发音与音色尚无广泛感知评估。 | 功能上最接近将来独立服务，但不优先于有 3090 实测的 ComfyUI 路线。[端口文档和验证边界](https://github.com/0xShug0/audio.cpp/blob/main/docs/models/fish_drama3.md) |
| CTranslate2 4.8.4 | 实验性 CPU 推理，可选 CUDA/ROCm；官方原始权重可本地转换，资源无可靠 3090 总量/时延保证。 | 目前只支持文本合成与波形解码；**不支持参考音编码/克隆**、专用多说话人 API、公共流式输出或长文本自动切分。 | 不满足本项目人物固定声音需求。[官方 Drama 3 指南](https://opennmt.net/CTranslate2/guides/drama3.html) |

证据等级：本机已实测 speech.cpp 和 Pedro W6A8 在**实体 RTX 3090 24GB** 上的中文短句与参考音。Pedro 和 mara 另有作者的实体 3090 测量；T8 在实体 24GB 5090 Laptop 上验证但慢于实时；audio.cpp 的 16/24GB 配置是在 96GB 卡上模拟，尚无实体 24GB 验证；Fish int4 只有较小的权重文件，公开服务测量仍占约 58GB 显存。这些证据不能相互替代。[Pedro](https://github.com/PedroMarinhoDev/ComfyUI-Drama3#performance)、[mara](https://github.com/dwain-barnes/mara-drama3/blob/master/DESIGN.md)、[T8](https://github.com/T8mars/Comfyui-Drama-3#hardware-and-acceleration)、[audio.cpp](https://github.com/0xShug0/audio.cpp/blob/main/docs/models/fish_drama3.md)、[Fish int4](https://huggingface.co/fishaudio/drama-3-int4)

权重不可混用：ComfyUI 的单文件权重、mara 的两份 GGUF、audio.cpp 的 GGUF、官方原始分片各有自己的加载器；下载时指定确切文件，避免把 Pedro 仓库全部 136GB 下载到本机。[Pedro 文件树](https://huggingface.co/PedroMarinhoDev/Drama-3-ComfyUI/tree/main)、[原始文件树](https://huggingface.co/fishaudio/drama-3/tree/main)

## ComfyUI W6A8 复核步骤

使用既有或新建的 ComfyUI ≥0.40，以下路径按实际安装目录替换。只需 W6A8 和 codec；手填参考音逐字稿时不需要额外下载 Qwen3-ASR。先保证试验 GPU 与约 40GB 可用内存，并把这次试验与既有 8100 TTS 隔离。[Pedro 安装/工作流](https://github.com/PedroMarinhoDev/ComfyUI-Drama3#quick-start)

    cd E:\ComfyUI\custom_nodes
    git clone https://github.com/PedroMarinhoDev/ComfyUI-Drama3.git
    python -m pip install -U "huggingface_hub[cli]"
    hf download PedroMarinhoDev/Drama-3-ComfyUI drama3_w6a8experts_bf16.safetensors --local-dir E:\ComfyUI\models\diffusion_models
    hf download PedroMarinhoDev/Drama-3-ComfyUI drama3_codec.safetensors --local-dir E:\ComfyUI\models\vae

重启 ComfyUI，载入 [作者的克隆工作流](https://github.com/PedroMarinhoDev/ComfyUI-Drama3/blob/main/example_workflows/drama3_voice_clone.json)。把 Load Drama 3 改选 W6A8；Load Audio 选有使用权、干净的几秒中文录音，截在句子边界；断开 Qwen3-ASR → Encode Voice 的连线，在 Encode Voice 手填**与录音完全一致**的中文逐字稿。Generate 输入可用“<|speaker:0|> 小灯，今天的风有点凉，记得把门关上。”；首次保持节点温度 1.0、top_p 0.9、top_k 0、专家放 RAM，设置固定 seed，生成并试听 Save Audio 文件。作者指出参考音转录遗漏尾字是静音常见原因；结果须检查是否漏词、静音、中文发音、音色及实际时延。[节点说明](https://github.com/PedroMarinhoDev/ComfyUI-Drama3#quick-start)、[采样说明](https://github.com/PedroMarinhoDev/ComfyUI-Drama3#settings)

如需从本机脚本排队，先在 UI 中完成上述输入，然后通过 **File → Export (API)** 保存 API 格式 JSON；作者的 example_workflows JSON 是 UI 工作流，不能直接作为 /prompt 的 prompt 字段。下例复用已配置的参考音与逐字稿，只改短句；返回 prompt_id 是排队成功，不是已合成或已播放。[ComfyUI 官方 API 示例](https://github.com/Comfy-Org/ComfyUI/blob/master/script_examples/basic_api_example.py)

    $wf = Get-Content -LiteralPath '.\drama3-api.json' -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
    $nodes = @($wf.Values | Where-Object { $_.class_type -eq 'Drama3Generate' })
    if ($nodes.Count -ne 1) { throw 'Expected one Drama3Generate node' }
    $nodes[0].inputs.text = '<|speaker:0|> 小灯，今天的风有点凉，记得把门关上。'
    $json = @{ prompt = $wf } | ConvertTo-Json -Depth 100
    Invoke-RestMethod -Uri 'http://127.0.0.1:8188/prompt' -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json))

需要先单独量本机中文语音样本的初始化、首段声音、完整音频时间、VRAM/RAM 峰值、漏词/静音和人物音色相似度；作者 3090 表是约 9 秒**英语**克隆语句及特定机器设置，不能推出本机中文实时对话。[作者测量条件](https://github.com/PedroMarinhoDev/ComfyUI-Drama3#performance)

## 中文、服务与许可边界

Fish 官方模型卡称覆盖 83 种语言、支持参考音克隆和最多 16 个说话人。官方技术报告在 MiniMax 24 语言克隆测试中的中文 CER 为 0.63%，但其评估会对静音、过短、过长或噪声异常输出重新生成；这个数字属于**原模型官方评估**，不是任何 3090 量化运行时的中文测量。到本次检索为止，上述 3090 运行时未提供可引用的中文克隆精度或人物音色测试。[模型卡](https://huggingface.co/fishaudio/drama-3)、[官方技术报告，第 5 节与表 6](https://github.com/fishaudio/fish-speech/blob/main/docs/assets/Fish_Audio_Drama_3_Technical_Report.pdf)

官方云端 Fish API 是另一服务选项，支持将 model 请求头设为 drama-3 后调用 POST https://api.fish.audio/v1/tts；它不是本地推理。官方本地 fish-speech server 用同名 /v1/tts 但请求体为 msgpack，并要求 48GB 显存；不能以替换 URL 的方式视为接口兼容。ComfyUI 走 /prompt，audio.cpp 走 /v1/audio/speech，mara 演示走自己的聊天页面/进程协议，集成工作量不同。[Fish 云 API 示例](https://beta.fish.audio/drama-3/)、[Fish 本地 API](https://github.com/fishaudio/fish-speech/blob/main/docs/en/inference.md)、[audio.cpp 服务](https://github.com/0xShug0/audio.cpp/blob/main/docs/models/fish_drama3.md)、[mara 演示](https://github.com/dwain-barnes/mara-drama3/blob/master/demo/README.md)

Drama 3 原始仓库页面的元数据仍显示 fish-audio-research-license，但**实际 LICENSE 文件与模型卡正文写的是 Fish Audio Community License 1.0（2026-10-13）**；部署前应以随权重提供的实际协议核对。该协议允许研究/非商用，年总收入低于 50 万美元的有限商用；第三方自助 TTS/克隆托管服务须另签协议，但游戏角色或产品自身生成台词的语音交付被明确排除于“Hosted Service”定义。分发/使用模型的产品须显著标注 “Built with Fish Audio”；克隆可识别真人声音须有本人同意或其他合法权利；不得用模型或输出训练其他生成式语音模型。具体用途仍要逐条核对协议全文。[实际 LICENSE](https://huggingface.co/fishaudio/drama-3/blob/main/LICENSE)、[模型卡及元数据](https://huggingface.co/fishaudio/drama-3)

运行时代码另有各自协议：Pedro 与 T8 节点为 GPL-3.0，mara 为 MIT，audio.cpp 为 Apache-2.0；这些代码协议不替代上述模型/衍生权重协议。[Pedro LICENSE](https://github.com/PedroMarinhoDev/ComfyUI-Drama3/blob/main/LICENSE)、[T8 LICENSE](https://github.com/T8mars/Comfyui-Drama-3/blob/main/LICENSE)、[mara LICENSE](https://github.com/dwain-barnes/mara-drama3/blob/master/LICENSE)、[audio.cpp LICENSE](https://github.com/0xShug0/audio.cpp/blob/main/LICENSE)
