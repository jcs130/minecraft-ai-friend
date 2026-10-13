import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { MinecraftWorld } from '../core/world.ts';
import { MINECRAFT_DEFAULTS } from '../core/config.ts';
import { Executor } from '../core/executor.ts';
import { CONTROL_KEYS } from '../core/skills.ts';
import { watchFlightAbilities } from '../core/flight.ts';
import { MethodRunner } from '../core/method-runner.ts';
import { FakeHost } from './method-host.ts';
function nextTaskId(): () => number { let seq = 0; return () => ++seq; }

const req = createRequire(createRequire(import.meta.url).resolve('mineflayer'));
const registry = req('prismarine-registry')('1.20.6');
const Blocks = req('prismarine-block')(registry);
const { Physics, PlayerState } = req('prismarine-physics');

/** Real executor and physics with a local block grid, without a server connection. */
export function methodHarness() {
  const host = new FakeHost();
  const cells = new Map<string, string>();
  const keys = Object.fromEntries(CONTROL_KEYS.map(key => [key, false]));
  const said: string[] = [];
  const blockAt = (at: Vec3) => {
    const pos = at.floored();
    const name = cells.get(pos.toString()) ?? (pos.y < 64 ? 'stone' : 'air');
    const block = Blocks.fromStateId(registry.blocksByName[name].defaultState, 0);
    block.position = pos;
    return block;
  };
  const blockWorld = { getBlock: blockAt };
  const bot = Object.assign(new EventEmitter(), {
    _client: Object.assign(new EventEmitter(), { write() {} }), registry, version: '1.20.6', world: blockWorld,
    game: { dimension: 'overworld', gameMode: 'survival' }, entities: {}, players: {}, health: 20, food: 20,
    time: { timeOfDay: 1000 }, rainState: 0, oxygenLevel: 20,
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5), velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0,
      onGround: true, height: 1.8, eyeHeight: 1.62, effects: {}, attributes: {} },
    inventory: { slots: Array(46).fill(null), items: () => [] }, heldItem: null, currentWindow: null,
    controlState: keys, jumpTicks: 0, jumpQueued: false, physicsEnabled: true,
    physics: Physics(registry, blockWorld), blockAt, findBlocks: () => [],
    setControlState(key: string, value: boolean) { keys[key] = value; },
    clearControlStates() { for (const key of CONTROL_KEYS) keys[key] = false; },
    look: async (yaw: number, pitch: number) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; },
    stopDigging() {}, chat(text: string) { said.push(text); },
    pathfinder: { goal: null, setGoal(goal: unknown) { this.goal = goal as null; bot.clearControlStates(); }, stop() {} },
  });
  const world = new MinecraftWorld({ cfg: structuredClone(MINECRAFT_DEFAULTS) });
  const internals = world as unknown as { onTaskReport: ConstructorParameters<typeof Executor>[0]['report']; methods: MethodRunner };
  const exec = new Executor({ getBot: () => bot as unknown as Bot,
    report: report => internals.onTaskReport(report), log: host.log, nextId: nextTaskId() });
  Object.assign(world, { host, executor: exec, bridge: { bot, invSynced: true } });
  const timer = setInterval(() => {
    if (bot.physicsEnabled) { const state = new PlayerState(bot, bot.controlState); bot.physics.simulatePlayer(state, blockWorld); state.apply(bot); }
    bot.emit('physicsTick');
  }, 50);
  const detach = watchFlightAbilities(bot as unknown as Bot);
  return { world, exec, bot, said, keys, host, runner: internals.methods,
    set: (x: number, y: number, z: number, name: string) => cells.set(new Vec3(x, y, z).toString(), name),
    close: () => { internals.methods.stop('测试结束'); exec.shutdown(); clearInterval(timer); detach(); } };
}

export async function methodEnded(r: ReturnType<typeof methodHarness>, id: number) {
  const end = Date.now() + 5000;
  while (r.runner.read(id)[0]?.status === 'running') {
    if (Date.now() > end) throw new Error('method did not finish');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return r.runner.read(id)[0];
}
