# 原生 OP 客户端与女仆指令兼容

2026-11-02，服主已批准随整批修复正常重启发布。当前实际安装状态以[部署清单](../manifests/current-deployment.json)为准。

`live` 的密码认证已经成功；转入游戏后，Velocity 解码包含女仆自定义参数的命令树失败，才造成客户端断线。隔离环境用真实 NeoForge 客户端和 OP 权限复现了 `AvailableCommandsPacket` 中 `Argument type identifier 56 unknown`。编号取决于当前模组注册表，不能通过写死编号、取消 OP 或把自定义参数改成普通字符串来掩盖。

采用 [Proxy Compatible Forge 1.3.1 的 CrossStitch](https://github.com/adde0109/Proxy-Compatible-Forge#modded-command-argument-wrapping-aka-crossstitch) 包装服务端命令参数，保持原类型、序列化数据和原版参数。[Velocity 官方说明](https://docs.papermc.io/velocity/faq/#argument-type-identifier-unknown)也将这类错误归为代理无法识别模组参数。使用官方服务端 JAR，客户端不用增加这个模组；女仆、YSM2.6.5 与原账号保持。

仅启用 `crossStitch.enabled=true`；`forwarding.enabled=false`、`forceWrapVanillaArguments=false`，Velocity 原有 `NONE` 转发方式不变。Youer 的 `auto_delete_mods=false` 必须保留。不能把这个配置作为绕过认证或向公网开放游戏后端的方法。

官方文件：`proxy-compatible-forge-1.3.1.jar`，706613 字节，SHA256 `ea541aff6276970d98506965c8e71bd4ad7329452f631b2f45eb08edea425271`；原下载版本 ID 为 `qiZ49HIW`。只在 `mods/` 添加该文件和 `config/proxy-compatible-forge.toml`，不替换原三项内容模组。安装源及回退证据保留在私有 E/F 运营目录，第三方 JAR 不进入 Git。

隔离检查包括：与正式相同的内核、Velocity 和三项内容模组；真实原生 OP 保持连接35秒，客户端仍得到 `HandleTypeArgument`，有效参数可解析、无效参数拒绝，`/tlm maid_num get NativeAuthQA` 返回真实结果；取消测试角色 OP 后管理入口不可见、同一请求被服务端拒绝。1.20.6、1.21.1、1.21.4 Core 客户端均完成认证和世界更新。普通客户端测试使用原有 Core 配置阶段处理，不能据此宣称所有未经适配的 Mineflayer 宿主均已验收。

认证场景构建器只将原三项内容模组复制进空白认证世界；允许存在经过精确 SHA512 校验的此项服务端包装器，但不将其作为认证内容复制。未知新增模组或修改过的同名 JAR 仍必须重新审核。六项独立检查覆盖原集合、精确哈希、已验证包装器排除、篡改、未知版本及缺失内容。

正式验收须另查完整插件栈、原生 OP 的真实连接、现役观战与日志消费；隔离结果不代替这些检查。QA 中该模组初始化后标准输出的时间格式发生变化，日志消费者需按当次时间和实际服务心跳核验。回退时正常停服，仅移除本次新增且哈希吻合的两个文件，保留最新世界、背包、密码库、权限和原内容模组，再正常启动。

## 实际发布与验收

2026-11-02T08:09:32.354233+08:00 已完成180/60/10秒预告、正常停启和 E/F 完整游戏／认证冷备份刷新。正式完整插件栈实际加载官方 PCF，三个原内容模组仍在，664份角色、物品和成长／认证文件在安装阶段一致，原七项女神任务和身份恢复。19项正式回读通过。账号代理按原有生命周期正常重连以取得一致冷备份；网站和 LLM／TTS 没有重启。

源 PR27、PR30、PR35 均在当前 head 检查通过后合入；早期可视化 PR11 已由后续实现替代，未覆盖现役模型。实验源代码没有自动启用，Skill1.3.7下载字节没有改变。远程原 `live` 的实际 OP 重连和安卓手机加入仍需分别核验，不能用隔离测试冒充。维护入口已消费，禁止重放或用旧备份覆盖新进度。

首次验收把模组自动重排TOML的字节变化当成改动，失败回执保留；二次按完整解析对象及类型相等复核，代码仍严格校验哈希。启动后的配置SHA256为 `d698aadb9a505f72d72a128c41de773dbb5f80bd3b6b2dbf23a978d07fa8fa59`。回退移除新增配置前须核对这个已确认的运行后摘要，不能直接用启动前排版的摘要判断篡改。55插件全部启用，原生核显相机恢复30帧。

实际启动日志使用Paper格式；活动委托读取和女神公屏复查已兼容新旧两种格式，49项检查通过，仍排除玩家伪造的日志、私聊、命令与凭据。两个读取程序原子替换生效，不再次重启游戏，不创建或发送新的女神私聊。
