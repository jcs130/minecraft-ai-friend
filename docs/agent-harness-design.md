# Agent Harness Runtime — design (Phase 1)

Status: Phase 1 implemented on branch `feat/agent-harness-phase1` (local). Feature flag **off by default**.

## Three layers

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Host  (N.E.K.O / Cortico Persona / DSH)                                    │
│  decides WHAT to do · persona · conversation · long-term host memory       │
└──────────────┬───────────────────────────────────────────▲─────────────────┘
               │ harness_submit_intent / harness_control   │ harness_get_summary (≤N tokens)
               │ (submitIntent, pause, resume, update,     │ harness_events (pull) / subscribe (push)
               ▼  cancel)                                  │ [optional] HostMemoryWriter (reflection notes)
┌───────────────────────────────────────────────────────────────────────────┐
│ Harness Runtime  (packages/agent-harness · agent-mc-harness)               │
│  IntentManager (priority queue, state machine, JSON persistence)           │
│  IntentExecutor (single lane, Planner → body steps, receipt tracking)      │
│  EventHub (key-event classification, ring buffer, push + pull)             │
│  Summary builder (Hot, token budget)                                       │
│  Memory: agent-mc-memory  Hot=summary · Warm=SQLite facts · Cold=episodes  │
│          + Graphiti (optional sidecar, async)                              │
│  AsyncWorkers (reflection) · Reflector / HostMemoryWriter (interfaces)     │
└──────────────┬───────────────────────────────────────────▲─────────────────┘
               │ BodyPort.call(mc_do / mc_stop / …)        │ eventObservers(EventEnvelope, facts)
               ▼                                           │
┌───────────────────────────────────────────────────────────────────────────┐
│ Body / Adapter  (packages/agent-mc-world)                                  │
│  perception · actions · world identity · MCP · event reporting             │
│  no long-term memory, no persona, no complex decisions                     │
└───────────────────────────────────────────────────────────────────────────┘
```

Package boundaries:

| Package | Owns | Depends on |
| --- | --- | --- |
| `agent-mc-world` | body; exposes two passive hooks `eventObservers`, `extraTools` (commit `10190e52`) | — |
| `agent-mc-memory` | episodes, bi-temporal facts, cold store, Graphiti client/sidecar, memory tools | nothing at runtime (structural types only) |
| `agent-mc-harness` | intents, executor, events, summary, workers, host tools, **integration glue** | `agent-mc-memory` (link) ; structural types of `agent-mc-world` |

`agent-mc-world` imports neither package. The only body change is the two optional client options; with neither set it
behaves exactly as before.

## Data flow

1. Body event → `host.pushEvent` → journal → `eventObservers` → `HarnessRuntime.observer(event, facts)`.
2. The observer fans out (each isolated, never throws into the body):
   - `memory.observer` → Episode (cold JSONL + SQLite) → extracted facts (Warm) → Graphiti episode (async, hybrid only);
   - `executor.observeExecution` → resolves terminal task receipts for the running intent step;
   - `classifyBodyEvent` → `HarnessEvent` → ring buffer + subscribers; death / task_failed → reflection worker.
3. Host reads `harness_get_summary` (Hot) built from: active intent, recent key events (severity ≥2),
   topic-relevant memory facts (local + Graphiti when a topic is given), paused/queued intents.

## Host-facing interface (TypeScript)

```ts
type IntentState = 'queued' | 'active' | 'paused' | 'done' | 'cancelled' | 'failed';
type PriorityInput = number | 'low' | 'normal' | 'high' | 'urgent';   // 20 / 50 / 75 / 95; ≥90 may preempt
interface BodyStep { tool: string; args: Record<string, unknown>; note?: string }
interface IntentConstraints { steps?: BodyStep[]; deadlineMs?: number; rules?: string[]; [key: string]: unknown }
interface IntentInput { goal: string; priority?: PriorityInput; constraints?: IntentConstraints; hostRef?: string }
interface Intent { id; goal; priority: number; constraints; hostRef: string|null; state: IntentState; reason: string|null;
  createdAt; updatedAt; startedAt: string|null; endedAt: string|null; plan: BodyStep[]|null; stepIndex; attempts; result: string|null }
interface IntentPatch { goal?: string; priority?: PriorityInput; constraints?: IntentConstraints }
type HarnessEventKind = 'death'|'task_completed'|'task_failed'|'interaction'|'skill'|'player_presence'|'intent_state'|'reflection';
interface HarnessEvent { seq: number; at: string; kind: HarnessEventKind; severity: 1|2|3; text: string; intentId?: string; data?: Record<string, unknown> }
interface SummaryOptions { topic?: string; maxTokens?: number }               // budget default 300, clamped 80..800
interface Summary { text: string; tokens: number; budget: number; truncated: boolean; generatedAt: string }

