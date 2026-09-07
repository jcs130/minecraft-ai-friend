# 玩家模型与人物外观资源审计

审计日期：2026-09-07；Minecraft 1.21.1 / YSM 2.6.5 NeoForge。完整资源哈希和模型元数据见 [ysm-model-audit.json](D:/Projects/QiandengJi/reports/ysm-model-audit.json)。

**YSM 的 27 个内置模型完整保留；新增的鸣人、桐人两套原生方块模型已在真实 NeoForge 客户端同时显示。** 两个专用 Numen 身体通过模型绑定和保存重建验证；原四 UUID 的模型附件也已在正常停服后应用成功，注册表未改、原角色未召唤。原 GLB 作为源档另行归档。当前接入与 [实际截图](D:/Projects/QiandengJi/client/screenshots/qd-controls-model-air-shot-20260907c.png) 见 [PLAYER-MODELS-INTEGRATION.md](D:/Projects/QiandengJi/docs/PLAYER-MODELS-INTEGRATION.md)。

## 指定目录核对

| 目录 | builtin | custom（当前） | 缓存（初始审计） |
|---|---|---|---|
| D 客户端 | 27 模型、622 文件 | 鸣人、桐人 2 模型，26 文件 | 26 个客户端缓存载荷 |
| D 服务端 | 27 模型、622 文件 | 鸣人、桐人 2 模型，26 文件 | 26 个服务端缓存载荷 |
| C 原 shadow 服务端 | 27 模型、622 文件 | 空 | 26 个服务端缓存载荷 |
| C Rapid Optimization 基础包 | 无 YSM 配置目录 | — | — |

初始审计时三个 builtin 各 64,004,278 字节，逐文件 SHA256 完全一致；三个 YSM JAR 也一致。27 份 ysm.json 显式引用的模型、动画、纹理文件均存在。当时 D 服务端的 26 个缓存载荷与 C 原 shadow 完全一致。客户端缓存密文不同，不能据此判断模型丢失；没有解密缓存或推断其逐项模型身份。新增 custom 资源使用独立显式模型锁，不依赖缓存密文判断。

`auth` 只记录目录是否存在，未读取内容、列出内容或修改权限；cache/server_index 未读取。服务器密钥未读取、未替换。以上结论不声称验证了每位玩家的模型授权状态。

## 现有内置模型

下面目录均相对于 `config/yes_steve_model/builtin`；目录名不作为未经运行时确认的命令 ID。`free` 是清单中的运行时标志，不代替模型的许可证。

| 模型目录 | 清单显示名 | free | 许可证元数据 |
|---|---|---:|---|
| `default` | Default | true | CC 0 |
| `misc/1_alex` | Alex （艾利克斯） | true | CC 0 |
| `misc/2_steve` | Steve （史蒂夫） | true | CC 0 |
| `misc/3_default_boy` | Default Boy | true | CC 0 |
| `misc/4_default_controllers` | Default Controllers Model | true | CC 0 |
| `wine_fox/01_taisho_maid` | Wine Fox（酒狐） | true | CC BY-NC-SA 4.0 |
| `wine_fox/02_new_year` | New Year Wine Fox（新春酒狐） | true | CC BY-NC-SA 4.0 |
| `wine_fox/03_astronaut` | 宇航员酒狐 | false | CC BY-NC-SA 4.0 |
| `wine_fox/04_kongfu` | 功夫酒狐 | true | CC BY-NC-SA 4.0 |
| `wine_fox/05_magical` | 魔法酒狐 | false | CC BY-NC-SA 4.0 |
| `wine_fox/06_hanfu` | 汉服酒狐 | true | CC BY-NC-SA 4.0 |
| `wine_fox/07_jk` | Wine Fox（酒狐） | true | CC BY-NC-SA 4.0 |
| `wine_fox/08_sta` | §6斯塔·柏 | false | CC BY-NC-SA 4.0 |
| `wine_fox/09_hailuo` | 星屑海螺 | true | All Rights Reserved |
| `wine_fox/10_zhiban` | 纸板 | true | All Rights Reserved |
| `wine_fox/11_salesperson` | 店员酒狐 | true | CC BY-NC-SA 4.0 |
| `wine_fox/12_little` | Little Wine Fox | true | CC BY-NC-SA 4.0 |
| `wine_fox/13_matured` | 大酒狐 | true | CC BY-NC-SA 4.0 |
| `wine_fox/14_momo` | MoMo Wine Fox | true | CC BY-NC-SA 4.0 |
| `wine_fox/15_kluonoa` | K螺诺亚 | true | CC BY-NC-SA 4.0 |
| `wine_fox/16_tactics` | 战术酒狐 | true | CC BY-NC-SA 4.0 |
| `wine_fox/17_mini` | 小小酒狐 | false | All Rights Reserved |
| `wine_fox/18_wedding` | Sakura Wine Fox（花嫁酒狐） | true | CC BY-NC-SA 4.0 |
| `wine_fox/19_nine_tailed` | 酒尾狐 | true | CC BY-NC-SA 4.0 |
| `wine_fox/20_survivor` | 幸存者酒狐 | true | CC BY-NC-SA 4.0 |
| `wine_fox/21_saint` | 圣女酒狐 | false | CC BY-NC-SA 4.0 |
| `wine_fox/22_elf` | 精灵酒狐 | true | CC BY-NC-SA 4.0 |

