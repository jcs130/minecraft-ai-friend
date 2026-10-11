# My Agent World：基岩生活场景、手持模型和冒险指南

2026-10-12。本批在现有 NeoForge 1.21.1 世界、Geyser 2.11.3 build 1249 与独立基岩网关上增加显示和引导。入口仍为家庭局域网 `192.168.3.163:28988/UDP`。Java、Mineflayer、Numen 和基岩共用原 `world-life`；没有另建体验世界或改动路由器。

## 玩家怎么使用

基岩添加服务器，名称 My Agent World，地址 `192.168.3.163`，端口 `28988`。重新加入时接受资源包下载。完成原有账号登录后，同伴欢迎菜单增加“冒险指南”；方向键或触屏选择即可浏览五张图文卡片：开始冒险、农场与厨房、机械与风车、魔法与装备、女仆和 Agent 同伴。以后可用 `/mawagent guide` 重新打开。菜单不发装备、不启动模型推理。

把真实生食放在点燃的农夫乐事灶台上，会显示实际食物及烹饪变化；砧板显示其实际存放物品。风车轴承组装后的风帆、齿轮、传动杆和磨石按真实机器状态显示运动。法术书按实际阶位和颜色选择模型；扳手、魔杖和魔艺剑使用专门手持模型。原来的物品数量、附魔、耐久和模组组件仍由服务端保存。

## 这批的具体范围

| 内容 | 范围 |
| --- | --- |
| 生活与机械方块 | 灶台、砧板、大小齿轮、传动杆、磨石、风车轴承、白色风帆、风帆框，共 9 类、53 个原生状态 |
| 灶台和砧板食物 | 114 种原物品图像，读取真实槽位、数量与烹饪计时 |
| 已组装风车组成部件 | 117 个原生状态，包括各种风帆、框架和选定木板、原木、羊毛；每个部件保留原模型与方向 |
| 手持模型 | 四类法术书 × 16 种颜色，加扳手、魔杖、魔艺剑，共 67 种 |
| 物品映射 | 739 种原生物品、799 个独立基岩定义；锁定 Geyser 另有 1 个内置定义，启动注册数为 800 |
| 场景辅助实体 | 519 个资源定义，实际只为连接附近的场景生成；它们没有服务端玩法身份、碰撞或 AI |
| 原女仆与 YSM | 原有 279 个模型定义及两套模型包继续使用；本批没有重做它们的动画控制器 |

资源包组合为原生图标及手持模型 `maw-native-icons.mcpack` 1.1.0、生活场景 `maw-world-visuals.mcpack` 1.0.0、原女仆和 YSM 两包 1.0.2，另加 Geyser 内置兼容包。自动测试实际下载了全部五包，逐块重组后核对完整 SHA256。

## 服务端状态与显示链路

`PlayerSceneBridge` 注册两个可选 NeoForge 频道：

- `maw_agent:scene_subscribe`：客户端发一个原始字节，`1` 订阅，其他值取消。仅接受已登录、声明接收频道的本人连接。
- `maw_agent:scene_state`：原始 UTF-8 JSON，无字符串长度前缀。含 `schemaVersion=1`、本人 `playerUuid`、维度、`serverTick`、`sampledAt`、方块及动态结构。

`MawVisuals.jar` 在本人经过认证的 `menu_state` 到达后订阅。基岩专属 Gate 显式声明以上可选频道；Agent 的 28977 默认不订阅、不添加显示标识。每个连接只收到该玩家周边状态。它是显示数据接口，不能冒充已经过视线过滤的 Agent 地形感知；规划仍使用现有 SDK 的感知和权限查询。

方块快照包含原生状态 ID、名称、属性、绝对坐标；机械读取实际转速、角度和过载状态；灶台读取原生物品与烹饪数组。组装风车复用实际被该连接追踪的 Create 结构。绘制辅助实体仅存在于基岩连接中，交互仍指向原 Java 方块坐标。物品返回沿原连接的完整组件 token 恢复，不能根据外观猜原物品。

约束为每 5 tick 一次、最大 64 KiB、最近 24 个方块。带方块实体的机械半径 16 格；未组装的白色风帆和框架只扫描周围 6 格的已加载区域；动态结构距离 32 格、最多 4 个结构，每个最多 96 个部件；每连接最多 128 个绘制辅助实体。不会为显示生成新区块。死亡、维度切换、断开或超过 1.5 秒没有状态时清理显示，过期方块恢复为原兼容映射。

几何、PNG、UV、骨骼和来源来自已校验的原生资源。碰撞形状由同版完整模组隔离服导出，不猜一个原版方块。Create 角度采用锁定版本的相位规则；灶台原动画条按原帧序、时长和插值转换。食物旋转是随实际烹饪计时推进的基岩展示效果。

## 构建、发布与回退

源码入口：`tools/maw_bedrock_visuals.py`、`world/bedrock-visuals-src`、`PlayerSceneBridge.java`、`GuideForms.java`。先准备同版原生资源、实际注册表，以及一个新的基础图标构建目录。`--icons` 必须使用 `maw_bedrock_resources.py` 生成的基础包，不要把已经增强到 1.1.0 的发布包再次作为输入。

在独立、回环监听且安装同版完整模组的测试服控制台执行 `maw_scene export_shapes`，获取工作目录中的 `maw-scene-shapes.json`。这条 OP 4 命令只导出数据，不建方块；无需在正式服执行。然后：

