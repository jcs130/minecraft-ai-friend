# Preserve context across host stage revisions

Live 0.1.22 reviews revised the same delivered stage at 16:46:14 and 16:47:11
Beijing time. Controller.external_command unconditionally cleared tool history
after every accepted feedback, including a same-stage host revision. The existing
wire capture ended before these revisions; the clearing mechanism is demonstrated
by source inspection and a failing offline regression, not a claimed live memory
capture.

Keep complete groups only after successful activation of a revision whose origin
is host_review. Mailbox already requires an insert revision of a planning target.
New goals, explicit user feedback, unknown provenance and stop semantics remain
unchanged. No model, native body, provider or review cadence changes.

- [x] Reproduce help/rejection loss with the original controller (1 failed, 6 passed).
- [x] Preserve original paired exchanges through consecutive revisions and UUID retries.
- [x] Verify user replace/insert, unknown revisions and new host stages still clear history.
- [x] Complete shared suite (295 passed), Ruff and independent source review.
- [x] Build and validate an isolated wheel; ordinary commit/push follows this receipt.
- [ ] Consume in the thin adapter, deploy and capture requests spanning real revisions.
- [ ] Observe a natural survival window and record the actual outcome separately.

Final wheel SHA256: 429fbd988885cdd4b513fba261b83bca1e3388b2b29419eb21cbcfe62bfb99f4.
Isolated autonomous and queue-only probes pass with no host import/network/game.
Independent review found no new normal-entry queue or retry issue. Origin remains
caller-provided provenance, not authentication; the existing ReviewPort uses its
own active request and revision compare-and-swap. Native queue/state and in-flight
model preemption are unchanged.
