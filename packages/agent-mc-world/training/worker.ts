/** One offline fixture per process; JSON-lines IPC never accepts code or server addresses. */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MotorSimulator } from '../src/motor/simulator.ts';
import { MOTOR_ACTIONS, MOTOR_PROTOCOL, FEATURE_COUNT, motorFeatures, loadMotorPolicy, type MotorPolicy } from '../src/motor/policy.ts';
let env: MotorSimulator | undefined;
let policy: ReturnType<typeof loadMotorPolicy> | undefined;
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const command = JSON.parse(line);
    if (command.op === 'hello') { console.log(JSON.stringify({ protocol: MOTOR_PROTOCOL, featureCount: FEATURE_COUNT, actionNames: MOTOR_ACTIONS.map(a => a.name), simulation: 'prismarine-physics@1.11.1', minecraftVersion: '1.21.1',
      sourceHashes: Object.fromEntries(['../src/motor/policy.ts', '../src/motor/simulator.ts', './worker.ts'].map(path => [path, createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex')])) })); continue; }
    if (command.op === 'load') { policy = loadMotorPolicy(JSON.parse(readFileSync(command.path, 'utf8')) as MotorPolicy); console.log('{"loaded":true}'); continue; }
    if (command.op === 'infer') {
      if (!policy) throw Error('Load a motor policy first');
      const started = performance.now(), action = policy(command.observation);
      console.log(JSON.stringify({ action, elapsedMs: performance.now() - started })); continue;
    }
    if (command.op === 'reset') env = new MotorSimulator(command.task, command.seed);
    if (!env) throw Error('Reset the offline fixture first');
    const result = command.op === 'step' ? env.step(command.action) : {};
    if (!['reset', 'step', 'observe'].includes(command.op)) throw Error('Unknown training command');
    const observation = env.observation();
    const inferenceStart = performance.now(), selected = policy ? policy(observation) : null, policyElapsedMs = policy ? performance.now() - inferenceStart : null;
    console.log(JSON.stringify({ ...result, observation, features: motorFeatures(observation), teacher: command.teacher ? env.teacher(observation) : null,
      policy: selected, policyElapsedMs, truth: command.truth ? env.truth() : null }));
  } catch (error) { console.log(JSON.stringify({ error: String(error) })); }
}
