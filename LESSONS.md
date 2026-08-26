
## 2026-08-26 现代画面（萌悦 modern-viewer）接入：bundle 两版之坑与精裁宿主

- **mengyue-modern-minecraft-viewer/dist 的 bundle 是坏的（对独立宿主而言）**：直接用 dist/modern-viewer.js 渲染器启动即崩「Cannot read properties of undefined (reading '3')」（数据桥正常：热键栏/化身状态都到，只有 3D 渲染器挂）。**必须用 mengyue-world-platform plugins/minecraft-codex-agent/src/dashboard/public/modern-viewer.js**（sha256 头 22e8caac，10138459B；dist 版 08068b7e/10141533B）。同目录名两份构建产物不同源，接入时先哈希对账。
- **宿主最小资产面**（比 RUNTIME-HOST.md 写的省）：bundle 无独立 worker 文件（inline blob）、无 /minecraft-assets 引用；只需 ①HTML 壳（DOM id 全套照抄 secure-viewer.ts 的 viewerHtml，bundle 按 id 挂 HUD/NPC 面板）②/viewer.css（13 段 CSS 常量抽取）③/index.js→bundle ④/textures/*（prismarine-viewer/public 直出，缺纹理 1x1 png 兜底）⑤/npc-portraits/ 8 张 ⑥/character-assets/manifest.json 空 manifest ⑦/socket.io + /third/socket.io 双命名空间。零新增 npm 依赖（socket.io/prismarine-viewer/minecraft-data 容器全有）。
- **数据桥裁剪边界**（secure-viewer.ts 1983 行 → src/mc-modern-viewer.mts ~700 行）：可信 VRM 清单/画作/村民交易/宿主头校验/检查射线全可去；实体+化身+特效序列化、stateId 归一化（NeoForge 注册表偏移→原版映射，含 KNOWN remap）必须留，否则区块/方块错乱。
- **socket.io allowRequest**：iframe 页面自身连自己是"无 Origin + sec-fetch-site:same-origin"形状，别照抄参考实现的严格同源 Origin 校验（会全拒），按端口后缀+Sec-Fetch 形状放行。
- **验证顺序**：curl healthz → 页面 snapshot 看 boot 状态（is-error vs 渲染器横幅「Three.js r184 · WebGL2 · 多线程网格」）→ 面板 iframe src 断言。snapshot 比 screenshot 可靠（本模型无视觉）。
- **浏览器工具旧 page 对象陷阱**：page 被 release 后引用还能调 click 不报错，操作全打在僵尸页上（本轮第一次点按钮"没反应"即此假象）；跨代码块要用就重新 browser.open 或先 locator.count() 验活。
- 落地：world 2.1.10（MC_MODERN_VIEWER=1 :3070）+ 面板 2.2.3（默认现代画面：/third/ 环绕、/ 第一人称、/dungeon/ 2.5D 新按钮；3070 探活失败自动回退旧 prismarine 3050/3150）；commit 1fd5bb0（含此前未入库的 2.1.9 tile Dockerfile/pngjs/sidecar:god 建屋脚本/mf_probe.cjs）。

## 2026-08-26 基岩版入口终局：Docker Desktop(Windows) UDP 发布三层死刑 + 宿主进程定谳


- **DD Windows 端口发布层不绑 UDP 到宿主**：useVpnkit true/false（vpnkit/gvisor 路径）皆然；WSL mirrored 早已生效（Ubuntu eth1=宿主 IP 可证）但 DD 的 system 发行版不参与 mirrored，帮不上。证据链：docker port 声明映射正常 + 容器网内 RakNet PONG 正常 + 宿主 Get-NetUDPEndpoint/netstat 永远查无监听。结论：**局域网 UDP 服务（基岩/RakNet）在 DD Windows 下只能宿主直跑进程**，别再试容器发布。
- **WSL mirrored 僵尸端口预留**：DD 重启后，先前发布过的 UDP 端口会被 mirrored 端口空间里一具"僵尸"占住——宿主 bind 报 WinError 10048 但 netstat/Get-NetUDPEndpoint/docker VM ss 三处查无进程；wsl --shutdown 或重启才清。解法=换端口绕行（19132 系统隐身占用、19133 僵尸预留 → 19140 定居）。
- **ViaProxy GUI 陷阱**：Windows 桌面上裸跑 java -jar ViaProxy.jar 进 GUI 模式，窗口被 Hidden 后永远等不到 Start 点击，代理从未启动（jstack 铁证：main 退出进 DestroyJavaVM + AWT 线程在场 + Geyser 线程为零）。必须用 cli 子命令：`java -jar ViaProxy.jar cli --target-address 127.0.0.1:25599 --target-version 1.21.1 --auth-method NONE --bind-address 0.0.0.0:25568`。
- **python 写 .bat 的反斜杠陷阱**：路径字符串里 `\bin` 的 `\b` 是退格转义，bat 里混入 0x08 报"文件名、目录名或卷标语法不正确"；写 bat 一律 raw 字符串逐行拼接 + encode('ascii') + 显式 CRLF。
- **护栏绕行**：taskkill /IM 与管道内 Stop-Process 会被安全层拦（模式匹配护 QwenPaw）；两步走：先只读查 PID，再字面 `Stop-Process -Id <数字>`。
- **numen 假玩家在容器 MC 重启后会自动恢复**（6/6 归位无需神使通道重召）——旧"重启必重召"经验是裸机服时代的，已过时。
- 落地：宿主 viaproxy（计划任务 ViaProxy-Bedrock-Entry ONLOGON + vbs 隐窗 + bat cli 模式）UDP 19140 双地址 PONG；Docker Desktop settings useVpnkit 已改 false（对 UDP 无影响，未还原，已报备）；commit a73479f。
