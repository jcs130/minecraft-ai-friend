# Agent 安全提交工作区（可独立复用组件）

让一个 AI Agent 改生产仓库，同时保证：改动只能落在人类批准的范围内、被钉定的测试不能被改、测试在无网络的一次性容器里跑、每一步都有可审计回执。本文是这个组件的对外契约，写给两类读者：本项目的维护者，以及想把它搬到别的仓库用的人。

组件本身**不含任何 Minecraft 概念**（全文无 minecraft / rcon / player 词汇），唯一的项目绑定是"哪个 actor 可以拥有请求"和"批准的分支怎么命名"，两者都是构造参数。

## 两半

| 侧 | 文件 | 职责 |
|---|---|---|
| 请求侧（Python） | `world/ops/engineering_workspace.py` | 独立 clone 的只读勘查、字节级快照、覆盖面闸门、排队测试、用 plumbing 提交。**从不执行候选代码。** |
| 执行侧（Node） | `world/admin/engineering-runner.mjs` | 在已被监督的 control 进程内轮询队列，把快照挂进一次性容器跑固定检查，写回执。**只有它看得见 Docker。** |
| MCP 暴露 | `world/ops/engineering_mcp.py` | 把上面的方法注册为 Agent 可调工具 |

两侧只通过 `root` 目录下的 JSON 文件通信，没有共享内存、没有网络调用。

## 目录契约

`root`（本项目容器内 `/engineering`，宿主 `server/engineering/`）：

```
config.json                              管理员所有；Agent 不可写
requests/<jobId>.json                    请求侧写入，一次性
receipts/<jobId>.json                    执行侧写入，一次性 + 状态推进
receipts/_runner.json                    执行侧健康心跳
snapshots/<sourceSha256>/source/…        被测字节，只读挂进容器
snapshots/<sourceSha256>/manifest.json   entries + changed
state/workspace.lock                     请求侧独占锁
state/commit-<requestId>.json            提交意图日志（先写意图，后动 ref）
```

`jobId` / `requestId` 必须匹配 `[A-Za-z0-9][A-Za-z0-9_-]{7,79}`。

## config.json 契约

`validate_config()`（Python）与 `validatePlan()`（Node）**各自独立校验同一份配置**，任一侧不通过就拒绝执行。

| 字段 | 约束 |
|---|---|
| `schema` | 必须为 `1` |
| `enabled` | 必须为字面 `true`（不接受真值） |
| `role` | 必须等于两侧注入的 role（默认 `mc-god`） |
| `repo` | 绝对路径，且必须是**独立 clone**：`.git` 是目录、无 `commondir`、无 `objects/info/alternates`、本地 config 无 `filter.*` / `include*` |
| `baseCommit` | 40 位 hex，必须是当前 HEAD 的祖先 |
| `branch` | 必须匹配注入的 branch 正则（默认 `codex/ops-[A-Za-z0-9_-]{1,80}`），且必须是仓库当前签出的分支 |
| `snapshotHostRoot` | 绝对路径，**以 Docker daemon 视角**（本项目是 `/run/desktop/mnt/host/d/...`），不含 `..` |
| `plans` | 1–12 项，`id` 唯一 |

每个 plan：

| 字段 | 约束 |
|---|---|
| `id` | `[a-z][a-z0-9-]{1,48}` |
| `image` | `sha256:<64hex>`，拉起前还要核对 `/images/<image>/json` 的 `Id` 一致 |
| `argv` | 1–40 个非空无 NUL 字符串；`argv[0]` 作 Entrypoint，其余作 Cmd（防止服务镜像启动自己的守护进程） |
| `timeoutSeconds` | 整数 1–300 |
| `coverage` | 相对路径或以 `/` 结尾的前缀；**改动不在其中即拒绝**（`engineering_changes_not_covered_by_plan`） |
| `checks` | 路径 → sha256；**被钉定的测试字节变了即拒绝**（`engineering_fixed_checks_changed`） |

