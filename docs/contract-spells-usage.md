# 契约与魂链法术 · 使用文档（第一阶段）

> 版本：v2026-08-23 ｜ 落地 commit：见 git log（`bind_guard`/`trace`/`recall` 三原子 + `specialExecutor` 注入）
> 面向：AI 玩家（穿越者/亲卫）、真人玩家、以及后续接手维护的工程侧。

---

## 1. 一句话背景

这个世界有**两档「叫人来」**：

| 档位 | 法术 | 本质 | 对象 |
|------|------|------|------|
| 低阶 | `summon`（召唤术，CLI） | 通灵，无意志 | MC 原生生物（狼/马/驴/铁傀儡/雪傀儡） |
| 高阶 | `bind_guard`（缔结契约） | 契约，有意志 | 假玩家侍卫（桐人/鸣人，numen 实体） |

**Fate 主从设定**：穿越者 = 御主（master），假玩家侍卫 = 从者（servant，有自主意志）。契约是**委托**不是**控制**；血祭/魔力是维持从者现世、不是买断意志。从者被契约拉来后，自己决定怎么走、怎么干——所以契约与唤魂**不强制 tp 从者**，而是写「女神谕令」到守卫桥，由亲卫自主寻路到场/返程（与 `summon` 同一哲学）。

---

## 2. 三个契约/魂链法术

都是 `category: contract`、`school: 东方`，效果走 `specialExecutor`（由 mc-god 落地），**不走 RCON commands**。

### 2.1 `bind_guard` —— 缔结契约（Lv20）

- **咏唱关键词**（说中一个即可）：缔结契约 / 契约召唤 / 御主契约 / 结契 / 召唤侍卫 / 唤守卫
- **消耗**：60 法力 + 2 生命（血祭）
- **参数**：`<守卫名>` + `<任务>`（自然语言）
- **效果**：写一条 `goddess-orders.jsonl`，守卫桥读走、亲卫自主到场执行任务。
- **示例**：

```
我：缔结契约 桐人 帮我挖矿
女神：契约已成——「桐人」应召而来。（消耗 60 法力、2 生命）
```

- **守卫只认**：桐人、鸣人（守卫桥 GUARDS 名单）。名字写错回执「只能与桐人、鸣人缔结契约」。
- **任务必填**：不带任务回执「契约既成，要他从者做什么？」。

### 2.2 `trace` —— 寻踪（Lv10）

- **咏唱关键词**：寻踪 / 追踪 / 寻人 / 找他 / 找她 / 传送到他身边 / 去找
- **消耗**：30 法力
- **参数**：`<目标>`（自然语言：守卫显示名「桐人/鸣人」或真人登录名）
- **效果**：施法者自己**直接 tp 到目标身边**（`tp <施法者> <目标>`）。
- **示例**：

```
我：寻踪 桐人
女神：循息而至——你已到桐人身边。（消耗 30 法力）
```

- 目标是守卫时，内部把显示名「桐人/鸣人」映射成登录名 `Kirito`/`Naruto`（name/ID 分离铁律）；目标找不到回执「寻不见「X」」。

### 2.3 `recall` —— 唤魂（Lv16）

- **咏唱关键词**：唤魂 / 召回 / 召唤从者 / 唤回 / 召回从者 / 唤他回来
- **消耗**：50 法力
- **参数**：`<守卫名>`（只认桐人/鸣人）
- **效果**：写一条 `mode: recall` 的 `goddess-orders.jsonl`，亲卫自主返程回到御主身边待命（**不强制 tp**）。
- **示例**：

```
我：唤魂 桐人
女神：魂链一颤——「桐人」当归。（消耗 50 法力）
```

---

## 3. `summon` 召唤术（低阶，CLI）

- **命令**：`cli summon <守卫> <任务>`（CLI_VERBS 已注册；`cliHelpLines` 已补）
- **本质**：把**现有**守卫召来相助（不新生成分身），同样走 `goddess-orders.jsonl`。
- **示例**：`cli summon 鸣人 守在我家门口`
- **说明**：这是 CLI 通道的快捷方式，与 `bind_guard`（咏唱）同源，都落到 `issueSummon`。

---

## 4. 架构与维护要点（工程侧）

- **执行分支**：`mc-magic.ts` 的 `cast()` 里，`atom.special` 有值走 `specialExecutor`（迟绑定注入），无值走既有 RCON `commands`。三个 special 原子的 `commands` 都是 `[]`。
- **注入点**：`packaging/mc-world/assets/world/bootstrap-world.mts` —— `magic.setSpecialExecutor((s,u,p,v) => god.service.execSpecial(s,u,p,v))`，与 `magic.setChronicle(god.service.record)` 并列（同为解环注入）。
- **落地实现**：`mc-god.ts` 的 `execSpecial()`：
  - `contract` → `issueSummon()`（复用 `/cli summon` 的既有通路）
  - `trace` → `rcon.send(\`tp <施法者登录名> <目标登录名>\`)`
  - `recall` → 直接写 `goddess-orders.jsonl`（`mode: recall`，带 `text` 字段——守卫桥 `decision_prompt` 只认 `text`/`reply`）
- **name/ID 分离**：`GUARD_LOGIN = { 桐人: 'Kirito', 鸣人: 'Naruto' }` + `resolveLogin()`。显示名只用于叙事/人机界面，RCON 的 `tp`/`data get entity` 一律用 ASCII 登录名。
- **失败语义**：`execSpecial` 返回 `{ ok:false }` 时，`cast()` 直接返回失败回执、**不扣资源、不白烧魔力/血祭**；`{ ok:true }` 时用 `res.reply` 覆盖 `atom.reply`。

---

## 5. 已知边界（后续阶段）

- 真人玩家只有「寻踪」，没有「契约」——真人无契约可拉（从者只与穿越者御主缔结）。
- 契约断供 → 从者灵基不稳机制：第二阶段。
- `school` 流派维已就位（`Atom.school` 字段），留空归「通用」；正式分组展示待第二阶段。