interface HarnessApi {
  submitIntent(input: IntentInput): Promise<{ intentId: string; state: IntentState }>;
  getSummary(options?: SummaryOptions): Promise<Summary>;
  subscribe(listener: (event: HarnessEvent) => void, filter?: { minSeverity?: 1|2|3 }): () => void;
  pullEvents(options?: { after?: number; limit?: number; minSeverity?: 1|2|3 }): { events: HarnessEvent[]; latest: number; dropped: boolean };
  pause(intentId?: string, reason?: string): Promise<Intent | null>;   // no id → pause whole executor
  resume(intentId?: string): Promise<Intent | null>;
  updateIntent(intentId: string, patch: IntentPatch): Promise<Intent>;
  cancel(intentId: string, reason?: string): Promise<Intent>;
  getIntent(intentId: string): Intent | null;
  listIntents(options?: { states?: IntentState[]; limit?: number }): Intent[];
}
```

Host tools (registered via `extraTools`, compact JSON results):

| Tool | Args |
| --- | --- |
| `harness_submit_intent` | `goal`, `priority?`, `constraints?` (`steps`, `deadlineMs`, `rules`), `hostRef?` |
| `harness_get_summary` | `topic?`, `max_tokens?` (80–800) |
| `harness_events` | `after?`, `limit?`, `min_severity?` |
| `harness_control` | `action` = pause \| resume \| cancel \| update \| get \| list, `intent_id?`, `reason?`, `goal?`, `priority?`, `constraints?`, `states?` (list) |

Extension points (harness side):

```ts
interface BodyPort { call(tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<BodyOutcome> }
interface Planner { plan(intent: Intent, context: { summary(): Promise<string> }): Promise<{ steps: BodyStep[] } | { needsHost: string }> }
interface Reflector { reflect(trigger: ReflectionTrigger, signal: AbortSignal): Promise<ReflectionNote | null> }
interface HostMemoryWriter { write(note: ReflectionNote, trigger: ReflectionTrigger): Promise<void> }
```

## Intent state machine

```
queued ──► active ──► done | failed | cancelled
  ▲  │       │  └──► queued   (preempted by urgent / executor paused / restart)
  │  │       └─────► paused   (host pause, planner needs host)
  │  └──► paused ──► queued (resume) | cancelled
  └──────────────────┘
```

* One active intent at a time (single body). Next = highest priority, then oldest.
* `urgent` (≥90) preempts a lower-priority active intent (abort + `mc_stop`, back to queued; it resumes from `stepIndex`).
* An active intent cannot change goal/constraints — pause first. Changing constraints drops the cached plan.
* Steps: body call → `failed` outcome fails the intent; a non-terminal receipt (`accepted`/`running`) waits for the
  terminal task event with the same id (`stepTimeoutMs` 10 min default, `constraints.deadlineMs`); phase must be `completed`.
* Persistence: `<dir>/intents.json` (atomic rename). An intent active at shutdown becomes queued on reload.

## Feature flags

| Variable | Default | Effect |
| --- | --- | --- |
| `AGENT_HARNESS_ENABLED` | off | master switch; off → `withAgentHarness` returns the same options object and `null` |
| `AGENT_HARNESS_EXECUTE` | off | let the harness drive the body; off → intents are tracked only (host keeps control) |
| `AGENT_HARNESS_DIR` | `<dataDir>/agent-harness` | intents + memory directory |
| `AGENT_HARNESS_MEMORY` | on (when enabled) | wire agent-mc-memory |
| `AGENT_HARNESS_MEMORY_TOOLS` | off | also expose `memory_*` tools to the host |
| `AGENT_MEMORY_BACKEND` / `AGENT_MEMORY_GRAPHITI_URL` / `AGENT_MEMORY_GRAPHITI_TOKEN_ENV` | local / 127.0.0.1:8765 / — | see agent-memory README (token env holds a variable **name**) |

## What is stubbed / honest limits (Phase 1)

* **Planner**: only `ExplicitStepsPlanner` (host-provided `constraints.steps`, ≤20, allow-listed body tools). A free-text
  goal is accepted but parked as `paused` with reason "No planner for a free-text goal yet" and a severity-3 event.
* **Reflection**: interfaces + async worker only; no default reflector, no host-memory writer implementation.
* **Hot summary**: deterministic template + heuristic token estimate (CJK 1 token/char, others 1/3.5 chars), not a tokenizer.
* **Execution** is opt-in because current DSH hosts also drive the body directly; both at once would conflict.
* Key-event classification is rule-based (death, task terminal, level-up text, whisper/mention, join/leave).

## Roadmap

* **Phase 2** — LLM planner (goal → `mc_do` steps, budgeted, using summary + Warm facts); reflection worker writing
  lessons into Warm memory + `HostMemoryWriter`; DSH host adapter (one host owns the body when `EXECUTE=1`);
  progress events for long tasks; FalkorDB as Graphiti backend.
* **Phase 3** — skill/lesson library learned from reflections, multi-intent scheduling (interruptible background goals),
  self-evaluation metrics, out-of-process harness (MCP server) so several hosts can share one body safely.
