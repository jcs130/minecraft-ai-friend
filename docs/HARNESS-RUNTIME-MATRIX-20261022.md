# Harness 运行时安装、线上联调与游戏验收

2026-10-22。官方锁定版本共有 26 个内置 base，本轮全部安装并逐一运行版本检查。
23 个用同一个线上模型 `qwen3.7-plus` 返回有效工具决策，已加入常驻服务；
Gemini、System One、Qoder 需要不同的服务接口/凭据，已安装但未启用，也未计作调用成功。
版本来源与启动参数见 [部署锁](../manifests/harnessrouter-20261022.lock.json)，
机器可读数据见 [完整验收汇总](evidence/harness-runtime-matrix-20261022.json)。

## 实际支持的选择

下面是 HarnessRouter 运行时的名字。Claude Code、Codex、Kimi 等名称不代表本轮用了
Claude、GPT、Kimi 模型；本轮统一使用用户提供的 Qwen Token Plan / qwen3.7-plus。

| 运行时 | harness_id | 已安装版本 | 单次线上决策 |
| --- | --- | --- | --- |
| DeepSeek Harness | `dsh` | 0.1.2rc1 | 通过；7766 ms |
| Qwen Code | `qwen` | 0.26.0 | 通过；15875 ms |
| Claude Code | `claude-code` | 2.1.280 (Claude Code) | 通过；7734 ms |
| Pi | `pi` | 1.4.0 | 通过；5312 ms |
| OpenCode | `opencode` | 1.19.3 | 通过；8812 ms |
| Hermes | `hermes` | 0.19.0 | 通过；10594 ms |
| Oh My Pi | `omp` | omp/18.1.13 | 通过；9531 ms |
| Cline | `cline` | 3.0.60 | 通过；8000 ms |
| goose | `goose` | 1.50.0 | 通过；7062 ms |
| Kilo Code | `kilo` | 7.8.1 | 通过；13437 ms |
| Kimi Code CLI | `kimi` | 2.0.0 | 通过；8844 ms |
| MiniMax Code | `minimax` | 0.5.4 | 通过；16328 ms |
| Grok Build | `grok` | grok 1.0.41 (4220f3b224a6) | 通过；9313 ms |
| Aider | `aider` | 0.86.2 | 通过；15875 ms |
| OpenHands | `openhands` | 1.49.2 | 通过；12765 ms |
| CheetahClaws | `cheetahclaws` | 3.5.88 | 通过；8609 ms |
| Agent Zero | `agentzero` | 2.13 | 通过；21375 ms |
| MiMo Code | `mimo` | 0.1.15 | 通过；10000 ms |
| jcode | `jcode` | jcode v0.90.0 (a7f005e8c) | 通过；8437 ms |
| OpenSquilla | `opensquilla` | 0.5.6 | 通过；20125 ms |
| nanobot | `nanobot` | 0.3.5 | 通过；40687 ms |
| ZeroClaw | `zeroclaw` | zeroclaw 0.8.5 | 通过；4234 ms |
| Codex | `codex` | codex-cli 0.154.0 | 通过；4969 ms |
| Gemini CLI | `gemini` | 0.58.0 | 未联调：需专属凭据 |
| System One | `systemone` | 0.4.0 | 未联调：需专属凭据 |
| Qoder Cloud Agent | `qoder` | 0.6.0 | 未联调：需专属凭据 |

单次任务要求返回 `mc_protocol facts` 的决策，检查正式 UHP 回执及工具参数，未连接游戏。
没有用模拟模型计数。各行只测一次，受到冷启动、网络及推理影响，不能当作排名或长期成功率。
例如 Pi 为 5.312 秒、DSH 为 7.766 秒、Qwen Code 为 15.875 秒。各驱动上报 usage 的口径不同，
Claude Code 本例只上报 6 个输入 token，不能拿它与其他驱动直接比较真实开销。

Pi 适合作为下一阶段日常游玩的候选：本例上下文较少，且真实移动、记忆检索均通过。
DSH 和 Qwen Code 可继续保留对照。当前没有自动替换模型，也没有自动恢复旧角色的循环。

## 怎么选用

原入口仍是 `http://127.0.0.1:29150/api/harness`，原 API key、控制台登录与数据卷保留。
完整账号/身体配置沿用 [框架指南](../packages/agent-mc-autonomy/docs/harness-router.md)。
只修改同一角色配置中的 `[planner]`：

```toml
[planner]
route = "harnessrouter"
base_url = "http://127.0.0.1:29150/api/harness"
harness_id = "pi"
model = "qwen3.7-plus"
api_key_env = "HARNESSROUTER_API_KEY"
max_step = 4
poll_seconds = 0.5
```

