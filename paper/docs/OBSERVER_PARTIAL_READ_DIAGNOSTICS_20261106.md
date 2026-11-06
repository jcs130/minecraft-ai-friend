# 网页观战 PartialReadError：诊断候选

状态：**隔离诊断候选，未部署，线上根因未知**。11 月 6 日 16:43 的 v1 日志只记录了最后一次解码上下文 `play / 88 / 42`。已有的 696 包、221 份场景回执和约 3.6 MB 事件离线回放没有复现；两次 55 秒只读复查未复现，不证明问题消失。官网可信资源配套修复与此故障不能等同。

## 链路与证据边界

在主仓库 `ab4e0275` 与共享渲染器 PR #23 合并提交 `184f8b7e` 的代码中，worker 将只读回执交给 `PaperObservedPlayer.ingest()`。该方法先处理角色和配置、然后逐个调用注入的 `decodePacket()`，再通过 `feed()` / 事件监听器转换场景，最后 worker 查询 `host.status()`。渲染器的 `NativeWorldState.handle()` 还会捕获部分转换异常并调用 `world.unavailable(error)`，随后状态只保留错误文本。以上几处都可能出错；异常类型即使同为 `PartialReadError`，也不能由 v1 的最后一个包推定其来源。

锁定的 `minecraft-protocol 1.66.2`、`minecraft-data 3.113.2` 使用 Java 1.21.1 协议 767、服务端到客户端方向。该 schema 中 play 阶段十进制 88（`0x58`）对应 `entity_metadata`：VarInt 实体编号，后接由一个字节的索引、VarInt 类型和值组成的元数据项，`0xff` 结束。值类型包括字符串、物品、NBT 等。这个映射只说明 v1 记录上下文对应何种包，并未证明该包失败，也未识别真实元数据项或字段。

已用锁定的真实序列化器生成一个 42 字节的合成 `entity_metadata`，能完整解码；把合成字符串声明长度改大而保持包长 42 字节，真实解码器抛出 `PartialReadError`。另一个合成包缺少结束标记时在边界读取失败。这些只证明诊断对合成输入有效，不是生产故障复现或根因。

## 候选诊断

- 状态使用 `errorDiagnosticsVersion:2`。每个场景异常记录 `phase`：只有解码器抛出的**同一个异常对象**传播到场景捕获处时，才是 `packet_decode` 并填充 `packet`；其他情况按 `scene_prepare_appearance`、`scene_prepare_maid`、`scene_ingest`、`scene_status`、`scene_unavailable` 或 `scene_publisher` 区分。候选以窄包装观察现有 `world.unavailable(error)`：在渲染器丢失原异常类型前只保留脱敏结构信息，分别标记 `renderer_unavailable_during_ingest` / `renderer_unavailable_async`；包装不会阻止或改变原调用，回收场景时恢复。渲染器接口不匹配或无法捕获时仍只报 `scene_unavailable`。这些是发现边界，不保证知道内部具体字段。若有最后成功解析的包，单独以 `lastDecodedPacket` 展示，不能作为因果结论；异步事件不继承其他目标的包。
- 解码失败的 `packet` 在实际调用前记录方向对应的 `state`、包编号、字节数及固定协议 schema 的名称；无法识别时保留未知，不从错误文本或包内容推测包名。正常包可标注解析器报告的 `consumedBytes`，但这不是对字段语义正确性的证明。
- `target.sourceRef` 是与身份无关的临时随机值；`generationRef`、`receiptGenerationRef` 和 `previousGenerationRef` 是以进程内随机密钥对有效代次做 HMAC 得到的短标识。`generationBasis: receipt` 表示本次回执代次，并不表示回执已经通过身份校验；异步错误则以 `last_accepted` 标识上次已接收代次，`receiptGenerationRef` 为 `null`。同进程相同代次可关联，重启后不可跨进程比较；无效或缺失代次为 `null`。不输出 UUID、玩家名、租约或凭据。
- 解析抛错后对**当前内存中已经收到的同一包**同步重放最多一次，仅当长度不超过原来的 2 MiB 上限；不发网络请求或增加采样频次。重放为读取器包装加入最多 100,000 次调用和约 25 毫秒的尽力预算检查；单次原生读取不可中断，不是严格墙钟时间上限。包装在 `finally` 中恢复，原异常照常传播。
- `position.replay: reproduced` 只表示相同输入再次抛出同类异常，不证明线上原始解析的位置一定相同。`reader` / `readerPath` 是最多 8 个固定 schema 读取器名称；`readerStartByte` 是重放中最内层失败读取器的**起始偏移，包含包编号**，不一定是最终越界位置或具体业务字段。无法映射到原输入的子缓冲偏移用 `null`。`unsupported`、`size_limit`、`budget_limit`、`not_reproduced`、`different_error`、`no_reader` 或 `diagnostic_error` 都明确表示位置未知。
- 结构化输出只接收固定错误代码和固定源码文件名，限制调用栈条数；不输出任意错误文本、目录、URL、包内容或玩家数据。`status()` 原有面向受控调用方的角色状态契约未扩大；新增故障日志不包含身份。没有新增监听端口、游戏权限、观察目标或采样请求。

