---
name: agent-speak
description: 让 Agent 在游戏世界里说话——语音经 SVC 语音聊天模组从角色头顶播出（近大远小，和真人玩家一样），同时头顶显示文字泡泡。适用于桐人、鸣人、结衣、女神化身、任何 numen 假玩家身体。触发词：说话、speak、开口、语音、聊天、发言、让Agent说话。
---

# Agent 说话（Speak with Voice + Text Bubble）

让 Agent 在 Minecraft 世界里真正开口说话：
- **语音**：经 SVC（Simple Voice Chat）从角色头部位置播出，**有距离衰减**（近大远小 ✓ 和真人一样 ✓ 16 格内可听）
- **文字泡泡**：头顶浮现 `text_display` 实体显示说话内容，说完自动消失

## 前提

- 服务器装了 `voicechat-neoforge-1.21.1-2.6.22.jar` + `god-voice-0.1.0.jar` ✓ 已部署
- voice 容器 + tts 容器在跑 ✓
- 真人玩家需要**客户端装 SVC mod** 才能听到语音（文字泡泡不需要）

## 用法

### 方法一：桐人（survivor）已内置 speak 工具

```
speak(turn_id, "要说的话")         → 排队说话（异步 ✓ 不占身体）
speech_status(turn_id)             → 查播放回执
```

### 方法二：其他 Agent / 直接调用（写 speech-request 文件）

```python
# 写到 /godvoice/speech-requests/<speech-id>.json
{
  "schema": 2,
  "id": "speech-<sha256-of-actor+key>",
  "entity": "<实体UUID>",           # 如 Kirito 的 d4ac9523-4962-43ed-98c5-19b49e104048
  "actor": "<实体名>",              # 如 "Kirito"
  "text": "要说的话（1-160字）",
  "voiceId": "kirito",             # 嗓音角色名
  "voiceVersion": 1,
  "generation": 1,
  "dimension": "minecraft:overworld",
  "createdAt": <毫秒时间戳>,
  "expiresAt": <毫秒时间戳+60秒>
}
```

voice 容器自动拾取 → TTS 合成 → SVC 播放（近大远小 ✓）。

### 方法三：文字泡泡（text_display 实体）

```python
# RCON 召唤 text_display 在实体头顶
# 先获取实体位置 (x, y, z)，然后：
summon minecraft:text_display <x> <y+2.5> <z> {
  text: '["<说话内容>"]',
  billboard: "center",
  background: 0.3
}
# 说话完毕后清除：
kill @e[type=text_display,distance=..5]
```

**注意**：RCON 命令里坐标为负数时需要用 `--` 分隔符：
```
rcon-cli -- summon minecraft:text_display -153 66 871 {...}
```

## 一键说话（语音 + 文字泡泡同时）

用 `tools/agent_speak.py`（B 仓 `world/tools/`）：

```bash
python agent_speak.py --entity Kirito --text "你好世界" --voice kirito
```

它会：
1. 查实体当前坐标（RCON `data get entity`）
2. 写 speech-request 到 voice 容器（触发 TTS + SVC 语音）
3. 在实体头顶召唤 text_display（文字泡泡）
4. 等语音时长后自动清除 text_display

## 嗓音表

| voiceId | 嗓音 | 适用 |
|---|---|---|
| goddess | zh-CN-XiaoxiaoNeural / IndexTTS 克隆 | 女神、旁白 |
| kirito | zh-CN-YunjianNeural / 云健 | 桐人 |
| naruto | zh-CN-YunxiNeural / 云希 | 鸣人 |
| villager | zh-CN-XiaoyiNeural / 晓伊 | 村民、儿童向 |

（本地 TTS 优先走 IndexTTS 克隆嗓 ✓ 失败回退 edge-tts ✓ 需设 `VOICE_ALLOW_EDGE_FALLBACK=1`）

## 验证

- **语音**：装了 SVC mod 的客户端在 16 格内能听到 ✓ 距离越远声音越小 ✓
- **文字**：所有客户端（不需装 SVC）能看到头顶文字泡泡 ✓
- **回执**：查 `speech-receipts/<id>.json` 的 `status` 字段（`completed` = 播完 ✓）
- **voice 容器日志**：`docker logs qiandengji-voice-1 | tail` 看 `tts queued` 行

## 常见问题

- **说话没声音**：①客户端没装 SVC mod ②距离超 16 格 ③voice 容器挂了（`docker ps | grep voice`）
- **text_display 不出现**：①RCON 命令负坐标没加 `--` ②NBT 格式错误
- **文字太短看不清**：调大 scale（`scale:[2f,2f,2f]` → `[3f,3f,3f]`）
- **TTS 合成失败**：查 tts 容器日志 ✓ edge-tts 回退是否开了

## 技术架构

```
Agent (speak 工具)
  ├── 语音 → speech-requests/<id>.json
  │          → voice 容器 (SpeechWorker)
  │          → TTS 合成 mp3 → tts-queue/
  │          → god-voice mod (TtsQueueWatcher.java)
  │          → SVC EntityAudioChannel → 头顶播放（近大远小 ✓ 原生 SVC）
  │
  └── 文字 → RCON summon text_display <x> <y+2.5> <z>
             → 头顶浮现文字（billboard:center ✓ 背景半透明）
             → 定时 kill（或 duration 到期自动消失）
```

## 安全边界

- **语音长度**：单次最多 160 字 ✓ 最长 120 秒音频
- **互斥**：同一实体同一时间只播一条（新语音自动打断旧的 ✓ `interrupt=True`）
- **不重放**：`speech_status` 返回终态（completed/expired/failed）后不重试 ✓
- **权限**：speech-request 写在 `/godvoice/`（容器挂载 ✓ Agent 通过 MCP 工具写 ✓ 不直接 RCON）
