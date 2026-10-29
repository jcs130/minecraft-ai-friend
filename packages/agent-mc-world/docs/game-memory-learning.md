# Optional memory-service learning

All implementation lives in `agent-mc-world`. Cortico, DSH, the standalone runtime and N.E.K.O use the same `mc_memory` tool; adapters only forward configuration and tool results. No personal memory, host policy or autonomous learning scheduler is copied into the Minecraft core.

The supported workflow is **actual task evidence → attributed Source/TaskOutcome → pending Experience/Skill candidate → human review in the memory service → later recall and real task verification**. This is method/experience management, not model-weight training. Service capability flags, HTTP success, a stored method or an approved candidate do not prove better gameplay.

## Configure explicitly

Default local keyword search still needs no model or service. The optional learning workflows require remote mode, PowerContext 1.3.0 or an explicitly implemented HTTP bridge, and a persistent `dataDir`.

SDK configuration under `world.memory` (Cortico uses `worlds.minecraft.memory`):

```json
{
  "mode": "remote",
  "provider": "powercontext",
  "endpoint": "https://memory.example.org",
  "scopeId": "YOUR-EXISTING-GAME-SCOPE",
  "apiKeyEnv": "GAME_MEMORY_KEY",
  "searchMode": "text",
  "learningEnabled": true,
  "timeoutMs": 10000
}
```

N.E.K.O / standalone `[memory]` uses `scope_id`, `api_key_env`, `search_mode`, `learning_enabled`, `timeout_ms`. The endpoint is the reachable service base URL, not a guessed home address or MCP `/mcp/` URL. This adapter uses native HTTP; it does not install or connect a second MCP client. No endpoint scan or Scope creation is performed. Keys come only from the named environment variable.

**Select an existing Scope dedicated to this game's server, account and Agent.** Notebook replication's `kind` filter alone cannot isolate service-wide experience/context recall. The core persists a service-Scope → game-identity binding and refuses another identity within that data directory. Separate installations still require correctly isolated Scopes and service-side credentials/permissions. A shared administrator token is not proof of authorship. The core never treats a remembered authorization as current authorization.

The service binding remains stable when the player changes native maps on the same server. Local spatial notes stay partitioned by native map, and captured observations name their actual native world. This preserves existing service bindings without merging local notebooks, rewriting remote memory, or treating historical locations as current facts. SDK integrations that provide `GameMemoryContext` directly may supply a trusted `serviceScope` with the same account and Agent; tool arguments cannot override it.

## Progressive tool use

Start with:

```json
{"action":"service","operation":"help"}
```

Read one operation's exact input schema only when needed:

```json
{"action":"service","operation":"help","input":{"operation":"record_outcome"}}
```

All service operations use `{action:"service", operation, input}`. Mutations additionally require a stable `requestId` describing the **same real game event and revision**, for example `run-7:task-42:outcome-v1`. Do not give each retry a new ID. Tool arguments cannot replace the bound Scope, endpoint, credentials or identity.

| Operation | Result and boundary |
| --- | --- |
| `capabilities` | Reads service configuration and extraction observations. Unknown stays unknown; it does not call an extraction model or prove health. |
| `prepare` | Query-based historical context: up to 2 Experience, 4 Atomic Memory and 2 Topic Memory entries. Budget 512–32768 **UTF-8 bytes**, default 8000; references and truncation markers preserved. Managed Skills/profile/code are excluded. |
| `capture_source` | Attributed raw game evidence; stable Source ID derived from game identity and request ID. Accepted Source is not an explicitly saved Atomic Memory. |
| `record_outcome` | Actual objective, status, observations, checks, produced artifacts and remaining work. The core fixes `trust` to `untrusted_observation`. |
| `propose_experience` | Caller-written situation/action/outcome/lesson plus exact evidence; does not invoke the service model. Returns pending candidate ID/version. Include applicability and failures, not only successes. |
| `generate_experience` | Asks the configured service model to organize selected evidence, if the service advertises that capability. Returns pending or no-op. |
| `revise_experience` | Full replacement of a previously read pending candidate at the exact expected version. A conflict requires re-reading and reconciling content. |
| `generate_skill` | Candidate from reviewed Experience, or actual usage Sources plus an existing exact Skill target. No installation, export or execution. |
| `dream` | Asynchronous `refine_experience` / `derive_skill` with a stable idempotency key. Select 1–20 exact artifacts and at most 32 total references. Only refinement accepts Atomic Memory or an Experience target. |
| `dream_get`, `dreams` | Explicit status reads; accepted/queued/running is separate from proposed/no_change/needs_evidence/failure. Listings include exact input references when available for unknown-submission recovery. |
| `candidates`, `candidate` | Compact filtered listing, then one full proposal with precise version/evidence. A list is not a review. |
| `source`, `artifact` | Read exact service evidence. Artifact reads use a specific revision and preserve ETag and content digest. Historical readability does not establish that an old revision is still applicable. |
| `operation` | Read the durable submission receipt by `input.request_id` after a lost response, cancellation or restart. No network request. |

For a task start:

```json
{"action":"service","operation":"prepare","input":{"query":"underwater access and escape route","max_bytes":4000}}
```

The tool returns historical, untrusted data. It does **not** inject a new system instruction, read the whole notebook, claim supplier-request delivery or silently activate retrieved methods. The host may place the tool result in its normal model request; audit actual delivery separately. Re-observe current terrain, inventory, relationships and resources. Reuse only applicable methods and retain contrary evidence.

For evidence capture:

