import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import pathfinderPkg, { Movements } from 'mineflayer-pathfinder';
import AStar from 'mineflayer-pathfinder/lib/astar.js';
import Move from 'mineflayer-pathfinder/lib/move.js';
import {
  installPathfinderPerf, setNoPlaceCells, setSiteZones, type SiteZone,
} from '../core/pathfinder-perf.ts';

const { goals } = pathfinderPkg as unknown as { goals: { GoalNear: new (...a: number[]) => unknown } };

const req = createRequire(createRequire(import.meta.url).resolve('mineflayer/package.json'));
const registry = req('prismarine-registry')('1.20.6');
const World = req('prismarine-world')(registry);
const Chunk = req('prismarine-chunk')(registry);
const { Vec3 } = req('vec3');

const STONE = registry.blocksByName.stone.defaultState as number;
const GRASS = registry.blocksByName.grass_block.defaultState as number;
const SLAB = registry.blocksByName.oak_slab.defaultState as number;
const WATER = registry.blocksByName.water.defaultState as number;
const Block = req('prismarine-block')(registry);

function doorState(half: 'lower' | 'upper', open: boolean): number {
  const door = registry.blocksByName.spruce_door;
  for (let id = door.minStateId; id <= door.maxStateId; id++) {
    const p = Block.fromStateId(id, 0).getProperties();
    if (p.half === half && p.open === open) return id;
  }
  throw new Error('1.20.6 spruce_door state missing');
}

/** 16x16 平地 y=63 封顶,(x=8) 立一堵 3 格高石墙:走/挖都有戏。
 *  掺半砖(状态级高度 0.5)与水(液体位),给特征表上语义压力。 */
function makeWorld() {
  const world = new World(null).sync;
  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) world.setColumn(cx, cz, new Chunk({ minY: -64, worldHeight: 384 }));
  }
  for (let x = -8; x < 16; x++) {
    for (let z = -8; z < 16; z++) {
      for (let y = 56; y < 63; y++) world.setBlockStateId(new Vec3(x, y, z), STONE);
      world.setBlockStateId(new Vec3(x, 63, z), GRASS);
    }
  }
  for (let z = -8; z < 16; z++) {
    for (let y = 64; y < 67; y++) world.setBlockStateId(new Vec3(8, y, z), STONE);
  }
  for (let x = 1; x <= 4; x++) world.setBlockStateId(new Vec3(x, 64, 3), SLAB);
  world.setBlockStateId(new Vec3(2, 63, 7), WATER);
  world.setBlockStateId(new Vec3(3, 63, 7), WATER);
  return world;
}

function makeBot(world: unknown) {
  const items = [
    { type: registry.itemsByName.wooden_pickaxe.id as number, count: 1, name: 'wooden_pickaxe', nbt: null, metadata: 0 },
    { type: registry.itemsByName.dirt.id as number, count: 8, name: 'dirt', nbt: null, metadata: 0 },
  ];
  const bot: Record<string, unknown> = {
    registry,
    version: '1.20.6',
    world,
    blockAt: (p: unknown) => (world as { getBlock(p: unknown): unknown }).getBlock(p),
    inventory: { items: () => items },
    entity: { position: new Vec3(0.5, 64, 0.5), effects: {}, height: 1.8 },
    entities: {} as Record<string, unknown>,
    game: { minY: -64, height: 384 },
  };
  bot.pathfinder = {
    bestHarvestTool: (block: { digTime: (...a: unknown[]) => number }) => {
      let fastest = Number.MAX_VALUE;
      let best = null;
      for (const tool of items) {
        const t = block.digTime(tool.type, false, false, false, [], {});
        if (t < fastest) { fastest = t; best = tool; }
      }
      return best;
    },
  };
  return bot;
}

interface SearchOut { status: string; cost: number; pathLen: number; breaks: Array<{ x: number; y: number; z: number }> }

