# Geyser 容器化 A/B 试验

## 目的
验证"基岩桥能不能收进 docker"——即回答 `viaproxy-bedrock/notes.md` 里那条**未证**的外部 UDP 入站问题。
**零风险设计**：容器只发宿主 **UDP 19141**，现役 ViaProxy 的 19140 完全不动。

## 起法（本地镜像，零下载）
```powershell
docker run -d --name qd-geyser-ab --network qiandengji_default --restart unless-stopped `
  -p 19141:19140/udp -v "D:\Projects\QiandengJi\server\geyser-ab":/geyser -w /geyser `
  --entrypoint java itzg/minecraft-server:java21 -Xmx1G -jar Geyser-Standalone.jar
```
基座 `itzg/minecraft-server:java21`（本地已有 ✓）；jar 用仓里现成的 `server/geyser-standalone/Geyser-Standalone.jar`（b1245 ✓ 54MB 不入库）。

## 本目录 `config.yml` 与宿主版的唯一差异（关键）
```yaml
java:
  address: gate      # 容器网内直连神社之门（宿主版是 127.0.0.1）
  port: 25700        # 门容器内部端口（宿主版是 25565 裸口 ✗）
```
> 注意块名是 `java:` 不是 `remote:` ✓ 我第一版补丁抓错块名，导致配置仍是裸口（自查发现后纠正）。

## 已验证
- 容器起得来：`Started Geyser on UDP port 19140` ✓ `Done (4.93s)` ✓ `Registered 199 custom block overrides` ✓ 扩展 `SettlementsEntityGate` enabled ✓
- 容器 → 门 TCP：`GATE-TCP-OK`（用 bash 测；容器 `sh` 是 dash 不支持 `/dev/tcp`，会假报 FAIL）

## 未验证 / 缺口
1. **外部设备 UDP 入站**：造物主手机加服务器 `192.168.3.133:19141` 实测（我手搓的 RakNet ping 探针**对照组也失败** ⇒ 仪器无效，不作判据）
2. `settlementsgate` 报 `no roster found`：宿主版从绝对路径读名册 ✓ 容器里要给它容器内路径，否则村民又变无职业/鳕鱼
3. 若转正：`server/geyser-ab/`（被 `/server/` gitignore）里的配置要以本目录为正本 ✓ 并把服务写进 `compose.yml` ✓ 同时停 ViaProxy 并把路由器 UDP 19140 转发指向容器

## 清理
```
docker rm -f qd-geyser-ab
```
