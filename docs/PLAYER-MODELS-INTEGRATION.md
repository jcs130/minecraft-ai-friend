# 鸣人、桐人的游戏内 YSM 模型

两套模型现已接入 `MC 1.21.1 / NeoForge 21.1.248 / YSM 2.6.5`。这是使用原角色皮肤制作的本地方块版，包含原生 YSM 骨架、动画、第一人称手臂和装备定位点。它们可以应用于真人玩家与 Numen Agent 身体。旧网页 GLB 没有被重命名或冒充 YSM。

| 角色 | 确认的运行模型 ID | 纹理 ID | 立体特征 | 主模型规模 |
|---|---|---|---|---|
| 鸣人 · 木叶忍者 | `qiandengji_naruto` | `skin` | 黄色碎发、原皮肤头带图案、头带结与飘带、橙黑衣、腰包与苦无包 | 67 骨骼、49 方块 |
| 桐人 · 黑衣剑士 | `qiandengji_kirito` | `skin` | 黑色头发、立领、随大腿运动的长衣摆、背带和背剑鞘 | 67 骨骼、54 方块 |

两套第一人称手臂均为 14 骨骼、10 方块；原皮肤 PNG 保持字节相同。头部附件跟随头骨，衣摆分别跟随左右大腿，背剑跟随上身，持物定位点保留。剑鞘是外观配件，不会增加攻击能力或代替实际持有的武器。

## 资源来源与边界

