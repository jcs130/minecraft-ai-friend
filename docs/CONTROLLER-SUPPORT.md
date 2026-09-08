# 千灯纪手柄与技能入口

客户端采用官方 **Controlify 3.0.1+lts / NeoForge 1.21.1**、**YACL 3.8.2**，以及本项目独立的 `qiandeng_controls` 客户端模组。它们不会装入服务端，也不替换 Numen 或 botgate。

后续言灵道具使用独立的双端 `qiandeng_chanting` 模组：长按使用键举杖，小窗默认语音；左右肩键在语音与 8 槽之间循环，松开使用键才提交一次。下表保留独立语音键与菜单入口；举杖交互和首末音包协议见 [语言即接口](LANGUAGE-INTERFACE.md)。实体手柄的长按、肩键与松开仍未验收。

官方版本：[Controlify](https://modrinth.com/mod/controlify/version/RqsNKKLK)、[YACL](https://modrinth.com/mod/yacl/version/7TVdVtxF)。下载文件、版本 ID、SHA-256 与 SHA-512 固定在 `config/controller-support.json`；构建与安装结果在 `manifests/controller-support.lock.json`。

## 默认操作

| 操作 | 键盘 | Xbox 标准布局 |
|---|---|---|
| 举起自制言灵杖，显示语音与技能选择 | 长按鼠标右键 | 长按 LT |
| 举杖期间左右选择语音或 1–8 槽 | Page Up / Page Down | LB / RB |
| 释放当前咏唱或所选技能 | 松开鼠标右键 | 松开 LT |
| 独立按住说话入口 | F8 | 按住十字键左 |
| 打开 27 格技能罗盘 | F6 | 十字键上 |
| 打开千灯手札 | F7 | 十字键右 |
| 在手札按钮间选择 | Tab / 方向键，或鼠标 | 摇杆 / 十字键 |
| 选择罗盘中的格子 | 鼠标指向 | 摇杆 / 十字键 |
| 确认 | 按钮用 Enter 或左键；罗盘格子用左键 | A |
| 返回 | Esc | B |
| 背包 | E | Y |
| 菜单 | Esc | Start |
| 持有法术书时释放 | 使用键 / 鼠标右键 | LT |

持有技能指南针时，使用键 / 右键也会打开同一个技能罗盘。表中的 Xbox 操作为默认映射，实体手柄输入仍待验收。

手柄按键可在 Controlify 的控制器配置页面修改；技能和手札键盘按键可在 Minecraft 的“控制 → 按键绑定 → 千灯纪 · 技能与手札”修改；F8 语音键属于 Simple Voice Chat 的“按住说话”。本项目只提供新控制器的默认映射，不覆盖用户已有的控制器配置。十字键上和右的原始“聊天”“Controlify 径向菜单”默认绑定被留空；十字键左的原始“选取方块”默认绑定也留空，避免按住说话同时操作方块。需要时可在控制器设置重新分配。

2026-09-07 的独立 PTT 绑定阶段复用官方 Controlify 自带的 `voicechat:ptt_hold`，持续按住十字键左保持 PTT，松开停止送音；该阶段没有新增录音 Java 桥。键盘 F8 原无绑定冲突，仅将 `client/options.txt` 的 SVC PTT 行从未绑定改为 F8。`client/config/controlify.json` 的 profiles/devices 当时为空且保持原字节，没有覆盖任何设备配置。后续举杖联动与录音 schema 2 属于另一轮双端代码更新，不能套用这份资源变更范围。

首次仍需在 Simple Voice Chat 设置中确认麦克风设备与录音权限。正常录音名单仍只有 MengMeng；QA 合成音频测试使用临时名单并恢复，不能据此认定其他账号已启用录音。当前软件链路与范围见 [语言即接口](LANGUAGE-INTERFACE.md) 及其对应报告；旧 [语音咏唱审计](VOICE-CASTING-AUDIT.md) 记录此前阶段。物理手柄、真人麦克风与声音听感仍待验收。

独立 PTT 阶段的构建与安装证据见 [controller-voice-bindings.json](../reports/controller-voice-bindings.json)：`qiandeng-controls-0.1.0.jar` 的 SHA-256 为 `67ca3e4e2993ab5eed17780d1ecac4d603fc344a751b97460aef74ea598331de`；5 个 Java 类与更新前逐字节一致，只有默认绑定及中英文帮助共 3 份资源变化。这是该控件的历史安装记录，完整客户端包是否包含后续法杖代码须另查 [成品校验](../reports/pack-export.json) 的版本、87 个 JAR 和当前文件哈希。

千灯手札使用 Minecraft 标准按钮，提供“技能轮盘”“全部技能与传送阵”“我的状态”“使用帮助”“铁魔法 · 原生法术书”和“返回”。前两个按钮保留旧名称，目前都进入同一个 27 格技能罗盘，不会展开全部旧技能供施法。状态与帮助会请求现有服务器命令并打开聊天记录查看回复，无需输入文字；界面本身显示客户端实时生命、饥饿和等级。详细魔力、已学技能等仍以服务器返回为准。

## 当前罗盘布局

罗盘使用 botgate 的 **9×3、共 27 格原版容器界面**。顶部左侧固定为铁魔法入口，顶部右侧固定为传送阵入口，中间一行按目录显示已学精选主动秘术，每页最多 9 项。当前精选目录为 8 项：归途、空间传送、造物、燃血、泉水、踏空、羽落之靴和烟花；未学会的项目不会冒充已学。底部提供翻页、旧技能档案、关闭和刷新。

传送阵独立分页，每页最多 **18 个地点**，公共与个人地点使用不同图标。点击使用 `shared:<id>` 或 `personal:<id>` 的稳定引用，不依赖可变的列表序号。造物也先打开物品选择页；子页都可返回主罗盘。旧技能档案只供查阅，不能点击施法，被动与旧学习记录继续保留。

主罗盘第 7 格提供“编辑快捷栏”：打开后中间一行显示 1–8 号槽，选槽后可绑定已学精选主动秘术、清空当前位置或恢复推荐排列。编辑不会施法，其他槽不会因清空而前移；归档和被动不进入候选。它与 `/mycli skillbar` 使用同一份原有存储，`/mycli menu skillbar` 可直接进入；八槽配置并不等于主罗盘的精选目录。早期单行、每页 7 技能的界面已被 27 格罗盘替代。

## 施法与输入语义

“铁魔法 · 原生法术书”入口发送 `qdspell self menu`，打开独立的原生法术菜单；实际装备、法力和冷却由铁魔法及服务端桥接检查。打开入口本身不会施法。

F6 或十字键上发送玩家自身的 `skillchest self`。`/mycli menu` 也进入同一罗盘，`/mycli menu waypoints` 与 `/mycli menu archive` 分别打开传送阵和只读档案。罗盘从已同步状态与精选目录生成内容，选定秘术后由 `SkillChestMenu` 执行 `/mycli cast <技能ID>`，统一检查学习条件、等级、参数、资源和冷却。界面注明基础消耗与默认参数；即时判定以服务器回执为准。

客户端用按下边沿触发入口，按住不连续请求。罗盘只接受本人当前界面的主确认点击，每次打开最多派发一次动作；快捷移动、拖拽和重复点击不会取走图标或重复施法。Controlify 的容器导航负责选格与 A 确认，B 返回；物理按键效果仍需接入手柄验证。普通法术书的使用键入口继续保留，其学习与施法同样受当前规则检查。

## 构建与检查

```powershell
python tools/prepare_controller_support.py --download --build
python tools/prepare_controller_support.py --install-client
python -m unittest discover -s tests -p test_controller_controls.py -v
python tools/check_controller_support.py --runtime
```

构建输出在 `vendor/controller-cache`，编译使用原有官方 Minecraft / NeoForge 缓存但不向其写入。安装仅复制清单中的 3 个 JAR 到本项目 `client/mods`；不会改 `options.txt`、既有控制器配置、服务端或公共内容清单。不同内容的同名目标会拒绝覆盖，升级由项目维护者明确协调。

Controlify 自带一份 YACL 3.8.0 的 Jar-in-Jar；这里固定外置 3.8.2，NeoForge 会选取满足版本约束的依赖，不是两个不同的顶层 YACL 模组。其余运行库来自未修改的官方发行包。

## 游戏内 QA 与验收边界

受限 QA 钩子默认关闭。仅同时满足 JVM 参数 `-Dqiandeng.controls.qa=true`、测试用户名 `QiandengTest`、游戏目录恰为 `D:/Projects/QiandengJi/client` 时启用。

它读取固定的 `client/qa-controls.json`，每个请求 ID 在进程内只消费一次，允许的动作只有：

```json
{"id":"guide-001","action":"open_guide"}
```

`action` 还可为 `screenshot` 或 `close`；截图请求须使用新的 ID。回执为 `client/qa-controls-result.json`，截图为 `client/screenshots/qd-controls-<id>.png`。钩子调用 Minecraft 的 framebuffer 截图 API，只截游戏画面；不接受命令文本、施法、召唤、背包修改或任意路径。

离线测试已经覆盖持续按住 200 tick 只触发一次、松开再按可触发，以及 QA 用户、路径、开关和动作白名单。客户端 3 个 JAR 的加载和手札界面通过记录在 [客户端检查报告](../reports/controller-support-health.json)。2026-09-07 手札文字被背景遮挡的问题已修复；该报告记录的 `guide-fixed-shot-20260907` 为修复后的实际游戏截图。

2026-09-07 的 [罗盘运行验收报告](../reports/skill-compass-smoke.json) 已 **10 组全部通过**。使用独立 QA 角色与真实容器交互，验证了右键原指南针打开 27 格罗盘、8 种精选图标、快捷移动不能取物或施法、档案只读与归档施法被拒绝、铁魔法入口打开 54 格菜单、13 个传送点完整显示，以及第 9 个地点的实际点击和位置回执。还验证了 CLI 第 8 槽移动去重、烟花实体效果、实际魔力消耗、冷却拒绝和相同请求 ID 不重施。测试只操作专用 QA，没有点击原公共地点。

实际 NeoForge 客户端的 framebuffer 截图也已验收，见 [罗盘画面报告](../reports/skill-compass-visual.json)：

- [27 格主罗盘截图](../client/screenshots/qd-controls-compass-main-shot-20260907.png)：固定原生法术书、传送阵入口，8 种精选图标及档案、关闭、刷新按钮可见。
- [传送阵截图](../client/screenshots/qd-controls-compass-waypoints-shot-20260907.png)：同页完整显示 13 个公共与 QA 个人地点。

画面使用专用 QA 的已学技能和地点夹具，真实右键与传送点击另由上述运行报告验证。两个报告都不代表物理手柄输入已通过。

上述 10 组罗盘验收是快捷栏编辑器加入前的历史基线。新增编辑器的真实 set/clear/auto 与镜像写回须查看 [编辑器冒烟](../reports/skillbar-editor-smoke.json) 的 6 项检查和当前 botgate 哈希；测试预先准备的 QA 技能不计作正常学习链路验收。[法杖客户端画面](../reports/chanting-client-smoke.json) 只有在 `visualReview=verified`、各截图 `visualReviewed=true` 且 JAR 为当前版本时才算视觉通过。截图只覆盖静态手持外观、图标及编辑器画面，不能证明长按 HUD 或实体按键。

**尚未连接实体手柄，硬件未验收。** 控制器识别、摇杆手感、死区、A/B 物理输入和不同型号图标仍需接入设备后测试；客户端加载、Mineflayer 交互和游戏截图不能替代这些结果。

当前完整命令说明见 [统一技能 CLI](SKILLS-UNIFIED-CLI.md)。
