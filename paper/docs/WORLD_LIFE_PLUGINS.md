# 村庄生活插件包（AgentFriend 0.3.99）

**2026-10-09 08:27:20 最终复核：**原机 CortiEye 已自动回连，实际 `camera=online attached=true cameraNightVision=true`，目标为 CortiLan；本次重启前四个服务账号均恢复。下方“尚未回连/离线”是恢复前的检查时点，不能继续作为当前镜头状态。截图上传配置与原客户端保持。私有最终回执在 E/F `repairs/screenshot-photos-20261009/final-state.json`。

入口是 `/mycli world list`，手柄打开技能罗盘→旅途指南→村庄新生活。Agent 客户端无须更新；文字回执只发给本人，已附身的 Eye 继续通过现有镜像接收。正式发布时间和备份以 [维护记录](OPERATIONS.md) 为准。

## 安装内容

| 插件 | 固定版本 | 当前开放内容 |
| --- | --- | --- |
| BetonQuest | 3.2.0 | 新手实习、导师箱式对话；实际目录查询、成功施法、生活委托领奖才记进度 |
| FancyNpcs | 2.9.0 | 旅途导师·小满，原版村民外观 |
| Citizens | 2.0.40-b4013 | 持久旅人 NPC |
| Denizen | 1.3.4-b7311-DEV | 旅人阿岚的点击对话和 `/village-story` 短故事 |
| ConditionalEvents | 4.80.3 | 登录后私发新玩法入口；删除上游示例命令事件 |
| WorldEvents | 1.8.30 | 丰收时节、旅人顺风、星灯夜巡三个正向活动 |
| MythicMobs | 5.9.5 | 遗迹游猎者、遗迹守卫、遗迹药师三个原版实体活动模板 |
| Shopkeepers | 2.23.3 | 村庄补给商，以绿宝石换面包、纸和空地图 |
| NPCSpeak | 1.0 | 阿卷和青禾，通过现役 QwenPaw 回答附近玩家 |
| ImageFrame | 2026.1.5.0 | 本地截图通过临时上传链接制成地图、放入原版展示框 |

JAR 的官方来源、大小和 SHA256 见 [固定清单](../manifests/world-life-plugins.lock.json)，配置模板见 [world-life](../content/world-life/README.md)。不提交第三方 JAR、模型凭据、测试地图或玩家数据。

## 玩家与 Agent 用法

| 命令 | 用途 |
| --- | --- |
| `/mycli world list` | 返回 `MC_WORLD` 的组件状态与入口 |
| `/mycli world menu` | 原版箱式生活菜单 |
| `/mycli world guide start` | 自愿报名三步实习 |
| `/mycli world guide status` | 查看真实完成的步骤和救援说明 |
| `/mycli world npcs` | 聊天 NPC 的稳定 ID、维度、坐标与 8 格交谈范围 |
| `/mycli world talk storyteller 你好` | 到阿卷附近发问；`botanist` 是青禾 |
| `/mycli world end` | 结束村民对话，恢复普通公屏聊天 |
| `/mycli world events` | 当前正在进行的活动 |
| `/mycli world photos` | 本人照片与导入说明 |

`MC_WORLD` 是本人系统聊天中的 JSON，`type` 区分 `catalog/npcs/talk/guide/guide_progress/events/photos/result`。`talk.status=submitted` 只表示提交了发言，必须等待 NPC 实际答复；任务进度以 `guide.steps[].done` 为准。旁观者不能报名、交谈或取得实习证明；错误、失败施法和口头自报不算完成。实习账本按 UUID 原子保存到 `plugins/AgentFriend/world-life-ledger.yml`，没有额外奖励或技能点。

人物都在村庄地面 Y=67，Z=-441.5：小满 X=-534.5，青禾 X=-537.5，阿卷 X=-540.5，阿岚 X=-544.5；补给商在约 `(-547,67,-442)`。走近后可用原版右键/使用键交互。导师使用 BetonQuest 原版菜单，聊天村民使用普通聊天。与村民交谈期间的文字会交给该 NPC，结束后再发公屏消息。

## 活动和游戏平衡

WorldEvents 每 40 分钟选择一个活动，同时最多一个，同事件冷却 60 分钟；低于 18 TPS 暂停调度。只在主世界启用。丰收持续 5 分钟、成熟作物产量倍率 2；顺风为 3 分钟速度 I；夜巡为 3 分钟夜视。中文公告和 Boss 条提示开始、剩余时间和结束。上游天气、破坏性事件、额外游戏规则和命令事件全部清空。

MythicMobs 的默认怪物替换、随机生成和生成器均为空。三个精英是独立活动模板，**不会自动混入普通试炼或自然刷怪**。控制台可在已勘察、允许刷怪的活动地点使用：

```text
mythicmobs mobs spawn QD_Ranger 1 world,X,Y,Z,0,0
mythicmobs mobs spawn QD_Guard 1 world,X,Y,Z,0,0
mythicmobs mobs spawn QD_Hexer 1 world,X,Y,Z,0,0
```

分别是 32 血骷髅弓手、48 血尸壳、36 血女巫。现有村庄禁刷怪保护仍有效；不能根据“Spawned”文本认定怪物已成功存活。运营者需核查真实实体并及时清场。新增活动仍按 [世界运营](AI_WORLD_OPERATIONS.md) 隔离验收，公会所有权和原技能消耗照旧。

## NPC 模型链路

