# CoPaw / 小智 MCP 接入

这个控制台在本机 `http://127.0.0.1:4177` 暴露 MCP 接入层，让 CoPaw 可以通过自然语言调用 Minecraft AI 陪玩能力。默认只允许本机访问；如果 CoPaw 或主播端在局域网另一台机器上，需要在控制台“设置”里打开“允许局域网 MCP 接入”，然后使用服务器局域网 IP。

## 端点

兼容旧式 HTTP+SSE：

```json
{
  "mcp_servers": {
    "minecraft-companion": {
      "transport": "sse",
      "url": "http://127.0.0.1:4177/mcp/sse"
    }
  }
}
```

局域网机器示例：

```json
{
  "mcp_servers": {
    "minecraft-companion": {
      "transport": "sse",
      "url": "http://192.168.3.133:4177/mcp/sse"
    }
  }
}
```

同时支持新版 Streamable HTTP 的单端点调用：

```json
{
  "mcp_servers": {
    "minecraft-companion": {
      "transport": "http",
      "url": "http://127.0.0.1:4177/mcp"
    }
  }
}
```

## 工具

- `get_play_status`：获取 Minecraft、Mindcraft、AI 队友、自动陪玩和村庄完整状态。
- `start_experience`：一键启动服务器、Mindcraft、恢复常驻居民并启动自动陪玩。
- `stop_all`：停止自动陪玩和本控制台启动的 Mindcraft。默认不关闭 Minecraft 服务器，避免误关世界。
- `create_agent`：创建或恢复 AI 队友，并请求进入服务器。
- `send_task`：给指定 AI 或所有在线 AI 发送自然语言任务。
- `locate_player`：读取真人玩家坐标。
- `activate_village`：激活常驻村庄模式。
- `village_report`：返回适合飞书展示的村庄状态摘要。
- `focus_live_observer`：让 `live` / `ServerTV` 等观察账号自动旁观当前最活跃的 AI，或指定目标 AI。
- `start_first_night`：发送“第一晚生存”新手陪玩任务。
- `start_free_play`：发送自由陪玩任务。

## 自然语言示例

- 看看村庄状态。
- 让村长派两个 bot 去挖矿。
- 让 Alex 去基地附近砍木头。
- 找一下 MengMeng 现在在哪。
- 进入常驻生存模式，然后让居民自由建设村庄。
- 让 live 去看现在最活跃的 AI。

## 快速测试

初始化：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4177/mcp -ContentType 'application/json' -Headers @{Accept='application/json, text/event-stream'} -Body '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"copaw-test","version":"0.1.0"}}}'
```

列出工具：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4177/mcp -ContentType 'application/json' -Headers @{Accept='application/json, text/event-stream'} -Body '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

调用村庄报告：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:4177/mcp -ContentType 'application/json' -Headers @{Accept='application/json, text/event-stream'} -Body '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"village_report","arguments":{}}}'
```

## 安全边界

MCP 默认只接受 localhost 连接。打开“允许局域网 MCP 接入”后，只接受私网地址来源，包括 `10.x.x.x`、`172.16.x.x` 到 `172.31.x.x`、`192.168.x.x` 和 `169.254.x.x`。不要直接暴露到公网；公网或多人环境应先加鉴权、来源校验和高风险操作确认。
