# 女仆身体持久化与守卫（2026-09-17）

结衣反复消失的根因定谳，以及随之落地的三道防线：原生持久化标记、身体守卫、TLM 备份集成。
与 [原生身体更新](COMPANION-BODY-TICKING.md) 互补——那篇解决「已加载却不跟随」，本篇解决「根本没留下」。

## 根因

全服 4 名女仆只有结衣反复消失。此前一度据 `debug.log` 里她的 `SpellBookManager` 创建/移除记录判断
「她还在，只是区块没加载」，因此把排查方向放在区块与加载票上。

实际对照两名女仆的原版标记后定谳：

```
结衣   data get entity <yui-uuid>  PersistenceRequired  ->  0b
酒狐   data get entity <wine-uuid> PersistenceRequired  ->  1b
```

原版语义：未设置 `PersistenceRequired` 的实体，其所在区块保持未加载一段时间后会被服务器从内存中
**正常回收**——不是丢失、不是异常、不是区块问题。日志里的创建/移除正是回收与重建本身，被误读成
「她还在」。其余女仆因为带这个标记而幸存，构成唯一差异。

对照命令即排查手段：**凡「实体莫名消失」，先对存活实体与失踪实体做这条 `PersistenceRequired` 对照。**

## 改动

1. **原生持久化（`CompanionProtection.java`）。** 四条守卫路径——`onJoin` / `onAttack` /
   `onDeath` / `onMaidDeath`——在原有 `setEntityInvulnerable(true)` 之外一并执行
   `setPersistenceRequired()`。状态输出新增 `nativePersistenceRequired`，并把原先硬编码为 `false`
   的 `removalGuard` 改为与事实相符的判定。该类仍不移动、不重建、不改名、不按定时器治疗、不调模型。
   实测：`qdmaid protection_status` 返回 `nativePersistenceRequired:true`、`removalGuard:true`。

2. **身体守卫（`world/sidecar/maid_guardian.py`，npc 侧车线程）。** 按 UUID 观察授权身体，
   仅在**连续 5 拍**查询未命中后重召；任何一拍命中即清零。这一阈值直接沿用 `heal_npcs` 的
   R011 教训——单次 `data get entity` 未命中可能只是区块未加载，而「每拍 miss 即重召」的朴素写法
   曾产出 259 只重复村民。守卫另含：每日重召上限、无锚点不盲召、绝不传送或改动活体、
   对已加载但标记丢失的身体就地补标记（`data modify entity <UUID> PersistenceRequired set value 1b`）。
   重召命令始终携带 `PersistenceRequired:1b` 与完整授权身份——否则重召一次会被再次回收一次。
   12 项单元测试覆盖：连续未命中不重召、第五拍重召、命中清零、标记修复、关闭/损坏配置不动作、
   超限不重召、无锚点不盲召、回执记录备份来源。

3. **TLM 备份集成。** npc 容器新增只读挂载 `server/mc/shadow/data/maid_backups`（`MAID_BACKUP_DIR`）。
   每次重召的回执记录当时最新备份文件作为恢复来源存档。备份机制本身已由
   `MaidBackupIntervalSeconds = 180` 生效中，实测每 3 分钟产出一份、每名女仆保留 3 份。

## 验收

- 结衣实体：`PersistenceRequired=1b`、`Invulnerable=1b`、`health=20.0`、`loaded=true`。
- `qdmaid protection_status`：`configMatched` / `damageGuard` / `deathGuard` / `removalGuard` 全 true。
- 守卫线程：npc 心跳 `threads.maid-guardian = true`；状态文件 `{"misses":0,"lastResult":"present"}`。
- 备份读取：容器内实测取到最新备份 `2026-09-17-13-43-06.dat`（1763 B，66 秒前）。
- 守卫修复命令语法：`data modify entity <UUID> ...` 在真服返回「值已相同」，证明 UUID 解析成立。
- 相关测试 69 项通过（含女仆守卫 12 项与身体自愈回归）。

**未被验证的部分**：真实的「丢失 → 5 拍 → 重召」全链路尚未在生产触发（需先令她真丢一次）。
单元测试覆盖该逻辑，但生产未跑过；不因此宣称该分支已在生产生效。

## 部署路径

经项目正门：`tools/build_maid_bridge.py`（编译 + 214 项契约测试）→ 停 `qiandengji-mc-1` →
`tools/deploy_character_extensions.py --maid-only --apply qiandengji`（自动全量备份世界至
`runtime/character-integration-backups/<UTC 时间戳>/`，jar 落 `server/mc/mods` + `client/mods` +
`vendor` 缓存三处并逐一校验 sha256）→ 启服。新 jar `0ae2f222b0f5b0602aae4222e50c7798cad579aa944e8459a781cda857c048e7`。
npc 侧车因新增挂载与环境变量经 `docker compose up -d npc` 重建（`restart` 吃不到新挂载）。

同一次停服重启顺带构成身体自愈机制的实战检验：桐人自动
`body-reconnect: online / restored_identity_verified`、`pauseReason=None`、控制器恢复 thinking、
决策继续——「身体丢失 → 暂停 → 自动恢复 → 自动续跑」全程无人干预闭环。

## 配置域

| 配置 | 位置 | 读取方 |
| --- | --- | --- |
| `qiandeng-companion-protection.json` | `server/mc/config/` | Java 原生 mod |
| `companion-guardian.json` | `server/mcdata/village/` | npc 侧车（容器内 `/mcdata/village/`） |

npc 容器不挂 `server/mc/config`，两侧配置不同域——女仆守卫配置放错位置会静默不生效。
