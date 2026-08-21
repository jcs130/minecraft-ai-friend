# MC 异世界·对外界面与分发蓝图（2026-08-21 造物主三定调）

造物主三条定调：
1. **mc-admin PawApp 必做** —— 项目最核心的对外界面。
2. **整个 MC 服务器做成「插件」形式**，便于分发。
3. 对外先用 **IP+端口直连**；**用户名密码由天神自定并自记**。

---

## 一、mc-admin PawApp（对外界面）

### 1.1 技术底座（已核实 QwenPaw 2.1.0 原生支持）

PawApp = 一个插件目录，QwenPaw 自动识别 `plugin.json` 里带 `meta.pawapp` 的插件：

```
mc-admin/
├── plugin.json            # manifest（entry.backend=main.py, meta.pawapp）
├── main.py                # backend：app = PawApp("mc-admin") + @app.route(...)
└── static/                # 前端构建产物（React/AntD），经 /pawapps/mc-admin/static/ 服务
```

- **backend**：`qwenpaw.pawapp.PawApp` 实例，用 `@app.route("/api/...")` 暴露 JSON API；
  ctx 提供 `chat/storage/tools/ui/notify/toast`（可做实时推送、会话、审批）。
- **frontend**：React/AntD 构建产物放 `static/`，QwenPaw 已内置静态服务 + Console 入口。
- **入口**：登录容器 QwenPaw 后 `/console` 统一面板，或直达 `/pawapps/mc-admin/static/`。
- **认证**：复用容器 QwenPaw 的 JWT（`QWENPAW_AUTH_ENABLED` 已开），mc-admin 后端走同一鉴权。

### 1.2 plugin.json（草稿）

```json
{
  "id": "mc-admin",
  "name": "MC 异世界·女神台",
  "version": "0.1.0",
  "description": "MC 异世界在线状态 / TPS / 祷告流 / 技能生成 / 编年史一屏总览",
  "author": "mc-god",
  "entry": { "backend": "main.py" },
  "meta": {
    "pawapp": {
      "category": "运维",
      "icon": "🏰",
      "entry_page": "index.html",
      "launch_scope": "page"
    }
  }
}
```

### 1.3 一屏功能 + 数据源

| 面板 | 数据源 | 现状 |
|---|---|---|
| 在线状态（穿越者/NPC） | MC 服务端 RCON（25575）`/list` + 世界进程 transmigrators.json | ✅ RCON 可接（mc-rcon 持有） |
| TPS / 性能 | MC 服务端 RCON `/forge tps` 或 Spark | ✅ 可接 |
| 祷告流（祈愿+裁决） | 世界进程祈愿日志（chronicle.jsonl） | ⚠️ 在 A 仓 scratch-plugin/data，待归位 B 仓 data/ |
| 技能生成记录 | B 仓 data/skill-events.json + magic-atoms.json | ✅ 已就位 |
| 编年史 | world-chronicle.md | ⚠️ 在 A 仓，待归位 B 仓 data/ |

### 1.4 backend API（main.py 草稿）

```
GET /api/status     → { online_players, npcs, tps, uptime }
GET /api/prayers    → 祷告流（近 N 条祈愿 + 裁决）
GET /api/skills     → 技能生成记录
GET /api/chronicle  → 编年史（滚动）
```

数据接入方式：mc-admin 运行在 qwenpaw 容器内，世界数据需挂载 world-process 的数据卷
（`mc-data` → `/app/data`）或经 world-process 提供只读 HTTP 查询口。倾向后者（协议接口、
不破坏两项目无文件依赖的天条），即 world-process 暴露 `GET /api/status|prayers|skills|chronicle`
只读端点，mc-admin 经内网 `http://world-process:3200/...` 拉取。

---

## 二、插件化分发（决定 2，待澄清方向）

### 2.1 现状架构（分发要收敛的组件）

| 层 | 组件 | 形态 | 归属 |
|---|---|---|---|
| 游戏 | MC 服务端（NeoForge 21.1.233 + numen + settlements） | 纯 Java | 服务器 |
| 游戏 | numen mod（假玩家/魔法/祈愿收集） | NeoForge jar | 服务器 |
| 世界逻辑 | 世界进程（B 仓 13 个 mc-*.ts，脱壳后 Node） | Node.js 进程 | 服务器 |
| 智能 | 容器 QwenPaw（世界侧 5 agent） | Python 服务 | 服务器 |
| 桥 | minecraft_companion MCP（autoplayer）/ guard-drive | 进程 | 服务器 |

「插件化」的张力点：**世界进程 + 智能层是独立于 MC 服务端的进程**，不是 NeoForge jar。
要让「整个 MC 服务器 = 一个插件（jar 丢 mods/ 即用）」，需把世界逻辑/智能层收进 MC 服务端。

### 2.2 三条可选路径（请造物主定方向）

