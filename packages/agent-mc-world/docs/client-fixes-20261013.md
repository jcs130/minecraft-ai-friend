# 0.4.0 客户端兼容修订（2026-10-13）

适用：独立 `packages/agent-mc-world`，Mineflayer **4.37.1**、minecraft-protocol **1.68.0**、minecraft-data **3.112.0**。本次保持锁定依赖和现有工具名；不自动重启服务器或其他 Agent。

## 逐项改动与回归

| 问题 | 实现文件（包根目录下） | 测试与结果边界 |
| --- | --- | --- |
| 1. 私聊称号/标签 | `src/chat-provenance.ts`、`core/world.ts` | `tests/client-regressions.test.ts`：三种前缀、原始组件、UUID/在线名单、公屏引文、未知玩家、出站消息、只投递一次、`/msg` 私有回复。停止消费默认 `whisper` 事件 |
| 2. 登录状态 | `core/server-login.mjs`、`.d.mts` | `tests/server-login.test.ts`：系统来源的 `MC_AUTH_STATE` 同时 `authorized:true` 与 `status:"authenticated"` 才确认；坏 JSON/错误账号/公共文本不确认。保留自定义 markers |
| 3. 等待登录提示 | `core/world.ts` | `tests/client-regressions.test.ts`：连接存在但未就绪时，聊天返回“正在等待服务器登录或出生点就绪”，没有发出聊天 |
| 4. 工具屏障 | `src/client/runtime.ts` | `tests/neutral-protocol.test.ts`：可选自动确认，仅在调用结束后释放；默认仍要求确认；停止和断开不受屏障限制 |
| 5. 退出信号 | `core/support/child-signals.ts`、`core/engine-child.ts`、`core/proxy.ts` | `tests/client-regressions.test.ts`、`tests/proxy-lifecycle.test.ts`、`tests/protocol-ipc.test.ts`：子进程保留 SIGINT/SIGTERM，父进程负责 shutdown RPC；中断/主动退出不自动重启，迟到旧 IPC 不能复活连接 |
| 6. visual 读数 | `core/world.ts`、`core/engine-child.ts` | `tests/client-regressions.test.ts`、`tests/visual-overview.test.ts`：不消费 deferred 事件也能读取现场；健康、位置与队列随实际状态变化，没画面不声称看过图 |
| 7. 欢迎过早 | `core/initial-scene.ts`、`core/world.ts`、`core/terrain.ts` | `tests/client-regressions.test.ts`：等待出生点周围区块和名单安静窗口，再补一次摘要；断线/死亡/换维度丢弃迟到摘要；不声称服务器只有自己 |
| 8. 参数说明 | `core/world.ts` | `tests/client-regressions.test.ts`：明确 `mc_scout.steps[].probe.shape` 必填，`mc_script` 带 code（包括 validate）时 name 为 1–80 字符。查询 index/api/runId/stop 不要求 name |
| 9. 可选查看器 | `scripts/viewer-input.mjs`、`scripts/build.mjs`、`scripts/verify-build.mjs`、`package.json`、`src/client/console-server.ts` | `tests/viewer-input.test.ts`、`tests/client-console.test.ts`：缺失可跳过，损坏文件仍报错；不遗留旧资源；没有 UI 时本机 API/SDK/MCP 仍可用，网页返回明确 503 |
| 10. 自定义日志 | `core/support/runtime.mjs` | `tests/client-regressions.test.ts`：IPC 日志优先 emit，缺少时调用对应级别方法，再缺则忽略；不因 emit/child 缺失崩溃 |
| 11. 末影人误报调查 | 核对 `core/viewer-sound-registry.ts`、`core/viewer-sound-packets.ts`、`core/perception-hearing.ts`，保留已有不匹配注册表保护 | `tests/entity-sound-1206.test.ts`：真实实体包编解码进入 Mineflayer，村民/展示实体不变成末影人；不匹配声音表不产生声音提示；声音不生成实体数量 |
| 12. 心跳与重连 | `core/config.ts`、`core/bridge.ts`、`src/client/config.ts` | `tests/entity-sound-1206.test.ts`、`tests/login-readiness.test.ts`、`tests/server-login.test.ts`：实际协议定时器 60 秒默认、可配置、断线清理；每连接登录至多一次；拒绝登录后退出并等待明确重连 |

`mc_visual` 原先依赖宿主消费延迟快照后才生成 facts。SDK 直接调用、宿主没有取事件时，缓存可始终为空。现在读取不扫描方块的当前快照，返回位置、身体、已同步库存和动作队列；子进程初始化时立即同步一次。断线后不返回旧缓存当成当前事实。

