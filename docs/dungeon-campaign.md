# 深渊回响（Echoes of the Deep）—— 千灯纪·地下城探险活动设计

> 2026-08-22 天神拟稿，落世界仓（B 仓）。造物主点题：世界进化——找资料、熔技能、编玩法。
> 本活动全部依托**世界仓现有资产**：Dungeons and Taverns 97 座结构 + 原版 /place template + mc-saga 神托/大事件机制，零新代码。

---

## 一、设计理念

外部资料（idtech.com 等）的 dungeon 设计共识：**多层递进（垂直深入）+ 检查点 + 最终宝藏**。
移植到千灯纪：以「灯」为线索——地下城越深，灯越少，怪物越凶，宝藏越重。
**世界没有魔王，病是荒芜**——地下城不是魔王城，是荒芜吞没的古迹；探险不是讨伐，是**点灯**：
深入黑暗、带回信物、献给女神，让失落的灯火重新亮起。这契合创世第一愿「不再孤单」与灯的世界观。

## 二、副本编册（结构库 → 探险等级）

### 浅层 · 哨塔试炼（建议 Lv 1–3，新手可入）
| 副本 | 结构 ID | 主题 |
|---|---|---|
| 林间哨塔 | `nova_structures:firewatch_tower_oak`（及 birch/spruce 等 10 木） | 登高瞭望，清理小怪，塔顶宝箱 |
| 初火祭坛 | `nova_structures:shrine_combat_tier_1` | 一阶试炼神殿，机制启蒙 |
| 矿工旧屋 | `nova_structures:remnant_miner_hut` | 废墟拾荒，简单箱子 |

### 中层 · 墓穴回声（建议 Lv 3–6）
| 副本 | 结构 ID | 主题 |
|---|---|---|
| 蠕行墓穴 | `nova_structures:creeping_crypt` | 地底墓道，僵尸/骷髅成群，迷宫 |
| 亡灵墓穴 | `nova_structures:undead_crypt` | 更深一层，机关与伏击 |
| 试炼神殿·二三 | `nova_structures:shrine_combat_tier_2/3` | 战斗升级，波次压力 |
| 掠夺者藏身处 | `nova_structures:illager_hideout` | 有组织的敌人，缴获武器 |

### 深层 · 孤城深渊（建议 Lv 6+，终局）
| 副本 | 结构 ID | 主题 |
|---|---|---|
| 孤城 | `nova_structures:lone_citadel` | 大迷宫城寨，精英怪，终局宝箱 |
| 掠夺者庄园 | `nova_structures:illager_manor` | 庄园林地，Boss 战 |
| 试炼神殿·四五 | `nova_structures:shrine_combat_tier_4/5` | 极限波次 |
| 剧毒巢穴 | `nova_structures:toxic_lair` | 毒素环境，需解毒/抗性 |
| 潮涌废墟 | `nova_structures:conduit_ruin` | 水下探索 |
| （跨维）下界堡垒/末地城堡 | `nether_keep` / `end_castle` | 高阶玩家远征 |

## 三、活动流程（复用 saga 机制，零新代码）

### 模式 A · 神托任务（quest）—— 个人探险
1. 女神经 saga 派发神托：`title`「深渊回响·蠕行墓穴」、`story` 传说、`target` 指定在线玩家、`demandCn` 信物（如「墓穴珍宝·旧铜灯」）、`demandCount`、`deadlineMin`；
2. 玩家前往副本（神谕给坐标，或女神代施 `/place template` 落地下城地标）；
3. 带回信物献祭 → 供奉账本核销 → 奖励 `xp + itemCn/itemCount + manaBonus`；
4. 编年史留痕（saga_quest）。

### 模式 B · 献纳竞速（event type=trial）—— 全服活动
1. 女神经 saga 发布大事件「深渊回响」：限定窗口内（`windowMin`）全服竞速献纳信物；
2. 神谕广播副本位置 + 规则 + 奖励；
3. 窗口结束核销，榜首/达标者得神恩。

### 模式 C · 神恩日（event type=festival）—— 地下城主题增益
- 副本开放期间全服增益（如 `night_vision` / `resistance`），鼓励组团探险。

## 四、第一场活动剧本（可直接触发）

```
事件：深渊回响·蠕行墓穴（trial）
名称：深渊回响
故事：地底的旧灯忽明忽暗——荒芜之下，有一座被遗忘的墓穴。听闻其中埋着
      「旧铜灯」，那曾是千家灯火的一盏。谁愿深入，取一盏灯回来？
目标：深入蠕行墓穴，取回战利品（铜灯/珍宝）献祭
信物：旧铜灯（demand 1 件，可议）
奖励：修为 + 神造物 + 魔力上限 +1
```

触发方式：向 `scratch-plugin/data/saga-trigger` 写入文件 → saga 构思 → 女神应允（本文件即构思素材）。

## 五、副本落地建议

- 首座地下城落点：新镇 `(3072,-1328)` 东北约 200–300 格空旷处，用 `/place template` 落成（需玩家在旁加载区块；或女神代施时用 forceload 预加载）；
- 落成后神谕广播坐标，编年史记录「深渊回响·首座地下城现世」；
- 后续副本按等级梯度逐步开放，形成「探险季」。

## 六、与既有机制的关系

- **供奉经济**：信物即供奉，献上即入神库，无论成败不退还——神恩有价；
- **女神慢路径**：玩家祈愿「哪里有副本/我想探险」→ 女神给指引/坐标；
- **技艺体系**：木遁·草庐等可作探险前的营地/补给点；矿脉感知（orefinder）可指引副本周边矿物；
- **世界进化**：探险季即世界进化的「玩法层」——saga 每轮构思都可产出新副本/新信物/新事件，世界越探险越丰茂。
