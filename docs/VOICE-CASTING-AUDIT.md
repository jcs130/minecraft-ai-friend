# 手柄语音与咏唱链路审计

审计时间：2026-09-07。本文记录修改前的实际源码、配置与已有验证；**下列改造建议尚未实施**。仅只读检查 D 项目与原 C 素材，不连接、移动或召唤原角色，不开启全服录音。

当前结论：SVC、录音模组、ASR 和 TTS 均已接入，但 **ASR 转写进入公屏聊天分支，尚未作为明确施法语言直接进入玩家命令应用服务**。手柄语音按键尚无默认绑定；“女神，火焰弹”也与当前原生法术名称不一致。这两处会使“按键说出咒语”无法可靠代替键盘命令。

## 1. 可直接使用的路径和数据格式

| 环节 | 本项目实际路径/入口 | 当前设置 |
|---|---|---|
| MC 语音模组 | `server/mc/mods/voicechat-neoforge-1.21.1-2.6.22.jar`、`god-voice-0.1.0.jar` | 均已部署 |
| 录音名单 | `server/mc/data/godvoice/config.json` | `{"listen":["MengMeng"]}`；录音插件启动时读取 |
| ASR 程序 | `world/sidecar/mic_asr_watcher.py` | Compose 挂载到 `/opt/sidecar/mic_asr_watcher.py` |
| ASR 配置 | `compose.yml:240` 的 `asr` 服务 | `MIC_BASE=/godvoice/mic`、`ASR_MODEL_DIR=/model`、`ASR_THREADS=2`、`ASR_MIN_DUR=0.45`、`VOICE_ALLOWED_PLAYERS=MengMeng` |
| ASR 模型 | `server/asr-model/model.int8.onnx`、`tokens.txt` | 本地 Paraformer，16 kHz 特征输入，模型只读挂载 `/model` |
| WAV 输入 | `server/mc/data/godvoice/mic/inbox/<timestamp>.wav` | PCM16、单声道、16 kHz；录音端由 48 kHz 下采样 |
| 身份元数据 | 同目录、同名 `<timestamp>.txt` | JSON，示例见下；扩展名是 `.txt` |
| ASR 输出 | `server/mc/data/godvoice/mic/outbox/<timestamp>.json` | `{player,text,ts,wav}`，原子发布 |
| 已处理音频 | `server/mc/data/godvoice/mic/processed/` | WAV 与元数据归档，失败任务可能回到 inbox 重试 |
| world 输入挂载 | `compose.yml:59,83` | `GODVOICE_DIR=/godvoice`；与 MC、ASR 使用同一个 D 目录 |
| world 消费入口 | `world/src/mc-god.ts:3579` | 每 1.5 秒读 ASR outbox，消费后删除，再注入 `bot.emit('chat', player, text)` |

录音端写出的元数据：

```json
{"player":"MengMeng","ts":1788760000000,"samples":32000}
```

对应 `1788760000000.wav` 与 `1788760000000.txt`；`samples=32000` 在 16 kHz 下是 2 秒。ASR 当前只使用元数据的 `player` 字段做白名单匹配，输出 `ts` 是识别完成时的毫秒时间。

ASR 输出示例：

```json
{"player":"MengMeng","text":"女神，咏唱烟花术","ts":1788760002300,"wav":"1788760000000.wav"}
```

输入 WAV 没有配对元数据时，worker 等待并退回输入目录，不默认冒认 MengMeng；非名单玩家与短于 0.45 秒的片段只归档。相关源码为 `mic_asr_watcher.py:115–166`。测试生成音频时应先准备完整文件和同名元数据，再以原子改名发布 WAV，避免 worker 读到未写完的波形。

**名单保持单玩家。** `godvoice/config.json` 与 ASR `VOICE_ALLOWED_PLAYERS` 是两道独立名单，改一处不会自动同步另一处。仅准许本轮明确的真人或专用 QA，不应改成无条件录全服。

## 2. 录音来自 god-voice，而非 Numen 或 botgate

原实现可读源码：

`C:/Users/lzl19/.copaw/workspaces/default/minecraft-ai-friend/god-voice-src/dev/god/godvoice/`

- `GodVoicePlugin.java:35–64`：监听 SVC 启动、`MicrophonePacketEvent` 和玩家语音状态变化，启动 `MicCapture`。
- `MicCapture.java:109–143`：从 SVC 已连接玩家取得真实名字、按名单过滤、Opus 解码。
- `MicCapture.java:26,160–170`：无音频包超过 1.2 秒后切段；另有 200 ms 检查间隔。
- `MicCapture.java:194–209`：写 PCM16 mono WAV，再写同名 JSON 元数据。

D 服部署 JAR 内 `MicCapture.class`、`GodVoicePlugin.class` 与该 C 源码目录的构建 class **逐字节一致**。当前 `server/mc/logs/latest.log:408–412` 有插件启动及 `Mic capture started, listening: [MengMeng]`。这证明录音端已启动，不代表真人已录到有效声音。

