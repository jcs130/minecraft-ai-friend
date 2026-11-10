import type { Bot, ControlState } from 'mineflayer';
import { Vec3 } from 'vec3';
import { canSeeBlockAt, canSeeEntity } from './terrain.ts';
import type { IdleBehaviorCandidate } from './idle-behavior.ts';
import { spatialBody } from './spatial-site.ts';

/** Protocol poses and local viewer previews available while the caller owns the body. */
export const IDLE_ACTIONS = [
  { id: 'look_left', label: '向左看一眼', category: 'look' },
  { id: 'look_right', label: '向右看一眼', category: 'look' },
  { id: 'scan', label: '左右环顾', category: 'look' },
  { id: 'over_shoulder', label: '回头看看', category: 'look' },
  { id: 'look_sky', label: '抬头看天空', category: 'look' },
  { id: 'look_horizon', label: '看看远处', category: 'look' },
  { id: 'look_ground', label: '看看脚下', category: 'look' },
  { id: 'look_hand', label: '看看手中物品', category: 'look' },
  { id: 'look_player', label: '看看附近玩家', category: 'target' },
  { id: 'look_villager', label: '看看附近村民', category: 'target' },
  { id: 'look_animal', label: '看看附近动物', category: 'target' },
  { id: 'look_item', label: '看看附近掉落物', category: 'target' },
  { id: 'look_tree', label: '看看树冠', category: 'target' },
  { id: 'look_flower', label: '看看花', category: 'target' },
  { id: 'look_water', label: '看看水面', category: 'target' },
  { id: 'look_entrance', label: '看看门口', category: 'target' },
  { id: 'crouch', label: '短暂蹲下', category: 'pose' },
  { id: 'crouch_twice', label: '轻轻蹲两下', category: 'pose' },
  { id: 'nod', label: '点点头', category: 'pose' },
  { id: 'nod_twice', label: '轻轻点两下头', category: 'pose' },
  { id: 'shake_head', label: '轻轻摇头', category: 'pose' },
  { id: 'wave', label: '空手挥一下', category: 'pose' },
  { id: 'wave_twice', label: '空手挥两下', category: 'pose' },
  { id: 'inventory_preview', label: '短暂查看背包', category: 'interface' },
  { id: 'wander', label: '在已核验的平地闲逛两三步', category: 'move' },
  { id: 'short_walk', label: '沿眼前平地走一小步', category: 'move' },
] as const;

export type IdleActionId = typeof IDLE_ACTIONS[number]['id'];
type Point = { x: number; y: number; z: number };
interface Target { point: Point; entityId?: number; playerName?: string; block?: { position: Point; name: string } }
interface SceneState extends Record<string, unknown> {
  origin: Point;
  targets: Partial<Record<IdleActionId, Target>>;
  movement?: { origin: Point; destination: Point };
  wander?: { origin: Point; destination: Point };
}

const ANIMALS = new Set(['allay', 'armadillo', 'axolotl', 'bat', 'bee', 'camel', 'cat', 'chicken',
  'cod', 'cow', 'dolphin', 'donkey', 'fox', 'frog', 'glow_squid', 'goat', 'horse', 'llama',
  'mooshroom', 'mule', 'ocelot', 'panda', 'parrot', 'pig', 'polar_bear', 'pufferfish', 'rabbit',
  'salmon', 'sheep', 'sniffer', 'squid', 'strider', 'tadpole', 'trader_llama', 'tropical_fish', 'turtle', 'wolf']);
const FLOWERS = new Set(['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip',
  'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley',
  'sunflower', 'lilac', 'rose_bush', 'peony', 'torchflower', 'pink_petals']);
const UNSAFE = new Set(['water', 'lava', 'bubble_column', 'fire', 'soul_fire', 'magma_block',
  'cactus', 'sweet_berry_bush', 'powder_snow', 'cobweb', 'campfire', 'soul_campfire']);
const FRAME_MS = 50;
const TURN_PEAK_SPEED = 3.6;
const MIN_TURN_MS = 150;
const point = (p: Point): Point => ({ x: p.x, y: p.y, z: p.z });
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const yawDelta = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));

