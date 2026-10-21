# FOM 服务端 Numen

2026-10-22：为现役 Minecraft 1.21.1 / NeoForge 21.1.250 / FOM 2.42 增加独立的 Numen 服务端身体入口。正式发布结果见 `evidence/fom-numen-20261022.json`。旧服、旧身体与旧控制器不随之恢复。

## 版本与安装

本轮查询官方 GitHub Releases：适用于 **Minecraft 1.21.1 的最新已发布版本为 Numen 0.1.4.1 beta**，发布于 2026-10-09。

来源：[官方发布](https://github.com/Dwinovo/minecraft-numen/releases/tag/v0.1.4.1-1.21.1-beta)。原 JAR `numen-neoforge-1.21.1-0.1.4.1.jar`，4,581,865 字节，SHA256 `ed4a5936aa182b0d9ab685cb993da54f72514eafb0838bb9a64cd69962cb1226`，与发布 API 的摘要相同。

实际 FOM 此前没有安装 Numen。新增官方核心和已经逐源文件核验的 `maw_numen_compat-0.1.0.jar`、`maw_numen_server-0.1.0.jar`，保留原 103 个 JAR，合计 106 个。API 已内嵌于官方 JAR，无需额外安装。

兼容组件将 Numen 网络频道设为可选，并由服务端提供常驻身体与鉴权；完整 Java 客户端仍需 FOM 原有内容模组，但无需额外安装 Numen。Mineflayer 和基岩沿用原入口。此处没有把旧 MineColonies/Ars/公会桥装进 FOM。

## 接入与身份

- Java 游戏 TCP 28976、Mineflayer TCP 28977、基岩 UDP 28988 保持原样。
- Numen MCP **仅监听服务器本机 `127.0.0.1:28989`**，地址 `http://127.0.0.1:28989/mcp`，需要每个 owner 自己的 bearer；没有新增公网管理端口。
- Numen 控制的是服务端假玩家，与同名 Mineflayer 登录身体不是同一身份。使用返回的 owner UUID、bodyId、控制租约和 action_id，不能套用旧服身份或动作账本。
- 本轮不配置模型 Key、不启动长期模型循环、不自动创建正式服机器人。模型与规划可运行在调用端；远程游戏连接仍可直接使用 Mineflayer。远程使用 Numen 管理入口需另行部署经审查的隧道/代理，不能直接公开此端口。

管理员确认 owner UUID 后，在本机用现有管理脚本发放凭据：

```powershell
E:\MC\runtime\python-3.12.14\python.exe E:\minecraft-ai-friend-society-lab\tools\maw_numen_server.py provision --root E:\MC\servers\fom-2.42 --owner <owner-UUID> --label <名称>
```

返回私有凭据文件路径，不在终端输出 token。当前 FOM 不能运行该脚本的旧栈 `initialize` 或旧栈专用 `health`；使用根目录“查看状态”或 `ops/service-tools/fom_health.py --config ops/service.json` 检查。

标准库 Python SDK：`tools/maw_numen_client.py`，也交付到 `E:\MC\integrations\fom-numen-20261022`。在服务器本机拿本人凭据后：

```text
python maw_numen_client.py --credentials <私有凭据.json> smoke
```

先 `tools/list`、`operations` 查询真实签名，再 `list_companions` / `create_companion`、`claim_control`、`get_state`。每次写动作带唯一 action_id，`action_status` 查询终态；断线后查原 ID，不因超时重放。没有模型配置也能调用 `lua`，示例：

```lua
numen.use.block({x=2,y=-59,z=0})
local window = numen.gui.view()
print(window)
-- 必须先读当前窗口，再用实际槽号移入材料或取出产物。
-- numen.gui.move(sourceSlot, destinationSlot, {count=2})
numen.gui.close()
```

## 本轮真实验收与能力边界

隔离服与正式服同一组 106 个 JAR。普通非 OP 的 Numen 身体使用明确提供的材料，完成：

1. 正常重启后按原 UUID 恢复身体。
2. 打开农夫乐事原生烹饪锅 45 槽界面，放入 2 份米和 2 个碗，自然煮出并取回 2 份熟饭。
3. 用生存背包的机壳放置机械动力方块，再以普通铁镐挖掘。
4. 使用机械动力手摇曲柄；独立服务器方块 NBT 记录实际转速 **−32 RPM**。
5. 自研统一身体适配器通过同一 Numen 身体打开/关闭烹饪锅；原 action_id 重交返回旧终态且不再次打开界面。

不是模型长期自主发展测试，也不是所有模组、全部机器和复杂载具的全覆盖。

当前提供 **17 个 MCP 工具、68 项真实服务端 Lua 函数**。`mod_operations` 明确返回 `native_mod_bridge_unavailable`，`nativeModAccess=false`、专用 mod operations 为 0；不能伪称拥有旧服 99 项模组桥。农夫乐事和机械动力上述流程通过原生 Lua 的交互、物品栏、GUI、建造和挖掘能力完成。统一适配器和 Python smoke 已支持这一模式，其他发现错误仍会拒绝。

Numen 原生背包是 **0–40 共 41 槽**，统一接口标为 `source=native_numen_player_inventory`、`slotNamespace=player_inventory_0_40`，保留非空物品完整组件 SNBT。当前菜单保留实际 containerId 和原生槽位；宿主未提供类型时 `menuType=null`，不能凭 45 槽猜测工作台类型。终态库存增量必须比较同身体、同来源和同槽空间。

原模组 ID、组件、实体和全部 186,696 个状态语义未变化；只增加 26 个可选 Numen 频道。12 行原始几何导出出现最大 `5.55e-17` 的 JVM 浮点末位差异，单独记录后保留原规范资源。既有网页与基岩资源包字节保持；这不等于所有 GUI 或像素一致验收。

## 维护

原 FOM owner/watchdog 同时检查游戏状态和属于同一 JVM 的 Numen 回环监听。启动宽限后连续三次 Numen 故障才正常停止其自有 JVM，由既有退避重启；不终止其他服务。Numen 配置、106 个 JAR 和网关均纳入启动哈希/运行期不变检查。

私有文件位于 `server/config/maw-numen-private`，仅当前 Windows 用户和 SYSTEM 可读写。账户文件可通过显式 provision/revoke 管理，配置/模组/网关变更走正常停服、E/F 双盘冷备和原入口启动。不能趁 owner 运行时替换其静态输入。

发布前备份、真实 Mineflayer/UDP 检查、正式健康与临时服退出情况见本轮 evidence。原始世界、组件、完整包、日志、凭据和候选 JAR 留在 Git 外。
