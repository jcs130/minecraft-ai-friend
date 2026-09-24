# 千灯纪原创暖木石城镇图纸

这两份原创结构使用 Minecraft 1.21.1 原版方块，无外部素材依赖。结构自身不创建任务、NPC、库存、交易、命令或新施工接口。本次已在独立副本验收并用于主村改造；生产结果见城镇记录，固定选址的一次性施工包另见 [OPERATOR.md](OPERATOR.md)。

| 作品 | X×Y×Z | 列出方块数 | 原生模板 ID | 主要内容 |
| --- | --- | --- | --- | --- |
| 集市庭院 | 13×5×13 | 303 | `qiandeng_town:market-courtyard` | 两座遮阳摊、四格楼梯座椅、六盏暖灯、两组花池、南北三格通路 |
| 庭院住宅 | 13×8×13 | 470 | `qiandeng_town:courtyard-house` | 单层、五张平层床、一扇木门、玻璃窗、低坡尖屋顶、花庭 |

完整尺寸、坐标、材料和 SHA-256 在 [metadata.json](metadata.json)。生成文件 `*.snbt` / `*.nbt` / `datapack/` 由 [generate.py](generate.py) 确定性产生；压缩 NBT 的时间戳固定为零。`site-plan.json` 和两个固定施工包单独维护，生成器不写它们。

## 载体与版本

- `*.snbt` 是可读作者源，根结构为 `DataVersion:3955`、`size`、`palette`（含 `Name/Properties` 的复合标签）、`blocks`（整数 `state`、三整数 `pos`）、`entities:[]`。3955 已从本机 1.21.1 `level.dat` 只读核对。
- 同名 `*.nbt` 是上述内容的 gzip 原生结构 NBT。Numen 将该文件放在服务端的 `schematics/` 后按**不含扩展名**的名字读取；也可复用现有旧目录兜底。这里没有自动安装文件。
- **不要只把本目录的原生 SNBT 复制给 Numen。** 现役 `BlueprintStore.readTag` 对 `.snbt` 调用 `NbtUtils.snbtToStructure`，该函数接收 Minecraft 打包文本格式（字符串 palette 与 `data`），不是这里的原生 compound palette / `blocks`。已经生成的同名 `.nbt` 走 `NbtIo.readCompressed`，同时存在时 Numen 优先选它；无需改读取器。
- `datapack/pack.mcmeta` 使用 `pack_format:48`，模板位于 1.21.1 的单数目录 `data/qiandeng_town/structure/`。其 NBT 字节与根目录同名文件完全一致。它仅含模板，不含函数、load/tick 标签或执行命令。

在**独立存档副本**中安装该数据包并正常加载后，可由已有管理员入口使用 `place template qiandeng_town:market-courtyard X GROUND_Y Z` 或 `place template qiandeng_town:courtyard-house X GROUND_Y Z` 预演。此处为说明，不是已执行回执。原生命令不接受本目录 SNBT 直接当模板资源。

## 原点、地面与通行

未旋转时，局部 `(0,0,0)` 是西北角的**地面方块**；`+X` 向东，`+Z` 向南。地面顶面和角色脚底在局部 Y1。例如要让居民站在世界 Y71，应以 `GROUND_Y=70` 放置。底层只厚一格，没有自动支柱、地形整平、清空或地下开挖。整个包围盒及门外接路必须在副本检查，坡度/高差由外部现场方案处理。

集市中心 X5..7、Z0..12 的 Y1..3 全部省略，形成三格宽贯通主路。摊位在两侧，前台靠主路，灯和座椅不占这条主路。楼梯仅作座椅造型，没有自动坐下逻辑。

住宅主体墙面 X2/10、Z1/9，前庭在南侧 Z10..12，屋檐范围 X1..11、Z0..10。外门位于 `(6,1,9)`，门外入口为 `(6,1,12)`。室内中央 X5..7、Z2..8 净宽三格，普通室内行走处 Y1..3 净空，床头脚上方 Y2..4 净空；灯在中央 Y4，高横梁在 Y5。屋顶为云杉半砖渐升斜坡，最高占用 Y7；没有第二层居住面或上下铺。

所有床朝北，脚部到头部是 `Z-1`：