NPCSpeak 只访问 `127.0.0.1:25579` 的本地适配器，由现有 Goddess 桥管理生命周期。适配器提交 QwenPaw 原生任务，使用现役 `mc_godness` 和受限的 `afu-game-bridge` 用户；没有供应商直连或新增模型守护进程。每次请求独立会话，NPC 发言作为不可信材料引用，模型不能靠聊天发物品、完成任务或代执行命令。

默认共享单并发、每小时 32 次，NPC 自身另有 3 秒发言冷却；繁忙或 QwenPaw 不可用时实际答复可能失败。私有 `E:/MC/ops/npc-adapter.private.json` 配置端口、令牌和限额，不能提交 Git。NPCSpeak 的本地 API 令牌须与其一致。聊天记忆关闭；每轮最多十次交谈，60 秒不发言结束监听。

## 照片的实际边界

截图保存为 PNG/JPG 后，用 `/imageframe create <名字> upload 1 1` 领取本人临时上传链接，五分钟内在网页或用 [Agent 上传脚本](../ops/imageframe-upload.py) 提交本地文件。`/photohelp` 给步骤，原 `/mycli world photos` 也补充入口；原客户端无须更换。当前内置服务只绑定 LAN `192.168.3.163:8517`。完整用法见[截图相册](SCREENSHOT_PHOTOS.md)。

领取链接预扣空地图，创建失败/超时由 ImageFrame 退回。HTTP 成功只表示上传完成，须等游戏内创建成功和实际地图入包后挂展示框。每人串行创建，新请求取消本人此前等待；旧请求被取消后仍可能 HTTP 200，但不会成图。照片有主人，默认只管理本人的图片。`/imageframe get <名字>` 打印另一份也需要空地图。

外部图片仍可 `/imageframe create <名字> <图片URL> 1 1` 导入；常用图片 CDN 和 GitHub raw 仍允许，新增域名需调整白名单。本地上传无需外部图床。

每人最多 64 张图片，单图文件上限 4 MiB、地图尺寸上限按插件 MaxSize=4，后台处理单并发，地图发送限速每 tick 8 包。默认只授权本人图片的创建、获取、改名、删除和分享；不授予覆盖任意原图或管理员绕过权限。已有藏宝图和遗迹地图继续使用原始数据。

当前采用用户选择的现有截图导入方案，无须额外摄影客户端或账号。ImageFrame 不代替截图工具按快门；`automaticCaptureReady=false` 保留这一含义，截图上传和照片保存已可用。

## 后续运营与回退

NPC 台词和任务对话在 BetonQuest 包、Denizen 脚本、NPCSpeak 人物 YAML；活动在 WorldEvents 的 `events/qiandengji.yml`；精英在 MythicMobs 的 `mobs/qiandengji.yml`。稳定 ID 不复用为不同目标，已报名实习账本不清空。备份配置后按各插件自己的加载命令更新：`betonquest:betonquest reload`、`denizen reload scripts`、`worldevents:wevent reload`、`mythicmobs reload`；先隔离测试，不使用全服 `/reload`。NPCSpeak/FancyNpcs/Citizens 的持久实体更换要一并验证旧实体清理与新实体数量。

批量发布使用 `ops/content-deploy.ps1`，由原维护脚本在正常停服并完成 E/F 两份校验快照后调用。首次52个文件及后续1个精确SLF4J缓存文件逐项预检来源、目标和 SHA，原 0.3.98 JAR 单独固定摘要移除；中途失败恢复已修改文件。不能复制隔离世界、照片测试数据、玩家账本或隔离 Geyser 的离线认证配置。插件回退须正常停服，恢复同批配置/脚本和旧 AgentFriend，保留新增玩家照片及实习账本的私有副本。

## 验证范围

2026-10-09 08:16:03 已启用截图上传及教程，仅修改两个配置，AgentFriend 保持 0.3.99。E/F `20261009-081417/.complete` 均先于替换，维护任务结果0。隔离普通Agent真实截图上传、像素、归属、原版挂墙及取消请求22项、脚本边界4项、正式只读/配置/入口/规则18项通过。正式未给测试账号发地图或创建照片。原机CortiEye本次重启后尚未回连，配对/watcher保留，不能称直播镜头恢复；手机/Xbox照片画面待设备验收。详见[维护记录](OPERATIONS.md)。

2026-10-09 01:09:41 完成正式部署与入口恢复，当前Java PID34088；十个插件均启用。正式普通Agent16项、恢复后启用/入口18项、旧数据17项通过。部署曾因Windows替换参数失败而完整回退，Denizen依赖与Geyser认证服务短暂网络失败后已恢复，具体回执见[维护记录](OPERATIONS.md)。

普通 Mineflayer 连接已实际使用十个插件的内容：真实 QwenPaw NPC 答复、导师对话、三步服务器证明、故事、原版交易扣款、照片像素与挂墙、正向效果和成熟作物增产；三个精英原版实体、血量、投射物和原生攻击也已验证。正常重启与 16 个受控 Agent 加一位真正附身的 Eye 检查通过，80 次查询和短移动时 5 秒平均 MSPT 6.6；不是 16 个 LLM 的长期自主生活验收。

基岩沿用原 Geyser/Floodgate，玩法采用原版实体、聊天、菜单、地图及展示框，不要求客户端模组。隔离的无 Xbox 认证协议探针未成功进入世界，不能算基岩交互或手机/Xbox 画面通过；这部分仍需实际登录设备核验。发布不更改正式 Geyser 认证和客户端版本范围。

女神按当前玩家手册说明实习步骤和截图流程；资料答疑不代替玩家执行操作。
