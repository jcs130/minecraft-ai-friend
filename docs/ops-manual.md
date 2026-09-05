# 我的世界·异世界千灯纪 — 开发运维手册

> 更新：2026-09-06（女仆法术纪）· MC 1.21.1 + NeoForge 21.1.248 · 维护者：天神（mc-god agent）
> 本文档同步存于：B 仓 `docs/ops-manual.md`（权威源，桌面副本由此派生）

## 1. 世界概况

| 项 | 值 |
|---|---|
| MC 版本 | 1.21.1 |
| 加载器 | NeoForge 21.1.248 |
| 种子 | 3620753367502722513 |
| 出生点 | -544, 864（千灯镇平原村） |
| 现役 mod | 68 个（清单权威：`ops/docker/modpack.json` v3） |
| 世界名 | shadow（数据在 `ops/docker/shadow/mc/shadow/`） |

## 2. 容器栈全景（docker compose -f ops/docker/shadow/docker-compose.yml）

**核心链（服务器侧）：**
| 容器 | 用途 | 端口(宿主) | 数据/源码 |
|---|---|---|---|
| shadow-mc | MC 服务器（itzg 镜像） | 25599 游戏直连 / 25575 RCON | `ops/docker/shadow/mc/`（mods/config/世界） |
| shadow-world | 女神化身 mc-bot + 世界进程 | — | B 仓 `mc-bot.ts` 等 |
| shadow-gate | 神社之门协议代理（bot 协商中继） | 25700 | Taro 等穿越者 bot 走此门 |
| shadow-qwenpaw | QwenPaw Agent 服务（天神/司灯等 agent） | 18088 | `shadow/copaw/` |

**语音链（全本地）：**
| 容器 | 用途 | 端口 |
|---|---|---|
| shadow-asr | 天耳（whisper 语音识别，萌萌语音→文本） | 8124 |
| shadow-tts | 神语阁（IndexTTS 2.5，中文 TTS，14 嗓） | 8100 |
| shadow-voice | 天音（女神语音播报 watcher） | — |
| shadow-sentinel | 值班哨（世界巡检） | — |

**Web 侧：**
| 服务 | 用途 | 端口 |
|---|---|---|
| web-panel | 观星台面板（A 面板 2.2.0） | 8011 |
| modern-viewer | 现代画面渲染（three.js） | 8010 |

**宿主进程（仅白名单）：** QwenPaw 主服务（8088）、MCP server（venv python）、Chrome host。

## 3. 关键路径

```
C:\Users\lzl19\.copaw\workspaces\default\minecraft-ai-friend\   ← B 仓（唯一物理 clone）
├─ ops\docker\shadow\docker-compose.yml        ← 容器编排（含历史决策注释，改配置先读注释）
├─ ops\docker\shadow\mc\mods\                  ← 服务端 mod（68 个，gitignored）
├─ ops\docker\shadow\mc\mods-disabled\         ← 冻结 mod（settlements 系/roadweaver）
├─ ops\docker\shadow\mc\config\                ← 全部 mod 配置
│  ├─ touhou_little_maid-server.toml           ← 女仆主配置（ClientPackDownloadUrls=中文语音包下发）
│  ├─ touhou_little_maid\sites\llm.json        ← 女仆 AI 大脑（当前=codingplan qwen3.7-plus）
│  ├─ touhou_little_maid\sites\tts.json        ← 女仆说话嗓（当前=神语阁 cosy_female 中文）
│  └─ maid_self_talk-common.toml               ← 女仆自言自语/互聊（已开）
├─ ops\docker\shadow\gpu-tts\tts_api.py        ← 神语阁源码（bind 挂载，改后 restart shadow-tts 即生效）
├─ botgate-src\                                 ← botgate mod 源码（六网络门，javac 直编）
├─ ops\docker\modpack.json                     ← mod 清单 v3（与 mods 目录 68=68 对账）
└─ shadow\mc\shadow\                            ← 世界数据（playerdata/region/…，定期备份）
```

## 4. 女仆生态（2026-09-06 女仆法术纪）

- **mod 五件套**：touhoulittlemaid 1.5.3 + teallib + self-talk 1.1.2 + affection 1.7.2.2 + **touhou_little_maid_spell 1.8.4**（女仆拿法术书施法+归隐之地维度）
- **铁魔法三件套**：irons_spellbooks 3.16.3 + geckolib 4.9.2 + irons_lib 2.1.0（**irons_lib 缺失=启动 FATAL**）
- **女仆 AI**：sites/llm.json → DashScope codingplan（qwen3.7-plus，key 在配置里，勿外传/勿 commit）
- **女仆语音**：AI 聊天 TTS → 神语阁中文嗓（GPT-SoVITS 兼容层）；环境语音 → 服务端下发 5 个中文声音包（纳西妲[花玲配]/煊煊/秋夕/籽岷/咕咕嘎嘎），客户端女仆菜单-下载界面一键装
- 召唤女仆：`execute at <玩家> run summon touhou_little_maid:maid` → 手持蛋糕右键驯服（可能要多次）
- 新女仆模型随机；换模型在女仆 GUI；法术书给女仆装备即可施法

