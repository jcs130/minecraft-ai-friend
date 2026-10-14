# 独立 Minecraft 核心的原生模组服接入

2026-10-14 后续更新：合入 `main@603c184`，三种 provider、可选 Baritone、核心游戏笔记、独立自主框架的实际 schema 与原帧 MCP 接入见[统一接入指南](MY-AGENT-WORLD-UNIFIED-ACCESS.md)。可选新包为 `v14-unified-access-20261014`、宿主0.2.0和客户端桥0.2.0；旧包与现役角色配置不切换。下文按日期保留此前证据，不能把旧归档 SHA 当本轮新工件。

2026-10-14：新增可选 `java-client` 身体与 `v13-java-client-20261014` 分发。宿主的 `mc_state/mc_help/mc_do/mc_result/mc_control` 沿用原接口，通过本机客户端桥控制已登录玩家，目标服务器无需安装桥。配置增加 `expectedServer` 和客户端私有 `credentialsFile`；保留独立 Harness 目录与原动作账本。真实模组 GUI、原帧采集和 Mineflayer API/A* 复用见 [客户端接入](MY-AGENT-WORLD-JAVA-CLIENT.md)。原核心0.4.0、生产角色配置与原身体均不切换；默认1.20.6工具不会自动映射为客户端模组操作。

2026-10-14 此前的`v12-village-compat-20261014`分发复用原核心0.4.0和原生适配器代码，更新候选接入说明。Settlements两个真实物品组件的编解码改在服务端网关源码，SDK分发不包含网关。角色配置和原账本沿用原版本；该SDK分发不代表已安装新增模组。万家烟火/村民新闻目前只在隔离候选验证，现役仍35个JAR，详见[整合记录](MY-AGENT-WORLD-SETTLEMENTS.md)。

2026-10-13：已继续合入 `main@5aeea112eee88523bac9bf65eb475a05f7857bc7`，保留 `agent-mc-world 0.4.0` 与可选宿主包 `@my-agent-world/agent-mc-host 0.1.0`。当时安装在 `E:\QiandengJiSocietyLab\integrations\agent-mc-world\v11-upstream-20261013`，原v4至v10包保留，分支仍为 `experiment/agent-society-1.21.1`。任务统计、动作位移反馈、原生 SDK 和模组操作保持。有限试玩角色仍使用原v10配置并已停止；安装v11不代表角色已重新上线或切换新版运行。

这次上游7个提交增加默认客户端的可见几何感知、粗粒度听觉、空间诊断、任务区域俯视图、宿主决策接口和生活目标资料，并核对丢物品的真实领取证据。`mc_choose`/`mc_life` 加在默认 `MinecraftClientWorld`；本服使用独立原生环境，没有自动获得这两项工具。`DecisionPort`、`observedEntity` 等公开扩展可供后续显式接线。1.21.1的模组方块、视觉和操作仍走原生适配器；不能把默认1.20.6引擎的更新说成本服新增玩法已经实测。

本次完整验证及保留审计见 [上游合并记录](evidence/agent-mc-world-upstream-20261013.json)。没有启动自主模型、连接生产身体或重启游戏服务。

任务成功率、模型轮次、纠错和停滞反馈见 [任务评测与迭代](MY-AGENT-WORLD-TASK-EVALUATION.md)。`TaskMonitor` 是宿主通用接口，按本人实际快照验收，失败和取消均保留；没有把模型自评当作成功。

随后用户授权实际运行并扩大测试：新角色KiritoCore沿同身体、原账本累计206次线上qwen3.7-plus调用，已完成购买原木、合成和放置工作台、原生合成菜单及首个委托；末次41轮无格式拒绝。角色自行报告困在坑底并正常结束，长期模组生活尚未通过。此后续阶段有模型和真实游戏动作，不能沿用下方最初集成验收的“0模型/0生产动作”描述。[完整实跑记录](MY-AGENT-WORLD-CORE-LIVE-TRIAL.md)。

[纯文字接入指南](MY-AGENT-WORLD-AGENT-MC-WORLD.txt)包含配置与调用示例；已有接口仍以[统一身体适配器](MY-AGENT-WORLD-WORLD-ADAPTER.md)、[原生 SDK](MY-AGENT-WORLD-NATIVE-SDK.md)及实际 operations 为准。

