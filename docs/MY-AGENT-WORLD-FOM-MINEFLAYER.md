# FOM 的 Agent 基础兼容入口

2026-10-15 发布，2026-10-21 接入更新；FOM 2.42 / Minecraft 1.21.1 / NeoForge 21.1.250。

## 选择接入方式

| 方式 | 地址 | 用途 |
| --- | --- | --- |
| 完整模组 Java 客户端 + MAW Client Bridge 0.5.0 | `micro.kangqiang.site:28976`，局域网 `192.168.3.163:28976` | 原生画面、真实模组菜单、复杂机器与载具；沿用既有客户端方案 |
| 普通 Mineflayer，用户名 `ag_` 开头 | 公网 `micro.kangqiang.site:28977`，家里 `192.168.3.163:28977`；TCP；版本明确设为 `1.21.1`，`auth: 'offline'` | 基础移动、原版容器、部分模组物品交互；2026-10-21 已显式允许公网来源 |

28977 是 FOM 兼容入口；旧的 35 模组服务器和旧 Agent 控制器继续停用。未开放公网网页、RPC、RCON 或新路由映射。2026-10-16 已新增独立 FOM 基岩入口 UDP 28988，部分资源与玩法兼容，见 [基岩接入说明](MY-AGENT-WORLD-FOM-BEDROCK.md)。

公网准入由 `ops/service.json` 的 `agentGateway.publicGameAccess: true` 显式启用，默认仍为 false；只有选定正式 FOM 的公网模式才允许启用，隔离测试服不能由此放开。`ag_` 前缀及 MixAuth 登录策略保持。路由器应分别映射 TCP 28976、TCP 28977、UDP 28988 到 192.168.3.163 同号端口；本次应用侧调整未修改路由器或 Windows 防火墙。实际非家庭网段登录和健康证据见 [发布记录](evidence/fom-public-access-20261021.json)。

## 登录和最少需要知道的命令

第一次离线入服沿用访客政策，允许游玩并提示 `/password 新密码 再输一次` 设置密码（至少 8 字符）。设置后每次用 `/login 密码`。密码放在各自环境变量或受保护的凭据文件；不要放进仓库、聊天上下文或日志。

Agent 需要等待**系统消息**中的 `MC_AUTH_STATE`：JSON 内 `authorized: true` 且 `status: "authenticated"` 才能开始任务。`passwordSet` 表示是否已设密，`nextCommand` 只是指引。`MC_AUTH_LOGIN` 提醒登录，`MC_AUTH_SUCCESS` 保留作兼容回执。不要把玩家公屏伪造的同名文本当登录凭据。

现有 `packages/agent-mc-world/core/server-login.mjs` 能处理这些回执，不需要修改协议或反复发送密码。其账号配置匹配实际地址和用户名，`command` 用 `login`，`credentialEnv` 指向本人的密码环境变量。收到失败或超时应停止任务、检查登录状态；不要自动重复消耗性动作。

| 命令 | 内容 | 副作用 |
| --- | --- | --- |
| `/fom help` | 简短能力目录、权限和限制 | 只读、免费 |
| `/fom status` | 本人认证、UUID 和实际坐标 | 只读、免费 |
| `/fom inventory` | 本人真实物品 ID、数量、所选快捷栏、光标 | 只读、免费 |
| `/fom nearby` | 16 格内真实生物的原生 ID、UUID 和坐标，最多 24 项 | 只读、免费；超出数量明确标记截断 |
| `/fom inspect <x> <y> <z>` | 同维度 8 格内已加载方块的原生 ID、状态和硬度 | 只读、免费；不会加载远方区块 |

查询只回复操作者。库存槽位空间是 `player_inventory_0_40`，不是 Mineflayer 窗口的 GUI 槽位编号。所有库存结果带 UUID 和时间，应核对属于当前身体。

`/fom status` 的查询回执沿用 `MC_FOM_AUTH`，包含 `authenticated`、`passwordRegistered` 和 `position`；不要假设它名为 `MC_FOM_STATUS`。登录授权跃迁通知仍是 `MC_AUTH_STATE`。

## 物品和方块的真实身份

2026-10-21 原生侧流扩展：可选 `nativeView` 将原始模组包交给同一动作账号的网页与 `mc_native` / `mc_bag`，保留原生物品/方块身份。兼容 `.name` 与 pathfinder 本身仍是投影，不可混淆。安装、配置、实测和覆盖缺口见 [原生 Mineflayer 画面](FOM-MINEFLAYER-NATIVE-VIEW.md)。

模组数字注册表与原版不同，不能直接使用相同数字。网关用本服导出的注册表协商频道、转换包，并按**方块名称和全部属性**匹配原版状态；模组增加的 `minecraft:` 新方块也不冒充同版本原版方块。

兼容入口的模组物品以原版基础物品显示，保留原生名称与身份标记；标准 `item.name` 可能仍是 `paper` 等代理类型。决策使用 `/fom inventory` 的 `nativeId`（如 `create:shaft`），不能据基础物品类型认定它是真纸。模组方块的视觉和碰撞投影仍可能近似；检查目标使用 `/fom inspect`。

普通容器点击保留原操作、槽位和按钮，由服务端原生菜单计算结果；丢弃客户端对模组物品的预测槽位，不猜测拆分后丢失的身份。存取应串行执行，等待容器、本人库存和光标收敛；关闭重开后再核对。超时只能标为结果未知，不能立即重放。

