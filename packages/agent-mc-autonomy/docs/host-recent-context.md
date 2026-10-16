# Generic recent host context (0.1.74)

The canonical controller reads optional recent attributed language on **every
actual model invocation**, including later tool rounds in the same native turn.
It replaces the final dynamic user JSON tail; it never appends this language to
gameplay history, tool exchanges or the stable persona prefix. Current user
intent, native facts, failures, receipts and death evidence remain authoritative.
Historical user messages are not submissions, authorization, cancellations or
goal replacements. Accepted/unknown speech is not proof of playback or hearing.
This follows the semantics of current host pins plus a stable identity; it does
not share a host's private prompt or full model session.

## Public ports and ownership

```python
from agent_mc_autonomy.host_context import HostContextPort

port = HostContextPort(host_directory)
metadata = port.publish_recent(projection, binding=status["host_recent_request"])
projection_or_unavailable = port.read_recent(request)
```

`binding` is the complete current `host_recent_request` from normal status,
including `as_of`. `projection.binding` contains the same fields **except**
`as_of`. That wall-clock timestamp is not part of identity. The controller builds
the request from Settings identity, a validated base/static actor, runner-owned
runtime session, the admitted native event run, actual realm/account/agent scope,
mailbox intent revision and nullable native death episode. Missing authoritative
facts yield `host_recent_request=null`; standalone gameplay continues.

Status also exposes `settings_identity`, `runtime_session`, `native_run`,
`game_identity`, and `body_death_episode_id`. The port cross-checks all of these,
the request, phase `running`, connection `true`, and status freshness ≤30 seconds.
It checks the current base/static actor again before publishing or reading.
Statuses/request fields are canonical output, never values chosen from imported
message text. A replaced actor, intent, session, run, scope or death episode makes
an old snapshot unavailable. Base publication with changed actor/intent/session/
revision also removes the old recent sidecar.

`publish_recent` atomically writes only `host-recent-context.json`. It never
renews `host-context.json` or `host-character.json` and their 600-second leases.
Existing base-only callers continue to work. Errors return bounded metadata such
as `{"available":false,"reason":"publication_rejected"}` or
`snapshot_unavailable`; private exception text and message content are not logged.
Direct `host_recent.validate` raises bounded validation codes for offline callers.

Both `Controller` and keyword-only `run_session` arguments accept
`host_context_provider(revision)` and `recent_context_provider(request)`.
Providers are selected by identity (`is not None`), including falsey callable
objects. An injected recent provider returns the same strict projection or
`{"available":false}`. A synchronous callback must be a nonblocking local read.
An async callback gets one outer deadline of 0.5 seconds, no retries, and must
cooperate with cancellation. Waiting polls the existing native event seam and
checks stop, user feedback, death epoch and binding/revision before inference,
including error/timeout cleanup. Timeout/error omits optional context and leaves
the normal game coordinator running. No model call is added.

The 0.5-second optional deadline includes waiting for native event transport,
lease renewal, archive-gap recovery and recovery facts. If a native poll cannot
finish in time, inference is deferred; one shielded poll remains owned by the
coordinator and is drained exactly once before new decisions or commands.
Provider/validation failures are optional; native event/transport errors propagate
through their authoritative path, including durable unknown-outcome fences.
Shutdown observes a completed poll's error or fences an unresolved poll before
cancelling and closing transport. It never silently discards a late unknown page.

External runtime defaults are file-only. An external adapter refreshes through
its existing observer; a 10-second observer gives disclosed bounded staleness,
not query-at-every-round transport. The body never waits for bus refresh, calls
an SDK or starts a new timer. Producer selection belongs to the adapter. This
package imports no host SDK, provider, endpoint or private host history.

## Synthetic payload

All field names are strict; unknown fields and unknown schema versions fail
closed. Identifiers/source/turn labels are neutral provenance tokens, at most
160 UTF-8 bytes (scope components at most 500 bytes).

```json
{
  "schema": "agent-mc-host-recent/v1",
  "binding": {
    "identity": "opaque-settings-id", "actor": "ExampleActor",
    "session": "runtime-session-id", "run": "actual-native-event-run",
    "scope": {"realm":"test-realm","account":"test-account","agent":"test-agent"},
    "intent_revision": 3, "death_episode_id": null
  },
  "source": "public_committed_snapshot",
  "sampled_at": 10000, "expires_at": 10030,
  "coverage": {
    "state":"available", "received_count":1, "limit":60, "saturated":false,
    "selected_count":1, "omitted_count":0, "reasons":[], "arrival_cursor":9999
  },
  "recent_messages": [{
    "id":"record-1", "derived_id":false, "conversation_id":"conversation-1",
    "actor":"ExampleActor", "role":"user", "source":"public_committed",
    "turn_type":"user_utterance", "observed_at":9999, "occurred_at":9999,
    "clock_source":"producer", "text":"hello",
    "text_sha256":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    "truncated":false,
    "original_ref":{"source_id":"record-1","full_text_available":true}
  }],
  "recent_speech": []
}
```

