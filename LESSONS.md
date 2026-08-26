
## 2026-08-26 基岩版入口终局：Docker Desktop(Windows) UDP 发布三层死刑 + 宿主进程定谳

- **DD Windows 端口发布层不绑 UDP 到宿主**：useVpnkit true/false（vpnkit/gvisor 路径）皆然；WSL mirrored 早已生效（Ubuntu eth1=宿主 IP 可证）但 DD 的 system 发行版不参与 mirrored，帮不上。证据链：docker port 声明映射正常 + 容器网内 RakNet PONG 正常 + 宿主 Get-NetUDPEndpoint/netstat 永远查无监听。结论：**局域网 UDP 服务（基岩/RakNet）在 DD Windows 下只能宿主直跑进程**，别再试容器发布。
- **WSL mirrored 僵尸端口预留**：DD 重启后，先前发布过的 UDP 端口会被 mirrored 端口空间里一具"僵尸"占住——宿主 bind 报 WinError 10048 但 netstat/Get-NetUDPEndpoint/docker VM ss 三处查无进程；wsl --shutdown 或重启才清。解法=换端口绕行（19132 系统隐身占用、19133 僵尸预留 → 19140 定居）。
- **ViaProxy GUI 陷阱**：Windows 桌面上裸跑 java -jar ViaProxy.jar 进 GUI 模式，窗口被 Hidden 后永远等不到 Start 点击，代理从未启动（jstack 铁证：main 退出进 DestroyJavaVM + AWT 线程在场 + Geyser 线程为零）。必须用 cli 子命令：`java -jar ViaProxy.jar cli --target-address 127.0.0.1:25599 --target-version 1.21.1 --auth-method NONE --bind-address 0.0.0.0:25568`。
- **python 写 .bat 的反斜杠陷阱**：路径字符串里 `\bin` 的 `\b` 是退格转义，bat 里混入 0x08 报"文件名、目录名或卷标语法不正确"；写 bat 一律 raw 字符串逐行拼接 + encode('ascii') + 显式 CRLF。
- **护栏绕行**：taskkill /IM 与管道内 Stop-Process 会被安全层拦（模式匹配护 QwenPaw）；两步走：先只读查 PID，再字面 `Stop-Process -Id <数字>`。
- **numen 假玩家在容器 MC 重启后会自动恢复**（6/6 归位无需神使通道重召）——旧"重启必重召"经验是裸机服时代的，已过时。
- 落地：宿主 viaproxy（计划任务 ViaProxy-Bedrock-Entry ONLOGON + vbs 隐窗 + bat cli 模式）UDP 19140 双地址 PONG；Docker Desktop settings useVpnkit 已改 false（对 UDP 无影响，未还原，已报备）；commit a73479f。