自动重连只恢复连接并再次认证，原执行器已有的 `onConnectionLost` 会终止旧动作/方法，不补发旧聊天和消费动作；请求 ID 去重和结果未知保护继续保留。查询与任务完成仍应看终态，不能用“发出命令”作为完成证据。

## 用法

```ts
const client = new MinecraftAgentClient({
  cfg: { ...config, keepAliveTimeoutMs: 60_000 },
  dataDir, log: nullLogger(),
  autoAcknowledgeBarriers: true, // 脚本按 await 顺序处理每条回执
});
await client.connect();
await client.call('mc_visual', {});
await client.call('mc_stop', {});
await client.disconnect();
```

默认 `autoAcknowledgeBarriers:false`。需要宿主阅读确认的场景保持默认，处理完回执后调用 `client.acknowledgeBarrier(result.control.requestId)`。SDK 的 `tools()` 返回游戏工具；确认是 SDK 方法。MCP 的 `tools/list` 另有 `mc_protocol`，使用 `{"protocol":"agent-mc/v1","action":"ack_barrier","id":"<requestId>"}`。自动确认不自动结束推理回合，也不放行尚在执行的屏障调用。

登录仍需在 `loginConfigFile` 显式匹配服务器和账号，通过 `credentialEnv` 或私有文件取得凭据，不把密码写进代码。省略 markers 时默认识别 `MC_AUTH_LOGIN`、`MC_AUTH_SUCCESS`、`MC_AUTH_FAILED`、`MC_AUTH_2FA`。`passwordSet` 和 `nextCommand` 保存于 `serverLogin.detail().authState`，属于引导信息；`passwordSet:false` 但已授权时正常就绪，不私自注册、不执行任意 `nextCommand`。

公开 TypeScript `Logger` 契约仍为 `trace/debug/info/warn/error/emit/child`；推荐使用 `nullLogger()` 并覆盖所需方法。JS 调用方缺少 emit/child 时，IPC 转发有兼容降级；自定义级别方法自身抛异常仍由调用方负责。

## 原版注册表核对

在独立目录运行 Mojang 1.20.6 服务端的 `net.minecraft.data.Main --reports`，没有启动游戏服务器。原 JAR SHA-256：`c6d01d018ca782e506f0ec60652d47fd565078be9122b625c1681bc86c29c7ec`。

- 130 个实体 ID 与锁定依赖全部相同：末影人 33、村民 113、物品展示 59、文字展示 105、盔甲架 3。Terralith 的动态群系注册不替换实体类型表。
- 原版声音 1607 项，依赖继承声音表 1539 项；按编号有 1553 项不同或缺失。末影人环境声实际为 477，旧表写在 447。
- minecraft-protocol 的 `registryEntryHolder` 已做 `wireId - 1`，不能再减一次。当前核心的 1.20.6 数字声音只有匹配资源注册表才启用，缺表时保留带名字的音效。
- 未取得原问题发生时的原始包，不能认定历史 21–36 只的具体来源已复现或根治。测试只证明上述版本边界与不误推断的行为。

上游声音修订仍单独跟踪于 [minecraft-data #1316](https://github.com/PrismarineJS/minecraft-data/pull/1316)；不以未合入 PR 代替本地原版核对。

## 本地验证

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build                  # 缺少锁定查看器时给警告，仍构建 SDK/引擎/类型
pnpm typecheck
pnpm exec vitest run --maxWorkers=4 --minWorkers=2
pnpm pack --pack-destination <独立输出目录>
```

Java 登录组件测试需要 JDK 21，设置当前 shell 的 `JAVA_HOME`。Windows 身份没有 DPAPI 能力时，该集成测试明确 skipped，不能宣称真实 DPAPI 成功。`viewer-content` 只在构建清单包含查看器时运行；缺失清单或损坏的已包含资源仍失败。

显式纯引擎使用 `pnpm build:engine`。需要查看器时先 `node scripts/prepare-viewer.mjs <匹配 release-sources.json 的压缩包>`，再 `pnpm build:viewer`。不会隐式下载、更换资源版本或跳过摘要检查。独立消费端从 tarball 安装生产依赖，验证 SDK/MCP 的导入、工具发现和类型，不能引用相邻源码。

最后再以测试账号连接目标服确认：认证完成→区块/玩家名单就绪→私聊正确标出真实发送者→以 `/msg` 回复→visual 返回当前状态→主动断开无重启日志。真实外部服务器的网络超时、正版会话和未提供的历史包需要现场另验。
