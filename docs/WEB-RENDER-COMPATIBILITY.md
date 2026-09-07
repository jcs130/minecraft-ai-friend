# 天神之眼渲染资产兼容性

最终联合部署后，2026-09-07 20:27–20:35 在真实管理页持续查看第一人称、环绕和俯视画面，实测拖动镜头、切换栏目；未再出现内存分配错误或浏览器错误，离开后服务端画面会话归零。记录见 `reports/management-platform-smoke.json`。这是已加载区域的持续实测，不是全部模组模型逐项验收。最后仅将俯视画面的无障碍说明改为“只观察”，没有改变几何或渲染预算。

本轮已按当前 D 实例重建网页资产：**71 个服务端 JAR、87 个客户端 JAR，共 95 个不同 SHA-256 的 JAR**，ZIP 完整性全部通过，重复资源内容冲突为 0。这里的“扫描”表示提取可供既有网页渲染器消费的 JSON/PNG，不表示在网页运行了全部 Java 模组。

生成器为 `tools/build_web_mod_assets.py`，只读取 D JAR、根代理导出的当前注册表，以及本机原版 1.21.1 JAR 中的父模型/纹理存在性；不会连接 MC、下载资源、启动服务或改变世界。首轮真实浏览器曾显示地形和建筑，但约 60 秒后出现重复内存分配错误，因此首轮未通过持续运行验收。下述预算修复已完成离线验证；修复后的真实持续运行结果由统一部署步骤另行记录。

## 当前成果

| 项目 | 结果 |
| --- | --- |
| 实际注册表 | MC 1.21.1 / NeoForge 21.1.248；4,336 种总方块、116,650 个总状态 |
| 网页模组方块表 | 3,276 种、89,816 个状态，逐状态属性反解精确回放 |
| 普通 JSON 形状 | 3,219 种方块具备可解析模型引用 |
| 明确回退形状 | 57 种，深色/紫色棋盘立方；显示名带“网页简化”，报告逐项说明原因 |
| 模型字典 | 10,070 项；保留父模型继承，只发送当前方块引用闭包和两杖别名 |
| 方块 / 物品纹理图集输入 | 1,367 / 0 项；两杖使用方块几何和纹理 |
| 物品模型 | 发现 3,952 项，仅预载两杖；其余 3,950 项只列目录，不宣称已实现按需加载 |
| 动画纹理 | 有 mcmeta 的纹理取指定首帧；不宣称播放完整动画，精确清单见报告 |
| 资源包 JSON 大小 | 10,607,005 bytes；比首轮 50,080,587 bytes 减少 78.8%，生成器上限 20 MiB |

根代理于 2026-09-07 19:48:06 执行了固定命令 `numen_act dumpregistry`。来源 `server/mc/block-registry.json` 已按授权原样复制到 `server/world-data/block-registry.json`，只更新此单个镜像文件。两份 SHA-256 均为：

```text
b34ebce167948b2822130cc6136f7cb690a2f2538eae4b87f18b415528b7bd42
```

旧网页包只列 10 个 Macaw namespace 和退役 `settlements`，块表来自旧 8 月 27 日注册表。新包从当前 JAR 和新导出重新生成，移除了旧 `settlements` 编号依赖。Macaw、Prefab、Spawn、铁魔法、女仆扩展、无人机等具备普通方块资源的内容已纳入；不能从 JAR 文件名猜测 stateId。

生成器修正了旧脚本中“状态基数检查总为 true”的问题，验证每块连续编号、属性组合乘积及每个状态；枚举导出如 `BASE`、`MIDDLE_NS` 归一成模型 variants 使用的 `base`、`middle_ns`；默认状态使用真实注册表值，而不是一概取最小编号。父模型的纹理变量在子模型覆盖后解析，未使用的父级占位变量不会误使合法几何回退。

## 两把言灵法杖

`qiandeng_chanting:whispering_staff` 和 `qiandeng_chanting:resonance_staff` 分别保留现役 JAR 中的 5 段 / 7 段立体几何及 display 变换，使用原版紫水晶、海晶灯、去皮原木和金块纹理。它们没有额外 PNG，也不是普通平面 layer0 物品。

