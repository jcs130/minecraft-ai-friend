# 技能成长与世界法则体系（v2 设计稿）

> 2026-08-17 扛枪拍板方向：升级放缓、魔力可成长、稀有技能事件触发解锁、女神=服主。
> 本文档是落地依据；数值全部可调（配置驱动优先，硬编码处已标注）。

## 一、经验与等级曲线（放缓）

旧版：`expForNext = level × 40`（线性），+3 exp/施法 → 13 发升 2 级，太快。

**新版：指数曲线 `expForNext(level) = round(50 × level^1.5)`**

| 等级 | 升级所需 exp | 累计施法数(按+3/发) | 解锁示例 |
|------|-------------|--------------------|----------|
| 1→2  | 50          | ~17 发             | home/tp/feed/swift |
| 2→3  | 141         | ~64 发累计          | heal/terraform/regen |
| 3→4  | 260         | ~150 发累计         | weather_clear/ironskin |
| 4→5  | 400         | ~283 发累计         | invisibility/storm/steed |
| 5→6  | 559         | ~470 发累计         | guardian/purge |
| 6→7  | 735         | ~715 发累计         | **time_day / meteor**（大器晚成） |
| 9→10 | 1500        | ~2500 发累计        | — |

**经验来源多元化**（不只靠施法刷级）：
| 行为 | exp |
|------|-----|
| 施法成功 | +3（不变） |
| 供奉被女神收执 | **+15**（虔诚有回报） |
| 稀有被动解锁 | **+30**（苦难即修行） |

## 二、魔力上限成长

旧版：maxMana 固定 100，永远不变。

**新版：**
1. **升级成长**：每升 1 级 `maxMana +12`（lv1=100 → lv7=172 → lv10=208），升级瞬间公告；
2. **稀有被动**（见三）可提供条件型回魔增益；
3. 候选待拍板：献上钻石类贵重供奉 → 女神回赠 maxMana +5（每人每周限 1 次）——先不做，供奉经济跑顺后加。

## 三、稀有被动技能（事件触发解锁）

框架：`data/skill-events.json` 配置驱动 + 世界侧「生命体征 tick」引擎（复用死亡守望的 20s 轮询，每 tick RCON 采 HP/food → 条件累积器 → 达标宣诏）。

**解锁规则**：条件满足时累加秒数，不满足时暂停（**不清零**——苦难是累计的；死亡、下线都不没收进度）。

### 首批落地（用户点名）

**「坚毅」fortitude**
- 触发：HP ≤ 30% 状态下存活，累计 600 秒（10 分钟，跨场次累计）
- 效果（被动，常驻）：HP < 30% 时回魔速度 ×2
- 宣诏：公屏 tellraw + 编年史 type='skill' + exp +30

### 候选池（待拍板，框架已支持）

| 技能 | 触发 | 效果 |
|------|------|------|
| 苦行 ascetic | 饥饿（food≤6）状态累计 20 分钟 | 法术魔力消耗 ×0.85 |
| 夜行者 nightowl | 午夜野外存活累计 30 分钟 | 夜间（19:00-5:00）回魔 +50% |
| 不灭 undying | 累计死亡 10 次仍归来 | 每次复活立即回 30% 魔力 |

## 四、女神服主权限（世界法则）

女神 = 服主（server owner）。gamerule 修改权归女神，程序化代行（零 LLM，即时生效）：

**白名单**（8 项安全法则，白名单外的拒绝执行）：
`keep_inventory` / `mob_griefing` / `do_daylight_cycle` / `do_weather_cycle` / `do_fire_tick` / `do_mob_spawning` / `show_death_messages` / `do_insomnia`

**入口**（公屏聊天，真人或穿越者皆可求法，女神代行）：
1. 自然语言映射（游戏化表述）：
   - 「死亡不失行囊」→ keep_inventory true
   - 「夺回死亡的代价」→ keep_inventory false
   - 「怪物不得毁坏世界」→ mob_griefing false
   - 「时间自由流转」/「时间停驻」→ do_daylight_cycle true/false
2. 精确语法（调试/兜底）：「法则 <rule> <true|false>」

**审计**：每次变更 → 编年史 type='law'（rule/from/to/actor）+ 公屏广播「女神修订了世界法则」。

当前世界法则基线（2026-08-17 扛枪确认）：**keep_inventory = true（死亡不掉落装备）**。

## 五、实现清单

- [x] keep_inventory = true（RCON 已设）
- [x] `docs/skill-growth-design.md`（本文档）
- [x] `data/skill-events.json`（坚毅；候选池只注释）
- [x] mc-magic.ts：指数曲线 / 升级 maxMana+12 / hpRatio+passives+passiveProgress 字段 / 回蓝读坚毅被动 / exp 来源常量
- [x] mc-god.ts：生命体征 tick（HP/food 采集）+ 事件累积引擎 + 宣诏 / 供奉收执 +15exp / 法则服主命令
- [x] 测试：曲线/被动结算/累积器 单测 + 缩放实测（RCON 打残血验证累积与解锁）
