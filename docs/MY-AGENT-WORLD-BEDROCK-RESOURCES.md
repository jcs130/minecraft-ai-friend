# My Agent World 基岩资源适配

2026-10-09 首批部署：732 种静态 generated/handheld 物品，使用已校验的原模组 PNG。Geyser 实际注册 733 个自定义物品，其中 732 个来自本包，另 1 个是锁定 Geyser 自带定义。资源和协议验证通过，真实基岩客户端下载与视觉仍未验收，不能称全模组显示一致。

## 当前范围

| 模组 | 物品数 |
| --- | ---: |
| Ars Nouveau 魔艺 | 227 |
| MineColonies 殖民地 | 137 |
| Farmer's Delight 农夫乐事 | 152 |
| Create 机械动力 | 114 |
| Touhou Little Maid 车万女仆 | 46 |
| Macaw's Windows | 21 |
| Create Dragons Plus | 18 |
| Structurize | 5 |
| Dungeoneer | 2 |
| Macaw's Bridges | 3 |
| Domum Ornamentum、Macaw's Furniture、Macaw's Roofs | 各 2 |
| Patchouli | 1 |

这是物品图标数量，包含料理、材料、部分工具和饰品，不能解读成已支持相应世界方块或模组全部功能。名称优先取已校验的原 zh_cn，缺中文时保留原英文/标识，不覆盖个人命名。

单层 PNG 原字节拷贝；多层 generated 图标只按原图透明叠加。生成器不重绘贴图、不替换 Java/网页原资源。状态覆盖、动画、动态染色刷怪蛋、非方形贴图、block/BER/专用渲染器模型及资源优先级冲突明确记入 excluded，不能用“纸”等图标冒充完成。初版 759 种预览中发现 27 种刷怪蛋需客户端代码染色，最终 1.0.2 包将其移出完成清单，避免白色蛋误报适配。魂符七帧动画、魔艺专用法术书、机械动力运动结构、女仆与 YSM 实体、模组 GUI 尚未完成基岩适配。后续分别转换模型/动画与交互，不因资源包下载成功自动判定支持。

## 显示与物品身份

28994 独立兼容 Gate 在原生物品 ID 翻译前，给本包物品加 `custom_model_data=8000000+原生ID`，为没有自定义名称的物品加名称组件。Geyser v2 legacy 映射用“基础物品+该标识”选择独立基岩定义和 atlas 图标，原版基础物品本身不被整体换皮。数值小于 2^24，经历 Java 1.21.4 后的浮点组件转换仍精确。

每个连接额外保留物品完整原生组件快照，以随机 128 位 `custom_data.maw_bedrock_view` 标识关联。包括原版物品在内的背包返回包均从该连接缓存恢复原生 ID、组件及 removals，数量由真实服务端校验，不反查纸/石头的多对一近似表。客户端改写组件不进入服务器；缺失或跨连接标识拒绝并断开该连接，要求重连刷新，不猜原生物品。创造物品注入暂拒绝。缓存上限 8192 种组件变体，满后要求重连，不淘汰后再误认物品。

原生组件返回需使用后端 serverbound codec，不能直接由原版 writer 编码 Patchouli 等 mod component。新连接实际 FrozenRegistrySnapshot 必须与目录 nativeId/nativeItem 相符，否则拒绝陈旧目录。全部逻辑只在基岩专属 Gate 开启，Agent 28977、原生 SDK 和网页不增加这些显示标识，也不丢失其原资源。

## 构建和发布

