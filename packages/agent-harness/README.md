# agent-mc-harness (Phase 1)

Harness Runtime between a persona **host** (N.E.K.O / Cortico / DSH) and the Minecraft **body** (`agent-mc-world`).
The host submits intents and reads bounded summaries and key events; the harness owns intent state, memory wiring and
(optionally) execution. Design: [`docs/agent-harness-design.md`](../../docs/agent-harness-design.md).

Two ways to run it:

1. **Hosted runtime (recommended)** — `pnpm serve <client-config.json>` (or `--fake-body`) starts body + harness +
   message gateway in one process. Third-party agents connect with JSON messages over WebSocket/HTTP/SSE
   ([protocol](../../docs/agent-harness-protocol.md)); the harness drives the body exclusively.
2. **In-process** — `withAgentHarness(clientOptions)`; off by default. With `AGENT_HARNESS_ENABLED` unset nothing is
   created and the client options are returned unchanged.

```ts
import { MinecraftAgentClient } from 'agent-mc-world/client';
import { withAgentHarness, harnessConfigFromEnv } from 'agent-mc-harness';

const { options, integration } = withAgentHarness(clientOptions, harnessConfigFromEnv());
const client = new MinecraftAgentClient(options, world);
integration?.attachClient(client);          // binds the body only when AGENT_HARNESS_EXECUTE=1
// host now sees harness_submit_intent / harness_get_summary / harness_events / harness_control
// in-process hosts can use integration.harness (HarnessApi) directly, e.g. harness.subscribe(e => …, { minSeverity: 3 })
```

| File | Purpose |
| --- | --- |
| `src/types.ts` | public contract: `HarnessApi`, `Intent`, `HarnessEvent`, `Summary` |
| `src/harness.ts` | `HarnessRuntime` — composes everything; `observer` for body events |
| `src/intents.ts` | priority queue + state machine + JSON persistence |
| `src/executor.ts` | single-lane executor, preemption, task-receipt waiting |
| `src/planner.ts` | `BodyPort`, `Planner`, `ExplicitStepsPlanner` (allow-listed tools) |
| `src/events.ts` | `EventHub` (push + pull ring buffer), `classifyBodyEvent` |
| `src/summary.ts`, `src/tokens.ts` | Hot summary under a token budget |
| `src/workers.ts`, `src/reflection.ts` | async worker queue; reflection interfaces (stub) |
| `src/tools.ts` | host tools |
| `src/integration.ts` | env config + `withAgentHarness` glue (memory + harness + optional `bodyGate`) |
| `src/gateway/` | message protocol v1, auth/tokens, limits, transport-free core, HTTP/WS/SSE server |
| `src/sdk/client.ts` | dependency-free TS client SDK (WS with auto-resume, or HTTP polling) |
| `src/server/serve.ts`, `cli.ts` | hosted runtime entry (`pnpm serve`) |
| `src/body/` | unified body adapter `agent-mc-body/v1`: Mineflayer, Numen (hosted / mcbot), Touhou Little Maid, `guardBody` safety |
| `src/testing/fake-world.ts` | offline fake body for tests/demos |
| `examples/` | TS third-party agent, stdlib-only Python agent |

Stubbed in Phase 1: free-text planning (goal without `constraints.steps` → paused, needs host), reflection
implementation, real tokenizer. See the design doc.

```bash
pnpm install && pnpm test && pnpm typecheck   # includes gateway e2e through MinecraftAgentClient with a fake world

# local demo without Minecraft
export NEKO_TOKEN="$(openssl rand -hex 24)"
export AGENT_HARNESS_GATEWAY_AGENTS='{"agents":[{"id":"neko","tokenEnv":"NEKO_TOKEN"}]}'
pnpm serve --fake-body --data-dir /tmp/harness-demo &
HARNESS_TOKEN_ENV=NEKO_TOKEN pnpm example:agent
HARNESS_TOKEN_ENV=NEKO_TOKEN python3 examples/python_agent.py
```

## Unified body adapter (`agent-mc-body/v1`)

The harness never talks to a body directly: it uses `BodyAdapter` (`src/body/types.ts`): perception events, action verbs,
lifecycle (spawn / reconnect / destroy), identity + world scope, capability discovery, health, and safety hooks.

```ts
import { MaidBodyAdapter, guardBody } from 'agent-mc-harness';
const body = guardBody(new MaidBodyAdapter({ connection: ownerBot, maidId, serverId: 'survival' })); // anti-cheat stop + pace limits
await body.spawn();                       // binds an existing maid; never creates one
harness.attachBody(body, { execute: true });
await harness.submitIntent({ goal: 'come here', constraints: { steps: [{ tool: 'body:follow', args: {} }] } });
```

Bodies: Mineflayer (`MineflayerBodyAdapter`, agent-mc-world client), Numen (`numenHostedAdapter()` for numen-hosting, or
`NumenBodyAdapter` + `McbotNumenPort` over the owner's connection), Touhou Little Maid (`MaidBodyAdapter`, touhou-maids
`maid-port.mjs`). Steps are `body:<verb>` / `body:native:<name>`; unsupported steps are refused before execution.
Capability matrix, reuse map and gaps: `docs/agent-harness-body-adapter.md`.
