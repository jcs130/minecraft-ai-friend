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

Live follow-up exposed a second variant: the intervening observation itself
failed validation, overwrote the body error, then cleared both when corrected.
Version 0.1.30 keeps the body error primary and attaches at most one later read
error. Cached invalid-read retries use the same retention path. Correcting the
read removes only its companion diagnostic. Both replay variants fail on 0.1.29
and pass on the corrected controller.

The follow-up passed 389 framework tests after integrating concurrent upstream
source, plus the 12-case installed-wheel replay and offline autonomous/queue
probe. Eight style violations in the incoming Java-client test file are an
upstream lint baseline; changed controller/replay files pass lint. The deployed
Mineflayer core remains the separately checked pin above; the new upstream Java
body is not enabled by this repair.

The live planner also returned repeated text-only intentions with no function
calls. Such replies correctly dispatch nothing, and the existing bounded
backoff can leave the player idle for minutes. Version 0.1.31 allows explicit
`tool_choice="required"` for Chat/Responses providers supporting that option.
It is not a scripted body fallback: the provider must return a tool choice, the
model selects its arguments, and native admission still decides whether it can
execute. Defaults and other protocols remain unchanged. Requests with no tools
omit the setting. The local provider's implementation was checked before opting
in; its forced nonthinking prefix must also be counted by the deployment's CPU
token-counter adapter. The 0.1.31 framework passed 394 tests; its isolated wheel
passed 68 provider/rejection replay tests and the offline autonomy/queue probe.

A further lifecycle replay showed that `feedback_pending` bypassed the turn
boundary for a newly accepted scout: the planner could run all six rounds before
the read completed. Version 0.1.32 ends the turn for every newly accepted
nonterminal native task, preserving the feedback insertion policy until its body
plan is submitted. Immediate help reads remain available within a turn, and old
unrelated native work does not block safe planning for a new goal. The failing
replay changed from six premature model calls to one call awaiting its terminal
receipt.

The final boundary revision passed 395 framework tests and 69 tests against an
isolated installed wheel, plus the offline autonomous/queue-only probe. No game,
host service or model was called by these tests.

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
