# Nearby game speech and text

`mc_voice` is an independent I/O lane on the existing authenticated game connection. It does not acquire the body queue, wait for a host turn, or call a server TTS for externally generated audio.

- `speak` accepts one complete authored `text` and one optional UUID `requestId`. The configured artifact producer receives the complete text once. An attested nearby text route sends that same authored text while synthesis runs.
- `upload` accepts a PCM16 WAV blob handle and optional authored `text`. This text is a caption supplied by the caller, not an ASR result or proof of what the recording says. Without text, the receipt says `not-provided`; the core does not invent a transcript.
- `nearbyText`, `game` and `broadcast` have separate outcomes. Caption failure does not discard audio. Audio generation failure does not erase text already sent. The same request ID is persisted before effects; a restart, timeout or status read never repeats the caption or the audio.
- Only a server adapter's currently attested `nearby` / `same-world-range` route is accepted. No private, shout or server-wide fallback. The existing `/voice auto off` request is preserved to avoid server re-synthesis; it is a request, not an attested server setting.
- Vanilla chat packets have a 256 UTF-16-unit limit. Long captions may span bounded Unicode-safe chat parts, each with a `minecraft.chat.sent` receipt and `voiceRequestId`. Only text transport is divided: audio synthesis remains one complete request. Invalid chat characters and command text are not dispatched. Parts stop on cancellation/world change; partial receipts are retained.

The shared upload client retains 16 KiB packets, sequence numbers, SHA-256 and existing limits (30 seconds, 4 MiB). It yields after each 64 KiB burst, allowing connection changes, cancellation and incoming status messages to run, instead of adding a fixed wait to every packet.

`timings` records client-observed synthesis start, valid audio readiness, upload start and first observed server queued/playing/sent timestamps. These are not recipient audio start or human hearing. `sent` still means server frames were sent. Native generators without a reliable completeness signal keep `generationComplete: null`; HTTP success does not prove complete speech.