```powershell
$py = 'C:\Users\lzl19\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $py tools/maw_bedrock_visuals.py `
  --assets E:\QiandengJiSocietyLab\assets\native-20261009-v15-chinese-icons `
  --registry E:\QiandengJiSocietyLab\gateway\permanent\registry\items.tsv `
  --states E:\QiandengJiSocietyLab\gateway\permanent\registry\block-states.jsonl `
  --shapes '<同版隔离服导出的文件>' `
  --icons '<新的基础图标构建目录>' `
  --output '<仓库外新的场景构建目录>' `
  --geyser E:\QiandengJiSocietyLab\bedrock\plugins\Geyser-ViaProxy.jar `
  --java-bin E:\MC\jdk\jdk-21.0.12.1+1\bin
& $py tools/build_bedrock_agents.py --smoke
```

生成器校验原素材 SHA、实际状态和碰撞表，输出排除原因及源码 hash。未解决的资源冲突、模型加载器或不支持的几何明确拒绝。只对导出器明确记录的“一份模组覆盖原版资源”采用已验证优先级。编译使用临时空类目录，避免旧 class 混入新扩展。第三方素材的作者和许可保留在资源包 `credits/`，适配器许可不改变原素材许可。

本次发布同时更新原生 bridge，因此需正常停止主服及基岩桥，确认所属子进程全部退出 0，再冷备世界、玩家数据、模组、账户、服务配置和原基岩资源。将 bridge 构建记录及锁定清单与 JAR 一起更新。Geyser 目录成套安装：

- `packs/`：增强图标包、生活场景包；原女仆/YSM 包保持。
- `extensions/`：`MawVisuals.jar`、新 `MawAgents.jar`；原 `MawModels.jar` 保持。
- `custom_mappings/maw-native-icons.json`。
- 根目录：`maw-native-items.json`、`resource-contract.json`、`visual-catalog.json`、`visual-contract.json`、`agents-contract.json`。

桥 owner 锁定这些文件，不能运行时直接覆盖。用新的维护 requestId 正常 shutdown 后，通过原 `maw_service_task.ps1 -Bedrock -Mode Start -StartupMethod Run` 启动 owner，再 resume；主服用原 owner resume。不要解除角色原有的自主暂停或重放未知动作。

回退也需停主服和桥，恢复冷备中的 bridge、旧构建记录/锁、整套旧图标目录及 `MawAgents.jar`，并移除本次新增的场景包、扩展和两个场景 JSON；保留失败日志与备份。不能只退一个包或只改 contract。原世界不需要重新生成。

发布后的只读检查：

```powershell
& $py world/ops/health/health_mon.py --society-bedrock-smoke
& $py world/ops/health/health_mon.py --society-native-sdk-smoke
& $py world/ops/health/health_mon.py --society-world-adapter-smoke
```

健康同时核对文件、这次子进程启动后的实际注册数、UDP 与原防火墙范围；旧成功日志不能证明本次注册。

## 验收证据与尚未覆盖的范围

完整 30 模组隔离服的原生场景 11 项通过：登录前拒绝订阅、本人 UUID、取消订阅、消息预算、未组装风帆、真实食物/烹饪进度、真实 16 RPM、风车组装和转动、红色法术书原始组件映射。真实基岩 UDP 协议客户端另有 11 项通过：下载五包并核对生成文件、进入世界、认证后欢迎菜单、按按钮进入厨房指南、原图图标路径、方块/食物/风车实体消息。53 项 Python、248 项网关回归、55 项 Java 表单断言通过，零跳过、零付费模型调用。

网络故障也保留：一轮测试的微软 OpenID HTTPS 请求出现 TLS EOF，随后静态初始化失败使该隔离桥的后续连接继续失败。确认默认 Java HTTPS 可以正常访问后，仅正常重启隔离桥，最新同一批资源完整复测通过；未关闭正式 Xbox 校验或放宽 TLS。其余旧探针的握手、UUID 字节序和表单图标字段错误记录保留。

这些是实际原生数据、资源下载及客户端协议验收。真实手机画面、手持姿态、GUI 光照和动画平滑度仍待视觉确认，`actualPhoneTested=false`、`visualPixelParityVerified=false`。专用物品的背包预览来自原模型纹理裁片，不是 Java GUI 的逐像素复刻。任意复杂 Create 结构只有全部部件已支持时才显示；不支持的结构不会被伪造成完整风车。全部模组 GUI、敌人/效果、女仆装备层、完整 YSM 动画也不在本批完成声明中。

私有验收和冷备在运行目录 `research/bedrock-visuals-20261011`、`backups/bedrock-visuals-20261012`，不提交玩家数据、凭据、生成包或 JAR。原始素材仍在独立可视化仓库；本批没有修改网页渲染器或它的素材。

正式发布已完成：1,264 文件冷备通过 CRC 和逐 SHA 校验，只换原生 bridge 与本批基岩显示/菜单资源。正式服两种 provider 的 17 项只读接入检查、基岩 9 项健康、原生 SDK 9 项及统一接口 8 项健康均通过。发布后核验 19 项通过，其余 29 个原生 JAR、旧分发包、保护配置和原账本前缀保持；只追加一次 worker 启动、断开和重生记录。MawExplorer 仍人工暂停。当前启动无 ERROR；原有 refmap、Structurize 包发现、Create Dragons Plus 数据映射及连接重复断开等 WARN 保留，本批没有将它们改成已修复。主世界及所有隔离子进程正常退出 0 后发布，测试端口现已关闭。
