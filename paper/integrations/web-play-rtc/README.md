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

网关启动配置新增操作员指定的 `playRtcConfig` 绝对路径；未设置时关闭，网页直接沿用原 HTTP。配置和运行时沿用 `agent-portal/src/webrtc-runtime.mjs` 的地址/UDP/STUN 验证，不接受浏览器传入的目标地址。`/api/play/rtc/status` 只公开能力与公开 STUN 地址，不包含 Key。

**网络部署须单独验证。** 现有官网 WebRTC 的 UDP 规则位于云端，不能证明 Windows 游玩网关可达。目前候选支持指定可达地址/端口及 STUN，不支持 TURN 鉴权；需选择直连 UDP 转发或补齐经过鉴权的 TURN 中继。当前未修改家庭路由器和正式网页配置，也没有宣称公网延迟降低。

正式发布前：核对网页源/摘要与原角色控制链；安装独立依赖并构建匹配资源；确认无活跃网页身体；保存当前代码和配置；只重载网页网关，不重启 Minecraft。分别验证 LAN/WAN 的真实游玩、弱网停止与 SSE 回退，再启用。只回退代码/配置，不回灌角色、账号或物品数据。

## 验证

`npm test` 覆盖输入过期/乱序/停止屏障、跨通道序号、重复操作、终态查询、权限撤销、容量/背压、握手期限及画面回退。

`test/browser-wire.mjs` 使用真实 Chromium 和 werift ICE/DTLS/SCTP、消费端原 GameConnection/控制桥，身体动作由隔离适配器执行；不连接生产 Minecraft、不调用模型。通过环境变量指定 `QD_RTC_CANDIDATE`、`QD_RTC_WERIFT_PACKAGE`、`QD_RTC_BROWSER_PACKAGE`、`QD_RTC_BROWSER`，可选 `QD_RTC_REPORT`。这些是本机路径，不应提交个人路径或捕获内容。

2026-11-09：12 项新回归、53 项消费端原权限/控制/清理/网关回归通过；真实浏览器读取完整世界 fixture、在库存请求未完成时发送移动、撤权停止、断线查询终态及协商失败回退通过。首轮真实连接发现 ICE 时间被错误计入活动超时，修复为通道打开后计时并加入回归。以上不等于 Minecraft 实景、手机/手柄或 WAN 延迟验收。

`public/native-rtc-protocol.js` 原样复用 mc-visual-console（MIT）提交 `6f80eade` 的有界原生 SSE 解码器；更新需保持与上游逐字一致。其余代码是消费端控制适配，不替换共享渲染器的已有女仆、音频、物品或 GUI 修复。