it('routes onto one real block but never directly jumps a two-block column without construction', () => {
  installPathfinderPerf();
  const world = makeWorld(), bot = makeBot(world);
  const m = new Movements(bot as never);
  m.canDig = false; m.allow1by1towers = false; m.allowParkour = false; m.scafoldingBlocks = [];
  (m as any).clearCollisionIndex(); (m as any).updateCollisionIndex();
  const climb = (height: number) => {
    world.setBlockStateId(new Vec3(3,64,0),STONE);
    world.setBlockStateId(new Vec3(3,65,0),height === 2 ? STONE : 0);
    const start = new (Move as any)(2,64,0,0,0);
    const search = new (AStar as any)(start,m,new goals.GoalNear(3,64+height,0,0),1000,40,5);
    let result = search.compute();
    while(result.status === 'partial') result=search.compute();
    return result;
  };
  expect(climb(1).status).toBe('success');
  const two = climb(2);
  expect(two.status).toBe('noPath');
  expect(two.path.every((n: any, i: number) => n.y - (i ? two.path[i-1].y : 64) <= 1.25)).toBe(true);
});

function search(
  bot: unknown, from: [number, number, number], to: [number, number, number], zones?: SiteZone[],
  noPlace?: (x: number, y: number, z: number) => boolean,
): SearchOut {
  const m = new Movements(bot as never);
  if (zones) setSiteZones(m, () => zones);
  if (noPlace) setNoPlaceCells(m, noPlace);
  m.scafoldingBlocks = [registry.itemsByName.dirt.id as number]; // 名单是物品 id,与背包 item.type 同空间
  (m as unknown as { clearCollisionIndex(): void; updateCollisionIndex(): void }).clearCollisionIndex();
  (m as unknown as { updateCollisionIndex(): void }).updateCollisionIndex();
  (bot as { entity: { position: unknown } }).entity.position = new Vec3(from[0] + 0.5, from[1], from[2] + 0.5);
  const start = new (Move as never as new (...a: unknown[]) => unknown)(from[0], from[1], from[2], 8, 0);
  const astar = new (AStar as never as new (...a: unknown[]) => { compute(): { status: string; cost: number; path: unknown[] } })(
    start, m, new goals.GoalNear(to[0], to[1], to[2], 1), 5_000, 60, -1,
  );
  let res = astar.compute();
  while (res.status === 'partial') res = astar.compute();
  return { status: res.status, cost: Math.round(res.cost * 100) / 100, pathLen: res.path.length,
    breaks: res.path.flatMap((move) => (move as { toBreak?: Array<{ x: number; y: number; z: number }> }).toBreak ?? []),
  };
}

/**
 * 一格流水被四面高岸围住：(0,0) 柱掏空，井底 Y=63 灌水，井壁 Y=63~66 实心，地面 Y=66 封顶，可走面 Y=67。
 */
function makeWaterPitWorld() {
  const world = new World(null).sync;
  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) world.setColumn(cx, cz, new Chunk({ minY: -64, worldHeight: 384 }));
  }
  for (let x = -8; x < 16; x++) {
    for (let z = -8; z < 16; z++) {
      for (let y = 56; y <= 65; y++) world.setBlockStateId(new Vec3(x, y, z), STONE);
      world.setBlockStateId(new Vec3(x, 66, z), GRASS);
    }
  }
  for (let y = 64; y <= 66; y++) world.setBlockStateId(new Vec3(0, y, 0), 0);
  world.setBlockStateId(new Vec3(0, 63, 0), WATER);
  return world;
}

/** 同一口井,井底那块石头也换成水:人是游着的,脚下没有可贴的面 */
function makeDeepWaterWorld() {
  const world = makeWaterPitWorld();
  for (let y = 60; y <= 62; y++) world.setBlockStateId(new Vec3(0, y, 0), WATER);
  return world;
}

/**
 * 玩家游在 (0,63) 水中，头侧 (±1,64) 是土，脚侧 (±1,63) 是空气，下方全是水；deep=false 在 (0,62) 放石底模拟可踩底浅水。
 */
function makeWaterTrapWorld(deep: boolean) {
  const world = new World(null).sync;
  const DIRT = registry.blocksByName.dirt.defaultState as number;
  for (let cx = -1; cx <= 1; cx++) {
    for (let cz = -1; cz <= 1; cz++) world.setColumn(cx, cz, new Chunk({ minY: -64, worldHeight: 384 }));
  }
  for (let x = -8; x < 16; x++) {
    for (let z = -8; z < 16; z++) {
      for (let y = 56; y <= 61; y++) world.setBlockStateId(new Vec3(x, y, z), STONE);
    }
  }
  // 她那一列:水柱
  world.setBlockStateId(new Vec3(0, 62, 0), deep ? WATER : STONE);
  world.setBlockStateId(new Vec3(0, 63, 0), WATER);
  // 邻列:脚位空、脚下水、头位土
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    world.setBlockStateId(new Vec3(dx, 62, dz), WATER);
    world.setBlockStateId(new Vec3(dx, 64, dz), DIRT);
  }
  return world;
}

