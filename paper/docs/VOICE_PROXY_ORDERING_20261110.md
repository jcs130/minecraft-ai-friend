# 语音分块代理乱序：隔离定位与候选修复（2026-11-10）

已在锁定 Velocity 的真实 TCP 链路、完整 LoginGuard 消息订阅和真实 `VoiceUploads` 校验中复现首块拒绝：客户端发 `0,1,2,3…`，后端可能先收到 `1`，此时预留仍期待 `0`，所以返回 `UPLOAD_CHUNK_INVALID`。缺陷是代理插件事件的异步完成顺序，不是 TCP 本身乱序，也不是 WAV 头、UUID 编码或 16 KiB 限制算错。

**历史事件边界：**本轮没有原可米宿主的当次逐帧日志、运行目录或现役代理进程读回权限。下述证据确认当前源码/锁定依赖存在足以产生同一症状的缺陷，不能将原可米那次历史失败的单一根因直接标为已确认。候选没有安装、重启或更改正式服务，没有重播历史请求、变更身份/声音/认证或清空账本。

## 最新版本与已有修复

核对远程 `main`、近期 PR、正式清单和客户端归档；本次基线：

| 组件 | 可验证证据 | 仍缺少的现场证据 |
| --- | --- | --- |
| 服务端源码 | `8df10215b45db578915e2f02acbaee39078add4f`，PR155；PR153/154 已合并，未发现后续语音修复 | 当前运行进程的直接读回 |
| 客户端源码 | `c94a9943173b23875681114cd3de29d3e7501c04`，PR29 | 原可米宿主真正加载的 World/server pack/core 路径与版本 |
| 客户端锁定核心 | `0.5.7-rc.160-preview.37`，下载归档 SHA256 `0e5e4066d134e6f97d10ed4a3b736b3ba477806fa10a12e975e181f944ad3b28`；源文件及 `dist/runtime` 中的语音客户端与主干在换行规范化后相同 | 下载/合并不代表原宿主已采用 |
| QiandengVoice | 11月10日正式记录 `0.1.5`，JAR SHA256 `61e414af4b44f476eaafd9b34777015e6cede46ce3dd53156c4c12893a8a999c` | 本候选诊断尚未加载 |
| 女仆桥 | 11月10日正式记录 `0.1.18-scene-voice-patrol`，SHA256 `7db4c45e03915317ca6f8056f22ba619f31573aea568d694111c3e1d36261094` | 人耳和原主人格验收 |
| LoginGuard | 后于11月5日双向修复的11月6日清单为 `0.1.11-web-rc2`，保留 SHA256 `91057a35ec75897f06c755bdeb60a48e05d9e59a93c7fe131adec510cc225a66`；不能沿用旧说明页0.1.8/0.1.10 | 原代理当下 JAR/hash、所有消息监听器清单 |
| Velocity / SVC | 锁定 Velocity `3.4.0-SNAPSHOT b563 / git-30227934`，SHA256 `fe53021f3168322cb6cb68f78699866fd098df3c306e4359847a10b0d02689ef`；SVC `2.6.27` | 本轮未查询正式进程；实验使用该固定 Velocity 制品 |

[正式联合记录](HUTAO_JOINT_DEPLOYED_20261110.md)与[正式清单](../manifests/hutao-joint-deployed-20261110.json)仍明确 `originalCormyHostVersionReadback=false`、`originalProxyFirstRejectedChunkRootCauseConfirmed=false`、`humanHearingVerified=false`。本候选不修改这些正式状态。代理新版本依据 [11月6日清单](../manifests/all-fixes-deployed-20261106.json)，不是 README 的历史标题。

## 完整时序与故障位置

| 阶段 | 实际行为及身份/状态约束 |
| --- | --- |
| 注册 | 原 Mineflayer 连接发 `minecraft:register` 声明 `mcagent:voice`，再 `subscribe`；Velocity 自己也注册此频道，因此每个载荷进入 `PluginMessageEvent`。频道注册本身不证明认证或真人听音 |
| begin | 类型1 + UTF-8 JSON，携带原 requestId、format、完整 bytes/SHA256。代理双向实时认证、2FA、当前物理 Player/ServerConnection 和 `paper` 后端检查；不改载荷 |
| 预留及回执 | 服务端以连接身份建立 `(actor, request)`，绑定服务端 session，序号初值0，60秒期限；最大单文件4MiB、全局16MiB/8项、每角色一项。客户端收到同ID `uploading` 才发分块 |
| 分块编码 | 类型2 + UUID16字节 + big-endian int32 sequence + 音频。头21字节，音频1–16384字节；核心每4块/64KiB让出事件循环一次；不是逐块ACK |
| 代理故障 | 原三个 `@Subscribe` 默认 async=true。Velocity 对每个事件独立调用 cached thread pool；`fire(event).thenAcceptAsync(..., backend.eventLoop())` 按事件完成顺序排转发，不能恢复原网络到达顺序。块1可先于块0，finish也可越过最后一块 |
| 解码及拒绝 | `ByteBuffer` 按21字节格式解码；`VoiceUploads.chunk` 要求 `sequence==nextSequence`、块长及累计长度合法。实测 seq=1、期待0、已收0、声明96044、块16384，正常触发拒绝 |
| finish及持久回执 | 校验长度、SHA256，移除上传；`finalizingUploads` 保护异步 ledger.reserve 窗口，入队后 queued→playing→sent/failed/cancelled。迟到块/重复finish读取已有回执，不二次归一化或播放 |
| 客户端失败处理 | 原ID回执按 requestId 关联，核心缓存失败并在下一轮分块前停止；已经发出的burst仍可能到达。不能将一次 write、queued、sent 或接收包数当作人耳证明。保留第一条失败，勿只保留后续 expired/incomplete |

