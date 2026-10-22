# Optional HarnessRouter planning and persistent characters (0.1.26)

The standalone coordinator can use a HarnessRouter UHP backend or its existing
direct provider. Both return decisions to the same controller. The existing
Minecraft body, queue, goals, barriers and original receipts remain authoritative.
No second autonomous loop or body connection is created by changing the planner.

This is a **planning adapter**. In the measured upstream implementation the UHP
request's `tools` field is reserved/ignored. This adapter therefore sends the
advertised schemas and current bounded context as input data, asks for a JSON
decision, validates it and passes accepted calls to the existing controller.
It does not install the game tools inside DSH or give a harness direct ownership
of the body. Native tool schemas still validate arguments; the adapter accepts
both JSON objects and Chat-style encoded strings for argument representation.

## Configure and run

Start an explicitly configured HarnessRouter instance. Configure its model
integration using its own console/API. This package does not discover account
credentials, provision providers, install harnesses or enable services on import.

Copy [harnessrouter.example.toml](../harnessrouter.example.toml) to a private file.
Fill in the existing server/account, verified MCP body entry, absolute shared data
directory and an available model. Set `autonomy.enabled = true`. The gateway key
belongs only in the environment variable named by `planner.api_key_env`.
The model provider key belongs to HarnessRouter's integration configuration.

```powershell
# Use the installed package's Python. Load HARNESSROUTER_API_KEY privately first.
python -m agent_mc_autonomy.cli harness-check --config E:/private/traveller.toml
python -m agent_mc_autonomy.cli check --config E:/private/traveller.toml --entry E:/verified/bin/minecraft-agent-mcp.mjs
python -m agent_mc_autonomy.cli run --config E:/private/traveller.toml --entry E:/verified/bin/minecraft-agent-mcp.mjs --goal "勘察当前营地并保存一条个人便笺"
```

`harness-check` only performs authenticated `GET /v1/uhp`. It does not call a model
or connect to Minecraft. `check` validates configuration and the explicit entry
without network calls. `run` is the foreground lifecycle; Ctrl+C stops it.
Use the existing `status`, `stop`, `submit-goal` and `receipt` commands against
the same configuration/data root. `model-list`/`model-check` remain direct-provider
commands; HarnessRouter has its own model integration and runtime administration.

The tested instance uses UHP `2026-09-28`, background response submission,
polling, cancellation and idempotency. Each decision starts a **fresh UHP task**;
the host supplies current facts and bounded history. A provider's opaque reasoning
state is never forwarded to another harness. Images are currently excluded.

## Switch without replacing the character

The standalone CLI re-reads **only `[planner]`** at decision boundaries. Replace
that entire table atomically with another explicit configuration, for example:

```toml
[planner]
route = "direct"
base_url = "https://your-provider.example/v1"
model = "your-available-model"
api_key_env = "YOUR_MODEL_KEY"
image_input = false
```

The new credential environment variable must already exist in the running
coordinator's environment. Switch back by restoring the HarnessRouter table.
Do not leave `harness_id` in a direct configuration. Do not change the account,
body configuration path, data directory or `[agent]` as part of a planner switch.
Changes to those settings require a separate, explicit lifecycle/binding change.

No model call is started merely because a file changed. Normal native work
finishes under its original ID before the next decision. If configuration changes
while inference is running, that stale response is rejected before dispatch and
the next decision uses the new planner. Pending/unknown game actions retain their
original ledger; changing runtime does not clear uncertainty or replay actions.
Cancelling an inference task does not cancel an already accepted game action.

Each UHP task has an independent request UUID (`Idempotency-Key`) and response ID
in `sessions/<account>/host/harness-requests.jsonl`. This journal contains routing,
phase and cancellation status, not credentials or prompt bodies. The existing
`decisions.jsonl` and `receipts.jsonl` retain private decisions and game evidence.
HTTP/provider refusals stop with a visible error; they do not trigger blind model
retries, automatic model substitutions or native action replay.

## Character data belongs to the host

`[agent]` is optional. Omitting it preserves previous behavior. When enabled:

| Data | Location / behavior |
| --- | --- |
| Stable persona | `agents/<sha256(owner_id,id)>/character.sqlite3`; name/persona changes append revisions |
| Personal history | Same database, with source, timestamp, idempotent request key and world/account scope |
| Game notebook | Existing `mc_memory`, unchanged; remains separate from personal history |
| Goals/actions | Existing mailbox, host state and original body receipts, unchanged |
| Inventory/levels/mod progress | Minecraft and the relevant mods' native storage |

The coordinator automatically records completed assistant/tool exchanges and
provides `agent_remember` / `agent_recall`. Retrieval returns bounded summaries
or record pages. It labels history as historical and unverified as current world
state. Models cannot choose another owner/character/scope or edit the persona.
The profile is supplied by the trusted operator, not inferred from a nickname.

The current scope preserves the existing account identity hash (including an
explicit alternative body configuration path). It does not automatically detect
world resets or migrate records when server addresses/body providers change.
Model/harness changes do not change this identity. A new owner or character ID
selects different storage; do not rename IDs to change the display name.

Records are append-only and are not silently evicted. Individual records are
bounded to 128 KiB; operators must monitor disk usage and make backups. The local
SQLite store is not a public multi-user authentication or cloud synchronization
service. It does not import old Cormy, Cortico or QwenPaw memories automatically.

```powershell
python -m agent_mc_autonomy.cli agent-export --config E:/private/traveller.toml --output E:/private/traveller-export-001.json
```

Export creates a **new** file, never overwrites, and includes persona revisions,
historical records and a canonical SHA-256 under `agent-character/v1`. The
consistent SQLite read excludes infrastructure credentials and the Minecraft
save. Game text inside history can still be private: keep exports private.
Full account/body data and world saves need their existing consistent backups.
There is no import/cloud conflict-resolution implementation in this release.

## Tested boundary

The 2026-10-22 online acceptance used `qwen3.5-plus`: DSH → direct → DSH, a real
ordinary Mineflayer account, one short walking task, original terminal receipt,
same connected body/event run, private-note retrieval and reconnect persistence.
The initial DSH object-argument rejection and one direct-provider invalid `goto`
shape are retained in evidence; the latter was corrected by consulting `mc_help`
before one real movement. No long-running autonomous survival benchmark is claimed.

Cortico/Numen can still use the existing injected host/ReviewPort/body adapters.
This release does not register their own Agent loops as HarnessRouter built-ins,
add a user-facing runtime selector or implement cross-machine/cloud restoration.
See the repository's [deployment and acceptance record](../../../docs/MY-AGENT-WORLD-HARNESSROUTER.md).
