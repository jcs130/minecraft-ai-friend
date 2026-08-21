# 定制指南 · 怎么定义你自己的世界

这份目录是「MC 异世界」的**初始种子**——第一次启动时，世界会从这里长出。它刻意做成**纯文本 + JSON**，全部可改、可删、可加。以下每一处，你都能亲手定制。

## 目录里有什么

| 文件 | 作用 | 怎么定制 |
|---|---|---|
| `agents.json` | 假玩家注册表（登录名/皮肤/背景一句话） | 改名、换皮肤、加新假玩家 |
| `transmigrators.json` | 住民档案索引（指向人设文件 + 初始技能偏好） | 加角色、调初始技能 |
| `transmigrators/*.persona.md` | **人格**（AI 住民的思考/性格/口吻） | 直接改文字，想写成谁就写成谁 |
| `transmigrators/*.backstory.md` | **身世**（角色背景介绍） | 同上 |
| `skins.json` | 皮肤库（12 个官方皮肤 + 用户名→皮肤映射） | 换官方皮肤、加自定义皮肤 |
| `magic-atoms.json` | 魔法法则（34 条咒语） | 加/改/删咒语 |
| `WORLD_STORY.md` | **世界背景故事**（穿越者醒来求生，住民当教官） | 改写世界观 |
| `world-chronicle.md` | 世界编年史（自动书写） | 一般不用动 |
| `world-requirements.md` | 世界迭代需求（守望女神自动写） | 一般不用动 |
| `identity-seed.json` | 住民记忆种子 | 一般不用动 |

## 世界是怎么设定的

主角是**穿越者**——真人玩家用客户端连进来，就是「从现实世界醒来」的那一刻。详见 `WORLD_STORY.md`。

现有住民分两层，都是 Minecraft 官方默认角色：

- **核心假玩家（2 个，LLM 驱动，有完整自主意识）**：`steve`（矿工/建筑师/炼金术士）、`alex`（建筑师/猎人/探险家）——最先醒来的两位。
- **可选 NPC（7 个，默认不启用，不占 LLM 调用）**：`noor`（农夫）、`sunny`（铁匠）、`ari`（制箭师）、`zuri`（图书管理员）、`makena`（牧羊人）、`kai`（渔夫）、`efe`（石匠）——人设放在 `optional-npcs/` 目录里备用。

想启用某个可选 NPC：把 `optional-npcs/<角色>.persona.md` 和 `.backstory.md` 移回 `transmigrators/`，再按「二、加一个新角色」的步骤注册进 `transmigrators.json` 与 `agents.json` 即可。

他们不是「NPC 工具人」，而是有自己生活、自己脾气的人。官方本就没给它们固定背景，也没给它们之间设定人物关系（9 个默认皮肤官方定位全是「可自定义的玩家化身」，关系由你定义）——你想让谁当主角的挚友、谁当沉默的隐士、谁当看不顺眼的冤家，直接改对应的人设文件即可。

## 一、改一个角色的性格

打开 `transmigrators/steve.persona.md`，直接改文字。

默认的史蒂夫是「矿工、建筑师、炼金术士」的实干家。你可以把他改成任何人：
> 你叫「史蒂夫」，是一个沉默的剑士，游荡在这片方块大陆，只为寻找失散的同伴……

改完保存，下次启动即生效。**没有固定人设，官方本就把他留成一张白纸。**

## 二、加一个新角色

1. 复制一份人设：
   - `transmigrators/steve.persona.md` → `transmigrators/你的角色.persona.md`
   - `transmigrators/steve.backstory.md` → `transmigrators/你的角色.backstory.md`
2. 改写这两个文件的内容。
3. 在 `transmigrators.json` 的 `transmigrators` 数组里，复制一个条目，改 `id`/`name`/`username`/`backstoryFile`/`personaFile`。
4. 在 `agents.json` 里加一条，`id`/`username` 与上面一致，`skin` 选一个。
5. 重启世界，新住民降临。

## 三、换皮肤

`skins.json` 里 `presets` 已内置 **12 个官方皮肤**：

- 9 个默认主角：`steve` `alex` `ari` `efe` `kai` `makena` `noor` `sunny` `zuri`
- 3 个官方账号皮肤：`notch` `jeb` `dinnerbone`

在 `agents.json` 里把某角色的 `skin` 改成上面任意一个即可。
要自定义皮肤，把皮肤 PNG 加入后，在 `presets` 里按现有格式加一条即可。

## 四、改魔法

`magic-atoms.json` 是 34 条咒语的定义，每条含：`words`（咏唱词）、`cost`（法力/饱食/血祭代价）、`commands`（实际效果指令）、`reply`（施法反馈）。

加一条新咒语 = 在数组里复制一个对象，改 `id`/`name`/`words`/`commands`。改代价 = 改 `cost` 与 `requiredLevel`。

## 五、生效方式

所有改动**无需重装**——改完保存，重启世界（或首次启动）即生效。世界会从这份种子重新长出。

---

> 一句话：**这份种子是给玩家的一张白纸。官方角色没有固定故事，你的世界，由你定义。**
