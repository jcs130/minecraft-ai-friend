/** Opt-in, owned localhost Minecraft training process. Never attaches to a running game or host Agent. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, realpath, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { Vec3 } from 'vec3';
import { MOTOR_ACTIONS, ACTION_TICKS, MOTOR_PROTOCOL, MOTOR_VERSION, type MotorObservation, type Point } from './policy.ts';
import { MotorSimulator, physicsTeacherAction, type MotorTask } from './simulator.ts';

const require = createRequire(import.meta.url);
const mineflayer = require('mineflayer');
const { Physics, PlayerState } = require('prismarine-physics');
const vector = (p: any): Point => [p.x, p.y, p.z];
const dist = (a: Point, b: Point) => Math.hypot(...a.map((x, i) => x - b[i]));
export interface MinecraftMotorConfig {
  java: string;
  serverJar: string;
  /** Must contain an existing, explicitly accepted eula=true. No automatic acceptance. */
  acceptedEulaFile: string;
  /** New empty directory, or a directory previously created by this training backend. */
  directory: string;
}
export class MinecraftMotorEnvironment {
  readonly goalMode = 'final-target' as const;
  readonly username = 'MotorTrain';
  private child?: ChildProcessWithoutNullStreams;
  private bot: any;
  private lines = new Set<(line: string) => void>();
  private ended = false;
  private lock?: Awaited<ReturnType<typeof open>>;
  private lockPath?: string;
  private closing?: Promise<void>;
  private expert: any;
  private movements: any;
  private scene!: MotorSimulator;
  private task!: MotorTask;
  private seed = 0;
  private physicsTick = 0;
  private corrections = 0;
  private travelled = 0;
  private collisions = 0;
  private still = 0;
  private longestStill = 0;
  private followTicks = 0;
  private terminal = false;
  private success = false;
  private serverGoalConfirmed: boolean | null = null;
  private failure: string | null = null;
  teacherRouteCalls = 0;
  serverJarSha256 = '';
  serverVersion = '';
  port = 0;

