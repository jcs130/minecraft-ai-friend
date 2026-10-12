# 保护提示与观战聊天修复（2026-10-12）

## 状态

**后续正式发布：**AgentFriend 0.4.32 / CortiEyeMirror 0.1.15 已正式上线。提前180/60/10秒通知、真人和活动副本门禁通过，原维护任务正常停启，E/F完整冷备份 `20261012-211001` 均在替换前完成。正式认证/背包/观战联机17项、备份/身份/服务状态29项通过；登录、原UUID、保护权限、普通难度与三维度keepInventory保持。yubeen重连到代理但未/login，已登录超时；远端须使用既有密码完成登录，未重置密码，不宣称所有客户端已恢复。观战过滤扩展至旧格式回执，维护JSON广播已删除；完整此次排查和验证见[聊天范围](CHAT_AUDIENCE.md)。原0.1.14候选未单独上线，下文保留上一轮验证时点。

AgentFriend **0.4.32** / CortiEyeMirror **0.1.14** 为已验证候选，**尚未部署**。正式只读核对仍为 0.4.31 / 0.1.13；未替换生产 JAR、重启或改动正式玩家、物品、权限和世界。

## 原因与改动

截图中的 `MC_PROTECTION` 是保护查询/操作拒绝的完整机器回执。旧代码将 JSON 私发到操作者的系统聊天，Eye 又会镜像这条聊天；不是据此认定向全服广播。保护边界、原因和下一步都包含在 JSON 中，因此占据很多行。旧观战过滤只处理 `MC_PHOTO`。

- 自动拒绝改为至多三条中文：动作/目标/归属、保护范围、下一步与详情命令。重叠区域明确提示数量；显式查询显示全部范围。原 1.5 秒重复提示节流保持，拒绝判定保持。
- 真人不自动显示 `MC_PROTECTION`、`MC_GUILD_ACCESS`、`MC_LAND_ACCESS` JSON。完整 `mcagent:protection` 私有负载保持；非观战 `ag_` 与已登记旧 Agent 保留旧聊天回执。
- 任意客户端可以执行 `/mycli protect break|place|container|use <x> <y> <z> --json`。通用 JSON 入口和能力帮助同步支持；查询只读，`allow_likely` 仍需核对最终操作。
- 固定 Eye、自动配对 Eye 和 `live` 的观战副本过滤合法 `MC_* {…}` 系统消息。Agent 本体原消息不变；普通提示、私聊、玩家写出的 MC 文本、无效 JSON 和 HUD 保留。
- Web 已有默认折叠机器回执的聊天面板，本次复验原功能，无需修改 Web 协议。运行在外机的旧 Web 仍需更新到含该面板的版本。

## 验证

最终两个 JAR 在独立回环 Paper 1.20.6 正常启动后验证，使用单独世界和测试账号。

| 检查 | 结果 |
| --- | --- |
| Mineflayer 4.39 / 原生 Java 协议与真实附身 Eye、live | 31 项通过 |
| 基岩协议经回环 Geyser/Floodgate 测试夹具 | 8 项通过 |
| 机器回执识别（含 40 KB JSON、无效 JSON、玩家引文） | 16 断言通过 |
| 现有 Web 聊天折叠、回看、切换目标和拍照模式 | 4 项通过 |

原生测试包含实际保护拒绝、方块不变、中文精简与边界、无人收到别人的私有回执、重复拒绝节流、真人显式 JSON、旧 Agent 兼容和普通私聊保留。基岩是协议接收验证，不代表手机/Xbox像素截图验收。

早期失败保留：首次测试用旧 Mineflayer 依赖并发现新增 `--json` 被通用入口拦截，已修复路由并复验；一次测试过早连接尚未启动的 RCON；超长 RCON 命令超时，改走客户端命令的试验也未收到目标消息，后者原因未确认。最终用短命令验证实际包、纯识别测试验证大消息，不宣称大消息已通过真实连接验证。未将失败报告改成成功。

可重现入口：

```powershell
& paper/plugins/CortiEyeMirror/test-machine-chat.ps1
$env:MC_STAGE_PAPER = 'E:/MC/staging/protection-chat-20261012/paper'
$env:MC_TEST_REPORT_DIR = '独立且存在的测试结果目录'
$env:MC_TEST_RUN_LABEL = '新编号'
node paper/plugins/CortiEyeMirror/protection-chat-stage.mjs
node paper/ops/tests/protection-chat-bedrock.integration.mjs
```

测试要求隔离服回环地址与 256xx 端口；脚本有门禁，不得对正式服运行。原生探针复用已验证的 1.20.6 客户端配方/药水兼容模块；没有修改 Agent 的实际运行端。私有完整记录：`E:/MC/ops/repairs/protection-chat-20261012`。

## 上线与回退

候选摘要：

- AgentFriend 0.4.32：`e1dd62710e50330060fdaa02326597a71ccd5b09d17b6f2b66d80525442c430a`
- CortiEyeMirror 0.1.14：`4755d8663f729fb3d5b936d2cd20bb9ebf8a141e520f03e0ef6495c73da1987f`

以下为此前候选部署说明；本次服主已批准并按最新OPERATIONS记录完成。候选原要求另行确认 Paper 维护重启，按 OPERATIONS.md 提前通知、真人退出/活动结束及 E/F 完整冷备份后替换两个 JAR；不用 `/reload`。当前未写入待部署标记。部署后需复验正式版本、真实连接、普通聊天及原角色恢复，并同步女神资料。回退按同一流程恢复本次维护前的 0.4.31 / 0.1.13 两个 JAR；本次不迁移数据格式，无需回退玩家物品或世界。