> 运维事实：本项目的 `server/engineering/config.json` **未入 git**（`.gitignore` 的 `/server/`）。它是运行态状态，由 `tools/prepare_world_engineering.py` 派生。因此"移动 coverage 白名单里的文件"这类改动无法在单个 commit 内自洽——需要同时重新派生运行态。

## 组件保证的不变量

- **覆盖面闸门**：快照里的 `changed` 只要有一条不落在 `plan.coverage`，测试就不排队。
- **钉定检查不可改**：`plan.checks` 的 sha256 与快照字节不符即拒绝，Agent 无法"改测试让自己通过"。
- **快照双向校验**：执行侧在起容器前和跑完后各校验一次字节、模式、文件数、链接与"清单外文件"，防止测试期间被替换。
- **测试沙箱**：`NetworkMode:none`、`ReadonlyRootfs`、`CapDrop:['ALL']`、`no-new-privileges`、`User:65534`、`PidsLimit:64`、512MB 内存、1 CPU、只有 `/tmp` 是 noexec tmpfs、源码只读挂载。
- **Git 加固**：钩子指向 `/dev/null`，`protocol.allow=never`（无网络），全局/系统配置屏蔽，`diff.external=` 清空，`commit.gpgSign=false`，`core.fileMode=false`；`--literal-pathspecs`。
- **提交不跑仓库过滤器**：提交走 `hash-object --no-filters` → `update-index` → `write-tree` → `commit-tree` → `update-ref`，写入的是**被测过的那份字节**，且只有当回执 `passed` / `exitCode==0` / `sourceSha256` 与 `planSha256` 与 `imageId` 全部对上才允许。
- **单写者 + 可恢复**：`state/workspace.lock` 独占；提交先落意图日志再动 ref；进程重启后 `running` 回执一律降级为 `unknown`，并且 `unknown` 是**终态**——阻塞后续所有作业直到人工复核（`engineering_unknown_test_requires_review`），绝不自动重放。
- **本地提交不等于上线**：`commit()` 返回 `pushed:false`，部署是独立的人工评审步骤。

## 注入点（搬到别的项目要改的全部内容）

```python
EngineeringWorkspace(config='/engineering/config.json', root='/engineering',
                     git=None,            # git 可执行文件路径
                     role='mc-god',       # 谁可以拥有请求
                     branch=r'codex/ops-[A-Za-z0-9_-]{1,80}')  # 批准分支命名
validate_config(value, role, branch)      # 同样的两个参数
```

```js
createEngineeringRunner({root:'/engineering', configFile, engine, role:'mc-god',
                         clock, sleep, redact})
validatePlan(config, request, role)
```

`engine` 是 `(method, route, body, timeout) => Promise`，本项目传 `control-service.mjs` 的 `dockerRequest`；测试传假函数，所以整套执行侧测试**不需要 Docker**（见 `world/tests-ai/engineering-runner.test.mjs`）。`redact` 传 `redactLog`，回执里的日志会脱敏后截断到 24000 字符。

搬迁清单：换 `role`、换 `branch` 正则、给出 `snapshotHostRoot`（Docker daemon 视角）、准备一个独立 clone、写 `plans`。其余不用改。

## 不属于本组件的部分

以下是本项目自己的调度胶水，**不要一起搬**：

- `world/ops/engineering_cron_runtime.py`：把 `ACTOR='operations:mc-god'` / `JOB_ID='qd-team-engineer'` 绑定到 QwenPaw 原生 Cron，并按 sha 钉定第三方执行器源码。
- `world/ops/engineering_task_runtime.py`、`world/ops/team_help.py`：原生任务/求助适配。
- `world/ops/cron_guard.py`：本项目 cron 周期锁与看门狗。
- QwenPaw 相关的一切（按 sha 钉死第三方内部实现，天然不可移植）。

## 相关测试

- `tests/test_engineering_workspace.py` — 请求侧，纯宿主，自建临时 git 仓库
- `world/tests-ai/engineering-runner.test.mjs` — 执行侧，假 engine，无需 Docker
- `tests/test_engineering_cron_runtime.py` — 需要钉定的 QwenPaw 镜像，宿主上跳过
