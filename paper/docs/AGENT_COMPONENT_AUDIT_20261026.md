# 服务端 Agent 组件更新核对（2026-10-26）

官网与 Skill 的更新已经生效；Harness 身体独立更新，Numen 本次是上游核查。
不要把其中一项完成当作所有 Agent 客户端和游戏插件均已更新。

| 组件 | 当前结论 | 验证范围 |
| --- | --- | --- |
| 官网 | 0.8.27 / `f14bbd35` 已发布，接入与Skill保持原版本 | Linux316项；此前OSS下载、安装和MCP启动验证继续保留，新增观战缓存和导航见性能文档 |
| Skill | 1.3.3，固定 MC SDK `0.5.7-rc.95` / `d21f036d` | 私有邀请文件、断点安装、38 核心工具加可选门户工具；API ready 仍不代表入服 |
| 本机 Harness 身体 | 从 MC SDK 0.4.0 更新到相同 rc.95 headless 包 | 使用实际已安装的 0.1.27 Python 控制器启动 MCP，38 工具可发现，8 项离线边界检查 |
| Harness 规划器 | 沿用原服务与 0.1.27 控制器 | 没有新建模型循环或改动模型、账号、人设和记忆；不宣称已验长期自主游玩 |
| Numen Paper | 保留现役自研补丁版 0.1.4 | 本次只核对上游与运行 JAR，不替换插件、不重启 Paper |

## Harness 来源与回退

身体依赖为 `agent-mc-world-0.5.7-rc.95-headless.tgz`，SHA256：
`46b9aea945c20cad4e63841d8c200203fd47164bb27770a3ab10dabeb679328b`。
五个千灯纪适配文件复用 `4333a1cd` 的
`paper/integrations/agent-portal/skill/assets/runtime/qiandengji`，没有新增一套服务器规则分支。

更新前确认该身体与控制器闲置，E/F 完整前像一致。
本机冻结目录的 `SOURCE.json`、`manifest.json` 和 README 记录新来源与旧验收的时间边界。
账号配置及记忆目录的全部文件摘要保持不变；这次没有真实游戏连接、模型调用或任务重放。
旧 `body.before-core95-20261026` 和双盘完整归档可回退；先正常停止本接入控制器，再交换身体目录，
恢复归档内的来源记录即可，不回写账号和游戏资料。原 Paper、代理和规划服务未重启。

## Numen 上游结果

[官方 1.21.1 Release](https://github.com/Dwinovo/minecraft-numen/releases/tag/v0.1.4.1-1.21.1-beta)
仍为 2026-10-09 的 `0.1.4.1-beta`，该 Release 提供 Fabric/NeoForge 文件，没有 Paper 成品。
[1.21.1 最新源码](https://github.com/Dwinovo/minecraft-numen/commit/e32d981eff9da39356704417308dcafa949425ec)
增加先握手再发包；近期还包括原生 YSM 动作、GUI、MCP 等变化。

生产 API JAR SHA256：`7380a3260ab8b291536c748ae6c7094daf3cbb921643f8700d1193b50c0fd31a`；
内容 JAR：`82133ebd12d89db5b7af515160562b64296eebca119f1e0473761ccd85c2bab1`。
它们含旧官方客户端编解码兼容、本人模型 Key 隔离、同名身体身份复用等本服补丁，不能直接被官方 Loader 包覆盖。

从共同祖先 `7c931600` 到上游，Paper 子项目直接变更三处：构建依赖、
`PaperBodyAdmission` 的区块加载职责、`PaperPlatformHelper.modVersion()`。
公共 API、网络与原生模型链也有较多改动，整个差异共 555 个文件。
本次没有把大量上游差异未经隔离验收合入生产。
下一次合并必须保留本服补丁，分别验证官方旧/新客户端、原版、基岩、Numen 假玩家重连及 Key 隔离，
再准备匹配 JAR、双盘回退和当次维护发布；Paper 上的模型链与原生 Loader YSM 不能混为一谈。
