// Harness² host driver: the EXISTING agent-mc-world Harness2Runner (journal, budgets, held-out gate) + the EXISTING
// createPhysicsMethodPractice (MethodRunner sandbox, Java 1.21.1 prismarine collision physics, isolated binding),
// spawning the EXISTING bridges/harness2/worker.py (pinned google-research/harness2 1cfe254e).
// The only thing supplied from Python is the model port: every model request is forwarded over stdout as
//   {"type":"model","id":n,"request":{id,stage,mission,files}}  and answered on stdin as {"id":n,"reply":{...}}.
// First stdin line: {"world": <agent-mc-world dir>, "directory", "worker": {command, script, workspace},
//                    "practice": {directory, seeds, binding}, "job": <Harness2Job minus train/holdout>, "modelId"}.
// Final stdout line: {"type":"result","result":<Harness2Result>,"fixtures":[...],"stats":{...}} or {"type":"error","message"}.
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();
const first = JSON.parse((await iterator.next()).value);
const out = value => process.stdout.write(JSON.stringify(value) + '\n');
const pending = new Map(); let serial = 0;
(async () => { for (;;) { const next = await iterator.next(); if (next.done) break;
  const msg = JSON.parse(next.value); const p = pending.get(msg.id); if (!p) continue; pending.delete(msg.id);
  msg.error ? p.reject(new Error(String(msg.error).slice(0, 200))) : p.resolve(msg.reply); } })();
try {
  const dist = p => pathToFileURL(join(first.world, 'dist/runtime/src', p)).href;
  const { Harness2Runner } = await import(dist('decisions/index.js'));
  const { createPhysicsMethodPractice } = await import(dist('learning/index.js'));
  const practice = createPhysicsMethodPractice(first.practice);
  const [train, ...holdout] = practice.fixtures;
  const model = { id: first.modelId, generate: request => new Promise((resolve, reject) => {
    const id = ++serial; pending.set(id, { resolve, reject }); out({ type: 'model', id, request }); }) };
  const runner = new Harness2Runner({ directory: first.directory, worker: first.worker, model, practice: practice.executor });
  const result = await runner.run({ ...first.job, train, holdout });
  out({ type: 'result', result, fixtures: practice.fixtures, stats: practice.stats?.() ?? null });
  process.exit(0);
} catch (error) {
  out({ type: 'error', message: String(error?.message ?? error).slice(0, 500) });
  process.exit(1);
}
