# 原生 YSM 通道识别修复候选

**状态：隔离联机通过，未部署。** 正式仍为 OptionalPayloadGuard 0.1.0、LoginGuard 0.1.10、原版 YSM 2.6.5 / 协议 2.6.0。本项没有重放已消费的整批维护，没有改变正式账号、UUID、OP、模型选择或客户端绑定。

## 原因与最小改动

真实原生 NeoForge 观战已能稳定通过认证并保持 OP，但显示普通皮肤。正式只读查询确认可米仍选择 `cormy-winefox-cream/cormy-cream`，外观未停用，且与 live 同世界、同位置；原生适配器却把 live / ag_PhotoLens 的 `nativeDecoderReady` 发布为 false。

隔离观测找到原因：原版客户端通过 `neoforge:register` 发送 3175 字节的原生通道声明。保护层 0.1.0 只识别 `minecraft:register`、`c:register`，因此正常 YSM 消息在发送监测 LOWEST 阶段尚未取消，到 MONITOR 阶段已被过滤。

**最终候选只更新 OptionalPayloadGuard 0.1.1。** 按固定 NeoForge 21.1.252 的 `ModdedNetworkQueryPayload` / `ModdedNetworkQueryComponent` 编码读取客户端声明，只认可 PLAY 中的客户端方向或双向接收能力。配置阶段、服务端方向、错误字段、截断或超限声明不能授予 PLAY 接收能力；保留物理连接隔离与断线清除。声明只是解码能力，不是登录或权限证明。

不改原版 YSM、登录规则或模型内容，不设置就绪属性或伪造回应。曾尝试的“认证场景推迟问候”不是必要条件：保留正式 LoginGuard，仅修复通道识别已经通过，因此该尝试已从发布源码和候选范围移除。

协议依据为固定原版二进制的实际编解码和 [NeoForge 1.21.1 官方载荷说明](https://docs.neoforged.net/docs/1.21.1/networking/payload/)；代理消息边界参照 [Velocity 官方说明](https://docs.papermc.io/velocity/dev/plugin-messaging/)。

## 实测结果

| 隔离组合 | 登录与原女仆查询 | 游戏服 YSM 就绪 | 模型资源 |
| --- | --- | --- | --- |
| 正式 Guard 0.1.10 + 旧保护层 0.1.0 | 正常，OP保持35秒 | false | 仅177字节缓存索引 |
| 仅调整问候 + 旧保护层 | 正常 | false | 仍无下载 |
| 正式 Guard 0.1.10 + 新保护层0.1.1 | 正常，OP保持35秒 | true | 原版客户端形成28份缓存文件，约18MB |

最终组合里，测试角色通过本人 `/appearance set qd_observer_drone default` 选择原创 CC0 模型；服务端实际读回模型、贴图、原生就绪及公开网页资源，mandatory=false。所有角色和路径均为独立 loopback QA，未改正式人物。客户端没有强制本地绑定，没有网络或注册表补丁。

缓存核验也纠正了早先的观察口径：本版实际资源位于 `cache/client` 并有 `server_index`，仅查看空的 `cache/server` 目录不足以判断传输失败。上述结果同时核对了真实传输、缓存增量及原生就绪，仍不代替正式远端完整人物画面验收。

70项能力边界检查、真实3175字节原生声明解析、原版客户端联机通过。CI加入无网络能力边界回归。早先测试环境的旧 NanoLimbo分流、Via版本映射和旧日志就绪误判均有失败回执；有效对照统一隔离旧提供者、采用准确的测试端口映射及独立新日志，正常停止并恢复隔离配置。这些测试调整没有改动正式路由。

## 发布边界

候选及旧保护层回退只放在私有E/F目录，第三方模组和运行数据不入Git。正式激活需要正常重连登录代理，经该代理的Java玩家及相机会短暂重连；游戏内核、世界与玩家进度不需回退或重启。正式状态继续以 `current-deployment.json` 为准，上线后还须由原生相机会话核对实际人物画面。
