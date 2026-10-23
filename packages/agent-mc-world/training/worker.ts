/** One offline fixture per process; JSON-lines IPC never accepts code or server addresses. */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { MotorSimulator } from '../src/motor/simulator.ts';
import { MinecraftMotorEnvironment } from '../src/motor/minecraft-simulation.ts';
import { MOTOR_ACTIONS, MOTOR_PROTOCOL, FEATURE_COUNT, motorFeatures, loadMotorPolicy, type MotorPolicy } from '../src/motor/policy.ts';
const configuration = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : {};
if (configuration.backend !== undefined && !['offline', 'minecraft'].includes(configuration.backend)) throw Error('Unknown motor backend');
const goalMode = configuration.goalMode ?? 'final-target';
if (!['final-target', 'teacher-waypoint'].includes(goalMode)) throw Error('Invalid goal mode');
const minecraft = configuration.backend === 'minecraft' ? new MinecraftMotorEnvironment() : undefined;
if (minecraft && goalMode !== 'final-target') throw Error('Actual Minecraft training only accepts final-target inputs');
let env: MotorSimulator | MinecraftMotorEnvironment | undefined;
let policy: ReturnType<typeof loadMotorPolicy> | undefined;
let episodeId: string | undefined;
try {
if (minecraft) await minecraft.start(configuration.minecraft);
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const command = JSON.parse(line);
    if (command.op === 'hello') { console.log(JSON.stringify({ protocol: MOTOR_PROTOCOL, featureCount: FEATURE_COUNT, actionNames: MOTOR_ACTIONS.map(a => a.name),
      simulation: minecraft ? 'Minecraft-Java-1.21.1-with-Mineflayer' : 'prismarine-physics@1.11.1', minecraftVersion: '1.21.1',
      backend: minecraft ? 'minecraft' : 'offline', goalMode, serverJarSha256: minecraft?.serverJarSha256 ?? null,
      observationSource: minecraft ? 'loaded Minecraft client chunks and player state; server positions checked separately' : 'generated local voxel/state fixture',
      sourceHashes: Object.fromEntries(['../src/motor/policy.ts', '../src/motor/simulator.ts', '../src/motor/minecraft-simulation.ts', './worker.ts'].map(path => [path, createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex')])) })); continue; }
    if (command.op === 'load') { policy = loadMotorPolicy(JSON.parse(readFileSync(command.path, 'utf8')) as MotorPolicy); console.log('{"loaded":true}'); continue; }
    if (command.op === 'infer') {
      if (!policy) throw Error('Load a motor policy first');
      const started = performance.now(), action = policy(command.observation);
      console.log(JSON.stringify({ action, elapsedMs: performance.now() - started })); continue;
    }
    if (command.op === 'reset') {
      if (minecraft) { await minecraft.reset(command.task, command.seed); env = minecraft; } else env = new MotorSimulator(command.task, command.seed, goalMode);
      episodeId = `${command.task}/${command.seed}/${randomUUID()}`;
    }
    if (!env) throw Error('Reset the offline fixture first');
    const result = command.op === 'step' ? await env.step(command.action) : {};
    if (!['reset', 'step', 'observe'].includes(command.op)) throw Error('Unknown training command');
    const observation = env.observation();
    const inferenceStart = performance.now(), selected = policy ? policy(observation) : null, policyElapsedMs = policy ? performance.now() - inferenceStart : null;
    console.log(JSON.stringify({ ...result, episodeId, observation, features: motorFeatures(observation), teacher: command.teacher ? env.teacher(observation) : null,
      policy: selected, policyElapsedMs, truth: command.truth ? await env.truth() : null }));
  } catch (error) { console.log(JSON.stringify({ error: String(error) })); }
}
} finally { await minecraft?.close(); }