重放依赖当前锁定的 ProtoDef 编译读取器内部结构；若依赖变更、读取器不可包装、出错前无法识别 VarInt 包编号、错误由其他代码重新包装、输入过大或触及预算，诊断可能不含包名或偏移。此时如实返回未知，不能把最后成功包改写为故障包。现有解码器的解释模式在该版本因依赖接口拼写不匹配无法直接启用，不能据此宣称已有完整字段路径。

共享渲染器的 `handleEntity()` / `tickEntities()` 还有独立的 `entityError` 降级路径，不一定调用 `world.unavailable()`，worker 目前也不会因为实体渲染不可用而退役整个场景。本候选未改动这条路径；如果它吞掉原异常，不能保证 v2 能恢复原异常类型或解析位置，场景仍可显示也不能证明实体转换正常。

## 离线运行

在 `paper/integrations/world-observer` 执行 `npm ci --ignore-scripts` 后：

```sh
node reproduce-partial-read.mjs --synthetic
```

命令只输出合成正反例的结构化结果，不连接游戏。若已有经授权保存在本地的私有单包文件，也可在私有环境执行 `node reproduce-partial-read.mjs --file /absolute/private/path --state play`（或 `configuration`）。脚本只读取现有文件、限制 2 MiB，不创建抓包、不输出路径、原始字节、解码值或任意错误文本。不要将原始玩家包、回执或凭据提交到仓库或公开日志。此工具不能仅凭 v1 的三个数字还原原包。

普通回归：`npm test`。若已在隔离环境安装共享渲染器依赖，将 `WORLD_OBSERVER_RENDERER_ROOT` 指向其 `packages/modern-viewer/renderer-src` 绝对路径后运行 `npm test`，可额外执行真实 `PaperObservedPlayer` 与真实协议解析器的合成联测；环境变量缺失时该项会显式跳过。测试不启动游戏或监听端口。

## 下次异常所需证据

先确认候选确实经过审核并由维护者按现有流程部署；当前线上仍是 v1。下一次异常时保留脱敏后的 `OBSERVER_FAILURE` 结构化记录及其时间、`errorDiagnosticsVersion`、实际部署代码版本和解析依赖版本；重点核对 `phase`、`protocol`、`packet` 或 `lastDecodedPacket`、`position.replay` / 读取器起点及同进程 `target` 代次标识。`packet_decode` 且重放同类错误时，再根据已知 schema 和读取器路径缩小范围；`scene_ingest` / `scene_status` 则检查对应转换或状态调用栈，不把 `lastDecodedPacket` 当成故障包。

如果位置未知、重放不一致或静态路径不足以确定字段，现有脱敏信息仍可能不足以确认根因；需要先审查更细粒度且不含玩家值的定点诊断，或在获授权的隔离数据上构造最小复现。若渲染器内部将异常换成另一对象，或没有经过 `world.unavailable`，仍无法建立更细因果关系。不要为此扩大现役观察权限、增加采样频率或自动保存原始生产数据。