## 分工

```text
宿主：人格、模型、规划、记忆、学习及目标判定
  → agent-mc-world：agent-mc/v1 回合、工具屏障、事件、事实、归档、请求防重
    → world/src/agent-mc-host：公开 World 环境接口
      → 现有 world-adapter / 原生 SDK：动作账本、身体身份、控制权、模组操作
        → 单一 Mineflayer 登录玩家，或单一 Numen 服务端身体
```

核心默认引擎面向 1.20.6；My Agent World 为 1.21.1，不能直接启动默认引擎替代原生协议桥。适配器只依赖核心公开的 `/client`、`/contracts`、`/mcp` 接口，服务端差异留在 `world/`，通用核心不反向导入宿主。上游新增的飞行输入和查询纠错源码均已保留并测试；原生宿主仍按本人 provider 的 operations 调用。

网页沿用现有 1.21.1 注册表、模型、材质和原生界面服务。`mc_viewer` 返回显式配置的本人画面；没有配置就明确不可用，不额外创建 Mineflayer、观战者或默认 1.20.6 渲染器。此次未更改共享可视化仓库和生产资源。

## 工具和账本

原生工具为 `mc_operations`、`mc_help`、`mc_state`、`mc_read`、`mc_do`、`mc_result`、`mc_wait`、`mc_cancel`、`mc_control`、`mc_lua_operations`、`mc_viewer`，加核心的连接、协议、事件和归档工具。

- 操作先按 provider 发现，分页最多24项；`mc_help` 返回实际参数、权限、可用性。接口列出不等于所有玩法通过验收。
- `mc_do` 接受 `{action_id,operation,args}`，不接受默认引擎的 vanilla `steps`。原生 SDK 再按该 operation 精确校验。
- `dataDir` 是新的 Harness 归档目录，`ledgerDir` 必须是本人原 SDK 账本；禁止用新账本绕过 `unknown`。配置显式绑定账号、provider、UUID 和 controllerId。
- Numen 显式 claim、续租和 release；关闭宿主不会删除身体或取消已受理动作。Mineflayer 保留原连接的排他控制。
- 在途动作有界轮询，终态带实际证据，`goalCompleted=false`。受理、执行结束均不自动判定目标完成；未知结果不会自动重投。归档失败阻止后续派发。
- Numen 同一动作的并发查询共享一次读取和终态落盘；关闭连接等待已发起的状态读取写完再释放账本锁。保留严格账本校验，没有接纳重复终态或删除失败记录。
- 完整 SNBT、窗口 stateId、原生库存槽位不作近似；超过64 KiB的工具结果保存为私有 JSON 制品。
- 可选 MCP 仅在宿主用 stdio，不另开端口。远端 Mineflayer 仍连接游戏入口，不需要开放 MCP。

没有迁移核心默认引擎的完整脚本、生存反射、闲时聊天/死亡/受伤订阅；宿主应显式查询状态并消费动作回执。此次没有启动新的自主模型循环，也未验证长期自主生存。

## 构建、安装和维护

Node 22、Java 21。核心按 `packages/agent-mc-world/AGENTS.md` 独立冻结依赖、测试、类型检查、构建并打包。消费者使用实际打包工件，不能靠源码工作区解析成功代替分发验收。

核心锁定的共享 viewer 归档未能在现有环境取得原文件。本次从新锁定的共享源码提交 `14b1afb563dadea8324021be6d41ea43709c5e0c` 显式重建，并更新 `release-sources.json` 的归档 SHA；没有假称取得原归档或放宽哈希验证。构建工具改用独立目录中的锁定 `npm ci --ignore-scripts`，不再链接共享工作区的旧依赖。本次首先发现共享依赖缺少新版 `camera-controls`，失败目录和日志保留；使用新锁文件后完成构建。

```powershell
python tools/prepare_agent_mc_viewer.py --shared-source E:/mc-visual-console --workspace E:/private/fresh-viewer-input --node C:/path/to/node.exe --update-lock
```

