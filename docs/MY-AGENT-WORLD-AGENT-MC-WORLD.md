# 独立 Minecraft 核心的原生模组服接入

2026-10-13：合入 `main@baac5cf41430168846a4b91410c150c85991d406` 的 `agent-mc-world 0.4.0`，在 `experiment/agent-society-1.21.1` 添加可选宿主包 `@my-agent-world/agent-mc-host 0.1.0`。当前安装在 `E:\QiandengJiSocietyLab\integrations\agent-mc-world\v2-20261013`。这次没有替换现役 Agent、模型、记忆、账本或服务器 JAR，没有生产重启。

[纯文字接入指南](MY-AGENT-WORLD-AGENT-MC-WORLD.txt)包含配置与调用示例；已有接口仍以[统一身体适配器](MY-AGENT-WORLD-WORLD-ADAPTER.md)、[原生 SDK](MY-AGENT-WORLD-NATIVE-SDK.md)及实际 operations 为准。

## 分工

```text
宿主：人格、模型、规划、记忆、学习及目标判定
  → agent-mc-world：agent-mc/v1 回合、工具屏障、事件、事实、归档、请求防重
    → world/src/agent-mc-host：公开 World 环境接口
      → 现有 world-adapter / 原生 SDK：动作账本、身体身份、控制权、模组操作
        → 单一 Mineflayer 登录玩家，或单一 Numen 服务端身体
```

核心默认引擎面向 1.20.6；My Agent World 为 1.21.1，不能直接启动默认引擎替代原生协议桥。适配器只依赖核心公开的 `/client`、`/contracts`、`/mcp` 接口，服务端差异留在 `world/`，通用核心不反向导入宿主。

网页沿用现有 1.21.1 注册表、模型、材质和原生界面服务。`mc_viewer` 返回显式配置的本人画面；没有配置就明确不可用，不额外创建 Mineflayer、观战者或默认 1.20.6 渲染器。此次未更改共享可视化仓库和生产资源。

## 工具和账本

原生工具为 `mc_operations`、`mc_help`、`mc_state`、`mc_read`、`mc_do`、`mc_result`、`mc_wait`、`mc_cancel`、`mc_control`、`mc_lua_operations`、`mc_viewer`，加核心的连接、协议、事件和归档工具。

- 操作先按 provider 发现，分页最多24项；`mc_help` 返回实际参数、权限、可用性。接口列出不等于所有玩法通过验收。
- `mc_do` 接受 `{action_id,operation,args}`，不接受默认引擎的 vanilla `steps`。原生 SDK 再按该 operation 精确校验。
- `dataDir` 是新的 Harness 归档目录，`ledgerDir` 必须是本人原 SDK 账本；禁止用新账本绕过 `unknown`。配置显式绑定账号、provider、UUID 和 controllerId。
- Numen 显式 claim、续租和 release；关闭宿主不会删除身体或取消已受理动作。Mineflayer 保留原连接的排他控制。
- 在途动作有界轮询，终态带实际证据，`goalCompleted=false`。受理、执行结束均不自动判定目标完成；未知结果不会自动重投。归档失败阻止后续派发。
- 完整 SNBT、窗口 stateId、原生库存槽位不作近似；超过64 KiB的工具结果保存为私有 JSON 制品。
- 可选 MCP 仅在宿主用 stdio，不另开端口。远端 Mineflayer 仍连接游戏入口，不需要开放 MCP。

没有迁移核心默认引擎的完整脚本、生存反射、闲时聊天/死亡/受伤订阅；宿主应显式查询状态并消费动作回执。此次没有启动新的自主模型循环，也未验证长期自主生存。

## 构建、安装和维护

Node 22、Java 21。核心按 `packages/agent-mc-world/AGENTS.md` 独立冻结依赖、测试、类型检查、构建并打包。消费者使用实际打包工件，不能靠源码工作区解析成功代替分发验收。

核心锁定的共享 viewer 归档未能在现有环境取得原文件。本次从同一共享源码提交 `f2cda1096fc8c3c9a37cd92c1ca0aded2d1a7e30` 显式重建，并更新 `release-sources.json` 的归档 SHA；没有假称取得原归档或放宽哈希验证。

```powershell
python tools/prepare_agent_mc_viewer.py --shared-source E:/mc-visual-console --workspace E:/private/fresh-viewer-input --node C:/path/to/node.exe --update-lock
```

在核心目录执行冻结安装、`node scripts/prepare-viewer.mjs <归档>`、`pnpm build` 和 `pnpm pack --out <工件>`；pack 输出应重定向到私有日志，避免11,000余个文件名刷屏。`--update-lock` 仅用于明确重新准备归档，后续构建照锁验证。

当前 viewer 输入 SHA256：`3397ee5fafbaf486d6a9acb5a5f4e568627273bd6550d27f59ff61b28153c2da`。核心打包 SHA256：`07abf0296f7feb489cb49e7a445529941f8b219817ec999fd4fa8d01e70f8aef`。

```powershell
python tools/install_maw_agent_mc_world.py --destination E:/QiandengJiSocietyLab/integrations/agent-mc-world/new-version --core-package E:/private/agent-mc-world-0.4.0.tgz --npm C:/path/to/npm.cmd
python world/ops/health/health_mon.py --society-agent-mc-world-smoke
```

安装工具拒绝覆盖已有版本，核对核心源码、打包内容和运行文件哈希，再复制现有原生依赖闭包。初次安装保存真实 `package-lock.json`；分发后恢复依赖执行 `npm ci --ignore-scripts --no-audit --no-fund`。不运行依赖安装脚本、不装全局包、不启动角色或服务。

健康检查核对当前安装清单、源码、核心构建、协议依赖和现有主服务，10项通过。它是手动只读检查，没有新增常驻进程。回退到旧宿主仅需停止新增宿主并继续原 SDK；新目录和原账本保留，不能删除未知动作记录。

## 本次证据与边界

脱敏汇总见 [agent-mc-world-20261013.json](evidence/agent-mc-world-20261013.json)。原始回包、日志、凭据、测试世界与分发工件在私有 `research/agent-mc-world-20261013/`、`integrations/agent-mc-world/`，不进入 Git。

| 检查 | 结果 |
|---|---|
| 核心完整测试 | 284通过、1失败、0跳过；Windows DPAPI Protect系统访问被拒；未跳过或弱化断言 |
| 核心类型、构建、公开声明与分发校验 | 通过 |
| 原生宿主定向测试 | 16通过、0失败、0跳过；使用安装后的独立核心 |
| 外部 TypeScript 消费者与真实 stdio 初始化 | 通过；未连接身体、未开启网络监听 |
| 隔离服 Mineflayer | 16项通过：真实状态/组件、2格移动/终态位置、技能女仆查询、公会登记、Curios开关、重连和同ID防重 |
| 隔离服 Numen | 对应16项通过；同UUID、明确控制租约、真实菜单CAS、原动作对账 |
| 殖民地 | 真实查询正确报告无附近/自有殖民地；未声称已完成建设流程 |
| 性能 | 只验证短动作；记录过一次约9.2ms寻路预算警告，不是负载基准或长期稳定性证明 |
| 生产保留 | 35个JAR、保护配置、两owner、Agent第464轮与暂停、原账本前缀不变，服务健康 |
| 隔离清理 | 游戏服与gate均exit 0，临时TCP/UDP监听关闭 |

0模型调用、0生产游戏动作。适配器使用既有私有文件登录，真实隔离服认证已通过；DPAPI失败仍是核心现有功能的独立缺口。Wandscape此前的WebGL验收与发布门槛仍保留，本次没有发布该模组或声称新增视觉验收。
