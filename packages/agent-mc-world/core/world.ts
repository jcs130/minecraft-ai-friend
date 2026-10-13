/**
 * MinecraftWorld — 实时游戏 World(worlds-minecraft),实时游戏 World 的范例实现。
 *
 * 三个正交槽位的取值:观察=结构化文本、动作=异步执行器、
 * 节奏=实时(World 内节流 + 不经 LLM 的自保反射)。对 vtuber 零代码耦合:事件
 * 语义文本化投递，prismarine-viewer 画面由 OBS 采集。将 "minecraft" 列入
 * worlds.vtuber.delayedSources 可延迟 vtuber 侧投递，避免画面先行。
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { goalClosureMetadata } from './goal-metrics.ts';
import { createGoalClosureHandler, GOAL_CLOSURE_CONTRACT } from '../src/client/goal-closure.ts';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ConfigGroup, World, WorldHost, WorldConsoleDecl, WorldPanelDecl, WorldRequestFacts,
  ExecutionReceipt, BlobInput, EventTag, StoragePart, ToolCallContext, ToolDef, ToolOutcome, TriggerMode,
} from './support/host-contract.ts';
import { MAP_SIZE, exploredShare, mapStateOf, renderMapPng } from './map-view.ts';
import { selfDamageText, takeSelfDamage } from './damage-source.ts';
import { readMapDat } from './level-dat.ts';
import { readMapId } from './item-facts.ts';
import { Vec3 } from 'vec3';
import type { Bot } from 'mineflayer';
import { nowIso } from './support/runtime.mjs';
import { observeStatusEffects } from './status-effects.ts';
import { Bridge } from './bridge.ts';
import { captureMinecraftView, closeMinecraftViewCapture, warmMinecraftViewCapture } from './visual-capture.ts';
import { PlayerObservations, playerObservationMeta, renderPlayerObservation, type PlayerObservation } from './player-observation.ts';
import { precheckEmptyUseTarget } from './precheck.ts';
import { blockAtCell, resolveAt } from './cell-facts.ts';
import { FLIGHT_PLAN_MAX_POINTS, parseFlightPlan, previewFlightPlan } from './flight-preview.ts';
import { MethodRunner, METHOD_LIMITS, METHOD_ADAPTER, type MethodOperation, type MethodRun } from './method-runner.ts';
import { resolveProcedure, procedureReference, PROCEDURE_RECEIPT_SCHEMA, PROCEDURE_RECEIPT_MIME,
  type ProcedureReceipt } from './support/procedure.ts';
import { MineflayerMethod, NATIVE_API } from './method-mineflayer.ts';
import { methodApiHelp } from './method-api.ts';
import { flightState } from './flight.ts';
import { IdleBehaviorController, IdlePresentationContext, type IdleBehaviorScene } from './idle-behavior.ts';
import { sampleIdleActions, executeIdleAction } from './idle-actions.ts';
import { RejectedRouteLedger, sameRejectedRouteOrigin, type RejectedRouteScope } from './rejected-route-ledger.ts';
import { classifyBossBarTitle } from './boss-bar.ts';
import { minecraftTextComponent } from './text-component.ts';
import { MinecraftChatProvenance } from '../src/chat-provenance.ts';
import { RAILWAY_TOOL_DECL, railwayReadout } from '../src/railway.ts';
import {
  REPEATED_QUERY_RECEIPT, RoundOnceGate, roundTokenOf,
} from './round.ts';
import {
  bagStamp, blockedStamp, queueStamp,
  renderBagReadout, renderBlockedReadout, renderLastTaskReadout, renderQueueReadout, renderStorageReadout, renderStoredItemReadout,
} from './readouts.ts';
import type { SiteZone } from './pathfinder-perf.ts';
import {
  AXIS_ORDER, blockIdOf, forEachCell, isAirState, isStructureVoidState, normalizeBlockName, validateBlueprintLabel,
  type BlueprintLabel, type NormalizedBlueprint, type PositionXYZ, type SizeXYZ, type VoxelMetrics,
} from './blueprint.ts';
import {
  BLUEPRINT_MATERIAL_NOTE, acceptBlueprint, billForSteps, blueprintProgress, blueprintStepStateMatches,
  remainingPlacementBillSteps, renderBlueprintAdvisories,
  BLUEPRINT_MAX_OUTPUT_CHARS,
  type BlueprintBillLine, type BlueprintPlan, type BlueprintStep,
} from './blueprint-plan.ts';
import {
  BlueprintResourceLedger, blueprintContentHash, createBlueprintJobId, createBlueprintVersion,
  createBlueprintVersionId,
  type BlueprintVersionIdentity,
} from './blueprint-resource.ts';
import { BLUEPRINT_SUPPORT_DOC, type BlueprintStateFailure } from './blueprint-registry.ts';
import {
  blueprintCheckText, parseChecks, renderChecks,
  CHECK_BOX_CELL_CAP, CHECK_MAX_ASSERTS, CHECK_SEALED_VOLUME_CAP,
  type CheckMarkProbe, type CheckSite, type CheckWorld,
} from './check.ts';
import {
  GOAL_PLAN_SCHEMA, coordinateGoalPlan, goalPlanDoneIssue, goalPlanSummary,
  parseGoalPlan, recordGoalJudgment, reopenGoalJudgment, renderGoalPlanTransition,
  type GoalPlan, type GoalProbeContext,
} from './goal-plan.ts';
import {
  MinecraftServerManager, type MinecraftDifficultyFact, type MinecraftServerPhase, type MinecraftServerState,
} from './server.ts';
import { MinecraftAuthentication } from '../src/client/authentication.ts';
import { GameClient, type ClientState } from './client.ts';
import {
  Executor, Reflexes, parseNoteText, parseQueueMode, parseScoutSteps, parseSteps, sendChat,
  QUEUE_SCHEMA, renderQueue,
  SCOUT_SKILL_DOC, SCOUT_STEP_SCHEMA, SKILL_STEP_SCHEMA,
  type BlueprintDesk, type BlueprintSurvey, type MarkDesk, type MarkLookup,
  type ParseNote, type ResourcePlacementPermit, type SkillCall, type TaskAdmissionDecision, type TaskAdmissionRejection, type TaskQueueTail, type TaskReport,
} from './executor.ts';
import { Aborted, SkillBlocked, sleep, type BlueprintPlacementIntent } from './skill-context.ts';
import { worldStateAt } from './skills-build.ts';
import { chatInputError, readSkillHelp, SKILL_HELP_MAX_SKILLS, SKILL_SIGNATURE_DOC } from './skills.ts';
import {
  parsePolicy, policyNoteText, renderFightRollback, renderPolicy, renderPolicyChange, renderPolicyEnv,
  PolicyBook, POLICY_DOC, POLICY_SCHEMA, type TravelPrefer,
} from './policy.ts';
import { markShowWindowClosed, type ShowTempo } from './show.ts';
import { MinecraftLog, type MinecraftLogEntry } from './log.ts';
import {
  BodyLeaseArbiter,
  type BodyLeaseEvent,
  type BodyOwner,
  type BodyOwnerKind,
} from './body-lease.ts';
import {
  bearing, biomeAt, canSeeEntity, classifyEntity, dayNightTransition, hazardTouch, isRaining,
  droppedStackOf, narrateWorld, narrateWorldSegments, scanMatureCrops, snapshotFingerprint, snapshotFromBot,
  standCellsAround, worldDelta, DIRECTION_ZH, WATER_BLOCKS,
  type BlockReader, type ItemStack, type WorldSnapshot,
} from './terrain.ts';
import {
  accessFrom, applyAccess, applySettings, ensureOps, FLAT_PRESETS, grantOp, isOp,
  LEVEL_TYPE_LABELS, levelTypeLabel, listWorlds, loadProperties, readOps, revokeOp,
  saveProperties, settingsFrom, validGeneratorSettings, validWorldName, worldEnvLine,
  worldIdentityOf, writeOps,
  type AccessSettings, type GameSettings, type LevelType, type WorldIdentity, type WorldInfo,
} from './server-config.ts';
import { ChestBook } from './chests.ts';
import { DirectionalSweepBook } from './directional-sweeps.ts';
import { containerStacks } from './containers.ts';
import { invItemNamed, itemsInReach } from './inventory.ts';
import { selectionMenuTitle } from './window-semantics.ts';
import { readEnchants } from './item-facts.ts';
import { ItemBreakDecoder, type ItemBreakFact } from './item-break.ts';
import { WorksBook } from './works.ts';
import { CombatSession } from './combat.ts';
import { corridorSafe } from './idle-actions.ts';
import { chooseRoutineFood, renderFoodReserveReadout } from './nutrition.ts';

import {
  BowController,
  PositionVelocityTracker,
  RANGED_ENTER_RANGE,
  RANGED_EXIT_RANGE,
  bestRangedWeapon,
  hasUsableArrows,
  type BowEvent,
  type BowShotResult,
} from './ranged.ts';
import { piglinIsHostile } from './piglin.ts';
import { DeathBook } from './deaths.ts';
import { ExploreBook } from './explored.ts';
import { ServerActionWait } from './server-action-wait.ts';
import { zhDimension, zhEntity, zhName } from './names.ts';
import { offlineUuid } from './client-launch.ts';
import {
  applySkins,
  clearStoredSkin,
  hasSkinMod,
  installedMatches,
  readStoredSkin,
  removeInstalledSkin,
  setStoredSkin,
  storedSkinInfo,
  type SkinInfo,
  type SkinRole,
} from './client-skins.ts';
import {
  ESCAPE_TP_MS, SET_SPAWN_TRANSLATE, normalizeDimension, playerDatPath, readPlayerDatFile, runEscape,
  spawnAt, type SpawnTarget, type Vec3like,
} from './escape.ts';
import { MINECRAFT_DEFAULTS, MINECRAFT_CONFIG_GROUP, MINECRAFT_RHYTHM_CONFIG_GROUP, MINECRAFT_CLIENT_CONFIG_GROUP, MINECRAFT_PLAYER_CONFIG_GROUP, type MinecraftConfigSection } from './config.ts';

/** 槽位交换会连续发多次 updateSlot；只在整笔交换安静下来后核对 reserve。 */
const BLUEPRINT_INVENTORY_SETTLE_MS = 500;
/** 已确认正式施工后等待该物品数量扣减的上界。 */
export const BLUEPRINT_PLACEMENT_SETTLE_MS = 1_500;

interface BlueprintResourceReading {
  scope: string;
  bot: Bot;
  remainingSteps: Set<number>;
  placements: Record<number, PositionXYZ[]>;
}

interface BlueprintOwnedConsumption {
  bot: Bot;
  life: number;
  scope: string;
  intent: BlueprintPlacementIntent;
  item: string;
  step: BlueprintStep;
  /** 同物品只有一笔未决放置；扣减必须来自其后且无其他库存改写。 */
  maxAfter: number;
  ambiguous?: boolean;
}
/** 重生点搬得比这远(或换了维度)才唤醒她:同一张床重睡、几格内的微调不值得打断 */
const SPAWN_FAR_BLOCKS = 256;
/** 实测重生点跟死亡回执里预告的差过这么多格，才值得再说一句（预告准了就不重复） */
const RESPAWN_OFF_BLOCKS = 8;
/** set_spawn 系统消息落地后这段时间内的床回执,捎带一句「重生点已经记在这张床上了」 */
const SPAWN_NOTE_MS = 5_000;

interface DimensionPoint extends Vec3like {
  dimension: string;
}

/** 实体接近报告的滞回窗:16 格进、24 格出,中间 8 格吸掉边缘抖动。 */
const PROXIMITY_ENTER = 16;
const PROXIMITY_EXIT = 24;

/** 原版客户端动作栏一条文字显示 60 tick(Gui.setOverlayMessage),期间收到同一文字只重置计时。 */
export const ACTION_BAR_SHOW_MS = 60 * 50;

/** 进出服广播由 playerJoined/playerLeft 成文。 */
const PLAYER_LIST_TRANSLATES = new Set([
  'multiplayer.player.joined', 'multiplayer.player.joined.renamed', 'multiplayer.player.left',
]);

/** mc_escape「第几次回到同一处」的统计窗口 */
const ESCAPE_REPEAT_WINDOW_MS = 15 * 60_000;

/** 值得单独点名的非敌对生物：能互动或罕见，进圈报一条常规事件。 */
const NOTABLE_FRIENDLY = new Set([
  'villager', 'wandering_trader', 'iron_golem', 'snow_golem', 'horse', 'donkey', 'mule',
  'llama', 'trader_llama', 'camel', 'wolf', 'cat', 'parrot', 'axolotl', 'allay', 'sniffer',
  'fox', 'panda', 'ocelot', 'turtle', 'piglin',
]);

/**
 * 常见牲畜按种类合并成"附近有牛×N"捎带投递;逐只报没有新闻价值。
 * 鱼和鱿鱼不进这里:沿河走时进出圈频繁,又没有互动价值,只在世界快照里可见。
 */
const FLOCK_ANIMALS = new Set([
  'cow', 'pig', 'sheep', 'chicken', 'rabbit', 'mooshroom', 'goat', 'bee', 'frog', 'bat',
]);

/**
 * 一跳掉这么多血就立刻唤醒她,不攒批也不受节流。岩浆是每半秒 4 点、摔落与
 * 苦力怕同量级——这种速度下"等血线跌破 10 再说"等于死后才通知。
 */
const URGENT_LOSS = 4;

/** 中了这些状态立即唤醒;其余增益类常规攒批。 */
const HARMFUL_EFFECTS = new Set([
  'Poison', 'Wither', 'Hunger', 'Weakness', 'Slowness', 'MiningFatigue',
  'Blindness', 'Nausea', 'Levitation', 'InstantDamage', 'Darkness', 'Unluck', 'BadOmen',
]);

/**
 * 官方死因 translate key → 中文短释。只是把英文原文翻给她看,不是归因判断;
 * 认不出的 key 不硬翻,专报里只贴原文。
 */
const DEATH_CAUSE_ZH: ReadonlyArray<readonly [RegExp, string]> = [
  [/^death\.attack\.inWall/, '闷在方块里窒息'],
  [/^death\.attack\.(inFire|onFire)/, '烧死'],
  [/^death\.attack\.lava/, '掉进岩浆'],
  [/^death\.attack\.hotFloor/, '被岩浆块烫死'],
  [/^death\.attack\.drown/, '淹死'],
  [/^death\.attack\.explosion/, '被炸死'],
  [/^death\.attack\.fall\b/, '摔死'],
  [/^death\.fell\./, '摔死'],
  [/^death\.attack\.(fallingBlock|fallingStalactite)/, '被下落的方块砸死'],
  [/^death\.attack\.starve/, '饿死'],
  [/^death\.attack\.cactus/, '被仙人掌扎死'],
  [/^death\.attack\.(freeze|stalagmite)/, '冻死/摔在钟乳石上'],
  [/^death\.attack\.arrow/, '被箭射死'],
  [/^death\.attack\.outOfWorld/, '掉出世界'],
  [/^death\.attack\.wither\b/, '被凋零效果耗死'],
  [/^death\.attack\.magic/, '被魔法伤害打死'],
  [/^death\.attack\.(mob|player)/, '被打死'],
];

/** 死因 key 的中文短释;认不出返回 null(只贴原文,不硬翻) */
function deathCauseZh(key: string): string | null {
  for (const [re, zh] of DEATH_CAUSE_ZH) {
    if (re.test(key)) return zh;
  }
  return null;
}

const ZH_EFFECTS: Record<string, string> = {
  Speed: '速度', Slowness: '缓慢', Haste: '急迫', MiningFatigue: '挖掘疲劳', Strength: '力量',
  InstantHealth: '瞬间治疗', InstantDamage: '瞬间伤害', JumpBoost: '跳跃提升', Nausea: '反胃',
  Regeneration: '生命恢复', Resistance: '抗性提升', FireResistance: '防火', WaterBreathing: '水下呼吸',
  Invisibility: '隐身', Blindness: '失明', NightVision: '夜视', Hunger: '饥饿', Weakness: '虚弱',
  Poison: '中毒', Wither: '凋零', HealthBoost: '生命提升', Absorption: '伤害吸收',
  Levitation: '漂浮', SlowFalling: '缓降', Darkness: '黑暗', BadOmen: '不祥之兆', Unluck: '霉运',
};

function effectNameOf(bot: any, effect: any): string {
  return String(bot.registry?.effects?.[effect?.id]?.name ?? effect?.id ?? '');
}

/** 快照跳拍所用的位置变化阈值，单位为格；独立于位移播报阈值 world.moveThreshold。 */
const SNAPSHOT_QUIET_MOVE = 4;

/** mc_policy 的 travel 档位 → 寻路挖/垫代价系数 */
const TRAVEL_COSTS: Record<TravelPrefer, { placeCost: number; digCost: number }> = {
  auto: { placeCost: 1, digCost: 1 },
  dig: { placeCost: 6, digCost: 1 },
  place: { placeCost: 1, digCost: 4 },
};

/**
 * 开新存档时的世界生成选择。这几项只在世界**第一次生成**时被服务器读到,
 * 之后再改 server.properties 也不会重塑已有的世界——所以它们是"开新存档"
 * 这个动作的参数,而不是可随时应用的设置。
 */
interface WorldGenChoice {
  /** 空 = 随机 */
  seed?: string;
  levelType?: LevelType;
  /** 生成器细则 JSON(超平坦层配方 / 单群系名);空 = 该类型默认 */
  generatorSettings?: string;
  generateStructures?: boolean;
}

/** 「存档与玩法」面板的一份状态 */
export interface MinecraftWorldState {
  /** 服务器目录配好了没 */
  configured: boolean;
  serverDir: string;
  /** 服务器正跑着(含外部起的):只有难度与默认游戏模式能热改 */
  live: boolean;
  /** 是否由 World 托管；仅托管进程提供控制台 stdin。 */
  hosted: boolean;
  worlds: WorldInfo[];
  settings: GameSettings;
  /** 超平坦层配方的常用预设;面板照它铺选项,措辞与配方只此一份 */
  flatPresets: typeof FLAT_PRESETS;
  /** 世界类型的中文词表,同上 */
  levelTypes: typeof LEVEL_TYPE_LABELS;
  detail: string | null;
}

/** 管理员名单里的一位;role 是这个名字在本部署里的身份 */
export interface MinecraftAccessMember {
  name: string;
  /** bot=她自己 / camera=观察者摄像机 / player=人的客户端 / other=名单里别的名字 */
  role: 'bot' | 'camera' | 'player' | 'other';
  /** 在 ops.json 里 */
  op: boolean;
  /** 名单里那条的权限等级;不在名单里为 0 */
  level: number;
}

/** 「权限与作弊」面板的一份状态 */
export interface MinecraftAccessState {
  configured: boolean;
  serverDir: string;
  /** 服务器正跑着(含外部起的) */
  live: boolean;
  /** 由 World 托管:跑着的时候也能经控制台 op/deop */
  hosted: boolean;
  /** worlds.minecraft.local.cheats:启动前自动补名单 */
  autoOp: boolean;
  members: MinecraftAccessMember[];
  settings: AccessSettings;
  detail: string | null;
}

/** 「皮肤」面板里的一个角色:她自己,或人那份客户端 */
export interface MinecraftSkinRole {
  role: SkinRole;
  /** 皮肤按这个账号名铺进游戏目录 */
  username: string;
  /** 选着的那张;null = 没选,那个账号维持原版随机皮肤 */
  skin: SkinInfo | null;
  /** 两份游戏目录里此刻铺着的正是这张 */
  installed: { camera: boolean; player: boolean };
}

/** 「皮肤」面板的一份状态 */
export interface MinecraftSkinState {
  roles: MinecraftSkinRole[];
  /** 两份客户端的游戏目录;相同即共用一份 */
  dirs: { camera: string; player: string };
  /** CustomSkinLoader 装了没:没装则皮肤铺得再对也不会被读 */
  mod: { camera: boolean; player: boolean };
  /** 客户端正跑着:换了皮肤要它重连服务器才刷新 */
  live: { camera: boolean; player: boolean };
  detail: string | null;
}

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
/** 只在开了观察者客户端时才进前缀的那一段;独立成文件才能让措辞归人。 */
const CAMERA_NOTE_FILE = fileURLToPath(new URL('./ENV_PROMPT_CAMERA.md', import.meta.url));







/**
 * 控制台面板的声明:**局部 id + 真标题**,渲染在 `src/worlds/minecraft/console/` 的
 * 自有浏览器插件里(键就是这里的 id),中央前端不认识这几个名字。
 *
 * 代理与真 World 共用这一份。控制台隔着子进程代理看到的表面必须与直连时一模一样
 * ——面板 id 两边一旦不同,浏览器插件那几个键就只在其中一条路上对得上。
 */
export const MINECRAFT_PANEL_DECLS: readonly WorldPanelDecl[] = [
  { id: 'connection', title: '连接与账号', getMethods: ['state'] },
  { id: 'mount', title: '挂载', description: '游戏服务器 / 观察者客户端 / 玩家客户端的启停。' },
  { id: 'skin', title: '皮肤', description: '她和玩家各穿哪一张皮肤:选一张 PNG,由客户端读(离线服自己没有材质)。' },
  { id: 'world', title: '存档与玩法', description: '换存档、开新世界、调难度与游戏模式。' },
  { id: 'access', title: '权限与作弊', description: '谁有作弊权限(ops.json),以及命令方块、正版验证这类服务器项。' },
  { id: 'log', title: 'World 日志', description: '一场试玩的现场:下过的令、投递、每一步的结局。' },
];

/**
 * 代理与进程内 World 共用的静态存储元数据，不含 stat/clear。
 * 装配期即可列出全部存储项，不依赖 start() 后才启动的子进程。
 */
export const MINECRAFT_STORAGE_DECLS: ReadonlyArray<Omit<StoragePart, 'stat' | 'clear'>> = [
  {
    key: 'minecraft-chests',
    label: '容器账本',
    kind: 'disk',
    location: 'data/minecraft-chests.json',
    note: 'stow/take/use 开过的箱子、炉子的槽位与到期估计、自备的工作站;清了下次当没开过。不是地标',
  },
  {
    key: 'minecraft-deaths',
    label: '死亡账本',
    kind: 'disk',
    location: 'data/minecraft-deaths.json',
    note: '这个世界今天死了几次、累计几次;死亡回执报序号,她写记忆提到死亡时回执带上这个读数。清了当没死过',
  },
  {
    key: 'minecraft-explored',
    label: '探索覆盖账本',
    kind: 'disk',
    location: 'data/minecraft-explored.json',
    note: 'find 边走边找收工时按方向记历史最远与末端群系,摘要进环境提示词;清了当哪儿都没去过。不是地标',
  },
  {
    key: 'minecraft-works',
    label: '成果登记',
    kind: 'disk',
    location: 'data/minecraft-works.json',
    note: '她亲手做成的格:建成的蓝图、锄成的耕地、种下的作物。寻路不往登记格头顶垫,'
      + 'excavate 与放置只把它摆进回执不拦人;清了当这些地方她没建过。不是地标',
  },
  {
    key: 'minecraft-policy',
    label: '常驻规矩(mc_policy)',
    kind: 'disk',
    location: 'data/minecraft-policy.json',
    note: '垫脚/照明名单与场合、赶路取向、收着不用的家伙什、主动交战条件;清了六格全回默认',
  },
  {
    key: 'minecraft-blueprints',
    label: '蓝图表',
    kind: 'disk',
    location: 'data/minecraft-blueprints.json',
    note: '装载过的蓝图设计(palette + 矩阵),外加每个世界里那几张图的施工锚点与进度。'
      + '设计没有世界性、跨世界留着;清了等于她画的图全没了,要重新出图或重新 save',
  },
  {
    key: 'minecraft-pwsr',
    label: '暂态表(目标/路标等)',
    kind: 'memory',
    note: 'PWSR 暂态:她从笔记投影进来的目标与路标,外加蓝图施工进度那张视图,按世界分命名空间。'
      + '本来就不跨重启,清了等于提前进了下一场',
  },
];

// ---------------------------------------------------------------------------
// PWSR 暂态骨架(Persona–World State Reconciliation;准则见 docs/worlds.md「Persona–World 状态对账」)
// ---------------------------------------------------------------------------

/**
 * 一张 realm 域暂态表的登记项。
 *
 * PWSR 的暂态**不是 World 的持久状态**:真身写在她自己的笔记里,World 这一份只是她
 * 运行时投影进来的可计算副本(so World 与 memory 互相匿名,她本人是同步协议)。
 * 于是每张表只需要交代三件事 —— **叫什么、清的时候怎么说、现状一行贡献什么**;
 * 命名空间归骨架管(换世界即换空间,旧数据留在旧空间**不删**),内容归表自己管。
 *
 * `T` 是这张表的数据本体;骨架只按 realm 键存放它,不理解里面装的是什么。
 */
interface PwsrTableDecl<T> {
  /** 机器层键,命名空间内唯一 */
  key: string;
  /** 空表长什么样;切到一个没见过的 realm 时现造一份 */
  create: () => T;
  /**
   * 换世界公告里这张表那一句(「2 条目标」)。**表当时是空的就返回 null** ——
   * 空表不进公告,「暂态已清:」后面不该跟一串零。它同时是「这张表空不空」的唯一判据。
   */
  cleared: (data: T) => string | null;
  /** 「暂态:」现状一行里这张表那一段(「目标 0 条」);空表照样报,零是有信息的 */
  status: (data: T) => string;
  /** 全空时那句指路里点它的名字(工具名);缺省不点名 */
  hint?: string;
}

/**
 * 按 realmKey 隔离的内存暂态表；切换世界保留旧命名空间，切回时恢复访问。
 * 注册的表自动进入公告、现状行与控制台存储项。
 */
export class PwsrTables {
  /** 当前命名空间键;空串 = 还没认过世界(她在连上之前就登记的东西落在这里) */
  protected current = '';
  protected readonly spaces = new Map<string, Map<string, unknown>>();
  protected readonly decls: Array<PwsrTableDecl<unknown>> = [];

  /**
   * 登记一张表,拿回一个「当前命名空间那一份」的取数句柄。
   *
   * 句柄每次现取:换过命名空间之后同一个句柄自动指向新空间的那一份,
   * 调用方不必知道换过 —— 世界性失效因此不依赖任何调用方记得做什么。
   */
  register<T>(decl: PwsrTableDecl<T>): () => T {
    this.decls.push(decl as unknown as PwsrTableDecl<unknown>);
    return () => this.dataOf(this.space(this.current), decl);
  }

  /** 当前命名空间键(诊断与测试用;她那边永远只看见存档名) */
  get realm(): string {
    return this.current;
  }

  /**
   * 切到 `key` 这个命名空间。返回旧空间里各表「随旧世界下桌」的那几句(公告用);
   * 没换、或旧空间本来就空,返回空数组。**旧空间原样留着。**
   */
  switchTo(key: string): string[] {
    if (key === this.current) return [];
    const old = this.spaces.get(this.current);
    this.current = key;
    if (!old) return [];
    return this.decls
      .map((d) => {
        const data = old.get(d.key);
        return data === undefined ? null : d.cleared(data);
      })
      .filter((s): s is string => s !== null);
  }

  /**
   * 进服那一行现状:告知 + 指路,不是开机仪式(PWSR 收紧第一条)。
   * 全空时才附那句指路 —— 有东西在的时候她要的是清单,不是被催着去恢复。
   */
  statusLine(): string | null {
    if (this.decls.length === 0) return null;
    const space = this.space(this.current);
    const parts = this.decls.map((d) => d.status(this.dataOf(space, d)));
    const allEmpty = this.decls.every((d) => d.cleared(this.dataOf(space, d)) === null);
    if (!allEmpty) return `暂态:${parts.join('、')}`;
    const hints = this.decls.map((d) => d.hint).filter(Boolean);
    return `暂态:${parts.join('、')}——要接着上次干,从你的笔记里读回来重新登记`
      + `${hints.length > 0 ? `(${hints.join('、')})` : ''}`;
  }

  /** 控制台存储项的规模一行 */
  stat(): string {
    const space = this.space(this.current);
    const here = this.decls.map((d) => d.status(this.dataOf(space, d))).join('、') || '没有登记表';
    const others = [...this.spaces.keys()].filter((k) => k !== this.current).length;
    return `当前世界:${here}${others > 0 ? `;另有 ${others} 个旧世界的命名空间留着` : ''}`;
  }

  /** 一键清空:所有命名空间一起没(旧世界那几份也不留) */
  clear(): string {
    const n = this.spaces.size;
    this.spaces.clear();
    return n > 0 ? `暂态已清空(${n} 个世界命名空间)` : '暂态本来就是空的';
  }

  protected space(key: string): Map<string, unknown> {
    let s = this.spaces.get(key);
    if (!s) {
      s = new Map();
      this.spaces.set(key, s);
    }
    return s;
  }

  protected dataOf<T>(space: Map<string, unknown>, decl: PwsrTableDecl<T>): T {
    let data = space.get(decl.key) as T | undefined;
    if (data === undefined) {
      data = decl.create();
      space.set(decl.key, data);
    }
    return data;
  }
}

// ---------------------------------------------------------------------------
// mc_goal:PWSR 表其一(最小实例)
// ---------------------------------------------------------------------------

/** 目标的格数上限。五格是刻意的小:它是她的注意力清单,不是待办数据库 */
const GOAL_SLOTS = 5;

/** 一条目标。`slot` 是她认的号(#1..#5);撤掉之后那个号空出来,下一次 add 补上 */
export interface MinecraftGoal {
  revision?: number;
  slot: number;
  text: string;
  /** 可选的追踪分类；自由文本，常见值如收集、击杀、捕获、探索、建造、种植。 */
  kind?: string | null;
  /** 被计数的物品、实体、地点或工程阶段。 */
  target?: string | null;
  progress?: { current: number; total: number | null; unit: string | null } | null;
  plan: GoalPlan;
  /** 关联的蓝图键；未绑定为 null。 */
  blueprint: string | null;
  /** 登记那一刻的游戏内天数;拿不到(没连上/服务端没给)为 null */
  day: number | null;
  /** 登记那一刻的现实时刻(部署时区的 nowIso 串) */
  realTime: string;
  /** 登记那一刻的毫秒戳,只用来算「挂了多久」 */
  at: number;
}

export interface GoalTable {
  list: MinecraftGoal[];
}

/** 登记时刻。现实时刻是主口径(跨场次可对账),游戏内天数只够当一句现场描述 */
export interface GoalStamp {
  day: number | null;
  realTime: string;
  at: number;
}

/**
 * 语义写之后那句提醒(PWSR 生命周期第 3 条)。**只跟增/删/改**:进度数字、位置
 * 这类高频机械变化绝不催写 memory(收紧第二条),频繁 memory 操作伤实时性。
 *
 * 目标(mc_goal)与路标(mc_map)共用同一句:两张表在她那边是同一件事 ——
 * 系统这边的登记会丢,笔记那边才过夜。两处说法不一样只会让她以为规矩不一样。
 */
const PWSR_OVERNIGHT_NOTE = '(临时登记,重启和换世界会丢;要过夜自己记进笔记。)';

/**
 * 蓝图键 → 那一条目标尾巴上的进度短句(「已施工 34%,还缺石头 50」)。
 * 接不上蓝图表(纯函数单测、那张图还没装载)时返回 null,由 `goalLine` 退回「待装载」——
 * 不拿一个假的百分比充数。
 */
type BlueprintNote = (key: string) => string | null;

/** 一条目标怎么念,不带蓝图尾巴(蓝图事实自己占一句的地方用它) */
function goalBody(g: MinecraftGoal): string {
  const plan = goalPlanSummary(g.plan);
  const facts = [
    g.kind ? `类型:${g.kind}` : '',
    g.target ? `对象:${g.target}` : '',
    g.progress
      ? `进度:${g.progress.current}${g.progress.total === null ? '' : `/${g.progress.total}`}`
        + `${g.progress.unit ? ` ${g.progress.unit}` : ''}`
      : '',
    `里程碑:${plan.completed}/${plan.total}${plan.next ? `;下一步:${plan.next.do}` : ''}`,
  ].filter(Boolean);
  return `#${g.slot} v${g.revision??1} ${g.text}[${facts.join(';')}]`;
}

/** 一条目标怎么念 */
export function goalLine(g: MinecraftGoal, note?: BlueprintNote): string {
  if (!g.blueprint) return goalBody(g);
  return `${goalBody(g)}(蓝图 ${g.blueprint}:${note?.(g.blueprint) ?? '待装载'})`;
}

/** 目标登记时间与已挂时长；先报现实时间，游戏内天数作为括注。 */
export function goalAge(g: MinecraftGoal, now: number): string {
  const mins = Math.max(0, Math.round((now - g.at) / 60_000));
  const span = mins < 60 ? `${mins} 分钟` : `${Math.floor(mins / 60)} 小时 ${mins % 60} 分`;
  const clock = `${Number(g.realTime.slice(5, 7))}-${Number(g.realTime.slice(8, 10))} ${g.realTime.slice(11, 16)}`;
  const inGame = g.day === null ? '' : `(挂上那会儿游戏里是第 ${g.day} 天)`;
  return `从现实 ${clock} 挂到现在,挂了 ${span}${inGame}`;
}

/** 世界快照的目标尾行；空表也渲染，其内容参与快照指纹。 */
export function goalSnapshotLine(list: readonly MinecraftGoal[], note?: BlueprintNote): string {
  if (list.length === 0) return `目标:0 条(${GOAL_SLOTS} 格全空,用 mc_goal 挂)`;
  return `目标:${list.map((g) => goalLine(g, note)).join(' · ')}`;
}

type GoalOp =
  | { kind: 'query' }
  | {
      kind: 'add';
      text: string;
      blueprint: string | null;
      trackingKind: string | null;
      target: string | null;
      progress: { current: number; total: number | null; unit: string | null } | null;
      plan: GoalPlan;
    }
  | { kind: 'revise'; slot:number; expectedRevision:number; text:string; plan:GoalPlan; reason:string }
  | { kind: 'done'; slot: number }
  | { kind: 'milestone'; slot: number; step: number; judgment: string }
  | { kind: 'reopen'; slot: number; step: number; reason: string }
  | { kind: 'drop'; slot: number };

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function optionalText(value: unknown): string | null | { error: true } {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return { error: true };
  return value.trim() || null;
}

/** `{}` = 查询；add/milestone/reopen/done/drop 一次只受理一个。 */
export function parseGoal(args: Record<string, unknown>): GoalOp | { error: string } {
  const operations = ['add', 'revise', 'milestone', 'reopen', 'done', 'drop'] as const;
  const extras = Object.keys(args).filter((key) => !operations.some((operation) => operation === key));
  if (extras.length > 0) return { error: `mc_goal 有未知字段: ${extras.join(', ')}` };
  const given = operations.filter((k) => args[k] !== undefined && args[k] !== null);
  if (given.length === 0) return { kind: 'query' };
  if (given.length > 1) {
    return { error: `一次只受理一件事,这次给了 ${given.join(' 和 ')};分开调用` };
  }
  const which = given[0];
  if (which === 'add') {
    const obj = args.add;
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      return { error: 'add 要一个 {text, plan, kind?, target?, blueprint?, current?, total?, unit?} 对象' };
    }
    const body = obj as Record<string, unknown>;
    const extras = Object.keys(body)
      .filter((key) => !['text', 'plan', 'blueprint', 'kind', 'target', 'current', 'total', 'unit'].includes(key));
    if (extras.length > 0) return { error: `add 有未知字段: ${extras.join(', ')}` };
    const { text, plan, blueprint, kind, target, current, total, unit } = body;
    if (typeof text !== 'string' || text.trim() === '') return { error: 'add.text 要一句话,不能空' };
    if (blueprint !== undefined && blueprint !== null && typeof blueprint !== 'string') {
      return { error: 'add.blueprint 要一个蓝图键(字符串)' };
    }
    const key = typeof blueprint === 'string' ? blueprint.trim() : '';
    const trackingKind = optionalText(kind);
    const trackedTarget = optionalText(target);
    const trackedUnit = optionalText(unit);
    if (trackingKind !== null && typeof trackingKind === 'object') return { error: 'add.kind 要一个字符串' };
    if (trackedTarget !== null && typeof trackedTarget === 'object') return { error: 'add.target 要一个字符串' };
    if (trackedUnit !== null && typeof trackedUnit === 'object') return { error: 'add.unit 要一个字符串' };
    const hasProgress = current !== undefined || total !== undefined || trackedUnit !== null;
    const currentNumber = current === undefined ? 0 : nonNegativeNumber(current);
    const totalNumber = total === undefined || total === null ? null : nonNegativeNumber(total);
    if (currentNumber === null) return { error: 'add.current 要一个非负数' };
    if (total !== undefined && total !== null && totalNumber === null) return { error: 'add.total 要一个非负数' };
    const parsedPlan = parseGoalPlan(plan);
    if ('error' in parsedPlan) return parsedPlan;
    return {
      kind: 'add',
      text: text.trim(),
      blueprint: key === '' ? null : key,
      trackingKind,
      target: trackedTarget,
      progress: hasProgress
        ? { current: currentNumber, total: totalNumber, unit: trackedUnit }
        : null,
      plan: parsedPlan,
    };
  }
  if (which === 'revise') {
    const value=args.revise;
    if(!value || typeof value!=='object' || Array.isArray(value))return {error:'revise requires slot, expectedRevision, text, plan and reason'};
    const r=value as Record<string,unknown>;
    if(Object.keys(r).some(k=>!['slot','expectedRevision','text','plan','reason'].includes(k)))return {error:'Unknown revision field'};
    if(!Number.isInteger(r.slot) || Number(r.slot)<1 || Number(r.slot)>GOAL_SLOTS || !Number.isInteger(r.expectedRevision) || Number(r.expectedRevision)<1)
      return {error:'Invalid goal slot or expectedRevision'};
    if(typeof r.text!=='string' || !r.text.trim() || r.text.length>2000 || typeof r.reason!=='string' || !r.reason.trim() || r.reason.length>2000)
      return {error:'Revision requires bounded text and reason'};
    const plan=parseGoalPlan(r.plan);if('error' in plan)return plan;
    return {kind:'revise',slot:Number(r.slot),expectedRevision:Number(r.expectedRevision),text:r.text.trim(),plan,reason:r.reason.trim()};
  }
  if (which === 'milestone' || which === 'reopen') {
    const body = args[which];
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return { error: `${which} 要一个 {slot,step,${which === 'milestone' ? 'judgment' : 'reason'}} 对象` };
    }
    const record = body as Record<string, unknown>;
    const allowed = which === 'milestone' ? ['slot', 'step', 'judgment'] : ['slot', 'step', 'reason'];
    const extras = Object.keys(record).filter((key) => !allowed.includes(key));
    if (extras.length > 0) return { error: `${which} 有未知字段: ${extras.join(', ')}` };
    const slot = record.slot;
    const step = record.step;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > GOAL_SLOTS) {
      return { error: `${which}.slot 要一个 1..${GOAL_SLOTS} 的槽位号` };
    }
    if (typeof step !== 'number' || !Number.isInteger(step) || step < 1) {
      return { error: `${which}.step 要一个从 1 开始的里程碑号` };
    }
    const note = optionalText(record[which === 'milestone' ? 'judgment' : 'reason']);
    if (note === null || typeof note === 'object') {
      return { error: `${which}.${which === 'milestone' ? 'judgment' : 'reason'} 要一句说明` };
    }
    return which === 'milestone'
      ? { kind: which, slot, step, judgment: note }
      : { kind: which, slot, step, reason: note };
  }
  const n = args[which];
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > GOAL_SLOTS) {
    return { error: `${which} 要一个 1..${GOAL_SLOTS} 的槽位号,给的是 ${JSON.stringify(n)}` };
  }
  return { kind: which, slot: n };
}

/** 查询那一份:列全,每条带登记时长。不带过夜提醒 —— 看一眼不是写 */
function renderGoalQuery(list: readonly MinecraftGoal[], now: number, note?: BlueprintNote): string {
  if (list.length === 0) {
    return `暂态里一条目标都没有(${GOAL_SLOTS} 格全空)。`
      + '要接着上次干,从你的笔记里读回来重新挂(mc_goal 的 add)。';
  }
  return [
    `挂着 ${list.length} 条(共 ${GOAL_SLOTS} 格):`,
    ...list.flatMap((g) => {
      const head = `${goalLine(g, note)} —— ${goalAge(g, now)}`;
      return [
        head,
        ...g.plan.steps.map((step, index) => {
          const state = step.state === 'verified' ? '机械旁证符合'
            : step.state === 'judged' ? '已判断' : '待完成';
          return `  ${index + 1}. [${state}] ${step.do}`;
        }),
      ];
    }),
  ].join('\n');
}

/**
 * 结案时那句对账提示(不绑蓝图的条目)。**只跟 done**:add/drop 都不提 ——
 * 结论落笔的时刻只有一个,别处提就是噪音。
 */
const GOAL_DONE_CHECK_HINT = '结案前想对一眼世界的话,mc_check 能按断言对账。';

/** mc_blocked 一次报几条。留一屏能读完的量,账本本身留一倍(见 executor BLOCKED_LOG_MAX) */
const BLOCKED_READOUT_MAX = 5;

/**
 * 绑了蓝图的条目 done 时那份现场 diff。**不拦 done** —— 干没干完是她的裁决,
 * 系统只把账摊开:对上多少格、缺哪几格、冲突多少格。
 */
type GoalSurvey = (key: string) => string | null;

/** 「其余 N 条没动」:照 mc_policy 本周的 diff 口径,回执只说这一次发生了什么 */
function restText(list: readonly MinecraftGoal[]): string {
  return list.length === 0 ? '别的没有了' : `其余 ${list.length} 条没动`;
}

/**
 * 就地更新目标表并以 diff 回执；done 与 drop 分别表示完成和放弃。
 * 仅成功写入时附过夜提醒。
 */
export function applyGoal(
  table: GoalTable,
  op: GoalOp,
  stamp: GoalStamp,
  note?: BlueprintNote,
  survey?: GoalSurvey,
): string {
  if (op.kind === 'query') return renderGoalQuery(table.list, stamp.at, note);
  if (op.kind === 'add') {
    const used = new Set(table.list.map((g) => g.slot));
    const slot = Array.from({ length: GOAL_SLOTS }, (_, i) => i + 1).find((n) => !used.has(n));
    if (slot === undefined) {
      return `${GOAL_SLOTS} 格全占着,这条没挂上——先 done 或 drop 一条。\n`
        + renderGoalQuery(table.list, stamp.at, note);
    }
    const goal: MinecraftGoal = {
      slot, revision:1,
      text: op.text,
      blueprint: op.blueprint,
      kind: op.trackingKind,
      target: op.target,
      // 绑了蓝图就只有一套账:计数器那一套当场丢掉,不进表
      progress: op.blueprint ? null : op.progress,
      plan: op.plan,
      ...stamp,
    };
    table.list.push(goal);
    table.list.sort((a, b) => a.slot - b.slot);
    const rest = table.list.filter((g) => g.slot !== slot);
    const dropped = op.blueprint && op.progress
      ? `(计数没收:这条的进度以蓝图游标为准)` : '';
    return `这次挂上 ${goalLine(goal, note)}${dropped};${restText(rest)}。${PWSR_OVERNIGHT_NOTE}`;
  }
  const hit = table.list.find((g) => g.slot === op.slot);
  if (!hit) {
    return `#${op.slot} 那一格本来就空着,什么都没动。\n${renderGoalQuery(table.list, stamp.at, note)}`;
  }
  if(op.kind==='revise') {
    const revision=hit.revision??1;
    if(revision!==op.expectedRevision)return `#${op.slot} 未修订：expectedRevision ${op.expectedRevision} 与当前 ${revision} 不符。`;
    const before=structuredClone({text:hit.text,plan:hit.plan,revision});
    hit.text=op.text;hit.plan=op.plan;hit.revision=revision+1;
    return JSON.stringify({protocol:'agent-mc/v1',kind:'goal-revision',goalId:`${hit.slot}:${hit.at}:${hit.realTime}`,
      hostAuthored:true,reason:op.reason,before,after:{text:hit.text,plan:hit.plan,revision:hit.revision},goalCompleted:false});
  }
  if (op.kind === 'milestone') {
    const result = recordGoalJudgment(hit.plan, op.step, op.judgment, stamp.at);
    if (!result.ok) return `#${op.slot} 判断没登记：${result.error}。`;
    const next = result.next ? `；下一步 #${result.completed + 1} ${result.next.do}` : '；全部步骤已登记，仍要现读机械旁证后才能 done';
    return `这次登记 #${op.slot} 第 ${op.step}/${result.total} 项现场判断：${op.judgment}${next}。${PWSR_OVERNIGHT_NOTE}`;
  }
  if (op.kind === 'reopen') {
    const result = reopenGoalJudgment(hit.plan, op.step);
    if (!result.ok) return `#${op.slot} 没有重开：${result.error}。`;
    return `这次重开 #${op.slot} 第 ${op.step}/${result.total} 项判断（${op.reason}）；进度回到 ${result.completed}/${result.total}。${PWSR_OVERNIGHT_NOTE}`;
  }
  if (op.kind === 'done') {
    const issue = goalPlanDoneIssue(hit.plan);
    if (issue) return `#${op.slot} 还不能结案：${issue}。`;
  }
  table.list = table.list.filter((g) => g.slot !== op.slot);
  const verb = op.kind === 'done'
    ? hit.plan.steps.some(step => step.judgment)
      ? '已按宿主判断结案；判断原文已登记，系统未独立证明目标完成'
      : '已按现场条件核验结案；只证明所列条件，不判定条件与目标的语义关系'
    : '撤了(不是干完,是不干了)';
  // 蓝图那一条的游标摆在最前面:她按这个数决定"这算不算干完"
  const head = hit.blueprint
    ? `蓝图「${hit.blueprint}」现在${note?.(hit.blueprint) ?? '待装载'};` : '';
  // 结案的那一刻是结论落进笔记之前最后一次能对账的时刻:绑了图就摊现场的账,
  // 没绑图就只说一句这条路存在。撤掉(drop)不提 —— 那本来就不是一个结论。
  // 对不上世界(没连上服务器)时不硬凑一份账,那一行整个不出现。
  const reckoning = op.kind !== 'done' ? null
    : hit.blueprint ? survey?.(hit.blueprint) ?? null
      : GOAL_DONE_CHECK_HINT;
  const tail = reckoning === null ? '' : `\n${reckoning}`;
  return `${head}${goalBody(hit)} ${verb},${goalAge(hit, stamp.at)};${restText(table.list)}。`
    + PWSR_OVERNIGHT_NOTE + tail;
}

/**
 * 目标表陈旧的判定线:表非空、这么久没有任何一次 mc_goal 写入,而且这中间 World
 * 真的做完了活。三条都成立才是「在干活却没记账」;少了第三条,单纯的"她在跟观众
 * 聊天"也会被判成陈旧。
 */
export const GOAL_STALE_MS = 45 * 60_000;
export const GOAL_STALE_TASKS = 3;
/** 响过一次之后的冷却;她不记账就每 45 分钟再提一次,由每小时预算兜底 */
export const GOAL_STALE_COOLDOWN_MS = 45 * 60_000;
/** 更新类提醒的每小时预算。超了静默跳过 —— 补一句"我本来还想提醒"就是又一条提醒 */
export const GOAL_NOTICE_HOURLY_CAP = 2;

/**
 * 陈旧提醒的措辞:说清多久没动、这中间做完了几件活、最上面那条还挂着。
 * **只陈述,不指派** —— 要不要记、记哪一条是她的事。
 */
export function staleGoalNotice(list: readonly MinecraftGoal[], sinceMs: number, tasks: number): string {
  const mins = Math.round(sinceMs / 60_000);
  const top = list[0];
  const rest = list.length > 1 ? `(另有 ${list.length - 1} 条)` : '';
  return `目标表 ${mins} 分钟没动了,这中间做完了 ${tasks} 件活;${goalBody(top)} 还挂着${rest}。`;
}

/** 目标表在「暂态:」现状一行里那一段 */
function goalTableStatus(t: GoalTable, note?: BlueprintNote): string {
  if (t.list.length === 0) return '目标 0 条';
  return `目标 ${t.list.length} 条(${t.list.map((g) => goalLine(g, note)).join(' · ')})`;
}

/** 目标表的登记项:骨架按 realm 存它,公告与现状一行的措辞在这里 */
export const GOAL_TABLE_DECL: PwsrTableDecl<GoalTable> = {
  key: 'goals',
  create: () => ({ list: [] }),
  cleared: (t) => (t.list.length === 0 ? null : `${t.list.length} 条目标`),
  status: (t) => goalTableStatus(t),
  hint: 'mc_goal',
};

// mc_map：路标表。

/**
 * 路标格数上限。24 是"一张地图记得住的地方"这个量级 —— 它是她的地名表,
 * 不是坐标数据库;真要记满一整个世界,那份东西属于她的笔记。
 */
export const MAP_SLOTS = 24;

/**
 * kind 词表初版。收口成有限词表不是为了管她,是因为**核验与危险区都按 kind 分流**:
 * 床/箱/工作站能对世界查证,危险区带半径参与受理刻的陈述,其余只是分类。
 * 她写词表外的词当场退回并把词表念给她,不静默改成"地标"(静默归类 = 她记的东西
 * 变成了另一样东西)。
 */
export const MAP_KINDS = [
  '家', '床', '箱', '工作站', '危险区', '资源点', '门户', '农田', '地标',
] as const;
type MapKind = (typeof MAP_KINDS)[number];

/** 一处路标。`name` 是主键 —— 她按名字认地方,槽位号在这里没有意义 */
export interface MinecraftMark {
  name: string;
  /** 坐标所属维度；空间距离只在同维度内计算。 */
  dimension: string;
  pos: [number, number, number];
  kind: MapKind;
  note: string | null;
  /** 危险区的半径(格);别的 kind 上没有意义,恒为 null */
  radius: number | null;
  /** 登记那一刻的毫秒戳 */
  at: number;
}

interface MapTable {
  list: MinecraftMark[];
}

/** 「工作站」认哪些方块 */
const MARK_STATION_BLOCKS = new Set([
  'crafting_table', 'furnace', 'blast_furnace', 'smoker', 'brewing_stand',
  'enchanting_table', 'anvil', 'chipped_anvil', 'damaged_anvil', 'smithing_table',
  'grindstone', 'loom', 'cartography_table', 'fletching_table', 'stonecutter',
  'composter', 'cauldron', 'lectern', 'beacon', 'campfire', 'soul_campfire',
]);

/**
 * 能对世界查证的那几类 kind → 那一格该是什么方块。
 *
 * 危险区、资源点、家、地标这些**不可查证**:世界里没有一格叫"危险",核不了就
 * 老实不核。查得了的才对账 —— 装载回执的价值全在这一句上(「你登记的旧箱那格
 * 现在是空气」),而假装核过了比不核更贵。
 */
const MARK_VERIFY: Partial<Record<MapKind, (blockName: string) => boolean>> = {
  床: (n) => n.endsWith('_bed'),
  箱: (n) => n === 'chest' || n === 'trapped_chest' || n === 'barrel'
    || n === 'ender_chest' || n.endsWith('shulker_box'),
  工作站: (n) => MARK_STATION_BLOCKS.has(n),
};

/**
 * 一格方块的读数来源:区块没加载 / 读不到时给 `null`,读到了给方块 id
 * (空气也是一个读数,给 `'air'`)。没连上服务器时整个句柄为 null。
 */
export type BlockPeek = (pos: readonly [number, number, number]) => string | null;

/** 一条路标的核验结论 */
type MarkVerdict = 'ok' | 'mismatch' | 'unloaded' | 'other-dimension' | 'unchecked';

interface MarkCheck {
  mark: MinecraftMark;
  verdict: MarkVerdict;
  /** 对不上时那一格现在是什么(中文名);其余为 null */
  found: string | null;
}

/** 逐条对世界查证。不可查证的 kind 一律 `unchecked`,不硬凑一个结论 */
export function checkMark(m: MinecraftMark, peek: BlockPeek | null, currentDimension?: string | null): MarkCheck {
  if (currentDimension && normalizeDimension(m.dimension) !== normalizeDimension(currentDimension)) {
    return { mark: m, verdict: 'other-dimension', found: null };
  }
  const match = MARK_VERIFY[m.kind];
  if (!match) return { mark: m, verdict: 'unchecked', found: null };
  if (!peek) return { mark: m, verdict: 'unloaded', found: null };
  const name = peek(m.pos);
  if (name === null) return { mark: m, verdict: 'unloaded', found: null };
  if (match(name)) return { mark: m, verdict: 'ok', found: null };
  return { mark: m, verdict: 'mismatch', found: zhName(name) };
}

/**
 * 核验那一段回执。对上的只报个数(对上是常态,逐条念是噪音),对不上的**逐条点名**
 * —— 那正是她需要动笔改笔记的那几条。没加载的说没加载,不含糊成"没找到"。
 */
function renderMarkChecks(checks: readonly MarkCheck[]): string | null {
  const ok = checks.filter((c) => c.verdict === 'ok');
  const bad = checks.filter((c) => c.verdict === 'mismatch');
  const off = checks.filter((c) => c.verdict === 'unloaded');
  const elsewhere = checks.filter((c) => c.verdict === 'other-dimension');
  const bits: string[] = [];
  if (ok.length > 0) bits.push(`${ok.length} 处对上了`);
  for (const c of bad) {
    bits.push(`「${c.mark.name}」登记的是${c.mark.kind},那一格现在是${c.found}`);
  }
  if (off.length > 0) {
    bits.push(`${off.map((c) => `「${c.mark.name}」`).join('')}`
      + `${off.length > 1 ? '那几格' : '那一格'}区块没加载,没法核`);
  }
  if (elsewhere.length > 0) {
    bits.push(`${elsewhere.map((c) => `「${c.mark.name}」`).join('')}`
      + `${elsewhere.length > 1 ? '分属别的维度' : `在${zhDimension(elsewhere[0].mark.dimension)}`},当前维度没核`);
  }
  return bits.length > 0 ? `核对了一遍:${bits.join(';')}。` : null;
}

/**
 * 「在你东北边 82 格」/「在你下方 40 格」/「就在你脚下」;拿不到她的位置时 null。
 * 高低差按世界快照 `whereIs` 那一套(±3 格才点出上下),两处口径不该不一样。
 */
export function markBearing(
  from: Vec3like | null | undefined,
  pos: readonly [number, number, number],
): string | null {
  if (!from) return null;
  const d = Math.round(Math.hypot(from.x - pos[0], from.y - pos[1], from.z - pos[2]));
  if (d === 0) return '就在你脚下';
  const dy = pos[1] - from.y;
  const vertical = dy >= 3 ? '上方' : dy <= -3 ? '下方' : '';
  const dir = bearing(pos[0] - from.x, pos[2] - from.z);
  if (!dir) return `在你正${vertical || '上下'} ${d} 格`;
  return `在你${DIRECTION_ZH[dir]}边${vertical} ${d} 格`;
}

/**
 * 路标回读；from 提供方向与距离，clock 为 note 附登记时刻。
 * note 记录登记时的观察，不代表世界当前状态。
 */
function markLine(m: MinecraftMark, from?: Vec3like | null, clock?: (ms: number) => string): string {
  const radius = m.radius !== null ? `,半径 ${m.radius} 格` : '';
  const stamp = m.note && clock ? ` · 记于 ${clock(m.at)}` : '';
  const note = m.note ? `,${m.note}${stamp}` : '';
  const where = markBearing(from, m.pos);
  return `「${m.name}」${m.kind} [${zhDimension(m.dimension)}] (${m.pos[0]}, ${m.pos[1]}, ${m.pos[2]})${radius}${note}`
    + `${where ? ` —— ${where}` : ''}`;
}

/**
 * 相对化只在这个半径内做。再远的「离『家』1400 格」不是参照物,是噪音 ——
 * 她读到的应该是"这儿离哪个我知道的地方近",没有近的就什么都不说。
 */
export const MARK_NEAR_MAX = 256;

/** 离这一点最近的那处路标;一处都没有、或最近的也超出 `MARK_NEAR_MAX` 时 null */
export function nearestMark(
  list: readonly MinecraftMark[],
  pos: Vec3like,
  dimension?: string,
): { mark: MinecraftMark; distance: number } | null {
  let best: { mark: MinecraftMark; distance: number } | null = null;
  for (const m of list) {
    if (dimension && normalizeDimension(m.dimension) !== normalizeDimension(dimension)) continue;
    const d = Math.hypot(pos.x - m.pos[0], pos.y - m.pos[1], pos.z - m.pos[2]);
    if (best === null || d < best.distance) best = { mark: m, distance: d };
  }
  return best !== null && best.distance <= MARK_NEAR_MAX ? best : null;
}

/**
 * 坐标旁边那一句相对化:「离『新家』82 格」。`approx` 给上界一类的估算用
 * (「走满时离『家』约 130 格」)—— 是不是估算必须写在字面上。
 */
export function nearMarkText(
  list: readonly MinecraftMark[],
  pos: Vec3like,
  approx = false,
  dimension?: string,
): string | null {
  const hit = nearestMark(list, pos, dimension);
  if (!hit) return null;
  return `离「${hit.mark.name}」${approx ? '约 ' : ''}${Math.round(hit.distance)} 格`;
}

/** 这一点落进了她标的哪几个危险区(带半径的才算;没标半径的危险区只是一个点) */
export function dangerZonesAt(list: readonly MinecraftMark[], pos: Vec3like, dimension?: string): MinecraftMark[] {
  return list.filter((m) => m.kind === '危险区' && m.radius !== null
    && (!dimension || normalizeDimension(m.dimension) === normalizeDimension(dimension))
    && Math.hypot(pos.x - m.pos[0], pos.y - m.pos[1], pos.z - m.pos[2]) <= m.radius);
}

type MapOp =
  | { kind: 'query' }
  | { kind: 'set'; marks: Array<Omit<MinecraftMark, 'at'>>; notes: string[] }
  | { kind: 'drop'; name: string }
  | { kind: 'rename'; from: string; to: string };

/**
 * 一条 set 入参 → 一处路标(不带时间戳);错了当场说清是第几条、哪个字段。
 *
 * `dimension` 缺省不再整条驳回:重启后她按笔记批量装载的旧地图整批没有这个字段,
 * 硬性必填会把整份地图挡在门外。缺省按主世界记,并在回执里把这件事说出来
 * —— 默认值不许是静默的(下界/末地的坐标被记成主世界比没记更贵)。
 */
function parseMark(
  raw: unknown,
  where: string,
  noDimension: string[],
): Omit<MinecraftMark, 'at'> | { error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: `${where}要一个 {name, pos, kind} 对象` };
  }
  const { name, dimension, pos, kind, note, radius } = raw as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim() === '') return { error: `${where}的 name 要一个名字,不能空` };
  if (!Array.isArray(pos) || pos.length !== 3 || pos.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
    return { error: `${where}的 pos 要 [x, y, z] 三个数,给的是 ${JSON.stringify(pos)}` };
  }
  if (dimension !== undefined && dimension !== null && typeof dimension !== 'string') {
    return { error: `${where}的 dimension 要写维度名(overworld/the_nether/the_end)` };
  }
  const dimensionGiven = typeof dimension === 'string' && dimension.trim() !== '';
  if (typeof kind !== 'string' || !(MAP_KINDS as readonly string[]).includes(kind)) {
    return { error: `${where}的 kind 只收这几个词:${MAP_KINDS.join('/')};给的是 ${JSON.stringify(kind)}` };
  }
  if (note !== undefined && note !== null && typeof note !== 'string') {
    return { error: `${where}的 note 要一句话(字符串)` };
  }
  if (radius !== undefined && radius !== null
    && (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0)) {
    return { error: `${where}的 radius 要一个正数(格)` };
  }
  const text = typeof note === 'string' ? note.trim() : '';
  if (!dimensionGiven) noDimension.push(name.trim());
  return {
    name: name.trim(),
    dimension: dimensionGiven ? normalizeDimension(dimension as string) : 'minecraft:overworld',
    pos: [Math.floor(pos[0] as number), Math.floor(pos[1] as number), Math.floor(pos[2] as number)],
    kind: kind as MapKind,
    note: text === '' ? null : text,
    // 半径只在危险区上有意义:别的 kind 上收了也不知道该拿它做什么,不留
    radius: kind === '危险区' && typeof radius === 'number' ? Math.round(radius) : null,
  };
}

/**
 * `{}` = 查询;`{set}`(单条或数组=批量装载)/ `{drop}` / `{rename}` 各是一次语义写。
 * 一次只受理一件事 —— 与 mc_goal 同一条规矩。
 */
export function parseMap(args: Record<string, unknown>): MapOp | { error: string } {
  const given = (['set', 'drop', 'rename'] as const).filter((k) => args[k] !== undefined && args[k] !== null);
  if (given.length === 0) return { kind: 'query' };
  if (given.length > 1) {
    return { error: `一次只受理一件事,这次给了 ${given.join(' 和 ')};分开调用` };
  }
  const which = given[0];
  if (which === 'drop') {
    const n = args.drop;
    if (typeof n !== 'string' || n.trim() === '') return { error: 'drop 要一个路标名字' };
    return { kind: 'drop', name: n.trim() };
  }
  if (which === 'rename') {
    const r = args.rename;
    if (typeof r !== 'object' || r === null || Array.isArray(r)) return { error: 'rename 要一个 {from, to} 对象' };
    const { from, to } = r as Record<string, unknown>;
    if (typeof from !== 'string' || from.trim() === '') return { error: 'rename.from 要一个现有的路标名字' };
    if (typeof to !== 'string' || to.trim() === '') return { error: 'rename.to 要一个新名字' };
    return { kind: 'rename', from: from.trim(), to: to.trim() };
  }
  const raw = Array.isArray(args.set) ? args.set : [args.set];
  if (raw.length === 0) return { error: 'set 给的是空数组,没有可登记的东西' };
  const marks: Array<Omit<MinecraftMark, 'at'>> = [];
  const noDimension: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const one = parseMark(raw[i], raw.length > 1 ? `第 ${i + 1} 条` : 'set ', noDimension);
    if ('error' in one) return one;
    marks.push(one);
  }
  const dup = marks.map((m) => m.name).find((n, i, all) => all.indexOf(n) !== i);
  if (dup !== undefined) return { error: `这一批里「${dup}」出现了两次;一个名字只能有一处` };
  // 缺维度的那几条一句话说完:批量装载 20 条就刷 20 行提醒等于没提醒
  const notes = noDimension.length > 0
    ? [`${noDimension.length} 条没写 dimension(${noDimension.join('、')}),按主世界记的;`
      + '在下界/末地的那几处要重记一次并写明 dimension。']
    : [];
  return { kind: 'set', marks, notes };
}

/** 受理一次 mc_map 要的三样外部读数 */
interface MapContext {
  at: number;
  /** 当前维度；没连上时为 null，只展示记录而不计算跨维度距离。 */
  dimension: string | null;
  /** 她此刻站在哪(查询时算距离与方向用);没连上时 null */
  me: Vec3like | null;
  /** 世界核验的读数口;没连上时 null(那时如实说核不了) */
  peek: BlockPeek | null;
  /** 毫秒戳 → 挂钟 HH:MM:SS;note 的登记时刻按它渲染 */
  clock: (ms: number) => string;
}

function samePos(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** 用掉几格起把格数写进登记回执:撞上限不该是登记那一刻才知道的事 */
export const MAP_SLOTS_TIGHT = 20;

/** 「24 格已用 21」;还宽裕的时候一个字都不说 */
function slotsLeftNote(used: number): string {
  return used >= MAP_SLOTS_TIGHT ? `(${MAP_SLOTS} 格已用 ${used})` : '';
}

/** 查询那一份:列全,每条带方向与距离。不带过夜提醒 —— 看一眼不是写 */
function renderMapQuery(
  list: readonly MinecraftMark[],
  me: Vec3like | null,
  dimension: string | null,
  clock?: (ms: number) => string,
): string {
  if (list.length === 0) {
    return `暂态里一处路标都没有(${MAP_SLOTS} 格全空)。`
      + '要接着上次那份地图,从你的笔记里读回来一次 set 批量装载(set 收数组)。';
  }
  return [
    `记着 ${list.length} 处(共 ${MAP_SLOTS} 格)${me ? '' : ',这会儿没连上服务器,方向和距离算不出来'}:`,
    ...list.map((m) => markLine(
      m,
      dimension && normalizeDimension(m.dimension) === normalizeDimension(dimension) ? me : null,
      clock,
    )),
  ].join('\n');
}

/**
 * 受理一次 mc_map,就地改表并给回执。
 *
 * 回执 diff 式(与 mc_goal 同口径):只说这一次发生了什么,不全量复述。
 * 真写进去了才带过夜提醒 —— 满格、名字不存在这些没写成的路不提醒。
 */
function applyMap(table: MapTable, op: MapOp, ctx: MapContext): string {
  if (op.kind === 'query') return renderMapQuery(table.list, ctx.me, ctx.dimension, ctx.clock);
  if (op.kind === 'set') {
    // 同一坐标只占一个路标名，改名通过 rename。
    const clashes: string[] = [];
    const marks = op.marks.filter((one) => {
      const owner = table.list.find((m) => m.name !== one.name
        && normalizeDimension(m.dimension) === normalizeDimension(one.dimension)
        && samePos(m.pos, one.pos));
      if (!owner) return true;
      clashes.push(`「${one.name}」没登记:(${one.pos.join(', ')}) 已登记为「${owner.name}」`
        + `(${owner.kind});想换名先 drop 或 rename。`);
      return false;
    });
    // 缺维度提醒与撞坐标提醒同走回执抬头:她读到的第一行就是「这次没照原样收下什么」
    const heads = [...op.notes, ...clashes];
    const clashText = heads.length > 0 ? `${heads.join('\n')}\n` : '';
    if (marks.length === 0) return `${clashText}${renderMapQuery(table.list, ctx.me, ctx.dimension, ctx.clock)}`;
    const room = MAP_SLOTS - table.list.filter((m) => !marks.some((n) => n.name === m.name)).length;
    if (marks.length > room) {
      return `${clashText}${MAP_SLOTS} 格里只剩 ${Math.max(0, room)} 格,这一批 ${marks.length} 条一条都没登记`
        + `(要么先 drop 几处,要么分批交)。\n${renderMapQuery(table.list, ctx.me, ctx.dimension, ctx.clock)}`;
    }
    const added: MinecraftMark[] = [];
    const changed: Array<{ before: MinecraftMark; after: MinecraftMark }> = [];
    for (const one of marks) {
      const mark: MinecraftMark = { ...one, at: ctx.at };
      const idx = table.list.findIndex((m) => m.name === mark.name);
      if (idx >= 0) {
        changed.push({ before: table.list[idx], after: mark });
        table.list[idx] = mark;
      } else {
        added.push(mark);
        table.list.push(mark);
      }
    }
    const checks = [...added, ...changed.map((c) => c.after)]
      .map((m) => checkMark(m, ctx.peek, ctx.dimension));
    const head = marks.length > 1
      ? `这次装载 ${marks.length} 处:${added.length > 0 ? `新记 ${added.length} 处` : ''}`
        + `${added.length > 0 && changed.length > 0 ? '、' : ''}${changed.length > 0 ? `改了 ${changed.length} 处` : ''}。`
        + `\n${[...added, ...changed.map((c) => c.after)].map((m) => markLine(m)).join('\n')}`
      : added.length > 0
        ? `这次记下 ${markLine(added[0])}。`
        : `「${changed[0].after.name}」改了:${markLine(changed[0].before)} → ${markLine(changed[0].after)}。`;
    const rest = table.list.length - marks.length;
    const tail = rest > 0 ? `其余 ${rest} 处没动。` : '别的没有了。';
    const verified = renderMarkChecks(checks);
    return `${clashText}${head}${verified ? `\n${verified}` : ''}${tail}${slotsLeftNote(table.list.length)}`
      + PWSR_OVERNIGHT_NOTE;
  }
  if (op.kind === 'drop') {
    const hit = table.list.find((m) => m.name === op.name);
    if (!hit) {
      return `没有叫「${op.name}」的路标,什么都没动。\n${renderMapQuery(table.list, ctx.me, ctx.dimension, ctx.clock)}`;
    }
    table.list = table.list.filter((m) => m.name !== op.name);
    const rest = table.list.length;
    return `${markLine(hit)} 撤了。${rest > 0 ? `其余 ${rest} 处没动。` : '别的没有了。'}`
      + PWSR_OVERNIGHT_NOTE;
  }
  const hit = table.list.find((m) => m.name === op.from);
  if (!hit) return `没有叫「${op.from}」的路标,什么都没动。\n${renderMapQuery(table.list, ctx.me, ctx.dimension, ctx.clock)}`;
  if (op.from === op.to) return `「${op.from}」本来就叫这个名字,什么都没动。`;
  if (table.list.some((m) => m.name === op.to)) {
    return `已经有一处叫「${op.to}」了,没改名(一个名字只能有一处)。\n${renderMapQuery(table.list, ctx.me, ctx.dimension, ctx.clock)}`;
  }
  hit.name = op.to;
  return `「${op.from}」改名叫「${op.to}」了:${markLine(hit)}。${PWSR_OVERNIGHT_NOTE}`;
}

/**
 * 世界快照的路标行:只报数与前几个名字,不念坐标(那份清单归 mc_map 的查询)。
 * 与目标尾行同一条规矩,空表照样渲染;已用格数写成 N/24,撞上限不该是个意外。
 */
export function mapSnapshotLine(list: readonly MinecraftMark[]): string {
  if (list.length === 0) return `路标:0 处(${MAP_SLOTS} 格全空,用 mc_map 记)`;
  const head = list.slice(0, 6).map((m) => `「${m.name}」`).join('');
  return `路标:${list.length}/${MAP_SLOTS} 处(${head}${list.length > 6 ? '等' : ''})`;
}

/** 路标表在「暂态:」现状一行里那一段。24 处全念太长,前 6 个名字加个「等」 */
function mapTableStatus(t: MapTable): string {
  if (t.list.length === 0) return '路标 0 处';
  const head = t.list.slice(0, 6).map((m) => `「${m.name}」`).join('');
  return `路标 ${t.list.length} 处(${head}${t.list.length > 6 ? '等' : ''})`;
}

/** 路标表的登记项:骨架按 realm 存它,公告与现状一行的措辞在这里 */
export const MAP_TABLE_DECL: PwsrTableDecl<MapTable> = {
  key: 'marks',
  create: () => ({ list: [] }),
  cleared: (t) => (t.list.length === 0 ? null : `${t.list.length} 处地点`),
  status: (t) => mapTableStatus(t),
  hint: 'mc_map',
};

// mc_blueprint：蓝图设计与施工绑定。

/**
 * 蓝图设计（palette、矩阵、编译产物）全局缓存并落盘，跨世界复用。
 * 施工绑定（锚点、游标）按 realmKey 隔离；旧世界绑定保留，切回后可继续访问。
 * PwsrTables 只登记公告与现状视图，不持有设计数据。
 */
interface BlueprintDesign {
  key: string;
  name: string | null;
  /** 每次保存都新建；同内容重复保存也是两个版本。 */
  versionId: string;
  /** 规范化矩阵的 SHA-256；标签、时间与施工进度不参与。 */
  contentHash: string;
  /** 后台构思交稿时绑定不可变 job id；前台直接保存为 null。 */
  sourceJobId: string | null;
  blueprint: NormalizedBlueprint;
  plan: BlueprintPlan;
  metrics: VoxelMetrics;
  savedAt: number;
  /** 本进程从 data/ 缓存装回来的(连接回执要把这件事说出来) */
  restored: boolean;
}

/** 施工游标反映上次施工的进度，不持续回读世界；回执须注明读数时点。 */
const CURSOR_AS_OF = '截至上次施工';

/** 一张图在某个世界里的施工绑定。游标 = 已完成的 IR 步数(从头连着那些) */
interface BlueprintBinding {
  dimension: string;
  anchor: PositionXYZ;
  cursor: number;
  at: number;
  survey: BlueprintSurvey | null;
  startedAt: number | null;
}

/** 缓存文件里一份设计的样子:palette 编码,与她交上来的 save 同形 */
interface CachedBlueprint {
  key: string;
  name: string | null;
  savedAt: number;
  version_id?: string;
  content_hash?: string;
  source_job_id?: string | null;
  size_xyz: SizeXYZ;
  site_mode?: 'new' | 'retrofit';
  axis_order: string;
  palette: string[];
  layers: number[][][];
}

interface BlueprintCacheFile {
  version: 3;
  designs: CachedBlueprint[];
  /** realmKey → dimension → 键 → 绑定 */
  sites: Record<string, Record<string, Record<string, BlueprintBinding>>>;
}

/**
 * 规范化蓝图 → palette 编码(落盘用)。索引矩阵避免重复写完整状态串，读回时
 * 原路再走一遍受理管线。
 */
export function encodeBlueprint(bp: NormalizedBlueprint): Omit<CachedBlueprint, 'key' | 'name' | 'savedAt'> {
  const index = new Map<string, number>();
  const palette: string[] = [];
  const layers = bp.layers.map((layer) => layer.map((row) => row.map((state) => {
    let at = index.get(state);
    if (at === undefined) {
      at = palette.length;
      index.set(state, at);
      palette.push(state);
    }
    return at;
  })));
  return {
    size_xyz: [...bp.size_xyz],
    site_mode: bp.site_mode,
    axis_order: AXIS_ORDER,
    palette,
    layers,
  };
}

/** 三分账单要的两栏库存;账本口径全是「上次看见」,措辞照此 */
interface BlueprintStock {
  carried: Record<string, number>;
  stored: Record<string, number>;
}

/**
 * 蓝图表:装载的设计 + 各世界的施工绑定 + data/ 缓存。
 *
 * 落盘生态照 chests.json 那一份(同步写、坏文件当没有、file=null 时纯内存)。
 */
export class BlueprintBook {
  protected readonly designs = new Map<string, BlueprintDesign>();
  protected readonly sites = new Map<string, Map<string, Map<string, BlueprintBinding>>>();
  /** 当前世界的命名空间键;空串 = 还没认过世界(她连上之前交的图落在这里) */
  protected currentRealm = '';
  protected currentDimension = 'minecraft:overworld';

  constructor(
    protected readonly file: string | null,
    /** 三分账单的两栏库存;拿不到(没连上服务器)给空表 */
    protected readonly stock: () => BlueprintStock = () => ({ carried: {}, stored: {} }),
    protected readonly warn: (msg: string, data?: unknown) => void = () => {},
  ) {
    this.load();
  }

  /** 切到某个世界的施工命名空间(旧世界那一份原样留着) */
  useRealm(key: string, dimension = 'minecraft:overworld'): void {
    this.currentRealm = key;
    this.currentDimension = normalizeDimension(dimension);
  }

  get realm(): string {
    return this.currentRealm;
  }

  get dimension(): string {
    return this.currentDimension;
  }

  get(key: string): BlueprintDesign | undefined {
    return this.designs.get(key);
  }

  list(): BlueprintDesign[] {
    return [...this.designs.values()].sort((a, b) => a.savedAt - b.savedAt);
  }

  keys(): string[] {
    return this.list().map((d) => d.key);
  }

  /** 本进程从缓存装回来的份数(连接回执那一句) */
  restoredCount(): number {
    return this.list().filter((d) => d.restored).length;
  }

  /** 受理成功的一份进表 + 落盘。同键覆盖 = 重出图,施工绑定跟着作废(图变了,进度不算数) */
  save(label: BlueprintLabel, accepted: {
    blueprint: NormalizedBlueprint;
    plan: BlueprintPlan;
    metrics: VoxelMetrics;
  }, identity: BlueprintVersionIdentity = createBlueprintVersion(accepted.blueprint), sourceJobId: string | null = null,
  at = Date.now()): BlueprintDesign {
    if (!identity.versionId.trim() || identity.contentHash !== blueprintContentHash(accepted.blueprint)) {
      throw new Error('蓝图版本身份与规范化内容不一致');
    }
    const design: BlueprintDesign = {
      key: label.key,
      name: label.name,
      versionId: identity.versionId,
      contentHash: identity.contentHash,
      sourceJobId,
      blueprint: accepted.blueprint,
      plan: accepted.plan,
      metrics: accepted.metrics,
      savedAt: at,
      restored: false,
    };
    const replaced = this.designs.has(label.key);
    this.designs.set(label.key, design);
    if (replaced) {
      for (const dimensions of this.sites.values()) {
        for (const space of dimensions.values()) space.delete(label.key);
      }
    }
    this.persist();
    return design;
  }

  /** 卸载一份:设计连缓存一起删,各世界的施工绑定跟着没(设计没了,进度无处可依) */
  unload(key: string): { had: boolean; boundHere: boolean } {
    const had = this.designs.delete(key);
    const boundHere = this.space(this.currentRealm, this.currentDimension).delete(key);
    for (const dimensions of this.sites.values()) {
      for (const space of dimensions.values()) space.delete(key);
    }
    if (had || boundHere) this.persist();
    return { had, boundHere };
  }

  binding(key: string): BlueprintBinding | undefined {
    return this.sites.get(this.currentRealm)?.get(this.currentDimension)?.get(key);
  }

  /** 首次开工登记锚点(realm 域);再给一个不同的锚点 = 换地方重盖,游标归零 */
  bind(key: string, anchor: PositionXYZ, at = Date.now()): void {
    const prev = this.binding(key);
    const moved = !prev || prev.anchor.some((v, i) => v !== anchor[i]);
    this.space(this.currentRealm, this.currentDimension).set(key, {
      dimension: this.currentDimension,
      anchor: [...anchor] as PositionXYZ,
      cursor: moved ? 0 : prev.cursor,
      at,
      survey: moved ? null : prev.survey,
      startedAt: moved ? at : (prev.startedAt ?? at),
    });
    this.persist();
  }

  /** 改造模式只登记探测锚点与现场账，不把它算作开工。 */
  survey(key: string, anchor: PositionXYZ, result: BlueprintSurvey): void {
    const prev = this.binding(key);
    const moved = !prev || prev.anchor.some((v, i) => v !== anchor[i]);
    this.space(this.currentRealm, this.currentDimension).set(key, {
      dimension: this.currentDimension,
      anchor: [...anchor] as PositionXYZ,
      cursor: moved ? 0 : prev.cursor,
      at: result.at,
      survey: result,
      startedAt: moved ? null : prev.startedAt,
    });
    this.persist();
  }

  /**
   * 进度游标写回。**纯机械变化**:落盘归落盘,回执那边一个字都不许催她写笔记
   * (PWSR 收紧第二条)。
   */
  progress(key: string, cursor: number): void {
    const prev = this.binding(key);
    if (!prev || prev.cursor === cursor) return;
    this.space(this.currentRealm, this.currentDimension).set(key, { ...prev, cursor });
    this.persist();
  }

  siteFacts(): string {
    const lines = this.list().flatMap(design => {
      const bound = this.binding(design.key);
      if (!bound) return [];
      const far = bound.anchor.map((n, axis) => n + design.blueprint.size_xyz[axis] - 1);
      return [`key=${JSON.stringify(design.key)} 版本=${design.versionId}，原点 (${bound.anchor.join(', ')})，` +
        `设计方块范围 (${bound.anchor.join(', ')})–(${far.join(', ')})，` +
        `施工游标 ${bound.cursor}/${design.plan.steps.length}（${CURSOR_AS_OF}）`];
    });
    return lines.length
      ? `当前维度的已绑定蓝图设计记录：\n${lines.join('\n')}\n现场缺口用 checks:[{blueprint:对应key}] 对账；设计范围与施工游标各有来源，现场完成须核验。`
      : '当前维度没有已绑定的蓝图设计记录。';
  }

  /** 目标行尾巴那一句(goalLine 的 BlueprintNote);没装载返回 null */
  noteOf(key: string): string | null {
    const design = this.designs.get(key);
    if (!design) return null;
    const bound = this.binding(key);
    const cursor = bound?.cursor ?? 0;
    const progress = blueprintProgress(design.plan.steps, cursor);
    if (bound && bound.startedAt !== null && progress.steps.done >= progress.steps.total) {
      return `已施工完(${CURSOR_AS_OF})`;
    }
    const short = this.shortest(design, cursor);
    const miss = short ? `,还缺${zhName(short.item)} ${short.missing}` : '';
    if (!bound) return `已装载,还没开工${miss}`;
    if (bound.startedAt === null) {
      const conflicts = (bound.survey?.wrongBlock ?? 0) + (bound.survey?.shouldBeAir ?? 0);
      return `已初探,还没开工${conflicts > 0 ? `,冲突 ${conflicts} 格` : ''}${miss}`;
    }
    return `已施工 ${Math.round(progress.ratio * 100)}%(${CURSOR_AS_OF})${miss}`;
  }

  /** 剩余步里缺得最狠的那一样;不缺料返回 null */
  shortest(design: BlueprintDesign, cursor: number): BlueprintBillLine | null {
    const stock = this.stock();
    const bill = billForSteps(design.plan.steps.slice(cursor), stock);
    return bill.lines.find((line) => line.missing > 0) ?? null;
  }

  /** 「暂态:」现状一行里蓝图那一段 */
  statusNote(realm: string): string {
    const all = this.list();
    if (all.length === 0) return '蓝图 0 份';
    const restored = this.restoredCount();
    const each = all.map((d) => {
      const bound = this.sites.get(realm)?.get(this.currentDimension)?.get(d.key);
      const progress = blueprintProgress(d.plan.steps, bound?.cursor ?? 0);
      const how = !bound
        ? '还没开工'
        : bound.startedAt === null
          ? `已初探${bound.survey
            ? `(冲突 ${bound.survey.wrongBlock + bound.survey.shouldBeAir} 格)`
            : ''},还没开工`
        : progress.steps.done >= progress.steps.total ? '已施工完' : `已施工 ${Math.round(progress.ratio * 100)}%`;
      return `${d.key} ${how}`;
    });
    return `蓝图 ${all.length} 份(${restored > 0 ? `缓存 ${restored} 份已装回;` : ''}${each.join('、')})`;
  }

  /**
   * 换世界公告里蓝图那一句。**下桌的只有施工进度**:设计没有世界性,
   * 跨世界原样留着 —— 这两件事必须在同一句话里说清,不然她会以为图也没了。
   */
  clearedNote(realm: string): string | null {
    const bound = [...(this.sites.get(realm)?.values() ?? [])].reduce((n, space) => n + space.size, 0);
    if (bound === 0) return null;
    return `${bound} 处蓝图施工进度(设计 ${this.designs.size} 份还在,跨世界留着,只是这边的进度不算数)`;
  }

  stat(): string {
    const n = this.designs.size;
    const spaces = [...this.sites.values()].filter((dimensions) =>
      [...dimensions.values()].some((space) => space.size > 0)).length;
    const where = spaces > 0 ? `,施工绑定分布在 ${spaces} 个世界` : '';
    if (!this.file || !existsSync(this.file)) return n === 0 ? '(无文件)' : `${n} 份(未落盘)${where}`;
    let kb = '?';
    try {
      kb = (statSync(this.file).size / 1024).toFixed(1);
    } catch { /* 读不到大小不值得报错 */ }
    return `${n} 份 / ${kb}KB${where}`;
  }

  clear(): string {
    const n = this.designs.size;
    this.designs.clear();
    this.sites.clear();
    if (this.file) {
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        writeFileSync(this.file, `${JSON.stringify({ version: 3, designs: [], sites: {} })}\n`, 'utf8');
      } catch (e) {
        this.warn('蓝图缓存清空失败', { err: String(e) });
      }
    }
    return n === 0 ? '蓝图表本来就是空的' : `蓝图表已清空(${n} 份设计连施工绑定一起)`;
  }

  protected space(realm: string, dimension: string): Map<string, BlueprintBinding> {
    let dimensions = this.sites.get(realm);
    if (!dimensions) {
      dimensions = new Map();
      this.sites.set(realm, dimensions);
    }
    const dim = normalizeDimension(dimension);
    let space = dimensions.get(dim);
    if (!space) {
      space = new Map();
      dimensions.set(dim, space);
    }
    return space;
  }

  protected load(): void {
    if (!this.file || !existsSync(this.file)) return;
    let data: BlueprintCacheFile;
    try {
      const raw = readFileSync(this.file, 'utf8').trim();
      if (!raw) return;
      data = JSON.parse(raw) as BlueprintCacheFile;
    } catch (e) {
      this.warn('蓝图缓存读不出来,按没有处理', { err: String(e) });
      return;
    }
    for (const cached of data.designs ?? []) {
      // 原路再走一遍受理:registry 换了版本、格式改了口径,这里就是唯一的把关处
      const accepted = acceptBlueprint(cached);
      if (!accepted.ok || !accepted.blueprint || !accepted.plan || !accepted.metrics) {
        this.warn('蓝图缓存里有一份现在过不了校验,没装回', {
          key: cached?.key, why: accepted.failures[0]?.reason,
        });
        continue;
      }
      this.designs.set(cached.key, {
        key: cached.key,
        name: cached.name ?? null,
        ...(() => {
          const contentHash = blueprintContentHash(accepted.blueprint!);
          const cachedIdentityValid = typeof cached.version_id === 'string'
            && cached.version_id.trim() !== ''
            && cached.content_hash === contentHash;
          if (cached.version_id && !cachedIdentityValid) {
            this.warn('蓝图缓存的版本身份与内容摘要对不上,按实际内容重建身份', { key: cached.key });
          }
          return {
            versionId: cachedIdentityValid ? cached.version_id! : createBlueprintVersionId(),
            // 缓存中的摘要只作诊断数据；装回时以规范化内容重算，避免身份与内容脱节。
            contentHash,
            sourceJobId: cachedIdentityValid && typeof cached.source_job_id === 'string'
              ? cached.source_job_id
              : null,
          };
        })(),
        blueprint: accepted.blueprint,
        plan: accepted.plan,
        metrics: accepted.metrics,
        savedAt: typeof cached.savedAt === 'number' ? cached.savedAt : Date.now(),
        restored: true,
      });
    }
    const restore = (
      bind: Partial<BlueprintBinding>,
    ): Omit<BlueprintBinding, 'dimension'> | null => {
      if (!Array.isArray(bind?.anchor) || bind.anchor.length !== 3) return null;
      return {
        anchor: [Number(bind.anchor[0]), Number(bind.anchor[1]), Number(bind.anchor[2])],
        cursor: typeof bind.cursor === 'number' ? bind.cursor : 0,
        at: typeof bind.at === 'number' ? bind.at : Date.now(),
        survey: bind.survey && typeof bind.survey === 'object' ? bind.survey : null,
        startedAt: bind.startedAt === null
          ? null
          : typeof bind.startedAt === 'number'
            ? bind.startedAt
            : (typeof bind.at === 'number' ? bind.at : Date.now()),
      };
    };
    for (const [realm, dimensions] of Object.entries(data.sites ?? {})) {
      for (const [dimension, binds] of Object.entries(dimensions)) {
        const dim = normalizeDimension(dimension);
        const space = this.space(realm, dim);
        for (const [key, bind] of Object.entries(binds)) {
          const restored = restore(bind);
          if (restored) space.set(key, { ...restored, dimension: dim });
        }
      }
    }
  }

  protected persist(): void {
    if (!this.file) return;
    const out: BlueprintCacheFile = {
      version: 3,
      designs: this.list().map((d) => ({
        key: d.key,
        name: d.name,
        savedAt: d.savedAt,
        version_id: d.versionId,
        content_hash: d.contentHash,
        source_job_id: d.sourceJobId,
        ...encodeBlueprint(d.blueprint),
      })),
      sites: Object.fromEntries(
        [...this.sites].map(([realm, dimensions]) => [
          realm,
          Object.fromEntries(
            [...dimensions].filter(([, space]) => space.size > 0)
              .map(([dimension, space]) => [dimension, Object.fromEntries(space)]),
          ),
        ]).filter(([, dimensions]) => Object.keys(dimensions as object).length > 0),
      ),
    };
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, `${JSON.stringify(out)}\n`, 'utf8');
    } catch (e) {
      this.warn('蓝图缓存落盘失败', { err: String(e) });
    }
  }
}

/** 交稿格式那一段。认知档的 brief 读这一份;交上来的东西过同一个 save。 */
const BLUEPRINT_FORMAT_DOC = [
  '交稿格式(Palette 方案),整份是一个 JSON 对象:',
  '{"key":"<键>","name":"<人话名字>","site_mode":"new|retrofit","size_xyz":[X,Y,Z],"axis_order":"YZX",',
  ' "palette":["minecraft:air","minecraft:oak_planks","minecraft:oak_stairs[facing=north,half=bottom]"],',
  ' "layers":[ 第0层, 第1层, … ]}',
  '· layers[y][z][x] 是 palette 的整数索引;实际画出的矩阵是尺寸权威,size_xyz 写偏会按实测尺寸登记并在回执说明;',
  '· y=0 是最低层(地面那层),X 从西到东,Z 从北到南;',
  '· site_mode 必须选:new=空地新建;retrofit=在现有结构上改,第一次 build 只探测不动方块。'
    + '两种一样:矩阵里有冲突格就得审阅后带 confirm:true 才清掉,谁都不会自动清场;',
  '· palette 写完整的 Java block-state 串,带属性就整串写;不写属性会按 1.20.6 的默认值补;',
  `· 不限某一条边;palette 编码后的整份输出 ≤${BLUEPRINT_MAX_OUTPUT_CHARS} 字符,超了按层 append 也不会绕过总预算;`,
  '· 不属于设计的格默认用 minecraft:structure_void(保留原状);minecraft:air 只表示明确清空,施工仍需 confirm:true;',
  '· 水/岩浆源、耕地、土径、age=0 作物、火会编译成桶/工具/种植动作;'
    + '刷怪塔、农场、陷阱坑与红石机构都按最终方块状态画进同一张图;',
  '· 流动液体、成熟作物等过程状态不收;传送门等没有可靠施工动作的状态仍会点名拒收;',
  '· 门、床这类占两格的:只写主部件那一格与它的从部件(上半格/床头),两格都要在矩阵里对得上。',
  BLUEPRINT_SUPPORT_DOC,
].join('\n');

/** 蓝图工具的用法说明(schema description) */
const BLUEPRINT_DOC = [
  '六件事,一次只受理一件:',
  '· {"design":{"key":"farm-v2","brief":"要什么结构或功能,写清楚"}} —— 交给后台去构思。',
  '  立刻回执"开工了",几分钟后成没成都会浮上来。同键再下一次 = 带新要求重出图。',
  '· {"save":{…}} —— 交一份现成的设计;',
  '  太大就分批:每批带同样的 key/size_xyz/palette,加 "append":true,layers 只放接着的几层。'
    + '分批齐了先成为 draft,不会替换当前可执行版本。',
  '· {"accept":{"key":"farm-v2","version_id":"…","content_hash":"…"}} —— '
    + '核对回执里的版本与摘要后,把完整 draft 提升成当前可执行版本。',
  '· {"reserve_override":{"reason":"紧急脱困","ttl_sec":30,"max_blocks":8}} —— '
    + '限时借用蓝图保留料;原因、时效和最大块数缺一不可,用后标记需补料。',
  '· {} —— 看现在装载着哪几份、施工到哪儿了、还缺什么。',
  '· {"unload":"home-v2"} —— 卸掉一份(设计连缓存一起没,本世界的施工进度也没)。',
  '装载着的图用 mc_do 的 build 施工:{"skill":"build","blueprint":"farm-v2","at":[x,y,z]}。',
  BLUEPRINT_MATERIAL_NOTE,
  'retrofit 首次只做初探。两种工地同待遇:有冲突格就要审阅无误后同锚点加 "confirm":true,'
    + '才会清掉那些格再施工——没有哪一种会自动清场。',
  '',
  BLUEPRINT_FORMAT_DOC,
].join('\n');

/**
 * 语义写(save / unload)之后那句提醒。**只跟增删改**:施工进度、锚点这类机械变化
 * 一个字都不催(PWSR 收紧第二条)。设计本身能跨重启,所以这句说的是"记键",
 * 不是"要丢了"。
 */
const BLUEPRINT_OVERNIGHT_NOTE = '\n(键和一句描述记进你的笔记;整份数据别抄进去,那是这边的活。)';

type BlueprintOp =
  | { kind: 'query' }
  | {
      kind: 'save'; submission: Record<string, unknown>; label: BlueprintLabel; append: boolean;
      jobId: string | null; versionId: string | null;
    }
  | { kind: 'design'; key: string; name: string | null; brief: string }
  | { kind: 'accept'; key: string; versionId: string; contentHash: string }
  | { kind: 'reserveOverride'; reason: string; ttlMs: number; maxBlocks: number }
  | { kind: 'unload'; key: string };

/** `{}` = 查询；其余顶层字段各是一次写，一次只受理一个。 */
export function parseBlueprintArgs(args: Record<string, unknown>): BlueprintOp | { error: string } {
  const given = (['save', 'design', 'accept', 'reserve_override', 'unload'] as const)
    .filter((k) => args[k] !== undefined && args[k] !== null);
  if (given.length === 0) return { kind: 'query' };
  if (given.length > 1) {
    return { error: `一次只受理一件事,这次给了 ${given.join(' 和 ')};分开调用` };
  }
  const which = given[0];
  if (which === 'unload') {
    const key = typeof args.unload === 'string' ? args.unload.trim() : '';
    if (!key) return { error: 'unload 要一个蓝图键(字符串)' };
    return { kind: 'unload', key };
  }
  const raw = args[which];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: `${which} 要一个对象` };
  }
  const body = raw as Record<string, unknown>;
  if (which === 'reserve_override') {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const ttlSec = body.ttl_sec;
    const maxBlocks = body.max_blocks;
    if (!reason) return { error: 'reserve_override.reason 要写明这次为什么必须动蓝图保留料' };
    if (!Number.isSafeInteger(ttlSec) || (ttlSec as number) < 1 || (ttlSec as number) > 600) {
      return { error: 'reserve_override.ttl_sec 要 1..600 秒的整数' };
    }
    if (!Number.isSafeInteger(maxBlocks) || (maxBlocks as number) < 1 || (maxBlocks as number) > 64) {
      return { error: 'reserve_override.max_blocks 要 1..64 的整数' };
    }
    return { kind: 'reserveOverride', reason, ttlMs: (ttlSec as number) * 1000, maxBlocks: maxBlocks as number };
  }
  let label: BlueprintLabel;
  try {
    label = validateBlueprintLabel(body);
  } catch (e) {
    const err = e as { path?: string; reason?: string; message?: string };
    return { error: `${which}.${err.path ?? '?'}: ${err.reason ?? err.message ?? '写法不对'}` };
  }
  if (which === 'design') {
    const brief = typeof body.brief === 'string' ? body.brief.trim() : '';
    if (!brief) return { error: 'design.brief 要一段话:这项结构或工程要什么样,你自己说清楚' };
    return { kind: 'design', key: label.key, name: label.name, brief };
  }
  if (which === 'accept') {
    const versionId = typeof body.version_id === 'string' ? body.version_id.trim() : '';
    const contentHash = typeof body.content_hash === 'string' ? body.content_hash.trim().toLowerCase() : '';
    if (!versionId) return { error: 'accept.version_id 要照 draft 回执原样填写' };
    if (!/^[0-9a-f]{64}$/.test(contentHash)) return { error: 'accept.content_hash 要照 draft 回执填写 64 位摘要' };
    return { kind: 'accept', key: label.key, versionId, contentHash };
  }
  const jobId = typeof body.job_id === 'string' && body.job_id.trim() ? body.job_id.trim() : null;
  const versionId = typeof body.version_id === 'string' && body.version_id.trim() ? body.version_id.trim() : null;
  return { kind: 'save', submission: body, label, append: body.append === true, jobId, versionId };
}

/** 分批 save 的缓冲：层数按声明的 Y 齐了才进入完整 draft。 */
interface BlueprintStreamDraft {
  kind: 'stream';
  versionId: string;
  sourceJobId: string | null;
  label: BlueprintLabel;
  size: SizeXYZ;
  siteMode: 'new' | 'retrofit';
  paletteKey: string;
  palette: unknown[];
  layers: unknown[];
  at: number;
}

/** 完整但尚未提升的版本；只可按 version id + content hash 精确接受。 */
interface BlueprintReadyDraft extends BlueprintVersionIdentity {
  kind: 'ready';
  sourceJobId: string | null;
  label: BlueprintLabel;
  blueprint: NormalizedBlueprint;
  plan: BlueprintPlan;
  metrics: VoxelMetrics;
  repairText: string;
  at: number;
}

interface BlueprintDesignJob {
  id: string;
  key: string;
  at: number;
  baseVersionId: string | null;
  baseGeneration: number;
  outputVersionId: string | null;
}

/** 一份提交里 size_xyz 的浅读(分批要在受理之前就知道总层数) */
function readSize(value: unknown): SizeXYZ | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const nums = value.map((v) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null));
  return nums.every((n): n is number => n !== null) ? [nums[0], nums[1], nums[2]] : null;
}

/**
 * 每一批的廉价形状检查:行数、每行格数、索引在不在 palette 里。
 * 精确到 `layers[y][z][x]`——分批的错要能当场指出来,不能攒到最后一批才说。
 */
function checkLayerShape(
  layer: unknown,
  y: number,
  size: SizeXYZ,
  paletteSize: number,
): string | null {
  if (!Array.isArray(layer)) return `layers[${y}]: 这一层应该是一个数组`;
  if (layer.length !== size[2]) return `layers[${y}]: 这一层应有 ${size[2]} 行(Z),给了 ${layer.length} 行`;
  for (let z = 0; z < layer.length; z++) {
    const row: unknown = layer[z];
    if (!Array.isArray(row)) return `layers[${y}][${z}]: 这一行应该是一个数组`;
    if (row.length !== size[0]) {
      return `layers[${y}][${z}]: 这一行应有 ${size[0]} 格(X),给了 ${row.length} 格`;
    }
    for (let x = 0; x < row.length; x++) {
      const cell: unknown = row[x];
      if (!Number.isSafeInteger(cell)) return `layers[${y}][${z}][${x}]: 这一格应该是 palette 的整数索引`;
      const index = cell as number;
      if (index < 0 || index >= paletteSize) {
        return `layers[${y}][${z}][${x}]: palette 索引 ${index} 越界,对照表只有 0..${paletteSize - 1}`;
      }
    }
  }
  return null;
}

/** 受理失败时那一串精确错误路径;原样回给生成侧自纠 */
function renderBlueprintFailures(failures: readonly BlueprintStateFailure[]): string {
  const shown = failures.slice(0, 12);
  const lines = shown.map((f) => `· ${f.path}${f.state ? `(${f.state})` : ''}: ${f.reason}`);
  const more = failures.length > shown.length ? `\n(还有 ${failures.length - shown.length} 条同类,先改这些)` : '';
  return `${lines.join('\n')}${more}`;
}

/** 用料 top:「橡木木板 96、圆石 60、玻璃 24」 */
function materialsTop(plan: BlueprintPlan, top = 3): string {
  const lines = billForSteps(plan.steps).lines
    .sort((left, right) => right.need - left.need || left.item.localeCompare(right.item))
    .slice(0, top);
  return lines.length === 0
    ? '无需施工物品'
    : lines.map((line) => `${zhName(line.item)} ${line.need}`).join('、');
}

function blueprintVoidCounts(blueprint: NormalizedBlueprint): { clear: number; preserve: number } {
  let clear = 0;
  let preserve = 0;
  forEachCell(blueprint, (_x, _y, _z, state) => {
    if (isStructureVoidState(state)) preserve++;
    else if (isAirState(state)) clear++;
  });
  return { clear, preserve };
}

function blueprintModeText(blueprint: NormalizedBlueprint): string {
  return blueprint.site_mode === 'new' ? '空地新建' : '现有结构改造';
}

/** 认知档的任务说明:她读到的是"World 交办的一件事",所以只说要办什么与怎么交稿 */
function blueprintDesignBrief(
  key: string,
  name: string | null,
  brief: string,
  previous = '',
  jobId = '',
): string {
  return [
    `设计一项 Minecraft 结构或工程,这一份的键是「${key}」${name ? `,名字叫「${name}」` : ''}。`,
    previous.trim() ? `这是同键修订轮。上一版与现场反馈:\n${previous.trim()}` : '',
    '',
    '我在主意识那一侧刚写下的要求原文:',
    '"""',
    brief.trim(),
    '"""',
    '',
    '若要求涉及外观、房间布局或既有建筑改造，可先用 mc_visual 看当前位置的真实画面；'
      + '看不到的背面和隐藏结构不要从截图臆测。图只给外观依据，方块与权限仍以现场试算为准。',
    `交稿 = 调 mc_blueprint 的 save 把设计交回来,key 必须是「${key}」。`,
    jobId ? `这轮构思的不可变 job_id 是「${jobId}」；每次 save 都必须原样带 job_id。` : '',
    '先根据需求选择 site_mode:new 用于空地新建;retrofit 用于在现有结构上修改。',
    '先把原要求逐项写成验收点，再确定外形、空间和功能，最后编码逐层矩阵；提交前对照矩阵核验，不能只在说明里声称已经画了。',
    '建筑按用途与原要求检查入口、门窗、室内可用空间、层间通路和屋顶：入口与通路能实际走通，居住空间留足两格净高；要求多层时楼梯连通各层。农场、轨道、红石等工程按自身功能验收，家具只按实际需求配置。',
    '屋顶的坡度、楼梯朝向和高差应与要求一致；门、床等多格部件要配对。材料和装饰形成一致风格，避免随机拼接。未知现场条件列为待核验，不能算作已满足。',
    BLUEPRINT_MATERIAL_NOTE,
    '交稿说明列出原要求与设计对应的位置、尚待现场验证的条件，以及适合本工程的施工阶段；每阶段写明需用物品和完成判据。可按地基、主体、屋顶、功能布置分段备料和施工，不以收齐整项工程全部材料为开工前提。',
    BLUEPRINT_FORMAT_DOC,
    'save 会当场校验:不过就把精确到某一格的错误回给你,照着改再交一次;',
    '一次交不下就分批(带 "append":true,layers 只放接着的几层,层数齐了自动收下)。',
    '**以「带本轮 job_id 的 save 成功」为准算交稿完成**;最后一段用第一人称写回(“我设计了……”),' +
      '说清我设计了什么、交了什么,它会原样浮到主意识那一侧。',
  ].join('\n');
}

/** 一处路标在工具面上的形状;`set` 单条与批量数组共用这一份 */
const MARK_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: '这地方叫什么,你说了算;名字就是主键,重名 = 改那一处。' },
    dimension: {
      type: 'string',
      description: '坐标所属维度:overworld / the_nether / the_end(或完整 minecraft: id)。'
        + '不写按主世界记,回执会点名是哪几条 —— 下界/末地的坐标一定要写。',
    },
    pos: {
      type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3,
      description: '[x, y, z] 整数格。',
    },
    kind: { type: 'string', enum: [...MAP_KINDS], description: '这地方是什么。' },
    note: { type: 'string', description: '一句备注(可不填)。' },
    radius: {
      type: 'integer',
      description: '只对危险区有用:圈多大(格)。标了半径,受理任务时目标点落进圈里我会说一声。',
    },
  },
  // dimension 缺省为主世界，并在回执注明；允许导入未带此字段的地图。
  required: ['name', 'pos', 'kind'],
} as const;

/**
 * mc_check 的用法说明。断言词汇全部复用别处已有的口径(方块名、蓝图键、路标名),
 * 不另立一套写法。
 */
const CHECK_DOC = [
  `一次最多 ${CHECK_MAX_ASSERTS} 条断言,写成 checks 数组。回执只报差异:符合的合并一句带过。`,
  '· {"at":[x,y,z],"is":"chest"} —— 这一格该是什么。只比方块种类,朝向、连接面不算数;'
    + '"is":"air" = 这格该空着。',
  '· {"box":[[x1,y1,z1],[x2,y2,z2]],"count":{"chest":4,"torch":">=8"}} —— 区域里各有几个。'
    + '整数 = 恰好,">=N" / "<=N" = 一侧的界。',
  '· {"box":…,"all":"oak_planks"} —— 区域里每一格都是它;{"box":…,"air":true} —— 区域里每一格都空着。',
  '· {"box":…,"sealed":true,"from":[x,y,z]} —— 这个盒子封不封得住(from 可不填,默认从盒中心起)。'
    + '水和岩浆按通路算(会灌进来),不当墙;漏口报盒内那一格。',
  '· {"inv":{"torch":">=8","bread":1}} —— 包里现有多少。物品名精确对(torch 只数火把,'
  + '不含灵魂火把);要数一整族就每样写一条。'
  + '值写成 {"enchant":"efficiency"} 就改问「带这个附魔的有几件」(默认至少一件,可加 "count")。',
  '· {"blueprint":"home-v2"} —— 这份图的工地现在对上多少格、缺哪几格。',
  '· {"mark":"熔炉"} —— 路标登记的东西那一格还在不在。',
  `区域断言一次最多 ${CHECK_BOX_CELL_CAP} 格,sealed 最多 ${CHECK_SEALED_VOLUME_CAP} 格;超了那一条不算,会说清。`,
  '只读已加载的区块:没加载的格照实说"没加载",既不算符合也不算不符——走近了再对一次。',
].join('\n');

/** 进程内 World 与引擎代理共用工具 schema 和 description；handler 各自接入。 */
/** 地图图标的中文名;表外的照英文 id 报 */
const MAP_ICON_ZH: Record<string, string> = {
  player: '玩家', player_off_map: '玩家(在图外)', player_off_limits: '玩家(远在图外)', frame: '物品展示框',
  red_marker: '红色标记', blue_marker: '蓝色标记', target_x: '目标 X', target_point: '目标点', red_x: '红叉(宝藏)',
  mansion: '林地府邸', monument: '海底神殿', village_desert: '沙漠村庄', village_plains: '平原村庄',
  village_savanna: '热带草原村庄', village_snowy: '雪原村庄', village_taiga: '针叶林村庄',
  jungle_temple: '丛林神庙', swamp_hut: '女巫小屋',
};

export const MINECRAFT_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  RAILWAY_TOOL_DECL,
  {
    name: 'mc_help',
    tags: ['read'],
    description:
      'Read Minecraft action skill documentation. Empty arguments return the complete compact '
      + 'directory with parameter signatures. Choose skill, or a short list of skills, to read their '
      + 'full examples and execution conditions. This reads the action registry without executing '
      + 'actions or contacting the server.',
    parameters: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: 'One action skill name from the directory.' },
        skills: { type: 'array', minItems: 1, maxItems: SKILL_HELP_MAX_SKILLS, uniqueItems: true,
          items: { type: 'string' }, description: 'Several action skill names; omit skill when using this.' },
      },
      required: [],
    },
  },
  {
    name: 'mc_script',
    tags: ['act'],
    description: 'Run an agent-authored JavaScript async function body with params and a restricted mc SDK. '
      + 'mc.state() returns {sampledAt,connectionGeneration,snapshot,flight,queue,combatActive,combat,method}. '
      + 'Read position, dimension, health, food, inventory and equipment under snapshot, which can be null. '
      + 'snapshot.entities is a bounded array of {entityId?,name,kind,distance,direction,dy,visible}; snapshot.entitiesOmitted reports truncation. '
      + 'snapshot.blocksScanned is false here; empty nearbyBlocks/terrain do not establish water depth or traversability. Missing fields are unknown observations. '
      + 'await mc.do(steps) submits one ordered group to the normal executor and waits for its actual terminal result: accepted, taskId, kind, done, receipt, steps and fresh state. '
      + 'A sent server command still needs observed effects; done is the executor result, not proof of an external quest. '
      + 'await mc.flightPlan(args) uses the same read-only geometry/budget contract as mc_flight_plan. '
      + 'Use JavaScript conditions, calculations and bounded loops to adapt to feedback. Prepare a timed route before casting; combine already-known cast/movement/blink steps with needs in one mc.do to avoid model delays. '
      + 'bot and Vec3 expose a bounded asynchronous transport for Mineflayer public primitives; use {api:"index"} then {api:"blockAt"}, {api:"activateItem"}, etc. for native signatures and differences. '
      + 'Native calls preserve the current hand and do not navigate or select tools. bot.blockAt returns Block|null with getProperties() for your own JavaScript result checks. '
      + 'The first native body call queues a body lease held until program end; after it, mc.do is unavailable in that program. Read calls do not acquire the body. '
      + 'No imports, process, filesystem, network or protected raw bot access. Calls must be awaited serially. '
      + `Limits: ${METHOD_LIMITS.sourceChars} source chars, ${METHOD_LIMITS.calls} SDK calls, ${METHOD_LIMITS.actions} action groups, default ${METHOD_LIMITS.durationMs}ms including queue waits, maximum ${METHOD_LIMITS.maxDurationMs}ms. `
      + 'Only one program runs at a time. New admitted body work, stop, death, disconnect, World stop or timeout revoke it and its own pending task. '
      + 'Returns a run id immediately; {runId} reads result and call summaries, {runId,call} expands one complete SDK call; {} lists the last eight run summaries, {stop:true} cancels the current run. '
      + '{validate:true,name,code} checks syntax without running any action. Program completion does not certify a learned method. '
      + 'Expand an SDK call to inspect its actual fields before interpreting results; compare the returned observations with the method objective before saving verified claims. '
      + 'Alternatively use {procedure:{handle,revision},params,validate?} to resolve and run a pinned agent-mc.procedure/v1 dependency graph (legacy cortico.procedure/v1 is also accepted) for adapter minecraft-method/v1. '
      + 'await methods.run(alias,params) composes only declared dependency versions; all share this program\'s budgets and body lease. Source is loaded directly from the selected blobs, without copying it through model context. '
      + 'Procedure terminal events carry an execution UUID and persistent receipt for explicit goal review/adoption by the owning Persona; completion alone is not proof of improvement.',
    parameters: { type: 'object', properties: {
      name: { type: 'string', minLength: 1, maxLength: 80 },
      code: { type: 'string', minLength: 1, maxLength: METHOD_LIMITS.sourceChars },
      procedure: { type: 'object', properties: { handle: { type: 'string' }, revision: { type: 'string' } }, required: ['handle', 'revision'] },
      params: { type: 'object', additionalProperties: true },
      durationMs: { type: 'integer', minimum: 1000, maximum: METHOD_LIMITS.maxDurationMs },
      validate: { type: 'boolean' }, runId: { type: 'integer', minimum: 1 },
      api: { type: 'string', description: 'index lists the program SDK and exposed Mineflayer API; mc.do/mc.state/mc.flightPlan or a native method name returns its result contract on demand.' },
      call: { type: 'integer', minimum: 1, maximum: METHOD_LIMITS.calls }, stop: { type: 'boolean' },
    }, required: [] },
  },
  {
    name: 'mc_do',
    tags: ['act'],
    description:
      'Queue an ordered group of Minecraft skills and return immediately with a task id. Known next steps in one intention can be submitted together; steps and queued tasks continue in the background without another model turn. Put a timed permission chat command and its planned movement in the same group, linked by needs. Flight waits up to 2 seconds for actual server permission; sending a command alone does not prove its effect. Use queue:"now" for immediate food or escape during combat; default submission waits for combat and replaces pending tasks. Start the group with eat, flee or surface to take control even during low-health combat. Environmental rescue still has priority. Use queue:"append" to add work after existing tasks. Use queue:"afterCheckpoint" to do this group at a safe checkpoint of current work, then resume that work; container and transaction groups wait until their operation is complete. Each task reports completion or obstruction as a minecraft.task event; a blocked task leaves later tasks queued. A single plain chat or vanilla /msg, /tell, /w to a named player, with default queue and no needs/expect, sends immediately while movement continues. Other slash commands and chat inside a multi-step group retain queue order.',
    parameters: {
      type: 'object',
      properties: {
        // items 是一份扁平字段池,由 skills.ts 注册表生成:每技能的必填与横向规则
        // 由签名与 mc_help 陈述,parseSteps 裁决(判别式 oneOf 见 stepSchemaOf 注释)
        steps: {
          type: 'array',
          description: SKILL_SIGNATURE_DOC,
          items: SKILL_STEP_SCHEMA,
        },
        queue: QUEUE_SCHEMA,
      },
      required: ['steps'],
    }
  },
  {
    name: 'mc_flight_plan',
    tags: ['read'],
    description: 'Preview a whole flight route before casting, without moving or consuming permission. Use subdivide:true to turn distant endpoints into short diagonal or vertical legs with executable dependent steps. Each point starts at the previous projected endpoint, including relative coordinates. Returns collisions, total time, budget fit and final support. Only loaded geometry is checked; execution revalidates. Unknown duration is not unlimited.',
    parameters: {
      type: 'object',
      properties: {
        points: { type: 'array', minItems: 1, maxItems: FLIGHT_PLAN_MAX_POINTS,
          items: { type: 'object', properties: {
            at: { anyOf: [{ type: 'string' }, { type: 'array', minItems: 3, maxItems: 3,
              items: { anyOf: [{ type: 'number' }, { type: 'string' }] } }] },
            land: { type: 'boolean', description: 'false=hover; default=true requires safe support at this point' },
          }, required: ['at'], additionalProperties: false } },
        budgetMs: { type: 'integer', minimum: 1,
          description: 'Available milliseconds from current server instructions, supplied by caller; does not grant or renew flight' },
        subdivide: { type: 'boolean', description: 'Split distant endpoints into client-sized legs; intermediate legs hover, each requested point keeps its land choice. Returns absolute mc_do steps with needs dependencies.' },
      },
      required: ['points'],
    },
  },
  {
    name: 'mc_scout',
    tags: ['read'],
    description:
      'Queue read-only observations and independent trials: probe, observe (native local voxels or collision rays), plus goto/flight/build/excavate/tunnel (always dry-run). Each trial uses the actual current position and world, without projecting an earlier trial destination or materials. needs gates on prior trial outcomes only, not hypothetical execution. Flight checks one segment before permission is granted; use mc_flight_plan for a projected multi-leg flight. Same queue and task events; does not change the world.',
    parameters: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: SCOUT_SKILL_DOC,
          items: SCOUT_STEP_SCHEMA,
        },
        // 同一条队列就是同一套三态:试算不该另有一份排队语义要记
        queue: QUEUE_SCHEMA,
      },
      required: ['steps'],
    },
  },
  {
    name: 'mc_visual',
    tags: ['read'],
    barrierAfter: true,
    description:
      'Capture the actual rendered Minecraft scene with time, location and physical readings. The host interprets the image. Inspect entrances and routes, visible player '
      + 'actions. background=true accepts one observation job immediately and later delivers its result as a minecraft.visual event; '
      + 'acceptance does not mean the image is ready. Only one observation may remain in flight, '
      + 'including synchronous calls; wait for its result instead of switching call modes to repeat it. '
      + 'Pending results arrive as events. A call made while an observation '
      + 'is pending ends the current decision turn; queued game actions keep running. Inspect '
      + 'combat situations, item icons and open menus, as well as buildings and landscapes. '
      + 'Compare fresh observations to check action results. include_hud includes the current game '
      + 'interface. A still image does not prove intent, motion or hidden facts; move to a useful vantage '
      + 'or compare another view when needed. '
      + 'This is observation only and never places or breaks blocks.',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string', enum: ['first', 'third', 'dungeon'],
          description: 'Camera view. first follows what is in front of you; third shows the surroundings and avatar; dungeon offers an overview. Default third.',
        },
        focus: {
          type: 'string', maxLength: 160,
          description: 'What you want to inspect: an entrance, nearby player, combat result, menu, item or building. This labels the observation; it does not move the camera.',
        },
        include_hud: { type: 'boolean', description: 'Include visible health, items, notices and open menus. Default false captures the 3D scene alone.' },
        raw: { type: 'boolean', description: 'Return the image directly instead of a separate focused observation. Default false.' },
        background: { type: 'boolean', description: 'Accept a background observation job and deliver its actual result in a minecraft.visual event. Analyzed reports retain saved image references; raw or fallback results include the image. Omitted follows the World visual.background setting (default false). Explicit false waits for the result. Local background waiting is capped at 75 seconds; a model request already running may finish later.' },
      },
      required: [],
    },
  },
  {
    // 规矩是常驻内部状态,不是外部世界,也不是记忆/工作区——`write` 是四个 tag 里唯一
    // 说得通的那个,同时保证它不进只读 fork 的装配。没有 barrierAfter:没有要复核的东西。
    name: 'mc_policy',
    tags: ['write'],
    description:
      'Set standing rules for how the work gets done in Minecraft. Takes effect immediately, '
      + 'does not queue behind tasks. Call with no fields to read the current rules back.',
    parameters: { ...POLICY_SCHEMA, description: POLICY_DOC },
  },
  {
    // 目标表与规矩同一档:常驻内部状态,不是外部世界也不是记忆 —— `write`。
    // 没有 barrierAfter:登记完没有要复核的世界事实。
    name: 'mc_goal',
    tags: ['write'],
    description:
      'Register and track what you are working towards in this world: up to five slots (#1..#5). '
      + 'Targets can be builds, gathered items, entity kills or captures, exploration, transport, farming, '
      + 'redstone work, survival time, or any other project. '
      + 'A verify condition must directly establish its milestone result. The evaluator only tests '
      + 'the supplied predicate; it does not check its semantic relevance. Use judgment with actual '
      + 'evidence for understood information, conversation and server command results. '
      + 'For observable position, inventory or entity conditions, use verify probes. A failed observation or a scan without a hit does not establish absence or safety. '
      + 'Judgment registration records the host claim; it is not independent world verification. '
      + 'Call with no fields to read them all back. Tied to the current world and empty after a restart '
      + 'or a world change, so the lasting copy belongs in your own notes.' + GOAL_CLOSURE_CONTRACT,
    parameters: {
      type: 'object',
      properties: {
        add: {
          type: 'object',
          description: '挂一条新目标并给出可核验的实施计划,落在最小的空格上;五格全占着就不挂。',
          properties: {
            text: { type: 'string', description: '一句话说清这条目标是什么。' },
            plan: GOAL_PLAN_SCHEMA,
            blueprint: {
              type: 'string',
              description: '这条目标对应的蓝图键(可不填)。绑了蓝图就不再收计数:'
                + '进度以蓝图游标为准,current/total/unit 会被丢掉。',
            },
            kind: {
              type: 'string',
              description: '可选追踪类型,自由写:建造/收集/击杀/捕获/探索/运输/种植/收获/红石/生存等。',
            },
            target: { type: 'string', description: '可选计数对象:物品、实体、地点、距离或工程阶段。' },
            current: { type: 'number', minimum: 0, description: '可选初始进度,默认 0。' },
            total: { type: 'number', minimum: 0, description: '可选目标总数。' },
            unit: { type: 'string', description: '可选单位,如 个/只/格/趟/分钟/阶段。' },
          },
          required: ['text', 'plan'],
        },
        revise: {type:'object',additionalProperties:false,required:['slot','expectedRevision','text','plan','reason'],
          description:'Host-authored revision of an existing goal; preserves identity and returns both original and replacement plans. New milestones require fresh evidence.',
          properties:{slot:{type:'integer',minimum:1,maximum:GOAL_SLOTS},expectedRevision:{type:'integer',minimum:1},
            text:{type:'string',minLength:1,maxLength:2000},reason:{type:'string',minLength:1,maxLength:2000},plan:GOAL_PLAN_SCHEMA}},
        milestone: {
          type: 'object',
          description: '完成当前最前面的 judgment 里程碑；机械里程碑不能用它代填。',
          properties: {
            slot: { type: 'integer', minimum: 1, maximum: GOAL_SLOTS },
            step: { type: 'integer', minimum: 1, maximum: 12 },
            judgment: { type: 'string', description: '现场复看后的明确判断及依据。' },
          },
          required: ['slot', 'step', 'judgment'],
        },
        reopen: {
          type: 'object',
          description: '显式撤回一项已经登记的 judgment 里程碑。',
          properties: {
            slot: { type: 'integer', minimum: 1, maximum: GOAL_SLOTS },
            step: { type: 'integer', minimum: 1, maximum: 12 },
            reason: { type: 'string', description: '为什么需要重新判断。' },
          },
          required: ['slot', 'step', 'reason'],
        },
        done: {
          type: 'integer',
          description: '明确结案,槽位号 1..5。plan 的每项里程碑都有新鲜旁证后才受理。',
        },
        drop: { type: 'integer', description: '这一格不干了(不是干完),槽位号 1..5。' },
      },
      required: [],
    },
  },
  {
    // 路标属于常驻内部状态，使用 write；set 自行核验世界事实，无 barrierAfter。
    // 工具只提供查询与写入；移动由 mc_do 的 goto 执行。
    name: 'mc_map',
    tags: ['write'],
    description:
      'Register dimension-tagged named places in this world: home, bed, chest, workstation, danger zone, resource spot, '
      + 'portal, farm, landmark — up to 24. Call with no fields to read them all back with the bearing '
      + 'and distance for places in your current dimension. Tied to the current world and empty after a restart '
      + 'or a world change, so the lasting copy belongs in your own notes.' + GOAL_CLOSURE_CONTRACT,
    parameters: {
      type: 'object',
      description: '一次只受理一件事。set 收数组 = 一次把笔记里那份地图整个装载回来。',
      properties: {
        // schema 中 set 一律为数组；受理侧也兼容单个对象。
        set: {
          type: 'array',
          items: MARK_SCHEMA,
          description: '登记路标:一条也写成一条的数组,一次交多条 = 把笔记里那份地图整个装载回来。'
            + '名字已经有了 = 改那一处。',
        },
        drop: { type: 'string', description: '撤掉这个名字的路标。' },
        rename: {
          type: 'object',
          description: '给一处路标改名。',
          properties: {
            from: { type: 'string', description: '现在的名字。' },
            to: { type: 'string', description: '改成的新名字。' },
          },
          required: ['from', 'to'],
        },
      },
      required: [],
    },
  },
  {
    // 蓝图与目标、规矩同一档:常驻内部状态。`write` 同时保证它不进只读 fork 的装配;
    // 没有 barrierAfter:save 的回执自己就说清了收没收下,没有另一份要复核的世界事实。
    name: 'mc_blueprint',
    tags: ['write'],
    description:
      'Design and hold Minecraft project blueprints: buildings, farms, mob systems, pits, redstone, '
      + 'and other functional structures. Submit a host-authored finished '
      + 'design, inspect what is loaded, or drop one. A loaded blueprint is what mc_do build works from. '
      + 'Designs survive a world change; how far one is built does not.',
    parameters: {
      type: 'object',
      description: BLUEPRINT_DOC,
      properties: {
        save: {
          type: 'object',
          description: '交一份现成的设计(Palette 方案;分批加 append:true)。后台构思必须带任务说明里的 job_id。',
          properties: {
            key: { type: 'string' },
            name: { type: 'string' },
            job_id: { type: 'string', description: '只给后台构思交稿：照任务说明里的不可变 job_id 原样填写。' },
            version_id: {
              type: 'string',
              description: '分批续交时照首批回执里的不可变 version_id 原样填写；首批不填。',
            },
            site_mode: {
              type: 'string', enum: ['new', 'retrofit'],
              description: 'new=空地新建;retrofit=先探测再改造现有结构。两种都不会自动清场。',
            },
            size_xyz: { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 },
            axis_order: { type: 'string', enum: ['YZX'], description: '轴序只有这一种;不写按它解释。' },
            palette: { type: 'array', items: { type: 'string' } },
            layers: {
              type: 'array',
              description: '满矩阵 layers[y][z][x],每个值是 palette 的整数索引。',
              items: {
                type: 'array',
                items: {
                  type: 'array',
                  items: { type: 'integer', minimum: 0 },
                },
              },
            },
            append: { type: 'boolean', description: '这一批接着上一批的层往后放。' },
          },
          // axis_order 仅支持 YZX；缺失时由 blueprint-repair 补齐并在回执注明，因此不列入 required。
          required: ['key', 'site_mode', 'size_xyz', 'palette', 'layers'],
        },
        accept: {
          type: 'object',
          description: '把完整 draft 提升成当前可执行版本；版本 id 与内容摘要都要照回执原样填写。',
          properties: {
            key: { type: 'string' },
            version_id: { type: 'string' },
            content_hash: { type: 'string' },
          },
          required: ['key', 'version_id', 'content_hash'],
        },
        reserve_override: {
          type: 'object',
          description: '紧急情况下限时借用蓝图保留料；首次实际借料后登记需补料。',
          properties: {
            reason: { type: 'string', description: '为什么这次必须动保留料。' },
            ttl_sec: { type: 'integer', minimum: 1, maximum: 600 },
            max_blocks: { type: 'integer', minimum: 1, maximum: 64 },
          },
          required: ['reason', 'ttl_sec', 'max_blocks'],
        },
        unload: { type: 'string', description: '卸掉这一份(设计连缓存一起没)。' },
      },
      required: [],
    },
  },
  {
    // 只读查询:同步返回,不进队列(排在正在做的那件事后面
    // 等于对的是那件事做完之后的世界,而她问的是现在)。
    name: 'mc_check',
    tags: ['read'],
    description:
      'Check what you believe against the world: hand in a list of assertions, get back only the differences. '
      + 'Read-only and instant: it never moves you and never touches the world, it only reads chunks that are '
      + 'already loaded. Use it before writing a conclusion (where something is, whether it exists, whether it '
      + 'worked) into your notes.',
    parameters: {
      type: 'object',
      description: CHECK_DOC,
      properties: {
        checks: {
          type: 'array',
          description: '一组断言;每条一个对象,形状见上。',
          items: { type: 'object' },
        },
      },
      required: ['checks'],
    },
  },
  {
    name: 'mc_view_map',
    tags: ['read'],
    description:
      'Look at a filled map you are carrying: returns the map picture (top = north/-z, right = east/+x) '
      + 'plus its id, scale, how much of it is explored, its world centre when readable, and every icon on it '
      + '(you, other players, banners, markers) with world coordinates. Read-only and instant. '
      + 'Without id it shows the map in your main hand, then off hand, then the first one in your bag.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: '地图编号(回执里的 #N);不写 = 手上那张,手上没有就包里第一张' },
      },
      required: [],
    },
  },
  /* 同轮且读数指纹相同的重复查询返回短回执。 */
  {
    name: 'mc_bag',
    tags: ['read', 'snapshot'],
    description:
      'Read your inventory right now: how many of the 36 slots are used, what is in them, '
      + 'what is in your hand, and what armour you are wearing. Read-only and instant — '
      + 'it never moves you, never touches the world and never touches the work queue. '
      + 'Set item to a material ID, Chinese material name, or exact custom display name to locate it in your inventory, the currently open container, and last observed chest records; '
      + 'closed virtual backpacks are not included, and chest records are historical until reopened. '
      + 'Ask this instead of re-submitting a task to find out what you are carrying. '
      + 'Once per turn: asking again in the same turn returns a one-line pointer to the answer above.',
    parameters: { type: 'object', properties: {
      item: { type: 'string', description: 'Optional focused stock lookup by material ID, Chinese material name, or exact custom display name.' },
    }, required: [] },
  },
  {
    name: 'mc_queue',
    tags: ['read', 'snapshot'],
    description:
      'Read the Minecraft work queue right now: the task being executed and which step it is on, '
      + 'the tasks waiting behind it, and how the most recent finished task ended. Read-only and '
      + 'instant — it changes nothing. Ask this instead of re-submitting a task to check progress. '
      + 'Once per turn: asking again in the same turn returns a one-line pointer to the answer above.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mc_blocked',
    tags: ['read', 'snapshot'],
    description:
      'Read the last few steps that did not work out: when, which task, which step, and the '
      + 'verbatim reason each one reported. Read-only and instant. Ask this instead of re-submitting '
      + 'a task to find out why it failed. '
      + 'Once per turn: asking again in the same turn returns a one-line pointer to the answer above.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mc_stop',
    tags: ['act'],
    description:
      'Clear the Minecraft work queue: stop what is being done right now and drop everything waiting behind it.',
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'mc_escape',
    tags: ['act'],
    description:
      'Cheat: teleport to the NEAREST safe anchor (your respawn bed/anchor, the world spawn, '
      + 'or a place you marked as 家/床 on mc_map) keeping all items, and clear the work queue. '
      + 'ONLY for getting genuinely unstuck — when movement or the task truly cannot make progress. '
      + 'It is NOT a way to travel: do not use it to get somewhere you could walk to. '
      + 'Say something to the audience first. The nearest anchor may still be far from here; '
      + 'the receipt lists every candidate with its distance and says which one it used.',
    parameters: { type: 'object', properties: {}, required: [] }
  },
];

/** Only generic Minecraft tools are declared here; server extensions supply their own tools. */
export function minecraftToolDecls(): ReadonlyArray<Omit<ToolDef, 'handler'>> { return MINECRAFT_TOOL_DECLS; }

/**
 * 服务端起来之后回读到的难度,说成她读得懂的一句。
 *
 * 只报两件事实:**这一刻的难度是什么**、**它是谁定的**。刷怪那一句是原版规则的机械
 * 换算(和平不刷敌对生物、也不掉血饿肚子),不是判断 —— 而它恰恰是难度这个数对她
 * 唯一有操作意义的后果。要不要改、改成什么,是操作员的事,这里一个字都不建议。
 *
 * 难度与 server.properties 对不上时两个数都念:能对上说明这一次是 properties 施加的
 * (启动时它一定会施加一次),对不上就是运行期被人改过,两种都得说清是哪一种。
 */
export function renderDifficultyFact(fact: MinecraftDifficultyFact): string {
  const props = fact.properties;
  if (!fact.difficulty) {
    return '服务器起来了,难度没问出来(往服务端问了一句 difficulty,它没回话)'
      + `${props ? `;server.properties 里写的是 ${props}` : ''}。`;
  }
  const source = props === null ? ''
    : props.toLowerCase() === fact.difficulty ? '(server.properties 所定)'
      : `(server.properties 里写的是 ${props},现在生效的是这个)`;
  const mobs = fact.difficulty === 'peaceful'
    ? '刷怪关,和平模式不刷敌对生物'
    : '刷怪开';
  return `服务器起来了,难度 ${fact.difficulty}${source},${mobs}。`;
}

export interface MinecraftWorldOptions {
  /** worlds.minecraft 配置段(活对象引用;x-hot 键现读生效) */
  cfg: MinecraftConfigSection;
  /** Explicit server extension module, tool declarations and configuration. */
  extension?: { module: string; tools: ReadonlyArray<Omit<ToolDef, 'handler'>>; config?: Record<string, unknown> };
  timezone?: string;
  botName?: string;
  /**
   * 账本目录(data/;箱子、死亡、探索、作品、策略、蓝图、世界各一份 JSON,
   * 外加两个角色选中的皮肤);不给就只在内存里,皮肤也就留不了底。
   */
  dataDir?: string;
}

interface VisualObservationJob {
  id: string;
  host: WorldHost;
  bot: Bot;
  viewerUrl: string;
  dimension: string;
  generation: number;
  controller: AbortController;
  callId?: string;
  timedOut: boolean;
}

export class MinecraftWorld implements World {
  readonly id = 'minecraft';

  protected host: WorldHost | null = null;
  protected readonly cfg: MinecraftConfigSection;
  protected readonly timezone: string;
  protected readonly botName: string;
  /** 这份部署的账本目录;'' = 没给,几本账只在内存里,皮肤留不了底 */
  protected readonly dataDir: string;
  protected bridge: Bridge | null = null;
  protected itemBreak: ItemBreakDecoder | null = null;
  protected executor: Executor | null = null;
  protected readonly methodTasks = new Map<number, (report: TaskReport) => void>();
  protected readonly methodTerminals = new Map<number, TaskReport>();
  protected readonly methods = new MethodRunner({
    nativeMethods: Object.keys(NATIVE_API),
    call: (method, args, signal) => this.methodCall(method, args, signal),
    onFinish: (run) => this.onMethodFinish(run),
  });
  protected nativeMethod: { runId: number; session: MineflayerMethod } | null = null;
  protected idleBehavior: IdleBehaviorController | null = null;
  protected readonly idleContext = new IdlePresentationContext();
  protected idleActivityVersion = 0;
  protected idleQuietUntil = 0;
  protected idleQuietReason: string | null = null;
  protected static readonly IDLE_ARRIVAL_WINDOW_MS = 1_500;
  protected static readonly IDLE_ARRIVAL_MAX_WAIT_MS = 4_500;
  protected static readonly IDLE_ARRIVAL_SETTLE_MS = 150;
  protected idleArrival: { generation: string; expiresAtMs: number; readyAtMs?: number; blockedBy?: string } | null = null;
  protected idleSceneCache: IdleBehaviorScene | null = null;
  protected visualWarmKey: string | null = null;
  protected visualInFlight: VisualObservationJob | null = null;
  protected static readonly VISUAL_BACKGROUND_WAIT_MS = 75_000;
  protected reflexes: Reflexes | null = null;
  protected combat: CombatSession | null = null;
  protected ranged: BowController | null = null;
  protected rangedMotion: PositionVelocityTracker | null = null;
  protected rangedBot: NonNullable<Bridge['bot']> | null = null;
  protected rangedGeneration = 0;
  protected worldTimer: ReturnType<typeof setInterval> | null = null;
  protected lastReported: WorldSnapshot | null = null;
  protected lastTickTime: number | null = null;
  protected lastLowHealthAt = 0;
  protected lastAutoEatAttemptAt = 0;
  /** 身上正在生效的状态效果名。服务端对同一效果每 30 秒重推一次 entity_effect,只有出现与消失才成文。 */
  protected readonly activeEffects = new Set<string>();
  protected hookedBots = new WeakSet<object>();
  protected hookedMessageBots = new WeakSet<object>();
  /** 服务端同一条系统提示在短时间连发时只投递首条；原始重复次数进诊断。 */
  protected readonly recentSystemMessages = new Map<string, { at: number; repeats: number }>();
  protected readonly mcServer: MinecraftServerManager;
  /** 受管服务器要不要开着:挂载面板的启停按钮设置,World 启动时取 local.startWithWorld。 */
  protected serverWanted = false;
  /** 受管服务器启停串行化；连续反转时，后一个状态总在前一个收尾之后落地。 */
  protected serverLifecycleQueue: Promise<void> = Promise.resolve();
  protected serverLifecycleTarget: string | null = null;
  protected serverLifecycleActive = false;
  protected readonly client: GameClient;
  protected readonly accountAuth: Record<'agent' | 'observer' | 'player', MinecraftAuthentication>;
  /** 人自己进服那一份;与摄像机是两份进程 */
  protected readonly playerClient: GameClient;
  protected readonly diag: MinecraftLog;
  protected readonly chests: ChestBook;
  protected readonly directionalSweeps: DirectionalSweepBook;
  protected readonly explored: ExploreBook;
  protected readonly deaths: DeathBook;
  /** 成果登记(建成的蓝图格、锄成的耕地、种下的作物);完工转长期保留,不随施工结束失效 */
  protected readonly works: WorksBook;
  /** 常驻规矩(mc_policy 的六格);五格落盘跨重启活着,fight 重启回默认 */
  protected readonly policy: PolicyBook;
  /** 按 realmKey 隔离的内存暂态表，不落盘。 */
  protected readonly pwsr = new PwsrTables();
  /**
   * 当前世界的目标表(句柄每次现取,换世界后自动指向新命名空间)。
   * `status` 换成带蓝图进度的那一版:目标行上「(蓝图 home-v2:已施工 34%)」的来源。
   */
  protected readonly goals = this.pwsr.register({
    ...GOAL_TABLE_DECL,
    status: (t: GoalTable) => goalTableStatus(t, (k) => this.blueprints.noteOf(k)),
  });
  /**
   * 当前世界的路标表(句柄每次现取,换世界后自动指向新命名空间)。
   * 死亡回执、行军代价、快照位置行的相对化,与受理刻的危险区陈述都读这一份。
   */
  protected readonly marks = this.pwsr.register(MAP_TABLE_DECL);
  /** 装载着的蓝图设计 + 各世界的施工绑定(data/ 缓存,跨重启) */
  protected readonly blueprints: BlueprintBook;
  /** 已装载可执行版本的剩余耗材保留账；草稿不进账。 */
  protected readonly blueprintResources: BlueprintResourceLedger;
  protected readonly blueprintResourceReadings = new Map<string, BlueprintResourceReading>();
  protected readonly blueprintOwnedConsumptions: BlueprintOwnedConsumption[] = [];
  protected readonly blueprintInventoryWriteDetach = new Map<Bot, () => void>();
  protected readonly blueprintPlacementLives = new WeakMap<Bot, number>();
  /**
   * 蓝图那张视图在骨架里的取数句柄。每次 syncRealm 都碰它一下 —— 骨架是"用到才
   * 建记录",而换世界公告只说得出**记录存在过**的那些命名空间;不碰它,一个只
   * 交过图没读过现状的世界下桌时会静默无声。
   */
  protected readonly blueprintView: () => { realm: string };
  /** 分批缓冲与完整草稿都按不可变 version id 存，不复用共享 key 当身份。 */
  protected readonly blueprintStreams = new Map<string, BlueprintStreamDraft>();
  protected readonly blueprintReadyDrafts = new Map<string, BlueprintReadyDraft>();
  /** 同键 current 的进程内单调代次；后台提升用它识别 save→unload 的 ABA。 */
  protected readonly blueprintMutationGeneration = new Map<string, number>();
  /** 在途的构思(单实例);null = 没有在跑 */
  protected designInFlight: BlueprintDesignJob | null = null;
  protected resourceOverrideTimer: ReturnType<typeof setTimeout> | null = null;
  protected blueprintInventoryTimer: ReturnType<typeof setTimeout> | null = null;
  /** permit 存续时由完成回调统一观察库存，避免 updateSlot 与结算重复扣账。 */
  protected blueprintPlacementHolds = 0;
  protected blueprintPlacementBot: Bot | null = null;
  /** 已经从旧命名空间「下桌」、还没公告出去的那几句 */
  protected realmCleared: string[] = [];
  protected lastSpectateAt = 0;
  /** GUI 演出的卡屏兜底:关窗后去抖踢一次脱离→再附身 */
  protected guiKickTimer: ReturnType<typeof setTimeout> | null = null;
  /** 附身失败播报的节流水位:摄像机卡住是持续态,十分钟喊一次就够 */
  protected lastSpectateWarnAt = 0;
  /** 摄像机进程崩过还没确认回来:去重用(同一次故障只投一条,恢复也只投一条) */
  protected cameraDown = false;
  /** 上次进服的世界身份落盘处;进服时对账,换了世界必须当场说 */
  protected readonly worldFile: string | null;
  /** host 挂载前也能用的日志转发器(控制台先于 start 用到管理器) */
  protected readonly fallbackLog: import('./support/host-contract.ts').Logger;
  /** 任务号:排进队列的每一件事领一个,回报时认它 */
  protected taskSeq = 0;
  protected readonly executionEpoch = randomUUID();
  protected readonly taskReportVersions = new Map<number, number>();
  protected taskReportVersion = 0;
  /** 每次真实 spawn 递增；断线前后的工具、事件与连接日志据此分代。 */
  protected connectionGeneration = 0;
  /** 全身租约当前只做影子决策；owner 随具体任务/战斗/环境事件更换。 */
  protected readonly bodyLease: BodyLeaseArbiter;
  protected bodyTask: { key: number; owner: BodyOwner } | null = null;
  protected bodyCombat: { owner: BodyOwner } | null = null;
  protected bodyEnvironment: { kind: Extract<BodyOwnerKind, 'lava' | 'drown' | 'suffocation'>; owner: BodyOwner } | null = null;
  /**
   * 作废期内重复拒绝的折叠账:每种(事件+原因)只落首条,其余按累计数在恢复时汇总
   * 一条。只动日志,不动事件语义 —— 仲裁器照旧逐条 emit。
   */
  protected bodyRejectFold: Map<string, { count: number; firstAt: number; lastAt: number }> | null = null;
  /**
   * 心跳拍的收件箱:`observeBodyControl` 这一拍里 emit 的每条租约事件先攒在这儿,
   * 收拍时按整拍的签名决定落不落盘(见 flushBodyHeartbeat)。null = 此刻不在心跳拍里,
   * 事件照旧逐条落盘(死亡作废、换代、重生那几条不能被压)。
   */
  protected bodyHeartbeat: Array<{ event: string; msg: string; data: Record<string, unknown> }> | null = null;
  /** 上一条落盘的心跳:签名、时刻、以及此后压下去的相同拍数 */
  protected bodyHeartbeatLast: { sig: string; at: number; folded: number } | null = null;
  /** stop() 入口置真；随后 bridge 不再重连，客户端的关机退出不计崩溃。 */
  protected shuttingDown = false;
  /** mc_escape 的落点流水:同一个点短时间反复逃回时,回执照实说这是第几次 */
  protected escapeLog: Array<{ key: string; at: number }> = [];

  constructor(opts: MinecraftWorldOptions) {
    this.cfg = opts.cfg;

    this.timezone = opts.timezone ?? 'Asia/Shanghai';
    this.botName = opts.botName ?? 'bot';
    this.bodyLease = new BodyLeaseArbiter({
      connectionGeneration: 0,
      emit: (event) => this.logBodyLease(event),
    });
    this.dataDir = opts.dataDir ?? '';
    const account = (lane: 'agent' | 'observer' | 'player') => {
      const config = lane === 'agent' ? this.cfg : lane === 'observer' ? this.cfg.client : this.cfg.player;
      return { mode: config.auth ?? 'offline', account: config.username, profilesFolder: config.profilesFolder };
    };
    this.accountAuth = Object.fromEntries(['agent', 'observer', 'player'].map(lane => [lane,
      new MinecraftAuthentication(() => account(lane as 'agent' | 'observer' | 'player'), this.dataDir,
        lane as 'agent' | 'observer' | 'player')])) as typeof this.accountAuth;
    const ledger = (name: string): string | null => (opts.dataDir ? join(opts.dataDir, name) : null);

    this.rejectedRoutes = new RejectedRouteLedger(ledger('minecraft-rejected-routes.json'));
    this.chests = new ChestBook(ledger('minecraft-chests.json'));
    this.directionalSweeps = new DirectionalSweepBook(ledger('minecraft-directional-sweeps.json'));
    this.explored = new ExploreBook(ledger('minecraft-explored.json'));
    this.deaths = new DeathBook(ledger('minecraft-deaths.json'), this.timezone);
    this.works = new WorksBook(ledger('minecraft-works.json'));
    this.policy = new PolicyBook(ledger('minecraft-policy.json'));
    this.worldFile = ledger('minecraft-world.json');
    // host 挂载在 start();管理器可能在此之前被控制台使用,日志经转发器现取
    const fwd: import('./support/host-contract.ts').Logger = {
      child: () => fwd,
      trace: (m, d) => this.host?.log.trace(m, d),
      debug: (m, d) => this.host?.log.debug(m, d),
      info: (m, d) => this.host?.log.info(m, d),
      warn: (m, d) => this.host?.log.warn(m, d),
      error: (m, d) => this.host?.log.error(m, d),
      emit: (level, m, o) => this.host?.log.emit(level, m, o),
    };
    this.fallbackLog = fwd;
    this.diag = new MinecraftLog({ log: fwd, timezone: this.timezone });
    this.blueprints = new BlueprintBook(
      ledger('minecraft-blueprints.json'),
      () => this.stockNow(),
      (msg, data) => fwd.warn(msg, data),
    );
    // 保留账读三份外部事实:垫脚/照明名单与她读到的 mc_policy 同一份,箱子存货与三分账单同一份
    this.blueprintResources = new BlueprintResourceLedger({
      scaffold: () => this.scaffoldWanted(),
      light: () => this.lightWanted(),
      stored: () => this.stockNow().stored,
    });
    this.syncBlueprintResources();
    /**
     * 蓝图那一张**视图**登记进骨架:数据真身在 `this.blueprints`(设计跨世界、
     * 绑定按世界),这里只登记"这一份记录属于哪个 realm",换世界公告与现状一行
     * 经它拿措辞。`create` 在骨架第一次碰某个命名空间时跑,那一刻的 `pwsr.realm`
     * 就是它的归属。取数句柄用不上:一个字节的暂态都不放在骨架里。
     */
    this.blueprintView = this.pwsr.register<{ realm: string }>({
      key: 'blueprints',
      create: () => ({ realm: this.pwsr.realm }),
      cleared: (v) => this.blueprints.clearedNote(v.realm),
      status: (v) => this.blueprints.statusNote(v.realm),
      hint: 'mc_blueprint',
    });
    this.mcServer = new MinecraftServerManager({
      serverDir: () => this.cfg.local.serverDir,
      javaPath: () => this.cfg.local.javaPath,
      jvmArgs: () => this.cfg.local.jvmArgs,
      host: () => this.cfg.host,
      port: () => this.cfg.port,
      log: fwd,
      onPhase: (phase, detail) => this.onServerPhase(phase, detail),
      onDifficulty: (fact) => this.onServerDifficulty(fact),
    });
    // 玩家那份默认沿用摄像机的游戏目录,于是也沿用它那一份 options.txt
    const cameraGameDir = (): string => this.cfg.client.gameDir;
    const playerGameDir = (): string => this.cfg.player.gameDir || this.client.directory();
    this.client = new GameClient({
      label: '观察者客户端',
      enabled: () => this.cfg.client.enabled,
      gameDir: cameraGameDir,
      versionId: () => this.cfg.client.versionId,
      javaPath: () => this.cfg.client.javaPath,
      jvmArgs: () => this.cfg.client.jvmArgs,
      username: () => this.accountAuth.observer.snapshot().profile?.name ?? this.observerName(),
      authentication: this.accountAuth.observer,
      width: () => this.cfg.client.width,
      height: () => this.cfg.client.height,
      autoJoin: () => this.cfg.client.autoJoin,
      server: () => ({ host: this.cfg.host, port: this.cfg.port }),
      noPauseOnLostFocus: () => this.cfg.client.noPauseOnLostFocus,
      syncGui: () => this.cfg.client.syncGui,
      // 摄像机的聊天可见性归人:画面要不要挂聊天是舞台选择
      chatUsable: () => false,
      skins: () => this.skinInstall(),
      restartMax: () => this.cfg.client.restartMax,
      restartBackoffMs: 30_000,
      restartWindowMs: 600_000,
      onCrash: (info) => this.onCameraCrash(info),
      shuttingDown: () => this.shuttingDown,
      log: fwd,
      // 窗口起来了不等于进服了,给它一段加载世界的时间再下附身指令
      onReady: () => setTimeout(() => this.syncSpectator('客户端就绪'), 8_000),
    });
    this.playerClient = new GameClient({
      label: '玩家客户端',
      enabled: () => this.cfg.player.enabled,
      gameDir: playerGameDir,
      versionId: () => this.cfg.player.versionId || this.cfg.client.versionId,
      javaPath: () => this.cfg.player.javaPath || this.cfg.client.javaPath,
      jvmArgs: () => this.cfg.player.jvmArgs,
      username: () => this.accountAuth.player.snapshot().profile?.name ?? this.playerName(),
      authentication: this.accountAuth.player,
      width: () => this.cfg.player.width,
      height: () => this.cfg.player.height,
      autoJoin: () => this.cfg.player.autoJoin,
      server: () => ({ host: this.cfg.host, port: this.cfg.port }),
      // 这是人自己玩的那份客户端:他的设置不归 World 改。唯一的例外是共用摄像机那个
      // 游戏目录时——摄像机关掉的聊天连命令行一起关,那已经不是"他自己的设置"了。
      noPauseOnLostFocus: () => false,
      shuttingDown: () => this.shuttingDown,
      chatUsable: () => playerGameDir() === this.client.directory(),
      // 皮肤是例外中的例外:这一份也要铺,不然人自己看到的她还是原版皮肤
      skins: () => this.skinInstall(),
      log: fwd,
    });
  }

  /** 摄像机那份 .minecraft */
  protected cameraGameDir(): string {
    return this.client.directory();
  }

  /** 人那份 .minecraft;配置留空则与摄像机共用一份 */
  protected playerGameDir(): string {
    return this.playerClient.directory();
  }

  /**
   * 皮肤留底就放在这份部署的账本目录里,与 `minecraft-*.json` 做伴:选中的那张
   * 是部署者资产,不属那几份游戏目录——游戏目录可以整个删掉重装,皮肤不该跟着没。
   */
  protected skinStoreDir(): string {
    return this.dataDir;
  }

  /** 角色 → 该铺的账号名。摄像机不在其中:旁观者不渲染,它没有身体可穿。 */
  protected skinAccounts(): Array<{ role: SkinRole; username: string }> {
    return [
      { role: 'bot', username: this.chatName() },
      { role: 'player', username: this.playerName() },
    ];
  }

  /** 启动客户端前铺皮肤要的那份数据:哪个账号铺哪份字节(没选的不在名单里) */
  protected skinInstall(): Array<{ username: string; bytes: Buffer }> {
    const out: Array<{ username: string; bytes: Buffer }> = [];
    for (const { role, username } of this.skinAccounts()) {
      const bytes = readStoredSkin(this.skinStoreDir(), role);
      if (bytes) out.push({ username, bytes });
    }
    return out;
  }

  /** 当场把选择铺进两份游戏目录,回一句"什么时候看得到"。 */
  protected applySkinsNow(): string {
    const entries = this.skinInstall();
    for (const dir of new Set([this.cameraGameDir(), this.playerGameDir()])) {
      applySkins(dir, entries, this.fallbackLog);
    }
    const live = [this.client.running ? '摄像机' : '', this.playerClient.running ? '玩家客户端' : '']
      .filter(Boolean);
    // CustomSkinLoader 只在拿到玩家档案时取一次材质,换了图要重新进服才会再取
    return live.length > 0
      ? `已铺好;${live.join('与')}正跑着,要它重进一次服务器才换得过来`
      : '已铺好,下次启动客户端生效';
  }

  serverConsole(): Record<'state' | 'start' | 'stop', () => Promise<MinecraftServerState & { wanted: boolean }>> {
    const withTarget = async (state: MinecraftServerState) =>
      ({ ...state, wanted: !this.managedLocalServer() || this.serverWanted });
    return {
      state: async () => withTarget(await this.mcServer.state()),
      start: async () => {
        this.serverWanted = true;
        // 名单必须先于服务端启动写入；服务端只在启动时读取 ops.json。
        this.ensureCheatOps();
        if (!this.serverLifecycleActive) return withTarget(await this.mcServer.start());
        await this.syncManagedServerLifecycle(true);
        return withTarget(await this.mcServer.state());
      },
      stop: async () => {
        this.serverWanted = false;
        if (!this.serverLifecycleActive) return withTarget(await this.mcServer.stop());
        await this.syncManagedServerLifecycle(true);
        return withTarget(await this.mcServer.state());
      },
    };
  }

  protected managedLocalServer(): boolean {
    // 运行中以 manager 锁定的目录为准；热改 serverDir 不得把已启动的进程误当远程服务。
    return this.mcServer.directory().trim() !== '';
  }

  /** serverWanted 是受管服务器与 Bridge 的共同目标；远程连接不经过它。 */
  protected syncManagedServerLifecycle(force = false): Promise<void> {
    const managed = this.managedLocalServer();
    const enabled = !managed || this.serverWanted;
    const target = `${managed ? 'managed' : 'external'}:${enabled}`;
    if (force || target !== this.serverLifecycleTarget) {
      this.serverLifecycleTarget = target;
      this.serverLifecycleQueue = this.serverLifecycleQueue.then(async () => {
        if (!this.serverLifecycleActive) return;
        if (!this.managedLocalServer()) {
          this.bridge?.start();
          return;
        }
        if (!this.serverWanted) {
          // Bridge.stop 主动清掉 bot 后会抑制旧 bot 的 end 回调；关服边界必须在这里
          // 显式终结身体租约和旧连接上的任务，重开后不能被 frozen/busyWith 卡住。
          this.detachItemBreak();
          this.detachRanged();
          this.executor?.onConnectionLost('受管服务器已停止');
          this.combat?.onConnectionLost();
          const stopped = await Promise.allSettled([
            this.bridge?.stop() ?? Promise.resolve(),
            this.mcServer.stop(),
          ]);
          const failures = stopped.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
          if (failures.length > 0) {
            throw new AggregateError(failures.map((failure) => failure.reason), '受管服务器关闭不完整');
          }
          return;
        }
        this.ensureCheatOps();
        const state = await this.mcServer.start();
        if (!this.serverLifecycleActive || !this.serverWanted) return;
        this.bridge?.start();
        if (state.phase === 'running' || state.reachable) {
          this.bridge?.reconnectNow('受管服务器已就绪');
        }
      }).catch((error: unknown) => {
        // 外部边界失败后留出下一次心跳重试，不把未落地的目标当成已完成。
        this.serverLifecycleTarget = null;
        this.fallbackLog.error(`受管服务器启停失败: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    return this.serverLifecycleQueue;
  }

  /** 本部署里有名有姓的三个账号,顺序即面板上的顺序。 */
  protected cheatIdentities(): Array<{ name: string; role: 'bot' | 'camera' | 'player' }> {
    const seen = new Set<string>();
    return [
      { name: this.chatName(), role: 'bot' as const },
      { name: this.observerName(), role: 'camera' as const },
      { name: this.playerName(), role: 'player' as const },
    ].filter((x) => {
      const name = x.name.trim();
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }

  /**
   * 作弊权限:把这三个名字补进 ops.json(已在名单里的不动,谁都不删)。
   * `worlds.minecraft.local.cheats` 关掉就完全不碰名单。
   */
  protected ensureCheatOps(): string[] {
    if (!this.cfg.local.cheats) return [];
    const added = ensureOps(this.mcServer.directory(), this.cheatIdentities().map((x) => x.name));
    if (added.length) {
      this.diag.write({ lane: 'link', event: 'op-grant', msg: `已授权作弊权限: ${added.join('、')}` });
    }
    return added;
  }

  /**
   * 控制台「存档与玩法」面板。
   *
   * server.properties 改动按服务器状态分两种时机:
   * 停着的时候写文件(什么都能改,下次启动生效);跑着的时候只有难度和默认游戏
   * 模式能经控制台指令当场改,且不落盘——那会儿写文件既不生效,还可能被服务端
   * 自己的存盘盖掉。
   */
  worldConsole(): {
    state(): Promise<MinecraftWorldState>;
    select(name: string): Promise<MinecraftWorldState>;
    create(name: string, gen: WorldGenChoice): Promise<MinecraftWorldState>;
    apply(patch: Partial<GameSettings>): Promise<MinecraftWorldState>;
  } {
    const dir = (): string => this.mcServer.directory();
    const load = (): { lines: ReturnType<typeof loadProperties>; settings: GameSettings } => {
      const lines = loadProperties(dir());
      return { lines, settings: settingsFrom(lines) };
    };
    const state = async (note?: string): Promise<MinecraftWorldState> => {
      const serverDir = dir();
      const srv = await this.mcServer.state();
      const configured = serverDir !== '' && existsSync(serverDir);
      const { settings } = load();
      return {
        configured,
        serverDir,
        // 跑着(含外部起的)就只让改能热改的那两项
        live: srv.reachable || srv.phase === 'running' || srv.phase === 'starting',
        hosted: srv.pid !== null,
        worlds: configured ? listWorlds(serverDir, settings.levelName) : [],
        settings,
        flatPresets: FLAT_PRESETS,
        levelTypes: LEVEL_TYPE_LABELS,
        detail: note ?? (configured ? null : '先在本 World 配置里填 worlds.minecraft.local.serverDir'),
      };
    };
    const requireStopped = async (what: string): Promise<MinecraftWorldState | null> => {
      const st = await state();
      if (!st.configured) return { ...st, detail: '没配服务器目录,改不了' };
      if (st.live) return { ...st, detail: `${what}要先把服务器停下来` };
      return null;
    };
    return {
      state: () => state(),
      select: async (name) => {
        const blocked = await requireStopped('换存档');
        if (blocked) return blocked;
        const bad = validWorldName(name);
        if (bad) return state(bad);
        const { lines } = load();
        saveProperties(dir(), applySettings(lines, { levelName: name.trim() }));
        return state(`下次启动进「${name.trim()}」`);
      },
      create: async (name, gen) => {
        const blocked = await requireStopped('开新存档');
        if (blocked) return blocked;
        const bad = validWorldName(name);
        if (bad) return state(bad);
        const world = name.trim();
        if (existsSync(join(dir(), world))) return state(`「${world}」已经存在,直接选它就行`);
        const generatorSettings = (gen.generatorSettings ?? '').trim();
        const brokenGen = validGeneratorSettings(generatorSettings);
        if (brokenGen) return state(brokenGen);
        const seed = (gen.seed ?? '').trim();
        const { lines } = load();
        saveProperties(dir(), applySettings(lines, {
          levelName: world,
          levelSeed: seed,
          levelType: gen.levelType,
          generatorSettings,
          generateStructures: gen.generateStructures,
        }));
        const how = [
          levelTypeLabel(gen.levelType ?? 'minecraft:normal'),
          seed ? `种子 ${seed}` : null,
          gen.generateStructures === false ? '不生成结构' : null,
        ].filter(Boolean).join(' · ');
        return state(`下次启动会生成新世界「${world}」(${how})`);
      },
      apply: async (patch) => {
        const st = await state();
        if (!st.configured) return { ...st, detail: '没配服务器目录,改不了' };
        if (!st.live) {
          const { lines } = load();
          saveProperties(dir(), applySettings(lines, patch));
          return state('已写入 server.properties,下次启动生效');
        }
        // 跑着的时候:只有这两项能热改,而且只对本轮有效
        const sent: string[] = [];
        if (patch.difficulty && this.mcServer.command(`difficulty ${patch.difficulty}`)) sent.push('难度');
        if (patch.gamemode && this.mcServer.command(`defaultgamemode ${patch.gamemode}`)) sent.push('默认游戏模式');
        if (sent.length === 0) {
          return state(st.hosted
            ? '服务器跑着,只有难度和默认游戏模式能当场改;别的要先停机'
            : '服务器是外部起的,没有控制台可用;要改就先停机改文件');
        }
        return state(`${sent.join('、')}已当场生效(只对本轮有效,没写进 server.properties)`);
      },
    };
  }

  /**
   * 控制台「权限与作弊」面板。
   *
   * 专用服没有单人存档那个「开作弊」开关:能不能下 /tp、/gamemode、/spectate,
   * 全看名字在不在 ops.json 里(以及 op 拿到第几级)。 World 经托管服务器的 stdin
   * 下的令永远是 4 级,吃这份名单的是 **bot 与人在游戏里打的命令**——mc_escape
   * 的 /tp、把玩家传送到她旁边、摄像机附身,在外部起的服务器上全走那条退路。
   *
   * 时机与「存档与玩法」同一条规则,只是这里有两份文件:
   *  - **停着**:直接改 ops.json 与 server.properties,下次启动生效。
   *  - **跑着且是托管的**:名单走控制台 op/deop 当场生效(服务端自己写回文件);
   *    properties 那几项一概要停机。
   *  - **跑着但是外部起的**:没有 stdin,什么都改不了——这会儿写 ops.json 只会
   *    被服务端退出时的整份写回盖掉,所以宁可拒绝也不假装成功。
   */
  accessConsole(): {
    state(): Promise<MinecraftAccessState>;
    setOp(name: string, on: boolean): Promise<MinecraftAccessState>;
    apply(patch: Partial<AccessSettings>): Promise<MinecraftAccessState>;
  } {
    const dir = (): string => this.mcServer.directory();
    const state = async (note?: string): Promise<MinecraftAccessState> => {
      const serverDir = dir();
      const srv = await this.mcServer.state();
      const configured = serverDir !== '' && existsSync(serverDir);
      const ops = configured ? readOps(serverDir) : [];
      const known = this.cheatIdentities();
      const members: MinecraftAccessMember[] = known.map(({ name, role }) => {
        const hit = configured ? isOp(ops, serverDir, name) : undefined;
        return { name, role, op: hit !== undefined, level: hit?.level ?? 0 };
      });
      // 名单里别人的名字(自己开的服上还有朋友)照样摆出来,否则收回权限得去翻文件
      for (const entry of ops) {
        if (known.some((k) => k.name === entry.name)) continue;
        members.push({ name: entry.name, role: 'other', op: true, level: entry.level });
      }
      return {
        configured,
        serverDir,
        live: srv.reachable || srv.phase === 'running' || srv.phase === 'starting',
        hosted: srv.pid !== null,
        autoOp: this.cfg.local.cheats,
        members,
        settings: accessFrom(configured ? loadProperties(serverDir) : []),
        detail: note ?? (configured ? null : '先在本 World 配置里填 worlds.minecraft.local.serverDir'),
      };
    };
    return {
      state: () => state(),
      setOp: async (name, on) => {
        const st = await state();
        if (!st.configured) return { ...st, detail: '没配服务器目录,改不了' };
        const who = name.trim();
        if (!who) return state('要先写个名字');
        if (/[\s"]/.test(who)) return state('游戏名里不会有空格或引号,确认一下');
        if (st.live) {
          if (!st.hosted) {
            return state('服务器是外部起的,没有控制台可用;要改名单就先停机');
          }
          // 跑着的时候服务端手里有自己的一份名单,退出时整份写回——只能请它改
          const ok = this.mcServer.command(`${on ? 'op' : 'deop'} ${who}`);
          return state(ok
            ? `已让服务器${on ? '授权' : '收回'} ${who} 的作弊权限(当场生效)`
            : '控制台写不进去,试试重启服务器');
        }
        const before = readOps(dir());
        const next = on ? grantOp(before, dir(), who) : revokeOp(before, dir(), who);
        if (!next.changed) return state(`${who} 本来就${on ? '有' : '没有'}作弊权限`);
        writeOps(dir(), next.ops);
        return state(`${on ? '已授权' : '已收回'} ${who} 的作弊权限,下次启动生效`);
      },
      apply: async (patch) => {
        const st = await state();
        if (!st.configured) return { ...st, detail: '没配服务器目录,改不了' };
        if (st.live) return { ...st, detail: '这几项服务器只在启动时读,要先把它停下来' };
        saveProperties(dir(), applyAccess(loadProperties(dir()), patch));
        return state('已写入 server.properties,下次启动生效');
      },
    };
  }

  clientConsole(): {
    state(): Promise<ClientState>;
    start(): Promise<ClientState>;
    stop(): Promise<ClientState>;
  } {
    return {
      state: () => this.client.state(),
      start: () => {
        this.host?.log.info('观察者客户端由控制台面板启动');
        return this.client.start();
      },
      stop: () => this.client.stop(),
    };
  }

  /**
   * 控制台「挂载」里的玩家客户端那一行。
   *
   * `teleport` 是手动补一次传送:自动那次挂在"这个名字进服了"这个时刻上,
   * 而人中途死了、回主菜单再进、或者自己开的客户端都够不着那一刻。
   */
  playerConsole(): {
    state(): Promise<ClientState>;
    start(): Promise<ClientState>;
    stop(): Promise<ClientState>;
    teleport(): Promise<ClientState>;
  } {
    return {
      state: () => this.playerClient.state(),
      start: () => this.playerClient.start(),
      stop: () => this.playerClient.stop(),
      teleport: async () => ({ ...(await this.playerClient.state()), detail: this.teleportPlayer('手动') }),
    };
  }

  envPromptVars(): Record<string, string> {
    // 截断点 core 会重新调用它刷新环境提示词——正是新上下文窗口失去快照基线
    // 的时刻:下一份快照强制全量,增量流从头锚定。**这个副作用是本方法存在的第二个
    // 理由**,改调用时机之前先想清楚它。
    this.snapshotAnchorPending = true;
    // 摄像机说明是一整段措辞,所以它住在自己的可编辑片段里——代码只决定用不用,
    // 措辞归人。前缀里不该有任何一句只存在于 .ts 里的话。
    return {
      'minecraft.version': this.bridge?.bot?.version ?? this.cfg.version,
      'minecraft.world': worldEnvLine(this.worldIdentity()),
      'minecraft.explored': this.explored.summary(normalizeDimension(this.bridge?.bot?.game?.dimension)),
      // 上下文截断时读取当前非默认设置，同时注明被蓝图预留收口的垫脚料。
      'minecraft.policy': renderPolicyEnv(this.policy.get(), false, this.blueprintHeldScaffold()),
      'minecraft.camera': this.cfg.client.enabled
        ? readFileSync(CAMERA_NOTE_FILE, 'utf8').trim()
        : '',
      ...this.envPromptRuntimeVars(),
    };
  }

  /** 子进程定期同步给主进程的提示词活状态；不触发快照重锚。 */
  envPromptRuntimeVars(): Record<'minecraft.current_task' | 'minecraft.goals', string> {
    return {
      'minecraft.current_task': (() => { try {
        const method = this.methods.current;
        return (this.executor?.current ?? '(手上没有在做的事)')
          + (method ? `；自主方法#${method.id}「${method.name}」仍在运行，包含自己的后续动作；mc_script可查终态或取消` : '');
      } catch { return '(读取当前任务失败)'; } })(),
      'minecraft.goals': (() => { try { return goalSnapshotLine(this.goalTable().list); } catch { return '(读取目标表失败)'; } })(),
    };
  }

  /** 已有快照及最近执行终态；只读已有状态，不扫描、不推进增量基线。 */
  requestFacts(): WorldRequestFacts | null {
    if (!this.bridge?.connected || !this.requestFactsCache) return null;
    const last = this.lastFinishedTask;
    // 终态可能刚投递，而下一拍快照尚未发生。读取最新原文，避免只有受理回执
    // 留在历史里时重做已经完成或受阻的单；日期也保留，不能当成当前队列。
    const outcome = renderLastTaskReadout(last
      ? { at: nowIso(this.timezone, new Date(last.at)), kind: last.kind, text: last.text }
      : null);
    return { ...this.requestFactsCache, text: `${this.requestFactsCache.text}\n${outcome}`,
      parts: [...(this.requestFactsCache.parts ?? []).map(part => ({ ...part })), { key: 'lastTask', text: outcome }],
      snapshotTypes: [...this.requestFactsCache.snapshotTypes] };
  }

  console(): WorldConsoleDecl {
    const connected = this.bridge?.connected ?? false;
    const managedServerOff = this.managedLocalServer() && !this.serverWanted;
    const task = this.executor?.current;
    // 给人看的画面从哪来:观察者客户端窗口出来了就是它,否则 viewer 网页,都没有就没有
    const origin = this.client.windowHint() ? 'client' : this.bridge?.viewerUrl ? 'viewer' : null;
    const badges: WorldConsoleDecl['badges'] = [
      managedServerOff
        ? { label: '服务器', value: '未启动', tone: 'off' }
        : connected
          ? { label: '服务器', value: `${this.cfg.host}:${this.cfg.port}`, tone: 'on' }
          : { label: '服务器', value: '未连接', tone: 'off' },
      task ? { label: '任务', value: task, tone: 'on' } : { label: '任务', value: '空闲', tone: 'plain' },
      origin
        ? { label: '画面', value: origin === 'client' ? '客户端主视角' : 'viewer', tone: 'on' }
        : { label: '画面', value: '无', tone: 'off' },
    ];
    const viewerUrl = this.bridge?.viewerUrl;
    return {
      // 三条链路各一颗:进服务器、手上的任务、给人看的画面。
      //
      // 服务器那颗:头两次重连算"正在回来"(掉线重连是常态,退避表前两档共 13 秒);
      // 再往上就是服务器根本不在,该有人去看一眼。
      lamps: [
        {
          label: '服务器',
          ...(managedServerOff
            ? { state: 'offline' as const, hint: '未启动' }
            : !this.bridge
              ? { state: 'offline' as const, hint: '未启动' }
              : connected
                ? { state: 'online' as const, hint: `${this.cfg.host}:${this.cfg.port}` }
                : this.bridge.reconnects <= 2
                  ? { state: 'loading' as const, hint: '连接中' }
                  : { state: 'error' as const, hint: `连不上 ${this.cfg.host}:${this.cfg.port}` }),
        },
        {
          label: '任务',
          ...(task
            ? { state: 'online' as const, hint: task }
            : { state: 'offline' as const, hint: '空闲' }),
        },
        {
          label: '画面',
          ...(origin
            ? { state: 'online' as const, hint: origin === 'client' ? '客户端主视角' : 'viewer' }
            : { state: 'offline' as const, hint: '无' }),
        },
      ],
      badges,
      panels: [...MINECRAFT_PANEL_DECLS],
      invoke: (panel, method, args) => this.invokePanel(panel, method, args),
      promptDocs: [
        {
          key: 'worlds.minecraft.envPrompt',
          title: 'Minecraft · 环境提示词',
          description: 'Minecraft World 的常驻事实（技能序列、世界观察、反射层）。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [
            {
              name: 'minecraft.version',
              description: '当前连接使用的 Minecraft 协议版本。',
            },
            {
              name: 'minecraft.world',
              description: '世界身份:本地托管=「当前存档:名字」,外部服务器=「当前服务器:地址」。她的位置类记忆按它划界。',
            },
            {
              name: 'minecraft.explored',
              description: '探索覆盖摘要(8 方向历史最远与末端群系);一处没探过时为空。',
            },
            {
              name: 'minecraft.policy',
              description: 'mc_policy 六格里与默认不同的那几条;全默认时为空。',
            },
            {
              name: 'minecraft.camera',
              description: '观察者摄像机说明;没开客户端时为空。措辞在「摄像机说明」那份里改。',
              multiline: true,
            },
            {
              name: 'minecraft.current_task',
              description: '当前正在执行的任务标签;空闲时为「手上没有在做的事」。上下文交接后仍可见。',
            },
            {
              name: 'minecraft.goals',
              description: 'mc_goal 目标表快照(最多5格);空表时提示用 mc_goal 挂目标。',
            },
          ],
        },
        {
          key: 'worlds.minecraft.cameraNote',
          title: 'Minecraft · 摄像机说明',
          description: '开了观察者客户端时,追加到环境提示词末尾的那一段。',
          path: CAMERA_NOTE_FILE,
        },
      ],
      storage: this.storageParts(),
      links: [...(viewerUrl ? [
        { label: this.bridge?.viewerKind === 'basic' ? '基础画面' : '第一人称', href: viewerUrl },
        ...(this.bridge?.viewerKind === 'modern' ? [
          { label: '第三人称', href: viewerUrl + '/third/' },
          { label: '2.5D', href: viewerUrl + '/dungeon/' },
          { label: 'OBS', href: viewerUrl + '/?obs=1' },
          { label: 'OBS 布局', href: viewerUrl + '/?obs=1&obsEdit=1' },
        ] : []),
      ] : []), ...(() => {
        try {
          const url = new URL(this.cfg.metricsDashboardUrl ?? '');
          return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
            ? [{ label: '模型与执行', href: url.href }] : [];
        } catch { return []; }
      })()],
      config: [
        MINECRAFT_CONFIG_GROUP,
        MINECRAFT_RHYTHM_CONFIG_GROUP,
        MINECRAFT_CLIENT_CONFIG_GROUP,
        MINECRAFT_PLAYER_CONFIG_GROUP,
      ],
    };
  }

  /**
   * 面板通用调用面:控制台按 (panel, method, args) 透传到这里。
   *
   * `panel` 是 `console()` 里声明的**局部 id**(mount / skin / world / access / log)。
   * 「挂载」一屏管三条链路(server / client / player),它们在服务端仍是三份各自
   * 的控制面,方法名与语义一字未改;`mount` 的方法名把是哪一条缀在前面
   * (`server.state` / `client.stop` / `player.teleport`),再分派回下面那三支。
   */
  protected async invokePanel(panel: string, method: string, args: unknown[]): Promise<unknown> {
    const call = async (obj: Record<string, unknown>, allowed: string[]): Promise<unknown> => {
      if (!allowed.includes(method)) throw new Error(`未知面板方法: ${panel}.${method}`);
      const fn = obj[method];
      if (typeof fn !== 'function') throw new Error(`未知面板方法: ${panel}.${method}`);
      return (fn as (...a: unknown[]) => unknown).apply(obj, args);
    };
    switch (panel) {
      case 'connection': {
        const launched = method === 'observer.start' ? this.client : method === 'player.start' ? this.playerClient : null;
        if (launched) {
          // Human OAuth can take minutes. A console RPC accepts the launch and
          // polls its account/window state instead of timing out on the login.
          void launched.start().catch(() => this.host?.log.warn('Client launch did not complete.'));
          return { accepted: method };
        }
        if (method === 'observer.stop') return this.client.stop();
        if (method === 'player.stop') return this.playerClient.stop();
        if (method !== 'state') throw new Error('Unknown connection method');
        return { server: { host: this.cfg.host, port: this.cfg.port, requestedVersion: this.cfg.version,
          actualVersion: this.bridge?.bot?.version ?? null, username: this.bridge?.bot?.username ?? null },
          viewer: { mode: this.bridge?.viewerKind ?? null, url: this.bridge?.viewerUrl ?? null },
          accounts: Object.fromEntries(Object.entries(this.accountAuth).map(([lane, auth]) => [lane, auth.snapshot()])),
          connection: this.bridge?.connectionState ?? null,
          clients: { observer: (({command, ...state}) => state)(await this.client.state()),
            player: (({command, ...state}) => state)(await this.playerClient.state()) } };
      }
      case 'mount': {
        const dot = method.indexOf('.');
        const lane = dot < 0 ? '' : method.slice(0, dot);
        if (!['server', 'client', 'player'].includes(lane)) {
          throw new Error(`未知面板方法: ${panel}.${method}`);
        }
        return this.invokePanel(lane, method.slice(dot + 1), args);
      }
      case 'server':
        return call(this.serverConsole() as unknown as Record<string, unknown>, ['state', 'start', 'stop']);
      case 'client':
        return call(this.clientConsole() as unknown as Record<string, unknown>, ['state', 'start', 'stop']);
      case 'player':
        return call(
          this.playerConsole() as unknown as Record<string, unknown>,
          ['state', 'start', 'stop', 'teleport'],
        );
      case 'world':
        return call(this.worldConsole() as unknown as Record<string, unknown>, ['state', 'select', 'create', 'apply']);
      case 'access':
        return call(this.accessConsole() as unknown as Record<string, unknown>, ['state', 'setOp', 'apply']);
      case 'skin':
        return call(
          this.skinConsole() as unknown as Record<string, unknown>,
          ['state', 'set', 'clear', 'file'],
        );
      case 'log': {
        if (method !== 'entries') throw new Error(`未知面板方法: ${panel}.${method}`);
        const after = typeof args[0] === 'number' ? args[0] : 0;
        return { entries: this.logConsole().entries(after) };
      }
      default:
        throw new Error(`未知面板: ${panel}`);
    }
  }

  /**
   * 控制台「皮肤」面板:她和玩家各选一张 PNG。
   *
   * 选中即铺:字节按账号名进两份游戏目录,由客户端侧的 CustomSkinLoader 读。
   * 服务器一侧什么都不做——离线服的玩家档案里根本没有材质这一格。
   */
  skinConsole(): {
    state(): Promise<MinecraftSkinState>;
    set(role: string, base64: string): Promise<MinecraftSkinState>;
    clear(role: string): Promise<MinecraftSkinState>;
    file(role: string): Promise<{ $binary: { mime: string; base64: string } }>;
  } {
    const asRole = (role: string): SkinRole => {
      if (role !== 'bot' && role !== 'player') throw new Error(`没有这个角色: ${role}`);
      return role;
    };
    const state = async (detail?: string): Promise<MinecraftSkinState> => {
      const camera = this.cameraGameDir();
      const player = this.playerGameDir();
      return {
        roles: this.skinAccounts().map(({ role, username }) => {
          const bytes = readStoredSkin(this.skinStoreDir(), role);
          return {
            role,
            username,
            skin: storedSkinInfo(this.skinStoreDir(), role),
            installed: {
              camera: installedMatches(camera, username, bytes),
              player: installedMatches(player, username, bytes),
            },
          };
        }),
        dirs: { camera, player },
        mod: { camera: hasSkinMod(camera), player: hasSkinMod(player) },
        live: { camera: this.client.running, player: this.playerClient.running },
        detail: detail ?? null,
      };
    };
    return {
      state: () => state(),
      set: async (role, base64) => {
        const added = setStoredSkin(this.skinStoreDir(), asRole(role), Buffer.from(base64, 'base64'));
        if ('error' in added) throw new Error(added.error);
        return state(this.applySkinsNow());
      },
      clear: async (role) => {
        const key = asRole(role);
        const prev = clearStoredSkin(this.skinStoreDir(), key);
        const username = this.skinAccounts().find((a) => a.role === key)!.username;
        for (const dir of new Set([this.cameraGameDir(), this.playerGameDir()])) {
          removeInstalledSkin(dir, username, prev);
        }
        return state(prev ? '已撤回,那个账号回到原版随机皮肤' : '本来就没选');
      },
      file: async (role) => {
        const bytes = readStoredSkin(this.skinStoreDir(), asRole(role));
        if (!bytes) throw new Error('这个角色还没选皮肤');
        return { $binary: { mime: 'image/png', base64: bytes.toString('base64') } };
      },
    };
  }

  /**
   * 折叠账结账:作废期结束(重生/换代/再次作废)时把压下去的重复拒绝汇成一条。
   * 每种只压第二条起,首条已经落过日志,所以汇总数是"另有 N 条"。
   */
  protected flushBodyRejectFold(): void {
    const fold = this.bodyRejectFold;
    this.bodyRejectFold = null;
    if (!fold) return;
    const folded = [...fold.entries()]
      .map(([key, stat]) => ({ key, ...stat, suppressed: stat.count - 1 }))
      .filter((entry) => entry.suppressed > 0);
    if (folded.length === 0) return;
    const total = folded.reduce((sum, entry) => sum + entry.suppressed, 0);
    this.diag.write({
      lane: 'body', event: 'rejects-folded',
      msg: `全身租约作废期内另有 ${total} 条重复拒绝未逐条记录(${folded.map((e) => `${e.key}×${e.suppressed}`).join('、')})`,
      data: { total, folded },
    });
  }

  protected logBodyLease(event: BodyLeaseEvent): void {
    // 作废期同种拒绝首条记录、后续计数，作废期结束时输出汇总。
    if (event.event === 'invalidated' || event.event === 'revived') {
      this.flushBodyRejectFold();
      if (event.event === 'invalidated') this.bodyRejectFold = new Map();
    } else if (
      this.bodyRejectFold
      && (event.event === 'proposal-rejected' || event.event === 'command-rejected')
    ) {
      const key = `${event.event}:${event.reason}`;
      const seen = this.bodyRejectFold.get(key);
      if (seen) {
        seen.count += 1;
        seen.lastAt = event.at;
        return;
      }
      this.bodyRejectFold.set(key, { count: 1, firstAt: event.at, lastAt: event.at });
    }
    const token = 'token' in event
      ? {
          leaseId: event.token.leaseId,
          ownerId: event.token.ownerId,
          ownerKind: event.token.ownerKind,
          acquiredAt: event.token.acquiredAt,
          expiresAt: event.token.expiresAt,
          connectionGeneration: event.token.connectionGeneration,
        }
      : null;
    let msg: string;
    let data: Record<string, unknown>;
    if (event.event === 'proposal-updated' || event.event === 'proposal-rejected') {
      const proposal = {
        proposalId: event.proposal.proposalId,
        ownerId: event.proposal.ownerId,
        ownerKind: event.proposal.ownerKind,
        intent: event.proposal.intent,
        validUntil: event.proposal.validUntil,
        utility: event.proposal.utility,
      };
      msg = event.event === 'proposal-updated'
        ? `owner#${proposal.ownerId} 提交全身意图:${proposal.intent}`
        : `owner#${proposal.ownerId} 的全身意图被拒:${event.reason}`;
      data = { generation: event.generation, proposal, ...('reason' in event ? { reason: event.reason } : {}) };
    } else if (event.event === 'decision') {
      const decision = event.decision;
      msg = decision.activeAfter
        ? `影子仲裁选择 owner#${decision.activeAfter.ownerId}(${decision.activeAfter.ownerKind}),原因 ${decision.reason}`
        : '影子仲裁当前没有全身 owner';
      data = {
        generation: event.generation,
        reason: decision.reason,
        candidates: decision.candidates,
        recommended: decision.recommended,
        incumbentBefore: decision.incumbentBefore,
        activeAfter: decision.activeAfter,
      };
    } else if (event.event === 'command-accepted' || event.event === 'command-rejected') {
      msg = `影子观测${event.event === 'command-accepted' ? '接受' : '拒绝'}:${event.command}`;
      data = {
        generation: event.generation, command: event.command, leaseId: event.leaseId,
        ownerId: event.ownerId, reason: event.reason,
      };
    } else if (event.event === 'proposal-withdrawn') {
      msg = `owner#${event.ownerId} 撤回全身意图:${event.reason}`;
      data = { generation: event.generation, proposalId: event.proposalId, ownerId: event.ownerId, reason: event.reason };
    } else if (event.event === 'invalidated') {
      msg = `全身租约代次作废:${event.reason}`;
      data = {
        generation: event.generation, reason: event.reason,
        leaseId: event.leaseId, proposalIds: event.proposalIds,
      };
    } else {
      const reason = 'reason' in event ? event.reason : null;
      msg = `${event.event}${reason ? `:${reason}` : ''}`;
      data = { generation: event.generation, token, reason };
    }
    this.writeBody(event.event, msg, data);
  }

  /** 身体日志的写入口；心跳内合批，其他事件直接落盘。 */
  protected writeBody(event: string, msg: string, data: Record<string, unknown>): void {
    if (this.bodyHeartbeat) {
      this.bodyHeartbeat.push({ event, msg, data });
      return;
    }
    this.diag.write({ lane: 'body', event, msg, data });
  }

  /** 与上一拍完全相同的心跳最多压这么久;超时照落一条,免得整段时间一行都没有 */
  protected static readonly BODY_HEARTBEAT_MAX_FOLD_MS = 60_000;

  /**
   * 收一拍心跳:整拍摊成**一条**,且只在这一拍与上一拍不同(或压够一分钟)时才落盘。
   *
   * 判据是"这一拍发生的事"的签名,不是时间 —— 稳定态每秒重复同一串事件,压掉;
   * owner 换人、意图变了、租约被抢,签名当场变,那一拍照落。压下去的拍数记进 data,
   * 不假装它们没发生过。BodyLease 本身一格不动(它是纯 shadow),只改落盘频率。
   */
  protected flushBodyHeartbeat(now: number): void {
    const beat = this.bodyHeartbeat ?? [];
    if (beat.length === 0) return;
    const sig = beat.map((e) => `${e.event}|${e.msg}`).join('\n');
    const last = this.bodyHeartbeatLast;
    if (last && last.sig === sig && now - last.at < MinecraftWorld.BODY_HEARTBEAT_MAX_FOLD_MS) {
      last.folded += 1;
      return;
    }
    // 报的是"上一条落盘之后压掉了几拍",与这一拍换没换签名无关
    const folded = last?.folded ?? 0;
    this.bodyHeartbeatLast = { sig, at: now, folded: 0 };
    const head = beat.find((e) => e.event === 'decision')?.msg ?? beat[0].msg;
    this.diag.write({
      lane: 'body',
      event: 'heartbeat',
      msg: `${head}${folded > 0 ? `(此前另有 ${folded} 拍与上一条完全相同,未逐条记录)` : ''}`,
      data: { foldedTicks: folded, events: beat },
    });
  }

  protected resetBodyOwners(): void {
    this.bodyTask = null;
    this.bodyCombat = null;
    this.bodyEnvironment = null;
  }

  /**
   * 现有控制器继续执行；这一拍只比较它们声明的效用并记录实际 owner 是否与建议一致。
   */
  protected observeBodyControl(now = Date.now()): void {
    this.bodyHeartbeat = [];
    try {
      this.observeBodyControlTick(now);
    } finally {
      this.flushBodyHeartbeat(now);
      this.bodyHeartbeat = null;
    }
  }

  protected observeBodyControlTick(now: number): void {
    const running = this.executor?.status().running ?? null;
    if (this.bodyTask && this.bodyTask.key !== running?.id) {
      this.bodyLease.withdraw(this.bodyTask.owner, 'task-ended-or-replaced', now);
      this.bodyTask = null;
    }
    if (running) {
      this.bodyTask ??= { key: running.id, owner: {} };
      this.bodyLease.update({
        owner: this.bodyTask.owner,
        ownerKind: 'task',
        intent: `task#${running.id}:${running.step}`,
        validUntil: now + 1_500,
        utility: {
          survival: 20, urgency: 30, feasibility: 80, progress: 65,
          continuity: 80, executionRisk: 20, disruption: 0,
        },
      }, now, this.connectionGeneration);
    }

    const combatActive = this.combat?.active ?? false;
    if (!combatActive && this.bodyCombat) {
      this.bodyLease.withdraw(this.bodyCombat.owner, 'combat-ended', now);
      this.bodyCombat = null;
    }
    if (combatActive) {
      this.bodyCombat ??= { owner: {} };
      this.bodyLease.update({
        owner: this.bodyCombat.owner,
        ownerKind: 'combat',
        intent: 'combat-session',
        validUntil: now + 1_500,
        utility: {
          survival: 72, urgency: 72, feasibility: 70, progress: 55,
          continuity: 70, executionRisk: 30, disruption: 30,
        },
      }, now, this.connectionGeneration);
    }

    const environmentKind = this.reflexes?.environmentOwnerKind ?? null;
    if (this.bodyEnvironment && this.bodyEnvironment.kind !== environmentKind) {
      this.bodyLease.withdraw(this.bodyEnvironment.owner, 'environment-cleared-or-changed', now);
      this.bodyEnvironment = null;
    }
    if (environmentKind) {
      this.bodyEnvironment ??= { kind: environmentKind, owner: {} };
      this.bodyLease.update({
        owner: this.bodyEnvironment.owner,
        ownerKind: environmentKind,
        intent: `environment:${environmentKind}`,
        validUntil: now + 1_500,
        utility: {
          survival: 100, urgency: 100, feasibility: 75, progress: 50,
          continuity: 45, executionRisk: 20, disruption: 60,
        },
      }, now, this.connectionGeneration);
    }

    this.bodyLease.reconcile(now);
    const actual = this.bodyEnvironment?.owner ?? this.bodyCombat?.owner ?? this.bodyTask?.owner ?? null;
    if (actual) this.bodyLease.observeLegacyCommit(actual, 'legacy-controller-heartbeat', () => undefined, now);
  }

  /** World 日志跨进程持久化。 */
  protected storageParts(): NonNullable<WorldConsoleDecl['storage']> {
    const impl: Record<string, Pick<StoragePart, 'stat' | 'clear'>> = {
      'minecraft-chests': {
        stat: () => this.chests.stat(),
        clear: () => this.chests.clear(),
      },
      'minecraft-deaths': {
        stat: () => this.deaths.stat(),
        clear: () => this.deaths.clear(),
      },
      'minecraft-explored': {
        stat: () => this.explored.stat(),
        clear: () => this.explored.clear(),
      },
      'minecraft-works': {
        stat: () => this.works.stat(),
        clear: () => this.works.clear(),
      },
      'minecraft-policy': {
        stat: () => this.policy.stat(),
        clear: () => this.policy.clear(),
      },
      'minecraft-blueprints': {
        stat: () => this.blueprints.stat(),
        clear: () => {
          const keys = new Set([
            ...this.blueprintMutationGeneration.keys(),
            ...this.blueprints.keys(),
            ...[...this.blueprintStreams.values()].map((draft) => draft.label.key),
            ...[...this.blueprintReadyDrafts.values()].map((draft) => draft.label.key),
            ...(this.designInFlight ? [this.designInFlight.key] : []),
          ]);
          for (const key of keys) this.markBlueprintMutation(key);
          this.blueprintStreams.clear();
          this.blueprintReadyDrafts.clear();
          const receipt = this.blueprints.clear();
          this.syncBlueprintResources();
          return receipt;
        },
      },
      'minecraft-pwsr': {
        stat: () => this.pwsr.stat(),
        clear: () => this.pwsr.clear(),
      },
    };
    return MINECRAFT_STORAGE_DECLS.map((d) => ({ ...d, ...impl[d.key]! }));
  }

  logConsole(): { entries(after?: number): MinecraftLogEntry[] } {
    return { entries: (after = 0) => this.diag.after(after) };
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.shuttingDown = false; // 重新启用同一个实例时要把收摊闸放开
    const log = host.log;

    this.executor = new Executor({
      getBot: () => this.bridge?.bot ?? null,
      admissionCheck: steps => this.extensionAdmission(steps),
      report: (r) => this.onTaskReport(r),
      log,
      nextId: () => ++this.taskSeq,
      timezone: this.timezone,
      fleeHealth: () => this.cfg.reflex.fleeHealth,
      // 清空冻结两槽后通知反射丢弃旧令牌；危机仍在时重新申请。
      onHoldsReleased: () => this.reflexes?.invalidateEnvironmentHold(),
      ranged: {
        ready: (bot) => this.rangedBot === bot && Boolean(bestRangedWeapon(bot)) && hasUsableArrows(bot),
        shoot: (target, ownerToken): Promise<BowShotResult> => this.ranged?.shoot(target, ownerToken)
          ?? Promise.resolve({ kind: 'blocked', reason: 'aborted', cause: 'bot_lost' }),
        abort: () => this.ranged?.abort(),
      },
      precheck: () => this.cfg.precheck,
      repeatSuccessFallback: () => this.cfg.repeatSuccessFallback ?? MINECRAFT_DEFAULTS.repeatSuccessFallback,
      diag: this.diag,
      // 技能只读规矩;改它的唯一入口是 mc_policy(工具面,不进队列)
      policy: {
        get: () => this.policy.get(),
        defaults: () => this.policyDefaults(),
      },
      permitResourcePlacement: (item, intent) => this.permitBlueprintResourcePlacement(item, intent),
      previewResourcePlacement: (item) => this.previewBlueprintResourcePlacement(item),
      probeRoutes: (target, goal) => this.bridge?.probeRoutes(target, goal) ?? null,
      probeTarget: (target) => this.bridge?.probeTarget(target) ?? null,
      digBackoffSince: (ts) => this.bridge?.digBackoffSince(ts) ?? [],
      // 战斗会话在场时队列闸住:受理照收,腾出手(resume)再跑
      busyWith: () => (this.combat?.active ? '正在跟怪打' : null),
      // 零位移探针里执行器看不见的那两格;只读,不参与任何判据
      bodyState: () => ({
        combatActive: this.combat?.active ?? false,
        environmentOwnerKind: this.reflexes?.environmentOwnerKind ?? null,
      }),
      showTempo: () => this.showTempo(),
      onDrain: () => this.closeStrayWindow(),
      onQueueTail: (notice) => this.onQueueTail(notice),
      spawnNote: () => this.freshSpawnNote(),
      serverFeedbackSince: (startedAt) => this.freshServerFeedback(startedAt),
      // 重生点那一格:受理刻的重生锚闸与 pickup/stow/toss 的回执共读这一份
      spawnAnchor: () => this.personalSpawn,
      // 蓝图施工面(照 spawnAnchor 的接法):装载表与本世界绑定归 World,技能只读+写游标
      blueprints: () => this.blueprintDesk(),
      // 路标表的取用面:只供回执侧的机械计算(坐标相对化、危险区陈述),不改变执行
      marks: () => this.markDesk(),
      // queue:"now" 夺手:战斗当场交还身体,不再走"腾出手就做"
      stopCombat: (firstStep) => this.combat?.standDown(firstStep) ?? null,
      chests: this.chests,
      directionalSweeps: this.directionalSweeps,
      works: this.works,
      explored: (dimension, direction, distance, biome) => this.explored.record(dimension, direction, distance, biome),
      searchContext: () => ({
        connectionGeneration: this.connectionGeneration,
        realm: this.realmKey(),
      }),
      // 周期份捎带、计数过半升常规;卡没卡住由 agent 看净位移自己判断
      onProgress: (p) => {
        const cnt = p.count ? `,进度 ${p.count.done}/${p.count.total}` : '';
        const detail = p.detail ? `;${p.detail}` : '';
        const where = p.pos ? `;我在 (${p.pos.x}, ${p.pos.y}, ${p.pos.z})` : '';
        // 躺在床上等醒的那段:人不动是因为在睡,不是卡住了。净位移那句在这一档里
        // 只会误导(「进行中、挪了 0 格」读起来就是卡死),换成说清在做什么。
        const moved = p.sleeping
          ? ',正在床上睡觉,等天亮醒过来(这段时间本来就不挪窝)'
          : p.movedBlocks === null ? '' : `,这段时间挪了 ${p.movedBlocks} 格`;
        // 进度是状态读数,不是结果:type 单独一档并打 snapshot,交接笔记里只留最后一条
        this.emit(
          'minecraft.task.progress',
          `[执行器] 任务#${p.taskId}「${p.label}」进行中` +
            `(第 ${p.stepIndex + 1}/${p.stepCount} 步:${p.step},已跑 ${p.elapsedS} 秒${cnt})${detail}${where}${moved}。`,
          false,
          { trigger: p.half ? 'debounce' : 'piggyback', tags: ['snapshot'] },
        );
      },
    });

    // 战斗会话(档 1 夜间自保)。控制权优先级 ENV > FIGHT > TASK:
    // 环境反射夺权时会话静默让位(yieldToEnv + envBusy 双保险),会话在场时
    // 执行器由 busyWith 闸住(受理照收,不开跑)。
    this.combat = new CombatSession({
      getBot: () => this.bridge?.bot ?? null,
      tuning: () => ({
        enabled: this.cfg.combat.enabled,
        ...this.extensionCombatTuning(),
        engageRadius: this.cfg.combat.engageRadius,
        chaseMax: this.cfg.combat.chaseMax,
        maxSec: this.cfg.combat.maxSec,
        space: this.cfg.combat.space,
        busyRatio: this.cfg.combat.busyRatio,
        cooldownSec: this.cfg.combat.cooldownSec,
        fleeHealth: this.cfg.reflex.fleeHealth,
        fight: this.policy.get().fight,
      }),
      // 环境自保与任务逃生分别持有身体，战斗不重复接管。
      envBusy: () => (this.reflexes?.envActive ?? false) || Date.now() < this.escapeHoldUntil,
      taskEscaping: () => this.executor?.escaping ?? false,
      taskEating: () => this.executor?.eating ?? false,
      taskFighting: () => this.executor?.attacking ?? false,
      suspendTasks: (by) => {
        this.interruptIdle('combat');
        return this.executor?.suspend(by);
      },
      resumeTasks: () => this.executor?.resume() ?? null,
      emit: (text, urgent, hurtNote) => {
        // 这句已讲明掉血来由:紧接着的掉血播报就是复述,压掉
        if (hurtNote) this.lastReflexHurtAt = Date.now();
        this.emit('minecraft.event', `[Minecraft] ${text}`, urgent,
          urgent ? undefined : { trigger: 'piggyback' });
      },
      onLowHealth: (bot) => this.onLowHealth(bot),
      report: result => this.extensionCombatReport(result),
      ranged: {
        ready: (bot) => this.rangedBot === bot && Boolean(bestRangedWeapon(bot)) && hasUsableArrows(bot),
        active: () => this.ranged?.active ?? false,
        shoot: (target, ownerToken): Promise<BowShotResult> => this.ranged?.shoot(target, ownerToken)
          ?? Promise.resolve({ kind: 'blocked', reason: 'aborted', cause: 'bot_lost' }),
        abort: () => this.ranged?.abort(),
      },
      diag: this.diag,
      log,
    });

    this.reflexes = new Reflexes({
      getBot: () => this.bridge?.bot ?? null,
      report: (r) => this.onTaskReport(r),
      log,
      preempt: (reason) => {
        this.interruptIdle('environment');
        // 低血直线脱战仍是不可恢复抢占；环境危机走下面的断点租约。
        this.combat?.yieldToEnv();
        this.executor?.preempt(reason);
      },
      pauseEnvironment: (reason) => {
        this.interruptIdle('environment');
        this.combat?.yieldToEnv();
        return this.executor?.pauseForEnvironment(reason) ?? null;
      },
      resumeEnvironment: (token) => this.executor?.resumeAfterEnvironment(token)
        ?? { released: false, note: null },
      stopFallTask: (reason) => {
        this.interruptIdle('fall');
        return this.executor?.stopCurrent(reason) ?? null;
      },
      resumeAfterFall: (token) => this.executor?.resumeQueue(token) ?? false,
      escapeActive: () => (this.executor?.escaping ?? false) || Date.now() < this.escapeHoldUntil,
      fightBack: () => this.cfg.reflex.fightBack,
      fleeHealth: () => this.cfg.reflex.fleeHealth,
      onLowHealth: (bot) => this.onLowHealth(bot),
      onWaterTrap: () => {
        void this.doEscape().then((result) => {
          this.diag.write({ lane: 'reflex', event: 'drown-trap-escape', msg: result });
          this.emit('minecraft.task', `[自动脱困] ${result}`, true);
        }, (error) => {
          this.diag.write({ lane: 'reflex', event: 'drown-trap-escape-failed',
            msg: String(error), incident: true });
          this.emit('minecraft.task', `[自动脱困] 没成功:${String(error)}`, true);
        });
      },
      reactCooldownSec: () => this.cfg.reflex.reactCooldownSec,
      antiDrown: () => this.cfg.reflex.antiDrown,
      antiLava: () => this.cfg.reflex.antiLava,
      currentTask: () => this.executor?.currentTask ?? null,
      combatHurt: (id, name) => (
        this.executor?.onCombatHurt(id, name) || this.combat?.onHurtBy(id, name) || false
      ),
      diag: this.diag,
    });

    this.bridge = this.createBridge({
      host: this.cfg.host,
      port: this.cfg.port,
      username: this.cfg.username || this.botName,
      version: this.cfg.version,
      authentication: this.accountAuth.agent,
      loginConfigFile: () => this.cfg.loginConfigFile,
      viewerPort: this.cfg.viewerPort,
      viewerAssetsDir: this.cfg.viewerAssetsDir,
      viewerSpeakerName: this.cfg.viewerSpeakerName,
      viewerSpeechSourceId: this.botName,
      performanceBridge: this.cfg.performanceBridge, remoteTextures: this.cfg.remoteTextures,
      log,
      diag: this.diag,
      shuttingDown: () => this.shuttingDown,
      scaffoldBlocks: () => this.scaffoldBlocksForUse(),
      movementCosts: () => TRAVEL_COSTS[this.policy.get().travel],
      taskId: () => this.executor?.currentTask?.id ?? null,
      protectionFile: this.dataDir ? join(this.dataDir, 'minecraft-break-permissions.json') : null,

      // 工地绑定持续约束自动寻路；显式施工与拆改仍通过各自权限检查。
      blueprintZones: () => this.blueprintPathZones(),
      // 成果登记的垫脚过滤:维度在这里合上,寻路器只问「这一格算不算」
      workCell: (x, y, z) => this.works.has(this.bridge?.bot?.game?.dimension ?? 'overworld', x, y, z),
      showTempo: () => this.showTempo(),
      onBotCreated: (bot) => this.hookMessageEvents(bot),
      onSpawn: () => this.onSpawn(),
      onRespawn: () => this.onRespawn(),
      // 第一次掉线值得叫醒她(手上的事全废了);之后每一次重连没成只是同一件事的
      // 复述,压成不唤醒的一条,免得连不上的那半小时里每隔几十秒炸一次
      onDisconnect: (reason, willReconnect, attempt) => {
        this.methods.stop('游戏连接已断开，原方法坐标和权限作废');
        this.visualInFlight?.controller.abort(new Error('游戏连接已断开'));
        this.interruptIdle('disconnect');
        this.idleContext.clear();
        this.bodyLease.invalidate('disconnect', Date.now());
        this.resetBodyOwners();
        this.diag.write({
          lane: 'link', event: 'disconnect',
          msg: `连接代次 ${this.connectionGeneration} 断开:${reason}${willReconnect ? ',将重连' : ''}`,
          data: { connectionGeneration: this.connectionGeneration, reason, willReconnect, attempt },
        });
        this.detachItemBreak();
        this.detachRanged();
        this.executor?.onConnectionLost();
        this.combat?.onConnectionLost();
        this.emit(
          'minecraft.event',
          attempt === 0
            ? `[Minecraft] 与服务器断开(${reason})。${willReconnect ? '正在自动重连。' : ''}`
            : `[Minecraft] 还是没连上(这是第 ${attempt + 1} 次:${reason})。${willReconnect ? '继续重连。' : ''}`,
          attempt === 0,
        );
      },
      onAlarm: (text) => this.emit('minecraft.event', `[Minecraft] ${text}`, true),
    });

    this.serverLifecycleActive = true;
    this.serverLifecycleTarget = null;
    this.serverWanted = this.cfg.local.startWithWorld;
    void this.syncManagedServerLifecycle(true);
    this.reflexes.start();
    this.combat.start();
    this.idleBehavior = new IdleBehaviorController({
      config: () => this.cfg.idle ?? MINECRAFT_DEFAULTS.idle,
      host: {
        scene: () => this.idleScene(),
        execute: async (id, scene, signal) => {
          const bot = this.bridge?.bot;
          if (!bot) return;
          const origin = bot.entity.position.clone();
          await executeIdleAction(bot, id, scene.state, signal, {
            available: () => this.bridge?.bot === bot && this.canIdle()
              && (id !== 'short_walk' || (this.cfg.idle ?? MINECRAFT_DEFAULTS.idle).allowMovement)
              && this.idleGeneration() === scene.generation
              && bot.entity.position.distanceTo(origin) < 3,
            inventoryPreview: (open) => {
              (bot as unknown as EventEmitter).emit('viewer_inventory_preview', { open });
            },
          });
        },
        record: (event) => this.diag.write({ lane: 'body', event: `idle-${event.event}`,
          msg: event.actionId ?? event.reason ?? event.event, level: 'debug', data: { ...event } }),
      },
    });
    this.worldTimer = setInterval(() => this.worldTick(), 1_000);
    // 客户端自己会花几十秒加载,和连服务器并行起就行,不等它
    if (this.cfg.client.enabled) void this.client.start();
    if (this.cfg.player.enabled) void this.playerClient.start();
    log.info(`minecraft World 已启动,目标 ${this.cfg.host}:${this.cfg.port}`);
  }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    for (const auth of Object.values(this.accountAuth)) auth.stop();
    this.disposeExtension();
    this.methods.stop('Minecraft World 已停止');
    this.methodTerminals.clear();
    this.visualInFlight?.controller.abort(new Error('Minecraft World 已停止'));
    this.requestFactsCache = null;
    this.idleBehavior?.stop();
    this.idleBehavior = null;
    this.idleSceneCache = null;
    this.idleContext.clear();
    this.visualWarmKey = null;
    this.bodyLease.invalidate('stop', Date.now());
    this.idleArrival = null;
    this.flushBodyRejectFold();
    this.resetBodyOwners();
    this.detachItemBreak();
    this.serverLifecycleActive = false;
    this.serverLifecycleTarget = null;
    this.host = null;
    if (this.worldTimer) clearInterval(this.worldTimer);
    this.worldTimer = null;
    if (this.guiKickTimer) clearTimeout(this.guiKickTimer);
    this.guiKickTimer = null;
    if (this.resourceOverrideTimer) clearTimeout(this.resourceOverrideTimer);
    this.resourceOverrideTimer = null;
    if (this.blueprintInventoryTimer) clearTimeout(this.blueprintInventoryTimer);
    this.blueprintInventoryTimer = null;
    this.combat?.stop();
    this.detachRanged();
    this.combat = null;
    this.executor?.shutdown();
    this.reflexes?.stop();
    const bridge = this.bridge;
    this.bridge = null;
    this.blueprintPlacementHolds = 0;
    this.blueprintPlacementBot = null;
    this.blueprintOwnedConsumptions.length = 0;
    this.blueprintResourceReadings.clear();
    for (const detach of this.blueprintInventoryWriteDetach.values()) detach();
    this.blueprintInventoryWriteDetach.clear();
    /* 先停止 bridge 与两份客户端，再停止 MC 服务器，避免退出期间安排重连或重启。 */
    const bridgeStop = Promise.allSettled([
      closeMinecraftViewCapture(), bridge?.stop() ?? Promise.resolve(),
    ]);
    await bridgeStop;
    // 托管进程随 World 收干净:客户端直接杀,MC 停机走 stop 指令存档
    await this.client.stop();
    await this.playerClient.stop();
    const serverStop = Promise.allSettled([this.mcServer.stop()]);
    await this.serverLifecycleQueue;
    this.executor = null;
    this.reflexes = null;
    this.lastReported = null;
    const failures = [...(await bridgeStop), ...(await serverStop)]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length > 0) {
      throw new AggregateError(failures.map((failure) => failure.reason), 'Minecraft World 停止不完整');
    }
  }

  protected extensionTools(): ToolDef[] { return []; }
  protected extensionState(): unknown { return null; }
  protected extensionCombatTuning(): Partial<import('./combat.ts').CombatTuning> { return {}; }
  protected extensionCombatReport(_result: unknown): void {}
  protected extensionLowHealth(_bot: Bot): void {}
  protected extensionSpawn(_bot: Bot): void {}
  protected extensionRespawn(): void {}
  protected extensionRealm(_key: string): void {}
  protected extensionMessage(_text: string): boolean { return false; }
  protected extensionImportantMessage(_text: string): boolean { return false; }
  protected attachExtension(_bot: Bot): void {}
  protected disposeExtension(): void {}
  protected extensionAdmission(_steps: readonly SkillCall[]): string | null { return null; }

  protected createBridge(options: ConstructorParameters<typeof Bridge>[0]): Bridge { return new Bridge(options); }
  onTurnEnded(): void { this.readGate.reset(); }

  tools(): ToolDef[] {
    const handlers: Record<string, ToolDef['handler']> = {
      mc_railway: async (args, ctx) => {
        if (ctx.signal?.aborted) return { text: '[mc_railway 未受理] 观察已取消', failed: true };
        const outcome = railwayReadout(this.bridge?.bot ?? null, args);
        return { ...outcome, text: this.toolLog('mc_railway', args, outcome.text) };
      },
      mc_help: async (args) => {
        const help = readSkillHelp(args);
        return 'error' in help
          ? { text: this.toolLog('mc_help', args, `[mc_help 失败] ${help.error}`), failed: true }
          : this.toolLog('mc_help', args, help.text);
      },

      mc_script: async (args) => {
        try {
          if (args.api !== undefined) {
            if (typeof args.api !== 'string' || ['code', 'procedure', 'runId', 'call', 'stop', 'validate'].some(key => args[key] !== undefined)) throw new Error('api 须单独使用');
            return this.toolLog('mc_script', args, methodApiHelp(args.api));
          }
          if (args.validate !== undefined && typeof args.validate !== 'boolean') throw new Error('validate须为布尔值');
          if (args.stop !== undefined && typeof args.stop !== 'boolean') throw new Error('stop须为布尔值');
          if (args.stop === true) {
            if (args.code !== undefined || args.procedure !== undefined || args.runId !== undefined || args.call !== undefined) throw new Error('stop不能与code、procedure、runId或call合用');
            return this.toolLog('mc_script', args, this.methods.stop('mc_script明确取消') ? '已取消当前方法' : '当前没有运行中的方法');
          }
          if (args.code !== undefined || args.procedure !== undefined) {
            if (args.runId !== undefined || args.call !== undefined) throw new Error('code不能与runId或call合用');
            if (args.code !== undefined && args.procedure !== undefined) throw new Error('code和procedure不能合用');
            if (args.validate !== true && (!this.executor || !this.bridge?.bot?.entity)) throw new Error('Minecraft尚未连接');
            const reference = args.procedure === undefined ? undefined : procedureReference(args.procedure);
            const graph = reference ? resolveProcedure(reference, METHOD_ADAPTER, handle => this.host?.blob(handle) ?? null) : undefined;
            const root = graph?.versions[graph.root];
            const run = this.methods.start({ name: root?.id ?? args.name as string, code: root?.code ?? args.code as string,
              params: args.params as Record<string, unknown> | undefined,
              durationMs: args.durationMs as number | undefined, validate: args.validate === true,
              ...(graph && reference ? { procedure: { reference, graph } } : {}) });
            return {text:this.toolLog('mc_script', args, `方法#${run.id}已启动，尚无执行终态：${JSON.stringify(run)}`), execution: {kind:'method',id:`${this.executionEpoch}:${run.id}`,phase:'accepted',terminal:false,goalCompleted:false,evidence:{localId:run.id}}};
          }
          if (args.runId !== undefined && (!Number.isInteger(args.runId) || Number(args.runId) <= 0)) throw new Error('runId须为正整数');
          if (args.call !== undefined && (args.runId === undefined || !Number.isInteger(args.call)
            || Number(args.call) < 1 || Number(args.call) > METHOD_LIMITS.calls)) throw new Error('call须配合runId，取1至32的调用编号');
          return this.toolLog('mc_script', args, JSON.stringify(this.methods.inspect(args.runId as number | undefined, args.call as number | undefined)));
        } catch (error) { return { text: this.toolLog('mc_script', args, String(error)), failed: true }; }
      },
      // 路标表在受理这一刻取一次:at 写名字时按当刻登记解析
      mc_do: async (args) => this.enqueueTool('mc_do', args, (raw) => parseSteps(raw, this.markLookup())),
      mc_scout: async (args) => this.enqueueTool('mc_scout', args, (raw) => parseScoutSteps(raw, this.markLookup())),
      mc_flight_plan: async (args) => {
        const parsed = parseFlightPlan(args, this.markLookup());
        const bot = this.bridge?.bot;
        if ('error' in parsed || !bot) return { text: this.toolLog('mc_flight_plan', args,
          `[mc_flight_plan 失败] ${'error' in parsed ? parsed.error : '尚未连接 Minecraft'}`), failed: true };
        try {
          const result = previewFlightPlan(bot, parsed.steps, parsed.budgetMs, parsed.subdivide);
          return { text: this.toolLog('mc_flight_plan', args,
            `整段飞行试算（未施法、未移动；后续起点是假定上一段到达，实际执行重验；估时仅含所列移动，每段含500毫秒余量。timing.source为nominal时按标称50毫秒周期估算，为runtime时按近期实际控制周期耗时校准；speedSource:server只表示标称速度来源，不保证耗时。施法、排队、模型和截图等待另计；allowed仅表示采样时许可；null为未知，悬停不表示有支撑。steps为可整体提交的绝对坐标与needs，未核验完整路线或超预算时为null；施法不包含在steps中，合并前置步骤须重编号needs。起点变化后应重算）：${JSON.stringify(result)}`),
          ...(!result.complete || result.fitsBudget === false ? { failed: true } : {}) };
        } catch (error) {
          if (!(error instanceof SkillBlocked)) throw error;
          return { text: this.toolLog('mc_flight_plan', args, `[mc_flight_plan 失败] ${error.message}`), failed: true };
        }
      },
      mc_visual: async (args, ctx) => this.visualObservation(args, ctx),
      mc_policy: async (args) => this.toolLog('mc_policy', args, this.setPolicy(args)),
      mc_goal: async (args) => {
        const op = parseGoal(args);
        if ('error' in op) return { text: this.toolLog('mc_goal', args, `[mc_goal 失败] ${op.error}`), failed: true };
        const goal = op.kind === 'done' ? this.goalTable().list.find(value => value.slot === op.slot) : null;
        const result = this.goalClosure(args);
        if (goal && !this.goalTable().list.includes(goal)) {
          const verification = goalClosureMetadata(goal, 'done', Date.now());
          return { ...(typeof result === 'string' ? { text: result } : result),
            meta: { goalClosure: { protocol: 'agent-mc/v1', goalId: verification.task_id,
              phase: 'closed', requestedBy: 'host', verification: verification.verified_by === 'environment'
                ? 'environment-conditions' : 'host-judgment', semanticGoalVerified: false }, taskVerification: verification } };
        }
        return result;
      },
      mc_map: async (args) => this.toolLog('mc_map', args, this.setMap(args)),
      mc_blueprint: async (args) => this.toolLog('mc_blueprint', args, this.setBlueprint(args)),
      mc_check: async (args) => this.toolLog('mc_check', args, this.runCheck(args)),
      mc_bag: async (args, ctx) => this.readOnce('mc_bag', ctx,
        () => this.bagReadout(typeof args.item === 'string' ? args.item : undefined)),
      mc_view_map: async (args) => this.viewMap(args),
      mc_queue: async (_args, ctx) => this.readOnce('mc_queue', ctx, () => this.queueReadout()),
      mc_blocked: async (_args, ctx) => this.readOnce('mc_blocked', ctx, () => this.blockedReadout()),
      mc_stop: async () => {
        this.methods.stop('mc_stop取消方法');
        this.interruptIdle('stop-command');
        if (!this.executor) return this.toolLog('mc_stop', {}, '[mc_stop 失败] World 未启动');
        // 正在打:mc_stop = 收手 + 撤退(原地站住等于送死),队列照旧全撤
        const fight = this.combat?.requestStop() ?? null;
        const cleared = this.executor.clear(fight !== null);
        const bits = [fight, cleared].filter(Boolean);
        return this.toolLog('mc_stop', {}, bits.length > 0 ? bits.join(';') : '手上本来就没有在做的事,队列也是空的');
      },
      mc_escape: async () => this.toolLog('mc_escape', {}, await this.doEscape()),
    };
    return [...minecraftToolDecls().map((decl) => ({ ...decl, handler: handlers[decl.name] })), ...this.extensionTools()];
  }

  protected methodState(): Record<string, unknown> {
    const bot = this.bridge?.bot;
    return { sampledAt: new Date().toISOString(), connectionGeneration: this.connectionGeneration,
      method: this.methods.current,
      snapshot: this.snapshot({ scanBlocks: false }), flight: bot ? flightState(bot) : null,
      queue: this.executor?.status() ?? null, combatActive: this.combat?.active ?? false,
      combat: this.extensionState() };
  }

  protected async methodCall(method: MethodOperation, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const bot = this.bridge?.bot;
    if (!bot?.entity || !this.executor) throw new Error('Minecraft尚未连接');
    if (method === 'state') return this.methodState();
    if (method === 'mineflayer') {
      if (typeof args.name !== 'string' || !Array.isArray(args.args)) throw new Error('原生调用须包含 name 与 args 数组');
      const run = this.methods.current;
      if (!run) throw new Error('自主程序权限已撤销');
      if (this.nativeMethod?.runId !== run.id) {
        this.nativeMethod = { runId: run.id, session: new MineflayerMethod({ executor: this.executor,
          name: `方法#${run.id}「${run.name}」`, signal, getBot: () => this.bridge?.bot ?? null,
          successful: () => this.methods.read(run.id)[0]?.status === 'completed',
          revoke: reason => { if (this.methods.current?.id === run.id) this.methods.stop(reason); },
          beforeEnqueue: () => this.interruptIdle('native-program') }) };
      }
      return this.nativeMethod.session.call(args.name, args.args);
    }
    if (method === 'flightPlan') {
      const parsed = parseFlightPlan(args, this.markLookup());
      if ('error' in parsed) throw new Error(parsed.error);
      return previewFlightPlan(bot, parsed.steps, parsed.budgetMs, parsed.subdivide);
    }
    if (this.nativeMethod?.session.ownsBody) throw new Error('当前原生程序已持有身体；mc.do 会等待自身，改用 bot 原生调用或结束后另起方法');
    let decision: TaskAdmissionDecision | undefined;
    // Explicit append keeps a method's single outstanding group behind existing work.
    // Plain chat also follows the executor so its receipt has a real task identity.
    const outcome = this.enqueueTool('mc_do', { steps: args.steps, queue: 'append' },
      (raw) => parseSteps(raw, this.markLookup()), (value) => { decision = value; });
    const receipt = typeof outcome === 'string' ? outcome : outcome.text;
    if (!decision?.accepted) return { accepted: false, done: false, kind: 'rejected', receipt,
      rejection: decision?.rejection ?? null, state: this.methodState() };
    if (decision.completedImmediately) return { accepted: true, done: true, kind: 'done', receipt,
      taskId: null, steps: [], state: this.methodState() };
    const taskId = decision.taskId!;
    const terminal = await new Promise<TaskReport>((resolve) => {
      const settle = (report: TaskReport) => {
        this.methodTasks.delete(taskId);
        signal.removeEventListener('abort', abort);
        resolve(report);
      };
      const abort = () => {
        this.executor?.cancelTask(taskId, '脚本权限撤销');
        settle({ kind: 'cancelled', taskId, text: String(signal.reason) });
      };
      const landed = this.methodTerminals.get(taskId);
      if (landed) { resolve(landed); return; }
      this.methodTasks.set(taskId, settle);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    return { accepted: true, taskId, kind: terminal.kind, done: terminal.kind === 'done',
      receipt: terminal.text, steps: terminal.steps ?? [], state: this.methodState() };
  }

  protected onMethodFinish(run: MethodRun): void {
    if (this.nativeMethod?.runId === run.id) this.nativeMethod = null;
    this.diag.write({ lane: 'task', event: 'method-terminal', msg: `方法#${run.id}「${run.name}」${run.status}`,
      data: { runId: run.id, sourceHash: run.sourceHash, status: run.status, calls: run.trace.length,
        startedAt: run.startedAt, endedAt: run.endedAt, error: run.error } });
    const procedure = run.procedure;
    const receipt: ProcedureReceipt | undefined = procedure && run.status !== 'running' ? {
      schema: PROCEDURE_RECEIPT_SCHEMA, executionId: procedure.executionId, root: procedure.reference,
      adapter: procedure.adapter, mode: procedure.mode, status: run.status, startedAt: run.startedAt, endedAt: run.endedAt!,
      invocations: procedure.invocations, trace: run.trace, result: run.result, error: run.error,
    } : undefined;
    const blobs: BlobInput[] | undefined = receipt ? [{ bytes: new TextEncoder().encode(JSON.stringify({ ...receipt, versions: procedure!.versions })),
      mime: PROCEDURE_RECEIPT_MIME, name: 'procedure-run.json', fallbackText: '方法完整执行回执；按执行 UUID 查询摘要，再按调用编号展开。' }] : undefined;
    this.emit('minecraft.method', `方法#${run.id}「${run.name}」终态${run.status}；源码SHA256 ${run.sourceHash}；`
      + `${run.trace.length}次SDK调用。${run.error ?? ''}用 mc_script {runId:${run.id}}读取各次真实回执；`
      + (receipt ? `执行UUID ${receipt.executionId}，方法版本 ${receipt.root.revision}；完整回执已随事件保存。` : '')
      + '脚本结束不等于原目标已达成。核对执行后状态，修订方法并记录已验证范围。', true,
    { execution:{kind:'method',id:`${this.executionEpoch}:${run.id}`,phase:run.status==='validated'?'validated':run.status==='completed'?'completed':run.status==='cancelled'?'cancelled':'blocked',terminal:true,goalCompleted:false,evidence:{sourceHash:run.sourceHash,receipt:receipt??null}}, meta: { runId: run.id, sourceHash: run.sourceHash, status: run.status, ...(receipt ? { procedureReceipt: {
      schema: receipt.schema, executionId: receipt.executionId, root: receipt.root, status: receipt.status } } : {}) }, blobs });
  }

  protected visualArgumentFailure(args: Record<string, unknown>): ToolOutcome | undefined {
    const name = 'mc_visual';
    const mode = args.mode === undefined ? 'third' : args.mode;
    if (mode !== 'first' && mode !== 'third' && mode !== 'dungeon') {
      return { text: this.toolLog(name, args, '[mc_visual 失败] mode 只能是 first、third 或 dungeon'), failed: true };
    }
    if (args.include_hud !== undefined && typeof args.include_hud !== 'boolean') {
      return { text: this.toolLog(name, args, '[mc_visual 失败] include_hud 只能是 boolean'), failed: true };
    }
    if (args.raw !== undefined && typeof args.raw !== 'boolean') {
      return { text: this.toolLog(name, args, '[mc_visual 失败] raw 只能是 boolean'), failed: true };
    }
    if (args.background !== undefined && typeof args.background !== 'boolean') {
      return { text: this.toolLog(name, args, '[mc_visual 失败] background 只能是 boolean'), failed: true };
    }
    return undefined;
  }

  protected async visualObservation(args: Record<string, unknown>, ctx: ToolCallContext): Promise<ToolOutcome> {
    const invalid = this.visualArgumentFailure(args);
    if (invalid) return invalid;
    const bot = this.bridge?.bot;
    const viewerUrl = this.bridge?.viewerUrl;
    const host = this.host;
    if (this.shuttingDown || !host || !bot?.entity || !viewerUrl) {
      return { text: this.toolLog('mc_visual', args, '[mc_visual 暂不可用] 游戏或网页画面未连接；等画面恢复后再看'),
        failed: true, endsTurn: true };
    }
    if (ctx.signal?.aborted) {
      return { text: this.toolLog('mc_visual', args, '[mc_visual 未受理] 本次调用已取消'), failed: true };
    }
    if (this.visualInFlight) {
      return { text: this.toolLog('mc_visual', args,
        `[mc_visual 未受理] 观察 job_id:${this.visualInFlight.id} 仍在收尾；本次没有拍摄或新建分析。`
          + '本轮结束，等待原观察结果；游戏任务继续运行。不要重复调用轮询；结果回来后再选择下一步行动'),
        failed: true, endsTurn: true };
    }
    const job: VisualObservationJob = {
      id: `vis_${randomUUID()}`, host, bot, viewerUrl,
      dimension: String(bot.game.dimension ?? 'unknown'), generation: this.connectionGeneration,
      controller: new AbortController(), callId: ctx.callId, timedOut: false,
    };
    this.visualInFlight = job;
    const background = typeof args.background === 'boolean' ? args.background : this.cfg.visual.background;
    const signal = !background && ctx.signal
      ? AbortSignal.any([ctx.signal, job.controller.signal]) : job.controller.signal;
    const work = this.visualReadout(args, { ...ctx, signal });
    // Keep the capture slot until cancellation cleanup actually settles.
    const release = () => { if (this.visualInFlight === job) this.visualInFlight = null; };
    void work.then(release, release);
    if (!background) return work;
    void this.deliverVisualObservation(job, work);
    return { text: this.toolLog('mc_visual', args,
      `[mc_visual 已受理] job_id:${job.id}；画面尚未完成，结果稍后通过 minecraft.visual 事件交回。`
        + '可继续不依赖观察结果的行动；需要等它时结束本轮，不要重复调用轮询。') };
  }

  protected visualJobIsCurrent(job: VisualObservationJob): boolean {
    return !this.shuttingDown && this.host === job.host && this.bridge?.bot === job.bot
      && !!job.bot.entity && this.bridge?.viewerUrl === job.viewerUrl
      && this.connectionGeneration === job.generation
      && String(job.bot.game.dimension ?? 'unknown') === job.dimension;
  }

  protected async deliverVisualObservation(job: VisualObservationJob, work: Promise<ToolOutcome>): Promise<void> {
    let onAbort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(job.controller.signal.reason);
      job.controller.signal.addEventListener('abort', onAbort, { once: true });
      if (job.controller.signal.aborted) onAbort();
    });
    const timer = setTimeout(() => {
      job.timedOut = true;
      job.controller.abort(new Error('后台观察本地等待超过 75 秒；已取消拍摄等待，迟到画面将丢弃'));
    }, MinecraftWorld.VISUAL_BACKGROUND_WAIT_MS);
    timer.unref();
    try {
      let outcome: ToolOutcome;
      try {
        outcome = await Promise.race([work, cancelled]);
      } catch (error) {
        if (!job.timedOut) return;
        outcome = { text: error instanceof Error ? error.message : String(error), failed: true };
      }
      if (!this.visualJobIsCurrent(job) || (job.controller.signal.aborted && !job.timedOut)) return;
      await job.host.pushEvent({
        origin: 'external', ts: nowIso(this.timezone), source: this.id, type: 'minecraft.visual',
        senderKey: 'minecraft.visual',
        text: `[mc_visual 后台${outcome.failed ? '失败' : '结果'}] job_id:${job.id}\n${outcome.text}`,
        blobs: outcome.blobs,
        meta: { jobId: job.id, callId: job.callId, status: outcome.failed ? 'failed' : 'completed',
          dimension: job.dimension, connectionGeneration: job.generation },
      }, { trigger: 'debounce' });
    } catch (error) {
      job.host.log.warn('mc_visual 后台事件投递失败', { err: error });
    } finally {
      clearTimeout(timer);
      job.controller.signal.removeEventListener('abort', onAbort);
    }
  }

  /** Capture current evidence; the Persona may interpret it in a separate task-scoped call. */
  protected async visualReadout(args: Record<string, unknown>, ctx: ToolCallContext): Promise<ToolOutcome> {
    const name = 'mc_visual';
    const invalid = this.visualArgumentFailure(args);
    if (invalid) return invalid;
    const mode = (args.mode ?? 'third') as 'first' | 'third' | 'dungeon';
    const focus = typeof args.focus === 'string' ? args.focus.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
    const bot = this.bridge?.bot;
    const viewerUrl = this.bridge?.viewerUrl;
    if (this.bridge?.viewerKind === 'basic') {
      return { text: '[mc_visual 暂不可用] 当前使用基础画面，没有匹配的现代截图素材；请读取现场数据或安装匹配资源。', failed: true };
    }
    if (!bot?.entity || !viewerUrl) {
      return { text: this.toolLog(name, args, '[mc_visual 暂不可用] 游戏或网页画面未连接；等画面恢复后再看'),
        failed: true, endsTurn: true };
    }
    const before = bot.entity.position.clone();
    const dimension = String(bot.game.dimension ?? 'unknown');
    const host = this.host;
    const generation = this.connectionGeneration;
    const current = () => !this.shuttingDown && this.host === host && this.connectionGeneration === generation
      && this.bridge?.bot === bot && !!bot.entity && this.bridge?.viewerUrl === viewerUrl
      && String(bot.game.dimension ?? 'unknown') === dimension;
    try {
      const capture = await captureMinecraftView({ viewerUrl, mode, includeHud: args.include_hud === true,
        timeoutMs: 25_000, signal: ctx.signal });
      this.diag.write({ lane: 'world', event: 'visual-capture', msg: capture.mode,
        data: { ...capture.timings, capturedAt: capture.capturedAt, width: capture.width, height: capture.height } });
      if (!current()) {
        return { text: this.toolLog(name, args, '[mc_visual 失败] 拍摄期间游戏连接或维度改变，旧画面已丢弃'), failed: true };
      }
      const after = bot.entity.position.clone();
      const moved = before.distanceTo(after);
      const location = `${after.x.toFixed(1)}, ${after.y.toFixed(1)}, ${after.z.toFixed(1)}`;
      const observedAt = new Date().toISOString();
      const feet = bot.blockAt(after);
      const head = bot.blockAt(after.offset(0, 1, 0));
      const ground = bot.blockAt(after.offset(0, -0.05, 0));
      const contact = bot.entity.onGround === true ? '是' : bot.entity.onGround === false ? '否' : '未知';
      const feetWet = feet ? WATER_BLOCKS.has(feet.name) : undefined;
      const headWet = head ? WATER_BLOCKS.has(head.name) : undefined;
      const waterState = headWet === true ? '头部在水中，水底可见不表示已登岸'
        : feetWet === true ? '脚部在水中，尚未确认登岸'
        : feetWet === undefined || headWet === undefined ? '水中状态未核实'
        : '头脚所在格未读到水';
      const oxygen = headWet && Number.isFinite(bot.oxygenLevel)
        ? `；氧气 ${Math.max(0, Math.min(20, bot.oxygenLevel))}/20` : '';
      const description = [
        `[mc_visual] ${capture.capturedAt} 网页实景截图，${capture.mode} 视角，${capture.width}×${capture.height}，`
          + `${dimension}，截图完成后玩家位置 (${location})。`,
        `维度：${dimension}；生物群系：${biomeAt(bot, after)}。生物群系与维度不是同一字段，不能据群系名称判断是否已经出洞或到达地表。`,
        `[现场读数 ${observedAt}] 脚部格 ${feet?.name ?? '未加载，未知'}；头部格 ${head?.name ?? '未加载，未知'}；${waterState}${oxygen}。`,
        `脚底下方格 ${ground?.name ?? '未加载，未知'}；物理接地：${contact}。头脚所在格描述身体空间，空气不表示脚下悬空。`,
        focus ? `这次想看：${focus}。` : '',
        'focus 只提出本帧问题，不改变玩家位置或镜头朝向，也不证明所写地点或对象就在画面中。',
        capture.includesHud ? '本帧包含游戏界面和当前可见菜单。' : '本帧只包含 3D 场景，未拍摄界面。',
        moved > 2 ? `拍摄期间移动了约 ${moved.toFixed(1)} 格；请把这张图当作移动中的一帧。` : '',
        '画面只证明当时可见的内容；一帧不能证明动作过程、玩家意图或隐藏区域。'
          + '入口、路线和战况可以据此复核；精确坐标、物品数据、动作终态和施工权限仍需现场读数或回执核对。',
      ].filter(Boolean).join('\n');
      const blobs = [{ bytes: capture.png, mime: 'image/png',
        name: `minecraft-${capture.mode}-${capture.capturedAt.replace(/[:.]/g, '-')}.png`,
        fallbackText: `Minecraft ${capture.mode} 视角现场截图；位置 (${location})，${dimension}，${capture.capturedAt}。` }];
      return {
        text: this.toolLog(name, args, `${description}`),
        blobs,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { text: this.toolLog(name, args, `[mc_visual 暂不可用] ${reason}`), failed: true,
        endsTurn: true };
    }
  }

  protected onLowHealth(bot: Bot): void {
    if ((bot.health ?? 20) >= 6 && (bot.food ?? 20) < 18) {
      this.emit('minecraft.event', `[Minecraft] 生命 ${Math.ceil(bot.health ?? 0)}/20，${this.recoveryFoodFact(bot)}。`,
        false, { trigger: 'piggyback' });
    }
    this.extensionLowHealth(bot);
  }

  protected recoveryFoodFact(bot: Bot): string {
    const hunger = Math.ceil(bot.food ?? 20);
    if (this.bridge?.invSynced === false) return `饥饿 ${hunger}/20，背包还没同步`;
    const foods = (bot.registry?.foodsByName ?? {}) as Record<string, unknown>;
    const stacks = bot.inventory?.items() ?? [];
    const available = new Map<string, number>();
    for (const item of stacks) {
      if (item.count > 0 && foods[item.name]) {
        available.set(item.name, (available.get(item.name) ?? 0) + item.count);
      }
    }
    if (available.size === 0) return `饥饿 ${hunger}/20，包里没看到食物`;
    return `饥饿 ${hunger}/20，包里的食物：${[...available]
      .map(([name, count]) => `${zhName(name)}(${name})×${count}`).join('、')}`;
  }

  /** 一轮一答闸的账(见 round.ts);三个只读原语共用一本,各占一格 */
  protected readonly readGate = new RoundOnceGate();
  protected queueReadBurst: { stamp: string; atMs: number; count: number } | null = null;
  protected rejectedTravelBurst: { key: string; scope: RejectedRouteScope; atMs: number; count: number } | null = null;
  protected lastRejectedTravelEscapeAt = 0;
  protected readonly rejectedRoutes: RejectedRouteLedger;

  /**
   * 只读原语的公共外壳:算读数 → 与上一次比 → 决定真答还是指回上一条。
   *
   * 闸只挡「同一轮里同一份读数的第二次」——读数真变了照答,轮认不出来(子会话、
   * 直接单测)也照答。降级方向永远是多答一次,不是把她挡在门外。
   */
  protected readOnce(
    name: string,
    ctx: ToolCallContext | undefined,
    compute: () => { stamp: string; text: string },
  ): string | ToolOutcome {
    const { stamp, text } = compute();
    const round = roundTokenOf(ctx);
    if (name === 'mc_queue' && round !== null) {
      const now = Date.now();
      const previous = this.queueReadBurst;
      const count = previous?.stamp === stamp && now - previous.atMs <= 5_000
        ? previous.count + 1 : 1;
      this.queueReadBurst = { stamp, atMs: now, count };
      if (count >= 3) {
        return {
          text: this.toolLog(name, {}, '[mc_queue] 队列状态未变；等任务或战斗结果事件再查。'),
          endsTurn: true,
        };
      }
      const q = this.executor?.status();
      if (q && (q.running || q.waiting.length > 0)) {
        const answer = this.readGate.answered(name, round, stamp) ? text : REPEATED_QUERY_RECEIPT;
        return { text: this.toolLog(name, {}, answer), endsTurn: true };
      }
    }
    return this.readGate.answered(name, round, stamp)
      ? this.toolLog(name, {}, text)
      : this.toolLog(name, {}, REPEATED_QUERY_RECEIPT);
  }

  /**
   * mc_view_map:地图画面 + 文字读数。画面来自服务端推给包里地图的像素包(map-view.ts),
   * 中心坐标只有本机服务端的存档里有;读不到就只报图上坐标,不猜世界坐标。
   */
  protected viewMap(args: Record<string, unknown>): string | ToolOutcome {
    const bot = this.bridge?.bot;
    if (!bot) return this.toolLog('mc_view_map', args, '[mc_view_map] 还没连上服务器,看不了地图');
    const carried = [bot.heldItem, bot.inventory.slots[bot.getEquipmentDestSlot('off-hand')], ...bot.inventory.items()]
      .filter((it): it is NonNullable<typeof it> => it?.name === 'filled_map');
    const ids = [...new Set(carried.map((it) => readMapId(it as never)).filter((n): n is number => n !== null))];
    if (ids.length === 0) {
      return this.toolLog('mc_view_map', args, '手上和包里都没有开过的地图(filled_map);空地图 map 要先拿在手上用一下才会开图');
    }
    const id = typeof args.id === 'number' ? args.id : ids[0];
    if (!ids.includes(id)) {
      return this.toolLog('mc_view_map', args, `身上没有编号 #${id} 的地图;身上有:${ids.map((n) => `#${n}`).join('、')}`);
    }
    const m = mapStateOf(bot, id);
    if (!m || !m.painted) {
      return this.toolLog('mc_view_map', args, `地图 #${id} 的整张画面还没收到:服务端只在登录后推一次整张,之后只推变了的部分;刚拿到手的图等一两秒再看`);
    }
    const identity = worldIdentityOf(this.cfg.local.serverDir, `${this.cfg.host}:${this.cfg.port}`);
    const dat = identity.local ? readMapDat(join(this.cfg.local.serverDir, identity.key, 'data', `map_${id}.dat`)) : null;
    const per = 2 ** m.scale;
    const world = (px: number, pz: number): string => (dat
      ? `,世界约 (${Math.round(dat.xCenter + (px - MAP_SIZE / 2) * per)}, ${Math.round(dat.zCenter + (pz - MAP_SIZE / 2) * per)})`
      : '');
    const lines = [
      `地图 #${id}:比例 1:${per}(一像素 ${per}×${per} 格,整张 ${MAP_SIZE * per}×${MAP_SIZE * per} 格)`
        + `${m.locked ? ',已锁定' : ''},已探索 ${Math.round(exploredShare(m) * 100)}%。图上方是北(-z),右边是东(+x)。`,
      dat
        ? `中心 (${dat.xCenter}, ${dat.zCenter})${dat.dimension ? `,${zhDimension(dat.dimension)}` : ''}`
        : '中心坐标读不到(不是本机服务端,或存档里还没写这张图),下面只有图上坐标',
      ...(m.icons.length === 0 ? ['图上没有图标'] : m.icons.map((i) =>
        `${MAP_ICON_ZH[i.type] ?? i.type}${i.label ? `「${i.label}」` : ''}:图上 (${Math.round(i.px)}, ${Math.round(i.pz)})`
        + `${world(i.px, i.pz)},朝向方位角 ${(180 + i.direction * 22.5) % 360}°`)),
    ];
    const text = lines.join('\n');
    this.toolLog('mc_view_map', args, text);
    return {
      text,
      blobs: [{
        bytes: renderMapPng(m), mime: 'image/png', name: `map_${id}.png`,
        fallbackText: '[地图画面:这一轮看不了图,只有上面的文字读数]',
      }],
    };
  }

  /** mc_bag:背包现读。与快照走同一份渲染口径(见 readouts.renderBagReadout) */
  protected bagReadout(item?: string): { stamp: string; text: string } {
    const snap = this.snapshot({ scanBlocks: false });
    if (!snap) {
      return {
        stamp: bagStamp(null),
        text: '[mc_bag] 还没连上服务器,看不了包(断线会自动重连,连上会有事件)',
      };
    }
    const records = this.chests.chestsIn(snap.dimension);
    if (item?.trim()) {
      const bot = this.bridge?.bot;
      const win = bot?.currentWindow;
      const opened = win && !selectionMenuTitle(win.title)
        ? { title: minecraftTextComponent(win.title) || '容器',
            items: containerStacks(win, bot.registry as never).items }
        : null;
      const text = renderStoredItemReadout(snap, records, item, opened, bot?.registry);
      return { stamp: `${bagStamp(snap)}|stock:${item}|${text}`, text };
    }
    const storage = renderStorageReadout(snap, records);
    return {
      stamp: `${bagStamp(snap)}|${storage ?? ''}`,
      text: `${renderBagReadout(snap)}${storage ? `\n${storage}` : ''}`,
    };
  }

  /** mc_queue:队列现读 + 最近一单的终态 */
  protected queueReadout(): { stamp: string; text: string } {
    const ex = this.executor;
    if (!ex) return { stamp: 'nomod', text: '[mc_queue 失败] World 未启动' };
    const q = ex.status();
    const last = this.lastFinishedTask;
    const method = this.methods.current;
    return {
      stamp: queueStamp(q, last?.at ?? null) + `:${method?.id ?? ''}`,
      text: renderQueueReadout(
        q,
        last ? { at: this.clock(last.at), kind: last.kind, text: last.text } : null,
      ) + (method ? `\n[自主方法] #${method.id}「${method.name}」仍在运行；它会按代码继续提交后续动作，mc_script可查结果或取消。` : ''),
    };
  }

  /** mc_blocked:最近几步没做成的原文 */
  protected blockedReadout(): { stamp: string; text: string } {
    const ex = this.executor;
    if (!ex) return { stamp: 'nomod', text: '[mc_blocked 失败] World 未启动' };
    const records = ex.blockedLog().slice(0, BLOCKED_READOUT_MAX);
    return {
      stamp: blockedStamp(records),
      text: renderBlockedReadout(records, (ms) => this.clock(ms)),
    };
  }

  /** 挂钟时刻 HH:MM:SS,与执行器回执同一口径 */
  protected clock(ms: number): string {
    return nowIso(this.timezone, new Date(ms)).slice(11, 19);
  }

  /**
   * 最近一单的终态。onTaskReport 每收一条非反射汇报就换掉这一格 —— 那条回执本身
   * 早被后续事件挤出上下文,而「我刚才那一单到底怎么了」正是她最常拿重下单去问的事。
   */
  protected lastFinishedTask: { at: number; kind: string; text: string } | null = null;

  /** mc_policy 同步修改常驻设置，不进队列或产生任务事件；回执报告实际变更和未收下的字段。 */
  protected setPolicy(args: Record<string, unknown>): string {
    const { patch, notes } = parsePolicy(args);
    // 修改前留快照，供回执计算实际 diff。
    const before = this.policy.get();
    this.policy.set(patch);
    // 垫脚名单与挖/垫代价直通寻路器,改完当场热改(正在走的那一段也跟着换)
    this.bridge?.retune();
    const head = notes.length > 0 ? `${notes.map(policyNoteText).join(';')}。` : '';
    const after = this.policy.get();
    return head + renderPolicyChange(before, after, patch)
      + renderPolicy(
        after, this.policyDefaults(), !this.cfg.combat.enabled, this.blueprintHeldScaffold(),
      );
  }

  /**
   * mc_goal:改这个世界的暂态目标表,同步回执。与 mc_policy 同一档 —— 不进队列
   * (排在正在做的那件事后面等于改不着),不产生任务事件。
   *
   * 「World 未启动」不是这里的失败:目标是她投影进来的语义,连不连得上服务器都成立
   * (连上之前先把上一场的清单挂回去,正是 PWSR 想要的用法)。拿不到 bot 只是
   * 登记时刻少一个游戏内天数,如实留 null。
   */
  protected readonly goalClosure = createGoalClosureHandler({
    state: (args) => {
      const op = parseGoal(args);
      if ('error' in op || op.kind !== 'done') return null;
      const goal = this.goalTable().list.find(value => value.slot === op.slot);
      return goal ? {
        slot: goal.slot,
        identity: `${this.pwsr.realm}/${goal.slot}/${goal.at}/${goal.realTime}`,
        phase: JSON.stringify(goal.plan.steps.map(step => ({
          do: step.do, state: step.state, verify: step.verify, judgment: step.judgment,
        }))),
      } : null;
    },
    invoke: (args) => this.setGoal(args),
    log: (args, text) => this.toolLog('mc_goal', args, text),
  });

  protected setGoal(args: Record<string, unknown>): string {
    const op = parseGoal(args);
    if ('error' in op) return `[mc_goal 失败] ${op.error}`;
    const table = this.goalTable();
    const writeState = (): string => JSON.stringify(table.list.map((goal) => ({
      slot: goal.slot,
      text: goal.text,
      kind: goal.kind,
      target: goal.target,
      progress: goal.progress,
      blueprint: goal.blueprint,
      plan: goal.plan.steps.map((step) => ({
        do: step.do,
        state: step.state,
        judgment: step.judgment,
        note: step.evidence && 'note' in step.evidence ? step.evidence.note : null,
      })),
    })));
    const revisionBefore = op.kind==='revise' ? table.list.find(g=>g.slot===op.slot)?.revision??1 : 0;
    const writeBefore = writeState();
    if (op.kind === 'done') {
      const slot = op.slot;
      const closing = table.list.find((goal) => goal.slot === slot);
      if (closing?.plan.steps.some((step) => step.verify) && !this.bridge?.bot?.entity) {
        return `#${slot} 还不能结案：当前没连上服务器，机械里程碑没有这一刻的独立世界旁证。`;
      }
    }
    // done 的门控必须读调用这一刻的世界；任务回执和 Goal 自己的 progress 都不参与。
    const before = op.kind === 'done' ? this.coordinateGoalPlans() : [];
    const closingGoal = op.kind === 'done' || op.kind === 'drop' ? table.list.find(goal => goal.slot === op.slot) : null;
    const day = (this.bridge?.bot as { time?: { day?: number } } | null | undefined)?.time?.day;
    let receipt = applyGoal(table, op, {
      day: typeof day === 'number' ? Math.floor(day) : null,
      realTime: nowIso(this.timezone),
      at: Date.now(),
    }, (k) => this.blueprints.noteOf(k), (k) => this.goalDoneSurvey(k));
    if(op.kind==='revise' && table.list.find(g=>g.slot===op.slot)?.revision!==revisionBefore && receipt.startsWith('{'))
      this.emit('minecraft.goal.revision',receipt,false,{trigger:'piggyback',meta:{goalRevision:JSON.parse(receipt)}});

    if (closingGoal && !table.list.includes(closingGoal) && (op.kind === 'done' || op.kind === 'drop')) {
      this.emit('minecraft.goal.metrics', '', false, { deliver: false,
        meta: { taskVerification: goalClosureMetadata(closingGoal, op.kind, Date.now()) } });
    }
    const after = op.kind === 'done' ? [] : this.coordinateGoalPlans();
    const notices = [...before, ...after];
    if (notices.length > 0) receipt += `\n[目标旁证] ${notices.join('；')}`;
    if (writeState() !== writeBefore) this.markGoalWrite();
    return receipt;
  }

  /** done 掉一条绑着蓝图的目标时那份现场 diff;没连上服务器就没有世界可对 */
  protected goalDoneSurvey(key: string): string | null {
    const bot = this.bridge?.bot;
    if (!bot) return null;
    return blueprintCheckText(this.checkSite(key), key, this.checkWorld(bot)).text;
  }

  /**
   * 同步修改当前世界的暂态路标表，不进任务队列。
   * 断线时允许登记，但不能核验世界或计算方向；此入口不执行移动。
   */
  protected setMap(args: Record<string, unknown>): string {
    const op = parseMap(args);
    if ('error' in op) return `[mc_map 失败] ${op.error}`;
    const bot = this.bridge?.bot;
    const me = bot?.entity?.position ?? null;
    return applyMap(this.markTable(), op, {
      at: Date.now(),
      dimension: bot ? normalizeDimension(bot.game?.dimension) : null,
      me: me ? { x: me.x, y: me.y, z: me.z } : null,
      peek: bot ? this.blockPeek(bot) : null,
      clock: (ms) => nowIso(this.timezone, new Date(ms)).slice(11, 19),
    });
  }

  /**
   * 世界核验的读数口:区块没加载时 mineflayer 的 blockAt 给 null,那与"读到了、
   * 是空气"不是一回事 —— 两者在回执里也说的是两句话,所以这里原样往上传。
   * 取格心(+0.5)避免负坐标上的取整偏一格。
   */
  protected blockPeek(bot: NonNullable<Bridge['bot']>): BlockPeek {
    return (p) => {
      try {
        return bot.blockAt(new Vec3(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5))?.name ?? null;
      } catch {
        return null; // 核验不许成为故障源:读不出来就当没加载
      }
    };
  }

  /**
   * mc_check:她出断言,系统对世界,同步回执。只读一档 —— 不进队列、
   * 不产生任务事件、不动身。
   *
   * 没连上服务器时整单不受理:一条断言都对不了,给一份"全没加载"的空账反而像结论。
   */
  protected runCheck(args: Record<string, unknown>): string {
    const bot = this.bridge?.bot;
    if (!bot) return '[mc_check] 角色尚不可操作，对不了账；连接、密码提交、认证成功与进世界分别确认。当前状态：'
      + JSON.stringify(this.bridge?.connectionState ?? { active: false, ready: false });
    // 蓝图与路标两类断言查的是 realm 域的表:取之前先对一次命名空间
    this.syncRealm();
    const world = this.checkWorld(bot);
    const parsed = parseChecks(args, world.knowsBlock);
    if ('error' in parsed) return `[mc_check 失败] ${parsed.error}`;
    return renderChecks(parsed, world);
  }

  /**
   * 断言求值器那一侧的世界取用面。四个口都是**现读**:一次对账里读到的是同一刻的世界,
   * 不缓存也不预取。区块没加载在这里就是 `null`,一路传到回执上说成"没加载"。
   */
  protected checkWorld(bot: NonNullable<Bridge['bot']>): CheckWorld {
    const registry = (bot.registry as { blocksByName?: Record<string, unknown> } | undefined)?.blocksByName;
    const peek = this.blockPeek(bot);
    return {
      position: () => bot.entity
        ? [bot.entity.position.x, bot.entity.position.y, bot.entity.position.z] : null,
      cell: (x, y, z) => {
        try {
          const b = bot.blockAt(new Vec3(x + 0.5, y + 0.5, z + 0.5));
          if (!b) return null;
          const raw = typeof b.getProperties === 'function'
            ? (b.getProperties() as Record<string, unknown>)
            : {};
          const props = Object.entries(raw).map(([k, v]) => `${k}=${String(v)}`).sort();
          return {
            state: props.length === 0 ? b.name : `${b.name}[${props.join(',')}]`,
            solid: b.boundingBox === 'block',
          };
        } catch {
          return null; // 对账不许成为故障源:读不出来就当没加载
        }
      },
      inventory: () => {
        const m = new Map<string, number>();
        for (const it of bot.inventory?.items?.() ?? []) m.set(it.name, (m.get(it.name) ?? 0) + it.count);
        return m;
      },
      enchantsOf: (item) => (bot.inventory?.items?.() ?? [])
        .filter((it) => it.name === item)
        .map((it) => readEnchants(it as never, bot.registry as never)),
      knowsBlock: registry ? (id) => Object.hasOwn(registry, id) : undefined,
      site: (key) => this.checkSite(key),
      mark: (name) => {
        const hit = this.marks().list.find((m) => m.name === name);
        if (!hit) return null;
        const verdict = checkMark(hit, peek, normalizeDimension(bot.game?.dimension));
        return {
          name: hit.name, kind: hit.kind, dimension: hit.dimension, pos: hit.pos,
          verdict: verdict.verdict, found: verdict.found,
        } satisfies CheckMarkProbe;
      },
    };
  }

  /** 一份蓝图的对账面:设计 + 这个世界的锚点(没开工过就没有锚点) */
  protected checkSite(key: string): CheckSite | null {
    const design = this.blueprints.get(key);
    if (!design) return null;
    return {
      key: design.key,
      name: design.name,
      blueprint: design.blueprint,
      plan: design.plan,
      anchor: this.blueprints.binding(key)?.anchor ?? null,
    };
  }

  /** 当前世界的路标表;取之前先对一次命名空间(她可能在连上之前就登记过) */
  protected markTable(): MapTable {
    this.syncRealm();
    return this.marks();
  }

  /**
   * 执行器那一侧的路标取用面(照 spawnAnchor/blueprints 的接法:World 持有,执行器只读)。
   * 两件事都是**回执侧的机械计算**,不改变任何执行:相对化一个坐标,陈述一句危险区。
   */
  protected markDesk(): MarkDesk {
    // 一份回执一个视图:表在这一刻取一次,同一张单里的几句话不会各说各的
    const dimension = normalizeDimension(this.bridge?.bot?.game?.dimension);
    const list = this.markTable().list
      .filter((m) => normalizeDimension(m.dimension) === dimension);
    return {
      near: (p, approx) => nearMarkText(list, p, approx),
      nearest: (p) => {
        const hit = nearestMark(list, p);
        return hit ? { name: hit.mark.name, x: hit.mark.pos[0], y: hit.mark.pos[1], z: hit.mark.pos[2] } : null;
      },
      danger: (p) => dangerZonesAt(list, p).map((m) => m.name),
      around: (p, radius) => list
        .filter((m) => Math.hypot(m.pos[0] - p.x, m.pos[1] - p.y, m.pos[2] - p.z) <= radius)
        .map((m) => ({ name: m.name, at: m.at })),
    };
  }

  /**
   * 技能入参里的路标名解析(`at:"家"`)。名字按登记原文精确匹配,大小写与空白
   * 归一之外不做近似 —— 猜她指的是哪一处路标就是替她决策。
   */
  protected markLookup(): MarkLookup {
    const list = this.markTable().list;
    const dimension = normalizeDimension(this.bridge?.bot?.game?.dimension);
    return (name) => {
      const want = name.trim().toLowerCase();
      const hit = list.find((m) => m.name.trim().toLowerCase() === want);
      if (!hit) return null;
      if (normalizeDimension(hit.dimension) !== dimension) {
        return {
          error: `mc_map 的「${hit.name}」在${zhDimension(hit.dimension)},当前在${zhDimension(dimension)};先明确穿门`,
        };
      }
      return [hit.pos[0], hit.pos[1], hit.pos[2]];
    };
  }

  /** Goal 只经这个现读面取得旁证；动作执行结果不在这张接口里。 */
  protected goalProbeContext(bot: NonNullable<Bridge['bot']>): GoalProbeContext {
    const dimension = normalizeDimension(bot.game?.dimension);
    return {
      observedAt: Date.now(),
      connectionGeneration: this.connectionGeneration,
      realm: this.realmKey(),
      dimension,
      world: this.checkWorld(bot),
      position: () => {
        const p = bot.entity.position;
        return [p.x, p.y, p.z];
      },
      status: () => {
        const entity = bot.entity as unknown as { isOnFire?: boolean; metadata?: unknown[] };
        const flags = Array.isArray(entity.metadata) && typeof entity.metadata[0] === 'number'
          ? entity.metadata[0] : 0;
        return {
          health: bot.health ?? 20,
          food: bot.food ?? 20,
          oxygen: Math.max(0, Math.min(20, bot.oxygenLevel ?? 20)),
          burning: Boolean(entity.isOnFire) || (flags & 1) !== 0,
        };
      },
      entities: () => Object.values(bot.entities)
        .filter((entity) => entity !== bot.entity && entity?.isValid !== false && entity?.position && entity.name !== 'item')
        .map((entity) => ({
          type: String(entity.name ?? entity.type ?? '').toLowerCase().replace(/^minecraft:/, ''),
          position: [Math.floor(entity.position.x), Math.floor(entity.position.y), Math.floor(entity.position.z)],
        })),
      items: () => Object.values(bot.entities).flatMap((entity) => {
        if (entity?.isValid === false || !entity?.position) return [];
        const stack = droppedStackOf(entity, bot.registry?.items);
        if (!stack) return [];
        return [{
          item: stack.name.toLowerCase().replace(/^minecraft:/, ''),
          count: stack.count,
          position: [
            Math.floor(entity.position.x), Math.floor(entity.position.y), Math.floor(entity.position.z),
          ] as PositionXYZ,
        }];
      }),
    };
  }

  /** 同一份现读依次协调全部 plan；返回的只是状态边沿，不周期复述。 */
  protected coordinateGoalPlans(): string[] {
    const list = this.goalTable().list;
    if (list.length === 0) return [];
    const bot = this.bridge?.bot;
    if (!bot?.entity) return [];
    const ctx = this.goalProbeContext(bot);
    const notices: string[] = [];
    let moved = false;
    for (const goal of list) {
      const coordinated = coordinateGoalPlan(goal.plan, ctx);
      if (coordinated.transitions.some((transition) => transition.kind === 'advance' || transition.kind === 'regress')) {
        moved = true;
      }
      if (coordinated.transitions.length > 0) {
        notices.push(`#${goal.slot} ${coordinated.transitions.map(renderGoalPlanTransition).join('；')}`);
      }
    }
    if (moved) this.markGoalWrite();
    return notices;
  }

  protected publishGoalPlanEdges(trigger: 'piggyback' | 'debounce'): void {
    const notices = this.coordinateGoalPlans();
    if (notices.length === 0) return;
    this.emit('minecraft.event', `[Minecraft] 目标旁证：${notices.join('；')}`, false, { trigger });
  }

  /** 坐标旁边那一句「离『新家』82 格」;表空、太远或还没对上命名空间时 null */
  protected nearMarkNote(p: Vec3like, dimension?: string): string | null {
    return nearMarkText(
      this.marks().list,
      p,
      false,
      normalizeDimension(dimension ?? this.bridge?.bot?.game?.dimension),
    );
  }

  // ── mc_blueprint ─────────────────────────────────────────────────────────

  /**
   * mc_blueprint:四条路(查询 / save / design / unload)。与 mc_goal 同一档 ——
   * 不进队列、不产生任务事件;design 的构思在后台跑,这里只给受理回执。
   */
  protected setBlueprint(args: Record<string, unknown>): string {
    const op = parseBlueprintArgs(args);
    if ('error' in op) return `[mc_blueprint 失败] ${op.error}`;
    // 施工绑定是 realm 域的:取之前先对一次命名空间(她可能在连上之前就交了图)
    this.syncRealm();
    switch (op.kind) {
      case 'query': return this.blueprintQuery();
      case 'unload': return this.blueprintUnload(op.key);
      case 'save': return this.blueprintSave(op);
      case 'design': return this.blueprintDesign(op);
      case 'accept': return this.blueprintAccept(op);
      case 'reserveOverride': return this.blueprintReserveOverride(op);
    }
  }

  /** 三分账单的两栏库存:随身现读背包,在箱读容器账本(口径都是「上次看见」) */
  protected stockNow(): BlueprintStock {
    const bot = this.bridge?.bot as {
      inventory?: { items(): Array<{ name: string; count: number }>; selectedItem?: { name: string; count: number } | null };
      currentWindow?: { selectedItem?: { name: string; count: number } | null } | null;
      game?: { dimension?: string };
    } | null | undefined;
    const carried: Record<string, number> = {};
    for (const it of bot?.inventory?.items?.() ?? []) {
      carried[it.name] = (carried[it.name] ?? 0) + it.count;
    }
    // 槽位事务中光标所持栈不在 items() 中，须计入随身库存以免误记消耗。
    const cursor = bot?.currentWindow?.selectedItem ?? bot?.inventory?.selectedItem;
    if (cursor) carried[cursor.name] = (carried[cursor.name] ?? 0) + cursor.count;
    return { carried, stored: this.chests.tally(String(bot?.game?.dimension ?? 'overworld')) };
  }

  /**
   * reserve 只取当前 realm 已开工版本的剩余 IR。
   * 开工要求存在施工绑定且 startedAt 非空；draft 和只 survey 的绑定不参与。
   */
  protected syncBlueprintResources(projectConsumption: Readonly<Record<string, number>> = {}): void {
    const settled = this.settleBlueprintOwnedConsumptions(this.stockNow().carried);
    const consumption = { ...projectConsumption };
    for (const [item, count] of Object.entries(settled)) consumption[item] = (consumption[item] ?? 0) + count;
    const changed = this.blueprintResources.sync(this.blueprints.list().flatMap((design) => {
      const bound = this.blueprints.binding(design.key);
      if (!bound || bound.startedAt === null) return [];
      const remaining = this.blueprintRemainingBill(design.key);
      return [{
        key: design.key,
        versionId: design.versionId,
        remaining,
      }];
    }));
    const observed = this.blueprintResources.observe(this.stockNow().carried, Date.now(), consumption);
    this.recordBlueprintResourceObservation(observed, changed);
  }

  protected blueprintResourceScope(key: string, versionId: string, anchor: PositionXYZ): string {
    return JSON.stringify([this.realmKey(), normalizeDimension(this.bridge?.bot?.game?.dimension), key, versionId, anchor]);
  }

  protected blueprintRemainingBill(key: string): BlueprintStep[] {
    const design = this.blueprints.get(key);
    if (!design) return [];
    const bound = this.blueprints.binding(key);
    const reading = this.blueprintResourceReadings.get(key);
    const fresh = !!reading && reading.bot === this.bridge?.bot && !!bound
      && reading.scope === this.blueprintResourceScope(key, design.versionId, bound.anchor);
    return fresh
      ? remainingPlacementBillSteps(design.plan.steps.filter((step) => reading.remainingSteps.has(step.index)), reading.placements)
      : design.plan.steps.slice(bound?.cursor ?? 0);
  }

  protected observeBlueprintRemaining(key: string, versionId: string, anchor: PositionXYZ,
    remainingSteps: readonly number[], placements: Readonly<Record<number, readonly PositionXYZ[]>>): void {
    const bot = this.bridge?.bot;
    const design = this.blueprints.get(key);
    const bound = this.blueprints.binding(key);
    if (!bot || design?.versionId !== versionId || !bound || bound.startedAt === null
      || bound.anchor.some((n, index) => n !== anchor[index])) return;
    this.blueprintResourceReadings.set(key, { bot,
      scope: this.blueprintResourceScope(key, versionId, anchor), remainingSteps: new Set(remainingSteps),
      placements: Object.fromEntries(Object.entries(placements).map(([index, cells]) => [index, cells.map((cell) => [...cell])])),
    });
    this.syncBlueprintResources();
  }

  protected proveBlueprintPlacement(bot: Bot, item: string, intent: BlueprintPlacementIntent): BlueprintOwnedConsumption | null {
    const design = this.blueprints.get(intent.key);
    const bound = this.blueprints.binding(intent.key);
    if (intent.aborted() || design?.versionId !== intent.versionId || !bound || bound.startedAt === null
      || bound.anchor.some((n, index) => n !== intent.anchor[index])) return null;
    const local = intent.at.map((n, index) => n - bound.anchor[index]);
    const step = design.plan.steps.find((candidate) =>
      local.every((n, index) => Number.isInteger(n) && n >= candidate.from[index] && n <= candidate.to[index])
      && (candidate.method.kind === 'place'
        ? candidate.item === item : candidate.method.baseItem?.includes(item)));
    if (!step) return null;
    const raw = worldStateAt(bot, { x: intent.at[0], y: intent.at[1], z: intent.at[2] });
    if (raw === null || blueprintStepStateMatches(step, raw)
      || (step.method.kind === 'place' && blockIdOf(normalizeBlockName(raw)) === blockIdOf(step.state))
      || (step.method.kind === 'use' && blockIdOf(normalizeBlockName(raw)) === `minecraft:${item}`)) return null;
    return { bot, life: this.blueprintPlacementLives.get(bot) ?? 0,
      intent: { ...intent, anchor: [...intent.anchor], at: [...intent.at] }, item, step,
      scope: this.blueprintResourceScope(intent.key, intent.versionId, intent.anchor),
      maxAfter: (this.stockNow().carried[item] ?? 0) - 1 };
  }

  protected blueprintConsumptionCurrent(fact: BlueprintOwnedConsumption): boolean {
    const design = this.blueprints.get(fact.intent.key);
    const bound = this.blueprints.binding(fact.intent.key);
    return this.bridge?.bot === fact.bot && fact.life === (this.blueprintPlacementLives.get(fact.bot) ?? 0)
      && design?.versionId === fact.intent.versionId && !!bound
      && bound.startedAt !== null && bound.anchor.every((n, index) => n === fact.intent.anchor[index])
      && fact.scope === this.blueprintResourceScope(fact.intent.key, fact.intent.versionId, fact.intent.anchor);
  }

  protected completeBlueprintPlacement(fact: BlueprintOwnedConsumption): void {
    const reading = this.blueprintResourceReadings.get(fact.intent.key);
    if (!reading || reading.bot !== fact.bot || reading.scope !== fact.scope || fact.step.method.kind !== 'place') return;
    const actual = worldStateAt(fact.bot, { x: fact.intent.at[0], y: fact.intent.at[1], z: fact.intent.at[2] });
    if (actual === null || !this.blueprintPlacedStateMatches(fact, actual)) return;
    const local = fact.intent.at.map((n, index) => n - fact.intent.anchor[index]);
    const cells = reading.placements[fact.step.index];
    if (cells) reading.placements[fact.step.index] = cells.filter((cell) => !cell.every((n, index) => n === local[index]));
  }

  protected blueprintPlacedStateMatches(fact: BlueprintOwnedConsumption, actual: string): boolean {
    const id = blockIdOf(normalizeBlockName(actual));
    // 正式放置以编译后的目标块核验，物品名只用于库存；原地加工的基材另有明确物品契约。
    return id === (fact.step.method.kind === 'place' ? blockIdOf(fact.step.state) : `minecraft:${fact.item}`);
  }

  /** 迟到库存只在没有后续改写的同连接内可归属到那次放置；不猜测两笔交错的扣料。 */
  protected observeBlueprintInventoryWrites(bot: Bot): void {
    if (this.blueprintInventoryWriteDetach.has(bot)) return;
    const client = bot._client;
    if (typeof client?.write !== 'function') return;
    const original = client.write;
    const world = this;
    const observed: typeof client.write = function (this: typeof client, name, packet) {
      const data = packet && typeof packet === 'object' ? packet as Record<string, unknown> : {};
      const changesInventory = ['window_click', 'block_place', 'use_item', 'creative_inventory_action'].includes(name)
        || (name === 'block_dig' && [3, 4, 5].includes(Number(data.status)))
        || (name === 'use_entity' && [0, 2].includes(Number(data.mouse)));
      if (changesInventory && world.bridge?.bot === bot
        && world.blueprintOwnedConsumptions.some((fact) => fact.bot === bot)) {
        world.observeBlueprintResources();
        const unresolved = world.blueprintOwnedConsumptions.filter((fact) => fact.bot === bot);
        for (const fact of unresolved) {
          fact.ambiguous = true;
          world.blueprintOwnedConsumptions.splice(world.blueprintOwnedConsumptions.indexOf(fact), 1);
        }
        if (unresolved.length > 0) world.diag.write({ lane: 'tool', event: 'blueprint-material-unconfirmed',
          msg: '正式施工目标已回读，库存扣料未同步前发生另一笔库存改写；未将后续数量变化认作原施工消耗',
          data: { packet: name, targets: unresolved.map((fact) => ({ key: fact.intent.key,
            versionId: fact.intent.versionId, at: fact.intent.at, item: fact.item })) } });
      }
      return original.call(this, name, packet);
    };
    client.write = observed;
    const changedLife = (): void => {
      this.blueprintPlacementLives.set(bot, (this.blueprintPlacementLives.get(bot) ?? 0) + 1);
      for (const fact of [...this.blueprintOwnedConsumptions]) {
        if (fact.bot === bot) this.blueprintOwnedConsumptions.splice(this.blueprintOwnedConsumptions.indexOf(fact), 1);
      }
      for (const [key, reading] of this.blueprintResourceReadings) {
        if (reading.bot === bot) this.blueprintResourceReadings.delete(key);
      }
    };
    bot.on?.('death', changedLife);
    bot.on?.('respawn', changedLife);
    const detach = (): void => {
      if (client.write === observed) client.write = original;
      bot.removeListener?.('death', changedLife);
      bot.removeListener?.('respawn', changedLife);
      this.blueprintInventoryWriteDetach.delete(bot);
      for (const fact of [...this.blueprintOwnedConsumptions]) {
        if (fact.bot === bot) this.blueprintOwnedConsumptions.splice(this.blueprintOwnedConsumptions.indexOf(fact), 1);
      }
    };
    this.blueprintInventoryWriteDetach.set(bot, detach);
    client.once?.('end', detach);
  }

  /** 执行器每次普通放置都取得一次 permit；库存差额在 permit 收尾时统一结算。 */
  protected permitBlueprintResourcePlacement(item: string, intent?: BlueprintPlacementIntent): ResourcePlacementPermit {
    const bot = this.bridge?.bot;
    if (!bot) return { ok: false, reason: '当前没连上服务器,无法核对蓝图材料 reserve' };
    if (this.blueprintPlacementBot !== bot) {
      this.blueprintPlacementBot = bot;
      this.blueprintPlacementHolds = 0;
    }
    // Executor 串行执行放置；上一块未结算时不发第二张 permit，覆盖预算不会被并发超领。
    if (this.blueprintPlacementHolds > 0) return { ok: false, reason: '上一块材料还在结算,这次放置稍后再试' };
    this.settleBlueprintInventoryNow();
    this.observeBlueprintResources();
    if (this.blueprintOwnedConsumptions.some((pending) => pending.bot === bot && pending.item === item)) {
      return { ok: false, reason: `${item} 的上一块正式施工已回读，但材料扣减仍待同步；不能把同一份扣料用于第二块` };
    }
    const fact = intent ? this.proveBlueprintPlacement(bot, item, intent) : null;
    if (intent && !fact) return { ok: false, reason: '蓝图施工身份、绑定位置或目标物品已变化，不能使用这份工程材料许可' };
    const decision = this.blueprintResources.placementDecision(item, this.stockNow().carried, Date.now(),
      fact ? { key: fact.intent.key, versionId: fact.intent.versionId } : undefined);
    if (!decision.ok) return decision;
    if (fact) this.observeBlueprintInventoryWrites(bot);
    this.blueprintPlacementHolds++;
    let finished = false;
    return {
      ok: true,
      finish: async (placed) => {
        if (finished) return;
        finished = true;
        try {
          if (!placed || !fact) return;
          if (!this.blueprintConsumptionCurrent(fact)) throw new Aborted('施工连接或版本已变化');
          if (!this.blueprintPlacedStateMatches(fact, worldStateAt(bot, { x: intent!.at[0], y: intent!.at[1], z: intent!.at[2] }) ?? '')) {
            throw new SkillBlocked('正式施工目标尚未回读到该物品，没有扣减工程材料账');
          }
          this.completeBlueprintPlacement(fact);
          if (bot.game.gameMode === 'creative') {
            this.syncBlueprintResources();
            return;
          }
          this.blueprintOwnedConsumptions.push(fact);
          this.syncBlueprintResources();
          const deadline = Date.now() + BLUEPRINT_PLACEMENT_SETTLE_MS;
          while (true) {
            if (!this.blueprintConsumptionCurrent(fact)) throw new Aborted('施工连接或版本已变化');
            if (fact.ambiguous) throw new SkillBlocked('目标方块已确认，但扣料尚未同步前有另一笔库存改写；无法确认本步材料消耗');
            this.observeBlueprintResources();
            if (!this.blueprintOwnedConsumptions.includes(fact)) return;
            if (intent!.aborted()) throw new Aborted('材料结算时任务已取消');
            if (Date.now() >= deadline) break;
            await sleep(50);
          }
          throw new SkillBlocked('目标方块已确认，但材料数量尚未扣减；本步材料仍待服务端同步，没有记成临时借料');
        } finally {
          if (this.blueprintPlacementBot === bot) this.blueprintPlacementHolds = Math.max(0, this.blueprintPlacementHolds - 1);
          if (this.blueprintPlacementHolds === 0 && this.bridge?.bot === bot) this.observeBlueprintResources();
        }
      },
    };
  }

  /** 纯只读的 placementDecision 预览；不取得 permit、不占串行闸，也不扣账。 */
  protected previewBlueprintResourcePlacement(item: string): { ok: boolean; reason?: string } {
    if (!this.bridge?.bot) return { ok: false, reason: '当前没连上服务器,无法核对蓝图材料 reserve' };
    this.settleBlueprintInventoryNow();
    return this.blueprintResources.placementDecision(item, this.stockNow().carried);
  }

  /**
   * 防抖窗口的逃生口:判据入口必须读结算过的库存。槽位事务的防抖(500ms)期间
   * `placementDecision` 读到的还是变动前的 carried,会照旧库存判 reserve。
   */
  protected settleBlueprintInventoryNow(): void {
    if (!this.blueprintInventoryTimer) return;
    clearTimeout(this.blueprintInventoryTimer);
    this.blueprintInventoryTimer = null;
    if (this.blueprintPlacementHolds > 0) return;
    this.observeBlueprintResources();
  }

  /** 库存每次变动都把“盈余 → 保留料”的边界与临时预算结清。 */
  protected observeBlueprintResources(): void {
    const stock = this.stockNow().carried;
    const projectConsumption = this.settleBlueprintOwnedConsumptions(stock);
    if (Object.keys(projectConsumption).length > 0) {
      this.syncBlueprintResources(projectConsumption);
      return;
    }
    const result = this.blueprintResources.observe(stock);
    this.recordBlueprintResourceObservation(result, false);
  }

  protected settleBlueprintOwnedConsumptions(stock: Readonly<Record<string, number>>): Record<string, number> {
    const projectConsumption: Record<string, number> = {};
    for (const fact of [...this.blueprintOwnedConsumptions]) {
      if (!this.blueprintConsumptionCurrent(fact)) {
        this.blueprintOwnedConsumptions.splice(this.blueprintOwnedConsumptions.indexOf(fact), 1);
        continue;
      }
      if ((stock[fact.item] ?? 0) > fact.maxAfter) continue;
      this.blueprintOwnedConsumptions.splice(this.blueprintOwnedConsumptions.indexOf(fact), 1);
      this.completeBlueprintPlacement(fact);
      projectConsumption[fact.item] = (projectConsumption[fact.item] ?? 0) + 1;
    }
    return projectConsumption;
  }

  /** 合并一次槽位事务的中间态，避免游标暂存被误判成材料借出或库存跨线。 */
  protected scheduleBlueprintResourceObservation(bot: unknown): void {
    if (this.blueprintInventoryTimer) clearTimeout(this.blueprintInventoryTimer);
    this.blueprintInventoryTimer = setTimeout(() => {
      this.blueprintInventoryTimer = null;
      if (this.bridge?.bot !== bot || this.blueprintPlacementHolds > 0) return;
      this.observeBlueprintResources();
    }, BLUEPRINT_INVENTORY_SETTLE_MS);
    this.blueprintInventoryTimer.unref?.();
  }

  protected recordBlueprintResourceObservation(
    result: { retune: boolean; borrowed: Readonly<Record<string, number>> },
    projectChanged: boolean,
  ): void {
    if (projectChanged || result.retune) this.bridge?.retune();
    if (Object.keys(result.borrowed).length > 0) {
      this.diag.write({
        lane: 'tool', event: 'blueprint-reserve-borrow',
        msg: `蓝图保留料临时动用:${Object.entries(result.borrowed).map(([item, n]) => `${item}×${n}`).join('、')}`,
        data: { borrowed: result.borrowed },
      });
    }
  }

  /** 当下生效的垫脚名单(她设的那份,没设过用寻路器默认那份) */
  protected scaffoldWanted(): string[] {
    return this.policy.get().scaffold ?? [...this.cfg.scaffoldBlocks];
  }

  /** 当下生效的照明名单;与垫脚名单同路豁免蓝图 reserve(见 ledger 的 scaffoldExempt) */
  protected lightWanted(): string[] {
    return this.policy.get().light ?? this.policyDefaults().light;
  }

  /**
   * 寻路器拿的垫脚名单。蓝图预留只做软降位,**永不把名单扣空** —— bridge 收到空数组
   * 就是完全禁垫且不出一句 warn,那个语义只该出自她自己把 policy.scaffold 设成 []。
   */
  protected scaffoldBlocksForUse(): string[] {
    return this.blueprintResources.orderScaffoldCandidates(this.scaffoldWanted(), this.stockNow().carried);
  }

  /**
   * 垫脚名单里此刻被蓝图预留收口的那几样。策略文本的事实标注读它,
   * 与寻路器的降位、逐块 permit 的否决同源(三处不许各算各的)。
   *
   * 豁免集改成「当前生效垫脚名单」之后,这一份在稳态下恒空(名单即豁免集):留着是
   * 因为它读的是账本现状而不是名单本身 —— 哪天豁免口径再变,标注不必跟着重写。
   */
  protected blueprintHeldScaffold(): string[] {
    const held = new Set(this.blueprintResources.collapsedItems(this.stockNow().carried));
    return this.scaffoldWanted().filter((item) => held.has(item));
  }

  /**
   * 「活跃蓝图」:被目标点名的那一张,或者一共就装载了一张。
   * 说不清是哪一张(两条目标各挂一张)就不搭车 —— 猜错了的那句提示比不提示更贵。
   */
  protected activeBlueprintKey(): string | null {
    const loaded = this.blueprints.keys();
    if (loaded.length === 0) return null;
    const named = [...new Set(this.goalTable().list
      .map((g) => g.blueprint)
      .filter((k): k is string => k !== null && loaded.includes(k)))];
    if (named.length === 1) return named[0];
    if (named.length > 1) return null;
    return loaded.length === 1 ? loaded[0] : null;
  }

  protected blueprintPathZones(): SiteZone[] {
    const desk = this.blueprintDesk();
    const out: SiteZone[] = [];
    for (const key of desk.keys()) {
      const site = desk.get(key);
      if (!site?.anchor) continue;
      const [sx, sy, sz] = site.blueprint.size_xyz;
      out.push({
        key: site.key,
        min: [...site.anchor],
        max: [site.anchor[0] + sx - 1, site.anchor[1] + sy - 1, site.anchor[2] + sz - 1],
        materials: site.plan.steps.map((s) => s.item),
      });
    }
    return out;
  }

  /** 执行器那一侧的蓝图取用面(照 spawnAnchor 的接法:World 持有,技能只读+写游标) */
  protected blueprintDesk(): BlueprintDesk {
    return {
      get: (key) => {
        const design = this.blueprints.get(key);
        if (!design) return null;
        const bound = this.blueprints.binding(key);
        return {
          key: design.key,
          versionId: design.versionId,
          name: design.name,
          blueprint: design.blueprint,
          plan: design.plan,
          anchor: bound?.anchor ?? null,
          cursor: bound?.cursor ?? 0,
          survey: bound?.survey ?? null,
          startedAt: bound?.startedAt ?? null,
        };
      },
      keys: () => this.blueprints.keys(),
      activeKey: () => this.activeBlueprintKey(),
      bind: (key, anchor) => this.blueprints.bind(key, anchor),
      survey: (key, anchor, result) => this.blueprints.survey(key, anchor, result),
      progress: (key, cursor) => {
        this.blueprints.progress(key, cursor);
        const design = this.blueprints.get(key);
        const bound = this.blueprints.binding(key);
        const reading = this.blueprintResourceReadings.get(key);
        if (reading && reading.bot === this.bridge?.bot && design && bound
          && reading.scope === this.blueprintResourceScope(key, design.versionId, bound.anchor)) {
          for (const index of reading.remainingSteps) if (index < cursor) reading.remainingSteps.delete(index);
        }
        this.syncBlueprintResources();
      },
      observeRemaining: (key, versionId, anchor, remaining, placements) =>
        this.observeBlueprintRemaining(key, versionId, anchor, remaining, placements),
      remainingBill: (key) => this.blueprintRemainingBill(key),
      stored: () => this.stockNow().stored,
    };
  }

  /** `{}`:装载着哪几份、施工到哪儿、还缺什么;分批收着的也报 */
  protected blueprintQuery(): string {
    const all = this.blueprints.list();
    const streams = [...this.blueprintStreams.values()].map((d) =>
      `${d.label.key} 收了 ${d.layers.length}/${d.size[1]} 层(version:${d.versionId})`);
    const ready = [...this.blueprintReadyDrafts.values()].map((d) =>
      `${d.label.key}${d.label.name ? `「${d.label.name}」` : ''} ${d.versionId} hash:${d.contentHash} 已完整,待 accept`);
    const drafts = [...streams, ...ready];
    const reserve = Object.entries(this.blueprintResources.reserve())
      .sort(([, left], [, right]) => right - left)
      .map(([item, count]) => `${zhName(item)} ${count}`);
    const activeOverride = this.blueprintResources.activeOverride();
    const markers = this.blueprintResources.restockMarkers();
    const resourceLines = [
      reserve.length > 0 ? `蓝图剩余材料 reserve:${reserve.join('、')}` : '',
      activeOverride
        ? `材料临时覆盖 ${activeOverride.id} 还剩 ${activeOverride.maxBlocks - activeOverride.spent} 块预算`
          + `,约 ${Math.max(0, Math.ceil((activeOverride.expiresAt - Date.now()) / 1000))} 秒,原因:${activeOverride.reason}`
        : '',
      markers.length > 0
        ? `需补料:已登记 ${markers.length} 次实际借料;最近一次「${markers.at(-1)!.reason}」最多 ${markers.at(-1)!.maxBlocks} 块`
        : '',
    ].filter(Boolean);
    if (all.length === 0) {
      const head = '这边一份蓝图都没装载。要新图就 mc_blueprint 的 design;'
        + '笔记里存过现成数据的话直接 save 交回来。';
      return [head, drafts.length > 0 ? `分批交着的:${drafts.join('、')}` : '', ...resourceLines]
        .filter(Boolean).join('\n');
    }
    const lines = all.map((d) => {
      const bound = this.blueprints.binding(d.key);
      const progress = blueprintProgress(d.plan.steps, bound?.cursor ?? 0);
      const where = bound
        ? bound.startedAt === null
          ? `锚点 (${bound.anchor.join(', ')});初探已保存,尚未开工`
            + `${bound.survey
              ? `(冲突 ${bound.survey.wrongBlock + bound.survey.shouldBeAir} 格,读不到 ${bound.survey.unknown} 格)`
              : ''}`
          : `锚点 (${bound.anchor.join(', ')});已施工 ${progress.steps.done}/${progress.steps.total} 步`
            + `(${Math.round(progress.ratio * 100)}%${progress.layer.y === null ? '' : `,正在第 ${progress.layer.y} 层`}`
            + `,${CURSOR_AS_OF})`
        : '这个世界里还没开工(第一次 build 要给 at 锚点)';
      const bill = billForSteps(this.blueprintRemainingBill(d.key), this.stockNow());
      const short = bill.lines.find((line) => line.missing > 0);
      const heldGap = bill.lines.find((line) => line.carried < line.need);
      const miss = short ? `;按历史账还缺${zhName(short.item)} ${short.missing}`
        : heldGap ? `;随身还需${zhName(heldGap.item)} ${heldGap.need - heldGap.carried}`
          + `（容器历史合计 ${heldGap.stored}，需复核来源并取出）`
          : bill.lines.length > 0 ? ';随身材料数量够' : ';无剩余放置材料';
      return `· ${d.key}${d.name ? `「${d.name}」` : ''} ${d.blueprint.size_xyz.join('×')}`
        + ` [${blueprintModeText(d.blueprint)}]`
        + ` [version:${d.versionId};hash:${d.contentHash}],`
        + `${d.plan.placeCells} 格 / ${d.plan.steps.length} 步 —— ${where}${miss}`;
    });
    const tail = drafts.length > 0 ? `分批交着的:${drafts.join('、')}` : '';
    return [`装载着 ${all.length} 份:`, lines.join('\n'), tail, ...resourceLines].filter(Boolean).join('\n');
  }

  protected blueprintMutationOf(key: string): number {
    return this.blueprintMutationGeneration.get(key) ?? 0;
  }

  protected markBlueprintMutation(key: string): void {
    this.blueprintMutationGeneration.set(key, this.blueprintMutationOf(key) + 1);
  }

  /** `{unload}`:设计连缓存一起删,本世界的施工进度跟着没 */
  protected blueprintUnload(key: string): string {
    this.markBlueprintMutation(key);
    const had = this.blueprints.get(key);
    const drafted = [
      ...[...this.blueprintStreams].filter(([, draft]) => draft.label.key === key).map(([id]) => id),
      ...[...this.blueprintReadyDrafts].filter(([, draft]) => draft.label.key === key).map(([id]) => id),
    ];
    for (const id of drafted) {
      this.blueprintStreams.delete(id);
      this.blueprintReadyDrafts.delete(id);
    }
    const gone = this.blueprints.unload(key);
    this.syncBlueprintResources();
    if (!gone.had) {
      const draftNote = drafted.length > 0 ? `(同时丢掉 ${drafted.length} 份 draft)` : '';
      return `「${key}」本来就没装载,什么都没动${draftNote}。\n${this.blueprintQuery()}`;
    }
    const left = this.blueprints.list().length;
    return `「${key}」${had?.name ? `「${had.name}」` : ''}卸了:设计连 data/ 缓存一起删,`
      + `${gone.boundHere ? '这个世界那份施工进度(锚点与游标)也没了' : '这个世界本来也没开工'};`
      + `${left > 0 ? `还装载着 ${left} 份` : '现在一份都不剩了'}。${BLUEPRINT_OVERNIGHT_NOTE}`;
  }

  /** `{save}`:整份交或分批交,最后都走同一个受理管线 */
  protected blueprintSave(op: Extract<BlueprintOp, { kind: 'save' }>): string {
    const key = op.label.key;
    const job = op.jobId === null ? null : this.designInFlight;
    if (op.jobId !== null && (!job || job.id !== op.jobId || job.key !== key)) {
      return `[mc_blueprint 失败] job_id「${op.jobId}」不是当前这份「${key}」的在途构思;`
        + '后台交稿必须照任务说明原样带 id,前台直接 save 不要写 job_id';
    }
    if (!op.append) {
      if (op.versionId) return '[mc_blueprint 失败] 整份 save 会新建版本,不要写 version_id';
      const prepared = this.blueprintPrepare(op.label, op.submission, op.jobId);
      if (!prepared.ok) return prepared.receipt;
      if (job) {
        this.blueprintReadyDrafts.set(prepared.draft.versionId, prepared.draft);
        job.outputVersionId = prepared.draft.versionId;
        return this.blueprintReadyReceipt(prepared.draft, '后台交稿已绑定本轮 job,等本轮收尾后再决定是否提升');
      }
      return this.blueprintPromote(prepared.draft).receipt;
    }
    const size = readSize(op.submission.size_xyz);
    if (!size) return '[mc_blueprint 失败] 分批交每一批都要带同一个 size_xyz:[X,Y,Z](三个正整数)';
    const siteMode = op.submission.site_mode;
    if (siteMode !== 'new' && siteMode !== 'retrofit') {
      return '[mc_blueprint 失败] 分批交每一批都要带同一个 site_mode:new 或 retrofit';
    }
    const palette = op.submission.palette;
    if (!Array.isArray(palette) || palette.length === 0) {
      return '[mc_blueprint 失败] 分批交每一批都要带同一份 palette(非空数组)';
    }
    const layers = op.submission.layers;
    if (!Array.isArray(layers) || layers.length === 0) {
      return '[mc_blueprint 失败] 这一批的 layers 是空的,没有可收的层';
    }
    const paletteKey = JSON.stringify(palette);
    const candidates = [...this.blueprintStreams.values()].filter((draft) =>
      draft.label.key === key && draft.sourceJobId === op.jobId);
    const prev = op.versionId
      ? this.blueprintStreams.get(op.versionId)
      : candidates.length === 1 ? candidates[0] : undefined;
    if (op.versionId && !prev) {
      return `[mc_blueprint 失败] version_id「${op.versionId}」没有对应的分批 draft;照首批回执原样填写`;
    }
    if (prev && (prev.label.key !== key || prev.sourceJobId !== op.jobId)) {
      return `[mc_blueprint 失败] version_id「${prev.versionId}」属于另一份键或另一个 job,不能串批`;
    }
    if (prev) {
      if (prev.size.some((v, i) => v !== size[i])) {
        return `[mc_blueprint 失败] 这一批的 size_xyz [${size.join(',')}] 与前几批的 `
          + `[${prev.size.join(',')}] 对不上;要换尺寸就别带 append,重新交一整份`;
      }
      if (prev.paletteKey !== paletteKey) {
        return '[mc_blueprint 失败] 分批的 palette 必须逐条一样(索引对不上就是另一份图);'
          + '要改 palette 就别带 append,重新交一整份';
      }
      if (prev.siteMode !== siteMode) {
        return `[mc_blueprint 失败] 这一批的 site_mode:${siteMode} 与前几批的 ${prev.siteMode} 对不上;`
          + '要换场地模式就别带 append,重新交一整份';
      }
    }
    const draft: BlueprintStreamDraft = prev
      ?? {
        kind: 'stream', versionId: createBlueprintVersionId(), sourceJobId: op.jobId,
        label: op.label, size, siteMode, paletteKey, palette, layers: [], at: Date.now(),
      };
    const from = draft.layers.length;
    if (from + layers.length > size[1]) {
      return `[mc_blueprint 失败] 已经收了 ${from} 层,这一批又来 ${layers.length} 层,`
        + `超过声明的 ${size[1]} 层;这一批一层都没收`;
    }
    for (let i = 0; i < layers.length; i++) {
      const bad = checkLayerShape(layers[i], from + i, size, palette.length);
      if (bad) return `[mc_blueprint 失败] 这一批第 ${i + 1} 层过不了,整批没收:\n· ${bad}`;
    }
    draft.layers.push(...layers);
    if (op.label.name) draft.label = { key, name: op.label.name };
    this.blueprintStreams.set(draft.versionId, draft);
    const to = draft.layers.length - 1;
    if (draft.layers.length < size[1]) {
      return `[mc_blueprint] 「${key}」draft ${draft.versionId} 收到第 ${from}..${to} 层,`
        + `还差 ${size[1] - draft.layers.length} 层(一共 ${size[1]} 层);`
        + `接着 append 并原样带 "version_id":"${draft.versionId}"。`;
    }
    this.blueprintStreams.delete(draft.versionId);
    const prepared = this.blueprintPrepare(draft.label, {
      key,
      ...(draft.label.name ? { name: draft.label.name } : {}),
      site_mode: draft.siteMode,
      size_xyz: size,
      axis_order: AXIS_ORDER,
      palette,
      layers: draft.layers,
    }, draft.sourceJobId, draft.versionId);
    if (!prepared.ok) return prepared.receipt;
    this.blueprintReadyDrafts.set(prepared.draft.versionId, prepared.draft);
    if (job) job.outputVersionId = prepared.draft.versionId;
    return this.blueprintReadyReceipt(
      prepared.draft,
      job ? '完整 draft 已绑定本轮 job,等本轮收尾后再决定是否提升' : '分批已齐,仍是 draft,没有替换当前可执行版本',
    );
  }

  /** 受理一份完整内容，生成不可变版本身份；这一步不改 current。 */
  protected blueprintPrepare(
    label: BlueprintLabel,
    submission: Record<string, unknown>,
    sourceJobId: string | null,
    versionId = createBlueprintVersionId(),
  ): { ok: true; draft: BlueprintReadyDraft } | { ok: false; receipt: string } {
    const accepted = acceptBlueprint(submission);
    if (!accepted.ok || !accepted.blueprint || !accepted.plan || !accepted.metrics) {
      return {
        ok: false,
        receipt: `[mc_blueprint 失败] 「${label.key}」这一份没收下:\n`
          + `${renderBlueprintFailures(accepted.failures)}\n改完重交(整份,或分批带 append)。`,
      };
    }
    const repairText = accepted.repair.applied
      ? `收下前顺手补了:${accepted.repair.actions.map((a) => `${a.message}×${a.count}`).join('、')}。`
      : '';
    return {
      ok: true,
      draft: {
        kind: 'ready', label, sourceJobId, versionId,
        contentHash: blueprintContentHash(accepted.blueprint),
        blueprint: accepted.blueprint, plan: accepted.plan, metrics: accepted.metrics,
        repairText, at: Date.now(),
      },
    };
  }

  /** 后台 job 交稿回执不附 accept 邀约，避免 fork 在收尾前消费 readyDrafts。 */
  protected blueprintReadyReceipt(draft: BlueprintReadyDraft, note: string): string {
    const coda = draft.sourceJobId !== null
      ? '不用交 accept,本轮收尾会自动定夺提升。'
      : `确认提升请交 {"accept":{"key":"${draft.label.key}","version_id":"${draft.versionId}",`
        + `"content_hash":"${draft.contentHash}"}}。`;
    return `[mc_blueprint] 「${draft.label.key}」${note}。\n`
      + `${draft.metrics.size_xyz.join('×')},${blueprintModeText(draft.blueprint)},`
      + `${draft.plan.placeCells} 个施工格/${draft.plan.steps.length} 步。${draft.repairText}\n`
      + (draft.plan.advisories.length > 0
        ? `设计检查与现场待验：\n${renderBlueprintAdvisories(draft.plan.advisories)}\n` : '')
      + `draft version_id:${draft.versionId}\ncontent_hash:${draft.contentHash}\n`
      + coda;
  }

  /** draft → accepted/current；可选 expected 是后台 job 的同键代次比较并交换边界。 */
  protected blueprintPromote(
    draft: BlueprintReadyDraft,
    expected: { generation: number; versionId: string | null } | undefined = undefined,
  ): { ok: true; design: BlueprintDesign; receipt: string } | { ok: false; receipt: string } {
    const current = this.blueprints.get(draft.label.key);
    if (expected && this.blueprintMutationOf(draft.label.key) !== expected.generation) {
      return {
        ok: false,
        receipt: `同键 current 在后台构思期间发生过保存、卸载或清空(`
          + `${expected.versionId ?? '空'} → ${current?.versionId ?? '空'});`
          + `后台 draft ${draft.versionId} 保留待审,没有覆盖 current`,
      };
    }
    const design = this.blueprints.save(draft.label, {
      blueprint: draft.blueprint,
      plan: draft.plan,
      metrics: draft.metrics,
    }, { versionId: draft.versionId, contentHash: draft.contentHash }, draft.sourceJobId);
    this.markBlueprintMutation(draft.label.key);
    this.blueprintReadyDrafts.delete(draft.versionId);
    this.syncBlueprintResources();
    const voids = blueprintVoidCounts(design.blueprint);
    this.diag.write({
      lane: 'tool', event: 'blueprint-save',
      msg: `蓝图「${design.key}」装载(${design.plan.steps.length} 步)`,
      data: {
        key: design.key, versionId: design.versionId, contentHash: design.contentHash,
        sourceJobId: design.sourceJobId, cells: design.plan.placeCells, steps: design.plan.steps.length,
      },
    });
    return {
      ok: true, design,
      receipt: `[mc_blueprint] 「${design.key}」${design.name ? `「${design.name}」` : ''}收下了:`
        + `${design.metrics.size_xyz.join('×')},${blueprintModeText(design.blueprint)},施工 ${design.plan.placeCells} 格`
        + `(明确清空 ${voids.clear} 格、保留原状 ${voids.preserve} 格),用料 top:${materialsTop(design.plan)};`
        + `编译成 ${design.plan.steps.length} 步。${draft.repairText}`
        + `版本 ${design.versionId},内容摘要 ${design.contentHash}。\n`
        + `已装载,build 就能用:{"skill":"build","blueprint":"${design.key}","at":[x,y,z]}`
        + '(at 是蓝图 [0,0,0] 落在世界的哪一格;改造图第一次只探测,'
        + '两种工地都要你审阅过冲突格、带 confirm:true 才清场)。'
        + `\n${BLUEPRINT_MATERIAL_NOTE}`
        + (design.plan.advisories.length > 0
          ? `\n这几条得靠现场满足(编译期看不见工地):\n${renderBlueprintAdvisories(design.plan.advisories)}`
          : '')
        + BLUEPRINT_OVERNIGHT_NOTE,
    };
  }

  protected blueprintAccept(op: Extract<BlueprintOp, { kind: 'accept' }>): string {
    const draft = this.blueprintReadyDrafts.get(op.versionId);
    if (!draft || draft.label.key !== op.key) {
      // 晋级会从 readyDrafts 移除草稿；current 已匹配同一版本及内容时，accept 幂等成功。
      const current = this.blueprints.get(op.key);
      if (current && current.versionId === op.versionId && current.contentHash === op.contentHash) {
        return `[mc_blueprint] 「${op.key}」这一份已经是当前可执行版本了,没有需要提升的`
          + `(版本 ${current.versionId},内容摘要 ${current.contentHash},`
          + `${current.plan.steps.length} 步)。build 直接就能用。`;
      }
      return `[mc_blueprint 失败] 「${op.key}」没有 version_id「${op.versionId}」这份完整 draft`;
    }
    if (draft.contentHash !== op.contentHash) {
      return `[mc_blueprint 失败] content_hash 对不上;draft 没提升,current 没变`;
    }
    return this.blueprintPromote(draft).receipt;
  }

  protected blueprintReserveOverride(op: Extract<BlueprintOp, { kind: 'reserveOverride' }>): string {
    const reserve = this.blueprintResources.reserve();
    if (Object.keys(reserve).length === 0) {
      return '[mc_blueprint 失败] 当前没有蓝图剩余材料 reserve,无需开临时覆盖';
    }
    this.blueprintResources.observe(this.stockNow().carried);
    const lease = this.blueprintResources.openOverride(op);
    if (this.resourceOverrideTimer) clearTimeout(this.resourceOverrideTimer);
    this.resourceOverrideTimer = setTimeout(() => {
      this.blueprintResources.activeOverride();
      this.bridge?.retune();
      this.resourceOverrideTimer = null;
    }, op.ttlMs);
    this.resourceOverrideTimer.unref?.();
    this.bridge?.retune();
    return `[mc_blueprint] 蓝图材料临时覆盖 ${lease.id} 已开启:${op.reason};`
      + `${op.ttlMs / 1000} 秒内最多借 ${op.maxBlocks} 块。实际跨入 reserve 的每一块都会扣预算,`
      + '到期或预算用完立即收口;首次实际借料后才会标记“需补料”。';
  }
  protected blueprintDesign(_op: Extract<BlueprintOp, {kind:'design'}>): string {
    return '[mc_blueprint 未受理] Design belongs to the host. Submit a blueprint with save; no model request or background task was started.';
  }


  /** 同键重出图时只带摘要与现场初探，不把满矩阵重新塞进上下文。 */
  protected blueprintRevisionContext(key: string): string {
    const design = this.blueprints.get(key);
    if (!design) return '';
    const bound = this.blueprints.binding(key);
    const lines = [
      `上一版:${design.blueprint.site_mode},${design.metrics.size_xyz.join('×')},`
        + `${design.plan.placeCells} 个施工格/${design.plan.steps.length} 步,用料:${materialsTop(design.plan)}。`,
    ];
    const survey = bound?.survey;
    if (bound && survey) {
      lines.push(
        `现场锚点(${bound.anchor.join(',')}):已符合 ${survey.matched},待处理 ${survey.missing},`
          + `错块 ${survey.wrongBlock},该空却占着 ${survey.shouldBeAir},读不到 ${survey.unknown}。`,
      );
      if (survey.samples.length > 0) lines.push(`冲突样本:${survey.samples.join('、')}。`);
    }
    lines.push('按这次主意识的新要求修订；带本轮 job_id 的 save 先形成独立版本，再由本轮收尾提升。');
    return lines.join('\n');
  }

  /** 精确消费 job 记录的 output；返回 false 表示本轮没有任何有效交稿。 */
  protected finishDesignOutput(
    op: Extract<BlueprintOp, { kind: 'design' }>,
    job: BlueprintDesignJob,
    text: string,
  ): boolean {
    if (!job.outputVersionId) return false;
    const draft = this.blueprintReadyDrafts.get(job.outputVersionId);
    if (!draft || draft.sourceJobId !== job.id || draft.label.key !== job.key) {
      // fork 可在收尾前 accept 并移除 readyDrafts；current 匹配本轮输出版本与 job 时仍算交稿成功。
      const current = this.blueprints.get(job.key);
      if (current && current.versionId === job.outputVersionId && current.sourceJobId === job.id) {
        this.designDone(op, text, current);
        return true;
      }
      return false;
    }
    const promoted = this.blueprintPromote(draft, {
      generation: job.baseGeneration,
      versionId: job.baseVersionId,
    });
    if (promoted.ok) this.designDone(op, text, promoted.design);
    else this.designDrafted(op, text, draft, promoted.receipt);
    return true;
  }

  /** 构思完成事件：设计自述、蓝图键及操作说明。 */
  protected designDone(op: { key: string; brief: string }, text: string, design: BlueprintDesign): void {
    this.diag.write({
      lane: 'tool', event: 'blueprint-design-done',
      msg: `蓝图「${op.key}」构思完成`,
      data: {
        key: op.key, jobId: design.sourceJobId, versionId: design.versionId,
        contentHash: design.contentHash, steps: design.plan.steps.length,
      },
    });
    this.emit('minecraft.event', [
      `[Minecraft] 「${design.key}」${design.name ? `「${design.name}」` : ''}的构思出来了,图已经装载好。`,
      text.trim(),
      `尺寸 ${design.metrics.size_xyz.join('×')},${blueprintModeText(design.blueprint)},`
        + `${design.plan.placeCells} 个施工格、${design.plan.steps.length} 步,用料 top:${materialsTop(design.plan)}。`,
      '接下来三件事:先跟观众说一声你要记一下;把键与一句描述记进笔记(整份数据别读进来);'
        + `要开工就 mc_goal 挂一条带这个键的目标,再下 {"skill":"build","blueprint":"${design.key}","at":[x,y,z]}。`
        + '第一次正式开工的回执会提醒你把工地锚点登记成路标。',
    ].filter(Boolean).join('\n'), true);
  }

  /** 构思交了完整版本，但同键 current 在途期间已变化；保留 draft 等明确审阅。 */
  protected designDrafted(
    op: { key: string },
    text: string,
    draft: BlueprintReadyDraft,
    reason: string,
  ): void {
    this.diag.write({
      lane: 'tool', event: 'blueprint-design-draft',
      msg: `蓝图「${op.key}」构思完成但未替换 current`,
      data: {
        key: op.key, jobId: draft.sourceJobId, versionId: draft.versionId,
        contentHash: draft.contentHash, reason,
      },
    });
    this.emit('minecraft.event', [
      `[Minecraft] 「${op.key}」的构思出来了,但后台期间 current 已变化；这份只留作 draft,没有替换可执行版本。`,
      text.trim(),
      reason,
      `draft version_id:${draft.versionId}`,
      `content_hash:${draft.contentHash}`,
      '审阅确认后用 mc_blueprint accept 精确提升；不确认就继续保留。',
    ].filter(Boolean).join('\n'), true);
  }

  /** 「构思没成」事件。**必须有**:没有它,那一单就成了永远等不到的下文 */
  protected designFailed(op: { key: string }, why: readonly string[]): void {
    const reason = why.length > 0 ? why.join(';') : '原因不明';
    this.diag.write({
      lane: 'tool', event: 'blueprint-design-failed',
      msg: `蓝图「${op.key}」构思没成:${reason}`,
      data: { key: op.key, why: [...why] },
    });
    this.emit(
      'minecraft.event',
      `[Minecraft] 「${op.key}」的构思没成:${reason}。`
      + '要再来一次就同一个键换个说法重下 design;自己有现成数据就直接 save。',
      true,
    );
  }

  /**
   * 她没设过名单时用哪一份。**名单只有一份真相**:寻路器读 `cfg.scaffoldBlocks`
   * (可部署配置),维持条件层从这里取同一份 —— 部署改了配置只改得到寻路器那一半,
   * 而她读到的是另一份,正是这个出口要防的。火把那份配置里没有,常量在这儿。
   */
  protected policyDefaults(): { scaffold: string[]; light: string[] } {
    return { scaffold: [...this.cfg.scaffoldBlocks], light: ['torch'] };
  }

  /** 同格交互比较实际或拟用物品、客户端可见的方块、窗口和随身状态。 */
  protected useObservation(at: readonly number[], requestedItem?: string | null): string | undefined {
    const bot = this.bridge?.bot;
    if (!bot) return undefined;
    let target: { type: number; stateId: number } | null = null;
    try {
      const block = bot.blockAt(new Vec3(at[0], at[1], at[2]));
      if (block) target = { type: block.type, stateId: block.stateId };
    } catch { /* 未加载的目标没有可比较的方块读数。 */ }
    const usedItem = requestedItem === undefined ? bot.heldItem
      : requestedItem === null ? null : invItemNamed(bot, requestedItem);
    return JSON.stringify({
      generation: this.connectionGeneration,
      dimension: bot.game?.dimension,
      target,
      usedItem: usedItem ? [usedItem.type, usedItem.metadata]
        : requestedItem ? ['missing', requestedItem] : null,
      window: bot.currentWindow ? [bot.currentWindow.id, bot.currentWindow.type] : null,
      inventory: bot.inventory?.slots?.map((item, slot) => item
        ? [slot, item.type, item.count, item.metadata, item.durabilityUsed] : null),
    });
  }

  /** mc_do / mc_scout 共用:校验 → 受理。参数错误优先于「World 未启动」。 */
  protected enqueueTool(
    name: 'mc_do' | 'mc_scout',
    args: Record<string, unknown>,
    parse: (raw: unknown) => { steps: SkillCall[]; notes?: ParseNote[] } | { error: string },
    methodAdmission?: (decision: TaskAdmissionDecision) => void,
  ): string | ToolOutcome {
    const mode = parseQueueMode(args.queue);
    if ('error' in mode) return { text: this.toolLog(name, args, `[${name} 失败] ${mode.error}`), failed: true };
    const parsed = parse(args.steps);
    if ('error' in parsed) {
      return { text: this.toolLog(name, args, `[${name} 失败] ${parsed.error}。你写的是 ${JSON.stringify(args.steps)}`), failed: true };
    }
    if (!this.executor) return { text: this.toolLog(name, args, `[${name} 失败] World 未启动`), failed: true };
    const only = parsed.steps.length === 1 ? parsed.steps[0] : null;
    if (name === 'mc_do' && only?.skill === 'use' && args.queue == null && this.cfg.precheck) {
      const status = this.executor.status();
      const bot = this.bridge?.bot;
      if (bot && !status.running && status.waiting.length === 0 && status.hold === null) {
        const invalid = precheckEmptyUseTarget(bot, only, {
          resolve: (value) => resolveAt(bot, value as Parameters<typeof resolveAt>[1]),
          blockAt: (cell) => blockAtCell(bot, cell), cellsOf: () => null,
        });
        if (invalid) {
          const rejection = this.executor.noteAdmissionRejection([only], invalid.rule, invalid.text);
          return { text: this.toolLog(name, args,
            `[${name} 未受理] ${invalid.text} 没有发送使用，也没有导航；当前任务和待办保留。`),
            failed: true, ...(rejection.kind === 'correction' ? {} : { endsTurn: true }) };
        }
      }
    }
    if (name === 'mc_do' && only?.skill === 'chat'
      && (!only.text.startsWith('/') || /^\/(?:msg|tell|w)[ \t]+[\p{L}\p{N}_.-]+[ \t]+\S[^\r\n]*$/u.test(only.text))
      && args.queue == null && only.needs === undefined && only.expect === undefined) {
      const bot = this.bridge?.bot;
      if (!bot) return { text: this.toolLog(name, args, `[${name} 失败] 当前没有连接服务器，聊天未发送`), failed: true };
      try {
        this.interruptIdle('outgoing-chat');
        sendChat(bot, only.text);
        const notes = parsed.notes?.map(parseNoteText) ?? [];
        return this.toolLog(name, args, `[游戏聊天] 已发送：${only.text}。当前任务和待办保留`
          + (notes.length > 0 ? `\n${notes.join(';')}。` : ''));
      } catch (error) {
        return { text: this.toolLog(name, args, `[${name} 失败] 聊天没有发出：${String(error)}`), failed: true };
      }
    }
    const directUse = name === 'mc_do' && parsed.steps.length === 1 && parsed.steps[0].skill === 'use'
      && parsed.steps[0].at?.every((n) => typeof n === 'number')
      ? parsed.steps[0].at as number[] : null;
    const directChat = name === 'mc_do' && parsed.steps.length === 1 && parsed.steps[0].skill === 'chat'
      ? parsed.steps[0].text : null;
    if (directUse) {
      const wait = this.serverActionWait.blockReason(directUse, Date.now(),
        this.useObservation(directUse, only?.skill === 'use' ? only.item ?? null : null));
      if (wait) return { text: this.toolLog(name, args, `[${name} 暂缓] ${wait}`), failed: true, endsTurn: true };
    }
    if (directChat) {
      const wait = this.serverActionWait.blockChat(directChat);
      if (wait) return { text: this.toolLog(name, args, `[${name} 暂缓] ${wait}`), failed: true, endsTurn: true };
    }
    // 解析结果与她写的不一致就明说:被静默吃掉的参数是这条链上最贵的一类失败
    const notes = parsed.notes?.map(parseNoteText) ?? [];
    const routeOrigin = this.bridge?.bot?.entity?.position;
    const routeScope: RejectedRouteScope | null = routeOrigin ? {
      realm: this.realmKey(), dimension: normalizeDimension(this.bridge?.bot?.game?.dimension),
      origin: [routeOrigin.x, routeOrigin.y, routeOrigin.z],
    } : null;
    const heldRoute = this.rejectedRoutes.match(parsed.steps, routeScope);
    if (heldRoute && name === 'mc_do') {
      return { text: this.toolLog(name, args,
        `[${name} 暂缓] 当前出发地的这条路线或途经的液体井筒曾连续失败并触发自动脱困(${heldRoute})。核对前次回执，改变出发位置或路线后重新评估；限制只保留 15 分钟，不取消原目标。`),
        failed: true, endsTurn: true };
    }
    const repeatedSuccess = name === 'mc_do'
      ? this.executor.repeatSuccessHold(parsed.steps,
        this.cfg.repeatSuccessFallback ?? MINECRAFT_DEFAULTS.repeatSuccessFallback) : null;
    if (repeatedSuccess) return {
      text: this.toolLog(name, args, repeatedSuccess), failed: true, endsTurn: true,
    };
    // 原文一并交过去:受理回执只回念解析+冻结之后与她所写不同的那几个字段
    let admitted = true;
    let admittedTaskId: number | undefined;
    let completedImmediately = false;
    let rejection: TaskAdmissionRejection | undefined;
    const accepted = this.executor.submit(parsed.steps, mode.mode, args.steps, (value, retryAfterMs, completed, rejected, taskId) => {
      admitted = value;
      admittedTaskId = taskId;
      completedImmediately = completed === true;
      rejection = rejected;
      methodAdmission?.({ accepted: value, receipt: '', retryAfterMs, completedImmediately: completed,
        rejection: rejected, taskId });
    }, () => {
      if (!methodAdmission) this.methods.stop('新的身体任务已受理，原方法取消');
      this.interruptIdle('task');
    });
    if (admitted && directChat) {
      this.serverActionWait.noteChat(directChat);
      if (!this.serverActionWait.isReadOnlyQuery(directChat)) this.recentSystemMessages.clear();
    }
    // 受理了查询或聊天并不代表原地打转的路线已经恢复；只按路线与时间聚合拒收。
    const firstRejectedSkill = parsed.steps[0]?.skill;
    // A rejected destination or repeated order is evidence about the goal, not
    // evidence that the player is trapped. Only physical stall/support hazards
    // can justify moving the player to a safety mark automatically.
    const rejectedTravel = firstRejectedSkill === 'goto'
      && /钉在原地|这条通道会经过|这片井筒刚在/.test(accepted);
    const rejectedShaft = firstRejectedSkill === 'tunnel'
      && /这片井筒刚在|同一整单已经连续失败|这条通道会经过/.test(accepted);
    if (!admitted && name === 'mc_do' && routeScope && (rejectedTravel || rejectedShaft)) {
      const now = Date.now();
      const liquidCell = /这片井筒刚在 \((-?\d+),(-?\d+),(-?\d+)\) 遇到(水|岩浆)/.exec(accepted);
      const supportCell = /这条通道会经过 \((-?\d+),(-?\d+),(-?\d+)\)/.exec(accepted);
      const key = liquidCell ? `shaft-liquid:${liquidCell.slice(1).join(':')}`
        : supportCell ? `tunnel-support:${supportCell.slice(1).join(':')}` : JSON.stringify(parsed.steps);
      const previous = this.rejectedTravelBurst;
      const count = previous?.key === key && sameRejectedRouteOrigin(previous.scope, routeScope)
        && now - previous.atMs < 90_000 ? previous.count + 1 : 1;
      this.rejectedTravelBurst = { key, scope: routeScope, atMs: now, count };
      if (count >= 3 && now - this.lastRejectedTravelEscapeAt > 180_000) {
        this.lastRejectedTravelEscapeAt = now;
        this.rejectedTravelBurst = null;
        this.rejectedRoutes.record(key, parsed.steps, routeScope, now);
        this.diag.write({ lane: 'task', event: 'rejected-route-escape', incident: true,
          msg: '同一条已拒收的无进展路线仍被连续提交，启动已有安全落点逃逸',
          data: { steps: parsed.steps, count, position: this.bridge?.bot?.entity?.position } });
        void this.doEscape().then((escape) => {
          this.diag.write({ lane: 'task', event: 'rejected-route-escape-result', msg: escape });
          this.emit('minecraft.task', `[自动脱困] ${escape}`, true);
        }, (error) => {
          this.diag.write({ lane: 'task', event: 'rejected-route-escape-failed',
            msg: String(error), incident: true });
          this.emit('minecraft.task', `[自动脱困] 没成功:${String(error)}`, true);
        });
        return { text: this.toolLog(name, args,
          `${accepted}\n[自动脱困] 同一出发地的无进展路线已连续拒收，正在尝试已登记的安全落点。原目标保留；先核对新位置，再选择新的路线。`),
          failed: true, endsTurn: true };
      }
    }
    // 受理回执附当前队列状态，与结局回执和世界快照共用渲染。
    const queue = renderQueue(this.executor.status());
    const receipt = this.toolLog(
      name, args,
      `${accepted}${notes.length > 0 ? `\n${notes.join(';')}。` : ''}\n[队列] ${queue}`,
    );
    const execution: ExecutionReceipt | undefined = admittedTaskId === undefined ? undefined : { kind:'task',
      id:`${this.executionEpoch}:${admittedTaskId}`, phase: admitted ? completedImmediately ? 'completed' : 'accepted' : 'rejected',
      terminal: !admitted || completedImmediately, goalCompleted:false, evidence:{localId:admittedTaskId,receipt} };
    return {text:receipt, ...(execution ? {execution} : {}), ...(admitted ? completedImmediately ? {endsTurn:true} : {}
      : {failed:true, ...(rejection?.kind === 'correction' ? {} : {endsTurn:true})})};
  }

  protected onSpawn(): void {
    const bot = this.bridge?.bot;
    if (!bot) return;
    this.visualInFlight?.controller.abort(new Error('游戏连接代次已改变'));
    // 新连接还没有现场读数，不能沿用上一代连接的事实。
    this.requestFactsCache = null;
    const connectionGeneration = ++this.connectionGeneration;
    this.idleContext.clear();

    this.resetBodyOwners();
    this.bodyLease.bindGeneration(connectionGeneration, Date.now());
    // bindGeneration 内部先作废再换代,折叠账要就地结掉:换代之后不再是作废期
    this.flushBodyRejectFold();
    this.attachItemBreak(bot);
    this.attachRanged(bot);
    // World 状态生命周期的开端(PWSR 生命周期第 1 条):暂态先对齐到这个世界的命名
    // 空间,再去渲染连接回执 —— 那一行现状说的必须是**这个**世界的暂态
    this.syncRealm();

    // 重连后的世界可能整个换了(重生点、另一台服务器):快照基线作废
    this.snapshotAnchorPending = true;
    this.setPersonalSpawn(undefined, '重连,等待核实', { announce: false });
    this.hydratePersonalSpawn();
    this.hookBotEvents(bot);
    this.extensionSpawn(bot);
    this.diag.write({
      lane: 'link', event: 'spawn',
      msg: `连入 ${this.cfg.host}:${this.cfg.port},物品栏${this.bridge?.invSynced ? '已同步' : '还没同步'}`,
      data: {
        connectionGeneration,
        invSynced: this.bridge?.invSynced,
        rawOxygen: (bot as { oxygenLevel?: number }).oxygenLevel,
        items: bot.inventory?.items().length,
      },
    });
    const snap = this.snapshot();
    this.lastReported = snap;
    this.lastTickTime = snap?.timeOfDay ?? null;
    this.lastHealth = null;
    this.activeEffects.clear();
    const fightRollback = this.policy.takeFightRollback();
    this.emit(
      'minecraft.event',
      [
        `[Minecraft] 已连入服务器 ${this.cfg.host}:${this.cfg.port},身份 ${this.chatName()}。`,
        snap ? narrateWorld(snap, this.nearMarkNote(snap.position)) : '',
        // 五格落盘跨重启活着:上一场设下的规矩必须有一句话说出来,且点明是上一场的
        renderPolicyEnv(this.policy.get(), this.policy.restored(), this.blueprintHeldScaffold()),
        // 第六格(fight)不跨重启。回弹是静默发生的,而她会按「我设过了」行事 ——
        // 所以回弹那一刻必须出线,一次重启只说一次(见 takeFightRollback)
        fightRollback ? renderFightRollback(fightRollback) : '',
        // 暂态现状一行:**告知 + 指路,不是开机仪式**(PWSR 收紧第一条)。何时恢复、
        // 恢复什么由她自己判断;空暂态只是回执少一层信息,不阻塞任何动作。搭连接
        // 回执走,于是「一次连接只说一次」是这个位置本身保证的,不需要另设水位
        this.pwsr.statusLine() ?? '',
      ].filter(Boolean).join('\n'),
      true,
    );
    // 服务端起来时回读到的难度:挂到这一刻才送得到她眼前(见 onServerDifficulty)
    this.flushDifficultyFact();
    // 重连换了实体,摄像机的附身会掉
    this.syncSpectator('bot 连入');
    this.noteWorldSwitch();
  }

  /**
   * 同一连接内重生时恢复身体租约；死亡作废的上一期租约不再使用。
   * 不重走 onSpawn：世界和连接未变，快照基线与暂态仍有效。
   */
  protected onRespawn(): void {
    const now = Date.now();
    this.extensionRespawn();
    this.bodyLease.revive(now);
    // 新一期身体不继承旧 owner 实例:死时已清过一次,死到重生之间还可能又攒了几个
    this.resetBodyOwners();
  }

  protected attachItemBreak(bot: NonNullable<Bridge['bot']>): void {
    this.detachItemBreak();
    this.itemBreak = new ItemBreakDecoder(bot, (fact) => this.onItemBreak(fact));
    this.itemBreak.attach();
  }

  protected detachItemBreak(): void {
    this.itemBreak?.detach();
    this.itemBreak = null;
  }

  protected attachRanged(bot: NonNullable<Bridge['bot']>): void {
    this.detachRanged();
    const generation = ++this.rangedGeneration;
    const motion = new PositionVelocityTracker();
    this.rangedBot = bot;
    this.rangedMotion = motion;
    this.ranged = new BowController({
      getBot: () => (
        generation === this.rangedGeneration &&
        this.rangedBot === bot &&
        this.bridge?.bot === bot
          ? bot
          : null
      ),
      resolveTarget: (id) => {
        const entity = bot.entities[id];
        if (!entity?.isValid || !entity.position) return null;
        return {
          id,
          position: entity.position,
          height: entity.height,
          width: entity.width,
        };
      },
      motion,
      leaseValid: (ownerToken) => (
        generation === this.rangedGeneration && (
          this.combat?.ownsRanged(ownerToken) === true || this.executor?.ownsRanged(ownerToken) === true
        )
      ),
      emit: (event) => {
        if (generation === this.rangedGeneration && this.rangedBot === bot) {
          if (event.kind !== 'blocked' && this.executor?.ownsRanged(event.ownerToken)) {
            this.executor.onBowEvent(event as BowEvent);
          }
          else this.combat?.onBowEvent(event);
        }
      },
    });
  }

  protected detachRanged(): void {
    this.rangedGeneration += 1;
    this.ranged?.onBotLost();
    this.ranged = null;
    this.rangedMotion = null;
    this.rangedBot = null;
  }

  protected onItemBreak(fact: ItemBreakFact): void {
    const item = zhName(fact.name);
    const slot = {
      mainhand: '主手',
      offhand: '副手',
      head: '头部装备',
      chest: '胸甲',
      legs: '护腿',
      feet: '脚部装备',
    }[fact.slot];
    this.diag.write({
      lane: 'inventory',
      event: 'item-broke',
      msg: `${slot}的${item}损坏`,
      data: { slot: fact.slot, item: fact.name, durability: fact.durability },
    });
    this.emit(
      'minecraft.event',
      fact.slot === 'mainhand'
        ? `[Minecraft] 主手的${item}已损坏；下一步动作前要重新选择工具。`
        : `[Minecraft] ${slot}的${item}已损坏。`,
      true,
    );
  }

  /** 世界身份:托管中的那份目录优先(activeServerDir),否则同 proxy 侧读配置里的目录 */
  protected worldIdentity(): WorldIdentity {
    return worldIdentityOf(this.mcServer.directory(), `${this.cfg.host}:${this.cfg.port}`);
  }

  /**
   * PWSR 命名空间的键(**纯机器层,永不出现在她读到的任何一句话里**)。
   *
   * 受管世界用 mc-server 发的 uuid(强身份:目录改名不丢、同名新档是新身份);
   * 拿不到 uuid 就退到弱身份 `host:port + 存档名`。
   *
   * **采信前提:bridge 当前连的就是受管服务器那台。** `realm()` 只回答「受管世界
   * 是谁」,它不知道 bridge 连到哪 —— 所以这里用 `worldIdentity().local` 当闸:
   * 那正是「配了本地服务器目录、且 server.properties 读得出存档名」这同一个条件,
   * 也是 World 判断自己在玩本地托管世界的既有口径。前提不成立时一律走弱身份,
   * 宁可多分一个命名空间(顶多少恢复一次),也不能把两个世界并成一个。
   */
  protected realmKey(): string {
    const world = this.worldIdentity();
    if (world.local) {
      const uuid = this.mcServer.realm()?.uuid;
      if (uuid) return `uuid:${uuid}`;
    }
    return `weak:${this.cfg.host}:${this.cfg.port}|${world.local ? world.key : ''}`;
  }

  /**
   * 把暂态骨架切到当前 realm 的命名空间(旧空间原样留着,不删)。
   * 「下桌」清单攒在 `realmCleared` 里,由世界切换公告一并说出去 —— 静默地清是
   * 这套东西最贵的失败方式(她会带着一份已经不在的清单继续干)。
   */
  protected syncRealm(): void {
    const key = this.realmKey();
    this.extensionRealm(key);
    this.explored.useRealm(key);
    // 蓝图表自己按 realm 分施工命名空间(设计跨世界),先切它再切骨架:
    // 骨架的「下桌」那几句里有一句要问蓝图表旧世界那边还剩什么
    this.blueprints.useRealm(key, normalizeDimension(this.bridge?.bot?.game?.dimension));
    const cleared = this.pwsr.switchTo(key);
    // 碰一下新命名空间里的蓝图视图:记录先存在,下一次换世界才说得出这边有什么下桌
    this.blueprintView();
    this.syncBlueprintResources();
    if (cleared.length > 0) this.realmCleared.push(...cleared);
  }

  /** 当前世界的目标表;取之前先对一次命名空间(她可能在连上之前就登记过) */
  protected goalTable(): GoalTable {
    this.syncRealm();
    return this.goals();
  }

  /**
   * 进服后核对实际世界身份；切换世界时通告位置类记忆失效，首次进服只落盘。
   * 暂态表已在 onSpawn 的 syncRealm 中切换命名空间，此处报告切换结果。
   */
  protected noteWorldSwitch(): void {
    const cleared = this.realmCleared;
    this.realmCleared = [];
    const clearedText = cleared.length > 0 ? `暂态已清:${cleared.join('、')}随旧世界下桌。` : '';
    const cur = this.worldIdentity().key;
    let prev: string | null = null;
    if (this.worldFile) {
      try {
        prev = (JSON.parse(readFileSync(this.worldFile, 'utf8')) as { world?: string }).world ?? null;
      } catch { /* 首次或文件缺损:当作没有上一个世界 */ }
      if (prev !== cur) {
        try {
          writeFileSync(this.worldFile, `${JSON.stringify({ world: cur })}\n`, 'utf8');
        } catch (e) {
          this.host?.log.warn('世界身份落盘失败', { err: String(e) });
        }
      }
    }
    if (prev && prev !== cur) {
      this.emit(
        'minecraft.event',
        `[Minecraft] 世界换了:现在是「${cur}」。之前在「${prev}」记的坐标、路线、据点在这里都不算数;`
        + `做法经验照旧有效。${clearedText}`,
        true,
      );
      return;
    }
    // 世界名没变而命名空间换了(弱身份补上了 uuid 一类):清单照样得有人说
    if (clearedText) this.emit('minecraft.event', `[Minecraft] ${clearedText}`, true);
  }

  /** 将服务器相位变化投递为事件。 */
  protected onServerPhase(phase: MinecraftServerPhase, detail: string | null): void {
    if (!this.host) return; // World 自身停机路径不吵
    this.diag.write({
      lane: 'link', event: 'server-phase',
      msg: `服务器相位:${phase}${detail ? `(${detail})` : ''}`,
      data: { phase, detail, connectionGeneration: this.connectionGeneration },
    });
    if (phase === 'starting') {
      this.emit('minecraft.event', '[Minecraft] 服务器启动中,世界加载要一阵。', false);
    } else if (phase === 'running') {
      if (this.managedLocalServer() && !this.serverWanted) return;
      if (this.bridge?.active) this.bridge.reconnectNow('服务器就绪');
      else this.bridge?.start();
      this.emit('minecraft.event', '[Minecraft] 服务器就绪,世界上线了。', false);
    } else if (phase === 'error') {
      this.emit('minecraft.event', `[Minecraft] 服务器出问题了(${detail ?? '原因不明'}),世界暂时下线。`, true);
    } else {
      this.emit('minecraft.event', '[Minecraft] 服务器停了,世界下线;它回来之前,游戏里的动作都不会生效。', true);
    }
  }

  /**
   * 服务端回读的实际难度；running 早于 bot 连接，先挂起，随连接回执投递。
   * 每次 running 只保留一条，新值覆盖尚未送出的旧值。
   */
  protected onServerDifficulty(fact: MinecraftDifficultyFact): void {
    this.diag.write({
      lane: 'link', event: 'server-difficulty',
      msg: `难度回读:${fact.difficulty ?? '没认出来'}`,
      data: { ...fact, connectionGeneration: this.connectionGeneration },
    });
    this.pendingDifficulty = fact;
    if (this.bridge?.bot) this.flushDifficultyFact();
  }

  /** 挂着的难度事实;送出去之后清掉(一次 running 只说一次) */
  protected pendingDifficulty: MinecraftDifficultyFact | null = null;

  /** 挂着的那条难度事实,有就投一次。没有就什么都不做 */
  protected flushDifficultyFact(): void {
    const fact = this.pendingDifficulty;
    if (!fact || !this.host) return;
    this.pendingDifficulty = null;
    this.emit('minecraft.event', `[Minecraft] ${renderDifficultyFact(fact)}`, true);
  }

  /** 摄像机进程意外退出时记录故障；网页画面仍在线时不把旧客户端故障投给主播。 */
  protected onCameraCrash(info: { detail: string; attempt: number; max: number; delayMs: number }): void {
    const alreadyDown = this.cameraDown;
    this.cameraDown = true;
    this.diag.write({
      lane: 'link', event: 'camera-crash',
      msg: `观察者摄像机非人为退出(第 ${info.attempt || info.max} 次);${info.attempt > 0 ? `${Math.round(info.delayMs / 1000)} 秒后重启` : '不再重启'}`,
      data: { ...info, viewerOnline: Boolean(this.bridge?.viewerUrl) },
    });
    this.host?.log.error(`观察者摄像机意外退出: ${info.detail}`);
    if (this.bridge?.viewerUrl || (alreadyDown && info.attempt > 0)) return;
    const text = info.attempt > 0
      ? `[Minecraft] 观察者客户端意外退出(第 ${info.attempt} 次),${Math.round(info.delayMs / 1000)} 秒后自动重启。`
      : `[Minecraft] 观察者客户端重启 ${info.max} 次仍未就绪,需要人检查。`;
    this.emit('minecraft.event', text, true);
  }

  /**
   * 将观察者客户端附身到 bot。托管服务器通过 stdin 执行命令；外部服务器通过
   * bot 聊天执行并要求 op 权限。每次同步先脱离再附身，以触发 SpectatorPlus 的
   * 初始道具栏全量快照。
   *
   * `teleportFirst`:附身前先把机位 tp 到她身上。原版 spectator 每 tick 只把目标
   * 坐标抄进摄像机**自己所在的维度**,目标一走传送门,画面就留在旧维度原地;
   * `/tp <cam> <target>` 是唯一能跨维度把机位挪过去的原语,跨维度那一路必须走它。
   */
  protected syncSpectator(reason: string, opts: { teleportFirst?: boolean } = {}): void {
    const cc = this.cfg.client;
    if (!cc.autoSpectate || !this.client.running) return;
    const cam = cc.username;
    const target = this.chatName();
    if (!cam || cam === target) return;
    this.lastSpectateAt = Date.now();
    const tp = opts.teleportFirst === true;
    this.diag.write({
      lane: 'link', event: 'spectate',
      msg: `摄像机 ${cam} 重新附身 ${target}(${reason}${tp ? ',先传送' : ''})`,
      data: { reason, cam, target, teleportFirst: tp },
    });
    // 顺序不能动:脱离在前(触发 SpectatorPlus 全量快照),传送夹在脱离与附身之间
    const viaConsole =
      this.mcServer.command(`op ${cam}`) &&
      this.mcServer.command(`gamemode spectator ${cam}`) &&
      this.mcServer.command(`execute as ${cam} run spectate`) &&
      (!tp || this.mcServer.command(`tp ${cam} ${target}`)) &&
      this.mcServer.command(`spectate ${target} ${cam}`);
    if (viaConsole) {
      this.host?.log.debug(`观察者附身经服务器控制台(${reason})`);
      this.scheduleSpectateCheck();
      return;
    }
    const bot = this.bridge?.bot;
    if (!bot) return;
    bot.chat(`/gamemode spectator ${cam}`);
    bot.chat(`/execute as ${cam} run spectate`);
    if (tp) bot.chat(`/tp ${cam} ${target}`);
    bot.chat(`/spectate ${target} ${cam}`);
    this.host?.log.debug(`观察者附身经 bot 指令(${reason});bot 不是 op 时会被拒`);
    this.scheduleSpectateCheck();
  }

  /**
   * 换维度时立即传送机位并重新附身，3 秒后重试一次以等待服务端搬运实体。
   * 期间再次换维度则由新请求接管，不叠加旧重试。
   */
  protected resyncSpectatorForDimension(dim: string): void {
    this.syncSpectator(`维度变了(${zhDimension(dim)})`, { teleportFirst: true });
    const t = setTimeout(() => {
      if (this.lastDimension !== dim) return;
      this.syncSpectator(`维度切换后补一次(${zhDimension(dim)})`, { teleportFirst: true });
    }, 3_000);
    t.unref?.();
  }

  /**
   * GUI 演出的卡屏兜底(去抖):最后一次关窗 2.5s 后,若没再开窗,踢一次脱离→再附身。
   * SpectatorPlus 在 stop/start spectating 事件上无条件关掉同步屏——bot 侧已无窗可关
   * 而摄像机侧屏没跟上时(同 tick 开关窗竞态),这是唯一能清掉它的动作。
   */
  protected scheduleGuiKick(): void {
    if (!this.cfg.client.syncGui || !this.cfg.client.autoSpectate || !this.client.running) return;
    if (this.guiKickTimer) clearTimeout(this.guiKickTimer);
    this.guiKickTimer = setTimeout(() => {
      this.guiKickTimer = null;
      if (this.bridge?.bot?.currentWindow) return; // 又开上窗了:正开着的屏不该被踢掉
      this.syncSpectator('GUI 演出关窗兜底');
    }, 2_500);
    this.guiKickTimer.unref?.();
  }

  /** 容器 GUI 演出节拍:摄像机窗口在、演出开着才有;否则 null(协议层照旧瞬时) */
  protected showTempo(): ShowTempo | null {
    if (!this.cfg.client.syncGui || this.client.windowHint() === null) return null;
    return { ...this.cfg.show };
  }

  /** 队列清空后的窗口卫生:忘关的窗口服务端一直记着开,同步屏就一直糊在画面上 */
  protected closeStrayWindow(): void {
    const bot = this.bridge?.bot;
    const w = bot?.currentWindow;
    if (!bot || !w) return;
    this.diag.write({
      lane: 'skill', event: 'stray-window-close',
      msg: `队列空了容器窗口还开着(${w.type}),兜底关掉`,
    });
    bot.closeWindow(w);
  }

  /**
   * 附身指令发出后延迟核对玩家表的 gamemode 3；此读数不能核验附身目标本身。
   * 失败最多每十分钟报告一次，成功静默。
   */
  protected scheduleSpectateCheck(): void {
    const t = setTimeout(() => {
      if (!this.cfg.client.autoSpectate || !this.client.running) return;
      const cam = this.observerName();
      const bot = this.bridge?.bot as { players?: Record<string, { gamemode?: number }> } | null | undefined;
      if (!cam || !bot) return;
      const p = bot.players?.[cam];
      if (p?.gamemode === 3) {
        // 崩过才有解除可报:附身核过一次是"画面真回来了"能拿到的最硬确认
        if (this.cameraDown) {
          this.cameraDown = false;
          this.diag.write({ lane: 'link', event: 'camera-recovered', msg: '摄像机重启后已重新附身', data: { cam } });
          if (!this.bridge?.viewerUrl) this.emit('minecraft.event', '[Minecraft] 观察者摄像机回来了,已重新附身,画面恢复。', true);
        }
        return;
      }
      this.diag.write({
        lane: 'link', event: 'spectate-verify',
        msg: `摄像机${p ? '没进旁观模式' : '不在玩家表'}`,
        data: { cam, gamemode: p?.gamemode ?? null },
      });
      if (this.bridge?.viewerUrl || Date.now() - this.lastSpectateWarnAt < 600_000) return;
      this.lastSpectateWarnAt = Date.now();
      this.emit('minecraft.event', `[Minecraft] 观察者摄像机${p ? '没进旁观模式' : '不在线'}。`, true);
    }, 5_000);
    t.unref?.();
  }

  /**
   * 把玩家客户端那个人传送到 bot 旁边。托管服务器走控制台 stdin;外部服务器
   * 借 bot 的聊天权限(需要 op)。返回一句给控制台看的回执。
   */
  protected teleportPlayer(reason: string): string {
    const who = this.playerName().trim();
    const target = this.chatName();
    if (!who) return '没配玩家名,不知道要传谁';
    if (who === target) return `玩家名与 bot 同名(${who}),传送不了`;
    this.diag.write({
      lane: 'link', event: 'player-tp',
      msg: `把玩家 ${who} 传送到 ${target} 旁边(${reason})`,
      data: { reason, who, target },
    });
    if (this.mcServer.command(`tp ${who} ${target}`)) return `已把 ${who} 传送到 ${target} 旁边`;
    const bot = this.bridge?.bot;
    if (!bot) return '服务器不是本 World 托管的,而 bot 还没连上:传送没人下得了';
    bot.chat(`/tp ${who} ${target}`);
    return `已借 bot 的权限下 /tp ${who} ${target}(bot 不是 op 时服务器会拒)`;
  }

  /** 聊天、欢迎说明与屏幕大字可早于 spawn；不依赖实体或背包装配。 */
  protected hookMessageEvents(bot: any): void {
    if (this.hookedMessageBots.has(bot)) return;
    this.hookedMessageBots.add(bot);
    this.lastServerFeedback = null;
    this.recentSystemMessages.clear();
    const noteActionFeedback = (value: unknown, keyHint = ''): void => {
      const rendered = minecraftTextComponent(value);
      const key = keyHint || (rendered.startsWith('block.minecraft.bed.') ? rendered : '');
      const text = key && rendered === key
        ? (bot.registry?.language?.[key] ?? rendered) : rendered;
      if (text && (key.startsWith('block.minecraft.bed.')
        || /(?:床.{0,12}太远|离床.{0,8}太远|bed is too far away)/i.test(text))) {
        this.lastServerFeedback = { text, at: Date.now() };
      }
    };
    // Java 1.20.6 有独立 action_bar 包；Mineflayer 的高层 message 不一定转发它。
    bot._client.on('action_bar', (packet: { text?: unknown }) => {
      noteActionFeedback(packet.text);
      this.extensionMessage(minecraftTextComponent(packet.text));
    });
    bot._client.on('system_chat', (packet: { content?: unknown; isActionBar?: boolean }) => {
      if (packet.isActionBar) {
        noteActionFeedback(packet.content);
        this.extensionMessage(minecraftTextComponent(packet.content));
      }
    });

    const matchedChatMessages = new WeakSet<object>();
    const chatProvenance = new MinecraftChatProvenance();
    bot.prependListener('message', (message: unknown, position: string, sender?: string | null) =>
      chatProvenance.observe(message, position, sender));
    const mentionedInChat = (message: string): boolean => {
      const lower = message.toLocaleLowerCase();
      return lower.includes(this.chatName().toLocaleLowerCase())
        || lower.includes(this.botName.toLocaleLowerCase())
        || lower.includes('corti') || message.includes('可缇');
    };
    const markMatched = (jsonMsg: unknown): boolean => {
      if (!jsonMsg || typeof jsonMsg !== 'object') return false;
      if (matchedChatMessages.has(jsonMsg)) return true;
      matchedChatMessages.add(jsonMsg);
      return false;
    };
    bot.on('chat', (username: string, message: string, _translate: string, jsonMsg: unknown) => {
      const identity = chatProvenance.identify(username, jsonMsg, bot.players);
      if (!identity) return;
      if (markMatched(jsonMsg)) return;
      if (jsonMsg && typeof jsonMsg === 'object') this.chatClaimed.add(jsonMsg);
      if (username === this.chatName()) {
        // 自己说的话:落库存档,但不投递——拿自己的话叫醒自己没有意义
        this.emit('minecraft.chat', `[MC] ${username}: ${message}`, false, { deliver: false });
        return;
      }
      this.interruptIdle('chat');
      this.emit('minecraft.chat', `[MC] ${username}: ${message}`, mentionedInChat(message),
        { meta: { uname: username, socialScope: 'minecraft-server', ...identity } }, username);
    });
    bot.on('whisper', (username: string, message: string, _translate: string, jsonMsg: unknown) => {
      const identity = chatProvenance.identify(username, jsonMsg, bot.players);
      if (!identity) return;
      if (markMatched(jsonMsg)) return;
      if (jsonMsg && typeof jsonMsg === 'object') this.chatClaimed.add(jsonMsg);
      if (username === this.chatName()) return;
      this.interruptIdle('whisper');
      this.emit('minecraft.chat', `[MC 私聊] ${username}: ${message}`, true,
        { meta: { uname: username, socialScope: 'minecraft-server', ...identity } }, username);
    });
    bot.on('title', (text: unknown) => {
      const t = minecraftTextComponent(text);
      if (t) this.emit('minecraft.event', `[Minecraft] 屏幕大字:${t}`, false);
    });
    // 高层 chat/whisper 由 Mineflayer 的英文格式正则识别；没匹配上的聊天由 message 补送。
    bot.on('message', (jsonMsg: { translate?: string; with?: Array<{ toString(): string }>; toString(): string }, position: string) => {
      const loginMessage = !this.hookedBots.has(bot);
      const key = String(jsonMsg?.translate ?? '');
      if (key === SET_SPAWN_TRANSLATE) {
        this.lastSetSpawnAt = Date.now();
        this.rememberPersonalSpawn(bot, `${SET_SPAWN_TRANSLATE} 系统消息`);
      }
      if (position === 'game_info') {
        // 动作栏也承载不断刷新的 HUD；只保存明确的交互拒绝理由。
        noteActionFeedback(jsonMsg, key);
        this.extensionMessage(jsonMsg.toString());
        this.forwardServerMessage(jsonMsg, 'actionBar');
        return;
      }
      if (position !== 'chat' && position !== 'system') return;
      let unchangedQueryFeedback = false;
      if (position === 'system') {
        const reply = jsonMsg.toString().trim();
        // 服务器扩展可消费自己的机器可读回执。
        if (this.extensionMessage(reply)) return;
        unchangedQueryFeedback = this.serverActionWait.noteFeedback(reply);

      }
      if (position === 'system') {
        // 其他玩家的死亡广播与成就走系统消息；自己的死亡由专报处理。
        if (key.startsWith('death.') || key === 'chat.type.advancement') {
          const text = jsonMsg.toString();
          if (!text) return;
          if (text.includes(this.chatName())) {
            if (key.startsWith('death.')) {
              this.diag.write({
                lane: 'world', event: 'death-cause',
                msg: `官方死因:${text}`,
                data: { translate: key, text, position: bot.entity?.position ?? null, health: bot.health ?? null },
              });
              this.pendingDeathCause = { text, key, at: Date.now() };
              this.deaths.noteCause(text);
            }
          } else {
            this.emit('minecraft.event', `[Minecraft] ${text}`, false);
          }
          return;
        }
        // 玩家进出已有 playerJoined/playerLeft 事件；动作栏由 position 过滤。
        if (key.startsWith('multiplayer.player.joined') || key === 'multiplayer.player.left') return;
      }
      // Mineflayer 在 message 后同步触发 messagestr，再由格式正则触发 chat/whisper。
      queueMicrotask(() => {
        if (matchedChatMessages.has(jsonMsg)) return;
        const text = jsonMsg.toString().trim();
        if (!text) return;
        if (unchangedQueryFeedback) return;
        const privateMessage = key === 'commands.message.display.incoming'
          || /^\S+ whispers(?: to you)?:? /i.test(text)
          || /^\[[^\]]+ -> [^\]]+\] /.test(text);
        if (key === 'commands.message.display.outgoing') {
          this.emit('minecraft.chat', `[MC 私聊发出] ${text}`, false);
          return;
        }
        if (position === 'chat') {
          const sender = jsonMsg.with?.[0]?.toString();
          const self = this.chatName();
          const fromSelf = sender === self || text.startsWith(`<${self}> `)
            || text.startsWith(`${self}: `) || text.startsWith(`[${self}] `);
          this.emit('minecraft.chat', `[MC${privateMessage ? ' 私聊' : ''}] ${text}`,
            !fromSelf && (privateMessage || mentionedInChat(text)), fromSelf ? { deliver: false }
              : sender && /^\w{1,16}$/.test(sender) ? { meta: { uname: sender, socialScope: 'minecraft-server' } } : undefined,
            !fromSelf && sender && /^\w{1,16}$/.test(sender) ? sender : undefined);
          return;
        }
        // 明确的方块保护拒绝会终止当前任务；其他插件回执按文本识别并即时投递。
        if (/can't break that block here|你不能破坏这里的方块|不能在这里破坏方块|不许破坏|不允许破坏|这块属于村庄原有建筑|受保护.*(?:破坏|挖掘)/i.test(text)) {
          const notice = `[MC 系统] ${text}`;
          this.bridge?.noteServerBreakDenied(text);
          if (this.executor?.currentTask) {
            this.emit('minecraft.chat', notice, false, { trigger: 'piggyback' });
            this.executor.blockCurrentFromServer(text);
          } else {
            this.emit('minecraft.chat', notice, true);
          }
          return;
        }
        const serverNotice = this.extensionImportantMessage(text);
        if (!privateMessage && !serverNotice && this.suppressRepeatedSystemMessage(text)) return;
        this.emit('minecraft.chat', `[MC ${privateMessage ? '私聊' : serverNotice ? '插件' : loginMessage ? '登录消息' : '系统'}] ${text}`,
          privateMessage || serverNotice,
          { ...(privateMessage || serverNotice ? {} : { trigger: 'piggyback' as const }),
            ...(loginMessage ? { meta: { phase: 'login', server: `${this.cfg.host}:${this.cfg.port}` } } : {}) },
          serverNotice ? 'server-extension' : undefined);
      });
    });
  }

  protected hookBotEvents(bot: any): void {
    if (this.hookedBots.has(bot)) return;
    this.hookedBots.add(bot);

    this.bossQuarter.clear();
    observeStatusEffects(bot);
    this.attachExtension(bot);
    this.hookMessageEvents(bot);
    const detachUses = this.serverActionWait.observeUses(bot._client, (at) =>
      this.bridge?.bot === bot ? this.useObservation(at) : undefined);
    bot._client.on('end', detachUses);
    bot.on('physicsTick', () => {
      if (this.idleBehavior?.active) {
        const reason = this.idleUnavailableReason();
        if (reason) {
          this.diag.write({ lane: 'body', event: 'idle-unavailable', msg: reason, level: 'debug',
            data: { reason, position: bot.entity?.position, onGround: bot.entity?.onGround,
              velocity: bot.entity?.velocity, pathfinderMoving: bot.pathfinder?.isMoving() ?? false } });
          this.interruptIdle('body-owner-changed');
        }
      }
      this.tryArrivalIdle();
    });
    // 爆炸仅写 diag，不投递成文事件。
    bot._client.on('explosion', (packet: {
      x: number; y: number; z: number; radius: number; affectedBlockOffsets: unknown[];
    }) => {
      const at = bot.entity?.position;
      const distance = at ? Math.hypot(at.x - packet.x, at.y - packet.y, at.z - packet.z) : null;
      const affected = packet.affectedBlockOffsets.length;
      this.diag.write({
        lane: 'world', event: 'explosion',
        msg: `爆炸:(${Math.round(packet.x)}, ${Math.round(packet.y)}, ${Math.round(packet.z)}) 半径 ${packet.radius.toFixed(1)}`
          + `,炸掉 ${affected} 格${distance === null ? '' : `,离我 ${distance.toFixed(1)} 格`}`,
        data: { x: packet.x, y: packet.y, z: packet.z, radius: packet.radius, affected, distance },
      });
    });
    if (typeof bot.inventory?.on === 'function') {
      bot.inventory.on('updateSlot', () => {
        if (this.blueprintPlacementHolds === 0) this.scheduleBlueprintResourceObservation(bot);
      });
    }
    bot.on('entityMoved', (entity: { id?: number; position?: { x: number; y: number; z: number } }) => {
      if (this.rangedBot !== bot || typeof entity.id !== 'number' || !entity.position) return;
      this.rangedMotion?.observe(entity.id, entity.position, Date.now());
    });
    const forgetRangedEntity = (entity: { id?: number }): void => {
      if (this.rangedBot === bot && typeof entity.id === 'number') this.rangedMotion?.forget(entity.id);
    };
    bot.on('entityGone', forgetRangedEntity);
    bot.on('entityDead', forgetRangedEntity);
    bot.on('entityGone', (entity: { id?: number }) => {
      if ((!this.bridge?.bot || this.bridge.bot === bot) && typeof entity.id === 'number') {
        this.playerObservations.forget(entity.id);
      }
    });
    bot.on('entitySpawn', (entity: { type?: string }) => {
      if (entity.type === 'player') this.playerProximityTick(bot);
    });
    bot.on('entityHurt', (entity: { id?: number }, source?: { id?: number }) => {
      if (entity.id === bot.entity?.id) this.interruptIdle('damage');
      if (
        this.rangedBot !== bot ||
        typeof entity.id !== 'number' ||
        source?.id !== bot.entity?.id
      ) return;
      const taskOwns = this.executor?.claimsCombat(entity.id) ?? false;
      const taskAcceptsArrow = this.executor?.acceptsRangedHit(entity.id) ?? false;
      const combatOwns = this.combat?.acceptsRangedHit(entity.id) ?? false;
      const arrow = taskAcceptsArrow || combatOwns ? this.ranged?.noteHit(entity.id) : null;
      if (taskOwns && !arrow) this.executor?.noteCombatTargetHurt(entity.id);
    });
    bot.on('death', () => {
      if (this.rangedBot === bot) this.ranged?.onDeath();
    });

    // GUI 演出的卡屏兜底:关窗后 2.5s(期间没再开窗)踢一次脱离→再附身,清掉摄像机侧
    // 可能没跟上的同步屏。正常路径的关窗同步几乎总是跟手,这一脚只在竞态漏网时起效;
    // 观感成本与 resyncSec 周期重下相同(每 30s 一次,五场直播没人看出来过)。
    bot.on('windowOpen', () => {
      this.interruptIdle('container');
      if (this.guiKickTimer) clearTimeout(this.guiKickTimer);
      this.guiKickTimer = null;
    });
    bot.on('windowClose', () => {
      // 关窗打点喂给演出节拍:下一次开窗要跟它隔开 reopenGapMs,否则同步屏就是闪一下
      markShowWindowClosed();
      this.scheduleGuiKick();
    });

    bot.on('playerJoined', (player: { username: string }) => {
      if (player.username === this.chatName()) return;
      // 摄像机不是"玩家进服"这件事的一部分:它进服恰恰是该给它下附身指令的时刻
      // (窗口起来 ≠ 已进服,这是唯一可靠的信号,由 bot 自己的玩家列表看到)
      if (this.isCamera(player.username)) {
        this.syncSpectator('摄像机进服');
        return;
      }
      // 人进服是她该知道的事(照报),同时也是把人挪到她旁边的那一刻——玩家列表
      // 里出现比窗口出现晚、比世界加载完早,给它两秒再下 tp
      if (this.cfg.player.teleportToBot && player.username === this.playerName().trim()) {
        setTimeout(() => this.teleportPlayer('玩家进服'), 2_000);
      }
      this.emit('minecraft.enter', `[Minecraft] 玩家 ${player.username} 进入了服务器。`, true,
        { meta: { uname: player.username, socialScope: 'minecraft-server' } }, player.username);
    });
    bot.on('playerLeft', (player: { username: string }) => {
      if (player.username === this.chatName() || this.isCamera(player.username)) return;
      if (!this.bridge?.bot || this.bridge.bot === bot) this.playerObservations.forgetPlayer(player.username);
      this.emit('minecraft.leave', `[Minecraft] 玩家 ${player.username} 离开了服务器。`, false,
        { meta: { uname: player.username, socialScope: 'minecraft-server' } }, player.username);
    });
    bot.on('entitySwingArm', (entity: unknown) => this.notePlayerGesture(bot, entity, 'wave'));
    bot.on('entityCrouch', (entity: unknown) => this.notePlayerGesture(bot, entity, 'crouch'));
    // 维度与经验的变化基准取挂钩时刻,重连不产生虚假事件
    this.lastDimension = bot.game?.dimension ? normalizeDimension(bot.game.dimension) : null;
    this.lastLevel = typeof bot.experience?.level === 'number' && Number.isFinite(bot.experience.level)
      ? bot.experience.level : null;
    bot.on('game', () => {
      const dim = bot.game?.dimension ? normalizeDimension(bot.game.dimension) : '';
      if (dim && this.lastDimension !== null && dim !== this.lastDimension) {
        const from = this.lastDimension;
        this.lastReported = null;
        this.lastPosForTeleport = null;
        this.snapshotArmedAt = null;
        this.proximity.clear();
        this.playerObservations.clear();
        this.flocks.clear();
        this.matureAnnounced.clear();
        this.lastDimension = dim;
        this.syncRealm();
        const cancelled = this.executor?.cancelForDimensionChange(from, dim) ?? null;
        this.emit(
          'minecraft.event',
          `[Minecraft] 从${zhDimension(from)}进入了${zhDimension(dim)}。${cancelled ? `${cancelled}。` : ''}`,
          true,
        );
        this.resyncSpectatorForDimension(dim);
      }
      if (dim) this.lastDimension = dim;
    });
    bot.on('forcedMove', () => {
      this.interruptIdle('forced-move');
      const p = bot.entity?.position;
      if (!p) return;
      const prev = this.lastPosForTeleport;
      this.lastPosForTeleport = { x: p.x, y: p.y, z: p.z };
      if (!prev) return;
      const dist = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
      // 服务器纠偏级别的小位移不值得报;重生传送由死亡播报覆盖;自己发起的 escape 不急报
      if (dist < 8 || Date.now() - this.lastDeathAt < 5_000 || Date.now() < this.escapeHoldUntil) return;
      this.emit(
        'minecraft.event',
        `[Minecraft] 位置突然变了:从 (${Math.round(prev.x)}, ${Math.round(prev.y)}, ${Math.round(prev.z)}) ` +
          `跳到 (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}),挪了 ${Math.round(dist)} 格(被传送或强推)。`,
        true,
      );
    });
    bot.on('spawnReset', () => {
      this.setPersonalSpawn(null, 'spawnReset 事件', { announce: false });
      this.emit('minecraft.event', `[Minecraft] 重生点失效了(床没了或被堵)。${this.worldSpawnNote(bot)}`, true);
    });
    const sleepFacts = (sleeping: boolean): Record<string, unknown> => {
      const ticks = (value: unknown): number | null => typeof value === 'number'
        && Number.isSafeInteger(value) && value >= 0 ? value : null;
      const timeOfDay = ticks(bot.time?.timeOfDay);
      const dimension = bot.game?.dimension;
      return {
        sleeping,
        world: this.worldIdentity().key,
        dimension: typeof dimension === 'string' && dimension.trim() ? normalizeDimension(dimension) : null,
        timeOfDay: timeOfDay !== null && timeOfDay < 24_000 ? timeOfDay : null,
        gameDay: ticks(bot.time?.day),
        worldAge: ticks(bot.time?.age),
      };
    };
    bot.on('sleep', () => {
      this.rememberPersonalSpawn(bot, 'sleep 事件');
      this.emit('minecraft.sleep', '[Minecraft] 躺下睡了。', false, { meta: sleepFacts(true) });
    });
    bot.on('wake', () => this.emit('minecraft.wake', '[Minecraft] 醒了。', false,
      { trigger: 'piggyback', meta: sleepFacts(false) }));
    bot.on('experience', () => {
      const lvl = bot.experience?.level;
      if (typeof lvl !== 'number' || !Number.isFinite(lvl)) return;
      if (this.lastLevel === null) {
        this.emit('minecraft.event', `[Minecraft] 经验已同步，当前 ${lvl} 级。`, false, { trigger: 'piggyback' });
      } else if (lvl > this.lastLevel) {
        this.emit('minecraft.event', `[Minecraft] 升到 ${lvl} 级了。`, false, { trigger: 'piggyback' });
      }
      this.lastLevel = lvl;
    });
    bot.on('entityEffect', (entity: unknown, effect: { duration?: number }) => {
      if (entity !== bot.entity) return;
      const name = effectNameOf(bot, effect);
      if (this.activeEffects.has(name)) return;
      this.activeEffects.add(name);
      const zh = ZH_EFFECTS[name] ?? name;
      const sec = Math.round((effect?.duration ?? 0) / 20);
      this.emit('minecraft.event', `[Minecraft] 中了「${zh}」效果(约 ${sec} 秒)。`, HARMFUL_EFFECTS.has(name));
    });
    bot.on('entityEffectEnd', (entity: unknown, effect: unknown) => {
      if (entity !== bot.entity) return;
      const name = effectNameOf(bot, effect);
      this.activeEffects.delete(name);
      this.emit('minecraft.event', `[Minecraft] 「${ZH_EFFECTS[name] ?? name}」效果结束了。`, false, { trigger: 'piggyback' });
    });
    bot.on('entityTamed', (entity: { name?: string }) => {
      this.emit('minecraft.event', `[Minecraft] 驯服了${zhEntity(entity?.name ?? '')}!`, false);
    });
    bot.on('entityDead', (entity: { id?: number; name?: string; position?: { distanceTo(o: unknown): number } }) => {
      if (!entity?.position || !bot.entity?.position || !entity.name) return;
      // 自身死亡由死亡专报处理，此处只报告其他实体。
      if ((entity as unknown) === (bot.entity as unknown) || entity.id === bot.entity.id) return;
      if (typeof entity.id === 'number') this.proximity.delete(entity.id);
      if (typeof entity.id === 'number') this.executor?.noteCombatTargetDead(entity.id);
      // 战斗会话打死的由它自己说「砍翻了」,这里不再补一句「死了」
      if (typeof entity.id === 'number' && (this.executor?.claimsCombat(entity.id) || this.combat?.claims(entity.id))) return;
      const d = entity.position.distanceTo(bot.entity.position);
      if (d > PROXIMITY_EXIT) return;
      this.emit('minecraft.event', `[Minecraft] ${zhEntity(entity.name)}死了(${Math.round(d)} 格外)。`, false,
        { trigger: 'piggyback' });
    });
    bot.on('soundEffectHeard', (soundName: string, position: { x: number; z: number } | null) => {
      if (!/explode|lightning_bolt/.test(String(soundName))) return;
      const now = Date.now();
      if (now - this.lastBoomAt < 5_000) return;
      this.lastBoomAt = now;
      const me = bot.entity?.position;
      const dir = me && position ? bearing(position.x - me.x, position.z - me.z) : null;
      const what = String(soundName).includes('lightning') ? '雷击声' : '爆炸声';
      this.emit('minecraft.event', `[Minecraft] 听见${what}${dir ? ',在' + DIRECTION_ZH[dir] + '边' : ''}。`, true);
    });
    bot.on('bossBarCreated', (bar: { entityUUID?: string; title?: unknown }) => {
      const title = minecraftTextComponent(bar?.title);
      const kind = classifyBossBarTitle(title);
      if (kind === 'skillExperience') {
        // Transient XP ticks belong in the viewer HUD, not the language-model event stream.
        this.diag.write({ lane: 'world', event: 'skill-experience-hud', msg: title });
        return;
      }
      this.bossQuarter.set(bar.entityUUID ?? bar, 4);
      this.emit('minecraft.event', `[Minecraft] 出现了${kind === 'boss' ? ' Boss 血条' : '顶部状态条'}:${title}。`, true);
    });
    bot.on('bossBarUpdated', (bar: { entityUUID?: string; title?: unknown; health?: number }) => {
      const title = minecraftTextComponent(bar?.title);
      const kind = classifyBossBarTitle(title);
      if (kind === 'skillExperience') return;
      const health = typeof bar?.health === 'number' ? bar.health : 1;
      // 每跌破一个 25% 档报一次,逐点进度变化不吵。
      const quarter = Math.ceil(health * 4);
      const key = bar.entityUUID ?? bar;
      const prev = this.bossQuarter.get(key) ?? 4;
      if (quarter < prev) {
        this.bossQuarter.set(key, quarter);
        this.emit('minecraft.event', `[Minecraft] ${title} ${kind === 'boss' ? '血量剩' : '状态条进度为'} ${Math.round(health * 100)}%。`, false);
      }
    });
    bot.on('bossBarDeleted', (bar: { entityUUID?: string; title?: unknown }) => {
      const title = minecraftTextComponent(bar?.title);
      this.bossQuarter.delete(bar.entityUUID ?? bar);
      const kind = classifyBossBarTitle(title);
      if (kind !== 'skillExperience') {
        this.emit('minecraft.event', `[Minecraft] ${title} 的${kind === 'boss' ? '血条' : '顶部状态条'}已移除。`, false);
      }
    });
    bot.on('death', () => {
      // death 是 terminal 边界：先撤掉旧技能、冻结任务、队列与 path goal，再记录/播报。
      // CombatSession 自己随后收到同一事件，只负责释放身体，不得恢复这些旧任务。
      this.interruptIdle('death');
      this.bodyLease.invalidate('death', Date.now());
      this.resetBodyOwners();
      this.methods.stop('死亡使原方法和身体状态作废');
      this.executor?.cancelForDeath();
      this.lastDeathAt = Date.now();
      // 死亡清空全部状态效果,服务端不逐个发 remove_entity_effect
      this.activeEffects.clear();
      // 死亡点坐标随事件报出,她自己决定记不记(地标机制已裁撤)
      const at = bot.entity?.position;
      const deathDimension = normalizeDimension(bot.game?.dimension);
      this.diag.write({
        lane: 'world', event: 'death',
        msg: `死了${at ? `,死亡点 [${zhDimension(deathDimension)}] (${Math.round(at.x)}, ${Math.round(at.y)}, ${Math.round(at.z)})` : ''}`
          + `;当前重生点 ${this.personalSpawn ? `[${zhDimension(this.personalSpawn.dimension)}] (${Math.round(this.personalSpawn.x)}, ${Math.round(this.personalSpawn.y)}, ${Math.round(this.personalSpawn.z)}) [${this.personalSpawn.source}]` : this.personalSpawn === null ? '无(回世界出生点)' : '尚未核实'}`,
        data: { position: at ? { x: at.x, y: at.y, z: at.z, dimension: deathDimension } : null,
          spawn: this.personalSpawn ?? null, spawnKnown: this.personalSpawn !== undefined },
      });
      const dropAt: DimensionPoint | null = at
        ? { x: at.x, y: at.y, z: at.z, dimension: deathDimension }
        : null;
      // 床毁坏后的 spawnReset 可能迟到；预告重生点须在三秒后以实测坐标复核。
      const predicted: SpawnTarget | null = this.personalSpawn
        ?? (this.personalSpawn === null && bot.spawnPoint ? spawnAt(bot.spawnPoint, 'minecraft:overworld', 'world') : null);
      // 死亡广播通常先到；pendingDeathCause 仅在 15 秒内归入此次死亡。
      // 同格死亡次数只作事实计数。
      const cause = this.pendingDeathCause !== null && Date.now() - this.pendingDeathCause.at <= 15_000
        ? this.pendingDeathCause
        : null;
      this.pendingDeathCause = null;
      const toll = this.deaths.record(this.worldIdentity().key, undefined, {
        cause: cause?.text ?? null,
        cell: dropAt
          ? `${dropAt.dimension}:${Math.floor(dropAt.x)},${Math.floor(dropAt.y)},${Math.floor(dropAt.z)}`
          : null,
      });
      const gloss = cause ? deathCauseZh(cause.key) : null;
      const causeLine = cause ? `服务端记的死因:${cause.text}${gloss ? `(${gloss})` : ''}。` : '';
      const hereLine = toll.hereToday > 1 ? `你今天第 ${toll.hereToday} 次死在这一格。` : '';
      this.emit(
        'minecraft.event',
        `[Minecraft] 你死了(今天第 ${toll.today} 次)。${causeLine}${this.deathNote(bot, dropAt)}${hereLine}`,
        true,
      );
      // 死亡会把摄像机的附身甩掉,重生后重下;同一拍用实测坐标复核重生落点
      setTimeout(() => {
        this.syncSpectator('bot 重生');
        this.confirmRespawn(bot, dropAt, predicted);
      }, 3_000);
    });
    bot.on('health', () => {
      const h = bot.health;
      if (typeof h !== 'number' || !Number.isFinite(h)) return;
      if (this.lastHealth === null) {
        const food = typeof bot.food === 'number' && Number.isFinite(bot.food)
          ? `饥饿 ${Math.round(bot.food)}/20` : '饥饿正在从服务器同步';
        this.emit('minecraft.event', `[Minecraft] 身体状态已同步：生命 ${Math.ceil(h)}/20，${food}。`,
          false, { trigger: 'piggyback' });
      }
      if (this.lastHealth !== null && h < this.lastHealth) this.interruptIdle('health-loss');
      this.noticeDamage(h);
      if (h > 0 && h <= 6) this.extensionLowHealth(bot);
      if (h > 0 && h < 6 && Date.now() - this.lastLowHealthAt > 15_000) {
        this.lastLowHealthAt = Date.now();
        // 向上取整:0.1 血活着时报 1,与 HUD 的半颗心一致;四舍五入会在她活着时报出「0/20」
        this.emit('minecraft.event', `[Minecraft] 濒死!生命只剩 ${Math.ceil(h)}/20；${this.recoveryFoodFact(bot)}。`, true);
      }
    });
  }

  protected interruptIdle(reason: string): void {
    this.idleActivityVersion++;
    this.idleQuietUntil = Date.now() + 3_000;
    this.idleQuietReason = reason;
    this.idleArrival = null;
    this.idleBehavior?.cancel(reason);
    this.idleSceneCache = null;
  }

  protected idleGeneration(): string {
    return `${this.connectionGeneration}:${this.idleActivityVersion}:${this.bridge?.bot?.game?.dimension ?? ''}`;
  }

  /** Wait for stable physics after arrival before handing the view to a small idle action. */
  protected tryArrivalIdle(): void {
    const pending = this.idleArrival;
    if (!pending) return;
    const config = this.cfg.idle ?? MINECRAFT_DEFAULTS.idle;
    const now = Date.now();
    if (!config.enabled || !config.afterArrival || this.idleGeneration() !== pending.generation
      || now > pending.expiresAtMs) {
      this.idleArrival = null;
      return;
    }
    if (this.idleQuietReason === 'task') this.idleQuietUntil = 0;
    const reason = this.idleUnavailableReason();
    if (reason) {
      pending.readyAtMs = undefined;
      if (pending.blockedBy !== reason) {
        pending.blockedBy = reason;
        this.diag.write({ lane: 'body', event: 'idle-arrival-wait', msg: reason, level: 'debug', data: { reason } });
      }
      return;
    }
    pending.blockedBy = undefined;
    pending.readyAtMs ??= now + MinecraftWorld.IDLE_ARRIVAL_SETTLE_MS;
    if (now < pending.readyAtMs) return;
    if (this.idleBehavior?.startAfterArrival([
      'scan', 'look_left', 'look_right', 'look_sky', 'look_horizon', 'look_ground',
    ])) this.idleArrival = null;
  }

  protected canIdle(): boolean {
    return this.idleUnavailableReason() === null;
  }

  protected idleUnavailableReason(): string | null {
    const bot = this.bridge?.bot;
    const queue = this.executor?.status();
    if (this.shuttingDown || !this.host || !(this.cfg.idle ?? MINECRAFT_DEFAULTS.idle).enabled) return 'world-unavailable';
    if (!this.bridge?.connected || !this.bridge.invSynced || !bot?.entity || !queue) return 'connection-unavailable';
    if (queue.running || queue.waiting.length || queue.hold) return 'task';
    if (this.combat?.active) return 'combat';
    if (this.reflexes?.envActive || Date.now() < this.escapeHoldUntil) return 'reflex';
    if (Date.now() < this.idleQuietUntil) return 'quiet-period';
    if (bot.health <= 0 || bot.isSleeping) return 'inactive';
    if (bot.usingHeldItem) return 'using-item';
    if (bot.currentWindow) return 'container';
    if (!bot.entity.onGround) return 'airborne';
    if (bot.pathfinder?.isMoving()) return 'pathfinder-moving';
    if (hazardTouch(bot).touching) return 'hazard';
    // The idle action may own a short walk; other movement must settle first.
    if (!this.idleBehavior?.active) {
      const velocity = bot.entity.velocity;
      if (velocity && Math.hypot(velocity.x, velocity.z) > 0.035) return 'residual-motion';
      if (['forward', 'back', 'left', 'right', 'jump', 'sprint'].some((control) =>
        bot.getControlState(control as Parameters<Bot['getControlState']>[0]))) return 'movement-control';
    }
    return null;
  }

  protected idleScene(): IdleBehaviorScene | null {
    if (!this.canIdle()) {
      this.idleSceneCache = null;
      return null;
    }
    const generation = this.idleGeneration();
    if (this.idleBehavior?.executing && this.idleSceneCache?.generation === generation) return this.idleSceneCache;
    const bot = this.bridge!.bot!;
    const presentation = this.idleContext.snapshot({ now: Date.now(), lastTask: this.lastFinishedTask,
      goals: this.goals().list.map(goal => ({ slot: goal.slot, intention: goal.text,
        nextStep: goalPlanSummary(goal.plan).next?.do ?? '' })) });
    const sample = sampleIdleActions(bot, {
      allowMovement: (this.cfg.idle ?? MINECRAFT_DEFAULTS.idle).allowMovement,
      preferredPlayer: presentation.preferredPlayer,
      ignorePlayer: name => name === this.chatName() || this.isCamera(name),
    });
    this.idleSceneCache = {
      generation, candidates: sample.candidates,
      state: { ...sample.state, presentation: presentation.state, health: bot.health, food: bot.food, timeOfDay: bot.time?.timeOfDay,
        situation: '当前没有身体任务；可选择一个短暂的小动作，也可以保持不动。' },
    };
    return this.idleSceneCache;
  }

  protected worldTick(): void {
    // 1s 心跳里做昼夜检测(转换点不能等节流窗口),节流窗口做世界摘要
    void this.syncManagedServerLifecycle();
    const bot = this.bridge?.bot;
    if (!bot?.entity || !this.host) return;
    const viewerUrl = this.bridge?.viewerUrl;
    if (this.cfg.viewerAssetsDir && viewerUrl && this.bridge?.viewerKind !== 'basic') {
      const key = `${this.connectionGeneration}:${viewerUrl}`;
      if (key !== this.visualWarmKey) {
        this.visualWarmKey = key;
        void warmMinecraftViewCapture(viewerUrl).then(() => {
          if (!this.shuttingDown && this.visualWarmKey === key)
            this.diag.write({ lane: 'world', event: 'visual-warm', msg: '截图场景已就绪' });
        }, (error) => {
          if (!this.shuttingDown && this.visualWarmKey === key)
            this.diag.write({ lane: 'world', event: 'visual-warm-failed', msg: String(error), level: 'debug' });
        });
      }
    }
    this.observeBodyControl();
    this.autoEatTick(bot);
    this.tryArrivalIdle();
    this.idleBehavior?.tick();
    const time = bot.time?.timeOfDay ?? 0;
    if (this.lastTickTime !== null) {
      const transition = dayNightTransition(this.lastTickTime, time);
      if (transition) this.emit('minecraft.event', `[Minecraft] ${transition}`, true);
    }
    this.lastTickTime = time;

    this.proximityTick(bot);
    this.furnaceTick();
    // 只有表里存在 plan 才会现读；状态边沿去抖唤醒，稳定态每秒检查不发文字。
    this.publishGoalPlanEdges('debounce');
    this.staleGoalTick(Date.now());
    const now0 = Date.now();
    if (now0 - this.lastCropScanAt >= this.cropScanMs) {
      this.lastCropScanAt = now0;
      this.cropTick(bot);
    }
    // 雷暴要求 thundering 与降雨同时成立：两者独立计时，
    // 客户端雷等级为 thunderLevel × rainLevel，晴天即使收到雷等级也不算雷暴。
    const thunder = Boolean((bot as { thunderState?: number }).thunderState) && isRaining(bot);
    if (thunder !== this.lastThunder) {
      this.lastThunder = thunder;
      this.emit('minecraft.event', thunder ? '[Minecraft] 打雷了,雷暴天。' : '[Minecraft] 雷停了。', false);
    }
    // forcedMove 的位移基准:每秒刷新,传送判定最多和 1 秒前的位置比
    const p = bot.entity.position;
    this.lastPosForTeleport = { x: p.x, y: p.y, z: p.z };

    const now = Date.now();
    const resync = this.cfg.client.resyncSec;
    if (resync > 0 && this.client.running && now - this.lastSpectateAt > resync * 1000) {
      this.syncSpectator('周期重下');
    }
    this.armSnapshot(now);
    if (this.lastWorldEmitAt === 0) this.lastWorldEmitAt = now;
    if (now - this.lastWorldEmitAt < this.cfg.world.tickSec * 1000) return;
    this.reportWorldDelta();
  }

  /** Routine food fallback uses the executor's safe handoff and preserves current work. */
  protected autoEatTick(bot: Bot): void {
    const now = Date.now();
    if (now - this.lastAutoEatAttemptAt < 30_000 || this.bridge?.invSynced === false
      || this.combat?.active || this.reflexes?.envActive || now < this.escapeHoldUntil
      || !this.executor || !bot.entity?.onGround) return;
    if (this.executor.hasPendingEat() || this.executor.status().hold) return;
    const foods = (bot.registry?.foodsByName ?? {}) as Record<string, { foodPoints?: number; saturation?: number }>;
    const item = chooseRoutineFood(bot.food ?? 20, itemsInReach(bot), foods);
    if (!item) return;
    if (hazardTouch(bot).touching) return;
    this.lastAutoEatAttemptAt = now;
    this.interruptIdle('eat');
    const result = this.executor.submitDetailed([{ skill: 'eat', item }], 'afterCheckpoint');
    this.diag.write({ lane: 'body', event: result.accepted ? 'auto-eat' : 'auto-eat-refused',
      msg: result.receipt, data: { item, food: bot.food, connectionGeneration: this.connectionGeneration } });
  }
  /**
   * expectedDoneAt 到期后推送估计完成事件，不单独唤醒。
   * 服务端不持续同步未打开的炉子槽位，实际结果需取货时核验。
   */
  protected furnaceTick(): void {
    const due = this.chests.due(Date.now());
    for (const rec of due) {
      this.chests.markNotified(rec.dimension, rec);
      const f = rec.furnace!;
      const load = f.input ? `${zhName(f.input.name)}×${f.input.count}` : '料';
      const when = nowIso(this.timezone, new Date(f.loadedAt)).slice(11, 19);
      const brewing = rec.name === 'brewing_stand';
      this.emit(
        'minecraft.event',
        `[Minecraft] 按${brewing ? '一轮 20 秒' : '每件烧炼耗时'}估算,(${rec.x}, ${rec.y}, ${rec.z}) 的` +
          `${zhName(rec.name ?? 'furnace')}这会儿该${brewing ? '酿好了' : '烧完了'}(${when} 下的${load})。` +
          `${brewing ? '台' : '炉'}里实际有什么以取出来的为准。` +
          `取货:{"skill":"take","at":[${rec.x},${rec.y},${rec.z}],"all":true}`,
        false,
        { trigger: 'piggyback' },
      );
    }
  }

  /**
   * 每 10 秒扫描感知半径内的作物，观察到 age 达上限才报告成熟。
   * 同一格持续可见时不重报；离开后重新观察到可再报。
   */
  protected cropTick(bot: unknown): void {
    const mature = scanMatureCrops(bot, 16);
    const seen = new Set(mature.map((c) => `${c.name}:${c.x},${c.y},${c.z}`));
    const fresh = mature.filter((c) => !this.matureAnnounced.has(`${c.name}:${c.x},${c.y},${c.z}`));
    this.matureAnnounced.clear();
    for (const k of seen) this.matureAnnounced.add(k);
    if (fresh.length === 0) return;
    const byName = new Map<string, typeof fresh>();
    for (const c of fresh) {
      const g = byName.get(c.name);
      if (g) g.push(c);
      else byName.set(c.name, [c]);
    }
    const parts = [...byName].map(([name, cells]) => {
      const shown = cells.slice(0, 4).map((c) => `(${c.x},${c.y},${c.z})`).join('、');
      const more = cells.length - Math.min(cells.length, 4);
      return `${zhName(name)}熟了(age ${cells[0].max}/${cells[0].max}):${shown}${more > 0 ? ` 等共 ${cells.length} 格` : ''}`;
    });
    this.emit('minecraft.event', `[Minecraft] ${parts.join(';')}。`, false, { trigger: 'piggyback' });
  }
  /**
   * 目标表陈旧自察(搭车):她在干活却没记账时提一句,搭下一次本来就会发生的唤醒,
   * 不单独叫醒她。判定、发射、预算全在 World 自己头上 —— 总线只看见一条 piggyback。
   *
   * 挂在 1 秒心跳上,不另起定时器。三条判定线见 `GOAL_STALE_MS` 那一组。
   */
  protected staleGoalTick(now: number): void {
    const list = this.goals().list;
    if (list.length === 0) return;
    // 表刚从空变成非空(或本进程头一回看见它):从这一刻起算,不拿 World 启动时刻当基准
    if (this.lastGoalWriteAt === 0) {
      this.lastGoalWriteAt = now;
      return;
    }
    const since = now - this.lastGoalWriteAt;
    if (since < GOAL_STALE_MS) return;
    if (this.tasksSinceGoalWrite < GOAL_STALE_TASKS) return;
    if (now - this.lastStaleNoticeAt < GOAL_STALE_COOLDOWN_MS) return;
    while (this.noticeTimes.length > 0 && now - this.noticeTimes[0] >= 3_600_000) this.noticeTimes.shift();
    if (this.noticeTimes.length >= GOAL_NOTICE_HOURLY_CAP) return;
    this.lastStaleNoticeAt = now;
    this.noticeTimes.push(now);
    this.emit(
      'minecraft.event',
      `[Minecraft] ${staleGoalNotice(list, since, this.tasksSinceGoalWrite)}`,
      false,
      { trigger: 'piggyback' },
    );
  }

  /** 一次 mc_goal 写入 = 记过账了:陈旧的时钟与任务计数一起归零 */
  protected markGoalWrite(): void {
    this.lastGoalWriteAt = Date.now();
    this.tasksSinceGoalWrite = 0;
  }

  /** 上一次 mc_goal 写入(add/milestone/reopen/done/drop)的时刻;0 = 本进程还没见过 */
  protected lastGoalWriteAt = 0;
  /** 上一次陈旧提醒的时刻(冷却基准) */
  protected lastStaleNoticeAt = 0;
  /** 上一次记账之后 World 做完了几件活 */
  protected tasksSinceGoalWrite = 0;
  /** 更新类提醒的发射时刻(每小时预算的滑窗) */
  protected readonly noticeTimes: number[] = [];

  /** 作物成熟扫描的节流(ms);测试可改小 */
  protected readonly cropScanMs = 10_000;
  protected lastCropScanAt = 0;
  /** 报过熟的那些格(还在视里且还熟着);离开视野即清,回来重新观察再报 */
  protected readonly matureAnnounced = new Set<string>();

  protected lastWorldEmitAt = 0;
  /** 世界快照挂单时刻;null=没有在途挂单(见 armSnapshot) */
  protected snapshotArmedAt: number | null = null;
  /** 上一份快照实际进上下文(被渲染)的时刻;snapshotSec 节流的基准 */
  protected lastSnapshotRenderAt = 0;
  /** 实体接近状态；持弓时已看见的敌对使用 32 进/40 出，其他仍为 16/24。 */
  protected readonly proximity = new Map<number, {
    kind: 'hostile' | 'notable';
    seen: boolean;
    extended: boolean;
  }>();
  /** 玩家活动单独跟踪；在线名单不代表人就在身旁。 */
  protected readonly playerObservations = new PlayerObservations();
  protected proximityBot: unknown = null;
  /** 牲畜种类当前在不在感知圈(种类级,不逐只) */
  protected readonly flocks = new Map<string, boolean>();
  protected lastThunder = false;
  protected lastPosForTeleport: { x: number; y: number; z: number } | null = null;
  protected lastDeathAt = 0;
  /** 挂起的官方死因(死亡广播通常先于 death 事件一拍到);随死亡专报投一次,过期作废 */
  protected pendingDeathCause: { text: string; key: string; at: number } | null = null;
  /** 最近一条 set_spawn 系统消息的时刻;床的右键回执据此捎带重生点变更 */
  protected lastSetSpawnAt = 0;
  protected lastServerFeedback: { text: string; at: number } | null = null;
  protected readonly serverActionWait = new ServerActionWait();
  /** 个人重生点(床/重生锚)。重连后未核实为 undefined，spawnReset 确认失效为 null。 */
  protected personalSpawn: SpawnTarget | null | undefined = undefined;
  /** 自己发起的传送:这段时间里 forcedMove 不急报,反射也不抢寻路。 */
  protected escapeHoldUntil = 0;
  protected lastDimension: string | null = null;
  protected lastLevel: number | null = null;
  /** 顶部状态条已报过的 25% 档位(按标题) */
  protected readonly bossQuarter = new Map<string | object, number>();
  protected lastBoomAt = 0;
  /** mineflayer 聊天模式已派发成 chat/whisper 的消息对象 */
  protected readonly chatClaimed = new WeakSet<object>();
  /** 最近一条动作栏文字及收到时刻 */
  protected lastActionBar: { text: string; at: number } | null = null;

  /**
   * 服务器系统消息与动作栏原文以 piggyback 进 minecraft.chat,随下一批投递,不单独唤醒。
   * mineflayer 在 message 之后才同步派发 chat/whisper,转发放到微任务里,
   * 已由那两路处理的同一条消息在此跳过。动作栏同一文字在显示期内重发只是续显,不再入流。
   */
  protected forwardServerMessage(jsonMsg: { toString(): string }, slot: 'system' | 'actionBar'): void {
    queueMicrotask(() => {
      if (this.chatClaimed.has(jsonMsg)) return;
      const text = jsonMsg.toString().trim();
      if (!text) return;
      if (slot === 'system') {
        this.emit('minecraft.chat', `[MC 系统] ${text}`, false, { trigger: 'piggyback' });
        return;
      }
      const now = Date.now();
      const prev = this.lastActionBar;
      this.lastActionBar = { text, at: now };
      if (prev?.text === text && now - prev.at < ACTION_BAR_SHOW_MS) return;
      this.emit('minecraft.chat', `[MC 动作栏] ${text}`, false, { trigger: 'piggyback' });
    });
  }

  protected suppressRepeatedSystemMessage(text: string): boolean {
    const now = Date.now();
    for (const [key, seen] of this.recentSystemMessages) {
      if (now - seen.at >= 60_000) this.recentSystemMessages.delete(key);
    }
    const seen = this.recentSystemMessages.get(text);
    if (seen) {
      seen.repeats++;
      if (seen.repeats === 1 || seen.repeats % 10 === 0) {
        this.diag.write({ lane: 'event', event: 'system-message-repeat',
          msg: `相同服务端系统提示 60 秒内重复 ${seen.repeats} 次，未再次唤醒 Agent`,
          data: { text, repeats: seen.repeats } });
      }
      return true;
    }
    this.recentSystemMessages.set(text, { at: now, repeats: 0 });
    if (this.recentSystemMessages.size > 64) {
      const oldest = this.recentSystemMessages.keys().next().value;
      if (oldest !== undefined) this.recentSystemMessages.delete(oldest);
    }
    return false;
  }

  /**
   * 实体接近报告:16 格进、24 格出的滞回状态机,1s 采样。
   * 敌对进圈立即唤醒,按可见性分"看见/听见动静";隔墙的怪露头后补一条"看清了"。
   * 友好的点名类常规攒批;牲畜按种类合并捎带;离开只有敌对值得说,消失静默清态
   * (死亡另由 entityDead 报)。
   */
  protected proximityTick(bot: any): void {
    if (bot !== this.proximityBot) {
      this.proximity.clear();
      this.flocks.clear();
      this.proximityBot = bot;
    }
    this.playerProximityTick(bot);
    const me = bot.entity.position;
    const enterSeen: string[] = [];
    const enterHeard: string[] = [];
    const revealed: string[] = [];
    const left: string[] = [];
    const notable: string[] = [];
    const present = new Set<number>();
    const flockSeen = new Map<string, number>();
    const flockNear = new Set<string>();
    const rangedReady = typeof bot.inventory?.items === 'function' &&
      Boolean(bestRangedWeapon(bot)) && hasUsableArrows(bot);
    for (const key of Object.keys(bot.entities)) {
      const e = bot.entities[key];
      if (!e || e === bot.entity || !e.position) continue;
      const name: string = e.name ?? '';
      const kind = name === 'piglin' && piglinIsHostile(bot, e)
        ? 'hostile'
        : classifyEntity(e.type, name);
      const isFlock = kind !== 'hostile' && FLOCK_ANIMALS.has(name);
      if (kind !== 'hostile' && !NOTABLE_FRIENDLY.has(name) && !isFlock) continue;
      const d = e.position.distanceTo(me);
      if (isFlock) {
        if (d <= PROXIMITY_EXIT) flockNear.add(name);
        if (d <= PROXIMITY_ENTER && canSeeEntity(bot, e)) {
          flockSeen.set(name, (flockSeen.get(name) ?? 0) + 1);
        }
        continue;
      }
      const eid: number = typeof e.id === 'number' ? e.id : Number(key);
      const state = this.proximity.get(eid);
      const dir = bearing(e.position.x - me.x, e.position.z - me.z);
      const at = dir ? `${DIRECTION_ZH[dir]}边` : '附近';
      const visible = canSeeEntity(bot, e);
      const stateKind = kind === 'hostile' ? 'hostile' : 'notable';
      const extendedVisible = stateKind === 'hostile' && rangedReady && visible;
      const extendedState = state?.extended === true && rangedReady;
      /*
       * 远处敌对的扩展退出半径只在目标仍可见时有效。
       * 不可见后移除记录，不报告“走远了”，因为没有观察到该动作。
       */
      if (state && extendedState && !visible && d > PROXIMITY_EXIT) {
        this.proximity.delete(eid);
        continue;
      }
      const exitRange = extendedVisible || (extendedState && visible) ? RANGED_EXIT_RANGE : PROXIMITY_EXIT;
      if (state && d >= exitRange) {
        this.proximity.delete(eid);
        if (state.kind === 'hostile') left.push(zhEntity(name));
        continue;
      }
      if (state && state.kind !== stateKind) {
        state.kind = stateKind;
        state.seen = visible;
        state.extended = extendedVisible;
        if (stateKind === 'hostile') {
          if (visible) enterSeen.push(`${zhEntity(name)}在${at} ${Math.round(d)} 格`);
          else enterHeard.push(`${at}有${zhEntity(name)}的动静`);
        } else {
          notable.push(visible ? `看见${zhEntity(name)}在${at} ${Math.round(d)} 格` : `${at}有${zhEntity(name)}的动静`);
        }
      }
      if (state) {
        if (extendedVisible) state.extended = true;
        else if (!rangedReady || state.kind !== 'hostile') state.extended = false;
        present.add(eid);
        if (state.kind === 'hostile' && !state.seen && visible) {
          state.seen = true;
          revealed.push(`看清了,是${zhEntity(name)}(${at} ${Math.round(d)} 格)`);
        }
        continue;
      }
      const enterRange = extendedVisible ? RANGED_ENTER_RANGE : PROXIMITY_ENTER;
      if (d > enterRange) continue;
      this.proximity.set(eid, { kind: stateKind, seen: visible, extended: extendedVisible });
      present.add(eid);
      if (kind === 'hostile') {
        if (visible) enterSeen.push(`${zhEntity(name)}在${at} ${Math.round(d)} 格`);
        else enterHeard.push(`${at}有${zhEntity(name)}的动静`);
      } else {
        notable.push(visible ? `看见${zhEntity(name)}在${at} ${Math.round(d)} 格` : `${at}有${zhEntity(name)}的动静`);
      }
    }
    for (const eid of [...this.proximity.keys()]) {
      if (!present.has(eid)) this.proximity.delete(eid);
    }
    const hostileParts = [...enterSeen, ...enterHeard, ...revealed];
    if (hostileParts.length > 0) this.emit('minecraft.event', `[Minecraft] ${hostileParts.join('、')}。`, true,
      this.executor?.currentTask || this.combat?.active ? { trigger: 'piggyback' } : undefined);
    if (left.length > 0) this.emit('minecraft.event', `[Minecraft] ${[...new Set(left)].join('、')}走远了。`, false,
      { trigger: 'piggyback' });
    if (notable.length > 0) this.emit('minecraft.event', `[Minecraft] ${notable.join('、')}。`, false,
      { trigger: 'piggyback' });
    for (const [name, count] of flockSeen) {
      if (this.flocks.get(name)) continue;
      this.flocks.set(name, true);
      this.emit('minecraft.event', `[Minecraft] 附近有${zhEntity(name)}×${count}。`, false, { trigger: 'piggyback' });
    }
    for (const [name, on] of this.flocks) {
      if (on && !flockNear.has(name)) this.flocks.set(name, false);
    }
  }

  /** Two nearby animations form one factual observation; intent remains the agent's judgment. */
  protected notePlayerGesture(bot: any, raw: unknown, kind: 'wave' | 'crouch'): void {
    if (!raw || !bot.entity || (this.bridge?.bot && this.bridge.bot !== bot)) return;
    const fact = this.playerObservations.gesture(bot, raw as Bot['entity'], kind,
      (name) => name === this.chatName() || this.isCamera(name));
    if (fact) this.emitPlayerObservation(fact);
  }

  /** Player facts are delivered independently of the full world snapshot cadence. */
  protected playerProximityTick(bot: any): void {
    if (!bot.entity || (this.bridge?.bot && this.bridge.bot !== bot)) return;
    for (const fact of this.playerObservations.sample(bot,
      (name) => name === this.chatName() || this.isCamera(name))) this.emitPlayerObservation(fact);
  }

  protected emitPlayerObservation(fact: PlayerObservation): void {
    if (!this.isCamera(fact.playerName) && fact.playerName !== this.chatName()) this.idleContext.notePlayer(fact);
    const urgent = fact.kind === 'appearance' || fact.kind === 'approach'
      || (fact.kind === 'gesture' && (fact.motion === 'crouch' || !fact.handItemName));
    this.emit('minecraft.event', `[Minecraft] ${renderPlayerObservation(fact)}。`, urgent,
      { meta: { uname: fact.playerName, socialScope: 'minecraft-server', minecraftPlayerObservation: playerObservationMeta(fact) } }, fact.playerName);
  }

  /**
   * 世界摘要:与上一次报过的快照比,变化值得说就推一条。
   *
   * 只有物品栏增减的那种摘要走搭车档:采集途中每个节流窗都在多几格土,单独
   * 叫醒她只换来一句无话可说。执行任务期间的普通位移也搭车:容器技能会自己找箱子,
   * 中途挪窝不是走错路,不该为此唤醒主循环重新决策。搭车不丢帧——积压随下一次
   * 唤醒整批送达；空闲时位移、群系、天候、饥饿照常合批唤醒。
   */
  protected reportWorldDelta(): void {
    const snap = this.snapshot();
    if (!snap) return;
    this.lastWorldEmitAt = Date.now();
    if (!this.lastReported) {
      this.lastReported = snap;
      return;
    }
    const { notes, inventoryOnly } = worldDelta(
      this.lastReported,
      snap,
      this.cfg.world.moveThreshold,
    );
    if (notes.length === 0) {
      // 首份身体、经验读数只建立基线；位置仍从上次已报告的落点累计。
      this.lastReported = {
        ...this.lastReported,
        health: this.lastReported.health ?? snap.health,
        food: this.lastReported.food ?? snap.food,
        xpLevel: this.lastReported.xpLevel ?? snap.xpLevel,
      };
      return;
    }
    this.emit(
      'minecraft.world',
      `[Minecraft] ${notes.join(';')}`,
      false,
      inventoryOnly || this.executor?.currentTask || this.combat?.active
        ? { trigger: 'piggyback' } : undefined,
    );
    this.lastReported = snap;
  }

  /**
   * 工具调用与回执入日志。下的每一道令与当场回的那句话是排查的起点;
   * session 里也有,但那份要跟事件、执行器轨迹分头对时间戳才拼得起来。
   */
  protected async doEscape(): Promise<string> {
    this.interruptIdle('escape');
    if (!this.executor) return '[mc_escape 失败] World 未启动';
    const bot = this.bridge?.bot;
    if (!bot?.entity) return '[mc_escape 失败] 未连接服务器';
    const marks = this.markTable().list;
    return runEscape({
      getBot: () => this.bridge?.bot ?? null,
      playerName: this.chatName(),
      personalSpawn: this.personalSpawn ?? null,
      // 她自己圈的落脚处也是安全锚。词表里能当"去处"的只有这两类:「家」与「床」;
      // 「箱」「资源点」这些是干活的地方,不是躲的地方,不替她扩这个口径。
      safeMarks: marks
        .filter((m) => m.kind === '家' || m.kind === '床')
        .map((m) => spawnAt({ x: m.pos[0], y: m.pos[1], z: m.pos[2] }, m.dimension, 'mark', m.name)),
      // 落点在不在她自己圈的危险区里:只进回执当事实,不参与选点
      dangerAt: (t) => dangerZonesAt(marks, t, t.dimension).map((m) => m.name),
      // 确认的落脚格同时用于排序和传送;未知区块保留原锚坐标。
      landingAt: (t) => {
        if (typeof bot.blockAt !== 'function'
          || normalizeDimension(bot.game?.dimension) !== normalizeDimension(t.dimension)) return null;
        const read: BlockReader = (x, y, z) => {
          const b = bot.blockAt(new Vec3(x, y, z));
          return b ? { name: b.name, solid: b.boundingBox === 'block' } : null;
        };
        const cell = { x: Math.floor(t.x), y: Math.floor(t.y), z: Math.floor(t.z) };
        const cells = standCellsAround(read, cell);
        if (cells.length === 0) return false;
        return cells.find((c) => read(c.x, c.y, c.z)
          && read(c.x, c.y + 1, c.z) && read(c.x, c.y - 1, c.z)) ?? null;
      },
      clearQueue: () => this.executor!.clear(),
      dropReflexGoal: (holdMs) => this.reflexes?.abandonEscapeGoal('mc_escape 传送,反射的寻路目标作废', holdMs) ?? null,
      sendConsole: (line) => this.mcServer.command(line),
      chat: (text) => { bot.chat(text); },
      playerCommand: this.cfg.escapeCommand,
      hold: (ms) => { this.escapeHoldUntil = Date.now() + ms; },
      waitMove: (ms) => this.waitForcedMove(bot, ms),
      timeoutMs: ESCAPE_TP_MS,
      noteRepeat: (target) => this.noteEscapeRepeat(target, Date.now()),
    });
  }

  /** 报告同一逃生点在窗口内的重复到达次数，不评价或推荐行动。 */
  protected noteEscapeRepeat(
    target: { x: number; y: number; z: number; dimension?: string; source?: string; name?: string },
    at: number,
  ): string | null {
    const key = `${target.dimension ?? ''}:${Math.round(target.x)},${Math.round(target.y)},${Math.round(target.z)}`;
    this.escapeLog = this.escapeLog.filter((e) => at - e.at <= ESCAPE_REPEAT_WINDOW_MS);
    const before = this.escapeLog.filter((e) => e.key === key);
    this.escapeLog.push({ key, at });
    if (before.length === 0) return '';
    const mins = Math.max(1, Math.round((at - before[0].at) / 60_000));
    // 计数按落点那一格记,所以多个锚点各有各的账;说法跟着这一次去的那个锚走
    const place = target.source === 'world' ? '同一个世界出生点'
      : target.source === 'anchor' ? '同一个重生锚'
        : target.source === 'mark' ? `同一处「${target.name ?? '路标'}」` : '同一张床';
    return `这是 ${mins} 分钟内第 ${before.length + 1} 次回到${place}。`;
  }

  protected rememberPersonalSpawn(
    bot: {
      entity?: { position?: { x: number; y: number; z: number } };
      game?: { dimension?: string };
      findBlock?: (o: unknown) => { name?: string; position?: Vec3like } | null;
    },
    from: string,
  ): void {
    const p = bot.entity?.position;
    if (!p) return;
    // 重生点取床的位置；找不到床时回退到当前脚下坐标。
    const anchor = bot.findBlock?.({
      matching: (b: { name?: string } | null) => typeof b?.name === 'string'
        && (/(^|_)bed$/.test(b.name) || b.name === 'respawn_anchor'),
      maxDistance: 4,
    });
    const source = anchor?.name === 'respawn_anchor' ? 'anchor' : 'bed';
    this.setPersonalSpawn(spawnAt(anchor?.position ?? p, bot.game?.dimension, source), from);
  }

  protected hydratePersonalSpawn(): void {
    const dir = this.mcServer.directory();
    if (!dir) return;
    const world = settingsFrom(loadProperties(dir)).levelName;
    const file = playerDatPath(dir, world, offlineUuid(this.chatName()));
    const parsed = readPlayerDatFile(file);
    if (parsed) this.setPersonalSpawn(parsed, 'player.dat', { announce: false });
  }

  /**
   * 躺床、set_spawn、启动读 player.dat 和 spawnReset 共用的重生点写入口。
   * 仅变更时记录时刻与新旧值。
   */
  protected setPersonalSpawn(next: SpawnTarget | null | undefined, from: string, opts?: { announce?: boolean }): void {
    const prev = this.personalSpawn;
    this.personalSpawn = next;
    const where = (s: SpawnTarget | null | undefined): string =>
      s ? `(${Math.round(s.x)}, ${Math.round(s.y)}, ${Math.round(s.z)}) ${s.dimension} [${s.source}]`
        : s === null ? '无' : '尚未核实';
    if (where(prev) === where(next)) return;
    this.diag.write({
      lane: 'world', event: 'spawn-point',
      msg: `重生点 ${where(prev)} → ${where(next)}(来源:${from})`,
      data: { from, prev, next },
    });
    if (opts?.announce === false || !next) return;
    // 原版白天右键床会先设置重生点，再拒绝睡眠；重生点迁移仍须报告。
    const sameDim = !!prev && normalizeDimension(prev.dimension) === normalizeDimension(next.dimension);
    const moved = sameDim && prev ? Math.hypot(next.x - prev.x, next.y - prev.y, next.z - prev.z) : null;
    const at = `[${zhDimension(next.dimension)}] (${Math.round(next.x)}, ${Math.round(next.y)}, ${Math.round(next.z)})`;
    const text = moved === null
      ? (!prev
        ? `[Minecraft] 重生点设在 ${at} 了${prev === null ? '(此前已确认没有个人重生点)' : ''}。`
        : `[Minecraft] 重生点换到 ${at} 了,跟原来那个不在同一个维度。`)
      : `[Minecraft] 重生点搬到 ${at} 了,离原来那个 ${Math.round(moved)} 格。`;
    // 搬远了/换维度才唤醒:这才是会让她"回家"这类计划整个作废的量
    this.emit('minecraft.event', text, moved === null ? !!prev : moved > SPAWN_FAR_BLOCKS);
  }

  /**
   * 死亡回执附重生点和距死亡点的距离。背包是否保留由服务端规则决定。
   * 死亡点只关联 MARK_NEAR_MAX 内最近的一处路标。
   */
  protected deathNote(bot: { spawnPoint?: Vec3like }, dropAt: DimensionPoint | null): string {
    const at = (p: Vec3like, dimension: string): string =>
      `[${zhDimension(dimension)}] (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`;
    const far = (p: Vec3like, dimension: string): string =>
      dropAt && normalizeDimension(dimension) === normalizeDimension(dropAt.dimension)
        ? `,离死亡点 ${Math.round(Math.hypot(p.x - dropAt.x, p.y - dropAt.y, p.z - dropAt.z))} 格`
        : dropAt ? ',与死亡点不在同一个维度,不计算直线距离' : '';
    const near = dropAt ? this.nearMarkNote(dropAt, dropAt.dimension) : null;
    const died = dropAt ? `死亡点在 ${at(dropAt, dropAt.dimension)}${near ? `,${near}` : ''}。` : '';
    const spawn = this.personalSpawn;
    let back: string;
    if (spawn) back = `会回重生点 ${at(spawn, spawn.dimension)} 重生${far(spawn, spawn.dimension)}。`;
    else if (spawn === undefined) {
      back = '个人重生点尚未核实，重生落点以服务端实际结果为准。';
    }
    else if (bot.spawnPoint) {
      back = `没有重生点了,会回世界出生点 ${at(bot.spawnPoint, 'minecraft:overworld')} `
        + `重生${far(bot.spawnPoint, 'minecraft:overworld')}。`;
    }
    else back = '会在出生点重生。';
    return `${died}${back}重生后核对背包和装备。`;
  }

  /** 世界出生点在哪、离她多远:重生点失效那一刻她最需要知道的两件事 */
  protected worldSpawnNote(bot: {
    entity?: { position?: Vec3like };
    game?: { dimension?: string };
    spawnPoint?: Vec3like;
  }): string {
    const w = bot.spawnPoint;
    if (!w) return '从现在起死了会回世界出生点(坐标这会儿读不到)。';
    const me = bot.entity?.position;
    const sameDimension = normalizeDimension(bot.game?.dimension) === 'minecraft:overworld';
    const far = me && sameDimension
      ? `,离你现在的位置 ${Math.round(Math.hypot(me.x - w.x, me.y - w.y, me.z - w.z))} 格`
      : me ? ',与你现在的位置不在同一个维度,不计算直线距离' : '';
    return `从现在起死了会回世界出生点 [主世界] (${Math.round(w.x)}, ${Math.round(w.y)}, ${Math.round(w.z)})${far}。`;
  }

  /**
   * 重生三秒后用实测坐标复核落点,并就地重设位置基线 —— 重生是一次瞬移,
   * 不重设的话世界摘要会把它渲染成「往东走了 863.7 格」,往她的世界模型里写假事实。
   * 只动 position 这一段:掉了什么、走进了什么群系照旧照实报。
   */
  protected confirmRespawn(
    bot: { entity?: { position?: Vec3like }; game?: { dimension?: string } },
    dropAt: DimensionPoint | null,
    predicted: SpawnTarget | null,
  ): void {
    const p = bot.entity?.position;
    if (!p) return;
    if (this.lastReported) this.lastReported = { ...this.lastReported, position: { x: p.x, y: p.y, z: p.z } };
    const dimension = normalizeDimension(bot.game?.dimension);
    const off = predicted && normalizeDimension(predicted.dimension) === dimension
      ? Math.hypot(p.x - predicted.x, p.y - predicted.y, p.z - predicted.z)
      : null;
    // 预告准了就不再说一遍：死亡回执刚报过同一个坐标，53 次死就是 53 条冗余
    if (off !== null && off <= RESPAWN_OFF_BLOCKS) return;
    const far = dropAt && normalizeDimension(dropAt.dimension) === dimension
      ? `,离死亡点 ${Math.round(Math.hypot(p.x - dropAt.x, p.y - dropAt.y, p.z - dropAt.z))} 格`
      : dropAt ? ',与死亡点不在同一个维度' : '';
    const wrong = predicted && normalizeDimension(predicted.dimension) !== dimension
      ? `(落点维度跟预告的${zhDimension(predicted.dimension)}不同)`
      : off === null ? '' : `(跟刚才说的那个重生点差 ${Math.round(off)} 格)`;
    this.emit(
      'minecraft.event',
      `[Minecraft] 重生了,实际落在 [${zhDimension(dimension)}] (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})${wrong}${far}。`,
      false,
    );
  }

  /** set_spawn 刚落地过就给一句;床的右键回执捎带它,免得那一次点击在她眼里是纯空操作 */
  protected freshSpawnNote(): string | null {
    if (Date.now() - this.lastSetSpawnAt > SPAWN_NOTE_MS) return null;
    const s = this.personalSpawn;
    const at = s
      ? ` [${zhDimension(s.dimension)}] (${Math.round(s.x)}, ${Math.round(s.y)}, ${Math.round(s.z)})`
      : '';
    return `但重生点已经记下了${at}`;
  }

  protected freshServerFeedback(startedAt: number): string | null {
    const feedback = this.lastServerFeedback;
    if (!feedback || feedback.at < startedAt || Date.now() - feedback.at > 3_000) return null;
    return feedback.text;
  }

  protected waitForcedMove(bot: any, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const onMove = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        bot.removeListener('forcedMove', onMove);
        resolve(false);
      }, ms);
      bot.once('forcedMove', onMove);
    });
  }

  protected toolLog(name: string, args: Record<string, unknown>, receipt: string): string {
    this.diag.write({
      lane: 'tool', event: name,
      msg: `${name} → ${receipt.replace(/\n/g, ' ')}`,
      data: { args, receipt, connectionGeneration: this.connectionGeneration },
    });
    return receipt;
  }

  /** 只给当前尾步空队列一份现读事实；任务结束或新增待办后不投递陈旧提示。 */
  protected onQueueTail(notice: TaskQueueTail): void {
    const executor = this.executor;
    const host = this.host;
    const generation = this.connectionGeneration;
    if (!executor || !host) return;
    host.pushDeferred({
      type: 'minecraft.task.queue', senderKey: 'minecraft', tags: ['snapshot'],
      meta: { minecraftQueueTail: { schemaVersion: 1, ...notice } },
      render: () => {
        if (this.host !== host || this.executor !== executor
          || generation !== this.connectionGeneration || !this.bridge?.connected) return null;
        const queue = executor.queueTailStatus(notice);
        if (!queue) return null;
        const snapshot = this.renderSnapshotEvent();
        const text = `[执行器/队列] 当前任务正在执行最后一步，后面没有待办。任务继续执行；这条观察不要求停止或换任务。`
          + `需要提前提交同一目标的后续步骤时可用 queue:"append" 保留原队列。\n[队列] ${renderQueue(queue)}`
          + (snapshot ? `\n${snapshot}` : '');
        this.diag.write({ lane: 'event', event: 'minecraft.task.queue', msg: text,
          data: { trigger: 'debounce', connectionGeneration: generation, taskId: notice.taskId } });
        return text;
      },
    }, { trigger: 'debounce' });
  }

  /**
   * 执行器与反射的汇报一律立刻投递:任务的结局正是agent停下来等的那件事,
   * 压在合批的地板里只会让agent以为没动静,转头再发一条。
   *
   * 一件事有结局的同一刻队列也变了(下一件开跑、或者后面的都撤了)。两件事分开
   * 说要agent自己拼,拼错了就会往一个已经在做的队列上再排一条。
   */
  protected onTaskReport(r: TaskReport): void {
    if (r.taskId !== undefined && r.kind !== 'suspended' && r.kind !== 'resumed' && r.kind !== 'reflex') {
      this.methodTerminals.set(r.taskId, r);
      while (this.methodTerminals.size > 64) this.methodTerminals.delete(this.methodTerminals.keys().next().value!);
      this.methodTasks.get(r.taskId)?.(r);
    }
    if (r.kind === 'suspended' || r.kind === 'resumed') {
      this.diag.write({ lane: 'task', event: `task-${r.kind}`, taskId: r.taskId, msg: r.text });
      this.emit(`minecraft.task.${r.kind}`, `[执行器] ${r.text}`, false,
        { trigger: 'piggyback', execution:r.taskId===undefined?undefined:{kind:'task',id:`${this.executionEpoch}:${r.taskId}`,phase:r.kind==='resumed'?'running':'suspended',terminal:false,goalCompleted:false}, meta: { taskId: r.taskId } });
      return;
    }
    // 反射汇报里已经写明了掉血的来由,紧接着的掉血播报就是复述
    if (r.kind === 'reflex' && r.hurt) this.lastReflexHurtAt = Date.now();
    if (r.kind === 'reflex') {
      this.emit('minecraft.task', r.text, true);
      return;
    }
    const reportVersion = ++this.taskReportVersion;
    if (r.taskId !== undefined) {
      this.taskReportVersions.set(r.taskId, reportVersion);
      if (this.taskReportVersions.size > 64) {
        this.taskReportVersions.delete(this.taskReportVersions.keys().next().value!);
      }
    }
    const repeatEvidence = r.repeatFailure
      ? `\n[重复尝试记录] ${r.repeatFailure.scope === 'target' ? '同一坐标目标' : '同形状任务'}在 15 分钟内第 ${r.repeatFailure.attempts} 次尝试；`
        + `${r.repeatFailure.observation === 'unchanged'
          ? r.repeatFailure.scope === 'target'
            ? '本次起止位置、背包物品数量与目标方块读数未变'
            : '本次起止位置与背包物品数量未变'
          : r.repeatFailure.observation === 'changed'
            ? '本次现场采样读数有变化，整单仍未完成'
            : '部分现场读数不可比'}；回执是否证明原目标达成需核对。`
        + `${r.repeatFailure.previousReceipt ? `上次回执：${r.repeatFailure.previousReceipt}` : ''}`
      : '';
    const reportText = `${r.text}${repeatEvidence}`;
    // 「最近一单是什么下场」的单槽:mc_queue 现读它(见 lastFinishedTask)
    this.lastFinishedTask = { at: Date.now(), kind: r.kind, text: reportText };
    // 任务终态只是采样时机；里程碑仍由独立世界现读判定，并先搭同一批事件。
    this.publishGoalPlanEdges('piggyback');
    // 「在干活却没记账」的分子:做完与做了一半都算干了活,受阻/顶替/撤单不算
    if (r.kind === 'done' || r.kind === 'partial') this.tasksSinceGoalWrite++;
    // 队列空着时那一行是「手上没有在做的事;后面没有排着的了」——一条终态回执后面
    // 跟这么一句零信息。受理句(submit)与世界快照那两处不受此限:那两处「空着」本身
    // 是读数,而这里刚说完的就是「这一单完了」。
    const q = this.executor?.status();
    const queue = q && (q.running || q.waiting.length > 0) ? `\n[队列] ${renderQueue(q)}` : '';
    // cancelled 进入事件流并随批次投递，不单独唤醒。
    this.emit('minecraft.task', `[执行器] ${reportText}${queue}`, r.kind !== 'cancelled',
      {execution: r.taskId === undefined ? undefined : {kind:'task',id:`${this.executionEpoch}:${r.taskId}`,
        phase:r.kind==='done'?'completed':r.kind,
        terminal:!['suspended','resumed','reflex'].includes(r.kind),goalCompleted:false,evidence:{receipt:reportText,steps:r.steps??[]}},
        ...(r.repeatFailure ? { meta: { repeatFailure: {
        taskId: r.taskId, attempts: r.repeatFailure.attempts, scope: r.repeatFailure.scope,
        observation: r.repeatFailure.observation,
      } } } : {}) });
    if (r.kind === 'done' && r.lastSkill === 'goto'
      && (this.cfg.idle ?? MINECRAFT_DEFAULTS.idle).afterArrival
      && q && !q.running && q.waiting.length === 0 && !q.hold) {
      const now = Date.now();
      const quietUntil = this.idleQuietReason === 'task' ? now : this.idleQuietUntil;
      this.idleArrival = {
        generation: this.idleGeneration(),
        expiresAtMs: Math.min(now + MinecraftWorld.IDLE_ARRIVAL_MAX_WAIT_MS,
          Math.max(now, quietUntil) + MinecraftWorld.IDLE_ARRIVAL_WINDOW_MS),
      };
      queueMicrotask(() => this.tryArrivalIdle());
    }
  }

  protected lastHealth: number | null = null;
  protected lastDamageNoticeAt = 0;
  protected lastReflexHurtAt = 0;

  /**
   * 非反射伤害在单次损失至少 2 点生命时播报。
   * 反射层刚汇报的伤害在 5 秒内不重复,零敲碎打的掉血按 6 秒节流。
   *
   * 单跳掉 URGENT_LOSS 点以上的一律立刻投递,不受节流也不等合批:岩浆是每半秒
   * 4 点,20 血只够活两秒半,等血线跌破 10 再唤醒她,人已经死透了。
   */
  protected noticeDamage(health: number): void {
    const prev = this.lastHealth;
    this.lastHealth = health;
    // 每次血量更新都取走攒下的伤害记录,下一次掉血不会认领这一次的来由
    const bot = this.bridge?.bot;
    const hits = bot ? takeSelfDamage(bot) : [];
    if (prev === null || health <= 0 || health >= prev) return;
    const lost = prev - health;
    const now = Date.now();
    if (lost < 2) {
      // 小额持续伤害单独检测，避免被普通掉血阈值过滤。
      this.noticePersistentDamage(health, now);
      return;
    }
    if (now - this.lastReflexHurtAt < 5_000) return;
    const urgent = health < 10 || lost >= URGENT_LOSS;
    if (!urgent && now - this.lastDamageNoticeAt < 6_000) return;
    this.lastDamageNoticeAt = now;
    // 来由只报服务端 damage_event 给的事实;没收到就不说
    const source = selfDamageText(hits);
    const from = source ? `(${source})` : '';
    this.emit(
      'minecraft.event',
      `[Minecraft] 我在掉血!少了 ${Math.round(lost)} 点,现在 ${Math.ceil(health)}/20${from}。`,
      urgent,
    );
  }

  /** 上一条持续伤害播报的时刻(着火/窒息那条节流线) */
  protected lastPersistentDamageAt = 0;

  /**
   * 持续伤害的节流播报:只报状态事实(在烧/头卡在什么里 + 当前血量),不建议动作。
   * 每跳 1 点的火伤/窒息伤过不了 noticeDamage 的 lost<2 闸,单独走这条。
   */
  protected noticePersistentDamage(health: number, now: number): void {
    if (now - this.lastPersistentDamageAt < 8_000) return;
    if (now - this.lastReflexHurtAt < 5_000) return; // 反射刚说过掉血来由,不复述
    const bot = this.bridge?.bot;
    if (!bot?.entity) return;
    const touch = hazardTouch(bot);
    const head = bot.blockAt(bot.entity.position.offset(0, 1, 0));
    const suffocating = head !== null && head.boundingBox === 'block';
    if (!touch.onFire && !suffocating) return;
    this.lastPersistentDamageAt = now;
    const what = touch.onFire ? '身上着着火' : `头卡在${zhName(head!.name)}里`;
    this.emit(
      'minecraft.event',
      `[Minecraft] 我在掉血:${what},现在 ${Math.ceil(health)}/20。`,
      health < 10,
    );
  }


  protected observerName(): string { return this.accountAuth.observer.snapshot().profile?.name ?? this.cfg.client.username; }
  protected playerName(): string { return this.accountAuth.player.snapshot().profile?.name ?? this.cfg.player.username; }
  protected chatName(): string {
    return this.bridge?.bot?.username || this.cfg.username || this.botName;
  }

  /** 观察者客户端账号不计入在线玩家。 */
  protected isCamera(username: string): boolean {
    const cam = this.observerName();
    return Boolean(cam) && username === cam;
  }

  protected snapshot(opts?: { scanBlocks?: boolean }): WorldSnapshot | null {
    const bot = this.bridge?.bot;
    if (!bot?.entity) return null;
    try {
      const snap = snapshotFromBot(bot, {
        invSynced: this.bridge?.invSynced,
        timezone: this.timezone,
        chestOf: (dim, p) => this.chests.get(dim, p),
        ...opts,
      });
      // 在线名单排除 bot 自身与观察摄像机;两者都不是 goto_player 的有效目标。
      const self = this.chatName();
      snap.players = snap.players.filter((n) => n !== self && !this.isCamera(n));
      return snap;
    } catch {
      return null; // 区块未加载完成时跳过该快照;下一 tick 重试。
    }
  }


  /**
   * 发车时渲染世界快照与队列，按段比较基线；全部未变则不生成事件。
   * 首份、上下文截断后、重连后及超过 snapshotAnchorSec 时发送全量锚。
   */
  protected renderSnapshotEvent(): string | null {
    this.snapshotArmedAt = null;
    const now = Date.now();
    // 同批双份兜底:陈旧重挂导致一批里有两条快照时,第二条现拿直接蒸发
    if (now - this.lastSnapshotRenderAt < 1000) return null;
    if (!this.bridge?.connected) return null;
    const snap = this.snapshot();
    if (!snap) return null;
    this.lastSnapshotRenderAt = now;
    const queue = renderQueue(this.executor?.status() ?? { running: null, waiting: [] });
    // 目标与路标两行:空表也报一行事实(表空着是有信息的,静默 = 那张表不存在)。
    // 它们是暂态的机械投影,不是世界读数,所以进不了 WorldSnapshot —— 与重生点
    // 同一个待遇,由持有它们的 World 自己拼进段表与比对键
    const goals = goalSnapshotLine(this.goals().list, (k) => this.blueprints.noteOf(k));
    const marks = mapSnapshotLine(this.markTable().list);
    const blueprints = this.blueprints.siteFacts();
    const offhand = snap.equipment.find(piece => piece.slot === 'offhand');
    const foodStacks = [...snap.inventory,
      ...(offhand?.count === undefined ? [] : [{ name: offhand.name, count: offhand.count }])];
    const foodReserve = renderFoodReserveReadout(foodStacks,
      this.bridge?.bot?.registry?.foodsByName ?? {}, snap.invSynced === true, zhName);
    const spawn = this.personalSpawn;
    const respawn = spawn
      ? `个人重生点：[${zhDimension(spawn.dimension)}] (${Math.round(spawn.x)}, ${Math.round(spawn.y)}, ${Math.round(spawn.z)})，来源 ${spawn.source}。`
      : spawn === null ? '个人重生点已确认失效，重生落点由服务端决定。'
        : '个人重生点尚未核实；未核实不表示没有重生点。';
    const anchorDue = this.snapshotBaseline === null
      || this.snapshotAnchorPending
      || now - this.lastSnapshotFullAt >= this.cfg.world.snapshotAnchorSec * 1000;
    const near = this.nearMarkNote(snap.position);
    const segs = [
      // 位置相对路标的描述参与 place 段比对。背包相对上一份已发快照只报变化，
      // 全量锚则报告完整背包。
      ...narrateWorldSegments(snap, near, anchorDue ? null : this.snapshotBagBase),
      { key: 'respawn' as const, text: respawn, cmp: respawn },
      { key: 'queue' as const, text: queue, cmp: queue },
      { key: 'goals' as const, text: goals, cmp: goals },
      { key: 'marks' as const, text: marks, cmp: marks },
      { key: 'blueprints' as const, text: blueprints, cmp: blueprints },
      { key: 'foodReserve' as const, text: foodReserve, cmp: foodReserve },
    ];
    // 请求用事实必须自足：增量背包仅属于事件，不能拿来替换历史快照。
    // 复用刚取得的 snap，不追加扫描；即使这拍变化被抑制，采样时间仍是本次读数。
    const fullSegments = anchorDue ? segs : [
      ...narrateWorldSegments(snap, near, null),
      ...segs.filter((segment) => segment.key === 'queue'
        || segment.key === 'goals' || segment.key === 'marks' || segment.key === 'foodReserve'
        || segment.key === 'respawn' || segment.key === 'blueprints'),
    ];
    const parts = [{ key: 'sample', text: `[Minecraft 当前读数；采样 ${snap.realTime}]` },
      ...fullSegments.map(({ key, text }) => ({ key, text })),
      { key: 'explored', text: this.explored.summary(normalizeDimension(snap.dimension)) }];
    this.requestFactsCache = {
      text: parts.map(part => part.text).filter(Boolean).join('\n'),
      parts,
      snapshotTypes: ['minecraft.world.snapshot', 'minecraft.task.queue'],
    };
    // 按变化量发:与上一拍比没有实质变化、人也没挪窝,这一拍整条不发(基线不动,
    // 下一次真变了照样按段差分)。全量锚那一拍不受这道闸管,漂移由它兜住。
    // 队列状态一起进比对键 —— 手上在做什么变了就是实质变化。
    const quietKey = `${snapshotFingerprint(snap)}|${queue}` +
      `|spawn:${this.personalSpawn ? `${this.personalSpawn.x},${this.personalSpawn.y},${this.personalSpawn.z}` : this.personalSpawn === null ? 'none' : 'unknown'}` +
      // 两张暂态表也进比对键:表变了就是实质变化,那一拍该发
      `|goals:${goals}|marks:${marks}|foodReserve:${foodReserve}|blueprints:${blueprints}`;
    const prev = this.snapshotQuiet;
    const moved = prev
      ? Math.hypot(snap.position.x - prev.pos.x, snap.position.y - prev.pos.y, snap.position.z - prev.pos.z)
      : Number.POSITIVE_INFINITY;
    if (!anchorDue && prev && prev.key === quietKey && moved < SNAPSHOT_QUIET_MOVE) return null;
    this.snapshotQuiet = { key: quietKey, pos: { ...snap.position } };
    const dirty = anchorDue ? segs : segs.filter((g) => this.snapshotBaseline?.get(g.key) !== g.cmp);
    if (dirty.length === 0) return null;
    this.snapshotBaseline = new Map(segs.map((g) => [g.key, g.cmp]));
    // 背包基线与段基线同刻推进:下一份增量差的就是这一份印出去的东西。
    // 没同步完的那份不作数(空清单不是有效基线,与 worldDelta 同一口径)
    if (snap.invSynced) this.snapshotBagBase = snap.inventory;
    if (anchorDue) {
      this.snapshotAnchorPending = false;
      this.lastSnapshotFullAt = now;
      return `[Minecraft] ${segs.map((g) => g.text).filter(Boolean).join('\n')}`;
    }
    // 变脏但当下无内容的段(近处/地形都空了)要说出来,静默省略会被当成"没变"
    const body = dirty
      .map((g) => g.text || (g.key === 'structure' ? '近处和地形都没什么可提的了。' : ''))
      .filter(Boolean)
      .join('\n');
    // 脏段全都渲染成空:基线已经跟上了,这一条不必存在
    if (!body) return null;
    return `[Minecraft] ${body}`;
  }
  /** 各段比对键的基线;null=还没发过全量,下一份必发全量 */
  protected snapshotBaseline: Map<string, string> | null = null;
  /** 只在已有世界快照采样时刷新；断线时不对外提供。 */
  protected requestFactsCache: WorldRequestFacts | null = null;
  /** 上一条真发出去的快照的实质指纹与站位(跳拍闸的基准) */
  protected snapshotQuiet: { key: string; pos: { x: number; y: number; z: number } } | null = null;
  /** 上一份真发出去的快照里的背包(gear 段增量的基准);null=还没有基线,下一份整份印 */
  protected snapshotBagBase: ItemStack[] | null = null;
  /** 上一份全量快照的时刻;snapshotAnchorSec 兜底的基准 */
  protected lastSnapshotFullAt = 0;
  /** 置位后下一份快照强制全量(截断刷新环境提示词、重连 spawn 时置位) */
  protected snapshotAnchorPending = false;

  /**
   * 世界快照的挂单(投递成文):每秒由 worldTick 检查,距上一份
   * 进上下文超过 snapshotSec 且没有在途挂单时补挂一条 piggyback——不唤醒,
   * 搭下一班投递走,正文在发车刻现拿。挂单超过 5 分钟没被渲染(隐藏期丢单等)
   * 视为失踪,允许重挂;双份由 renderSnapshotEvent 的 1s 兜底蒸发掉。
   */
  protected armSnapshot(now: number): void {
    if (!this.host || !this.bridge?.connected) return;
    if (this.snapshotArmedAt !== null && now - this.snapshotArmedAt < 300_000) return;
    if (now - this.lastSnapshotRenderAt < this.cfg.world.snapshotSec * 1000) return;
    this.snapshotArmedAt = now;
    this.host.pushDeferred(
      { type: 'minecraft.world.snapshot', senderKey: 'minecraft', tags: ['snapshot'], render: () => this.renderSnapshotEvent() },
      { trigger: 'piggyback' },
    );
  }

  protected emit(
    type: string,
    text: string,
    urgent: boolean,
    opts?: { execution?: ExecutionReceipt; deliver?: boolean; trigger?: TriggerMode; tags?: readonly EventTag[]; meta?: Record<string, unknown>; blobs?: BlobInput[] },
    senderKey?: string,
  ): void {
    if (!this.host) return;
    const player = opts?.meta?.uname;
    if (type === 'minecraft.chat' && opts?.deliver !== false && typeof player === 'string'
      && player !== this.chatName() && !this.isCamera(player)) {
      this.idleContext.noteChat(player, text, text.startsWith('[MC 私聊]') ? 'whisper' : 'public');
    }
    const trigger: TriggerMode = opts?.trigger ?? (urgent ? 'flush' : 'debounce');
    // Flush 会投递全部积压；先结算受节流的世界摘要，使其与完成事件进入同一批。
    if (trigger === 'flush' && type !== 'minecraft.world') this.reportWorldDelta();
    // 事件日志保存实际投递文本，供事后追溯。
    this.diag.write({
      lane: 'event',
      event: type,
      msg: text,
      data: { trigger, deliver: opts?.deliver !== false, connectionGeneration: this.connectionGeneration,
        ...(opts?.meta ? { meta: opts.meta } : {}) },
    });
    this.host.pushEvent(
      {
        ts: nowIso(this.timezone),
        source: this.id,
        type,
        text,
        senderKey: senderKey ?? 'minecraft',
        tags: opts?.tags,
        meta: opts?.meta,
        blobs: opts?.blobs,
        execution: opts?.execution,
      },
      { trigger, deliver: opts?.deliver },
    ).catch((e) => this.host?.log.warn('事件投递失败', { type, err: String(e) }));
  }
}