当前录音器只有一个全局 decoder、buffer 和 activeSpeaker（`MicCapture.java:44–48,131–143`）。若同时加入多个白名单玩家，其声音可能混入第一个活跃玩家的片段。多玩家录音需要以后改为按 UUID 独立解码和缓冲；本轮单玩家链路不必因此重写模组。

## 3. 现有转写为什么没有可靠施法

当前实际链路为：

```text
SVC 麦克风包 → god-voice WAV/玩家元数据
→ ASR outbox JSON → mc-god 的 mic 消费器
→ bot.emit('chat', player, text)
→ 真人公屏点名规则 → goddessChat（模型 reply/give）
```

并没有独立的 `voice-command` 消费队列；`chant-requests.jsonl` 是已有 Agent/假玩家咏唱入口，ASR 当前未使用它。

`mc-god.ts:3676–3723` 的真人公屏分支先检查点名或祈愿词；多数普通真人都会在这里结束处理。`goddessChat` 位于 `2487–2557`，只允许模型返回 `reply` 或 `give`，**没有 native cast 动作**。

| 语音转写例子 | 当前多数普通真人的实际去向 | 问题 |
|---|---|---|
| `咏唱：火焰箭` | 没有女神点名/祈愿词，`chat-pass` | 明确咒语也被聊天点名闸拦住 |
| `归乡` / `雷电` | 通常 `chat-pass` | 不是数字传送，也不满足点名闸 |
| `女神，火焰弹` | `goddessChat` | 走模型回答或送物，不走原生施法 |
| `女神，咏唱：烟花术` | `goddessChat` | 先点名并不能自动进入咏唱分流 |
| `二` / `八号哎` | `mc-god.ts:3649–3668` 数字地点路径 | 已在点名闸之前；命中现有序号才传送 |
| `祈愿：……` | 转入原私语祈愿链 | 这是求神裁决，不能等同于玩家自付资源施法 |

确定性原生施法路径本身已存在：`mc-god.ts:1984–1990` 的显式咏唱调用 `castUnified`；其实际实现已提取到 `world/src/application/player-commands.ts:16`。原生适配器 `world/src/irons-spell-client.ts:36–45` 只从该玩家**实际装备的法术**中精确找名字，再提交原生 ID。直接自然咏唱的另一路仍使用 legacy 词匹配，必要时调用模型，不应作为明确短咒的默认路径。

名称也需要窄范围统一：

- `irons_spellbooks:firebolt` 的本地中文是 **火焰箭**，见 `world/src/irons-spell-names.json:12`；当前“火焰弹”不是它的精确名字。
- `irons_spellbooks:lightning_bolt` 为 **落雷**，`:chain_lightning` 为 **连锁闪电**；“雷电”需明确的口语映射或让玩家选择，不能按子串任意挑雷系技能。
- `home` 的现有名字/别名为归乡、回家、回基地、归途、回巢，见 `world/data/magic-atoms.json:4–12`；保留现有等级、消耗与落点规则。
- 旧 `chain_lightning` 已归档，不能因语音关键词命中重新启用。原生法术仍走装备、法力和冷却检查。

mic 消费器本身还有应随接线一起收紧的边界：`mc-god.ts:3593` 会把缺玩家字段回落到 MengMeng；只检查超过两分钟的旧 `ts`，未要求时间字段必填或拒绝未来时间；`seenMic` 仅在进程内，删除后才执行。明确施法入口应验证玩家、当前在线身份、时效与已处理 ID，失败不自动重放，不沿用缺字段冒认。

## 4. 手柄可以复用官方兼容，不需要再写录音桥

已部署的 `client/mods/controlify-3.0.1+lts+1.21.1-neoforge.jar` 包含：

- `dev.isxander.controlify.compatibility.simplevoicechat.SimpleVoiceChatCompat`
- `compatibility.simplevoicechat.mixins.PTTKeyHandlerMixin`
- 原生绑定 ID：`voicechat:ptt_hold`、`voicechat:ptt_toggle`、`voicechat:whisper_hold`、`voicechat:whisper_toggle`。

本机 `javap` 确认 `ptt_hold` 使用持续按下状态，Mixin 把其结果并入 SVC 原有 PTT 判断。官方默认 `default_bind/default.json` 没有给它指定按钮；只有 DualSense 特例给了静音按钮。`client/config/controlify.json` 的 profiles/devices 为空，当前没有实际控制器配置。

本项目现有默认绑定文件为：

`world/client-controls-src/resources/assets/controlify/controllers/default_bind/default.json`

其按钮格式已在十字键上/右使用：

```json
{
  "defaults": {
    "qiandeng_controls:wheel": {"button":"controlify:button/dpad_up"},
    "qiandeng_controls:guide": {"button":"controlify:button/dpad_right"}
  }
}
```

最小配置建议为同文件增加 `voicechat:ptt_hold`。例如选十字键左时，需处理原 `controlify:pick_block` 的冲突：

```json
{
  "defaults": {
    "voicechat:ptt_hold": {"button":"controlify:button/dpad_left"},
    "controlify:pick_block": {"type":"empty"}
  }
}
```

