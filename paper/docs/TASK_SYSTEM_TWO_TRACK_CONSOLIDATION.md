# 任务体系两体系收敛方案（Two-Track Consolidation）

> 状态：方案待评估 · 提出人：扛枪（"任务体系需要收敛到两个体系，一个是公会委托等级，一个是个人职业技能等级"，2026-11-25）· 起草：史提西亚（运营线）
> 关联：[TASK_SYSTEM_GOVERNANCE.md](TASK_SYSTEM_GOVERNANCE.md)（问题清单与分层治理）· PR #435（考试文案修复）
> 运营侧不动代码不重启；本文件为架构收敛方案，交开发线评估。

## 一、现状：全部进度计量轴盘点（实证）

| # | 计量轴 | 所属系统 | 怎么涨 | 查询入口 |
| --- | --- | --- | --- | --- |
| 1 | 声望 fame | GuildManager（静态 37 项 + 动态看板 + 市场单 + 探索契约 + 近郊分段） | 交付委托 | `/mycli status` |
| 2 | 晋级分 rankPoints | GuildRankPoints（独立账本，按段位分段计分，上限 `GuildRankPoints.target`） | 交付委托折算（`legacyCredit`） | `/mycli guild exam promotion` |
| 3 | 冒险者段位（青铜 III → 钻石 I，18 阶） | adventurer-grades.yml | fame + rankPoints + 证书 + 现场专长（fresh-any） | 同上 |
| 4 | 能力证书 | skill-assessments（inventory/flight/leap/support/shelter/survey/combat/conquest 八类） | 考试通过 | `/mycli guild certificates` |
| 5 | 生活声望 7 类 | life-guild（gourmet/angler/builder/author/trader/farmer/tinkerer） | 交付生活委托 | `/mycli life status` |
| 6 | 职业等级 + 技能等级 + 天赋 + 魔力 | VortexRPG（六职业） | 战斗/施法/用法 | `/mycli profession info <ID>` |
| 7 | 基础熟练度 11 项 | AuraSkills（farming/foraging/mining/fishing/excavation/archery/defense/fighting/agility/alchemy/enchanting） | 实际行动 | `/mycli skills list passive` |
| 8 | 技能点 | skill-points.yml（旧 SpellMastery 体系残留） | AuraSkills 等级每 5 级 +1 | `skills respec` 等 |
| 9 | 职业技艺认证 19 项 | 旧 guild exam（0.4.18） | 已归档停止写入 | — |

## 二、重叠与冲突（对比分析）

1. **体系内双账本**：声望（#1）与晋级分（#2）都由交付委托产出，却是两套独立计量——晋级要同时看两个数，玩家搞不清"我到底差多少"。
2. **同一行为两套等级**：生活声望的 `angler`/`farmer` 与 AuraSkills 的 `fishing`/`farming` 统计的是同一行为（钓鱼/农耕），各有各的等级。
3. **跨体系依赖无提示**：生活委托 `builder_home` 产出声望（A）+ builder 声望（B）；考试 `shelter_basic`（A 的证书）依赖交付 `builder_home`（B 的技能委托）——依赖本身合理（升公会段位要证明生活技能），但提示文案不清（PR #435 已修）。
4. **两套"花点"**：旧技能点（#8）与 Vortex 学习点（#6）并存，玩家不知道该花哪个。

## 三、收敛目标：两条主线

### 体系 A：公会委托等级
- **一句话**：做委托 → 升冒险者段位。
- **唯一进度**：冒险者段位（18 阶）。
- **计量收敛**：声望为唯一主轴；晋级分并入声望（或明确为声望的派生显示，不再单独要求）；能力证书 = 晋级门槛（条件，不是进度轴）。
- **内容**：全部委托类型（静态/动态/市场/探索/近郊/副本委托）+ 考试（作为晋级门槛）。

### 体系 B：个人职业技能等级
- **一句话**：练技能 → 升技能等级。
- **进度**：职业技能（Vortex 六职业等级 + 技能等级 + 天赋）+ 基础技能（AuraSkills 11 项）+ 生活技能（life-guild 收敛后）。
- **计量收敛**：`angler`→`fishing`、`farmer`→`farming` 合并进 AuraSkills；`gourmet/builder/author/trader/tinkerer` 保留为生活技能等级（无 AuraSkills 对应，是体系 B 的独有技能线）；技能点统一用 Vortex 学习点，旧 skill-points 退役。

