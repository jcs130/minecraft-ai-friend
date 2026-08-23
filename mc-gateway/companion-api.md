# 玩家伴侣「系统」—— mc-gateway API 契约

> 2026-08-23 定谳。给贾维斯门户客户端的权威接口说明。
> 服务端实现：`mc-gateway/mc_gateway.py`（已落地，E2E 实测通过）。文档以服务端代码为准。

## 〇、核心定位（一句话）

**「系统」运行在客户端本地**（大模型在客户端跑），mc-gateway（服务端）是它的**权威档案 + 权限管控 + 数据供给 + 指令下发**。每个真人玩家一个**私有无实体观察者 AI 系统**——像《转生史莱姆》里的大贤者：随时分析、按级别解锁权限、能升级、长技能。

- **客户端（门户内嵌伴侣面板 / 独立系统客户端）**：本地跑大模型，可配置性格（personality）、模型（model）。负责分析、升级响应。
- **服务端（mc-gateway / 创世天神）**：存系统档案（等级/经验/技能/权限/模型快照），从 RCON/世界端拉数据，按级别派生权限，向客户端下发系统指令。**服务端是权限权威**，客户端大模型只能动用权限集内的能力。

**女神 vs 系统**：女神 = 全服神格（祈愿/供奉/神谕）；系统 = 单真人私有 AI 助手。互补不混同。

## 一、系统等级/权限/技能模型（权威定义）

按级别（level）派生权限集（`permissions`），客户端大模型据此判断能用多少服务端能力。**升级曲线**：每级需 `level*100` 经验，升到 Lv5 封顶。

| Lv | 阶名 | 解锁权限 | 说明 |
|---|---|---|---|
| 1 | 观察者 | `world_view` | 能看到世界与自身状态 |
| 2 | 分析者 | + `analyse` | 分析周边地形/资源/村庄/危险（需世界端扫描） |
| 3 | 影响者 | + `pray` | 代表玩家向女神上达祈愿/代施 |
| 4 | 施法者 | + `suggest` | 建议/触发法术咏唱 |
| 5 | 大贤者 | + `oracle` | 全服公共情报 + 女神级洞察 |

`skills_unlocked` = 已解禁技能 ∪ 当前 level 派生权限。权限是**累进**的（Lv2 含 Lv1 全部）。

## 二、角色绑定（账号↔游戏角色，一对多）

绑定的是**真人玩家登录名**（ASCII），拒绝 numen 假玩家（Goddess/Kirito/Naruto/Edward 等）。

### `GET /api/user/characters`
```json
{"characters":[{"id":1,"name":"太郎","mc_username":"taro","class":"战士","is_active":1,"created_at":"..."}]}
```

### `POST /api/user/characters`（绑定角色）
请求：`{"name":"太郎","mc_username":"Taro","class":"战士"}`
- 校验 `mc_username` 必须是真人（`is_human`），否则 `400 {"error":"mc_username must be a real player login"}`。
- 同账号同 `mc_username` 不可重复（`409`）。
```json
{"ok":true,"id":1,"name":"太郎","mc_username":"taro","class":"战士"}
```

### `POST /api/user/characters/activate`
请求：`{"id":1}`。设该角色为当前激活（系统聚焦它）。`404` 若非本账号。

## 三、系统绑定 + 配置（客户端）

### `GET /api/companion/state`
返回完整系统档案（含 level/权限/技能/模型快照）。
```json
{"bound":true,"cname":"大贤者","enabled":true,"model":"qwen3-27b",
 "level":2,"xp":50,"auto_assigned":false,
 "tier":"分析者","tier_desc":"能分析周边地形/资源/村庄/危险",
 "skills":[],"skills_unlocked":["analyse","world_view"],
 "permissions":["analyse","world_view"],
 "personality":"{\"tone\":\"冷静\",\"style\":\"分析\"}"}
```
未绑：`{"bound":false}`。

### `POST /api/companion/bind`（绑定/更新，可配置）
请求：`{"cname":"大贤者","personality":{"tone":"冷静","style":"分析"},"model":"qwen3-27b","auto_assigned":false}`
- `cname` ≤24，`personality` 为对象（≤2000 字符），`model` 客户端配置的模型 id（≤64），`auto_assigned` 是否系统自动分配。
返回同 `state`（系统档案）。

## 四、世界视图（系统拉数据）

系统的「眼睛」——抓当前账号**激活且在线**角色实时数据。只看自己。

### `GET /api/companion/world`
```json
{"bound":true,"ok":true,
 "player":{"username":"taro","online":true,"pos":{"x":3096.7,"y":75.0,"z":-1343.3},
   "health":"9.333334","level":"5","air":"300","dimension":"minecraft:overworld",
   "character":"太郎","character_id":1,"class":"战士"},
 "characters":[{"id":1,"name":"太郎","mc_username":"taro","class":"战士","is_active":1}]}
```
- `ok:false` + `reason:"companion_not_bound"` = 未绑；`player:null` = 无在线角色。
- **周边地形/资源为二期**：数据源 = 世界端（女神 mineflayer bot 侦察扫描）产出结构化 JSON。

### `POST /api/companion/activate`
聚焦当前在线角色。无在线 → `{"ok":false,"reason":"no_online_character"}`。

### `POST /api/companion/chat`
请求 `{"text":"分析周围危险"}`。系统跑在客户端本地，服务端**把意图 + 世界上下文**转发（`context` 字段按权限决定含多少）。MVP 给模板回执。
```json
{"bound":true,"reply":"［大贤者·分析者］我在你身边。有权限级别 2 能看，你说。",
 "intent":"分析周围危险",
 "context":{"system":{...系统档案...},"world":{...世界视图(按权限)...}}}
```

## 五、服务端→客户端「系统指令」队列

服务端是权威：升级/解锁/自动分配时，服务端**下发指令**，客户端轮询拉取、处理完 ack。指令去向：`auto_assign` / `level_up` / `unlock_skill` / `permission_grant`。

### `GET /api/companion/commands`（轮询拉取）
```json
{"commands":[{"id":1,"type":"level_up","payload":"{\"from\":1,\"to\":2}","created_at":"..."}]}
```

### `POST /api/companion/commands/ack`
请求 `{"id":1}`。确认已处理 → 指令出队。`404` 若非本账号/不存在。
```json
{"ok":true,"acked":1}
```

### 服务端触发入口（世界端/女神侧调用）
- `push_system_command(user_id, type, payload)`：入队指令。
- `grant_xp(user_id, amount)`：加经验；若跨级自动入队 `level_up` 指令。升级曲线 `level*100`，Lv5 封顶。

## 六、鉴权

所有 `/api/user/*` 与 `/api/companion/*` 需 `Authorization: Bearer <token>`（登录返回）。未授权 `401`。

## 七、服务端数据流（本次已实现）

- `companions` 表升级为系统档案（`model/level/xp/skills/permissions/auto_assigned`）+ `companion_commands` 指令队列表。均幂等迁移。
- `system_profile(row)` 展开档案；`system_tier_perms(level)` 按级派生权限；`SYSTEM_TIERS`/`SYSTEM_SKILLS` 为权威定义。
- `push_system_command`/`grant_xp` 为服务端触发「升级/指令」的入口。
- `/api/user/info` 的 `online` 已改为 `current_player_view(user)`（只看自己在线角色）。
