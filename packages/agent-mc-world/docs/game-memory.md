# Game memory

`mc_memory` is the same notebook through the SDK, MCP, Cortico and DSH interfaces. N.E.K.O discovers it through its progressive `mc_tool_help` / `mc_invoke` interface. A persistent `dataDir` is required. The default local mode makes no network or model calls. Optional retrieval connections are explicitly configured; the core never starts a model service or a planning loop.

The caller retains personality, general memory and learning decisions. The Minecraft notebook holds locations, resource observations, attributed player reports, task notes, methods and counterexamples. Existing chest/exploration/blueprint/tactic ledgers remain their own sources of truth. Notes do not update those ledgers, create teammates, resume goals, execute code or cancel body tasks. Optional [service learning](game-memory-learning.md) exposes evidence capture, reviewed experience candidates, asynchronous refinement and bounded historical recall through the same core tool.

## Small reads

1. `mc_memory {"action":"help"}` reads the contract.
2. `mc_memory {"action":"search","query":"下潜 换气","kind":"method","limit":4}` reads summaries and provenance.
3. `mc_memory {"action":"get","id":"<returned id>"}` reads one full note.
4. Re-observe the world before relying on old inventory, positions or relationships.

Search has bounded results and pagination. Chinese substrings and words are matched locally. Optional vector and remote modes combine the local ranking with semantic/service results using reciprocal rank fusion.

### Player encounters

For an explicitly saved `relationship` note, use exact tags `player:<Minecraft-account-name>` and, only when observed, `player-uuid:<uuid>`. Search accepts `tags` with case-insensitive exact OR matching; nickname fragments never bind accounts. A conflicting UUID suppresses a same-name match; UUID-bound notes require a confirmed matching UUID. A UUID from an offline server is only that server's account identity, not proof of a real person or cross-platform ownership.

Before a delivered chat, arrival or nearby-player observation, the engine can queue at most three recent, unexpired local relationship summaries in a separate `minecraft.memory` event. Movement-only repeats are limited to one recall per identity per 30 seconds; direct chat may refresh it. The original chat text and sender are unchanged. History carries note IDs, revisions, source timestamps and speakers; full content remains on demand. No match or a failed read never proves a stranger or a first meeting. The host should also consult its own existing profiles where applicable.

This path is local, bounded and does not call an embedding/model/cloud service or write new memories. It is disabled without persistent storage. It does not import private host profiles into shared game memory. Whether a host actually supplies delivered history to its model still requires host-side verification.

## Writes and evidence

`remember` requires `kind`, `summary`, `content` and `source`. Use `source.kind:agent_note`, `hypothesis`, or `user_report` with speaker and a reference. Arbitrary references are unverified pointers. In method notes include applicability, failures, method/source hashes and actual task/run IDs. Saving a method does not establish successful use or improvement.

`capture` reads current connected position, health/food and inventory synchronization state directly from the runtime. Unsynchronized inventory is saved as unknown. Only this action can create `runtime_observation` provenance. Every retrieved record is still historical and `currentWorldVerified:false`, including an unexpired capture. The runtime does not validate a caller's interpretation or a user report.

`revise` requires the latest `expectedRevision` and a complete replacement note. Earlier versions remain readable with `get(id, revision)`. Revising an observation creates an attributed note, not a new runtime observation. `archive` also requires a matching revision and preserves history. `expiresAt` is advisory; expired results are visibly marked and never represented as current.

## Isolation and recovery

Files are stored under `dataDir/minecraft-memory/`, keyed by a hash of realm, Minecraft account/authentication mode and agent identity. Callers cannot select another account or server in tool arguments. Searches default to current dimension and dimensionless notes; use an explicit dimension or `"*"` to search across dimensions within the same scope. Place/resource notes require a known dimension. Offline reads work; offline capture fails.

SDK/MCP notebook calls also work before `connect` and after `disconnect`, without starting the engine or a reconnect loop. Offline capture fails and offline place/resource writes need an explicit dimension. A local managed world must already have its realm marker; offline calls do not create world identities. The same data-directory lease excludes a second client or connection while an offline call is pending.

Remote server identity is address based, so a world replacement behind the same address is not automatically detectable. Use a new data directory for a replacement world. Changing configured account or agent identity intentionally selects a separate scope. There is no automatic cross-agent import or personal memory migration.

Writes use atomic replacement. The client data-directory lease supplies one writer. Corrupt/oversized files fail visibly and remain untouched. Limits: 1,000 notes, 32 revisions per note, 6,000 content characters per revision and 16 MiB per scope; hitting a limit refuses the write instead of silently evicting history. Export/rotate or repair a backup explicitly. No deletion tool is provided.

## Retrieval configuration

SDK/MCP use `world.memory`; Cortico uses the same fields under `worlds.minecraft.memory` in its configuration UI. N.E.K.O and the standalone Python runtime expose the neutral `[memory]` table and forward it to the core. No provider implementation belongs in those adapters.

| Mode | Dependencies and behavior |
| --- | --- |
| `local` (default) | Bounded JSON notebook and keyword/Chinese substring search; no additional dependency, model or network |
| `vector` | Explicit OpenAI-compatible embeddings URL and model; vectors stay in the local game directory, keyword and cosine rankings are combined |
| `remote` | Explicit provider URL and key environment variable; game notes are replicated to a memory service, which supplies additional search matches |

