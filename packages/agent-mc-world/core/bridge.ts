import { loadViewerRelay } from './relay-port.ts';
/**
 * 管理 Mineflayer 连接、重连和 prismarine-viewer。
 * 重连会替换 bot 实例，World 与执行器须通过 bridge.bot 取得当前实例。
 */
import mineflayer from 'mineflayer';
import pathfinderPkg, { pathfinder, Movements } from 'mineflayer-pathfinder';

// goals 不是 cjs-module-lexer 能静态识别的命名导出,只能从默认导出上取
const { goals } = pathfinderPkg;
import { Vec3 } from 'vec3';
import type { Logger } from './support/host-contract.ts';
import type { RouteProbe, TargetDiag } from './executor.ts';
import type { MinecraftLog } from './log.ts';
import { DEFAULT_BLUEPRINT_MC_VERSION, setBlueprintMcVersion } from './blueprint-registry.ts';
import { DIG_UNCONFIRMED_EVENT, installMineflayerFixes, installOffsetShapes, installPathfinderToolSelection } from './mineflayer-fixes.ts';
import { inventoryReadConfirmed } from './inventory-window-sync.ts';
import { installNavigationBareHand } from './hand-interaction.ts';
import { installDoorWaypointRepair } from './path-waypoints.ts';
import {
  installPathfinderPerf, setDigBackoff, setNoPlaceCells, setProtectedCells, setProtectedPlaceCells,
  setSiteZones, type SiteZone,
} from './pathfinder-perf.ts';
import { BREAK_ACL_CHANNEL, BreakPermissions } from './break-permissions.ts';
import {
  type BlockProtectionPort, type ProtectReply, NearbyProtectionBackoff, holdUnverifiedPathAction,
  selectHeldPathAction, type ProtectAction, type ProtectCell, type ProtectStatus,
} from './protection-port.ts';
import { isGravityBlock, isSpawnAnchorBlock } from './policy.ts';
import { isStableScaffoldMaterial } from './scaffold-material.ts';
import type { ShowTempo } from './show.ts';
import { diagnoseTargetSpace, probeBlockInfo } from './terrain.ts';
import { walkOnlyPath } from './travel.ts';
import { installPartialBlockStartRepair } from './pathfinder-start.ts';

import { watchFlightAbilities } from './flight.ts';
import { trackWindowProps } from './containers.ts';
import { installTreadWater } from './travel.ts';
import { trackMaps } from './map-view.ts';
import { trackDamageSources } from './damage-source.ts';
import { MinecraftAuthentication, protocolVersion } from '../src/client/authentication.ts';
import { installServerLogin } from './server-login.mjs';
import { installMountedLook } from '../src/mounted-look.ts';

export interface BridgeOptions {
  host: string;
  port: number;
  username: string;
  version: string;
  authentication?: MinecraftAuthentication;
  /** Private account configuration, reread for every network connection. Empty disables automatic login. */
  loginConfigFile?: () => string;
  /** prismarine-viewer 网页端口;0=不开 viewer */
  viewerPort: number;
  viewerAssetsDir?: string;
  viewerSpeakerName?: string;
  viewerSpeechSourceId?: string;
  performanceBridge?: import('./relay-port.ts').RelayConfiguration;
  remoteTextures?: boolean;
  log: Logger;
  /** World 日志;不给就不记(合成与放置的包流走它) */
  diag?: MinecraftLog;
  /** 寻路垫脚方块名单(顺序即优先级,空数组=禁垫);spawn 与风格热改时求值 */
  scaffoldBlocks?: () => string[];
  /** 挖/垫代价系数(mc_policy 的 travel 档位);spawn 与设置热改时求值 */
  movementCosts?: () => { placeCost: number; digCost: number };
  /** 当前执行器任务号，供异步物理刻异常与决策链关联。 */
  taskId?: () => number | null;
  /** 本服务端拒绝过的方块持久缓存；无目录时只保存在本次连接。 */
  protectionFile?: string | null;
  /** 由服务器扩展显式配置的按格保护频道。 */
  protectionChannel?: string;
  /** 已绑定蓝图范围，含完工建筑；自动寻路不在范围内挖掘或搭路。每次搜索现取。 */
  blueprintZones?: () => readonly SiteZone[];
  /**
   * 成果登记里的一格(维度已由调用方合上)。寻路器不往登记格自己、也不往它头顶
   * 垫脚搭路,也不把它排进挖掘计划;走不受限。每次候选移动生成时现问。
   */
  workCell?: (x: number, y: number, z: number) => boolean;
  /** 容器 GUI 演出节拍;摄像机没开/演出关着时回 null(craft 用,每次 bot.craft 现取) */
  showTempo?: () => ShowTempo | null;
  /** spawn 完成(含重连后) */
  onSpawn: () => void;
  /** 连接创建后立即接收聊天和欢迎信息；此时实体及背包可能尚未就绪。 */
  onBotCreated?: (bot: mineflayer.Bot) => void;
  /** 同一连接内的死亡重生；连接代次和资源保持不变。 */
  onRespawn?: () => void;
  /** 断线后通知；attempt 为本次断线前连续连接失败次数，连接成功归零。 */
  onDisconnect: (reason: string, willReconnect: boolean, attempt: number) => void;
  /** 连接告警通过 World 事件通道投递。 */
  onAlarm?: (text: string) => void;
  /** 停止期间不创建连接或安排重连。 */
  shuttingDown?: () => boolean;
}

const RECONNECT_DELAYS_MS = [3_000, 10_000, 30_000, 60_000];

const DIG_BACKOFF_TRIES = 3;

const DIG_BACKOFF_MS = 60_000;

interface Cell { x: number; y: number; z: number }

const cellKey = (p: Cell): string => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;

/** 卡住瞬间只读脚边的门状态；不把整片方块快照塞进每轮模型上下文。 */
export function nearbyDoorStates(bot: Pick<mineflayer.Bot, 'entity' | 'blockAt'>): Array<{
  x: number; y: number; z: number; name: string; open: boolean | null; half: string | null;
}> {
  const at = bot.entity?.position;
  if (!at) return [];
  const cx = Math.floor(at.x), cy = Math.floor(at.y), cz = Math.floor(at.z);
  const found: ReturnType<typeof nearbyDoorStates> = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const x = cx + dx, y = cy + dy, z = cz + dz;
    const block = bot.blockAt(new Vec3(x, y, z));
    if (!block || (!block.name.endsWith('_door') && !block.name.endsWith('_fence_gate'))) continue;
    const props = typeof block.getProperties === 'function' ? block.getProperties() : {};
    const open = props.open === true || props.open === 'true' ? true
      : props.open === false || props.open === 'false' ? false : null;
    found.push({ x, y, z, name: block.name, open, half: typeof props.half === 'string' ? props.half : null });
  }
  return found.slice(0, 16);
}

/** 「暂时挖不动」的一格,连同它进退避的时刻 */
interface DigBackoffCell extends Cell {
  since: number;
}

