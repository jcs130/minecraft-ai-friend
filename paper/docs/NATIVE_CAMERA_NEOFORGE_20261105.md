# 女神相机：原生 NeoForge 与 32× 材质隔离验证

本记录是 2026-11-05 的隔离渲染验证，不是正式相机已迁移的公告。后续控制桥、拍照和场景适配进展见 [2026-11-06 原生女仆相机](NATIVE_MAID_CAMERA_20261106.md)。当时正式相机运行 PR #77 的 Fabric 1.21.1、YSM 2.6.5、RTX 3080 Ti、Complementary Reimagined r5.9.3 MEDIUM；空闲 5 FPS、拍照 30 FPS 的资源保护规则保持不变。

## 需要解决的缺口

现有 Fabric 相机可以读取 YSM，但不能直接运行 NeoForge 版车万女仆的原生实体渲染器。材质和光影不能弥补这个加载器差异。应让相机使用匹配游戏版本的 NeoForge、原版 YSM 和原版女仆客户端，再迁移现有拍照控制桥；不要用村民映射作为高画质照片的最终方案。

## 已验证组合

| 部件 | 版本与来源 |
| --- | --- |
| Minecraft / NeoForge | 1.21.1 / 21.1.252，使用已验证的官方客户端库 |
| YSM | 原版 `2.6.5-neoforge+mc1.21.1`，不改模型选择及握手 |
| 车万女仆 | 原版 `1.5.3-neoforge+mc1.21.1`；[作者仓库](https://github.com/TartaricAcid/TouhouLittleMaid) |
| Iris / Sodium | `1.8.8+1.21.1-neoforge` / `mc1.21.1-0.6.13-neoforge`；[Iris 官方](https://irisshaders.dev/) |
| 材质 | [Faithful 官方 32×，Minecraft 1.21.1，June 2026](https://database.faithfulpack.net/packs/32x-Java/June%202026/) |
| 光影候选 | 与正式相机一致的 Complementary Reimagined r5.9.3；本次核显原生兼容检查关闭光影 |

2026-11-05 20:56 CST 的真实 960×960 截图和诊断同时确认：

- 加载器为 NeoForge `TransformingClassLoader`；Sodium 自带的 Fabric API 子模块不是 Fabric 加载器。
- 原版 YSM 客户端握手就绪，测试玩家实际渲染自定义 YSM 外观。
- 女仆实体类型为 `touhou_little_maid:maid`，实际使用 `EntityMaidRenderer`，没有变成村民。最初截图只见头部，不能据此判断原生外观完整；下述补测已定位测试场景的问题。
- Faithful 32× 与 `mod_resources` 同时加载，资源包不覆盖 `yes_steve_model`、`touhou_little_maid` 命名空间。截图无游戏 HUD，玩家名字保留。
- 本次只使用核显运行隔离客户端、合成玩家和本机测试服；没有第二个 RTX 相机与正式服务争抢显存。8 FPS 是此核显测试的结果，不能作为 3080 Ti 性能结论。

首次启动揭示 NeoForge 改写了窗口创建调用；原 Fabric `glfwCreateWindow` 注入点不匹配。隔离探针改为已核实的 `ImmediateWindowHandler.setupMinecraftWindow` 后启动、实体渲染和截图通过。正式适配不能只改包名或把 Fabric JAR 改扩展名。

21:41 CST 补测：实际地面是 Y=-60 的草方块，先前实体脚部错误地设在 Y=-60，而不是方块上表面的 Y=-59；身体被地面遮挡。仅改变驯服、饥饿状态，或移除 Iris/Sodium 都没有改变遮挡结果。修正测试高度并恢复原 Iris/Sodium 组合后，原生酒狐 `authors_and_credits:wine_fox_maid`、灵梦 `touhou_little_maid:hakurei_reimu` 与测试玩家 YSM 完整同框，女仆原生表情气泡也显示。读回实体存活、站立、正确模型 ID，原 YSM 握手保持就绪。这是测试布景错误，不是已证明的正式服模型渲染缺陷；不修改正式女仆、玩家模型或地形来“修复”它。

## 资源与后续验收边界

Faithful 包约 10.5 MiB、`pack_format=34`，SHA256 为 `15e093da38af37e11531c6cfeb9787f5617c20009c68b789eb62cfafe53c2762`。包内 PNG 原始像素按 RGBA 计算约 127 MiB，仅用于估算；这不是 GPU 图集占用或加载峰值。优先验证 32×，不要在模型服务同卡运行时盲目加入高分辨率 PBR、远景区块或高档光影。

本次未替换正式 `agent-mc-java/v1` 控制桥、短时镜头租约和场景归档链。切换正式相机前仍须完成 NeoForge 对应适配，并验证第一/第三/俯视拍摄、GUI 隐藏、原生女仆模型及装备、YSM 加载、照片入箱/网站同步、场景保存、断线重连和回退。不能把隔离截图成功描述成这些能力已上线。

正式 RTX 测试必须先正常暂停自己的相机，避免双开；保留 TTS、系统一的 GPU 分配、缓存与服务进程，用同场景和相同分辨率比较帧时、显存、照片耗时，再做并发语音/决策验收。不得通过清空模型缓存或重启模型服务来给相机腾显存。

此次维护期间正式相机已正常暂停时，3080 Ti 仍仅余约 1,334 MiB。未启动第二个 RTX 测试进程，也未把材质/更重光影直接放入正式实例。TTS PID、系统一容器 PID/实例 ID 与原基线相同，健康正常，重启计数均为 0。