function eye(bot: Bot): Vec3 {
  const height = (bot.entity as Bot['entity'] & { eyeHeight?: number }).eyeHeight ?? 1.62;
  return bot.entity.position.offset(0, height, 0);
}

export function loadedSight(bot: Bot, to: Point): boolean {
  if (typeof bot.blockAt !== 'function' || typeof bot.world?.raycast !== 'function') return false;
  const from = eye(bot);
  const length = distance(from, to);
  const steps = Math.max(1, Math.ceil(length * 2));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!bot.blockAt(new Vec3(from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t))) return false;
  }
  return true;
}

function visibleEntity(bot: Bot, entity: Bot['entity']): boolean {
  if (entity.isValid === false || entity.id === bot.entity.id || distance(bot.entity.position, entity.position) > 8) return false;
  const target = entity.position.offset(0, (entity.height ?? 1) * 0.5, 0);
  return loadedSight(bot, target) && canSeeEntity(bot, entity);
}

function blockAction(name: string): IdleActionId | null {
  if (name.endsWith('_leaves')) return 'look_tree';
  if (FLOWERS.has(name)) return 'look_flower';
  if (name === 'water') return 'look_water';
  if (name.endsWith('_door') && !name.endsWith('_trapdoor')) return 'look_entrance';
  return null;
}

export function corridorSafe(bot: Bot, from: Point, to: Point): boolean {
  if (!bot.entity.onGround || Math.abs(from.y - Math.round(from.y)) > 0.04
    || Math.abs(to.y - from.y) > 0.01) return false;
  const length = distance(from, to);
  if (length < 0.5 || length > 1.6) return false;
  // A fence's occupied cell is not its entire collision volume. Use the same
  // unrounded 0.6 x 1.8 body and protruding-shape reads as short combat motion.
  // Cache only for this validation; the next control tick reads fresh blocks.
  type Cell = [number, number, number];
  type Sample = ReturnType<Parameters<typeof spatialBody>[0]>;
  const cache = new Map<string, Sample>(), unsafe: Cell[] = [];
  const read = (cell: Cell): Sample => {
    const key = cell.join(',');
    const previous = cache.get(key); if (previous) return previous;
    const block = bot.blockAt(new Vec3(...cell), false);
    const properties = block?.getProperties?.() ?? null;
    if (block && (UNSAFE.has(block.name) || properties?.waterlogged === true || properties?.waterlogged === 'true')) unsafe.push(cell);
    const sample: Sample = block ? { material: {
      name: block.name, properties,
      collision: block.shapes?.map(shape => [...shape] as [number, number, number, number, number, number]) ?? null,
      liquid: ['water', 'lava', 'bubble_column'].includes(block.name),
    } } : { unknown: 'unloaded' };
    cache.set(key, sample); return sample;
  };
  const steps = Math.ceil((length + 0.35) * 5);
  let previous: Cell = [from.x, from.y, from.z];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps * (1 + 0.35 / length);
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    const current: Cell = [x, from.y, z], body = spatialBody(read, previous, current);
    if (body.unknown || body.collision || body.water || body.hazard || !body.supported) return false;
    // Preserve dry/hazard restrictions including cobweb, lit campfire and
    // waterlogged support, whose collision shape alone cannot certify safety.
    if (unsafe.some(cell => cell[0] < Math.max(previous[0], x) + .3 && cell[0] + 1 > Math.min(previous[0], x) - .3
      && cell[1] < from.y + 1.8 && cell[1] + 1 > from.y - .05
      && cell[2] < Math.max(previous[2], z) + .3 && cell[2] + 1 > Math.min(previous[2], z) - .3)) return false;
    previous = current;
  }
  return true;
}

/** Bounded known-ground stroll; never digs, places, jumps, trades or enters unknown terrain. */
export function wanderSafe(bot: Bot, from: Point, to: Point): boolean {
  if (distance(from, to) > 2.5) return false;
  const middle = { x: (from.x + to.x) / 2, y: from.y, z: (from.z + to.z) / 2 };
  return corridorSafe(bot, from, middle) && corridorSafe(bot, middle, to);
}

