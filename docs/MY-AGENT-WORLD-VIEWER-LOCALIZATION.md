# My Agent World：网页图标与中文名称维护

2026-10-09：新服名称同步与网页已更新。可视化代码提交到独立的 `jcs130/mc-visual-console` main；本仓库使用 `experiment/agent-society-1.21.1`。旧 Paper 千灯纪及端口未改，生活世界未重生成。

快捷栏、背包、光标、配方预览与钓获可显示原版/模组中文。服务端保留原 `getHoverName()` Component 和参数，所以“圆石面板”等动态名称也能翻译。自定义命名优先，悬停仍有物品 ID；未知翻译保留原文。工作台、箱子、炉、饰品栏、烹饪锅、建筑切割台提供中文界面名。Domum 的常用分组/格式在 viewer 有界补译，Agent 命令及 SNBT 不改写。

橡木按钮、木板、楼梯恢复原图标。既有面板之外，新增七种 Domum 默认模型、四种门、十五种活板门，第一页十组图标均支持。只重贴实际组件指定的 sprite，保留铁铰链等原纹理。材料限已审计的不透明、无 tint、单一 sprite；魂符 INIT/HAS_MAID 动画/glint 及其他未知模型仍明确 unavailable，不借 EMPTY 图标代替。

## 当前部署

- 网页仍为 `http://192.168.3.163:28984/third/`，游戏/gate 端口不变。
- 桥 SHA256：`a672b1d233941b31e782f0465d379e1b2e90756daa30882988277d1f3647f8ec`。
- 资产：`E:\QiandengJiSocietyLab\assets\native-20261009-v15-chinese-icons`，39699 主资源，连 variant/registry 共 39768 个校验文件。
- v14 的 39698 个主资源 SHA 逐项保持，仅新增未编辑的 Mojang zh_cn；YSM 原模型/动画/PNG 保留，旧资产目录保留供回滚。
- 仅 `services/agent.json` 的 `assetDirectory` 改为 v15，其他参数未改。其他 26 JAR、主 Agent 原暂停/任务/凭据/旧未知动作保持。

中文导出需要官方 1.21.1 version JSON、asset index 17 及 SHA1 对象，使用 `--minecraft-version-json`、`--asset-index`、`--asset-objects-dir` 核对 client/index/object 哈希链。原文件、JAR、PNG、运行目录及原始包不入 Git。

只放行 Domum 对原版 oak_planks/dark_oak_planks 两个 PNG 的确定覆盖，依据锁定原 ClientPackSource、NeoForge ResourcePackLoader 和 FallbackResourceManager 的默认 pack 顺序。其他 9 项覆盖未解决，完整 resourcePriorityVerified/renderParityVerified/complete 仍为 false。完整规则、类哈希及输入见可视化仓库 `renderer-src/docs/native-ui-localization.md`；不能按 mod 文件名排序猜优先级。

## 验证与恢复

148 项相关 Node 原资产测试通过，0 skip；9 项导出测试、3 项菜单/6 项 Cutter/3 项材质 Java 审计通过，实际桥编译通过。实机使用普通非 OP 的 mc-agent-neko 身体，0 模型调用，不启动主决策或接 QwenPaw。机器/材料沿用先前披露的管理夹具，不作为自主采集证明。

两轮维护由 supervisor 正常关闭 owned worker/gate/java，退出码 0；冷备 world-life/原桥/配置并验 CRC、逐文件 SHA 后恢复。第二轮仅刷新网页内存 bundle。原主 Agent 暂停及旧未知动作不能重放，也不要重放本次已结束的维护请求。私有回执、失败尝试、备份和截图在 research/viewer-chinese-icons-20261009。

新增可选 `displayNameComponent` JSON，兼容保留 `displayName`、`descriptionId` 和 SNBT。Host 单份 Component 显示预算 4096 字节，超出保留服务端名称；菜单 64KiB/Cutter 16KiB 预算不放宽，不写入聊天。后续扩展先核对锁定 JAR 与真实 ItemStack，再用本人连接和浏览器验收。
