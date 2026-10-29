# Drama 3 LAN cutover to drama-rs

## Goal and constraints

Replace the 18120 speech.cpp runtime with drama-rs v0.3.0 on the RTX 3090. Preserve the existing Cormy reference WAV, transcript and GGUF file untouched; preserve the existing LAN address, voice registration and speech API where the new engine can truthfully support them. Expose drama-rs's native voice and multi-speaker controls, streaming, sampling controls and inline delivery tags. Do not claim an unsupported numeric speaking-rate or emotion control.

## Work and rollback sequence

1. Snapshot the scheduled task action, watchdog state, voice manifests and hashes. Keep the old `voice_service.py` and GGUF assets for rollback. Check the Kirito/Yui original references and derive a virtual `cast` mapping from them.
2. Implement a single Windows launcher/gateway that starts the already benchmarked WSL drama-rs binary on loopback, preloads durable WAV/transcript references, checks the native health and serves the LAN on 18120. Proxy `/v1/speak`, `/v1/voices`, `/v1/info`, `/docs`, and the web UI. Preserve `/v1/audio/speech`, `/v1/audio/voices`, `/v1/models`, and `/health` with explicit errors for unsupported options.
3. Validate API parsing, audio streaming and stop metadata with local fake-engine tests. Verify native model with Cormy short and 204+ character text, original Kirito/Yui references and two-speaker cast. Verify unknown voices, inline tags, seed, queue and disconnect behavior. Keep original WAVs and request/response logs.
4. Set watchdog maintenance, switch only `Drama3-Speech` to the launcher, wait for GPU model readiness and run LAN-address smoke tests. Restore the previous task action and runtime if any production acceptance check fails. Remove maintenance marker when healthy.
5. Update deployment record and project service documentation with the actual API, client examples, limitations and rollback procedure. Verify the final scheduled task action, active process, GPU, live voice list and generation; do not touch Minecraft, Cortico or LLM services.

## Acceptance boundaries

Native drama-rs exposes streamed 44.1 kHz mono PCM16 WAV, voice upload with exact transcript, voice selection, multi-speaker `voices`, seed/top-k/top-p/temperature/max-new and inline text tags. No native numeric speed parameter is advertised. The upstream engine currently does not report EOS versus generation cap or support immediate cancellation inside generation; a compatibility gateway must never label an unknown termination `complete`. A production switch is acceptable only with these limitations made visible to callers and the original service restorable.

## Result (2026-10-29)

- [x] Snapshot of previous scheduled task action and Cormy reference hashes; original voice files unchanged.
- [x] Windows LAN gateway and WSL CUDA/Q4 runtime; native API, UI, registration and compatibility routes on 18120.
- [x] Seven gateway tests plus eleven existing speech.cpp tests; Python compilation and PowerShell parsing.
- [x] Formal task switch with automatic rollback and four-voice live smoke; isolated restart, durable QA registration and re-synthesis.
- [x] Full native long-form, short, names, cast, Kirito, Yui and inline-tag WAV evidence; legacy SSE sample-count check.
- [x] Current service document and AGENTS.md updated; old speech.cpp document archived.
- [ ] External LAN device call and subjective review of the new Kirito/Yui/cast/tag samples remain for their respective callers. The known engine stop/cancel limitations are explicitly published.
