/**
 * Synthetic smoke (no Minecraft server): player joins, states a preference, sets a home, later moves it.
 *   pnpm exec tsx scripts/smoke.ts --backend local|graphiti [--dir DIR] [--url URL]
 * `graphiti` = hybrid backend against a running sidecar (see graphiti-sidecar/README in ../README.md).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentMemory, fromEvent, homeSet, renderFact } from '../src/index.ts';

const arg = (name: string, d: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1]! : d; };
const backend = arg('backend', 'local');
const dir = arg('dir', mkdtempSync(join(tmpdir(), 'agent-memory-smoke-')));
const memory = new AgentMemory({ dataDir: dir, backend: backend === 'graphiti' ? 'hybrid' : 'local',
  graphiti: { url: arg('url', 'http://127.0.0.1:8765'), timeoutMs: 300_000 },
  onWarning: (m, d) => console.warn('WARN', m, JSON.stringify(d)) });
const scope = memory.scope({ realm: 'smoke:qiandengji-local|', account: 'offline:Komi', agent: 'komi' });
const world = { key: 'minecraft:overworld', dimensionType: 'minecraft:overworld', revision: 1 };
const ctx = { self: 'Komi', world };

const steps = [
  fromEvent({ type: 'minecraft.enter', ts: '2026-11-01T10:00:00Z', text: '[Minecraft] 玩家 Steve 进入了服务器。', meta: { uname: 'Steve' }, cursor: 1 }, ctx)!,
  fromEvent({ type: 'minecraft.chat', ts: '2026-11-01T10:01:00Z', text: '[MC 私聊] Steve: Komi你好！我最喜欢红石机械了，以后一起做自动农场吧', meta: { uname: 'Steve' }, cursor: 2 }, ctx)!,
  homeSet({ owner: 'Steve', name: 'base', pos: { x: 100, y: 64, z: 200 }, world, at: '2026-11-01T10:05:00Z',
    text: 'Steve 在 minecraft:overworld 的 (100, 64, 200) 设置了家 base（/sethome base）。' }),
  homeSet({ owner: 'Steve', name: 'base', pos: { x: -300, y: 70, z: 50 }, world, at: '2026-11-05T09:00:00Z',
    text: 'Steve 把家 base 搬到了 minecraft:overworld 的 (-300, 70, 50)，旧家 (100, 64, 200) 不再使用。' }),
  fromEvent({ type: 'minecraft.leave', ts: '2026-11-05T09:30:00Z', text: '[Minecraft] 玩家 Steve 离开了服务器。', meta: { uname: 'Steve' }, cursor: 3 }, ctx)!,
];

const t0 = Date.now();
for (const s of steps) {
  const r = await scope.ingest(s);
  console.log(`ingest ${r.episode.kind.padEnd(11)} local +${r.local.added.length} ~${r.local.confirmed.length} -${r.local.invalidated.length}${r.queuedForGraphiti ? ' → graphiti queued' : ''}`);
}
await memory.flush();
console.log(`stats ${JSON.stringify(memory.stats)} in ${((Date.now() - t0) / 1000).toFixed(1)}s; health ${JSON.stringify(await memory.health())}`);

const show = async (title: string, p: Promise<{ facts: import('../src/index.ts').Fact[]; degraded?: string }>) => {
  const r = await p; console.log(`\n## ${title}${r.degraded ? ` (degraded: ${r.degraded})` : ''}`);
  for (const f of r.facts) console.log(renderFact(f));
};
await show('current: Steve', scope.currentFacts({ entity: 'Steve', text: backend === 'graphiti' ? 'Steve home base redstone' : undefined }));
await show('valid at 2026-11-03 (before move): Steve home', scope.factsAt('2026-11-03T00:00:00Z', { entity: 'Steve', text: backend === 'graphiti' ? 'Steve home base' : undefined }));
await show('valid now: Steve home', scope.factsAt('2026-11-10T00:00:00Z', { entity: 'Steve', text: backend === 'graphiti' ? 'Steve home base' : undefined }));
await show('history: home:base (local)', scope.history({ entity: 'home:base' }));
console.log(`\ncold episodes: ${scope.episodeCount()} (dir ${dir})`);
await memory.close();
