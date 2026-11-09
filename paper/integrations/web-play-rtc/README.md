# 网页本人游玩 WebRTC

当前为已验证的代码候选，**未部署公网游玩入口**。不是只读观战的控制后门，不创建第二个游戏身体，不改变游戏权限、碰撞或动作执行器。

现役 `play.kangqiang.site` 使用独立 Toy 网关：HTTPS → 云端反向代理/隧道 → Windows 网关 → 本人 Mineflayer。原网页每次控制等待 HTTP 回执再发送下一项。此适配器在原 HTTP 登录、Cookie、CSRF 和本人角色检查后协商 WebRTC，仍调用原 `GameConnection.control` 与控制租约桥。

## 传输与结果

| 通道 | 规则 |
|---|---|
| `qd.play.input` | 无序、零重传；完整最新移动/朝向输入。独立序号、当前租约及可靠命令 generation。使用服务端短期 token，不依赖客户端时钟；过期、乱序、旧 stop 前输入丢弃。 |
| `qd.play.control` | 可靠有序；接管、停止、按键边沿、物品/菜单操作、心跳及回执。协议 `qiandengji.play.v1`，单消息最多 16 KiB，共用原限流。 |
| `qd.play.world` | 可靠有序；从同一身体的原生 SSE 来源转发原字节，每片最多 16 KiB，背压等待有界。人物、库存、方块增量不作有损丢弃。 |

浏览器只在收到新 RTC identity 后停止 SSE，原 UUID、注册表和构建校验继续执行。贴图/模型仍走 HTTPS。断线后只恢复只读 SSE；控制停止，须再次显式接管，不自动续持按键或重放动作。

每项可靠操作使用独立 requestId。相同 ID/内容只返回原回执，ID 冲突拒绝；当前进程内每个身体最多保存 512 条、终态保留五分钟，在途不挤出。重连可通过 `/api/play/rtc/receipt` 查询。没有回执返回 unknown，**不代表可以重新执行**。服务器进程重启后此暂存账本不可恢复，不能声称持久化去重。

原执行器的 `sent` 仍是受理，只有原执行器终态回调才能更新终态；`completed` 仅在执行器明确提供 true 时为 true。过大的库存详情保留在查询回执中，控制频道明确 `detailsIncluded:false`。控制 ACK 不冒充库存、角色位移或任务完成。

## 消费端准备

```powershell
python prepare-consumer.py --source <现役网页客户端代码目录> --destination <全新隔离候选目录>
```

该命令只创建新目录，复制代码并核对每个补丁锚点，输出前后摘要；不修改源目录，不复制 runtime、账号、凭据、存档或 asset-packs。候选依旧需要现役匹配资源，不能改用近似贴图。复制此包的锁定 `werift@0.26.0` 依赖到消费端的独立依赖安装，或者使用消费端自己的精确锁文件；不可依赖全局 npm 安装。

网关启动配置新增操作员指定的 `playRtcConfig` 绝对路径；未设置时关闭，网页直接沿用原 HTTP。直接线路沿用 `agent-portal/src/webrtc-runtime.mjs` 的地址/UDP/STUN 验证；TURN 模式由 `play-rtc-runtime.mjs` 读取操作员配置，不接受浏览器传入目标地址。`/api/play/rtc/status` 验证本人角色后才下发短期 TURN 凭据，不下发中继共享密钥。

**公网线路采用云端鉴权 TURN 中继，不新增家庭端口映射。** 两端均强制 relay；支持客户端到中继 UDP 或 TCP。凭据按本人账号/会话派生，最长一小时、五分钟桶稳定身份；角色授权撤销仍由游戏网关检查。中继设每身份/全局分配数、带宽限制并禁止向私网目标转发。短期凭据在到期前仍能用于中继分配，不能称作即时撤销的 TURN 账号。

操作员配置示例（独立私有文件，不能提交共享密钥）：
```json
{"schemaVersion":1,"mode":"turn","secretFile":"/private/turn-secret.txt","bindAddress":"192.0.2.10","urls":["turn:relay.example.org:35128?transport=udp","turn:relay.example.org:35128?transport=tcp"]}
```
`secretFile` 必须为绝对路径，至少 32 字符；coturn 同一共享密钥只存私有文件。TURN/TCP 也承载 DTLS 加密的游戏数据，不过 TCP 路径仍可能受队头阻塞影响，不能保证所有网络更快。当前未修改家庭路由器和正式网页配置。

正式发布前：核对网页源/摘要与原角色控制链；安装独立依赖并构建匹配资源；确认无活跃网页身体；保存当前代码和配置；只重载网页网关，不重启 Minecraft。分别验证 LAN/WAN 的真实游玩、弱网停止与 SSE 回退，再启用。只回退代码/配置，不回灌角色、账号或物品数据。

## 验证

`npm test` 覆盖输入过期/乱序/停止屏障、跨通道序号、重复操作、终态查询、权限撤销、容量/背压、握手期限及画面回退。

`test/browser-wire.mjs` 使用真实 Chromium 和 werift ICE/DTLS/SCTP、消费端原 GameConnection/控制桥，身体动作由隔离适配器执行；不连接生产 Minecraft、不调用模型。通过环境变量指定 `QD_RTC_CANDIDATE`、`QD_RTC_WERIFT_PACKAGE`、`QD_RTC_BROWSER_PACKAGE`、`QD_RTC_BROWSER`，可选 `QD_RTC_REPORT`。这些是本机路径，不应提交个人路径或捕获内容。

2026-11-09：15 项新回归、53 项消费端原权限/控制/清理/网关回归通过；真实浏览器读取完整世界 fixture、在库存请求未完成时发送移动、撤权停止、断线查询终态及协商失败回退通过。首轮真实连接发现 ICE 时间被错误计入活动超时，修复为通道打开后计时并加入回归。另通过真实云端双向 TURN，单次采样 RTT 82 ms；UDP/TCP 分配成功，错误凭据收到 401 且无 relay。以上不等于 Minecraft 实景、手机/手柄或性能提升对照验收。

`QD_RTC_TURN_CONFIG` 可指定私有配置，强制真实浏览器测试走中继并检查两端选中 relay candidate；报告只记录候选类型、字节数和 RTT，不记录凭据或 SDP。

`public/native-rtc-protocol.js` 原样复用 mc-visual-console（MIT）提交 `6f80eade` 的有界原生 SSE 解码器；更新需保持与上游逐字一致。其余代码是消费端控制适配，不替换共享渲染器的已有女仆、音频、物品或 GUI 修复。

首次发布被部署后检查拦截并自动回退：外层网关缺少三个 RTC 路由。修复只开放 status/offer/receipt 精确路径，SDP 的 JSON 信封限 64 KiB，内部 SDP 仍限 16 KiB；其他写入保持 8 KiB。`test/consumer-http.mjs` 在 `QD_RTC_CANDIDATE` 指定的实际消费端上验证两层 HTTP、Cookie/CSRF/来源、本人归属、12 KiB SDP、未知回执及原预算。18 项专项与 8 项双层 HTTP 检查通过后才准备新的发布入口，旧维护不可重放。

画面订阅结束时会关闭该 RTC 连接并停止控制，避免半个旧 SSE 事件与新快照混合；新画面先恢复 SSE，重新接管时建立全新解码器。首版此行为优先保证画面与角色操作可信，切换重建画面的视角可能需要再次接管。