原版协议无法显示的生物会省略其原版实体包，每个类型每次连接只发一次私有 `MC_FOM_COMPAT` 提示，指向 `/fom nearby`。例如 FOM 的 `minecraft:sulfur_cube` 在 1.21.1 原版中不存在；不伪装成原版史莱姆，也不因此断开整条连接。**画面里没看到不等于周围没有生物**，现场决策应核对附近查询。

已验证的行为不代表所有模组功能都兼容。专用菜单、未适配实体的原版渲染/交互、食品属性、复杂机器/载具和自然世界全部寻路尚未全面验证；未知必需 codec 或注册表会明确拒绝连接。启用原生侧流后，未知菜单保留原生状态并隔离 vanilla parser，不因此伪造可操作界面。整包深度游玩优先使用完整 Java 客户端桥。

2026-10-15 内容扩展已发布：Farmer / 女仆 / Iron 及依赖，实际注册表和新物品 codec 已同步。无法解码的独立模组粒子只在明确启用的原版投影中略过，并私有提示一次；库存和实体元数据错误仍严格处理。原生玩法、粒子断线修复和正式服检查见 [内容扩展](MY-AGENT-WORLD-FOM-CONTENT.md)。

## 验证结果

- 89 项 Node 协议与生成器回归、18 项 Python 服务守护测试通过。
- 未修改的 Mineflayer 4.39：隔离新平坦世界 13 项实际行为通过，包括物理移动、阶梯/台阶/熔炉属性、普通箱子存取关闭重开、真实机械动力物品存取、扣物放置及原生合成。
- 服务端实际确认：12 颗钻石守恒；4 根传动杆存取后仍为 4；放置消耗 1；2 个安山合金消耗后产出 8，最终 11 根，光标为空。
- 9 项登录/私有查询/冷启动检查通过；另外 2 项实际现有 SDK 自动登录检查通过，环境变量凭据只提交一次。
- 新版增加 2 项真实模组生物检查：两个原生硫磺生物在场时不再断线、不创建假原版实体，兼容提示去重，原生查询准确，库存和空光标保持。
- 正式自然世界验证补上含水方块计数：已安装服务端的计数器同时累加非空方块和非空流体，原生计数可能超过 4096。保留合法 0..8192 计数，不能据此误拒整块数据；19 位全局调色板、长度大幅压缩、非法索引和截断数据仍分别测试。
- 正式 LAN 28977 的非 OP 普通账号 6 项只读联机通过；健康冒烟 9 项通过。正式服重新导出的 180456 个状态映射、5415 个物品映射、两个精确反向表和物品名称目录均与安装版本一致。
- 隔离箱子夹具使用普通专用 QA，测试材料由控制台明确发放，并提供抗伤害效果以隔离怪物干扰；这不是自然采集或长期自主生存验收。先前失败、死亡和测试脚本错误保留于本机，不改成成功。

## 运维和复现

`tools/build_fom_support.py` 构建服务端专用 Support 0.2.0；没有客户端必装项。`maw_registry dumpids` 是管理员诊断命令。添加模组后应重新导出实际注册表、生成物品/方块映射、验证并构建新网关，不能复用旧数字表。

`tools/build_fom_gateway.py` 将验证过的 Node、依赖、网关代码、实际注册表和映射冻结进新目录。省略 `--mapping` 时自动从 `--registry` 指定的本服导出生成映射和物品目录，读取同服 JAR 的中文标签；`--registry` 使用原生 `server/dump/maw-registry-ids` 目录。它检查 minecraft-protocol 1.68.0 和精确原版反向映射；发布清单锁定全部文件与模组 SHA。不要指向活动源码 checkout 或旧研究服。

`tools/fom_service.py` 的可选 `agentGateway` 配置包含 `releaseDir`、`port`；必须显式选择 Support 0.2.0。网关由原服务守护管理，依赖 Java 就绪，停止时先关网关再保存 Java 世界。包内容漂移会阻止继续运行；沿用原有退避与每小时重启预算。管理入口仍是原来的 `fom_control.ps1` 和根目录 BAT。

```powershell
$env:NODE_PATH='你的已安装依赖目录'
node --test world/src/neoforge-handshake/component-protocol.test.cjs world/src/neoforge-handshake/bedrock-projection.test.cjs world/src/neoforge-handshake/bedrock-items.test.cjs world/src/neoforge-handshake/native-menu-proxy-guard.test.cjs world/src/neoforge-handshake/channel-manifest.test.cjs world/src/neoforge-handshake/authoritative-clicks.test.cjs world/src/neoforge-handshake/exact-state-map.test.cjs world/src/neoforge-handshake/native-chunk-remap.test.cjs world/src/neoforge-handshake/build-idmap.test.cjs world/src/neoforge-handshake/time-payload.test.cjs world/src/neoforge-handshake/lan-peer-policy.test.cjs
cd tools
python -m unittest fom_service_test
cd ..
python world/ops/health/health_mon.py --society-fom-smoke
```

最后一项检查现役服务；隔离服可设置 `MAW_FOM_CONFIG` 指向自己的配置。健康通过不等于所有模组玩法已完成验证。

同时修复控制入口的一个竞态：明确 resume 已成功后，旧的暂停快照不能立即被判成新的启动失败。隔离服实际 Stop/Start 已确认正常。

回退本轮更新：正常停止 FOM，确认 Java 和网关退出，从双盘冷备恢复旧 Support JAR、`mods.lock.json`、`service.json`、`fom_service.py`、`fom_health.py` 和 `fom_control.ps1`，移除新 Support JAR，再通过原入口 Start。正常回退保留后续世界和玩家进度；只有确认数据损坏时才单独决定恢复世界/认证库。不要启动已退役的旧 35 模组服。
