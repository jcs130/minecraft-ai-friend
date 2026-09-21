# 基岩桥（ViaProxy 内嵌 Geyser）· 宿主服务

## 为什么在宿主机上（不在容器里）
`start-viaproxy.bat` 头部注释记录的历史结论：**Docker Desktop(Windows) 不把 UDP 发布到宿主** → 基岩需要 UDP 19140 → 只能宿主直跑。
2026-09-21 实测：容器发布 UDP 时宿主 `Get-NetUDPEndpoint` **确实查不到监听**（旧观察成立），但从宿主向本机 LAN IP 发 UDP **容器能收到**（旧推论已不成立）。
**外部设备（手机）能否入站仍未证** → 由 `geyser-container/` 的 A/B 试验定生死（手机连 19141）。

## 版本与来源（jar 不入库）
| 件 | 版本 | 大小 | 位置 |
|---|---|---|---|
| ViaProxy | 3.4.12 | 47,136,119B | `C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\viaproxy\ViaProxy-3.4.12.jar` |
| Geyser（内嵌插件） | 2.11.3-b1245 | 42,589,244B | `C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\ops\docker\shadow\viaproxy\plugins\Geyser-ViaProxy.jar` |
| settlementsgate 扩展 | 1.3.0 | 4,979B | 本目录已收正本 ✓ |

## 关键配置（本目录 `geyser-config.yml`）
- `bedrock: address 0.0.0.0 / port 19140` ✓ `auth-type: offline`（服务端也是离线模式）
- `debug-mode: true`（2026-09-20 排查未映射方块时开的，留着可捞 unknown 记录）
- **`remote`/`java` 上游由 ViaProxy 命令行决定**，不在 Geyser config 里

## 启动与自启
- 计划任务 `ViaProxy-Bedrock`（ONLOGON）→ `cmd /c start-viaproxy.bat`（bat 内 `:loop` 自愈重启，15s 间隔）
- 为什么用计划任务而不是随会话启动：本机 Windows 作业对象会把随会话启动的整棵进程树收走（历史踩坑）

## 2026-09-21 的关键变更
`--target-address 127.0.0.1:25565`（裸口，绕过号翻译）→ **`127.0.0.1:25701`（神社之门）**
运行副本同目录留有 `start-viaproxy.bat.bak-target25565` 可回滚。
验证：`node verify-gate.cjs 127.0.0.1 25568` → 11/11 ✓ 门日志出现经桥会话 ✓ 造物主手机确认画面正常 ✓

## 重启正确姿势（`schtasks /end` 不杀孤儿）
```
schtasks /end /tn "ViaProxy-Bedrock"
taskkill /T /F /PID <java.pid>        # 必须！否则旧 java 带旧参数继续跑
# 确认 UDP 19140 已空
schtasks /run /tn "ViaProxy-Bedrock"
# 验收：Get-CimInstance 看新进程命令行确实带 --target-address 127.0.0.1:25701
```