既有 bundle 的 `getItemTexture` 会先查询 `namespace:名称`；只放 `namespace:item/名称` 且没有 layer0 时不会进入立体物品路径。因此新包为这些物品添加真实模型直接名称别名。测试执行了 bundle 中原函数，确认两把杖都进入几何分支。

`vendor/modern-viewer/modern-viewer.js` 在既有 `Boe` 资产接入函数中增加 `customTextures.items` 输入，与已有 `customTextures.blocks` 并列；另有下节所述渲染预算和状态文案的小范围补丁，均以已知字面量和出现次数守卫。`mod-pack.json` 仍采用 schemaVersion 1，新增可选 `itemTextures` 字典，加载器使用已有 items atlas API。没有编造新的 Java/YSM/着色器协议。

## 首轮内存错误与预算修复

首轮包在真实第一人称页面约 60 秒后出现 6 次 `Array buffer allocation failed`，外层管理台也明显卡顿。初始包大小 50,080,587 bytes、模型 17,948 项、方块纹理 2,337 项，此结果不能因后续重建而改为成功。`reports/web-render-initial-failure.json` 单独保留根代理的首轮观察摘要，原截图/浏览器记录不改；后续运行验收另写报告。

可确定的主要增量内存来源是：首版将继承几何重复展开、把全部物品别名和额外图集一起装入世界包，随后由多个区块 worker 复制资源。JSON 文件大小不等于堆内存大小；纹理解码、GPU 图集和区块几何会继续占用内存。因此本轮同时缩减资源与渲染并行量，没有通过吞异常掩盖失败：

- 保留当前 89,816 个状态的精确映射，裁掉未被当前方块和两杖引用的模型/纹理；不将可解析内容改成空气。
- 保留原始父模型继承，避免同一几何在大量子模型中重复展开；全物品预载缩为两把杖。
- 区块网格 worker 固定为 1；视距默认 2、上限 4；帧率上限 30，像素比上限 1。
- `mod-debug-panel` 与底部技术 HUD 默认关闭，只有 `?diagnostic` 开启；顶部成功状态显示“画面已连接 · 第一人称/环绕/俯视”。失败与断线状态、console 错误和启动失败面板仍保留。

这些是已实施的预算，不是已测得的浏览器峰值内存。根代理负责修复版本至少 120 秒的真实页面持续运行、模式切换和网格验收；在取得该记录前仍标为待验证。调优参数同步写入公开摘要 `budget`，不会为首页展示下载完整资源包。

**真实手持物显示仍有数据条件：** 当前导出只有方块注册表，没有动态物品数值 ID 表。Viewer 消息需要保留 `qiandeng_chanting:…` 这样的规范物品名；仅传入被原版 mcData 误解的 mod 数字 ID 时，资产映射无法自行恢复身份。离线模型分发通过不等于真实实体手中已经显示，后续截图必须核对这条链。

## 已知回退与边界

57 个显式方块回退按 namespace 分布：Iron 基础库 / Patreon 库 / Iron 本体各 1，Macaw 门 6、百叶窗 10，精妙背包 6，Spawn 19，车万女仆 13。具体方块名和原因见 `compatibility-report.json` 的 `unsupportedBlocks`。许多属于 Java block entity renderer；源码中缺少有效 JSON 几何、动态 loader 或缺少实际引用时不会声称完整支持，也不会静默当空气。

本包不执行 GeckoLib、女仆角色动画、载具实体渲染、Iron 施法特效、YSM 模型或 Java 自定义渲染器。现有网页自身的实体/皮肤/粒子支持保持原有范围。碰撞、遮挡、透明排序、生物群系染色与动画也不是完整 Java 客户端的实现。3 个模组内原版 namespace 覆盖资产被保守忽略并记录，避免不知道资源加载优先级时覆盖原版图集。

仅客户端的 24 个 JAR 主要是优化、Controlify/YACL 与 controls；仅服务端的 8 个 JAR 是 botgate、Chunky、grieflogger、incontrol、numen、numen_act、qiandeng-irons-bridge、spark。精确文件和 SHA-256 见报告 `jars`。没有把缺少可提取资产的库或优化模组误称为渲染失败。

