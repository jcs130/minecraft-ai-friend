# Agent Harness Runtime — design (Phase 1)

Status: Phase 1 + 1b (server-hosted runtime with message gateway) implemented on branch `feat/agent-harness-phase1`
(local). Nothing changes unless the harness is explicitly enabled (`AGENT_HARNESS_ENABLED=1`) or the server is
explicitly launched (`pnpm serve`). Wire protocol: [agent-harness-protocol.md](agent-harness-protocol.md).

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
| `AGENT_HARNESS_EXCLUSIVE` | = `AGENT_HARNESS_EXECUTE` | install `bodyGate`: hosts see only `harness_*` tools; requires EXECUTE |
| `AGENT_HARNESS_DIR` | `<dataDir>/agent-harness` | intents + memory directory |
| `AGENT_HARNESS_MEMORY` | on (when enabled) | wire agent-mc-memory |
| `AGENT_HARNESS_MEMORY_TOOLS` | off | also expose `memory_*` tools to the host |
| `AGENT_MEMORY_BACKEND` / `AGENT_MEMORY_GRAPHITI_URL` / `AGENT_MEMORY_GRAPHITI_TOKEN_ENV` | local / 127.0.0.1:8765 / — | see agent-memory README (token env holds a variable **name**) |

## Phase 1b — server-hosted runtime and message gateway

Decision (2026-11-16): the harness is the **server-hosted agent runtime**. Third-party agents connect through a
lightweight message interface and never call `mc_*` tools; when the harness executes it is the body's only driver.

```
 third-party agents (N.E.K.O · Cortico · DSH · Python · …)
        │  JSON messages v1: hello · submit_intent · update_intent · control · get_summary
        │                    subscribe/unsubscribe · pull_events · ping        ▲ event pushes
        ▼  WebSocket /v1/ws  ·  HTTP POST /v1/messages  ·  SSE /v1/events/stream │
┌──────────────────────────────── one server process (`pnpm serve`) ─────────────────────────┐
│ Gateway  auth (per-agent tokens, constant-time) · ownership · rate limits · size limits     │
│          loopback bind by default · origin check · resume by (stream, seq)                  │
│ Harness  intents · executor · events · summary · memory (agent-mc-memory)                    │
│ Body     MinecraftAgentClient (agent-mc-world) with bodyGate: mc_* callable only with the    │
│          harness's bodyKey; hosts/MCP/context see only harness_* tools                       │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

Files: `src/gateway/{protocol,auth,limits,core,server,index}.ts`, `src/sdk/client.ts`, `src/server/{serve,cli}.ts`,
`src/testing/fake-world.ts`, `examples/{third-party-agent.ts,python_agent.py}`.

### Exclusive body control

`agent-mc-world` gained one more optional client option (default absent → unchanged behaviour):

```ts
interface MinecraftBodyGate { key: object; expose: (toolName: string) => boolean }
MinecraftClientOptions.bodyGate?: MinecraftBodyGate
CallOptions.bodyKey?: object
```

Tools with `expose(name) === false` disappear from `client.tools()` (therefore from the MCP tool list, model context and
fast-action paths) and `client.call()` refuses them unless `options.bodyKey` is the very same object. Only the harness
holds the key (created inside `withAgentHarness`, never serialised). `AGENT_HARNESS_EXCLUSIVE` defaults to
`AGENT_HARNESS_EXECUTE`; exclusive without execute is a configuration error. `pnpm serve` always executes and is
exclusive unless `AGENT_HARNESS_EXCLUSIVE=0`.

### Switching hosts to gateway mode

| Host | Today | Gateway mode |
| --- | --- | --- |
| DSH (run35 style) | launches the body (`minecraft-agent-mcp <config>` / in-process client) and calls `mc_*` | run `pnpm serve <same client config>` instead; DSH connects to `ws://127.0.0.1:8787/v1/ws` with its token, submits intents with `constraints.steps` built from what it used to send as `mc_do`, subscribes to events, reads `get_summary` instead of raw observations. DSH's own model loop keeps planning *what*; the harness does the *doing*. |
| N.E.K.O | — | plugin/adapter using the TS SDK (`agent-mc-harness/sdk`) or raw WS JSON; maps persona decisions to `submit_intent`, shows `severity ≥ 2` events in chat, uses `get_summary(topic)` as game context. |
| Cortico Persona | — | same as N.E.K.O; non-TS stacks can use HTTP + `pull_events` (see `examples/python_agent.py`). |

