# 基岩女仆原生语音包

2026-10-12；`experiment/agent-society-1.21.1`。使用已安装的 Touhou Little Maid 1.5.3 自带录音，和模型一起通过服务器资源包下发。基岩玩家重新进服，接受 **1.2.0** 版资源包即可；无需配置语音服务或 API Key。音量可在游戏声音设置中调整。

## 声音来源与事件

- `touhou_little_maid`：103 段，作者 Amitaro；保留原包署名与 [来源](https://amitaro.net/)。
- `littlemaid_peco`：332 段，原包署名秋野かえで（CV）、Tamemaru；保留原包 [来源](https://booth.pm/ja/items/1903163)。
- 共 435 个原始 Ogg Vorbis 文件，逐文件校验；不重新录制、合成或转码。52 个包／事件组合包含闲置、工作、受伤、战斗、驯服和环境等原生声音。

每只女仆播放实际选择的声音包。`CustomSoundLoader` 中的复用规则也保留：工作池追加闲置录音，远程／弹幕攻击池追加攻击录音，火焰受伤池追加普通受伤录音；已有专用录音仍保留。随机选取由基岩声音事件执行，与原模组各 Java 客户端独立随机的行为一致。

声音定义依据 [微软声音文档](https://learn.microsoft.com/en-us/minecraft/creator/documents/introductiontosound?view=minecraft-bedrock-stable) 和 [Mojang 声音 schema](https://github.com/Mojang/bedrock-schemas/blob/main/schemas/rp/sounds/index.schema.json)。采用 `neutral` 分类、原音频和空间坐标，不在聊天栏输出声音通知。

## 接入方式

复用既有 Geyser `MawModels` 扩展和 Gate，不新增常驻进程，也不改变女仆 AI、实体、背包或权限。

原服务端本来就发送这两种消息，桥只消费发给当前玩家连接的原始负载：

| 原生频道 | 字节布局 |
| --- | --- |
| `touhou_little_maid:play_maid_sound` | MC UTF-8 字符串 soundEvent、packId，然后 VarInt entityId |
| `touhou_little_maid:play_maid_sound_at_pos` | 相同两个字符串，然后大端 double x/y/z、float volume/pitch |

MC 字符串使用 VarInt 字节长度，无 `writeUTF` 前缀。解析长度、UTF-8、事件名称、坐标与浮点数均有界校验；多余字节或畸形包拒绝。扩展只产生当前基岩连接的 `PlaySoundPacket`，不转发到公屏、Web 或其他玩家。

实体声音核对实际 entityId 与 UUID，读取原始同步元数据的 `Silent`（4）和 `SOUND_FREQ`（50）。频率乘以本机 TLM common 配置中的 `GlobalMaidSoundFrequency / 100`。该全局配置修改后需重启基岩桥，单只女仆的元数据变更即时生效。静音饰品在原模组事件阶段取消发声，本适配不自行重新触发。

默认声音包由 TLM 随机初始化，可能因等于原生默认值而不包含在首次元数据中；必须使用声音负载中的 packId，不能按缺失元数据猜测。包缺失时保持安静，不借用其他女仆的声音。实体移除、维度切换、断线清理连接缓存。

原实体声音继续沿用原模组同维度、附近 16 格的发送范围；声音位置为播放开始时的实体实际坐标。基岩包内距离衰减也设置为 16 格。当前没有把正在播放的音源持续绑定到移动中的实体，长语音中途移动与 Java 的逐 tick 音源跟随仍有差异。

## 构建与维护

`tools/maw_bedrock_voices.py` 从 SHA-256 锁定为 `f6db0419…c27` 的原 JAR 读取内置 `maid_sound.json` 和录音。`tools/maw_bedrock_modpacks.py --maid-jar <安装的TLM.jar>` 将声音加入女仆模型包，输出 `maid-voices.json`，同时提升专属模型包版本至 1.2.0。原几何、UV、PNG 和动画不替换。YSM 包不额外加入声音。

生成文件在运行目录，原录音不另行提交 Git。`modpack-contract.json` 校验全部文件、声音池和原录音 SHA；supervisor 检查原生频道注册、两份模型包与声音事件注册日志。`health_mon.py --society-bedrock` 及 `--society-bedrock-smoke` 已包含声音探针。原看门狗继续负责恢复基岩桥。

内置两包已适配。新增第三方声音包需显式扩展构建输入并进行来源、事件映射与真机验收，不能仅把 ZIP 放入 Java 目录就宣称已向基岩下发。

## 验证范围

隔离 1.21.1 NeoForge 服与真实 Bedrock UDP 协议客户端验证：下载五个资源包并核对字节哈希；两只女仆真实受伤产生不同的原生声音；位置、音量、音调正确；频率 0 静音、原静音饰品取消事件、切换声音包、未知声音不串音及超出 16 格不发送，共 12 项通过。另有 13 项 Java 编解码检查、31 项 Python、22 项 Node 和 15 项原模型／动画／气泡回归通过。

测试直接使用原模组事件，没有生成台词或调用语言模型。实际手机扬声器听感、平台音频解码，以及完整 Java 逐 tick 音源跟随尚未实测，不能把协议接收等同于真机已听见。模组原有 AI 对话 TTS 的流式音频是另一条协议，本次保留其配置，未将其冒充成这些录音。

## 本次发布

2026-10-12 已备份并更新常驻基岩桥，模型包版本 1.2.0；现役日志确认 279 个模型、两个模型包和 435 段录音／52 个声音事件完成注册。435 段源录音按内容去重后为 431 个音频文件，声音池中的重复权重保留。正式健康 manifest 的 11 项及 panel-smoke 均通过，隔离测试服务正常退出。

本次只重启基岩桥，Java 主服、Mineflayer 和 Numen 连接保持原进程，34 个原生模组 JAR、旧 SDK 分发、原模型服务配置与 Agent 账本逐项核对保持。MawExplorer 原自主暂停及旧 unknown 动作不解除、不重投。

私有备份 `E:\QiandengJiSocietyLab\backups\bedrock-voice-20261012\bedrock-backup.zip` 含 147 个文件、99,957,624 字节，CRC 和逐文件 SHA 均通过；证据位于同运行目录的 `research/bedrock-voice-20261012`。备份和生成音频包不提交 Git。此轮维护已结束，不应重新执行其 shutdown／部署／resume 记录。