/** 本机端口连续拒连达到此次数时，提示检查服务器是否已启动。 */
const REFUSED_ALARM_AT = 5;
const REFUSED_ALARM_EVERY = 10;
/** 连续连接被拒绝达到阈值后的重试间隔。 */
const REFUSED_DELAY_MS = 120_000;

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
}

/** 路线试算的总超时与单次迭代预算；partial 时继续原搜索。 */
const PROBE_TIMEOUT_MS = 400;
const PROBE_TICK_MS = 60;
const PROBE_WALL_MS = 500;

interface ProbePath {
  status: string;
  /** A* closed set 大小;=1 表示只展开了起点 */
  visitedNodes?: number;
  path: Array<{ x: number; y: number; z: number; toBreak?: unknown[]; toPlace?: Array<{ useOne?: boolean }> }>;
}

/** 最后一次检测到水后禁用疾跑的物理 tick 数；20 tick 约一秒。 */
const SPRINT_WET_TICKS = 40;

const WATER_BLOCKS = new Set(['water', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);

/** 水面附近 isInWater 会逐 tick 变化；检测到水后禁用疾跑 40 tick（约两秒）。 */
function suppressSprintNearWater(bot: mineflayer.Bot, movements: Movements): void {
  let wet = 0;
  // isInWater 由 prismarine-physics 每 tick 写在实体上,prismarine-entity 的类型里没有
  const inWater = (): boolean => Boolean((bot.entity as unknown as { isInWater?: boolean }).isInWater);
  bot.on('physicsTick', () => {
    const feet = bot.blockAt(bot.entity.position);
    const soaked = inWater() || (feet !== null && WATER_BLOCKS.has(feet.name));
    wet = soaked ? SPRINT_WET_TICKS : Math.max(0, wet - 1);
    movements.allowSprinting = wet === 0;
  });
}

/** prismarine-viewer 只用到 mineflayer() 这一个入口 */
interface ViewerModule {
  mineflayer(bot: mineflayer.Bot, opts: { port: number; firstPerson: boolean }): void;
}

/** 上游 viewer.close() 不返回 Promise，关闭后轮询端口是否可绑定，超时记录警告。 */
const VIEWER_RELEASE_MS = 3_000;
const VIEWER_RELEASE_POLL_MS = 50;

/** 端口可绑返回 true(探完即关) */
async function probePort(port: number): Promise<boolean> {
  const { createServer } = await import('node:net');
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, () => srv.close(() => resolve(true)));
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 每代连接登记监听端口、外部进程句柄等资源，失效时逆序关闭。
 * dispose 之后收到的注册立即执行 closer，回收异步启动迟到的资源。
 */
class ResourceBag {
  protected readonly closers: Array<{ name: string; close: () => Promise<void> | void }> = [];
  protected draining: Promise<void> | null = null;
  /** draining 在 dispose 的同步部分完成后赋值；此前由此标记阻止新资源登记。 */
  protected closed = false;

  constructor(protected readonly log: Logger) {}

  get disposed(): boolean {
    return this.closed;
  }

  register(name: string, close: () => Promise<void> | void): void {
    if (this.closed) {
      void this.run(name, close);
      return;
    }
    this.closers.push({ name, close });
  }

  dispose(): Promise<void> {
    if (this.draining !== null) return this.draining;
    this.closed = true;
    const items = this.closers.splice(0).reverse();
    this.draining = (async () => {
      for (const item of items) await this.run(item.name, item.close);
    })();
    return this.draining;
  }

  protected async run(name: string, close: () => Promise<void> | void): Promise<void> {
    try {
      await close();
    } catch (err) {
      this.log.warn(`${name} 关闭失败: ${(err as Error).message}`);
    }
  }
}

export class Bridge {
  protected readonly protection: BreakPermissions;
  protected serverProtection: BlockProtectionPort | null = null;
  protected agentMana: { current: number; max: number } | null | undefined;
  protected _bot: mineflayer.Bot | null = null;
  /** An entity can exist before login/first spawn; it is not yet an operable body. */
  protected spawnedBot: mineflayer.Bot | null = null;
  protected protocolSpawned = false;
  protected serverLogin: ReturnType<typeof installServerLogin> | null = null;
  protected started = false;
  protected stopped = false;
  protected reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  protected reconnectAttempt = 0;
  /** 每次 connect 递增的连接世代；资源和迟到回调均据此判定归属。 */
  protected generation = 0;
  /** 已经作废的最高世代；世代单调作废，一代结束才有下一代。 */
  protected disposedThrough = -1;
  protected readonly bags = new Map<number, ResourceBag>();
  protected readonly disposing = new Set<Promise<void>>();
  protected viewer: { gen: number; url: string; kind: 'modern' | 'basic' } | null = null;
  protected _invSynced = false;
  protected scaffoldComplained = '';
  protected refusedStreak = 0;
  protected liveMovements: Movements | null = null;
  protected aclReplanTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 挖掘失败按格坐标记账；连续失败 DIG_BACKOFF_TRIES 次进入退避，
   * DIG_BACKOFF_MS 后过期。
   */
  protected digFails = new Map<string, { tries: number; lastAt: number; since: number | null; cell: Cell }>();

  protected createProtectionPort(_bot: mineflayer.Bot, _reply: (reply: ProtectReply) => void): BlockProtectionPort | null { return null; }
  protected attachServerProtocols(_bot: mineflayer.Bot, _generation: number): void {}
  protected viewerServerProtocol(): import('./viewer-extension.ts').ViewerServerProtocol | undefined { return undefined; }
  constructor(protected readonly opts: BridgeOptions) {
    this.protection = new BreakPermissions(opts.protectionFile ?? null, `${opts.host}:${opts.port}`);
  }

  /** 服务端明确拒绝破坏时记住真实挖掘格；没有可靠坐标就只记录事件，不乱猜。 */
  noteServerBreakDenied(reason: string): void {
    const bot = this._bot;
    if (!bot) return;
    const target = bot.targetDigBlock;
    const last = (bot as unknown as { cortiLastDigAttempt?: {
      at: number; x: number; y: number; z: number; type: number;
    } }).cortiLastDigAttempt;
    const p = target?.position ?? (last && Date.now() - last.at <= 5000 ? last : null);
    const type = target?.type ?? last?.type;
    if (!p || type === undefined) {
      this.opts.diag?.write({ lane: 'path', event: 'protection-unlocated',
        msg: `服务端拒绝破坏，但没读到这一刻的挖掘格：${reason}`, incident: true });
      return;
    }
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    this.protection.noteDenied(String(bot.game.dimension), x, y, z, type);
    if (target?.position && typeof bot.stopDigging === 'function') bot.stopDigging();
    this.opts.diag?.write({ lane: 'path', event: 'protection-denied',
      msg: `服务端拒绝破坏 (${x}, ${y}, ${z})；寻路以后不再把这格列为可挖`,
      data: { cell: { x, y, z }, type, reason, protection: this.protection.status(String(bot.game.dimension)) },
      incident: true, taskId: this.opts.taskId?.() ?? undefined });
  }

  /** 当前连接的 bot;未连接或重连中为 null。 */
  get bot(): mineflayer.Bot | null {
    return this.connected ? this._bot : null;
  }

  get agentManaState(): { current: number; max: number } | null | undefined {
    return this.agentMana;
  }

  /** 登录后收到窗口 0 的完整清单，且未被不完整容器窗覆盖。 */
  get invSynced(): boolean {
    return this._invSynced && (this._bot ? inventoryReadConfirmed(this._bot) : false);
  }

  get connected(): boolean {
    return this._bot !== null && this.spawnedBot === this._bot
      && (this.serverLogin?.ready() ?? true)
      && (this._bot as unknown as { entity?: unknown }).entity !== undefined;
  }

  get connectionState() {
    return { active: this.started, protocolState: this._bot?._client.state ?? 'closed',
      spawnReceived: this.protocolSpawned, ready: this.connected, reconnects: this.reconnectAttempt,
      serverLogin: this.serverLogin?.detail() ?? { stage: 'disabled', attempted: false, reason: null } };
  }

  /** 连接生命周期已启用；不要求当前已经完成登录。 */
  get active(): boolean {
    return this.started;
  }

  get reconnects(): number {
    return this.reconnectAttempt;
  }

  get viewerKind(): 'modern' | 'basic' | null {
    return this.viewer?.gen === this.generation ? this.viewer.kind : null;
  }

  get viewerUrl(): string | null {
    return this.viewer !== null && this.viewer.gen === this.generation ? this.viewer.url : null;
  }

  /** 已作废代次使用关闭状态的 ResourceBag，迟到资源登记时立即关闭。 */
  protected bagFor(gen: number): ResourceBag {
    const existing = this.bags.get(gen);
    if (existing) return existing;
    const bag = new ResourceBag(this.opts.log);
    this.bags.set(gen, bag);
    if (gen <= this.disposedThrough) void this.disposeGeneration(gen);
    return bag;
  }

  /** 逆序关闭资源；返回值只等待调用时已登记的资源。 */
  protected disposeGeneration(gen: number): Promise<void> {
    const bag = this.bags.get(gen);
    this.disposedThrough = Math.max(this.disposedThrough, gen);
    if (!bag) return Promise.resolve();
    this.bags.delete(gen);
    const done = bag.dispose().finally(() => void this.disposing.delete(done));
    this.disposing.add(done);
    return done;
  }

  /** 等所有在途回收落地:端口释放必须排在新一代绑定之前 */
  protected async settleDisposals(): Promise<void> {
    while (this.disposing.size > 0) await Promise.allSettled([...this.disposing]);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.aclReplanTimer) {
      clearTimeout(this.aclReplanTimer);
      this.aclReplanTimer = null;
    }
    const bot = this._bot;
    this._bot = null;
    this.spawnedBot = null;
    this.protocolSpawned = false;
    this.agentMana = undefined;
    this._invSynced = false;
    this.liveMovements = null;
    this.digFails.clear();
    this.reconnectAttempt = 0;
    this.refusedStreak = 0;
    this.viewer = null;
    if (bot) {
      try {
        bot.quit();
      } catch {
        /* 已断开 */
      }
    }
    this.disposedThrough = Math.max(this.disposedThrough, this.generation);
    for (const gen of [...this.bags.keys()].sort((a, b) => b - a)) {
      await this.disposeGeneration(gen);
    }
    await this.settleDisposals();
  }

  /**
   * 服务器进入 running 时取消退避并立即重连；已连接或正在连接时不操作。
   */
  reconnectNow(reason: string): void {
    if (this.stopped || this._bot !== null) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.refusedStreak = 0;
    this.opts.log.info(`minecraft 立刻重连: ${reason}`);
    this.connect();
  }

  protected connect(): void {
    if (this.stopped || this.opts.shuttingDown?.()) return;
    if (this.aclReplanTimer) {
      clearTimeout(this.aclReplanTimer);
      this.aclReplanTimer = null;
    }
    this.protection.beginConnection();
    const { host, port, username, version, log } = this.opts;
    const gen = ++this.generation;
    for (const old of [...this.bags.keys()]) {
      if (old < gen) void this.disposeGeneration(old);
    }
    this.bagFor(gen);
    log.info(`minecraft 连接 ${host}:${port} as ${username} (${version})`);
    // 蓝图注册表按实际连接的版本走:写死 1.20.6 的话,1.21 上会拿旧表认方块状态与默认属性
    if (protocolVersion(version) && setBlueprintMcVersion(version)) {
      log.info(`蓝图注册表版本已跟随连接版本:${version}(原默认 ${DEFAULT_BLUEPRINT_MC_VERSION})`);
    }
    let bot: mineflayer.Bot;
    try {
      bot = mineflayer.createBot({ host, port, username, version: protocolVersion(version) || undefined,
        ...(this.opts.authentication?.botOptions() ?? { auth: 'offline' as const }),
        logErrors: false });
    } catch (err) {
      log.warn(`createBot 失败: ${(err as Error).message}`);
      this.scheduleReconnect(String((err as Error).message));
      return;
    }
    this._bot = bot;
    bot._client.on('session', session => {
      if (this._bot === bot && this.generation === gen && !this.stopped) this.opts.authentication?.acceptProtocolSession(session);
    });
    bot.once('inject_allowed', () => {
      if (this._bot === bot && this.generation === gen) setBlueprintMcVersion(bot.version);
    });
    // Authentication may finish after the user stopped a pending connection.
    bot._client.on('connect', () => {
      if (this.stopped || this._bot !== bot || this.generation !== gen) bot._client.end('Connection cancelled');
    });
    this.spawnedBot = null;
    this.protocolSpawned = false;
    this.opts.onBotCreated?.(bot);
    let activate = () => {};
    const login = installServerLogin(bot, { server: `${host}:${port}`, username,
      configFile: this.opts.loginConfigFile?.(),
      report: status => {
        log.info(`minecraft authentication ${status.status}`, { username, server: `${host}:${port}`, reason: status.reason });
        if (status.status === 'confirmed') activate();
      } });
    this.serverLogin = login;
    this.bagFor(gen).register('server-login', login.stop);
    this.bagFor(gen).register('flight-abilities', watchFlightAbilities(bot));
    this.attachServerProtocols(bot, gen);
    const protectionBackoff = new NearbyProtectionBackoff();
    let releaseProtectionWalk: (() => void) | null = null;
    type HeldPathAction = { action: ProtectAction; cell: ProtectCell; dimension: string; key: string; querying: boolean };
    let heldPathAction: HeldPathAction | null = null;
    const scheduleProtectionReplan = (): void => {
      if (this.aclReplanTimer) return;
      this.aclReplanTimer = setTimeout(() => {
        this.aclReplanTimer = null;
        if (this._bot === bot && this.liveMovements) bot.pathfinder.setMovements(this.liveMovements);
      }, 75);
    };
    const queryHeldAction = (): void => {
      const gate = heldPathAction;
      const protect = this.serverProtection;
      if (!gate || gate.querying || !protect || this._bot !== bot) return;
      const pos = bot.entity?.position;
      const distance = pos ? Math.hypot(pos.x - gate.cell.x, pos.y - gate.cell.y, pos.z - gate.cell.z) : Infinity;
      // 服务端只接受 16 格内的查询；远处节点绝不能试探性地得到 unknown 后触发重算。
      // 路径已截到改块动作之前；沿这个前缀靠近，不改变整条路线的移动规则。
      if (distance > 15) return;
      gate.querying = true;
      void protect.check(gate.action, gate.dimension, gate.cell).then(() => {
        if (heldPathAction === gate) {
          heldPathAction = null;
          scheduleProtectionReplan();
        }
      }).catch((error) => {
        if (heldPathAction !== gate) return;
        heldPathAction = null;
        this.opts.diag?.write({ lane: 'path', event: 'protection-check-error',
          msg: `寻路保护预检失败:${String(error)}`, incident: true });
        scheduleProtectionReplan();
      });
    };
    bot.on('physicsTick', () => {
      if (heldPathAction) queryHeldAction();
      if (!releaseProtectionWalk || protectionBackoff.active(bot.entity?.position,
        String(bot.game?.dimension ?? 'overworld'))) return;
      releaseProtectionWalk();
      releaseProtectionWalk = null;
      if (this._bot === bot && this.liveMovements) bot.pathfinder.setMovements(this.liveMovements);
      this.opts.diag?.write({ lane: 'path', event: 'protection-walk-end',
        msg: '离开保护密集区域或退避到期，恢复普通寻路规则' });
    });
    this.serverProtection = this.createProtectionPort(bot, (reply) => {
        if (this._bot !== bot || !this.liveMovements) return;
        const resolvedHeldPath = heldPathAction && heldPathAction.key ===
          `${reply.action}|${reply.dimension.replace(/^minecraft:/, '')}|${reply.x},${reply.y},${reply.z}`;
        if (resolvedHeldPath) {
          heldPathAction = null;
          scheduleProtectionReplan();
        }
        if (reply.status === 'allow_likely') return;
        this.opts.diag?.write({ lane: 'path', event: 'agentfriend-protect',
          msg: `服务端保护预检 ${reply.status}: ${reply.action} (${reply.x}, ${reply.y}, ${reply.z}) ${reply.reason}`,
          data: reply.status === 'deny' ? { action: reply.action, status: reply.status, cell: [reply.x, reply.y, reply.z] }
            : { action: reply.action, status: reply.status, cell: [reply.x, reply.y, reply.z], reason: reply.reason },
          ...(reply.status === 'deny' ? { incident: true } : {}) });
        if (protectionBackoff.note(reply, bot.entity?.position) && !releaseProtectionWalk) {
          releaseProtectionWalk = walkOnlyPath(bot);
          this.opts.diag?.write({ lane: 'path', event: 'protection-walk',
            msg: '附近多个方块的破坏权限被拒或暂无法确认，60 秒内只沿现有通路寻路',
            data: { position: bot.entity?.position, reason: reply.reason }, incident: true });
        }
        // 实际 dig/place 的 fresh 预检被拒时，包装器会拒绝操作，上游随即以
        // dig_error/place_error 自己重算。这里再 reset 一次会撞上 equip 窗口的挖掘闩锁。
        if (!resolvedHeldPath && !bot.pathfinder?.isMining?.() && !bot.pathfinder?.isBuilding?.()) {
          scheduleProtectionReplan();
        }
      });
    if (this.serverProtection) this.opts.diag?.write({
      lane: 'path', event: 'agentfriend-protect-ready',
      msg: '千灯纪方块保护预检已接入寻路、挖掘和放置',
    });
    (bot as mineflayer.Bot & { cortiProtectCheck?: (action: ProtectAction, cell: ProtectCell) => Promise<{ status: string; reason: string }> })
      .cortiProtectCheck = this.serverProtection
        ? (action, cell) => this.serverProtection!.check(action, String(bot.game.dimension), cell, true)
        : undefined;
    (bot as mineflayer.Bot & { cortiBreakVerdict?: (block: { position: { x: number; y: number; z: number }; type: number }) =>
      'allowed' | 'protected' | 'unknown' }).cortiBreakVerdict = (block) =>
      this.serverProtection?.verdict('break', String(bot.game.dimension), block.position) === 'deny'
        ? 'protected'
        : this.protection.verdict(String(bot.game.dimension), block.position.x, block.position.y, block.position.z, block.type);
    this._invSynced = false;
    // 包里地图的整张画面服务端只在登录后第一刻推一次,早于 spawn;挂在 spawn 上就只剩增量
    trackMaps(bot);
    trackDamageSources(bot);
    /** 修补须通过插件注入，等待 Mineflayer 的 inject_allowed。 */
    bot.loadPlugin((b) => installMineflayerFixes(b, log, this.opts.diag, this.opts.showTempo));
    bot.loadPlugin(installMountedLook);
    bot.loadPlugin(installOffsetShapes);
    bot.loadPlugin(pathfinder);
    if (this.serverProtection) {
      const protect = this.serverProtection;
      const clearHeldRoute = (): void => {
        heldPathAction = null;
      };
      bot.on('goal_updated', clearHeldRoute);
      bot.on('goal_reached', clearHeldRoute);
      bot.on('path_stop', clearHeldRoute);
      bot.on('path_update', (result) => {
        if (this._bot !== bot) return;
        const dimension = String(bot.game.dimension);
        const gate = holdUnverifiedPathAction(result, bot.entity.position,
          (action, cell): ProtectStatus | null => protect.verdict(action, dimension, cell));
        if (!gate) return;
        const key = `${gate.action}|${dimension.replace(/^minecraft:/, '')}|${gate.cell.x},${gate.cell.y},${gate.cell.z}`;
        const candidate: HeldPathAction = { action: gate.action, cell: gate.cell, dimension, key, querying: false };
        const selected = selectHeldPathAction(heldPathAction, candidate);
        // The new path is already truncated at its first unverified action.
        // Finish the current query before allowing another path update to queue a different cell.
        if (selected !== candidate && selected.key !== key) return;
        if (gate.status !== null) {
          heldPathAction = null;
          scheduleProtectionReplan();
          return;
        }
        if (selected === candidate) {
          heldPathAction = candidate;
          this.opts.diag?.write({ lane: 'path', event: 'protection-path-hold',
            msg: `寻路将改动 (${gate.cell.x}, ${gate.cell.y}, ${gate.cell.z})，先等服务端 ${gate.action} 权限回执`,
            data: { action: gate.action, cell: gate.cell, safePrefix: gate.safePrefix },
          });
        }
        const distance = bot.entity.position.distanceTo(new Vec3(gate.cell.x, gate.cell.y, gate.cell.z));
        if (distance > 15) {
          if (selected === candidate) {
            this.opts.diag?.write({ lane: 'path', event: 'protection-distant-walk',
              msg: `前方 ${Math.round(distance)} 格才需改方块；先走现有通路，接近后再预检`,
              data: { action: gate.action, cell: gate.cell, safePrefix: gate.safePrefix },
            });
          }
        } else {
          queryHeldAction();
        }
      });
    }
    installPathfinderPerf(log);
    (bot._client as unknown as { on(ev: string, cb: (pkt: { windowId: number }) => void): void }).on(
      'window_items',
      (pkt) => {
        if (this._bot === bot && this.generation === gen && pkt.windowId === 0) this._invSynced = true;
      },
    );
    bot._client.on('custom_payload', (packet: { channel?: unknown; data?: unknown }) => {
      if (!this.opts.protectionChannel || packet.channel !== this.opts.protectionChannel) return;
      if (this._bot !== bot || this.generation !== gen) return;
      const result = this.protection.applyPacket(packet.channel, packet.data);
      this.opts.diag?.write({ lane: 'path', event: result ? 'protection-acl' : 'protection-acl-invalid',
        msg: result ? `收到了服务端方块保护清单 (${result})` : '服务端方块保护清单格式不符，未应用',
        data: { channel: packet.channel, result }, ...(result ? {} : { incident: true }) });
      // 一批区块加载只触发一次重算；相同 revision 续租不打断路线。
      if (result === 'changed' && this.liveMovements && !this.aclReplanTimer) {
        this.aclReplanTimer = setTimeout(() => {
          this.aclReplanTimer = null;
          if (this._bot === bot && this.generation === gen && this.liveMovements) {
            bot.pathfinder.setMovements(this.liveMovements);
          }
        }, 75);
      }
    });

    activate = () => {
      if (this.stopped || this._bot !== bot || this.generation !== gen || this.spawnedBot === bot
        || !this.protocolSpawned || !login.ready()) return;
      setBlueprintMcVersion(bot.version);
      this.spawnedBot = bot;
      this.reconnectAttempt = 0;
      this.refusedStreak = 0;
      this.installSpawnGear(bot, gen);
      this.opts.onSpawn();
    };
    bot.on('spawn', () => {
      if (this.stopped || this._bot !== bot || this.generation !== gen) return;
      const wasReady = this.spawnedBot === bot;
      this.protocolSpawned = true;
      activate();
      if (wasReady && login.ready()) this.opts.onRespawn?.();
    });

    const onGone = (reason: string) => {
      if (this._bot !== bot || this.generation !== gen) return;
      this._bot = null;
      this.spawnedBot = null;
      this.protocolSpawned = false;
      this.agentMana = undefined;
      this._invSynced = false;
      this.viewer = null;
      void this.disposeGeneration(gen);
      this.liveMovements = null;
      this.digFails.clear();
      this.serverProtection = null;
      heldPathAction = null;
      releaseProtectionWalk?.();
      releaseProtectionWalk = null;
      const willReconnect = !this.stopped;
      this.opts.onDisconnect(reason, willReconnect, this.reconnectAttempt);
      if (willReconnect) this.scheduleReconnect(reason);
    };
    bot.once('end', (reason) => onGone(String(reason)));
    bot.once('kicked', (reason) => onGone(`kicked: ${JSON.stringify(reason)}`));
    bot.on('error', (err) => {
      this.opts.authentication?.failPending();
      log.warn(`minecraft 连接错误: ${err.message}`);
      this.noteConnectError(err);
    });
  }

  /** 连续 ECONNREFUSED 达到阈值时告警，并延长重连间隔。其他错误重置计数。 */
  protected noteConnectError(err: Error): void {
    const code = (err as NodeJS.ErrnoException).code ?? '';
    if (code !== 'ECONNREFUSED' && !err.message.includes('ECONNREFUSED')) {
      this.refusedStreak = 0;
      return;
    }
    this.refusedStreak += 1;
    const n = this.refusedStreak;
    if (n < REFUSED_ALARM_AT || (n - REFUSED_ALARM_AT) % REFUSED_ALARM_EVERY !== 0) return;
    const where = `${this.opts.host}:${this.opts.port}`;
    this.opts.log.error(`minecraft 连续 ${n} 次被 ${where} 拒连:连接被拒绝`);
    this.opts.onAlarm?.(
      isLocalHost(this.opts.host)
        ? `连着 ${n} 次连不上 ${where},端口上根本没有进程在听 —— MC 服务器没在跑,去控制台的 Minecraft 面板把它启动起来;` +
          '在那之前我进不了游戏,做不了任何事。'
        : `连着 ${n} 次连不上 ${where},对面端口没有进程在听 —— 那台服务器没在跑。`,
    );
  }

  /** 一条连接只装一次的那些东西(寻路器、挖掘退避、viewer);死亡重生不重装 */
  protected installSpawnGear(bot: mineflayer.Bot, gen: number): void {
    const log = this.opts.log;
    installPartialBlockStartRepair(bot);
    installNavigationBareHand(bot);
    installPathfinderToolSelection(bot, log);
    const movements = new Movements(bot);
    movements.canDig = true;
    movements.allow1by1towers = true;
    this.applyTuning(bot, movements);
    this.liveMovements = movements;
    bot.pathfinder.setMovements(movements);
    bot.pathfinder.tickTimeout = 60;
    suppressSprintNearWater(bot, movements);
    installTreadWater(bot);
    trackWindowProps(bot);
    this.installDigBackoff(bot);
    installDoorWaypointRepair(bot);
    this.installPathDiag(bot);
    this.startViewer(bot, gen);
  }

  /** 把垫脚名单与挖/垫代价装到 movements 上;spawn 与风格热改共用 */
  protected applyTuning(bot: mineflayer.Bot, movements: Movements): void {
    const log = this.opts.log;

    /** 寻路单次落差上限 2 格(原版 3 格内摔落不掉血)。 */
    movements.maxDropDown = 2;
    // 上游 parkour 会把屋门边的两格高墙当成捷径，插入 y+1 的跳跃首步；
    // 实际碰撞过不去，反复 reset stuck。普通走路/开门/搭桥仍由 Movements 规划。
    movements.allowParkour = false;

    /**
     * 水路代价:游一步记 1 + 3,往水里跳也受 maxDropDown 约束(上游默认不限高)。
     * 在存档 33 西海台周边取直播里真实下过的 107 对起终点只算不走:成功路线上泡水的路点
     * 139 → 99,没有新增算不出的路,多垫 44 块方块;液体代价取 5 与 3 的结果逐条相同。
     */
    // 上游类型声明漏了 liquidCost,运行时字段在 Movements 上
    (movements as unknown as { liquidCost: number }).liquidCost = 3;
    movements.infiniteLiquidDropdownDistance = false;

    /** 上游 lava 的 diggable=true；额外加入 blocksCantBreak 禁止寻路挖掘。 */
    const lava = (bot.registry.blocksByName as Record<string, { id: number } | undefined>).lava;
    if (lava) movements.blocksCantBreak.add(lava.id);

    // 维度切换只由 transit 发起；普通寻路把传送面与门框当作空间边界。
    const portalBlocks = bot.registry.blocksByName as Record<string, { id: number } | undefined>;
    /** 传送门方块的 id;寻路器不在这些格子里、也不在它们头顶垫脚(末地传送门头顶垫一块就把门盖住) */
    const portalIds = new Set<number>();
    for (const name of [
      'nether_portal', 'end_portal', 'end_gateway',
      'obsidian', 'crying_obsidian', 'end_portal_frame',
    ]) {
      const portal = portalBlocks[name];
      if (!portal) continue;
      if (name === 'nether_portal' || name === 'end_portal' || name === 'end_gateway') {
        movements.blocksToAvoid.add(portal.id);
        portalIds.add(portal.id);
      }
      movements.blocksCantBreak.add(portal.id);
    }

    // 寻路不得挖穿容器、工作站及下列功能方块；取出或拆除须走 take/collect。
    // 上游默认保护名单只有 chest，需在此补齐。
    const blocksByName = bot.registry.blocksByName as Record<string, { id: number } | undefined>;
    for (const name of [
      'chest', 'trapped_chest', 'barrel', 'ender_chest',
      'furnace', 'blast_furnace', 'smoker', 'crafting_table',
      'bookshelf', 'enchanting_table', 'cake',
      'brewing_stand', 'lectern', 'smithing_table',
      'anvil', 'chipped_anvil', 'damaged_anvil',
      'beacon', 'cauldron', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron',
    ]) {
      const b = blocksByName[name];
      if (b) movements.blocksCantBreak.add(b.id);
    }

    /** 启用开门并禁止挖门；状态通行判据由 pathfinder-perf 的 applyDoorState 提供。 */
    movements.canOpenDoors = true;
    for (const name of Object.keys(blocksByName)) {
      if (!name.endsWith('_door') && !name.endsWith('_fence_gate')) continue;
      const b = blocksByName[name];
      if (b) movements.blocksCantBreak.add(b.id);
    }

    // 床与 respawn_anchor 禁止被寻路挖穿；显式拆除仍走执行器确认路径。
    for (const name of Object.keys(blocksByName)) {
      if (!isSpawnAnchorBlock(name)) continue;
      const b = blocksByName[name];
      if (b) movements.blocksCantBreak.add(b.id);
    }

    const wanted = this.opts.scaffoldBlocks?.();
    if (wanted) {
      /** scafoldingBlocks 使用物品 ID；1.20.6 的物品和方块 ID 不同，须查询 itemsByName。 */
      const byName = bot.registry.itemsByName as Record<string, { id: number } | undefined>;
      // 重力方块失去支撑后会下落，不能作为寻路器按固定落点记账的垫脚料。
      const heavy = wanted.filter((n) => isGravityBlock(n));
      const usable = wanted.filter((n) => isStableScaffoldMaterial(bot.registry, n));
      const shaped = wanted.filter((n) => !isGravityBlock(n)
        && byName[n] !== undefined && !isStableScaffoldMaterial(bot.registry, n));
      const complaints: string[] = [];
      if (heavy.length > 0) {
        complaints.push(`scaffoldBlocks 里的重力方块不收(垫下去会自己掉,垫不住): ${heavy.join('、')}`);
      }
      if (shaped.length > 0) {
        complaints.push(`寻路垫脚需要完整稳定立方支撑，忽略非完整支撑材料: ${shaped.join('、')}`);
      }
      const ids = usable.map((n) => byName[n]?.id).filter((id): id is number => id !== undefined);
      const unknown = wanted.filter((n) => byName[n] === undefined);
      if (unknown.length > 0) complaints.push(`scaffoldBlocks 里不认识的方块名被忽略: ${unknown.join('、')}`);
      if (ids.length > 0 || wanted.length === 0 || shaped.length > 0 || heavy.length > 0) {
        movements.scafoldingBlocks = ids;
      } else {
        complaints.push('scaffoldBlocks 全部无效,沿用寻路器默认(泥土、圆石)');
      }
      const key = complaints.join('\n');
      if (key !== this.scaffoldComplained) {
        this.scaffoldComplained = key;
        for (const c of complaints) log.warn(c);
      }
    }
    setSiteZones(movements, this.opts.blueprintZones ?? null);
    // 判据对落点和落点下面那一格各问一次(见 setNoPlaceCells)
    const workCell = this.opts.workCell;
    setNoPlaceCells(movements, (x, y, z) => portalIds.has(bot.blockAt(new Vec3(x, y, z), false)?.type ?? -1)
      || (workCell?.(x, y, z) ?? false));
    // 成果登记格同挖不动的格一样排出寻路的挖掘计划;显式挖掘不经这里
    setDigBackoff(movements, (x, y, z) => this.digBackedOff(x, y, z) || (workCell?.(x, y, z) ?? false));
    setProtectedCells(movements, (x, y, z, type) =>
      this.protection.denied(String(bot.game.dimension), x, y, z, type)
      || (this.serverProtection?.verdict('break', String(bot.game.dimension), { x, y, z }) === 'deny')
      || (this.serverProtection?.verdict('break', String(bot.game.dimension), { x, y, z }) === 'unknown'));
    setProtectedPlaceCells(movements, (x, y, z) => {
      const verdict = this.serverProtection?.verdict('place', String(bot.game.dimension), { x, y, z });
      return verdict === 'deny' || verdict === 'unknown';
    });
    const costs = this.opts.movementCosts?.();
    if (costs) {
      movements.placeCost = costs.placeCost;
      movements.digCost = costs.digCost;
    }
  }

  /**
   * 挖掘失败退避的记账口。挂 mineflayer 的挖掘结局事件而不是寻路器的
   * `path_reset('dig_error')`:后者不带坐标,而退避是按格记的。
   */
  protected installDigBackoff(bot: mineflayer.Bot): void {
    bot.on('diggingAborted', (block) => this.noteDigFailure(block.position));
    bot.on('diggingCompleted', (block) => {
      this.digFails.delete(cellKey(block.position));
    });
    // mineflayer 的本地完成事件可能早于服务端确认；服务端不认时一次即退避。
    (bot as unknown as { on(event: string, listener: (block: { position: Cell }) => void): void })
      .on(DIG_UNCONFIRMED_EVENT, (block) => this.noteDigFailure(block.position, true));
  }

  protected noteDigFailure(p: Cell, unconfirmed = false): void {
    const now = Date.now();
    const key = cellKey(p);
    const rec = this.digFails.get(key);
    if (rec === undefined || now - rec.lastAt > DIG_BACKOFF_MS) {
      this.pruneDigFails(now);
      this.digFails.set(key, {
        tries: unconfirmed ? DIG_BACKOFF_TRIES : 1, lastAt: now, since: unconfirmed ? now : null,
        cell: { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) },
      });
      if (!unconfirmed) return;
    } else {
      rec.tries += unconfirmed ? DIG_BACKOFF_TRIES : 1;
      rec.lastAt = now;
      if (rec.tries < DIG_BACKOFF_TRIES || rec.since !== null) return;
      rec.since = now;
    }
    const blocked = this.digFails.get(key)!;
    this.opts.diag?.write({
      lane: 'path', event: 'dig-backoff',
      msg: `(${blocked.cell.x}, ${blocked.cell.y}, ${blocked.cell.z}) ${unconfirmed ? '服务端未确认挖掘' : `连挖 ${blocked.tries} 次没挖动`},`
        + `${DIG_BACKOFF_MS / 1000} 秒内寻路绕开`,
      data: { cell: blocked.cell, tries: blocked.tries, ms: DIG_BACKOFF_MS, unconfirmed },
    });
  }

  protected pruneDigFails(now: number): void {
    for (const [key, rec] of this.digFails) {
      if (now - rec.lastAt > DIG_BACKOFF_MS) this.digFails.delete(key);
    }
  }

  /** 这一格此刻挖不动(寻路器据此不把它排进 toBreak) */
  protected digBackedOff(x: number, y: number, z: number): boolean {
    if (this.digFails.size === 0) return false;
    const key = cellKey({ x, y, z });
    const rec = this.digFails.get(key);
    if (rec?.since == null) return false;
    if (Date.now() - rec.since <= DIG_BACKOFF_MS) return true;
    this.digFails.delete(key);
    return false;
  }

  /** `ts` 之后进退避的格子。goto 受阻回执据此说清「哪一格挖不动、绕开了」 */
  digBackoffSince(ts: number): DigBackoffCell[] {
    const now = Date.now();
    const out: DigBackoffCell[] = [];
    for (const rec of this.digFails.values()) {
      if (rec.since === null || rec.since < ts || now - rec.since > DIG_BACKOFF_MS) continue;
      out.push({ ...rec.cell, since: rec.since });
    }
    return out.sort((a, b) => a.since - b.since);
  }

  /** 移动风格热改:把新名单/代价装回当前 movements 并触发重算 */
  retune(): void {
    const bot = this._bot;
    if (!bot || !this.liveMovements || !(bot as { pathfinder?: unknown }).pathfinder) return;
    this.applyTuning(bot, this.liveMovements);
    bot.pathfinder.setMovements(this.liveMovements);
  }

  /** getPathFromTo 生成器用于路线试算，避免 getPathTo 覆盖当前寻路的 A* 上下文。 */
  probeRoutes(
    target: { x: number; y: number; z: number },
    /** 试算与执行须使用同一目标。省略时使用以 target 为中心、半径 1 的 GoalNear；水平寻路显式传入 GoalNearXZ。 */
    goal: InstanceType<typeof goals.Goal> = new goals.GoalNear(target.x, target.y, target.z, 1),
  ): RouteProbe[] | null {
    const bot = this._bot;
    if (!bot?.entity || typeof bot.pathfinder?.getPathFromTo !== 'function') return null;
    const me = bot.entity.position;
    const horizontal = goal instanceof goals.GoalNearXZ;
    const startDist = horizontal
      ? Math.hypot(me.x - target.x, me.z - target.z)
      : Math.hypot(me.x - target.x, me.y - target.y, me.z - target.z);
    const out: RouteProbe[] = [];
    for (const profile of ['style', 'dig', 'walk'] as const) {
      const m = new Movements(bot);
      m.canDig = profile !== 'walk';
      m.allow1by1towers = profile === 'style';
      this.applyTuning(bot, m);
      if (profile !== 'style') m.scafoldingBlocks = [];
      let result: ProbePath | null = null;
      try {
        const gen = bot.pathfinder.getPathFromTo(m, me, goal, {
          timeout: PROBE_TIMEOUT_MS, tickTimeout: PROBE_TICK_MS,
        });
        const deadline = Date.now() + PROBE_WALL_MS;
        for (const step of gen) {
          result = (step?.result ?? null) as ProbePath | null;
          if (!result || result.status !== 'partial' || Date.now() > deadline) break;
        }
      } catch (err) {
        this.opts.log.warn(`路线试算失败(${profile}): ${(err as Error).message}`);
      }
      if (!result) {
        out.push({ profile, status: 'noPath', steps: 0, place: 0, interact: 0, breaks: 0, endDist: startDist });
        continue;
      }
      const path = result.path ?? [];
      const last = path[path.length - 1];
      const endDist = last
        ? horizontal
          ? Math.hypot(last.x - target.x, last.z - target.z)
          : Math.hypot(last.x - target.x, last.y - target.y, last.z - target.z)
        : startDist;
      let place = 0;
      let interact = 0;
      let breaks = 0;
      for (const mv of path) {
        // Pathfinder also stores door/gate clicks in toPlace; they consume no scaffold blocks.
        for (const action of mv.toPlace ?? []) {
          if (action.useOne === true) interact += 1;
          else place += 1;
        }
        breaks += mv.toBreak?.length ?? 0;
      }
      const status = result.status === 'success' ? 'complete'
        : result.status === 'partial' || result.status === 'timeout' || result.status === 'noPath'
          ? result.status as RouteProbe['status']
          : 'noPath';
      out.push({
        profile, status, steps: path.length, place, interact, breaks,
        endDist: Math.round(endDist * 10) / 10,
        ...(typeof result.visitedNodes === 'number' ? { visited: result.visitedNodes } : {}),
      });
    }
    return out;
  }

  /** 检查目标附近落脚格与最多 128 格的空间连通性；未加载区域不作封闭结论。 */
  probeTarget(target: { x: number; y: number; z: number }): TargetDiag | null {
    const bot = this._bot;
    if (!bot?.entity) return null;
    const read = (x: number, y: number, z: number) => {
      const b = bot.blockAt(new Vec3(x, y, z));
      return b ? probeBlockInfo(b) : null;
    };
    const t = { x: Math.floor(target.x), y: Math.floor(target.y), z: Math.floor(target.z) };
    return diagnoseTargetSpace(read, t);
  }

  /** 每类寻路记录使用独立的五秒窗口；期间重复项计数，下一次输出附抑制数量。 */
  protected installPathDiag(bot: mineflayer.Bot): void {
    const diag = this.opts.diag;
    if (!diag) return;
    const RESET_ZH: Record<string, string> = {
      goal_updated: '目标更换', movements_updated: '移动规则更新', block_updated: '方块变化',
      chunk_loaded: '区块加载', goal_moved: '目标移动', dig_error: '挖掘失败',
      no_scaffolding_blocks: '没有搭路方块', place_error: '放置失败', stuck: '卡住',
    };
    // 抑制计数与时间窗按 key 独立记录；key 来自 RESET_ZH、update、goal、reached 的有限集合。
    const suppressed = new Map<string, number>();
    const lastAt = new Map<string, number>();
    let lastPath: Array<Record<string, unknown>> = [];
    let lastPathAt = 0;
    const write = (key: string, event: string, msg: string, data?: Record<string, unknown>, incident = false): void => {
      const now = Date.now();
      if (now - (lastAt.get(key) ?? 0) < 5_000) {
        suppressed.set(key, (suppressed.get(key) ?? 0) + 1);
        return;
      }
      const n = suppressed.get(key) ?? 0;
      const tail = n > 0 ? `(此前 ${n} 条同类未记)` : '';
      diag.write({ lane: 'path', event, msg: msg + tail, data,
        ...(incident ? { incident: true, taskId: this.opts.taskId?.() ?? undefined } : {}) });
      suppressed.set(key, 0);
      lastAt.set(key, now);
    };
    bot.on('path_update', (r) => {
      lastPath = r.path.slice(0, 8).map((mv) => ({
        at: [mv.x, mv.y, mv.z],
        break: (mv.toBreak ?? []).slice(0, 3).map((p) => [p.x, p.y, p.z]),
        interact: (mv.toPlace ?? []).filter((p) => 'useOne' in p && p.useOne).slice(0, 3).map((p) => [p.x, p.y, p.z]),
      }));
      lastPathAt = Date.now();
      write(`update:${r.status}`, 'update',
        `寻路 ${r.status}:${r.path.length} 步,搜了 ${r.visitedNodes} 节点/${Math.round(r.time)}ms`,
        { status: r.status, pathLen: r.path.length, visitedNodes: r.visitedNodes, timeMs: Math.round(r.time) });
    });
    bot.on('path_reset', (reason) => {
      const stuck = reason === 'stuck';
      const at = bot.entity?.position;
      write(`reset:${reason}`, 'reset', `寻路重置:${RESET_ZH[reason] ?? reason}`,
        stuck ? {
          reason,
          position: at ? { x: at.x, y: at.y, z: at.z } : null,
          doors: nearbyDoorStates(bot),
          canDig: bot.pathfinder?.movements?.canDig ?? null,
          canOpenDoors: bot.pathfinder?.movements?.canOpenDoors ?? null,
          protection: this.protection.status(String(bot.game?.dimension ?? 'overworld')),
          pathAgeMs: lastPathAt ? Date.now() - lastPathAt : null,
          path: lastPath,
        } : { reason }, stuck);
    });
    bot.on('goal_updated', (goal, dynamic) => {
      write(`goal:${goal ? 'set' : 'clear'}`, 'goal',
        goal ? `新寻路目标${dynamic ? '(动态)' : ''}:${goal.constructor?.name ?? 'Goal'}` : '寻路目标已撤销');
    });
    bot.on('goal_reached', () => {
      write('reached', 'reached', '寻路到达目标');
    });
  }

  /** 按需动态加载 viewer。 */
  protected loadViewer(): Promise<ViewerModule> {
    return import('prismarine-viewer') as unknown as Promise<ViewerModule>;
  }

  protected startViewer(bot: mineflayer.Bot, gen: number): void {
    if (this.opts.viewerPort <= 0 || this.viewerUrl !== null) return;
    const port = this.opts.viewerPort;
    /** 上游 viewer 不暴露 http server 的 error 处理接口，启动前先探测端口；探测与绑定之间仍有竞争窗口。 */
    void (async () => {
      try {
        await this.settleDisposals();
        const free = await probePort(port);
        if (!free) {
          this.opts.log.warn(
            `viewer 端口 ${port} 已被占用,本次不开画面(worlds.minecraft.viewerPort 可改)`,
          );
          return;
        }
        let modernAssets = this.opts.viewerAssetsDir;
        if (modernAssets) {
          const { readFile } = await import('node:fs/promises');
          const { join } = await import('node:path');
          try {
            const manifest = JSON.parse(await readFile(join(modernAssets, 'viewer-assets.json'), 'utf8'));
            if (manifest.minecraftVersion !== bot.version) {
              this.opts.log.warn(`Modern assets ${manifest.minecraftVersion} do not match Java ${bot.version}; using the basic viewer.`);
              modernAssets = '';
            }
          } catch { /* An explicitly configured broken pack fails with its own diagnostic. */ }
        }
        if (modernAssets) {
          const { startModernViewer } = await import('./modern-viewer.ts');
          if (this.stopped || this._bot !== bot || this.generation !== gen || this.bagFor(gen).disposed) return;
          const relay = await loadViewerRelay(this.opts.performanceBridge, this.opts.viewerSpeechSourceId || bot.username);
          if (this.stopped || this._bot !== bot || this.generation !== gen) { relay?.close(); return; }
          const handle = await startModernViewer(bot, {
            relay, remoteTextures: this.opts.remoteTextures,
            port, assetsDir: modernAssets, speakerName: this.opts.viewerSpeakerName,
            speechSourceId: this.opts.viewerSpeechSourceId,
            agentMana: () => this.agentMana, serverProtocol: this.viewerServerProtocol(),
          }).catch(error => {relay?.close();throw error;});
          this.bagFor(gen).register('modern-viewer', () => this.releaseViewer(gen, port, handle.close));
        } else {
          const mod = await this.loadViewer();
          if (this.stopped || this._bot !== bot || this.generation !== gen || this.bagFor(gen).disposed) return;
          mod.mineflayer(bot, { port, firstPerson: true });
          // 取得句柄后必须同步注册到资源袋，中间不能 await，以免 stop 时漏收。
          const close = (bot as unknown as { viewer?: { close?: () => void } }).viewer?.close;
          this.bagFor(gen).register('prismarine-viewer', () => this.releaseViewer(gen, port, close));
        }
        if (this.stopped || this.generation !== gen) return; // 旧代不得改新代状态
        this.viewer = { gen, url: `http://127.0.0.1:${port}`, kind: modernAssets ? 'modern' : 'basic' };
        this.opts.log.info(`minecraft viewer 已启动 http://127.0.0.1:${port}`);
      } catch (err) {
        this.opts.log.warn(`minecraft viewer 启动失败(不影响游玩): ${(err as Error).message}`);
      }
    })();
  }

  /** viewer.close() 不返回 Promise，关闭后通过端口绑定探测确认释放。 */
  protected async releaseViewer(gen: number, port: number, close?: () => Promise<void> | void): Promise<void> {
    if (this.viewer?.gen === gen) this.viewer = null;
    if (!close) {
      this.opts.log.warn(`viewer 没有暴露 close,端口 ${port} 无法主动释放`);
      return;
    }
    await close();
    const deadline = Date.now() + VIEWER_RELEASE_MS;
    for (;;) {
      if (await probePort(port)) return;
      if (Date.now() >= deadline) {
        this.opts.log.warn(`viewer 已关闭,端口 ${port} 在 ${VIEWER_RELEASE_MS / 1000}s 内仍不可绑定`);
        return;
      }
      await sleep(VIEWER_RELEASE_POLL_MS);
    }
  }

  protected scheduleReconnect(reason: string): void {
    if (this.stopped || this.opts.shuttingDown?.() || this.reconnectTimer) return;
    const delay = this.refusedStreak >= REFUSED_ALARM_AT
      ? REFUSED_DELAY_MS
      : RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt++;
    this.opts.log.info(`minecraft ${delay / 1000}s 后重连(第 ${this.reconnectAttempt} 次): ${reason}`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
