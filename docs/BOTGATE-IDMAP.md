# 号映射权威（Botgate ID Map）· 单一事实源

> 2026-09-21 定稿。本文件是「NeoForge ↔ 原版 blockstate/item 号映射」的**权威说明**。
> 部署动作见 `docs/deploy-release-runbook.md` §5；容器内速查卡见 `world/src/neoforge-handshake/README.md`；
> Agent 接入手册见 `docs/AGENT-ONBOARDING.md`。
> **权威仓库 = 本仓（`D:\Projects\QiandengJi` = remote `jcs130/minecraft-ai-friend`，分支 `codex/performance-foundation`）**
> —— `D:\Minecraft\minecraft-ai-friend` 是旧栈 clone，只作运行副本，**不得作为号表或规程的源头**。

---

## 1. 为什么必须有这张表

NeoForge 装了**带内容的模组**后，网络上跑的 blockstate / item **数字编号 ≠ 原版静态表编号**。
任何按原版表解码的客户端（mineflayer、基岩 Geyser、任何 vanilla 协议客户端）都会读到一个**错位世界**：

| 症状 | 实测根因 |
|---|---|
| 红床读成活塞、书架读成刻纹书架、obsidian 读成**火**（"地上一片火海"） | 高段号错位 ✓ **低段号侥幸正确**（所以村庄/地形看着没问题，别据此判断"映射是好的"） |
| 模组物品图标空白 | 号落在原版表外 |
| Agent 寻路/挖掘/避怪失真 | 它活在错世界里，**翻译层是 Agent 可用性的地基，不是优化项** |

**这张表离线推不出来**（历史上按字母序、id 序、H1/H3 假设全部拟合失败）→ **必须从服务端注册表导出**。

---

## 2. 单一事实源在哪（三层落点）

| 层 | 位置 | 说明 |
|---|---|---|
| **号表本体** | `world/src/neoforge-handshake/idmap.json`（≈1.7MB，**入 git** ✓） | `generatedAt` / `states` / `items` / `fallbackBlockState` / `report` |
| **生成器 + 规则** | 同目录 `build-idmap.cjs`（**入 git** ✓） | 读 `idmap-dump/{blocks.tsv,items.tsv}` + minecraft-data 原版表 → 产号表 |
| **原始导出** | `world/src/neoforge-handshake/idmap-dump/{blocks.tsv,items.tsv}`（入 git ✓） | 由服务端插件 `/botgate dumpids` 导出：`blocks.tsv = name⇥blockIdstateBase⇥stateCount`，`items.tsv = name⇥itemId` |
| **容器内** | `qiandengji-gate-1` / `gate-public-1` 的 `/app/src/neoforge-handshake/` | compose 把宿主 `world/src` **只读 bind-mount** 进去 ✓ 所以**改宿主文件 + `docker restart` 两道门即生效** ✓ 不重建镜像、不重启世界、不掉玩家 |
| **服务端导出器** | `world/botgate-src/dev/god/botgate/IdDump.java`（jar 产物 `world/botgate-src/botgate.jar` 被 gitignore ✓ 以源码为准） | `/botgate dumpids` 只读导出，不改动世界 |
| **回滚备份** | `idmap.json.bak-*` | **已 gitignore**（本地留，勿入库） |

---

## 3. 覆盖面：门翻的四类包（逐类实测过）

| 包 | 内容 | 处理 | 状态 |
|---|---|---|---|
| `map_chunk` | chunkData 是 **raw buffer** | `remapChunkBuf()`：prismarine-chunk('1.21.1') `load → 翻 palette/单值段 → dump` | ✓ 实测 9/9 高位号读对 |
| `block_change` | `{location, type}` 单块实时变更 | 字段名就是 `type`（pktspy 定谳） | ✓ 1s 内应用，号 4276 = diamond_block |
| `multi_block_change` | `{chunkCoordinates, records:varint[]}` 1.20.5+ 批量（`fill`/结构/模组） | **record = `stateId<<12 \| 局部坐标低12位`** ✓ 实测 `rec=[19504904,19537671] → >>12=4761/4769` 反推定谳 ✓ 用 `Math.floor(r/4096)` 避开 JS 32 位符号坑 | ✓ 2026-09-21 补（此前漏翻 → 批量变更在客户端读成 air） |
| 含 ItemStack 的包 | `set_slot` / `window_items` / `container_set_content` / `entity_equipment` … | `itemId` 逐栈翻译 + 通用 deep（**只碰 `BLOCK_KEYS`/`itemId`，绝不碰 `entityId`/`windowId` 这类同名 id**） | ✓ |