DSH、Qwen Code、Hermes、OpenCode、Goose 等 21 个 Chat 运行时只需换 `harness_id`。
Claude Code 用 `harness_id="claude-code"`、`model="qwen3.7-plus-messages"`；
Codex 用 `harness_id="codex"`、`model="qwen3.7-plus-responses"`。
这三个是本机 integration 的显式别名，供应商实际模型均为 `qwen3.7-plus`。

模型密钥在 HarnessRouter 的原生加密 integration 中；上述环境变量存网关自己的 API key。
新增 Token Plan 凭据另有本机 DPAPI 保护副本，不修改 QwenPaw 的原供应商凭据。
两个凭据目录及备份文件的 DACL 已限定本人、SYSTEM、管理员，原备份字节与哈希保持。
本轮官方 Token Plan 端点实测 Chat、Anthropic、Responses 均返回 200；
原 CodingPlan 的多个模型当时返回 429，两者是不同入口，不能据此声称整个账户耗尽。

## 真实游戏与记忆

普通账号 `ag_HarnQA22` 在一个控制器、一个身体连接中依次切换 DSH、Pi、Qwen Code、
Claude Code、OpenCode、Codex。每种两次规划：读个人历史/事实，再走一格。
六个不同原生任务均取得 `completed` 终态，并用位置读回验证；累计六次步行，
最终及重连后均为 `(-7,82,0)`，无挖掘、放置、传送或 OP 操作。

Qwen Code 阶段的终态先于下一份位置快照，立即查询仍是旧位置；后续只读阶段在下一次
动作前确认已到目标。初次立即验收是 5/6，延迟读回是 6/6。原始失败记录保留，
没有重新移动来覆盖结果；本轮没有把 SDK 的快照时序问题描述为已修复。

还发现旧便笺会被较新的检索/工具交换挤出查询结果，且长记录的开头预览不含搜索命中。
`agent-mc-autonomy 0.1.27` 已修正：有关键词时先返回匹配的个人便笺，再按时间返回交换记录；
空查询仍按最近记录排序。预览围绕命中内容，并返回可用于全文分页的字符 `preview_offset`。
原数据原位保留，不需要迁移或删历史。

安装修复后，六种运行时在常驻入口再次只读检索原便笺。首轮 5/6：DSH 的一次响应多了
右花括号，被框架拒绝，零工具派发；保留失败后，带明确纠错提示的单独复测成功。
最终六种都找回旧便笺，仍为同一角色修订 1。角色导出独立哈希校验通过，全部测试账号已退出、
租约已释放。游戏动作仍交原生队列，Harness 没有另建 Minecraft 连接或第二个控制循环。

框架 334 项 pytest、冻结 wheel 的独立消费者检查通过。后者禁用网络和进程创建，
验证原队列、UHP 封包、检索排序/命中预览与角色导出，且不导入源码或宿主 SDK。
0.1.27 安装在 `E:/MC/integrations/agent-mc-autonomy-0.1.27-harnessrouter`；wheel SHA-256：
`14313f41cfc49e25a71696a8faf65ad6c310e14512d4f784ca61a5cfd862c15f`。

## 运行维护与边界

仍只运行一个常驻 `maw-harnessrouter`，2 CPU、3 GiB、1024 PID，`unless-stopped`。
这只是各 CLI 的按需推理服务，并未让 23 个 Agent 同时常驻。原卷、密钥及 6 个已知旧响应 ID
读回保持；新常驻入口的 7 个已知推理任务均终结。匿名访问 sessions/admin 返回 401，
公开 discovery 返回 200。没有新增公网端口或 Windows 启动任务。

维护前冷备 178,131,986 字节，23,502 个成员完整读过并校验归档 SHA-256。
首次工具缓存复制因 256 MiB 限制触发 OOM/137，自动回滚到原容器；增至 1 GiB 并停用
临时复制容器的健康检查后完成。两次结果均保留，备份与凭据留本机私有目录。

已停止隔离测试容器；临时模型夹具与专用网络删除，29152/29153 均关闭。
隔离缓存卷保留供复查，旧 DSH 容器以 `maw-harnessrouter-dsh-backup-20261022` 停止并禁用
自动重启；它与现役容器共用数据卷，不能同时启动。维护/回滚沿用
[原卷与原密钥备份规则](MY-AGENT-WORLD-HARNESSROUTER.md#维护与备份)，不要重放一次性验收或删除卷来重置角色。

FOM 20 项与基岩桥 14 项只读健康检查全部通过，两个原 run ID 保持，游戏服/基岩桥未重启。
本轮只证明规划接入与有界短任务，未验长期生存、全模组操作、压力或多用户托管。
Cortico/Numen 自带循环驱动、用户选择页面、云同步仍按原后续计划处理。

上游资料：[HarnessRouter 官方源码](https://github.com/HarnessRouter/harnessrouter)、
[Token Plan 官方接入说明](https://help.aliyun.com/zh/model-studio/token-plan-personal-quick-start)、
[官方第三方工具协议说明](https://help.aliyun.com/en/model-studio/more-tools)。