在核心目录执行冻结安装、`node scripts/prepare-viewer.mjs <归档>`、`pnpm build` 和 `pnpm pack --out <工件>`；pack 输出应重定向到私有日志，避免11,000余个文件名刷屏。`--update-lock` 仅用于明确重新准备归档，后续构建照锁验证。

当前 viewer 输入 SHA256：`e7fa7aa69c19f176f3e05074ac6d86751e9c2a811225c71aa51d8bdf70f71609`。当前核心工件哈希见上游合并记录和v11的 `installation.json`。旧v10核心工件哈希 `09dc52c987ab48f8b8ecaee625f03a90531f96274e3822ad396230e81b3d4393` 仅用于旧包回溯。

```powershell
python tools/install_maw_agent_mc_world.py --destination E:/QiandengJiSocietyLab/integrations/agent-mc-world/new-version --core-package E:/private/agent-mc-world-0.4.0.tgz --npm C:/path/to/npm.cmd
python world/ops/health/health_mon.py --society-agent-mc-world-smoke
```

安装工具拒绝覆盖已有版本，核对核心源码、打包内容和运行文件哈希，再复制现有原生依赖闭包。初次安装保存真实 `package-lock.json`；分发后恢复依赖执行 `npm ci --ignore-scripts --no-audit --no-fund`。不运行依赖安装脚本、不装全局包、不启动角色或服务。

健康检查核对当前安装清单、源码、核心构建、协议依赖和现有主服务，10项通过。它是手动只读检查，没有新增常驻进程。回退到旧宿主仅需停止新增宿主并继续原 SDK；新目录和原账本保留，不能删除未知动作记录。

## 最初集成证据与边界（main@edd0179）

脱敏汇总见 [agent-mc-world-20261013.json](evidence/agent-mc-world-20261013.json)。原始回包、日志、凭据、测试世界与分发工件在私有 `research/agent-mc-world-20261013/`、`integrations/agent-mc-world/`，不进入 Git。

| 检查 | 结果 |
|---|---|
| 核心完整测试 | 308通过、1失败、0跳过；Windows当前用户域DPAPI Protect访问被拒；未跳过或弱化断言 |
| 核心类型、构建、公开声明与分发校验 | 通过 |
| 原生宿主定向测试 | 16通过、0失败、0跳过；使用安装后的独立核心 |
| 原生身体与账本回归测试 | 29通过、0失败、0跳过；含并发终态和关闭期间排他锁；旧NEKO目录数量断言更新为130项/45只读 |
| 外部 TypeScript 消费者与真实 stdio 初始化 | 通过；未连接身体、未开启网络监听 |
| 隔离服 Mineflayer | 16项通过：真实状态/组件、2格移动/终态位置、技能女仆查询、公会登记、Curios开关、重连和同ID防重 |
| 隔离服 Numen | 对应16项通过；同UUID、明确控制租约、真实菜单CAS、原动作对账 |
| 殖民地 | 真实查询正确报告无附近/自有殖民地；未声称已完成建设流程 |
| 性能 | 只验证短动作；记录过一次约9.2ms寻路预算警告，不是负载基准或长期稳定性证明 |
| 生产保留 | 35个JAR、保护配置、两owner、Agent第464轮与暂停、原账本前缀不变，服务健康 |
| 隔离清理 | 游戏服与gate均exit 0，临时TCP/UDP监听关闭 |

Numen 首次最新版复测暴露了等待工具与后台轮询同时落盘的竞态：同一动作出现两条终态，重连被严格账本拒绝。修复合并并发状态读取并等待落盘后关闭，之后用新隔离世界完成同UUID重连和同ID防重。失败世界与原始重复记录保留，未通过删除账本让测试变绿。

0模型调用、0生产游戏动作。适配器使用既有私有文件登录，真实隔离服认证已通过；DPAPI失败仍是核心现有功能的独立缺口。打开显示器后单独重跑仍为7通过/1失败；无秘密的直接探针确认机器域DPAPI往返成功、当前用户域返回0x80070005、CryptSvc正常运行，具体用户凭据环境原因尚未定位，没有改成机器域保存实际凭据。Wandscape此前的WebGL验收与发布门槛仍保留，本次没有发布该模组或声称新增视觉验收。