**路径 A（推荐，现实可行）——「MC 服务端插件 + 一键部署包」**
- numen 已收编 MC 内逻辑（假玩家/魔法/祈愿），继续增强它成为「世界核心插件」。
- 世界进程（裁决/叙事/进化）+ QwenPaw 智能层打包成 **一个 compose/安装包**，随插件分发。
- 分发 = 用户拿到「numen jar + 标准 MC 服务端 + 一键起智能层的 compose」。
- 优点：不动现有架构、落地快；缺点：仍是「多进程」，只是打包成一键部署。

**路径 B——「世界逻辑彻底收进 mod（Java 化）」**
- 把世界进程 13 个 ts 服务重写进 numen（Java），或 GraalJS 在 MC 服务端内跑 Node 逻辑。
- 智能层（LLM）仍需外部（QwenPaw/云端），但世界逻辑全在 jar 内。
- 优点：真·单 jar 插件；缺点：重写成本巨大、LLM 调用仍要外联。

**路径 C——「纯 MC 插件 + 云端智能（SaaS）」**
- MC 侧只留 numen 插件（收集祈愿/执行神迹），智能裁决全走云端 QwenPaw。
- 用户装 MC 服务端 + numen jar，填一个「云端 AgentOS 地址 + 凭证」即接入有神异世界。
- 优点：客户端最轻；缺点：依赖云端在网、离线不智能。

### 2.3 建议

先按 **路径 A** 落地（numen 强化 + 一键部署包 + mc-admin 界面），同时把 numen 与世界进程的
接口收敛成协议（HTTP/MCP），为将来 **路径 C（云端智能）** 留路。是否彻底 Java 化（路径 B）
代价太大，暂不建议。

---

## 三、凭证（决定 3，已定）

- 用户名：`mcadmin`
- 密码：`<见 .env 的 QWENPAW_AUTH_PASSWORD，不入库>`（天神自定，已写 `.env`；`.env*` 已 gitignore）
- 已写 `.env`（`QWENPAW_AUTH_USERNAME/PASSWORD`，`.env*` gitignore 不入库）。
- 访问：本地 `http://<IP>:18088/console`，服务器部署 `http://<IP>:8088/console`。

---

## 四、待造物主拍板

1. mc-admin 一屏五块（在线/TPS/祷告流/技能/编年史）功能范围是否 OK？是否还要加「传送/神迹操作台」（管理员手动降神迹）？
2. 插件化走哪条路径（A/B/C）？
3. 数据接入方式：世界进程暴露只读 HTTP 查询口（推荐）还是 mc-admin 直挂数据卷？

## 五、假玩家与皮肤策略（2026-08-21 定调）

- **假玩家收敛 2 个**：Steve（矿工/建筑师）+ Alex（建筑师/猎人）。官方皮肤库随包走（9 默认 + notch/jeb/dinnerbone = 12），**不扩假玩家**；官方 9 角色不做可选假玩家清单。
- **真人客户端连入：可自选皮肤或自定义**（阶段 2 之后增量，暂不阻塞分发收口）——
  - 现状：皮肤由 skin-proxy（服务端 MITM）按 `skins.json assignments[用户名]→预设` 硬指派，登录 add_player 时注入；真人名字不在表 = 默认皮，无人能自助选。
  - 选皮入口（贴单端口天条·聊天即 API）：进服聊天命令 `/skin <预设>` 或与 NPC 对话，服务器解析 → 更新指派 → 提示「重进生效」→ relogin 后皮肤上身（原版机制：皮肤只在登录时注入）。
  - 自定义皮肤：玩家给 URL / 经 mc-admin 面板上传 PNG → 进皮肤库 → 指派。坑：现 presets 全为 Mojang 签名纹理（value+signature），自制 PNG 无签名 vanilla 客户端可能不渲染，需「离线服自签纹理」小管线。
- 皮肤链路分界：服务器侧 skin-proxy 指派 + 命令解析 = B 仓（mc-god）；客户端选皮 UI（如需图形）= A 仓 scratch-plugin（小智）。

### 5.1 进阶愿景（2026-08-21 造物主）：变身技能 + 造型师 AI

游戏内即可换外观，三步递进（阶段 2 之后）：

1. **变身 = 一条魔法**（换外观，进技艺表，咏唱释放）。坑：原版皮肤只在登录 add_player 注入，变身要即时生效需补「重刷 player_info / 踢重连」机制（即此前暂缓的「在线换肤即时生效」）。
2. **造型师 AI = 一个新神格**（司「容/形」，或女神摇光一项权柄）：生图模型按玩家文字描述画 64×64 皮肤。已有根：`npc_skins_gen.py` 程序化画过 5 张原创皮（岳山/石磊/墨白/云笈/福伯），生图模型（Seedream 5.0）也在体系内——升级为「LLM 理解描述 → 生图 → 套 MC 皮肤 UV 约束（或 LoRA）」。
3. **自签纹理管线** = AI 生成的皮（无 Mojang 签名）能被 vanilla 客户端渲染；与「自定义皮肤」共用地基，是变身与自定义的共同前置。

分界：造型师 AI 独立成神走 QwenPaw agent（与传令官/灶神并列）；皮肤生成、注入、变身魔法落 B 仓（mc-god）。