/** 直接问 getMoveForward:在给定节点朝 +x 生成了什么 */
function forwardNeighbors(world: unknown, at: [number, number, number]): Array<{ toPlace?: unknown[] }> {
  const m = new Movements(makeBot(world) as never) as unknown as {
    scafoldingBlocks: number[];
    getMoveForward(node: { x: number; y: number; z: number; remainingBlocks: number }, dir: { x: number; z: number }, neighbors: unknown[]): void;
  };
  m.scafoldingBlocks = [registry.itemsByName.dirt.id as number];
  const neighbors: Array<{ toPlace?: unknown[] }> = [];
  m.getMoveForward({ x: at[0], y: at[1], z: at[2], remainingBlocks: 8 }, { x: 1, z: 0 }, neighbors);
  return neighbors;
}

function diagonalNeighbors(world: unknown, at: [number, number, number], dx: number, dz: number): unknown[] {
  const m = new Movements(makeBot(world) as never) as unknown as {
    getMoveDiagonal(node: { x: number; y: number; z: number; remainingBlocks: number },
      dir: { x: number; z: number }, neighbors: unknown[]): void;
  };
  const neighbors: unknown[] = [];
  m.getMoveDiagonal({ x: at[0], y: at[1], z: at[2], remainingBlocks: 8 }, { x: dx, z: dz }, neighbors);
  return neighbors;
}

/** 直接问 getMoveJumpUp:在给定节点朝 +x 生成了什么 */
function jumpUpNeighbors(world: unknown, at: [number, number, number]): Array<{ toPlace?: unknown[] }> {
  const m = new Movements(makeBot(world) as never) as unknown as {
    scafoldingBlocks: number[];
    getMoveJumpUp(node: { x: number; y: number; z: number; remainingBlocks: number }, dir: { x: number; z: number }, neighbors: unknown[]): void;
  };
  m.scafoldingBlocks = [registry.itemsByName.dirt.id as number];
  const neighbors: Array<{ toPlace?: unknown[] }> = [];
  m.getMoveJumpUp({ x: at[0], y: at[1], z: at[2], remainingBlocks: 8 }, { x: 1, z: 0 }, neighbors);
  return neighbors;
}

/** 直接问 getMoveUp 生成了几个邻居:垫塔动作在不在,是这条判据唯一的观测面 */
function towerNeighbors(world: unknown, at: [number, number, number]): unknown[] {
  const m = new Movements(makeBot(world) as never) as unknown as {
    scafoldingBlocks: number[];
    getMoveUp(node: { x: number; y: number; z: number; remainingBlocks: number }, neighbors: unknown[]): void;
  };
  m.scafoldingBlocks = [registry.itemsByName.dirt.id as number];
  const neighbors: unknown[] = [];
  m.getMoveUp({ x: at[0], y: at[1], z: at[2], remainingBlocks: 8 }, neighbors);
  return neighbors;
}

/** 只靠走(canDig=false):把出路唯一化成 1×1 垫塔,别让"挖穿井壁"混进来 */
function searchOutOfPit(
  bot: unknown, zones?: SiteZone[], noPlace?: (x: number, y: number, z: number) => boolean,
): { status: string; visitedNodes: number; place: number } {
  const m = new Movements(bot as never);
  if (zones) setSiteZones(m, () => zones);
  if (noPlace) setNoPlaceCells(m, noPlace);
  m.canDig = false;
  m.scafoldingBlocks = [registry.itemsByName.dirt.id as number];
  (m as unknown as { clearCollisionIndex(): void; updateCollisionIndex(): void }).clearCollisionIndex();
  (m as unknown as { updateCollisionIndex(): void }).updateCollisionIndex();
  (bot as { entity: { position: unknown } }).entity.position = new Vec3(0.5, 63, 0.5);
  const start = new (Move as never as new (...a: unknown[]) => unknown)(0, 63, 0, 8, 0);
  const astar = new (AStar as never as new (...a: unknown[]) => {
    compute(): { status: string; visitedNodes: number; path: Array<{ toPlace?: unknown[] }> };
  })(start, m, new goals.GoalNear(4, 67, 0, 1), 5_000, 60, -1);
  let res = astar.compute();
  while (res.status === 'partial') res = astar.compute();
  const place = res.path.reduce((s, mv) => s + (mv.toPlace?.length ?? 0), 0);
  return { status: res.status, visitedNodes: res.visitedNodes, place };
}

