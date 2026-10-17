/** Offline Prismarine physics fixture. This module has no network or live-client dependency. */
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { MOTOR_ACTIONS, ACTION_TICKS, MOTOR_PROTOCOL, MOTOR_VERSION, type Point, type MotorObservation, type MotorGoalMode } from './policy.ts';
const require = createRequire(import.meta.url);
const { Physics, PlayerState } = require('prismarine-physics');
const data = require('minecraft-data')(MOTOR_VERSION);
const Block = require('prismarine-block')(MOTOR_VERSION);
export const TASKS = ['walk', 'step', 'obstacle', 'gap', 'follow', 'recovery'] as const;
export type MotorTask = typeof TASKS[number];
const key = (x: number, y: number, z: number) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
const distance = (a: Point, b: Point) => Math.hypot(...a.map((v, i) => v - b[i]));
function random(seed: number) { let state = seed >>> 0; return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; }; }
export class MotorSimulator {
  readonly blocks = new Map<string, number>();
  readonly task: MotorTask;
  readonly seed: number;
  readonly player: any;
  readonly world: { getBlock: (p: Vec3) => any };
  readonly physics: any;
  private state: any;
  tick = 0;
  terminal = false;
  success = false;
  failure: string | null = null;
  travelled = 0;
  collisionTicks = 0;
  stillTicks = 0;
  longestStillTicks = 0;
  followTicks = 0;
  goal: Point;
  private route: Point[] = [];
  /** Audit counter: independent student rollouts must leave this at zero. */
  teacherRouteCalls = 0;
  private readonly heading: number;
  private readonly offset: [number, number];
  private readonly wall: number;
  constructor(task: MotorTask, seed: number, readonly goalMode: MotorGoalMode = 'final-target') {
    if (!TASKS.includes(task) || !Number.isSafeInteger(seed) || seed < 0 || seed >= 2 ** 32) throw Error('Invalid training scenario');
    if (!['final-target', 'teacher-waypoint'].includes(goalMode)) throw Error('Invalid motor goal mode');
    this.task = task; this.seed = seed;
    const rand = random(seed); for (let i = 0; i < 8; i++) rand();
    this.heading = Math.floor(rand() * 4); this.offset = [Math.floor(rand() * 21) - 10, Math.floor(rand() * 21) - 10];
    this.wall = 4 + Math.floor(rand() * 3);
    for (let x = -6; x <= 19; x++) for (let z = -7; z <= 7; z++) this.setLocal(x, 63, z, 'stone');
    if (task === 'step') for (let x = this.wall; x <= 19; x++) for (let z = -7; z <= 7; z++) this.setLocal(x, 64, z, 'stone');
    if (task === 'obstacle') for (let x = this.wall; x <= this.wall + 1; x++) for (let z = -1; z <= 1; z++) for (let y = 64; y < 67; y++) this.setLocal(x, y, z, 'stone');
    if (task === 'gap') for (let z = -7; z <= 7; z++) this.setLocal(this.wall, 63, z, 'air');
    const start = this.point(.5, 64, .5); this.goal = this.point(11.5, task === 'step' ? 65 : 64, .5);
    if (task === 'follow') this.goal = this.point(4.5, 64, .5);
    this.world = { getBlock: p => this.blockAt(p.x, p.y, p.z) };
    this.physics = Physics(data, this.world);
    this.player = { version: MOTOR_VERSION, entity: { position: new Vec3(...start), velocity: new Vec3(0, 0, 0),
      yaw: rand() * Math.PI * 2, pitch: 0, onGround: true, isInWater: false, isInLava: false, isInWeb: false,
      isCollidedHorizontally: false, isCollidedVertically: false, elytraFlying: false, effects: {}, attributes: {} },
      inventory: { slots: Array(46).fill(null) }, jumpTicks: 0, jumpQueued: false, fireworkRocketDuration: 0 };
    this.state = new PlayerState(this.player, {});
  }
  private point(x: number, y: number, z: number): Point {
    for (let i = 0; i < this.heading; i++) [x, z] = [-z, x];
    return [x + this.offset[0], y, z + this.offset[1]];
  }
  private setLocal(x: number, y: number, z: number, name: string) {
    const p = this.point(x + .5, y, z + .5); this.blocks.set(key(...p), data.blocksByName[name].defaultState);
  }
  blockAt(x: number, y: number, z: number): any {
    const p = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    const id = this.blocks.get(key(p.x, p.y, p.z)) ?? data.blocksByName.air.defaultState;
    const block = Block.fromStateId(id, 0); block.position = p; return block;
  }
  private controls(action: number) {
    const a = MOTOR_ACTIONS[action];
    if (!a) throw Error('Invalid motor action');
    return { forward: !!a.forward, back: false, left: false, right: false, jump: !!a.jump, sprint: !!a.sprint, sneak: false };
  }
  private support(x: number, z: number): number | null {
    for (let y = 67; y >= 62; y--) if (this.blockAt(x, y, z).shapes.length && !this.blockAt(x, y + 1, z).shapes.length && !this.blockAt(x, y + 2, z).shapes.length) return y + 1;
    return null;
  }
  /** Privileged expert only. A final-target student observation never invokes this method. */
  private findRoute(): Point[] {
    this.teacherRouteCalls++;
    const start: Point = [Math.floor(this.state.pos.x) + .5, Math.round(this.state.pos.y), Math.floor(this.state.pos.z) + .5];
    const target = this.goal;
    type Node = { p: Point; g: number; parent?: Node };
    const first: Node = { p: start, g: 0 }, open = [first], best = new Map<string, number>([[key(...start), 0]]);
    let end = first;
    for (let count = 0; open.length && count < 1600; count++) {
      open.sort((a, b) => (a.g + distance(a.p, target)) - (b.g + distance(b.p, target)));
      const node = open.shift()!; if (distance(node.p, target) < distance(end.p, target)) end = node;
      if (distance(node.p, target) < .8) { end = node; break; }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let x = node.p[0] + dx, z = node.p[2] + dz, y = this.support(x, z), span = 1;
        if (y === null) { x += dx; z += dz; y = this.support(x, z); span = 2; }
        if (y === null || y - node.p[1] > 1 || node.p[1] - y > 1 || Math.abs(x - start[0]) > 25 || Math.abs(z - start[2]) > 25) continue;
        const p: Point = [x, y, z], g = node.g + span + Math.max(0, y - node.p[1]) * .2, k = key(...p);
        if ((best.get(k) ?? Infinity) <= g) continue;
        best.set(k, g); open.push({ p, g, parent: node });
      }
    }
    const path: Point[] = []; for (let n: Node | undefined = end; n; n = n.parent) path.push(n.p);
    return path.reverse();
  }
  private updateGoal() {
    if (this.task === 'follow') this.goal = this.point(4.5 + Math.min(7, this.tick / 45), 64, .5 + Math.sin(this.tick / 55) * 1.5);
  }
  private teacherGoal(): Point {
    this.updateGoal();
    if (!this.route.length || (this.tick % 10 === 0 && this.state.onGround)) this.route = this.findRoute();
    const p = this.state.pos;
    while (this.route.length > 1 && distance([p.x, p.y, p.z], this.route[0]) < .8) this.route.shift();
    // Look ahead through collinear nodes, preserving the first corner and upward/jump transition.
    let goal = this.route[0] ?? this.goal;
    for (let i = 1; i < Math.min(this.route.length, 4); i++) {
      const next = this.route[i];
      if (next[1] !== goal[1] || (next[0] !== goal[0] && next[2] !== goal[2])) break;
      if (distance(next, [p.x, p.y, p.z]) > 2.6) break;
      goal = next;
    }
    if (distance([p.x, p.y, p.z], this.goal) < 2) goal = this.goal;
    return [...goal];
  }
  observation(): MotorObservation {
    this.updateGoal();
    const goal = this.goalMode === 'teacher-waypoint' ? this.teacherGoal() : [...this.goal] as Point;
    const p = this.state.pos;
    const voxels: number[] = [], bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    for (let x = -3; x <= 3; x++) for (let y = -2; y <= 2; y++) for (let z = -3; z <= 3; z++) {
      const b = this.blockAt(bx + x, by + y, bz + z);
      // Offline fixture knows its generated local cells. Unloaded live cells must remain zero (unknown).
      voxels.push(1 | (b.shapes.length ? 2 : 0) | (b.name === 'lava' ? 4 : 0) | (b.name === 'water' || b.name === 'lava' ? 8 : 0));
    }
    return { protocol: MOTOR_PROTOCOL, minecraftVersion: MOTOR_VERSION, tick: this.tick, position: [p.x, p.y, p.z],
      velocity: [this.state.vel.x, this.state.vel.y, this.state.vel.z], yaw: this.state.yaw, onGround: this.state.onGround, goal: [...goal], goalMode: this.goalMode, voxels };
  }
  teacher(observation = this.observation()): number {
    // Labels can use privileged routes; the recorded student input keeps the final target.
    const goal = this.goalMode === 'final-target' ? this.teacherGoal() : observation.goal;
    return physicsTeacherAction(this.state, this.physics, this.world, goal);
  }
  step(action: number) {
    if (this.terminal) throw Error('Episode already terminal');
    const before: Point = [this.state.pos.x, this.state.pos.y, this.state.pos.z];
    const previousDistance = distance(before, this.goal);
    this.state.yaw += MOTOR_ACTIONS[action]?.yawDelta ?? 0; this.state.control = this.controls(action);
    for (let i = 0; i < ACTION_TICKS; i++) {
      this.physics.simulatePlayer(this.state, this.world); this.tick++;
      if (this.state.isCollidedHorizontally) this.collisionTicks++;
    }
    const after: Point = [this.state.pos.x, this.state.pos.y, this.state.pos.z], moved = distance(before, after);
    this.travelled += moved; this.stillTicks = moved < .015 ? this.stillTicks + ACTION_TICKS : 0;
    this.longestStillTicks = Math.max(this.longestStillTicks, this.stillTicks);
    if (this.task === 'recovery' && this.tick === 20) {
      for (let z = -1; z <= 1; z++) for (let y = 64; y < 67; y++) this.setLocal(7, y, z, 'stone');
      this.route = [];
    }
    if (after[1] < 62 || this.state.isInLava) { this.terminal = true; this.failure = 'fell-or-hazard'; }
    const close = distance(after, this.goal) < (this.task === 'follow' ? 2 : .8) && this.state.onGround;
    this.followTicks = close ? this.followTicks + ACTION_TICKS : 0;
    if (close && (this.task !== 'follow' || (this.tick >= 180 && this.followTicks >= 30))) { this.success = true; this.terminal = true; }
    if (!this.terminal && this.tick >= 420) { this.terminal = true; this.failure = 'timeout'; }
    return { reward: previousDistance - distance(after, this.goal) - .01 - (this.failure ? 10 : 0) + (this.success ? 10 : 0),
      terminal: this.terminal, success: this.success, failure: this.failure };
  }
  truth() { return { task: this.task, seed: this.seed, tick: this.tick, goal: this.goal, blocks: [...this.blocks].map(([k, stateId]) => ({ position: k.split(',').map(Number), stateId })),
    travelled: this.travelled, collisionTicks: this.collisionTicks, longestStillTicks: this.longestStillTicks, teacherRouteCalls: this.teacherRouteCalls,
    goalMode: this.goalMode, success: this.success, failure: this.failure }; }
}

