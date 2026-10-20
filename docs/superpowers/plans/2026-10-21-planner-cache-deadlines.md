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

### Task 4: Reopened shared-cache capacity follow-up

The finite 13-response window above ended before a later 115,802-token request
exceeded the same deadline. Its retained head/tool/first-history hashes stayed
unchanged and no group was retired. Subsequent requests also encountered
deadlines. This is new evidence, not proof that the two source fixes failed
their reproductions or that the short window established a general solution.

The installed engine reports 386 usable FP8 cache blocks. CPU replay through
that engine's own specs reproduces its budget: one full 131,072-token request
uses 360 blocks and a 6,400-token review uses 78. Their combined 438-block
admission cap exceeds the pool. Four configured sequence admissions never
meant four resident 128K contexts. Actual gateway reviews and queued engine
work corroborate contention, without a request-ID-level wire trace assigning
every timeout to that cause.

The human explicitly requested more actual residency. This adds a narrow
exception to this plan's original model-continuity constraint: a normal,
owned-service configuration replacement may be evaluated after body/adapter
drain. Neko/SDK, Java, driver, power, weights and paid-fallback restrictions
remain unchanged. The pinned HyperQwen image already contains its KVarN
backend. Its DFlash2/huge profile predicts room for a full game request and a
small review with the same 128K per-request capacity; two full 128K requests
still do not fit. It uses a lossy cache and sparse recurrent-state retention,
so startup, natural inference, cache reuse and queue outcomes require separate
validation. No synthetic pressure campaign is authorized by this follow-up.

- [x] Replay both budgets on CPU; preserve the later failed requests.
- [x] Prepare a fresh normal stop/drain and exact environment rollback ledger.
- [x] Confirm actual KVarN geometry and healthy initialization. The engine reported 209,132 equivalent tokens, 358 usable blocks and the predicted 225-block full-request cost. Two simultaneous natural requests were observed, with no preemption.
- [x] Reject KVarN as the timeout solution: the reviewed trial had five successful body replies and four deadline rejections. Some warm replies reused 43K/52K tokens, but a 99,233-token request still took 201.41 seconds in the engine and missed the 180-second client deadline. Shared-memory usage and missing periodic log lines alone did not prove paging, a GPU fault or a cancellation root cause. No host/provider code was changed on those hypotheses.
- [x] Use a separately journaled normal operation for the same pinned model's MTP/FP8 profile. It keeps vision, 128K, strict=function and the full draft vocabulary. Its actual budget is 275 usable blocks with 15 fixed blocks per active request and 173 blocks at 128K, compared with DFlash2's 54 fixed blocks. This allows a long game request plus a short review with more room, without additional 4/2-bit KV compression. Admissions remain two for this evaluation; two full 128K requests still do not fit.
- [x] Resume the same 0.2.74 runtime without replaying actions; keep Neko/SDK and private game settings unchanged. Natural MTP replies have reached 101,451 prompt tokens with 91,520 cached and a 47.938-second response. This single finite sample is not a controlled cross-profile speed benchmark or long-term acceptance.
- [x] Complete the due full inspection separately at 2026-10-20T19:37:16.247514+00:00, reading the original full journal offsets and every known old-run tail. Fresh ownership, local bindings, stream/image and natural audio receipts were checked. Long-term survival, actual desktop playback and complete visual parity remain unverified.
- [x] Finish the bounded MTP observation and update the monitor. Fourteen body responses were recorded with zero body deadlines; ten completed before an announced server disconnect. Successful-response median was 47.2895 seconds and first output 32.9845 seconds. The official review gateway separately had one success and one timeout, so the whole chain is not timeout-free. The body reached 116,224 prompt tokens with real cache reuse, but the following smaller/cold contexts were caused by a server-connection/identity transition rather than overflow retirement. That boundary is not an adaptive-retirement acceptance test. The same body later reconnected naturally without a local restart. Remaining movement, persistent-project and long-term acceptance limits are retained.

HyperQwen upstream was fetched read-only through `63f7581804afe05f23f240c2f584a00ac18c488b`.
New MTP defaults are guarded out with this deployment's `VISION=1`; benchmark
timing and documentation updates do not justify changing the fixed image here.
The deployed source/image remain `95ac251b` and the original checked digest.
No additional synthetic model requests, driver changes or publication occurred.