// 补丁是进程级 prototype 覆写,装上撤不掉:所有"装之前"的读数必须在任何 it 跑起来之前取。
const pitBeforePatch = searchOutOfPit(makeBot(makeWaterPitWorld()));
const baseBot = makeBot(makeWorld());
const baseWall = search(baseBot, [0, 64, 0], [14, 64, 0]); // 穿墙(必须挖)
const baseFlat = search(baseBot, [0, 64, 0], [5, 64, 5]); // 平地(纯走)

describe('pathfinder 性能补丁', () => {
  it('1.20.6 木门上半扇不能成为跳跃或搭路的落脚节点', () => {
    installPathfinderPerf();
    const world = makeWorld();
    world.setBlockStateId(new Vec3(-1, 64, 0), doorState('lower', true));
    world.setBlockStateId(new Vec3(-1, 65, 0), doorState('upper', true));
    world.setBlockStateId(new Vec3(0, 64, 1), STONE);
    world.setBlockStateId(new Vec3(0, 65, 1), STONE);
    const m = new Movements(makeBot(world) as never);
    m.canOpenDoors = true;
    const from = new (Move as never as new (...a: unknown[]) => { x: number; y: number; z: number })(0, 64, 0, 8, 0);
    let neighbors: Array<{ x: number; y: number; z: number }> = [];
    const original = m.getNeighbors.bind(m);
    m.getNeighbors = (node) => {
      const out = original(node);
      if (node.x === 0 && node.y === 64 && node.z === 0) neighbors = out;
      return out;
    };
    const astar = new (AStar as never as new (...a: unknown[]) => { compute(): { status: string } })(
      from, m, new goals.GoalNear(-1, 64, 3, 1), 5000, 60, -1,
    );
    let result = astar.compute();
    while (result.status === 'partial') result = astar.compute();
    expect(neighbors.some((mv) => mv.x === -1 && mv.y === 65 && mv.z === 0)).toBe(false);
    expect(neighbors.some((mv) => mv.x === -1 && mv.y === 64 && mv.z === 0)).toBe(true);
  });

  it('门外墙角不能斜穿实体碰撞：先走正交空格再转弯', () => {
    installPathfinderPerf();
    const world = makeWorld();
    // 从 (0,64,0) 斜向 (-1,64,1)，正北侧 (0,64,1) 是实墙，西侧畅通。
    (world as { setBlockStateId(p: unknown, id: number): void })
      .setBlockStateId(new Vec3(0, 64, 1), STONE);
    expect(diagonalNeighbors(world, [0, 64, 0], -1, 1)).toHaveLength(0);
    expect(diagonalNeighbors(world, [-2, 64, 0], 1, 1)).toHaveLength(1);
  });

  it('脚在一格水里、岸高 4 格:上游一步都迈不出去,补丁后垫塔上岸', () => {
    // 未修补的 getMoveUp 遇液体即返回，水中没有垫塔动作；forward/diagonal 又受 1.2 格台阶限制，因此仅展开起点，visitedNodes=1。
    expect(pitBeforePatch.status).toBe('noPath');
    expect(pitBeforePatch.visitedNodes).toBe(1);

    installPathfinderPerf();

    const after = searchOutOfPit(makeBot(makeWaterPitWorld()));
    expect(after.status).toBe('success');
    expect(after.place).toBeGreaterThanOrEqual(4); // 从 y=63 垫到可走面 y=67
  });

  it('垫脚落点预检:脚下也是水就不生成垫塔,踩得到实底的浅水照旧', () => {
    installPathfinderPerf();
    // 一格水、井底是石头:参照方块有面可贴,第四刀的解锁照旧成立
    expect(towerNeighbors(makeWaterPitWorld(), [0, 63, 0])).toHaveLength(1);
    // 深水中参照方块也是水，不能据此生成服务端会接受的垫塔动作。
    expect(towerNeighbors(makeDeepWaterWorld(), [0, 63, 0])).toHaveLength(0);
  });

  it('深水节点不生成搭桥/带放置的上岸(参照是水+人站不住);浅水两样照旧', () => {
    installPathfinderPerf();
    // 深水 forward 搭桥的参照是水；jumpUp 放置期间漂移还可能让玩家碰撞箱进入落点。
    expect(forwardNeighbors(makeWaterTrapWorld(true), [0, 63, 0])).toHaveLength(0);
    expect(jumpUpNeighbors(makeWaterTrapWorld(true), [0, 63, 0])).toHaveLength(0);
    // 踩得到实底的浅水:参照有面可贴、人站得住,两个动作都在
    const fwd = forwardNeighbors(makeWaterTrapWorld(false), [0, 63, 0]);
    expect(fwd).toHaveLength(1);
    expect(fwd[0].toPlace).toHaveLength(1);
    const jump = jumpUpNeighbors(makeWaterTrapWorld(false), [0, 63, 0]);
    expect(jump).toHaveLength(1);
    expect(jump[0].toPlace).toHaveLength(2);
  });

  it('被服务端拒过的放置进搜索黑名单:同格同块不再生成,过期或世界变过放行', () => {
    installPathfinderPerf();
    const fresh = { was: 'water', x: 0, y: 63, z: 0, at: Date.now() };
    // 井底垫塔第一块 (0,63,0) 刚被三连拒:整条垫塔出路不再生成 → 诚实 noPath
    const banned = makeBot(makeWaterPitWorld()) as Record<string, unknown>;
    banned.placeMisses = [fresh];
    const bannedOut = searchOutOfPit(banned);
    expect(bannedOut.place).toBe(0);
    expect(bannedOut.status).toBe('noPath');
    // 三分钟过了:放行重试
    const stale = makeBot(makeWaterPitWorld()) as Record<string, unknown>;
    stale.placeMisses = [{ ...fresh, at: Date.now() - 10 * 60_000 }];
    expect(searchOutOfPit(stale).status).toBe('success');
    // 那一格已经不是被拒时的方块(世界变过):放行重试
    const changed = makeBot(makeWaterPitWorld()) as Record<string, unknown>;
    changed.placeMisses = [{ ...fresh, was: 'dirt' }];
    expect(searchOutOfPit(changed).status).toBe('success');
  });

  it('补丁后墙与平地仍可达，角落绕行稳定且重复安装幂等', () => {
    expect(baseWall.status).toBe('success');
    expect(baseFlat.status).toBe('success');

    installPathfinderPerf();
    installPathfinderPerf(); // 幂等

    const bot = makeBot(makeWorld());
    expect(search(bot, [0, 64, 0], [14, 64, 0])).toEqual(baseWall);
    const safeFlat = search(bot, [0, 64, 0], [5, 64, 5]);
    expect(safeFlat.status).toBe('success');
    expect(safeFlat.cost).toBeGreaterThanOrEqual(baseFlat.cost);
    expect(search(makeBot(makeWorld()), [0, 64, 0], [5, 64, 5])).toEqual(safeFlat);
  });

  it('缓存随搜索生灭:世界变了,新搜索看得见新世界', () => {
    const world = makeWorld();
    const bot = makeBot(world);
    installPathfinderPerf();
    const before = search(bot, [0, 64, 0], [14, 64, 0]);
    // 在墙上开个门洞:新搜索应该走门洞,代价明显下降
    world.setBlockStateId(new Vec3(8, 64, 0), 0);
    world.setBlockStateId(new Vec3(8, 65, 0), 0);
    const after = search(bot, [0, 64, 0], [14, 64, 0]);
    expect(after.status).toBe('success');
    expect(after.cost).toBeLessThan(before.cost);
  });

  it('挖掘成本重读时区块已卸载，排除该边且下一次搜索可重新挖掘', () => {
    installPathfinderPerf();
    const bot = makeBot(makeWorld());
    const blockAt = bot.blockAt as (position: unknown) => { type: number } | null;
    // 搜索特征仍读得到墙，物化完整 Block 时客户端已丢掉对应区块。
    bot.blockAt = (position: unknown) => {
      const block = blockAt(position);
      return block?.type === registry.blocksByName.stone.id ? null : block;
    };
    const missing = search(bot, [0, 64, 0], [14, 64, 0]);
    expect(missing.breaks.some((position) => position.x === 8)).toBe(false);
    expect(Number.isFinite(missing.cost)).toBe(true);

    bot.blockAt = blockAt;
    const restored = search(bot, [0, 64, 0], [14, 64, 0]);
    expect(restored.status).toBe('success');
    expect(restored.breaks.some((position) => position.x === 8)).toBe(true);
  });

  it('compute 之外 getBlock 不走缓存,读到的是新鲜世界', () => {
    const world = makeWorld();
    const bot = makeBot(world);
    installPathfinderPerf();
    const m = new Movements(bot as never) as unknown as {
      getBlock(pos: unknown, dx: number, dy: number, dz: number): { name: string };
    };
    const p = new Vec3(2, 64, 2);
    expect(m.getBlock(p, 0, -1, 0).name).toBe('grass_block');
    world.setBlockStateId(new Vec3(2, 63, 2), STONE);
    expect(m.getBlock(p, 0, -1, 0).name).toBe('stone');
  });

  it('工地不生成搭路动作，现有通路仍可走', () => {
    installPathfinderPerf();
    // 井底 (0,63,0) 垫塔上岸:不设区时有这一步,把井口整段圈成工地就没有了
    expect(searchOutOfPit(makeBot(makeWaterPitWorld())).place).toBeGreaterThan(0);

    const bot = makeBot(makeWaterPitWorld());
    const walled = searchOutOfPit(bot, [{
      key: 'yard', min: [-1, 60, -1], max: [1, 70, 1], materials: [],
    }]);
    expect(walled.place).toBe(0);
    expect(walled.status).toBe('noPath'); // 这口井只有垫塔一条出路

    // 平地纯走的那条路不受影响:禁的是"垫",不是"走"
    const flat = makeBot(makeWorld());
    const zoned = search(flat, [0, 64, 0], [5, 64, 5], [{
      key: 'yard', min: [0, 60, 0], max: [6, 70, 6], materials: [],
    }]);
    expect(zoned).toEqual(search(makeBot(makeWorld()), [0, 64, 0], [5, 64, 5]));
  });

  it('自动寻路绕开工地墙体，范围外仍可挖掘', () => {
    installPathfinderPerf();
    const zone: SiteZone = { key: 'wall', min: [8, 64, -8], max: [8, 66, 15], materials: [] };
    const unbound = search(makeBot(makeWorld()), [0, 64, 0], [14, 64, 0]);
    expect(unbound.status).toBe('success');
    expect(unbound.breaks.some((p) => p.x === 8)).toBe(true);
    const protectedRoute = search(makeBot(makeWorld()), [0, 64, 0], [14, 64, 0], [zone]);
    expect(protectedRoute.status).toBe('success');
    expect(protectedRoute.breaks.some((p) => p.x === 8 && p.z >= -8 && p.z <= 15)).toBe(false);
    expect(protectedRoute.pathLen).toBeGreaterThan(unbound.pathLen);
    expect(search(makeBot(makeWorld()), [0, 64, 0], [14, 64, 0], [{ ...zone, min: [0, 80, 0], max: [1, 81, 1] }]))
      .toEqual(unbound);
  });

  it('搜索外的破坏检查现读绑定；卸载和迁移不会沿用旧工地', () => {
    installPathfinderPerf();
    const bot = makeBot(makeWorld());
    const m = new Movements(bot as never);
    let zones: SiteZone[] = [{ key: 'wall', min: [8, 64, -8], max: [8, 66, 15], materials: [] }];
    setSiteZones(m, () => zones);
    const readBlock = bot.blockAt as (p: InstanceType<typeof Vec3>) => Parameters<typeof m.safeToBreak>[0];
    const block = readBlock(new Vec3(8, 64, 0));
    expect(m.safeToBreak(block)).toBe(false);
    zones = [{ ...zones[0]!, min: [12, 64, -8], max: [12, 66, 15] }];
    expect(m.safeToBreak(block)).toBe(true);
    zones = [];
    expect(m.safeToBreak(block)).toBe(true);
  });

  it.each([
    ['west', -1, 0], ['east', 1, 0], ['north', 0, -1], ['south', 0, 1],
  ] as const)('auto-navigation preserves a %s-facing ladder and its attached wall', (facing, dx, dz) => {
    installPathfinderPerf();
    const world = makeWorld();
    const ladder = registry.blocksByName.ladder;
    let state = ladder.defaultState;
    for (let id = ladder.minStateId; id <= ladder.maxStateId; id++) {
      const properties = Block.fromStateId(id, 0).getProperties();
      if (properties.facing === facing && properties.waterlogged === false) { state = id; break; }
    }
    const wall = new Vec3(8, 65, 0);
    const rung = wall.offset(dx, 0, dz);
    world.setBlockStateId(rung, state);
    const bot = makeBot(world);
    const movements = new Movements(bot as never);
    const safe = (at: InstanceType<typeof Vec3>) => movements.safeToBreak(world.getBlock(at));
    expect(safe(wall)).toBe(false);
    expect(safe(rung)).toBe(false);
    expect(safe(wall.offset(0, -1, 0))).toBe(true);
    const route = search(bot, [0, 64, 0], [14, 64, 0]);
    expect(route.status).toBe('success');
    expect(route.breaks.some(p => p.x === wall.x && p.y === wall.y && p.z === wall.z)).toBe(false);
    world.setBlockStateId(rung, registry.blocksByName.air.defaultState);
    expect(safe(wall)).toBe(true);
  });

  it('成果登记:不往登记格自己、也不往它头顶垫;走与挖照旧', () => {
    installPathfinderPerf();
    expect(searchOutOfPit(makeBot(makeWaterPitWorld())).place).toBeGreaterThan(0);

    // 井底那一格登记成她的耕地:垫塔的第一块正落在它头顶,整条出路就不该生成
    const onWork = searchOutOfPit(
      makeBot(makeWaterPitWorld()), undefined,
      (x, y, z) => x === 0 && y === 63 && z === 0,
    );
    expect(onWork.place).toBe(0);
    expect(onWork.status).toBe('noPath');

    // 平地纯走的那条路不受影响:禁的是"垫",不是"走"
    expect(search(makeBot(makeWorld()), [0, 64, 0], [5, 64, 5], undefined, () => true))
      .toEqual(search(makeBot(makeWorld()), [0, 64, 0], [5, 64, 5]));
  });

  it('工地建材垫脚排到最后:包里有泥土就先用泥土,只剩建材时照旧可用', () => {
    installPathfinderPerf();
    const dirt = registry.itemsByName.dirt.id as number;
    const planks = registry.itemsByName.oak_planks.id as number;
    const bag = [
      { type: planks, count: 8, name: 'oak_planks', nbt: null, metadata: 0 },
      { type: dirt, count: 8, name: 'dirt', nbt: null, metadata: 0 },
    ];
    const bot = makeBot(makeWorld()) as { inventory: { items(): typeof bag } };
    bot.inventory.items = () => bag;
    const m = new Movements(bot as never) as unknown as {
      scafoldingBlocks: number[]; getScaffoldingItem(): { name: string } | null;
    };
    // 名单顺序把木板排在前面:没有工地时它就是首选
    m.scafoldingBlocks = [planks, dirt];
    expect(m.getScaffoldingItem()?.name).toBe('oak_planks');

    setSiteZones(m as never, () => [{
      key: 'yard', min: [0, 0, 0], max: [1, 1, 1], materials: ['oak_planks'],
    }]);
    expect(m.getScaffoldingItem()?.name).toBe('dirt');

    // 泥土用光,只剩建材:软优先级,照旧拿得到
    bag.splice(1, 1);
    expect(m.getScaffoldingItem()?.name).toBe('oak_planks');
  });

  it('实体索引短路保语义:没实体回 0,有实体照常计数', () => {
    const world = makeWorld();
    const bot = makeBot(world);
    installPathfinderPerf();
    const m = new Movements(bot as never) as unknown as {
      clearCollisionIndex(): void;
      updateCollisionIndex(): void;
      getNumEntitiesAt(pos: unknown, dx: number, dy: number, dz: number): number;
    };
    m.clearCollisionIndex();
    m.updateCollisionIndex();
    expect(m.getNumEntitiesAt(new Vec3(3, 64, 3), 0, 0, 0)).toBe(0);
    (bot.entities as Record<string, unknown>).e1 = {
      name: 'zombie', width: 0.6, height: 1.95, position: new Vec3(3.5, 64, 3.5),
    };
    m.clearCollisionIndex();
    m.updateCollisionIndex();
    expect(m.getNumEntitiesAt(new Vec3(3, 64, 3), 0, 0, 0)).toBeGreaterThan(0);
  });
});