/** Expert labels only; never used by a raw learned-policy step. */
export function physicsTeacherAction(playerState: any, physics: any, world: any, goal: Point): number {
  const predict = (action: number) => {
    const state = Object.assign(Object.create(Object.getPrototypeOf(playerState)), playerState, { pos: playerState.pos.clone(), vel: playerState.vel.clone() });
    const a = MOTOR_ACTIONS[action];
    state.yaw += a.yawDelta; state.control = { forward: !!a.forward, back: false, left: false, right: false, jump: !!a.jump, sprint: !!a.sprint, sneak: false };
    let collisions = 0, closest = Infinity;
    for (let i = 0; i < 16; i++) { physics.simulatePlayer(state, world); if (state.isCollidedHorizontally) collisions++; closest = Math.min(closest, distance([state.pos.x, state.pos.y, state.pos.z], goal)); }
    return { state, collisions, closest };
  };
  let best = 0, cost = Infinity;
  for (let action = 0; action < MOTOR_ACTIONS.length; action++) {
    const { state: s, collisions, closest } = predict(action), a = MOTOR_ACTIONS[action];
    const dx = goal[0] - s.pos.x, dz = goal[2] - s.pos.z;
    const desired = Math.atan2(-dx, -dz), error = Math.atan2(Math.sin(desired - s.yaw), Math.cos(desired - s.yaw));
    let value = closest + Math.abs(s.pos.y - goal[1]) * .2 + Math.abs(error) * .1
      + collisions * .08 + (a.jump ? .12 : 0) + Math.abs(a.yawDelta) * .015;
    if (closest > .6 && Math.hypot(s.pos.x - playerState.pos.x, s.pos.z - playerState.pos.z) < .05) value += 1;
    if (s.pos.y < 63.4 || s.isInLava) value += 100;
    if (!Number.isFinite(value)) throw Error('Invalid physics prediction');
    if (value < cost) { cost = value; best = action; }
  }
  return best;
}