内置资源共 22 个 free=true、5 个 free=false；许可证元数据为 5 个 CC 0、19 个 CC BY-NC-SA 4.0、3 个 All Rights Reserved。内置清单的 free/许可字段没有改动，builtin 元数据没有鸣人或桐人。后续新增的两套模型位于 custom，使用原皮肤和内置 CC0 Steve 骨架制作；auth 始终未检查或更改。

## YSM 的识别、授权与分发

官方模型文档将文件夹、ZIP、.ysm 列为加载格式，custom/auth 为自定义模型入口；builtin 启动时重建，cache 为服务器同步的加密缓存。因此不需要手动把 builtin 再当额外人物包安装，也不将缓存当作可发布的模型源文件。[官方模型格式说明](https://yesstevemodel.github.io/wiki/type/)

正常模型重载会向连接客户端同步。原有模型仍遵循其授权规则；新增两套本地方块模型可直接选择。没有修改作者授权或使用强制忽略授权参数。[官方指令说明](https://yesstevemodel.github.io/wiki/command/)

本机 2.6.5 的实际配置文件是 [yes_steve_model-client.toml](D:/Projects/QiandengJi/client/config/yes_steve_model-client.toml:7) 和 [yes_steve_model-server.toml](D:/Projects/QiandengJi/server/mc/config/yes_steve_model-server.toml:2)，以已安装版本为准。已核对白名单设置：玩家可切换、隐藏模型列表为空、默认模型为 default；客户端自身/其他玩家渲染均未禁用，音量 100%；服务端模型同步 5 Mbps，AcceptSoundFX=0。没有发现配置把人物模型整体关掉。相关字段语义见 [官方配置说明](https://yesstevemodel.github.io/wiki/config/)。

## 玩家入口与 QA 命令

按 **Alt+Y** 打开模型选择界面。现役 JAR 中文按键名为“打开玩家模型界面”，分类“是，史蒂夫模型”；当前 [options.txt:161](D:/Projects/QiandengJi/client/options.txt:161) 明确保存 `key.keyboard.y:ALT`。动画轮盘为 Z，额外玩家渲染配置为 Alt+P；这是本地配置核对结果。

现役 JAR 的 model 命令注册类仅包含 reload、disable、set，**没有 `ysm model list` 子命令**。两套新增模型的实际运行 ID 已确认，可用下面的语法切换唯一 QA 玩家；其他模型 ID 使用真实客户端命令补全核对：

```text
ysm model set <唯一QA玩家名> qiandengji_naruto -
ysm model set <唯一QA玩家名> qiandengji_kirito -
ysm model set <QA> default -
```

最后一条是恢复默认模型示例；测试前仍应记录 QA 的原模型。不要添加 ignore_auth。`ysm model reload` 会重载并广播同步，不能当作只读“列出模型”命令。重名原角色必须按 UUID 精确匹配：YSM 的 players 参数拒绝裸 UUID 文本，实际验证使用 `@a[nbt={UUID:[I;四个有符号整数]}]`。本轮已执行专用 QA 的 YSM 指令和渲染验证，未手动点击模型选择项。

## 鸣人、桐人与旧网页模型

主任务定位到 [guard-skins.json](C:/Users/lzl19/.copaw/workspaces/default/minecraft-ai-friend/ops/guard-skins.json)：鸣人、桐人使用 Mojang 签名的 64×64 玩家皮肤，由 numen_act 应用并持久化到 numen_companions.dat。这是游戏内 AI 外观链，皮肤不需要额外 YSM 模型文件。

主任务对 C、D 存档的检查发现各有 4 条角色记录（2 桐人、2 鸣人），修复前仅一条桐人记录带完整皮肤值/签名，其余缺字段；主任务已保持角色身份不变地恢复外观字段。初始静态审计未读取签名值；后续协议验收和落盘复核仅在内存中比对，未输出这些值，也未由验收脚本修改原角色存档。

另一审计在原 `modern-viewer/character-assets/characters` 找到 `naruto-uzumaki-shippuden.glb`、`kirito-black-swordsman.glb`。它们作为旧网页渲染器源档保存在 `assets/source-models/characters`；当前已可见的 YSM 模型使用现有皮肤和原生骨架、立体配饰分别构建。

初始审计只写入审计 JSON 与本文件；后续开发增加两套原生 YSM、生成器、独立 QA 和导出模型锁。始终没有改变作者授权、复制 auth、修改服务器密钥或更改原 C 盘实例。

## 实际皮肤协议验收与注册表清理复核

2026-09-07 09:19:49–09:19:51（北京时间），[smoke_character_skins.mjs](D:/Projects/QiandengJi/tools/smoke_character_skins.mjs) 的实际服务器验收通过 7 项检查，见 [character-skins-smoke.json](D:/Projects/QiandengJi/reports/character-skins-smoke.json)。仅使用 `QDSkinProbe` 与唯一临时 Numen 身体 `QDSkinBody`，按鸣人、桐人顺序换肤；两次均收到与原目录完全匹配的 textures value 和 signature，同时确认同一同伴 UUID 的 player_info 移除/新增、旧实体销毁、新实体实例出现，以及刷新后的 Numen 身份。没有召唤或替换现有鸣人、桐人角色。

首轮在只读身份复核时收到非预期 RCON 返回，未判定通过且已清理。最终一轮仍如实记录一次只读列表返回异常，经受限的只读重试恢复；没有重发换肤命令。两轮临时身体均已 dismiss，客户端均退出，共享锁释放。此验收证明实际协议同步与身体刷新，不代替纹理的肉眼渲染检查、密码学签名验证或 YSM 菜单点击验证；本次未点击模型菜单。

09:23:26 又只读解析了 [numen_companions.dat](D:/Projects/QiandengJi/server/mc/shadow/data/numen_companions.dat)。文件最后写入为 09:21:09，晚于当次皮肤验收结束；读取前后大小、修改时间稳定。当时注册表恰好 **4 条：2 桐人、2 鸣人**，没有 QDSkin 注册记录，也没有其他新增角色记录。四条原身份与 C 源对应记录全部保留；四条 skinValue、skinSig 均存在且逐项匹配原皮肤目录。那次只读复核没有停服、触发保存、改写注册表或重跑测试。

## 后续：用户授权的原生 YSM 模型开发

两套原生 YSM 已部署到 D 客户端与服务端各自 `custom/qiandengji_naruto`、`custom/qiandengji_kirito`，通过 Numen 绑定、皮肤刷新后的保存重建和真实无遮挡画面验证。模型 QA 结束后两个临时身体已遣散，观察者位置、朝向与模式已恢复，共享锁释放；保存后无 QDSkin/QDModel 注册残留。见 [game-models-smoke.json](D:/Projects/QiandengJi/reports/game-models-smoke.json)。

[game-models.lock.json](D:/Projects/QiandengJi/manifests/game-models.lock.json) 锁定两目录 26 个文件、SHA256 和 MC 1.21.1 / NeoForge 21.1.248 / YSM 2.6.5。客户端含原 83 个 JAR 加 Controlify、YACL、千灯控制器，共 **86 个 JAR**；原生模型是资源文件，不增加 JAR。`0.1.2-local` 成品已导出并验证，包含 18 个声音包和两套模型，见 [pack-export.json](D:/Projects/QiandengJi/reports/pack-export.json)。千灯手札的真实界面图已通过，实体手柄仍未验收。

原四 UUID 的 YSM 外观附件于 10:40 正常停服后写入成功，[character-model-bindings.json](D:/Projects/QiandengJi/reports/character-model-bindings.json) 记录 4 个 changed=true、注册表未改、原角色未召唤。只修改各自的 `neoforge:attachments / yes_steve_model:model_id`，其他玩家数据与进度保持；完整备份目录为 `runtime/backups/character-models/2026-09-07T02-40-36-402Z`。这不代表原四个休眠角色已全部上线。

模型构建和离线方案见 [PLAYER-MODELS-INTEGRATION.md](D:/Projects/QiandengJi/docs/PLAYER-MODELS-INTEGRATION.md)，键鼠、手柄和 Agent 的统一技能入口见 [SKILLS-UNIFIED-CLI.md](D:/Projects/QiandengJi/docs/SKILLS-UNIFIED-CLI.md)。原生铁魔法服务桥已安装并重启，服务端实际 **70 JAR**；最终统一链与 Python CLI 各 12 项真测通过，报告为 [irons-bridge-smoke.json](D:/Projects/QiandengJi/reports/irons-bridge-smoke.json)、[skill-cli-smoke.json](D:/Projects/QiandengJi/reports/skill-cli-smoke.json)。中文咏唱的效果与消耗、UUID CLI 的角色匹配和原生施法开始回执均已完成验证；这些施法证据与人物模型截图分别记录。
