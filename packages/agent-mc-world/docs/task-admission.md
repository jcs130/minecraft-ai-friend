Owner: `core/executor.ts` (`submitDetailed`), `core/world.ts` (`submitSkills`), `core/server-action-wait.ts`, `src/client/goal-closure.ts`.

# Task admission and historical evidence

The host chooses goals, retries, inventory value and disposal. The executor
reports historical attempts and current observations without converting repeated
failure, repeated success or a storage preference into an admission quota.

| Evidence | Behavior |
| --- | --- |
| Earlier search, probe, route, farming or container failure | A dated history note; the new operation can recheck the world. |
| Take followed by stow, repeated peeks, vertical return trips, rapid stops | A description of the requests or receipts; no timer forbids the next request. |
| Caller-selected discards | Multiple item classes and subsequent pickup are permitted. Toss checks actual space and settled inventory loss. Generic pickup excludes identified recent discards. |
| Named item variants | Full stacks use the selected slot. Ambiguous partial selection is rejected because a type-based toss cannot identify the intended stack. Names do not establish item value. |
| Rejected goal closure | Reports missing evidence without changing the goal or ending the host decision turn. |
| Repeated cancellation or queued attacks | Stop always cancels; an appended attack waits for the body owner and rechecks its target when executed. |
| Busy queue or unavailable screenshot | Returns current queue/capture evidence without ending the host turn. Same-round identical readouts may reference the previous answer. |
| Server wait | Only the correlated duration reported by the server is enforced. Repeated unchanged queries do not create extra cooldowns. |

Argument validation, confirmed item identity, current body ownership, inventory
synchronization, window identity, actual collision/support checks and explicit
server permissions remain execution boundaries. Planned repairs are not credited
as completed construction. A failed dependency still skips work that requires
its result. Admission and tool return do not establish world effects or goal
completion.

Automatic container selection ranks earlier failures after other candidates;
it does not exclude them. An explicitly named container is reopened and checked.
Bounded scans, cancellation deadlines and per-operation work budgets remain
computational bounds; they do not impose a choice of gameplay activity.

`repeatSuccessFallback` retains its old configuration keys and values. When
enabled it selects success-history notes and never refuses a task or skips a
step. No configuration rewrite is required. Existing rejected-route ledger files
remain historical data; task admission no longer loads them as route bans or
starts an escape action from rejection counts. Explicit escape and physical
survival mechanisms remain separate operations.
