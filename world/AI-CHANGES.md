# AI 与技能兼容修复（开发副本）

2026-09-07。本轮以现有玩法整合、旧存档兼容为目标。修改及集成验证仅针对 D 盘独立开发项目和原存档副本，不部署到 C 盘生产服务。MCP 保持原有 54 个工具，未新增回执工具、未更改 chant 文案或消耗判定。真实 RCON 和登录检查只使用独立端口与保留 QA 身份，结束清理在线测试角色。

## 修改

- `src/mc-magic.ts`：Atom 和 AtomSummary 声明 `type`、`passiveId`；列表与单项查询共用摘要投影，保留被动解锁标识和图标。原 `mc-god.ts` 参悟处理在第 2118 行调用 `listAtoms()`，第 2134–2136 行依据这两个字段解锁被动；先前摘要丢字段，导致该分支无法命中。未改变技能消耗、等级门槛或解锁规则。
- `sidecar/guard/mcp_numen.py`：支持 `NUMEN_REPO_ROOT`、`NUMEN_DATA_DIR`、`NUMEN_SKILLS_DIR`；Node 默认从 PATH 查找，仍支持原 `NODE_EXE`、`TSX_CLI`。原 `MC_DATA_DIR` 继续指定世界运行数据目录；新变量仅指定程序、守卫输出和技能资料位置。独立部署应显式设置 `MC_DATA_DIR`，避免使用旧 shadow 目录默认值。
- 凭据仍按原 `RCON_PASSWORD` / `MC_RCON_SECRET` 注入，不将密码写入配置示例、测试或打包产物。
- `src/rcon.ts` / `src/mc-rcon.ts`：世界命令按顺序等待各自回复，断线后下一个请求重新连接；仅在明确尚未写入的错误上重试，已写出命令遇到断线或超时不会盲目重放。认证等待有超时，旧 socket 事件不能破坏新连接。默认指令长度上限 1446 UTF-8 字节；完成本项目 botgate 完整帧补丁验证后，独立 compose 显式使用 `MC_RCON_MAX_COMMAND_BYTES=65522`。过长命令发前拒绝，不截断。客户端原有按 request-id 匹配及接收响应分片的处理保留。
- `src/qwenpaw-auth.ts` 与 `mc-god.ts`：独立神谕请求读取独立 console token 文件并发送 Bearer 认证；同步回答、异步请求和轮询均覆盖。独立 QwenPaw 为真实镜像内的 2.1.0 schema 初始化，只启用 `mc-god` / `mc-herald` 语言模型角色，内建、动态、ACP 和 MCP 工具均禁用，不复用生产工作目录或 Agent 工具。
- `tools/run_numen_mcp.py`（项目根）：外部 Agent 的 stdio 入口固定使用本项目数据、独立 RCON 端口和私有密钥文件，默认身体名 `QiandengAgent`；准备身体及视觉限制见 `docs/NUMEN-MCP.md`。

## 离线验证

```powershell
node --test tests-ai/magic-summary.test.mjs
python -B -m unittest discover -s tests-ai -p 'test_*.py' -v
```

若开发副本暂未安装 Node 依赖，可将 `QD_TEST_NODE_MODULES` 设为已有 `node_modules` 的绝对路径，仅只读加载 esbuild/依赖；测试构建与模拟数据落系统临时目录，结束删除。没有把源仓 node_modules 复制或改动。

验证包括：真实 `createMagic().service` 对所有被动技能保留解锁标识，列表/单项查询一致，返回对象不污染内存技能表；Python AST 工具清单与实际 FastMCP 注册清单一致（54 项），独立路径、PATH 中的 Node、技能正文读取和路径穿越拒绝均符合既有行为。测试屏蔽网络和定时副作用，不连接游戏。

离线测试不等同于 Minecraft 启动或真人参悟联调。集成阶段另已在独立服验证 Mineflayer 原版协议登录、45 槽技能轮盘、Numen 身体查询，以及现役羽落术成功回执、实体实际缓降效果和 8 点魔力消耗；完整结果在项目根 `reports/ai-smoke.json`。MCP 已实际 stdio 初始化、列出 54 个工具并读取技能正文；独立 QwenPaw 两个角色均已完成简短模型请求。Python 的既有 `read_skill` / `list_skills` 使用 `open(...).read()`，单测有未显式关闭文件的 ResourceWarning；本轮按整合范围未扩修。原生视觉渲染尚未实际验收。

