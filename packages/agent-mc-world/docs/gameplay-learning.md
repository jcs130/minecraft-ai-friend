# Continuous gameplay evidence

`agent-mc-world/learning` and `minecraft-agent-record <private-profile.json>`
provide an opt-in, model-neutral recorder beside an already running Agent.
Importing the module starts nothing. Starting it does not connect another game
account, acquire the body, dispatch inputs, call a model, restart a host, train
a policy, write personal memory or promote a method.

The recorder follows the existing [operation journal](operation-learning.md)
read-only. A source scope must be selected explicitly; it never discovers
servers, accounts or credentials. Source, archive and status paths are checked
before writing. Archive ownership and a separate process lease reject another
writer; this lease is not a game connection lease for the Agent's body.

## Inputs and coverage

Operation evidence preserves run/request, decision and execution identities,
safe requested parameters, method revision, actual adopted game-memory refs,
before/after states and client-visible effect receipts. Decision records retain
the selected candidate, available probabilities, timing/token metadata and
separate recalled memory refs. Anonymous callers remain unknown. Chat, prompt,
answer, reasoning, arbitrary script/source, raw tool arguments, NBT and secrets
are not copied. Game locations and scoped account associations are still private.

This applies beyond locomotion: gathering, crafting, smelting, storage, food,
equipment, interaction, combat, flight, blink and spells use the same evidence
contract. Which fields exist depends on the original call and backend. Newly
recorded operation parameters also allow `block` and `recipe`; an older host
does not gain these fields until it normally loads the updated core. Never infer
missing historical arguments or replay operations to obtain them.

An optional local 1.21.1 viewer subscriber records live avatar state and a
7×5×7 grid of client-loaded cells at 2 Hz by default, including periods when
the operation journal is quiet. It retains up to 256 serialized columns / 64 MiB
from the viewer footprint and decodes at most nine local columns. This matters
when walking: the viewer sends new edge columns, not previously streamed columns
as they become nearby. Sparse block updates are retained while columns are not
decoded (4,096 cells/column, 16,384 total); overflow evicts the affected column and
leaves unknown cells until a new snapshot. Eviction counters remain visible.
Dimension/reset/disconnect boundaries clear both cache levels. Body
samples require a fresh avatar. An already pinned self entity can bound initial
chunk caching while a cold registry load makes the first avatar stale.
Received/oversized/missing-position column counters expose coverage loss. Body
capture, network receipt and world-grid sampling timestamps remain separate.
Unknown voxels have occupancy bits `0`; unknown block state IDs are `-1`.
Inventory absence remains unknown, not an empty bag.

The observer uses **one regular viewer slot**, not a capture slot. An unavailable,
busy or incompatible viewer is retried after 15 seconds without evicting an
existing viewer or starting a game. Operation recording continues independently.
Both self username and UUID must match. To bind a quiet stream to a realm,
configure an existing read-only local connection-state endpoint with the expected
server address. It is checked every 15 seconds; a stale binding stops samples
after 30 seconds. Without that port, a fresh same-scope physical operation and
matching location/dimension must confirm the stream after each connection.
The endpoint is supplied by the caller, not imported from a host implementation.

This viewer exposes partial sprint/sneak state, **not complete per-tick inputs**.
Requested keys in an operation are retained as intent, not relabeled as actual
inputs. `controlsKnown`, `motorImitationReady` and independent server truth stay
false. The environment topic is the client's loaded world state, not a full
server-authoritative map, depth image or camera field of view. Never use hidden
world cells as an actor observation or infer exact buttons from displacement.

## Outcome signals and review

The evaluator stores vectors of progress/cost/risk signals with reasons, rather
than treating one scalar as the Agent's intelligence:

| Evidence | Interpretation |
| --- | --- |
| Intended item increases after completed craft/smelt/gather/take | Positive progress candidate; ingredient use is retained |
| Distance to a declared operation target decreases | Movement progress candidate; displacement alone is insufficient |
| Food increases after eating | Recovery progress candidate |
| Health decreases | Risk evidence with unverified cause |
| Progress together with harm, failure or partial completion | Mixed result for contrast review |
| Real terminal blocked/failed receipt | Failure-recovery candidate, not proof that the model chose badly |
| Rejected interface, cancellation, missing/stale state, unknown effect | Unknown/context/interface recovery; never fabricated success |
| Observation, chat, looking, equipment change or standing still | No movement-based penalty |

