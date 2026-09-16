# 自进化 Agent 内核（组件声明）

`world/survival/` 里有两类东西：**内核**——经验、技能、感知与路由等可复用能力；以及**本项目胶水**——把它接到 Minecraft、公会、队伍、语音上的代码。本文声明前者的导入边界，由 `tests/test_survival_kernel_boundary.py` 强制。声明边界不等于完全领域无关：动作词表、事件结构、成长与知识内容仍有游戏语义。

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

内核当前向外导入 **8 个名字**，全部在测试里显式声明；其中 `WorldAdapter` 是不依赖具体实现的结构化协议，其余七个仍来自既有网关模块：

| 来源 | 名字 | 用途 |
|---|---|---|
| `numen_gateway` | `read_json` / `write_json` | 状态文件读写（原子、有界） |
| `numen_gateway` | `action_lock` | 单写者动作锁 |
| `numen_gateway` | `IDENTIFIER` / `TURN_ID` | 行动与回合的标识格式 |
| `numen_gateway` | `TOOLS` | 可用动作词表（`practice` 统计、`skill_library` 校验脚本调用） |
| `numen_gateway` | `GatewayError` | 世界侧错误类型 |
| `world_adapter` | `WorldAdapter` | 租约/动作/回执及只读观测协议；`fast_execution` 只调用两种只读观测 |

`world_adapter.py` 仅导入标准库，`NumenGateway` 通过结构化类型实现它，不要求继承。公开接口为 `snapshot`、`observe`、`open_lease`、`close_lease`、`action`、`action_status`、`turn_receipts`、`inspect_block`、`inspect_container`：

- `open_lease` 的 `expires_at` 是毫秒时间戳；动作必须走原 `action(turn_id, tool, args)` 授权与持久化链路。
- 接受动作不等于动作完成；`action_status` 可结算本地回执，但不得重放世界动作。失败/未知与实际效果确认保持原语义。
- 两种 `inspect_*` 不消耗动作租约；Minecraft 实现仍委托 `WorldActions`，保留物理距离、范围及容器校验。
- 协议不暴露 RCON、裸命令或未授权 dispatch。`tests/test_survival_world_adapter.py` 使用无 RCON/状态目录的另一世界假实现验证程序观测。

七个原直连模块（`body_reconnect`、`drop_actions`、`food_actions`、`navigation_sense`、`recipe_lookup`、`scene_view`、`world_actions`）已把命令序列化/发送收回 `NumenGateway._native_*` 私有方法。校验、共享锁、持久化、回执解析及轮询仍留在原调用点；私有方法不是供模型调用的新工具。原始命令字节、已核对身份、单次发送及未知不重放由协议与行为测试约束。

这只是接入边界，不是独立发行包：Minecraft 适配层仍使用自研 `numen_act` / `qdworld` / `qdtrade` 协议，**不是原版 RCON 即可运行**。领域模块仍依赖网关私有校验和原生响应格式；换世界还需适配动作词表、状态结构、知识与项目装配，不能仅换九个方法就宣称完成移植。

任何新增外部导入都会让 `test_declared_adapter_surface_is_exactly_what_the_kernel_uses` 失败，必须显式声明。

## 状态位置

内核的持久状态在源码树外（宿主 `server/survival-agent-state/`，容器 `/state/survival`）。S4 核实这些构造参数已经存在，保留部署默认值，不再引入配置层或迁移已有状态：

| 构造入口 | 显式注入 | 未提供时的原默认值 |
|---|---|---|
| `SkillLibrary(root)` | 独立技能存储目录 | `/state/survival/skills` |
| `WorldPerception(state_dir, world_dir, public_dir, body_name, display_name)` | 独立游标目录、观测源、公开快照与角色身份 | `world_dir` 先取 `SURVIVOR_WORLD_OBSERVATION_DIR`，否则 `/world-observation`；`public_dir=/public`；身份为 `Kirito` / `桐人` |
| `KnowledgeLibrary(root)` | 独立只读知识包目录 | `SURVIVOR_KNOWLEDGE_ROOT`，否则 `/survival-knowledge` |

`PatternDetector`、`ReviewQueue`、`PracticeStore` 与生活会话也使用调用方传入的状态目录。第二个消费者须显式提供自己的目录和身份；默认角色名不是通用内核概念。

`tests/test_survival_skills.py`、`test_survival_perception.py`、`test_survival_knowledge.py` 的路径测试验证显式参数优先于环境变量、两实例互不串写、重建对象保留游标/草稿，以及默认值不变。测试只写临时目录，不操作生产存档。

## 明确不属于内核

`world/survival/` 里的其余文件是本项目胶水，**不要当内核用**：

- `numen_gateway.py`、`world_actions.py`、`game_skills.py` — Minecraft 接口层（自研模组方言）
- `controller.py` — 编排 + 大量 party 调用点 + 硬编码中文 prompt
- `party.py`、`guild.py`、`speech.py`、`character_speech.py` — 队伍/公会/语音，跨树依赖 `world/sidecar` 与 `world/ops`
- `game_service.py`、`health.py`、`init_runtime.py`、`verify_runtime.py` — 运行时装配，依赖 `world/ops`

## 可选原生依赖

`quickjs`（技能沙箱）与 `nbtlib`（Minecraft 库存解码）由 `world/survival/Dockerfile` 安装。宿主缺依赖时，必须在 survivor 容器内运行相关测试，不能把未验证项当作通过。

正式容器没有 `tests/` 挂载。容器验收需将源码、测试与知识包夹具复制到独立临时目录，保持 `tests/`、`world/survival/`、`world/sidecar/` 等相对布局，再设置对应平铺 `PYTHONPATH`、逐模块运行 `python -m unittest`。测试使用临时状态，不借用生产 `/state`，不安装或变更生产依赖。

## 边界测试

```
python -m unittest tests.test_survival_kernel_boundary
```

三条断言：内核只 import 标准库 / 内核自身 / 声明的适配面；声明的适配面与实际使用**完全相等**（不许有陈旧条目）；声明的每个名字在其模块里真实存在。