## 鸣人 / 桐人的 Web 形象来源

现有 GLB 与游戏内原生 YSM 是独立资产。来源证明保留于 `manifests/character-source-models.lock.json`；本轮只使用已有用户资产，没有下载新人物模型或绕过授权。

| Web 槽位 | 当前结果 |
| --- | --- |
| `characters/kirito-black-swordsman.glb` | 原文件保留；合法 GLB，92 节点、1 个 skin、11 个动画；SHA-256 `d88ad5267917cd488f6fd035e3920099fa0279dc9adc873e5f51815a2fd8f4a5` |
| `characters/naruto-uzumaki-shippuden.glb` | 从 D `assets/prepared-models/characters` 复制此前审计过的修正版；只将错误首块标记 JSPN 改成 JSON，二进制几何不变；合法 GLB，SHA-256 `404c440b5c60a7539ec1f61492eb1d662b542e34e283bf16f2de0739b055ce33` |
| `characters/sasuke-uchiha.glb` | 继承文件仍有 JSPN 首块错误，本轮不改；报告标明不可解析，应走既有回退 |
| 桐人 statue.bak | 留作旧资产；非正常人物槽位，不当作带动画的新模型 |

服务端 `world/src/mc-modern-viewer.mts:872` 动态列出 GLB/VRM，浏览器再用内置 trusted-avatar 白名单按角色身份选择槽位。**当前 bundle 对 `player` 类型且身份为 Kirito/Naruto 有 skin-only 提前返回**，使用本地 `character-assets/skins/{kirito,naruto}.png`；不会因为目录中存在 GLB 就自动把 Numen 假玩家换成 GLB。符合现有命名 NPC 升级路径的实体才可能使用 trusted GLB。GLB 格式检查通过不等于 GLTFLoader 实际挂载、骨骼动画或视觉姿态已验收。

游戏内两份 YSM 仍是其原来的 `.ysm` / JSON / PNG 模型系统；本轮不转换为 Web，也不声称浏览器能直接播放 YSM。

## 文件与公开摘要接口

产物均位于 `vendor/modern-viewer/mod-assets`：

- `mod-pack.json`：既有渲染 schema，包含 blockstates、models、textures 和可选 itemTextures。
- `mod-blocks-mcdata.json`：既有 minecraft-data 扩展格式，实际状态表。
- `compatibility-report.json`：新审计清单，含 stats、当前 registry 来源/hash、95 个 JAR 来源/hash、失败原因、法杖映射、GLB 状态和限制。
- `compatibility-summary.json`：当前 1,363 bytes 的固定公开投影，生成器自动写入并强制小于 16 KiB；只含 schema、生成时间、stats、jarCounts、注册表时间/hash、两杖规范 ID/status、YSM 不支持标志、limits 和渲染 budget。

既有服务器 `/mod_assets/*.json` 路由可以服务上述 JSON，管理页可固定代理 `/mod_assets/compatibility-summary.json`。摘要不含密钥、玩家聊天、存档角色私有字段或来源路径。完整报告仍含本地相对资产路径、模组文件名和全部模型诊断，主页不必一次全部展示；不要让浏览器为摘要下载约 10.6 MB 的 `mod-pack.json`。本任务未修改管理页或 HTTP 服务代码。

## 已完成验证与复现

```powershell
python -X utf8 tools/build_web_mod_assets.py
python -X utf8 -m unittest discover -s tests -p test_web_mod_assets.py -v
node --test tests/web-asset-bridge.test.mjs
node --check vendor/modern-viewer/modern-viewer.js
```

14 项 Python 测试与 5 项真实 bundle 函数/预算测试全部通过，包含 89,816 状态完整回放、注册表镜像字节一致、模型引用、所有图集 PNG 解码、父子纹理覆盖、路径越界、损坏/动态模型拒绝、动画首帧、两杖实际 dispatch、GLB 结构、公开摘要边界、实际渲染预算及诊断/错误文案保留。JavaScript 语法检查通过。生成器要求 24 小时内的 1.21.1 注册表；模组变化后应由统一维护步骤重新导出再重建，不能复用旧 stateId。