/** Targets contain only loaded observations; unavailable actions are absent from candidates. */
export function sampleIdleActions(bot: Bot, options: {
  allowMovement: boolean; preferredPlayer?: string; ignorePlayer?: (name: string) => boolean;
}): {
  state: Record<string, unknown>; candidates: IdleBehaviorCandidate[];
} {
  const state: SceneState = {
    origin: point(bot.entity.position), yaw: bot.entity.yaw, pitch: bot.entity.pitch,
    onGround: bot.entity.onGround, heldItem: bot.heldItem?.name ?? null,
    health: bot.health, food: bot.food, targets: {},
  };
  const allowed = new Set<IdleActionId>(IDLE_ACTIONS.filter(a => a.category === 'look'
    || a.category === 'pose').map(a => a.id));
  if (!bot.heldItem) allowed.delete('look_hand');
  else { allowed.delete('wave'); allowed.delete('wave_twice'); }
  if (bot.getControlState('sneak')) { allowed.delete('crouch'); allowed.delete('crouch_twice'); }
  if (!bot.currentWindow) allowed.add('inventory_preview');

  const entities = Object.values(bot.entities ?? {}).filter(e => visibleEntity(bot, e)
    && !(e.type === 'player' && e.username && options.ignorePlayer?.(e.username)))
    .sort((a, b) => Number(b.type === 'player' && b.username === options.preferredPlayer)
      - Number(a.type === 'player' && a.username === options.preferredPlayer)
      || distance(bot.entity.position, a.position) - distance(bot.entity.position, b.position));
  for (const entity of entities) {
    const id: IdleActionId | null = entity.type === 'player' ? 'look_player'
      : entity.name === 'villager' || entity.name === 'wandering_trader' ? 'look_villager'
        : ANIMALS.has(entity.name ?? '') ? 'look_animal' : entity.name === 'item' ? 'look_item' : null;
    if (!id || state.targets[id]) continue;
    state.targets[id] = { entityId: entity.id, ...(entity.username ? { playerName: entity.username } : {}),
      point: point(entity.position.offset(0, (entity.height ?? 1) * 0.5, 0)) };
    allowed.add(id);
  }
  if (typeof bot.findBlocks === 'function' && typeof bot.canSeeBlock === 'function') {
    const blocks = bot.findBlocks({ matching: b => blockAction(b.name) !== null, maxDistance: 6, count: 48 });
    for (const position of blocks) {
      const block = bot.blockAt(position);
      const id = block && blockAction(block.name);
      const target = position.offset(0.5, 0.5, 0.5);
      if (!block || !id || state.targets[id] || !loadedSight(bot, target) || !canSeeBlockAt(bot, position)) continue;
      state.targets[id] = { point: point(target), block: { position: point(position), name: block.name } };
      allowed.add(id);
    }
  }
  if (options.allowMovement && !bot.currentWindow && !bot.getControlState('sneak')
    && !(['forward', 'back', 'left', 'right', 'jump', 'sprint'] as ControlState[]).some(key => bot.getControlState(key))) {
    const origin = state.origin;
    const destination = { x: origin.x - Math.sin(bot.entity.yaw) * 1.2,
      y: origin.y, z: origin.z - Math.cos(bot.entity.yaw) * 1.2 };
    if (corridorSafe(bot, origin, destination)) {
      state.movement = { origin, destination };
      allowed.add('short_walk');
    }
    for (const angle of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const yaw = bot.entity.yaw + angle;
      const to = { x: origin.x - Math.sin(yaw) * 2.4, y: origin.y, z: origin.z - Math.cos(yaw) * 2.4 };
      if (wanderSafe(bot, origin, to)) { state.wander = { origin, destination: to }; allowed.add('wander'); break; }
    }
  }
  return { state, candidates: IDLE_ACTIONS.filter(action => allowed.has(action.id)).map(({ id, label }) => {
    const target = state.targets[id];
    const subjectKey = target?.entityId !== undefined ? `entity:${target.entityId}` : target?.block
      ? `block:${target.block.name}:${target.block.position.x},${target.block.position.y},${target.block.position.z}` : undefined;
    return { id, label: target?.playerName ? `${label}（${target.playerName}）` : label,
      ...(subjectKey ? { subjectKey } : {}) };
  }) };
}

