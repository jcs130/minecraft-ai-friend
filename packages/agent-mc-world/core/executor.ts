/**
 * 异步执行器:任务队列 + 逐步派发 + 自保反射。
 *
 * mc_do 的契约在这里落地:排队立即返回,技能后台跑,完成/受阻/被抢占一律经
 * report 回调交给 World 转成 minecraft.task 事件。一件做完接着做下一件;
 * 反射不经 LLM,做了什么事后汇报。技能一律经 `getBot()` 现取 bot(重连后实例会换)。
 *
 * 技能的契约面(SkillCall/parseSteps/SKILL_DOC/schema)住在 skills.ts 的注册表里,
 * 实现分在 skills-*.ts 各族,`runSkill` 是唯一派发口。公共面经本文件转口,
 * 调用方不必分辨两处。
 */
import type { Bot } from 'mineflayer';
import { observeDamage, type DamageEvidence } from './damage-evidence.ts';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import type { Logger } from './support/host-contract.ts';
import { nowIso } from './support/runtime.mjs';
import type { MinecraftLog } from './log.ts';
import {
  BLOCK_FACES, cellOnFace, rasterize, resolveAnchors,
  type Anchor, type AnchorCoord, type BlockFace, type BoxFill, type Cell, type ShapeName,
} from './geometry.ts';
import {
  CHEST_BLOCKS, ChestBook, FURNACE_BLOCKS, chestBlockName,
  hasItem, hasRoom, matchItemName, matchMaterialName, type ChestRecord,
} from './chests.ts';
import { worksNote, WorksBook, type WorkHit } from './works.ts';
import {
  DRINKABLES, readDurability, readEnchants, readPotionId,
  type EnchantRegistry, type ItemEnchant, type ItemLike,
} from './item-facts.ts';
import {
  itemMatchesPick, pickLabel, pickMissText, pickTargetOf, pickedText, type PickTarget,
} from './item-pick.ts';
import {
  FEED_ITEMS, TAME_ITEMS, dyeColorOf, readHorseTamed, readSaddled, readSheepColor, readSitting, readTamedBy, tamedByMe,
} from './entity-facts.ts';
import { roman, zhDimension, zhEnchant, zhEntity, zhName } from './names.ts';
import {
  CROP_MAX_AGE, DIRECTIONS, DIRECTION_ZH, bearing, biomeAt, canSeeBlockAt, canSeeEntity,
  ESCAPE_SAFE_GAP, bodyInWater, cropAgeAt, droppedStackOf, findEscapeCell, hazardTouch, hazardsWithin, headInWater,
  isDark, isNight, narrateInventory, nearestHazard, pocketScan, sampleLight, villagerNote, WATER_BLOCKS, wetNote,
  type Direction, type HazardCell, type ItemStack,
} from './terrain.ts';
import {
  chatInputError, FIND_STATIC_MAX, NEAR_DEFAULT, PROBE_WHERE_SHOWN, UNTIL_CATEGORIES, UNTIL_CATEGORY_DOC,
  type AttackMode, type Expectation, type QueueMode, type SkillCall,
} from './skills.ts';
import {
  FALLBACK_DEFAULTS, isGravityBlock, isSpawnAnchorBlock,
  type PolicyDefaults, type PolicySettings,
} from './policy.ts';
import { HOE_TILLED, SHOVEL_PATH, blockStateItem } from './blueprint-registry.ts';
import { ShowPacer, type ShowTempo } from './show.ts';
import {
  PLAYER_SLOTS, edibleInBag, notFoodText, precheckSteps, renderPrecheckNotes, type PrecheckDeps,
} from './precheck.ts';
import { normalizeDimension } from './escape.ts';
import { InspectionGuard } from './inspection-guard.ts';
import { DirectionalSweepBook } from './directional-sweeps.ts';
import { farmingClickCell, isHoeUseItem } from './farming-target.ts';
import { publishViewerCastCommand } from './command-events.ts';
import { skillGesture } from './skills-social.ts';
import { skillLook } from './skills-look.ts';
import { skillControl } from './skills-control.ts';
import { flyToLanding, flyToPosition, landFlight, flightState, previewFlight } from './flight.ts';
import { promoteTemporaryScaffold, reclaimPendingTemporaryScaffold } from './temporary-scaffold.ts';
import { inventoryReadConfirmed } from './inventory-window-sync.ts';
import { assertInventoryClicksReady, isInventoryClickError } from './inventory-click-sync.ts';
import { ContainerWindowOwnership } from './container-window-ownership.ts';
import { isBabyPiglin, piglinIsHostile } from './piglin.ts';
import {
  blockIdOf, normalizeBlockName, renderLayerMap,
  type NormalizedBlueprint, type PositionXYZ,
} from './blueprint.ts';
import {
  billForSteps, blueprintProgress, blueprintStepStateMatches, diffBlueprint, renderBlueprintAdvisories,
  stepCountThroughLayer, stepToBuildCall, summarizeReadback, toWorld,
  type BlueprintCheckCell, type BlueprintConflict, type BlueprintDiff, type BlueprintPlan, type BlueprintStep,
  type ItemTally, type ReadbackEntry,
} from './blueprint-plan.ts';
import {
  HYBRID_MELEE_AT, KITE_MAX_RANGE, KITE_MIN_RANGE,
  bestRangedWeapon, chooseHybridWeapon, hasRangedLos, hasUsableArrows,
  type BowEvent, type BowShotResult, type HybridWeapon, type RangedTarget,
} from './ranged.ts';
import { FindObservationCache, type FindKind, type SearchScope } from './search-observation.ts';
import {
  Aborted, Yielded, SkillBlocked, SkillNoop, checkAbort, dangerNoteText, sleep,
  type BlueprintDesk, type BlueprintSite, type BlueprintSurvey, type BodyStateProbe,
  type MarkDesk, type ProbeMemo, type ReserveHit, type ResourcePlacementGate,
  type ResourcePlacementPermit, type ResourcePlacementPreview, type RouteProbe,
  type SkillContext, type TargetDiag, type TaskAttackLease, type TaskRangedActions,
  type ToolTrace,
} from './skill-context.ts';

const { goals } = pathfinderPkg;

export {
  NEAR_DEFAULT, parseNoteText, parseQueueMode, parseScoutSteps, parseSteps,
  QUEUE_MODES, QUEUE_SCHEMA,
  SCOUT_SKILL_DOC, SCOUT_SKILL_NAMES, SCOUT_STEP_SCHEMA,
  SKILL_DOC, SKILL_NAMES, SKILL_STEP_SCHEMA,
} from './skills.ts';
export type {
  Expectation, MarkLookup, ParseNote, QueueMode, SkillCall, StepBounds,
} from './skills.ts';
export { dangerNoteText } from './skill-context.ts';

type UsedBlockState = { name: string; stateId: number; open: string | null };

/** 开关门是双向操作：关门不能抹掉刚记录的寻路失败。 */
export function useChangeMayClearRouteFailure(before: UsedBlockState | null, after: UsedBlockState | null): boolean {
  if (!before || !after || before.stateId === after.stateId) return false;
  const isDoor = before.name.endsWith('_door') || before.name.endsWith('_fence_gate');
  if (isDoor && before.name === after.name) return before.open === 'false' && after.open === 'true';
  return true;
}
export { describeSkill, zhErrorText } from './receipt.ts';
export { dropOwnedGoal, goalOwnerKind, releaseBody, renderRouteMenu, setOwnedGoal } from './travel.ts';
export { HOSTILE, bestWeapon, meleeCooldownMs } from './melee.ts';
export {
  findFishingSpot, fishWaitMs, isOpenFishingWater, planFishingCasts,
} from './skills-gather.ts';
export type {
  BlueprintDesk, BlueprintSurvey, MarkDesk, ResourcePlacementGate, ResourcePlacementPermit,
  RouteProbe, TargetDiag,
} from './skill-context.ts';
import {
  AIR_NAMES, BUILD_CELL_CAP, EXCAVATE_CELL_CAP, FACE_TRY_ORDER, FACE_ZH, LIQUIDS, NEIGHBORS6,
  NO_PLACE_REFERENCE, PLACE_REACH, PROBE_CELLWISE_MAX, PROBE_CELL_CAP, PROBE_WHERE_CELL_CAP,
  SHAPE_ZH, blockAtCell, blockNamesOf, cellKeyOf, cellText, chebyshev, cropAgeOfCell, faceText,
  feetOf, fnv32, nearLavaAt, readRegion, resolveAt, shapeCells, skyVisibleAt,
  solidAt, type RegionReading,
} from './cell-facts.ts';
import {
  CRAFT_SETTLE_MS, INVENTORY_SLOTS, PICKUP_SETTLE_MS, askedLabel, awaitCraftGain, awaitInvConfirm,
  dropNamesOf, invCount, invCountById, invCountIn, invGains, invGainsSplit, invItemNamed,
  invLosses, invSnapshot, itemAsked, itemPredOf, lootNote, moveExactSlot, namedLike, noSuchItem,
  playerInvIn, probabilisticDropsOf, type InvItem, type InvPred,
} from './inventory.ts';
import {
  chooseTool, equipToolFor, harvestFact, minHarvestTool, miningToolPlan, nearBreak, reserveNote,
  toolTraceNote,
} from './tools.ts';
import {
  BAG_LOW_FREE, SIGN_RE, bagNow, blockedOnItems, blockedSourceOf, blockedText, describeSkill,
  gridText, signLinesText, type BlueprintCall, type ExpectVerdict, type PlaceCall, verdictNote,
  zhErrorText, zhThing,
} from './receipt.ts';
import { HANDHELD_SUFFIXES, equipDestOf } from './tools.ts';
import { dimensionOf } from './cell-facts.ts';
import { fmtDur } from './receipt.ts';
import {
  FLEE_DEADLINE_MS, clearEscapeGoalOwner, digBackoffScene, digBlock, dropGoal, escapeIntent,
  findEntity, fmtDist, gotoGoal, holdTreadWater, onEscapeGoal, goalOwnerKind, levelTravelGoal, nextLongTravelLeg, matchBlockIds, readStamp, releaseBody,
  renderRouteMenu, routeNote, setOwnedGoal, travelGoalReached, type DistanceMetric, walkOnlyPath, withRouteScene,
} from './travel.ts';
import {
  HOSTILE, MELEE_CHASE, MELEE_REACH,
  STRAFE_MS, aimAt,
  attackCooldownMs, attackStats, bestWeapon, forcedRangedIssue, hostilesAround, meleeSwing,
  nearestHostileTo, pressMelee, pressRanged, rangedBlockedText,
  rangedTargetOf, releaseMelee, type HostileRead, underwaterOxygenNote,
} from './melee.ts';
import {
  LEDGER_GUARD_BLOCKS, SEED_CROP, forgetPlaced, lastAteOf, ledgerBlockFact, noteAte, noteTilled,
  noteWork, placeMarksOf, placedLedgerOf, placedNote,
} from './placed-ledger.ts';
import {
  CRAFTING_STATION, FURNACE_STATION, Upkeep, buildSpots, ensureHolding, ensureStation, footprintOf,
  footprintScene, gotoPlaceable, hitboxBlocks, inBox, jumpPlaceBelow, matchPlacedMaterialName,
  materialCollides, nearestBoat, occupantOf, occupantText, occupiedByMe, permitPlacement,
  permittedStockFor, placeIntoCell, placeReferenceFace, pushPocketLine, scaffoldNames,
  siteAtCellAnywhere, siteBox, standableCell, stationNotes, stepOffCell, sweepDrops,
  type BuildSpot, type Station, type StationAt,
} from './placement.ts';
import { contentsText } from './receipt.ts';
import { itemCustomName } from './item-display.ts';
import { consumesOpenWindow, selectionMenuTitle, storageWindow } from './window-semantics.ts';
import {
  UNTIL_DIG_RADIUS, UNTIL_TRAVEL_RADIUS, type UntilHit, untilBlockIds, untilHit, untilUnknownNote,
} from './until.ts';
import { blockProp } from './cell-facts.ts';
import { compositionText, noDropMaterials } from './receipt.ts';
import { settleOnGround } from './travel.ts';
import {
  collectVisible, skillCollect, skillFind, skillFish, skillProbe, skillTrade,
} from './skills-gather.ts';
import { spatialObservationText } from './spatial-observation.ts';
import { CONTAINER_FIND, FURNACE_KINDS } from './chests.ts';
import { skillExcavate, skillTunnel } from './skills-dig.ts';
import { reachCell } from './travel.ts';
import {
  ANVIL_BLOCKS, STATION_FIND_R, WINDOW_SETTLE_MS, containerStacks, findContainers, findStationCell,
  furnaceDoneAt, knownChestNote, noContainerNearby, openNearbyContainer, openStationWindow,
  openWindowGuarded, orderForStow, orderForTake, putIntoStation, rememberChest, rememberWindow,
  recentStorageRouteFailure, storageSkipReason,
  slotStack, smeltPerItemMs, stationItemFacts, type GenericWindow,
} from './containers.ts';
import {
  consumeHeldFood, craftItemDef, craftNeeds, equipNamed, skillCraft, skillEat, skillEquip, smithingInputs,
  type CraftRecipeLike,
} from './skills-craft.ts';
import { isKnownTarget, unknownUseTargetText } from './entity-facts.ts';
import { skillAttack } from './melee.ts';
import {
  LEAD_ITEM, USE_SETTLE_MS, aimThenUse, isBoat, skillAnvil, skillGrindstone, skillLead, skillRide, skillUse,
} from './skills-interact.ts';
import {
  LAPIS, protectedTossItem, reacquiredTossNote, skillBrew, skillCompact, skillEnchant, skillPickup, skillSmelt, skillStow, skillTake, skillToss,
  skillTransit,
} from './skills-container.ts';
import {
  hasDryFooting, skillBuild, skillBuildBlueprint, skillSurfaceLand, stableDryFooting,
  surfaceStateText, withBlueprintGain,
} from './skills-build.ts';
/**
 * 评估一步的 expect:读包、位置或方块,报达成与实测值。
 * 锚点以评估时刻脚下为原点解析;解析不出的锚点按落空处理,实测值写解析错误。
 * 物品/方块名与技能同一口径(类别名 log/planks/ore 也认)。
 */
function evaluateExpect(bot: Bot, e: Expectation, gainBase?: number): ExpectVerdict {
  if ('has' in e) {
    const n = invCountIn(playerInvIn(bot, bot.currentWindow), (name) => matchItemName(e.has.item, name, bot?.registry));
    if (gainBase !== undefined) {
      const got = n - gainBase;
      return {
        met: got >= e.has.count,
        actual: `这一步进包${zhName(e.has.item)}×${got}(包里现在 ${n} 个)`,
        measured: String(got),
        gain: true,
      };
    }
    return { met: n >= e.has.count, actual: `包里${zhName(e.has.item)}×${n}`, measured: String(n) };
  }
  if ('holding' in e) {
    const held = bot.heldItem?.name ?? null;
    return {
      met: held !== null && matchItemName(e.holding.item, held, bot?.registry),
      actual: held ? `手上是${zhName(held)}` : '手上是空的',
      measured: held ? zhName(held) : '空手',
    };
  }
  const resolved = resolveAnchors(['near' in e ? e.near : e.at], feetOf(bot));
  if (!Array.isArray(resolved)) return { met: false, actual: resolved.error, measured: resolved.error };
  const cell = resolved[0];
  if ('near' in e) {
    const feet = feetOf(bot);
    const dist = Math.hypot(feet.x - cell.x, feet.y - cell.y, feet.z - cell.z);
    // 锚点与脚下同高时报告水平距离，否则报告三维直线距离；单位为格。
    const metric: DistanceMetric = feet.y === cell.y ? '水平' : '直线';
    const shown = `${metric} ${fmtDist(Math.round(dist * 10) / 10)} 格`;
    return {
      met: dist <= (e.within ?? NEAR_DEFAULT),
      actual: `我在 ${cellText(feet)},离 ${cellText(cell)} 还有 ${shown}`,
      measured: shown,
    };
  }
  const block = blockAtCell(bot, cell);
  if (!block) return { met: false, actual: `${cellText(cell)} 那里区块没加载`, measured: '区块未加载' };
  return {
    met: matchPlacedMaterialName(bot, e.block, block.name),
    actual: `${cellText(cell)} 那一格是${zhName(block.name)}`,
    measured: zhName(block.name),
  };
}

/**
 * 技能的产出与入料:一张表,两个消费者 —— 裁决按产出推后置状态(deriveExpect),
 * 依赖闸按「后一步的入料 ∩ 前一步的产出」判因果。两半各自单独查得到。
 *
 * 名字一律是**物品 id 口径**:collect 给的是掉落物名(挖 stone 进包的是 cobblestone,
 * 按方块名去数永远数出 0)。只有服务端才知道的一律给空表 —— smelt 的产物名要等
 * 输出槽第一次出东西、craft 摆格子的产出槽出什么算什么、fish 钓上来什么不定。
 * `bot` 为 null 时只回调用里写得出的那些(掉落表与配方表都在 registry 上)。
 */
export function skillProduces(call: SkillCall, bot: Bot | null): string[] {
  switch (call.skill) {
    case 'collect': {
      const item = bot ? collectDropName(bot, call.block) : call.block;
      return item ? [item] : [];
    }
    case 'craft': return !call.grid && call.item ? [call.item] : [];
    // at 形态是掏空那一格容器,取出来什么开窗才知道
    case 'take': return call.item ? [call.item] : [];
    case 'pickup': return call.item ? [call.item] : [];
    default: return [];
  }
}

/** 同上的另一半:这一步要消耗的东西。craft 的直接材料在配方表里,没有 bot 就报不出 */
export function skillNeeds(call: SkillCall, bot: Bot | null): string[] {
  switch (call.skill) {
    // 蓝图形态要哪些料由图说了算(一整张图十几样),不进因果闸这张窄表
    case 'build': return 'material' in call ? [call.material] : [];
    case 'craft': {
      if (call.grid) return [...new Set(call.grid.flat().filter((n) => n !== ''))];
      return bot && call.item ? craftInputNames(bot, call.item) : [];
    }
    case 'smelt': return [call.input, call.fuel];
    case 'brew': return [call.input, call.bottle, call.fuel];
    case 'enchant': return [call.item, LAPIS];
    case 'anvil': return call.with ? [call.item, call.with] : [call.item];
    case 'grindstone': return call.with ? [call.item, call.with] : [call.item];
    // 驾猪要手持胡萝卜钓竿(不消耗,但没有它这一步走不了)
    case 'ride': return call.to && call.target === 'pig' ? ['carrot_on_a_stick'] : [];
    // 拴上那一下要包里有绳(会被消耗成拴在它身上的那根);松开／牵着走都不再要
    case 'lead': return call.target ? [LEAD_ITEM] : [];
    case 'use': return call.item ? [call.item] : [];
    case 'equip': return call.item ? [call.item] : [];
    case 'eat': return [call.item];
    case 'toss': case 'stow': return [call.item];
    default: return [];
  }
}

/**
 * collect 一块 `block` 可能进包的所有掉落名;只给因果闸用。裁决用的 collectDropName
 * 在多样掉落时报 null(数不准就不数),而「后一步要不要用这一步的产出」只问有没有:
 * 小麦掉小麦+种子,搓面包用的正是那份小麦。
 */
function collectDropNamesAll(bot: Bot, block: string): string[] {
  const byName = bot.registry.blocksByName as unknown as
    Record<string, { name?: string; drops?: unknown[] } | undefined> | undefined;
  if (!byName) return [];
  const items = bot.registry.items as unknown as Record<number, { name: string } | undefined>;
  const dropsOf = (def: { drops?: unknown[] } | undefined): string[] => (def?.drops ?? [])
    .map((d) => (typeof d === 'number' ? d : (d as { drop?: number } | null)?.drop))
    .map((id) => (id === undefined ? null : items[id]?.name ?? null))
    .filter((n): n is string => n !== null);
  const def = byName[block];
  if (def) return [...new Set(dropsOf(def))];
  const names = new Set<string>();
  for (const d of Object.values(byName)) {
    if (d?.name && matchItemName(block, d.name, bot?.registry)) for (const n of dropsOf(d)) names.add(n);
  }
  return [...names];
}

/**
 * 未声明 needs 时，依赖本步消耗与更早步骤产出有交集的那些步骤。
 * 物品名经 matchItemName 双向匹配，兼容类别名与具体名称。
 */
export function causalNeeds(
  steps: readonly SkillCall[],
  index: number,
  bot: Bot | null,
): Array<{ step: number; items: string[] }> {
  const needs = skillNeeds(steps[index], bot);
  if (needs.length === 0) return [];
  const out: Array<{ step: number; items: string[] }> = [];
  for (let j = 0; j < index; j++) {
    const prev = steps[j];
    const produces = prev.skill === 'collect' && bot ? collectDropNamesAll(bot, prev.block) : skillProduces(prev, bot);
    const meet = [...new Set(needs.filter((n) =>
      produces.some((p) => matchItemName(n, p, bot?.registry) || matchItemName(p, n, bot?.registry))))];
    if (meet.length > 0) out.push({ step: j + 1, items: meet });
  }
  return out;
}

/**
 * collect 一块 `block` 进包的是什么。照 minecraft-data 自己的掉落表正向查,
 * 不写死 cobblestone→stone 这类映射。掉落表为空(草掉种子这类概率掉落)或不止一样时
 * 返回 null —— 数不准就不数。
 *
 * 类别名(log/ore/wool)不在方块表里,**只有整类都掉自己时**才按类别名数:`log` 掉的是
 * `oak_log`(matchItemName 认得出),而 `ore` 掉的是煤与原矿、`leaves` 干脆什么都不掉,
 * 拿类别名去数它们永远数出 0。
 */
function collectDropName(bot: Bot, block: string): string | null {
  // 推导不许抛:裁决点有一处在 catch 分支里,从那儿抛出去就是整条任务再不回执
  const byName = bot.registry.blocksByName as unknown as
    Record<string, { name?: string; drops?: unknown[] } | undefined> | undefined;
  if (!byName) return null;
  const soleDrop = (def: { drops?: unknown[] } | undefined): string | null => {
    const drops = def?.drops ?? [];
    if (drops.length !== 1) return null;
    const d = drops[0];
    const id = typeof d === 'number' ? d : (d as { drop?: number } | null)?.drop;
    if (id === undefined) return null;
    return (bot.registry.items as unknown as Record<number, { name: string } | undefined>)[id]?.name ?? null;
  };
  const def = byName[block];
  if (def) return soleDrop(def);
  const members = Object.values(byName)
    .filter((d): d is { name: string; drops?: unknown[] } => !!d?.name && matchItemName(block, d.name, bot?.registry));
  if (members.length === 0) return null;
  return members.every((m) => {
    const name = soleDrop(m);
    return name !== null && matchItemName(block, name, bot?.registry);
  }) ? block : null;
}

/** craft 的直接材料:同一样东西的几种摆法各要什么,取并集(哪一条走得通由技能自己挑) */
function craftInputNames(bot: Bot, item: string): string[] {
  const def = craftItemDef(bot, item);
  if (!def) return [];
  const smithing = smithingInputs(def.name);
  if (smithing) return smithing;
  const items = bot.registry.items as unknown as Record<number, { name: string } | undefined>;
  const all = bot.recipesAll(def.id, null, true as never) as unknown as CraftRecipeLike[];
  const names = new Set<string>();
  for (const r of all) for (const [id] of craftNeeds(r)) {
    const n = items[id]?.name;
    if (n) names.add(n);
  }
  return [...names];
}

/**
 * 未声明 expect 时按技能推导后置状态；推不准返回 null，交给技能裁决。
 * 相对锚点不推导，因开工与核验时的位置可能不同。
 * 当前期望形态无法表达的状态不推导；equip 的 holding 只覆盖手持，不覆盖盔甲和盾。
 */
export function deriveExpect(bot: Bot, call: SkillCall): Expectation | null {
  if ('dryRun' in call && call.dryRun) return null; // 试算不动世界,没有后置状态
  switch (call.skill) {
    // goto 已按寻路目标核验到达，不另推位置判据。
    case 'goto': return null;
    case 'tunnel': {
      // 声明了 until:终点不再是判据 —— 碰到名单里的东西提前收束是这一单的正常结局,
      // 拿「人到终点」去核验会把她要的那个结果判成落空
      if (call.until && call.until.length > 0) return null;
      if (!absAnchor(call.at)) return null;
      // 终点为当前脚下格时，near 恒真，不能用于核验是否挖通；冻结后的相对锚点也适用。
      const c = anchorCell(call.at);
      const p = bot.entity?.position;
      if (p && Math.floor(p.x) === c.x && Math.floor(p.y) === c.y && Math.floor(p.z) === c.z) return null;
      return { near: call.at };
    }
    // collect.count 计方块，掉落数量、名称及归属均可能不同，因此不推导物品存量期望。
    // 技能按块数与入包数回报；craft.count 计产出物品，可在下方推导。
    case 'collect': return null;
    case 'craft': {
      const item = skillProduces(call, bot)[0];
      return item ? { has: { item, count: call.count } } : null;
    }
    case 'build': {
      const cell = soleBuildCell(call);
      if (!cell || !('material' in call)) return null;
      // 落地的方块名不一定等于材料名(火把贴墙成 wall_torch),matchItemName 收得住;
      // 但材料本身得是个方块 —— 种子放下去长出来的是 wheat,按 wheat_seeds 比对必然落空
      if (!(bot.registry.blocksByName as unknown as Record<string, unknown> | undefined)?.[call.material]) return null;
      return { block: call.material, at: [cell.x, cell.y, cell.z] };
    }
    case 'excavate': {
      // 锚点全同才推:那时候不论什么形状都只有这一格,不必栅格化(受阻分支上还要再算一遍,
      // 一个大 box 在这儿铺开就是白烧)。多格的挖不完是正常结局,技能自己按块数报
      const cell = soleAnchorCell(call.anchors);
      return cell ? { block: 'air', at: [cell.x, cell.y, cell.z] } : null;
    }
    // use 的判据是 (item, 目标方块) → 后置读数那张表,住在 use 自己那儿
    case 'use': return null;
    case 'equip': {
      // 腾手(不写 item)不推:副手与装备槽不动的语义由技能自己说
      if (!call.item) return null;
      const found = invItemNamed(bot, call.item);
      // 落在装备槽的(盔甲/鞘翅/盾)不在手上,holding 判不了;包里没有的也不推,
      // 让「包里没有X」自己说话
      const dest = call.hand === 'off' ? 'off-hand' : call.hand === 'main' ? 'hand' : equipDestOf(found?.name ?? '', bot.registry);
      if (!found || dest !== 'hand') return null;
      return { holding: { item: found.name } };
    }
    default: return null;
  }
}

/** 这一步点名的那一格(三个数的 at / 第一个锚点);交给踩水判断,见 holdTreadWater */
function stepTargetCell(bot: Bot, call: SkillCall): Cell | null {
  const c = call as { at?: unknown; anchors?: unknown[] };
  const anchor = [c.at, c.anchors?.[0]].find((a) => Array.isArray(a) && a.length === 3) as Anchor | undefined;
  if (!anchor) return null;
  try {
    return resolveAt(bot, anchor);
  } catch {
    return null; // 锚点解不开由技能自己受阻说清,这里只是不登记
  }
}

/** 采集开工前的库存基线，用于核验本步增量；显式 expect 按其声明语义处理。 */
function collectGainBase(bot: Bot, call: SkillCall): number | null {
  if (call.skill !== 'collect' || call.expect !== undefined) return null;
  const e = deriveExpect(bot, call);
  return e && 'has' in e ? invCount(bot, (name) => matchItemName(e.has.item, name, bot?.registry)) : null;
}

/**
 * 推导的 near/block 状态可将技能受阻改判为完成；has 存量不能证明本步增量。
 * 显式声明的 expect 按调用方判据裁决。
 */
function mayOverturnBlocked(e: Expectation): boolean {
  return !('has' in e);
}

/** 三个分量都是数字 = 绝对坐标,两次解析指的是同一格 */
function absAnchor(a: Anchor): boolean {
  return a.every((c) => typeof c === 'number');
}

function anchorCell(a: Anchor): Cell {
  return { x: a[0] as number, y: a[1] as number, z: a[2] as number };
}

/** 只有一处、且是绝对坐标时的那一格;否则 null */
function soleAnchorCell(anchors: readonly Anchor[]): Cell | null {
  if (anchors.length === 0 || !anchors.every(absAnchor)) return null;
  const first = anchorCell(anchors[0]);
  return anchors.every((a) => {
    const c = anchorCell(a);
    return c.x === first.x && c.y === first.y && c.z === first.z;
  }) ? first : null;
}

/**
 * build 这一单只落一格时,落在哪。贴面形态的落点是「参照方块 + 面向量」,
 * 格子形态的落点就是锚点本身;形状形态与多格形态都不推 —— 搭了多少报多少是
 * 它的正常结局(README「一块都没放上才是受阻」)。
 */
function soleBuildCell(call: Extract<SkillCall, { skill: 'build' }>): Cell | null {
  // 蓝图形态一单就是几十上百步,「只落一格」这个前提根本不成立
  if ('blueprint' in call) return null;
  if ('on' in call) {
    if (call.on.length !== 1 || !absAnchor(call.on[0].at)) return null;
    return cellOnFace(anchorCell(call.on[0].at), call.on[0].face);
  }
  if (call.shape) return null;
  return soleAnchorCell(call.anchors);
}

/** 运行中步骤的周期进度间隔;每份带位置与净位移,agent 据此自行判断有没有卡住 */
const PROGRESS_EVERY_MS = 30_000;

/** 「同一件事上次什么下场」的有效期:再往前的账她多半已经换了打法 */
const PRIOR_OUTCOME_WINDOW_MS = 15 * 60_000;
const MAX_REPEAT_SUCCESS_WINDOW_MS = 60 * 60_000;
const EXACT_FAILURE_WINDOW_MS = 10 * 60_000;
const EXACT_FAILURE_RETRY_DISTANCE = 4;
const NAVIGATION_BURST_WINDOW_MS = 120_000;
const NAVIGATION_BURST_COOLDOWN_MS = 45_000;
const NAVIGATION_BURST_RESET_DISTANCE = 12;
const EMPTY_FIND_WINDOW_MS = 180_000;
const EMPTY_FIND_HOLD_MS = 5 * 60_000;
const EMPTY_FIND_REGION_DISTANCE = 32;
const DIRECTIONAL_SWEEP_HOLD_MS = 24 * 60 * 60_000;
const DIRECTIONAL_SWEEP_REPEAT_MS = 2 * 60_000;
const DIRECTIONAL_SWEEP_EVIDENCE_RADIUS = 64;
const IMMATURE_FIND_HOLD_MS = 120_000;
const LOCAL_FARM_FAILURE_WINDOW_MS = 90_000;
const LOCAL_FARM_FAILURE_DISTANCE = 8;
const NEARBY_GOAL_DISTANCE = 4;
const PROVEN_TARGET_DISTANCE = 1.5;
const GOAL_PROGRESS_SAMPLE_MS = 2_000;
const STALLED_CANCEL_MS = 15_000;
const retryGuardApplies = (steps: readonly SkillCall[]): boolean => steps.some((step) =>
  step.skill === 'goto' || step.skill === 'tunnel' || step.skill === 'stow'
  || step.skill === 'craft'
  || (step.skill === 'take' && (step.from === 'open' || Boolean(step.at))));
function lastAbsoluteGoto(steps: readonly SkillCall[]): { x: number; y: number; z: number } | null {
  const step = [...steps].reverse().find((item) => item.skill === 'goto' && !item.dryRun);
  if (!step || step.skill !== 'goto' || !Array.isArray(step.at)
    || step.at.length !== 3 || !step.at.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  return { x: step.at[0] as number, y: step.at[1] as number, z: step.at[2] as number };
}

function firstAbsoluteGoto(steps: readonly SkillCall[]): { x: number; y: number; z: number } | null {
  const step = steps[0];
  if (step?.skill !== 'goto') return null;
  return step ? lastAbsoluteGoto([step]) : null;
}

/** 已开的门不会改变通路；跳过这类前置 use，仍需核对后面的同一路线。 */
function firstRouteAfterOpenDoors(steps: readonly SkillCall[], bot: Bot): { x: number; y: number; z: number } | null {
  let skippedOpenDoor = false;
  for (const step of steps) {
    if (step.skill === 'goto') return skippedOpenDoor ? lastAbsoluteGoto([step]) : null;
    if (step.skill !== 'use' || !step.at || step.item || step.target) return null;
    const cell = targetCellOf(bot, step);
    const block = cell ? blockAtCell(bot, cell) : null;
    if (!block || (!block.name.endsWith('_door') && !block.name.endsWith('_fence_gate'))
      || blockProp(block, 'open') !== 'true') return null;
    skippedOpenDoor = true;
  }
  return null;
}

/** 受阻头名的统计窗口与起报门槛(见 Executor.blockedHeadline) */
const BLOCKED_HEADLINE_WINDOW_MS = 60 * 60_000;
const BLOCKED_HEADLINE_MIN = 5;

/** flee 的自身时限那一路。定时器 unref,不拖住进程退出 */
function fleeDeadline(startedAt: number): Promise<'timeout'> {
  return new Promise<'timeout'>((resolve) => {
    const left = Math.max(0, FLEE_DEADLINE_MS - (Date.now() - startedAt));
    const timer = setTimeout(() => resolve('timeout'), left);
    timer.unref?.();
  });
}

/**
 * flee 超时那一条受阻文案。全是读数:逃了多久、离出发点多远(离要求的还差多少)、
 * 当初那只现在多远、身边此刻还剩几只。
 *
 * 不写"逃不掉""换个法子"这类结论 —— 换不换招是她的决定(IO 回报三原则)。
 */
function fleeTimeoutText(
  bot: Bot,
  want: number,
  started: HostileRead,
  from: { x: number; y: number; z: number },
  startedAt: number,
): string {
  const at = bot.entity.position;
  const moved = Math.hypot(at.x - from.x, at.z - from.z);
  const secs = Math.round((Date.now() - startedAt) / 1000);
  const chaser = started.e.isValid === false || !started.e.position
    ? `当初那只${zhEntity(started.e.name ?? '它')}已经不在实体表里`
    : `当初那只${zhEntity(started.e.name ?? '它')}起手 ${Math.round(started.d)} 格、现在 `
      + `${Math.round(started.e.position.distanceTo(at))} 格`;
  const foes = hostilesAround(bot, at);
  const around = foes.length === 0
    ? '此刻 32 格内没有敌对生物了'
    : `此刻 32 格内还有 ${foes.length} 只:`
      + foes.slice(0, 3).map((f) => `${zhEntity(f.e.name ?? '它')} ${Math.round(f.d)} 格`).join('、')
      + (foes.length > 3 ? '……' : '');
  return `没拉开:逃了 ${secs} 秒,离出发那儿 ${Math.round(moved)} 格(这一单要的是 ${want} 格),`
    + `人在 ${cellText(feetOf(bot))};${chaser};${around}`;
}

export function sendChat(bot: Bot, text: string): void {
  const error = chatInputError(text);
  if (error) throw new SkillBlocked(error);
  bot.chat(text);
}

function gotoArrivalGoal(call: Extract<SkillCall, { skill: 'goto' }>, target: Cell): InstanceType<typeof goals.Goal> {
  return call.groundY
    ? levelTravelGoal(target.x, target.z)
    : call.exact ? new goals.GoalBlock(target.x, target.y, target.z)
      : new goals.GoalNear(target.x, target.y, target.z, 1);
}

async function runSkill(bot: Bot, call: SkillCall, ctx: SkillContext): Promise<string> {
  // An unresolved click is a protocol transaction barrier, independent of item
  // dependencies. Observing, walking and speaking remain available; the lower
  // click guard also covers inventory changes initiated by background actions.
  let inventoryMutation = false;
  switch (call.skill) {
    case 'craft': case 'take': case 'stow': case 'compact': case 'toss':
    case 'equip': case 'eat': case 'smelt': case 'brew': case 'enchant':
    case 'anvil': case 'grindstone':
      inventoryMutation = true;
      break;
    case 'use':
      inventoryMutation = call.index !== undefined || call.item !== undefined;
      break;
  }
  if (inventoryMutation) {
    try { assertInventoryClicksReady(bot); }
    catch (err) {
      if (!isInventoryClickError(err)) throw err;
      throw new SkillBlocked((err as Error).message, [], 'server', 'inventory-click-sync');
    }
  }
  switch (call.skill) {
    case 'goto': {
      if (call.dimension
        && normalizeDimension(dimensionOf(bot)) !== normalizeDimension(call.dimension)) {
        throw new SkillBlocked(
          `这处坐标属于${zhDimension(call.dimension)},我当前在${zhDimension(dimensionOf(bot))};`
          + '先用 transit 穿门,不能把两边坐标直接拿来算路',
        );
      }
      const resolved = resolveAt(bot, call.at);
      // Horizontal goals have no destination height. The current feet Y is only
      // a diagnostic reference; unloaded destination columns do not prevent travel.
      const target = call.groundY ? { ...resolved, y: feetOf(bot).y } : resolved;
      const finalGoal = gotoArrivalGoal(call, target);
      const travelContext: SkillContext = call.walkOnly && ctx.probeRoutes ? {
        ...ctx, probeRoutes: (at, goal) => ctx.probeRoutes!(at, goal)?.filter((route) => route.profile === 'walk') ?? null,
      } : ctx;
      if (call.dryRun) {
        const probes = travelContext.probeRoutes?.(target, call.groundY || call.exact ? finalGoal : undefined);
        if (!probes || probes.length === 0) throw new SkillBlocked('探路器不可用(没连上服务器)');
        const me = bot.entity.position;
        const startDist = call.groundY
          ? Math.hypot(me.x - target.x, me.z - target.z)
          : Math.hypot(me.x - target.x, me.y - target.y, me.z - target.z);
        return renderRouteMenu(probes, target, {
          startDist, diag: call.groundY ? null : ctx.probeTarget?.(target) ?? null,
        });
      }
      const note = routeNote(bot, travelContext, target, call.groundY || call.exact ? finalGoal : undefined);
      const startedAt = Date.now();
      let sceneTarget = target;
      const releaseWalkOnly = call.walkOnly ? walkOnlyPath(bot) : undefined;
      try {
        let legs = 0;
        for (;;) {
          const from = { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z };
          const leg = nextLongTravelLeg(from, target);
          if (!leg) break;
          if (++legs > 64) throw new SkillBlocked('长途分段超过 64 段仍未到目标附近，停止这条路线');
          sceneTarget = { x: leg.x, y: Math.floor(from.y), z: leg.z };
          await gotoGoal(bot, levelTravelGoal(leg.x, leg.z), travelContext);
          const moved = Math.hypot(bot.entity.position.x - from.x, bot.entity.position.z - from.z);
          if (moved < 4) throw new SkillBlocked('长途这一段没有足够位移，停止原路线');
        }
        sceneTarget = target;
        await gotoGoal(bot, finalGoal, travelContext);
      } catch (err) {
        // 长途失败只试算当前短段，避免再次用远处终点耗尽寻路预算。
        throw withRouteScene(
          bot, travelContext, err, sceneTarget,
          [...digBackoffScene(ctx, startedAt), ...(note ? [note] : []),
            ...(sceneTarget !== target ? [
              `长途最终目标 ${cellText(target)}，这一段先去 ${cellText(sceneTarget)}`,
              "本次受阻发生在途中，尚未核实最终目标的落脚条件",
            ] : [])],
          sceneTarget !== target ? levelTravelGoal(sceneTarget.x, sceneTarget.z)
            : call.groundY || call.exact ? finalGoal : undefined,
        );
      } finally {
        releaseWalkOnly?.();
      }
      const water = headInWater(bot) || bodyInWater(bot);
      const arrival = call.groundY ? ';本次只满足水平接近条件，高度未作为到达条件'
        : call.exact ? ';已满足精确落脚格到达条件' : '';
      const footing = water ? ';仍在水中，未确认登岸' : '';
      return `到了 ${cellText(feetOf(bot))}${arrival}${footing}${call.walkOnly ? ';沿现有通路到达，未挖掘或垫脚' : ''}${note ? `。\n${note}` : ''}`;
    }
    case 'transit': return skillTransit(bot, call, ctx);
    case 'find': return skillFind(bot, call.target, call.direction, call.distance, ctx, call.until);
    case 'goto_player': {
      if (!isKnownTarget(bot, call.name)) throw new SkillBlocked(`${call.name} 不在线`);
      const e = findEntity(bot, call.name, 128);
      if (!e) throw new SkillBlocked(`${call.name} 在线但不在附近 128 格内`);
      await gotoGoal(bot, new goals.GoalFollow(e, 2), ctx);
      return `到 ${call.name} 身边了`;
    }
    case 'follow': {
      if (!isKnownTarget(bot, call.name)) throw new SkillBlocked(`${call.name} 不在线`);
      const e = findEntity(bot, call.name, 128);
      if (!e) throw new SkillBlocked(`${call.name} 在线但不在附近 128 格内`);
      setOwnedGoal(bot, new goals.GoalFollow(e, 3), 'task', `跟着 ${call.name}`, { dynamic: true, diag: ctx.diag });
      // 持续任务:挂着直到被顶替/叫停
      while (!ctx.aborted() && e.isValid) await sleep(500);
      dropGoal(bot, 'task', '跟随结束', ctx.diag);
      if (!e.isValid) return `${call.name} 不见了,停止跟随`;
      throw new Aborted(ctx.abortedBy?.() ?? null);
    }
    case 'flee': {
      const me = bot.entity.position;
      const nearest = nearestHostileTo(bot, me);
      if (!nearest) throw new SkillNoop('附近 32 格内没有敌对生物,不用逃');
      ctx.escape.active = true;
      const from = { x: me.x, y: me.y, z: me.z };
      const startedAt = Date.now();
      const away = me.minus(nearest.e.position);
      const flat = Math.hypot(away.x, away.z) || 1;
      const x = Math.round(me.x + (away.x / flat) * call.distance);
      const z = Math.round(me.z + (away.z / flat) * call.distance);
      const fleeGoal = levelTravelGoal(x, z);
      // 脱险只沿现有通路移动。边跑边挖/搭会在保护区反复预检，
      // 还会让寻路器停在原地换工具，正好耽误逃命。
      const releaseWalkOnly = walkOnlyPath(bot);
      try {
        // 这一步自己的时限(见 FLEE_DEADLINE_MS):到点撤目标、按事实收工,
        // 不熬满 gotoGoal 借来的两分钟。迟到的 gotoGoal 拒绝单独接住,
        // 不让它在超时胜出之后变成未捕获拒绝。
        const travel = gotoGoal(bot, fleeGoal, ctx).then(() => 'arrived' as const);
        travel.catch(() => undefined);
        const outcome = await Promise.race([travel, fleeDeadline(startedAt)]);
        if (outcome === 'timeout') {
          dropGoal(bot, 'task', 'flee 到了自身时限', ctx.diag);
          throw new SkillBlocked(fleeTimeoutText(bot, call.distance, nearest, from, startedAt));
        }
      } catch (err) {
        // 试算与行军判同一个目标(见 levelTravelGoal):逃跑受阻的现场要说得出
        // 这条路到底能推进到哪儿
        throw withRouteScene(bot, ctx, err, { x, y: feetOf(bot).y, z }, [], fleeGoal);
      } finally {
        releaseWalkOnly();
      }
      const at = bot.entity.position;
      return `甩开了${zhEntity(nearest.e.name ?? '它')},现在在 (${Math.round(at.x)}, ${Math.round(at.y)}, ${Math.round(at.z)})`;
    }
    case 'surface': {
      // 下界 y=127 是基岩顶,「露天」这件事不存在;不拦她耗满 8 秒跳键才发现
      if (dimensionOf(bot).includes('nether')) {
        throw new SkillBlocked('下界没有露天,这个技能在这儿用不了(顶上到 y=127 全是基岩)');
      }
      if (!headInWater(bot) && !bodyInWater(bot)) return skillSurfaceLand(bot, ctx);
      ctx.escape.active = true;
      // 换气与寻找落脚点分别裁决；循环重申 jump，避免被顶替任务迟到的 finally 清掉。
      const breathe = Date.now() + 8_000;
      while (headInWater(bot) && Date.now() < breathe && !ctx.aborted()) {
        bot.setControlState('jump', true);
        await sleep(200);
      }
      checkAbort(ctx);
      // 只有实际出水才能报告浮上水面；超时时保留 jump，交给随后的登岸寻路。
      const surfaced = !headInWater(bot);
      if (surfaced) bot.setControlState('jump', false);
      const head = surfaced
        ? '我浮上了水面'
        : `按着上浮 8 秒还没出水,人在 ${cellText(feetOf(bot))}(氧气 ${bot.oxygenLevel ?? 20}/20)`;
      // 跳键不许漏出这个技能:它会污染后续所有任务。松开推迟到登岸这一程走完为止,
      // 超时那条出口正靠它继续上浮。
      try {
        const land = findNearbyAirColumn(bot, 32, landSearchUp(bot));
        if (!land) {
          throw new SkillBlocked(`${head},但 32 格内没找到可站立的岸;只换到气,还没有脱离液体`);
        }
        try {
          await gotoGoal(bot, new goals.GoalBlock(land.x, land.y, land.z), ctx);
        } catch (err) {
          if (err instanceof Aborted) throw err;
          throw new SkillBlocked(`${head},但游不到看见的那处岸(${(err as Error).message});还没有脱离液体`);
        }
        // 到岸就松跳键:按着它人一着地下一 tick 又起跳,落脚永远读不到
        bot.setControlState('jump', false);
        if (!(await stableDryFooting(bot, ctx))) {
          throw new SkillBlocked(
            `${head};我游到了岸边但没有稳定站上干燥落脚格,还没有脱离液体;${surfaceStateText(bot)}`,
          );
        }
        const feet = feetOf(bot);
        const skyVisible = skyVisibleAt(bot, feet.x, feet.y + 2, feet.z);
        const state = surfaceStateText(bot);
        if (skyVisible === null) return `我脱离液体并站稳了,头顶柱未加载完,天空读数未知;${state}`;
        return skyVisible
          ? `我脱离液体并站稳了,这里能看见天空;${state}`
          : `我脱离液体并站稳了,这里仍有遮盖,没有回到露天;${state}`;
      } finally {
        bot.setControlState('jump', false);
      }
    }
    case 'look': return skillLook(bot, call, ctx);
    case 'control': {
      dropGoal(bot, 'task', '短时直接控制', ctx.diag);
      return skillControl(bot, call, ctx);
    }
    case 'flight': {
      const at = resolveAt(bot, call.at);
      if (call.dryRun) return `飞行试算（未移动、未施法；仅核对当前已加载地形，执行时重验；timing.source为nominal时未校准运行调度，为runtime时使用近期实际控制周期；标称速度不保证耗时，排队、模型和截图等待另计；allowed只表示采样时是否已有飞行许可，false不表示几何试算失败，remainingMs/timeEnough为null表示未知）：${JSON.stringify(previewFlight(
        bot, { x: at.x + 0.5, y: at.y, z: at.z + 0.5 }, { land: call.land !== false },
      ))}`;
      return call.land === false
        ? flyToPosition(bot, { x: at.x + 0.5, y: at.y, z: at.z + 0.5 }, () => ctx.aborted())
        : flyToLanding(bot, at, () => ctx.aborted());
    }
    case 'land': return landFlight(bot, () => ctx.aborted());
    case 'collect':
      return withBlueprintGain(bot, ctx, () =>
        skillCollect(bot, call.block, call.count, ctx, call.buried === true, call.mature === true, call.tool));
    case 'fish': return skillFish(bot, call, ctx);
    case 'build':
      return 'blueprint' in call ? skillBuildBlueprint(bot, call, ctx) : skillBuild(bot, call, ctx);
    case 'excavate': return skillExcavate(bot, call, ctx);
    case 'tunnel': return skillTunnel(bot, call, ctx);
    case 'probe': return skillProbe(bot, call, ctx);
    case 'observe': return spatialObservationText(bot, call);
    case 'use': return skillUse(bot, call, ctx);
    case 'ride': return skillRide(bot, call, ctx);
    case 'anvil': return skillAnvil(bot, call, ctx);
    case 'grindstone': return skillGrindstone(bot, call, ctx);
    case 'craft': return skillCraft(bot, call, ctx);
    case 'smelt': return skillSmelt(bot, call.input, call.count, call.fuel, ctx, call.at);
    case 'brew': return skillBrew(bot, call, ctx);
    case 'enchant': return skillEnchant(bot, call, ctx);
    case 'eat': return skillEat(bot, call.item);
    case 'attack': return skillAttack(bot, call.target, call.mode ?? 'auto', ctx);
    case 'equip': return skillEquip(bot, call);
    case 'pickup': return withBlueprintGain(bot, ctx, () => skillPickup(bot, ctx, call.item));
    case 'toss': return skillToss(bot, call, ctx);
    case 'lead': return skillLead(bot, call, ctx);
    case 'stow': return skillStow(bot, call, ctx);
    case 'compact': return skillCompact(bot, ctx);
    case 'take': return withBlueprintGain(bot, ctx, () => skillTake(bot, call, ctx));
    case 'server_travel': {
      if (!call.command.startsWith('/')) throw new SkillBlocked('server_travel 只接受 / 开头的服务端命令');
      const target = resolveAt(bot, call.at);
      const distance = (): number => bot.entity.position.distanceTo(new Vec3(target.x, target.y, target.z));
      if (distance() <= call.within) return `已在服务端传送落点 ${cellText(target)} 附近，无需重复传送`;
      sendChat(bot, call.command);
      const until = Date.now() + 6_000;
      while (Date.now() < until) {
        checkAbort(ctx);
        if (distance() <= call.within) return `服务端传送已核验:来到 ${cellText(feetOf(bot))}`;
        await sleep(100);
      }
      throw new SkillBlocked(`已发 ${call.command}，但 6 秒内没有抵达 ${cellText(target)} 附近；查看服务端回执再决定下一步`);
    }
    case 'gesture': return skillGesture(bot, call, ctx);
    case 'chat': {
      const next = ctx.batch?.steps[(ctx.batch.index ?? 0) + 1];
      const needsWindow = call.text.startsWith('/') && consumesOpenWindow(next);
      const beforeWindow = bot.currentWindow;
      sendChat(bot, call.text);
      publishViewerCastCommand(bot, call.text);
      if (needsWindow && bot.currentWindow !== beforeWindow && storageWindow(bot.currentWindow)) {
        ctx.holdWindow?.(bot.currentWindow!);
      }
      if (needsWindow) {
        const until = Date.now() + 2_000;
        while ((!bot.currentWindow || bot.currentWindow === beforeWindow) && Date.now() < until) {
          checkAbort(ctx);
          await sleep(50);
          if (!ctx.aborted() && bot.currentWindow !== beforeWindow && storageWindow(bot.currentWindow)) {
            ctx.holdWindow?.(bot.currentWindow!);
          }
        }
      }
      let windowNote = '';
      if (needsWindow) {
        const win = bot.currentWindow !== beforeWindow ? bot.currentWindow : null;
        const menu = win && selectionMenuTitle(win.title);
        if (menu) windowNote = `；服务端打开的是${menu}选择菜单，不能当储物箱`;
        else if (win) {
          const snap = containerStacks(win);
          windowNote = `；服务端已打开容器窗口，${snap.usedSlots}/${snap.slots} 格占用，内容:${contentsText(snap.items.slice(0, 12))}`
            + (snap.items.length > 12 ? `等 ${snap.items.length} 类` : '');
        } else windowNote = '；2 秒内未打开窗口';
      }
      return `已向游戏聊天发送: ${call.text}${windowNote}；实际广播、命令或私聊结果以服务端回执为准`;
    }
  }
}

/** 执行器 → World 的汇报。text 已渲染好,World 包成 minecraft.task 事件。 */
export interface TaskReport {
  /** partial 表示动作已有成果，但声明的量未完成。 */
  /** cancelled 表示被叫停、顶替或停机取消，未经过正常 finish 的任务终态。 */
  kind: 'done' | 'partial' | 'blocked' | 'superseded' | 'reflex' | 'cancelled' | 'suspended' | 'resumed';
  text: string;
  /** 这条汇报说的是哪个任务;反射不属于任何任务,没有 */
  taskId?: number;
  /** Last completed step of a successful task. */
  lastSkill?: SkillCall['skill'];
  steps?: Array<{ step: number; outcome: StepOutcome | 'cut'; why: string | null }>;
  /** 同形状任务在短时间内再次未达整体目标时，附上上一回的受阻事实。 */
  repeatFailure?: { attempts: number; previousReceipt: string; scope: 'target' | 'shape'; observation: 'changed' | 'unchanged' | 'unavailable' };
  /** 这条汇报已经讲明了掉血的来由;World 据此不再复述一遍掉血播报 */
  hurt?: boolean;
}

/** 中止标记；设置 aborted 的调用方同时记录抢占来源 by。 */
interface AbortFlag {
  aborted: boolean;
  by: string | null;
  /** 死亡边界推进后，旧异步执行即使迟到也不能写回或继续泵队列。 */
  epoch: number;
}

/** 已落地步骤的终态；供未运行 finish 的取消路径通过 reportCancelled 回报各步结果。 */
interface StepLanding {
  /** 1 起的步号 */
  step: number;
  /** 这一步是什么(describeSkill 的说法,与受理回执同一口径) */
  what: string;
  /** 与 needs 闸门读的 outcomes 同一套判词 */
  outcome: StepOutcome;
  /** 一句原因(截短);做成的那几步没有 */
  why: string | null;
  /** 技能给出的确定原因；资源许可拒绝不作为空间放置失败。 */
  code?: SkillBlocked['code'];
  /**
   * 结局回执里这一步那一行,完整。断点续做的单靠它把断点之前的步原样摆回 finish()
   * 的回执 —— 那几步没在别处报过,续做后的结局回执是它们唯一的出口。
   */
  line: string;
}

/** 一步落地的终态。闸门、账本、结局回执三处同一套判词 */
type StepOutcome = 'ok' | 'noop' | 'partial' | 'fail' | 'skip';

/** 被切断那一刻补的一条:正在跑的那一步。只出现在终态回投里,不进账本 */
interface CutLanding {
  step: number;
  what: string;
  outcome: 'cut';
  why: string | null;
}

/** 一条回投里最多列几步。多出来的只报个数 —— 12 步的单不该把上下文吃掉 */
const STEP_LANDING_CAP = 6;

/** 一步终态的判词。与 priorOutcomes 的 kind 同一套说法,两处不再各说各的 */
const STEP_LANDING_ZH: Readonly<Record<StepOutcome | 'cut', string>> = {
  ok: '做成了',
  partial: '做了一部分',
  noop: '没什么可做的',
  fail: '没做成',
  skip: '跳过了',
  cut: '做到一半被撤',
};

/**
 * 步骤终态回投那一段。跟着 `cancelled`/`superseded` 那条报告走 —— 它们本来就
 * 不唤醒(World 侧 `r.kind !== 'cancelled'`)、按攒批投递,所以这一段不新增任何一次
 * 唤醒,只是把已经发生过的事实塞进同一条事件里。
 */
function renderStepLandings(landings: readonly (StepLanding | CutLanding)[], stepCount: number): string {
  if (landings.length === 0) return '';
  const shown = landings.slice(-STEP_LANDING_CAP);
  const omitted = landings.length - shown.length;
  const one = (l: StepLanding | CutLanding): string =>
    `第 ${l.step}/${stepCount} 步 ${l.what}:${STEP_LANDING_ZH[l.outcome]}`
    + (l.why ? `(${l.why})` : '');
  return `各步下场:${omitted > 0 ? `前 ${omitted} 步略;` : ''}${shown.map(one).join(';')}。`;
}

/** 回投里的原因只留一句;整段受阻文案进这里会把回执撑爆 */
function shortWhy(why: string | null | undefined): string | null {
  if (!why) return null;
  const head = why.split('\n')[0].trim();
  return head.length > 40 ? `${head.slice(0, 40)}…` : head;
}

interface TaskObservation {
  key: string;
  scope: 'target' | 'shape';
  dimension: string;
  position: { x: number; y: number; z: number } | null;
  orientationOnly: boolean;
  rotation: { yaw: number; pitch: number } | null;
  inventory: string | null;
  targetBlock: string | null;
}

/** 排着队还没轮到的一件事 */
interface QueuedTask {
  id: number;
  steps: SkillCall[];
  program?: ExecutorProgram;
  /** 受理时的维度、站位和完整参数；失败回顾不能借用另一地点或方法的原因。 */
  priorContext?: string;
  startObservation?: TaskObservation;
  /** 每个定向 find 真正开跑的位置；前面的 goto 完成后才知道起点。 */
  findOrigins?: Map<number, Cell>;
  /**
   * 已经落地的各步终态。挂在任务上而不是 ctx 上:战斗/环境挂起会重建 RunningTask,
   * 挂在 ctx 上的话断点续做之后前半程的账就没了。
   */
  stepLog?: StepLanding[];
  /** 尾步空队列提示每单至多一次；战斗/环境挂起后不重新唤醒。 */
  queueTailNotified?: boolean;
  /** 受理那一刻;与 startedAt 之差就是排队等了多久,结局回执分开报两段 */
  enqueuedAt: number;
  /** 首次开跑时刻。断点续做的单带着它:结局回执的时刻段与排队时长按第一次开跑算 */
  startedAt?: number;
  /**
   * 战斗/环境挂起后续做:从这一步开始跑。之前的步不重跑,终态与回执行都照 stepLog
   * 里记的,进闸门、进结局回执。
   */
  resumeFrom?: number;
  /** 做到一半被打断且不可重跑的那一步(craft/smelt 这类);恢复时按没做成算 */
  interrupted?: number | null;
  /**
   * 挂起那一刻正在跑的那一步(1 起)与它的计数进度。只有 `suspend()` 冻的断点有,
   * 步边界冻结时没有步在跑。续做的 collect 按它扣掉已挖的数(见 resumedCollect),
   * 断点被撤时进终态回投。
   */
  progress?: { step: number; count: { done: number; total: number } | null };
  /** 这一单有意放下的落点(build 逐格登记;见 run 里的说明)。跟着任务走,续做不丢 */
  intended?: Set<string>;
  /**
   * 被更早一步顺手做掉的步 → 那一步的回执。挂在任务上而不是 ctx 上,是因为战斗
   * 挂起会重建 ctx:东西已经进箱子了,恢复后那一步再跑一遍只会报「包里没有X」。
   */
  absorbed?: Map<number, { receipt: string; ok: boolean }>;
  /** 冻结断点的拥有者；仅同一组可恢复。战斗通过 busyWith 持有断点，深坠 hold 的释放不得恢复它。 */
  frozenBy?: QueueFreezeOwner;
  /** 等待这个逻辑任务的安全检查点；排队请求不立即夺手。 */
  checkpointOwnerId?: number;
  /** afterCheckpoint 优先队列成员，包括身体空闲但环境冻结时受理的请求。 */
  checkpointRequest?: boolean;
  /** 检查点让位保存的原任务；queue:now 可单独撤销该断点。 */
  checkpointContinuation?: boolean;
  /** 断点坐标属于让位时的维度，短任务不能把它改投另一维度。 */
  resumeDimension?: string;
}

/** A program holds the same body as a skill task; cancellation revokes its host capability. */
export interface ExecutorProgram {
  name: string;
  run(bot: Bot, context: SkillContext): Promise<void>;
  cancel(reason: string): void;
}

/**
 * 队列断点的冻结者组。
 *
 * `queue` = 环境危机与深坠:两者各持**自己**的 queueHold 槽(见 QueueHoldSlot),
 * 但断点只有一个,归组不归槽 —— 谁先把当前任务挂起,断点就是这一组的,另一槽
 * 的释放不会替它解冻(队列要两槽都空才开闸,所以先后并不改变结果)。
 * `combat` = 战斗:它不持 queueHold,走 busyWith 闸,与上面那一组互不相干。
 */
export type QueueFreezeOwner = 'combat' | 'queue';

/**
 * environment/fall 各持自己的冻结令牌，各自释放并独立计时。
 * 两槽都空后才恢复队列。
 */
type QueueHoldSlot = 'environment' | 'fall';

/**
 * 这一步被打断后能不能从头重跑。goto/collect/build/excavate 这类幂等(build 重放
 * 已放好的格是 no-op、collect 按打断前的进度扣掉已挖的数续采,见 resumedCollect);
 * craft/smelt/toss/stow/take 重跑会重复扣料/重复转移,use 带 times>1 或商人成交
 * 同理——不重跑,按没做成算,下游按 needs 闸门自然处置。
 */
function reRunnable(call: SkillCall | undefined): boolean {
  if (!call) return true;
  switch (call.skill) {
    case 'craft': case 'smelt': case 'toss': case 'stow': case 'take': case 'brew': case 'transit': case 'control': return false;
    // 只看报价那一形没有副作用,重跑无妨;下过手的那一形扣了等级与青金石,不重跑
    case 'enchant': return call.index === undefined;
    case 'use': return (call.times ?? 1) <= 1 && call.index === undefined;
    default: return true;
  }
}

/**
 * 断点续做时 collect 这一步实际要跑的形态。collect 的 count 是"这一趟挖几块",从进门
 * 那一刻起算,原样重进会把打断前挖到的再挖一遍(6/10 被打断,续做再挖 10 块)。
 * build/excavate/tunnel 的进度按几何续做,已挖已放的格重放是 no-op,不在此列。
 * 返回 null = 这一步不按剩余数续做。
 */
function resumedCollect(
  task: QueuedTask,
  i: number,
): { call: SkillCall; done: number; total: number; remaining: number; note: string } | null {
  const call = task.steps[i];
  const p = task.progress;
  if (call?.skill !== 'collect' || !p || p.step !== i + 1 || !p.count) return null;
  const { done, total } = p.count;
  const remaining = total - done;
  return {
    call: { ...call, count: remaining },
    done, total, remaining,
    note: remaining > 0
      ? `打断前已挖到 ${done}/${total} 块,接着挖剩下的 ${remaining} 块`
      : `打断前已挖够 ${total} 块`,
  };
}

interface RunningTask extends QueuedTask {
  /** 当前执行实例的尾步提示；恢复后的新实例不继承旧提示。 */
  queueTailNotice?: TaskQueueTail;
  /** 在跑的那一件账本一定在场(pump 建的时候补齐) */
  stepLog: StepLanding[];
  flag: AbortFlag;
  /** 由技能置位(flee/surface/战斗撤退):正在逃的任务反射不抢占 */
  escape: { active: boolean };
  startedAt: number;
  /** 做到第几步(0 起);进心跳那行,让agent知道一件事走到哪了 */
  stepIndex: number;
  /** 当前这一步是什么时候开始的 */
  stepStartedAt: number;
  /** 当前 goto 最近一次让目标距离至少缩短一格的时刻。 */
  goalProgressAt?: number;
  bestGoalDistance?: number;
  /** 当前步骤的计数进度(collect/build/excavate/tunnel);非计数类为 null */
  count: { done: number; total: number } | null;
}

interface CheckpointDrain {
  task: RunningTask;
  bot: Bot;
  resumeFrom: number;
  boundary: boolean;
  phase: 'settling' | 'yielded';
  continuation: QueuedTask | null;
}

/** 当前步骤重放时仍有固定空间目标，或按实际采集计数扣除已完成量。 */
function checkpointReplayable(call: SkillCall): boolean {
  const fixed = (at: readonly unknown[] | undefined): boolean =>
    at !== undefined && at.every((value) => typeof value === 'number' && Number.isFinite(value));
  switch (call.skill) {
    case 'collect': return true;
    case 'goto': return fixed(call.at);
    case 'excavate': return call.anchors.every(fixed);
    case 'build':
      return 'blueprint' in call ? fixed(call.at)
        : 'on' in call ? call.on.every((point) => fixed(point.at))
          : call.anchors.every(fixed);
    default: return false;
  }
}

/**
 * 首步相对锚点入队即冻结，只解析带 ~ 的分量；无效表达式留给执行时报错。
 * 后续步骤和 expect 锚点仍在各自执行或评估时解析。
 */
export function freezeFirstStep(
  steps: readonly SkillCall[],
  origin: Cell,
): { steps: SkillCall[]; changed: boolean; origin: Cell } {
  if (steps.length === 0) return { steps: [...steps], changed: false, origin };
  let changed = false;
  const fz = (a: Anchor): Anchor => {
    if (a.every((c) => typeof c === 'number')) return a;
    const r = resolveAnchors([a], origin);
    if (!Array.isArray(r)) return a;
    changed = true;
    return [r[0].x, r[0].y, r[0].z];
  };
  const s0 = steps[0];
  let head: SkillCall = s0;
  switch (s0.skill) {
    case 'goto': case 'transit': case 'tunnel':
      head = { ...s0, at: fz(s0.at) };
      break;
    case 'fish':
      head = s0.at ? { ...s0, at: fz(s0.at) } : s0;
      break;
    case 'use':
      head = s0.at ? { ...s0, at: fz(s0.at) } : s0;
      break;
    case 'take':
      head = s0.at ? { ...s0, at: fz(s0.at) } : s0;
      break;
    case 'build':
      // 蓝图形态的 at 是锚点(蓝图 [0,0,0] 落哪儿),同样按下单那一刻的位置冻结
      head = 'blueprint' in s0
        ? (s0.at ? { ...s0, at: fz(s0.at) } : s0)
        : 'on' in s0
          ? { ...s0, on: s0.on.map((p) => ({ ...p, at: fz(p.at) })) }
          : { ...s0, anchors: s0.anchors.map(fz) };
      break;
    case 'excavate':
      head = { ...s0, anchors: s0.anchors.map(fz) };
      break;
    case 'probe':
      // 找块形态(radius)没有锚点,没什么可冻结的
      head = s0.anchors !== undefined ? { ...s0, anchors: s0.anchors.map(fz) } : s0;
      break;
    default:
      break;
  }
  if (!changed) return { steps: [...steps], changed: false, origin };
  return { steps: [head, ...steps.slice(1)], changed: true, origin };
}

/** 技能序列渲染成的一句话,回执与心跳里都用它指代这件事 */
function labelOf(task: QueuedTask): string {
  if (task.program) return task.program.name;
  return task.steps.map((c) => describeSkill(c)).join(';');
}

/** 步骤尚未结束时，账本不能用于断言这一步没有发生效果。 */
function cancelledNote(
  who: string,
  task: QueuedTask,
  step: number | null,
  phase: 'running' | 'frozen',
): string {
  if (task.program) return `已叫停${who}「${task.program.name}」；原生程序不自动重放`;
  const done = (task.stepLog ?? []).filter((entry) => entry.outcome === 'ok').length;
  const head = `已叫停${who},已做成 ${done}/${task.steps.length} 步`;
  if (step === null) return head;
  const where = phase === 'running' ? '叫停前正在执行' : '断点记录在';
  return `${head};${where}第 ${step}/${task.steps.length} 步「${describeSkill(task.steps[step - 1])}」`;
}

/** 任务同类签名由技能名和主目标原始 id 组成，不含坐标与数量。 */
function taskSignature(steps: readonly SkillCall[]): string {
  return steps.map((c) => {
    const o = c as unknown as Record<string, unknown>;
    const what = ['target', 'block', 'item', 'material', 'input', 'name']
      .map((k) => o[k])
      .find((v) => typeof v === 'string');
    return what ? `${c.skill}:${what as string}` : c.skill;
  }).join('>');
}

/** Repeated short approaches share a budget, but adding an approach changes a stationary search. */
function navigationIntentKey(steps: readonly SkillCall[]): string {
  const firstFind = steps.findIndex((step) => step.skill === 'find');
  const approach = firstFind > 0 && steps.slice(0, firstFind).some((step) => step.skill === 'goto');
  const search = steps.some((step) => step.skill === 'find')
    && steps.every((step) => step.skill === 'find' || step.skill === 'goto')
    ? steps.filter((step) => step.skill === 'find') : steps;
  return JSON.stringify({ approach, steps: search.map((step) => step.skill === 'find'
    ? { ...step, direction: undefined, distance: undefined } : step) });
}

/** 与失败归并签名不同：在途去重必须包含坐标、数量和选项。 */
function exactTaskKey(steps: readonly SkillCall[]): string {
  return JSON.stringify(steps.map((step) =>
    Object.keys(step).sort().map((key) => [key, (step as unknown as Record<string, unknown>)[key]])));
}

/** 同一来源窗口取同一物品，前面是否多了一段赶路不改变失败原因。 */
function openTakeRetryKey(steps: readonly SkillCall[]): string | null {
  const take = steps.at(-1);
  if (!take || take.skill !== 'take' || take.from !== 'open') return null;
  const opener = [...steps.slice(0, -1)].reverse().find((step) => step.skill === 'chat' || step.skill === 'use');
  return opener ? `open-take:${JSON.stringify({ opener, take })}` : null;
}

/** Pointed takes keep the same source when count or an earlier route changes. */
function namedTakeRetryKey(steps: readonly SkillCall[], bot: Bot | null): string | null {
  const take = steps.at(-1);
  if (!bot || !take || take.skill !== 'take' || !take.at || !take.item) return null;
  if (steps.slice(0, -1).some((step) => step.skill !== 'goto')) return null;
  try {
    const cell = resolveAt(bot, take.at);
    return JSON.stringify(['take-at', dimensionOf(bot), cell.x, cell.y, cell.z, take.item]);
  } catch { return null; }
}

/** 同类任务的上次未达成终态：blocked、partial 或 noop。 */
interface PriorOutcome {
  kind: 'blocked' | 'partial' | 'noop';
  why: string;
  at: number;
  context: string;
  taskId: number;
  label: string;
}

/** 跨形状统计的短摘要隐藏坐标；带来源的同现场历史回执保留原文。 */
function maskCoords(why: string): string {
  return why.replace(/\(\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*\)/g, '那一处');
}

/** 打转账的一份快照:这一签名下过几次、跨了多久、其中几次真开跑过第 1 步 */
interface RoundaboutSnapshot {
  times: number;
  spanMs: number;
  ranBefore: number;
}

function priorOutcomeNote(prev: PriorOutcome, now: number, round: RoundaboutSnapshot | null): string {
  const mins = Math.round((now - prev.at) / 60_000);
  const when = mins <= 1 ? '刚才' : `${mins} 分钟前`;
  const how = prev.kind === 'partial' ? '当时只做成了一部分'
    : prev.kind === 'noop' ? '当时没什么可做的'
      : '当时没做成';
  /* 报告窗口内同类任务的提交与实际开跑次数，不推荐行动。 */
  const spanMin = round ? Math.round(round.spanMs / 60_000) : 0;
  const span = spanMin >= 1 ? `${spanMin} 分钟内` : '这几分钟里';
  const tail = round && round.times >= 2
    ? `;这是${span}第 ${round.times} 次下同形状的单,`
      + (round.ranBefore === 0
        ? `前 ${round.times - 1} 次一步都没跑过`
        : `前 ${round.times - 1} 次里有 ${round.ranBefore} 次跑过第 1 步`)
    : '';
  return `${when}下过同类的单；历史任务#${prev.taskId}「${prev.label}」${how}:${prev.why}${tail}。这是历史结果，本次现场以新试算和执行回执为准`;
}

/** 成功的同类任务没有失败旧账，仍把重复提交次数交给模型判断。 */
function repeatedSubmissionNote(round: RoundaboutSnapshot): string | null {
  if (round.times < 3) return null;
  const spanMin = Math.round(round.spanMs / 60_000);
  const span = spanMin >= 1 ? `${spanMin} 分钟内` : '这几分钟里';
  return `这是${span}第 ${round.times} 次提交同类任务(技能和目标类型相同，坐标与参数可能不同；次数未判定有无进展)`;
}

/** 拦截重生锚破坏后，在此窗口内原样重发同一任务视为确认。 */
const SPAWN_CONFIRM_WINDOW_MS = 10 * 60_000;

/** 重力方块头顶保护高度，单位为格；只限制自身列贴近身体的这一段。 */
const GRAVITY_OVERHEAD = 3;

/**
 * 这一步的形状会动到哪些格。只覆盖几何族(build/excavate/tunnel):
 * 别的技能没有"一片格子"这个概念,返回 null 表示这道闸不管它。
 * 算不出来(锚点写错、超规模)也返回 null —— 闸不许成为第二个报错源,
 * 那些错由技能自己在出队刻照原样说。
 */
/**
 * 一段行军走满时的落点(方向单位向量 × distance)。这是**上界**,不是预测:
 * 路上碰到早停名单就正常收束,真走满才到这儿。坐标不取整 —— 它本来就是估算,
 * 取整只会让"约 130 格"看起来比它实际有的精度更硬。
 */
function marchEnd(feet: Cell, direction: Direction, distance: number): { x: number; y: number; z: number } {
  const [dx, dz] = DIRECTIONS[direction];
  const norm = Math.hypot(dx, dz) || 1;
  return { x: feet.x + (dx / norm) * distance, y: feet.y, z: feet.z + (dz / norm) * distance };
}

/**
 * 一步的代表性目标格(危险区陈述用):她写的 `at`,或形状族的第一个锚点。
 * 算不出来返回 null —— 陈述缺一句无所谓,报错才是问题。
 */
function targetCellOf(bot: Bot, call: SkillCall): Cell | null {
  try {
    const at = (call as { at?: unknown }).at;
    if (at !== undefined && at !== null) return resolveAt(bot, at as Anchor);
    const anchors = (call as { anchors?: unknown }).anchors;
    if (Array.isArray(anchors) && anchors.length > 0) return resolveAt(bot, anchors[0] as Anchor);
  } catch {
    return null;
  }
  return null;
}

function shapeFootprint(bot: Bot, call: SkillCall, desk?: BlueprintDesk | null): Cell[] | null {
  // 试算一格都不动:两道受理刻的闸都不该拦它(与 precheckStep 同一条豁免)
  if ((call as { dryRun?: boolean }).dryRun) return null;
  try {
    if (call.skill === 'excavate') {
      return shapeCells(bot, call.shape, call.anchors, call.fill, EXCAVATE_CELL_CAP);
    }
    if (call.skill === 'build') {
      if ('blueprint' in call) return blueprintFootprint(bot, call, desk).map((c) => c.cell);
      if ('on' in call) {
        return call.on.map((spot) => cellOnFace(resolveAt(bot, spot.at), spot.face));
      }
      return shapeCells(bot, call.shape, call.anchors, call.fill, BUILD_CELL_CAP);
    }
    if (call.skill === 'tunnel') {
      // 与 skillTunnel 同源:塔挖头顶那条、竖井挖脚下那条、斜通道两条都挖
      const start = feetOf(bot);
      const target = resolveAt(bot, call.at);
      const line = rasterize('line', [start, target], 'solid');
      if (!Array.isArray(line)) return null;
      const rise = target.y - start.y;
      const vertical = Math.max(Math.abs(target.x - start.x), Math.abs(target.z - start.z)) === 0;
      return vertical
        ? line.slice(1).map((c) => ({ x: c.x, y: rise > 0 ? c.y + 1 : c.y, z: c.z }))
        : line.flatMap((c) => [c, { x: c.x, y: c.y + 1, z: c.z }]);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 一张蓝图这一单会动到哪些格、每格放的是什么物品。
 *
 * 两道受理刻的闸(重生锚、重力方块)按它算 —— 蓝图那一单的落点全在图里,
 * 闸不认识图就等于对这条路整个失效:一张把床罩进去的图会一路盖到重生点作废。
 * 锚点取她这一单给的 `at`,没给就取本世界的施工绑定;两者都没有(第一次盖又忘了
 * 给锚点)时返回空 —— 那一单本来就跑不起来,由技能自己在出队刻说清。
 */
function blueprintFootprint(
  bot: Bot,
  call: BlueprintCall,
  desk?: BlueprintDesk | null,
): Array<{ cell: Cell; item: string }> {
  const site = desk?.get(call.blueprint) ?? null;
  if (!site) return [];
  const anchor: PositionXYZ | null = call.at
    ? (() => { const c = resolveAt(bot, call.at as Anchor); return [c.x, c.y, c.z] as PositionXYZ; })()
    : site.anchor;
  if (!anchor) return [];
  const limit = call.stopAfter === undefined
    ? site.plan.steps.length
    : stepCountThroughLayer(site.plan.steps, call.stopAfter);
  const out: Array<{ cell: Cell; item: string }> = [];
  for (const step of site.plan.steps) {
    if (step.index >= limit) break;
    for (let y = step.from[1]; y <= step.to[1]; y++) {
      for (let z = step.from[2]; z <= step.to[2]; z++) {
        for (let x = step.from[0]; x <= step.to[0]; x++) {
          const pos = toWorld(anchor, [x, y, z]);
          out.push({ cell: { x: pos[0], y: pos[1], z: pos[2] }, item: step.item });
        }
      }
    }
  }
  return out;
}

/** 重生锚保护格包括锚点、下方支撑，以及可读取的另一半床。 */
function spawnGuardCells(bot: Bot, anchor: { x: number; y: number; z: number }): Cell[] {
  const at: Cell = { x: Math.floor(anchor.x), y: Math.floor(anchor.y), z: Math.floor(anchor.z) };
  const cells: Cell[] = [at, { x: at.x, y: at.y - 1, z: at.z }];
  for (const [dx, , dz] of NEIGHBORS6) {
    if (dx === 0 && dz === 0) continue;
    const c = { x: at.x + dx, y: at.y, z: at.z + dz };
    const b = blockAtCell(bot, c);
    if (b && isSpawnAnchorBlock(b.name)) cells.push(c);
  }
  return cells;
}

/** 识别自身头顶的相对锚点表达式，不依赖当前位置。 */
function isOverheadAnchor(a: Anchor): boolean {
  const rel = (v: AnchorCoord): number | null => {
    if (typeof v !== 'string' || !/^~-?\d*$/.test(v)) return null;
    return v === '~' ? 0 : Number(v.slice(1));
  };
  const dy = rel(a[1]);
  return rel(a[0]) === 0 && rel(a[2]) === 0 && dy !== null && dy > 0 && dy <= GRAVITY_OVERHEAD;
}

/** 这一单是不是「显式指名对重生锚那一格动手」——那条路给确认,不是驳回 */
function namesSpawnAnchor(bot: Bot, call: SkillCall, guard: readonly Cell[]): boolean {
  // collect 按名字点名床/重生锚:她说的就是这个东西,不是顺带罩上的
  if (call.skill === 'collect') return isSpawnAnchorBlock(call.block);
  if (call.skill !== 'excavate') return false;
  const cells = shapeFootprint(bot, call, null);
  // 就那一格:形状语言里"指名"只有这一种写法
  return cells !== null && cells.length === 1
    && guard.some((g) => g.x === cells[0].x && g.y === cells[0].y && g.z === cells[0].z);
}

/** 一个对象里"真写了"的键:值是 undefined/null 的不算(schema 是扁平字段池,填 null 是照 schema 写的) */
function liveKeys(o: Record<string, unknown>): string[] {
  return Object.keys(o).filter((k) => o[k] !== undefined && o[k] !== null);
}

/** 语义相等：对象忽略键序，数组按序，标量按值比较。 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b)
      && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const oa = a as Record<string, unknown>;
    const ob = b as Record<string, unknown>;
    const ka = liveKeys(oa);
    const kb = liveKeys(ob);
    return ka.length === kb.length && ka.every((k) => kb.includes(k) && sameValue(oa[k], ob[k]));
  }
  return false;
}

/**
 * 受理回念只显示解析、冻结后与原输入不同的字段；被丢弃字段由 parseNoteText 报告。
 * 无原输入可比较时回念完整步骤。
 */
/** 这个值是不是「相对锚点」写法(带 `~` 的那种) */
function isRelativeAnchor(v: unknown): boolean {
  return Array.isArray(v) && v.some((c) => typeof c === 'string' && c.startsWith('~'));
}

/** 这个值是不是一串纯数坐标 */
function isAbsoluteAnchor(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0 && v.every((c) => typeof c === 'number');
}

/**
 * 相对锚点冻结的差异提到首句；补默认值注明按该值理解。
 * 路标解析结果置尾段；其他差异并列显示原输入与实际值。
 */
interface EchoParts {
  /** 提首句的那一类 */
  hoist: string | null;
  /** 留在尾段的那些 */
  tail: string | null;
}

/** Receipts use public goto coordinates while execution retains its normalized anchor. */
function receiptStep(step: SkillCall): Record<string, unknown> {
  if (step.skill !== 'goto' || !step.groundY) return step as unknown as Record<string, unknown>;
  const publicStep: Record<string, unknown> = { ...step, at: [step.at[0], step.at[2]] };
  delete publicStep.groundY;
  return publicStep;
}

function echoDiff(steps: readonly SkillCall[], wrote: unknown): EchoParts {
  if (!Array.isArray(wrote) || wrote.length !== steps.length) {
    const publicSteps = steps.map(receiptStep);
    return { hoist: null, tail: JSON.stringify(publicSteps.length === 1 ? publicSteps[0] : publicSteps) };
  }
  const hoisted: string[] = [];
  const parts: string[] = [];
  const marks: string[] = [];
  for (const [i, step] of steps.entries()) {
    const raw = wrote[i];
    const one = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const at = steps.length > 1 ? `第 ${i + 1} 步的 ` : '';
    const fields: string[] = [];
    for (const [key, val] of Object.entries(receiptStep(step))) {
      // skill 名必须一字不差才解析得出这一步,不可能有差别
      if (val === undefined || key === 'skill') continue;
      const hers = one[key];
      if (hers === undefined || hers === null) {
        fields.push(`${key} 你没写,我按 ${JSON.stringify(val)} 理解`);
      } else if (sameValue(val, hers)) {
        continue;
      } else if (isRelativeAnchor(hers) && isAbsoluteAnchor(val)) {
        hoisted.push(`${at}${key} 你写 ${JSON.stringify(hers)}、我按 ${JSON.stringify(val)} 跑`);
      } else if (typeof hers === 'string' && isAbsoluteAnchor(val)) {
        marks.push(`${at}${key} 路标「${hers}」= ${JSON.stringify(val)}`);
      } else {
        fields.push(`${key} 你写 ${JSON.stringify(hers)}、我按 ${JSON.stringify(val)} 跑`);
      }
    }
    if (fields.length > 0) parts.push(`${at}${fields.join(',')}`);
  }
  const tailBits = [
    parts.length > 0 ? `跟你写的不一样:${parts.join(';')}` : null,
    marks.length > 0 ? marks.join(';') : null,
  ].filter(Boolean);
  return {
    hoist: hoisted.length > 0 ? `相对锚点已折成绝对坐标:${hoisted.join(';')}` : null,
    tail: tailBits.length > 0 ? tailBits.join('。') : null,
  };
}

/**
 * 步行速度,格/秒。原版玩家平地走路 4.317 格/秒(疾跑 5.612,寻路器默认的
 * `Movements` 走的是走路姿态)。用这个固定值而不是本场均速:均速把绕路、挖掘、
 * 卡住全算了进去,拿它乘直线距离得到的既不是直线时长也不是实走时长。
 */
const WALK_BLOCKS_PER_SEC = 4.317;

/** 长途 goto 的距离阈值，单位为格。 */
const LONG_GOTO_BLOCKS = 100;

/** 直线距离 → 步行时长的人读写法 */
function fmtWalk(blocks: number): string {
  const sec = blocks / WALK_BLOCKS_PER_SEC;
  return sec < 90 ? `${Math.round(sec)} 秒` : `${Math.round(sec / 60)} 分钟`;
}

/** 队列此刻的样子。世界快照末行与任务结局回执都读它;没有"查队列"的工具 */
/**
 * 一步没做成的原文记录。四个字段全是**已经写好的那几句**原样搬过来,
 * 不改写、不归因(worlds-report-facts)。
 */
export interface BlockedRecord {
  /** 发生时刻(epoch ms);渲染成 HH:MM:SS 由调用方按自己的时区做 */
  at: number;
  /** 哪一单:`任务#12「造墙」` 这样的标签 */
  task: string;
  /** 哪一步:多步任务带步号;单步任务就是那一步本身 */
  step: string;
  /** 技能自己报的那句原话 */
  why: string;
}

/** 受阻原文账留几条。只读原语一次报 5 条,留一倍余量给「上一屏」 */
const BLOCKED_LOG_MAX = 10;

export interface QueueStatus {
  /** elapsedMs 是**这一步**跑了多久;整条任务的那份另给 taskElapsedMs */
  running: {
    id: number; label: string; step: string; stepIndex: number; stepCount: number; elapsedMs: number;
    /** 受理到现在。只看步骤耗时读不出「这一单已经磨了二十分钟」 */
    taskElapsedMs: number;
    count: { done: number; total: number } | null;
    pos: { x: number; y: number; z: number } | null;
  } | null;
  waiting: Array<{ id: number; label: string }>;
  /** 身体当前被反射或战斗持有的原因；未占用时为 null，供受理及队列回执共用。 */
  hold?: string | null;
}

/**
 * 队列渲染成一句话。给agent的每一处都用同一句:两处措辞不同的同一件事读起来
 * 就像两件事。
 */
export function renderQueue(q: QueueStatus): string {
  const r = q.running;
  // 两个耗时只在走起来之后才有读数:受理刻(replace 下单占 976/1338)两个数恒为
  // 「已跑 0s,整单已跑 0.0s」,印出来只是把「刚开跑」说第二遍
  const stepS = r ? Math.round(r.elapsedMs / 1000) : 0;
  const head = r
    ? `正在做任务#${r.id}「${r.label}」` +
      `(第 ${r.stepIndex + 1}/${r.stepCount} 步:${r.step}` +
      `${stepS > 0 ? `,已跑 ${stepS}s` : ''}` +
      `${r.taskElapsedMs >= 1000 ? `,整单已跑 ${fmtDur(r.taskElapsedMs)}` : ''}` +
      `${r.count ? `,进度 ${r.count.done}/${r.count.total}` : ''})` +
      `${r.pos ? `,我在 (${r.pos.x}, ${r.pos.y}, ${r.pos.z})` : ''}`
    // 手上没有**任务**不等于手空着:反射/战斗持身时照实点名占着它的是谁
    : q.hold
      ? `手上是${q.hold}(不是任务),队列头空着`
      : '手上没有在做的事';
  if (q.waiting.length === 0) return `${head};后面没有排着的了`;
  return `${head};后面排着 ${q.waiting.map((t) => `任务#${t.id}「${t.label}」`).join('、')}`;
}

/** 当前任务已开跑尾步且后面没有待办；只描述队列，不安排下一件事。 */
export interface TaskQueueTail {
  taskId: number;
  stepIndex: number;
  stepCount: number;
}

export interface TaskAdmissionRejection {
  /** A fresh correction permits replanning; known refusals and waits end this turn. */
  kind: 'correction' | 'repeat' | 'wait';
  rule: string;
}

export interface TaskAdmissionDecision {
  receipt: string;
  accepted: boolean;
  taskId?: number;
  retryAfterMs?: number;
  completedImmediately?: true;
  rejection?: TaskAdmissionRejection;
}

/** 运行中任务的一份进度(周期捎带投递;计数过半那份升为常规攒批) */
export interface TaskProgress {
  taskId: number;
  label: string;
  stepIndex: number;
  stepCount: number;
  step: string;
  elapsedS: number;
  pos: { x: number; y: number; z: number } | null;
  /** 距上一份进度的净位移(格);第一份从步骤起点算。原地打转时这个数接近 0 */
  movedBlocks: number | null;
  count: { done: number; total: number } | null;
  /** 技能提供的当前阶段与现场读数。 */
  detail?: string;
  /** 计数刚过半的那一份 */
  half: boolean;
  /** 这一刻人正躺在床上等醒:进度文案换一句说,别把"没挪窝"报成卡住 */
  sleeping?: boolean;
}

interface ExecutorOptions {
  getBot: () => Bot | null;
  admissionCheck?: (steps: readonly SkillCall[]) => string | null;
  report: (r: TaskReport) => void;
  log: Logger;
  /** 任务号发号器 */
  nextId: () => number;
  /** 回执里 HH:MM:SS 按哪个时区渲染;不给按东八区(与世界快照的现实时间同一默认) */
  timezone?: string;
  /** 战斗中生命跌破此值就收手撤退(与反射的脱战血线同源);不给 = 不撤 */
  fleeHealth?: () => number;
  /** 主动 attack 与被动战斗层共用的弓控制器出口；租约由执行器单独持有。 */
  ranged?: TaskRangedActions;
  /**
   * 前置试算开关(默认开)。返回 false 时受理刻不试算、出队刻不闸 —— 台架做 A/B 用,
   * 也留给控制台在判据出问题时一键退回旧行为。
   */
  precheck?: () => boolean;
  /**
   * 受理回执里捎带「上一次同样这一单是什么下场」(默认开)。
   * 它补的是**已经滑出上下文**的那一段——同一单隔了几十轮再下,上一次的终态
   * 早被交接压掉了。关掉退回旧行为(受理单只说这一单)。
   */
  priorOutcome?: () => boolean;
  /** 可选的同类成功任务兜底；在每个步骤开跑前现读，排队任务也遵守热配置。 */
  repeatSuccessFallback?: () => {
    enabled: boolean; skillsCsv: string; maxSuccesses: number; windowMinutes: number;
  };
  /** World 日志;不给就不记 */
  diag?: MinecraftLog;
  /** 运行中步骤的进度快照(30s 周期 + 计数过半) */
  onProgress?: (p: TaskProgress) => void;
  /** 尾步开始且等待队列为空时至多一次；World 在投递时重新核验当前状态。 */
  onQueueTail?: (p: TaskQueueTail) => void;
  /** 常驻规矩(mc_policy;World 持有并落盘) */
  policy?: SkillContext['policy'];
  /** 普通放置逐块取得许可；用于执行器外部持有的数量保留账。 */
  permitResourcePlacement?: ResourcePlacementGate;
  /** 试算的只读材料判据;不占串行闸 */
  previewResourcePlacement?: ResourcePlacementPreview;
  /** 路线试算(goto 的 dryRun 与受阻现场的三种走法用) */
  probeRoutes?: SkillContext['probeRoutes'];
  /** 目标点分诊(探路误诊断的另一半) */
  probeTarget?: SkillContext['probeTarget'];
  /** 挖掘失败退避账的取用面(桥持有);不接 = 这个部署没有退避(台架) */
  digBackoffSince?: SkillContext['digBackoffSince'];
  /**
   * 零位移探针里 World 那一半(战斗会话、环境 owner)。只读;不接 = 那两格记 null。
   * 队列冻结与断点由执行器自己补进去,见 `run()` 里的 `bodyState`。
   */
  bodyState?: () => Pick<BodyStateProbe, 'combatActive' | 'environmentOwnerKind'>;
  /** 清空冻结两槽后通知反射作废旧令牌；危机持续时需重新申请租约。 */
  onHoldsReleased?: () => void;
  /** 开过的箱子账本 */
  chests?: ChestBook;
  /** Persist completed empty directional routes across World restarts. */
  directionalSweeps?: DirectionalSweepBook;
  /** 成果登记(World 持久化) */
  works?: WorksBook;
  /** 探索覆盖账本落账(World 持久化) */
  explored?: SkillContext['explored'];
  /**
   * 身体现在被谁占着(战斗会话):非 null 时 pump 不开新任务,受理回执照实说
   * 「排上了,腾出手就做」。返回的字符串就是那个"在忙什么"。
   */
  busyWith?: () => string | null;
  /** 容器 GUI 演出节拍(SkillContext 同名字段的来源) */
  showTempo?: SkillContext['showTempo'];
  /** 任务做完且队列空了:兜底关掉忘关的容器窗口(GUI 演出的窗口卫生) */
  onDrain?: () => void;
  /** 白天点床时重生点已经悄悄搬走了没有(World 持有 set_spawn 的时刻) */
  spawnNote?: SkillContext['spawnNote'];
  serverFeedbackSince?: SkillContext['serverFeedbackSince'];
  /** 个人重生点那一格(World 持有);受理刻的重生锚闸与技能回执共读一份 */
  spawnAnchor?: SkillContext['spawnAnchor'];
  /** 蓝图施工面(World 持有);build 的蓝图形态、两道受理刻的闸与采集搭车共读一份 */
  blueprints?: SkillContext['blueprints'];
  /**
   * 路标表的取用面(World 持有 mc_map);不接 = 这个部署没有路标(台架),
   * 受理回执里那两句相对化与危险区陈述整段不出现。
   */
  marks?: () => MarkDesk;
  /**
   * `queue:"now"` 夺手时让战斗会话当场交还身体(CombatSession.standDown)。
   * 首步交给战斗层判断是否为进食或撤离；返回刚才在做什么。
   */
  stopCombat?: (firstStep: SkillCall) => string | null;
  /** Search cache namespace. A realm or connection-generation change invalidates all sightings. */
  searchContext?: () => { connectionGeneration: number; realm: string };
}

interface QueueHoldToken {
  readonly owner: symbol;
}

interface QueueResumeResult {
  released: boolean;
  note: string | null;
  /** 这一槽解了、另一槽还冻着时那一槽的理由;队列这时不开闸 */
  stillHeld?: string;
}

/**
 * 队列按提交顺序执行，步骤依赖规则见 StepBounds。
 * 单步受阻不撤后续任务，撤单由队列操作、自保抢占或生命周期处理决定。
 */
export class Executor {
  private task: RunningTask | null = null;
  private queue: QueuedTask[] = [];
  /**
   * 两个独立的冻结槽(见 QueueHoldSlot):环境危机一张、深坠一张,各自释放,
   * **都空了**队列才开闸。队列内容在冻结期间原样保留。
   */
  private readonly queueHolds: Record<QueueHoldSlot, { token: QueueHoldToken; reason: string } | null> = {
    environment: null,
    fall: null,
  };
  private stopped = false;
  private executionEpoch = 0;
  private activeAttack: TaskAttackLease | null = null;
  /** 战斗挂起中的任务(断点冻结,战后 resume 放回队头续做) */
  private frozen: QueuedTask | null = null;
  /** 让位收尾涵盖整个旧 run；清请求不能提前解除这道执行屏障。 */
  private checkpointDrain: CheckpointDrain | null = null;
  private readonly runningInstances = new Map<RunningTask, Bot | null>();
  /** probe 差分单槽:mc_stop 不清,换执行器(重启)才清 */
  private readonly probeMemo: { last: ProbeMemo | null; entries: Map<number, ProbeMemo> } = {
    last: null, entries: new Map(),
  };
  private readonly emptyProbeReads = new Map<string, {
    at: number; dimension: string; from: Cell;
  }>();
  /**
   * 每种技能+目标类型最近一次未达成的结果，引用前另核对受理时的完整现场和参数。
   * 成功清除相同现场的旧账；不同现场的原因不会转交给新尝试。
   */
  private readonly priorOutcomes = new Map<string, PriorOutcome>();
  private readonly unresolvedIntents = new Map<string, {
    attempts: number; at: number; evidence: string; after: TaskObservation | null;
  }>();
  /** 同类签名在 15 分钟内的提交时刻及开跑首步次数，不据此推断目标未推进。 */
  private readonly roundabout = new Map<string, { submits: Array<{ id: number; at: number; started: boolean }> }>();
  /** 实际成功的步骤按目标技能归并；启用 fallback 前也保留窗口内事实。 */
  private readonly successfulIntents = new Map<string, number[]>();
  /** 原样重试的失败账；换目标、站位或维度后重新计数。 */
  private readonly exactFailures = new Map<string, {
    count: number; at: number; why: string;
    from: { x: number; y: number; z: number; dimension: string } | null;
    inventoryStamp: string | null;
    takeProof?: 'not-container' | 'missing-item';
    admissionRule?: string;
    admissionInventoryStamp?: string | null;
    admissionTargetBlock?: string | null;
  }>();
  /** 同一片区域反复采集不可见目标的短期账；仅由结构化受阻码写入。 */
  private readonly unseenCollects = new Map<string, {
    count: number; at: number; from: Cell;
  }>();
  /** 每片农田分别记账；在家与远处田之间往返不能覆盖上一片的未成熟观察。 */
  private readonly immatureCollects = new Map<string, Array<{ at: number; from: Cell }>>();
  private tunnelLiquidStops: Array<{
    at: number; dimension: string; cell: Cell; name: 'water' | 'lava';
  }> = [];
  private tunnelSupportStops: Array<{ at: number; dimension: string; cell: Cell }> = [];
  /** 已实际走完的竖向通道：允许首次折返，但拦住同段反复上下来回。 */
  private verticalTunnelTraversals: Array<{
    at: number; dimension: string; from: Cell; to: Cell;
  }> = [];
  /** Full virtual/open containers: a successful stow of another item does not free a slot. */
  private readonly fullOpenStorageFailures = new Map<string, { count: number; at: number; why: string }>();
  /** 已知耕种操作在同片区域的失败账；换地点或找到可核验土格后放行。 */
  private localFarmFailures: Array<{
    at: number; why: string; from: { x: number; y: number; z: number; dimension: string };
  }> = [];
  /** 相邻目标从同一站位反复走不通；不可站的目标格跨站位记忆。 */
  private spatialFailures: Array<{
    count: number; at: number; why: string; dimension: string;
    target: { x: number; y: number; z: number };
    from: { x: number; y: number; z: number };
  }> = [];
  /** 位置与移动状态未变时，重复提交同一个单步 goto 的短窗口。 */
  private readonly recentGotoRequests = new Map<string, number>();
  private readonly inspections = new InspectionGuard();
  /** 定向 find 在起点命中同一可见物、实际未行军时，不让同地重复观测刷成进展。 */
  private readonly unmovedFindHits = new Map<string, {
    at: number; dimension: string; from: { x: number; y: number; z: number };
  }>();
  /** 已看见但尚未成熟的同一片作物；龄期变化或移动到新田地便重新观察。 */
  private readonly immatureFindHits = new Map<string, {
    at: number; stamp: string; from: { x: number; y: number; z: number };
  }>();
  private readonly navigationBursts = new Map<string, {
    times: number[]; dimension: string; from: { x: number; y: number; z: number }; lastAlertAt: number;
  }>();
  /** Repeated negative observations are evidence that a nearby search area is exhausted. */
  private readonly emptyFinds = new Map<string, {
    count: number; at: number; until: number; from: { x: number; y: number; z: number };
  }>();
  /** Tests and deployments without a data directory keep the same in-memory guard. */
  private readonly directionalSweeps: DirectionalSweepBook;
  /** 同一目的地反复快速自停的短期账；仅限制再次受理，不妨碍 mc_stop 本身。 */
  private readonly rapidStops = new Map<string, { times: number[]; until: number }>();
  /** 跨任务的过早叫停滚动账；一次改主意后先让下一单跑出结局。 */
  private earlyStops: number[] = [];
  /** 同一容器同种物品的反向转移账。 */
  private storageIntents: Array<{ kind: 'take' | 'stow'; item: string; source: string; at: number; x: number; y: number; z: number; dimension: string }> = [];
  private storageOscillationHold: Array<{ item: string; source: string; until: number; x: number; y: number; z: number; dimension: string }> = [];
  /** 受阻理由的滚动账:归并键 → 发生时刻(见 blockedHeadline;头条只报次数,不留原文) */
  private readonly blockedReasons = new Map<string, { at: number[] }>();
  /**
   * 受阻原文按新到旧保留最近 BLOCKED_LOG_MAX 条，供只读查询使用。
   * blockedReasons 使用去坐标的归并键计数，此处保留完整原因。
   */
  private readonly blockedRecords: BlockedRecord[] = [];
  /** Real sightings are short-lived context, not PWSR or persisted memory. */
  private readonly findHistory = new FindObservationCache();
  /**
   * 重生锚闸的确认单槽:上一次被拦下的那一单是什么、什么时候拦的。
   * 原样重发即确认(见 SPAWN_CONFIRM_WINDOW_MS);换了单就换这一槽。
   */
  private spawnConfirm: { key: string; at: number } | null = null;
  /**
   * 「包快满了」这条提醒的击发状态:true = 还没报过,跌破就报;报完置 false,
   * 空位回到 BAG_LOW_FREE 以上再重新上膛(见 `bagLowNote`)。
   */
  private bagLowArmed = true;

  constructor(private readonly opts: ExecutorOptions) {
    this.directionalSweeps = opts.directionalSweeps ?? new DirectionalSweepBook(null);
  }

  /** 当前任务在做什么;空闲为 null */
  get current(): string | null {
    return this.task ? labelOf(this.task) : null;
  }

  /** 当前任务(带任务号与已跑时长);空闲为 null */
  get currentTask(): { id: number; label: string; elapsedMs: number } | null {
    const t = this.task;
    return t ? { id: t.id, label: labelOf(t), elapsedMs: Date.now() - t.startedAt } : null;
  }

  /** Routine nutrition must not queue another meal behind an existing eat step. */
  hasPendingEat(): boolean {
    return [this.task, this.frozen, ...this.queue].some((task) =>
      task?.steps.some((step) => step.skill === 'eat'));
  }

  status(): QueueStatus {
    const t = this.task;
    const p = this.opts.getBot()?.entity?.position;
    return {
      running: t
        ? {
            id: t.id,
            label: labelOf(t),
            step: t.program?.name ?? describeSkill(t.steps[Math.min(t.stepIndex, t.steps.length - 1)]),
            stepIndex: t.stepIndex,
            stepCount: t.program ? 1 : t.steps.length,
            elapsedMs: Date.now() - t.stepStartedAt,
            taskElapsedMs: Date.now() - t.startedAt,
            count: t.count,
            pos: p ? { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) } : null,
          }
        : null,
      waiting: [
        ...(this.frozen ? [{ id: this.frozen.id, label: `${labelOf(this.frozen)}(被打断,待续)` }] : []),
        ...this.queue.map((q) => ({ id: q.id, label: labelOf(q)
          + (q.checkpointContinuation ? '(检查点待续)' : q.checkpointOwnerId !== undefined ? '(等待检查点)' : '') })),
        ...(this.checkpointDrain?.continuation
          ? [{ id: this.checkpointDrain.continuation.id,
            label: `${labelOf(this.checkpointDrain.continuation)}(检查点收尾后待续)` }] : []),
      ],
      // 与受理句读同一份来源(见 submit 里的 hold),两处不再各说各的
      hold: this.holdReason() ?? this.opts.busyWith?.() ?? null,
    };
  }

  /** 延迟提示只属于原执行实例；完工、追加、冻结或取消后旧提示失效。 */
  queueTailStatus(notice: TaskQueueTail): QueueStatus | null {
    const task = this.task;
    if (this.stopped || !task || task.queueTailNotice !== notice || task.flag.aborted
      || task.flag.epoch !== this.executionEpoch || task.stepIndex !== task.steps.length - 1
      || this.queue.length > 0 || this.frozen || this.holdReason() !== null || this.opts.busyWith?.()) return null;
    return this.status();
  }

  /** 挂钟时刻 HH:MM:SS。一场就是一天,不带日期 */
  private clock(ms: number): string {
    return nowIso(this.opts.timezone ?? 'Asia/Shanghai', new Date(ms)).slice(11, 19);
  }

  /** 仅供 mc_do 受理前使用；不改队列，也不为其他工具设置全局退避。 */
  repeatSuccessHold(steps: readonly SkillCall[], config: {
    enabled: boolean; skillsCsv: string; maxSuccesses: number; windowMinutes: number;
  }, now = Date.now()): string | null {
    if (!config.enabled || typeof config.skillsCsv !== 'string'
      || !Number.isFinite(config.windowMinutes) || config.windowMinutes <= 0
      || !Number.isFinite(config.maxSuccesses) || config.maxSuccesses < 1) return null;
    const allowed = new Set(config.skillsCsv.split(',').map((skill) => skill.trim()));
    const windowMs = config.windowMinutes * 60_000;
    for (const target of steps) {
      if (!allowed.has(target.skill)
        || ['attack', 'flee', 'surface', 'eat', 'chat'].includes(target.skill)
        || ('dryRun' in target && target.dryRun === true)) continue;
      const recent = (this.successfulIntents.get(taskSignature([target])) ?? [])
        .filter((at) => now - at < windowMs);
      if (recent.length < config.maxSuccesses) continue;
      const until = recent[recent.length - config.maxSuccesses] + windowMs;
      const localUntil = nowIso(this.opts.timezone ?? 'Asia/Shanghai', new Date(until))
        .replace('T', ' ').slice(0, 19);
      return `[mc_do 暂缓] ${config.windowMinutes} 分钟内目标技能「${describeSkill(target)}」成功 ${recent.length} 次，`
        + `同类新任务到 ${localUntil} 可再受理。当前任务和队列保留，其他目标技能照常可用`;
    }
    return null;
  }

  private noteSuccessfulIntent(step: SkillCall, at: number): void {
    for (const [key, times] of this.successfulIntents) {
      const recent = times.filter((time) => at - time < MAX_REPEAT_SUCCESS_WINDOW_MS);
      if (recent.length > 0) this.successfulIntents.set(key, recent);
      else this.successfulIntents.delete(key);
    }
    if ('dryRun' in step && step.dryRun === true) return;
    const key = taskSignature([step]);
    this.successfulIntents.set(key, [...(this.successfulIntents.get(key) ?? []), at]);
  }

  /** Records a proven admission failure without modifying or starting queued work. */
  noteAdmissionRejection(steps: readonly SkillCall[], rule: string, text: string): TaskAdmissionRejection {
    const p = this.opts.getBot()?.entity?.position;
    const calls = p ? freezeFirstStep([...steps], {
      x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z),
    })?.steps ?? steps : steps;
    const count = this.recordExactOutcome(calls, true, text, rule);
    return { kind: count && count > 1 ? 'repeat' : 'correction', rule };
  }

  /**
   * replace 撤销待办并接在当前任务后；append 排尾；now 中断当前任务并排首。
   * afterCheckpoint 在原子动作检查点让位，短任务之后以原任务 ID 续做。
   * 回执说明撤销与中断对象；身体仍被自保持有时继续排队。
   * wrote 仅用于与解析、冻结后的步骤比较，差异按字段回念，无原文则完整回念。
   */
  submit(steps: SkillCall[], mode: QueueMode = 'replace', wrote?: unknown,
    onDecision?: (accepted: boolean, retryAfterMs?: number, completedImmediately?: true,
      rejection?: TaskAdmissionRejection, taskId?: number) => void, beforeEnqueue?: () => void): string {
    const decision = this.submitDetailed(steps, mode, wrote, beforeEnqueue);
    onDecision?.(decision.accepted, decision.retryAfterMs, decision.completedImmediately, decision.rejection, decision.taskId);
    return decision.receipt;
  }

  enqueueProgram(program: ExecutorProgram): number {
    if (this.stopped) throw new Error('World 未启动');
    const id = this.opts.nextId();
    this.queue.push({ id, steps: [], program, enqueuedAt: Date.now() });
    this.opts.diag?.write({ lane: 'task', event: 'enqueue', taskId: id,
      msg: `受理原生程序「${program.name}」`, data: { mode: 'append' } });
    this.pump();
    return id;
  }

  submitDetailed(steps: SkillCall[], mode: QueueMode = 'replace', wrote?: unknown,
    beforeEnqueue?: () => void): TaskAdmissionDecision {
    if (this.stopped) return { receipt: '[mc_do 失败] World 未启动', accepted: false,
      rejection: { kind: 'wait', rule: 'world.stopped' } };
    const at = Date.now();
    // 首步的相对锚点按受理位置冻结；后续步骤仍按各自执行时的位置解析。
    const p = this.opts.getBot()?.entity?.position;
    const frozen = p ? freezeFirstStep(steps, { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }) : null;
    const calls = frozen?.steps ?? steps;
    const satisfiedGoto = this.satisfiedGotoReceipt(calls);
    if (satisfiedGoto) return {
      receipt: `[${this.clock(at)}] ${satisfiedGoto}`, accepted: true, completedImmediately: true,
    };
    const id = this.opts.nextId();
    const task: QueuedTask = { id, steps: [...calls], enqueuedAt: at,
      priorContext: this.priorOutcomeContext(calls) ?? undefined };
    const emptyFindHold = this.emptyFindNote(task.steps, at);
    const directionalSweep = this.directionalSweepNote(task.steps, at);
    const directionalSweepHold = directionalSweep?.refuse ? directionalSweep.text : null;
    const immatureFindHold = this.immatureFindNote(task.steps, at);
    const unmovedFindHold = this.unmovedFindNote(task.steps, at);
    const navigationBurst = emptyFindHold || directionalSweepHold || immatureFindHold || unmovedFindHold
      ? null : this.navigationBurstNote(task.steps, at);
    const botForInspection = this.opts.getBot();
    const inspectionHold = botForInspection
      ? this.inspections.block(task.steps, normalizeDimension(dimensionOf(botForInspection)), at) : null;
    const farmingHold = this.localFarmFailureNote(task.steps, at);
    // 对当前已加载且不会被前置步骤改变的土格，试算已有确定的否定结论。
    // 直接拒收，避免把一次已知必败的锄地+种地拆成两条零秒失败，再驱动快速重试。
    const soilPrecheckHold = this.definiteSoilPrecheckNote(task.steps);
    const takeEvidenceHold = this.takeEvidenceNote(task.steps, at);
    const namedTakeHold = namedTakeRetryKey(task.steps, this.opts.getBot())
      ? this.repeatFailedTaskNote(task.steps, at) : null;
    const storageCycleHold = this.storageCycleNote(task.steps);
    const storageAccessHold = storageCycleHold ? null : this.storageAccessNote(task.steps);
    // 受理刻驳回排在入队之前：队列一个字都不动；前置试算只报现场否定，不改变执行。
    const refusal = (text: string | null | undefined, rule: string,
      kind: TaskAdmissionRejection['kind'] = 'wait') => text ? { text, rule, kind } : null;
    const refused = refusal(emptyFindHold?.text, 'find.empty', 'repeat')
      ?? refusal(directionalSweepHold, 'find.sweep', 'repeat')
      ?? refusal(immatureFindHold, 'find.immature')
      ?? refusal(unmovedFindHold, 'find.unmoved', 'repeat')
      ?? refusal(navigationBurst, 'navigation.burst', 'repeat')
      ?? refusal(inspectionHold?.text, 'inspection.wait')
      ?? refusal(farmingHold, 'farm.failed', 'repeat')
      ?? refusal(soilPrecheckHold?.text, 'farm.soil', 'correction')
      ?? refusal(namedTakeHold, 'task.failed', 'repeat')
      ?? refusal(takeEvidenceHold?.text, `take.${takeEvidenceHold?.proof}`, 'correction')
      ?? refusal(storageCycleHold, 'storage.cycle', 'repeat')
      ?? refusal(this.duplicatePendingNote(task.steps), 'queue.pending')
      ?? refusal(this.storageOscillationNote(task.steps, at), 'storage.oscillation', 'repeat')
      ?? refusal(this.fullOpenStorageNote(task.steps, at), 'storage.full', 'repeat')
      ?? refusal(this.spawnGuardNote(task.steps, at), 'spawn.protected')
      ?? refusal(this.gravityGuardNote(task.steps), 'build.gravity')
      ?? refusal(this.rapidStopNote(task.steps, at), 'task.rapidStop', 'repeat')
      ?? refusal(this.activeCombatAttackNote(task.steps, mode), 'combat.active')
      ?? refusal(this.immediateAttackTargetNote(task.steps, mode), 'attack.noTarget', 'correction')
      ?? refusal(this.pendingAttackPlanNote(task.steps, mode), 'combat.pending')
      ?? refusal(this.repeatStationaryGotoNote(task.steps, botForInspection, at), 'goto.stationary', 'repeat')
      ?? refusal(this.spatialFailureNote(task.steps, at), 'navigation.failed', 'repeat')
      ?? refusal(storageAccessHold, 'storage.access', 'correction')
      ?? refusal(this.staleKnownContainerUseNote(task.steps), 'use.staleContainer', 'correction')
      ?? refusal(this.opts.admissionCheck?.(task.steps) ?? null, 'extension.admission', 'correction')
      ?? refusal(this.protectedTossNote(task.steps), 'toss.protected')
      ?? refusal(this.reacquiredTossNote(task.steps), 'toss.reacquired', 'repeat')
      ?? refusal(this.bulkUnanchoredTossNote(task.steps), 'toss.unanchored')
      ?? refusal(this.missingStowItemNote(task.steps), 'stow.missingItem', 'correction')
      ?? refusal(this.missingUseItemNote(task.steps), 'use.missingItem', 'correction')
      ?? refusal(this.impossibleCraftStartNote(task.steps), 'craft.invalid', 'correction')
      ?? refusal(this.fullInventoryGridCraftNote(task.steps), 'craft.capacity', 'correction')
      ?? refusal(this.fullInventoryTakeNote(task.steps), 'take.capacity', 'correction')
      ?? refusal(this.tunnelLiquidStopNote(task.steps, at), 'tunnel.liquid', 'repeat')
      ?? refusal(this.tunnelSupportStopNote(task.steps, at), 'tunnel.support', 'repeat')
      ?? refusal(this.verticalTunnelOscillationNote(task.steps, at), 'tunnel.oscillation', 'repeat')
      ?? refusal(this.repeatEmptyProbeNote(task.steps, at), 'probe.empty', 'repeat')
      // Later steps observe the world after their predecessors actually finish.
      ?? refusal(this.unseenCollectNote(task.steps.slice(0, 1), at), 'collect.unseen', 'repeat')
      ?? refusal(this.immatureCollectNote(task.steps, at), 'collect.immature')
      ?? refusal(this.repeatFailedTaskNote(task.steps, at), 'task.failed', 'repeat');
    const echo = echoDiff(task.steps, wrote);
    const echoText = [echo.hoist, echo.tail].filter(Boolean).join('。');
    if (refused) {
      let kind = refused.kind;
      if (kind === 'correction') {
        const evidenceSteps = soilPrecheckHold && refused.rule === 'farm.soil'
          ? [soilPrecheckHold.step]
          : takeEvidenceHold && refused.rule === `take.${takeEvidenceHold.proof}`
            ? [takeEvidenceHold.step] : task.steps;
        kind = this.noteAdmissionRejection(evidenceSteps, refused.rule, refused.text).kind;
      }
      return {
      receipt: `[${this.clock(at)}] 这一单我没接:${refused.text}${echoText ? `\n${echoText}` : ''}`,
      accepted: false,
      rejection: { kind, rule: refused.rule },
      ...(emptyFindHold ? { retryAfterMs: emptyFindHold.retryAfterMs }
        : directionalSweepHold ? { retryAfterMs: 45_000 }
        : immatureFindHold ? { retryAfterMs: 45_000 }
        : navigationBurst ? { retryAfterMs: NAVIGATION_BURST_COOLDOWN_MS }
        : inspectionHold ? { retryAfterMs: inspectionHold.retryAfterMs }
          : farmingHold ? { retryAfterMs: 8_000 }
          : soilPrecheckHold ? {}
          : takeEvidenceHold ? { retryAfterMs: takeEvidenceHold.retryAfterMs }
             : storageCycleHold || storageAccessHold ? { retryAfterMs: 5_000 } : {}),
      };
    }
    // 受理了才进打转账;没接的那几单不算她"下过一次"。快照要在 pump 之前取
    const sig = taskSignature(task.steps);
    const round = this.noteSubmitted(sig, at, id);
    this.noteStorageIntent(task.steps, at);
    if ([3, 6, 10].includes(round.times)) {
      this.opts.diag?.write({ lane: 'task', event: 'repeated-intent', taskId: id,
        msg: `15 分钟内第 ${round.times} 次提交同类任务，保留现场供复盘`, incident: true,
        data: { signature: sig, times: round.times, spanMs: round.spanMs,
          ranBefore: round.ranBefore, position: p ? { x: p.x, y: p.y, z: p.z } : null } });
    }
    // 受理刻试算必须冻结在开工前。equip 会同步把装备移出背包，开工后重读会误报缺货。
    const precheck = this.precheckNote(task.steps);
    // Release an idle body only after admission, before the new task can start.
    beforeEnqueue?.();
    const dropped = mode === 'replace' ? this.queue.splice(0) : [];
    // queue:"now" = 手上的事全放下,战斗也一样。先让战斗交还身体(挂起的那件会被
    // resume 放回队头),再 interrupt 掐掉手上这件,最后这一单插到队头 —— 顺序反了
    // 就会是"刚解冻的旧任务排在急件前面"。
    const combatCut = mode === 'now' ? this.opts.stopCombat?.(task.steps[0]) ?? null : null;
    const cut = mode === 'now' ? this.interrupt() : null;
    if (mode === 'afterCheckpoint') {
      const owner = this.task ?? this.frozen;
      task.checkpointRequest = true;
      task.checkpointOwnerId = owner?.id;
      const last = this.queue.reduce((found, queued, index) => queued.checkpointRequest ? index : found, -1);
      this.queue.splice(last + 1, 0, task);
      if (owner) this.opts.diag?.write({ lane: 'task', event: 'yield-pending', taskId: owner.id,
        msg: `任务#${id} 等待任务#${owner.id} 的安全检查点`,
        data: { requestId: id, ownerTaskId: owner.id } });
    } else if (mode === 'now') this.queue.unshift(task);
    else this.queue.push(task);
    const ahead = this.queue.indexOf(task) + (this.task ? 1 : 0) + (this.frozen ? 1 : 0);
    this.opts.diag?.write({
      lane: 'task', event: 'enqueue', taskId: id,
      msg: `受理任务#${id}「${labelOf(task)}」(${mode},前面还有 ${ahead} 件)`,
      data: {
        steps, mode, ahead, cut,
        dropped: dropped.map((d) => ({ id: d.id, label: labelOf(d) })),
      },
    });
    // 缺省的 replace 撤掉的那几件各补一条结局:受理回执点名只活在这一个上下文窗口里
    for (const d of dropped) this.reportCancelled(d, `新任务#${id} 顶替`, Executor.frozenProgress(d));
    this.pump();
    // 身体被战斗占着时如实说"排上了":此刻队列闸着,说"已开始"就是说假话。
    // 普通急件不能夺走低血自保；即时进食或撤离可由战斗层交还身体。
    // 交还动作之后重读 busyWith，避免把实际仍在排队的急件说成已经开跑。
    const hold = this.holdReason() ?? this.opts.busyWith?.() ?? null;
    /* 受理回执只说明收下或排队状态，不宣称完成，也不估计无依据的任务时长。 */
    const place = task.checkpointOwnerId !== undefined
      ? `任务#${id} 收下了,等待任务#${task.checkpointOwnerId} 的安全检查点;短任务之后原任务续做`
      : hold !== null
      ? `任务#${id} 排上了(${hold},腾出手就做${ahead > 0 ? `,前面还有 ${ahead} 件` : ''})`
      : ahead === 0
        // 入队回执注明首步内容；各步实际结果由后续事件报告。
        ? `任务#${id} 收下了,排在第 1/${task.steps.length} 步:${describeSkill(task.steps[0])}`
        : mode === 'now'
          ? `任务#${id} 插到队头,前面只剩 ${ahead} 件`
          : `任务#${id} 排进队尾,前面还有 ${ahead} 件`;
    const notes = [
      // 她自己圈过的危险区排在这一组最前面:这是关于世界的事实,别的几句是关于队列的
      this.dangerNote(task.steps),
      // 战斗被这一单打断了:照实说一句,别让"怎么突然不打了"成为她要自己解释的事
      combatCut ? `战斗被这单打断了(刚才${combatCut},已经放开手)` : null,
      mode !== 'now' && !this.holdReason() && this.opts.busyWith?.()
        ? '本单尚未执行。立即进食或撤离可用 queue:"now" 插队；默认 replace 会撤销排队中的旧任务，append 则继续等待'
        : null,
      cut,
      dropped.length > 0
        ? `撤掉了排在后面的 ${dropped.map((d) => `任务#${d.id}「${labelOf(d)}」`
          + (dropped.every((queued) => queued.startedAt === undefined) ? ''
            : d.startedAt === undefined ? '(还没轮到跑第 1 步)' : '(已执行断点已撤)')).join('、')}`
          + (dropped.every((queued) => queued.startedAt === undefined) ? '(都还没轮到跑第 1 步)' : '')
        : null,
      // 差异回念之外，注明首步冻结所用原点及后续步骤仍延迟解析。
      frozen?.changed
        ? `第 1 步的 ~ 是按你下这一单时站的地方 ${cellText(frozen.origin)} 算的(后面各步还是到做那一刻再算)`
        : null,
      // 带 direction 的 find 会行军；受理时报告距离及走满后的重生点距离。
      this.marchNote(task.steps),
      directionalSweep?.refuse === false ? directionalSweep.text : null,
      // 长途 goto 的空间代价:直线多远、走路要多久。原点用她下这一单时站的那一格
      // (与第 1 步锚点冻结同源),不是 pump 之后的位置
      this.hikeNote(task.steps, frozen?.origin ?? null),
    ].filter(Boolean);
    /** 回执先列重要现场事实和警告，受理状态置后。 */
    const warn = [
      // 受理试算只读并报告否定结果，不改变执行。
      precheck,
      // 同一件事上次的下场:补的是已经滑出上下文的那一段
      this.priorNote(task, at, round) ?? repeatedSubmissionNote(round),
      // 相对锚点转为绝对坐标的差异优先呈现。
      echo.hoist,
    ].filter(Boolean);
    const receipt = `[${this.clock(at)}] ${warn.length > 0 ? `⚠ ${warn.join(';')} → ` : ''}` +
      `${place}。${echo.tail ?? ''}` +
      `${notes.length > 0 ? `\n${notes.join(';')}。` : ''}`;
    return { receipt, accepted: true, taskId: id };
  }

  /** 同一整单已经在途时不再入队；换坐标或数量的修正计划照常受理。 */
  private duplicatePendingNote(steps: readonly SkillCall[]): string | null {
    const key = exactTaskKey(steps);
    const active = this.task;
    if (active && exactTaskKey(active.steps) === key) {
      return `任务#${active.id} 正在做同一整单；等完成或受阻回执后再决定。原任务与队列保留`;
    }
    const pending = [this.frozen, this.checkpointDrain?.continuation, ...this.queue]
      .find((task) => task && exactTaskKey(task.steps) === key);
    return pending ? `任务#${pending.id} 已在队列里；等它执行后再决定。原任务与队列保留` : null;
  }

  private navigationBurstNote(steps: readonly SkillCall[], now: number): string | null {
    if (!steps.some((step) => step.skill === 'find')) return null;
    const bot = this.opts.getBot();
    const pos = bot?.entity?.position;
    if (!bot || !pos) return null;
    const planned = lastAbsoluteGoto(steps);
    if (planned && Math.hypot(planned.x - pos.x, planned.y - pos.y, planned.z - pos.z)
      >= NAVIGATION_BURST_RESET_DISTANCE) return null;
    for (const [key, entry] of this.navigationBursts) {
      if (now - entry.times.at(-1)! > NAVIGATION_BURST_WINDOW_MS) this.navigationBursts.delete(key);
    }
    const key = navigationIntentKey(steps);
    const dimension = dimensionOf(bot);
    let entry = this.navigationBursts.get(key);
    if (!entry || entry.dimension !== dimension
      || Math.hypot(pos.x - entry.from.x, pos.y - entry.from.y, pos.z - entry.from.z) >= NAVIGATION_BURST_RESET_DISTANCE) {
      entry = { times: [], dimension, from: { x: pos.x, y: pos.y, z: pos.z }, lastAlertAt: 0 };
      this.navigationBursts.set(key, entry);
    }
    entry.times = entry.times.filter((time) => now - time <= NAVIGATION_BURST_WINDOW_MS);
    entry.times.push(now);
    const rapid = entry.times.filter((time) => now - time <= 20_000).length;
    if (rapid < 3 && entry.times.length < 6) return null;
    if (now - entry.lastAlertAt > NAVIGATION_BURST_COOLDOWN_MS) {
      entry.lastAlertAt = now;
      this.opts.diag?.write({ lane: 'task', event: 'navigation-burst', incident: true,
        msg: '同一位置连续提交同一寻路或观察计划，暂缓新任务',
        data: { key, attempts: entry.times.length, rapid, position: entry.from, dimension } });
    }
    return `同一寻路或观察计划从这片区域已提交 ${entry.times.length} 次，位置仍未移动 ${NAVIGATION_BURST_RESET_DISTANCE} 格；这次不改队列。等原任务结局，或换目标/实际站位后再试`;
  }

  private emptyFindKey(target: string, dimension: string): string {
    return `${dimension}\0${target.trim().toLowerCase()}`;
  }

  /** 搜索历史注明实际路线；仅短期同起点、同方向且未延长的请求暂缓。 */
  private directionalSweepNote(steps: readonly SkillCall[], now: number): { text: string; refuse: boolean } | null {
    const i = steps.findIndex((step) => step.skill === 'find');
    if (i < 0 || steps.slice(0, i).some((step) => step.skill !== 'goto')) return null;
    const find = steps[i];
    const bot = this.opts.getBot();
    if (!bot?.entity || find.skill !== 'find') return null;
    const prefix = steps.slice(0, i);
    const precedingGoto = [...prefix].reverse().find((step) => step.skill === 'goto');
    const from = i === 0 ? feetOf(bot)
      : precedingGoto?.skill === 'goto' && !precedingGoto.groundY ? lastAbsoluteGoto(prefix) : null;
    // 后续相对锚点和二维目的地的到达位置尚未确定，不能套用当前位置的历史。
    if (!from) return null;
    const recent = this.directionalSweeps.recent(now, DIRECTIONAL_SWEEP_HOLD_MS);
    const nearby = recent.filter((entry) =>
      entry.dimension === dimensionOf(bot)
      && entry.target === find.target.trim().toLowerCase()
      && Math.hypot(from.x - entry.from.x, from.z - entry.from.z) <= DIRECTIONAL_SWEEP_EVIDENCE_RADIUS);
    if (nearby.length === 0) return null;
    const stamp = (at: number): string => nowIso(this.opts.timezone ?? 'Asia/Shanghai', new Date(at))
      .replace('T', ' ').slice(0, 19);
    const evidence = (entry: typeof nearby[number]): string =>
      `${stamp(entry.at)} 从 ${cellText(entry.from)} 朝${DIRECTION_ZH[entry.direction]}走满 ${entry.distance} 格，未命中${zhThing(find.target)}`;
    const prior = [...nearby].reverse().find((entry) =>
      now - entry.at < DIRECTIONAL_SWEEP_REPEAT_MS
      && entry.direction === find.direction
      && find.distance <= entry.distance
      && from.x === entry.from.x && from.y === entry.from.y && from.z === entry.from.z);
    if (prior) return { refuse: true,
      text: `计划起点 ${cellText(from)}；${evidence(prior)}。本次同起点、同方向且声明距离未扩大，`
        + `暂缓相同路线至 ${stamp(prior.at + DIRECTIONAL_SWEEP_REPEAT_MS)}；原队列保留` };
    const shown = [...nearby].reverse().slice(0, 3);
    return { refuse: false,
      text: `搜索历史（计划起点 ${cellText(from)}，附近 ${nearby.length} 条记录${nearby.length > shown.length ? '，列最近 3 条' : ''}）：`
        + shown.map(evidence).join('；') + '。这些是已完成路线的历史读数' };
  }

  private recordDirectionalSweeps(task: RunningTask): void {
    const bot = this.opts.getBot();
    if (!bot) return;
    const now = Date.now();
    for (const landed of task.stepLog) {
      const i = landed.step - 1;
      const step = task.steps[i];
      const from = task.findOrigins?.get(i);
      if (step?.skill !== 'find' || !step.direction || !from || landed.outcome !== 'ok'
        || !landed.line.includes('走满了') || !landed.line.includes('一路没看见')) continue;
      this.directionalSweeps.record({
        at: now, dimension: dimensionOf(bot), target: step.target.trim().toLowerCase(),
        direction: step.direction, from, distance: step.distance,
      }, now, DIRECTIONAL_SWEEP_HOLD_MS);
    }
  }

  private emptyFindNote(steps: readonly SkillCall[], now: number): { text: string; retryAfterMs: number } | null {
    const find = steps.find((step): step is Extract<SkillCall, { skill: 'find' }> => step.skill === 'find');
    const bot = this.opts.getBot();
    const pos = bot?.entity?.position;
    if (!find || !bot || !pos) return null;
    const key = this.emptyFindKey(find.target, dimensionOf(bot));
    const entry = this.emptyFinds.get(key);
    if (!entry || entry.until <= now) return null;
    const outside = (point: { x: number; y: number; z: number }): boolean =>
      Math.hypot(point.x - entry.from.x, point.y - entry.from.y, point.z - entry.from.z)
      >= EMPTY_FIND_REGION_DISTANCE;
    const planned = lastAbsoluteGoto(steps);
    if (outside(pos) || (planned && outside(planned))) return null;
    // The hold applies only to this search intent; other tasks remain available.
    const retryAfterMs = Math.min(entry.until - now, 8_000);
    return {
      text: `这片区域已连续 ${entry.count} 次没找到${zhThing(find.target)}，继续逐格移动或改变搜索半径不会得到新线索。`
        + `暂缓在周围 ${EMPTY_FIND_REGION_DISTANCE} 格内重复找它；去建筑入口、远处新区域，或改做其他任务`,
      retryAfterMs,
    };
  }

  private recordEmptyFindOutcomes(task: RunningTask): void {
    const bot = this.opts.getBot();
    if (!bot?.entity?.position) return;
    const now = Date.now();
    const dimension = dimensionOf(bot);
    for (const landed of task.stepLog) {
      const stepIndex = landed.step - 1;
      const step = task.steps[stepIndex];
      if (step?.skill !== 'find' || landed.outcome !== 'ok') continue;
      const key = this.emptyFindKey(step.target, dimension);
      if (!landed.line.includes('没看见')) {
        this.emptyFinds.delete(key);
        continue;
      }
      // A directional find may finish 64 blocks from its start. Count searches
      // from the origin so returning home does not erase the failed sweep.
      const pos = task.findOrigins?.get(stepIndex) ?? bot.entity.position;
      const prior = this.emptyFinds.get(key);
      const nearby = prior && now - prior.at <= EMPTY_FIND_WINDOW_MS
        && Math.hypot(pos.x - prior.from.x, pos.y - prior.from.y, pos.z - prior.from.z)
          < EMPTY_FIND_REGION_DISTANCE;
      const count = nearby ? prior.count + 1 : 1;
      this.emptyFinds.set(key, {
        count, at: now, until: count >= 3 ? now + EMPTY_FIND_HOLD_MS : 0,
        from: nearby ? prior.from : { x: pos.x, y: pos.y, z: pos.z },
      });
      if (this.emptyFinds.size > 64) this.emptyFinds.delete(this.emptyFinds.keys().next().value!);
    }
  }

  private storageIntentsOf(steps: readonly SkillCall[], at: number) {
    // 开窗前可以有 goto，开窗后也可能连续存多样物品；逐步找实际来源，
    // 才能识别「开包→取出→开包→存回」及夹着其他存物步骤的倒货循环。
    const bot = this.opts.getBot();
    const pos = bot?.entity?.position;
    if (!bot || !pos) return [];
    let source = 'local';
    const intents: typeof this.storageIntents = [];
    for (const step of steps) {
      if (step.skill === 'use') {
        source = step.item ? `item:${step.item.toLowerCase()}`
          : step.at ? `block:${JSON.stringify(step.at)}` : 'local';
      } else if (step.skill === 'chat' && step.text.startsWith('/')) {
        source = `command:${step.text.toLowerCase()}`;
      } else if ((step.skill === 'take' || step.skill === 'stow') && step.item) {
        const fromOpen = step.skill === 'take' ? step.from === 'open' : step.into === 'open';
        if (fromOpen && source === 'local') continue;
        intents.push({ kind: step.skill, item: step.item, source: fromOpen ? source : 'local',
          at, x: pos.x, y: pos.y, z: pos.z, dimension: normalizeDimension(dimensionOf(bot)) });
      }
    }
    return intents;
  }

  /** A take followed by an equal or smaller stow into the same container frees no bag slot. */
  private storageCycleNote(steps: readonly SkillCall[]): string | null {
    const bot = this.opts.getBot();
    if (!bot || steps.some((step) => step.skill === 'compact')) return null;
    const containerAt = (at: Anchor): string | null => {
      try {
        const p = resolveAt(bot, at);
        return `block:${normalizeDimension(dimensionOf(bot))}:${p.x},${p.y},${p.z}`;
      } catch { return null; }
    };
    let opened: string | null = null;
    const taken = new Map<string, Array<{ source: string; count: number }>>();
    for (const step of steps) {
      if (step.skill === 'use') {
        opened = step.at ? containerAt(step.at) : step.item ? `item:${step.item.toLowerCase()}` : null;
      } else if (step.skill === 'chat' && step.text.startsWith('/')) {
        opened = `command:${step.text.toLowerCase()}`;
      } else if (step.skill === 'take' && step.item) {
        const source = step.at ? containerAt(step.at) : step.from === 'open' ? opened : null;
        if (source) taken.set(step.item, [...(taken.get(step.item) ?? []),
          { source, count: step.count ?? 1 }]);
      } else if (step.skill === 'stow') {
        const destination = step.at ? containerAt(step.at) : step.into === 'open' ? opened : null;
        const prior = taken.get(step.item) ?? [];
        if (destination && prior.length > 0 && prior.every((part) => part.source === destination)
          && prior.reduce((sum, part) => sum + part.count, 0) >= step.count) {
          return `本单从同一容器取出${zhName(step.item)}又存回不多于取出的数量，无法保证随身净腾出一格。若要压缩容器请用 compact；若要腾随身格，直接把原本随身的物品存到有余量的容器；原队列保留`;
        }
      }
    }
    return null;
  }

  private storageOscillationNote(steps: readonly SkillCall[], at: number): string | null {
    const items = this.opts.getBot()?.inventory?.items?.();
    const free = items ? Math.max(0, PLAYER_SLOTS - items.length) : null;
    const recovery = free !== null && free >= 6
      ? `随身还有 ${free} 格空位；若收纳目标只是腾出至少 6 格，现在已经达标，应结束收纳去做别的事。`
      : '若仍需腾位，先检查随身空格，再选另一处有空位的容器。';
    for (const next of this.storageIntentsOf(steps, at)) {
      const nearby = (other: { x: number; y: number; z: number; dimension: string }) =>
        other.dimension === next.dimension && Math.hypot(other.x - next.x, other.y - next.y, other.z - next.z) <= 5;
      this.storageOscillationHold = this.storageOscillationHold.filter((hold) => at < hold.until);
      if (this.storageOscillationHold.some((hold) => hold.item === next.item && hold.source === next.source && nearby(hold))) {
        return `同一地点的${zhName(next.item)}刚出现取出/存回循环，暂缓 10 分钟。${recovery}不要再从这口容器取出同种物品给它腾位`;
      }
      const recent = this.storageIntents.filter((entry) => at - entry.at < 30_000
        && entry.item === next.item && entry.source === next.source && nearby(entry));
      const last = recent.at(-1);
      if (last?.kind === 'take' && next.kind === 'stow') {
        this.storageOscillationHold.push({ item: next.item, source: next.source, until: at + 600_000,
          x: next.x, y: next.y, z: next.z, dimension: next.dimension });
        this.opts.diag?.write({ lane: 'task', event: 'storage-oscillation', incident: true,
          msg: `同一地点的${zhName(next.item)}出现取出/存回交替，暂停这类操作 10 分钟`,
          data: { item: next.item, source: next.source, position: { x: next.x, y: next.y, z: next.z }, dimension: next.dimension } });
        return `同一地点的${zhName(next.item)}已连续取出/存回，暂缓 10 分钟。${recovery}不要再从这口容器取出同种物品给它腾位`;
      }
    }
    return null;
  }

  private noteStorageIntent(steps: readonly SkillCall[], at: number): void {
    const intents = this.storageIntentsOf(steps, at);
    if (intents.length === 0) return;
    this.storageIntents = this.storageIntents.filter((entry) => at - entry.at < 30_000);
    this.storageIntents.push(...intents);
    if (this.storageIntents.length > 32) this.storageIntents.splice(0, this.storageIntents.length - 32);
  }

  /** An immediate attack needs a current target before it may cancel unrelated work. */
  private immediateAttackTargetNote(steps: readonly SkillCall[], mode: QueueMode): string | null {
    const first = steps[0];
    if (mode !== 'now' || first?.skill !== 'attack') return null;
    const bot = this.opts.getBot();
    if (!bot?.entity) return null;
    const target = findEntity(bot, first.target, 32, candidate => canSeeEntity(bot, candidate));
    return target ? null : `附近 32 格内没看见${zhEntity(first.target)}；即时攻击没有可执行目标，本次不打断当前任务或撤销待办。目标出现后再按现场决定`;
  }

  /** 反射战斗占着身体时，排尾攻击会在战后读到过时目标。 */
  private activeCombatAttackNote(steps: readonly SkillCall[], mode: QueueMode): string | null {
    return mode !== 'now' && steps.length > 0 && steps.every((step) => step.skill === 'attack')
      && this.opts.bodyState?.().combatActive
      ? '反射战斗正在处理附近敌人；主动攻击任务现在不接。等战斗结束后再观察现场，原队列保留'
      : null;
  }

  /** 一张攻击计划尚未结案时，新的排尾攻击只能堆积过时目标。 */
  private pendingAttackPlanNote(steps: readonly SkillCall[], mode: QueueMode): string | null {
    if (mode === 'now' || steps.length === 0 || !steps.every((step) => step.skill === 'attack')) return null;
    const active = this.task?.steps.every((step) => step.skill === 'attack') ? this.task : null;
    const pending = [this.frozen, ...this.queue].find((task) => task?.steps.every((step) => step.skill === 'attack'));
    const prior = active ?? pending;
    return prior ? `攻击任务#${prior.id} 还没结案；等它完成或受阻后重看敌人位置。原任务与队列保留` : null;
  }

  /** 已观测到的窗口和访问失败，不再作为当前存物计划的可用目标。 */
  private storageAlternativeNote(bot: Bot, wrong: Cell): string {
    const visible = findContainers(bot, 32)
      .filter((spot) => spot.x !== wrong.x || spot.y !== wrong.y || spot.z !== wrong.z)
      .slice(0, 3);
    if (visible.length) return `附近实际看见的容器: ${visible.map((spot) =>
      `${zhName(spot.name)}(${spot.x},${spot.y},${spot.z})`).join('、')}；请先核验容量与访问权限，不要逐格猜坐标`;
    const known = knownChestNote(bot, this.opts.chests);
    return known
      ? `32 格内没观察到容器；${known}。先去现场核验，不要逐格猜坐标`
      : '32 格内没观察到容器；先寻找或制作并放置储物箱，不要逐格猜坐标';
  }

  private storageAccessNote(steps: readonly SkillCall[]): string | null {
    const bot = this.opts.getBot();
    if (!bot) return null;
    let canHaveOpenWindow = Boolean(bot.currentWindow);
    for (const step of steps) {
      if ((step.skill === 'compact'
        || (step.skill === 'stow' && step.into === 'open')
        || (step.skill === 'take' && step.from === 'open')) && !canHaveOpenWindow) {
        return '当前没有打开容器窗口；单独 use 查看的窗口会在任务结束时自动关闭。请把 use 和 take/stow/compact 写在同一单连续步骤里，再操作 into/from:"open"；原队列保留';
      }
      if (step.skill === 'use' || (step.skill === 'chat' && step.text.startsWith('/'))) {
        canHaveOpenWindow = true;
      }
    }
    if (!steps.some((step) => step.skill === 'stow')) return null;
    let openedAt: { x: number; y: number; z: number } | null = null;
    for (const [stepIndex, step] of steps.entries()) {
      if (step.skill === 'use' && step.at) {
        try { openedAt = resolveAt(bot, step.at); }
        catch { openedAt = null; }
      }
      if (step.skill !== 'stow') continue;
      if (step.at !== undefined && step.into === 'open') {
        return 'stow 的 at 与 into:open 只能选一个；原队列保留';
      }
      if (step.at !== undefined) {
        try {
          const target = resolveAt(bot, step.at);
          const position = new Vec3(target.x, target.y, target.z);
          // 目标已在身边时先看真实方块；不要为了一个不可确认的箱子反复穿门寻路。
          // 若本单会先造容器，执行时再核验，不能用施工前的空气误拒收。
          if (!steps.some((part) => part.skill === 'build')
            && bot.entity?.position?.distanceTo(position) <= 16
            && typeof bot.blockAt === 'function') {
            const block = bot.blockAt(position);
            if (!block) {
              return `指定位置 (${target.x},${target.y},${target.z}) 已在附近，但方块还不可读，不能确认有储物箱；${this.storageAlternativeNote(bot, target)}；原队列保留`;
            }
            if (!CONTAINER_FIND.includes(block.name)) {
              this.opts.chests?.forget(dimensionOf(bot), target);
              return `指定位置 (${target.x},${target.y},${target.z}) 实际是${zhName(block.name)}，不是储物箱；${this.storageAlternativeNote(bot, target)}；原队列保留`;
            }
          }
          const earlier = steps.slice(0, stepIndex);
          const full = this.recentFullChestNote(bot, target, step.item, step.count, earlier);
          if (full) return full;
          const reason = storageSkipReason(bot, target,
            this.plannedFreeSlots(bot, target, earlier) > 0 ? undefined : step.item);
          if (reason) return `指定容器${reason}，当前不能存${zhName(step.item)}；原队列保留`;
        } catch { /* 坐标读数待执行时确认 */ }
        continue;
      }
      if (step.into === 'open' && openedAt) {
        const earlier = steps.slice(0, stepIndex);
        const full = this.recentFullChestNote(bot, openedAt, step.item, step.count, earlier);
        if (full) return full;
        const reason = storageSkipReason(bot, openedAt,
          this.plannedFreeSlots(bot, openedAt, earlier) > 0 ? undefined : step.item);
        if (reason) return `指定容器${reason}，当前不能存${zhName(step.item)}；原队列保留`;
      }
      if (step.into !== 'open') {
        const found = findContainers(bot, 32);
        if (found.length > 0 && found.every((spot) => storageSkipReason(bot, spot, step.item))) {
          return `附近可见容器都已有访问或存入失败记录，当前不能自动存${zhName(step.item)}。换站位或容器后可重试；原队列保留`;
        }
      }
    }
    return null;
  }

  /** 开旧箱前核对现场，避免账本残影把空手右键引向已经消失的容器。 */
  private staleKnownContainerUseNote(steps: readonly SkillCall[]): string | null {
    const bot = this.opts.getBot();
    if (!bot?.entity?.position || typeof bot.blockAt !== 'function') return null;
    for (const step of steps) {
      if (step.skill !== 'use' || !step.at || step.item) continue;
      let target: { x: number; y: number; z: number };
      try { target = resolveAt(bot, step.at); }
      catch { continue; }
      const dimension = dimensionOf(bot);
      if (!this.opts.chests?.get(dimension, target)) continue;
      const position = new Vec3(target.x, target.y, target.z);
      if (bot.entity.position.distanceTo(position) > 16) continue;
      const block = bot.blockAt(position);
      if (!block || CONTAINER_FIND.includes(block.name) || FURNACE_KINDS.has(block.name)) continue;
      this.opts.chests.forget(dimension, target);
      return `账本里的容器 (${target.x},${target.y},${target.z}) 现场已是${zhName(block.name)}；已清除过期记录，本单不右键，也不再为它寻路。重新 find chest 找真实容器，或换目标；原队列保留`;
    }
    return null;
  }

  /** A named take target must agree with loaded block data and a fresh window read. */
  private takeEvidenceNote(steps: readonly SkillCall[], now: number): {
    text: string; retryAfterMs: number; step: Extract<SkillCall, { skill: 'take' }>;
    proof: 'not-container' | 'missing-item';
  } | null {
    const bot = this.opts.getBot();
    if (!bot?.entity?.position || typeof bot.blockAt !== 'function') return null;
    for (const [index, step] of steps.entries()) {
      if (step.skill !== 'take' || !step.at) continue;
      // Earlier construction or item use may change this block or its contents.
      if (steps.slice(0, index).some((before) => before.skill === 'build'
        || before.skill === 'excavate' || before.skill === 'tunnel'
        || (before.skill === 'use' && Boolean(before.item))
        || before.skill === 'stow')) continue;
      let target: Cell;
      try { target = resolveAt(bot, step.at); }
      catch { continue; }
      if (Math.hypot(bot.entity.position.x - target.x, bot.entity.position.y - target.y,
        bot.entity.position.z - target.z) > 16) continue;
      const block = bot.blockAt(new Vec3(target.x, target.y, target.z));
      if (!block) continue; // An unloaded chunk is unknown, not proof of absence.
      if (!CONTAINER_FIND.includes(block.name) && !FURNACE_KINDS.has(block.name)
        && block.name !== 'brewing_stand') {
        this.opts.chests?.forget(dimensionOf(bot), target);
        return { text: `目标格 (${target.x},${target.y},${target.z}) 当前是${zhName(block.name)}，不是可取物容器。先 find chest 核对实际方块坐标；本单不入队，原队列保留`,
          retryAfterMs: 8_000, step, proof: 'not-container' };
      }
      if (!step.item) continue;
      const rec = this.opts.chests?.get(dimensionOf(bot), target);
      if (!rec?.observedAt || now - rec.observedAt > 30_000 || hasItem(rec, step.item, bot?.registry)) continue;
      return { text: `容器 (${target.x},${target.y},${target.z}) 最近开窗确认没有${zhName(step.item)}。先查看其他容器或重新核验内容；本单不入队，原队列保留`,
        retryAfterMs: 8_000, step, proof: 'missing-item' };
    }
    return null;
  }

  /** 只拒绝开工前已可证明失败的合成；后续取料、加工仍交给逐步试算。 */
  private impossibleCraftStartNote(steps: readonly SkillCall[]): string | null {
    for (const step of steps) {
      if (step.skill === 'craft' && step.grid && step.item) {
        return `合成同时写了 item 和 grid；实际只会按 grid 摆，item 会被忽略。若要做${zhName(step.item)}，只写 item 走官方配方；若要试自摆配方，只写 grid。原队列保留`;
      }
    }
    const first = steps[0];
    if (first?.skill !== 'craft' || this.opts.precheck?.() === false) return null;
    const bot = this.opts.getBot();
    if (!bot) return null;
    if (first.grid) {
      // A queued task may still supply ingredients before this task starts.
      if (this.task || this.queue.length > 0 || this.frozen) return null;
      const needed = new Map<string, number>();
      for (const name of first.grid.flat()) {
        if (name) needed.set(name, (needed.get(name) ?? 0) + 1);
      }
      const missing = [...needed].filter(([name, count]) => invCount(bot, (item) => item === name) < count)
        .map(([name, count]) => `${zhName(name)}要 ${count} 个,包里 ${invCount(bot, (item) => item === name)} 个`);
      return missing.length > 0
        ? `第一步自摆合成当前做不了：${missing.join('；')}。先取得材料或换格子，再提交整单；原队列保留`
        : null;
    }
    const hit = precheckSteps(bot, [first], this.precheckDeps(bot))[0]?.note;
    if (hit?.level !== 'hard' || !['craft.short', 'craft.unknownItem'].includes(hit.rule)) return null;
    const product = first.item ? bot.registry?.itemsByName?.[first.item] : null;
    if (product && invCountById(bot, product.id) >= first.count) return null;
    return `第一步合成当前做不了：${hit.text}。先取得材料或换配方，再提交整单；原队列保留`;
  }

  /** 账本合并了同类槽位；仅计入能保证腾出的格数，再扣除本单先前存物。 */
  private plannedFreeSlots(bot: Bot, target: { x: number; y: number; z: number },
    earlierSteps: readonly SkillCall[]): number {
    const rec = this.opts.chests?.get(dimensionOf(bot), target);
    if (!rec?.observedAt || Date.now() - rec.observedAt > 120_000) return 0;
    let openedAt: { x: number; y: number; z: number } | null = null;
    const taken = new Map<string, number>();
    const credited = new Map<string, number>();
    let free = 0;
    for (const step of earlierSteps) {
      if (step.skill === 'use' && step.at) {
        try { openedAt = resolveAt(bot, step.at); }
        catch { openedAt = null; }
      }
      let from: { x: number; y: number; z: number } | null = null;
      if ('at' in step && step.at) {
        try { from = resolveAt(bot, step.at); }
        catch { /* not a known container yet */ }
      } else if ((step.skill === 'take' && step.from === 'open')
        || (step.skill === 'stow' && step.into === 'open')) from = openedAt;
      if (!from || from.x !== target.x || from.y !== target.y || from.z !== target.z) continue;
      if (step.skill === 'take' && step.item) {
        const total = rec.items.filter((stack) => matchItemName(step.item!, stack.name, bot?.registry))
          .reduce((sum, stack) => sum + stack.count, 0);
        if (total <= 0) continue;
        const stackMax = bot.registry.itemsByName?.[step.item]?.stackSize ?? 64;
        const next = Math.min(total, (taken.get(step.item) ?? 0) + (step.count ?? 1));
        taken.set(step.item, next);
        const guaranteed = stackMax === 1 ? next
          : next >= total ? Math.ceil(total / stackMax) : 0;
        free += guaranteed - (credited.get(step.item) ?? 0);
        credited.set(step.item, guaranteed);
      } else if (step.skill === 'stow' && step.item) {
        const stackMax = bot.registry.itemsByName?.[step.item]?.stackSize ?? 64;
        free -= Math.ceil((step.count ?? 1) / stackMax);
      }
    }
    return free;
  }

  /** 刚开窗证实已满的箱子，只有同一单保证腾格时才允许接着存。 */
  private recentFullChestNote(bot: Bot, target: { x: number; y: number; z: number },
    item: string, count: number, earlierSteps: readonly SkillCall[]): string | null {
    if (earlierSteps.some((step) => step.skill === 'build')) return null;
    const rec = this.opts.chests?.get(dimensionOf(bot), target);
    if (!rec?.observedAt || Date.now() - rec.observedAt > 120_000
      || rec.slots <= 0) return null;
    // A cross-container transfer first increases the carried count. Do not take
    // that stack out when a recent destination snapshot proves the requested
    // amount cannot fit, even if a smaller partial merge would still succeed.
    const transfer = earlierSteps.some((step) => step.skill === 'take'
      && !!step.item && matchItemName(step.item, item, bot?.registry));
    if (transfer && this.plannedFreeSlots(bot, target, earlierSteps) <= 0) {
      const stackMax = bot.registry.itemsByName?.[item]?.stackSize ?? 64;
      const otherMinSlots = rec.items.filter((stack) => !matchItemName(item, stack.name, bot?.registry))
        .reduce((slots, stack) => slots + Math.ceil(stack.count
          / (bot.registry.itemsByName?.[stack.name]?.stackSize ?? 64)), 0);
      const itemCount = rec.items.filter((stack) => matchItemName(item, stack.name, bot?.registry))
        .reduce((sum, stack) => sum + stack.count, 0);
      // Merged records may hide several partial stacks. This is an upper bound
      // on possible room, so rejecting below it cannot mistake a usable box for full.
      const upperRoom = Math.max(0, (rec.slots - otherMinSlots) * stackMax - itemCount);
      if (upperRoom < count) {
        return `目标箱子 (${target.x},${target.y},${target.z}) 最近开窗读数最多只能再容纳${zhName(item)}×${upperRoom}，本单却要从别处取出后存入×${count}；这会把物品留在随身而不会净腾格。先换有足够容量的容器，或直接存随身已有的物品；原队列保留`;
      }
    }
    if (rec.usedSlots < rec.slots) return null;
    // 同名物品可能有可并堆的槽；无法确认 NBT 相同时保守放行，执行时再核对。
    const stackMax = bot.registry.itemsByName?.[item]?.stackSize ?? 64;
    if (hasRoom(rec, item, stackMax, bot?.registry)) return null;
    const free = this.plannedFreeSlots(bot, target, earlierSteps);
    const needed = Math.ceil(count / stackMax);
    if (free >= needed) return null;
    const before = earlierSteps.filter((step) => step.skill === 'take');
    const hint = before.length > 0
      ? `本单前序取物扣除已计划存物后只保证空出 ${Math.max(0, free)} 格，本步至少需 ${needed} 格；只从一堆取走一件通常仍占原格。`
      : '只从一堆取走一件通常仍占原格。';
    return `指定箱子 (${target.x},${target.y},${target.z}) 最近开窗证实已满 ${rec.usedSlots}/${rec.slots} 格，且没有${zhName(item)}可并堆；${hint}先整堆取走物品并转存到另一处，勿再存回原箱；开窗确认出现空格后再存，或直接改用其他容器。原队列保留`;
  }

  private openStorageKey(steps: readonly SkillCall[]): string | null {
    if (!steps.some((step) => step.skill === 'stow' && step.into === 'open')) return null;
    const opener = steps.find((step) => step.skill === 'chat' && step.text.startsWith('/'))
      ?? steps.find((step) => step.skill === 'use');
    return JSON.stringify(opener ?? { skill: 'open' });
  }

  private fullOpenStorageNote(steps: readonly SkillCall[], now: number): string | null {
    for (const [key, entry] of this.fullOpenStorageFailures) {
      if (now - entry.at >= 120_000) this.fullOpenStorageFailures.delete(key);
    }
    const key = this.openStorageKey(steps);
    const entry = key ? this.fullOpenStorageFailures.get(key) : null;
    if (!entry || entry.count < 2) return null;
    const firstStow = steps.findIndex((step) => step.skill === 'stow' && step.into === 'open');
    const before = steps.slice(0, firstStow);
    const opener = before.reduce((last, step, index) => step.skill === 'use'
      || (step.skill === 'chat' && step.text.startsWith('/')) ? index : last, -1);
    // Earlier changes to this window invalidate its old capacity failure.
    // The transfer still checks the live slots and reports insufficient room.
    if (before.slice(opener + 1).some((step) => step.skill === 'compact'
      || (step.skill === 'take' && step.from === 'open'))) return null;
    return `同一打开方式的容器最近 ${entry.count} 次存入都因没有空位失败；换物品不会腾出格子。先从该容器取走物品、整理出可并堆格，或换另一处容器；原队列保留。上次:${entry.why}`;
  }

  /** 批量原地抛物只会被自动捡回，或把有用物品丢失；不让它成为腾背包格的计划。 */
  private protectedTossNote(steps: readonly SkillCall[]): string | null {
    const bot = this.opts.getBot();
    if (!bot) return null;
    for (const step of steps) {
      if (step.skill !== 'toss') continue;
      const note = protectedTossItem(bot, step.item);
      if (note) return `${note}；原队列保留`;
    }
    return null;
  }

  private reacquiredTossNote(steps: readonly SkillCall[]): string | null {
    const bot = this.opts.getBot();
    if (!bot) return null;
    for (const step of steps) {
      if (step.skill !== 'toss') continue;
      const note = reacquiredTossNote(bot, step.item);
      if (note) return `${note}；原队列保留`;
    }
    return null;
  }

  /** 批量原地抛物只会被自动捡回，或把有用物品丢失；不让它成为腾背包格的计划。 */
  private bulkUnanchoredTossNote(steps: readonly SkillCall[]): string | null {
    const loose = steps.filter((step) => step.skill === 'toss' && step.at === undefined);
    const firstLoose = steps.findIndex((step) => step.skill === 'toss' && step.at === undefined);
    if (firstLoose >= 0 && steps.slice(firstLoose + 1).some((step) => step.skill === 'pickup')) {
      return '这单要在原地抛物后捡另一件；抛出的东西可能自动捡回，也可能丢失。先把要腾出的物品存进容器，再单独捡取；原队列保留';
    }
    return loose.length >= 2
      ? `这单要原地抛出 ${loose.length} 类物品，容易自动捡回或丢失；没有受理。整理背包请去普通储物箱，暂时没有箱子就先做其他事`
      : null;
  }

  /** 空闲时已达成的单步 goto 直接返回事实，不创建任务或投递完成事件。 */
  private satisfiedGotoReceipt(steps: readonly SkillCall[]): string | null {
    if (this.task || this.frozen || this.queue.length > 0
      || this.holdReason() !== null || this.opts.busyWith?.()) return null;
    const call = steps.length === 1 ? steps[0] : undefined;
    const bot = this.opts.getBot();
    if (!bot?.entity?.position || call?.skill !== 'goto' || call.dryRun || call.expect
      || (call.dimension && normalizeDimension(dimensionOf(bot)) !== normalizeDimension(call.dimension))) return null;
    const p = bot.entity.position;
    const here = { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    const resolved = resolveAnchors([call.at], here);
    if (!Array.isArray(resolved)) return null;
    const target = resolved[0];
    if (!travelGoalReached(bot, gotoArrivalGoal(call, target))) return null;
    const where = call.groundY ? `水平 (${target.x},${target.z})` : cellText(target);
    return `goto 已达成：当前位置已满足目标 ${where} 的寻路到达条件，实测脚下 ${cellText(here)}；`
      + '本次无移动、未创建新任务。';
  }

  /** 同目标、位置与移动前提未变时，十五秒内重复提交不会增加位移。 */
  private repeatStationaryGotoNote(
    steps: readonly SkillCall[],
    bot: Bot | null,
    now: number,
  ): string | null {
    for (const [key, at] of this.recentGotoRequests) {
      if (now - at >= 15_000) this.recentGotoRequests.delete(key);
    }
    if (steps.length !== 1 || steps[0].skill !== 'goto') return null;
    const same = [this.task, this.frozen, ...this.queue].find(
      (task) => task !== null && task.steps.length === 1
        && task.steps[0].skill === 'goto'
        && JSON.stringify(task.steps[0]) === JSON.stringify(steps[0]),
    );
    if (same) {
      return `同一个 goto 已在任务#${same.id} 执行或排队；新单未接，原队列保留。等那单的结局再判断`;
    }
    const pos = bot?.entity?.position;
    if (!bot || !pos) return null;
    const here = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    const movement = flightState(bot).flying ? 'flying' : 'ground';
    const key = `${JSON.stringify(steps[0])}@${normalizeDimension(dimensionOf(bot))}:${here}:${movement}`;
    if (this.recentGotoRequests.has(key)) {
      return `同一个 goto 刚从 (${here}) 提交过，现在仍在同一格；重复走这个目标不会增加进展。先核对现场，换可站的三维落点或另一条路线`;
    }
    this.recentGotoRequests.set(key, now);
    return null;
  }

  private unmovedFindKey(step: Extract<SkillCall, { skill: 'find' }>, dimension: string): string {
    return JSON.stringify({ target: step.target, direction: step.direction, dimension });
  }

  private unmovedFindNote(steps: readonly SkillCall[], now: number): string | null {
    const bot = this.opts.getBot();
    const pos = bot?.entity?.position;
    if (!bot || !pos) return null;
    for (const [key, entry] of this.unmovedFindHits) {
      if (now - entry.at > 120_000) this.unmovedFindHits.delete(key);
    }
    const i = steps.findIndex((step) => step.skill === 'find' && step.direction !== undefined);
    if (i < 0) return null;
    const find = steps[i] as Extract<SkillCall, { skill: 'find' }>;
    const prior = this.unmovedFindHits.get(this.unmovedFindKey(find, dimensionOf(bot)));
    if (!prior || Math.hypot(pos.x - prior.from.x, pos.z - prior.from.z) > 4
      || Math.abs(pos.y - prior.from.y) > 3) return null;
    // 前序移动可能改变观察现场；只有已满足实际到达条件的 goto 才能当成原地重找。
    if (steps.slice(0, i).some((step) => {
      if (step.skill === 'server_travel') return true;
      if (step.skill !== 'goto' || step.dryRun
        || (step.dimension && normalizeDimension(dimensionOf(bot)) !== normalizeDimension(step.dimension))) return false;
      const resolved = resolveAnchors([step.at], { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
      return Array.isArray(resolved) && !travelGoalReached(bot, gotoArrivalGoal(step, resolved[0]));
    })) return null;
    return `刚才从这里朝${DIRECTION_ZH[find.direction!]}找${zhThing(find.target)}时，出发点就命中同一可见目标，人并未沿指定方向走；原地重找不会产生新信息。先走离这处至少几格，或改查不同目标；原队列保留`;
  }

  private recordUnmovedFindHits(task: RunningTask): void {
    const bot = this.opts.getBot();
    const pos = bot?.entity?.position;
    if (!bot || !pos) return;
    for (const landed of task.stepLog) {
      const step = task.steps[landed.step - 1];
      if (step?.skill !== 'find' || !step.direction || landed.outcome !== 'ok'
        || !landed.line.includes('行军尚未发生')) continue;
      this.unmovedFindHits.set(this.unmovedFindKey(step, dimensionOf(bot)), {
        at: Date.now(), dimension: dimensionOf(bot),
        from: { x: pos.x, y: pos.y, z: pos.z },
      });
    }
    while (this.unmovedFindHits.size > 32) this.unmovedFindHits.delete(this.unmovedFindHits.keys().next().value!);
  }

  /** 从客户端当前可见的作物读坐标和 age；任何读不到的格都不推断为未成熟。 */
  private cropFindStamp(bot: Bot, step: Extract<SkillCall, { skill: 'find' }>): string | null {
    if (step.direction || CROP_MAX_AGE[step.target] === undefined) return null;
    const id = bot.registry?.blocksByName?.[step.target]?.id;
    if (id === undefined) return null;
    try {
      const radius = Math.min(step.distance ?? FIND_STATIC_MAX, FIND_STATIC_MAX);
      const hits = bot.findBlocks({ matching: [id], maxDistance: radius, count: 64 })
        .filter((p) => canSeeBlockAt(bot, p));
      if (hits.length === 0) return null;
      const reads = hits.map((p) => ({ p, age: cropAgeAt(bot, p) }));
      if (reads.some(({ age }) => !age || age.value >= age.max)) return null;
      return reads.map(({ p, age }) => `${p.x},${p.y},${p.z}:${age!.value}`)
        .sort().join(';');
    } catch { return null; }
  }

  private immatureFindKey(bot: Bot, step: Extract<SkillCall, { skill: 'find' }>): string {
    return `${dimensionOf(bot)}/${step.target}/${Math.min(step.distance ?? FIND_STATIC_MAX, FIND_STATIC_MAX)}`;
  }

  private immatureFindNote(steps: readonly SkillCall[], now: number): string | null {
    const i = steps.findIndex((step) => step.skill === 'find' && !step.direction
      && CROP_MAX_AGE[step.target] !== undefined);
    if (i < 0 || steps.slice(0, i).some((step) => step.skill !== 'goto')) return null;
    const bot = this.opts.getBot();
    const pos = bot?.entity?.position;
    const step = steps[i];
    if (!bot || !pos || step.skill !== 'find') return null;
    const key = this.immatureFindKey(bot, step);
    const prior = this.immatureFindHits.get(key);
    if (!prior || now - prior.at >= IMMATURE_FIND_HOLD_MS) return null;
    const intended = steps.slice(0, i).find((s): s is Extract<SkillCall, { skill: 'goto' }> => s.skill === 'goto');
    if (intended && Array.isArray(intended.at) && intended.at.every((n) => typeof n === 'number')
      && Math.hypot(Number(intended.at[0]) - prior.from.x, Number(intended.at[2]) - prior.from.z) >= 8) return null;
    if (Math.hypot(pos.x - prior.from.x, pos.z - prior.from.z) >= 8) return null;
    const current = this.cropFindStamp(bot, step);
    if (current !== prior.stamp) {
      this.immatureFindHits.delete(key);
      return null;
    }
    const left = Math.ceil((IMMATURE_FIND_HOLD_MS - (now - prior.at)) / 1000);
    return `这片${zhName(step.target)}上次已看见，但都未成熟；坐标和生长阶段仍相同，${left} 秒内不再重复原地 find。随机生长期间先做其他事；若作物长了一阶段、成熟或去了另一片田，立即可查`;
  }

  private recordImmatureFindHits(task: RunningTask): void {
    const bot = this.opts.getBot();
    const pos = bot?.entity?.position;
    if (!bot || !pos) return;
    for (const landed of task.stepLog) {
      const step = task.steps[landed.step - 1];
      if (step?.skill !== 'find' || step.direction || CROP_MAX_AGE[step.target] === undefined
        || landed.outcome !== 'ok') continue;
      const key = this.immatureFindKey(bot, step);
      const stamp = this.cropFindStamp(bot, step);
      if (stamp) this.immatureFindHits.set(key, {
        at: Date.now(), stamp, from: { x: pos.x, y: pos.y, z: pos.z },
      });
      else this.immatureFindHits.delete(key);
    }
    while (this.immatureFindHits.size > 32) this.immatureFindHits.delete(this.immatureFindHits.keys().next().value!);
  }

  /** 对连续快速自停作限时受理兜底；坐标变化中的同一目的地也计入。 */
  private rapidStopKey(steps: readonly SkillCall[]): string {
    const lastGoto = [...steps].reverse().find(
      (step): step is Extract<SkillCall, { skill: 'goto' }> => step.skill === 'goto',
    );
    return lastGoto
      ? JSON.stringify({ skill: 'goto', at: lastGoto.at, dimension: lastGoto.dimension ?? null })
      : JSON.stringify(steps);
  }

  private rapidStopNote(steps: readonly SkillCall[], now: number): string | null {
    for (const [key, entry] of this.rapidStops) {
      if (entry.until <= now && entry.times.every((at) => now - at >= 20_000)) this.rapidStops.delete(key);
    }
    const entry = this.rapidStops.get(this.rapidStopKey(steps));
    if (!entry || entry.until <= now) return null;
    const left = Math.ceil((entry.until - now) / 1000);
    return `同一目的地最近被你连续快速叫停 ${entry.times.length} 次，${left} 秒内不再受理这个目的地的新单；原队列保留。先换别的目标或任务`;
  }

  private noteRapidStop(task: RunningTask, now: number): void {
    if (now - task.startedAt > 3_000) return;
    const key = this.rapidStopKey(task.steps);
    const prior = this.rapidStops.get(key);
    const times = [...(prior?.times ?? []).filter((at) => now - at < 20_000), now];
    this.rapidStops.set(key, { times, until: times.length >= 6 ? now + 120_000 : prior?.until ?? 0 });
  }

  /** 没有点名包里物品的存物计划在受理时驳回。 */
  private missingUseItemNote(steps: readonly SkillCall[]): string | null {
    const first = steps[0];
    if (first?.skill !== 'use' || !first.item || first.at || first.target) return null;
    const bot = this.opts.getBot();
    if (!bot?.inventory?.items || invItemNamed(bot, first.item)) return null;
    return `包里没有${first.item}，第一步无法使用；原队列保留。先核对背包，改用仍在身上的物品`;
  }

  /** 没有点名包里物品的存物计划在受理时驳回。 */
  private missingStowItemNote(steps: readonly SkillCall[]): string | null {
    const stow = steps.length === 1 && steps[0].skill === 'stow' ? steps[0]
      : steps.length === 2 && steps[0].skill === 'use' && steps[1].skill === 'stow' ? steps[1] : null;
    // 只赶路再存物也不会凭空得到东西；在出发前拒收，避免白走到另一口箱子。
    const travelStow = steps.length > 1 && steps.at(-1)?.skill === 'stow'
      && steps.slice(0, -1).every((step) => step.skill === 'goto' || step.skill === 'server_travel')
      ? steps.at(-1) as Extract<SkillCall, { skill: 'stow' }> : null;
    const planned = stow ?? travelStow;
    if (!planned) return null;
    const bot = this.opts.getBot();
    if (!bot?.inventory?.items || bot.inventory.items().length === 0) return null;
    if (invCount(bot, itemPredOf(bot, planned.item, planned.pick)) > 0) return null;
    return `${noSuchItem(bot, planned.item, planned.pick).message}；先用背包读数里的工具物品名核对，原单未入队`;
  }

  private fullInventoryTakeNote(steps: readonly SkillCall[]): string | null {
    // Earlier queued work may change the inventory before this task starts.
    if (this.task || this.queue.length > 0 || this.frozen) return null;
    const bot = this.opts.getBot();
    const held = bot?.inventory?.items();
    if (!held || held.length < 36) return null;
    const preservesCapacity = (part: SkillCall): boolean => {
      if ('dryRun' in part && part.dryRun) return true;
      if (part.skill === 'chat') return !part.text.trimStart().startsWith('/');
      return part.skill === 'probe' || part.skill === 'observe' || part.skill === 'gesture';
    };
    for (const [index, step] of steps.entries()) {
      if (step.skill !== 'take' || !step.item) continue;
      // A consuming, moving or custom-item operation makes later capacity unknown.
      // Its success does not promise a free slot; the actual transfer checks the window.
      if (steps.slice(0, index).some((part) => !preservesCapacity(part))) continue;
      const canMerge = held.some((item) => item.name === step.item
        && item.count < (item.stackSize ?? 1));
      if (!canMerge) {
        return `随身 36/36 格已满，${zhName(step.item)}没有可合并的现有堆；第 ${index + 1} 步取物一定放不进背包。先存放、用完或整堆丢弃一格低价值物品，确认出现空格后再单独开窗取物；只丢一件堆叠物不会腾格。原队列保留`;
      }
    }
    return null;
  }

  /** 满包自摆配方若第一轮不会耗尽任何材料栈，未知产物没有可验证的落袋空间。 */
  private fullInventoryGridCraftNote(steps: readonly SkillCall[]): string | null {
    const first = steps[0];
    if (first?.skill !== 'craft' || !first.grid) return null;
    const held = this.opts.getBot()?.inventory?.items();
    if (!held || held.length < 36) return null;
    const needed = new Map<string, number>();
    for (const row of first.grid) for (const name of row) {
      if (name) needed.set(name, (needed.get(name) ?? 0) + 1);
    }
    if (needed.size === 0) return null;
    // 一轮材料全部耗尽某一堆才可能空出原位；其他步骤尚未执行，不能预支其空位。
    for (const [name, count] of needed) {
      if (held.some((item) => item.name === name && item.count <= count)) return null;
    }
    return '随身 36/36 格已满，这次自摆配方的第一轮不会耗尽任何材料堆，产物没有可验证的空格。先存放、用完或整堆丢弃一格低价值物品；只丢一件圆石之类的堆叠物仍占一格。空格出现后再合成，原队列保留';
  }

  /** 同一整单在相同现场连续失败后暂缓；换站位、维度或做法即可重新尝试。 */
  private repeatFailedTaskNote(steps: readonly SkillCall[], now: number): string | null {
    // 施工前置步骤会改变支撑与占位；失败历史不能冻结修正后的整单。
    if (steps.some((step) => step.skill === 'build') || !retryGuardApplies(steps)) return null;
    for (const [key, entry] of this.exactFailures) {
      if (now - entry.at >= EXACT_FAILURE_WINDOW_MS) this.exactFailures.delete(key);
    }
    const bot = this.opts.getBot();
    const namedTake = namedTakeRetryKey(steps, bot);
    const key = namedTake ?? openTakeRetryKey(steps) ?? JSON.stringify(steps);
    const entry = this.exactFailures.get(key);
    if (!entry || entry.count < 2) return null;
    if (entry.admissionRule && (entry.admissionInventoryStamp !== this.retryInventoryStamp(bot)
      || entry.admissionTargetBlock !== this.admissionBlockStamp(steps))) {
      this.exactFailures.delete(key);
      return null;
    }
    if (namedTake && bot && typeof bot.blockAt === 'function') {
      const take = steps.at(-1);
      if (take?.skill === 'take' && take.at && take.item) {
        const cell = resolveAt(bot, take.at);
        const block = bot.blockAt(new Vec3(cell.x, cell.y, cell.z));
        const isContainer = block && (CONTAINER_FIND.includes(block.name)
          || FURNACE_KINDS.has(block.name) || block.name === 'brewing_stand');
        const rec = this.opts.chests?.get(dimensionOf(bot), cell);
        const evidence = entry.admissionRule ? this.takeEvidenceNote(steps, now) : null;
        if ((evidence && entry.admissionRule !== `take.${evidence.proof}`)
          || (entry.takeProof === 'not-container' && isContainer)
          || (rec?.observedAt && rec.observedAt >= entry.at && hasItem(rec, take.item, bot?.registry))) {
          this.exactFailures.delete(key);
          return null;
        }
      }
    }
    if (steps.some((step) => step.skill === 'craft')
      && entry.inventoryStamp !== this.retryInventoryStamp(bot)) {
      this.exactFailures.delete(key);
      return null;
    }
    const here = bot?.entity?.position;
    // 取当前打开的服务端容器取不到东西，换站位不会让同一窗口凭空添货。
    const windowTake = Boolean(namedTake) || steps.some((step) => step.skill === 'take' && step.from === 'open');
    if (!windowTake && entry.from && here && (entry.from.dimension !== dimensionOf(bot!)
      || Math.hypot(here.x - entry.from.x, here.y - entry.from.y, here.z - entry.from.z) >= EXACT_FAILURE_RETRY_DISTANCE)) {
      this.exactFailures.delete(key);
      return null;
    }
    const left = Math.ceil((EXACT_FAILURE_WINDOW_MS - (now - entry.at)) / 1000);
    if (namedTake) {
      return `同一目标取同一物品已经连续失败 ${entry.count} 次；${left} 秒内原样重试不受理。上次卡在:${entry.why}。先换来源或重新核验目标内容`;
    }
    if (windowTake) {
      return `同一来源窗口取同一物品已经连续失败 ${entry.count} 次；${left} 秒内换站位或多走几步再取也不会受理。上次卡在:${entry.why}。先核对窗口实际内容，改取现有物品或换来源`;
    }
    return `同一整单已经连续失败 ${entry.count} 次，现场位置没明显变化；${left} 秒内原样重下不会受理。上次卡在:${entry.why}。请换站位、目标或做法`;
  }

  /** 首步可立即拒收；组合任务的后续 collect 在执行到该步时重新读现场。 */
  private unseenCollectNote(steps: readonly SkillCall[], now: number): string | null {
    const bot = this.opts.getBot();
    if (!bot?.entity) return null;
    for (const call of steps) {
      if (call.skill !== 'collect') continue;
      const key = `${dimensionOf(bot)}/${call.block}`;
      const miss = this.unseenCollects.get(key);
      if (!miss || miss.count < 2 || now - miss.at >= 90_000) continue;
      const here = feetOf(bot);
      if (Math.hypot(here.x - miss.from.x, here.y - miss.from.y, here.z - miss.from.z) > 16) continue;
      try {
        const ids = matchBlockIds(bot, call.block);
        if (ids.length > 0 && bot.findBlocks({ matching: ids, maxDistance: 48, count: 16 })
          .some((p) => collectVisible(bot, p))) {
          this.unseenCollects.delete(key);
          continue;
        }
      } catch { continue; } // 感知读数不可用时交给技能本身裁决
      return `附近连续 ${miss.count} 次没有看得见的${zhName(call.block)}，现在仍未露出；`
        + '当前采集暂缓。可以先执行挖掘或移动，再到 collect 步骤重读；目标露出、离开 16 格或本次 90 秒暂缓到期后恢复。';
    }
    return null;
  }

  private noteUnseenCollect(block: string, bot: Bot): void {
    const key = `${dimensionOf(bot)}/${block}`;
    const now = Date.now();
    const from = feetOf(bot);
    const previous = this.unseenCollects.get(key);
    const nearby = previous && now - previous.at < 90_000
      && Math.hypot(from.x - previous.from.x, from.y - previous.from.y, from.z - previous.from.z) <= 16;
    this.unseenCollects.set(key, { count: nearby ? previous.count + 1 : 1, at: now, from });
  }

  private clearUnseenCollect(block: string, bot: Bot): void {
    this.unseenCollects.delete(`${dimensionOf(bot)}/${block}`);
  }

  private immatureCollectNote(steps: readonly SkillCall[], now: number): string | null {
    const bot = this.opts.getBot();
    if (!bot?.entity) return null;
    const holdMs = 5 * 60_000;
    for (const [key, entries] of this.immatureCollects) {
      const fresh = entries.filter((entry) => now - entry.at < holdMs);
      if (fresh.length) this.immatureCollects.set(key, fresh);
      else this.immatureCollects.delete(key);
    }
    for (const step of steps) {
      if (step.skill !== 'collect' || (!step.mature && CROP_MAX_AGE[step.block] === undefined)) continue;
      const key = `${dimensionOf(bot)}/${step.block}`;
      const destination = lastAbsoluteGoto(steps) ?? bot.entity.position;
      const prior = this.immatureCollects.get(key)?.find((entry) =>
        Math.hypot(destination.x - entry.from.x, destination.z - entry.from.z) <= 32);
      if (!prior) continue;
      // 只用当前确实可见、且属于这片田的成熟作物解除暂缓；远处田的作物
      // 或走向另一片田之前看到的成熟作物，不能证明目标农田已成熟。
      try {
        const ids = matchBlockIds(bot, step.block);
        if (ids.length > 0 && bot.findBlocks({ matching: ids, maxDistance: 48, count: 64 })
          .some((p) => {
            if (Math.hypot(p.x - prior.from.x, p.z - prior.from.z) > 32 || !collectVisible(bot, p)) return false;
            const age = cropAgeAt(bot, p);
            return age !== null && age.value >= age.max;
          })) {
          const fresh = (this.immatureCollects.get(key) ?? []).filter((entry) => entry !== prior);
          if (fresh.length) this.immatureCollects.set(key, fresh);
          else this.immatureCollects.delete(key);
          continue;
        }
      } catch { /* 现场读不到时保留刚才的失败事实，短时暂缓 */ }
      return `这片区域的${zhName(step.block)}刚核实都未成熟；同一农田的 mature collect 暂缓。`
        + '等观察到成熟作物，或换到 32 格外的另一片农田；不要在原地与农田之间反复往返';
    }
    return null;
  }

  private noteImmatureCollect(block: string, bot: Bot): void {
    const key = `${dimensionOf(bot)}/${block}`;
    const from = feetOf(bot);
    const entries = (this.immatureCollects.get(key) ?? []).filter((entry) =>
      Math.hypot(from.x - entry.from.x, from.z - entry.from.z) > 32);
    entries.push({ at: Date.now(), from });
    this.immatureCollects.set(key, entries.slice(-16));
  }

  private tunnelLiquidStopNote(steps: readonly SkillCall[], now: number): string | null {
    const bot = this.opts.getBot();
    const pos = bot?.entity?.position;
    if (!bot || !pos) return null;
    const dimension = dimensionOf(bot);
    this.tunnelLiquidStops = this.tunnelLiquidStops.filter((stop) => now - stop.at < EXACT_FAILURE_WINDOW_MS);
    let start = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    for (const step of steps) {
      if (step.skill === 'goto') {
        const goal = lastAbsoluteGoto([step]);
        if (goal) start = goal;
        continue;
      }
      if (step.skill !== 'tunnel' || step.dryRun) continue;
      const resolved = resolveAnchors([step.at], start);
      if (!Array.isArray(resolved)) continue;
      const end = resolved[0];
      if (end.y >= start.y) continue;
      for (const stop of this.tunnelLiquidStops) {
        if (stop.dimension !== dimension || stop.cell.y < end.y || stop.cell.y > start.y + 2
          || Math.hypot(stop.cell.x - start.x, stop.cell.z - start.z) > 4) continue;
        const block = bot.blockAt(new Vec3(stop.cell.x, stop.cell.y, stop.cell.z));
        if (block?.name !== stop.name) {
          if (block) this.tunnelLiquidStops = this.tunnelLiquidStops.filter((entry) => entry !== stop);
          continue;
        }
        return `这片井筒刚在 (${stop.cell.x},${stop.cell.y},${stop.cell.z}) 遇到${zhName(stop.name)}，该格现在仍是${zhName(stop.name)}；附近下行通道会再碰上它。先排水、封水或换到水平 5 格外的井位；原队列保留`;
      }
    }
    return null;
  }

  private verticalTunnelOscillationNote(steps: readonly SkillCall[], now: number): string | null {
    const bot = this.opts.getBot();
    const pos = bot?.entity?.position;
    if (!bot || !pos) return null;
    const dimension = dimensionOf(bot);
    this.verticalTunnelTraversals = this.verticalTunnelTraversals.filter((row) => now - row.at < 180_000);
    let start = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    const near = (a: Cell, b: Cell): boolean => Math.abs(a.y - b.y) <= 1
      && Math.hypot(a.x - b.x, a.z - b.z) <= 2;
    for (const step of steps) {
      if (step.skill === 'goto') {
        const goal = lastAbsoluteGoto([step]);
        if (goal) start = goal;
        continue;
      }
      if (step.skill !== 'tunnel' || step.dryRun) continue;
      const resolved = resolveAnchors([step.at], start);
      if (!Array.isArray(resolved)) continue;
      const end = resolved[0];
      if (Math.abs(end.y - start.y) < 3 || Math.hypot(end.x - start.x, end.z - start.z) > 2) continue;
      const traversals = this.verticalTunnelTraversals.filter((row) => row.dimension === dimension);
      const went = traversals.find((row) => near(row.from, start) && near(row.to, end));
      const returned = traversals.find((row) => row !== went && row.at >= (went?.at ?? Infinity)
        && near(row.from, end) && near(row.to, start));
      if (went && returned) {
        return `这段竖向通道刚走过 (${went.from.x},${went.from.y},${went.from.z}) → (${went.to.x},${went.to.y},${went.to.z})，又原路折回；短时间内再走同段只是上下打转。先选不同目的地或路线，原队列保留`;
      }
    }
    return null;
  }

  private noteVerticalTunnelTraversal(from: Cell, to: Cell, dimension: string): void {
    if (Math.abs(to.y - from.y) < 3 || Math.hypot(to.x - from.x, to.z - from.z) > 2) return;
    this.verticalTunnelTraversals.push({ at: Date.now(), dimension, from, to });
    if (this.verticalTunnelTraversals.length > 16) this.verticalTunnelTraversals.shift();
  }

  private repeatEmptyProbeNote(steps: readonly SkillCall[], now: number): string | null {
    if (steps.length === 0 || !steps.every((step) => step.skill === 'probe' && step.where?.length)) return null;
    const bot = this.opts.getBot();
    const pos = bot?.entity?.position;
    if (!bot || !pos) return null;
    for (const [key, entry] of this.emptyProbeReads) {
      if (now - entry.at >= 30_000) this.emptyProbeReads.delete(key);
    }
    const dimension = dimensionOf(bot);
    const repeated = steps.every((step) => {
      const entry = this.emptyProbeReads.get(exactTaskKey([step]));
      return entry && entry.dimension === dimension && now - entry.at < 30_000
        && Math.hypot(pos.x - entry.from.x, pos.y - entry.from.y, pos.z - entry.from.z) < 3;
    });
    return repeated ? '同一范围的点名探查刚回报一样都没有，站位也没有明显变化；30 秒内不再原样重查。可先移动或换探查范围，原队列保留' : null;
  }

  private recordEmptyProbeReads(steps: readonly SkillCall[], landings: readonly StepLanding[]): void {
    const bot = this.opts.getBot();
    const pos = bot?.entity?.position;
    if (!bot || !pos) return;
    const from = { x: pos.x, y: pos.y, z: pos.z };
    for (const landing of landings) {
      const step = steps[landing.step - 1];
      if (step?.skill !== 'probe' || !step.where?.length || landing.outcome !== 'ok'
        || !landing.line.includes(':一样都没有')) continue;
      this.emptyProbeReads.set(exactTaskKey([step]), { at: Date.now(), dimension: dimensionOf(bot), from });
    }
  }

  private recordTunnelLiquidStop(steps: readonly SkillCall[], landings: readonly StepLanding[]): void {
    const bot = this.opts.getBot();
    if (!bot) return;
    const dimension = dimensionOf(bot);
    for (const landing of landings) {
      if (landing.outcome !== 'fail' || steps[landing.step - 1]?.skill !== 'tunnel') continue;
      const match = /\((-?\d+),\s*(-?\d+),\s*(-?\d+)\) 碰上(水|岩浆)/.exec(landing.why ?? '');
      if (!match) continue;
      const cell = { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
      const name = match[4] === '水' ? 'water' : 'lava';
      this.tunnelLiquidStops = this.tunnelLiquidStops.filter((entry) => entry.dimension !== dimension
        || entry.cell.x !== cell.x || entry.cell.y !== cell.y || entry.cell.z !== cell.z);
      this.tunnelLiquidStops.push({ at: Date.now(), dimension, cell, name });
    }
  }

  private tunnelSupportStopNote(steps: readonly SkillCall[], now: number): string | null {
    const bot = this.opts.getBot();
    const pos = bot?.entity?.position;
    if (!bot || !pos) return null;
    const dimension = dimensionOf(bot);
    this.tunnelSupportStops = this.tunnelSupportStops.filter((row) => now - row.at < EXACT_FAILURE_WINDOW_MS);
    let start = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
    for (const step of steps) {
      if (step.skill === 'goto') {
        const goal = lastAbsoluteGoto([step]);
        if (goal) start = goal;
        continue;
      }
      if (step.skill !== 'tunnel' || step.dryRun) continue;
      const resolved = resolveAnchors([step.at], start);
      if (!Array.isArray(resolved)) continue;
      const end = resolved[0];
      const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
      const len2 = dx * dx + dy * dy + dz * dz;
      if (len2 < 1) continue;
      for (const stop of this.tunnelSupportStops) {
        if (stop.dimension !== dimension) continue;
        const support = bot.blockAt(new Vec3(stop.cell.x, stop.cell.y - 1, stop.cell.z));
        if (!support) continue;
        if (support.boundingBox === 'block') {
          this.tunnelSupportStops = this.tunnelSupportStops.filter((row) => row !== stop);
          continue;
        }
        const t = Math.max(0, Math.min(1, ((stop.cell.x - start.x) * dx
          + (stop.cell.y - start.y) * dy + (stop.cell.z - start.z) * dz) / len2));
        if (t <= 0.1) continue;
        const distance = Math.hypot(stop.cell.x - (start.x + dx * t),
          stop.cell.y - (start.y + dy * t), stop.cell.z - (start.z + dz * t));
        if (distance > 1.5) continue;
        return `这条通道会经过 (${stop.cell.x},${stop.cell.y},${stop.cell.z})，那里刚因脚下悬空且垫脚未获服务端确认而停工，底下仍没有实心支撑。先换路线或修好该格支撑；原队列保留`;
      }
      start = end;
    }
    return null;
  }

  private recordTunnelSupportStop(steps: readonly SkillCall[], landings: readonly StepLanding[]): void {
    const bot = this.opts.getBot();
    if (!bot) return;
    const dimension = dimensionOf(bot);
    for (const landing of landings) {
      if (landing.outcome !== 'fail' || steps[landing.step - 1]?.skill !== 'tunnel') continue;
      const match = /(?:前面|下一级台阶|挖开) \((-?\d+),\s*(-?\d+),\s*(-?\d+)\) (?:脚下悬空|底下塌空|下面就是空的)/.exec(landing.why ?? '');
      if (!match) continue;
      const cell = { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
      this.tunnelSupportStops = this.tunnelSupportStops.filter((row) => row.dimension !== dimension
        || row.cell.x !== cell.x || row.cell.y !== cell.y || row.cell.z !== cell.z);
      this.tunnelSupportStops.push({ at: Date.now(), dimension, cell });
    }
  }

  /** 只覆盖原版锄地/种植：真实可用的土格立即放行，不因附近坏格阻断修正方案。 */
  private localFarmFailureNote(steps: readonly SkillCall[], now: number): string | null {
    const index = steps.findIndex((step) => step.skill === 'use' && !!step.at
      && !!step.item && (isHoeUseItem(step.item) || !!SEED_CROP[step.item] || step.item === 'nether_wart'));
    if (index < 0 || steps.slice(0, index).some((step) => step.skill !== 'goto')) return null;
    const bot = this.opts.getBot();
    const pos = bot?.entity?.position;
    const step = steps[index];
    if (!bot || !pos || step.skill !== 'use' || !step.at || !step.item) return null;
    this.localFarmFailures = this.localFarmFailures.filter((entry) => now - entry.at < LOCAL_FARM_FAILURE_WINDOW_MS);
    const nearby = this.localFarmFailures.filter((entry) => entry.from.dimension === dimensionOf(bot)
      && Math.hypot(pos.x - entry.from.x, pos.y - entry.from.y, pos.z - entry.from.z) < LOCAL_FARM_FAILURE_DISTANCE);
    if (nearby.length < 3) return null;
    // 新目标在已加载区块里确实具备种植条件，就让执行层现场核验；不靠倒计时妨碍纠错。
    try {
      const requested = resolveAt(bot, step.at);
      const cell = farmingClickCell(bot, requested, step.item) ?? requested;
      const target = blockAtCell(bot, cell);
      const above = blockAtCell(bot, { x: cell.x, y: cell.y + 1, z: cell.z });
      if (target && above && AIR_NAMES.has(above.name)
        && (isHoeUseItem(step.item) ? HOE_TILLED[target.name] !== undefined
          : target.name === (step.item === 'nether_wart' ? 'soul_sand' : 'farmland'))) return null;
    } catch { /* 锚点暂不可读时沿用本地冷却。 */ }
    const last = nearby.at(-1)!;
    const left = Math.ceil((LOCAL_FARM_FAILURE_WINDOW_MS - (now - last.at)) / 1000);
    return `这片区域的锄地/种植已连续失败 ${nearby.length} 次，${left} 秒内暂停相同耕种尝试；上次卡在:${last.why}。先探查已加载的土格及其上方空间，找到可用耕地或换一件事`;
  }

  private recordLocalFarmOutcome(steps: readonly SkillCall[], landings: readonly StepLanding[]): void {
    const bot = this.opts.getBot();
    const pos = bot?.entity?.position;
    if (!bot || !pos) return;
    const now = Date.now();
    this.localFarmFailures = this.localFarmFailures.filter((entry) => now - entry.at < LOCAL_FARM_FAILURE_WINDOW_MS);
    for (const landing of landings) {
      const step = steps[landing.step - 1];
      if (step?.skill !== 'use' || !step.at || !step.item
        || (!isHoeUseItem(step.item) && !SEED_CROP[step.item] && step.item !== 'nether_wart')) continue;
      if (landing.outcome === 'ok') {
        this.localFarmFailures = this.localFarmFailures.filter((entry) => entry.from.dimension !== dimensionOf(bot)
          || Math.hypot(pos.x - entry.from.x, pos.y - entry.from.y, pos.z - entry.from.z) >= LOCAL_FARM_FAILURE_DISTANCE);
      } else if (landing.outcome === 'fail') {
        this.localFarmFailures.push({ at: now, why: maskCoords(landing.why ?? '没说清为什么').slice(0, 180),
          from: { x: pos.x, y: pos.y, z: pos.z, dimension: dimensionOf(bot) } });
      }
    }
  }

  private spatialFailureNote(steps: readonly SkillCall[], now: number): string | null {
    // 入队时只检查第一段将要执行的路。前置航点或开门可能改变后段的起点与地形；
    // 拿整单最后的目的地在这里拒绝，会让「先去门边、开门、再走」永远无法开跑。
    const bot = this.opts.getBot();
    const target = firstAbsoluteGoto(steps) ?? (bot ? firstRouteAfterOpenDoors(steps, bot) : null);
    const pos = bot?.entity?.position;
    if (!target || !bot || !pos) return null;
    const dim = dimensionOf(bot);
    const storageRoute = recentStorageRouteFailure(bot, target);
    if (storageRoute) return `这处容器刚才寻路失败，短时间内不再直走相同落点；先改走其他路径或目标。上次卡在:${storageRoute}`;
    this.spatialFailures = this.spatialFailures.filter((entry) => now - entry.at < EXACT_FAILURE_WINDOW_MS);
    const occupied = this.spatialFailures.find((entry) => entry.dimension === dim
      && entry.why.includes('目标那一格站不进人')
      && entry.target.x === target.x && entry.target.y === target.y && entry.target.z === target.z);
    if (occupied) {
      const diag = this.opts.probeTarget?.(target);
      const stillOccupied = !this.opts.probeTarget || diag?.kind === 'noStand';
      const reachable = stillOccupied && this.opts.probeRoutes?.(target)
        ?.some((probe) => probe.status === 'complete');
      if (stillOccupied && !reachable) return `目标格 (${target.x},${target.y},${target.z}) 已确认不可站；换出发位置仍进不去。先找可站的落点或使用已验证的入口。上次卡在:${occupied.why}${this.nearbyRouteHint(bot, target)}`;
      this.spatialFailures = this.spatialFailures.filter((entry) => entry !== occupied);
    }
    // A pinned body proves a failure at its departure, including a fall in the same column.
    // A different horizontal departure needs a fresh route assessment.
    const samePinnedDeparture = (entry: (typeof this.spatialFailures)[number]): boolean =>
      Math.hypot(pos.x - entry.from.x, pos.z - entry.from.z) < EXACT_FAILURE_RETRY_DISTANCE;
    const targetFailures = this.spatialFailures.filter((entry) => entry.dimension === dim
      && /走不过去|找不到可行路线|钉在原地|没有接近目标/.test(entry.why)
      && (!entry.why.includes('钉在原地') || samePinnedDeparture(entry))
      && Math.hypot(target.x - entry.target.x, target.y - entry.target.y, target.z - entry.target.z) <= PROVEN_TARGET_DISTANCE);
    const targetAttempts = targetFailures.reduce((count, entry) => count + entry.count, 0);
    if (targetAttempts >= 3) {
      const left = Math.ceil((EXACT_FAILURE_WINDOW_MS - (now - Math.min(...targetFailures.map((entry) => entry.at)))) / 1000);
      return `目标格 (${target.x},${target.y},${target.z}) 已连续走不通 ${targetAttempts} 次；${left} 秒内不再接原样靠近的路线。若找到不同入口，可先走新航点再靠近；目标附近方块改变或走通目标格后也可重试。上次卡在:${targetFailures.at(-1)!.why}${this.nearbyRouteHint(bot, target)}`;
    }
    const pinned = this.spatialFailures.find((entry) => entry.dimension === dim
      && entry.why.includes('钉在原地')
      && samePinnedDeparture(entry)
      && entry.target.x === target.x && entry.target.y === target.y && entry.target.z === target.z
      // Falling away from the goal is movement, but it is not route progress.
      && Math.hypot(pos.x - target.x, pos.y - target.y, pos.z - target.z)
        >= Math.hypot(entry.from.x - target.x, entry.from.y - target.y, entry.from.z - target.z) - 1);
    if (pinned) return `刚才走向同一目标时人被钉在原地，此后也没有接近目标；原样重走不会增加进展。先换路线、用即时传送脱困或核对现场。上次卡在:${pinned.why}`;
    const stalled = this.spatialFailures.find((entry) => entry.count >= 2 && entry.dimension === dim
      && Math.hypot(target.x - entry.target.x, target.y - entry.target.y, target.z - entry.target.z) <= NEARBY_GOAL_DISTANCE
      && Math.hypot(pos.x - entry.from.x, pos.y - entry.from.y, pos.z - entry.from.z) < EXACT_FAILURE_RETRY_DISTANCE);
    if (!stalled) return null;
    return `这片目标区域从当前站位已经连续走不通 ${stalled.count} 次；原样靠近或换旁边几格仍会重复卡住。先离开当前站位、改走另一条路线或使用已验证的传送方式。上次卡在:${stalled.why}${this.nearbyRouteHint(bot, target)}`;
  }

  /** 只给当前可读的入口线索；避免让模型在实心目标格上不断平移坐标。 */
  private nearbyRouteHint(bot: Bot, target: { x: number; y: number; z: number }): string {
    const here = bot.entity?.position;
    if (!here || typeof bot.blockAt !== 'function') return '';
    const hints: string[] = [];
    const known = [-1, 0, 1].map((dy) => this.opts.chests?.get(dimensionOf(bot),
      { x: target.x, y: target.y + dy, z: target.z })).find(Boolean);
    if (known) hints.push(`账本记有容器 (${known.x},${known.y},${known.z})；那是方块坐标，goto 应选附近可站立格，开箱用 use at`);
    const cx = Math.floor(here.x), cy = Math.floor(here.y), cz = Math.floor(here.z);
    const doors: Array<{ x: number; y: number; z: number; distance: number }> = [];
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = -1; dy <= 2; dy++) {
      const x = cx + dx, y = cy + dy, z = cz + dz;
      const block = bot.blockAt(new Vec3(x, y, z));
      if (!block || (!block.name.endsWith('_door') && !block.name.endsWith('_fence_gate'))
        || block.name.startsWith('iron_')) continue;
      const props = block.getProperties?.() ?? {};
      if (props.open !== false && props.open !== 'false') continue;
      if (block.name.endsWith('_door') && props.half === 'upper') continue;
      doors.push({ x, y, z, distance: Math.hypot(dx, dy, dz) });
    }
    doors.sort((a, b) => a.distance - b.distance);
    if (doors[0]) {
      const d = doors[0];
      hints.push(`身边还有一扇关闭的门 (${d.x},${d.y},${d.z})；若它是入口，可先 use at 打开，再重探路线`);
    }
    return hints.length ? `。现场线索:${hints.join('；')}` : '';
  }

  private recordSpatialOutcome(steps: readonly SkillCall[], failed: boolean, why: string): void {
    const target = lastAbsoluteGoto(steps);
    const bot = this.opts.getBot();
    const pos = bot?.entity?.position;
    if (!target || !bot || !pos) return;
    const now = Date.now();
    const dim = dimensionOf(bot);
    const occupied = why.includes('目标那一格站不进人');
    const near = (entry: (typeof this.spatialFailures)[number]): boolean => entry.dimension === dim
      && (occupied || entry.why.includes('目标那一格站不进人')
        ? entry.target.x === target.x && entry.target.y === target.y && entry.target.z === target.z
        : Math.hypot(target.x - entry.target.x, target.y - entry.target.y, target.z - entry.target.z) <= NEARBY_GOAL_DISTANCE
          && Math.hypot(pos.x - entry.from.x, pos.y - entry.from.y, pos.z - entry.from.z) < EXACT_FAILURE_RETRY_DISTANCE);
    this.spatialFailures = this.spatialFailures.filter((entry) => now - entry.at < EXACT_FAILURE_WINDOW_MS);
    if (!failed) {
      // Reaching an already-satisfied GoalNear can succeed without moving at all.
      // Keep the short-lived request keyed by its starting cell so another
      // identical goto from that cell is refused; real movement naturally
      // changes the next request's key.
      this.spatialFailures = this.spatialFailures.filter((entry) => entry.dimension !== dim
        || Math.hypot(target.x - entry.target.x, target.y - entry.target.y, target.z - entry.target.z) > PROVEN_TARGET_DISTANCE);
      return;
    }
    const prior = this.spatialFailures.find(near);
    if (prior) {
      prior.count++;
      prior.at = now;
      prior.why = maskCoords(why).slice(0, 180);
      return;
    }
    this.spatialFailures.push({ count: 1, at: now, why: maskCoords(why).slice(0, 180), dimension: dim,
      target, from: { x: pos.x, y: pos.y, z: pos.z } });
    if (this.spatialFailures.length > 32) this.spatialFailures.shift();
  }

  private clearSpatialFailuresForChangedBlock(cell: Cell, dimension: string): void {
    this.spatialFailures = this.spatialFailures.filter((entry) => entry.dimension !== dimension
      || (Math.hypot(cell.x - entry.from.x, cell.y - entry.from.y, cell.z - entry.from.z) > 5
        && Math.hypot(cell.x - entry.target.x, cell.y - entry.target.y, cell.z - entry.target.z) > PROVEN_TARGET_DISTANCE));
    for (const [key, entry] of this.exactFailures) {
      if (key.includes('"skill":"goto"') && entry.from?.dimension === dimension
        && Math.hypot(cell.x - entry.from.x, cell.y - entry.from.y, cell.z - entry.from.z) <= 5) {
        this.exactFailures.delete(key);
      }
    }
    this.recentGotoRequests.clear();
  }

  private recordStalledCancel(task: RunningTask, now: number): void {
    if (task.steps[task.stepIndex]?.skill !== 'goto' || task.goalProgressAt === undefined
      || now - task.goalProgressAt < STALLED_CANCEL_MS || now - task.stepStartedAt < STALLED_CANCEL_MS) return;
    const why = `叫停前 ${Math.round((now - task.goalProgressAt) / 1000)} 秒没有接近目标`;
    this.recordSpatialOutcome([task.steps[task.stepIndex]], true, why);
    this.opts.diag?.write({ lane: 'task', event: 'stalled-navigation-cancelled', taskId: task.id,
      msg: why, data: { step: task.stepIndex + 1, goal: lastAbsoluteGoto([task.steps[task.stepIndex]]) }, incident: true });
  }

  private recordExactOutcome(steps: readonly SkillCall[], failed: boolean, why: string,
    admissionRule?: string): number | undefined {
    const openStorage = this.openStorageKey(steps);
    if (!failed && steps.some((step) => step.skill === 'take' || step.skill === 'compact')) {
      this.fullOpenStorageFailures.clear();
    }
    if (failed && openStorage && /当前窗口没有存进|那一边没空位了/.test(why)) {
      const prior = this.fullOpenStorageFailures.get(openStorage);
      const now = Date.now();
      this.fullOpenStorageFailures.set(openStorage, {
        count: prior && now - prior.at < 120_000 ? prior.count + 1 : 1,
        at: now, why: maskCoords(why).slice(0, 160),
      });
    }
    if (!retryGuardApplies(steps) && !admissionRule) return;
    const exactKey = JSON.stringify(steps);
    const sourceKey = openTakeRetryKey(steps);
    const bot = this.opts.getBot();
    const namedKey = steps.length === 1 ? namedTakeRetryKey(steps, bot) : null;
    if (!failed) {
      this.exactFailures.delete(exactKey);
      if (sourceKey) this.exactFailures.delete(sourceKey);
      if (namedKey) this.exactFailures.delete(namedKey);
      return;
    }
    const key = namedKey ?? (sourceKey && /当前窗口没取到|当前没有打开可取东西的容器窗口/.test(why)
      ? sourceKey : exactKey);
    const now = Date.now();
    for (const [entryKey, entry] of this.exactFailures) {
      if (now - entry.at >= EXACT_FAILURE_WINDOW_MS) this.exactFailures.delete(entryKey);
    }
    const prior = this.exactFailures.get(key);
    const inventoryStamp = steps.some((step) => step.skill === 'craft')
      ? this.retryInventoryStamp(bot) : null;
    const at = bot?.entity?.position;
    const from = at && bot ? { x: at.x, y: at.y, z: at.z, dimension: dimensionOf(bot) } : null;
    const windowTake = Boolean(namedKey) || steps.some((step) => step.skill === 'take' && step.from === 'open');
    const samePlace = windowTake || !prior?.from || !from || (prior.from.dimension === from.dimension
      && Math.hypot(from.x - prior.from.x, from.y - prior.from.y, from.z - prior.from.z) < EXACT_FAILURE_RETRY_DISTANCE);
    const admissionInventoryStamp = admissionRule ? this.retryInventoryStamp(bot) : undefined;
    const admissionTargetBlock = admissionRule ? this.admissionBlockStamp(steps) : undefined;
    const changedAdmission = admissionRule && prior?.admissionRule
      && (prior.admissionRule !== admissionRule || prior.admissionInventoryStamp !== admissionInventoryStamp
        || prior.admissionTargetBlock !== admissionTargetBlock);
    const count = prior && now - prior.at < EXACT_FAILURE_WINDOW_MS && samePlace
      && prior.inventoryStamp === inventoryStamp && !changedAdmission ? prior.count + 1 : 1;
    const evidence = namedKey ? this.takeEvidenceNote(steps, now) : null;
    const takeProof = evidence?.proof;
    this.exactFailures.set(key, { count, at: now, why: maskCoords(why).slice(0, 180), from, inventoryStamp,
      ...(takeProof ? { takeProof } : {}),
      ...(admissionRule ? { admissionRule, admissionInventoryStamp, admissionTargetBlock } : {}) });
    return count;
  }

  private retryInventoryStamp(bot: Bot | null): string | null {
    if (!bot?.inventory?.items) return null;
    return bot.inventory.items()
      .map((item) => `${item.type}:${item.count}`)
      .sort().join('|');
  }

  /** Farming validity also depends on the loaded support and cover cells. */
  private admissionBlockStamp(steps: readonly SkillCall[]): string | null {
    const bot = this.opts.getBot();
    if (!bot) return null;
    const readings: string[] = [];
    for (const step of steps) {
      if (step.skill !== 'use' || !step.at || !step.item) continue;
      if (!isHoeUseItem(step.item) && !SEED_CROP[step.item] && step.item !== 'nether_wart') continue;
      const cell = this.precheckDeps(bot).resolve(step.at);
      if (!cell) continue;
      for (const dy of [-1, 0, 1]) {
        const at = { ...cell, y: cell.y + dy };
        const block = blockAtCell(bot, at);
        readings.push(`${at.x},${at.y},${at.z}:${block ? `${block.name}:${block.stateId}` : 'unloaded'}`);
      }
    }
    return readings.length ? readings.join('|') : this.observeTask(steps)?.targetBlock ?? null;
  }

  /**
   * 带 direction 的 `find` 是一个真实的行军循环(见 skillFind),不是原地扫一眼。
   * 受理刻把这一步的空间代价当场说出来:朝哪走、最多几格、走满时离重生点多远。
   *
   * 只报读数,不劝阻也不拦 —— 走不走是她的权衡(「出发前试算只拦事实,不拦权衡」)。
   * 重生点距离按**走满**算(方向单位向量 × distance),那是这一步的上界。
   *
   * 重生点之外再附一句离最近路标多远(「离『家』约 130 格」):重生点是系统给的
   * 一个点,路标是她自己命名的地方 —— 后者才是她盘算"走这一趟离家多远"时用的尺子。
   */
  private marchNote(steps: SkillCall[]): string | null {
    const legs = steps.filter(
      (c): c is Extract<SkillCall, { skill: 'find' }> => c.skill === 'find' && c.direction !== undefined,
    );
    if (legs.length === 0) return null;
    const anchor = this.opts.spawnAnchor?.();
    const spawnNote = anchor === null ? '你现在没有重生点' : '你的个人重生点尚未核实';
    const bot = this.opts.getBot();
    const feet = bot?.entity ? feetOf(bot) : null;
    /** 成对报告行军前后距出发点最近路标的距离。 */
    const drift = (at: Cell, end: Cell): string | null => {
      const from = this.opts.marks?.().nearest(at) ?? null;
      if (!from) return null;
      const was = Math.round(Math.hypot(at.x - from.x, at.z - from.z));
      const will = Math.round(Math.hypot(end.x - from.x, end.z - from.z));
      return `离「${from.name}」从 ${was} 格变成约 ${will} 格`;
    };
    const one = (c: Extract<SkillCall, { skill: 'find' }>): string => {
      const head = `这一步会朝${DIRECTION_ZH[c.direction!]}走最多 ${c.distance} 格`;
      if (!feet) {
        return anchor ? `${head}(离重生点多远算不出来:还没连上服务器)` : `${head},${spawnNote}`;
      }
      const end = marchEnd(feet, c.direction!, c.distance);
      // 上界估算:是估算这件事必须写在字面上(「约」)
      const near = drift(feet, end) ?? this.opts.marks?.().near(end, true) ?? null;
      if (!anchor) {
        return near ? `${head},走满时${near}(${spawnNote})` : `${head},${spawnNote}`;
      }
      if (anchor.dimension
        && normalizeDimension(anchor.dimension) !== normalizeDimension(dimensionOf(bot!))) {
        return `${head},重生点在${zhDimension(anchor.dimension)},不和当前维度计算直线距离${near ? `;走满时${near}` : ''}`;
      }
      const away = Math.round(Math.hypot(end.x - anchor.x, end.z - anchor.z));
      return `${head},走满时离重生点 ${cellText(anchor)} 约 ${away} 格${near ? `、${near}` : ''}`;
    };
    return legs.map(one).join(';');
  }

  /** 受理时报告长途 goto 的直线距离和步行估时，不自动拆航点或阻断。 */
  private hikeNote(steps: SkillCall[], origin: Cell | null): string | null {
    if (origin === null) return null;
    const out: string[] = [];
    const bot = this.opts.getBot();
    const dimension = bot ? normalizeDimension(dimensionOf(bot)) : null;
    for (const c of steps) {
      if (c.skill !== 'goto') continue;
      if (dimension && c.dimension && normalizeDimension(c.dimension) !== dimension) continue;
      const resolved = resolveAnchors([c.at], origin);
      if (!Array.isArray(resolved)) continue;
      // 水平距离:goto [x,z] 的 y 要到执行那一刻才解,竖直分量在受理刻本来就是假的
      const dist = Math.hypot(resolved[0].x - origin.x, resolved[0].z - origin.z);
      if (dist <= LONG_GOTO_BLOCKS) continue;
      out.push(`这一步直线 ${Math.round(dist)} 格,步行约 ${fmtWalk(dist)}(平地不绕路、不挖不垫的下限)`);
    }
    return out.length > 0 ? out.join(';') : null;
  }

  /**
   * 受理刻的危险区陈述:这一单的目标点/行军终点落进了**她自己圈的**危险区。
   *
   * **措辞铁律(PWSR 主客观纪律):** 只说「你标记的危险区」这个事实,永远不写成
   * 系统的判断(不出现"危险""建议"这类词),也不拦不劝 —— 走不走是她的权衡。
   * 圈是她画的,她比系统更清楚圈里为什么危险,以及这一趟值不值。
   */
  private dangerNote(steps: SkillCall[]): string | null {
    try {
      const desk = this.opts.marks?.();
      if (!desk) return null;
      const bot = this.opts.getBot();
      if (!bot?.entity) return null;
      const target = new Set<string>();
      const march = new Set<string>();
      const feet = feetOf(bot);
      for (const call of steps) {
        if (call.skill === 'find' && call.direction !== undefined) {
          for (const n of desk.danger(marchEnd(feet, call.direction, call.distance))) march.add(n);
          continue;
        }
        const cell = targetCellOf(bot, call);
        if (cell) for (const n of desk.danger(cell)) target.add(n);
      }
      return [
        dangerNoteText([...target], '目标'),
        dangerNoteText([...march], '走满时的行军终点'),
      ].filter(Boolean).join(';') || null;
    } catch {
      return null; // 陈述不许成为故障源:算不出来就不说
    }
  }

  /**
   * 前置试算使用执行器的锚点解析、形状展开、方块读取与进食记录。
   * 全部包成不抛的形式:试算自己绝不许成为故障源。
   */
  private precheckDeps(bot: Bot): PrecheckDeps {
    return {
      resolve: (a) => { try { return resolveAt(bot, a as Anchor); } catch { return null; } },
      cellsOf: (c) => {
        try {
          const b = c as PlaceCall;
          if (!('anchors' in b)) return null;
          return shapeCells(bot, b.shape, b.anchors, b.fill, BUILD_CELL_CAP);
        } catch { return null; }
      },
      blockAt: (cell) => blockAtCell(bot, cell),
      lastAte: () => lastAteOf(bot),
      chests: this.opts.chests,
    };
  }

  /**
   * 受理回执里的「上次这一单什么下场」那一句;没有旧账、旧账太老或开关关着时静默。
   *
   * 15 分钟窗口:再往前的账她多半已经换了打法,拿出来只会误导。
   * 顺手清掉过期项——这张表按签名开条目,一场几百种,不清会一直长。
   */
  private priorOutcomeContext(steps: readonly SkillCall[]): string | null {
    const bot = this.opts.getBot();
    const position = bot?.entity?.position;
    if (!bot || !position || ![position.x, position.y, position.z].every(Number.isFinite)) return null;
    const from = { x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) };
    return JSON.stringify([normalizeDimension(dimensionOf(bot)), from, exactTaskKey(steps)]);
  }

  private priorNote(task: QueuedTask, now: number, round: RoundaboutSnapshot | null): string | null {
    if (this.opts.priorOutcome?.() === false) return null;
    for (const [k, v] of this.priorOutcomes) if (now - v.at > PRIOR_OUTCOME_WINDOW_MS) this.priorOutcomes.delete(k);
    const prev = this.priorOutcomes.get(taskSignature(task.steps));
    return task.priorContext && prev?.context === task.priorContext ? priorOutcomeNote(prev, now, round) : null;
  }

  /**
   * 记录窗口内同类签名的提交与首步开跑次数，仅报告事实。
   * 必须在 pump() 前取快照，避免将本次开跑计入先前尝试。
   */
  private noteSubmitted(sig: string, at: number, id: number): RoundaboutSnapshot {
    for (const [k, v] of this.roundabout) {
      v.submits = v.submits.filter((submission) => at - submission.at <= PRIOR_OUTCOME_WINDOW_MS);
      if (v.submits.length === 0) this.roundabout.delete(k);
    }
    const entry = this.roundabout.get(sig) ?? { submits: [] };
    const ranBefore = entry.submits.filter((submission) => submission.started).length;
    const first = entry.submits[0]?.at ?? at;
    entry.submits.push({ id, at, started: false });
    this.roundabout.set(sig, entry);
    return { times: entry.submits.length, spanMs: at - first, ranBefore };
  }

  /** 这一签名的单真开跑了(第 1 步进了执行循环) */
  private noteStarted(sig: string, id: number): void {
    const submission = this.roundabout.get(sig)?.submits.find((item) => item.id === id);
    if (submission) submission.started = true;
  }

  /**
   * 受理时保护重生锚；返回提示则拒单，null 放行。
   * 几何操作间接覆盖锚点时拒单；显式点名首次警告并拒单，确认窗口内同签名同锚点重发放行。
   * 寻路保护由 bridge 处理，拾取后的状态由 pickup 回报。
   */
  private spawnGuardNote(steps: SkillCall[], now: number): string | null {
    try {
      return this.spawnGuardVerdict(steps, now);
    } catch {
      return null; // 闸不许成为第二个故障源:算不出来就放行,由技能自己在出队刻说
    }
  }

  private spawnGuardVerdict(steps: SkillCall[], now: number): string | null {
    const anchor = this.opts.spawnAnchor?.();
    if (!anchor) return null;
    const bot = this.opts.getBot();
    if (!bot?.entity) return null;
    if (anchor.dimension
      && normalizeDimension(anchor.dimension) !== normalizeDimension(dimensionOf(bot))) return null;
    const guard = spawnGuardCells(bot, anchor);
    const at = cellText(guard[0]);
    for (let i = 0; i < steps.length; i++) {
      const call = steps[i];
      const where = steps.length > 1 ? `第 ${i + 1} 步` : '这一单';
      if (namesSpawnAnchor(bot, call, guard)) {
        const key = `${taskSignature(steps)}@${cellKeyOf(guard[0])}`;
        const prev = this.spawnConfirm;
        if (prev && prev.key === key && now - prev.at <= SPAWN_CONFIRM_WINDOW_MS) {
          this.spawnConfirm = null;
          this.opts.diag?.write({
            lane: 'task', event: 'spawn-anchor-confirmed',
            msg: `重生锚 ${at}:同样的单再下一次,按确认放行`,
            data: { key, steps },
          });
          return null;
        }
        this.spawnConfirm = { key, at: now };
        this.opts.diag?.write({
          lane: 'task', event: 'spawn-anchor-hold',
          msg: `重生锚 ${at}:显式指名要动它,先警告等确认`,
          data: { key, steps },
        });
        return `${where}要动的 ${at} 就是你的重生锚。它一离开地面,重生点当场作废,` +
          '死了会回世界出生点。真要搬走就再下一次一模一样的单,我照做;换个目标的话这一单作废。';
      }
      const cells = shapeFootprint(bot, call, this.opts.blueprints?.() ?? null);
      const hit = cells?.find((c) => guard.some((g) => g.x === c.x && g.y === c.y && g.z === c.z));
      if (!hit) continue;
      this.opts.diag?.write({
        lane: 'task', event: 'spawn-anchor-refused',
        msg: `重生锚 ${at}:形状罩住 ${cellText(hit)},驳回`,
        data: { step: i + 1, hit, anchor, steps },
      });
      return `${where}的形状罩住了 ${cellText(hit)} —— 你的重生锚在 ${at},` +
        '罩住它或它脚下那一格,重生点就当场作废了。避开那几格重下这一单;' +
        '真要拆,单独下一条只对准那一格的 excavate,我会先跟你确认。';
    }
    return null;
  }

  /**
   * 受理时拒绝在自身碰撞箱正上方放置重力方块的整单任务。
   * 必须先于 skillBuild 的移身操作检查，避免移身后放置绕过保护。
   */
  private gravityGuardNote(steps: SkillCall[]): string | null {
    try {
      return this.gravityGuardVerdict(steps);
    } catch {
      return null; // 同上:闸算不出来就放行
    }
  }

  private gravityGuardVerdict(steps: SkillCall[]): string | null {
    if (!steps.some((c) => c.skill === 'build' && ('blueprint' in c || isGravityBlock(c.material)))) {
      return null;
    }
    const bot = this.opts.getBot();
    if (!bot?.entity) return null;
    const desk = this.opts.blueprints?.() ?? null;
    const feet = feetOf(bot);
    const overheadCell = (c: Cell): boolean =>
      c.x === feet.x && c.z === feet.z && c.y > feet.y && c.y <= feet.y + GRAVITY_OVERHEAD;
    for (let i = 0; i < steps.length; i++) {
      const call = steps[i];
      if (call.skill !== 'build') continue;
      // 蓝图形态:哪一格放的是沙砾这类由 IR 步自己说,闸认的还是「落点在不在我头顶」
      if ('blueprint' in call) {
        const bad = blueprintFootprint(bot, call, desk)
          .find((c) => isGravityBlock(c.item) && overheadCell(c.cell));
        if (!bad) continue;
        this.opts.diag?.write({
          lane: 'task', event: 'gravity-overhead-refused',
          msg: `蓝图「${call.blueprint}」要把 ${bad.item} 放在头顶 ${cellText(bad.cell)},驳回`,
          data: { step: i + 1, blueprint: call.blueprint, material: bad.item, hit: bad.cell, feet },
        });
        return `${steps.length > 1 ? `第 ${i + 1} 步` : '这一单'}那张图会把${zhName(bad.item)}放在 `
          + `${cellText(bad.cell)},那是我头顶这一柱上的格子。${zhName(bad.item)}下面没有支撑就整块掉下来,`
          + '落到头上会把我埋住闷死。挪一格锚点,或者先走开再让它盖那一层。';
      }
      if (!isGravityBlock(call.material)) continue;
      const overhead = 'anchors' in call && call.anchors.some((a) => isOverheadAnchor(a));
      const hit = overhead
        ? { x: feet.x, y: feet.y + 1, z: feet.z }
        : shapeFootprint(bot, call, desk)?.find(overheadCell);
      if (!hit) continue;
      this.opts.diag?.write({
        lane: 'task', event: 'gravity-overhead-refused',
        msg: `${call.material} 要放在头顶 ${cellText(hit)},驳回`,
        data: { step: i + 1, material: call.material, hit, feet },
      });
      return `${steps.length > 1 ? `第 ${i + 1} 步` : '这一单'}要把${zhName(call.material)}放在 ${cellText(hit)},` +
        `那是我头顶这一柱上的格子。${zhName(call.material)}下面没有支撑就整块掉下来,` +
        '落到头上会把我埋住闷死。换个不在我头顶的位置,或者换一种不会掉的材料。';
    }
    return null;
  }

  /** 已知目标格错误且此前没有改地形的步骤时，拒绝必败的耕种任务。 */
  private definiteSoilPrecheckNote(steps: readonly SkillCall[]): { text: string; step: SkillCall } | null {
    if (this.opts.precheck?.() === false) return null;
    const bot = this.opts.getBot();
    if (!bot) return null;
    try {
      const hit = precheckSteps(bot, [...steps], this.precheckDeps(bot)).find(({ index, note }) =>
        ['use.hoeWrongBlock', 'use.hoeCovered', 'use.seedWrongBlock', 'use.seedFlooded', 'use.soilCell'].includes(note.rule)
        // 之前若已有挖掘、放置等动作，目标方块可能改变，仍交给执行刻判定。
        && steps.slice(0, index).every((step) => step.skill === 'goto'
          || (note.rule === 'use.seedWrongBlock' && step.skill === 'use' && !!step.item
            && isHoeUseItem(step.item))));
      if (!hit) return null;
      return {
        text: `第 ${hit.index + 1} 步的目标格已确认不适合耕种：${hit.note.text}。这单未入队；按现场读数修正后可立即提交，不需要等待`,
        step: steps[hit.index],
      };
    } catch { return null; }
  }

  /** 受理回执里的试算那一句;全通返回 null(静默) */
  private precheckNote(steps: SkillCall[]): string | null {
    if (this.opts.precheck?.() === false) return null;
    const bot = this.opts.getBot();
    if (!bot) return null;
    const hits = precheckSteps(bot, steps, this.precheckDeps(bot));
    if (hits.length > 0) {
      this.opts.diag?.write({
        lane: 'task', event: 'precheck',
        msg: `受理刻试算命中 ${hits.length} 条`,
        data: { hits: hits.map((h) => ({ step: h.index + 1, ...h.note })) },
      });
    }
    return renderPrecheckNotes(hits);
  }

  private takeDrainingContinuation(): QueuedTask | null {
    const drain = this.checkpointDrain;
    const continuation = drain?.continuation ?? null;
    if (drain) drain.continuation = null;
    return continuation && continuation.id !== this.task?.id ? continuation : null;
  }

  /** 撤销新机械原语保存的工作，不改变原有普通队列任务。 */
  private removeCheckpointWork(): QueuedTask[] {
    const dropped = this.queue.filter((task) => task.checkpointRequest || task.checkpointContinuation);
    this.queue = this.queue.filter((task) => !task.checkpointRequest && !task.checkpointContinuation);
    const continuation = this.takeDrainingContinuation();
    if (continuation && !dropped.some((task) => task.id === continuation.id)) dropped.push(continuation);
    return dropped;
  }

  private detachCheckpointOwner(taskId: number): void {
    for (const queued of this.queue) {
      if (queued.checkpointOwnerId === taskId) queued.checkpointOwnerId = undefined;
    }
  }

  private checkpointReady(task: RunningTask, bot: Bot, stable = true, boundary = false): boolean {
    if (this.task !== task || task.flag.aborted || this.stopped
      || task.flag.epoch !== this.executionEpoch || this.opts.getBot() !== bot) return false;
    if (!this.queue.some((queued) => queued.checkpointOwnerId === task.id)) return false;
    if (this.holdReason() !== null || this.opts.busyWith?.() || task.escape.active || (this.escaping && !boundary)
      || this.opts.bodyState?.().combatActive || this.opts.bodyState?.().environmentOwnerKind) return false;
    const owner = goalOwnerKind(bot);
    if (owner !== null && owner !== 'task') return false;
    if (bot.currentWindow || bot.inventory?.selectedItem || !inventoryReadConfirmed(bot)) return false;
    if (stable && bot.entity?.onGround !== true && !flightState(bot).flying) return false;
    if (bot.pathfinder?.isMoving?.() || bot.pathfinder?.isMining?.() || bot.pathfinder?.isBuilding?.()) return false;
    if (typeof bot.blockAt !== 'function' || !bot.entity?.position) return false;
    const foot = bot.blockAt(bot.entity.position.floored());
    const head = bot.blockAt(bot.entity.position.offset(0, 1.62, 0).floored());
    if (!foot || !head || bodyInWater(bot) || headInWater(bot)) return false;
    const hazard = hazardTouch(bot);
    return !hazard.touching && !hazard.submerged && !hazard.onFire;
  }

  private async checkpointTask(
    task: RunningTask, bot: Bot, resumeFrom: number, boundary: boolean, settle?: () => Promise<void>,
  ): Promise<void> {
    if (!boundary && (!checkpointReplayable(task.steps[resumeFrom])
      || (task.steps[resumeFrom].skill === 'collect' && !task.count))) return;
    if (this.checkpointDrain || !this.checkpointReady(task, bot, !settle, boundary)) return;
    const drain: CheckpointDrain = { task, bot, resumeFrom, boundary, phase: 'settling', continuation: null };
    this.checkpointDrain = drain;
    try {
      await settle?.();
    } catch (err) {
      if (err instanceof Aborted || task.flag.aborted || task.flag.epoch !== this.executionEpoch || this.stopped) {
        throw err instanceof Aborted ? err : new Aborted(task.flag.by);
      }
      this.checkpointDrain = null;
      this.opts.diag?.write({ lane: 'task', event: 'yield-deferred', taskId: task.id,
        msg: '检查点收尾未完成，继续原任务', data: { reason: (err as Error).message } });
      return;
    }
    if (task.flag.aborted || task.flag.epoch !== this.executionEpoch || this.stopped || this.opts.getBot() !== bot) {
      throw new Aborted(task.flag.by);
    }
    if (!this.checkpointReady(task, bot, true, boundary)) {
      this.checkpointDrain = null;
      return;
    }
    drain.continuation = {
      ...task,
      resumeFrom,
      interrupted: null,
      progress: boundary
        ? task.progress?.step === resumeFrom + 1 ? task.progress : undefined
        : { step: resumeFrom + 1, count: task.count },
      checkpointOwnerId: undefined,
      checkpointRequest: undefined,
      checkpointContinuation: true,
      resumeDimension: normalizeDimension(dimensionOf(bot)),
    };
    drain.phase = 'yielded';
    task.flag.aborted = true;
    task.flag.by = '安全检查点让位';
    this.opts.diag?.write({ lane: 'task', event: 'yield-draining', taskId: task.id,
      msg: '已保存检查点断点，等待当前执行实例完成收尾',
      data: { resumeFrom, boundary, count: task.count,
        requestIds: this.queue.filter((queued) => queued.checkpointOwnerId === task.id).map((queued) => queued.id) } });
    throw new Yielded();
  }

  /** 此回调在技能与执行器所有 finally 返回之后运行。 */
  private completeCheckpointDrain(task: RunningTask): void {
    const drain = this.checkpointDrain;
    if (!drain || drain.task !== task) return;
    this.checkpointDrain = null;
    if (this.task === task) this.task = null;
    const continuation = drain.continuation;
    if (continuation && !this.stopped && task.flag.epoch === this.executionEpoch && this.opts.getBot() === drain.bot) {
      const requested = this.queue.filter((queued) => queued.checkpointOwnerId === task.id);
      const last = this.queue.reduce((found, queued, index) => queued.checkpointOwnerId === task.id ? index : found, -1);
      this.queue.splice(last + 1, 0, continuation);
      const body = this.opts.bodyState?.();
      const goalOwner = goalOwnerKind(drain.bot);
      if (!this.opts.busyWith?.() && this.holdReason() === null && !this.escaping && !task.escape.active
        && !body?.combatActive && !body?.environmentOwnerKind && (goalOwner === null || goalOwner === 'task')) {
        releaseBody(drain.bot, '检查点收尾完成', this.opts.diag);
      }
      this.opts.report({ kind: 'suspended', taskId: task.id,
        text: `任务#${task.id} 已在安全检查点挂起，第 ${(continuation.resumeFrom ?? 0) + 1}/${task.steps.length} 步待续；`
          + (requested.length > 0 ? `先执行${requested.map((queued) => `任务#${queued.id}`).join('、')}，随后以原任务 ID 续做。`
            : '检查点请求已撤销，继续原任务。') });
      this.opts.diag?.write({ lane: 'task', event: 'yield-suspended', taskId: task.id,
        msg: '旧执行实例已退出，检查点断点进入队列',
        data: { resumeFrom: continuation.resumeFrom, requestIds: requested.map((queued) => queued.id) } });
    }
    this.pump();
  }

  /**
   * `queue:"now"` 的中断路径:掐掉手上这件(结局由受理回执点名,不另发汇报)。
   * 正在逃的任务不抢——逃岩浆的时候不插火把,急件在队头等它逃完。
   */
  private interrupt(): string | null {
    const checkpointDropped = this.removeCheckpointWork();
    for (const dropped of checkpointDropped) {
      this.reportCancelled(dropped, 'queue:"now" 的新任务顶替', Executor.frozenProgress(dropped));
    }
    const droppedNote = checkpointDropped.length > 0
      ? `撤掉了检查点待办 ${checkpointDropped.map((dropped) => `任务#${dropped.id}`).join('、')}` : null;
    const t = this.task;
    const frozen = this.frozen;
    if (!t && !frozen) return droppedNote;
    if (t && this.escaping) {
      return `${droppedNote ? `${droppedNote};` : ''}`
        + `手上这件正在自保(任务#${t.id}「${labelOf(t)}」),不抢它;它脱身之后立刻做这件`;
    }
    const notes: string[] = droppedNote ? [droppedNote] : [];
    if (t) {
      const at = this.progressOf(t);
      this.recordStalledCancel(t, Date.now());
      this.abortTask(t, '被 queue:"now" 的新任务顶替');
      this.reportCancelled(t, 'queue:"now" 的新任务顶替', at);
      notes.push(cancelledNote(
        `任务#${t.id}「${labelOf(t)}」`,
        t,
        at.step,
        'running',
      ) + `${t.count ? `(进度 ${t.count.done}/${t.count.total})` : ''}`);
    }
    if (frozen) {
      this.frozen = null;
      // suspend 的旧 RunningTask 可能还在同一调用栈里；同一个任务只补一条终态。
      if (!t || t.id !== frozen.id) {
        const at = Executor.frozenProgress(frozen);
        this.reportCancelled(frozen, 'queue:"now" 的新任务顶替', at);
        notes.push(cancelledNote(
          `战斗中待续的任务#${frozen.id}「${labelOf(frozen)}」`,
          frozen,
          at?.step ?? null,
          'frozen',
        ));
      }
    }
    return notes.join(';');
  }

  /** 队列空着且没在做事就开下一件;身体被战斗占着时闸住(resume 时再泵) */
  private pump(): void {
    const bot = this.opts.getBot();
    // A disconnected native promise may never return. Its finally belongs to the old Bot,
    // while same-Bot abort/death must still drain before sharing that body's controls.
    if (this.checkpointDrain && this.checkpointDrain.bot !== bot) this.checkpointDrain = null;
    if (this.stopped || this.task || this.checkpointDrain || this.holdReason() !== null) return;
    if (this.opts.busyWith?.()) return;
    if (this.queue.some((queued) => queued.checkpointRequest || queued.checkpointContinuation)) {
      const body = this.opts.bodyState?.();
      const owner = goalOwnerKind(this.opts.getBot());
      if (body?.combatActive || body?.environmentOwnerKind || this.escaping
        || (owner !== null && owner !== 'task')
        || [...this.runningInstances].some(([running, instance]) => instance === bot && running.flag.aborted)) return;
    }
    const next = this.queue.shift();
    if (!next) return;
    // 反射自保时会在没有任务的情况下下寻路目标;新任务一律接管,否则一边合成
    // 一边被上一轮的逃跑路线带着走
    dropGoal(this.opts.getBot(), 'task', `新任务#${next.id}接管身体`, this.opts.diag);
    const flag: AbortFlag = { aborted: false, by: null, epoch: this.executionEpoch };
    const now = Date.now();
    // 打转账只记第一次开跑:断点续做是同一单接着跑,不是又下了一单
    if (next.startedAt === undefined) this.noteStarted(taskSignature(next.steps), next.id);
    this.task = {
      ...next, startObservation: next.startObservation ?? this.observeTask(next.steps) ?? undefined,
      stepLog: next.stepLog ?? [], flag, escape: { active: false },
      startedAt: next.startedAt ?? now, stepIndex: 0, stepStartedAt: now, count: null,
    };
    this.opts.diag?.write({
      lane: 'task', event: 'start', taskId: next.id,
      msg: `开始任务#${next.id}「${labelOf(next)}」`,
      data: { steps: next.steps, waiting: this.queue.length },
    });
    const running = this.task;
    if (next.checkpointContinuation) {
      this.opts.report({ kind: 'resumed', taskId: next.id,
        text: `任务#${next.id} 从安全检查点续做，第 ${(next.resumeFrom ?? 0) + 1}/${next.steps.length} 步。` });
      this.opts.diag?.write({ lane: 'task', event: 'yield-resumed', taskId: next.id,
        msg: '检查点断点以原任务 ID 续做',
        data: { resumeFrom: next.resumeFrom, count: next.progress?.count ?? null } });
    }
    this.runningInstances.set(running, bot);
    void this.run(running, flag).finally(() => {
      this.runningInstances.delete(running);
      this.completeCheckpointDrain(running);
      if (!this.task && this.queue.some((queued) => queued.checkpointRequest || queued.checkpointContinuation)) this.pump();
    });
  }

  /**
   * 可恢复夺手:当前任务断点挂起,不是抢占——preempt 会撤空整条队列。当前步骤走
   * checkAbort 通道中止;不可重跑的步(reRunnable)恢复时按没做成算。战斗由 busyWith
   * 闸住，环境危机另持 queueHold，二者都在安全交还后续做。
   */
  suspend(by = '战斗', owner: QueueFreezeOwner = 'combat'): void {
    if (this.stopped || this.frozen) return;
    const t = this.task;
    if (!t) return;
    if (this.checkpointDrain?.task === t && this.checkpointDrain.phase === 'yielded') return;
    const boundary = this.checkpointDrain?.task === t && this.checkpointDrain.boundary
      ? this.checkpointDrain.resumeFrom : null;
    this.abortTask(t, by);
    if (t.program) { this.reportCancelled(t, by, null); return; }
    const idem = reRunnable(t.steps[t.stepIndex]);
    this.frozen = {
      id: t.id, steps: t.steps, enqueuedAt: t.enqueuedAt, startedAt: t.startedAt,
      resumeFrom: boundary ?? (idem ? t.stepIndex : t.stepIndex + 1),
      interrupted: boundary !== null || idem ? null : t.stepIndex,
      progress: boundary !== null ? t.progress : { step: t.stepIndex + 1, count: t.count },
      // 已经做掉的步跟着任务走:重建 ctx 会丢,重跑会报假失败
      absorbed: t.absorbed,
      findOrigins: t.findOrigins,
      // 各步终态的账同理:挂起前跑成的那几步,断点被撤时还得说得出来
      stepLog: t.stepLog,
      queueTailNotified: t.queueTailNotified,
      intended: t.intended,
      frozenBy: owner,
      checkpointOwnerId: t.checkpointOwnerId,
      checkpointRequest: t.checkpointRequest,
      checkpointContinuation: t.checkpointContinuation,
      resumeDimension: t.resumeDimension,
    };
    this.opts.diag?.write({
      lane: 'task', event: 'suspend', taskId: t.id,
      msg: `任务#${t.id}「${labelOf(t)}」在第 ${t.stepIndex + 1} 步被挂起(${by}),交还身体后续做`,
      data: { stepIndex: t.stepIndex, reRunnable: idem, by },
    });
  }

  /**
   * 步边界上的冻结:这一步**还没开跑**,断点就落在它自己身上。
   *
   * 与 `suspend()` 的差别只在断点算法:那一条是"跑到一半被夺手",非幂等步按做了一半
   * 算(`resumeFrom = stepIndex + 1`、记 `interrupted`);这一条是"还没开工就被拦下",
   * 无论幂等与否都从这一步原样重来。
   */
  private freezeBeforeStep(t: RunningTask, i: number, why: string): boolean {
    // 断点只有一个槽。已经被别人(战斗)占着时不抢,照旧往下跑 —— 抢了等于把那一单丢掉
    if (this.stopped || this.frozen) return false;
    this.frozen = {
      id: t.id, steps: t.steps, enqueuedAt: t.enqueuedAt, startedAt: t.startedAt,
      resumeFrom: i, interrupted: null,
      queueTailNotified: t.queueTailNotified,
      absorbed: t.absorbed, stepLog: t.stepLog, intended: t.intended,
      findOrigins: t.findOrigins, frozenBy: 'queue',
      checkpointOwnerId: t.checkpointOwnerId,
      checkpointRequest: t.checkpointRequest,
      checkpointContinuation: t.checkpointContinuation,
      resumeDimension: t.resumeDimension,
    };
    this.abortTask(t, why);
    this.opts.diag?.write({
      lane: 'task', event: 'hold-step-boundary', taskId: t.id,
      msg: `任务#${t.id}「${labelOf(t)}」的第 ${i + 1} 步没开工:队列还冻着(${why}),等安全了再从这一步接着做`,
      data: { stepIndex: i, why },
    });
    return true;
  }

  /**
   * 战斗收工:解冻,挂起的任务放回队头从断点续做。返回给她的一句说明。
   *
   * `owner` 是解冻者组。断点归哪一组冻就只由哪一组解:别人的断点原样冻着,
   * 只把队列推一下。
   */
  resume(owner: QueueFreezeOwner = 'combat'): string | null {
    const f = this.frozen;
    if (f && f.frozenBy !== undefined && f.frozenBy !== owner) {
      this.pump();
      return null;
    }
    this.frozen = null;
    if (f) {
      const lastRequest = this.queue.reduce((last, queued, index) =>
        queued.checkpointRequest && queued.checkpointOwnerId === f.id ? index : last, -1);
      this.queue.splice(lastRequest + 1, 0, f);
    }
    this.pump();
    if (!f) return null;
    const at = f.resumeFrom ?? 0;
    const step = describeSkill(f.steps[Math.min(at, f.steps.length - 1)]);
    const carried = resumedCollect(f, at);
    return f.interrupted !== null && f.interrupted !== undefined
      ? `刚才任务#${f.id} 的第 ${f.interrupted + 1} 步做到一半被打断,那一步不重做(${f.steps[f.interrupted]?.skill === 'control' ? '重放会重复移动，需重新观察' : '重做会再扣一次料'}),后面的接着来`
      : `刚才做到一半的任务#${f.id} 接着做(第 ${at + 1} 步:${step}${carried ? `,${carried.note}` : ''})`;
  }

  /**
   * mc_stop：停止当前任务、撤销队列(挂起待续的也算)；全空返回 null。
   */
  clear(force = false): string | null {
    const t = this.task;
    const now = Date.now();
    this.earlyStops = this.earlyStops.filter((at) => now - at < 120_000);
    const stalledGoto = t?.steps[t.stepIndex]?.skill === 'goto'
      && t.goalProgressAt !== undefined
      && now - t.goalProgressAt >= STALLED_CANCEL_MS
      && now - t.stepStartedAt >= STALLED_CANCEL_MS;
    if (t && !force && !stalledGoto && now - t.startedAt < 30_000 && this.earlyStops.length >= 1) {
      return `这次 mc_stop 没执行：近两分钟已过早叫停 ${this.earlyStops.length} 次；任务#${t.id} 仍在做，等它跑满 30 秒或等完成/受阻回执再判断。原队列保留`;
    }
    const dropped = this.queue.splice(0);
    const continuation = this.takeDrainingContinuation();
    if (continuation) dropped.unshift(continuation);
    if (this.frozen) {
      dropped.unshift(this.frozen);
      this.frozen = null;
    }
    // 撤空队列时同时作废深坠与环境冻结令牌；旧持有者的恢复调用随之失效。
    const held = this.holdReason();
    this.releaseAllHolds();
    if (!t && dropped.length === 0) {
      if (held === null) return null;
      this.opts.diag?.write({
        lane: 'task', event: 'cleared',
        msg: `mc_stop 解除了队列冻结(${held})`,
        data: { dropped: [], releasedHold: held },
      });
      return `队列本来就空着;顺带解除了队列冻结(${held})`;
    }
    if (t) {
      const at = this.progressOf(t);
      if (now - t.startedAt < 30_000) this.earlyStops.push(now);
      this.noteRapidStop(t, now);
      this.recordStalledCancel(t, now);
      this.abortTask(t, 'mc_stop');
      this.reportCancelled(t, 'mc_stop 叫停', at);
    }
    // 被撤销的排队任务各自投递终态，供后续轮次读取。
    for (const d of dropped) {
      this.reportCancelled(d, 'mc_stop 撤单', Executor.frozenProgress(d));
    }
    this.opts.diag?.write({
      lane: 'task', event: 'cleared', taskId: t?.id,
      msg: `叫停${t ? `任务#${t.id}「${labelOf(t)}」` : ''}${dropped.length > 0 ? `,撤掉排着的 ${dropped.length} 件` : ''}`
        + (held !== null ? `,并解除队列冻结(${held})` : ''),
      data: { dropped: dropped.map((d) => ({ id: d.id, label: labelOf(d) })), releasedHold: held },
    });
    return [
      t ? `已叫停任务#${t.id}「${labelOf(t)}」` : null,
      dropped.length > 0 ? `撤掉了排在后面的 ${dropped.map((d) => `任务#${d.id}「${labelOf(d)}」`).join('、')}` : null,
      held !== null ? `队列冻结(${held})也解除了` : null,
    ].filter(Boolean).join(';');
  }

  /** Revoke only a caller-owned task, preserving unrelated work and rescue holds. */
  cancelTask(id: number, reason: string): boolean {
    const current = this.task?.id === id ? this.task : null;
    let pending: QueuedTask | null = null;
    if (this.frozen?.id === id) { pending = this.frozen; this.frozen = null; }
    if (this.checkpointDrain?.continuation?.id === id) pending = this.takeDrainingContinuation();
    const index = this.queue.findIndex((task) => task.id === id);
    if (index >= 0) pending = this.queue.splice(index, 1)[0];
    if (current) {
      const progress = this.progressOf(current);
      this.abortTask(current, reason);
      this.detachCheckpointOwner(id);
      this.reportCancelled(current, reason, progress);
    } else if (pending) this.reportCancelled(pending, reason, Executor.frozenProgress(pending));
    else return false;
    this.pump();
    return true;
  }

  /** 服务端明确拒绝当前动作时，终止这单并保留原话；后续排队任务照常排队。 */
  blockCurrentFromServer(reason: string): boolean {
    const task = this.task;
    if (!task) return false;
    const at = Date.now();
    const step = task.program?.name ?? describeSkill(task.steps[Math.min(task.stepIndex, task.steps.length - 1)]);
    const label = labelOf(task);
    const text = `[场上拒绝] 任务#${task.id}「${label}」第 ${task.stepIndex + 1}/${task.steps.length} 步「${step}」没做成:服务端提示 ${reason}；后续步骤未执行。`;
    this.abortTask(task, reason);
    this.detachCheckpointOwner(task.id);
    this.noteBlockedReason(reason, at, { task: `任务#${task.id}「${label}」`, step });
    this.notePriorOutcome(task, 'blocked', reason, at);
    const repeatFailure = this.noteRepeatOutcome(task, 'blocked', at);
    this.recordExactOutcome(task.steps, true, reason);
    const failedCall = task.steps[task.stepIndex];
    if (task.steps.length > 1 && failedCall?.skill === 'take' && failedCall.at) {
      this.recordExactOutcome([failedCall], true, reason);
    }
    if (task.steps[task.stepIndex]?.skill === 'goto') this.recordSpatialOutcome([task.steps[task.stepIndex]], true, reason);
    this.opts.diag?.write({ lane: 'task', event: 'blocked', taskId: task.id, msg: text,
      data: { reason, step }, incident: true });
    this.opts.report({ kind: 'blocked', text, taskId: task.id, ...(repeatFailure ? { repeatFailure } : {}) });
    this.pump();
    if (!this.task && this.queue.length === 0) this.opts.onDrain?.();
    return true;
  }

  /** 两槽合起来的一句冻结理由;都空着为 null。同时冻着就两条都说 */
  private holdReason(): string | null {
    const bits = [this.queueHolds.environment?.reason, this.queueHolds.fall?.reason].filter(Boolean);
    return bits.length > 0 ? bits.join('、') : null;
  }

  /** 两槽一起清空(mc_stop / 抢占 / 死亡 / 断线 / 停机):留哪一张都够把队列关死 */
  private releaseAllHolds(): void {
    const had = this.queueHolds.environment !== null || this.queueHolds.fall !== null;
    this.queueHolds.environment = null;
    this.queueHolds.fall = null;
    // 回边:反射那边的令牌已经作废,别让它拿着旧票挡住这一轮危机的重新冻结
    if (had) this.opts.onHoldsReleased?.();
  }

  /**
   * 一槽释放。**另一槽还握着就不解冻断点** —— 两件事的解冻条件不同(环境要危险
   * 解除,深坠要稳定落脚),先满足的那一条不替另一条作数。两槽都空了才 `resume`。
   */
  private releaseHold(slot: QueueHoldSlot, token: QueueHoldToken): QueueResumeResult {
    if (this.queueHolds[slot]?.token !== token) return { released: false, note: null };
    this.queueHolds[slot] = null;
    const other = this.holdReason();
    if (other !== null) {
      this.opts.diag?.write({
        lane: 'task', event: 'hold-partial-release',
        msg: `${slot === 'fall' ? '深坠' : '环境'}那一槽解了,另一槽还冻着(${other}),队列不开闸`,
        data: { slot, stillHeld: other, frozenId: this.frozen?.id ?? null },
      });
      return { released: true, note: null, stillHeld: other };
    }
    return { released: true, note: this.resume('queue') };
  }

  /** 终止当前危险任务并保留排队计划；恢复由安全状态事件显式触发。 */
  stopCurrent(reason: string): QueueHoldToken {
    const token: QueueHoldToken = { owner: Symbol('queue-hold') };
    this.queueHolds.fall = { token, reason };
    const task = this.task;
    if (!task) return token;
    const progress = this.progressOf(task);
    this.abortTask(task, reason);
    this.detachCheckpointOwner(task.id);
    this.reportCancelled(task, reason, progress);
    return token;
  }

  /** 环境危机冻结当前断点和整条队列；逃逸技能本身继续完成脱身。 */
  pauseForEnvironment(reason: string): QueueHoldToken {
    const token: QueueHoldToken = { owner: Symbol('environment-hold') };
    this.queueHolds.environment = { token, reason };
    const task = this.task;
    if (!task?.escape.active) this.suspend(`环境:${reason}`, 'queue');
    const selfRescue = task?.escape.active === true;
    const msg = task && selfRescue
      ? `环境危机接管(${reason}),任务#${task.id}正在自救,后续队列冻结到安全落脚`
      : task
        ? `环境危机接管(${reason}),任务#${task.id}与队列冻结到安全落脚`
      : `环境危机接管(${reason}),队列冻结到安全落脚`;
    this.opts.diag?.write({
      lane: 'task', event: 'environment-hold', taskId: task?.id ?? this.frozen?.id,
      msg,
      data: { reason, taskId: task?.id ?? null, frozenId: this.frozen?.id ?? null, selfRescue },
    });
    this.opts.report({ kind: 'reflex', text: `[反射] ${msg};冻结期间新排的任务只排队不开跑。` });
    return token;
  }

  /** 只接受当前环境租约；有效释放会把冻结断点放回队首(除非深坠那一槽还冻着)。 */
  resumeAfterEnvironment(token: QueueHoldToken): QueueResumeResult {
    const out = this.releaseHold('environment', token);
    if (!out.released) return out;
    this.opts.diag?.write({
      lane: 'task', event: 'environment-resume',
      msg: out.note ?? '环境安全租约已释放,队列可以继续',
      data: { resumedTask: out.note !== null, stillHeld: this.holdReason() },
    });
    return out;
  }

  /** 坠落危险解除后继续仍在队列中的计划(除非环境那一槽还冻着)。 */
  resumeQueue(token: QueueHoldToken): boolean {
    return this.releaseHold('fall', token).released;
  }

  /** 主动 attack 正持有身体；被动三格巡检与受击接管据此让位。 */
  get attacking(): boolean {
    const step = this.task?.steps[this.task.stepIndex];
    return this.task !== null && (this.activeAttack !== null || step?.skill === 'attack');
  }

  ownsRanged(ownerToken: unknown): boolean {
    return this.attacking && this.activeAttack?.dead === false &&
      this.activeAttack.disconnected === false && ownerToken === this.activeAttack.token;
  }

  acceptsRangedHit(targetId: number, at = Date.now()): boolean {
    const attack = this.activeAttack;
    return attack !== null && attack.targetId === targetId && this.ownsRanged(attack.token) && !(
      attack.lastSwingTargetId === targetId && at - attack.lastSwingAt <= 1_500
    );
  }

  onBowEvent(event: BowEvent): void {
    if (event.kind !== 'hit' || !this.ownsRanged(event.ownerToken)) return;
    const attack = this.activeAttack!;
    if (event.targetId === attack.targetId) attack.rangedHits += 1;
  }

  noteCombatTargetHurt(targetId: number): void {
    const attack = this.activeAttack;
    if (!attack || targetId !== attack.lastSwingTargetId) return;
    if (Date.now() - attack.lastSwingAt > 1_500) return;
    attack.meleeHits += 1;
    attack.lastSwingTargetId = -1;
  }

  noteCombatTargetDead(targetId: number): void {
    const attack = this.activeAttack;
    if (!attack || attack.targetId !== targetId) return;
    attack.dead = true;
    this.opts.ranged?.abort();
    dropGoal(this.opts.getBot(), 'task', '交战目标死了', this.opts.diag);
  }

  /** 连接消失会使旧 Bot 上的当前、冻结和排队工作全部失效。 */
  onConnectionLost(reason = 'Minecraft 连接断开'): void {
    this.executionEpoch += 1;
    this.findHistory.clear();
    const current = this.task;
    const frozen = this.frozen;
    const queued = this.queue.splice(0);
    const continuation = this.takeDrainingContinuation();
    if (continuation) queued.push(continuation);
    if (current) {
      current.flag.aborted = true;
      current.flag.by = reason;
    }
    if (this.activeAttack) this.activeAttack.disconnected = true;
    this.cancelActiveAttack();
    this.task = null;
    this.frozen = null;
    this.releaseAllHolds();
    dropGoal(this.opts.getBot(), 'link', '连接断开', this.opts.diag);

    const reported = new Set<number>();
    if (current) {
      reported.add(current.id);
      this.reportCancelled(current, reason, this.progressOf(current));
    }
    if (frozen && !reported.has(frozen.id)) {
      reported.add(frozen.id);
      this.reportCancelled(frozen, reason, Executor.frozenProgress(frozen));
    }
    for (const task of queued) {
      if (reported.has(task.id)) continue;
      reported.add(task.id);
      this.reportCancelled(task, reason, Executor.frozenProgress(task));
    }
    this.opts.diag?.write({
      lane: 'task', event: 'connection-cancelled', taskId: current?.id ?? frozen?.id ?? queued[0]?.id,
      msg: `${reason}，取消旧连接上的工作(${current ? 1 : 0} 当前、${frozen ? 1 : 0} 冻结、${queued.length} 排队)`,
      data: {
        epoch: this.executionEpoch,
        current: current?.id ?? null,
        frozen: frozen?.id ?? null,
        queued: queued.map((task) => task.id),
      },
    });
  }

  claimsCombat(targetId: number): boolean {
    return this.activeAttack?.targetId === targetId;
  }

  /** 受击仍归当前主动 attack；返回 true 让反射与被动会话不要再开第二套动作。 */
  onCombatHurt(attackerId: number, _name: string): boolean {
    const attack = this.activeAttack;
    if (!this.task || this.task.steps[this.task.stepIndex]?.skill !== 'attack') return false;
    if (!attack) {
      this.opts.diag?.write({
        lane: 'skill', event: 'attack-hurt', taskId: this.task.id,
        msg: `主动攻击起步时受击,归任务#${this.task.id}处理`,
        data: { attackerId, targetId: null, hurts: 1 },
      });
      return true;
    }
    attack.hurts += 1;
    attack.lastHurtAt = Date.now();
    this.opts.diag?.write({
      lane: 'skill', event: 'attack-hurt', taskId: this.task.id,
      msg: `主动攻击中受击,归任务#${this.task.id}处理`,
      data: { attackerId, targetId: attack.targetId, hurts: attack.hurts },
    });
    return true;
  }

  private acquireAttack(targetId: number): TaskAttackLease {
    this.cancelActiveAttack();
    const lease: TaskAttackLease = {
      token: {}, targetId,
      swings: 0, meleeHits: 0, arrows: 0, rangedHits: 0,
      hurts: 0, lastHurtAt: 0, lastSwingAt: 0, lastSwingTargetId: -1,
      dead: false, disconnected: false,
    };
    this.activeAttack = lease;
    return lease;
  }

  private releaseAttack(lease: TaskAttackLease): void {
    if (this.activeAttack !== lease) return;
    this.opts.ranged?.abort();
    this.activeAttack = null;
  }

  private cancelActiveAttack(): void {
    if (!this.activeAttack) return;
    this.opts.ranged?.abort();
    this.activeAttack = null;
  }

  /** 死亡是执行边界：旧身体上的当前、冻结和排队工作全部失效。 */
  cancelForDeath(): void {
    this.executionEpoch += 1;
    this.findHistory.clear();
    this.cancelActiveAttack();
    const current = this.task;
    const frozen = this.frozen;
    const queued = this.queue.splice(0);
    const continuation = this.takeDrainingContinuation();
    if (continuation) queued.push(continuation);
    if (current) {
      current.flag.aborted = true;
      current.flag.by = '死亡';
    }
    this.task = null;
    this.frozen = null;
    // 深坠/环境冻结的令牌随死亡作废;它单独出一句,泛化的 death-cancelled 对不上账
    // (「任务受理了却永不开跑」与「死亡撤单」在案卷里长得一模一样)
    const held = this.holdReason();
    this.releaseAllHolds();
    releaseBody(this.opts.getBot(), '死亡', this.opts.diag, 'link');
    const holdText = held ? `;当时队列还冻结着(${held}),那份排队计划因死亡作废` : '';
    this.opts.diag?.write({
      lane: 'task', event: 'death-cancelled', taskId: current?.id ?? frozen?.id ?? queued[0]?.id,
      msg: `死亡取消了当前与待执行工作(${current ? 1 : 0} 当前、${frozen ? 1 : 0} 冻结、${queued.length} 排队)`
        + holdText,
      data: {
        epoch: this.executionEpoch,
        current: current?.id ?? null,
        frozen: frozen?.id ?? null,
        queued: queued.map((task) => task.id),
        releasedHold: held,
      },
    });
    if (held !== null) {
      this.opts.report({
        kind: 'superseded',
        text: `死的时候队列还冻着(${held}),排在里面的计划因死亡作废,想接着做要重新排。`,
        taskId: current?.id ?? frozen?.id ?? queued[0]?.id,
      });
    }
  }

  /**
   * 维度变了而手上那一步不是 transit:当前、冻结和排队的计划都按旧维度坐标写的,
   * 当刻撤单并撤掉寻路目标(包括逃生目标),每一件各自投递取消终态。
   * 返回给 bot 的说明;没有可撤的东西时为 null。
   */
  cancelForDimensionChange(from: string, to: string): string | null {
    const t = this.task;
    if (t?.steps[t.stepIndex]?.skill === 'transit') return null;
    const bot = this.opts.getBot();
    const goal = bot?.pathfinder?.goal ?? null;
    // 寻路目标的坐标同样属于旧维度,不管是谁下的都作废
    if (goal) dropGoal(bot, 'task', `维度从${zhDimension(from)}变成${zhDimension(to)}`, this.opts.diag);
    const dropped = this.queue.splice(0);
    if (this.frozen) {
      dropped.unshift(this.frozen);
      this.frozen = null;
    }
    if (!t && dropped.length === 0) return goal ? '旧维度的寻路目标已撤' : null;
    const by = `维度变化中止(没经 transit 从${zhDimension(from)}进入了${zhDimension(to)},`
      + `计划里的坐标是按${zhDimension(from)}写的)`;
    if (t) {
      const at = this.progressOf(t);
      this.abortTask(t, by);
      this.reportCancelled(t, by, at);
    }
    for (const d of dropped) this.reportCancelled(d, by, Executor.frozenProgress(d));
    this.opts.diag?.write({
      lane: 'task', event: 'dimension-cancelled', taskId: t?.id ?? dropped[0]?.id,
      msg: `维度从${zhDimension(from)}变成${zhDimension(to)},撤了${t ? `任务#${t.id}` : ''}`
        + `${dropped.length > 0 ? `${t ? '和' : ''}排着的 ${dropped.length} 件` : ''},寻路目标已撤`,
      data: { from, to, current: t?.id ?? null, dropped: dropped.map((d) => d.id), hadGoal: goal !== null },
    });
    return [
      t ? `任务#${t.id}「${labelOf(t)}」已中止` : null,
      dropped.length > 0 ? `排着的 ${dropped.map((d) => `任务#${d.id}`).join('、')} 也撤了` : null,
      '寻路目标已撤,想在这边做事要按这边的坐标重新排',
    ].filter(Boolean).join(';');
  }

  /** 当前任务占用逃逸路径时为 true;反射层据此避免重复抢占。 */
  get escaping(): boolean {
    const t = this.task;
    if (!t) return false;
    // eat 属于回血自救，低血反射不得抢占。
    return t.escape.active || t.steps[t.stepIndex]?.skill === 'eat';
  }

  /** 进食占用主手直到消费回执或失败，战斗不能中途换武器。 */
  get eating(): boolean {
    return this.task?.steps[this.task.stepIndex]?.skill === 'eat';
  }

  /**
   * 自保反射接管寻路前终止当前任务及其排队任务;已处于逃逸状态的任务不被抢占。
   * 本方法不清除寻路目标,由紧随其后的反射 setGoal 替换旧目标。
   */
  preempt(reason: string): void {
    if (this.stopped) return;
    const t = this.task;
    if (t?.escape.active) return;
    const continuation = this.takeDrainingContinuation();
    // 抢占撤空队列时作废两种冻结令牌；旧令牌的恢复调用无效。
    const held = this.holdReason();
    this.releaseAllHolds();
    // 战斗窗口里没有"当前任务",但挂起待续的与排着的照样要撤:
    // 环境自保夺权(岩浆/溺水)之后,按原地写的计划已经不知道自己在哪了
    if (!t && !this.frozen && !continuation && this.queue.length === 0) {
      if (held !== null) {
        this.opts.diag?.write({
          lane: 'task', event: 'preempted',
          msg: `自保反射接管(${reason}),队列空着,顺带解除了队列冻结(${held})`,
          data: { reason, dropped: 0, releasedHold: held },
        });
      }
      return;
    }
    // 寻路目标由紧随其后的反射 setGoal 替换,这里不撤(见方法头注)
    if (t) {
      t.flag.aborted = true;
      t.flag.by = `自保反射:${reason}`;
      this.cancelActiveAttack();
      this.task = null;
    }
    const dropped = this.queue.splice(0);
    if (continuation) dropped.unshift(continuation);
    if (this.frozen) {
      dropped.unshift(this.frozen);
      this.frozen = null;
    }
    // 抢占绕过 finish()，须在此投递各步骤终态。
    const landings = t ? Executor.landingsAtCut(t, this.progressOf(t)) : [];
    const text = (t
      ? `任务#${t.id}「${labelOf(t)}」被自保反射抢占(${reason}),已中断。`
      : `自保反射接管了(${reason})。`) +
      (dropped.length > 0 ? `排在后面的 ${dropped.length} 件也撤了,想接着做要重新排。` : '') +
      (t ? renderStepLandings(landings, t.steps.length) : '') +
      this.furnaceNote();
    this.opts.diag?.write({
      lane: 'task', event: 'preempted', taskId: t?.id ?? dropped[0]?.id, msg: text,
      data: { reason, dropped: dropped.length, releasedHold: held, landings },
    });
    this.opts.report({ kind: 'superseded', text, taskId: t?.id ?? dropped[0]?.id });
  }

  /** 抢占回执附带账上仍有原料或成品的炉子，并标明是上次看见的数量。 */
  private furnaceNote(): string {
    const bot = this.opts.getBot();
    if (!bot?.game) return '';
    const cooking = this.opts.chests?.loadedFurnaces(String(bot.game.dimension ?? 'overworld')) ?? [];
    if (cooking.length === 0) return '';
    const one = (r: (typeof cooking)[number]): string => {
      const f = r.furnace!;
      const bits = [
        f.input ? `${zhName(f.input.name)}×${f.input.count} 没烧完` : null,
        f.output ? `输出槽有${zhName(f.output.name)}×${f.output.count}` : null,
      ].filter(Boolean);
      return `(${r.x}, ${r.y}, ${r.z}) 的${zhName(r.name ?? 'furnace')}里账上还有:${bits.join('、')}`;
    };
    return `另外,${cooking.map(one).join(';')}。`;
  }

  /**
   * 主动撤销任务时投递 cancelled 终态及各步骤结果，不改变队列或启动 pump。
   * 此同步路径绕过 finish() 的迟到回调保护，由清空、顶替和停机入口调用。
   * progress 为 null 表示任务尚未开始；结果按批投递，不单独唤醒模型。
   */
  private reportCancelled(
    task: QueuedTask,
    by: string,
    progress: { step: number; count: { done: number; total: number } | null } | null,
  ): void {
    task.program?.cancel(by);
    const head = task.steps.length > 1 ? `任务#${task.id}「${labelOf(task)}」` : `任务#${task.id}`;
    const where = task.program ? '原生程序已撤销，不自动重放' : progress
      ? `做到第 ${progress.step}/${task.steps.length} 步` +
        `${progress.count ? `(进度 ${progress.count.done}/${progress.count.total})` : ''}`
      : '一步都没开始';
    const landings = Executor.landingsAtCut(task, progress);
    const ledger = renderStepLandings(landings, task.steps.length);
    const text = `${head}没做完:${where},被${by}。${ledger}`;
    this.opts.diag?.write({
      lane: 'task', event: 'cancelled', taskId: task.id, msg: text,
      data: { by, landings },
    });
    this.opts.report({ kind: 'cancelled', text, taskId: task.id,
      steps: landings.map(({ step, outcome, why }) => ({ step, outcome, why })) });
  }

  /**
   * 断点被撤时的进度读数(reportCancelled 用)。`suspend()` 冻的断点带着正在跑的那一步
   * 与它的计数进度;步边界冻的没有步在跑,只报已落地的步数。
   */
  private static frozenProgress(
    f: QueuedTask,
  ): { step: number; count: { done: number; total: number } | null } | null {
    if (f.progress) return f.progress;
    const landed = f.resumeFrom ?? 0;
    return landed > 0 ? { step: landed, count: null } : null;
  }

  /**
   * 被切断那一刻的各步终态。已落地的照抄,**正在跑的那一步**补一条「做到一半被撤」
   * —— 它确实开跑过,说成"跳过"或干脆不提都不是事实。
   *
   * 只有"紧接着已落地那几步的下一步"才算正在跑的那一步(`step === 已落地数 + 1`)。
   * 非幂等步被战斗挂起时 `resumeFrom` 会跨过它,`progress.step` 因此指向一个**还没
   * 开跑**的步 —— 那一格不许编,被打断的那一步由 `interrupted` 自己认领。
   */
  private static landingsAtCut(
    task: QueuedTask,
    progress: { step: number; count: { done: number; total: number } | null } | null,
  ): Array<StepLanding | CutLanding> {
    const log: Array<StepLanding | CutLanding> = [...(task.stepLog ?? [])];
    const cut = (step: number, why: string | null): void => {
      const call = task.steps[step - 1];
      if (!call || log.some((l) => l.step === step)) return;
      log.push({ step, what: describeSkill(call), outcome: 'cut', why });
    };
    if (typeof task.interrupted === 'number') {
      cut(task.interrupted + 1, task.steps[task.interrupted]?.skill === 'control'
        ? '按键做到一半被打断，重放会重复移动，需重新观察' : '做到一半被打断,重做会重复扣料');
    }
    if (progress && progress.step === log.length + 1) {
      cut(progress.step, progress.count ? `进度 ${progress.count.done}/${progress.count.total}` : null);
    }
    return log;
  }

  /** 正在跑的那一单当下的进度读数(reportCancelled 用) */
  private progressOf(t: RunningTask): { step: number; count: { done: number; total: number } | null } {
    return { step: t.stepIndex + 1, count: t.count };
  }

  /** 手上这件被谁打飞的记在 flag 上:skill/aborted 那条日志的 `by` 只有这一个来源 */
  private abortTask(t: RunningTask, by: string): void {
    t.flag.aborted = true;
    t.flag.by = by;
    this.cancelActiveAttack();
    if (this.checkpointDrain?.task === t) this.checkpointDrain.continuation = null;
    this.task = null;
    releaseBody(this.opts.getBot(), `中止任务#${t.id}(${by})`, this.opts.diag);
    t.program?.cancel(by);
  }

  /** 停止后丢弃所有任务;迟到回调不得修改状态或发送报告。 */
  shutdown(): void {
    // 停机先同步报告现存任务的取消终态，再置 stopped；finish 据此忽略迟到回调。
    if (this.task) this.reportCancelled(this.task, 'World 停止', this.progressOf(this.task));
    const continuation = this.takeDrainingContinuation();
    for (const d of [...(this.frozen ? [this.frozen] : []), ...(continuation ? [continuation] : []), ...this.queue]) {
      this.reportCancelled(d, 'World 停止', Executor.frozenProgress(d));
    }
    this.stopped = true;
    this.findHistory.clear();
    this.cancelActiveAttack();
    if (this.task) {
      this.task.flag.aborted = true;
      this.task.flag.by = 'World 停止';
    }
    this.task = null;
    this.queue = [];
    this.frozen = null;
    this.releaseAllHolds();
    // 停止 World 时同时交还身体(目标、控制键、挖掘、右键)。
    releaseBody(this.opts.getBot(), 'World 停止', this.opts.diag, 'link');
  }

  private async run(task: RunningTask, flag: AbortFlag): Promise<void> {
    const { id } = task;
    // 单步任务的标签就是它的回执:"任务#1「用剪刀右键羊」完成: 剪刀右键了羊"
    // 把同一件事说了两遍。多步任务才需要标签列出全程,好让"受阻于第几件"有参照。
    const label = (): string => `${task.steps.length > 1 ? `任务#${id}「${labelOf(task)}」` : `任务#${id}`}`;
    /**
     * 结局回执的时刻段:受理 → 结束、总耗时(含排队等待),排过队才多报排的那一段。
     * 她没有别的时钟——一张床被空手右键 45 次横跨 6 小时,回执一字不差;
     * done 到下一次 mc_do 的 p90 是 46 秒也只有这里看得出来。
     */
    const span = (): string => {
      const end = Date.now();
      const queued = task.startedAt - task.enqueuedAt;
      return `[${this.clock(task.enqueuedAt)}→${this.clock(end)} 共 ${fmtDur(end - task.enqueuedAt)}` +
        `${queued >= 1000 ? `,排队 ${fmtDur(queued)}` : ''}] `;
    };
    /**
     * 一步的回执行开头:步号 + 回念解析后的那一步 + 这一步用了多久。
     *
     * 步号与单步耗时都只在多步任务里出现:单步任务的整条 span 已经把总耗时说了,
     * 再报一遍这一步的用时就是同一个数说两遍(README「一件事只说一遍」)。
     */
    const stepLabel = (i: number): string =>
      `${task.steps.length > 1 ? `第 ${i + 1} 步 ` : ''}${JSON.stringify(receiptStep(task.steps[i]))}`;
    const trialOrigins = new Map<number, string>();
    const stepHead = (i: number, stepStart: number): string =>
      (task.steps.length > 1
        ? `${stepLabel(i)} 用时 ${fmtDur(Date.now() - stepStart)}`
        : stepLabel(i))
      + (trialOrigins.has(i) ? ` [只读试算，未执行；真实起点 ${trialOrigins.get(i)}；不继承前步假定位置或材料]` : '');
    /** 多步分行列,单步就跟在冒号后面 */
    const listOf = (entries: string[]): string =>
      entries.length > 1 ? `\n${entries.join('\n')}` : ` ${entries.join('')}`;
    if (flag.aborted || this.stopped || flag.epoch !== this.executionEpoch) return;
    const bot = this.opts.getBot();
    if (!bot) {
      task.program?.cancel('Minecraft 连接已结束，原生程序未执行');
      this.finish(flag, { kind: 'blocked', text: `${span()}${label()}执行不了:当前没连上服务器。`, taskId: id });
      return;
    }
    let windowStep = 0;
    const windowInstances = new WeakMap<object, number>();
    let windowSequence = 0;
    const windowInstance = (window: NonNullable<Bot['currentWindow']> | null): number | null => {
      if (!window) return null;
      let instance = windowInstances.get(window);
      if (instance === undefined) windowInstances.set(window, instance = ++windowSequence);
      return instance;
    };
    const windows = new ContainerWindowOwnership(bot, {
      valid: () => !flag.aborted && !this.stopped && flag.epoch === this.executionEpoch && this.opts.getBot() === bot,
      scope: () => normalizeDimension(dimensionOf(bot)),
      onEvent: ({ kind, window, source, heldWindow, candidateWindow, changedFields }) => {
        const event = `hold-window-${kind}`;
        this.opts.diag?.write({ lane: 'skill', event, taskId: id,
          msg: kind === 'bound' ? '任务已认领本次打开的容器窗口'
            : kind === 'candidate' ? '开窗步骤尚在验收，记录当前候选容器窗口'
              : kind === 'close-deferred' ? '候选窗口未收到本次完整内容，暂不关窗，避免旧玩家槽回写背包'
                : '容器窗口与本次开窗或已认领的窗口不一致',
          data: { step: windowStep, source, windowId: window.id, windowInstance: windowInstance(window),
            heldWindowId: heldWindow?.id ?? null, heldWindowInstance: windowInstance(heldWindow),
            candidateWindowId: candidateWindow?.id ?? null, candidateWindowInstance: windowInstance(candidateWindow),
            ...(changedFields ? { changedFields } : {}) } });
      },
    });
    const closeHeldWindow = (): void => windows.close();
    const onWindowClose = (window: NonNullable<Bot['currentWindow']> | null): void => windows.onWindowClose(window);
    if (typeof bot.on === 'function') bot.on('windowClose', onWindowClose);
    const ctx: SkillContext = {
      aborted: () => flag.aborted || this.stopped || flag.epoch !== this.executionEpoch,
      checkpoint: async (settle) => {
        if (windows.heldWindow || windows.hasUnconfirmedOpening()) return;
        await this.checkpointTask(task, bot, task.stepIndex, false, settle);
      },
      abortedBy: () => flag.by ?? (this.stopped ? 'World 停止' : null),
      log: this.opts.log,
      fleeHealth: this.opts.fleeHealth ?? (() => 0),
      escape: task.escape,
      attack: {
        acquire: (targetId) => this.acquireAttack(targetId),
        release: (lease) => this.releaseAttack(lease),
        ranged: this.opts.ranged,
      },
      diag: this.opts.diag,
      taskId: id,
      clock: (ms) => this.clock(ms),
      policy: this.opts.policy,
      permitResourcePlacement: this.opts.permitResourcePlacement,
      previewResourcePlacement: this.opts.previewResourcePlacement,
      reserveHits: [],
      probeRoutes: this.opts.probeRoutes,
      probeTarget: this.opts.probeTarget,
      digBackoffSince: this.opts.digBackoffSince,
      bodyState: () => ({
        combatActive: this.opts.bodyState?.().combatActive ?? false,
        environmentOwnerKind: this.opts.bodyState?.().environmentOwnerKind ?? null,
        queueHold: this.holdReason(),
        frozenTaskId: this.frozen?.id ?? null,
      }),
      chests: this.opts.chests,
      works: this.opts.works,
      probeMemo: this.probeMemo,
      explored: this.opts.explored,
      search: {
        history: this.findHistory,
        scope: () => {
          const external = this.opts.searchContext?.();
          return {
            connectionGeneration: external?.connectionGeneration ?? this.executionEpoch,
            realm: external?.realm ?? 'current',
            dimension: normalizeDimension(dimensionOf(bot)),
          };
        },
      },
      showTempo: this.opts.showTempo,
      holdWindow: (window) => windows.retain(window, 'skill'),
      spawnNote: this.opts.spawnNote,
      serverFeedbackSince: this.opts.serverFeedbackSince,
      spawnAnchor: this.opts.spawnAnchor,
      blueprints: this.opts.blueprints,
      marks: this.opts.marks,
    };
    if (task.program) {
      let error: unknown;
      try { await task.program.run(bot, ctx); checkAbort(ctx); }
      catch (caught) { error = caught; }
      finally {
        bot.off('windowClose', onWindowClose);
        if (!ctx.aborted() && this.task === task) {
          closeHeldWindow();
          releaseBody(bot, `原生程序#${id}结束`, this.opts.diag);
        }
      }
      if (!ctx.aborted()) this.finish(flag, { taskId: id, kind: error ? 'blocked' : 'done',
        text: `${span()}原生程序「${task.program.name}」${error ? `受阻：${String(error)}` : '结束；具体效果以原生调用读数和程序返回值核验'}` });
      return;
    }
    const results: string[] = [];
    /** 同一根因导致的连续跳步合并为一条回执，保留最早失败步骤的编号。 */
    interface SkipRun { from: number; to: number; root: number; rootOutcome: string; whys: string[]; calls: SkillCall[] }
    /** 没做成的与被跳过的步:一份回执里一起报;跳过的按连续段记(见 SkipRun) */
    const blockedSteps: Array<string | SkipRun> = [];
    /** 被跳过的步序(1 起)→ 拖垮它的根因步序:跳过链要追到真正没做成的那一步 */
    const skipRoot = new Map<number, number>();
    const renderBlocked = (e: string | SkipRun): string => {
      if (typeof e === 'string') return e;
      if (e.from === e.to) return `${stepLabel(e.from)} 跳过(${e.whys[0]})`;
      const n = e.to - e.from + 1;
      const rootWhy = e.rootOutcome === 'noop' ? '没什么可做的' : '没做成';
      return `第 ${e.from + 1}~${e.to + 1} 步 没跑(第 ${e.root} 步${rootWhy},这 ${n} 步一环扣一环都要用它的产出):`
        + e.calls.map((c) => JSON.stringify(receiptStep(c))).join(';');
    };
    /**
     * 无事可做的步:陈述句单独成段,不进「没做成」那一堆。
     * 它不影响任务终态——一单里只有这类,任务照样是「完成」。
     */
    const noopSteps: string[] = [];
    /** 做了一部分的步:缺口点名,任务终态降成「做了一部分」 */
    const partialSteps: string[] = [];
    /** 这一单头一次卡住的理由;进「同一件事上次什么下场」的账(见 priorOutcomes) */
    let firstWhy: string | null = null;
    /** 这一单各步受阻理由的归并键;头条按它比对(见 blockedHeadline) */
    const myBlockedKeys = new Set<string>();
    /** 这一单有没有卡在「东西」上:有就在终态回执末尾贴一份当刻全量背包(见 bagNow) */
    let bagDue = false;
    const scenes: string[] = [];
    const steps = task.steps;
    let expectedDimension = task.resumeDimension ?? normalizeDimension(dimensionOf(bot));
    let transitBoundary: number | null = null;
    /** 各步在验收后的结局。显式依赖要求 ok/partial；自动因果边还可凭现有入料放行。 */
    const outcomes: StepOutcome[] = [];
    /**
     * 一步落地:记进 outcomes(闸门读它),同时记一笔终态账(见 StepLanding)。
     * 两处必须同一刻写,否则被叫停时那本账与实际跑到哪一步对不上号。
     * `line` 是这一步进结局回执的那一行,断点续做时原样摆回去。
     */
    const land = (i: number, outcome: StepOutcome, why: string | null, line: string, code?: SkillBlocked['code']): void => {
      outcomes.push(outcome);
      task.stepLog.push({
        step: i + 1, what: describeSkill(steps[i]), outcome, why: shortWhy(why), line,
        ...(code ? { code } : {}),
      });
      if (outcome === 'ok') this.noteSuccessfulIntent(steps[i], Date.now());
    };
    /**
     * 本任务有意放置的落点，跨步骤保留。
     * 回收脚手架按坐标豁免这些格子，包括后续步骤在同格重新登记的放置记录。
     */
    const intended = task.intended ??= new Set<string>();
    try {
      for (let i = 0; i < steps.length; i++) {
        const call = steps[i];
        if ('dryRun' in call && call.dryRun) trialOrigins.set(i, cellText(bot.entity.position));
        if (ctx.aborted()) return;
        // 环境冻结在步骤边界生效：当前自救步骤可完成，后续步骤等待 resumeAfterEnvironment。
        const heldBefore = this.holdReason();
        if (heldBefore !== null && this.freezeBeforeStep(task, i, `环境冻结:${heldBefore}`)) return;
        if (transitBoundary !== null) {
          const why = `第 ${transitBoundary} 步没有完成可信的维度穿越，后续步骤不能在错误维度继续`;
          const line = `${stepLabel(i)} 跳过(${why})`;
          land(i, 'skip', why, line);
          blockedSteps.push(line);
          this.opts.diag?.write({
            lane: 'skill', event: 'dimension-tail-blocked', taskId: id,
            msg: `第 ${i + 1} 步「${describeSkill(call)}」跳过:${why}`,
            data: {
              call, transitStep: transitBoundary, expectedDimension,
              actualDimension: normalizeDimension(dimensionOf(bot)),
            },
          });
          continue;
        }
        const preceding = steps[i - 1];
        if (consumesOpenWindow(call) && !storageWindow(bot.currentWindow)
          && i > 0 && (outcomes[i - 1] === 'fail' || outcomes[i - 1] === 'skip')
          && (consumesOpenWindow(preceding) || preceding.skill === 'use'
            || (preceding.skill === 'chat' && preceding.text.startsWith('/')))) {
          const why = `第 ${i} 步没有留下可存取的容器窗口`;
          const line = `${stepLabel(i)} 跳过(${why})`;
          land(i, 'skip', why, line);
          blockedSteps.push(line);
          continue;
        }
        const beforeDimension = normalizeDimension(dimensionOf(bot));
        if (beforeDimension !== expectedDimension) {
          transitBoundary = i + 1;
          const why = `维度在没有成功 transit 的情况下从${zhDimension(expectedDimension)}变成了${zhDimension(beforeDimension)}`;
          const line = `${stepLabel(i)} 没执行(${why}；为防止把另一维坐标当当前维度坐标，整条尾巴已停)`;
          land(i, 'fail', why, line);
          firstWhy ??= why;
          blockedSteps.push(line);
          this.opts.diag?.write({
            lane: 'skill', event: 'dimension-unexpected', taskId: id,
            msg: `第 ${i + 1} 步前检测到${why}`,
            data: { call, expectedDimension, actualDimension: beforeDimension },
          });
          continue;
        }
        // 战斗挂起后的续做:被打断的非幂等步不重跑(重跑会重复扣料),按没做成算;
        // 更早的步战前已做完,按做成计入闸门,结局回执不重述
        if (i === task.interrupted) {
          const why = call.skill === 'control' ? '按键做到一半被打断，没重放（会重复移动），需重新观察'
            : '做到一半被打断,没重做(重做会重复扣料)';
          const line = call.skill === 'control' ? `${stepLabel(i)} ${why}`
            : `${stepLabel(i)} 做到一半被打断,没重做(这一步重做会重复扣料),按没做成算`;
          land(i, 'fail', why, line);
          blockedSteps.push(line);
          if (call.skill === 'transit') transitBoundary = i + 1;
          continue;
        }
        if (i < (task.resumeFrom ?? 0)) {
          // 断点之前的步:终态照账本进闸门,回执行照账本进结局回执。这一单只有 finish()
          // 一个出口,断点之前那几步的下场没在别处报过;闸门读到「做成」会放行注定落空的
          // 下游。账本按步序记,每一步落地恰一次,第 i 步就是 stepLog[i]。
          const landed = task.stepLog[i];
          outcomes.push(landed.outcome);
          switch (landed.outcome) {
            case 'ok': results.push(landed.line); break;
            case 'partial': partialSteps.push(landed.line); break;
            case 'noop': noopSteps.push(landed.line); firstWhy ??= landed.why; break;
            case 'skip': blockedSteps.push(landed.line); break;
            case 'fail':
              blockedSteps.push(landed.line);
              firstWhy ??= landed.why;
              if (landed.why) {
                myBlockedKeys.add(Executor.blockedKey(landed.why));
                bagDue ||= blockedOnItems(landed.why);
              }
              break;
          }
          continue;
        }
        if (!consumesOpenWindow(call) && !windows.heldWindow && !windows.hasUnconfirmedOpening()) {
          await this.checkpointTask(task, bot, i, true);
        }
        // 更早一步顺手做掉的容器步骤:须抢在 needs 闸与出队试算之前落账。
        const absorbed = task.absorbed?.get(i);
        if (absorbed !== undefined) {
          const line = `${stepLabel(i)}: ${absorbed.receipt}`;
          land(i, absorbed.ok ? 'ok' : 'fail', absorbed.ok ? null : absorbed.receipt, line);
          if (absorbed.ok) results.push(line);
          else {
            blockedSteps.push(line);
            firstWhy ??= absorbed.receipt;
            myBlockedKeys.add(Executor.blockedKey(absorbed.receipt));
            bagDue ||= blockedOnItems(absorbed.receipt);
          }
          this.opts.diag?.write({
            lane: 'skill', event: absorbed.ok ? 'done' : 'blocked', taskId: id, durMs: 0,
            msg: `${describeSkill(call)}: ${absorbed.receipt}`,
            data: { call, result: absorbed.receipt, absorbed: true },
          });
          continue;
        }
        if (call.skill === 'stow' && call.at !== undefined) {
          try {
            const target = resolveAt(bot, call.at);
            const skipped = storageSkipReason(bot, target, call.item);
            if (skipped) {
              const why = `指定容器${skipped}，本步不再重走同一条路线`;
              const line = `${stepLabel(i)} 跳过(${why})`;
              land(i, 'skip', why, line);
              blockedSteps.push(line);
              this.opts.diag?.write({ lane: 'skill', event: 'skip', taskId: id,
                msg: `第 ${i + 1} 步「${describeSkill(call)}」跳过:${why}`,
                data: { call, target, reason: skipped } });
              continue;
            }
          } catch { /* 坐标在技能执行时仍会校验 */ }
        }
        // 显式 needs 优先。默认除物品因果外，紧跟移动的定点容器/交互步骤
        // 也依赖到场；若移动虽失败但人已在操作范围内，则仍可照做。
        const causal = call.needs === undefined ? causalNeeds(steps, i, bot) : null;
        const previous = i > 0 ? steps[i - 1] : null;
        let spatialNeed: number | null = null;
        if (call.needs === undefined && previous
          && (previous.skill === 'goto' || previous.skill === 'server_travel')
          && (call.skill === 'take' || call.skill === 'stow' || call.skill === 'use')
          && call.at !== undefined) {
          try {
            const target = resolveAt(bot, call.at);
            const pos = bot.entity.position;
            const reach = call.skill === 'use' ? 5 : 32;
            if (Math.hypot(pos.x - target.x, pos.y - target.y, pos.z - target.z) > reach) spatialNeed = i;
          } catch { spatialNeed = i; }
        }
        const needs = call.needs ?? [...new Set([...causal!.map((c) => c.step), ...(spatialNeed ? [spatialNeed] : [])])];
        // 因果边的入料包里本来就有时不拦:闸拦的是「注定落空」,料在手上这一步就不是
        const inBag = (items: string[]): boolean => items.every((n) =>
          playerInvIn(bot, bot.currentWindow).items().some((it) => it.count > 0
            && (matchItemName(n, it.name, bot?.registry) || matchItemName(it.name, n, bot?.registry))));
        const upstreamFailed = (n: number): boolean => outcomes[n - 1] !== 'ok' && outcomes[n - 1] !== 'partial';
        const unmet = needs.find((n) =>
          upstreamFailed(n) && !causal?.some((c) => c.step === n && inBag(c.items)));
        /** 上游没成但入料在包里、因而照跑的那条边 */
        const stocked = unmet === undefined
          ? causal?.find((c) => upstreamFailed(c.step) && inBag(c.items)) ?? null
          : null;
        if (unmet !== undefined) {
          // 跳过链追到根:上游自己也是被跳过的,拖垮它的是更早那一步
          const root = skipRoot.get(unmet) ?? unmet;
          // 上游是「无事可做」而不是「没做成」时照实说:两者都拦下游,但说成没做成
          // 会让她以为那一步走错了,转头去修一件根本没坏的事
          const upstream = outcomes[root - 1] === 'noop' ? '那一步没什么可做的'
            : outcomes[root - 1] === 'skip' ? '那一步没跑' : '那一步没做成';
          const chained = root === unmet ? upstream : `那一步没跑(卡在第 ${root} 步)`;
          const why = spatialNeed === unmet
            ? `依赖的第 ${unmet} 步没到场,当前仍够不着目标`
            : causal
            ? `要用第 ${unmet} 步的${(causal.find((c) => c.step === unmet)?.items ?? []).map(zhName).join('、')},${chained}`
            : `依赖的第 ${unmet} 步${outcomes[unmet - 1] === 'noop' ? '没什么可做的' : outcomes[unmet - 1] === 'skip' ? '没跑' : '没做成'}`;
          skipRoot.set(i + 1, root);
          land(i, 'skip', why, `${stepLabel(i)} 跳过(${why})`);
          // 跳过的那一步压根没跑,没有"用时"可报;紧接着上一段、同一根因的并进那一段
          const last = blockedSteps[blockedSteps.length - 1];
          if (typeof last === 'object' && last.to === i - 1 && last.root === root) {
            last.to = i;
            last.whys.push(why);
            last.calls.push(call);
          } else {
            blockedSteps.push({ from: i, to: i, root, rootOutcome: outcomes[root - 1], whys: [why], calls: [call] });
          }
          this.opts.diag?.write({
            lane: 'skill', event: 'skip', taskId: id,
            msg: `第 ${i + 1} 步「${describeSkill(call)}」跳过:${why}`,
            data: { call, needs, failed: unmet, root, causal: causal?.find((c) => c.step === unmet)?.items ?? null },
          });
          if (call.skill === 'transit') transitBoundary = i + 1;
          continue;
        }
        if (consumesOpenWindow(call) && (windows.hasUnconfirmedOpening()
          || windows.isCurrentUnconfirmed()
          || (windows.heldWindow && !windows.isHeldCurrent()))) {
          const why = '本任务使用的容器窗口已关闭或被替换，不能把后续操作改投另一窗口';
          const line = `${stepLabel(i)} 没执行(${why})`;
          land(i, 'fail', why, line);
          firstWhy ??= why;
          blockedSteps.push(line);
          this.opts.diag?.write({ lane: 'skill', event: 'blocked', taskId: id, msg: why,
            data: { call, reason: 'container-window-changed' } });
          continue;
        }
        // 兜底说明:缺省闸门下前一步没做成、但这一步不消费它的产出(或要用的料包里本来
        // 就有)——照跑,并说明为什么(不说这一句,她会以为闸门坏了或这一步不该跑)
        const ranFree = stocked !== null
          ? `(第 ${stocked.step} 步没做成;要用的${stocked.items.map(zhName).join('、')}包里本来就有,照做了)`
          : causal !== null && i > 0 && outcomes[i - 1] !== 'ok' && outcomes[i - 1] !== 'partial'
            ? `(第 ${i} 步没做成;这一步不用它的产出,照做了)`
            : '';
        // 受理后排队的旧任务也在真正执行前重读额度；只跳过当前步骤，后续独立步骤继续。
        const repeatedSuccess = this.opts.repeatSuccessFallback
          ? this.repeatSuccessHold([call], this.opts.repeatSuccessFallback()) : null;
        if (repeatedSuccess) {
          const line = `${stepLabel(i)} 没执行(${repeatedSuccess})`;
          land(i, 'fail', repeatedSuccess, line);
          firstWhy ??= repeatedSuccess;
          blockedSteps.push(line);
          this.opts.diag?.write({ lane: 'skill', event: 'blocked', taskId: id,
            msg: `第 ${i + 1} 步「${describeSkill(call)}」暂缓:${repeatedSuccess}`,
            data: { call, reason: 'repeat-success-fallback' } });
          continue;
        }
        // 断点续做的 collect:只挖打断前没挖到的那些;打断前就已挖够的不再进技能
        const carried = resumedCollect(task, i);
        if (carried && carried.remaining <= 0) {
          const line = `${stepLabel(i)}: ${carried.note},没再挖`;
          land(i, 'ok', null, line);
          results.push(line);
          this.opts.diag?.write({
            lane: 'skill', event: 'done', taskId: id, durMs: 0,
            msg: `${describeSkill(call)}: ${carried.note}`,
            data: { call, resumed: { done: carried.done, total: carried.total } },
          });
          continue;
        }
        const run = carried?.call ?? call;
        const carriedNote = carried ? `(${carried.note})` : '';
        const useCell = call.skill === 'use' && call.at ? targetCellOf(bot, call) : null;
        const beforeUseBlock = useCell ? blockAtCell(bot, useCell) : null;
        const useBlockBefore: UsedBlockState | null = beforeUseBlock
          ? { name: beforeUseBlock.name, stateId: beforeUseBlock.stateId, open: blockProp(beforeUseBlock, 'open') }
          : null;
        task.stepIndex = i;
        ctx.progressDetail = undefined;
        task.escape.active = false; // 逃生标记只属于置位它的那一步
        // 续做步从打断前的读数起算:第一次进度回调之前再被挂起,断点里的进度也不能是空
        task.count = carried ? { done: carried.done, total: carried.total } : null;
        const startedAt = Date.now();
        task.stepStartedAt = startedAt;
        if (!task.queueTailNotified && i === task.steps.length - 1
          && this.queue.length === 0 && !this.frozen && this.holdReason() === null && !this.opts.busyWith?.()) {
          task.queueTailNotified = true;
          const notice: TaskQueueTail = { taskId: id, stepIndex: i, stepCount: task.steps.length };
          task.queueTailNotice = notice;
          try { this.opts.onQueueTail?.(notice); }
          catch (error) { this.opts.log.warn('尾步队列观察投递失败，任务继续', { taskId: id, err: String(error) }); }
        }
        const at = bot.entity?.position;
        if (call.skill === 'find' && call.direction && at) {
          (task.findOrigins ??= new Map()).set(i, feetOf(bot));
        }
        const gotoTarget = call.skill === 'goto' ? lastAbsoluteGoto([call]) : null;
        task.goalProgressAt = gotoTarget ? startedAt : undefined;
        task.bestGoalDistance = gotoTarget && at
          ? Math.hypot(at.x - gotoTarget.x, at.y - gotoTarget.y, at.z - gotoTarget.z) : undefined;
        const trackGoalProgress = (): void => {
          if (!gotoTarget || task.goalProgressAt === undefined) return;
          const pos = bot.entity?.position;
          if (!pos) return;
          const distance = Math.hypot(pos.x - gotoTarget.x, pos.y - gotoTarget.y, pos.z - gotoTarget.z);
          if (task.bestGoalDistance === undefined || distance <= task.bestGoalDistance - 1) {
            task.bestGoalDistance = distance;
            task.goalProgressAt = Date.now();
          }
        };
        this.opts.diag?.write({
          lane: 'skill', event: 'begin', taskId: id,
          msg: `第 ${i + 1} 步 ${describeSkill(call)}`,
          data: {
            call,
            from: at ? { x: Math.round(at.x), y: Math.round(at.y), z: Math.round(at.z) } : null,
          },
        });
        let lastProgressPos = at ? { x: at.x, y: at.y, z: at.z } : null;
        let halfSent = false;
        const sendProgress = (half: boolean): void => {
          if (ctx.aborted()) return;
          const p = bot.entity?.position ?? null;
          const moved = p && lastProgressPos
            ? Math.hypot(p.x - lastProgressPos.x, p.y - lastProgressPos.y, p.z - lastProgressPos.z)
            : null;
          if (p) lastProgressPos = { x: p.x, y: p.y, z: p.z };
          this.opts.onProgress?.({
            taskId: id,
            label: labelOf(task),
            stepIndex: i,
            stepCount: task.steps.length,
            step: describeSkill(call),
            elapsedS: Math.round((Date.now() - startedAt) / 1000),
            pos: p ? { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) } : null,
            movedBlocks: moved === null ? null : Math.round(moved * 10) / 10,
            count: task.count,
            ...(ctx.progressDetail ? { detail: ctx.progressDetail() } : {}),
            half,
            ...(ctx.sleeping ? { sleeping: true } : {}),
          });
        };
        // 续做的 collect 按剩余数跑,进度读数加回打断前那一段:心跳与再次挂起看的都是整单的数
        const offset = carried?.done ?? 0;
        ctx.progress = (done, total) => {
          const count = { done: done + offset, total: total + offset };
          task.count = count;
          if (!halfSent && count.total > 1 && count.done * 2 >= count.total && count.done < count.total) {
            halfSent = true;
            sendProgress(true);
          }
        };
        const progressTimer = setInterval(() => sendProgress(false), PROGRESS_EVERY_MS);
        progressTimer.unref?.();
        const goalProgressTimer = gotoTarget ? setInterval(trackGoalProgress, GOAL_PROGRESS_SAMPLE_MS) : null;
        goalProgressTimer?.unref?.();
        const placedMark = placeMarksOf(bot);
        const reserveMark = ctx.reserveHits!.length;
        ctx.toolTrace = { last: undefined, notes: [], near: new Set() };
        const toolAndReserve = (): string =>
          toolTraceNote(ctx.toolTrace) + reserveNote(ctx.reserveHits!, reserveMark);
        ctx.intended = intended;
        const gainBase = collectGainBase(bot, call) ?? undefined;
        // 这一步能不能顺手把后面几步也做掉(目前只有 stow 用):它自己看剩下的步
        ctx.batch = {
          steps, index: i,
          absorb: (n, receipt, ok = true) => { (task.absorbed ??= new Map()).set(n, { receipt, ok }); },
        };
        windowStep = i + 1;
        /** 这一步登记的缺口(build 放不满);null = 没登记过 */
        let gapNote: string | null = null;
        ctx.partial = (gap) => { gapNote = gap; };
        const opensForNext = (call.skill === 'use' || (call.skill === 'chat' && call.text.startsWith('/')))
          && consumesOpenWindow(steps[i + 1]);
        const windowBaseline = bot.currentWindow;
        const onWindowOpen = (window: NonNullable<Bot['currentWindow']>): void => windows.onWindowOpen(window);
        if (opensForNext) {
          windows.beginOpening(windowBaseline);
          bot.on('windowOpen', onWindowOpen);
        }
        try {
          if (run.skill === 'collect') {
            const hold = this.unseenCollectNote([run], Date.now());
            if (hold) throw new SkillBlocked(hold, [], 'local', 'resource-unavailable');
          }
          const tread = stepTargetCell(bot, call);
          const releaseTread = tread ? holdTreadWater(bot, tread) : null;
          let skillResult = await runSkill(bot, run, ctx).finally(() => releaseTread?.());
          if (ctx.aborted()) return;
          promoteTemporaryScaffold(bot, intended);
          if (i === steps.length - 1 && !bot.currentWindow && !flightState(bot).flying
            && ['goto', 'find', 'surface', 'build', 'collect', 'land'].includes(call.skill)
            && !(call.skill === 'goto' && call.walkOnly)
            && !steps.some((step) => 'dryRun' in step && step.dryRun)) {
            try {
              skillResult += await reclaimPendingTemporaryScaffold(bot, ctx);
            } catch (err) {
              if (err instanceof Aborted || ctx.aborted()) throw err;
              const reason = err instanceof Error ? err.message : String(err);
              skillResult += `;临时垫脚清理未完成，原任务结果保留：${reason}`;
              this.opts.diag?.write({ lane: 'skill', event: 'temporary-scaffold-cleanup-deferred', taskId: id,
                msg: reason, data: { call } });
            }
            if (ctx.aborted()) return;
          }
          const next = steps[i + 1];
          if ((call.skill === 'use' || (call.skill === 'chat' && call.text.startsWith('/')))
            && consumesOpenWindow(next) && (!storageWindow(bot.currentWindow) || bot.currentWindow === windowBaseline)) {
            const oldWindowOnly = bot.currentWindow !== null && bot.currentWindow === windowBaseline;
            const why = call.skill === 'use' && call.at === undefined
              ? `使用物品后${oldWindowOnly ? '没有打开新的容器窗口' : '没有打开容器窗口'}，下一步无法使用当前窗口`
              : `操作后${oldWindowOnly ? '没有打开新的可存取容器窗口' : '没有打开可存取的容器窗口'}，下一步无法使用当前窗口`;
            const line = `${stepHead(i, startedAt)}: ${skillResult};${why}`;
            land(i, 'fail', why, line);
            firstWhy ??= why;
            blockedSteps.push(line);
            this.opts.diag?.write({ lane: 'skill', event: 'blocked', taskId: id,
              durMs: Date.now() - startedAt, msg: `${describeSkill(call)}: ${why}`,
              data: { call, result: skillResult, reason: 'container-window-missing' } });
            continue;
          }
          if (opensForNext) await windows.awaitOpeningReady(ctx);
          const afterDimension = normalizeDimension(dimensionOf(bot));
          if (call.skill === 'transit') {
            expectedDimension = afterDimension;
          } else if (afterDimension !== expectedDimension) {
            transitBoundary = i + 1;
            const why = `${describeSkill(call)}执行期间未经 transit 从${zhDimension(expectedDimension)}进入了${zhDimension(afterDimension)}`;
            const line = `${stepHead(i, startedAt)}: ${why}；本步不按完成，整条尾巴已停`;
            land(i, 'fail', why, line);
            firstWhy ??= why;
            blockedSteps.push(line);
            this.opts.diag?.write({
              lane: 'skill', event: 'dimension-unexpected', taskId: id, durMs: Date.now() - startedAt,
              msg: why,
              data: { call, expectedDimension, actualDimension: afterDimension },
            });
            continue;
          }
          const result = skillResult
            + placedNote(bot, placedMark, call.skill, intended)
            + toolAndReserve() + wetNote(bot);
          // 期望在场时它才是裁决:技能报成也可能被期望落空推翻。她没声明就由执行器推
          const expect = call.expect ?? deriveExpect(bot, call);
          const verdict = expect ? evaluateExpect(bot, expect, gainBase) : null;
          // 核验与这一步同一刻跑,句子却随终态回执一起重放:读数时刻要跟着句子走
          const readAt = verdict ? this.clock(Date.now()) : undefined;
          if (verdict && !verdict.met) {
            this.opts.diag?.write({
              lane: 'skill', event: 'blocked', taskId: id, durMs: Date.now() - startedAt,
              msg: `${describeSkill(call)}期望落空: ${verdict.actual}`,
              data: { call, result, expect, derived: call.expect === undefined, actual: verdict.actual, readAt },
            });
            const note = verdictNote(expect!, verdict, readAt);
            const line = `${stepHead(i, startedAt)}: ${describeSkill(call)}没做成(技能报「${result}」);${note}`;
            land(i, 'fail', note, line);
            bagDue ||= blockedOnItems(note);
            blockedSteps.push(line);
            if (call.skill === 'transit') transitBoundary = i + 1;
            continue;
          }
          if (opensForNext) windows.commitOpening();
          this.opts.diag?.write({
            lane: 'skill', event: 'done', taskId: id, durMs: Date.now() - startedAt,
            msg: `${describeSkill(call)}: ${result}`,
            data: { call, result, ...(verdict ? { expect, derived: call.expect === undefined, actual: verdict.actual } : {}) },
          });
          // 技能登记了缺口 = 做了一部分:回执与任务终态都要说,别混进「完成」。
          // 例外:她**显式声明**的期望已达成时裁决权在期望(存量口径,与「技能报受阻
          // 但期望已达成」对称)——缺口的读数仍留在句子里,只是终态不再按半成算。
          const gap: string | null = verdict?.met && call.expect !== undefined ? null : gapNote;
          // 达成也回显:她拿不到正向确认时,重发是唯一可用的确认手段
          const line = `${stepHead(i, startedAt)}: ${result}${ranFree}${carriedNote}`
            + `${verdict ? `;${verdictNote(expect!, verdict, readAt)}` : ''}`
            + `${gap ? `;${gap}` : ''}`;
          land(i, gap ? 'partial' : 'ok', gap, line);
          if (call.skill === 'tunnel' && !call.spiral && at && bot.entity?.position) {
            const end = bot.entity.position;
            this.noteVerticalTunnelTraversal(
              { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) },
              { x: Math.floor(end.x), y: Math.floor(end.y), z: Math.floor(end.z) },
              afterDimension,
            );
          }
          if (call.skill === 'collect') this.clearUnseenCollect(call.block, bot);
          if (!gap && useCell && useBlockBefore) {
            const afterBlock = blockAtCell(bot, useCell);
            const after: UsedBlockState | null = afterBlock
              ? { name: afterBlock.name, stateId: afterBlock.stateId, open: blockProp(afterBlock, 'open') }
              : null;
            if (useChangeMayClearRouteFailure(useBlockBefore, after)) {
              this.clearSpatialFailuresForChangedBlock(useCell, dimensionOf(bot));
            }
          }
          if (gap) partialSteps.push(line);
          else results.push(line);
        } catch (err) {
          if (err instanceof Yielded || (this.checkpointDrain?.task === task
            && this.checkpointDrain.phase === 'yielded' && this.checkpointDrain.continuation)) {
            this.opts.diag?.write({ lane: 'skill', event: 'yielded', taskId: id,
              msg: `${describeSkill(call)}保存检查点，当前执行实例正在收尾`,
              data: { call, step: i + 1 } });
            return;
          }
          const aborted = err instanceof Aborted || ctx.aborted();
          if (aborted) {
            // 顶替/叫停的汇报已由发起方发过;Aborted 不评估 expect
            const by = (err instanceof Aborted ? err.by : null) ?? ctx.abortedBy?.() ?? null;
            this.opts.diag?.write({
              lane: 'skill', event: 'aborted', taskId: id, durMs: Date.now() - startedAt,
              msg: `${describeSkill(call)}被打断${by ? `(${by})` : ''}`,
              data: { call, error: (err as Error).message, by },
            });
            return;
          }
          const blocked = err instanceof SkillBlocked ? err : null;
          if (call.skill === 'transit') transitBoundary = i + 1;
          const reason = blocked ? blocked.message : `技能内部错误: ${zhErrorText((err as Error).message)}`;
          // 技能报阻但期望已达成(战利品自己进了包、人已经在目的地):按达成算
          const expect = call.expect ?? deriveExpect(bot, call);
          const verdict = expect ? evaluateExpect(bot, expect, gainBase) : null;
          const readAt = verdict ? this.clock(Date.now()) : undefined;
          const operationUnconfirmed = blocked?.code === 'container-window-changed'
            || blocked?.code === 'container-window-rollback' || blocked?.code === 'use-hand-changed'
            || isInventoryClickError(err);
          if (!opensForNext && !operationUnconfirmed && verdict?.met
            && (call.expect !== undefined || mayOverturnBlocked(expect!))) {
            this.opts.diag?.write({
              lane: 'skill', event: 'done', taskId: id, durMs: Date.now() - startedAt,
              msg: `${describeSkill(call)}技能报受阻但期望已达成: ${verdict.actual}`,
              data: { call, error: reason, expect, derived: call.expect === undefined, actual: verdict.actual },
            });
            const line = `${stepHead(i, startedAt)}: `
              + `${describeSkill(call)}:技能报受阻(${reason});${verdictNote(expect!, verdict, readAt)}${toolAndReserve()}`;
            land(i, 'ok', null, line);
            results.push(line);
          } else if (err instanceof SkillNoop) {
            // 无事可做:条件不成立所以什么都没发生。陈述句、不进失败堆、不阻断下游。
            this.opts.diag?.write({
              lane: 'skill', event: 'noop', taskId: id, durMs: Date.now() - startedAt,
              msg: `${describeSkill(call)}无事可做: ${reason}`,
              data: { call, why: reason, ...(verdict ? { actual: verdict.actual } : {}) },
            });
            const line = `${stepHead(i, startedAt)}: ${reason},这一步没什么可做的${toolAndReserve()}`;
            land(i, 'noop', reason, line);
            firstWhy ??= reason;
            noopSteps.push(line);
          } else {
            if (call.skill === 'collect' && blocked?.code === 'target-not-visible') {
              this.noteUnseenCollect(call.block, bot);
            }
            if (call.skill === 'collect' && blocked?.code === 'target-not-ready') {
              this.noteImmatureCollect(call.block, bot);
            }
            this.opts.diag?.write({
              lane: 'skill', event: 'blocked', taskId: id, durMs: Date.now() - startedAt,
              msg: `${describeSkill(call)}受阻: ${(err as Error).message}`,
              data: {
                call, error: (err as Error).message, source: blockedSourceOf(err),
                ...(blocked?.code ? { code: blocked.code } : {}),
                ...(verdict ? { actual: verdict.actual } : {}),
              },
            });
            const line = `${stepHead(i, startedAt)}: `
              + `${blockedText(call, reason, expect, verdict, bot.heldItem?.name ?? null, readAt)}${toolAndReserve()}${carriedNote}`;
            land(i, 'fail', reason, line, blocked?.code);
            firstWhy ??= reason;
            this.noteBlockedReason(reason, Date.now(), {
              task: label(),
              step: steps.length > 1 ? `第 ${i + 1} 步 ${describeSkill(call)}` : describeSkill(call),
            });
            // 这一单自己撞上的是哪几类:头条只在与其中一类同类时才上浮(见 blockedHeadline)
            myBlockedKeys.add(Executor.blockedKey(reason));
            // 判据只看受阻的**原因**:blockedText 尾巴上那句「不过包里现在有 N 个,够了」
            // 说的是东西不缺,拿它当"卡在东西上"就反了
            bagDue ||= blockedOnItems(reason);
            blockedSteps.push(line);
            if (blocked && blocked.scene.length > 0) scenes.push(...blocked.scene);
          }
        } finally {
          if (opensForNext) {
            bot.removeListener('windowOpen', onWindowOpen);
          }
          clearInterval(progressTimer);
          if (goalProgressTimer) clearInterval(goalProgressTimer);
          ctx.progress = undefined;
          const outcome = outcomes[i];
          if (outcome === 'fail' || outcome === 'noop' || ctx.aborted()
            || !consumesOpenWindow(steps[i + 1])) closeHeldWindow();
          if (opensForNext) windows.endOpening();
        }
      }
    } catch (err) {
      if (err instanceof Aborted || ctx.aborted()) return;
      throw err;
    } finally {
      closeHeldWindow();
      if (typeof bot.removeListener === 'function') bot.removeListener('windowClose', onWindowClose);
    }
    // 现场事实单独成段:结论说发生了什么,现场说当时都知道什么
    const scene = scenes.length > 0 ? `\n[现场] ${scenes.join('\n[现场] ')}` : '';
    // 无事可做的那几步单独成段:它们既不是做成也不是没做成,混进哪一堆都会读歪
    const nothingToDo = noopSteps.length > 0 ? `\n没什么可做的:${listOf(noopSteps)}` : '';
    // 「同一件事上次什么下场」入账:只记没达到目的的,达到了就把旧账抹掉
    // (上次没成这次成了,再拿旧账去提醒她就是散布过期事实)。
    // 一步没成、全程无事可做也算没达到目的 —— 找牛找了 20 分钟一头没见着,
    // 任务层面是「做完了」,可她想要的那件事一次没发生。
    const kind: PriorOutcome['kind'] | null = blockedSteps.length > 0 ? 'blocked'
      : partialSteps.length > 0 ? 'partial'
        : results.length === 0 && noopSteps.length > 0 ? 'noop'
          : null;
    const finishedAt = Date.now();
    this.notePriorOutcome(task, kind, firstWhy ?? '没说清为什么', finishedAt);
    const repeatFailure = this.noteRepeatOutcome(task, kind, finishedAt);
    this.recordExactOutcome(steps, kind === 'blocked' || kind === 'noop', firstWhy ?? '没说清为什么');
    if (steps.length > 1) {
      for (const landing of task.stepLog) {
        const call = steps[landing.step - 1];
        if (call?.skill !== 'take' || !call.at) continue;
        if (landing.outcome === 'fail') this.recordExactOutcome([call], true, landing.why ?? '没说清为什么');
        else if (landing.outcome === 'ok' || landing.outcome === 'partial') {
          this.recordExactOutcome([call], false, '');
        }
      }
    }
    this.recordUnmovedFindHits(task);
    this.recordImmatureFindHits(task);
    this.recordEmptyFindOutcomes(task);
    this.recordDirectionalSweeps(task);
    this.recordTunnelLiquidStop(steps, task.stepLog);
    this.recordTunnelSupportStop(steps, task.stepLog);
    this.recordEmptyProbeReads(steps, task.stepLog);
    this.recordLocalFarmOutcome(steps, task.stepLog);
    if (kind === null) this.inspections.record(steps, normalizeDimension(dimensionOf(bot)), task.stepLog, Date.now());
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].skill !== 'goto') continue;
      const gotoLanding = task.stepLog.find((landing) => landing.step === i + 1);
      if (gotoLanding) {
        this.recordSpatialOutcome([steps[i]], gotoLanding.outcome === 'fail',
          gotoLanding.why ?? firstWhy ?? '没说清为什么');
      }
    }
    // 终态四分。没做成 > 做了一部分 > 完成:一单里最重的那个结局说了算。
    // 无事可做不影响终态——一单全是「附近没有掉落物」,那一单就是做完了。
    const hasTrials = steps.some(step => 'dryRun' in step && step.dryRun === true);
    const onlyTrials = hasTrials && steps.every(step => step.skill === 'probe' || step.skill === 'observe' || 'dryRun' in step && step.dryRun === true);
    if (blockedSteps.length === 0 && partialSteps.length === 0) {
      this.finish(flag, {
        kind: 'done',
        text: `${span()}${label()}${onlyTrials ? '试算结束（没有执行移动、施法、放置或挖掘）' : '完成'}:${listOf(results)}${nothingToDo}${scene}`,
        taskId: id,
        ...(repeatFailure ? { repeatFailure } : {}),
      });
      return;
    }
    const doneSoFar = results.length > 0
      ? `\n${onlyTrials ? '已返回的试算' : hasTrials ? '已返回的步骤结果' : '做成的'}:${listOf(results)}` : '';
    if (blockedSteps.length === 0) {
      this.finish(flag, {
        kind: 'partial',
        text: `${span()}${label()}做了一部分:${listOf(partialSteps)}${doneSoFar}${nothingToDo}${scene}`,
        taskId: id,
        ...(repeatFailure ? { repeatFailure } : {}),
      });
      return;
    }
    const halfDone = partialSteps.length > 0 ? `\n做了一部分的:${listOf(partialSteps)}` : '';
    // 头名理由上浮:只在这一单自己就撞在那一类上时才拼(见 blockedHeadline)
    const headline = this.blockedHeadline(Date.now(), myBlockedKeys);
    this.finish(flag, {
      // 存在受阻或跳过的步骤时，任务终态为 blocked。
      kind: 'blocked',
      text: `${headline ?? ''}${span()}${label()}:${listOf(blockedSteps.map(renderBlocked))}${halfDone}${doneSoFar}${nothingToDo}${scene}`
        + `${bagDue ? bagNow(bot) : ''}`,
      taskId: id,
      ...(repeatFailure ? { repeatFailure } : {}),
    });
  }

  private notePriorOutcome(task: QueuedTask, kind: PriorOutcome['kind'] | null, why: string, at: number): void {
    if (!task.priorContext) return;
    const sig = taskSignature(task.steps);
    if (kind === null) {
      if (this.priorOutcomes.get(sig)?.context === task.priorContext) this.priorOutcomes.delete(sig);
      return;
    }
    this.priorOutcomes.set(sig, { kind, why, at, context: task.priorContext, taskId: task.id, label: labelOf(task) });
  }

  private observeTask(steps: readonly SkillCall[]): TaskObservation | null {
    const bot = this.opts.getBot();
    if (!bot) return null;
    const dimension = dimensionOf(bot);
    const orientationOnly = steps.length > 0 && steps.every((step) => step.skill === 'look');
    // A look target is a viewing direction, not a block to modify. Keep its history
    // separate, and in mixed batches observe the actual interaction target.
    const observedSteps = orientationOnly ? steps : steps.filter((step) => step.skill !== 'look');
    const target = [...observedSteps].reverse().map((step) => (step as { at?: unknown }).at).find((at): at is number[] =>
      Array.isArray(at) && at.length === 3 && at.every((value) => typeof value === 'number' && Number.isFinite(value)));
    const cell = target ? { x: target[0], y: target[1], z: target[2] } : null;
    let targetBlock: string | null = null;
    if (cell && typeof bot.blockAt === 'function') {
      try {
        const block = blockAtCell(bot, cell);
        if (block) targetBlock = `${block.name}:${block.stateId}`;
      } catch { /* An unloaded target has no comparable block reading. */ }
    }
    const position = bot.entity?.position;
    const yaw = bot.entity?.yaw;
    const pitch = bot.entity?.pitch;
    let inventory: string | null = null;
    try { inventory = this.retryInventoryStamp(bot); } catch { /* Observation must not hold task execution. */ }
    return {
      key: cell && !orientationOnly ? `target:${dimension}:${cell.x},${cell.y},${cell.z}` : `shape:${dimension}:${taskSignature(steps)}`,
      scope: cell && !orientationOnly ? 'target' : 'shape', dimension,
      position: position && [position.x, position.y, position.z].every(Number.isFinite)
        ? { x: position.x, y: position.y, z: position.z } : null,
      orientationOnly,
      rotation: orientationOnly && Number.isFinite(yaw) && Number.isFinite(pitch) ? { yaw, pitch } : null,
      inventory, targetBlock,
    };
  }

  private observationChanged(before: TaskObservation | null, after: TaskObservation | null): boolean | null {
    if (!before || !after) return null;
    if (before.dimension !== after.dimension) return true;
    if (before.orientationOnly && after.orientationOnly) {
      if (!before.rotation || !after.rotation) return null;
      const yawDelta = after.rotation.yaw - before.rotation.yaw;
      return Math.abs(Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta))) >= Math.PI / 180
        || Math.abs(after.rotation.pitch - before.rotation.pitch) >= Math.PI / 180;
    }
    if (before.inventory !== null && after.inventory !== null && before.inventory !== after.inventory) return true;
    if (before.position && after.position && Math.hypot(
      before.position.x - after.position.x,
      before.position.y - after.position.y,
      before.position.z - after.position.z,
    ) >= 0.75) return true;
    if (before.scope === 'target' && before.targetBlock !== null && after.targetBlock !== null
      && before.targetBlock !== after.targetBlock) return true;
    if (before.inventory === null || after.inventory === null || !before.position || !after.position
      || (before.scope === 'target' && (before.targetBlock === null || after.targetBlock === null))) return null;
    return false;
  }

  private noteRepeatOutcome(task: QueuedTask, kind: PriorOutcome['kind'] | null, at: number): TaskReport['repeatFailure'] {
    // Inspection leaves physical observations unchanged by contract and must not
    // join or clear the progress history of an actual action at the same target.
    if (task.steps.every(step => 'dryRun' in step && step.dryRun === true)) return undefined;
    const before = task.startObservation ?? null;
    const after = this.observeTask(task.steps);
    const changed = this.observationChanged(before, after);
    const key = before?.key ?? after?.key;
    if (!key) return undefined;
    for (const [oldKey, prior] of this.unresolvedIntents) {
      if (at - prior.at > PRIOR_OUTCOME_WINDOW_MS) this.unresolvedIntents.delete(oldKey);
    }
    // 动作显示完成却未改变这些采样读数，只对同一空间目标提示复盘；
    // 没有坐标的成功动作可能在未采样的外部状态上已经奏效。
    const unfinishedTarget = before?.scope === 'target' && kind !== null;
    // A failed spatial task can move, toggle a gate or collect items while its
    // final target remains unmet. Preserve that outcome alongside the changes.
    if (!unfinishedTarget && (changed === true || (kind === null && (changed !== false || before?.scope !== 'target')))) {
      this.unresolvedIntents.delete(key);
      return undefined;
    }
    const prior = this.unresolvedIntents.get(key);
    const repeated = prior && (unfinishedTarget || this.observationChanged(prior.after, before) !== true);
    const attempts = repeated ? prior.attempts + 1 : 1;
    const landing = [...(task.stepLog ?? [])].reverse().find((step) =>
      step.outcome === 'fail' || step.outcome === 'noop' || step.outcome === 'partial')
      ?? task.stepLog?.at(-1);
    const line = landing?.line ?? (kind === 'blocked' ? '任务整体受阻' : '所采样读数未变');
    const evidence = line.length > 180 ? `${line.slice(0, 60)}…${line.slice(-119)}` : line;
    this.unresolvedIntents.delete(key);
    this.unresolvedIntents.set(key, { attempts, at, evidence, after });
    if (this.unresolvedIntents.size > 128) this.unresolvedIntents.delete(this.unresolvedIntents.keys().next().value!);
    if (!(attempts === 2 || attempts === 5 || attempts % 10 === 0)) return undefined;
    return {
      attempts, previousReceipt: maskCoords(repeated ? prior.evidence : '').slice(0, 180),
      scope: before?.scope ?? after?.scope ?? 'shape',
      observation: changed === true ? 'changed' : changed === false ? 'unchanged' : 'unavailable',
    };
  }

  /**
   * 受阻理由归并用的键:坐标、数字、方块名后缀都摘掉,只留"这是哪一类受阻"。
   * 只做字面归并,不做归因。
   */
  private static blockedKey(why: string): string {
    return why
      .replace(/\(\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*\)/g, '')
      .replace(/-?\d+(\.\d+)?/g, '')
      .replace(/\s+/g, '')
      .slice(0, 60);
  }

  /** 受阻原文账,新的在前(见 blockedRecords) */
  blockedLog(): readonly BlockedRecord[] {
    return this.blockedRecords;
  }

  /**
   * 「包里只剩 N 格」这一行,附在任务终态回执末尾。
   *
   * 补的是 precheck 那条格位警告够不着的那一段:precheck 只在**这一步要往包里装东西**
   * 时才算格位(`包里剩 N 格空位,这一步…预计要占 M 格`),于是挖了一路矿、包早就快满了,
   * 只要下一单不是装东西的,她一个字都读不到,直到某一步真的被「包满了,没处放」驳回。
   *
   * 防刷屏是**状态机**不是节流:一次「跌破 5 格」只说一次,空位回到 5 格以上再跌破
   * 才说第二次。所以捡两格土又扔掉不会来回念,而真的从宽裕挖到快满一定会被说到一次。
   *
   * 只报两个数与账上最近的那个箱子(复用 `knownChestNote` 的同一份口径与措辞),
   * 去不去清、清什么、就地放个新箱子还是走回去,都是她的权衡。
   */
  private bagLowNote(bot: Bot): string {
    // 物品栏还没到手(登录后 window_items 未到、台架的裸 bot):没有读数就不出声,
    // 更不能把"读不到"当成"空的"报成一句「只剩 36 格」
    if (!inventoryReadConfirmed(bot)) return '';
    const items = bot.inventory?.items?.();
    if (!items) return '';
    const free = Math.max(0, PLAYER_SLOTS - items.length);
    if (free > BAG_LOW_FREE) {
      this.bagLowArmed = true;
      return '';
    }
    if (!this.bagLowArmed) return '';
    this.bagLowArmed = false;
    const chest = knownChestNote(bot, this.opts.chests);
    return `\n[背包] 包里只剩 ${free} 格空位,快满了${chest ?? ';账上本维度还没有记过箱子'}`;
  }

  private noteBlockedReason(why: string, at: number, where?: { task: string; step: string }): void {
    if (where) {
      this.blockedRecords.unshift({ at, task: where.task, step: where.step, why });
      if (this.blockedRecords.length > BLOCKED_LOG_MAX) this.blockedRecords.length = BLOCKED_LOG_MAX;
    }
    const key = Executor.blockedKey(why);
    const cut = at - BLOCKED_HEADLINE_WINDOW_MS;
    for (const [k, v] of this.blockedReasons) {
      v.at = v.at.filter((t) => t > cut);
      if (v.at.length === 0) this.blockedReasons.delete(k);
    }
    const entry = this.blockedReasons.get(key) ?? { at: [] };
    entry.at.push(at);
    this.blockedReasons.set(key, entry);
  }

  /**
   * 报告一小时内与本单受阻原因相同的累计次数。
   * 候选仅取本单遇到的归并类；达到门槛后选次数最多的一类，头条只报次数，原因保留在步骤结果中。
   */
  private blockedHeadline(at: number, mine: ReadonlySet<string>): string | null {
    const cut = at - BLOCKED_HEADLINE_WINDOW_MS;
    let top = 0;
    for (const key of mine) {
      const count = this.blockedReasons.get(key)?.at.filter((t) => t > cut).length ?? 0;
      if (count >= BLOCKED_HEADLINE_MIN && count > top) top = count;
    }
    if (top === 0) return null;
    const mins = Math.round(BLOCKED_HEADLINE_WINDOW_MS / 60_000);
    return `⚠ 这一类受阻在过去 ${mins} 分钟里已经是第 ${top} 次\n`;
  }

  /** 任务终结后继续队列，受阻不自动撤销后续任务；撤单由 mc_stop 决定。 */
  private finish(flag: AbortFlag, report: TaskReport): void {
    if (this.stopped || flag.aborted || flag.epoch !== this.executionEpoch) return;
    const t = this.task?.flag === flag ? this.task : null;
    if (t) this.task = null;
    if (t) this.detachCheckpointOwner(t.id);
    // 「包快满了」只搭**跑完了的那一单**的车:顶替/撤单那两种终态说的是「这一单没了」,
    // 往上贴一行背包读数只会把那句话冲淡。状态机本身照常在这三种终态上推进。
    const bot = this.opts.getBot();
    const bagLow = bot && (report.kind === 'done' || report.kind === 'partial' || report.kind === 'blocked')
      ? this.bagLowNote(bot)
      : '';
    const text = `${report.text}${bagLow}`;
    this.opts.diag?.write({
      lane: 'task', event: report.kind, taskId: report.taskId, msg: text,
    });
    const lastLanding = t?.stepLog.at(-1);
    this.opts.report({ ...report, text,
      ...(t ? { steps: t.stepLog.map(({ step, outcome, why }) => ({ step, outcome, why })) } : {}),
      ...(report.kind === 'done' && t && lastLanding
        && (lastLanding.outcome === 'ok' || lastLanding.outcome === 'noop')
        ? { lastSkill: t.steps[lastLanding.step - 1]?.skill } : {}) });
    this.pump();
    // pump 没接到新任务 = 队列空了:兜底关掉忘关的容器窗口(窗口卫生)
    if (!this.task && !this.checkpointDrain && this.queue.length === 0) this.opts.onDrain?.();
  }
}

/** 反射层的阈值与开关。一律现读,控制台热改即生效。 */
interface ReflexOptions {
  getBot: () => Bot | null;
  report: (r: TaskReport) => void;
  log: Logger;
  /** 低血等不可恢复接管仍走破坏性抢占。 */
  preempt: (reason: string) => void;
  /** 岩浆、溺水和窒息接管时冻结任务断点与队列。 */
  pauseEnvironment: (reason: string) => QueueHoldToken | null;
  /** 所有环境危险清除并稳定落脚后恢复冻结断点。 */
  resumeEnvironment: (token: QueueHoldToken) => QueueResumeResult;
  /** 深坠落只终止当前危险任务，排队与冻结计划继续保留。 */
  stopFallTask: (reason: string) => QueueHoldToken | null;
  /** 深坠落结束并满足安全恢复条件后，释放对应队列租约。 */
  resumeAfterFall: (token: QueueHoldToken) => boolean;
  /** 执行器的当前任务正在逃(flee/surface/战斗撤退):受击反应整个让路,不添乱 */
  escapeActive?: () => boolean;
  /** 受击是否反击(关掉则反射不还手,打不打由主脑决定) */
  fightBack: () => boolean;
  /** 反击时生命低于此值改为脱离战斗 */
  fleeHealth: () => number;
  /** 低血脱离前可尝试不占用身体的服务端防护技能。 */
  onLowHealth?: (bot: Bot) => void;
  /** 持续找不到岸且水平位置未推进时，由 World 执行安全落点逃逸。 */
  onWaterTrap?: () => void;
  /** 两次受击反应之间的最短间隔(秒) */
  reactCooldownSec: () => number;
  /** 防溺水上浮 */
  antiDrown: () => boolean;
  /** 挨烧就跑(岩浆、火);关掉则连手动冲刺一起松手 */
  antiLava: () => boolean;
  /** 执行器手上正在跑的任务;灭火找水不在它跑的时候抢身体 */
  currentTask?: () => { id: number; label: string } | null;
  /**
   * 战斗会话接手受击:返回 true = 会话开打/已在打(反射不再自己抡,也不用
   * 反应冷却);false = 会话进不了场(关着/冷却/环境自保),退回反射的降级行为。
   */
  combatHurt?: (attackerId: number, name: string) => boolean;
  /** World 日志;不给就不记 */
  diag?: MinecraftLog;
}

/**
 * 挨烧与防溺水逐心跳检查；受击挂钩按 SLOW_EVERY 分频。
 */
const REFLEX_TICK_MS = 200;

/** 逃跑方向:背对危险格的水平反方向,取 6 格远处一个供 lookAt 用的瞄点 */
function awayFrom(p: { x: number; y: number; z: number }, hazard: { x: number; y: number; z: number }): Vec3 {
  const dx = p.x - (hazard.x + 0.5);
  const dz = p.z - (hazard.z + 0.5);
  const len = Math.hypot(dx, dz);
  // 正正好站在危险格中心(陷进去了):没有方向可言,随便挑一个走出去
  if (len < 1e-6) return new Vec3(p.x + 6, p.y + 1.6, p.z);
  return new Vec3(p.x + (dx / len) * 6, p.y + 1.6, p.z + (dz / len) * 6);
}
const SLOW_EVERY = 5;

/**
 * 会把人埋住并持续窒息的下落方块。比 `isGravityBlock` 窄:铁砧/龙蛋/钟乳石也会掉,
 * 但不是整方块,压不出窒息伤害,挖它们脱不了困。
 */
function isSuffocatingFaller(name: string): boolean {
  return name === 'sand' || name === 'red_sand' || name === 'gravel'
    || name === 'suspicious_sand' || name === 'suspicious_gravel'
    || name.endsWith('_concrete_powder');
}

/** 原版摔落伤害从超过 3 格起算;落体记录用同一条线,免得每次跳跃都记一笔 */
const FALL_DAMAGE_BLOCKS = 3;
/** 超过这段落差后，原任务落点与路径前提均已失效。 */
const FALL_TASK_STOP_BLOCKS = 6;
/** 连续稳定三次以上心跳才交还队列，过滤边缘触地与史莱姆反弹。 */
const FALL_SAFE_FOOTING_MS = 600;
/** 环境与深坠冻结租约各自的超时阈值；到期释放对应槽并报告现场，另一槽仍可保持队列冻结。 */
const HOLD_WATCHDOG_MS = 60_000;
/**
 * 反射自己下的逃生目标允许零推进多久。
 *
 * 这三条路(登岸、逃岩浆、低血脱离)都是裸 `setGoal`,不经 `gotoGoal`,没有 deadline
 * 也没有收尾校验;而空路径之后寻路器的 `pathUpdated` 闩锁让它**永不重算**——
 * 目标一旦不可达就是死等。到点撤销目标,交回各反射自己的重试节奏重下。
 */
const ESCAPE_STALL_MS = 5_000;
/** 与 FALL_SAFE_MOVE 同口径:小于这个数的位移是站桩时的抖动,不算推进 */
const ESCAPE_STALL_MOVE = 0.08;
const WATER_TRAP_MS = 90_000;
const WATER_TRAP_MOVE = 3;
const FALL_SAFE_MOVE = 0.08;
const FALL_UNSAFE_BLOCKS = new Set([
  'cactus', 'sweet_berry_bush', 'wither_rose', 'powder_snow',
  'campfire', 'soul_campfire', 'magma_block', 'fire', 'soul_fire', 'lava',
]);

function safeFallFooting(bot: Bot, allowWaterSurface = false): boolean {
  if ((bot.health ?? 0) <= 0 || (!hasDryFooting(bot)
    && !(allowWaterSurface && bodyInWater(bot) && !headInWater(bot)
      && bot.blockAt(bot.entity.position.offset(0, 1, 0))?.boundingBox === 'empty'))) return false;
  const touch = hazardTouch(bot);
  if (touch.touching !== null || touch.onFire) return false;
  const p = bot.entity.position;
  for (let x = Math.floor(p.x - 0.31); x <= Math.floor(p.x + 0.31); x++) {
    for (let z = Math.floor(p.z - 0.31); z <= Math.floor(p.z + 0.31); z++) {
      for (let y = Math.floor(p.y - 0.05); y <= Math.floor(p.y + 1.79); y++) {
        const block = blockAtCell(bot, { x, y, z });
        if (block && FALL_UNSAFE_BLOCKS.has(block.name)) return false;
      }
    }
  }
  return true;
}

export class Reflexes {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private busyFighting = false;
  private lastHurtReactAt = 0;
  private ticks = 0;
  private unobserveDamage: (() => void) | null = null;
  private deathHandler: (() => void) | null = null;
  private hookedBot: Bot | null = null;
  private environmentHold: QueueHoldToken | null = null;
  /** 当前环境租约起租时刻；0 表示没有计时中的环境租约。 */
  private environmentHoldSince = 0;
  /** 看门狗强制解冻过这一轮环境危机:危机彻底解除前不再重新冻结队列。 */
  private environmentForfeited = false;
  /** 执行器单边清空了冻结两槽(mc_stop 等):下一拍要为仍在的危机重申一张新租约。 */
  private environmentHoldStale = false;
  private environmentSafe: {
    since: number;
    at: { x: number; y: number; z: number };
  } | null = null;
  /** 反射自己下的逃生目标:哪条反射下的、什么目标、上次见到推进是什么时候、当时人在哪 */
  private escapeGoal: {
    kind: 'drown' | 'lava' | 'burn' | 'flee';
    goal: InstanceType<typeof goals.Goal>;
    since: number;
    at: { x: number; y: number; z: number };
    /** 目标格(登岸/换气点/灭火的水):零推进撤销后进本轮的排除集,不再重选 */
    target?: Cell;
    drownPhase?: 'breathing' | 'landing';
  } | null = null;
  /** 传送在飞到此刻为止;见 abandonEscapeGoal */
  private goalHoldUntil = 0;

  constructor(private readonly opts: ReflexOptions) {}

  /** 环境自保正在进行：战斗会话据此让位、也不进场。 */
  get envActive(): boolean {
    return this.environmentOwnerKind !== null;
  }

  /** 影子全身租约与战斗让位共用的当前环境 owner。 */
  get environmentOwnerKind(): 'lava' | 'drown' | 'suffocation' | null {
    if (this.lavaEscape !== null) return 'lava';
    if (this.drowning) return 'drown';
    if (this.buried !== null) return 'suffocation';
    return null;
  }

  start(): void {
    this.stopped = false;
    this.timer = setInterval(() => this.tick(), REFLEX_TICK_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // 停在逃跑中途:方向键留在按下状态,人会一直朝那边走
    const bot = this.opts.getBot();
    if (bot?.entity && this.lavaEscape !== null && !this.lavaEscape.handedOff) this.releaseDash(bot);
    this.lavaEscape = null;
    this.burning = null;
    if (bot?.entity && this.buried !== null) bot.setControlState('jump', false);
    this.buried = null;
    this.drowning = false;
    this.waterTrap = null;
    this.environmentHold = null;
    this.environmentHoldSince = 0;
    this.environmentForfeited = false;
    this.environmentHoldStale = false;
    this.environmentSafe = null;
    this.escapeGoal = null;
    // 反射停了就不再有"正在救命的目标",登记必须跟着撤,否则 releaseBody 会一直
    // 认为那张还归反射用、谁也撤不掉它
    if (bot) clearEscapeGoalOwner(bot);
    this.fall = null;
    this.fallBot = null;
    this.unobserveDamage?.();
    this.unobserveDamage = null;
    if (this.hookedBot && this.deathHandler) {
      this.hookedBot.removeListener('death', this.deathHandler as never);
    }
    this.hookedBot = null;
  }

  private tick(): void {
    if (this.stopped) return;
    const bot = this.opts.getBot();
    if (!bot?.entity) return;
    const slow = this.ticks++ % SLOW_EVERY === 0;
    if (slow) this.hookHurt(bot);
    // 防溺水与防烧在各自开关启用时逐心跳检查；关闭防烧时调用 endLavaEscape 收尾。
    // 执行器清空冻结后，持续危机会重申环境租约，仍受 beginEnvironment 的超时放弃限制。
    if (this.environmentHoldStale) {
      this.environmentHoldStale = false;
      if (this.environmentOwnerKind !== null && this.environmentHold === null) {
        this.beginEnvironment(`${Reflexes.ownerText(this.environmentOwnerKind)}危机还在,重申队列冻结`);
      }
    }
    if (this.opts.antiDrown()) void this.antiDrown(bot);
    if (this.opts.antiLava()) void this.antiLava(bot);
    else this.endLavaEscape(bot, false);
    if (this.buried !== null) void this.antiSuffocate(bot);
    this.watchFall(bot);
    this.resumeEnvironmentWhenSafe(bot);
    this.watchHolds(bot);
    this.watchEscapeGoal(bot);
  }

  /**
   * 下一个逃生目标并开始盯它。裸 `setGoal` 的三条路都走这里,免得再出现
   * 「下完就没人管」的目标。
   */
  private setEscapeGoal(
    bot: Bot, kind: 'drown' | 'lava' | 'burn' | 'flee', goal: InstanceType<typeof goals.Goal>, target?: Cell,
    drownPhase?: 'breathing' | 'landing',
  ): void {
    // 同步登记给 releaseBody:别人交还身体时不许把正在救命的这一张撤掉。
    // 下达与登记是同一处(setOwnedGoal 记的就是 escape 这一档),两本账合成一本
    setOwnedGoal(bot, goal, 'escape', escapeIntent(kind), { diag: this.opts.diag });
    const p = bot.entity.position;
    this.escapeGoal = { kind, goal, since: Date.now(), at: { x: p.x, y: p.y, z: p.z }, target, drownPhase };
  }

  /**
   * 逃生目标看门狗:零推进超过 ESCAPE_STALL_MS 就撤掉重下。
   *
   * 重下不新造节奏 —— 溺水把「每 8 秒找一次岸」的钟归零(下一拍就重找),岩浆退回
   * 手动冲刺那条既有兜底(冲够 DASH_MS 再交给寻路器),只有低血脱离没有自己的
   * 节拍,原地重下同一个目标(dropGoal 已经把 `pathUpdated` 闩锁解开,这一下会真重算)。
   */
  private watchEscapeGoal(bot: Bot): void {
    const esc = this.escapeGoal;
    if (esc === null) return;
    // 目标已经被别人换掉/撤掉了:这张不再归我看
    if (bot.pathfinder?.goal !== undefined && bot.pathfinder.goal !== esc.goal) {
      this.escapeGoal = null;
      return;
    }
    const now = Date.now();
    const p = bot.entity.position;
    const moved = Math.hypot(p.x - esc.at.x, p.y - esc.at.y, p.z - esc.at.z);
    if (moved > ESCAPE_STALL_MOVE) {
      esc.since = now;
      esc.at = { x: p.x, y: p.y, z: p.z };
      return;
    }
    if (now - esc.since < ESCAPE_STALL_MS) return;
    this.escapeGoal = null;
    dropGoal(bot, 'escape', `${escapeIntent(esc.kind)}零推进,撤了重下`, this.opts.diag);
    const what = escapeIntent(esc.kind);
    this.opts.diag?.write({
      lane: 'reflex', event: 'escape-goal-stalled',
      msg: `${what}的逃生目标 ${Math.round(ESCAPE_STALL_MS / 1000)} 秒零推进,已撤销重下`,
      data: {
        kind: esc.kind, stallMs: now - esc.since,
        position: bot.entity.position, health: bot.health,
      },
    });
    this.opts.report({
      kind: 'reflex',
      text: `[反射] ${what}的寻路${esc.target ? `(去 ${cellText(esc.target)})` : ''}`
        + `${fmtDur(now - esc.since)}没挪动,人在 ${cellText(feetOf(bot))},已撤掉目标`
        + (esc.kind === 'flee' ? ',原地重下同一个目标。' : esc.kind === 'lava' ? ',改回手动冲刺。' : ',换一个目标重找。'),
    });
    if (esc.kind === 'drown') {
      // 将零推进的登岸格列入本轮排除集，避免重试再次选中。
      if (esc.target) this.drownExcluded.add(cellKeyOf(esc.target));
      this.lastDrownEscapeAt = 0; // 下一拍 routeDrownToLand 重新找岸
    } else if (esc.kind === 'burn') {
      if (esc.target) this.burning?.excluded.add(cellKeyOf(esc.target));
      this.lastBurnSeekAt = 0;
    } else if (esc.kind === 'lava' && this.lavaEscape !== null) {
      this.lavaEscape.handedOff = false; // 退回手动冲刺,冲够 DASH_MS 再交寻路器
      this.lavaEscape.startedAt = now;
      this.lavaEscape.dashFrom = null;
    } else if (esc.kind === 'flee') {
      this.setEscapeGoal(bot, 'flee', esc.goal);
    }
  }

  /**
   * 执行器清空冻结后丢弃失效令牌，并标记下一拍重新申请。
   * environmentForfeited 保留超时放弃状态，限制持续危机对队列的占用。
   */
  invalidateEnvironmentHold(): void {
    if (this.environmentHold === null) return;
    this.environmentHold = null;
    this.environmentHoldSince = 0;
    this.environmentSafe = null;
    const kind = this.environmentOwnerKind;
    this.environmentHoldStale = kind !== null;
    this.opts.diag?.write({
      lane: 'reflex', event: 'environment-hold-invalidated',
      msg: `执行器清空了冻结租约,反射的旧令牌作废`
        + (kind !== null ? `;${Reflexes.ownerText(kind)}危机还在,下一拍重申` : ''),
      data: { owner: kind, willReassert: kind !== null },
    });
  }

  /**
   * 传送(mc_escape)前撤掉反射自己下的寻路目标并松开冲刺键:目标格和方向都按传送前的位置算,
   * 留着会在落地后把人拽回原处。各反射落地后按新位置重新判断;holdMs 内岩浆反射不再把落脚格
   * 交给寻路器(溺水、灭火、低血脱离由 escapeActive 挡着)。返回撤了什么,没撤返回 null。
   */
  abandonEscapeGoal(why: string, holdMs: number): string | null {
    const bot = this.opts.getBot();
    if (!bot?.entity) return null;
    this.goalHoldUntil = Date.now() + holdMs;
    const bits: string[] = [];
    const esc = this.escapeGoal;
    if (esc !== null || onEscapeGoal(bot)) {
      this.escapeGoal = null;
      dropGoal(bot, 'escape', why, this.opts.diag);
      bits.push(esc
        ? `撤掉了反射正在走的${escapeIntent(esc.kind)}寻路${esc.target ? `(目标 ${cellText(esc.target)})` : ''}`
        : '撤掉了反射正在走的寻路');
    }
    const lava = this.lavaEscape;
    if (lava !== null && !lava.handedOff) {
      this.releaseDash(bot);
      bits.push('松开了逃离岩浆的冲刺键');
    }
    if (lava !== null) {
      lava.handedOff = false;
      lava.cell = null;
      lava.dashFrom = null;
    }
    if (bits.length === 0) return null;
    const text = bits.join(',');
    this.opts.diag?.write({
      lane: 'reflex', event: 'escape-goal-abandoned',
      msg: `${why}:${text}`,
      data: { kind: esc?.kind ?? null, target: esc?.target ?? null, position: bot.entity.position },
    });
    return text;
  }

  private beginEnvironment(reason: string): void {
    if (this.environmentHold !== null) return;
    // 这一轮危机的冻结已被看门狗强制解冻过:再冻一次等于下一拍又把队列关死
    if (this.environmentForfeited) return;
    this.environmentHold = this.opts.pauseEnvironment(reason);
    this.environmentSafe = null;
    if (this.environmentHold !== null) this.environmentHoldSince = Date.now();
  }

  /** 环境 owner 的中文说法,只出现在回报里。 */
  private static ownerText(kind: 'lava' | 'drown' | 'suffocation' | null): string {
    if (kind === 'lava') return '岩浆';
    if (kind === 'drown') return '溺水';
    if (kind === 'suffocation') return '窒息';
    return '危险已解除';
  }

  /** 脚下那一格的方块名:强制解冻要说清当时人踩在什么上面。 */
  private footingText(bot: Bot): string {
    const feet = feetOf(bot);
    const below = blockAtCell(bot, { x: feet.x, y: feet.y - 1, z: feet.z });
    return below ? zhName(below.name) : '读不到的方块';
  }

  /**
   * 冻结看门狗。安全恢复条件长期不满足时，超时交还对应的队列租约。
   * 走反射心跳,不另开定时器。环境侧解冻后置 forfeited,否则下一拍 beginEnvironment
   * 立刻再冻一次;深坠侧直接丢掉本轮落体记录,重新起跳会重新计数。
   */
  private watchHolds(bot: Bot): void {
    const now = Date.now();
    if (this.environmentHold === null && this.environmentOwnerKind === null) {
      this.environmentForfeited = false;
    }
    const envToken = this.environmentHold;
    if (envToken !== null && this.environmentHoldSince !== 0
      && now - this.environmentHoldSince >= HOLD_WATCHDOG_MS) {
      const heldSec = Math.round((now - this.environmentHoldSince) / 1000);
      const kind = this.environmentOwnerKind;
      const footing = this.footingText(bot);
      this.environmentHold = null;
      this.environmentHoldSince = 0;
      this.environmentSafe = null;
      this.environmentForfeited = true;
      const resumed = this.opts.resumeEnvironment(envToken);
      // 令牌对不上号时这一下并没有解冻任何东西(冻结已换租约或已被撤),照实说
      const text = `[反射] 环境冻结(${Reflexes.ownerText(kind)})超过 ${heldSec} 秒仍未稳定落脚,`
        + (resumed.released ? '已解冻队列;' : '这张租约已经失效,没有可解冻的队列;')
        + `当时脚下是${footing},人在 ${cellText(feetOf(bot))}。`
        + (resumed.released && resumed.note ? `${resumed.note}。` : '');
      this.opts.diag?.write({
        lane: 'reflex', event: 'hold-timeout', msg: text,
        data: {
          hold: 'environment', owner: kind, footing, heldSec, resumed,
          position: bot.entity.position, health: bot.health,
        },
      });
      this.opts.report({ kind: 'reflex', text });
    }
    const fall = this.fall;
    if (fall?.stopped === true && fall.hold !== null && fall.holdSince !== 0
      && now - fall.holdSince >= HOLD_WATCHDOG_MS) {
      const heldSec = Math.round((now - fall.holdSince) / 1000);
      const footing = this.footingText(bot);
      const token = fall.hold;
      this.fall = null;
      const released = this.opts.resumeAfterFall(token);
      const text = `[反射] 深坠冻结超过 ${heldSec} 秒仍未稳定落脚,`
        + (released ? '已解冻队列;' : '这张租约已经失效,没有可解冻的队列;')
        + `当时脚下是${footing},人在 ${cellText(feetOf(bot))}。`;
      this.opts.diag?.write({
        lane: 'reflex', event: 'hold-timeout', msg: text,
        data: {
          hold: 'fall', footing, heldSec, released,
          position: bot.entity.position, health: bot.health,
        },
      });
      this.opts.report({ kind: 'reflex', text });
    }
  }

  /** 所有环境 owner 都退出并稳定干燥落脚后，才把断点交还给执行器。 */
  private resumeEnvironmentWhenSafe(bot: Bot): void {
    const token = this.environmentHold;
    if (token === null) return;
    if (this.environmentOwnerKind !== null || !safeFallFooting(bot)) {
      this.environmentSafe = null;
      return;
    }
    const now = Date.now();
    const p = bot.entity.position;
    const moved = this.environmentSafe === null
      ? Infinity
      : Math.hypot(
          p.x - this.environmentSafe.at.x,
          p.y - this.environmentSafe.at.y,
          p.z - this.environmentSafe.at.z,
        );
    if (this.environmentSafe === null || moved > FALL_SAFE_MOVE) {
      this.environmentSafe = { since: now, at: { x: p.x, y: p.y, z: p.z } };
      return;
    }
    if (now - this.environmentSafe.since < FALL_SAFE_FOOTING_MS) return;
    this.environmentHold = null;
    this.environmentHoldSince = 0;
    this.environmentSafe = null;
    const resumed = this.opts.resumeEnvironment(token);
    this.opts.diag?.write({
      lane: 'reflex', event: 'environment-safe',
      msg: `环境危机后已在 ${cellText(feetOf(bot))} 稳定落脚,`
        + (resumed.released ? '恢复执行权' : '旧恢复租约已失效'),
      data: { position: bot.entity.position, health: bot.health, resumed },
    });
    if (resumed.released) {
      this.opts.report({
        kind: 'reflex',
        text: `[反射] 已在 ${cellText(feetOf(bot))} 稳定落脚,环境冻结解除`
          + Reflexes.resumedText(resumed),
      });
    }
  }

  /**
   * 危险已经解除、但脚下永远不会干(开阔水域游着换气)时就地交还队列。
   * 稳定落脚那条路要求 `safeFallFooting`,在水里恒假,只等它等于永久冻结。
   */
  private releaseEnvironmentHoldNow(bot: Bot, why: string): void {
    const token = this.environmentHold;
    if (token === null || this.environmentOwnerKind !== null) return;
    this.environmentHold = null;
    this.environmentHoldSince = 0;
    this.environmentSafe = null;
    const resumed = this.opts.resumeEnvironment(token);
    this.opts.diag?.write({
      lane: 'reflex', event: 'environment-safe',
      msg: `${why},` + (resumed.released ? '恢复执行权' : '旧恢复租约已失效'),
      data: { position: bot.entity.position, health: bot.health, resumed, why },
    });
    if (resumed.released) {
      this.opts.report({
        kind: 'reflex',
        text: `[反射] ${why},环境冻结解除` + Reflexes.resumedText(resumed),
      });
    }
  }

  /** 环境那一槽解了之后队列的下场:接着做哪件、另一槽还冻着、或者队列已经放开。 */
  private static resumedText(resumed: QueueResumeResult): string {
    if (resumed.note) return `;${resumed.note}。`;
    if (resumed.stillHeld) return `;另一处冻结(${resumed.stillHeld})还在,队列还不开跑。`;
    return ',队列放开了。';
  }

  /** 受击反应挂在 bot 事件上;重连换 bot 后重挂 */
  private hookHurt(bot: Bot): void {
    if (this.hookedBot === bot) return;
    this.unobserveDamage?.();
    if (this.hookedBot && this.deathHandler) {
      this.hookedBot.removeListener('death', this.deathHandler as never);
    }
    this.hookedBot = bot;
    this.unobserveDamage = observeDamage(bot, (evidence) => {
      if (this.stopped || this.hookedBot !== bot || this.opts.getBot() !== bot) return;
      void this.onHurt(bot, evidence);
    });
    this.deathHandler = () => {
      this.fall = null;
      this.environmentHold = null;
      this.environmentHoldSince = 0;
      this.environmentForfeited = false;
      this.environmentHoldStale = false;
      this.environmentSafe = null;
      this.drowning = false;
      this.submergedAt = 0;
      this.surfacedAt = 0;
      this.drownExcluded.clear();
      // 氧气元数据死后停在旧值,复活后服务端不一定补发:读数再变之前只信水下计时
      this.oxygenTrusted = false;
      this.lavaEscape = null;
      this.burning = null;
      this.buried = null;
      this.escapeGoal = null;
      clearEscapeGoalOwner(bot);
    };
    bot.on('death', this.deathHandler as never);
  }

  /** 着火时检测火源的半径；范围内仍有火源则继续脱离。 */
  private static readonly ON_FIRE_HAZARD_R = 3;
  /** 找逃生落脚格的扫描半径 */
  private static readonly ESCAPE_SCAN_R = 4;
  /** 先手动冲这么久再把目标交给寻路器:A* 一次要几百毫秒到两秒,岩浆等不起 */
  private static readonly DASH_MS = 1_200;
  private static readonly LAVA_REPORT_MS = 20_000;

  /** 同一片岩浆的两次接触算不算一轮:间隔超过这个数就重新计数 */
  private static readonly LAVA_BOUT_GAP_MS = 30_000;

  /**
   * 连续满 600ms 没有危险接触(着火时连 ON_FIRE_HAZARD_R 内的火源也没有)才结算 lava-clear，
   * 期间不交还执行权。600ms 约三次心跳，用于过滤危险边缘的采样抖动。
   */
  private static readonly LAVA_CLEAR_DWELL_MS = 600;
  /**
   * 手动冲刺在 ESCAPE_STALL_MS 内的净位移不到这个数就算卡住。岩浆里横向游速约
   * 0.8 格/秒(每刻 0.02 推力、0.5 阻力),5 秒该走 4 格;不到 1 格说明人没离开原来那一格附近。
   */
  private static readonly LAVA_DASH_STALL_MOVE = 1;

  private lastLavaReportAt = 0;
  private lavaEscape: {
    startedAt: number; handedOff: boolean; reported: boolean;
    /** 头一次读到「不碰」的时刻;再碰到就清回 null(见 LAVA_CLEAR_DWELL_MS) */
    clearSince: number | null;
    /** 本轮选定的落脚格;仍安全就一直朝它走 */
    cell: Cell | null;
    /** 冲刺卡住检测的窗口起点:从哪儿、什么时候开始量 */
    dashFrom: { x: number; y: number; z: number; at: number } | null;
  } | null = null;
  /**
   * 一轮岩浆的进出计次。离开危险格满驻留窗口记 clear，身上还着火也照记，着火交给灭火反射。
   * 同一片危险区内再次接触仍用计次区分，避免把反复进出读成多次成功。
   */
  private lavaBout = { count: 0, firstAt: 0, lastClearAt: 0 };

  /**
   * 挨烧就跑。触发口径是"碰撞箱压着烧人的方块",不是"脚下那格是岩浆"——贴着岩浆池
   * 边缘走的时候人已经在掉血,而中心格还是空气,这是真机上最常见的中招方式;流动
   * 岩浆柱蹭到身上同理。身上着火且火源还在近处也算,那说明刚蹭进去、下一跳还会挨。
   */
  private async antiLava(bot: Bot): Promise<void> {
    const touch = hazardTouch(bot);
    const hazard = touch.touching
      ?? (touch.onFire ? nearestHazard(bot, Reflexes.ON_FIRE_HAZARD_R) : null);
    if (hazard === null) {
      // 灭火不等驻留窗口结算
      if (this.lavaEscape !== null || this.burning !== null) this.extinguish(bot, touch.onFire);
      this.endLavaEscape(bot, touch.onFire);
      return;
    }
    const now = Date.now();
    const p = bot.entity.position;
    if (this.lavaEscape === null) {
      this.beginEnvironment('逃离岩浆');
      // 正在飞的寻路多半就是把人送进来的那条;先撤掉,免得它把人拽回去
      dropGoal(bot, 'escape', '踩进岩浆,撤掉正在飞的那条路', this.opts.diag);
      this.escapeGoal = null;
      this.lavaEscape = {
        startedAt: now, handedOff: false, reported: false, clearSince: null, cell: null, dashFrom: null,
      };
      const fresh = this.lavaBout.count === 0
        || now - this.lavaBout.lastClearAt > Reflexes.LAVA_BOUT_GAP_MS;
      if (fresh) this.lavaBout = { count: 1, firstAt: now, lastClearAt: 0 };
      else this.lavaBout.count += 1;
    }
    const esc = this.lavaEscape;
    // 又碰上了:上一拍那点"没碰到"不算数,驻留窗口从头计
    esc.clearSince = null;
    // 交给寻路器之后还在烧,说明它没把人带出去;收回来自己跑,别在火里等 A*
    if (esc.handedOff && now - esc.startedAt >= Reflexes.DASH_MS * 2) {
      esc.handedOff = false;
      esc.startedAt = now;
      esc.dashFrom = null;
      dropGoal(bot, 'escape', '交给寻路器还在烧,收回来自己跑', this.opts.diag);
      this.escapeGoal = null;
      this.opts.report({
        kind: 'reflex', hurt: true,
        text: `[反射] 逃离岩浆:寻路器走了 ${fmtDur(Reflexes.DASH_MS * 2)} 还贴着${zhName(hazard.name)},`
          + `撤了寻路目标,改回手动冲刺。生命 ${Math.ceil(bot.health ?? 0)}/20。`,
      });
    }
    // 落脚点逐 tick 复核:流动岩浆还在铺开,上一 tick 的安全格这一 tick 未必安全,不安全了才重选。
    // 身上着着火时水格是最高优先的落脚点(preferWater),不再被当障碍排除。
    // 列表总含碰到的那一格:hazardTouch 认脚下的灼热地面,hazardsWithin 只扫 BURNING_BLOCKS,
    // 而 dashAway 取列表均值作危险中心,列表不能为空。
    const hazards = hazardsWithin(bot, Reflexes.ESCAPE_SCAN_R + ESCAPE_SAFE_GAP);
    if (!hazards.some((h) => h.x === hazard.x && h.y === hazard.y && h.z === hazard.z)) {
      hazards.push(hazard);
    }
    const cell = findEscapeCell(bot, hazards, Reflexes.ESCAPE_SCAN_R, touch.onFire, esc.cell);
    esc.cell = cell;
    if (!esc.handedOff) {
      if (cell !== null && now - esc.startedAt >= Reflexes.DASH_MS && now >= this.goalHoldUntil) {
        // 冲开一段之后多半已经出了岩浆,这时候再让寻路器把人送到落脚点
        this.handLavaToPathfinder(bot, esc, cell, `冲刺 ${fmtDur(now - esc.startedAt)} 后`);
      } else {
        this.dashAway(bot, hazards, cell, touch.submerged);
        if (cell === null) this.watchLavaDash(bot, esc, now);
        else esc.dashFrom = null;
      }
    }
    if (esc.reported && now - this.lastLavaReportAt < Reflexes.LAVA_REPORT_MS) return;
    this.lastLavaReportAt = now;
    esc.reported = true;
    const what = zhName(hazard.name);
    const how = touch.touching === null
      ? `身上着火了,${what}就在 ${hazard.distance.toFixed(1)} 格外`
      : touch.submerged ? `整个人陷进${what}里了` : `碰到${what}了(${hazard.distance.toFixed(1)} 格)`;
    this.opts.diag?.write({
      lane: 'reflex', event: 'lava',
      msg: `${how},正在往 ${cell ? `(${cell.x}, ${cell.y}, ${cell.z})` : '反方向'} 逃`,
      data: {
        position: p, hazard, cell, onFire: touch.onFire,
        submerged: touch.submerged, health: bot.health,
        bout: this.lavaBout.count, boutMs: now - this.lavaBout.firstAt,
      },
    });
    this.opts.report({
      kind: 'reflex',
      hurt: true,
      text: `[反射] ${how}!正在逃离。生命 ${Math.ceil(bot.health ?? 0)}/20。`,
    });
  }

  /**
   * 手动冲刺:寻路器算一条路要几百毫秒到两秒,岩浆里只有两秒半可活,这段时间
   * 只能自己按方向键。有落脚格就朝它冲,没有就背着身边这片危险格的中心冲。
   * 中心取扫描半径内全部危险格的平均:只背着最近那一格冲时,人一跨格最近格就换到另一侧,
   * 朝向每拍翻转,人原地打转。
   */
  private dashAway(
    bot: Bot,
    hazards: HazardCell[],
    cell: { x: number; y: number; z: number } | null,
    submerged: boolean,
  ): void {
    const p = bot.entity.position;
    const near = hazards.filter((h) => h.distance <= Reflexes.ESCAPE_SCAN_R);
    const pool = near.length > 0 ? near : hazards;
    const center = {
      x: pool.reduce((s, h) => s + h.x, 0) / pool.length,
      y: p.y,
      z: pool.reduce((s, h) => s + h.z, 0) / pool.length,
    };
    const aim = cell !== null
      ? new Vec3(cell.x + 0.5, cell.y + 1.6, cell.z + 0.5)
      : awayFrom(p, center);
    void bot.lookAt(aim, true).catch(() => undefined);
    bot.setControlState('forward', true);
    bot.setControlState('sprint', true);
    // 陷进岩浆里是往下沉的,得一直按跳才浮得上来;要跨上去的落脚格同理
    bot.setControlState('jump', submerged || (cell !== null && cell.y > Math.floor(p.y)));
  }

  private releaseDash(bot: Bot): void {
    bot.setControlState('forward', false);
    bot.setControlState('sprint', false);
    bot.setControlState('jump', false);
  }

  /** 松开冲刺键,把落脚格交给寻路器,并告诉 bot 去哪儿。 */
  private handLavaToPathfinder(
    bot: Bot, esc: NonNullable<Reflexes['lavaEscape']>, cell: Cell, when: string,
  ): void {
    esc.handedOff = true;
    esc.dashFrom = null;
    this.releaseDash(bot);
    this.setEscapeGoal(bot, 'lava', new goals.GoalBlock(cell.x, cell.y, cell.z));
    this.opts.report({
      kind: 'reflex', hurt: true,
      text: `[反射] 逃离岩浆:${when}交给寻路器,去 ${cellText(cell)} 落脚。生命 ${Math.ceil(bot.health ?? 0)}/20。`,
    });
  }

  /**
   * 没有落脚格时手动冲刺的卡住检测:ESCAPE_STALL_MS 内净位移不到 LAVA_DASH_STALL_MOVE
   * 就把现场报给 bot,接着冲并重新计窗。有落脚格时冲满 DASH_MS 就交寻路器,轮不到这里。
   */
  private watchLavaDash(bot: Bot, esc: NonNullable<Reflexes['lavaEscape']>, now: number): void {
    const p = bot.entity.position;
    if (esc.dashFrom === null) {
      esc.dashFrom = { x: p.x, y: p.y, z: p.z, at: now };
      return;
    }
    const moved = Math.hypot(p.x - esc.dashFrom.x, p.y - esc.dashFrom.y, p.z - esc.dashFrom.z);
    if (moved >= Reflexes.LAVA_DASH_STALL_MOVE) {
      esc.dashFrom = { x: p.x, y: p.y, z: p.z, at: now };
      return;
    }
    if (now - esc.dashFrom.at < ESCAPE_STALL_MS) return;
    const heldMs = now - esc.dashFrom.at;
    const footing = this.footingText(bot);
    const where = cellText(feetOf(bot));
    this.opts.diag?.write({
      lane: 'reflex', event: 'lava-dash-stalled',
      msg: `逃离岩浆冲刺 ${fmtDur(heldMs)} 只挪了 ${moved.toFixed(1)} 格,人在 ${where},脚下是${footing},附近没有安全落脚格`,
      data: { moved, heldMs, footing, position: p, health: bot.health },
    });
    this.opts.report({
      kind: 'reflex', hurt: true,
      text: `[反射] 逃离岩浆卡住了:往背离岩浆的方向冲了 ${fmtDur(heldMs)},只挪了 ${moved.toFixed(1)} 格,`
        + `人在 ${where},脚下是${footing};${Reflexes.ESCAPE_SCAN_R} 格内找不到离岩浆 ${ESCAPE_SAFE_GAP} 格以上`
        + `能站的地方,还在往外冲。生命 ${Math.ceil(bot.health ?? 0)}/20。`,
    });
    esc.dashFrom = { x: p.x, y: p.y, z: p.z, at: now };
  }

  /** 身上还烧着时找水的扫描半径;着火满时长 8 秒,值得看远一点 */
  private static readonly BURN_WATER_SCAN_R = 16;
  /** 扫遍已加载区块且确实没有水时,隔这么久再扫;找到水就下目标,由 watchEscapeGoal 盯着 */
  private static readonly BURN_SEEK_MS = 2_000;
  private lastBurnSeekAt = 0;
  /**
   * 碰过岩浆/火源之后身上还着火的这一段,直到火灭。只在岩浆反射接过手之后才有,
   * 打怪被点着这类着火不归它。离开危险格后不冻结队列,bot 自己排的灭火照常跑。
   */
  private burning: {
    /** 水桶那一下:untried 还没试,poured 倒成了(water 是那格水),skip 不倒或倒不成 */
    pour: 'untried' | 'poured' | 'skip';
    water: Cell | null;
    /** 倒水在飞:这期间不结算、不找水 */
    busy: boolean;
    /** 找水落空/让路已经报过一次;同一段着火里同一句不重复报 */
    told: Set<string>;
    /** 找水目标零推进过的格,这一段着火里不再选 */
    excluded: Set<string>;
  } | null = null;

  /**
   * 灭火反射。包里有水桶就往自己身上倒水,火灭后用空桶舀回;没有水桶、在下界或倒不成时,
   * 走去最近的水里(执行器手上有任务时不抢身体)。做了什么、结果如何都报给 bot。
   */
  private extinguish(bot: Bot, onFire: boolean): void {
    if (!onFire) {
      const done = this.burning;
      if (done !== null && !done.busy) this.endBurning(bot, done);
      return;
    }
    // 泡进水里,服务端这一刻就会熄火
    if (bodyInWater(bot)) return;
    this.burning ??= { pour: 'untried', water: null, busy: false, told: new Set(), excluded: new Set() };
    const b = this.burning;
    if (b.busy) return;
    if (b.pour === 'untried') {
      b.busy = true;
      void this.pourWater(bot, b).finally(() => { b.busy = false; });
      return;
    }
    this.seekWaterWhileBurning(bot, b);
  }

  /** 着火这一段里报给 bot 的话;key 给了就同一段里只报一次。 */
  private reportBurn(
    bot: Bot, text: string, b?: NonNullable<Reflexes['burning']>, key?: string,
  ): void {
    if (b && key) {
      if (b.told.has(key)) return;
      b.told.add(key);
    }
    this.opts.report({ kind: 'reflex', hurt: true, text: `[反射] ${text}。生命 ${Math.ceil(bot.health ?? 0)}/20。` });
  }

  /**
   * 原版水桶规则:对脚下方块顶面用水桶,水落进脚这一格;脚这一格有草这类带外框的非实心
   * 方块时点中的是它,水落到它上面那一格(头)。两格都在身上,倒进哪格都能灭火。
   * 下界倒出来的水当场蒸发。
   */
  private async pourWater(bot: Bot, b: NonNullable<Reflexes['burning']>): Promise<void> {
    const bucket = bot.inventory.items().find((i) => i.name === 'water_bucket');
    if (!bucket) {
      b.pour = 'skip';
      return;
    }
    if (dimensionOf(bot).includes('nether')) {
      b.pour = 'skip';
      this.reportBurn(bot, '身上着着火;包里有水桶,但在下界倒出来的水会当场蒸发,没有倒');
      return;
    }
    // 跳起来的那几拍脚下是空的,等落地再倒
    if (!bot.entity.onGround) return;
    const feet = feetOf(bot);
    const floorCell = { x: feet.x, y: feet.y - 1, z: feet.z };
    const floor = blockAtCell(bot, floorCell);
    const at = blockAtCell(bot, feet);
    // 刚传送过来脚下区块还没到:下一拍再看
    if (floor === null || at === null) return;
    if (floor.boundingBox !== 'block' || at.boundingBox === 'block') {
      b.pour = 'skip';
      this.reportBurn(
        bot,
        `身上着着火;包里有水桶,但脚下 ${cellText(floorCell)} 是${zhName(floor.name)}、`
          + `脚这一格是${zhName(at.name)},水倒不到身上,没有倒`,
      );
      return;
    }
    const before = invCount(bot, (n) => n === 'water_bucket');
    try {
      await bot.equip(bucket, 'hand');
      await aimThenUse(bot, new Vec3(feet.x + 0.5, feet.y, feet.z + 0.5));
    } catch (err) {
      b.pour = 'skip';
      this.reportBurn(bot, `身上着着火;拿水桶往脚下倒水没做成(${(err as Error).message})`);
      return;
    }
    await sleep(USE_SETTLE_MS);
    const after = invCount(bot, (n) => n === 'water_bucket');
    const head = { x: feet.x, y: feet.y + 1, z: feet.z };
    const water = [feet, head].find((c) => WATER_BLOCKS.has(blockAtCell(bot, c)?.name ?? '')) ?? null;
    if (water !== null) {
      b.pour = 'poured';
      b.water = water;
      this.opts.diag?.write({
        lane: 'reflex', event: 'burning-pour',
        msg: `身上着着火,用水桶往 ${cellText(water)} 倒了水`,
        data: { water, before, after, position: bot.entity.position, health: bot.health },
      });
      this.reportBurn(bot, `身上着着火,手上换成水桶往 ${cellText(water)} 倒了水灭火(包里水桶 ${before} → ${after})`);
      return;
    }
    b.pour = 'skip';
    const now = blockAtCell(bot, feet)?.name ?? '读不到的方块';
    this.opts.diag?.write({
      lane: 'reflex', event: 'burning-pour-failed',
      msg: `用水桶对 ${cellText(floorCell)} 顶面右键,${cellText(feet)} 没读到水`,
      data: { feet, now, before, after, position: bot.entity.position, health: bot.health },
    });
    this.reportBurn(
      bot,
      `身上着着火;手上换成水桶对脚下 ${cellText(floorCell)} 右键了,${cellText(feet)} 没读到水`
        + `(那一格现在是${zhName(now)};包里水桶 ${before} → ${after})`,
    );
  }

  /** 火灭了:撤掉找水目标;倒过水就用空桶把那格水舀回来。 */
  private endBurning(bot: Bot, b: NonNullable<Reflexes['burning']>): void {
    this.burning = null;
    if (this.escapeGoal?.kind === 'burn') {
      this.escapeGoal = null;
      dropGoal(bot, 'escape', '火灭了,不用再去找水', this.opts.diag);
    }
    if (b.pour !== 'poured' || b.water === null) {
      this.reportBurn(bot, '身上的火灭了');
      return;
    }
    void this.scoopBack(bot, b.water);
  }

  private async scoopBack(bot: Bot, water: Cell): Promise<void> {
    const bucket = bot.inventory.items().find((i) => i.name === 'bucket');
    const name = blockAtCell(bot, water)?.name ?? '读不到的方块';
    if (!bucket || !WATER_BLOCKS.has(name)) {
      this.reportBurn(
        bot,
        `身上的火灭了;倒在 ${cellText(water)} 的水没舀回来(`
          + (bucket ? `那一格现在是${zhName(name)}` : '包里没有空桶') + ')',
      );
      return;
    }
    const before = invCount(bot, (n) => n === 'water_bucket');
    try {
      await bot.equip(bucket, 'hand');
      await aimThenUse(bot, new Vec3(water.x + 0.5, water.y + 0.5, water.z + 0.5));
    } catch (err) {
      this.reportBurn(bot, `身上的火灭了;拿空桶舀 ${cellText(water)} 的水没做成(${(err as Error).message}),那格水还在`);
      return;
    }
    await sleep(USE_SETTLE_MS);
    const after = invCount(bot, (n) => n === 'water_bucket');
    const left = blockAtCell(bot, water)?.name ?? '读不到的方块';
    this.reportBurn(
      bot,
      after > before
        ? `身上的火灭了;用空桶把 ${cellText(water)} 的水舀回来了(包里水桶 ${before} → ${after})`
        : `身上的火灭了;拿空桶对 ${cellText(water)} 右键了,水没舀回来(那一格现在是${zhName(left)};包里水桶 ${before} → ${after})`,
    );
  }

  /**
   * 去最近的水里灭火。目标取离人最近的水面格:绕去更远的水,路上蹚过的近处水格会被
   * 寻路器当成要垫脚的空当。扫描只覆盖已加载区块,有区块没到时下一拍重扫。
   */
  private seekWaterWhileBurning(bot: Bot, b: NonNullable<Reflexes['burning']>): void {
    // 已有在飞的逃生目标:watchEscapeGoal 在盯零推进,不重下
    if (this.escapeGoal !== null) return;
    // mc_escape 传送在飞或执行器的逃生任务在跑:这时下的目标会在落地后把人拽回原处
    if (this.opts.escapeActive?.()) return;
    const task = this.lavaEscape === null ? this.opts.currentTask?.() ?? null : null;
    if (task) {
      this.reportBurn(
        bot,
        `身上着着火,包里没有能用的水桶;执行器正在做任务#${task.id}「${task.label}」,反射不抢身体去找水`,
        b, `task-${task.id}`,
      );
      return;
    }
    const now = Date.now();
    if (now - this.lastBurnSeekAt < Reflexes.BURN_SEEK_MS) return;
    const water = this.nearestWater(bot, b.excluded);
    if (water === null) {
      const loaded = this.columnsLoaded(bot, Reflexes.BURN_WATER_SCAN_R);
      // 区块没到齐时这次落空不算数,下一拍重扫
      if (loaded) this.lastBurnSeekAt = now;
      const why = loaded
        ? `${Reflexes.BURN_WATER_SCAN_R} 格内没有水`
        : `身边 ${Reflexes.BURN_WATER_SCAN_R} 格内还有区块没加载,暂时看不到水`;
      this.opts.diag?.write({
        lane: 'reflex', event: 'burning-no-water',
        msg: `身上还着着火,${why}`,
        data: { loaded, position: bot.entity.position, health: bot.health },
      });
      this.reportBurn(bot, `身上着着火,包里没有能用的水桶;${why}`, b, loaded ? 'no-water' : 'unloaded');
      return;
    }
    this.lastBurnSeekAt = now;
    this.opts.diag?.write({
      lane: 'reflex', event: 'burning-seek-water',
      msg: `身上还着着火,去 ${cellText(water)} 的水里灭火`,
      data: { water, position: bot.entity.position, health: bot.health },
    });
    this.setEscapeGoal(bot, 'burn', new goals.GoalBlock(water.x, water.y, water.z), water);
    this.reportBurn(bot, `身上着着火,包里没有能用的水桶;反射接管寻路,去 ${cellText(water)} 的水里灭火`);
  }

  /** 离人最近、上面不是实心也不是液体的水格。 */
  private nearestWater(bot: Bot, excluded: Set<string>): Cell | null {
    const water = (bot.registry.blocksByName as Record<string, { id: number } | undefined>).water;
    if (!water) return null;
    const surface = (pos: Vec3): boolean => {
      if (excluded.has(cellKeyOf(pos))) return false;
      const above = bot.blockAt(pos.offset(0, 1, 0));
      return !!above && above.boundingBox !== 'block' && !LIQUIDS.has(above.name);
    };
    const hit = bot.findBlocks({
      matching: [water.id], maxDistance: Reflexes.BURN_WATER_SCAN_R, count: 1,
      useExtraInfo: (blk: { position: Vec3 }) => surface(blk.position),
    }).find(surface);
    return hit ? { x: hit.x, y: hit.y, z: hit.z } : null;
  }

  /** 以人为中心、半径 r 覆盖到的区块列是否都已加载。 */
  private columnsLoaded(bot: Bot, r: number): boolean {
    const p = bot.entity.position;
    for (let cx = Math.floor((p.x - r) / 16); cx <= Math.floor((p.x + r) / 16); cx++) {
      for (let cz = Math.floor((p.z - r) / 16); cz <= Math.floor((p.z + r) / 16); cz++) {
        if (!bot.world.getColumn(cx, cz)) return false;
      }
    }
    return true;
  }

  /**
   * 离开危险格并且连着站住 `LAVA_CLEAR_DWELL_MS` 之后这一轮逃离完成。身上还着火也结算:
   * 剩下的火归灭火反射,环境冻结当场解除,bot 自己排的灭火不再被压住。
   */
  private endLavaEscape(bot: Bot, stillOnFire: boolean): void {
    const esc = this.lavaEscape;
    if (esc === null) return;
    const now = Date.now();
    // 驻留窗口:单 tick 无接触撑不住「我出来了」这句断言(见 LAVA_CLEAR_DWELL_MS)。
    // 窗口里身体仍归环境自保 —— 不结算、不写 lava-clear、不交还执行权;
    // 但冲刺这一刻就松开:窗口是给断言用的,不是让她再往前冲半秒。
    if (esc.clearSince === null) {
      esc.clearSince = now;
      if (!esc.handedOff) this.releaseDash(bot);
    }
    if (now - esc.clearSince < Reflexes.LAVA_CLEAR_DWELL_MS) return;
    this.lavaEscape = null;
    if (!esc.handedOff) this.releaseDash(bot);
    const p = bot.entity.position;
    this.lavaBout.lastClearAt = now;
    const bout = this.lavaBout.count;
    this.opts.diag?.write({
      lane: 'reflex', event: 'lava-clear',
      // 第 2 次起仍该读成「又出来了一次」,不是「又成功了一次」
      msg: `脱离了 (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}),`
        + `${stillOnFire ? '身上还着着火' : '火也灭了'},生命 ${Math.ceil(bot.health ?? 0)}/20`
        + (bout > 1
          ? `;本轮第 ${bout} 次脱离(首次接触已过 ${fmtDur(now - this.lavaBout.firstAt)})`
          : ''),
      data: {
        position: p, onFire: stillOnFire, health: bot.health, ms: now - esc.startedAt,
        dwellMs: Reflexes.LAVA_CLEAR_DWELL_MS,
        bout, boutMs: now - this.lavaBout.firstAt,
      },
    });
    if (esc.reported) {
      this.opts.report({
        kind: 'reflex',
        hurt: true,
        text: `[反射] 从火里出来了,${stillOnFire ? '身上还着着火' : '火也灭了'}。生命 ${Math.ceil(bot.health ?? 0)}/20。`,
      });
    }
    // 着火不靠冻结队列来救;人在水里也站不出干燥落脚。两种情况都当场交还,其余按稳定落脚窗口。
    if (stillOnFire) this.releaseEnvironmentHoldNow(bot, '离开了岩浆,身上还着着火,灭火不冻结队列');
    else if (bodyInWater(bot)) this.releaseEnvironmentHoldNow(bot, '火灭了,人在水里(不等干燥落脚)');
  }

  /** 两条环境伤害日志之间的最短间隔;掉血播报归 World,这里只记诊断 */
  private static readonly ENV_HURT_LOG_MS = 5_000;
  private lastEnvHurtAt = 0;

  /**
   * 环境伤害:岩浆、火、摔落、窒息……没有可打的对象。反射能做的是立刻重查一次
   * 挨烧(等下一个 tick 太晚)并把现场记下来。掉血这件事本身由 World 播报,不复述。
   */
  private onEnvironmentHurt(bot: Bot, now: number, evidence: DamageEvidence): void {
    if (this.opts.antiLava()) void this.antiLava(bot);
    if (headInWater(bot)) {
      this.hurtUnderwaterAt = now;
      if (this.opts.antiDrown()) void this.antiDrown(bot);
    }
    // hurting=true:实心方块闷头那一路(圆石/石头)只在掉血时起手,口径在这条挂钩上
    void this.antiSuffocate(bot, true);
    if (now - this.lastEnvHurtAt < Reflexes.ENV_HURT_LOG_MS) return;
    this.lastEnvHurtAt = now;
    const touch = hazardTouch(bot);
    const hazard = touch.touching ?? nearestHazard(bot, Reflexes.ON_FIRE_HAZARD_R);
    this.opts.diag?.write({
      lane: 'reflex', event: 'env-hurt',
      msg: `收到伤害,尚无可确认的攻击者(生命 ${Math.ceil(bot.health ?? 0)}/20)`
        + (hazard ? `,${zhName(hazard.name)}就在 ${hazard.distance.toFixed(1)} 格` : '')
        + (touch.onFire ? ',身上着着火' : ''),
      data: {
        health: bot.health, onFire: touch.onFire, touching: touch.touching,
        hazard, position: bot.entity.position, sourceType: evidence.sourceType,
        causeId: evidence.causeId, directId: evidence.directId, origin: evidence.origin,
      },
    });
  }

  private buried: { startedAt: number; block: string; digging: boolean; reported: boolean } | null = null;

  /**
   * 环境伤害入口启动窒息自救，启动后逐心跳复查头部方块。
   * 下落方块直接进入处理分支；其他方块须为不透明实心块且本次受伤或已有自救状态。
   * 身体所有权沿用环境身份优先级，队列冻结受 beginEnvironment 约束。
   * 下落方块优先寻找可用横向出口，找不到时挖头部格；其他窒息方块直接挖头部格。
   */
  private async antiSuffocate(bot: Bot, hurting = false): Promise<void> {
    const headPos = bot.entity.position.offset(0, 1, 0);
    const head = bot.blockAt(headPos);
    const faller = head !== null && isSuffocatingFaller(head.name);
    // transparent 排除铁砧/台阶这类非整方块:头在它们的格里不窒息,掉血多半是砸击
    // 伤害,挖它们脱不了困(玻璃也被这条排除 —— 宁可漏这种罕见形态,不误挖铁砧)
    const solid = head !== null && !faller && head.boundingBox === 'block'
      && head.transparent !== true
      && (hurting || this.buried !== null);
    if (head === null || (!faller && !solid)) {
      const was = this.buried;
      if (was === null) return;
      this.buried = null;
      bot.setControlState('forward', false);
      bot.setControlState('jump', false);
      this.opts.diag?.write({
        lane: 'reflex', event: 'buried-clear',
        msg: `从${zhName(was.block)}里挖出来了,生命 ${Math.ceil(bot.health ?? 0)}/20`,
        data: {
          block: was.block, position: bot.entity.position,
          health: bot.health, ms: Date.now() - was.startedAt,
        },
      });
      this.opts.report({
        kind: 'reflex',
        text: `[反射] 从${zhName(was.block)}里挖出来了,头那一格不再闷人,人在 ${cellText(feetOf(bot))}。`
          + `生命 ${Math.ceil(bot.health ?? 0)}/20。`,
      });
      return;
    }
    const now = Date.now();
    if (this.buried === null) {
      this.beginEnvironment(faller ? '被埋住,往上挖' : '头卡在实心方块里,挖开脱身');
      // 把人送进沙砾层的多半就是正在飞的那条路;不撤掉它会一边挖一边被拽回去
      dropGoal(bot, 'escape', '被埋住,撤掉正在飞的那条路', this.opts.diag);
      this.buried = { startedAt: now, block: head.name, digging: false, reported: false };
      this.opts.diag?.write({
        lane: 'reflex', event: 'buried',
        msg: `头${faller ? '顶' : ''}是${zhName(head.name)},被${faller ? '埋' : '闷'}住了`
          + `(生命 ${Math.ceil(bot.health ?? 0)}/20),正在挖开脱身`,
        data: { block: head.name, solid, position: bot.entity.position, health: bot.health },
      });
    }
    const esc = this.buried;
    bot.setControlState('jump', true);
    if (!esc.reported) {
      esc.reported = true;
      this.opts.report({
        kind: 'reflex',
        hurt: true,
        text: `[反射] ${faller ? `被${zhName(head.name)}埋住了!正在挖开脱身` : `头卡在${zhName(head.name)}里,在掉血!正在挖开脱身`}。生命 ${Math.ceil(bot.health ?? 0)}/20。`,
      });
    }
    if (esc.digging) return;
    esc.digging = true;
    try {
      if (faller) {
        // 横向出口:头层四邻里第一个非下落方块的格。挖穿走出去,重力填不回来
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const side = bot.blockAt(headPos.offset(dx, 0, dz));
          if (side === null || isSuffocatingFaller(side.name)) continue;
          if (side.boundingBox === 'block' && side.diggable === false) continue;
          const aim = headPos.offset(dx, 0, dz);
          void bot.lookAt(new Vec3(Math.floor(aim.x) + 0.5, Math.floor(aim.y) + 0.5, Math.floor(aim.z) + 0.5), true)
            .catch(() => undefined);
          bot.setControlState('forward', true);
          if (side.boundingBox === 'block') {
            await bot.dig(side, true);
            return;
          }
          // 头层出口已通:脚层那格还实心就把它也挖穿,人才走得出去
          const feetSide = bot.blockAt(bot.entity.position.offset(dx, 0, dz));
          if (feetSide && feetSide.boundingBox === 'block' && feetSide.diggable !== false) {
            await bot.dig(feetSide, true);
          }
          return;
        }
        // 没有可用横向出口时，尝试挖开头部格。
        bot.setControlState('forward', false);
      }
      await bot.dig(head, true);
    } catch {
      // 挖这一下没成(方块已经塌走/够不着):下一拍重读头顶再来,不在这里分诊
    } finally {
      if (this.buried !== null) this.buried.digging = false;
    }
  }

  private fallBot: Bot | null = null;
  private fall: {
    fromY: number;
    logged: boolean;
    /** 已经为这一轮深坠叫停过任务(不论有没有拿到冻结租约),不再重复叫停 */
    handled: boolean;
    /** 队列真被冻住了才为 true:拿不到租约时没有冻结可言,落地也别报"冻结保持" */
    stopped: boolean;
    hold: QueueHoldToken | null;
    holdSince: number;
    safeSince: number | null;
    safeAt: { x: number; y: number; z: number } | null;
    safeInWater: boolean;
  } | null = null;

  /** 深坠落使原路径失效；反射不尝试空中动作，只停止任务与寻路。 */
  private watchFall(bot: Bot): void {
    if (this.fallBot !== bot) {
      this.fallBot = bot;
      this.fall = null;
    }
    const y = bot.entity.position.y;
    const falling = !bot.entity.onGround && (bot.entity.velocity?.y ?? 0) < 0 && !bodyInWater(bot);
    // 半秒内落完的深坠两次心跳之间就着地了:落地这一拍按总落差补判一次
    const landedDeep = !falling && this.fall !== null && !this.fall.handled
      && this.fall.fromY - y >= FALL_TASK_STOP_BLOCKS;
    if (!falling && !landedDeep) {
      if (this.fall?.stopped) {
        if (this.environmentOwnerKind !== null || !safeFallFooting(bot, true)) {
          this.fall.safeSince = null;
          this.fall.safeAt = null;
          return;
        }
        const now = Date.now();
        const p = bot.entity.position;
        const inWater = bodyInWater(bot);
        const moved = this.fall.safeAt === null
          ? Infinity
          : Math.hypot(p.x - this.fall.safeAt.x, p.y - this.fall.safeAt.y, p.z - this.fall.safeAt.z);
        // 水面换气连续成立即可；游动与浮沉不要求身体保持在同一个坐标。
        if (this.fall.safeSince === null || this.fall.safeInWater !== inWater
          || (!inWater && moved > FALL_SAFE_MOVE)) {
          this.fall.safeSince = now;
          this.fall.safeAt = { x: p.x, y: p.y, z: p.z };
          this.fall.safeInWater = inWater;
          return;
        }
        if (now - this.fall.safeSince < FALL_SAFE_FOOTING_MS) return;
        const resumed = this.fall.hold !== null && this.opts.resumeAfterFall(this.fall.hold);
        const recovery = inWater ? '浮在水面且连续换气' : '稳定落脚';
        // 令牌对不上号有两种可能:执行器换了冻结租约,或者 mc_stop/抢占已经把冻结
        // 清掉了。反射这边分不出来,措辞就只说租约失效,不替队列断言还冻着。
        this.opts.diag?.write({
          lane: 'reflex', event: 'falling-safe',
          msg: `深坠落后已在 ${cellText(feetOf(bot))} ${recovery},`
            + (resumed ? '排队计划恢复' : '旧恢复租约已失效'),
          data: { position: bot.entity.position, health: bot.health, resumed },
        });
        if (resumed) {
          this.opts.report({
            kind: 'reflex',
            text: `[反射] 深坠落后已在 ${cellText(feetOf(bot))} ${recovery},深坠那一处队列冻结解除。`,
          });
        }
      }
      this.fall = null;
      return;
    }
    if (this.fall === null) {
      this.fall = {
        fromY: y, logged: false, handled: false, stopped: false,
        hold: null, holdSince: 0, safeSince: null, safeAt: null, safeInWater: false,
      };
      return;
    }
    this.fall.safeSince = null;
    this.fall.safeAt = null;
    if (y > this.fall.fromY) this.fall.fromY = y;
    const drop = this.fall.fromY - y;
    if (!this.fall.logged && drop >= FALL_DAMAGE_BLOCKS) {
      this.fall.logged = true;
      this.opts.diag?.write({
        lane: 'reflex', event: 'falling',
        msg: `正在自由落体,已掉 ${drop.toFixed(1)} 格(生命 ${Math.ceil(bot.health ?? 0)}/20)`,
        data: { fromY: this.fall.fromY, y, drop, health: bot.health, position: bot.entity.position },
      });
    }
    if (this.fall.handled || drop < FALL_TASK_STOP_BLOCKS) return;
    // 目标的数值 y 至少比当前位置低 FALL_TASK_STOP_BLOCKS 时，本轮深坠不撤销寻路。
    // 判据不区分目标类型；GoalFollow 等带数值 y 的目标也可豁免。
    const goal = bot.pathfinder?.goal as { y?: unknown } | undefined;
    if (goal && typeof goal.y === 'number' && goal.y <= y - FALL_TASK_STOP_BLOCKS) {
      this.fall.handled = true; // 这一轮落体不再评估:目的地没变,判据也不会变
      this.opts.diag?.write({
        lane: 'reflex', event: 'falling-en-route',
        msg: `深坠落已掉 ${drop.toFixed(1)} 格,但寻路目标就在下方(y=${goal.y}),原单继续`,
        data: {
          fromY: this.fall.fromY, y, drop, goalY: goal.y,
          health: bot.health, position: bot.entity.position,
        },
      });
      return;
    }
    this.fall.handled = true;
    const hold = this.opts.stopFallTask(`深坠落超过 ${FALL_TASK_STOP_BLOCKS} 格`);
    // 拿不到冻结租约(执行器不在)时队列根本没被冻:不进冻结态,免得落地那一拍
    // 报出"旧恢复租约已失效,当前冻结保持"这种与事实相反的话
    this.fall.hold = hold;
    this.fall.stopped = hold !== null;
    this.fall.holdSince = hold !== null ? Date.now() : 0;
    dropGoal(bot, 'fall', '深坠,原路径的前提已经不成立', this.opts.diag);
    this.opts.diag?.write({
      lane: 'reflex', event: 'falling-stop',
      msg: `深坠落已掉 ${drop.toFixed(1)} 格,原任务与路径已停止`
        + (hold === null ? '(没有可冻结的队列)' : ',排队计划冻结到安全落脚'),
      data: {
        fromY: this.fall.fromY, y, drop, threshold: FALL_TASK_STOP_BLOCKS,
        held: hold !== null, health: bot.health, position: bot.entity.position,
      },
    });
    this.opts.report({
      kind: 'reflex',
      text: `[反射] ${landedDeep ? '深坠落着地' : '正在深坠落'},掉了 ${drop.toFixed(1)} 格,撤掉了正在走的寻路`
        + (hold === null ? '(没有可冻结的队列)。' : ',排着的计划冻结到稳定落脚。')
        + `人在 ${cellText(feetOf(bot))},生命 ${Math.ceil(bot.health ?? 0)}/20。`,
    });
  }

  private drowning = false;
  private lastDrownReportAt = 0;
  private lastDrownEscapeAt = 0;
  private submergedAt = 0;
  private waterTrap: { since: number; x: number; z: number; escalated: boolean } | null = null;
  /** 头在水下时挨了环境伤害的时刻;HURT_UNDERWATER_WINDOW_MS 内算数 */
  private hurtUnderwaterAt = 0;
  /** 危机中头出水的起点;氧气读数不可信时靠它判「已经在换气」 */
  private surfacedAt = 0;
  private lastSubmergedDiagAt = 0;
  /** 死亡后的氧气读数可能停留在旧值；再次观察到 air_supply 变化前视为不可信。 */
  private oxygenTrusted = true;
  private oxygenSeen: number | null = null;
  /** 本轮溺水里零推进撤销过的目标格,登岸/换气点都不再选它;危机解除清空 */
  private readonly drownExcluded = new Set<string>();

  private async antiDrown(bot: Bot): Promise<void> {
    const now = Date.now();
    const headWet = headInWater(bot);
    const rawOxygen = bot.oxygenLevel ?? null;
    if (rawOxygen !== this.oxygenSeen) {
      this.oxygenSeen = rawOxygen;
      // 原版氧气读数 0–20;超出的是没换算的原始刻数(实测 303),同一时刻人已经在溺水掉血,不信它
      this.oxygenTrusted = rawOxygen === null || rawOxygen <= 20;
    }
    const oxygen = Math.max(0, Math.min(20, rawOxygen ?? 20));
    // 已找到的登岸路线保留到干燥落脚；只有换气目标时可在氧气恢复后交还队列。
    if (!headWet) {
      if (hasDryFooting(bot)) this.waterTrap = null;
      if (!this.drowning) {
        this.submergedAt = 0;
        return;
      }
      if (this.surfacedAt === 0) this.surfacedAt = now;
      const dry = hasDryFooting(bot);
      const landing = this.escapeGoal?.kind === 'drown' && this.escapeGoal.drownPhase === 'landing';
      bot.setControlState('jump', !dry && landing);
      const breathing = this.oxygenTrusted ? oxygen >= 15 : now - this.surfacedAt >= SURFACED_CLEAR_MS;
      if (dry || (breathing && !landing)) {
        const why = this.oxygenTrusted ? `氧气回满 ${oxygen}/20` : `已出水 ${Math.round((now - this.surfacedAt) / 1000)} 秒`;
        this.drowning = false;
        this.submergedAt = 0;
        this.surfacedAt = 0;
        this.drownExcluded.clear();
        if (dry) this.waterTrap = null;
        this.opts.diag?.write({
          lane: 'reflex', event: 'drown-clear',
          msg: dry
            ? `离开水体并站稳了(氧气 ${oxygen}/20)`
            : `头出水且${why}(脚下还是水)`,
          data: { oxygen, oxygenTrusted: this.oxygenTrusted, dryFooting: dry, position: bot.entity.position },
        });
        this.opts.report({
          kind: 'reflex',
          text: dry
            ? `[反射] 溺水自救结束:离开水体,在 ${cellText(feetOf(bot))} 站稳了(氧气 ${oxygen}/20)。`
            : `[反射] 溺水自救结束:头出水且${why},脚下还是水,人在 ${cellText(feetOf(bot))}。`,
        });
        // 站稳那条路由 resumeEnvironmentWhenSafe 按稳定窗口交还;水面上没有那个窗口
        if (!dry) this.releaseEnvironmentHoldNow(bot, `头出水且${why}`);
        return;
      }
      if (!this.opts.escapeActive?.()) {
        this.beginEnvironment('防溺水上浮找岸');
        this.routeDrownToLand(bot, now, oxygen);
      }
      return;
    }
    this.surfacedAt = 0;
    if (this.submergedAt === 0) this.submergedAt = now;
    const submergedMs = now - this.submergedAt;
    // 低频记录水下反射的等待原因：入水宽限、氧气充足或读数未刷新。
    if (now - this.lastSubmergedDiagAt >= SUBMERGED_DIAG_MS) {
      this.lastSubmergedDiagAt = now;
      this.opts.diag?.write({
        lane: 'reflex', event: 'drown-submerged',
        msg: `头在水下 ${(submergedMs / 1000).toFixed(1)}s,氧气读数 ${rawOxygen ?? '无'}${this.oxygenTrusted ? '' : '(复活后没刷新,不信)'}${this.drowning ? ',逃生中' : ''}`,
        data: {
          headWet, oxygenLevel: rawOxygen, oxygenTrusted: this.oxygenTrusted,
          submergedMs, drowning: this.drowning, position: bot.entity.position,
        },
      });
    }
    if (!this.drowning) {
      // 头在水下时掉血、周围又没有敌人:氧气已经见底,读数和计时都不必再等
      const hurtUnderwater = now - this.hurtUnderwaterAt < HURT_UNDERWATER_WINDOW_MS;
      // 入水后的前 2 秒忽略氧气读数,等待实体元数据更新。
      if (submergedMs < 2_000 && !hurtUnderwater) return;
      // 氧气读数是主判据;读数不可信或一直不跌时按水下时长兜底(20 口气原版 15 秒耗尽)
      const lowOxygen = this.oxygenTrusted && oxygen <= 6;
      if (!lowOxygen && !hurtUnderwater && submergedMs < SUBMERGED_TRIGGER_MS) return;
      const why = hurtUnderwater
        ? `头在水下、周围没有敌人却在掉血(生命 ${Math.ceil(bot.health ?? 0)}/20,已沉 ${Math.round(submergedMs / 1000)}s)`
        : lowOxygen
        ? `快溺水了(氧气 ${oxygen}/20,已沉 ${Math.round(submergedMs / 1000)}s)`
        : `头在水下已 ${Math.round(submergedMs / 1000)} 秒${this.oxygenTrusted ? `,氧气读数 ${oxygen}/20` : ',氧气读数复活后没刷新'}`;
      this.opts.diag?.write({
        lane: 'reflex', event: 'drown-trigger',
        msg: `${why},开始上浮`,
        data: {
          oxygen, rawOxygen, oxygenTrusted: this.oxygenTrusted, byTimer: !lowOxygen,
          position: bot.entity.position, submergedMs,
        },
      });
      this.drowning = true;
      this.drownExcluded.clear();
      this.drownRouteTold = null;
      if (now - this.lastDrownReportAt > 20_000) {
        this.lastDrownReportAt = now;
        this.opts.report({ kind: 'reflex', hurt: true, text: `[反射] ${why},正在上浮找岸。` });
      }
    }
    // 持续上浮,并每 8s 尝试给寻路器一个换气点或登岸点
    bot.setControlState('jump', true);
    // surface 任务持有寻路目标时，反射只保留上浮按键，避免双方覆盖目标。
    if (this.opts.escapeActive?.()) return;
    this.beginEnvironment('防溺水上浮找岸');
    this.routeDrownToLand(bot, now, oxygen);
  }

  /**
   * 两级目标:自己这一列头顶被实心盖住时先游到头顶是空气的水面格换气,再找登岸点;
   * 两级都排除本轮零推进过的格,登岸点还要求头高那一层到它之间没有实心阻隔。
   */
  private routeDrownToLand(bot: Bot, now: number, oxygen: number): void {
    if (now - this.lastDrownEscapeAt <= 8_000) return;
    this.lastDrownEscapeAt = now;
    const up = landSearchUp(bot);
    const excluded = (c: Cell): boolean => this.drownExcluded.has(cellKeyOf(c));
    const breath = findBreathingCell(bot, BREATH_SEARCH_R, up, excluded);
    if (breath) {
      this.opts.diag?.write({
        lane: 'reflex', event: 'drown-breath',
        msg: `头顶被盖住,先游到 (${breath.x}, ${breath.y}, ${breath.z}) 的水面换气`,
        data: { breath, position: bot.entity.position, oxygen, excluded: [...this.drownExcluded] },
      });
      this.setEscapeGoal(bot, 'drown', new goals.GoalBlock(breath.x, breath.y, breath.z), breath, 'breathing');
      this.tellDrownRoute(
        `breath:${cellKeyOf(breath)}`,
        `[反射] 溺水自救:头顶被盖住,反射接管寻路,先游到 ${cellText(breath)} 的水面换气(氧气 ${oxygen}/20)。`,
      );
      return;
    }
    const land = findNearbyAirColumn(bot, 12, up, excluded);
    if (land) this.waterTrap = null;
    else this.noteWaterTrap(bot, now);
    // 诊断区分朝岸移动与原地上浮,以检测横向位置没有进展的逃生循环。
    this.opts.diag?.write({
      lane: 'reflex', event: land ? 'drown-swim' : 'drown-noland',
      msg: land
        ? `往 (${land.x}, ${land.y}, ${land.z}) 的登岸点游`
        : '附近找不到能上去的岸,只能继续上浮换气',
      data: { land, position: bot.entity.position, oxygen, excluded: [...this.drownExcluded] },
    });
    if (land) {
      this.setEscapeGoal(bot, 'drown', new goals.GoalBlock(land.x, land.y, land.z), land, 'landing');
    }
    this.tellDrownRoute(
      land ? `land:${cellKeyOf(land)}` : 'noland',
      land
        ? `[反射] 溺水自救:反射接管寻路,往 ${cellText(land)} 的登岸点游(氧气 ${oxygen}/20)。`
        : `[反射] 溺水自救:附近 12 格找不到能上去的岸,只按着跳往上浮换气(氧气 ${oxygen}/20)。`,
    );
  }

  /** 这一轮溺水里上一次报给 bot 的去向;每 8 秒重找一次岸,去向没变就不重复报 */
  private drownRouteTold: string | null = null;

  private tellDrownRoute(key: string, text: string): void {
    if (this.drownRouteTold === key) return;
    this.drownRouteTold = key;
    this.opts.report({ kind: 'reflex', text });
  }

  private noteWaterTrap(bot: Bot, now: number): void {
    const p = bot.entity.position;
    const prior = this.waterTrap;
    if (!prior || Math.hypot(p.x - prior.x, p.z - prior.z) >= WATER_TRAP_MOVE) {
      this.waterTrap = { since: now, x: p.x, z: p.z, escalated: false };
      return;
    }
    if (prior.escalated || now - prior.since < WATER_TRAP_MS) return;
    prior.escalated = true;
    this.opts.diag?.write({
      lane: 'reflex', event: 'drown-trap', incident: true,
      msg: `持续找不到岸且水平未推进，人在 (${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)})`,
      data: { since: prior.since, position: p },
    });
    this.opts.report({ kind: 'reflex', hurt: true,
      text: '[反射] 水里持续找不到岸，水平位置也没推进，正在尝试已登记的安全落点。' });
    this.opts.onWaterTrap?.();
  }

  private async onHurt(
    bot: Bot,
    evidence: DamageEvidence,
  ): Promise<void> {
    const now = Date.now();
    const actor = evidence.actor;
    if (!actor) {
      this.onEnvironmentHurt(bot, now, evidence);
      // A known projectile without a loaded owner is still a real impact. A bounded
      // low-health dodge uses its direction, never a nearby mob's guessed identity.
      if ((evidence.projectile || evidence.directId !== null) && evidence.sourcePosition
        && (bot.health ?? 20) < this.opts.fleeHealth()
        && !this.opts.escapeActive?.() && !this.busyFighting
        && now - this.lastHurtReactAt >= this.opts.reactCooldownSec() * 1000) {
        const from = evidence.sourcePosition;
        const dx = bot.entity.position.x - from.x;
        const dz = bot.entity.position.z - from.z;
        const length = Math.hypot(dx, dz);
        if (length > 0.1) {
          this.lastHurtReactAt = now;
          this.opts.onLowHealth?.(bot);
          this.opts.preempt('低血受到外来伤害,来源尚未确定');
          this.setEscapeGoal(bot, 'flee', levelTravelGoal(
            bot.entity.position.x + dx / length * 8, bot.entity.position.z + dz / length * 8));
          this.opts.report({ kind: 'reflex', hurt: true,
            text: '[反射] 低血受到外来伤害,尚未确认攻击者,先离开命中方向。' });
        }
      }
      return;
    }
    const attacker = actor.entity;
    this.opts.diag?.write({ lane: 'reflex', event: 'damage-source',
      msg: `${evidence.origin === 'packet' ? '原始伤害包' : '实体受击事件'}的来源绑定实体 ${actor.id} (${actor.name})`,
      data: { origin: evidence.origin, sequence: evidence.sequence, sourceType: evidence.sourceType,
        causeId: evidence.causeId, directId: evidence.directId,
        loaded: !!attacker?.isValid, attacker: actor.name, health: bot.health } });
    // 战斗会话在场就归它:反击、血线撤退、退出闸门都是它的(反射这套 10 秒挥两下
    // 保留为 combat.enabled 关掉时的降级行为)
    if (this.opts.combatHurt?.(actor.id, actor.name)) return;
    const bleedingOut = (bot.health ?? 20) < this.opts.fleeHealth();
    if (!this.opts.fightBack() && !bleedingOut) return;
    // Identity is not visibility or reachability: the degraded melee loop never
    // attacks a stale entity or aims through a solid obstruction.
    if (!attacker?.isValid || bot.entities[actor.id] !== attacker
      || (!bleedingOut && !canSeeEntity(bot, attacker))) {
      this.onEnvironmentHurt(bot, now, evidence);
      return;
    }
    const distance = attacker.position.distanceTo(bot.entity.position);
    // 撤退阈值独立于反击开关;关闭反击只禁止攻击,不禁止逃逸。
    if (this.opts.escapeActive?.()) return; // 已有逃逸路径时不叠加反击或直线逃逸。
    if (this.busyFighting || now - this.lastHurtReactAt < this.opts.reactCooldownSec() * 1000) return;
    this.lastHurtReactAt = now;
    this.busyFighting = true;
    this.opts.diag?.write({
      lane: 'reflex', event: 'hurt',
      msg: `被${zhEntity(attacker.name ?? '?')}打到,生命 ${Math.ceil(bot.health ?? 0)}/20`,
      data: { attacker: attacker.name, distance: Number(distance.toFixed(1)), health: bot.health, bleedingOut },
    });
    try {
      if ((bot.health ?? 20) < this.opts.fleeHealth()) {
        // 血少:脱离
        this.opts.onLowHealth?.(bot);
        this.opts.preempt('血量过低,脱离战斗');
        const away = bot.entity.position.minus(attacker.position).normalize().scaled(16);
        const dest = bot.entity.position.plus(away);
        this.setEscapeGoal(bot, 'flee', levelTravelGoal(dest.x, dest.z));
        this.opts.report({
          kind: 'reflex',
          hurt: true,
          text: `[反射] 被 ${attacker.name} 打到只剩 ${Math.ceil(bot.health)}/20 血,正在脱离战斗!`,
          });
      } else {
        const weapon = bestWeapon(bot);
        if (weapon) await bot.equip(weapon, 'hand').catch(() => undefined);
        const deadline = Date.now() + 10_000;
        let swings = 0;
        let lastSwing = 0;
        let strafeLeft = false;
        let strafeAt = 0;
        try {
          while (attacker.isValid && Date.now() < deadline && !this.stopped) {
            if ((bot.health ?? 0) <= 0) break; // 人都死了,别再对着空气挥
            if (this.opts.getBot() !== bot || !canSeeEntity(bot, attacker)) break;
            const d = attacker.position.distanceTo(bot.entity.position);
            if (d > 3.5) break; // 它跑了/被打退,不追:追击是主脑的决策,不归反射
            if (Date.now() >= strafeAt) {
              strafeLeft = !strafeLeft;
              strafeAt = Date.now() + STRAFE_MS;
            }
            await aimAt(bot, attacker);
            pressMelee(bot, attacker, strafeLeft);
            if (d <= MELEE_REACH && Date.now() - lastSwing >= attackCooldownMs(bot)) {
              await meleeSwing(bot, attacker);
              swings++;
              lastSwing = Date.now();
            } else {
              await new Promise((r) => setTimeout(r, 50));
            }
          }
        } finally {
          releaseMelee(bot);
        }
        this.opts.report({
          kind: 'reflex',
          hurt: true,
          text: `[反射] 被 ${attacker.name} 攻击,反击了 ${swings} 下${attacker.isValid ? ',它还活着' : ',击杀了它'}。生命 ${Math.ceil(bot.health)}/20。`,
          });
      }
    } finally {
      this.busyFighting = false;
    }
  }
}

/** 找岸往上看几格的硬上限:再高的水柱不是「快淹死了」,是掉进了海沟 */
const LAND_SEARCH_UP_CAP = 24;

/** 登岸搜索的垂直范围按当前位置上方水柱高度确定，限制在 3–24 格。 */
function landSearchUp(bot: Bot): number {
  const base = bot.entity.position.floored();
  for (let dy = 0; dy <= LAND_SEARCH_UP_CAP; dy += 1) {
    const b = bot.blockAt(base.offset(0, dy, 0));
    if (!b || !LIQUIDS.has(b.name)) return Math.max(3, dy);
  }
  return LAND_SEARCH_UP_CAP;
}

/** 换气点的水平搜索半径:氧气 6→0 只有 6 秒,游得到的距离就这么远 */
const BREATH_SEARCH_R = 6;
/** 水下计时兜底:头在水下连续这么久就按溺水处理,不看氧气读数 */
const SUBMERGED_TRIGGER_MS = 10_000;
/**
 * 头在水下挨环境伤害之后这么久内都算「正在淹」。原版溺水伤害每秒一下,
 * 2 秒盖住两次心跳之间的空档,再长就会把早先一次无关的伤害算进来。
 */
const HURT_UNDERWATER_WINDOW_MS = 2_000;
/** 氧气读数不可信时,头出水连续这么久算已换到气 */
const SURFACED_CLEAR_MS = 3_000;
const SUBMERGED_DIAG_MS = 2_000;

/** 从自己这一列到目标列的水平直线上,y 这一层有没有实心方块;每半格采样,起止列的格由调用方验 */
function rowClear(bot: Bot, from: Cell, toX: number, toZ: number, y: number): boolean {
  const dx = toX - from.x;
  const dz = toZ - from.z;
  const steps = Math.ceil(Math.hypot(dx, dz) * 2);
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (solidAt(bot, { x: Math.floor(from.x + 0.5 + dx * t), y, z: Math.floor(from.z + 0.5 + dz * t) })) return false;
  }
  return true;
}

/**
 * 登岸路线先沿当前列上浮到目标头高，再水平直行。
 * 上浮段检查头部经过的各格，水平段检查脚、头两层的实心阻隔。
 */
function reachableFromWater(bot: Bot, me: Cell, to: Cell): boolean {
  const headY = to.y + 1;
  for (let y = Math.min(me.y + 1, headY); y <= Math.max(me.y + 1, headY); y += 1) {
    if (solidAt(bot, { x: me.x, y, z: me.z })) return false;
  }
  return rowClear(bot, me, to.x, to.z, headY) && rowClear(bot, me, to.x, to.z, to.y);
}

/**
 * 同一水体里头顶是空气的水面格,按环由近及远;返回的是脚该到的那一格(头在它上方的空气里)。
 * 自己这一列头顶就通(按住跳就能换气)时返回 null。「同一水体」按头高那一层的直线全是水判。
 */
function findBreathingCell(
  bot: Bot, maxR: number, maxUp: number, excluded: (c: Cell) => boolean,
): Cell | null {
  const base = bot.entity.position.floored();
  const me: Cell = { x: base.x, y: base.y, z: base.z };
  /** 该列从头高往上第一格非水的 y;水一直到 maxUp 之外返回 null */
  const surfaceOf = (dx: number, dz: number): number | null => {
    for (let dy = 1; dy <= maxUp + 1; dy += 1) {
      const b = bot.blockAt(base.offset(dx, dy, dz));
      if (!b || !WATER_BLOCKS.has(b.name)) return dy === 1 ? null : base.y + dy;
    }
    return null;
  };
  const open = (y: number, dx: number, dz: number): boolean => {
    const b = bot.blockAt(base.offset(dx, y - base.y, dz));
    return b !== null && b.name === 'air';
  };
  const own = surfaceOf(0, 0);
  if (own !== null && open(own, 0, 0)) return null;
  for (let r = 1; r <= maxR; r += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const y = surfaceOf(dx, dz);
        if (y === null || !open(y, dx, dz)) continue;
        const feet: Cell = { x: base.x + dx, y: y - 1, z: base.z + dz };
        if (excluded(feet)) continue;
        // 头高那一层直线全是水:隔着岸壁的另一片水过不了这一关
        if (!rowClear(bot, me, feet.x, feet.z, me.y + 1)) continue;
        return feet;
      }
    }
  }
  return null;
}

/**
 * 寻找最近的可站立登岸点；脚下有支撑、脚头不在水中且路线无实心阻隔。
 * maxUp 由实测水柱确定，搜索从半径一格逐圈扩展；找不到返回 null。
 */
function findNearbyAirColumn(
  bot: Bot, maxR = 12, maxUp = 3, excluded: (c: Cell) => boolean = () => false,
): { x: number; y: number; z: number } | null {
  const base = bot.entity.position.floored();
  const me: Cell = { x: base.x, y: base.y, z: base.z };
  for (let r = 1; r <= maxR; r += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (let dy = maxUp; dy >= -1; dy--) {
          const feet = base.offset(dx, dy, dz);
          const below = bot.blockAt(feet.offset(0, -1, 0));
          const at = bot.blockAt(feet);
          const head = bot.blockAt(feet.offset(0, 1, 0));
          if (!below || !at || !head) continue;
          if (below.boundingBox !== 'block' || at.name !== 'air' || head.name !== 'air') continue;
          const cell: Cell = { x: feet.x, y: feet.y, z: feet.z };
          if (excluded(cell) || !reachableFromWater(bot, me, cell)) continue;
          return cell;
        }
      }
    }
  }
  return null;
}
