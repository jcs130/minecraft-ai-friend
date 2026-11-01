# 原生 OP 客户端与女仆指令兼容

2026-11-02，服主已批准随整批修复正常重启发布。当前实际安装状态以[部署清单](../manifests/current-deployment.json)为准。

`live` 的密码认证已经成功；转入游戏后，Velocity 解码包含女仆自定义参数的命令树失败，才造成客户端断线。隔离环境用真实 NeoForge 客户端和 OP 权限复现了 `AvailableCommandsPacket` 中 `Argument type identifier 56 unknown`。编号取决于当前模组注册表，不能通过写死编号、取消 OP 或把自定义参数改成普通字符串来掩盖。

采用 [Proxy Compatible Forge 1.3.1 的 CrossStitch](https://github.com/adde0109/Proxy-Compatible-Forge#modded-command-argument-wrapping-aka-crossstitch) 包装服务端命令参数，保持原类型、序列化数据和原版参数。[Velocity 官方说明](https://docs.papermc.io/velocity/faq/#argument-type-identifier-unknown)也将这类错误归为代理无法识别模组参数。使用官方服务端 JAR，客户端不用增加这个模组；女仆、YSM2.6.5 与原账号保持。

仅启用 `crossStitch.enabled=true`；`forwarding.enabled=false`、`forceWrapVanillaArguments=false`，Velocity 原有 `NONE` 转发方式不变。Youer 的 `auto_delete_mods=false` 必须保留。不能把这个配置作为绕过认证或向公网开放游戏后端的方法。

官方文件：`proxy-compatible-forge-1.3.1.jar`，706613 字节，SHA256 `ea541aff6276970d98506965c8e71bd4ad7329452f631b2f45eb08edea425271`；原下载版本 ID 为 `qiZ49HIW`。只在 `mods/` 添加该文件和 `config/proxy-compatible-forge.toml`，不替换原三项内容模组。安装源及回退证据保留在私有 E/F 运营目录，第三方 JAR 不进入 Git。

隔离检查包括：与正式相同的内核、Velocity 和三项内容模组；真实原生 OP 保持连接35秒，客户端仍得到 `HandleTypeArgument`，有效参数可解析、无效参数拒绝，`/tlm maid_num get NativeAuthQA` 返回真实结果；取消测试角色 OP 后管理入口不可见、同一请求被服务端拒绝。1.20.6、1.21.1、1.21.4 Core 客户端均完成认证和世界更新。普通客户端测试使用原有 Core 配置阶段处理，不能据此宣称所有未经适配的 Mineflayer 宿主均已验收。

认证场景构建器只将原三项内容模组复制进空白认证世界；允许存在经过精确 SHA512 校验的此项服务端包装器，但不将其作为认证内容复制。未知新增模组或修改过的同名 JAR 仍必须重新审核。六项独立检查覆盖原集合、精确哈希、已验证包装器排除、篡改、未知版本及缺失内容。

正式验收须另查完整插件栈、原生 OP 的真实连接、现役观战与日志消费；隔离结果不代替这些检查。QA 中该模组初始化后标准输出的时间格式发生变化，日志消费者需按当次时间和实际服务心跳核验。回退时正常停服，仅移除本次新增且哈希吻合的两个文件，保留最新世界、背包、密码库、权限和原内容模组，再正常启动。