export interface IdleActionHost {
  /** Abort the signal synchronously before transferring the body to another owner. */
  available(): boolean;
  inventoryPreview(open: boolean): void;
}

/** Aborting releases owned controls synchronously and never restores the old direction. */
export async function executeIdleAction(bot: Bot, id: string, sceneState: Record<string, unknown>,
  signal: AbortSignal, host: IdleActionHost): Promise<void> {
  const owned = new Set<ControlState>();
  let previewOpen = false;
  const interrupted = (): Error => new DOMException('Idle action interrupted', 'AbortError');
  const clean = (): void => {
    for (const key of owned) bot.setControlState(key, false);
    owned.clear();
    if (previewOpen) { previewOpen = false; host.inventoryPreview(false); }
  };
  const check = (): void => {
    if (signal.aborted || !host.available()) throw interrupted();
  };
  const wait = (ms: number): Promise<void> => new Promise((resolve, reject) => {
    check();
    const abort = (): void => { clearTimeout(timer); reject(interrupted()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
  const pause = async (ms: number): Promise<void> => {
    for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) { check(); await wait(Math.min(FRAME_MS, ms - elapsed)); }
    check();
  };
  const turn = async (yaw: number, pitch: number): Promise<void> => {
    check();
    const fromYaw = bot.entity.yaw;
    const fromPitch = bot.entity.pitch;
    const dy = yawDelta(fromYaw, yaw);
    const dp = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch)) - fromPitch;
    const angle = Math.max(Math.abs(dy), Math.abs(dp));
    if (angle < 0.001) return;
    // Cubic easing has a peak derivative of 1.5. Its duration keeps angular
    // speed bounded while starting and finishing each glance at rest.
    const durationMs = Math.max(MIN_TURN_MS,
      Math.ceil(1.5 * angle / TURN_PEAK_SPEED * 1000 / FRAME_MS) * FRAME_MS);
    const startedAtMs = Date.now();
    let nextAtMs = startedAtMs + FRAME_MS;
    for (;;) {
      const remainingMs = nextAtMs - Date.now();
      if (remainingMs > 0) await wait(remainingMs);
      check();
      const progress = Math.min(1, (Date.now() - startedAtMs) / durationMs);
      const eased = progress * progress * (3 - 2 * progress);
      await bot.look(fromYaw + dy * eased, fromPitch + dp * eased, true);
      if (progress === 1) break;
      nextAtMs = Math.min(startedAtMs + durationMs, Date.now() + FRAME_MS);
    }
    check();
  };
  const enable = (key: ControlState): void => {
    check();
    if (!bot.getControlState(key)) { owned.add(key); bot.setControlState(key, true); }
  };
  const release = (key: ControlState): void => {
    check();
    if (owned.delete(key)) bot.setControlState(key, false);
  };
  check();
  if (!IDLE_ACTIONS.some(action => action.id === id)) throw new Error(`Unknown idle action: ${id}`);
  const original = { yaw: bot.entity.yaw, pitch: bot.entity.pitch };
  signal.addEventListener('abort', clean, { once: true });
  try {
    if (id === 'inventory_preview') {
      if (bot.currentWindow) return;
      previewOpen = true;
      host.inventoryPreview(true);
      for (let i = 0; i < 36; i++) {
        check();
        if (bot.currentWindow) return;
        await wait(FRAME_MS);
      }
      return;
    }
    if (id === 'wander') {
      const movement = (sceneState as SceneState).wander;
      if (!movement || distance(bot.entity.position, movement.origin) > 0.2
        || !wanderSafe(bot, movement.origin, movement.destination)) return;
      const yaw = Math.atan2(-(movement.destination.x - movement.origin.x), -(movement.destination.z - movement.origin.z));
      await turn(yaw, original.pitch);
      for (let i = 0; i < 30; i++) {
        check();
        const here = bot.entity.position, remaining = distance(here, movement.destination);
        if (remaining < 0.25 || distance(here, movement.origin) > 2.5 || Math.abs(yawDelta(bot.entity.yaw, yaw)) > 0.08) break;
        const ahead = { x: here.x - Math.sin(yaw), y: here.y, z: here.z - Math.cos(yaw) };
        if (!corridorSafe(bot, here, ahead)) break;
        enable('forward'); await wait(FRAME_MS);
      }
      release('forward'); return;
    }
    if (id === 'short_walk') {
      const movement = (sceneState as SceneState).movement;
      if (!movement || distance(bot.entity.position, movement.origin) > 0.2
        || !corridorSafe(bot, movement.origin, movement.destination)) return;
      for (let i = 0; i < 14; i++) {
        check();
        const here = bot.entity.position;
        if (distance(here, movement.origin) >= 1.1 || !corridorSafe(bot, movement.origin, movement.destination)) break;
        const remaining = distance(here, movement.destination);
        if (remaining < 0.22 || Math.abs(yawDelta(bot.entity.yaw, original.yaw)) > 0.08) break;
        enable('forward');
        await wait(FRAME_MS);
      }
      release('forward');
      return;
    }
    if (id === 'crouch' || id === 'crouch_twice') {
      if (bot.getControlState('sneak')) return;
      for (let i = 0; i < (id === 'crouch_twice' ? 2 : 1); i++) {
        enable('sneak'); await pause(400); release('sneak'); await pause(220);
      }
    } else if (id === 'wave' || id === 'wave_twice') {
      if (bot.heldItem) return;
      for (let i = 0; i < (id === 'wave_twice' ? 2 : 1); i++) {
        check();
        if (bot.heldItem) break;
        bot.swingArm('right');
        await pause(420);
      }
    } else if (id === 'nod' || id === 'nod_twice') {
      for (let i = 0; i < (id === 'nod_twice' ? 2 : 1); i++) {
        await turn(original.yaw, original.pitch - 0.2); await pause(120);
        await turn(original.yaw, original.pitch); await pause(180);
      }
    } else if (id === 'shake_head' || id === 'scan') {
      const angle = id === 'scan' ? 0.65 : 0.23;
      const holdMs = id === 'scan' ? 500 : 100;
      await turn(original.yaw + angle, original.pitch); await pause(holdMs);
      await turn(original.yaw - angle, original.pitch); await pause(holdMs);
    } else {
      let yaw = original.yaw;
      let pitch = original.pitch;
      const offsets: Record<string, [number, number]> = {
        look_left: [0.55, 0], look_right: [-0.55, 0], over_shoulder: [1.6, 0],
        look_sky: [0, 0.95 - pitch], look_horizon: [0, -pitch],
        look_ground: [0, -0.82 - pitch], look_hand: [0, -0.58 - pitch],
      };
      if (offsets[id]) { yaw += offsets[id][0]; pitch += offsets[id][1]; }
      else {
        const target = (sceneState as SceneState).targets?.[id as IdleActionId];
        if (!target) return;
        let aim = target.point;
        if (target.entityId !== undefined) {
          const entity = bot.entities[target.entityId];
          if (!entity || !visibleEntity(bot, entity)) return;
          aim = entity.position.offset(0, (entity.height ?? 1) * 0.5, 0);
        } else if (target.block) {
          const block = bot.blockAt(new Vec3(target.block.position.x, target.block.position.y, target.block.position.z));
          if (!block || block.name !== target.block.name || !loadedSight(bot, aim)
            || !canSeeBlockAt(bot, target.block.position)) return;
        }
        const from = eye(bot);
        yaw = Math.atan2(-(aim.x - from.x), -(aim.z - from.z));
        pitch = Math.atan2(aim.y - from.y, Math.hypot(aim.x - from.x, aim.z - from.z));
      }
      await turn(yaw, pitch); await pause(500);
    }
    await turn(original.yaw, original.pitch);
  } finally {
    signal.removeEventListener('abort', clean);
    // A failed terrain/availability check also has to release held controls.
    // Owner changes abort synchronously and empty `owned`, so a late finally
    // cannot release the next owner's controls.
    clean();
  }
}
