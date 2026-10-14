# Rejected body plans and queued observations

An accepted observation has a native task ID, just like a body action. The
autonomy controller previously cleared its last tool rejection on *any* accepted
task. Replaying `mc_do` rejection → queued `mc_scout` (or observational `mc_do`)
→ terminal read → history eviction reproduced a missing rejection in the next
planner request. This made repeated unsuccessful batches harder to correct.

Autonomy 0.1.29 classifies known observation steps conservatively and keeps the
body rejection in the request tail. It records read activity for observational
`mc_do` too. A corrected observation may clear its own invalid-parameter error;
an unrelated accepted read cannot clear a body rejection. A corrected body plan
can replace the rejection, while its acceptance still remains nonterminal and
does not imply goal completion. Unknown native outcomes retain blocking.

When a batch is refused, the feedback explicitly says its earlier steps did not
run. The planner can submit its next feasible action separately from a blocked
optional search or an unverified crafting dependency. Native admission guards
and the sole body queue remain in place; no manual recovery action is injected.

The native client's entity search itself already resolved `chicken` correctly.
Its accepted, empty-search and retry feedback incorrectly used the food item's
Chinese name. The checked core now reports the live entity as 鸡 while inventory
and eating retain 生鸡肉. The regression reaches the actual world tool, executor,
terminal facts and repeated-search admission guard.

Validation on 2026-10-14:

- Both queued-read replay variants failed before the controller fix. The native
  receipt replay failed before the label fix.
- Framework: 379 tests passed; an isolated installed wheel passed the 10-case
  replay and autonomous/queue-only subprocess probe with host imports and network
  prohibited.
- Native core: 701 tests passed, one optional viewer-input test skipped. Clean
  engine build, source typecheck, isolated packed runtime and NodeNext/Bundler
  declaration consumers passed.
- The committed native source and tested snapshot produced equal source/runtime
  manifests. Its exact archive SHA and executable/declaration receipts are pinned
  in `core_distribution/source.json`; a new dedicated backend installation passed
  disconnected MCP checks with network denied.

These offline checks establish the specific fixes and packaging boundary. They
do not establish long-term autonomous survival, model compliance with host tool
instructions, food acquisition or voice playback. Deployment and fresh gameplay
observations must be checked separately.