## 5. botgate（协议六门，撤不得）

settlements 退役时其 settlementsfix 里六个通用网络门被提炼成独立 mod `botgate.jar`（源码 botgate-src/，`python build.py --pack --deploy <mods>` 重编）。**它是 mineflayer 女神化身/基岩客户端能连 NeoForge 服的命脉**：
1. PayloadRegistrarForceOptional — 所有 mod payload 强制 optional（协商总闸）
2. CheckPacketSendGuard — checkPacket 对包裹类放行（治 immersive_aircraft vehicle_upgrades 踢人）
3. ConfigTaskGateForNonNeoForge — 非 NeoForge 连接跳过 mod CONFIG 任务
4. RecipePacketGate — 非 NeoForge 连接不下发配方包
5. EquipmentPacketGate — 装备包剥 mod custom_data
6. BetterCombatConfigTaskGate — BC 配置任务按连接类型分流

**监控**：日志打点 `[CFG-GATE]`/`[RECIPE-GATE]`/`[BC-GATE]`/`[EQUIP-GATE]` 消失=mixin 失效（NeoForge 升级时必查）。
**教训**：撤任何 mod 前先查它的 mixin 是否被别的系统依赖。

## 6. 常用运维

```powershell
# 重启服务器（配置/mod 变更后）
docker restart shadow-mc
# 看日志（启动 60-90s，Done 行=就绪）
docker logs shadow-mc --tail 100 | findstr /i "Done FATAL ERROR"
# RCON
docker exec shadow-mc rcon-cli list
docker exec shadow-mc rcon-cli "say 你好"
# 女神化身掉线排查：先看 mc 日志踢人原因，再 docker restart shadow-world
# TTS 变更：改 gpu-tts/tts_api.py → docker restart shadow-tts（模型加载 3-4 分钟）
# mod 上服：jar 放 ops\docker\shadow\mc\mods\ → docker restart shadow-mc → 查 FATAL
#   双端 mod 同时给客户端拷（清单见 §7）；下 mod 前查依赖链（Modrinth version dependencies）
```

## 7. 客户端 mods 同步（萌萌/造物主）

**必装新增（2026-09-06）**，从 `ops\docker\shadow\mc\mods\` 拷入客户端 mods 文件夹：
- touhou_little_maid_spell-1.21.1-1.8.4-neoforge.jar
- irons_spellbooks-1.21.1-3.16.3.jar
- geckolib-neoforge-1.21.1-4.9.2.jar
- irons_lib-1.21.1-2.1.0.jar

**若客户端尚未装女仆基础包**，还需：touhoulittlemaid 1.5.3 / teallib / player-animation-lib（施法动画）。
**删除（已退役）**：settlements 系、roadweaver、settlementsfix。
**中文语音**：进服后女仆菜单 → 资源包下载界面 → 装「纳西妲声音包」（花玲配音）等。

## 8. 铁律与坑（血泪史）

1. **Windows 脚本**：bat 用 CRLF+ASCII；python 内嵌命令换行会被吞（写 .py 文件执行）；编码统一 UTF-8 无 BOM。
2. **敏感配置**：API key 只放 gitignored 配置（llm.json/toml），绝不进 .env/commit。
3. **mods 对账**：modpack.json 与 mods 目录必须一致（`python tmp/diff_modpack.py`），改完跑 `pytest tests/test_modpack_and_deploy.py`。
4. **批量杀进程前核对身份**（曾误杀 god-voice-watcher）；常驻 watcher 优先容器化。
5. **Docker Desktop 深度卡死**（pipe 失联/WSL Stopped）：自救无效就重启宿主机，恢复后手动 `docker start shadow-mc shadow-world`。
6. **itzg 备份**：每日 04:00 自动备份世界，保留 7 份。
7. **拿 Forge/NeoForge 版要瞪大眼**：affection 曾拿错 Forge 版直接启动失败；所有 jar 从 Modrinth 按 loaders=["neoforge"] 过滤。
8. **神语阁重启后**：模型加载 3-4 分钟，期间 /tts 拒连是正常现象。

## 9. 近期变更史

- 2026-09-05：settlements 生态退役（世界备份 + mods-disabled）；TLM 核心包上服
- 2026-09-06：TLM Spell 1.8.4+铁魔法三件套上服；botgate mod 诞生（commit 6e962d3）；modpack v3（b0d4e52）；神语阁 GPT-SoVITS 兼容层（daf8276）；女仆 AI 接 codingplan；中文语音包下发；女神 dat 重置（备份 playerdata-bak-20260906/）