Vector example (under `world.memory`):

```json
{"mode":"vector","endpoint":"http://localhost:8000/v1/embeddings","model":"your-embedding-model","apiKeyEnv":"GAME_EMBEDDING_KEY","timeoutMs":3000}
```

`apiKeyEnv` names a process environment variable; never put a secret in a checked-in example. It can be empty for an intentionally unauthenticated local endpoint. Only explicit game notes and search queries are sent, not the host's personal memory, conversations or credentials. Vector indexing runs once per saved revision. Searching embeds one query; it never batch-embeds the whole notebook. `sync(id, expectedRevision)` explicitly indexes an existing note after enabling a provider or changing model. `incompleteIndex` reports uncovered notes; reindexing is not automatic. Switching an embedding model at the same name/address requires explicit reindexing.

| `remote` provider | Endpoint (base URL) | Behavior |
| --- | --- | --- |
| `mem0-platform` | `https://api.mem0.ai` | V3 add/search; `infer:false` retains the supplied note, Token authentication |
| `mem0-oss` | URL of your Mem0 REST server | `/memories`, `/search`; `infer:false`, X-API-Key authentication |
| `bailian` | `https://dashscope.aliyuncs.com/api/v2/apps/memory` | `/add` with verbatim `custom_content`, `/memory_nodes/search`; Bearer authentication, optional `libraryId` and `projectId` |
| `powercontext` | URL of your PowerContext server | Explicit `scopeId` required; `/v1/memory/remember` and `/v1/atomic-memory/search`, Bearer authentication; `searchMode:text` by default, optionally `vector` or `hybrid` |
| `http` | URL of an implemented bridge | The `agent-mc-memory/v1` contract below; Bearer authentication |

These are distinct APIs, not an industry-wide interchangeable memory protocol. Cloud vendors with another API can implement the bridge or add a core provider. No vendor SDK or cloud account is required for local mode.

PowerContext uses the supplied existing Scope and a `kind` keyed by the game scope. It never creates, lists or changes Scopes. Its 8,192 UTF-8-byte limit applies to the complete serialized record; oversized records remain local with an indexing error, without truncation. A confirmed write returns exact `artifacts` (family, artifact_id, revision) and `scopeId`; matching text without a valid ArtifactRef is unverified. The adapter targets PowerContext 1.3.0. Other installed versions need a contract check; no home service or real cloud credentials were used for repository tests.

### Failure, revision and replication boundaries

For notebook search, local revision history is authoritative. Remote results must exactly match local scope, note ID, revision and content hash. Stale, archived, unrelated and foreign-agent remote records cannot become current facts. A second machine needs the corresponding local notebook restored or migrated; this version does not automatically import a whole remote account. Archiving suppresses old matches locally but does not erase the provider's stored history. Separately enabled service learning can read external reviewed experience and topics in an explicitly dedicated game Scope; these remain attributed historical service results, never silently imported as local observations.

Writes commit locally first. A provider acknowledgement reports `stored` with `searchVerified:false`; an asynchronous acknowledgement stays `pending`, and a timeout stays `unverified`. None proves successful future recall. Unknown writes are not retried automatically. Search failure falls back to local results and reports `retrieval.degraded:true`. Requests have an explicit timeout, cancellation, a 1 MiB response bound and no redirects/discovery. Provider keys and response error bodies are excluded from tool results. A write cancelled after local commit retains `saved:true` and reports its remote indexing status.

### Generic bridge contract (`http`)

- `POST /upsert`: `{protocol:"agent-mc-memory/v1", namespace, key:"<id>:<revision>", entry, metadata}`. Respond `{status:"stored"}` only after persistence. Upsert that key idempotently; `entry` contains the complete attributed historical note, including archival state.
- `POST /search`: `{protocol:"agent-mc-memory/v1", namespace, query, limit:40}`. Respond `{results:[{metadata:{mc_scope,mc_id,mc_revision,mc_hash}}]}` ordered by relevance. Scope filtering is mandatory. Return the metadata unchanged from upsert; the core resolves note content from the local ledger.
- `namespace` is the opaque hash of the engine-selected server/account/agent scope. Authentication is `Authorization: Bearer <configured env value>`, if configured. Return a non-2xx status for rejection; secrets must not be included in errors.

## Evaluated sources

The bounded local notebook avoids an always-running database and native extensions. [sqlite-vec](https://github.com/asg017/sqlite-vec) is a possible larger-store backend, but is not installed or required here. Existing services are used through their documented APIs:

- [Mem0 platform add](https://docs.mem0.ai/api-reference/memory/add-memories) and [search](https://docs.mem0.ai/api-reference/memory/search-memories).
- [Mem0 OSS REST server source](https://github.com/mem0ai/mem0/blob/main/server/main.py).
- [Bailian add](https://help.aliyun.com/zh/model-studio/memory/add-memory) and [search](https://help.aliyun.com/zh/model-studio/memory/search-memory).
- [PowerContext 1.3.0 OpenAPI](https://github.com/oceanbase/powercontext/blob/powercontext-v1.3.0/openapi/powercontext.yaml).

Tests cover local persistence through the actual disconnected core child and mocked provider wire contracts, isolation, revision races, cancellation and degradation. They do not establish real cloud/home-service connectivity or Agent learning gains.
