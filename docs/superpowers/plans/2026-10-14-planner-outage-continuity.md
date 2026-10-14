# Keep the body alive during transient planning outages

**Goal:** A temporary inference HTTP/transport failure pauses planning and retries with bounded backoff while the native Minecraft connection, event polling and reflexes remain alive.

**Evidence/spec:** At 17:55:12 Beijing on 2026-10-14, the live 0.1.24 session exited with `brain_http_error_503` and the browser reported `NATIVE_WORLD_STREAM_DISCONNECTED`. The model and vanilla server stayed running; the cleanup ledger contained no unknown dispatch. A prior session also exited on `brain_transport_error`.

**Architecture:** Only the shared framework changes. `HttpPlanner` classifies transient inference failures using a typed, sanitized exception. `Controller.turn_once` handles that type through its existing pre-dispatch rejection/backoff path. Native dispatch errors, permanent model HTTP errors and cancellation keep their existing semantics. No inference retry inside the provider and no game action replay.

**Files:** `planner.py`, `controller.py`, `tests/test_planner_outages.py`, package version/README; then the thin plugin's pinned dependency/version and acceptance record.

- [x] Reproduce HTTP 503 teardown and transport classification with offline fake HTTP/body ports. Check successful recovery preserves history, events, native work and one connection; repeated failures cap delay at 300 seconds; user feedback/stop remain effective; permanent errors/unknown native outcomes still propagate.
- [x] Add `PlannerUnavailableError` for HTTP 408/429/500/502/503/504 and transport/timeout errors. Catch only it alongside `PlannerResponseError` at the inference boundary; record a sanitized non-dispatch receipt and keep the existing bounded cooldown.
- [x] Run focused regressions, all package tests, Ruff, build a 0.1.25 wheel and run the SDK-free isolated consumer. Commit and ordinary-push main after checking concurrent upstream changes.
- [ ] Pin framework source in plugin 0.5.11, run adapter tests/Ruff/official release and Market checks, inspect the archive, commit/push. Keep the body build, server, model and Neko main continuous.
- [ ] Restore only the failed owned framework with a fresh private proof directory and the already matched token counter. Reopen and watch actual browser frames; collect a separate natural survival window. Do not induce live provider faults or claim offline recovery tests prove natural food/shelter success.

Validation: 14 regressions failed before the fix (four permanent-error checks already passed); all 18 then passed. Full package suite: 361 passed, including unknown-native-outcome and cancellation coverage. Ruff passed. Packed SDK-free autonomous and queue-only consumer passed with network/processes prohibited. Wheel SHA256: `8c30ab4e6bd2d768b9211142a77b2272e6ec9577099b25810e1308f8bc71a1d9`. Checked and fast-forwarded main to upstream `4adbcc4399e5c4ad9bfcfdbdc82c28a0575f1903` (memory changes preserved); no native body rebuild in this repair.
