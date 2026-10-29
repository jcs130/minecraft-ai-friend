# Recovering a rejected goal plan

Goal-plan errors include the failing operation path and the selected probe's
accepted fields. Independent errors in separate steps or probes are reported
together (up to eight paths, with an explicit remainder count). Repair guidance
is included once per source; the entire plan remains rejected, so valid pieces
cannot silently replace the old plan. Position and dropped-item errors include a complete shape
with placeholder values. Replace those placeholders with observed facts or the
intended target; the example is not an instruction to travel or gather items.

- `position` uses `region: [[x1,y1,z1],[x2,y2,z2]]` and `dimension`. It checks
  current containment, not whether a historical arrival occurred.
- `item` counts dropped items in an observable region. It cannot query a server
  commission by `key` or `field`, and a pile of emeralds does not prove a reward
  was claimed. Its 4096-cell observable-volume cap remains; position containment
  does not scan cells and does not share that cap.
- `status` reads only `health`, `food`, `oxygen` and `burning`. Equipment,
  commissions and server dungeon states have no implicit status field.
- Server replies, conversations and historical actions use a step's `judgment`
  instead of `verify`. Later `milestone` evidence remains a host judgment, not
  independent proof of success.
- A rejected `revise` reports `revise.plan[...]` and leaves the original goal
  and its evidence intact. It does not silently reinterpret unknown fields,
  save a partial plan, or mark a step complete.

Goal bookkeeping neither starts nor pauses body tasks. After a schema failure,
keep the intended result and choose a suitable evidence source; do not substitute
an unrelated predicate merely to make the plan parse.

The repair hints address repeated argument guessing. They do not establish that
a model will follow the hint or that live request latency has improved. Test the
packaged SDK/MCP rejection and repaired submission before adopting an update.
