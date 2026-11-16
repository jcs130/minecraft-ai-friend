/**
 * Tiny third-party agent (persona host) talking to a hosted harness only via messages.
 *
 *   HARNESS_URL=http://127.0.0.1:8787 HARNESS_TOKEN_ENV=NEKO_TOKEN pnpm example:agent
 *
 * The token is read from the env var NAMED by HARNESS_TOKEN_ENV and never printed.
 */
import { HarnessGatewayClient } from '../src/sdk/client.ts';
import type { HarnessEvent } from '../src/types.ts';

const url = process.env.HARNESS_URL ?? 'http://127.0.0.1:8787';
const tokenEnv = process.env.HARNESS_TOKEN_ENV;
const token = tokenEnv ? process.env[tokenEnv] : undefined;

const client = new HarnessGatewayClient({ url, token, clientName: 'example-agent', onStatus: s => console.log(`[status] ${s}`) });
const welcome = await client.connect();
console.log(`[welcome] agent=${welcome.agent} exclusiveBody=${welcome.server.exclusiveBody} stream=${welcome.stream}`);

let finish!: () => void;
const finished = new Promise<void>(resolve => { finish = resolve; });
let intentId = '';
// Events for an intent can arrive before submit_intent's response (the harness starts work at once), so queue them.
const seen: HarnessEvent[] = [];

async function react(event: HarnessEvent): Promise<void> {
  if (!intentId || event.intentId !== intentId || event.kind !== 'intent_state') return;
  const data = event.data as { state?: string; needsHost?: boolean };
  if (data.needsHost) {
    // The harness has no free-text planner yet: the host (this agent) decides the concrete steps.
    console.log('[agent] harness needs concrete steps → supplying them');
    await client.updateIntent(intentId, { constraints: { steps: [{ tool: 'mc_do', args: { steps: [{ skill: 'fish' }] } }] } });
    await client.resume(intentId);
  }
  if (data.state === 'done' || data.state === 'failed' || data.state === 'cancelled') finish();
}

await client.subscribe(event => {
  console.log(`[event #${event.seq}] (${event.kind}, sev ${event.severity}) ${event.text}`);
  if (!intentId) seen.push(event); else void react(event);
}, { minSeverity: 1 });

({ intentId } = await client.submitIntent({ goal: '去河边钓一会儿鱼', priority: 'normal', hostRef: 'example-1' }));
console.log(`[agent] submitted ${intentId}`);
for (const e of seen.splice(0)) await react(e);
await finished;
console.log(`[summary]\n${(await client.getSummary({ maxTokens: 200 })).text}`);
await client.close();
