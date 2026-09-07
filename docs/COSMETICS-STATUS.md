# 女仆配音与人物外观

2026-09-07 对原项目、Downloads、当前 D 客户端/服务端和存档重新核查，并补齐以下遗漏。原 C 盘资源未修改。

## 东方女仆配音

当前预装 **18 个自定义声音包、2304 个 OGG 音频文件**，加上模组自带声音。包括纳西妲、ATRI、煊煊、苏打Baka、籽岷、咕咕嘎嘎，以及 12 个原项目整理的方舟角色包。

- 原存档里有女仆已经绑定 `atri_sound_pack`，但上一版没有打包 ATRI。已从原项目 `tmp/atri_sound_pack-1.0.0.zip` 补回客户端、服务器与本地资源下载服务；女仆实体和声音绑定没有改动。
- 11 个方舟包继承了“佩佩声音包”的名字、翻译键与图标路径。已改成阿米娅、贝娜、杜林、澄闪、克洛丝、罗小黑、麦哲伦、桃金娘、泡泡、德克萨斯、跃跃各自的名称和命名空间。
- 图片和音频字节完全不变。部分原图标本身复用了佩佩图片，本轮修的是指向真实文件的路径，没有把它宣称成新角色立绘。
- 原存档的三只女仆分别绑定模组自带默认、内置 `littlemaid_peco` 与 ATRI 声音，现在都能找到对应资源。内置模型有博丽灵梦、森近霖之助等；声音包和外观可分别选择，并非所有自定义音频都来自东方角色。

在自己女仆的交互界面选择外观/声音包；需要下载时使用资源包页面。本包已预装上述资源，服务器也提供对应下载。更改外观不要求更改声音，也不要求重建女仆。真人扬声器听感、逐个语音事件和模型菜单点击不在本轮自动验收范围。

证据：`docs/MAID-VOICE-MODELS.md`、`manifests/voice-packs.lock.json`、`reports/maid-voice-model-audit.json`、`reports/cosmetic-assets-health.json`。

## YSM 玩家模型

**Alt+Y** 打开“玩家模型界面”。27 个内置模型、622 个资源文件在 D 客户端、D 服务端与原服逐项一致；当前配置允许切换，隐藏列表为空。包括 Steve、Alex、默认人物及多套酒狐外观，各模型保留模组原有授权规则。另已接入两套原生方块模型：“鸣人 · 木叶忍者”和“桐人 · 黑衣剑士”。

这套模型界面和东方女仆的外观菜单是两个入口。完整模型目录与验证范围见 `docs/PLAYER-MODELS-AUDIT.md`。

## 鸣人和桐人

鸣人和桐人的两套原生 YSM 模型**已经在真实 NeoForge 客户端同时可见**：桐人有黑衣长外套、背剑轮廓，鸣人有橙黑衣装、立体头带和碎发。模型以现有皮肤和内置 CC0 骨架制作，部署在两端 `custom/qiandengji_naruto`、`custom/qiandengji_kirito`；它们是游戏原生模型，旧 GLB 只作源档保存。见 [实际截图](../client/screenshots/qd-controls-model-air-shot-20260907c.png) 和 [接入说明](PLAYER-MODELS-INTEGRATION.md)。

存档原有两条鸣人、两条桐人历史记录；原来使用 Numen 角色与签名 Minecraft 皮肤，修复前只有一条桐人记录保留完整皮肤字段。

已在服务器正常停止后恢复缺失的 3 条外观记录：只写 `skinValue` / `skinSig`，既有 UUID、主人、位置、任务和其他字段逐项保持，未删除/合并角色，也没有自动启动他们的 AI。原始皮肤 PNG 和签名资料保存在项目私有的 `server/character-skins/`；原 NBT 备份路径记录在 `reports/character-skins.json`。

`tools/prepare_character_skins.mjs --restore-registry` 会拒绝在 MC 正运行时写存档。脚本先核对完整 NBT 语义再原子替换，不能用角色同名就随意覆盖身份。本轮当前角色仍保持原来的休眠状态；需要恢复 AI 行为时应另行核对相应驱动和主人绑定。