## 四、映射表：现有每个系统归哪里

| 系统 | 归属 | 处理 |
| --- | --- | --- |
| 静态委托 37 项 / 动态看板 / 市场单 / 探索契约 / 近郊分段 | A | 产出声望 |
| 副本（dungeon 15 处） | A 的委托目标地 | conquest 类委托与考试的目标 |
| skill-assessments 考试 | A 的晋级门槛 | 证书 = 段位条件 |
| fame | A 主轴 | 保留为唯一进度 |
| rankPoints | A | 并入声望或标为派生 |
| Vortex 六职业 | B 主轴 | 保留 |
| AuraSkills 11 项 | B | 保留为基础技能等级 |
| life-guild `angler`/`farmer` | B | 合并到 AuraSkills `fishing`/`farming` |
| life-guild 其余 5 类 | B | 保留为生活技能等级 |
| 生活委托（`builder_home` 等） | A（委托）+ B（技能熟练） | 双归属：交付产出声望，同时涨对应技能等级 |
| 旧 skill-points | B | 退役，统一 Vortex 学习点 |
| 旧 guild exam 19 项 | 已归档 | — |

## 五、落地分层

- **文案层（运营线，配置热加载）**：`agent-guide.yml` 术语表改为两体系口径；`/mycli intro`/`rules` 的任务段按"公会等级 / 技能等级"两组重写；动态看板描述统一"交付委托 → 涨声望"。
- **代码层（开发线）**：晋级分并入声望（单账本）；`angler`/`farmer` 与 AuraSkills 合并（单统计源）；`/mycli journal` 按"公会 / 技能"两组展示全部进行中事项；旧 skill-points 退役迁移到 Vortex 学习点。
- **过渡期**：两套账本并存时，对外只显示合并后口径（声望），晋级分隐藏为内部量。

## 六、验收标准

- 玩家只会被问两个问题："公会几阶了？""技能多少级？"——不再出现"晋级分多少""生活声望几"这类第三种进度。
- `/mycli journal` 两组（公会 / 技能）一屏看清本人全部进度与下一步。
- 钓鱼一次只涨一个等级（fishing），不再同时涨 angler。
- 升段位只需看声望一个数是否达标（证书作为条件另列）。

## 七、体系 B 内部：技能插件盘点与统一（扛枪 2026-11-25 追问"有多少技能插件，是不是也要统一"）

### 7.1 实证盘点：六个插件、四层结构

| # | 插件 | 版本 | 实际角色 | 玩家可见入口 |
| --- | --- | --- | --- | --- |
| 1 | AgentFriend | 0.4.47.59 | 基础技能封装层（`/mycli cast`）；`skills.yml` 内含 23 条已停止成长的旧职业技艺定义 | `/mycli skills list common` |
| 2 | MagicSpells | 4.0-Beta-15 | **基础技能的底层引擎**（不是独立第三套）：`spells-regular` 3 法术（blink/heal/food）+ `spells-agentfriend` 9 法术（selfheal + 8 个 conjure 固定配方）+ `spells-command` 11 个管理类 spell；全部 always-granted，费用由 AgentFriend 从 AuraSkills 魔力代扣 | `/cast list`（**第二个列表入口**） |
| 3 | AuraSkills | 2.4.0 | 11 项熟练度 + 每项多个被动 abilities + mana abilities；**全服唯一魔力池**（统一扣费入口，已是对的） | `/mycli skills list passive` |
| 4 | VortexRPG | 1.2.2-alpha-qd29 | 六职业技能（spells.yml 10 法术：余烬长枪/守望绽放/星界汇聚/幸运步/坚守/奥术飞弹/猎手印记/愈合/野性召唤/机巧锁击）+ 天赋 + 职业等级 | `/mycli profession` |
| 5 | QiandengjiRpg | 0.2.20 | Vortex ↔ AgentFriend 的桥 | — |
| 6 | QiandengjiSmartBlink | 0.1.0 | 自定义闪现法术类（MagicSpells 扩展） | — |

