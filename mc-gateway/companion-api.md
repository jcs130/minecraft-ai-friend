# 玩家伴侣系统 —— mc-gateway API 契约

> 2026-08-23 定谳。给贾维斯门户客户端的权威接口说明，与 `GODDESS_HANDOFF.md` 同源。
> 服务端实现：`mc-gateway/mc_gateway.py`（已落地，E2E 实测通过）。文档以服务端代码为准。

## 一、定位（一句话）

每个真人玩家配一个**专属小助手（伴侣）**：无实体 AI agent（不占游戏连接/实体、零性能负担）、一对一绑定、始终跟随所在角色、数据经 mc-gateway 转门户客户端。伴侣**私有**——只服务绑定账号，别的账号看不到。

**女神 vs 伴侣**：女神 = 全服神格（祈愿/供奉/神谕）；伴侣 = 单真人私有系统（提醒/导航/标记/陪伴）。互补不混同。

## 二、角色绑定（账号↔游戏角色）

账号与游戏角色**一对多**（一个门户账号可绑多个游戏内角色，激活哪个用哪个）。绑定的是**真人玩家登录名**（ASCII），**拒绝** numen 假玩家（Goddess/Kirito/Naruto/Edward 等穿越者 bot）。

### `GET /api/user/characters`
列出当前账号所有角色。
```json
{"characters":[{"id":1,"name":"太郎","mc_username":"taro","class":"战士","is_active":1,"created_at":"..."}]}
```

### `POST /api/user/characters`（绑定角色）
请求：`{"name":"太郎","mc_username":"Taro","class":"战士"}`
- 校验 `mc_username` 必须是真人玩家登录名（`is_human`），否则 `400 {"error":"mc_username must be a real player login"}`。
- 同一账号同一 `mc_username` 不可重复绑定（`409`）。
```json
{"ok":true,"id":1,"name":"太郎","mc_username":"taro","class":"战士"}
```

### `POST /api/user/characters/activate`
请求：`{"id":1}`。把该角色设为当前激活（伴侣跟随它）。`404` 若角色不属于该账号。
```json
{"ok":true,"active_id":1}
```

## 三、伴侣绑定（一对一）

### `GET /api/companion/state`
当前账号是否已绑伴侣 + 配置。
```json
{"bound":true,"cname":"小灯","personality":"{\"tone\":\"温和\",\"style\":\"提醒\"}","enabled":1,"created_at":"...","updated_at":"..."}
```
未绑：`{"bound":false}`。

### `POST /api/companion/bind`
请求：`{"cname":"小灯","personality":{"tone":"温和","style":"提醒"}}`
绑定/更新伴侣（upsert，`cname` ≤24 字符，`personality` 为对象，最大 2000 字符）。
```json
{"ok":true,"bound":true,"cname":"小灯"}
```

## 四、伴侣世界视图（核心数据链路）

伴侣的「眼睛」——抓当前账号**激活且在线**角色的实时数据（坐标/血量/等级/呼吸/维度）。只看自己，不多看别人。

### `GET /api/companion/world`
```json
{
  "bound":true,
  "ok":true,
  "player":{"username":"taro","online":true,
            "pos":{"x":3096.7,"y":75.0,"z":-1343.3},
            "health":"9.333334","level":"5","air":"300","dimension":"minecraft:overworld",
            "character":"太郎","character_id":1,"class":"战士"},
  "characters":[{"id":1,"name":"太郎","mc_username":"taro","class":"战士","is_active":1}]
}
```
- `ok:false` 且 `reason:"companion_not_bound"` = 未绑伴侣；`player:null` = 无在线角色（伴侣暂时无事可做）。
- 字段索引：`username`/`online`/`pos{x,y,z}`/`health`/`level`/`air`/`dimension`（均来自服务端 RCON `data get entity`）。
- **周边地形/资源为二期**：数据源 = 世界进程（女神 mineflayer bot）的「侦察扫描」，产出结构化 JSON，经此端点转发（契约见附表，待世界端接入）。

### `POST /api/companion/activate`
激活伴侣（标记聚焦当前在线角色）。无在线角色时 `{"ok":false,"reason":"no_online_character"}`；成功 `{"ok":true,"focused":{...player...}}`。

## 五、伴侣对话

### `POST /api/companion/chat`
请求：`{"text":"我还有多少血"}`。MVP 用模板答话（无实体 agent）；后续接世界/LLM。
```json
{"bound":true,"reply":"［小灯］我在你身边。有啥事，说一声。"}
```
未绑：`{"bound":false,"reason":"companion_not_bound"}`。

## 六、鉴权

所有 `/api/user/*` 与 `/api/companion/*` 均需 `Authorization: Bearer <token>`（登录返回）。未授权 `401`。

## 七、服务端数据流（本次已落地）

- `characters` 表加 `mc_username`（ASCII 登录名），`companions` 表（user_id 唯一，一对一）。
- `is_human(login)` 排除女神/穿越者 bot（Goddess/Kirito/Naruto/Edward/Steve/Alex 等）——只认真人。
- `player_snapshot(login)` 用 RCON `data get entity <login> <Pos|Health|XpLevel|Air|Dimension>` 逐字段取实时值。
- `current_player_view(user)` = 账号激活角色里在线者的快照（**只看自己**）。
- `/api/user/info` 的 `online` 字段已由「全服名单」改为 `current_player_view(user)`（用户拍板语义：只看自己已连接角色）。