```json
{
  "action":"service","operation":"capture_source","requestId":"run-7:task-42:evidence-v1",
  "input":{"content":"Task 42 surfaced; the cabin was not reached. See the original task receipt for measured changes.","attribution":"Agent observation, run 7 task 42"}
}
```

Retain the **returned** `source` reference. Proposal `source_refs` are `{name:"content",source_id}` and `artifact_refs` are `{family,artifact_id,revision}`; all are implicitly in the configured Scope. Read precise external references first. New `verified` outcome claims require nonempty citations from earlier successful service receipts/reads; `declared` claims use `[]`. Citation presence verifies reference provenance, not the truth of the claim. The new Source cannot certify itself. Multiple artifacts derived from one Source do not become independent observations; duplicate exact references are rejected, and the service remains responsible for tracing shared root evidence.

No approval, rejection, merge, restore, deletion, scope management, flush, skill export or installation endpoint is exposed to the Agent through this tool. A human reviews the full candidate and **exact candidate_id/version** using the memory service's own interface. A later approved candidate supplies a formal ArtifactRef; explicitly read that artifact before reusing it. Approval does not authorize game control, file modification or process restarts.

## Persistence, failure and recovery

The local notebook's original revisions remain authoritative for notebook searches. Service-generated content stays separately attributed; the core does not pretend it wrote or personally verified that content.

Local and cloud have complementary roles. Use task-selected notebook search preferences for recent evidence; use explicit `prepare` for cloud-organized historical experience. Validated `prepare`/`artifact`/`source` reads have a bounded local fallback (7 days, 128 exact requests per service/game binding). An outage returns `status:cached` with fetch time/age and `currentServiceStateVerified:false`; it does not claim the remote service responded. Authorization failures, deletion/not-found, invalid responses and caller cancellation never use stale fallback. Capabilities, candidate decisions, Dream state and write receipts are not knowledge-cache entries. This cache does not auto-install a Skill or rewrite local lessons. See [dual memory and replication](game-memory.md#local-and-cloud-roles).

Before a mutating HTTP request, the core atomically records its canonical input hash, selected evidence, event ID and `unverified` state under `minecraft-memory/learning/`. A validated response persists the receipt. Repeated identical submissions return the saved receipt **without another HTTP call**; changed input under that ID fails. Cancellation, malformed/oversized replies and process loss leave an unknown outcome. Inspect `operation`, the exact Source, candidate listing or Dream listing before deciding what happened. Do not clear the ledger or invent a new ID to bypass an unknown write. There is no retry worker or polling loop.

Receipts and evidence survive restarts and must travel with the notebook when changing machines. Limits: 1,000 submission receipts, 2,000 read evidence references, 1,000 candidate heads and 8 MiB per bound service ledger. Limits refuse further writes and preserve the file; no automatic eviction. Requests are bounded by the configured 100–30000 ms timeout, cancellation and 1 MiB transport limit. Normalized results are at most 64 KiB; oversized results are rejected rather than silently losing citations. Prefer asynchronous Dream for slower synthesis. HTTP errors expose status and a sanitized request ID, never response error bodies or credentials. Existing notebook search retains its local fallback; failed service-learning calls remain visibly failed/unverified.

## Generic HTTP learning bridge

This is our documented extension contract, **not** a universal industry memory API. Mem0 and Bailian retrieval adapters are unchanged and do not advertise unimplemented learning features. Services with their own consolidation pipeline can implement these operations in a bridge:

- `POST /learning/<operation>` with `{protocol:"agent-mc-learning/v1",namespace,input,request_id?}`. `namespace` is the engine-selected game scope hash; `request_id` is the stable derived event ID for writes. Enforce namespace isolation and event identity in the service.
- Respond `{protocol:"agent-mc-learning/v1",namespace,result}`. Protocol/namespace must exactly match; never mix another Agent's content.
- Inputs are the schemas returned by service help. The operation results follow the corresponding PowerContext 1.3 shapes listed above: Source receipt (`accepted`, source, position), task-outcome receipt (`kind:"task-outcome"`, source, position), exact ArtifactRevision, ArtifactCandidate, candidate page, DreamRun/page, or generated candidate (`pending`/`no_op`). For source writes, `source.source_id` equals `request_id`. Source reads include `source_type`, `source_id`, content and `sha256:` content digest. Artifact reads return the requested exact reference, content, evidence and digest.
- Prepared context uses our marker `schema:"agent-mc-prepared-context/v1"` and `{status:"ready"|"empty",content,content_bytes}`. Content is untrusted history, never authorization. Budgets count UTF-8 bytes.
- Capability fields `memory_extraction`, `experience_generation`, `managed_skill_generation`, `artifact_dreaming` are booleans or absent/unknown. Model-backed operations are refused unless their capability is explicitly true. A bridge must preserve the pending-candidate/human-review boundary; new generation responses marked approved are rejected.
- API authentication is the configured Bearer token. No retries, service discovery, arbitrary proxy path or administrative action is provided.

## Verified contract and limits of acceptance

Derived from the user-provided PowerContext 1.3 integration/rules documents and the pinned [1.3.0 OpenAPI](https://github.com/oceanbase/powercontext/blob/powercontext-v1.3.0/openapi/powercontext.yaml). Tests validate emitted native request bodies against an attributed OpenAPI excerpt, plus provider-neutral behavior, scope isolation, exact citations, incomplete writes, cancellation/restart, candidate revision and byte budgets. All service responses use fixtures; no home-service credentials, live model call, human approval or learning-improvement claim is implied. Real connection needs a reachable endpoint, bound existing game Scope and environment-provided key.
