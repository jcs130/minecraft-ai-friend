# BODY-1：受控悬停后安全降落

关联 [Issue #43 / BODY-1](https://github.com/jcs130/minecraft-ai-friend/issues/43)。2026-11-05 在 `main@a60bf8ca09eeda1e51055ed14e7ae9290af31311` 复现；交付前更新到 `main@d9d30e0c5713d30f8421116b53b09990c4f9956b`，两者之间没有 MC 核心变更。

本修复为源码候选，未发布 npm、未更新宿主依赖、未部署或重启正式服务器/Agent。

## 根因与最小修复面

`Executor → runSkill → nativeBodyBlockedReason → landFlight` 是实际派发路径。`beginFlight` 为悬停关闭普通物理；Mineflayer 随之停止 `physicsTick`，但继续发送移动包，静止时也约每秒更新一次位置。旧门禁既拒绝 `physicsEnabled=false`，也会在最后一次物理 tick 超过 5 秒后拒绝，因此仅豁免该布尔字段仍不完整。

运行时代码只改三个文件：

| 文件 | 行为 |
| --- | --- |
| `core/body-readiness.ts` | 增加 `controlled-flight` 状态及独立的 `movementAt`，不伪造 `physicsAt`。控制器只能从当前身体已经 `ready` 的状态接管；服务器位置、新鲜原生运动更新、有限坐标、有效生命值和 PLAY 状态仍须成立。 |
| `core/flight.ts` | 以实际控制器所有权、实体身份、物理参数和飞行许可证明受控状态；在退出/边界时释放。每次异步等待后复核身体代次，防止旧许可等待、路线或落地确认跨越新身体继续执行。 |
| `core/executor.ts` | 失败的 `land` / 落地式 `flight` 不得被“坐标已经接近”的 `expect` 改判为成功；身体上下文改变沿用既有不可改判错误码。 |

受控飞行只放行 `land`、`flight` 和 `control`；后者保留已有 mode 检查，ground/water 输入仍拒绝。`chat` 保持原行为，其他技能仍须普通物理就绪。没有安装身体观察器的既有消费者保留显式兼容行为。

登录、死亡、重生、configuration、骑乘和连接结束都会撤销本次控制/就绪证据；位置修正也会终止旧飞行。新生命值、spawn、飞行许可或旧坐标均不能代替新位置与物理恢复。落地恢复接管前的 `physicsEnabled`、`gravity`，并等待恢复后的实际物理 tick 与站稳读数；没有安全支撑时继续悬停，返回受阻。

复核补充了骑乘后的许可保留。上下载具仍属同一连接，终止当前飞行控制后，保留服务端已授予的许可与到期时间。仍在载具上时拒绝飞行，下车并重新取得位置与物理就绪后可继续使用。新增用例先在候选上复现许可丢失，修复后通过。

`movementAt` 是客户端原生发送循环的存活证据，不能解释为服务端已接受任意目标。服务端位置需要另行核对；本次联机测试由第二客户端执行这一核对。

## 隔离回归

新增 `tests/flight-body-readiness.test.ts`，使用仓库锁定的 Mineflayer 4.37.1 / Java 1.21.1 健康与物理插件、真实 Executor，以及合成传输/本地方块网格。明确停用原 harness 的无条件 `physicsTick` 定时器，避免它掩盖悬停缺陷。

- **修复前**：同一主回归经执行器起飞、悬停 6 秒后执行 `land`，稳定得到 `blocked` / “物理更新尚未恢复或已经中断”。
- **修复后 25/25**：起飞、长时间悬停、降落、原重力恢复；空洞、水、岩浆块、未加载区；降落途中支撑消失；取消；真实位置发送循环停滞及恢复；死亡/重生/登录/骑乘/configuration；bot/client 两层结束；三个坐标轴非有限值；撤权/期限/位置修正；等待许可时完整换世界；恢复物理后换世界，以及旧位置 expect 不得冒充降落成功。
- **完整核心测试**：328 个文件通过、6 个文件跳过；**2883 passed / 10 skipped**。新增 25 项包含于该总数，不重复相加。
- `pnpm run typecheck`、`pnpm run build:engine`（运行时、公开声明、来源摘要）均通过。
- 本地打包后在独立消费者目录安装；公开 SDK/readiness 运行、严格 TypeScript 声明检查（`skipLibCheck=false`）、`verify-build.mjs --packed` 均通过。包版本未提升或发布。

首轮完整运行与构建并发，两个 CLI/MCP 测试读取到尚未生成的 dist 入口；另有一个无关水岸寻路断言失败。构建结束后这三文件 39 项重跑通过，随后整套按构建完成的顺序重跑得到上述 2883/10。没有删除断言或修改这些测试。首次独立消费者离线安装缺少传递依赖缓存，正常安装后完成验证。

## 独立联机验收

另启动全新、仅回环监听、无插件、离线认证的 **Paper 1.21.1 build 133** 创造模式测试服。`Body1QA` 经真实协议与 Executor 执行；`Body1Observer` 独立接收服务端实体位置。两者均为专用测试账号，无生产凭据、真实角色或既有世界数据。

最终验证 **7 个技能回执：6 个完成，1 个预期受阻**：

| 场景 | 实际结果 |
| --- | --- |
| 从 Y=-60 起飞至 -58，悬停 6.1 秒 | `physicsAt` 不变，`movementAt` 继续增长，状态为 `controlled-flight`；观察客户端确认 Y≈-58。 |
| 正常 `land` | 任务完成，观察客户端确认 Y=-60；原物理参数恢复，`onGround=true`，控制器释放。 |
| 再起飞至 -58，继续升至 -46 | 两段飞行完成，观察客户端确认 Y≈-46。 |
| 高于地面 14 格时 `land` | 超出 12 格垂直安全落点搜索范围，准确返回受阻并保持悬停，无假成功。 |
| 回到 -58 后再次 `land` | 移动和降落完成，观察客户端再次确认 Y=-60，普通身体就绪。 |

验收结束后两客户端退出，专用测试服正常停止。初次从另一个执行隔离环境连接得到 ECONNREFUSED，改为在同一隔离环境内启动服务端与客户端后完成；没有修改正式网络或服务。

**边界**：死亡、重生、跨世界、断线和中途失效以隔离回归为证，未宣称这些分支全部在真实服务端逐一重演。联机日志出现上游组件数据解码 `PartialReadError`；飞行回执及观察端位置核对仍完成，不据此宣称全部协议兼容。没有生产插件服验收、真实 LLM 决策或长期运行频率统计。

## 复跑

在 `packages/agent-mc-world`：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run typecheck
pnpm run build:engine
pnpm exec vitest run tests/flight-body-readiness.test.ts
pnpm test
```

可选联机入口必须指向自行准备的**一次性回环测试服**（Java 1.21.1、离线认证、创造模式、安全平地、两个空位）；该脚本会移动两个专用测试角色，不用于现役服务：

```sh
node scripts/accept-flight-body-readiness.mjs --port <测试端口>
```

该脚本不启动服务端，不发送管理员命令，不接受远端主机参数，也不自动重试未知动作。
