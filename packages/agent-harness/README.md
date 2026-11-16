# agent-mc-harness (Phase 1)

Harness Runtime between a persona **host** (N.E.K.O / Cortico / DSH) and the Minecraft **body** (`agent-mc-world`).
The host submits intents and reads bounded summaries and key events; the harness owns intent state, memory wiring and
(optionally) execution. Design: [`docs/agent-harness-design.md`](../../docs/agent-harness-design.md).

Off by default. With `AGENT_HARNESS_ENABLED` unset nothing is created and the client options are returned unchanged.

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
| `src/integration.ts` | env config + `withAgentHarness` glue (memory + harness into client options) |

Stubbed in Phase 1: free-text planning (goal without `constraints.steps` → paused, needs host), reflection
implementation, real tokenizer. See the design doc.

```bash
pnpm install && pnpm test && pnpm typecheck   # tests include an end-to-end run through MinecraftAgentClient with a fake world
```
