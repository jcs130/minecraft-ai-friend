# Context and Review Evidence Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve model-matched historical context and factual failed-action evidence, and separate short strategic-review output capacity from action-planning capacity.

**Architecture:** Extend the existing explicit CPU-only counter port for vLLM Chat rendering rather than applying NInfer normalization to another backend. Keep evidence selection and review budgets in the neutral autonomy package; the Neko adapter only forwards supported public SDK fields. The native queue remains the sole body queue.

**Tech Stack:** Python 3.11, tokenizers, Jinja2, pytest, the existing public Neko model gateway.

**Spec:** This document, Scope and Global Constraints. Execution is native in the current session under the user's instruction to implement, test, push and deploy; no additional planning approval is required.

## Scope

The live local-model route currently falls back to conservative UTF-8 byte accounting because the exact counter only supports a different server. Strategic review omits structured observed effects while clipping native error strings. Its output limit is also inherited from the body planner even though it performs a smaller transaction. These are implementation boundaries to test; better token counting and richer evidence alone do not establish goal completion or universal latency improvement.

## Global Constraints

- Retain 131072-token service capacity, explicit endpoint/model/resource hash binding, and conservative fallback on unsupported input.
- Counting is deterministic and CPU-only: no provider, game or network access inside the counter.
- Preserve raw receipts, strict slot/cursor confirmation, unknown-dispatch fencing, user feedback and explicit stop.
- Never infer goal success from tool acceptance, movement, observation, or a model report.
- Preserve Neko main/SDK, the normal model service and server continuity. Only the owned independent executor and plugin adapter may undergo normal handover.
- No paid fallback, new release tag, public release or Market submission.

## Review Focus

- A model or template change invalidates its counter binding, rather than silently undercounting another route.
- Multimedia, literal special tokens and unsupported template behavior fall back without dropping original evidence.
- vLLM effort/tool defaults must not inherit NInfer-specific normalization.
- Structured effects are dated client observations, never a claim that a stage succeeded or a permanent prohibition on retry.
- A truncated review must not create an intent, speech, automatic retry, or a successful acknowledgement.

### Task 1: Model-matched local counting

**Files:** `packages/agent-mc-autonomy/src/agent_mc_autonomy/local_counter.py`, `packages/agent-mc-autonomy/tests/test_local_counter.py`, package README.

**Interfaces:** Extend `validate_configuration(value, *, model, base_url, protocol)` with explicit `mode="vllm_chat"`; retain `configured_counter(config)` and `LocalChatCounter(messages, tools)`.

- [ ] Add a test using the existing `configured` fixture with `context_counter.mode="vllm_chat"`; assert a Chinese exchange that exceeds the byte budget remains included when actual token counting fits.
- [ ] Run `python -m pytest tests/test_local_counter.py -q`; preserve the failure before changing implementation.
- [ ] Implement separate vLLM effort/tool normalization, preserving hash/model/URL checks, no media guessing, and byte fallback.
- [ ] Assert `render_input` preserves vLLM `reasoning_effort="high"`, while legacy NInfer retains its existing mapping to `xhigh`.
- [ ] Compare the local count against the current server's CPU-only `/tokenize` endpoint for text, tools and reasoning-history fixtures. Count requests are not inference requests. Keep deployment resources outside source control.
- [ ] Run context-counter and full-history regressions and document supported and fallback boundaries.

### Task 2: Preserve failed-action geometry

**Files:** `packages/agent-mc-autonomy/src/agent_mc_autonomy/review_evidence.py`, `packages/agent-mc-autonomy/tests/test_review_counterevidence.py`.

**Interfaces:** Keep `compact(evidence, reference, last_decision=None)` and existing immutable detail paths. Add a small safe effect projection to selected step samples rather than copying raw item metadata.

- [ ] Add a failed navigation/build fixture whose long `why` clips before important coordinates, with an `observed_effect` containing skill, dimension, target, change flags, coverage and `goal_verified=False`.
- [ ] Assert the production compact review retains structured target/flags and its original event reference, while staying within the existing bounded sample envelope.
- [ ] Run the test before implementation and preserve its missing-effect failure.
- [ ] Project only the allowlisted geometry/effect fields; include explicit observational/goal-verification semantics. Do not add action bans or choose a new objective.
- [ ] Test mixed success/failure, malformed effects, observation-only samples and displacement by later successful reads.
- [ ] Run review evidence, failure-context and effect-recovery regressions.

### Task 3: Independent review output capacity

**Files:** neutral `ReviewPolicy`, its tests, adapter `HeartbeatSettings`, `neko_structured_review.py`, dashboard allowlist and structured-review tests.

**Interfaces:** Add `review_max_output_tokens` to the existing review policy/config. The adapter sends `min(settings.max_output_tokens, config.review_max_output_tokens)` through the supported `max_completion_tokens` field.

- [ ] Add tests with body budget 8192 and review budget 3072; assert the review request uses 3072 while the body setting remains 8192.
- [ ] Preserve small existing body budgets, validate positive integer bounds, and retain `finish_reason="length"` rejection without effects or automatic replay.
- [ ] Run the new tests red before implementation, then implement the neutral policy and thin adapter mapping.
- [ ] Run package regressions, adapter tests, Ruff, UI-data checks and official candidate structure checks. A candidate check is not publication.

### Task 4: Fixed dependencies and real validation

- [ ] Fetch both mains again, review concurrent changes, commit scoped source changes and push ordinarily to main.
- [ ] Build and consume a fixed-source wheel in isolation, then pin its source SHA and archive digest in the thin adapter. Inspect candidate package contents without publishing.
- [ ] Read current Settings, lease, process creation/commands and native unknown/terminal state. Use one new normal maintenance stop and verify drain/exit/release before replacing the independent executor.
- [ ] Bind the exact counter only to verified local tokenizer/template resources; keep raw history and original receipts. Refresh/start the adapter through the public lifecycle while the new body stays continuous.
- [ ] Observe natural decisions/reviews, retained history, actual cache/input/latency and native outcomes. Record truncation/timeouts separately. No synthetic game chats, test TTS, claimed desktop playback or assumed quest completion.
- [ ] Save actual deployment and comparison evidence, update only the appropriate inspection/maintenance checkpoints, and report verified improvements and remaining limits.
