# 直播主播开放 API（qiandengji-live）

独立服务，默认监听 `0.0.0.0:3110`（容器内）/ 宿主发布 `:19095`。
**读接口开放 + CORS**（别的机器/网页可直接拉）；**写接口需 token**（`LIVE_WRITE_TOKEN`）或本机回环。

## 读接口（无需鉴权，跨域可用）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/live/state` | 一次性快照：桐人状态 + 最近10轮思考 + 最近50条弹幕 + 最近30条主播回复 + 弹幕连接状态 |
| GET | `/api/live/thinking` | 桐人完整思考流（goal/lesson/nextFocus/动作/事件，透传 panel survivor-trace） |
| GET | `/api/live/danmaku` | **SSE 实时流**：`danmaku` / `reply` / `status` 事件（弹幕来了即时推） |
| GET | `/api/live/replies` | 最近主播回复列表 |
| GET | `/healthz` | 服务健康 + 弹幕状态 + 写鉴权模式 |

`/api/live/state` 示例字段：
```json
{ "ok": true,
  "agent": {"name":"桐人","hp":20,"hunger":18,"status":"thinking","position":{"x":-512,"y":68,"z":828}},
  "turns": [{"turnId":"…","status":"completed","goal":"…","nextFocus":"…","actions":[{"tool":"…","status":"completed","item":"…"}]}],
  "danmaku": [{"user":"观众A","text":"…","type":"danmaku","at":1700000000000}],
  "replies": [{"user":"观众A","question":"…","reply":"…","at":…}],
  "danmakuStatus": {"connected":true,"room":"…","error":null} }
```

## 写接口（需 `x-live-token: <LIVE_WRITE_TOKEN>` 头，或本机回环）

| 方法 | 路径 | 体 | 作用 |
|---|---|---|---|
| POST | `/api/ask` | `{text, uid?}` | 让主播（mc-god 女神）答一条弹幕 → 回复进 state/replies + SSE 推 |
| POST | `/api/command` | `{mission}` | 改桐人任务（写 survivor control.json，≤15s 生效） |
| GET | `/api/say?text=&voice=` | — | TTS 合成 mp3（goddess/kirito） |

无 token 且非回环 → `401 {error:"need LIVE_WRITE_TOKEN"}`。

## 别的机器怎么连

- **同机**：`http://127.0.0.1:19095/api/live/state`
- **局域网**：`http://<本机LAN IP>:19095/api/live/state` —— ⚠️ 需两条前提：
  1. 服务绑 `0.0.0.0`（已默认）；
  2. **Windows 防火墙放行 19095 入站**（需管理员，见下）。
  > 若走 Docker 容器发布：Docker Desktop WSL2 的端口代理不在 0.0.0.0 监听，局域网直连容器发布口可能不通 → **推荐用宿主进程方式跑 live**（`start-live.bat`，绑 0.0.0.0），只需放行防火墙。

管理员 PowerShell 放行（一次性）：
```powershell
netsh advfirewall firewall add rule name="qiandengji-live-19095" dir=in action=allow protocol=TCP localport=19095 profile=private,domain
```

## 安全边界
- 读接口是**直播本就要公开的数据**（思考/弹幕），开放 + CORS 无妨。
- **写接口（改桐人任务 / 调主播 / TTS）必须 token**，防局域网任意机器指挥桐人。
- **绝不做公网转发**（对齐项目铁律：RCON/面板/观战/Java 均不公网）。跨公网自用走 Tailscale。


## /api/live/race —— 竞速聚合（只读，2026-09-27 加）

```
GET /api/live/race            当前战况：每选手增量统计+七判据达成+最近快照位置
GET /api/live/race?history=1  附最近48拍原始快照
```

- **零硬编码**：选手/判据/路径全在 `race_config.json`（换比赛只改配置）；`RACE_CONFIG` 环境变量可指向别的配置跑多场。
- 数据源全为宿主文件（stats/snap/base），不依赖 RCON，永远拉得动；开放 + CORS。