这是建议片段，尚未修改文件。左/右肩键当前切换物品槽，左/右摇杆按下当前冲刺/蹲下，十字键下当前丢弃物品；不能不检查冲突就占用。用户已有绑定应保留，新默认与现有配置分开处理。

键盘目前也没有 PTT：`client/options.txt:174` 为 `key_key.push_to_talk:key.keyboard.unknown`。`client/config/voicechat/voicechat-client.properties` 当前是 PTT 模式、`onboarding_finished=false`、默认麦克风设备、`disabled=false`；`muted=true` 的配置注释注明仅影响 VOICE 激活模式，不能仅据此断言 PTT 被静音。首次应完成设备选择和麦克风测试，再确定键盘备用键。

## 5. 最小接线建议

1. 保留 SVC → god-voice → ASR 的现有部署。将可信 ASR 转写先交给一个纯语言意图解析器，明确动作进入现有 `playerCommands`；只有未命中动作的普通会话才继续现有点名/闲聊链。
2. 解析器只规范化开头称呼、常见口语标点、显式“咏唱/施法”和**完整**技能名/受控别名。例如 `女神，火焰弹` → 配置映射的 firebolt ID；`咏唱归乡` → home。优先识别“不/别/不要施法”、疑问或介绍句，避免“火焰弹是什么”被当成释放。
3. 同一片段最多一个动作；不把未知短咒自动升级为模型裁决、任意 RCON 或技能关键词子串扫描。成功、未装备、魔力不足、冷却、未确认回执都沿用实际服务结果。
4. 返回短字幕并可复用 `speakViaGodVoice` 发简短语音回执。已有 `mc-god.ts:2461–2477` 可把声音绑定到听者实体；不要朗读整个机器 JSON，也不要在只收到 `casting_started` 时声称已命中。
5. 通过官方 `voicechat:ptt_hold` 补一个无冲突的手柄默认操作，保留持续按住/松开语义。不要用目前技能罗盘的 `PressEdge` 代替 PTT 按住状态。

## 6. 已有证据与本轮验收方法

已有可复用内容：

- `reports/voice-inference-20260906T235021002685Z.json`：本机 TTS 合成“这是语音链路测试。”，输出 22,050 Hz 单声道 PCM16、2.067 秒；ASR 识别为“这是语音链路测试”，合成与推理总计 8.27 秒。该临时 WAV **已删除**，不是现成可直接投队列的录音。
- `world/sidecar/god-voice-watcher.py:62` 的 `synth_local` 可复用本地 `http://host.docker.internal:8100/tts` 接口；`mic_asr_watcher.py:36,56,66` 已有 recognizer、WAV 装载和转写函数。未发现独立保留下来的 voice-inference 执行脚本，不应引用不存在的命令。
- `server/asr-model/test_wavs/` 有随模型附带的测试 WAV；它们适合验证解码，不代表千灯咒语识别正确率。
- 原 C `ops/docker/shadow/mc/data/godvoice/mic/processed/` 有 **323 段**历史 WAV。仅做了只读数量核对，未试听、未复制或投递；如后续用于离线识别，应制作独立测试副本，绝不重新消费 C 队列。
- D 的 mic inbox/processing/processed/outbox 本次检查均无 WAV/任务，因此不能声称本项目真人麦克风已验收。
- `reports/client-runtime.json` 与当前 `client/logs/latest.log:802–824` 证明 NeoForge 客户端已通过 `127.0.0.1:24455` 的 SVC UDP 认证和连接检查。`latest.log:753` 是 **No controllers found**，不能以模组加载代替物理手柄验收。
- `tests/test_voice_watchers.py` 的 4 项离线测试只覆盖路径隔离、TTS 地址、任务名和原子 JSON，不覆盖录音到施法。

建议分层验收，分别报告结果：

1. **纯语言/应用端口测试**：称呼+短咒、标点、火焰弹别名、归乡、未知/歧义、否定、疑问、冷却、未装备；明确命令在模型不可用时仍完成，失败不调用模型或重发。归乡先只断言路由，不把 QA 传到旧角色聚集区域。
2. **合成音频→真实 ASR→实际技能**：唯一 QA 身体、共享 smoke 锁、只给本次 QA 必需的装备；生成明确烟花/无伤原生技能音频，实际产出转写和匹配回执，验证一次施放/资源。若临时使用 QA 名单，只改明确该 QA 并最终恢复 MengMeng；不打开全服录音。短噪声、名单外、缺身份和过期片段必须无动作。
3. **SVC 录音段实测**：客户端按住官方 PTT、说出咒语、松开，检查真实 WAV/身份元数据、ASR 文本及技能结果。前两层不能替代这一层。
4. **物理手柄/实际听感**：按住与释放、菜单中行为、冲突键、麦克风权限、远处字幕/回音均需实物验证；当前仍未测。

现有固定等待包括段尾静默 1.2 秒、ASR 最多约 1 秒轮询等待、world 最多约 1.5 秒轮询等待，再加识别/施法/合成。不能根据进程心跳或单次合成记录宣称语音施法已经达到低于 2 秒。
