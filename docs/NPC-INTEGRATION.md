# NPC 与技能书消费链迁移

迁移代码：`world/sidecar/mc_npc.py`、`world/sidecar/mc_guild.py`。来自现有世界端同名模块，依赖仅 Python 标准库；复用已存在的 `mc-sidecar:2.1.0` 镜像即可。源码挂载到新项目，生产源码/数据未修改。

## 接入关系

- `botgate` 技能书使用事件写 `/mcdata/spell-requests.jsonl`。
- `mc_npc.spell_loop()` 读取新增事件，保留原有 `light/heal/home/give` 效果、冷却和 `tellraw` 回执，并写 `/mcdata/npc-feed.jsonl`。
- 任意已学法术保留 `execute as <玩家> at @s run mycli cast <法术>` 路线，由原 Numen 命令桥/世界法术引擎处理。不能把请求写入或 RCON 命令发出等同于效果已成功。
- 玩家交易 `npc-inbox.jsonl` 与神谕 `god-inbox/god-reply.jsonl` 使用 `/world-data`，与世界进程的 `MC_DATA_DIR` 同一个宿主目录。
- 技能定义和已学状态读取 `/world-data` 的权威文件；NPC 村民档案、技能书请求与回执使用 `/mcdata`。
- 世界进程还应设置 `STATUS_REQ=/mcdata/status-requests.jsonl`，让 botgate 的手札请求落到已有状态书消费者。`CHANT_REQ` 继续使用世界进程既有 `/app/data/chant-requests.jsonl`。

## 当前 Compose 服务段

已由根协调者合并进根 `compose.yml` 并启动，以下路径与当前配置一致。

```yaml
  npc:
    image: mc-sidecar:2.1.0
    pull_policy: never
    restart: unless-stopped
    entrypoint: ["python3", "-u", "/opt/sidecar/mc_npc.py"]
    environment:
      TZ: Asia/Shanghai
      NPC_DATA_DIR: /mcdata
      MC_DATA_DIR: /world-data
      NPC_MAGIC_DIR: /world-data
      NPC_LOG_PATH: /mclogs/latest.log
      MC_RCON_HOST: mc
      MC_RCON_PORT: "25575"
      MC_RCON_PASSWORD_FILE: /world-data/rcon-secret.txt
      NPC_SPAWN_MISSING: "0"
      NPC_VILLAGE_GUARD: "0"
      NPC_GUILD_AUTOGENERATE: "0"
      NPC_LLM_ENABLED: "0"
    volumes:
      - ./world/sidecar:/opt/sidecar:ro
      - ./tools/npc_health.py:/opt/npc_health.py:ro
      - ./server/world-data:/world-data
      - ./server/mcdata:/mcdata
      - ./server/mc/logs:/mclogs:ro
    depends_on:
      mc:
        condition: service_healthy
      world:
        condition: service_started
    healthcheck:
      test: ["CMD", "python3", "/opt/npc_health.py", "--state", "/mcdata/npc-health.json"]
      interval: 20s
      timeout: 5s
      start_period: 45s
      retries: 3
```

Compose 启动命令需带项目已有 `.env` 配置：`docker compose --project-name qiandengji --env-file .env up -d npc`。优先使用项目管理脚本已提供的启动入口，以保留根任务生成的 RCON 密钥。

## 与原部署的必要差异

