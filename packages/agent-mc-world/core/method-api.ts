/** On-demand contracts for the program SDK; native primitives retain their own guide. */
import { nativeApiHelp } from './method-mineflayer.ts';
import { METHOD_CAPABILITIES_HELP } from './method-capabilities.ts';
import { adaptiveDivingDecision } from './diving-budget.mjs';

const SDK_API = Object.freeze({
  authoring: '可以直接写新的 JavaScript async 函数体，不必等待现有脚本提供所需动作。'
    + '保持按键、按实际读数计算、条件分支或重复编排适合写成有界方法；一次普通动作仍可直接用 mc_do。'
    + '先 library:{op:"list",query:"当前目的"} 检索本作用域的小索引；没有适用方法就按 api:"index" 和具体原生方法帮助构造候选。'
    + '例如同一程序内持续蹲走：await bot.setControlState("sneak",true); await bot.setControlState("forward",true); '
    + 'try { await bot.waitForTicks(20); return await bot.read("entity.position"); } finally { await bot.clearControlStates(); }。'
    + '按键跨 await 保持，正常结束/取消/超时释放；先核验支撑、净空、方向和当前身体任务，再按反馈调整。示例只是维护者资料，不是已学会的动作。'
    + '\n积累：{name:"method-id",code:"候选源码",validate:true}→{runId}读 validated；'
    + '{library:{op:"save",id:"method-id",code:"同一源码",description:"目的、参数与结果字段",conditions:["适用条件和失败边界"],parent:null,validationRunId:实际校验编号}}。'
    + '保存返回 reference，再 {procedure:reference,params:{...}} 显式执行；可用 waitMs 等同一运行，不能因等待超时重新发动作。'
    + '\n组合：save 可带 dependencies:{alias:已有reference}，代码 await methods.run("alias",params)。只解析精确子版本；同一身体和预算，不复制整段源码，不随子方法新版本自动改变父方法。'
    + '修订先 read 当前候选 revision，save 的 parent 填它；已有选择继续指向旧版，直到你明确采用新版本。'
    + '\n核验：终态给 executionId。{library:{op:"evidence",id:"method-id",executionId:"原UUID"}}读摘要，加 call:实际编号 展开原始 SDK 回执；跨重载仍能按 UUID 读。'
    + '比较原目标、前后位置/生命/方块/库存和外部回执，不用 return {ok:true} 或 completed 代替净变化。'
    + '{library:{op:"review",id:"method-id",revision:"实际版本",executionId:"原UUID",outcome:"achieved|not-achieved|unknown",assessment:"核验依据",context:"场景/样本边界",measurements:{"distance-blocks":实际数值或null},counterexamples:["失败/不适用条件"]}}。'
    + '语法回执不能作为执行复盘。你的评估与原回执分开保留，不自动证明因果或长期改善。'
    + '\n采用/回退：{library:{op:"adopt",id:"method-id",revision:"已评估版本",reviewId:"复盘UUID",expectedAdopted:null,reason:"选择理由"}}；'
    + '已有选择时 expectedAdopted 填其 revision。以后 list 返回 selected.reference，核对本次前提后显式复用。'
    + '失败也保留回执与反例，改源码并另存父版本；候选仍可显式试用，不因未采用而禁止运行。'
    + '只有下一次相似场景实际检索、采用并得到可比较的世界净变化，才有复用/改善证据；不为学习凑次数制造危险或打断伙伴。',
  'mc.capabilities': METHOD_CAPABILITIES_HELP,
  'diving-budget': '维护者编写的纯计算参考代码，不是已学会的方法、不执行身体动作。'
    + '可在 mc_script 中校验/改写。params: samples（本次 bot.read("breathing") 的样本）, returnSeconds（实测返程秒数）, '
    + 'reserveSeconds, minHealth, sampleMaxAgeMs（调用者选择的新鲜度容忍值）, nowMs?（默认当前时间，仅离线回放才覆盖）。'
    + '只用最后连续的同一 observationId/实体/维度/epoch 水下段；旧读数、换气和未知身份不能证明还能继续。'
    + '\n```js\n' + adaptiveDivingDecision + '\n```',
  entities: 'Mineflayer: await bot.read("entitySnapshot") returns {sampledAt,source,dimension,coverage,availability,self,entities,players}. '
    + 'entities is keyed by entity id and players by online name. Entries are detached, read-only observations, not live bot objects. '
    + 'await bot.read("entity"), await bot.read("entities") and await bot.read("players") read the corresponding fresh projection. '
    + 'Online does not mean nearby; a tracked entity is not proof of line of sight. Compare positions yourself and preserve sampledAt. availability:false means the corresponding source is unavailable, not an empty world. '
    + 'Synchronous bot.entity/bot.entities/bot.players are unavailable in the isolated worker; never infer an empty world from that TypeError.',
  work: 'mc_script 的内置工作脚本（非 mc 对象方法）：routine:{op:"list"} 查看目录；'
    + 'routine:{op:"read",id:"farm_harvest"} 读取参数 schema、源码、版本与适用条件。'
    + 'routine:{op:"run",id},params:{...} 显式执行，返回 runId 后继续等 minecraft.method 终态或按 runId 查询。'
    + 'farm_harvest 收割补种；gather_logs 定点采木；deposit_surplus 保留指定数量并存余料；restock 补至目标随身数量。'
    + 'navigate_route 依次走多路点；swim_to 短程三维游泳（非水下A*）；flight_route 使用已有服务端权限分段飞行。'
    + 'swim_route 在已加载水体内按氧气预算三维绕障；ride_route 串联点名实体ID的驾乘路点；portal_route 串联并核验跨维度穿门。'
    + '所有坐标为绝对坐标并要求 dimension；最多8格/物种，120秒；现有单写者队列、保护、取消/死亡/断线收尾保持。'
    + '运行结果含 outcome/goalCompleted/reason/remaining/records/inventoryDelta；completed 脚本不等于工作成功。'
    + '停止或部分完成后先核验 remaining 的现场，不自动重放；这不是后台 NPC 自主循环。',
  'mc.state': 'await mc.state(): {sampledAt,connectionGeneration,snapshot,flight,movement,lastSwim,queue,temporaryScaffolds,combatActive,combat,method}. '
    + 'movement contains self-local feetWet/headWet/bodyWet (boolean|null), raw oxygen (0..20|null), yaw/pitch (native radians|null), onGround and vehicleAttached. Unknown oxygen is not replaced with 20; dry-land oxygen may be a stale reading. '
    + 'snapshot can be null; position/dimension/health/food/inventory/equipment are under snapshot. '
    + 'lastSwim is the last swim action report for this connection (historical, with its own taskId/time), not a live assertion that the body remains at that position. '
    + 'No block scan is performed. Missing readings are unknown. Preserve sampledAt and connectionGeneration when comparing observations.',
  'mc.do': 'await mc.do(steps): {accepted,taskId?,kind,done,receipt,steps?,state}. '
    + 'Waits for this group\'s executor terminal, unlike the mc_do tool which returns on admission. '
    + 'Rejected groups have accepted:false, done:false, kind:"rejected" and no executed steps. '
    + 'Executed steps are {step,outcome,why,detail?}; step is one-based; outcome is ok/noop/fail/skip/partial/cut; why is string|null. '
    + 'why is a short preview; detail:{text,chars,truncated} retains the bounded original reason and recovery condition. Inspect the original SDK call for detail; compact trace summaries omit it. '
    + 'There is no steps[n].done or steps[n].receipt. Read the group receipt for the actual operation and state for the fresh observation. '
    + 'done:true and outcome:"ok" certify the requested operation, not your program\'s declared objective or a new world change. '
    + 'A successful right click can leave blocks and inventory unchanged. use without item explicitly uses an empty hand; it does not infer an item from the program name or previous equip. '
    + 'For a known local postcondition, existing steps accept expect:{block:"<id>",at:[x,y,z]}, '
    + 'expect:{has:{item:"<id>",count:n}}, expect:{holding:{item:"<id>"}}, or expect:{near:[x,y,z],within:n}. '
    + 'These test current state, not a delta: an already-satisfied condition is not evidence that this action changed it. '
    + 'For net progress, compare relevant before/after block or inventory readings yourself; keep unknowns unknown. '
    + 'Server transactions still need authoritative replies. Expand mc_script {runId,call} for the complete task result before saving a claim.',
  'mc.flightPlan': 'await mc.flightPlan(args): the same read-only geometry and budget preview as mc_flight_plan. '
    + 'It does not move, cast, grant permission or prove arrival. Read mc_flight_plan schema for arguments; execution revalidates geometry and permission.',
  diving: 'Mineflayer 潜水程序：await bot.read("breathing") 按需取带采样/更新时刻的氧气、生命、浸水状态、位置与速度。'
    + '浸水按实际眼高和已加载流体高度读取；eyeHeightSource=standing-default 时是站姿默认眼高。控制工具不再用固定氧气 6 的阈值禁止下潜。'
    + '在同一原生程序中 await bot.setControlState("jump",false) 接管输入，await bot.waitForTicks(n) 和连续读取期间保持；结束/取消会释放。自动踩水与防溺水共用 reflex.antiDrown 开关；关闭后不自动上浮、找岸或冻结任务，手动上浮仍可用。启用时危急环境接管仍可撤销程序，程序结束后也可能恢复踩水。'
    + '按实际时间差比较多次读数；headWet=true 且有多次氧气递减才估计消耗率，读数不变或缺失不等于无限氧气。生命下降和回复分别留证据，不以回血抵消伤害。'
    + '返程预算=已核验呼吸点路线耗时+实际上浮/横移耗时+控制延迟与不确定性余量；剩余氧气秒数=当前氧气/实测保守消耗率。'
    + '预计返程时间接近氧气余量、生命余量不足、通路变化或读数失效时，脚本自行决定返程；不以入水或固定水下秒数直接判定必须上浮。'
    + '先观察上方/返程通路和呼吸点，低顶不能按垂直距离当上浮时间。仅凭跳跃输入、程序结束或头出水不证明登岸/目标完成。'
    + '既有 surface/防溺水是应急兜底，不是完整潜水规划器。原生身体程序取得队列后不要嵌套 mc.do 等待自己的身体；用原生按键并在终态后核验。'
    + 'api:"diving-budget" 按需读可改写的预算参考；维护者资料不是已学会的方法。由 Agent 自己构造、校验、保存版本，记录实际效果/失败边界，下次检索后再评估复用。',
  'mc.swimPlan':'await mc.swimPlan({at:[absoluteX,feetY,absoluteZ],reserveOxygen?:6..16}): read-only loaded-water A* with collision and oxygen budgeting. '
    +'Returns {schema,sampledAt,from,at,complete,reason,waypoints:[{at,breathe}],expanded,planningMs,estimatedMs,reserveOxygen,terrainSource,unknownCells}. '
    +'Does not move, reveal hidden material identities, guarantee arrival or certify future air refills. Execute swim skill through mc.do; read lastSwim for actual controls, replans and elapsedMs.',
  methods: '通过 mc_script 工具操作自己的方法库（不是 mc 对象的方法）：'
    + 'api:"authoring" 给完整编写、组合、执行、复盘和采用路径。'
    + '先 library:{op:"list",query:"关键词",limit:8} 找适用条件，再 library:{op:"read",id:"method-id"} 读取源码/版本。'
    + '编写或修改后提交 {name:"method-id",code:"…",validate:true}，再用 {runId} 等待 validated；校验不执行动作。'
    + '保存 {library:{op:"save",id:"method-id",code:"同一源码",description:"目的",conditions:["适用条件/失败边界"],parent:null,validationRunId:1}}。'
    + '新建 parent:null，修订 parent 必须是 read 返回的当前 revision，冲突先重读；作者、时间、源码哈希和父版本自动保留。'
    + 'dependencies:{alias:已有reference} 组合固定子版本，await methods.run("alias",params) 共用身体与预算；父方法不会自动跟随子方法的新版本。'
    + '保存不安装、不执行；用 {procedure:保存返回的reference} 显式运行，旧 reference 可回退。'
    + '读取 runId 并按 call 展开实际 SDK 终态，再比较位置/方块/库存净变化。只把有证据的适用性记入 mc_memory 或宿主记忆，记录版本和失败条件。'
    + '下次先检索再复用；程序结束不等于方法有效。运行保留身体占用、取消清理和资源限额，不开放任意文件/网络/引擎源码。'
    + '核心库的 procedure 原执行回执跨重启保留；library evidence 按 executionId/call 读，review 保存明确的结果/场景/反例，adopt 选择已评估版本供后来显式调用，失败候选不覆盖已选择版本。'
    + '宿主的 procedure_find 可能是另一套人物/跨World库；本游戏库以 mc_script library 为准，不把一处无命中当作另一处也为空。'
    + '库按服务器与账号隔离；有 dataDir 才跨重启持久化，persistent:false 时须由宿主另存。每库128方法、每方法64版本，list最多20项，源码按需读。',
  building: '临时垫脚由核心记录实际放置证据，当前事实和 await mc.state().temporaryScaffolds 持续列出待办。'
    + '自行搭临时支撑用 build 的 material/on/anchors 形态并加 temporary:true；blueprint 形态是作品，不能整体标为临时。'
    + '用完先到稳定地面，再 cleanup；dryRun:true 只查。安全的移动/采集/施工收尾也会做有限清理；仍承重、够不到、缺权限、来源失效的保留并说明。'
    + '不能把旧地形猜成自己的垫脚。重连后来源连续性丢失的只作待核验，不能据此自动拆。'
    + '建造先定用途/尺度/入口，蓝图回执给图内净空与外观指标（不是美观评分或现场事实）；以 observe sites/voxels/rays 检查落点、支撑和净空，图纸原点与站位分开。'
    + '完工比较实际方块，从常用视角看比例、主辅材、立面与屋顶并修订。没有图像就明确外观未验证。'
    + '收到路径内部几何错误时保存原路径/高度和读数，改走实测台阶或可达路线；不要重复同参尝试，也不要把单次失败写成永久不可达。',
});

export function methodApiHelp(name: string): string {
  if (name === 'index') return `程序 SDK（按需用 api:"mc.do" 等读取）：${Object.keys(SDK_API).join(', ')}\n${nativeApiHelp('index')}`;
  if (Object.hasOwn(SDK_API, name)) return SDK_API[name as keyof typeof SDK_API];
  return nativeApiHelp(name);
}
