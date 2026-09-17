# 上游 Numen 的来源与同步记录（2026-09-17）

这个世界的同伴身体来自**第三方开源项目 Numen**，不是自研。本文件记录它的来源、
许可证、我们在其上做了什么改动、以及同步时必须守住的能力契约。
机器可读的同份记录见 `manifests/numen-upstream.lock.json`。

## 归属与许可

| 项 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/Dwinovo/minecraft-numen |
| 作者 | `dwinovo`（mod displayName：Numen） |
| 许可证 | **LGPL-3.0-only**（取自发布 jar 的 `META-INF/neoforge.mods.toml`；源码树另带 `COPYING`(GPL-3.0) 与 `LICENSE`(LGPL-3.0)） |
| 许可义务 | 保留上游许可证与版权声明；**如实记录我们的修改**（即本文件与 patch 目录）；不把 Numen 当作本项目的作品再许可出去 |

我们不重新分发它作为自研成果：server 侧只部署 jar，源码与补丁留在本仓
`world/numen-patches/`（patch + 输入哈希 + 构建器 + 测试）。

## 我们现役的是什么

- 部署件：`server/mc/mods/numen-neoforge-1.21.1-0.1.1.jar`
  sha256 `bda81485d7a6760bb0288b232f251f4a…`（完整哈希见 `manifests/numen-restore.lock.json`）
- 构成：**上游 0.1.1 二进制 + 本项目 5 个能力补丁**（编译受影响的 class family，其余条目逐项校验不变）

### 我们在上游之上加了什么（5 个能力）

| 能力 | 补丁 | 为什么 |
| --- | --- | --- |
| `walk_only_strict_arrival_v2` | `walk-only-v1` | 任务内步行 + **严格到达**：没真的站上目标格就不算到达。**网关硬依赖** |
| `existing_body_restore_v1` | `restore-existing-v1` | 按**原身份**恢复已存档的身体（绝不 summon 新 UUID）。**重连路径硬依赖** |
| `autonomous_body_tick_v1` | `autonomous-body-tick-v1` | 无客户端接入时让同伴身体照常 tick |
| `autonomous_world_tick_v2` | `autonomous-world-tick-v2` | 只有服务端身体在场时让周边世界照常 tick |
| `autonomous_world_tick_v3` | `autonomous-world-tick-v3` | 同上，v3 修订 |

## 上游有哪些版本（2026-09-17 查证）

| 版本 | 时间 | 有 jar | 说明 |
| --- | --- | --- | --- |
| release `v0.1.3-1.21.1-beta` | 2026-09-11 | ✅ `numen-neoforge-1.21.1-0.1.3.jar` | 官方发布件。**早于上游 HEAD**，不含最新寻路改造 |
| HEAD `e627089d` | 2026-09-16 | ❌ | 最新源码。含 08-10 起 `pathing/` 18 个提交 + `task/move/` 9 个提交的寻路大改（RoutePlanner/RouteBook、路线规格取代 TerrainPermit、CellClass、goto 改 route id、新工具 plan_route…） |

## 为什么不能"直接换上最新 jar"

**已实测**（对两个 jar 解压后逐标识符比对）：上游发布件里
**上述 5 个能力一个都不存在**。直接替换会立刻造成两处硬断裂：

1. **goto 全线拒绝** —— `world/survival/numen_gateway.py:975`：
   ```python
   if tool == 'goto' and 'walk_only_strict_arrival_v2' not in before.get('navigationModes', []):
       raise GatewayError('safe_navigation_unavailable')
   ```
   网关在**没有**该能力时**主动拒绝** goto（这是有意的安全闸，防止退回"以为到了其实没到"）。
2. **身体恢复失效** —— `world/survival/body_reconnect.py` 依赖 `numen_restore_existing` 命令
   （`existing_body_restore_v1`）。上游没有这条命令，同伴死亡后将无法按原身份恢复。

因此正确做法是：**以上游新版本为基线，把我们的能力补丁重基上去**，而不是删掉补丁换 jar。
上游新的 route/plan_route 体系可能**最终替代** `walk_only`，但那要先读懂、再改网关的判定，
属于一次性重基工程，不能在运行中的世界上盲合。

## 同步流程（守住契约）

1. 选定基线：上游 **HEAD**（最新、需自建）或 **release 0.1.3**（现成 jar、落后 5 天）
2. 逐个判断 5 个能力的去留：上游已内置等价物 → 退休我们的补丁并**同步改网关判定**；否则重基
3. **停服** → 重编译 → 部署（沿用 `tools/deploy_numen_*.py` 的备份+哈希校验路径）
4. **逐能力在真实世界验收**（编译通过 ≠ 实机可用）：
   - `goto` 仍能走且严格到达生效（`navigation_modes` 里出现该能力）
   - 身体死亡后能被按原身份恢复
   - 无客户端时身体与世界照常 tick
5. 更新本文件与 `manifests/numen-upstream.lock.json` 的版本/哈希

## 集成方式已改为源码集成（2026-09-17 造物主定调）

**"还是直接源码集成吧，毕竟使用场景不同"** —— 上游默认场景是**给玩家客户端用**，而我们是
**纯服务端自主 agent、无客户端接入**，且要严格到达 / 按原身份恢复 / 无人时照常 tick。
继续"上游 jar + 二进制补丁"的叠法，每次同步都要重解一遍 class family 与哈希；源码集成后
我们的改动有明确落点、上游更新变成一次普通 rebase。

- 源码树：**`world/numen-src/`**（上游整树除去 `docs/` 与 `.github/`，1077 文件 / 8.5 MB，
  许可证 `LICENSE`/`COPYING`/`LICENSE-ASSETS` 原样保留）
- 集成版本：commit **`e627089ddf6870f01968903214366fb430bd7190`**（2026-09-16）
- 集成说明与改动清单：**`world/numen-src/INTEGRATION.md`**
- 机器档：`manifests/numen-upstream.lock.json` 的 `integration` 段

**权威源（迁移期，别搞混）**：五个能力全部迁入并通过实机验收之前，
构建输入的权威仍是 `world/numen-patches/`；**本树此刻仅供阅读与迁移**。迁完之后反过来。

## 待办（截至本文件）

- 正式同步**尚未执行**：需要停服窗口 + 基线选择（HEAD 自建 vs release 0.1.3）。
- 上游 HEAD 是否已把"身体死亡状态"暴露给服务端（`CompanionRegistry.diedAt` /
  `CompanionRoster.respawnInMs`）**未查完**——这关系到"死亡→总结→换一世"能否拿到身体侧信号。
  现役 jar 有 `diedAt`/`deathCause` 字段，但两条名单命令都不打印它们。
