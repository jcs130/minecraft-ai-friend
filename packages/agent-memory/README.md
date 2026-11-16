# agent-mc-memory (Phase 1)

Long-term, **bi-temporal** memory for a resident Minecraft agent (千灯纪 resident agent design, Phase 1).

- **Cold layer** – append-only SQLite log of raw episodes (original text kept as provenance).
- **Warm layer** – temporal knowledge graph. Two interchangeable backends behind one `MemoryGraph` interface:
  - `LocalTemporalGraph` (default): in-process SQLite, deterministic rule-based merging, no network, no model.
  - `GraphitiMemoryGraph`: HTTP client for the Python [Graphiti](https://github.com/getzep/graphiti) sidecar in
    `graphiti-sidecar/` (LLM extraction, hybrid BM25 + vector search, contradiction invalidation).
- **Tools** – `memory_query`, `memory_recall_at`, `memory_recent`, `memory_remember`, shaped like agent-mc-world `ToolDef`.
- **Opt-in wiring** – one passive observer on `MinecraftAgentClient` host events. **Off by default.**

Hot-context assembly, reflection and self-evolution are Phase 2–4 (see `docs/agent-memory-design.md` at the repo root).

## Time model

Every fact (edge) carries `validAt`/`invalidAt` (game-world truth) and `createdAt`/`expiredAt` (when the memory
believed it). Contradictions never delete: the old version is expired and a closed copy (with `invalidAt`) is written,
so you can ask both *"where was Steve's home on 11-03?"* (`factsAt`) and *"what did I believe at 12:30?"* (`knownAt`).

Relation policies (`src/relations.ts`) decide what contradicts what: `LOCATED_AT`/`IS_ONLINE` are exclusive per subject,
`HOME_AT`/`HAS_LEVEL`/`OWNS` per subject+object (value change supersedes), `LIKES`↔`DISLIKES` conflict,
`DIED_AT` is an event (each death kept), others are multi-valued and only closed by explicit negation.

## Scope and world isolation

- Partition = `{realm, account, agent}` (same shape as agent-mc-world `GameMemoryScope`) → opaque `scopeKey`
  (`mc_<sha256>`; also a valid Graphiti `group_id`). Every query is confined to one key.
- Locations are namespaced by the native world key from agent-mc-world `agent-mc-world-identity/v1`
  (`minecraft:overworld|home:base`). An unknown world gets a connection-local namespace and never merges with another
  world, following `worldScopedRealm`.
- Only meaningful changes become episodes: joins/leaves, player chat & whispers, deaths (with position/cause from
  `meta.death`), respawn, XP level, task accept/terminal. Snapshots, action bars and ambient notices are ignored.
  `InventoryDeltaTracker` turns full inventory reads into deltas (notable items, first/last of an item; never full dumps).

## Use

> Integration into a running agent now goes through **`agent-mc-harness`** (`packages/agent-harness`,
> `withAgentHarness`), which owns the glue and exposes memory to the host via `harness_get_summary`.
> `withAgentMemory` below remains as a lower-level, memory-only option.

```ts
import { MinecraftAgentClient } from 'agent-mc-world';          // in-repo: packages/agent-mc-world/src/client
import { withAgentMemory, memoryConfigFromEnv } from 'agent-mc-memory';

const { options, integration } = withAgentMemory(clientOptions, memoryConfigFromEnv());
const client = new MinecraftAgentClient(options);            // unchanged when AGENT_MEMORY_ENABLED is unset
// ... on shutdown: await integration?.close();
```

Environment (all optional; memory is OFF unless enabled):

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENT_MEMORY_ENABLED` | off | `1` to attach the observer + memory tools |
| `AGENT_MEMORY_DIR` | `<dataDir>/agent-memory` | SQLite location |
| `AGENT_MEMORY_BACKEND` | `local` | `hybrid` = local + async Graphiti sidecar |
| `AGENT_MEMORY_GRAPHITI_URL` | `http://127.0.0.1:8765` | sidecar URL |
| `AGENT_MEMORY_GRAPHITI_TOKEN_ENV` | – | *name* of env var holding a bearer token |

In `hybrid` mode the game event path never waits for Graphiti: episodes go to a bounded single-worker queue
(low-importance work is dropped first when full; the cold log always keeps the episode). Reads merge local and Graphiti
results and fall back to local with a `degraded` note if the sidecar fails.

## Graphiti sidecar

```bash
cd packages/agent-memory/graphiti-sidecar
python3 -m venv .venv && .venv/bin/pip install -e '.[test]'
export AGENT_MEMORY_LLM_BASE_URL=https://api.deepseek.com/v1   # any OpenAI-compatible endpoint
export AGENT_MEMORY_LLM_MODEL=deepseek-chat
export AGENT_MEMORY_LLM_API_KEY_ENV=DEEPSEEK_API_KEY            # NAME of the env var, never the key itself
export AGENT_MEMORY_KUZU_PATH=$PWD/.data/graphiti.kuzu
.venv/bin/python -m agent_memory_sidecar                       # binds 127.0.0.1:8765
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENT_MEMORY_GRAPH_DRIVER` | `kuzu` | `kuzu` (embedded) or `falkordb` (`AGENT_MEMORY_FALKORDB_HOST/PORT`) |
| `AGENT_MEMORY_LLM_STRUCTURED_OUTPUT` | `json_object` for DeepSeek, else `json_schema` | Graphiti structured-output mode |
| `AGENT_MEMORY_EMBEDDER` | `hash` | `hash` = deterministic local lexical vectors; `openai` = `AGENT_MEMORY_EMBED_BASE_URL/MODEL/API_KEY_ENV/DIM` |
| `AGENT_MEMORY_SIDECAR_HOST/PORT` | `127.0.0.1` / `8765` | non-loopback bind requires `AGENT_MEMORY_SIDECAR_TOKEN_ENV` |

HTTP (`agent-mc-memory-graph/v1`): `GET /health`, `POST /episodes`, `POST /search` (`at`, `known_at`, `history`).
Telemetry is disabled (`GRAPHITI_TELEMETRY_ENABLED=false`).

Known limits: graphiti-core 0.31 marks its Kuzu driver deprecated and ships it without `_database` and without the
FTS indexes its own search uses; the sidecar contains a small shim for both. Use FalkorDB for long-term production.
Graphiti updates `invalid_at` in place, so `known_at` there only hides later-created edges; the local backend is the
exact bi-temporal reference. The hash embedder has no semantics (lexical overlap only).

## Development

```bash
pnpm install && pnpm test && pnpm typecheck      # typecheck also checks compatibility with ../agent-mc-world sources
pnpm smoke:local                                 # synthetic join → preference → home → moved home
pnpm smoke:graphiti                              # same, against a running sidecar (hybrid)
cd graphiti-sidecar && .venv/bin/python -m pytest -q
```