代码：`tools/maw_bedrock_resources.py`；生成输入为 v15 原生资产、同一套 items.tsv 和 idmap.json。工具验证每个使用文件的 SHA，拒绝歧义优先级，输出可重现 ZIP、Geyser 映射、Gate 目录和来源/排除清单。本服务端仓库保存适配代码；可视化的原始模型、PNG、语言及动画已在独立 [mc-visual-console 的 native-1.21.1 素材包](https://github.com/jcs130/mc-visual-console/tree/main/packages/modern-viewer/asset-packs/native-1.21.1)随代码提交。已按远端 a0cb107d 树逐文件核对 39,700 个主素材文件与当前 v15 原字节一致，含此前 323f7b8 魂符适配代码，素材提交为 986a052c。原服务器 registry 和覆盖变体按该包 README 从匹配服务端导出；当前生成 mcpack、JAR、原始包、测试玩家资料及本机证据留在运行目录，不能混入玩家数据。

```powershell
$py = 'C:\Users\lzl19\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $py tools/maw_bedrock_resources.py `
  --assets E:\QiandengJiSocietyLab\assets\native-20261009-v15-chinese-icons `
  --registry E:\QiandengJiSocietyLab\gateway\permanent\registry\items.tsv `
  --idmap E:\QiandengJiSocietyLab\gateway\permanent\idmap.json `
  --output '<仓库外新的构建目录>'
```

正式目录 `E:\QiandengJiSocietyLab\bedrock\plugins\Geyser`：

- `packs/maw-native-icons.mcpack`：资源包，版本 1.0.2。
- `custom_mappings/maw-native-icons.json`：format_version 2、732 个独立定义。
- `maw-native-items.json`：兼容 Gate 显示目录。
- `resource-contract.json`：三个文件 SHA/字节数、原资产输入 SHA、使用文件来源、排除原因。

先在新目录构建、验证，再通过独立 `maw_bedrock_service.py stop` 停止两桥子进程，等待所有 pid=null/exit0；`shutdown` 正常结束桥 owner 后备份并替换四个文件。启动 helper 使用 `-Bedrock -Mode Start -StartupMethod Run`，其后以新的 requestId resume。主世界无需重启。不要对运行文件直接覆盖：owner 会因锁定文件变化拒绝继续。包版本、contract 与新目录必须一起更新，保留旧包和失败记录。资源包存在时 owner 强制验证目录和 idmap SHA，并以受控环境变量给基岩 Gate；无资源包的基础桥兼容路径保留。

`--society-bedrock-smoke` 的 7 项检查包含资源 ZIP/PNG/atlas/定义完整性和当前子进程真实注册数量；时间早于该子进程启动的旧注册日志不能通过。已有 owner 继续守护两个子进程，无新增裸进程。

## 验证及边界

本轮 36 项守护回归、5 项资源测试、56 项网关/原生协议回归通过，零跳过。源图拷贝、中文名称、生成可重复、动画/染色/专用模型排除、篡改/过期注册拒绝、跨账号 token 拒绝、完整 mod 组件返回等有断言。

普通非 OP `MawBedrockQA1009`，零模型调用，经 28995 实际收到独立标识、名称和 token；Java776(26.2)也收到转换后的 float CMD 与 token。提供给测试账号铁刀、安山合金、魔源宝石各 1 件是明确测试夹具，不是玩家自然获得。经过拿取、移动、放回及重连保存读取，Patchouli 指南书类型/数量/`patchouli:book` 组件与原生物品、车万魂符原 owner 组件均保持，显示 token 未写入存档。

保留两次测试缺口：最初原版 writer 编码返回 mod 组件导致测试账号解码断线；补原生 serverbound writer 后解决。随后 QA 脚本误把无符号窗口 255 当 -1，等待游标超时，断开使测试指南书自然落地；已按实际 UUID 取回同一本并修正测试，未伪造或重复发书。两份失败报告、日志和正式回执都保留。Java 独立探针缺 Log4j ip_redactor 布局的诊断不等于正式桥错误。

真实手机/Xbox 登录、下载完成、快捷栏/手持/掉落图标和拿取仍需实际基岩客户端验收；本轮没有将这些记为 true。下一批优先适配常用 Create/农夫乐事世界方块、魂符状态与动画、女仆实体，分别记录资源、映射、视觉和交互结果。

依据：[Geyser 自定义物品](https://geysermc.org/wiki/geyser/custom-items/)、[资源包下发](https://geysermc.org/wiki/geyser/packs/)、[独立方块映射](https://geysermc.org/wiki/geyser/custom-blocks/)。