  private line(pattern: RegExp, timeout = 10000): Promise<string> {
    return new Promise((done, fail) => {
      const finish = (error?: Error, value?: string) => { clearTimeout(timer); this.lines.delete(listener); error ? fail(error) : done(value!); };
      const listener = (line: string) => { if (pattern.test(line)) finish(undefined, line); if (line === '__PROCESS_EXIT__') finish(Error('Owned Minecraft server exited')); };
      const timer = setTimeout(() => finish(Error(`Minecraft command/start timeout: ${pattern}`)), timeout);
      this.lines.add(listener);
    });
  }
  private async command(command: string): Promise<string> {
    if (!this.child || this.ended) throw Error('Owned Minecraft server unavailable');
    const marker = `MOTOR_${randomUUID().replaceAll('-', '')}`;
    const logs: string[] = [], listener = (line: string) => logs.push(line);
    this.lines.add(listener);
    const done = this.line(new RegExp(marker));
    this.child.stdin.write(command + '\nsay ' + marker + '\n');
    try {
      await done;
      const output = logs.join('\n');
      if (/Unknown or incomplete command|Too many blocks|outside of the world|not loaded|No entity was found|Incorrect argument/i.test(output)) throw Error('Owned training world rejected a setup/query command');
      return output;
    } finally { this.lines.delete(listener); }
  }
  async start(config: MinecraftMotorConfig) {
    const directory = resolve(config.directory), marker = join(directory, 'agent-mc-motor-sandbox.json');
    if (!/^eula\s*=\s*true\s*$/m.test(await readFile(config.acceptedEulaFile, 'utf8'))) throw Error('An explicitly accepted Minecraft EULA file is required');
    await mkdir(directory, { recursive: true });
    const entries = await readdir(directory);
    if (entries.length) {
      const previous = JSON.parse(await readFile(marker, 'utf8').catch(() => { throw Error('Refusing an existing non-training directory'); }));
      if (previous.kind !== 'agent-mc-motor-owned-sandbox/v1') throw Error('Training ownership marker mismatch');
    } else await writeFile(marker, JSON.stringify({ kind: 'agent-mc-motor-owned-sandbox/v1', createdAt: new Date().toISOString() }));
    this.lockPath = join(directory, 'agent-mc-motor-process.lock');
    this.lock = await open(this.lockPath, 'wx');
    await this.lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    // The jar stays outside the training directory. Never copy server configuration, users or saves.
    const serverJar = await realpath(config.serverJar);
    this.serverJarSha256 = createHash('sha256').update(await readFile(serverJar)).digest('hex');
    this.port = await new Promise<number>((done, fail) => { const socket = createServer(); socket.once('error', fail); socket.listen(0, '127.0.0.1', () => { const port = (socket.address() as any).port; socket.close(() => done(port)); }); });
    await writeFile(join(directory, 'eula.txt'), 'eula=true\n');
    await writeFile(join(directory, 'server.properties'), [
      'server-ip=127.0.0.1', `server-port=${this.port}`, 'online-mode=false', 'enable-rcon=false', 'enable-query=false',
      'max-players=1', 'view-distance=3', 'simulation-distance=3', 'spawn-protection=0', 'allow-flight=true',
      'level-name=motor-training', 'level-seed=781938', 'level-type=minecraft:flat',
      'generator-settings={"biome":"minecraft:plains","layers":[{"block":"minecraft:air","height":1}],"structures":{}}',
      'generate-structures=false', 'gamemode=survival', 'difficulty=peaceful', 'sync-chunk-writes=false',
      'network-compression-threshold=-1', 'max-tick-time=60000', 'motd=Agent MC isolated motor training',
    ].join('\n') + '\n');
    this.child = spawn(config.java, ['-Xms512M', '-Xmx1536M', '-jar', serverJar, 'nogui'], { cwd: directory, windowsHide: true, stdio: 'pipe' });
    this.child.on('error', () => { this.ended = true; for (const listener of this.lines) listener('__PROCESS_EXIT__'); });
    this.child.on('exit', () => { this.ended = true; for (const listener of this.lines) listener('__PROCESS_EXIT__'); });
    for (const pipe of [this.child.stdout, this.child.stderr]) createInterface({ input: pipe }).on('line', line => {
      if (/Starting minecraft server version /.test(line)) this.serverVersion = line.split('version ')[1].trim();
      for (const listener of this.lines) listener(line);
    });
    await this.line(/Done \(.+For help/, 120000);
    if (this.serverVersion !== MOTOR_VERSION) throw Error(`Training requires Minecraft ${MOTOR_VERSION}; got ${this.serverVersion}`);
    for (const rule of ['doMobSpawning false', 'doDaylightCycle false', 'doWeatherCycle false', 'randomTickSpeed 0', 'doPatrolSpawning false', 'doTraderSpawning false', 'keepInventory true', 'sendCommandFeedback true']) await this.command('gamerule ' + rule);
    await this.command('forceload add -32 -32 32 32');
    await this.command('setworldspawn 0 64 0');
    await this.command('setblock 0 63 0 stone');
    this.bot = mineflayer.createBot({ host: '127.0.0.1', port: this.port, username: this.username, auth: 'offline', version: MOTOR_VERSION, hideErrors: true, logErrors: false, viewDistance: 'tiny' });
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(Error('Training client spawn timeout')), 45000);
      this.bot.once('spawn', () => { clearTimeout(timer); done(); });
      this.bot.on('error', (e: Error) => { clearTimeout(timer); fail(e); });
      this.bot.once('kicked', () => { clearTimeout(timer); fail(Error('Training client kicked')); });
    });
    await this.bot.waitForChunksToLoad();
    this.bot.physicsEnabled = false;
    this.bot.on('physicsTick', () => this.physicsTick++);
    this.bot._client.on('position', () => this.corrections++);
  }
  private async ticks(count: number) {
    await new Promise<void>((done, fail) => {
      let remaining = count;
      const cleanup = () => { clearTimeout(timer); this.bot.removeListener('physicsTick', tick); this.bot.removeListener('end', end); this.bot.physicsEnabled = false; };
      const tick = () => { if (--remaining === 0) { cleanup(); done(); } };
      const end = () => { cleanup(); fail(Error('Training client disconnected during action')); };
      const timer = setTimeout(() => { cleanup(); fail(Error('Training physics tick timeout')); }, 5000);
      this.bot.on('physicsTick', tick); this.bot.once('end', end); this.bot.physicsEnabled = true;
    });
  }
  async reset(task: MotorTask, seed: number) {
    this.bot.clearControlStates(); this.bot.physicsEnabled = false;
    this.scene = new MotorSimulator(task, seed); this.task = task; this.seed = seed;
    // All mutations are confined to the owned, localhost, empty training world.
    for (const [lo, hi] of [[60, 63], [64, 67], [68, 70]]) await this.command(`fill -32 ${lo} -32 32 ${hi} 32 air`);
    const blocks = this.scene.truth().blocks;
    const xs = blocks.map(b => b.position[0]), zs = blocks.map(b => b.position[2]);
    await this.command(`fill ${Math.min(...xs)} 63 ${Math.min(...zs)} ${Math.max(...xs)} 63 ${Math.max(...zs)} stone`);
    // Compress identical obstacle/platform blocks into bounded rows; state is subsequently read from the game.
    const rows = new Map<string, number[]>();
    for (const b of blocks) if (b.position[1] !== 63 || b.stateId === 0) {
      const [x, y, z] = b.position, name = b.stateId === 0 ? 'air' : 'stone', key = `${x} ${y} ${name}`;
      const row = rows.get(key) ?? []; row.push(z); rows.set(key, row);
    }
    for (const [key, z] of rows) { const [x, y, name] = key.split(' '); await this.command(`fill ${x} ${y} ${Math.min(...z)} ${x} ${y} ${Math.max(...z)} ${name}`); }
    const initial = this.scene.observation(), [x, y, z] = initial.position;
    const teleported = new Promise<void>((done, fail) => { const timer = setTimeout(() => fail(Error('Training teleport acknowledgement timeout')), 5000); this.bot.once('forcedMove', () => { clearTimeout(timer); done(); }); });
    await this.command(`tp ${this.username} ${x} ${y} ${z} ${(Math.PI - initial.yaw) * 180 / Math.PI} 0`); await teleported;
    this.bot.entity.velocity.set(0, 0, 0); this.bot.jumpTicks = 0; this.bot.jumpQueued = false;
    this.bot.entity.yaw = initial.yaw; this.bot.entity.pitch = 0;
    await this.ticks(2); // Settle actual client/server physics before the episode starts.
    this.physicsTick = this.corrections = this.travelled = this.collisions = this.still = this.longestStill = this.followTicks = this.teacherRouteCalls = 0;
    this.terminal = this.success = false; this.failure = null; this.serverGoalConfirmed = null;
  }
  observation(): MotorObservation {
    const entity = this.bot.entity, p = entity.position, voxels: number[] = [];
    for (let x = -3; x <= 3; x++) for (let y = -2; y <= 2; y++) for (let z = -3; z <= 3; z++) {
      const block = this.bot.blockAt(new Vec3(Math.floor(p.x) + x, Math.floor(p.y) + y, Math.floor(p.z) + z), false);
      voxels.push(block ? 1 | (block.shapes.length ? 2 : 0) | (block.name === 'lava' ? 4 : 0) | (['lava', 'water'].includes(block.name) ? 8 : 0) : 0);
    }
    return { protocol: MOTOR_PROTOCOL, minecraftVersion: MOTOR_VERSION, tick: this.physicsTick, position: vector(p), velocity: vector(entity.velocity),
      yaw: entity.yaw, onGround: !!entity.onGround, goal: [...this.scene.goal], goalMode: 'final-target', voxels };
  }
  teacher(observation = this.observation()): number {
    if (!this.expert) {
      const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
      this.bot.loadPlugin(pathfinder); this.movements = new Movements(this.bot);
      this.movements.canDig = false; this.movements.allow1by1towers = false; this.movements.scafoldingBlocks = [];
      this.expert = goals;
    }
    this.teacherRouteCalls++;
    const [x, y, z] = observation.goal;
    const route = this.bot.pathfinder.getPathTo(this.movements, new this.expert.GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), .5), 100).path;
    let goal = observation.goal;
    for (const node of route) { goal = [node.x, node.y, node.z]; if (dist(goal, observation.position) > 1.4) break; }
    const world = { getBlock: (p: Vec3) => this.bot.blockAt(p, false) };
    return physicsTeacherAction(new PlayerState(this.bot, {}), Physics(this.bot.registry, world), world, goal);
  }
  async step(action: number) {
    if (this.terminal || !Number.isInteger(action) || !MOTOR_ACTIONS[action]) throw Error('Invalid/terminal training action');
    const a = MOTOR_ACTIONS[action], before = vector(this.bot.entity.position), previousDistance = dist(before, this.scene.goal);
    await this.bot.look(this.bot.entity.yaw + a.yawDelta, 0, true);
    for (const key of ['forward', 'jump', 'sprint'] as const) this.bot.setControlState(key, !!a[key]);
    await this.ticks(ACTION_TICKS); this.bot.clearControlStates();
    const after = vector(this.bot.entity.position), moved = dist(before, after);
    this.travelled += moved; this.still = moved < .015 ? this.still + ACTION_TICKS : 0; this.longestStill = Math.max(this.longestStill, this.still);
    if (this.bot.entity.isCollidedHorizontally) this.collisions += ACTION_TICKS;
    if (this.task === 'follow' || (this.task === 'recovery' && this.physicsTick === 20)) {
      const oldBlocks = this.scene.truth().blocks;
      // Advance the generated scenario clock only to schedule map changes/target motion; never to move the real body.
      while (this.scene.tick < this.physicsTick && !this.scene.terminal) this.scene.step(0);
      this.scene.observation();
      if (this.task === 'recovery') {
        const previous = new Map(oldBlocks.map(b => [b.position.join(','), b.stateId]));
        for (const b of this.scene.truth().blocks) if (previous.get(b.position.join(',')) !== b.stateId) await this.command(`setblock ${b.position.join(' ')} stone`);
      }
    }
    if (after[1] < 62 || this.bot.health <= 0) { this.terminal = true; this.failure = 'fell-or-hazard'; }
    const close = dist(after, this.scene.goal) < (this.task === 'follow' ? 2 : .8) && this.bot.entity.onGround;
    this.followTicks = close ? this.followTicks + ACTION_TICKS : 0;
    if (close && (this.task !== 'follow' || (this.physicsTick >= 180 && this.followTicks >= 30))) this.terminal = this.success = true;
    if (this.success) {
      let position = await this.serverPosition();
      if (dist(position, this.scene.goal) >= (this.task === 'follow' ? 2 : .8)) position = await this.serverPosition();
      this.serverGoalConfirmed = dist(position, this.scene.goal) < (this.task === 'follow' ? 2 : .8);
      if (!this.serverGoalConfirmed) { this.success = false; this.failure = 'server-goal-unconfirmed'; }
    }
    if (!this.terminal && this.physicsTick >= 420) { this.terminal = true; this.failure = 'timeout'; }
    if (this.corrections) { this.terminal = true; this.success = false; this.failure = 'server-position-correction'; }
    return { reward: previousDistance - dist(after, this.scene.goal) - .01 - (this.failure ? 10 : 0) + (this.success ? 10 : 0),
      terminal: this.terminal, success: this.success, failure: this.failure };
  }
  private async serverPosition(): Promise<Point> {
    const logs = await this.command(`data get entity ${this.username} Pos`);
    const match = logs.match(/entity data: \[([^\]]+)\]/);
    if (!match) throw Error('Actual Minecraft server position is unavailable');
    const serverPosition = match[1].split(',').map(v => Number(v.trim().replace(/[dDfF]$/, ''))) as Point;
    if (serverPosition.length !== 3 || !serverPosition.every(Number.isFinite)) throw Error('Invalid actual server position');
    return serverPosition;
  }
  async truth() {
    const serverPosition = await this.serverPosition();
    const cells: { position: number[]; stateId: number }[] = [];
    for (const { position } of this.scene.truth().blocks) {
      const block = this.bot.blockAt(new Vec3(...position as Point), false);
      if (!block) throw Error('Training truth chunk not loaded');
      cells.push({ position, stateId: block.stateId });
    }
    return { task: this.task, seed: this.seed, tick: this.physicsTick, goal: this.scene.goal, blocks: cells, serverPosition,
      serverClientDistance: dist(serverPosition, vector(this.bot.entity.position)), positionCorrections: this.corrections,
      travelled: this.travelled, collisionTicks: this.collisions, longestStillTicks: this.longestStill, teacherRouteCalls: this.teacherRouteCalls,
      serverGoalConfirmed: this.serverGoalConfirmed, mapSource: 'server-constructed scene verified against loaded client chunks',
      goalMode: 'final-target', success: this.success, failure: this.failure };
  }
  async close() {
    this.closing ??= this.stop();
    return this.closing;
  }
  private async stop() {
    if (this.bot) { this.bot.clearControlStates(); this.bot.physicsEnabled = false; this.bot.quit(); }
    if (this.child && !this.ended) {
      this.child.stdin.write('stop\n');
      await new Promise<void>(done => { const timer = setTimeout(() => { this.child?.kill(); done(); }, 15000); this.child!.once('exit', () => { clearTimeout(timer); done(); }); });
    }
    if (this.lock) { await this.lock.close(); await unlink(this.lockPath!); this.lock = undefined; }
  }
}
