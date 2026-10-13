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

## SDK

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

v0.3.0-next.2 支持原生 Microsoft 设备码认证、隔离缓存、自动协议识别及已安装 Java 客户端启动；[完整账号与启动器指引](online-accounts.md) 说明实际验证范围。内置现代素材为 Java 1.20.6，不能由协议连接推断画面兼容。旧 RPG 快战术尚待从服务器能力协议中拆出，通用入口不提供法术或该战术工具；原生脚本与通用反射可用。参见 [架构边界](architecture.md)。
