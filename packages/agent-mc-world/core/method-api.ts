/** On-demand contracts for the program SDK; native primitives retain their own guide. */
import { nativeApiHelp } from './method-mineflayer.ts';

const SDK_API = Object.freeze({
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
    + 'Executed steps are {step,outcome,why}; step is one-based; outcome is ok/noop/fail/skip/partial/cut; why is string|null. '
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
  'mc.swimPlan':'await mc.swimPlan({at:[absoluteX,feetY,absoluteZ],reserveOxygen?:6..16}): read-only loaded-water A* with collision and oxygen budgeting. '
    +'Returns {schema,sampledAt,from,at,complete,reason,waypoints:[{at,breathe}],expanded,planningMs,estimatedMs,reserveOxygen,terrainSource,unknownCells}. '
    +'Does not move, reveal hidden material identities, guarantee arrival or certify future air refills. Execute swim skill through mc.do; read lastSwim for actual controls, replans and elapsedMs.',
  methods: '通过 mc_script 工具操作自己的方法库（不是 mc 对象的方法）：'
    + '先 library:{op:"list",query:"关键词",limit:8} 找适用条件，再 library:{op:"read",id:"method-id"} 读取源码/版本。'
    + '编写或修改后提交 {name:"method-id",code:"…",validate:true}，再用 {runId} 等待 validated；校验不执行动作。'
    + '保存 {library:{op:"save",id:"method-id",code:"同一源码",description:"目的",conditions:["适用条件/失败边界"],parent:null,validationRunId:1}}。'
    + '新建 parent:null，修订 parent 必须是 read 返回的当前 revision，冲突先重读；作者、时间、源码哈希和父版本自动保留。'
    + '保存不安装、不执行；用 {procedure:保存返回的reference} 显式运行，旧 reference 可回退。'
    + '读取 runId 并按 call 展开实际 SDK 终态，再比较位置/方块/库存净变化。只把有证据的适用性记入 mc_memory 或宿主记忆，记录版本和失败条件。'
    + '下次先检索再复用；程序结束不等于方法有效。运行保留身体占用、取消清理和资源限额，不开放任意文件/网络/引擎源码。'
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