剩余验收是预算修复后的持续运行、真实区块网格、透明模型、物品规范名称传输与截图。本文件不会把这些尚未执行的测试标绿，也不会以首次成功出现画面代替持续运行验收。

## 后续错贴图审计：原版状态编号也发生偏移

2026-09-07 后续反馈“现代画面空白/卡、降级贴图不对”后，又发现独立于内存预算的实际映射缺陷：当前 Spawn 给 `minecraft:note_block` 添加 `SPAWNEPIANO`、`SPAWNKALIMBA`、`SPAWNSITAR` 三个乐器值，共多 150 个状态。原版音符盒范围为 538–1687，现服为 538–1837；此后 958 种原版方块的范围发生偏移。不能把“minecraft namespace”理解成“数字 stateId 没变”。

旧宿主注入只补 `bot.registry.blocksByStateId` 空槽，已有原版槽不覆盖；归一化器因此可能读到错误的原版名字。现代资源包之前只补模组方块，又没有覆盖原版偏移，所以单纯现代 raw 透传也会错。石头、泥土、橡木板、草顶和玻璃的旧图集 UV 已与对应 PNG 逐像素核对，五种可见像素一致；玻璃全透明像素的隐藏 RGB 差异不影响颜色。运行容器和 D 依赖副本的 atlas/blocksStates 文件 SHA 一致，没有证据支持把整张 atlas 过期当成主要原因。

新增 `tools/build_web_state_map.py` 读取实际完整注册表和本地原版 `minecraft-data` 属性定义，生成 `mod-assets/vanilla-state-map.json`。主资产生成器也调用此步骤，后续不能只重建 mod 表而遗漏原版翻译：

- 26,834 个现服原版状态全部纳入；26,684 个按**完整属性**精确对应原版状态，包含 enum 小写、布尔 true-first 和多属性混合基数顺序。
- 150 个新增音符盒状态没有原版同属性表现，明确退到原版音符盒默认状态，并逐条记录原因；不按范围减 150 后误映射成床或其他乐器属性。
- 25,146 个状态数字需转换；3,276 种模组方块保留运行期 ID，且验证与原版 canonical 范围不重叠。
- 文件含 `registrySha256` 与 `canonicalBlocksSha256`，后端应校验前者等于当前导出；后者也已与运行容器文件核对一致。翻译只能在原始服务器流上应用一次，不能对转换后的数字再次套用。

消费契约为 `schema:1`、`minecraft:'1.21.1'`、`mappings:[[serverStateId,canonicalStateId],…]`，外加 `serverModRanges:[{name,minStateId,maxStateId,defaultState}]`、`fallbacks` 和 `stats`。现代模式保留已具备资产的模组 ID；兼容模式才另按模组真实名字简化。运行桥由独立任务接线，本文的资产生成结果不代表服务已部署。

新增 **7 项 Python + 2 项 Node 测试通过**。Node 直接调用已安装的真实 `prismarine-block.fromStateId()` 反解全部目标状态，再逐项比对原名与属性，避免只用生成器自身算法互证。重复 ID、范围交叠、额外乐器回退、楼梯/箱子/铁轨状态、图集坐标均有检查；没有修改本轮渲染 bundle 或运行服务。

`reports/web-scene-palette-samples.json` 提供停车位附近已落盘 region 的 5 个只读样本及固定 `execute if block` 验证命令。例：`(-544,68,863)` 的 spruce_stairs 为 raw 7847 → canonical 7697；`(-546,62,864)` 的 cobblestone_stairs 为 4903 → 4753；`(-545,66,868)` 的 spruce_wall_sign 为 4925 → 4775。数字由已保存 palette 名字和属性匹配当前注册表得到，不能冒称读取了此刻 live observer 内存。抽样只读取已存在 region，未加载世界、移动观察者或访问实体/NPC。

抽样同时发现 `(-544,65,864)` 为 spruce_log(axis=x)，与停车点脚部所在格相同；第一人称是否在实心方块内需运行负责人只读确认。该遮挡可能影响观感，但不能拿它替代上面的真实编号错误。