| 床 | 床脚 | 床头 |
| --- | --- | --- |
| 1 | (3,1,4) | (3,1,3) |
| 2 | (4,1,4) | (4,1,3) |
| 3 | (8,1,4) | (8,1,3) |
| 4 | (9,1,4) | (9,1,3) |
| 5 | (3,1,7) | (3,1,6) |

木门下半 `(6,1,9)`、上半 `(6,2,9)`，两半均 `facing=south`、`hinge=left`、`open=false`、`powered=false`。五床都能从前庭经可打开的原版木门步行到相邻格；此为**空地静态通路**检查，不代表现存地形中的寻路和床认领已验收。

## 保留现状的边界

图纸没有 `air`、`cave_air` 或 `void_air`，没有任何 block-entity NBT，也没有实体。省略的格子不会主动清空，因此原有障碍同样不会自动消失；既有箱子、床、工作站和地标仍须逐格排除冲突。

默认施工约定是**保存现有内容，冲突先拒绝并重新选址**。它依赖施工前检查；静态 NBT 自身不能施加不覆盖策略。

- 原版管理员 `place template` 会覆盖模板**明确列出**的目标格。权限等级不等于已获得覆盖已有居民设施的许可，也没有自动回滚。
- 现役 Numen `BlueprintTool` 使用 `ReplaceMode.REPLACE_EMPTY`。已从源码及实际 JAR 字节码核对：它的含义是“允许替换现存方块，且显式 air 也可清场”，**不是只填空格**。本图无 air 可避免显式清场，但列出的格仍可能替换非空块；原生权限、物资与任务检查继续执行。
- Numen 枚举中保留硬方块的模式叫 `DONT_REPLACE`，现役 blueprint 工具未暴露该选择。本批资产不改变工具或保护区权限，不承诺它尚未提供的保留模式。

本轮保留主城区所有容器、既有床/工作站及高空结构；具体选址、道路和恢复方案见项目城镇计划。不能通过模板数量、床位理论容量或构建任务 completed 推断居民已认领床、贸易已运行或 Agent 已获施工授权。

## 材料清单

下表是等价物品数；床的头脚合计一张床、门的上下合计一扇门，双半砖折为两个半砖。`metadata.json` 同时保留实际方块格数。草方块的获得方式、可替代材料和 Numen 实际消耗必须由原生预览核实；这里不是已经备齐库存的证明。

| 原版物品 | 集市 | 五床住宅 |
| --- | ---: | ---: |
| `stone_bricks` | 125 | 69 |
| `mossy_stone_bricks` | 12 | 7 |
| `smooth_stone` | 26 | 8 |
| `stone_brick_slab` | 6 | 4 |
| `oak_planks` | 0 | 147 |
| `oak_slab` | 36 | 0 |
| `spruce_planks` | 6 | 0 |
| `spruce_log` | 0 | 51 |
| `spruce_slab` | 40 | 131 |
| `spruce_fence` | 30 | 4 |
| `spruce_stairs` | 4 | 0 |
| `spruce_door` | 0 | 1 |
| `glass` | 0 | 36 |
| `white_bed` | 0 | 5 |
| `lantern` | 6 | 3 |
| `grass_block` | 6 | 4 |
| `poppy` | 4 | 2 |
| `dandelion` | 2 | 0 |
| `oxeye_daisy` | 0 | 2 |

## 离线维护与验证

依赖 Python 3.11+、`nbtlib`；本机已在固定 Linux 镜像 `sha256:45dc7f061c09489b7d36d5b1499b830a3b14176835c0bc9afaa233d60df2299f` 内验证，网络关闭，仅挂载本资产目录。生成器不读取世界文件、不运行 Minecraft 命令。

```text
python generate.py
python validate.py
python -m unittest discover -s . -p test_assets.py -v
```

12 项离线回归覆盖：实际文件解析/压缩往返/数据包同字节/哈希和材料一致性；五床入口可达；三格市场通道；重复位置、越界、无效状态、非原版及容器/air/命令方块、实体或 block NBT、孤立床/门、堵路、低床顶的拒绝。验证不会写游戏状态。

还需独立副本验收：原版模板载入和逐块读回、现有地形/地下/高空设施前后比对、村民实际寻路与 POI 认领、照明和屋顶外观；如未来使用 Numen，再验证实际材料账和权限回执。不能将以上静态检查当作这些效果已完成。