原作者公开页面有苏依凛的桐人展示线索、壹花1h的鸣人系列分享线索，但本轮未获得可确认适配的角色成品文件，没有采用聚合网站的模型合集或任何授权恢复工具。[苏依凛的原作者页面](https://www.bilibili.com/video/BV1HyHxesEV2/)、[壹花1h的原作者分享页面](https://www.bilibili.com/video/BV1Ku4y1K7QY/)。前者是另一角色的公开分享页，其作品列表包含桐人；不能据此断言桐人模型免费。

本地版本以 YSM 内置 `builtin/misc/2_steve/ysm.json` 明确声明的 **CC0** 骨架与动画为基础。保留原作者鸣谢；针对现有皮肤移除无对应纹理的眼睛、手指等附加小块，并删去模板中指向不存在骨骼的动画通道。新配饰使用原皮肤像素的 UV，不新增或改写皮肤图片。

角色、皮肤的权利仍属于原权利人。模型的 `free=true` 表示本服可选，无需 YSM 授权解锁；它不等于对角色或皮肤的再分发授权。未复制 `auth`、缓存、服务器密钥或签名目录进入模型。官方支持的文件夹格式和 `custom` 安装位置见 [YSM 模型类型说明](https://yesstevemodel.github.io/wiki/type/)。

## 构建、使用与部署

源输出位于 `assets/game-models/qiandengji_naruto` 和 `assets/game-models/qiandengji_kirito`；各自包含 spec 2 的 `ysm.json`、Bedrock 1.12.0 几何、动作 JSON、原皮肤、鸣谢及生成器所有权标记。

```powershell
python tools/build_game_models.py --deploy
python tools/test_build_game_models.py
node tools/test_character_bindings.mjs
```

生成器只负责两个独立目录，分别部署到 `client/config/yes_steve_model/custom` 和 `server/mc/config/yes_steve_model/custom`。遇到未标记目录、外来文件或人工修改，会拒绝覆盖。文件哈希和输入来源记录在 [构建锁](../assets/game-models/build-lock.json) 与 [构建报告](../reports/game-models-build.json)；导出通过下述独立模型锁接入。

主任务随后授权导出接入。生成器现在同时写入 [game-models.lock.json](../manifests/game-models.lock.json)：仅包含这两个模型目录的 **26 个显式文件**、大小、SHA256 和 MC/NeoForge/YSM 目标版本，共 1,546,108 字节。导出器默认版本已更新为 `0.1.2-local`，必须逐项匹配模型锁；模型文件不能沿用普通配置“可变更”的宽松校验，也不能用 `--include-relative` 绕过。`auth`、`cache`、`builtin` 和其他 custom 目录全部拒绝导出。

模型锁独立嵌入成品包并再次校验。6 组模型导出测试、6 组模型构建测试以及原 17 组构建/导出回归测试通过；其中包括实际模型的小型 mrpack 往返、修改模型拒绝、添加未锁文件拒绝、私有路径拒绝及仅改一般文件清单无法绕过模型哈希。见 [模型导出校验报告](../reports/game-models-export-validation.json)。主任务已完成最终 [0.1.2-local 分发包](../dist/QiandengJi-1.21.1-0.1.2-local.mrpack) 导出和校验：86 JAR、18 声音包、两套 YSM 的 26 个文件，共 383,494,701 字节。成品 SHA256 为 `101d38c6aacd22516207c1f15794dd171d75c767e80c40cc41beae8bd8f76be0`，报告见 [pack-export.json](../reports/pack-export.json)。

玩家按 **Alt+Y** 打开“打开玩家模型界面”，选择上述中文名。服务器重载：

```text
ysm model reload
ysm model set <唯一玩家名> qiandengji_naruto -
ysm model set <唯一玩家名> qiandengji_kirito -
```

`-` 会解析为 `skin`。不要添加 `ignore_auth`。YSM 的 players 参数不接受裸 UUID；重名玩家必须用 `@a[nbt={UUID:[I;四个有符号整数]}]` 精确匹配。该方式已在临时 Numen 身体实际验证。四个原角色不会通过同名命令统一选取。

## 实际验证与原角色持久化

09:41:07–09:41:09（北京时间）服务器成功完成模型重载，耗时 1900.611 ms。本轮实际 Numen 测试已确认：两个模型 ID 都存在；UUID 玩家选择器能准确绑定；attachment 内的模型 ID、纹理 `skin` 和启用状态正确；Mojang 皮肤更换触发身体保存、重建后，YSM 选择仍保留。见 [协议与持久化验收](../reports/game-models-smoke-protocol.json)。这份协议报告不代表已经通过肉眼渲染验收。

独立脚本 [smoke_game_models.mjs](../tools/smoke_game_models.mjs) 使用共享 smoke 锁，只创建 `QDModelNaruto`、`QDModelKirito`，由真实 `QiandengTest` 观察。先前山崖和地面墙体遮挡截图均不判为视觉通过；后续重新安排露天同高度、creative 飞行展示，截图与清理结果由最终验收补录。

最终无遮挡渲染已通过：实际 NeoForge 客户端 [截图](../client/screenshots/qd-controls-model-air-shot-20260907c.png) 清晰显示左侧桐人的黑衣长外套与背剑轮廓、右侧鸣人的橙黑衣装、头带与碎发，两套 Numen 人物模型同时可见。为排除遮挡，展示临时放在原观察者同一 XZ 邻域的 y=220 开阔层，并检查视线走廊 36 处空气方块；没有建设或删除地形。

见 [最终运行与渲染报告](../reports/game-models-smoke.json)。展示结束后两个 QA 身体均已 dismiss，观察者恢复原位置、朝向与 spectator 模式，临时夜视已不存在，共享锁已释放。保存后确认注册表无 QA 残留；原四角色离线绑定计划通过，报告为 [character-model-binding-plan.json](../reports/character-model-binding-plan.json)。此轮没有召唤原四个休眠角色，也没有手动点击 Alt+Y 选择这两套模型。

原角色绑定工具 [bind_character_models.mjs](../tools/bind_character_models.mjs) 默认只做计划；`--apply` 要求独立 MC 容器正常停止。它只修改以下原 UUID 的 `playerdata/<UUID>.dat` 中 `neoforge:attachments / yes_steve_model:model_id`，不修改注册表身份、皮肤、物品、属性、位置、任务或其他附件。

| 原角色 | 保持的 UUID | 绑定模型 |
|---|---|---|
| 桐人 | `d4ac9523-4962-43ed-98c5-19b49e104048` | `qiandengji_kirito` |
| 鸣人 | `4b93e0a8-9707-4743-ab53-73bf12fa8797` | `qiandengji_naruto` |
| 桐人 | `4d67319b-938e-420a-9d92-78db0a32601a` | `qiandengji_kirito` |
| 鸣人 | `b44590d3-89dd-44ff-978e-c0c2a397f781` | `qiandengji_naruto` |

```powershell
node tools/bind_character_models.mjs          # 只生成计划
# 由主任务正常停 MC 后运行：
node tools/bind_character_models.mjs --apply
```

工具校验原四条身份及签名皮肤字段、没有 QA 注册残留、模型部署哈希、玩家文件内 UUID、typed NBT 的非目标字段完全不变与压缩往返；写入前备份、重查停服与源字节，原子替换，失败时在仍停服且文件未被并发修改的前提下回滚。已通过 16 项绑定与场景解析断言，并实测运行中 MC 拒绝写入。真正执行和重新加载原角色后的结果必须与计划区别记录。

2026-09-07 **10:40 正常停服后已执行 `--apply` 成功**，见 [character-model-bindings.json](../reports/character-model-bindings.json)：原四 UUID 均已写入相应模型附件，四份写后 SHA256 与计划一致，注册表未改，原人物未召唤。原文件备份于 `runtime/backups/character-models/2026-09-07T02-40-36-402Z`。进度 JSON、SQLite 和 Pufferfish 另有主任务备份 `runtime/backups/skills-integration-20260907`。原四个休眠角色尚未作为本轮视觉验收对象上线；模型运行与重建已由独立 QA 验证。

统一技能入口的最终实测也已完成：[irons-bridge-smoke.json](../reports/irons-bridge-smoke.json) 与 [skill-cli-smoke.json](../reports/skill-cli-smoke.json) 各 12 项通过，包含中文咏唱效果/消耗、UUID CLI 的角色匹配与原生施法开始回执。使用方法见 [SKILLS-UNIFIED-CLI.md](SKILLS-UNIFIED-CLI.md)；这些结果不扩大原角色上线、实体手柄或逐项语音试听的验证范围。