- 路径必须由环境变量明确提供。Windows 运行只允许新项目的 `server` 子树；容器只允许 `/mcdata`、`/world-data`、`/mclogs` 挂载。禁止默认回退到原 C 盘运行态。
- RCON 仅允许容器 `mc:25575` 或宿主测试端口 `127.0.0.1:25577`，不会误连宿主生产 25575。密钥从新项目已有文件读取，不复制原值。
- 开机不重召失踪 NPC，不执行旧模组白名单的自动清怪，也不自动生成公会建筑/实体。已有 NPC 对话、贸易和已导入的公会任务保留；三项自动行为保留代码和显式开关，需单独验证后启用。
- 2026-09-07 世界内容修复：`NPC_GUILD_BASIC_QUESTS=1` 允许无当日板时生成普通任务，`NPC_GUILD_AUTOGENERATE=0` 仍禁止新营地/宝箱/Boss。公会轮询由 `start_npc_thread` 监督并输出 `guild-health.json`。不一致的旧收购单、未核验旧地点和新 Boss 接取会被拒绝；已有板/功勋保留。`公会 看板` 与 `公会 接 7` 的真实聊天及原板字节不变已验收，见 `reports/guild-board-smoke.json`。
- 原有 `unleash_alive` 会对现存 NPC 写入 `NoAI:0b`，恢复自由活动；这会修改并保存实体 AI 开关。日常看护还会回拉离家过远的现有 NPC、刷新柜台。不是只读世界模式，不会因此创建或删除 NPC。旧 `dedup_npc` 已是只观测实现。
- 不继承村庄配置中的旧生产模型端点。若需要 NPC 模型能力，显式设置 `NPC_LLM_ENABLED=1` 与 `NPC_LLM_ENDPOINT` 或 `NPC_AGENT_ENDPOINT`；当前默认使用原有模板对话。
- 技能线程由进程内监督器重启；容器崩溃由 `restart: unless-stopped` 拉起。`npc-health.json` 每 5 秒更新，健康探针要求技能消费线程存活、持续轮询及近期 RCON 成功。
- 原有队列从启动时 EOF 开始，不重放旧请求。进程重启瞬间的未处理事件仍可能跳过，这是原有队列语义；不声称恰好执行一次。
- 当前服务端已部署 RCON 完整帧读取补丁，世界端允许 65522 字节载荷；全新 QA 的自然命格书发放及客户端接收已成功，旧的原版 1460 字节读取限制已不再作为本轮结论。`[offer] synced` 仍不能证明柜台选择器找到了实体或实际成交。
- 原 NPC 档案与实体存在遗留不一致：mobai/yunji/fubo 档案指向 `settlements:base_villager`、新村庄约 `(-520,70,840)`；原 C 与 D 的该区域存档均未找到对应 tag。对应旧 tag 实体在旧坐标约 `(-100,66,170)`，类型为原版村民/盔甲架，所在区域与原文件字节一致并含大量历史重复实体。本轮未加载旧聚集区、未重建或删除 NPC，因此柜台贸易没有通过实际验收。证据：`reports/npc-trade-runtime.json` 和 `reports/npc-persisted-entity-check.json`。

## 必须完成的实际验证

1. 服务启动后运行 `python tools/npc_health.py`，确认 `ok=true`。
2. 用专用 QA 玩家实际使用原有 `light` 技能书，确认 botgate 追加 `speaker/skill=light` 请求。
3. 断言 QA 玩家火把数量增加 4，且收到技能书点对点回执；`npc-feed.jsonl` 应有匹配玩家的 `kind=spell` 记录。
4. 再测试一个既有自定义法术，确认原世界引擎回执和法力/效果变化；不能仅依据 sidecar 的 `cast` 日志宣称成功。

实际 `light` 闭环已于 2026-09-07 通过：专用玩家 `QDNpcProbe` 用 Mineflayer 真正右键带 `custom_data.skillbook=light` 的书，botgate 追加请求，NPC 消费后火把从 0 增至 4；NPC feed 和客户端 `[女神]` 回执均匹配。临时书、4 火把已清理，玩家退出确认。验证等级为 `book-interaction`，未使用队列注入兜底。报告：`reports/npc-smoke-20260906T234503645106Z.json`；重跑入口为 `python tools/smoke_npc.py --execute qiandengji`，与其他 QA smoke 共用独占锁。

最终帧补丁部署后，全新 `QDTradeProbe` 在自然首次登录流程收到一份带 `statusbook` 标记的命格书；客户端背包与 world 的 `Gave 1 [命格书]` 回执均确认，本次 QA 长命令错误为 0。玩家已退出，测试未传送或手工修改背包。此项与柜台交易分别判定，见 `reports/npc-trade-runtime.json`。

离线回归：`python tools/npc_health.py --self-test`。它从迁移源码提取原技能书消费函数，使用假队列与假 RCON 验证 `light` 的既有效果和回执，并测试健康状态过期/线程退出；不连接游戏，不改变存档。它不能代替上述游戏内端到端验证。
