# Agent CLI 0.4.29 候选测试

仅隔离环境；生产部署、重启另行批准。参考 CLI-Anything 的探查命令、机器输出与真实后端验收方法；不导入其运行时代码。

## 计划

- 纯 Java：长文本、中文、转义与 emoji 无损分页；消息大小、空列表、容量错误、原始对象不被改写。
- 纯 Java：认证观察匹配 UUID、新连接时间、有效期、格式与状态；未知不能伪装为已认证或未认证。
- 代理回归：保留正版校验、Eye配对、首次密码边界、并发启动失败关闭；新增 authstatus 会话变化、不泄露密码。
- 真实 Mineflayer 4.39：自动欢迎只发短引导与状态；统一 status；帮助与 JSON 标志不执行动作；任务各分项、分页完整、只读账本/PDC；技能支持与已学分开、施法后真实冷却；续读不混旧连接，不向其他玩家泄露。
- 真实大背包：沿用已实现的串行槽位适配器，存入、关闭重开、取回、光标为空与数量守恒；延迟、重复窗口、超时、断线回归现有专门测试。
- Geyser/Floodgate：同样的查询、分页与中文回执；协议测试不代表手机/Xbox实机验收。
- 正常停止/重启隔离服：快照不可跨连接使用，原任务与报名状态保留。

## 兼容原则

- 旧命令仍可调用。`progress` 不带页码保留 MC_PROGRESS；带页码用 MC_PAGE。
- `status` 是只读 MC_STATUS；旧详细状态/实练证明用 `status full`，专项状态证明也可显式 `coach practice status`。
- `skills mine/info/points` 保留原流程与明确声明的点数同步；新 `skills status` 不同步点数、不验收。
- 机器输出标志限已经支持的只读入口，未知格式报错并停止，不执行消耗性动作。
- 操作验收必须核对最终服务端状态；发命令与收到 pending 均不是完成。

## 结果

2026-10-12，最终候选通过：

| 范围 | 结果 / 原始证据 |
| --- | --- |
| 纯 Java 分页、长文本、认证校验 | 124 断言，`unit-pages-auth-final.txt` |
| LoginGuard 观察/密码/正版Eye | 11 / 8 / 21 检查，`unit-login-guard-final.txt` |
| 认证回调并发 / 非本机端点失败关闭 | 各一场景，同上 |
| 现有可靠背包、配方/私聊、登录门禁 | 37 项，`client-regression-final.tap` |
| 原生 Mineflayer 4.39，最终 JAR 正常重启后 | 35 项，`observations-b.json` |
| 原生基岩协议经 Geyser/Floodgate | 8 项，`observations-bedrock.json` |
| 正常重启前旧玩家数据回读 | 9 项，`observations-restart.json` |

AgentFriend SHA256 `D4C605B969740EA6F03494944667EC41999AC657294466C3850BAED4CB43352F`；LoginGuard SHA256 `127F4A789BDF51B48C0CB3FD4FC9562AF8908986084009693D833B3BFF1A70BD`。

隔离服 `E:/MC/staging/agent-cli-20261012/paper`，Java `127.0.0.1:25660` / 基岩 `127.0.0.1:19182`；堆上限1536 MiB。首轮 `observations-a.json` 在少量最终补充前通过35项，后正常停止、更新最终摘要并正常启动，B轮和基岩复验固定最终JAR。最后正常停止隔离服，无生产维护。

重跑必须使用独立新测试玩家/副本：A轮会实际报名、学习烟花并存取8张纸，不能直接在同一玩家上反复假定未学习。

```powershell
$env:MC_STAGE_PAPER='E:/MC/staging/agent-cli-20261012/paper'
$env:MC_TEST_REPORT_DIR='E:/MC/ops/repairs/agent-cli-20261012'
node paper/ops/tests/agent-cli-observations.integration.mjs a
# 正常停止并正常启动同一隔离服，再执行：
node paper/ops/tests/agent-cli-observations.integration.mjs b
node paper/ops/tests/agent-cli-bedrock.integration.mjs
node paper/ops/tests/agent-cli-restart.integration.mjs

$env:MINEFLAYER_TEST_PACKAGE='E:/MC/research/mineflayer-client-fixes-20261011/package.json'
node --test paper/probe/mineflayer-inventory-session.test.mjs paper/probe/mineflayer-client-compat.test.mjs paper/ops/mineflayer-login-gate.test.mjs
```

便携运行时可用 `MF_REQUIRE_FROM` / `MC_TEST_BEDROCK_REQUIRE_FROM` 覆盖已安装测试依赖的 package.json 位置。构建方法沿用各插件原脚本，认证构建须用官方Libre API依赖并保留现役双监听器补丁，不能拿官方JAR覆盖正式补丁。

Paper认证读取使用明确的本地文件夹具，代理语义用实际Velocity/Libre API回归；没有冒称真实正版/跨代理发布联机验收。基岩为协议客户端，不代表手机/Xbox画面。没有16个LLM自主或压力验收。

日志和原始回执保存在仓库外 `E:/MC/ops/repairs/agent-cli-20261012/`，F盘另存校验副本。配置、兼容与发布回退见 [说明](../../docs/AGENT_CLI_OBSERVATIONS.md)。