另：AgentFriend 目录下有 7 个技能相关 yml——`skills.yml` / `skill-points.yml` / `spell-mastery.yml` / `professions.yml` / `skill-unlocks.yml` / `skill-visuals.yml` / `skill-assessments.yml`。**注意：这 7 个文件全部被现行代码在启动时加载，不是可删的旧残留**（实证：`ProfessionManager.java:30` 遍历加载前四个、`ProfessionProgression.java:19` 读技能点账本、`SpellMastery.java:37` 读法术熟练度、`SkillVisuals` 读技能特效、`AssessmentCatalog` 读考试定义；`plugin.professions()` 被 CombatRpg/CombatSpells/DungeonManager/SkillAssessments/SkillTome 等 15+ 现行类调用）。10 月"归档"仅指 `skills.yml` 内 23 条旧职业技艺（sword_*/guardian_*/scout_*/healer_*/mage_*/tank_taunt/三机动）**停止成长写入**，文件与其余内容仍是现行数据。真正的混淆源是这 23 条定义仍被 `skills()` 列表遍历展示。

### 7.2 乱在哪（五处实证）

1. **两套引擎一个命令**：`/mycli cast` 同时派发 MagicSpells 基础技与 Vortex 职业技，玩家分不清哪个是基础哪个是职业。
2. **同一技能两个名字两个列表**：`/cast list` 显示 MagicSpells 内部名（blink/heal/conjure_bread…），`/mycli skills list` 显示中文 ID（闪现/圣愈/造物…）——同一个技能两套称呼。
3. **三个技能入口**：`skills list common`（基础）/ `skills list passive`（AuraSkills 被动）/ `profession`（Vortex）——查"我会什么"要跑三条命令。
4. **旧职业技艺定义仍在展示**：`skills.yml` 内 23 条旧四职业技艺（剑士/守护/斥候/治疗/法师/坦克）已停止成长，但仍被 `skills()` 列表遍历——玩家 `/mycli skills list profession` 会看到一批学不了也无效的旧技艺。
5. **两套"花点"**：旧 `skill-points`（23 项）与 Vortex 学习点并存。

### 7.3 统一方案：技能也收敛成两条线（即体系 B 的内部结构）

- **① 基础技能线（人人可用）**：AgentFriend 封装 + MagicSpells 引擎 + AuraSkills 被动/熟练度。对外只保留 **一个入口 `/mycli skills`**（common 与 passive 合并展示）；MagicSpells 退居纯引擎，`/cast list|help` 对普通玩家收口（防双列表），`/cast teach|scroll|spellbook|tome` 维持 op-only（**待验证**：LuckPerms 为 H2 库，权限查询命令异步超时未能实证，按 MagicSpells 默认权限模型判断 teach/forget 为 op-only）。
- **② 职业技能线（Vortex）**：对外只保留 **一个入口 `/mycli profession`**（职业等级 / 职业技能 / 天赋 / 学习点一体展示）。
- **命名统一**：同一技能只一个名字——以 `/mycli cast` 的中文 ID 为准，MagicSpells 内部名不出现在玩家可见处。
- **旧职业技艺退役（代码层，文件不删）**：`skills.yml` 内 23 条旧职业技艺定义由开发层加退役标记并在 `skills()` 列表过滤，玩家账本里残留的旧等级读取加容错（`level()`/`readSkillState()` 对退役 id 返回 0/隐藏）；`professions.yml` 旧四职业同理。**7 个 yml 文件本身是现行数据文件，全部保留。**
- **旧 skill-points 收敛**：旧职业技艺的点数消费随退役一并冻结；基础技能的学习点与 Vortex 学习点统一口径（与 §四 映射表一致）。

### 7.4 落地分层

- **配置层（运营可做，待开发线确认无副作用后执行）**：MagicSpells `spells-command.yml` 的 `list`/`help` 两个 spell-class 改为非 always-granted 或 `enabled: false`——需先确认 AgentFriend 的 `/mycli skills list` 不依赖它们。
- **代码层（开发线）**：`/mycli skills` 合并 common + passive；`/mycli profession` 一体化展示；`skills.yml` 内 23 条旧职业技艺加退役标记并在列表过滤（文件保留，账本读取加容错）；`/mycli cast` 回执标注"基础技 / 职业技"归属。

### 7.5 验收

- 玩家查技能只跑一条命令（`/mycli skills` 基础线、`/mycli profession` 职业线）。
- 同一技能在所有入口只有一个名字。
- `/mycli skills list profession` 不再出现已停止成长的旧职业技艺；玩家账本里残留的旧等级读取不报错（返回 0 或隐藏）。
