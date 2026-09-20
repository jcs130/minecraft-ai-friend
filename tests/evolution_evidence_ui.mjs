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
    parent: { QwenPaw: { paw: { forApp: () => ({ api: {
      get: async () => ({ roles: [], metrics: { survival } }),
    } }) } } },
  });
  vm.runInContext(script, context);
  await vm.runInContext('tick()', context);
  const rendered = elements.get('metrics').innerHTML;
  assert.ok(rendered.includes(expected), expected);
  assert.ok(!rendered.includes(absent), absent);
}
console.log('4 evolution evidence renderer cases passed');

// A real pause, rejected contracts and missing rate stay visible; a failed
// refresh must retain the last reading and explicitly mark it as stale.
const nodes = new Map();
let fail = false;
const live = {schema:2,roles:[],metrics:{survival:{schema:2,at:100,ageMinutes:10,
  generation:{status:'current',memoryEpoch:'test-epoch',startedAt:1000},
  runtime:{status:'paused',enabled:false,pauseReason:'controller_FileNotFoundError'},
  evidence:{coverage:{currentGeneration:24,readFailures:1,sampleTruncated:true},errors:['bad.json']},
  closedLoop:{rate:null,sampled:24,succeeded:0,outcomes:{rejected:24,unknown:1}},
  repeats:{share:null},trends:{buckets:[{from:100,to:200,rate:null,sampled:0,succeeded:0}]},
  behaviors:[{category:'contracts',sampled:24,succeeded:0,tools:{guild_claim:24},outcomes:{rejected:24}}],
}},proposals:[{id:'case-test',title:'<img src=x onerror=bad()>',status:'open'}]};
const context=vm.createContext({document:{getElementById(id){if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);}},
  parent:{QwenPaw:{paw:{forApp:()=>({api:{get:async()=>{if(fail)throw new Error('offline');return live;}}})}}}});
vm.runInContext(script,context);await vm.runInContext('tick()',context);
assert.ok(nodes.get('runtime').textContent.includes('controller_FileNotFoundError'));
assert.ok(nodes.get('scope').textContent.includes('数据已过期'));
assert.ok(nodes.get('behaviors').innerHTML.includes('guild_claim'));
assert.ok(nodes.get('behaviors').innerHTML.includes('24'));
assert.ok(!nodes.get('trend').innerHTML.includes('NaN'));
assert.ok(nodes.get('proposals').innerHTML.includes('&lt;img'));
const previous=nodes.get('metrics').innerHTML;fail=true;await vm.runInContext('tick()',context);
assert.equal(nodes.get('metrics').innerHTML,previous);
assert.equal(nodes.get('error').hidden,false);
assert.ok(nodes.get('error').textContent.includes('上次读取结果'));
console.log('Live pause, partial evidence, escaping and failed refresh verified');
