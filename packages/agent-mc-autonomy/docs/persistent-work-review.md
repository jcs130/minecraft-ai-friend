# Persistent native work reviews

An ordinary native task wakes the planner when its terminal receipt arrives.
`follow` is different: a valid target can keep it running indefinitely, so a
planner waiting only for terminal events can remain silent for hours even while
the body, connection and event poll are healthy.

The SAO recovery backport and subsequent releases offer a planning turn at
`autonomy.idle_decision_seconds` intervals while it owns a known `mc_do` task
containing `follow`. The current body facts and the original pending execution
remain in context. The model can retain useful following, inspect its purpose,
or explicitly call `mc_stop` before choosing finite subsequent work. The host
does not infer success, cancel automatically, create another queue or start a
separate model loop.

The review uses normal inference backoff and review admission. Explicit user
feedback and stop commands still take priority. Unknown delivery, another game
scope, another goal's ownership, death recovery and in-flight native requests
do not gain a new dispatch path. Terminal receipts or scope changes invalidate
an in-flight review so a late stop cannot affect successor work. A successful
model stop ends that review turn before any further planning.

`planning_handoff.mode` and model journals report `persistent_review`, with the
same original execution ID. Finite tasks keep their existing event and single
lookahead behavior. Queued successors do not conceal an indefinite follow.

Offline tests use fake body/model ports and a controlled clock to verify review
frequency, continued useful work, model-requested cancellation, terminal races,
queued successors, backoff and ownership boundaries. An isolated wheel consumer
checks the installed code rather than relying only on source imports. These
checks establish scheduling and ownership behavior; actual survival, movement
and inventory goals still require their native receipts and world changes.
