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
