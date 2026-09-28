# Yui LLM Speech Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Yui's live dialogue arise from her own LLM decisions and play through the local female TTS profile without repetitive time-triggered lines.

**Architecture:** Keep Yui's existing QwenPaw role and model route. Remove periodic pressure to speak from the life prompt; retain verified recent dialogue and event-based initiative. Keep party delivery as the only speech submission path and confirm TTS receipts.

**Tech Stack:** Python QwenPaw sidecar, party bridge, local GodVoice/Kokoro TTS.

**Spec:** Current user request, 2026-09-25; `docs/EMBODIED-SOCIAL-SCHEDULING.md`.

## Global Constraints

- Timers never choose or write lines; the LLM may choose silence.
- Keep actor and voice UUID binding unchanged.
- Never claim playback merely because text was submitted.
- Preserve Yui's current active model until a user preference or measured reason changes it.

## Review Focus

- Five-minute silence with no new event: no forced utterance.
- New event or Kirito's message: model can speak naturally through `party_send`.
- Duplicate old plan in recent dialogue: prompt discourages repetition.
- Yui far away: party text does not falsely claim audible delivery.
- TTS unavailable: preserve text and report audio failure separately.

---

### Task 1: Life dialogue policy

**Files:** `world/sidecar/party_life.py`, `tests/test_party_life.py`.

- [x] Change the red-capable test from an elapsed-time speech hint to event-based choice.
- [x] Remove five-minute speech directive, keep verified recent dialogue context.
- [x] Run party life and dialogue tests.

### Task 2: Local voice identity and live check

**Files:** `server/mc/data/godvoice/speech-profiles.json`, `tools/character_speech_health.py` as needed.

- [x] Correct Yui's display label while preserving UUID and `cosy_female` voice.
- [x] Verify current model route and local TTS health; inspect real speech receipts, including the current no-listener failure.
- [x] Restart the affected sidecar and confirm the live life signal remains healthy.
