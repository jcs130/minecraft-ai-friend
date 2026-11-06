# 原生女仆相机：NeoForge 适配

2026-11-06。本页先记录已完成的候选验证；正式切换结果须以发布验收回执为准。

## 原因及选择

先前正式女神相机使用 Fabric，不能加载 NeoForge 的 Touhou Little Maid。服务器为了兼容原版客户端，把女仆映射为悦灵；提高材质或光影质量不会改变实体类型。RTX 3080 Ti 是显卡，并不要求 Fabric；NVIDIA RTX Remix 的 Minecraft 模组当前面向 Fabric，不能直接当作 NeoForge 女仆客户端。

本次采用 Minecraft 1.21.1 / NeoForge 21.1.252、原版 YSM 2.6.5、原版车万女仆 1.5.3、Sodium 0.6.13、NeoForge Iris 1.8.8、Complementary Reimagined r5.9.3 MEDIUM 和 Faithful 32×。保留 3080 Ti 渲染，不称之为 RTX Remix 或路径追踪。原版、基岩、Mineflayer 的映射能力不移除；需要完整女仆外观的客户端须安装匹配的原生模组。

官方兼容资料：[Iris NeoForge 1.21.1](https://modrinth.com/mod/iris/version/1.8.8%2B1.21.1-neoforge)、[RTX Remix 安装要求](https://github.com/NVIDIAGameWorks/rtx-remix-minecraft/blob/main/docs/PLAYING.md)、[车万女仆](https://github.com/TartaricAcid/TouhouLittleMaid)。

## 实现边界

- 新相机桥 `0.2.0-neoforge` 重用现有相机租约、视角几何、隐藏 HUD/Toast、帧率/显存保护和 MC 核心场景导出源码；通过安装包中的官方映射生成 Mojmap 源码，未知或歧义符号拒绝构建。
- 只提供本机私有拍照/场景 RPC、限时控制租约和专用登录提交。没有新增自主 Agent 循环；普通聊天、传送或其他游戏命令均不能经此桥执行。账号密码由原私有登录助手读取，仍需服务器授权心跳确认成功。
- YSM 读取原版 `RenderPlayerEvent` 使用的玩家渲染 attachment。普通实体 attachment 和服务端保存的 model_id 都不能代替玩家当前外观。观察不改模型、不创建渲染 attachment、不绕过原版握手。
- 女仆来自真实 `touhou_little_maid:maid` 和原版 `EntityMaidRenderer`。场景归档保留实体类型和 `maidModel`，不把悦灵映射冒充原生模型；尚未保存完整女仆 NBT、动画状态或所有原始资源，不能保证未来逐像素重建。
- `prepare_neoforge.py` 使用已安装的官方 NeoForge 启动元数据，核验原版客户端和有校验值的库。继承客户端必须使用 NeoForge profile 的文件名，避免与 NeoForge 提供的 Minecraft 模块重复。正式客户端引用独立稳定运行库，不依赖临时测试服目录。

构建需显式提供已安装的 NeoForge 编译类路径、Mojang mappings、Fabric intermediary 映射及原版 YSM/TLM JAR；`build_neoforge.py --help` 列出参数。原版 JAR 用摘要锁定，升级版本必须重新核对公开 API。源码仓库不包含第三方 JAR、玩家凭据或私有运行文件。

## 已完成的验证

独立 Youer 测试服只监听回环端口，用合成账号和测试女仆，不操作正式玩家。

| 检查 | 结果 |
| --- | --- |
| Intel 原生客户端、原生酒狐/灵梦、YSM 同框、三个视角及场景保存 | 26/26 |
| RTX 3080 Ti + Complementary，同样的三个视角和原生模型 | 26/26 |
| 正式启动配置生成器、1280²、登录重复请求/冲突/过期租约、凭据不进入回执、女仆模型归档 | 34/34 |
| 照片租约、GPU 就绪、归档格式及门户读取回归 | 12/12 |
| NeoForge 启动库摘要、继承文件名、路径和参数边界 | 5/5 |

真实截图已人工检查：酒狐、灵梦、YSM 人物及女仆表情气泡正常，HUD 隐藏，人物名字保留。测试期间 TTS、系统一进程、模型实例及重启计数保持。只说明本轮并发验证，没有据此宣称长期内存稳定性已完成。

失败记录保留：第一次依赖版本字符串不完整、前两版误读 YSM attachment、启动生成器首次重复加载原版模块，均在隔离环境修正后复测。RTX 首次维护等待使用了错误状态名，超时后恢复旧相机；修正为守护实际的 `maintenance-paused` 后通过，未触碰游戏或模型服务。

## 发布及回退

采用独立 NeoForge 相机目录；原 Fabric 客户端完整保留。切换只涉及相机守护配置、私有登录助手路径、拍照桥配置及场景归档模块四个文件。E/F 两盘保存对应候选、当前文件回退和新客户端摘要。

等待拍照队列和女神任务空闲，暂停原任务后正常停止相机与拍照桥，再切换；保留原账号、照片归属、照片入箱和网站上传路径。启动失败恢复四文件及原相机，不覆盖任何玩家数据。游戏服、登录代理、TTS 和系统一不重启。发布器须核对当前四文件与新 profile 摘要，不能重放已消费的历史维护入口。
