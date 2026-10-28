# Drama 3 Long Form Streaming Repair Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep each Drama 3 utterance in one native synthesis request, finish long Chinese text without hiding truncation, and stream correct PCM and terminal status.

**Architecture:** Retain the loaded `cormy` GGUF and its source files. Let speech.cpp 0.9.0 perform its own roughly 300 UTF-8 byte chunks with first/recent acoustic context inside one `speech_synthesize` call. Raise and validate the per-chunk `max_seconds` budget only after live VRAM and long-form tests. Bind native cancellation and result sample count; monitor the HTTP peer while waiting and generating. Capture SSE to WAV with a repeatable probe and verify termination, seed, timing, sample count and transcription evidence.

**Tech Stack:** Python 3.14 stdlib, speech.cpp 0.9.0 C API, PowerShell scheduled task, local Qwen3-ASR for independent text checks.

**Spec:** User request of 2026-10-28; speech.cpp `docs/models/drama3.md`, `docs/c-api.md`, `include/speech.h` and `src/families/drama3/synthesizer.cpp` from the running 0.9.0 build.

## Global Constraints

- Keep `model="drama-3"`, `voice="cormy"`, the existing `reference.wav`, `reference.txt`, `voice.gguf` and their hashes.
- Do not change LLM, Minecraft, Cortico, persona, memory or their running services.
- Keep no-key LAN speech, existing voices, cast speaker tags, WAV and PCM/SSE API compatibility.
- Do not add speaker, emotion or pronunciation markers or post-process pitch.
- A single HTTP speech request must invoke one native `speech_synthesize`; rely on its own chunk history rather than separate cloned requests.
- `max_seconds` means the maximum **per native chunk**, not total utterance time; report `max_seconds` or `model_limit` when any chunk stops there.

## Review Focus

- A disconnected client waiting for the serial model or inside a native chunk cancels that request and frees the queue.
- SSE `samples` equals audio actually sent and no failure is reported as `complete`; raw PCM ends as a broken transfer on failure.
- Explicit seed stays unchanged; missing seed is drawn once per request and returned.
- WAV reports real stop reason and 44.1 kHz mono PCM16 without using the 48 kHz reference rate.
- The 172+ character sample must complete on the 24 GB RTX 3090 without Vulkan OOM, with evidence from actual generated audio and ASR/manual review.

---

### Task 1: Reproduce and trace

**Files:** Create `tools/drama3/longform_probe.py`, `disconnect_probe.py`, `queue_disconnect_probe.py`; save outputs under ignored `server/drama3-service/longform-acceptance/`.

- [x] Write an SSE probe that sends one request, timestamps first delta and done, counts decoded samples, saves raw WAV and JSON log, and fails on missing/incorrect terminal status.
- [x] Run a 204-character case against the old 10-second service; preserve the red `max_seconds` result.
- [x] Check local model metadata and upstream C API for chunking, seed, stop and cancellation semantics.

### Task 2: Native binding and HTTP terminal behavior

**Files:** Modify `tools/drama3/speech_native.py`, `tools/drama3/voice_service.py`; extend `tools/drama3/tests/test_voice_service.py`.

- [x] Add tests for explicit seed, per-chunk budget, sample count, `max_seconds` terminal, post-audio SSE failure and disconnected queued/running request.
- [x] Bind `speech_request_cancel` and `speech_result_samples`; use one native synthesis call and cancel only its own request.
- [x] Watch connection state while queued and running, keep serialized model access, and log seed, stop, samples and duration without logging transcript or reference text.
- [x] Stream PCM16 at the engine's 44.1 kHz; send SSE done with truthful stop on native completion/limit, and an error terminal for post-audio failures when the client remains connected.

### Task 3: Long-form deployment and acceptance

**Files:** Modify `docs/DRAMA3-DEDICATED-SERVICE.md` and `AGENTS.md`; preserve evidence under ignored local state.

- [x] Live test 30-second per-chunk budget; existing 4 GiB temporary VRAM reservation sufficed even when the long request was first after cold start.
- [x] Restart only `Drama3-Speech`, verify `cormy` source and GGUF hashes unchanged and model/voice loaded.
- [x] Run short, 204-character, and names/coordinates one-request SSE probes; check first-audio-before-done, stop, samples, rate, independent ASR and the user's long-WAV listening feedback.
- [x] Test direct WAV, the built-in voices/cast, running and queued disconnect; run unit/static checks and inspect logs.
- [x] Commit source/tests/docs, integrate and push `main` without runtime audio or model assets.
