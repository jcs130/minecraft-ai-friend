# 自进化 Agent 内核（组件声明）

`world/survival/` 里有两类东西：**内核**——一个与具体游戏无关的"会自己变强的 Agent"实现；以及**本项目胶水**——把它接到 Minecraft、公会、队伍、语音上的代码。本文声明前者的边界。边界由 `tests/test_survival_kernel_boundary.py` 强制，不是靠自觉。

## 内核成员（11 个文件，约 2,366 行）

| 文件 | 行数 | 职责 |
|---|---|---|
| `practice.py` | 499 | SQLite 经验库：每次行动的结果、代价与情境，供检索与统计 |
| `skill_library.py` | 431 | 技能草稿 → 测试 → 晋升；QuickJS 沙箱执行技能脚本 |
| `perception.py` | 396 | 事件游标、去重、待处理队列；把世界观测变成有界的感知 |
| `adaptive_router.py` | 211 | 四级模型路由（快思考/慢思考的成本-收益选择） |
| `pattern_detector.py` | 196 | 从回执流里发现重复模式，产出"熟能生巧"提示 |
| `progression.py` | 190 | 能力阶段与解锁判定 |
| `review.py` | 131 | 复盘/做梦队列（SQLite） |
| `inference_errors.py` | 89 | 推理误差的度量与归类 |
| `knowledge.py` | 86 | 只读知识包的寻址与校验 |
| `life_session.py` | 77 | 生活会话的标识与切换 |
| `fast_execution.py` | 60 | 本地只读观测的直接执行（不经规划器/模型） |

## 世界适配面（消费者必须提供的全部内容）

内核不假设 Minecraft，但需要一个"世界"。它向外只要 **8 个名字**，全部在测试里显式声明：

| 来源 | 名字 | 用途 |
|---|---|---|
| `numen_gateway` | `read_json` / `write_json` | 状态文件读写（原子、有界） |
| `numen_gateway` | `action_lock` | 单写者动作锁 |
| `numen_gateway` | `IDENTIFIER` / `TURN_ID` | 行动与回合的标识格式 |
| `numen_gateway` | `TOOLS` | 可用动作词表（`practice` 统计、`skill_library` 校验脚本调用） |
| `numen_gateway` | `GatewayError` | 世界侧错误类型 |
| `world_actions` | `WorldActions` | 只读观测动作（`inspect_block` / `inspect_container`） |

当前实现是本项目的 `numen_gateway.py`（1,022 行，说的是自研模组的 `numen_act` / `qdworld` 方言，**不是原版 RCON**）。换一个世界 = 换这 8 个名字的实现；这也是 S5 要正式定义 `WorldAdapter` 协议的依据。

**这张表只增不减地扩大 = 内核变难复用。** 任何新增都会让 `test_declared_adapter_surface_is_exactly_what_the_kernel_uses` 失败，必须显式声明。

## 状态位置

内核的持久状态**已经在源码树外**（宿主 `server/survival-agent-state/`，容器 `/state/survival`），数据边界是对的。构造函数大多已接受 `state` / `state_dir` 参数，仍有三处把容器路径写成默认值，是 S4 要参数化的全部内容：

- `skill_library.py:225` — `/state/survival/skills`
- `perception.py:169` — 环境变量 `SURVIVOR_WORLD_OBSERVATION_DIR`，默认 `/world-observation`
- `knowledge.py:37` — 环境变量 `SURVIVOR_KNOWLEDGE_ROOT`，默认 `/survival-knowledge`

另外 `perception.py:167` 把 `body_name='Kirito'` / `display_name='桐人'` 作为默认值——本项目的角色身份，不是内核概念。

## 明确不属于内核

`world/survival/` 里的其余文件是本项目胶水，**不要当内核用**：

- `numen_gateway.py`、`world_actions.py`、`game_skills.py` — Minecraft 接口层（自研模组方言）
- `controller.py` — 编排 + 大量 party 调用点 + 硬编码中文 prompt
- `party.py`、`guild.py`、`speech.py`、`character_speech.py` — 队伍/公会/语音，跨树依赖 `world/sidecar` 与 `world/ops`
- `game_service.py`、`health.py`、`init_runtime.py`、`verify_runtime.py` — 运行时装配，依赖 `world/ops`

## 可选原生依赖

`quickjs`（`skill_library.py:67`，技能沙箱）与 `nbtlib`（`numen_gateway.py:207`）只装在 `world/survival/Dockerfile` 里。宿主上缺这两个会让相关测试大量失败——**那不是代码问题，容器内才是真基线**：

```
docker compose exec survivor python -m unittest tests.test_survival_gateway
```

## 边界测试

```
python -m unittest tests.test_survival_kernel_boundary
```

三条断言：内核只 import 标准库 / 内核自身 / 声明的适配面；声明的适配面与实际使用**完全相等**（不许有陈旧条目）；声明的每个名字在其模块里真实存在。