- 反表（原版→NeoForge，供入站）在 `finalize()` 里构建，**必须恒等对优先**：模组物品常被近似到 paper/stone 等通用原版号，若后插入会顶掉真 paper 的反查。
- `direct` 调色板段（无 palette）当前分支不处理：实测 201 chunk / 1440 段中 **direct = 0** ✓ 风险为零，但 `audit-idmap.cjs` 会持续量化它。
- **实体类型号未翻**（`idmap.json` 只有 states/items）→ 模组新增生物类型号未处理，基岩端村民变鳕鱼历史上靠 Geyser 扩展 `settlementsgate` 救。

---

## 4. 兜底策略：不是"一律 paper"，是"最接近的原版"

**方块**（`FAM` 家族表）：`prefab:block_compressed_stone → stone_bricks` ✓ `block_paper_lantern → glowstone` ✓ `block_glass_slab → smooth_stone_slab` ✓ …

**物品**（三级递进 ✓ 级 1 最准 ✓ 逐级降级 ✓ 实测兜 paper **3825 → 303**，覆盖 **68 种**代理物）：
1. **级 1 同名方块**：模组物品名命中方块映射 → 用那原版方块的物品（3231 个，占大头）
2. **级 2.0 工具/护甲带材质**（`tierFamOf`）：先判种类（sword/axe/pickaxe/shovel/hoe/helmet/chestplate/leggings/boots）再判材质（netherite>diamond>golden>iron>stone>leather>wooden），拼出的名字**必须在原版表存在**，否则降级（原版无木/石头盔 → leather）
   `item_swift_blade_diamond → diamond_sword` ✓（不是笼统 iron_sword）
3. **级 2.1 语义家族**（约 70 条正则，**顺序即优先级**）：`scroll/tome/codex → enchanted_book` ✓ `staff/wand/mace → blaze_rod` ✓ `spawn_egg → chicken_spawn_egg`（**必须排在 `/egg\b/` 之前**，否则刷怪蛋被当普通蛋 ✓ 实踩过）✓ `stew → mushroom_stew` ✓ `key/coin/token → gold_nugget` ✓
4. **级 3 兜底 paper**

**两条红线**：
- 新增规则的目标名**必须校验存在**（`vi.has(target)`）✓ 生成器 fail-fast 会打印 `badRules` ✓ **`badRules` 不为 0 就不算绿**（写错名会把 `undefined` 灌进号表 = 线上物品变未知号）
- 代理号**只影响显示与识别，不是可操作身份** ✓ 要真用模组物品请拿完整 id（RCON `give` / `/mycli`）

**状态保真**：服务端状态数与原版不等时（模组给原版方块加了属性，如 `note_block`），映射写为 `vBase + Math.min(k, vcnt-1)`（逐号推进 + 夹在合法段内）✓ **不得整段压平到基态**（2026-09-21 修过一个此类 bug：1299 个 note_block 状态被压平）。

---

## 5. 重建流程（增删模组 / 换 NeoForge 版本后**必做**）

