# mcagent:voice 双向授权修复候选（2026-11-05）

关联 [Issue #43 / R2-VOICE-REPLIES](https://github.com/jcs130/minecraft-ai-friend/issues/43)。基线为 `main@cbf2c6d3b83006b8d8aa550c6cc74c24a924e8b0`。本次仅完成源码候选与隔离验证，未修改或重启正式服务器，未发布 LoginGuard JAR。

## 消息语义与修复

按 [Velocity Plugin Messaging](https://docs.papermc.io/velocity/dev/plugin-messaging/) 和 [ServerConnection API](https://jd.papermc.io/velocity/3.4.0/com/velocitypowered/api/proxy/ServerConnection.html) 复核，并检查仓库锁定的 Velocity `3.4.0-SNAPSHOT (git-30227934-b563)` 实际字节码：

| 方向 | 事件 source | 事件 target | 身份依据 |
| --- | --- | --- | --- |
| 客户端请求 C2S | `Player p` | `ServerConnection c` | 发起请求的物理玩家连接 |
| 后端回执/附近字幕 S2C | `ServerConnection c` | `Player p` | 接收消息的物理玩家连接；字幕中的说话人可以是其他玩家 |

`ClientPlaySessionHandler` 创建 `(player, backend)` 事件；`BackendPlaySessionHandler` 创建 `(serverConn, serverConn.getPlayer())` 事件。后者在事件结果允许时才将原始 payload 写给客户端。旧 `voiceTransport` 只接受 `source instanceof Player`，因此合法回包也被 `handled()` 丢弃。

修复仅调整 `LoginGuard.voiceTransport`，增加 `ServerConnection` import。两个方向统一要求：

- `p.isActive()`，且 `c.getPlayer() == p`，匹配物理连接，不凭用户名/UUID推断。
- 原 `authorized(p)` 通过：服务 ready、已登记认证会话、实时 LibreLogin 授权、没有待完成 2FA。没有修改认证策略、账号或凭据。
- 授权查询后重新读取 `p.getCurrentServer()`，必须与 `c` 为同一对象，且后端名为原有 `paper`。同名但非当前连接、切服后的旧连接、其他玩家的连接、auth/FOM 后端均拒绝。
- 未知来源/目标组合拒绝；只在失败时设 `handled()`，不主动设置 `forward()`，不会撤销其他插件的拒绝。

代理不解析、更改或重新发送语音 payload。`mcbot:c2s` 继续单向授权，`qiandengji:agent` 与其他通道独立。旧 McbotTransportTest 中对语音回包的错误拒绝预期移到独立双向测试；mcbot 原有断言保留。服务端语音队列、客户端实现、模型框架和播放策略均未修改。

## 先失败后通过的证据

| 验证 | 基线 | 候选 | 证明范围 |
| --- | --- | --- | --- |
| 新 VoiceTransportTest | 首个合法 `queued` S2C 断言失败；之前 C2S 通过 | 92 条断言通过 | 完整 LoginGuard、真实 Velocity 事件类；玩家/连接/认证提供者为替身 |
| LoginGuard 认证及兼容回归 | 以原测试为基准 | 13 次测试运行通过 | 包含 mcbot、认证观察、2FA门禁、首次密码、正版/Eye、PortalBridge、心跳、并发与配置兼容 |
| 语音客户端 | 原有5项测试保留 | 11 项测试通过 | 原 client.mjs + EventEmitter；六种状态、请求关联、断线/丢回执不重播、显式查询原 ID、附近语音与错误通道隔离 |
| 真实 TCP 基线对照 | 2 项复现检查通过：请求到达 Paper，回包全被拒绝，客户端超时 `unknown` | — | 真实 Velocity/Paper/Mineflayer；复现通过不代表基线功能正常 |
| 真实 TCP 候选 | — | 22 项客户端检查通过，另由服务端日志确认未授权请求为0 | 收到 `queued/playing/sent/failed/cancelled/unknown`、附近字幕；丢终态后查询原 ID，未重播；未授权客户端双向均拒绝 |

联机环境为回环地址上的全新世界：Velocity 锁定 b563，Paper 1.21.1，Mineflayer 4.37.1，Java 21.0.13。只复用现有隔离环境的运行依赖和已接受的 EULA 文件，没有复制已有世界、账号库或私有配置。两轮代理与游戏进程均正常退出。

**真实与替身的边界**：TCP连接、Velocity事件构造/转发、Paper插件消息与原 Mineflayer语音客户端是真实执行；LibreLogin授权结果由测试提供者返回，六种语音状态及附近消息由后端探针生成。没有运行正式 LibreLogin 登录流程、PaperVoicePlugin 的 TTS/ASR/SVC 音频链路或真人麦克风/耳听验收；`sent` 不代表真人听到。切服旧连接和跨玩家伪造由隔离事件测试验证，未伪称做了真实多后端切服测试。独立问题 R2-VOICE-CANCEL 不在本修复范围。

准备阶段修正过测试启动器的 PremiumEyePolicyTest 包名，以及隔离 Velocity 默认 forced-hosts 指向不存在服务器的配置；失败记录保留在测试输出，未将这些失败计为通过。

## 复现方法

构建物和第三方依赖放在仓库之外。三件公开依赖的文件名及 SHA256 由 `tests/run_transport_tests.py` 严格核对：

这两组离线回归也已接入 `public-source.yml` 的 `review-boundaries`，CI 不启动代理或游戏进程。

| 文件名 | 官方来源 |
| --- | --- |
| velocity.jar | [Velocity b563](https://fill-data.papermc.io/v1/objects/fe53021f3168322cb6cb68f78699866fd098df3c306e4359847a10b0d02689ef/velocity-3.4.0-SNAPSHOT-563.jar) |
| LibreLogin.jar | [LibreLogin 0.24.0](https://github.com/kyngs/LibreLogin/releases/download/0.24.0/LibreLogin.jar) |
| packetevents.jar | [PacketEvents 2.8.0](https://github.com/retrooper/packetevents/releases/download/v2.8.0/packetevents-velocity-2.8.0.jar) |

在仓库根目录执行，需含 `jdk.compiler` 的 Java 21：

```sh
python paper/integrations/login-guard/tests/run_transport_tests.py --deps /tmp/voice-deps --output /tmp/voice-candidate
node --test paper/integrations/proximity-voice/tests/client.test.mjs
```

`--source` 可指定基线的 `src` 目录：用本次新增测试编译基线完整源码，预期失败在 `current backend receipt queued`；输出目录中仍保留编译后的基线 classes，可用于 TCP 对照。

已有可用隔离 Paper 1.21.1 输入时：

```sh
python paper/integrations/login-guard/tests/protocol/run_live.py \
  --inputs /tmp/prepared-isolated-paper \
  --deps /tmp/voice-deps \
  --classes /tmp/voice-candidate/classes \
  --baseline-classes /tmp/voice-baseline/classes \
  --node-package /path/to/node_modules/mineflayer/package.json \
  --output /tmp/voice-live
```

输入需有 `server.jar`、`versions/1.21.1/paper-1.21.1.jar`、`libraries`、`cache` 和已接受的 `eula.txt`。默认代理/游戏端口分别25881/25882，均只绑定127.0.0.1；可用参数更改。测试插件要求专用 JVM 属性、标记文件及回环绑定，**不能进入正式插件包**。输出含两轮代理日志、Paper日志、客户端对照结果；不入 Git。

当前候选没有给旧的窄包发布脚本签发新版本，也没有证明整仓 LoginGuard 构建可直接覆盖现役窄包。后续如要部署，需按当时实际 JAR 基线另做打包与维护验证；不要重放旧发布入口或回灌旧账户/世界。
