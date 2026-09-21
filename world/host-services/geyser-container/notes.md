# 基岩桥容器化试验（结论：容器化 ViaProxy 本体，不是裸 Geyser）

> 2026-09-21 夜 · 两轮试验的完整结论。**旧的"宿主机直跑"理由（Docker Desktop 不能把外部 UDP 放进来）已被实测推翻。**

## 试验一：裸 Geyser 容器 → 门 ✗ 失败（但证成了最关键的一件事）
- 起法：`itzg/minecraft-server:java21` + `server/geyser-standalone/Geyser-Standalone.jar`（b1245）+ 只改 `java: address gate / port 25700`
- **重大收获**：造物主手机（WiFi 上的外部设备）**成功打进容器发布的 UDP 口** ✓ 容器日志实录
  `Player connected with username MicroKQ (2193)` → **「Docker Desktop 不放外部 UDP 入站」这条 2026-08-30 的老结论作废** ✓
- 失败原因：`MicroKQ has disconnected from remote Java server on address gate because of End of stream`
  → **Geyser b1245 的配置里没有 `java.version` 键** ✓ 它按基岩客户端版本自行挑 Java 协议 ✓
    而门只接受 `1.21.1 / protocol 767` ✓ 握手即断 ✓
- 附带缺口：`[settlementsgate] no roster found`（裸 Geyser 拿不到村民名册 → 村民会显示为无职业）
- 该容器已 `docker rm -f` 移除 ✓ 不留误导性的死试验

## 试验二：容器化 ViaProxy 本体 ✓ 成功（等价于现役宿主版）
```powershell
# 目录正本：本目录 viaproxy/（jar 47MB 不入库，见 ../../README.md 的指纹表）
docker run -d --name qd-viaproxy-ab --network qiandengji_default --restart unless-stopped `
  --no-healthcheck `
  -p 19142:19140/udp -p 127.0.0.1:25569:25568 `
  -v "D:\Projects\QiandengJi\server\viaproxy-ab":/viaproxy -w /viaproxy `
  --entrypoint java itzg/minecraft-server:java21 `
  -jar ViaProxy-3.4.12.jar cli --target-address gate:25700 --target-version 1.21.1 `
      --auth-method NONE --bind-address 0.0.0.0:25568
```
- 启动核验：`Geyser 2.11.3-b1245` ✓ `199 custom block overrides` ✓ **`roster loaded: 37 NPCs`** ✓（名册缺口自然消失 ✓）
  `Started Geyser on UDP port 19140` ✓ `Binding proxy server to 0.0.0.0:25568` ✓
- **Java 侧链路实测**：`node verify-gate.cjs 127.0.0.1 25569` → **11/11 exit 0** ✓
  门日志铁证：`穿越者 QDVerify451 叩门 → 开后端会话` + `census … err=none` ✓
- 关键点：**ViaProxy 的 `--target-version 1.21.1` 就是那层 ViaVersion** ✓ 它把后端钉成 1.21.1 ✓
  所以"基岩新客户端 ↔ 1.21.1 服务端"能成 ✓ 裸 Geyser 做不到 ✓

## 转正步骤（等造物主手机连 `192.168.3.133:19142` 验过基岩侧之后）
1. 停宿主 ViaProxy：`schtasks /end /tn ViaProxy-Bedrock` → **`taskkill /T /F` 掉孤儿 java**（`/end` 不杀子进程）
2. 禁自启：`schtasks /change /tn ViaProxy-Bedrock /disable`
3. 容器改发布正式口：`-p 19140:19140/udp`（**对外端口不变 ✓ 访客与路由器配置一字不改**）
4. 复验：`node verify-gate.cjs 127.0.0.1 25569`（或转正后的 Java 口）+ 手机重连一次
5. 回滚：`schtasks /change /tn ViaProxy-Bedrock /enable` + `/run`（容器先停以让出 19140）

## 待办
- 转正后把该服务写进 `compose.yml`（正本进本目录 ✓ 运行副本 `server/viaproxy-ab/` 在 `/server/` 里被 gitignore ✓ 需以本目录为源）
- 大 jar（47MB）不入库 ✓ 只记版本与 sha256 ✓ 换机需按本文重下
- 提醒：白名单仍 `off` ✓ 基岩与外门都属"知道地址就能进" ✓ 收口前别扩公网
