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
