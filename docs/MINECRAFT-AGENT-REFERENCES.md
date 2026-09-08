# 从 Minecraft AI 项目到千灯纪自主冒险者

核对日期：2026-09-08。只阅读作者仓库、作者论文和本地已部署 Numen 源码，没有安装或运行参考项目。以下五项是机制借鉴；千灯纪继续用 QwenPaw 规划、受限 JavaScript 程序技能执行、NeoForge Numen 身体，并保留桐人的原有存档、装备与成长。

## 原始出处与兼容边界

| 项目 | 原始出处与核对内容 | 适合借鉴 | 本项目不能直接照搬的部分 |
| --- | --- | --- | --- |
| Voyager | [作者仓库](https://github.com/MineDojo/Voyager)、[论文 §2](https://arxiv.org/html/2305.16291v2#S2)、[curriculum.py](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/curriculum.py)、[skill.py](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/skill.py)、[critic.py](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/critic.py)。课程输入包括当前状态及已成功/失败任务；程序技能可保存与检索，执行反馈用于修正。 | 自主选择下一项可学会的任务；把成功方法保存在代码与经验中。 | README 的测试客户端为 Fabric 1.19，代码依赖 Mineflayer；安装示例含实验世界/作弊设置。不能覆盖当前 1.21.1 NeoForge 服务器或清空已有进度。 |
| Mindcraft | [作者仓库](https://github.com/mindcraft-bots/mindcraft)、[SelfPrompter 源码](https://github.com/mindcraft-bots/mindcraft/blob/stable/src/agent/self_prompter.js)。源码区分运行/暂停/停止，防止重入，在用户动作介入时终止自提示循环。 | 自主工作可以持续，但用户介入、身体忙和暂停必须能打断。 | 底层仍是 Mineflayer；源码自提示冷却 2 秒，不适合本项目调用预算。不得打开不受限主机代码执行来替代现有技能沙箱。 |
| Odyssey | [作者仓库](https://github.com/zju-vipa/Odyssey)、[论文](https://arxiv.org/html/2407.15325v2)、[skill.py](https://github.com/zju-vipa/Odyssey/blob/master/Odyssey/odyssey/agents/skill.py)。作者区分基础/组合技能，按相关性检索技能，并评测长程规划、即时适应和自主探索。 | 生活能力要覆盖多种任务；将已有动作组合为可复用方法。 | 论文附录 F 的实验为 1.19.4/Fabric/Mineflayer，包含独立实验的暂停及重生安排；不适合直接接入生产存档。无需搬入其模型、多个规划 Agent 或训练数据。 |
| MineDojo | [作者仓库](https://github.com/MineDojo/MineDojo)、[论文 §2](https://arxiv.org/html/2206.08853v2#S2)、[任务目录](https://github.com/MineDojo/MineDojo/tree/main/minedojo/tasks)。任务同时包括可程序验收的生存/采集/制作/战斗，以及建筑等创作。 | 将“能生活”拆成独立可验证的能力，区分数量验收和作品质量。 | 它是另一个模拟器与基准环境，README 使用 JDK 8 后端；不是生产 NeoForge 身体适配器。MineCLIP 分数不能替代材料账、合同回执或当前方块状态。 |
| Numen / numen-mcp | [Numen 作者说明](https://github.com/Dwinovo/minecraft-numen/blob/1.21.1/README_EN.md)、[原 numen-mcp 仓库](https://github.com/Dwinovo/numen-mcp)。外部大脑接管身体，原生玩家路径负责执行；旧 MCP 仓库已标注并入 numen-api。 | 继续复用真实身体、配方/方块/实体感知和动作执行；避免同身体双脑。 | 旧 MCP README 的工具名/客户端接管方式不是本项目已开放接口。当前使用已核对哈希的本地改版及服务端桥，只以实际 MCP 清单和 `actionTools` 为准，不再安装存档仓库的旧独立模组。 |

上表描述参考项目本身；下面的实现方案是结合本项目接口提出的设计，不是这些论文已经验证过的千灯纪实验结果。

## 采用的五个机制

1. **由当前生活状态产生目标。** 借鉴 Voyager 的课程输入，但不设固定“木→石→铁→钻石→末地”剧情。模型比较自身生存需求、已有资源、正在履行的承诺、能弥补能力缺口的小任务，以及附近真实机会。屋顶漏雨、工具不足、粮食可持续、公会交付、村民报价、探索入口都能成为目标；只在选定目标后拆前置条件。摘要不排序、不打分、不自动接任务。[原始课程实现](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/curriculum.py)

2. **用前置条件和验收组织组合技能。** 借鉴 Voyager/Odyssey 的可检索程序库。每份程序描述写清输入、需要的动作接口、材料/位置条件、完成证据与重规划出口。复杂工程依赖小方法，但不会因存在“采矿”程序就推断任何矿石都能采。当前库较小时，先读目录选少量相关源码；避免每轮额外付费 embedding 或把全部源码注入提示。[Voyager 技能库](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/skill.py)、[Odyssey 检索实现](https://github.com/zju-vipa/Odyssey/blob/master/Odyssey/odyssey/agents/skill.py)

3. **把失败证据变成下一版程序。** 借鉴 Voyager 的执行反馈与验证，但生产里的成功标准由实际库存、位置、方块或原系统回执约束。发现失败后先分清缺资源、世界变化、接口不支持、路径失败或代码错误。只有代码/策略需要改进时才写新版本：保留旧版本、增加重现失败的 fixture、重测，再在正常动作限制下执行。单元测试通过与“真正在世界里成功”分别记录；不要用一次成功宣称长期掌握。[Voyager 论文 §2.3](https://arxiv.org/html/2305.16291v2#S2.SS3)、[critic.py](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/critic.py)

4. **计划可中断，连续动作复用程序。** 借鉴 Mindcraft 的循环状态与 Numen 的身体分离。Qwen 负责目标变化和异常复盘；已经晋升的 `next(state,memory)` 在真实快照间继续执行，无需每个挖掘/放置步骤询问模型。任意时刻仍只有一个动作租约。饥饿、受伤、未知回执或不再满足前提时停止当前程序并重规划；Numen 的即时自卫属于身体反射，不等于另一个付费模型。保持项目实际预算与冷却，而不是照搬参考项目 2 秒的提示循环。[Mindcraft 状态机](https://github.com/mindcraft-bots/mindcraft/blob/stable/src/agent/self_prompter.js)、[Numen 外部大脑](https://github.com/Dwinovo/minecraft-numen/blob/1.21.1/README_EN.md)

5. **用多类世界证据衡量成长。** 借鉴 MineDojo 的任务分类与 Odyssey 的不同规划评测。记录实际工具与材料、可恢复补给、住所可用性、耕作产出、真实交易、公会履约，以及同一方法在不同条件的成功/失败；同时记录模型请求次数、动作数和损失。增加技能文件数量或对话长度不是成长。原版/模组装备属性、游戏法术进度和 JS 程序熟练度分开。[MineDojo 任务定义](https://github.com/MineDojo/MineDojo#programmatic-tasks)、[Odyssey 论文实验](https://arxiv.org/html/2407.15325v2)

## 本轮落地接口

新增 `world/survival/progression.py` 的纯函数：

```python
summarize_progression(snapshot, perception=None, environment=None,
                      skill_catalog=None, now_ms=None)
```

输入只使用已有 `NumenGateway.snapshot()`、`WorldPerception` view、缓存的 `observe()` 和 `SkillLibrary.catalog()`，不会请求模型、读文件、调用游戏或创建任务。输出为不超过 6000 UTF-8 字节的 JSON 事实，可由控制器放入决策上下文的 `adventure`：

- `resources`：真实库存分类和计数；保留完整命名空间。仅对少量原版物品提供用途提示，模组物品留在 `other`，不按名称猜挖掘等级或食物性质。
- `equipment`：已观察到的实际装备槽；不把“拥有铁镐”换算成综合角色等级。
- `capabilities`：传入目录里真正存在的 `actionTools`、有 `activeVersion` 的程序和已识别的携带技能书。不会把草稿视为已晋升，也不会把有书视为已学会。
- `progression`：已有女神系统的可用等级/法力摘要；不另造角色经验值。详细原生属性和铁魔法状态仍由已有游戏技能接口提供。
- `opportunities`：公会公示和实际观察到的村民/流浪商人；报价、合同资格/进度和土地归属保持未知，不从公示或实体存在中猜出。

每项保留 `known`/`fresh` 等边界。缺失与“查到为空”不同，超过长度预算会标记 `truncated`；全文原始事实仍以对应只读接口为准。新增 `ADVENTURE.md` 是供角色加载的规划指导。具体动作名只作概念映射，运行时必须检查实际接口与参数。

## 生活目标怎样验收

以下是可被模型选择的目标类型，不是自动派发的队列。前置缺口可以变成小目标；未知权限不等于许可。

| 类型 | 规划时应知道 | 成功证据 | 不能冒充成功的现象 |
| --- | --- | --- | --- |
| 采矿/装备 | 已观察材料、配方、工具要求、数量与返程补给 | 目标材料真实增加；制作/装备后出现实际物品或装备槽变化 | 发现矿脉、提交任务、看到方块变空气但没有取得掉落 |
| 住所/建房 | 被允许使用的位置、材料清单、可走入口、分阶段结构 | 关键位置方块符合设计、真实消耗材料；屋顶/入口/生活设施逐项核对 | 放了一块木头、执行器返回 done、仅从渲染缩略图判断完整可住 |
| 农耕 | 可用土地、水源/土壤、种子、成熟状态、收获与补种方法 | 土地/作物状态变化、成熟后的实际库存收益、补种后的状态 | 仅持有种子；只完成耕地或种植就声称稳定供粮 |
| 村民交易 | 真实商人、当前报价/库存、输入材料、输出物品及次数 | 同一次真实报价/交易回执，且输入消耗与输出增加相符 | 看见村民、打开交易界面、公屏说“买到了” |
| 公会生活 | 实时看板、本人资格/已接合同、可用材料和交付方式 | 原公会系统受理/交付/结算回执，辅以库存与声望/报酬变化 | 看板条目存在、持有材料、聊天承诺接单 |
| 技能成长 | 本人的等级/装备法术、合法技能书、法力/冷却；已有程序版本 | 游戏学习/施法回执，或程序在独立情境下得到真实目标证据 | 目录列出了技能、fixture 通过、只改了技能描述 |

建造可以先完成功能小屋，再选择布局、照明和风格改善；美观需要视觉或人工评价，不能从一串 set 操作推断。复用旧建筑知识时保留其版本差异，不照抄旧 Mineflayer、管理员命令或整段第三方执行代码。

## 已有基础与剩余差异

| 状态 | 内容 |
| --- | --- |
| 本轮之前已有 | 真实 Qwen 角色与持续调度、身体快照与聊天/事件游标、单动作租约、同 task ID + epoch 的导航回执、程序草拟/测试/晋升/有界运行、游戏法术与技能书接口。 |
| 本文对应实现 | 纯事实成长摘要及 6000 字节约束；缺失/陈旧/模组 ID/权限未知的独立测试；`ADVENTURE.md` 目标与验收指导。源码已接入控制器上下文、发布数据及生活卡；容器是否加载当前版本仍须实测。 |
| 同轮新增源码，生产效果另行验收 | 已实现受限放置、农耕、实体容器/熔炉、睡眠、原生村民分页报价与一次交易、公会请求/回执，以及同步已加载区块扫描。MCP 共 39 项，程序动作白名单 17 项，详细协议与实机边界见 [自主生活能力](SURVIVOR-ADVENTURE.md)。是否开放由当前实例实际工具清单决定。 |
| 尚未完成的研究能力 | 全量动态配方/模组能力依赖图、语义技能向量检索、长期跨场景技能可靠性统计、建筑视觉质量评价。暂不宣称已有；先积累真实执行证据，再决定是否需要。 |

本项目的“自我成长”目前是积累可复用程序、实际游戏能力和有证据的经验，不是在线修改 Qwen 模型权重。验证应先用隔离测试与最小游戏动作，再观察连续生活；不能用论文的成绩或一次演示代替本服验收。