## 随存档迁移的文件清单

以下由源码的读取路径核对，生产侧只检查文件是否存在及大小，没有复制账号、凭据或玩家资料到开发产物。`<world-data>` 指世界进程的 `MC_DATA_DIR`；现役正本是原世界仓库的 `ops/docker/shadow/data`，并非仓库根 `data`。

### 静态玩法配置

| 路径 | 用途与迁移要求 |
|---|---|
| `<world-data>/magic-atoms.json` | 实际技能定义；现役运行表与仓库根基准表不同，迁移必须保持现役表以保留已学技能 ID。 |
| `<world-data>/skill-events.json` | 被动事件、效果定义；漏掉会退回内置少量默认被动。 |
| `<world-data>/advancement-unlocks.json` | 原生成就到技能、经验和魔力上限奖励的映射；缺失时映射为空。 |
| `<world-data>/advancement-names.json` | 成就中文名/说明；缺失会退回 ID 展示。 |
| `<world-data>/balance-overrides.json` | 当前平衡覆盖，影响消耗与等级门槛；应保持存档对应设置。 |
| `<world-data>/social.json`（如存在） | 社交数值覆盖；现役上述目录未发现，缺省使用代码默认值。 |
| `sidecar/guard/skills/**` | MCP `list_skills` / `read_skill` 的技能操作说明与 references，属于程序资产。 |

不要把带用户状态的完整 data 目录作为通用整合包的默认资产。现役 `transmigrators.json` 及人物资料归下方私有存档配套数据。

### 存档与自研成长必须配套保存

| 路径 | 保存内容 |
|---|---|
| Minecraft 的完整 `level-name` 世界目录 | 地形、各维度、实体、背包、装备、经验等级、成就与统计，以及模组 SavedData。应保留整个目录，不能仅复制 region。Minecraft XP 是修为等级真源。 |
| `<world-data>/magic-state.json` | 魔力、魔力上限加成、已学技能、出生天赋、背景摘要、被动/进度、已见成就、成就技能及技能栏。只有 Minecraft 世界目录不足以保留这些。 |
| `<world-data>/world.db` | 祈愿、供奉、编年史、人物记忆文本、观察记录等。SQLite 当前用 WAL；迁移需一致备份或停服后的完整数据库，不能在写入中只复制主 DB 文件。 |
| `<world-data>/transmigrators.json` 及其中 `backstoryFile` / `personaFile` 引用 | AI 人物索引、个性与前世文件。路径相对索引目录解析；仅随个人存档迁移，不并入公共默认包。 |
| `<world-data>/waypoints.json` | 公共和个人传送点。 |
| `<world-data>/saga-store.json` | 世界剧情/演化记录；与已演化过的 magic-atoms.json 配套。 |
| `<world-data>/xp-snapshots.json` | 增量经验同步基线，避免迁移后统计重复结算。 |
| `<world-data>/statusbook-given.json`、`bookbox-given.json`、`skillbooks-given.json`（如存在） | 已发放手札、技能箱和书的判重记录，避免重复赠送。 |
| 守卫输出目录的 `guard-places.json`（如存在） | MCP 守卫个人地点记忆；旧默认在仓库根 data，独立环境可用 NUMEN_DATA_DIR 指定。 |
| `<world-data>/village/**`、`terra-fixed.json`（如启用对应组件） | 村民任务、村庄运行状态和地形修复记录；需与 NPC/botgate 组件的共享数据卷一起迁移。 |

世界数据库的向量召回另依赖 Qdrant 的 `mc_world_memory` collection；SQLite 保留记忆文本，但不复制向量库时不会保留原语义索引。关闭或不可用时，代码降级为记录、不召回。

`chant-requests.jsonl`、`god-inbox.jsonl`、各 inbox/outbox 是待执行通道，不能当静态配置复制后无条件重放；回执、心跳、缓存、截图也不是成长真源。迁移它们需要与相应消费游标保持一致。RCON 密钥和 AI 提供商凭据应独立配置，不纳入可分享整合包。

另需挂载：世界 `advancements` → `MC_ADVANCEMENTS_DIR`，世界 `stats` → `MC_STATS_DIR`，服务器日志 → `MC_LOG_PATH`。`magic-state.json` 与 `waypoints.json` 的当前实现还向 `/mcdata` 镜像，独立容器必须让该路径与读取这些资料的模组/NPC 使用一致的共享卷。本文未更改这一部署约定。