依据锁定的[ClientPlaySessionHandler](https://github.com/PaperMC/Velocity/blob/30227934/proxy/src/main/java/com/velocitypowered/proxy/connection/client/ClientPlaySessionHandler.java)、[VelocityEventManager](https://github.com/PaperMC/Velocity/blob/30227934/proxy/src/main/java/com/velocitypowered/proxy/event/VelocityEventManager.java)及实际 JAR 字节码复核。`VelocityPluginContainer` 使用 cached pool。锁定 LibreLogin0.24.0 的 `isAuthorized/isAwaiting2FA` 是内存 Map 查询，不做密码校验、磁盘或远程调用。

PR153/154 解决的是**失败以后上传预留未释放、错误未关联原ID、重复finish/迟到帧覆盖回执**。本轮复现的是**正确数据在进入校验前被代理重排**；两者是独立故障。没有通过放宽序号/长度/摘要/会话校验来掩盖问题。

## 先失败后通过的隔离证据

| 检查 | 基线 | 候选 |
| --- | --- | --- |
| 真实 Velocity 事件分发器 + 完整 LoginGuard 注解，合法逆序工作线程调度 | 失败 `C2S reordered: [2,1,0]` | C2S/S2C顺序断言通过 |
| 自然调度，真实TCP，原核心上传器 + 原 VoiceUploads | 直连20/20；代理16/20，4项失败 | 直连20/20；代理20/20 |
| 仅在测试监听器给seq0增加40ms延迟 | 直连20/20；代理0/20，20次首到分块seq>0且期待0 | 直连20/20；代理20/20 |
| 完整 LoginGuard 编译及原认证回归 | 原认证行为基准保持 | 15次回归运行通过，含原92条语音授权断言及2个新增顺序/诊断测试 |
| 完整 PaperVoicePlugin 编译与边界 | 官方 Paper1.21.1 API及摘要核对的现役同版SVC2.6.27 | 90项已有断言 + 新有界诊断测试通过 |
| JS客户端及被动采集 | 原11项 | 14项通过，含3项采集/原字节/异常/上限/脱离回归 |

无注入的完整基线记录包括：

- 客户端 `begin,0,1,2,3,4,5,finish` → 后端 `begin,1,0,2,3,5,4,finish`；首拒 `sequence=1, nextSequence=0, receivedBytes=0, expectedBytes=96044, chunkBytes=16384`。
- 另一轮后端 `begin,0,1,2,3,4,finish,5` → `UPLOAD_INCOMPLETE`。
- 其余两项为中途块乱序。收到的每个载荷 SHA256 均与客户端发出的对应载荷一致，未发生内容改写。

测试没有通过随机修改sequence/长度来制造错误。40ms只用于确定性暴露独立事件的完成顺序，不代表测得公网延迟。自然调度20次也不是故障概率或压力性能估计。

**真实/替身范围：**使用真实 Minecraft1.21.1 TCP协议、固定 Velocity、其真实事件分发/转发、完整原 LoginGuard 三个订阅、原核心客户端和真实 Java VoiceUploads。后端用测试协议服务器把每个载荷顺序交给 Java 夹具，framing按现役插件；没有启动 Youer/Paper世界、真实LibreLogin账号库、媒体服务、SVC播放或真人客户端。夹具的 `sent` 只表示长度/摘要检验完成，报告明确 `syntheticCompletion=true`。此证据不能替代完整公网生产插件组合、SVC实体音频或人耳验收。

## 最小修复及作用范围

`LoginGuard.agentTransport/voiceTransport/mcbotTransport` 三个注解都设 `async=false`。即使其他方法收到voice频道后马上return，它们也参与此事件类型的线程调度，不能只改voice方法。原认证表达式、payload、拒绝结果、其他插件已有handled标记都保留；不主动重新发送，不添加sleep，不缓冲/重排音频，不变更协议或请求ID。

这是对 **LoginGuard 自身引入的异步切换** 的修复。若正式代理的另一插件也有异步 `PluginMessageEvent` 监听器，仍可能重引入乱序；需核对当前实际插件组合，不能据这个最小候选保证任意第三方监听器都保持顺序。后续不得为了处理乱序绕开认证或强制覆写其他插件的handled结果。

源码候选之外增加有界诊断，见下一节。正式 JAR 尚未制作或安装；仍需以当前实际窄包基线验证无关类保持、包含新诊断类。旧 `build-upload-recovery.py` 绑定0.1.4→0.1.5，遇新诊断类会明确拒绝，不能复用它遗漏依赖或沿用旧版本名。只回退代码，保留全部最新世界、账号和语音账本。

## 下次自然出现时采集什么

所有层按**原requestId + 现有宿主runId/连接generation + 角色UUID + 时间**关联，不收历史音频或重新上传。

| 层 | 有界证据 | 能区分什么 |
| --- | --- | --- |
| 原客户端 | `trace-client.mjs`，默认256/最多512条，仅挂原bot；C2S-write/S2C-received、协议状态、sequence、frameBytes/chunkBytes、frameSha256、begin.expectedBytes、回执state/reason、真实runId/connectionId | 发出前已错序/错误编码，或代理之后才改变；write只证明调用，不等于已送达 |
| 代理 | 候选可显式 `-Dqiandeng.voice.trace=true`；默认关闭，每进程最多256条 `MC_VOICE_TRACE`：方向、原ID、序号、帧摘要/长度、Player/Backend对象标识、allowedAtGuard | 相同payload、连接切换及当前门禁结果；日志名明确guard_decision_not_delivery，不能当最终转发回执 |
| 服务端 | 每分钟最多16条 `VOICE_UPLOAD_REJECT`，含session、pending/sessionMatches、nextSequence/received/expected、remainingMs、序号、帧长/摘要、注册状态、currentPlayer及抑制数量 | 无预留/过期/换会话、首块/中途乱序、空块/超长/累计超量；快照在discard前取得 |
| 发行/进程 | 实际加载core/World/server pack路径、JAR摘要、代理版本及所有消息监听器；采集时间与同轮原请求 | 旧客户端未采用、源码与制品漂移、第三方监听器重引入异步 |

采集器不创建新连接、不注册频道、不发status/finish、不调用模型、不播放或重试。必须由原宿主已经可信的诊断接缝持有原bot和真实runId/connectionId；没有该接缝就保持缺证，不能另造同名客户端。回调异常不改变传输，close/end会移除监听器并恢复原write；没有原始WAV/文本/密码/令牌/IP输出。代理开关须留到后续经授权维护再考虑，本轮不修改现役JVM参数。

按本次证据排查优先级：①实际代理仍异步分发；②原宿主版本/连接代次不一致；③真实组合其他监听器导致转发重排或拒绝；④实际首块长度/编码异常。后三项没有现场证据，不能用本次合成实验排除。

## 可复跑的隔离命令

固定三份代理依赖沿用 `tests/run_transport_tests.py` 中的摘要。Node测试需要独立安装 `minecraft-protocol@1.66.2`；本次 Node24、Java21。每次输出使用仓库外新目录，端口只绑定127.0.0.1:25881/25882。测试插件有专用JVM参数和标记文件门禁，绝不能安装正式服。构建无网络/运行不复制世界、EULA、账号或密钥。

```sh
python paper/integrations/login-guard/tests/run_transport_tests.py --deps /tmp/voice-deps --output /tmp/voice-candidate
node --test paper/integrations/proximity-voice/tests/client.test.mjs paper/integrations/proximity-voice/tests/trace-client.test.mjs
python paper/integrations/login-guard/tests/protocol/run_chunks.py \
  --deps /tmp/voice-deps --classes /tmp/voice-candidate/classes \
  --node-package /tmp/voice-node/package.json --output /tmp/voice-candidate-delayed --delay-first
```

基线：在独立目录用 `git archive 8df10215 .../login-guard/src` 取得旧源码，以同一 `run_transport_tests.py --source <旧src>` 编译（新顺序测试预期失败，classes仍保留）；对该classes运行 `run_chunks.py --baseline --delay-first`。自然调度去掉 `--delay-first`；不要在同端口并行运行。新trace测试依赖候选类，逆序测试一旦失败即停止，不能将基线总测试计为通过。

## 修复后仍需真实验收

1. 原可米进程只读回读实际加载的核心与扩展路径/摘要；正式代理核对全部消息监听器、Player/ServerConnection和加载JAR，确认使用候选而非仅合并源码。
2. 沿原连接产生一段**新的自然发言**，至少跨两个16KiB分块，保留同一个请求ID；核对 begin→uploading→全部块按序→finish→queued/playing/终态、一次归一化与一次发送。失败只保留证据或查原ID，不换号补发同一句。
3. 已有真人Java/NeoForge+SVC客户端在同维度、有效距离、加载声源实体、打开收听且音量正常时，确认实际听到一次、完整、无截断/重复、原声音配置保持；服务端25包或sent不代替此确认。
4. 若新发言真实失败，验证预留释放后**下一句独立自然发言**可以上传；原失败语音不重播，原ledger与角色资料保持。

以上未完成前，不能关闭原可米历史事件根因、全公网链路或人耳验收。
