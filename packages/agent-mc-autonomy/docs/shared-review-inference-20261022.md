# Explicitly shared strategic/body inference

Two admitted model sequences share physical compute. A new long body prefill can
delay a high-level review already generating a short decision. The native body
queue and fast reflexes do not depend on either inference. This optional control
coordinates only admission of new slow body requests.

`autonomy.review_model_pool` defaults to an empty string (disabled). An operator
may set the same opaque pool name in body and host-adapter settings **only after
confirming that they actually use the same inference resource**. Different model
resources need no such coordination. No endpoint, credentials, server or persona
is discovered by this package. Pool names are bounded ASCII identifiers.

After real inspection and immediately before its first provider await, a host
calls `ReviewPort.begin_model_inference(review_id, pool)`. A SQLite transaction
creates a scoped window under the original review expiry (never beyond 180
seconds). It does not acknowledge a review, submit a body command or modify native
pending/unknown state. The host holds it over optional evidence/correction calls
and ends it in `finally`, including on timeout/cancellation. A late release cannot
remove a newer window.

An opted-in body checks this signal before a new turn and again after assembling
input. It keeps polling native work, connection and user commands while deferred;
no decision budget or lookahead opportunity is consumed by a wholly deferred
turn. It does not cancel or discard a request already in flight. A request admitted
just before a review may still overlap; this is not a provider-wide mutex or a
claim that every host request is serialized. Unrelated host/model traffic is not
controlled.

Pool/session/world/intent/baseline mismatch, stale observations, expiry, disabled
review policy, stop, death and runtime failure invalidate a hold. New user feedback
and native urgent events keep their existing priority. The old row is not replayed
or treated as a game action. Optional review-store errors are reported without
killing native gameplay. No second body queue, new inference loop, worker, model
service, timeout expansion or forced project choice is added.

Native receipts and scoped `planner_model_wait` evidence must show that ordinary
work continued, a new body inference did not start under a valid hold, and the next
inference resumed after release. Provider success, canonical review adoption and
actual project progress remain separate acceptance criteria. Live contention is a
hypothesis to verify with actual request/engine timing, not an inference from low
GPU utilization or a single timeout.
