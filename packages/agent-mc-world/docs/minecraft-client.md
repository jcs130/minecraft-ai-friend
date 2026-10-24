# 独立客户端、SDK 与 skill

**Agent MC World** 的执行产品是 Mineflayer 客户端 / Harness；skill 是配套使用说明，安装 skill 本身不会启动游戏或提供主决策模型。

| 入口 | API | 运行依赖 |
| --- | --- | --- |
| MCP | `minecraft-agent-mcp`、`mc_*`、`mc://` | 本包生产依赖，无 Cortico |
| SDK | `agent-mc-world/client` | 自有结构契约，无 Cortico 类型或运行时依赖 |
| Cortico | `jcs130/cortico-world-qiandengji`（独立宿主适配仓库） | API 5；World ID `mc`，配置 `worlds.mc.*` |
| Skill | `skills/minecraft-agent/` | 复制整个文件夹，保留 references |
| 本机连接台 | `minecraft-agent-client <private-config.json>` | 无 Cortico；默认仅绑定 127.0.0.1 |

安装与离线检查见 [核心包说明](../README.md)。千灯纪适配器在独立 World 仓库的 `integrations/qiandengji/`，不随此通用包安装，也不是默认能力。

Java 1.21.1 是主要维护、构建与验收版本，1.20.6 保留显式兼容回归。早期 1.20.6 的私聊、登录状态、工具屏障、现场读数、退出与可选构建修订及逐项测试见 [客户端兼容修订](client-fixes-20261013.md)。心跳默认 60 秒，可用 `keepAliveTimeoutMs` 配置；登录失败会停下等待修正，不循环重试密码。

## SDK

连接配置推荐 `version:"auto"`，由 Mineflayer 识别服务器；显式版本仍原样保留。1.21.1 是主要维护基线，不是登录白名单。网页按实际版本匹配已打包的原素材和注册表，新增 1.21.11 原版资源；缺少资源不冒充游戏断线，也不使用相近版本代替。1.21.11 音频、地图/粒子扩展与新增实体模型尚未完成验收。

`operatorState().connection.viewer` 提供 `phase`（waiting/starting/ready/failed/disabled）、`version`、安全的 `code/message` 及原有 `mode/url`。未连接或换代时不沿用旧画面状态。`serveClientConsole(..., {embedOrigins, nativeClients:false})` 可关闭宿主未配置的观察者/玩家原生启动入口；元数据和 POST 动作同时限制，Agent 的连接与微软授权不受影响。默认值保持既有 SDK 启动器可用。

普通交流默认使用 `mc_do` 的 `chat` 步骤和不带命令的公屏文本，可直接在文字中点名。只有明确要求私聊且已确认服务器支持，才使用相应命令；私聊失败不能自动重发到公屏，公屏限额也不能转用私聊规避。

```ts
import { MinecraftAgentClient, loadMinecraftClientConfig, nullLogger }
  from 'agent-mc-world/client';

const client = new MinecraftAgentClient({
  ...loadMinecraftClientConfig(privateConfig), log: nullLogger(),
});
await client.connect();
const accepted = await client.call('mc_do', { steps });
const page = client.journal.read(after, 64, run);
// 把实际事件正文交给宿主，保留 run / nextCursor 并继续消费。
await client.disconnect();
```

`examples/minecraft-client.ts` 是不进服的最小宿主示例。通过 `node --import tsx` 运行 TypeScript 示例。SDK 不拥有主模型；宿主决定何时 connect、如何消费事件与何时允许 disconnect。

`src/client/contracts.ts` 定义工具、宿主、事件、模型事实、可选认知和日志结构。Cortico 是结构兼容的适配器，不是 SDK 类型的必需依赖。连接日志、附件和指标在 `src/client/`；MCP 只做协议转换，不另造动作执行器。

## Skill

把安装包内 `skills/minecraft-agent/` 完整复制到 Agent 的技能目录。先发现工具和能力，按需读取引用，不全量注入方法库。skill 强调真实回执、Promise、身体控制权、原生接口、版本和适用条件；不会安装主模型、发明服务器技能或代替学习评价。

客户端支持原生 Microsoft 设备码认证、隔离缓存、自动协议识别及已安装 Java 客户端启动；[完整账号与启动器指引](online-accounts.md) 说明实际验证范围。锁定的现代素材以 Java 1.21.1 为主目录，并保留单独的 1.20.6 资源；画面资源、容器解码和注册表必须匹配实际连接版本，不能由协议连接成功推断画面兼容。旧 RPG 快战术尚待从服务器能力协议中拆出，通用入口不提供法术或该战术工具；原生脚本与通用反射可用。参见 [架构边界](architecture.md)。
