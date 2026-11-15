# YSM 2.6.5 现役链路核对

2026-11-15 只读复核结论：**当前正式链已经是官方 NeoForge YSM 2.6.5，保留原生管线，无须再次从 2.4.1 迁移。** 本轮没有安装或替换模组、重启服务、改模型绑定，亦未修改玩家数据。

## 实际制品与运行链路

| 位置 | 核对结果 |
| --- | --- |
| `E:/MC/server/mods/ysm-2.6.5-neoforge+mc1.21.1-release.jar` | 实际解析到 `C:/MC-active/youer-tlm-0.1.4-20261030-115513/mods`，原包版本 `2.6.5-neoforge+mc1.21.1` |
| `E:/MC/private/ysm/auth-native-265/mods/ysm-2.6.5-neoforge+mc1.21.1-release.jar` | 实际解析到 `C:/MC-active/ysm/auth-native-265/mods`，与游戏服逐字节一致 |
| 模型服务控制器 | `appearanceBackend=native265`，原生后端 `ready=true`，当前服务集合为认证后端和登录代理，没有启用旧 Worker |
| 登录代理启动日志 | 2026-11-15 04:14 加载 `OptionalPayloadGuard 0.1.2`；旧 Freesia 文件为停用后缀，不是活动插件 |
| 当前原生状态 | `source=ysm_native_backend`、`ysmVersion=2.6.5`、`protocolVersion=2.6.0`；相机 `ag_PhotoLens` 的真实 `nativeDecoderReady=true` |

两份原包均为 63,463,229 字节，SHA256：

```text
b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb
```

SHA512 与 [官方发布 HZWaR0LY](https://modrinth.com/mod/yes-steve-model/version/2.6.5-neoforge%2Bmc1.21.1) 的 API 制品摘要相符：

```text
75a655fe095565d949aeea5e333f3e1501443b796b250aeabe1ac230c47a99cbac6b7470956b4458f5c982c2cf8a17f170b53e0805b4f4079874fc9975b10dce
```

原生适配器在读取模型前会检查实际加载类的来源制品、摘要与原生结构，不只是返回一个配置中的版本字符串。官方 2.6.5 JAR 本身也保留 `2.6.0` 协议常量。**模组版本与网络协议号是不同字段，禁止伪造握手或将协议号改为 2.6.5。**

## 官网下载核对

实际请求公开别名、跟随 OSS 跳转并读取 ZIP 内 `modrinth.index.json`，并非只检查仓库的下载配置：

| 包 | 包版本 | 包 SHA256 |
| --- | --- | --- |
| [桌面 Java 客户端](https://mc.kangqiang.site/downloads/java-client) | 1.1.0 | `1ba659e68a2f980fd9a2ac5151405af2ffc78b449d1ed0639e8cacc5eabd70d3` |
| [安卓原生客户端](https://mc.kangqiang.site/downloads/android-native-client) | 1.0.0-preview.3 | `76e8f1f05fa11b28100711be2c23d4bd28b0794a6d6ea48006a7bfaee9c9e1ba` |

二者均声明 Minecraft 1.21.1 / NeoForge 21.1.252；YSM 路径、文件大小、官方下载地址和 SHA512 均指向上述同一份原包。没有重新打包、覆盖 OSS 对象或修改官网。

## live／Eye 的核对范围

用户随后澄清：指 live／Eye 观战客户端，**没有实际报错，只需确认并提供版本说明**。因此本轮不再将此列为已确认故障，也没有无依据替换现役 JAR。原生相机握手成功不代表其他客户端必然成功；普通 Mineflayer 的 `nativeDecoderReady=false` 也不代表服务器版本错误。以下为观战端核对方法。

1. 在**实际启动的实例**模组列表或 `logs/latest.log` 核对 Minecraft、加载器和 YSM 版本，不能只看下载文件名。NeoForge 包只使用对应 Minecraft 1.21.1 的原包；同一实例保留一份 YSM。
2. 使用公开入口 `micro.kangqiang.site:25702`，记录该次连接时间和角色名。核对登录后原生握手及模型接收，不仅核对账号认证。
3. 若客户端确实加载了匹配原包仍报错，在隔离环境重现其握手、登录后台切换和模型接收；保留原错误，不通过删角色、清空模型选择或强写就绪标志绕过。

详细只读原始回执保存在维护机 `D:/codex/2026-09-14/new-chat/work/trial-travel-audit-20261115/ysm-chain-readonly.json` 和 `public-ysm-pack-check.json`。本次结论是版本及现役原生链路已核实，**没有新故障复现或服务器重新部署；特定远端 live／Eye 实际画面仍由对应客户端验收**。