```
1) RCON:  /botgate dumpids                          # 服务端只读导出
2) 把 dump/botgate-ids/{blocks.tsv,items.tsv} 拷到 world/src/neoforge-handshake/idmap-dump/
3) cd world/src/neoforge-handshake
   copy idmap.json idmap.json.bak-<日期>            # 先备份，可秒回滚
4) node build-idmap.cjs                             # 必须看到 badRules=0
5) docker restart qiandengji-gate-1 qiandengji-gate-public-1     # 只重启门，不动世界
6) 验收两件必须全绿（2026-09-22 起容器内跑，见 §6；宿主跑只作兜底）
7) git add world/src/neoforge-handshake && git commit && git push # 号表入仓，防漂移
```

号表是**快照**：模组变了不重生成 = 静默世界错乱。目前**没有自动新鲜度检查**（待办：门启动时比对 `generatedAt` 与服务端注册表指纹）。

---

## 6. 验证与体检（两件常驻工具，别再手写一次性探针）

```
# ① 容器内跑（正道 · 2026-09-22 起）：world 容器自带 mineflayer 4.37.1 + vec3，
#    走 compose 内网 gate:25700 / mc:25575，全程不出宿主（铁律：游戏相关的都在容器里）
PW=$(docker exec qiandengji-mc-1 sh -c "grep '^rcon.password' /data/server.properties | cut -d= -f2")
docker exec -e GATE_HOST=gate -e GATE_PORT=25700 -e RCON_HOST=mc -e RCON_PORT=25575 \
  -e RCON_PASS="$PW" qiandengji-world-1 node /app/src/neoforge-handshake/verify-gate.cjs

# ② 宿主兜底（world 容器不可用时；RCON_PASS 必须先注入环境变量，mineflayer 落到 scratch 钉版）：
node verify-gate.cjs                        # 内门 25701，11 项冒烟
node verify-gate.cjs 127.0.0.1 25568        # 基岩桥 Java 入口 = 基岩同一条上游（免手机验基岩）
#   （25566 皮肤代理入口一行已删：皮肤代理 2026-09 已退役，YSM 接管形象）
node audit-idmap.cjs                        # ①号表 vs 注册表覆盖率对账 ②双向往返恒等 ③chunk 段模式分布
```
2026-09-22 双路复验：**容器内 11/11 ✓（gate:25700）· 宿主兜底 11/11 ✓（127.0.0.1:25701）**
2026-09-21 基准：verify **11/11 ✓ exit 0**（含 4 项**状态保真**：楼梯朝向+上下 / 半砖类型 / 箱子朝向 / 熔炉 lit —— 只比方块名**测不出状态被压平**）· audit `states 116650 == blocks.tsv 声明数 ✓`、`items 5158 == items.tsv 行数 ✓`、往返 **8/8 恒等 ✓**、`direct = 0 ✓`

**判"过门没有"只能用链路证据**（门日志 `docker logs qiandengji-gate-1 | grep 叩门` 的名单、或进程实参），**不能用"画面看着对"** —— 低段号本来就对，裸连也画得出正常村庄。

---

## 7. 全链路拓扑（2026-09-21 实测收编后）