实际皮肤同步验收见 `reports/character-skins-smoke.json`：7 项通过。专用 QA 身体依次换成鸣人、桐人，确认原签名属性精确送达、角色 UUID 保持、旧实体移除和新实体生成；临时角色已遣散。一次只读状态回应异常经读取重试恢复，记录保留，换肤操作没有重发。

后续原生模型验收见 `reports/game-models-smoke.json`：两个独立 Numen 身体通过 YSM 模型绑定、原皮肤更换后的保存重建和实际无遮挡渲染。测试没有占用原角色身份；临时身体已遣散、观察者已恢复、共享锁已释放，保存后确认没有 QA 注册残留。

原四 UUID 的 YSM 外观附件已于 **10:40 正常停服后应用成功**，见 `reports/character-model-bindings.json`。四条玩家文件只改外观附件，注册表、身份和其他进度不变，原文件备份于 `runtime/backups/character-models/2026-09-07T02-40-36-402Z`。原角色没有因本次操作被召唤；不能将 QA 显示通过当成原四个休眠角色已全部上线。

## 找回的 3D 源模型

另找到了旧网页展示器使用的鸣人、桐人 GLB：

- 原样归档：`assets/source-models/characters/`，两 GLB、两 PNG。
- 桐人整理版含 83 个骨骼关节、11 段动画。
- 鸣人整理版保留 6 段动画，但原文件头把 JSON 写成 JSPN。派生修复版在 `assets/prepared-models/characters/naruto-uzumaki-shippuden.glb`，仅改偏移 18 的一个字节，其余 8,461,255 字节与源文件相同。

这些 GLB 作为网页查看器源档归档，与本轮已经可见的两套原生 YSM 模型分别管理。源档的结构、引用和缓冲区边界检查见 `manifests/character-source-models.lock.json`、`reports/legacy-character-assets.json`；当前游戏模型及动作骨骼验证见 `reports/game-models-build.json`。

## 分发与检查

客户端包：[QiandengJi-1.21.1-0.1.2-local.mrpack](../dist/QiandengJi-1.21.1-0.1.2-local.mrpack)，**已完成导出与成品校验**。包含 86 JAR：原 83 个，加上 Controlify、YACL 与千灯控制器；另含 18 个声音包和两套原生 YSM 的 26 个文件。模型资源不另增加 JAR，27 个内置模型由 YSM 模组提供。成品 383,494,701 字节，SHA256 及完整校验见 [pack-export.json](../reports/pack-export.json)。

`manifests/game-models.lock.json` 显式锁定两模型目录共 26 个文件及 SHA256，目标为 MC 1.21.1 / NeoForge 21.1.248 / YSM 2.6.5。导出器已接入严格校验，拒绝未锁的模型、auth/cache/builtin 等目录。个人存档、角色签名目录、作者授权和 GLB 源档不放入客户端分发包。模型导出测试见 `reports/game-models-export-validation.json`。

控制器初始化和千灯手札界面均已通过真实客户端验证，见 `reports/controller-visual.json`；真实物理手柄尚未验收。键鼠、手柄与 Agent 的技能入口见 [SKILLS-UNIFIED-CLI.md](SKILLS-UNIFIED-CLI.md)。原生铁魔法桥已安装并重启，服务端为 **70 JAR**。最终统一链 12 项与 Python CLI 12 项均通过，分别见 [irons-bridge-smoke.json](../reports/irons-bridge-smoke.json)、[skill-cli-smoke.json](../reports/skill-cli-smoke.json)。中文咏唱已验证效果与消耗，UUID CLI 已核对角色并收到原生施法开始回执；施法开始不等于所有法术最终命中。

```powershell
python tools/check_cosmetic_assets.py
python tools/verify_client_runtime.py
python world/ops/health/health_mon.py
```

资源检查会读取本地 HTTP 服务返回的实际 ZIP 字节，并验证三端哈希、18 个命名空间与图标引用。完整配音修复从原 C 资源可重复构建，连续两次输出一致；源音频和图片字节不变。

本次真实 NeoForge 客户端成功进入 D 盘服务器，语音 UDP 认证和连接通过；18 个客户端预装包及游戏实际下载缓存的哈希均匹配，ATRI 包也已下载。证据见 `reports/client-runtime.json`。人物模型另有实际画面验证；仍未逐个试听女仆语音、手动点击两个人物的模型选择项或连接实体手柄。
