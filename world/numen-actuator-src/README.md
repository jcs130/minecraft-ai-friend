# numen-actuator —— 我们自己的模块（非上游）

这里是 **Numen Server Actuator**：把 numen 的能力通过 RCON 命令面暴露给服务端 agent 的那一层。
**它不是上游代码**，是本项目的模块；上游的 `world/numen-src/` 里没有它的对应物
（`numen_act` / `qdworld` 等命令在上游 HEAD 里 0 命中）。

## 它提供什么

| 命令 | 作用 |
| --- | --- |
| `numen_act list` | 名单：在线身体 + **不在世界里的名册条目**（`offline=N`，每行 `removed=0/1|reason=`；0.1.5 起名册不再记死亡，死亡由原版当场重生） |
| `numen_act summon <ownerUuid> <name>` | 按名召唤（上游幂等：同名复用原 UUID 与存档） |
| `numen_act dismiss / skin / say / whisper / dumpregistry` | 其余维护面 |
| `numen_restore_existing <uuid> <owner> <name>` | **重连契约命令**：按原身份恢复身体，回 `QD_NUMEN_RESTORE_JSON {…}` 信封 |

`numen_restore_existing` 原本由我们给 core 打的补丁提供；改用上游 core 后，它搬到这里
（`api/` 里的 `all()` 只读访问器是同一批改动的另一半）。**回复信封与旧契约逐字一致**——
`world/survival/body_reconnect.py` 的安全语义（未知结果不重放、预留不重复派发）就是照它写的。

## Numen 0.1.5 起的变化

- `numen_act invoke` 与 GodChannel 的 `invoke` 动词**已退役**：0.1.5 的工具面是 Lua（`numen.move.walk`、`numen.inv.*`、`numen.work.mine`…），
  经原生 MCP 端点（`config/numen/server/mcp_server.json`，只听 127.0.0.1，令牌由主人 `/numen token create brain` 发）调用；
  外部大脑用 `packages/agent-harness-py` 的 `NumenBody`（`lua_dialect = "numen-0.1.5"`）。
- 这里只保留原生 MCP 不覆盖的：`numen_restore_existing`、GodChannel（文件队列 + 世界信标）、`numen_act snapshot`（视觉）、pad、skin、say/whisper、dumpregistry。
- `numen_restore_existing`：0.1.5 名册没有死亡状态（旧档的 `diedAt/deathCause` 读档即忽略），`.dat` 里 Health≤0 仍回 `body_dead`；
  名册里有 `taskLua`（重启会被原生重放）回 `saved_task_requires_review`；0.1.3 旧档的 `taskArgs`（0.1.5 读作 taskOld，从不重放）
  会被清掉并在回执里报 `droppedLegacyTask`。恢复走 `Companions.respawn(server, uuid, then)`（NeoForge 准入同步，回执当场可得）。
- 构建：`python tools/build_numen_actuator.py --resource-root <有 server/mc/{libraries,mods} 的目录> --jdk-bin <jdk21/bin>`；
  mods 里没有旧 actuator jar 时直接从源码资源组装 `numen_act-neoforge-1.21.1-<numen 版本>.jar`。

## 构建

改用上游 core 后，编译方式与项目既有桥一致：`javac` 对
`world/numen-src` 编出的 core/api jar + `server/mc/libraries` 编译，再按
`server/mc/mods/numen_act-neoforge-<mc>-<ver>.jar` 的形状打包（mods.toml + classes + LICENSE）。
classpath 要复用 `world/botgate-src/build.py` 的 `full_cp()`——自己拼 `mods/`+`versions/`
会让 `MinecraftServer` 解析到别的版本，产生一片"找不到符号"的假错。
