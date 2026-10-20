# Planner cache continuity and deadline repair

> For agentic workers: follow the implementation tasks sequentially, using the available debugging and verification skills. Do not delegate or restart protected host/model components.

**Goal:** Identify and repair avoidable repeated cold inference behind the observed 180-second planner deadlines, preserving current gameplay, full evidence and the native queue.

**Architecture:** The host-neutral autonomy package owns request construction and enforcement. Keep provider capability declarations separate from per-turn policy if evidence proves declaration churn invalidates reusable prefixes. The thin plugin only pins the verified package. Model services and host SDK remain unchanged.

**Tech Stack:** Python 3.11, pytest fake planner/body ports, actual selected CPU tokenizer/template, hash-pinned wheel consumption.

**Spec:** Latest human request and `packages/agent-mc-autonomy/AGENTS.md`; runtime diagnostics in the private maintenance directory, never committed.

## Global constraints

- Keep the selected local model, 131072 capacity, native safety/reflexes, single body queue and original journals.
- Do not restart or modify Neko/SDK, Java services or the normal model service.
- Do not increase deadlines or discard evidence as a substitute for identifying repeated work.
- No paid fallback, synthetic model stress or game chat/TTS tests.
- Fresh ownership, terminal/unknown checks, normal drain/exit/lease release before an executor deployment; no old script or UUID replay.
- Fetch main before changes and push; preserve unrelated edits. No release/tag/Market publication.

## Review focus

- Ahead planning may append/read only; hiding a tool must never be the sole enforcement.
- A delayed read remains unavailable despite a stable provider declaration.
- Fresh current permissions and queue limits must be explicit to the model.
- Identity/capability changes may legitimately invalidate a prefix; do not reuse across actors.
- Preserve full retained scenes and original receipts; do not conflate input reduction, cache reuse and actual latency improvement.

### Task 1: Reproduce and distinguish causes

- [x] Align actual cold/warm requests, deadline/cancellation records and provider metadata.
- [x] Exercise the real controller seam with a fake provider and body, changing only ahead/read eligibility. Capture actual provider declarations and normalized token prefixes using the selected local template.
- [x] Compare history retirement and local model contention separately. Keep private raw evidence outside Git. They remain possible contributors; older timeout records lack per-request layout, so they are not assigned a proven share.
- [x] Record red assertions before any production behavior change; reject unsupported hypotheses.

### Task 2: Repair the confirmed request-construction defect

Potential files: `controller.py`, `context.py`, `context_full.py`, targeted tests and the context/cache documentation, all under `packages/agent-mc-autonomy`.

- [x] Keep unchanged provider capability declarations reusable while exposing current restrictions in the fresh tail, only if the controller-seam replay confirms this defect.
- [x] Continue validating against the current restricted tool set; reject disallowed actions before native dispatch.
- [x] Verify forbidden queue insertion, changed/failed anchor, deferred reads, compact compatibility, narration and full-window/counter fallback.
- [x] Add bounded non-content diagnostics for request/policy identity where useful; never log private payloads or credentials.
- [x] Run the complete package regression and isolated wheel before commit: 1,387 package tests, 100 wheel tests and SDK-free fake-queue probe passed. Pinned thin-adapter checks follow its source-pin update in task 3.

### Task 3: Pin, deploy and observe

Live 0.2.73 follow-up exposed a second trigger: unchanged head/tool hashes but
two retired history groups preceded a 106,549-token request deadline. A new red
controller regression reproduced repeated rotation with large complete
exchanges. The 0.2.74 follow-up adapts only the existing nonzero overflow margin
to measured exchange growth, caps it at one quarter window, preserves fitting
history/fresh evidence and keeps the latest fitting exchange. Full regression:
1,389 passed after repairing the selected-memory counterexample. Exact-template
CPU replay distinguishes this from the first tool-policy defect. Model and host
remain protected; connection reset/timeout evidence is a separate live boundary.

- [x] Update the thin plugin's explicit source pin and development version, without a second implementation: 0.6.78 pins autonomy 0.2.74 at `7ac713e5b517e082b71213023ca9eada4ab4299a`.
- [x] Follow fresh normal lifecycle controls, preserving ongoing project evidence and original failed methods; no old action replay. Both stages used distinct new stop ledgers, verified drain/exit/lease release, and kept host/model/config unchanged.
- [x] Observe natural ordinary/ahead transitions and real queue outcomes. Stage one kept declarations stable across ordinary/ahead work, then exposed the independent rotation timeout. Final stage reached 121,454 actual input tokens; its first adaptive rotated request and three following replies returned, with 13 model responses and no deadline rejection over about 11 minutes. This is a bounded trial, not long-term performance or survival acceptance.
- [x] Save actual source/package/deployment/live evidence; update maintenance offsets separately from the last completed full inspection. Final record `deadline-root-cause-20261021T0148/rotation-final/maintenance-result.json` is private; full inspection time remains 2026-10-20T17:34:07.923324+00:00.
- [x] Push verified changes normally. Code commits are `1369c56f` and `7ac713e5`; adapter commits `e276db7` and `71c1a8a`. No publication. Keep monitoring cold rotations, actual project progress and shared-service pressure; queries/blocked work are not completed survival goals.
