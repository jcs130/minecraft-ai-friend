# Preserve goal authority and rejected-call learning

Live 0.1.20 reviews resumed, including official host speech, but the main brain kept proposing obsolete practice stages. Inspection found host stages encoded as generic feedback and described to the planner as current user priority. Separately, rejected model calls were journaled but their exact call/result pair was absent from the next request.

Scope: keep explicit user intent, standing goal and host suggestions distinct; preserve original parent lineage through optional paged lookup. Retain complete rejected wire envelopes paired with non-dispatch failure receipts; malformed IDs/functions must not poison provider history. No host SDK copies, semantic exam filters, automatic game actions or model changes.

- [x] Implement provenance, parent lineage and legacy UUID compatibility in the shared mailbox/review/CLI.
- [x] Add rejection-history regressions (four failures before the fix; malformed envelope boundaries retained).
- [x] Run full shared tests, Ruff, final wheel and isolated consumer; commit/push.
- [ ] Update the thin adapter, package and deploy; distinguish runtime recovery from survival acceptance.

Neko's currently installed public notification SDK cannot request an isolated, non-persistent strategic review. The adapter must not impersonate the old plugin identity or silently modify the host. This remains a separately documented compatibility limitation; provenance does not prove it eliminated all historical influence.

Full shared suite: 282 passed; Ruff passed. The 0.1.21 wheel passed isolated autonomous and queue-only consumption without host SDK imports, network or actual gameplay. Live 0.1.20/0.5.6 restored real main-brain decisions and online speech/playback receipts, but its nine-sample 16:05:36–16:09:36 window had no position, health or hunger progress, so survival remains not passed. Subsequent deployment is recorded separately by the adapter.
