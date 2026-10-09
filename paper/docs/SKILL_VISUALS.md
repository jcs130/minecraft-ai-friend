# 技能粒子编舞与粒子工坊接入

内容 ID：`skill_visuals_v1`。部署版本与核验记录以 [维护记录](OPERATIONS.md) 为准。

## 玩家怎样看到

沿用现有技能命令、罗盘、法杖、刻印和资格。真实施法成功时才播放新增编舞，标题、音效、技能事件与原资源规则继续使用原入口。粒子只表现技能风格；图案大小不代表实际伤害、治疗、探测或无敌范围。

| 技能 | 视觉设计 |
| --- | --- |
| 突刺、弧光斩、步法斩、剑气 | 白蓝短斩痕、宽弧、青绿落点斩、前方剑气线 |
| 双剑觉醒、守护阵、村庄誓约 | 蓝金交错斩痕、金色护盾、绿金盾环 |
| 星芒箭、奥术飞矢 | 命中位置星旋与连线、紫色奥术螺旋 |
| 霜环、霜寒束缚、焰浪、炎流 | 蓝白六臂冰晶、冰屑、橙金或红金扇形火浪 |
| 圣愈、范围治疗、抚愈、高阶圣愈 | 绿色莲瓣、扩大绿金花阵、粉绿恢复、金阵与上升光柱 |
| 飞行、跃空、羽落、夜视 | 白蓝羽翼、风翼、白羽、双眼光纹 |
| 归乡、传送点与支援传送、闪现 | 金色归途螺旋、紫蓝星环、短促星隙 |
| 探敌、探矿 | 向外扩散的青蓝探测环、翠金矿晶；原轮廓和持续路径引导保留 |
| 星尘、烟花、造物、远程箱 | 工坊导出的六芒星、粉金星爆、金色构型、紫色立方体 |

当前配置 36 个独立风格绑定，覆盖基础及战法牧技能的成功路径，并包括远程储物。支援传送复用传送术效果，造物配方统一归入 `conjure`。

全部使用原版粒子包，不要求 Agent、Java 或基岩安装客户端模组。实际附身 Eye 直接收到一份附近粒子，避免再经旧粒子镜像重复转发。Geyser 对 dust/transition、冰雪、火焰等已有映射：[官方映射](https://github.com/GeyserMC/mappings/blob/master/particles.json)。基岩的颜色变化、粒子材质和尺寸可能与 Java 不完全相同；协议验收不代替手机/Xbox画面验收。

## 热运营

文件：`plugins/AgentFriend/skill-visuals.yml`。

```text
mycli admin visuals audit
mycli admin visuals reload
mycli admin visuals preview <在线玩家> <技能ID>
```

上述维护入口仅服务器控制台/RCON可用。preview 只播放粒子，不施法、不扣魔力、不发成功事件、不推进新手任务或委托；超额会返回 throttled。玩家用 `/mycli visuals` 查看只读状态，`/mycli explain visuals` 查入口说明。技能操作仍按原命令和本人状态完成。

修改配色、图案、时长和预算后可热加载，不必重启。完整候选配置先校验，任何错误保留上一份可用配置；在途动画持有旧图层快照。`enabled: false` 关闭本轮新增编舞，不关闭技能本身和原有命中/路径提示。启动时磁盘配置损坏会报告错误并用内置安全默认值，不覆盖损坏文件。

每个效果声明 `skills`、`anchor`（caster/target/beam）、`duration-ticks`、`interval-ticks`、`layers`。图层支持 ring、helix、lotus、star、snowflake、fan、wings、crescent、shield、diamond、cube、beam、eyes、points。颜色 `#RRGGBB`；DUST 可以随动画由 color 变为 color-end，其他原版粒子保持原生颜色。成长等级仅小幅增加视觉尺寸，不扩大实际判定。

默认：24格内、最多12个附近连接（优先施法者和实际附身Eye）、最多32段动画、每人同时2段、全服每tick256次粒子投递、每连接每tick64次。硬上限：32格/16连接/48段/每人3段/全服512/每连接96；每段最多48tick、16帧、3图层、每帧64点。持续高tick耗时时减半投递预算。超额跳过粒子，保留真实施法及原文字回执，不排长队。所有编舞共用一个主线程计时器，不创建装饰实体，不扫描或加载区块，不使用force覆盖客户端粒子设置。

预算只统计新增编舞；原命中、探矿路径、药水或其他插件粒子仍由各自机制管理。`MC_VISUALS` 提供 admitted/dropped/packets/throttled/errors/active 和预算；不是玩家任务完成证据。

## 使用用户指定的粒子工坊

项目：[LanLin225/-](https://github.com/LanLin225/-)，本轮核对提交 `cf23babfcec97670b4e53df660c428df92e1e09a`。实际项目为单文件浏览器设计器，能导出 Fabric等客户端代码以及原版 `.mcfunction`；不是Paper插件。项目 LICENSE 为AGPL-3.0（README的GPLv3文字与之不同，以LICENSE为准）。工具本体独立使用，没有将其JavaScript代码合并到AgentFriend；本插件独立渲染图形，导入只读坐标和粒子参数。

1. 本机打开该项目的 `网页化粒子工具.html`，选择图案、少量点和颜色。
2. 导出选择 **Minecraft Java 1.20.6 → 命令方块/数据包函数**，下载 `.mcfunction`。本服不安装循环命令方块来播放。
3. 用仓库标准库转换器读取完整导出（自动取“方案二”精确坐标），例如：

```powershell
python paper/ops/import-particle-studio.py particles.mcfunction --skill starlight --output starlight-profile.json --max-points 32
```

4. 输出是JSON对象，也可按YAML读取。合并到 `effects` 下，并移除旧效果对同一技能的绑定；保留原预算和其他效果。重复绑定会拒绝加载，不会悄悄覆盖。
5. 隔离服先reload和preview，确认颜色、坐标、粒子预算，再将同一配置送到正式服并reload。

转换器不执行任何命令。只接收精确单点粒子、施法者周围±8格、最多4096个输入点、最多3组参数，按预算均匀抽样为最多64点/每层48点。不支持的新版粒子、复杂目标、绝对坐标、非粒子命令和超大文件会拒绝；输出文件已存在也拒绝覆盖。客户端专用贴图和脚本不会导入。

本轮星尘术实际使用该固定提交的 `makeShape(star6)` 与 `cmdExact(...1.20.6)` 导出，再经转换器导入；原始场景和导出保留在 [示例目录](../plugins/AgentFriend/examples/particle-studio/studio-scene.json)。从真实工具产出的32点六芒星播放，服务器再按本插件统一预算做旋转与扩散。

## 回退

仅图案不合适：恢复之前的 `skill-visuals.yml` 并执行 visuals reload。代码问题：按现有维护门禁正常停服、完整E/F备份、恢复0.4.4 JAR并移除0.4.5；旧版不读取新特效配置。无需覆盖世界或玩家技能账本。维护预览与配置编辑不授予学习资格、不重置冷却、不花技能点。