Comparable before/after states must be near their original operation timestamps
and in the same known dimension. Backfilled data is compared against those
historical timestamps, not today's clock. A method completing does not verify a
user goal: every record keeps `goalVerified:false`. Combat target damage,
cooldowns, mana, spell effects, long-term task success and counterfactual blame
remain unknown unless a separate real receipt supplies the evidence.

Use later review to distinguish a poor choice from missing candidates, stale
state, unavailable resources, dispatch rejection, controller failure and a
different actor changing the world. Keep negative and mixed evidence. Split by
episode/time/world before training and evaluate on held-out scenarios; adjacent
frames and revisions of one request are not independent trials. There is no
automatic SFT target, reward, preference pair or skill adoption here.

Memory integration uses the original `mc-experience:<scope>:<sourceId>` evidence,
exact method revision and adopted `memoryRefs`. A host may explicitly reflect
through `mc_memory` and later evaluate actual adoption. Merely retrieving a note
or recording a choice is not learning. See the `minecraft-learning` skill.

## Durable format and export

MCAP contains `/gameplay/experience`, `/gameplay/observation` and
`/gameplay/environment`, all using the typed FlatBuffers `MCL1` schema and
embedded BFBS reflection. Node runtimes supporting Zstandard compress chunks;
otherwise compression is explicitly `none`. MCAP CRCs and sealed-file SHA-256
checks protect reads. Exported Python bindings ship with the schema.

Writes are serialized with bounded backpressure. Segments rotate by count/time;
only a sealed `.mcap` plus its committed `.manifest.json` is eligible for review.
On restart, committed cursors are restored and original source revisions are
deduplicated. Incomplete/orphaned files remain retained and excluded. A stopped
recorder never retries a game action. Storage failure or the configured byte
budget stops archival writes, retains existing data and exposes an unhealthy
status. There is no automatic deletion; the byte budget can exceed by at most
one bounded pending segment plus metadata. Archive integrity is checked on
restart; large archives require proportionate startup I/O.

Watch notifications are bounded and may include repeated metadata-only events.
A full reconciliation drains changes in bounded batches, so a burst larger than
the queue does not truncate recovery to its first batch. Deleted source files
leave the queue; a later creation is picked up by watch/reconciliation. Notification
overflow counts are not counts of lost operations. Audit sealed cursors against
stable source hashes to establish actual coverage; intermediate source revisions
not retained by the original mutable journal cannot be reconstructed.

`status.json` is updated every five seconds. Its label counts are **record
revisions**, including observations; use the exporter for unique operations.
It reports source freshness, missing notifications/errors, viewer identity and
binding, pending/sealed writes, byte budget and the absence of control/model
calls. A process being alive does not prove fresh observations or task success.

With the training requirements installed:

```console
python training/export_gameplay.py /private/agent-gameplay/data --output /private/reviews/window-1.jsonl
```

The exporter validates sealed hashes/CRCs/schema/scope, keeps the latest original
operation revision, quarantines conflicting equal-time revisions and excludes
observation-only frames from action targets. Output is a review dataset with
`split:"unassigned"` and `automaticallyApprovedForTraining:false`. It refuses to
overwrite previous exports. The adjacent report includes source hashes, sample
counts and known coverage gaps. No private run or profile belongs in a release.

## Explicit profile

Paths below are examples. Select the existing source scope and actual player
identity from your own host; do not copy another Agent's identity. `connectionRead`
is optional; a POST port, if used, receives only the literal `{"args":[]}`.

```json
{
  "scopeKey": "<64-lowercase-hex-existing-scope>",
  "sourceDirectory": "/private/agent/minecraft-memory/operations/<scope>",
  "directory": "/private/gameplay/data",
  "statusFile": "/private/gameplay/status.json",
  "maxBytes": 10737418240,
  "maxRecords": 512,
  "segmentMs": 60000,
  "sealEveryMs": 60000,
  "viewer": {
    "url": "http://127.0.0.1:7793",
    "expectedUsername": "<actual-self-name>",
    "expectedUuid": "<actual-self-uuid>",
    "sampleMs": 500,
    "worldCells": true,
    "connectionRead": {
      "url": "http://127.0.0.1:7789/read-only/connection/state",
      "expectedAddress": "example.invalid:25565",
      "method": "GET"
    }
  }
}
```

Stop only this recorder to pause collection. SIGINT/SIGTERM seal pending data;
after a forced stop, uncommitted fragments stay excluded and the process lease
recovers after confirming that its owner is gone. Rollback means stopping the
recorder and selecting a prior packed runtime; retain archive/source history.
It does not change the host's game, model, goals, memory or controller settings.