| 通路 | 现在指向 | 过门？ | 验证 |
|---|---|---|---|
| 真人 Java 客户端 | `0.0.0.0:25565` → mc:25599 | 不需要（装了 NeoForge ✓ 原生对表） | 萌萌实测 |
| 本机兼容裸口 | `127.0.0.1:25567` → mc:25599 | ✗ **Agent 禁用**（旧 README 曾推荐，已更正） | — |
| **内门**（容器内/本机 Agent） | `127.0.0.1:25701` → gate:25700 | ✓ | 11/11 |
| **外门**（外部 Agent，名字须 `ag_` 前缀） | `0.0.0.0:25702` → gate:25700 | ✓ | `ag_probe` 进门 ✓ 内部名门口拒 ✓ |
| `world` 服务（Goddess 化身 + **天神之眼**） | `gate:25700`（`MC_GATE_TRANSLATED=1`） | ✓ 14:37/15:14 | 门日志 `Goddess 叩门→PLAY` ✓ healthz `mode=gate-translated` ✓ |
| 守卫之眼 `guard-render-*.mts`（`render_view`） | `GUARD_RENDER_PORT` 默认 25701 | ✓ 15:41 | 门日志 `RenderBot 叩门→PLAY→603 chunk→err=none` ✓ |
| **基岩桥 ViaProxy（宿主 java）** | `--target-address 127.0.0.1:25701` | ✓ 14:37 | `verify-gate 127.0.0.1 25568` → 11/11 ✓ 手机确认正常 ✓ |
| **皮肤代理 skin-proxy（宿主 node）** | `SKIN_UPSTREAM_PORT=25701` | ✓ 20:4x | `verify-gate 127.0.0.1 25566` → **11/11 exit 0** ✓ |
| ~~基岩桥容器化~~ 试验 | 裸 Geyser 与容器化 ViaProxy 各试一轮 | — | **未通过 ✓ 已收掉试验容器** 副产品：**证明容器 UDP 外部入站可用**（手机确实打进容器发布口 ✓ 2026-08-30 旧论作废 ✓）；但容器内 ViaProxy 直连 `gate:25700` 时前端卡 CONFIGURATION、后端进 play 即被 MC 关闭（`back_total=0` + `socketClosed`），而宿主 ViaProxy 经 `127.0.0.1:25701` 正常入服（`entityId=83672`、36508 包）→ 根因需抓包级对比 ✓ **ViaProxy 暂留宿主 = 唯一剩余例外** ✓ 详见 `world/host-services/geyser-container/notes.md` |
| numen MCP | 容器服务 `numen-mcp`（宿主 `127.0.0.1:18091`） | 不经游戏协议口（走 RCON `mc:25575`） | `numen__get_world_info` 等实测 ✓ |
| ~~`mc-gateway`（宿主 python ✓ 8011）~~ | **已退役 2026-09-21** | — | `8011 RELEASED` ✓ 代码与 DB 未删 ✓ 回滚 `schtasks /change mc-gateway-autostart /enable` + `/run` |

**RCON 不绕门** ✓ 管理面（`MC_RCON_HOST=mc` / 宿主 `127.0.0.1:25577`）保持直连：门不转发 RCON，也不该转发。

---

## 8. 安全收口（外门 = 公网入口）

- 现 `white-list=false` ✓ **前缀闸只挡名字、不挡准入**（`ag_probe` 无白名单就进门进过 PLAY ✓ 实测）
- 公网开 25702 前：`whitelist add <ag_独占名>` → 全员备齐 → `whitelist on`（RCON 即时生效，不用重启）；已预置 14 个自家号，**没填就开 = 把自家 AI 锁在门外**
- **绝不转发公网**：`25577` RCON / `19091` 面板 / `19092` 观战 / `25567` 裸口 / `445` SMB / `3389` RDP ✗
- **不要把裸 `25565` 转发给 Agent**：离线模式 + 无 Floodgate = 可被冒名 `Kirito`/`Goddess` 抢身份与家当 ✗
- 被前缀闸拒绝时客户端表现为**挂断/超时**（不是友好提示），Agent 侧要自己处理连接失败

---

## 9. 已知缺口（别当已完工）

1. 实体类型号未翻（需 `IdDump` 加 `entities.tsv` + 翻 `spawn_entity.type`）
2. `packet_entity_metadata` 解析洞未修（mineflayer/protodef 读不懂模组实体元数据 → Agent 实体视图有洞）
3. 号表无自动新鲜度检查（模组变更后忘记重建 = 静默错乱）
4. **持久性隐患**：宿主侧服务脚本被 gitignore 排除 —— `ops/docker/.gitignore` 的 `shadow/`（基岩桥 bat + Geyser 配置 + `settlementsgate` 扩展 jar）、`.gitignore` 的 `/server/`（`geyser-ab` 试验配置）✓ 正本已收进 `world/host-services/`（见该目录 README），但**运行副本与仓内正本需人工同步**
5. Geyser 容器版若转正：`settlementsgate` 在容器里 `no roster found`（宿主版从绝对路径读名册）→ 须给容器内路径，否则村民又变无职业
