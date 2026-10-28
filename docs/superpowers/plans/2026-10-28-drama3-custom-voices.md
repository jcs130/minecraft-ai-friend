# Drama 3 Custom Voices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept caller supplied reference audio and exact transcript, encode and persist a Drama 3 voice, then synthesize with its registered ID without reencoding.

**Architecture:** Use speech.cpp 0.9.0's native voice encoder to create a GGUF voice file, and its C API `speech_voice_add` to load that file into the already loaded model. A small Python HTTP service owns the model and adds registration endpoints alongside the existing speech endpoint. Its registry writes versioned metadata and source assets under ignored local state, recovers jobs at startup, and never aliases unknown IDs.

**Tech Stack:** Python 3.14 stdlib, ctypes for the installed speech.dll and speech.cpp 0.9.0 native voice C API, Windows Task Scheduler and PowerShell.

**Spec:** User request of 2026-10-28 in this task; upstream contracts in `speech.h`, `docs/models/drama3.md`, `docs/c-api.md`, and `docs/server.md` of speech.cpp 0.9.0.

## Global Constraints

- Keep `POST /v1/audio/speech` unauthenticated on TCP 18120 with existing `none`, `kirito`, `yui`, and `cast` behavior, including cast speaker tags.
- Preserve the model, voice assets, GPU user task, firewall scope, watchdog, and all LLM/other services.
- Require an exact transcript for every Drama 3 reference recording; use the model's own encoder and hot-add API.
- Keep references, generated GGUF voices, logs, and registry state outside Git under `server/drama3-service/voices`.
- Cap synthesis at 10 seconds per request to respect the tested RTX 3090 Vulkan memory budget.
- Do not source or synthesize Cormy reference audio; only the caller may upload it later.

## Review Focus

- An unknown or pending voice returns an explicit error; no fallback voice is used.
- A completed encode that fails to hot-add stays failed with its native error; never reports ready.
- A crash between file and manifest writes does not publish a partial ready voice.
- A restart reloads ready GGUF files without reencoding, and retries pending registrations.
- The deployed server actually uses the registered native voice condition, not only a successful metadata response.

---

### Task 1: Native API adapter and registry

**Files:** Create `tools/drama3/speech_native.py`, `tools/drama3/voice_registry.py`, and focused tests under `tools/drama3/tests/`.

**Interfaces:** `SpeechEngine.load()`, `add_voice(name, path)`, `synthesize(text, voice, options)`, `VoiceRegistry.register(...)`, `list()`, `get(id)`, `recover()`.

- [x] Test the C API version and Drama 3 voice capabilities from the local model metadata.
- [x] Bind model loading, hot-add, request options and audio callback to the native DLL; map every nonzero status to an explicit error.
- [x] Validate voice IDs, WAV format, duration and exact transcript; persist source WAV, transcript, GGUF and manifest atomically.
- [x] Run native encoding in a worker, hot-add only complete GGUF files, and implement restart recovery with hash/version checks.
- [x] Run unit tests with a fake engine and encoder, including duplicate, failure, unknown ID and restart paths.

### Task 2: HTTP API and deployment

**Files:** Create `tools/drama3/voice_service.py`; modify `tools/drama3/Install-Drama3Service.ps1` and, if required, `Watch-Drama3Service.ps1`.

**Interfaces:** `POST /v1/audio/voices` multipart `voice_id`, `audio`, `reference_text`; `GET /v1/audio/voices`; `GET /v1/audio/voices/{voice_id}`; existing speech/health/models endpoints.

- [x] Test request parsing, bounded uploads, statuses, error shapes, no-key synth, WAV and PCM, and cast tags locally.
- [x] Implement the HTTP server and return `202 pending` only after durable registration; expose `ready` only after native hot-add succeeds.
- [x] Switch only the `Drama3-Speech` task action to the Python service, leaving its interactive principal and firewall intact; retain an exact rollback task action.
- [x] Verify the task owns the process and watchdog can restart it without an orphan; check health and all three old voices by real synthesis.

### Task 3: Acceptance and documentation

**Files:** Modify `docs/DRAMA3-DEDICATED-SERVICE.md` and `AGENTS.md`; add integration test/smoke script if useful.

- [x] Register an isolated QA ID from an existing Kirito test recording and its exact transcript; synthesize with that ID and inspect the output.
- [x] Restart the service and synthesize again with the QA ID; prove no encode ran during restart or synthesis.
- [x] Confirm an unknown ID fails, and validate the requested `voice="cormy"` behavior only as `unknown` until the caller uploads real audio.
- [x] Publish the exact curl contract, WAV limits, transcript rule, interface and effectiveness results, and remaining remote LAN/manual listening limits.
- [x] Run syntax/unit/integration checks, `git diff --check`, commit source/docs, and integrate/push main without force or runtime assets.
