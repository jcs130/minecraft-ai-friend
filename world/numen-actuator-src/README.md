# numen-actuator —— 我们自己的模块（非上游）

这里是 **Numen Server Actuator**：把 numen 的能力通过 RCON 命令面暴露给服务端 agent 的那一层。
**它不是上游代码**，是本项目的模块；上游的 `world/numen-src/` 里没有它的对应物
（`numen_act` / `qdworld` 等命令在上游 HEAD 里 0 命中）。

## 它提供什么

| 命令 | 作用 |
| --- | --- |
| `numen_act list` | 名单：在线身体 + **已死待复生**（`dead=1|diedAt=|cause=`，读上游 `CompanionRegistry`） |
| `numen_act summon <ownerUuid> <name>` | 按名召唤（上游幂等：同名复用原 UUID 与存档） |
| `numen_act invoke <companion> <tool> <argsJson>` | 调用上游工具面（goto/mine/… 共 39 个工具） |
| `numen_act dismiss / skin / say / whisper / dumpregistry` | 其余维护面 |
| `numen_restore_existing <uuid> <owner> <name>` | **重连契约命令**：按原身份恢复身体，回 `QD_NUMEN_RESTORE_JSON {…}` 信封 |

`numen_restore_existing` 原本由我们给 core 打的补丁提供；改用上游 core 后，它搬到这里
（`api/` 里的 `all()` 只读访问器是同一批改动的另一半）。**回复信封与旧契约逐字一致**——
`world/survival/body_reconnect.py` 的安全语义（未知结果不重放、预留不重复派发）就是照它写的。

## 构建

改用上游 core 后，编译方式与项目既有桥一致：`javac` 对
`world/numen-src` 编出的 core/api jar + `server/mc/libraries` 编译，再按
`server/mc/mods/numen_act-neoforge-<mc>-<ver>.jar` 的形状打包（mods.toml + classes + LICENSE）。
classpath 要复用 `world/botgate-src/build.py` 的 `full_cp()`——自己拼 `mods/`+`versions/`
会让 `MinecraftServer` 解析到别的版本，产生一片"找不到符号"的假错。
