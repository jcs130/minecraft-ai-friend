// Execute the real inline renderer with a minimal DOM; no network or live writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = JSON.parse(readFileSync(0, 'utf8'));
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  .replace('tick(); setInterval(tick, 60000);', '');
for (const [survival, expected, absent] of [
  [{ schema: 2, closedLoop: { rate: null }, repeats: { share: null } }, '证据不足', '0%'],
  [{ schema: 2, closedLoop: { rate: .76 }, repeats: { share: .08 } }, '动作确认成功 76%', '旧口径'],
  [{ schema: 1, closedLoop: { rate: .42 }, repeats: { share: 1 } }, '旧口径闭环 42%', '同参连续重复'],
  [{}, '证据不足', '0%'],
]) {
  const elements = new Map();
  const context = vm.createContext({
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, {});
      return elements.get(id);
    } },
    fetch: async () => ({ json: async () => ({ roles: [], metrics: { survival } }) }),
  });
  vm.runInContext(script, context);
  await vm.runInContext('tick()', context);
  const rendered = elements.get('metrics').innerHTML;
  assert.ok(rendered.includes(expected), expected);
  assert.ok(!rendered.includes(absent), absent);
}
console.log('4 evolution evidence renderer cases passed');