Message roles are exactly `user` or `assistant`; an adapter must establish the
role and allowed producer from public producer provenance. It must discard
other actors, instructions, unknown/conflicting roles and private/unmatched data
before normalization. Never pass a raw shared-store page. No arbitrary path or
URL is interpreted as an original query. `original_ref.source_id` is descriptive
only; callers cannot supply body query handles.

Finite source occurrence and arrival epoch seconds must satisfy
`now-600 <= occurred_at <= observed_at <= sampled_at <= now`. An explicitly
labelled `clock_source="arrival"` requires occurrence and arrival to be equal.
Otherwise `clock_source="producer"` preserves the producer occurrence time.
Do not replace malformed/future producer timestamps or renew old occurrence
times on reread. `sampled_at <= now <= expires_at <= sampled_at+30` is required.

The stored selection contains at most four chronological messages. Adapters may
use `host_recent.select_recent_messages(records, binding=identity_binding,
sampled_at=sampled_at, source=source)` on at most 60 already-normalized, eligible
neutral candidates. It validates and selects newest four, protecting the latest
eligible user row. The candidates are not persisted. IDs distinguish delivery
identity; a conversation ID alone never deduplicates rows. Identical text under
distinct identities remains repeated language. Adapters without an exposed ID
derive a deterministic identity from actor/source/turn/role/occurrence/full hash
and mark `derived_id=true`. Duplicate selected source/record IDs are rejected.

Coverage state is `available`, `empty`, `unavailable` or `partial`. Counts describe
eligible normalized source records across both categories:
`received_count = selected_count + omitted_count`, and `received_count <= limit`.
`saturated` describes the source query's saturation even if local eligibility
filtering reduces its count. Reasons are at most eight lowercase underscore
diagnostic codes. `unavailable` is not an empty-success result.
`limit` is the combined normalized candidate capacity: for example a public
query of `max_count=60` plus up to three owned speech candidates uses `limit=63`.
This does not change or claim a public bus query limit of 63; adapters retain
their actual source query bound and account for both categories honestly.

Speech holds at most three chronological records from the last 300 seconds:
`actor`, `source`, `session`, `run`, `scope`, `opportunity_id`, `decision_id`,
optional nullable `speech_id`, actual `offered_at`, `receipt_state`,
`text_sha256`, `text_available`, and `playback_verified=false`. Receipt states
are `accepted`, `unknown`, `rejected`, `failed`. Session/run/actor/scope must
match the binding exactly. Only `text_available=true` permits `text`, together
with `text_boundary="owned_sanitized_submission"` and optional `truncated`.
Hash-only receipts must not contain text or boundary fields. No text is inferred
from a hash/audio; equal public hashes do not establish one-to-one speech links.

## Bounds and original queries

The complete UTF-8 JSON snapshot is at most 8192 bytes, including provenance and
immutable retained originals. Publication trims message text to 1600 bytes and
speech text to 600 bytes, preserving full-source hashes and marking truncation.
It then drops oldest optional records while protecting the latest user record;
if the whole envelope still cannot fit it rejects publication. Reads revalidate
the complete bound. Per-field caps never substitute for combined measurement.

The recent request-tail JSON is at most 2400 UTF-8 bytes. It also shares the
dynamic host allowance `min(2400, remaining//5)` in the configured counter's
units with existing selected intent/memories. Current goal/facts/failure/native
receipts/death and existing selected host data fit first. Excerpts are explicitly
marked `excerpt_truncated`; omitted record categories/counts, source coverage,
sample age and included byte count appear in metadata-only context diagnostics.
Tokens and bytes are measured separately. No context/model/output/framing/image
reserve changes are made: default 65536, optional 131072, explicit 32768 retained.

Only the controller's validated current snapshot can mint `host-context:<opaque>`
handles in `original_ref` with `tool="mc_original"` and `body_queryable=true`.
The existing `mc_original` schema is unchanged. It pages exact retained selected
text locally with offsets in Python characters and `1 <= limit <= 1000`.
The response has status `available`, `truncated_original`, `expired` or
`unavailable`; retained length/hash and full-source hash distinguish retained
text from an unavailable suffix. A source refresh never silently retargets a
still-live handle to different text. Handles are private to the controller,
bound to exact actor/Settings identity/session/run/scope/revision/death and TTL.
The in-memory original registry is itself capped at 8192 serialized bytes;
older originals can become unavailable under registry pressure. Queries never
read arbitrary files, invoke a host SDK, use network or dispatch native actions.
This local-only rule covers the complete tool dispatch and private receipt
archival, including text that expands substantially under JSON escaping. Such
pages retain exact characters locally and never become native artifact chunks.
Unknown/traversal handles in this reserved namespace fail closed. Genuine body
artifact handles continue through the existing `mc_artifact` route.

This is source/offline behavior. Public adapter integration and live game,
language, voice and playback acceptance remain separate work.