Migration steps: (1) issue a token per host (`openssl rand -hex 24` into an env var; reference it by `tokenEnv`),
(2) start `pnpm serve` on the body machine, (3) remove direct `mc_*` access from the host (with `bodyGate` they are not
offered anyway), (4) translate actions to intents. During transition an in-process host can keep running with
`AGENT_HARNESS_ENABLED=1` and no EXECUTE (tracking only) — but never let a host and the harness drive the body at once.

### Server flags (`pnpm serve`)

| Variable / flag | Default | Meaning |
| --- | --- | --- |
| `<client-config.json>` | — | agent-mc-world private client config (same as `minecraft-agent-mcp`) |
| `--fake-body [--data-dir DIR]` | — | offline fake body for demos/tests (no Minecraft connection) |
| `--hash-token` | — | read a token on stdin, print its SHA-256 (for `tokenSha256`) |
| `AGENT_HARNESS_GATEWAY_HOST` / `_PORT` | `127.0.0.1` / `8787` | bind address; non-loopback requires agents |
| `AGENT_HARNESS_GATEWAY_AGENTS_FILE` / `AGENT_HARNESS_GATEWAY_AGENTS` | — | agents JSON (ids, `tokenEnv`/`tokenSha256`, admin, limits) |
| `AGENT_HARNESS_GATEWAY_MAX_MESSAGE_BYTES` | 65536 | inbound size limit |
| `AGENT_HARNESS_GATEWAY_ORIGINS` | — | comma list of allowed browser origins |
| `AGENT_HARNESS_EXCLUSIVE` | `1` in serve | `0` keeps `mc_*` visible (not recommended) |
| `AGENT_HARNESS_FAKE_TASK_MS`, `AGENT_HARNESS_FAKE_USERNAME` | 300, HarnessBot | fake body tuning |
| `AGENT_HARNESS_DIR`, `AGENT_HARNESS_MEMORY`, `AGENT_MEMORY_*` | see above | harness/memory storage |

## What is stubbed / honest limits (Phase 1)

* **Planner**: only `ExplicitStepsPlanner` (host-provided `constraints.steps`, ≤20, allow-listed body tools). A free-text
  goal is accepted but parked as `paused` with reason "No planner for a free-text goal yet" and a severity-3 event.
* **Reflection**: interfaces + async worker only; no default reflector, no host-memory writer implementation.
* **Hot summary**: deterministic template + heuristic token estimate (CJK 1 token/char, others 1/3.5 chars), not a tokenizer.
* **Execution** is opt-in for in-process use; the hosted server (`pnpm serve`) always executes with exclusive body control.
* Gateway: no TLS (terminate it in a reverse proxy), no token rotation/revocation API (edit config + restart), event
  buffer is in-memory (500) so replay does not survive restarts (`streamReset`), single process / single body.
* `pnpm serve` runs TypeScript through `tsx` (no build step yet).
* Key-event classification is rule-based (death, task terminal, level-up text, whisper/mention, join/leave).

## Roadmap

* **Phase 2** — DSH adapter to gateway mode; LLM planner (goal → `mc_do` steps, budgeted, using summary + Warm facts); reflection worker writing
  lessons into Warm memory + `HostMemoryWriter`; DSH host adapter (one host owns the body when `EXECUTE=1`);
  progress events for long tasks; FalkorDB as Graphiti backend.
* **Phase 3** — skill/lesson library learned from reflections, multi-intent scheduling (interruptible background goals),
  self-evaluation metrics, out-of-process harness (MCP server) so several hosts can share one body safely.
