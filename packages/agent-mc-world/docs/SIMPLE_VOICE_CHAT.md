# 原生 Simple Voice Chat 客户端（`mc_svc`）

这是 **原生 Simple Voice Chat（SVC）** 客户端，不是 `mc_voice` / `mcagent:voice`。

- `mc_voice`：走自定义插件通道 `mcagent:voice`，把 WAV 交给服务端编码播放（例如千灯纪附近语音）。服务端没有该通道时无法工作。
- `mc_svc`：在已认证的 Mineflayer 连接上完成 `voicechat:request_secret` / `voicechat:secret`（及 `vc:` 短名）握手，再对官方兼容的 UDP 口发送 AES-128-GCM 加密的 Opus 麦克风帧。`sent` 只表示本机已写出 UDP 帧，`recipientHeard` 恒为 `unknown`，不得当成听见。

默认关闭：`simpleVoiceChat.enabled=false`。打开前必须提供官方 SVC jar（Concentus 编解码），不要把宿主 TTS 密钥用于验证。不要向真实玩家发声，除非运营明确授权。

本包没有发布新版本；接入方需要自行用当前源码构建客户端包。这不是官方 Mojang 功能，也未声明 upstream official support。

## 复用的已有实现（不要当成第二套协议）

客户端握手、UDP 报文头、包 ID、兼容版本 20、AES-128-GCM、空 Opus 结束 PTT，对齐 jcs130 已在真实 SVC Bukkit 2.6.27 + Velocity + Paper 上验证过的测试客户端，以及官方 2.6.22 的 `SecretPacket` / `NetworkMessage` / `OpusManager`：

- https://github.com/jcs130/minecraft-ai-friend/blob/0cf764f29e0b01275e30580a5c4bbdbdd31acb7b/paper/integrations/login-guard/tests/protocol/live_svc.mjs
- https://github.com/jcs130/minecraft-ai-friend/blob/a00544410333b4fcf202e7c9fd8c6a90430187df/paper/integrations/touhou-maids/tests/svc-receiver.mjs
- 官方协议说明：https://modrepo.de/minecraft/voicechat/wiki/troubleshooting 、https://modrepo.de/minecraft/voicechat/wiki/server_config 、https://modrepo.de/minecraft/voicechat/wiki/proxy_setup 、https://modrepo.de/minecraft/voicechat/wiki/client_setup

接收路径按官方 `NetworkMessage.readPacketServer`：magic `0xFF`、16 字节 UUID，再 varint 长度 + `iv[12]+ciphertext+tag[16]`。部分 QA 脚本在 magic 后立刻 `readv(..., 1)`，那会把 UUID 当成长度，不能当作官方布局。

Opus：48 kHz、单声道、960 样本（20 ms）、`OPUS_APPLICATION_VOIP`、带内 FEC、5% PLC。独立进程调用官方 jar 里的 raw Concentus（`de.maxhenkel.voicechat.concentus`），因为官方 `JavaOpus*Impl` 依赖 Voicechat 的 Log4J，不能单独加载。

仓库、许可与依赖以实际检出为准：`jcs130/minecraft-ai-friend` 的上述测试文件为 MIT；Concentus 在官方 jar 中为 BSD 风格许可。本客户端适配复用该契约，而不是另写一套编码。

## Agent / SDK 用法

SDK：

```ts
import { attachSimpleVoiceChat, createOfficialOpusCodec, SVC_COMPATIBILITY_VERSION } from 'agent-mc-world/simple-voice-chat';

const opus = createOfficialOpusCodec({ jar: '/path/to/voicechat-*.jar', javaPath });
const voice = attachSimpleVoiceChat(bot, { opus, bindHost: '0.0.0.0' });
const result = await voice.upload(wavBuffer, { requestId, whisper: false });
// result.state 可能是 sent | failed | cancelled；result.recipientHeard === 'unknown'
voice.close();
```

World 工具：`mc_svc`。`{ }` 或 `{action:"status"}` 只报告握手状态。`{action:"upload", audio_handle}` 读取已有 PCM16 WAV blob（0.1–30s），重采样到 48 kHz 后按官方帧编码发送。配置：

- `worlds.minecraft.simpleVoiceChat.enabled`（默认 `false`）
- `worlds.minecraft.simpleVoiceChat.officialJar`（官方 jar 绝对路径，不是 TTS 凭据）
- 可选 `javaPath`、`compatibilityVersion`（默认 20）、`bindHost`

断开、换世界、`close()`、超时、取消上传都会丢掉 UDP 套接字与队列中的发送。密钥只留在内存，解析 `SecretPacket` 的 API 不返回、不记录 16 字节 secret。不要把音频证据写进日志。

## 服务器扩展包的握手时机（gate）

`MinecraftWorld` 每秒同步一次 SVC：只有已认证的 play 连接、且 `simpleVoiceChatGate(bot)` 返回 true 时才握手。默认实现总是 true。服务器扩展包可覆盖它，例如代理大厅里没有语音后端，要等进入生存服后再发 `request_secret`。返回 false 时已附着的客户端立即关闭；经代理切换后端（configuration 阶段）也会关闭，回到 play 且 gate 为 true 后重新握手。`SimpleVoiceChatLane` 另接受可选的 `opus` 工厂与 `resolveUdpHost`，供宿主自带编解码或测试使用。示例：`packages/agent-mc-world-packs/tangerinecology`（橘乡在 `/main` 之后才放行）。

## 以后把可米接到原生 SVC（当前不部署）

可米若要在 **没有 `mcagent:voice`、但登记了 `voicechat:*` / `vc:*` 通道** 的服上说话（例如已审计的橘乡登记了 SVC 通道，没有 `mcagent:voice`），应走 `mc_svc`，不要误用 `mc_voice`。反过来，只提供 `mcagent:voice` 的服仍用原来的附近语音桥。两者不要混用，也不要把橘乡 `ag_cormy` 和千灯纪可米账号 `ag_CorMy` 当成同一部署。

接入步骤（留给以后，本次不部署、不连真实服、不向玩家发声）：

1. 用当前构建的 `agent-mc-world`（本能力尚未 publish）。保持实验标记，不要把 `officialSupportRecommended` 改为 true。
2. 打开 `simpleVoiceChat.enabled`，配置官方 SVC jar 路径；音频来自已有 PCM/WAV 流水线，不要用宿主 TTS 密钥做连通验证。
3. 确认目标服在 `minecraft:register` 中出现 `voicechat:secret` / `voicechat:request_secret`（或 `vc:` 短名），UDP 口以 `SecretPacket` 为准（可被 voiceHost 覆盖）。代理后面的路由见官方 proxy_setup。
4. 先在 127.0.0.1 或隔离实验室验证：对端能解密并官方解码 Opus，失败/超时/断连会清理套接字。`sent` 仍不是听见证明。
5. 再决定是否在运营授权下对真实玩家发声。可米进程、账号、以及任何生产部署都不在本次范围内。

## 本环境验证范围

本地测试用已知 PCM/WAV，在 `127.0.0.1` 上完成 `request_secret`、UDP 认证、加密麦克风帧到达，并用官方 2.6.22 Concentus 解码。本环境没有现成的 Bukkit 2.6.27 + Paper 进程；因此这是官方编解码 + 官方报文布局 + 作者已验证发送契约的端到端，而不是再起一个完整 Paper 语音服。
