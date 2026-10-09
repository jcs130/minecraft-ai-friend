# My Agent World 基岩资源适配

2026-10-09 最新部署：732 种静态物品图标，加上车万女仆、YSM 两套专属模型包；Geyser 实际注册 733 个物品与 279 个实体定义，已在自动下发列表找到两套模型包。资源和协议验证通过，真实基岩客户端下载与视觉仍未验收，不能称全模组显示一致。

## 专属模型包

| 资源包 | 版本 / 字节数 | 当前范围 |
| --- | --- | --- |
| `maw-native-icons.mcpack` | 1.0.2 / 451,684 | 732 种静态物品图标 |
| `maw-touhou-models.mcpack` | 1.0.2 / 2,869,354 | 241 个车万女仆模型及纹理变体 |
| `maw-ysm-models.mcpack` | 1.0.2 / 1,857,594 | 38 个 YSM 模型及纹理变体 |

原骨骼、父子关系、方块、pivot、旋转、inflate、零厚度面及逐面 UV 保留；PNG 原字节复制。旧 1.10 几何只迁移 description 到 1.12 格式，已有新格式保留原版本。模型包内 `credits/*.json` 保留来源定义和作者/许可资料，原作品许可不随适配代码改成 MIT。资源路径缩短到 80 字符以下；TLM 额外纹理保留原生 MD5 后缀，不能凭模型基础名称猜纹理。

`MawModels.jar` 用 Geyser 的实体 API 注册全部 279 个定义。独立兼容 Gate 按同一连接的真实女仆 metadata 选择模型，在 `mawbedrock:entity` 私有负载之后发送显示载体；原实体 UUID、entityId、坐标、AI 和交互身份保持。只把共享的 Entity/LivingEntity metadata 交给显示载体；自定义属性仍过原版过滤。没有匹配资源则明确不显示，不套错误皮肤。扩展就绪握手 `mawbedrock:ready` 使初始模型和本人状态缓存到监听器已挂接后再发送；缓存保留原生数据，在发出时才进行物品显示转换，避免重复附加 token。

YSM 本人外观读取该连接 `maw_agent:menu_state.self.ysm`，双重核对 playerUuid 和锁定 YSM JAR。6 个 64/128 尺寸的变体可通过 Geyser 网络 Skin API 绑定本人：default 两款、Alex、Steve、Boy 蓝/红。其余 32 个模型纹理已供自定义女仆实体使用，不宣称已解决任意尺寸的玩家皮肤；未知/禁用模型恢复本人原皮肤。不会拿其他玩家的本人快照替换外观。

本批排除 17 个来源记录：12 个几何与 PNG 尺寸不一致、2 个重复骨骼名、3 个 YSM 多通道纹理。完整原因在 `modpack-contract.json`。Java JS/Gecko/YSM 动画控制器、装备/背包层、第一人称手臂、专用 GUI、动态世界方块仍需另行适配；下载包成功不代表这些功能完成。

模型转换与扩展编译：

```powershell
$py = 'C:\Users\lzl19\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $py tools/maw_bedrock_modpacks.py `
  --assets E:\QiandengJiSocietyLab\assets\native-20261009-v15-chinese-icons `
  --geyser E:\QiandengJiSocietyLab\bedrock\plugins\Geyser-ViaProxy.jar `
  --java-bin E:\MC\jdk\jdk-21.0.12.1+1\bin `
  --output '<仓库外新的模型构建目录>'
```

锁定 TLM 1.5.3、YSM 2.6.5 和当前 Geyser-ViaProxy JAR SHA；扩展的内部 downstream 监听器必须随锁定 Geyser 版本重新编译验收。两个 `.mcpack` 放 `packs/`，`MawModels.jar` 放 `extensions/`，`modpack-catalog.json`、`modpack-contract.json` 放 Geyser 根目录；一次维护成套替换。owner 同时校验模型包、扩展与目录，健康冒烟增加实际模型注册和资源下发栈，共 8 项。主世界与 Agent 网关无需重启。

45 项 Python 与 60 项 Node 回归通过、零跳过，扩展通过实际锁定 JAR 编译。普通非 OP、零模型调用 QA 经正式 ViaProxy 收到正确模型绑定、同 UUID/entityId 的实体及过滤后 metadata；延迟就绪和重连也验证通过。早期两次有界观察未收到目标，原生链路同样未收到；只将 QA 账号移动到已有女仆附近后重测，原 Agent/女仆未传送。这属于协议验证，真实基岩手机的下载、几何显示和玩家皮肤仍为未验。桥在一次启动时遭遇 Windows 内存提交不足（1455），原生 JVM 报告保留，守护自动恢复；不能据当前健康掩盖该历史故障。

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

单层 PNG 原字节拷贝；多层 generated 图标只按原图透明叠加。生成器不重绘贴图、不替换 Java/网页原资源。状态覆盖、动画、动态染色刷怪蛋、非方形贴图、block/BER/专用渲染器模型及资源优先级冲突明确记入 excluded，不能用“纸”等图标冒充完成。初版 759 种预览中发现 27 种刷怪蛋需客户端代码染色，最终 1.0.2 包将其移出完成清单，避免白色蛋误报适配。魂符七帧动画、魔艺专用法术书、机械动力运动结构和模组 GUI 尚未完成基岩适配；女仆/YSM 本批范围见上文。后续分别转换模型/动画与交互，不因资源包下载成功自动判定支持。

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

`--society-bedrock-smoke` 当前 8 项检查包含资源 ZIP/PNG/atlas/定义完整性、当前子进程真实物品/模型注册数量和资源下发栈；时间早于该子进程启动的旧注册日志不能通过。已有 owner 继续守护两个子进程，无新增裸进程。

## 验证及边界

本轮 36 项守护回归、5 项资源测试、56 项网关/原生协议回归通过，零跳过。源图拷贝、中文名称、生成可重复、动画/染色/专用模型排除、篡改/过期注册拒绝、跨账号 token 拒绝、完整 mod 组件返回等有断言。

普通非 OP `MawBedrockQA1009`，零模型调用，经 28995 实际收到独立标识、名称和 token；Java776(26.2)也收到转换后的 float CMD 与 token。提供给测试账号铁刀、安山合金、魔源宝石各 1 件是明确测试夹具，不是玩家自然获得。经过拿取、移动、放回及重连保存读取，Patchouli 指南书类型/数量/`patchouli:book` 组件与原生物品、车万魂符原 owner 组件均保持，显示 token 未写入存档。

保留两次测试缺口：最初原版 writer 编码返回 mod 组件导致测试账号解码断线；补原生 serverbound writer 后解决。随后 QA 脚本误把无符号窗口 255 当 -1，等待游标超时，断开使测试指南书自然落地；已按实际 UUID 取回同一本并修正测试，未伪造或重复发书。两份失败报告、日志和正式回执都保留。Java 独立探针缺 Log4j ip_redactor 布局的诊断不等于正式桥错误。

真实手机/Xbox 登录、下载完成、快捷栏/手持/掉落图标和拿取仍需实际基岩客户端验收；本轮没有将这些记为 true。下一批优先适配常用 Create/农夫乐事世界方块、魂符状态与动画、女仆/YSM 动画和装备层，分别记录资源、映射、视觉和交互结果。

依据：[Geyser 自定义物品](https://geysermc.org/wiki/geyser/custom-items/)、[资源包下发](https://geysermc.org/wiki/geyser/packs/)、[独立方块映射](https://geysermc.org/wiki/geyser/custom-blocks/)。
