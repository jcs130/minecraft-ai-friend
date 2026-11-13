# Progressive request reading

`agent-mc-world/context` is an engine-free SDK entry. It imports no host framework,
model connection, transport, game runtime or character configuration. The same
helpers are also available from `agent-mc-world/client`.

```ts
import { contextSourcePage, contextFactReadings } from 'agent-mc-world/context';

// Select the intended realm/account/channel before paging. Keep exact originals
// in the existing journal and serve individual source ids on demand.
const page = contextSourcePage(localSources, { limit: 4, before: previousPage?.nextBefore ?? undefined });
if (!page.ok) {
  // The cursor was evicted or belongs to another selected scope. Refresh the
  // index rather than treating a different page as the requested source.
}
const facts = contextFactReadings('minecraft:realm-a:account-a', currentFacts);
```

`contextSourcePage` returns newest-first literal previews with every original
metadata field, source id, timestamp and cursor preserved. `previewContextText`
does the same for one fact or source. Existing truncation remains explicit. A
preview is not a full observation and never proves execution or goal completion.
These pure functions do not read, write, send, acknowledge or consume an event.
The caller must retain a working source-id/blob lookup and its original content.

`contextFactReadings` shares one source header in replacement mode. Each key and
original body retains its own time, uncertainty and identity. `{mode:'append'}`
keeps parts independent, so a health update need not append unchanged inventory.
Missing content is labelled as missing, not a known empty world state. The host
may localize `label`, `observationsNote` and `emptyText` without altering facts.

`contextExecutionReading(event)` extracts a bounded, attributed terminal from the
structured `execution` contract. Acceptance, running events and prose alone return
`null`. Failed, partial and cut step reasons retain the original `detail` text,
its length/truncation and client-visible change flags; large inventories are not
copied. The short `why` remains a preview. Older receipts without `detail` include
a labelled excerpt of the original event. At most four unsuccessful steps are
shown, with omitted steps counted. A completion for another task does not resolve
this task or its goal. The host owns persistence, expiry and selection for requests.

Native death observations carry `execution.kind: "observation"`, the same death
episode ID, `terminal: true`, `goalCompleted: false`, and evidence with
`outcome: "death"` and zero health. Terminal here means an observed outcome,
not successful completion. Later server leave/cleanup receipts do not change that
earlier outcome. Hosts can keep this small dated cause alongside recent state
without retaining the entire snapshot history in each model request.

`omitContextSchemaAnnotations(schema)` leaves validation keywords, fields and
alternatives intact while moving `x-agent-mc-skill-contracts` behind complete
help. The annotation contains on-demand generation material, not input-schema
validation. Property names, constants, enums, defaults and other literal values
are preserved. Full declarations, generation APIs and handlers retain the
original annotation. The compact MCP catalogue and on-demand parameter view use
this same helper; hosts can also use it through the engine-free context entry.

This is request presentation, not automatic event deletion or a new background
Agent. Native tool call/result pairing, recent/protected records, pending user
intent, memory, exact expansion and model scheduling remain with the host.
Include extra expansion calls and catalogue costs when measuring token savings;
smaller individual previews alone do not establish lower total cost or latency.

## Current task progress coverage (rc.90 candidate)

Mineflayer current facts include a `taskProgress` part and declare
`minecraft.task.progress` in `snapshotTypes`, alongside world and queue state.
The part distinguishes the current task/step, waiting work and body holds from
the latest matching periodic sample. The sample retains its original observation
time, net displacement, count and detail; reading it does not refresh its age.
A different task, a different step or a new connection cannot inherit that sample.
Missing samples remain unknown. Completion and failure still use independent
task terminal receipts.

Hosts may replace historical progress *state snapshots* in a model request when
this complete fact part is available. Preserve the raw event ledger and an
attributed retrieval index for historical movement, counts and outcomes. A null
or disconnected fact reading supplies no coverage. SDK status, extension facts
and MCP `mc_protocol` facts share this same core part; no model call is required.

`MovementProgress` also counts repeated ground modifier-key requests without
resetting the movement streak. Its `kind: 'control'` is a request-pattern hint,
not evidence of failed execution or absent world progress. Water descent,
flight ascent/descent, directional controls and view changes have unknown motion
in this input contract and do not yield a no-movement verdict. Check actual
position/height, constraints and task terminals before a host intervenes. This
helper does not cancel work, close goals or schedule model calls.

For a worker that holds the physical body, `executionFactParts` includes the
World's `executionPartKeys` in addition to the worker's optional selections.
The current queue and last native terminal are distinct. An absent current
partition stays unavailable even when older observations remain in the archive.

A native server message can carry `meta.executionFeedback`. The consumer
checks `hasExecutionFeedbackContext` against the original text and routes it
to the active worker in the same World independently of optional event
subscriptions. The marker carries neither a command correlation nor proof of
an effect. Independent read queries return their matched replies directly.

## Scoped decision evidence and semantic fact dependencies

`WorldRequestFacts.partDependencies` declares producer-owned semantic dependencies.
`executionFactKeys` and `executionFactParts` resolve them transitively, with stable
ordering and cycle protection, including after a host overrides a profile's focus.
For example, `gear` (held item and bag) also requires `equip` (worn armor/offhand)
and `inventoryIds`; spare boots in a bag do not describe what is worn. An absent
dependency is explicitly unavailable, never restored from an old snapshot.
SDK `currentFacts()` and MCP `mc_protocol action=facts` expose these declarations.

`projectDecisionEvidence` creates bounded original excerpts of host-selected
intent, report, current facts, calls and native events. It labels truncation and
omissions and retains exact read routes. `complete` means presentation coverage
only, never execution or goal completion. The host retains original archives and
chooses a world/task/report version; the helper does not request models or modify
state. Keep this material in a replaceable request suffix until that logical
decision is reviewed, then remove it. Do not append it to stable personality or
long-term memory. A compact current-state index cannot claim full snapshot coverage.

`decisionBoundary` is an opaque critical body identity. On the Mineflayer backend
it changes on a connection generation, death episode, native world/dimension
change or material forced displacement (at least eight blocks), not normal
movement, health or hunger ticks. Consumers may reject an unissued stale side
effect and read fresh facts. They must not replay or erase an accepted action.
Death observations use `preempt`: hosts can cancel an unexternalized model
request; this is not permission to cancel running tools or server operations.
Legacy producers may omit the boundary and dependency fields.
