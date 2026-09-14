# RCON 命令回执隔离

本轮候选修复位于现有服务端 `botgate.jar`，没有新增代理或常驻进程。每个 RCON 连接依然使用原生认证、命令权限、主线程执行、请求编号和分包协议；仅将完整的 `ServerInterface.runCommand` 调用放在同一个私有锁中。

## 已核实的问题

固定 Minecraft 1.21.1 / NeoForge 21.1.248 的 `DedicatedServer.runCommand` 使用同一个 `RconConsoleSource`。它在 RCON 线程清空共享缓冲区，然后等待主线程执行命令，再回到 RCON 线程读取缓冲区。三个步骤没有共同的锁，因此不同连接可以清掉或拼接彼此的回执。单个 TCP 连接中的 request-id 校验无法保护这个服务端共享正文。

另外，Numen 的 `TaskDispatch` 在回 JSON 之前已经把任务装入槽位并调用 `start`。中间抛出异常时，Actuator 会返回纯文本 `invoke error`，不会自动撤回原动作。`TaskPersistence.remember` 此处仅更新内存并标脏，没有立即写文件；不能仅凭 GatewayError 推断磁盘保存失败。

这两个具体分支解释了为什么“回执未知”不能重发动作，但本轮丢失的原始回执没有被保留，不能把它的具体原因直接认定为其中之一。Actuator 自行生成调用 UUID，也未透传 Python actionId；相邻时间和相同落点不等于精确请求关联。

## 修复边界

`RconFrameReadMixin` 包装原生 RCON 客户端中唯一的 `ServerInterface.runCommand` 调用，`require=1` / `expect=1`，沿用现有 Mixin 配置。私有锁只由 RCON 客户端线程获取，不锁 `MinecraftServer` 实例，不让 Minecraft 主线程获取这把锁，因此等待 `executeBlocking` 不会造成这个锁的主线程死锁。Java monitor 在正常返回、Exception 和 Error 时均释放；没有重试命令。

候选只替换 `dev/god/botgate/mixin/RconFrameReadMixin.class`，新增 `dev/god/botgate/RconCommandTransaction.class`。其余 JAR 条目的解压后字节逐项保持一致，包括注册表、资源、网络消息和模组元数据。客户端不需要同步这个增量。

## 构建与验收

```powershell
.\run-python.bat tools/build_botgate_rcon_transaction.py
.\run-python.bat tools/smoke_rcon_transaction.py --run-isolated --build-record <本次新生成的build-record.json>
.\run-python.bat -m unittest discover -s tests -p test_rcon_protocol_health.py
```

构建器复用现有 botgate 的固定 classpath，显式编译两份源码，校验原始 RCON 三个类及原 Mixin 字节，拒绝未审查的新版本。原 `build.py` 的 `FILES` 自动遍历 `dev/**/*.java`，因此后续完整构建同样会编译并记录新增的事务类。

离线测试使用真实 NeoForge `RconConsoleSource` 和独立的主线程 executor，确定性重现旧竞争，验证 12 个客户端的 192 次精确回复、单次执行及异常后其他客户端可继续。真实隔离测试在内部 Docker 网络、新存档和专用 QA 指令中比较旧、新 JAR 的 12 连接 × 8 请求；无模型调用、TTS 或生产游戏动作。QA 指令和客户端仅打包进临时测试模组，绝不进入生产候选。

2026-09-14 本次实际验证：原 `0705a6f9…c21a0bc` 在 96 请求中仅 85 条回执精确，其余 11 条混入其他命令回复；候选 `6ca6c1ed…15022a` 为 96/96。两版本所有请求的服务端执行计数均为 1，新版本的原生报错后继续调用、错误口令拒绝及测试服务清理全部通过，共 9 项。另有 227 条 Java 断言和 6 项健康证据回归通过。不可把这个独立竞争实证当作先前那条丢失 ACK 的原始异常证明。

候选记录：`runtime/botgate-rcon-transaction-build/71ee26bb8d1e/build-record.json`；原始实机报告：`runtime/rcon-transaction-qa-c05b9c968e19/report.json`。首次夹具仅因 Docker 内部网络端口映射前置而中止，原失败记录保存在 `runtime/rcon-transaction-qa-6b68f788210d/report.json`；后续测试改为容器内部 Java socket 客户端，没有开放测试端口。

健康检查 `rcon_protocol` 同时要求原 `rcon-live-smoke.json` 的认证/分帧验收与新的 `rcon-transaction-smoke.json`：实际部署 JAR、正式 build-record、两份行为报告必须精确对应，夹具、驱动、测试工具和实现源码也要匹配。旧报告或源码漂移如实失败，不改历史哈希。

## 最小部署范围

先等现有原生任务自然收尾并完成既有停服备份，替换服务端 `server/mc/mods/botgate.jar` 后重启 Minecraft。更新当前 `world/botgate-src/build-record.json` 的真实候选及源码记录，并同步 `manifests/server-extensions.lock.json` 的 botgate 项；历史 `ai-components` 来源记录不改。

发布新隔离报告前逐字节归档已有同名报告，再发布本次真实记录到 `reports/rcon-transaction-smoke.json`。原认证/分帧 smoke 也必须在当前 JAR 上实际执行，先归档旧记录。不能用更新旧报告中的 JAR/source 哈希代替新验收。该文档记录候选与验证合同，部署完成与否以根线程的实际部署记录为准。
