# Optional nearby game voice

`mc_voice` speaks to nearby players through **the existing authenticated Mineflayer connection** and the optional `mcagent:voice` server protocol. It never creates another player, calls a game model, or acquires the game body's control lease. The host's own voice and provider remain in its presentation/audio extension.

Configuration is explicit and disabled by default:

```json
{"proximityVoice":{"enabled":true,"audioProducerUrl":"http://127.0.0.1:18431","outputMode":"game-only"}}
```

The audio producer is a configured artifact service, not a TTS API credential. The independent avatar-stage extension implements the HTTP contract below. Other hosts can implement the same port. No producer or endpoint is discovered automatically.

| Utterance | game-only mode | live-and-game mode |
| --- | --- | --- |
| Nearby player conversation, `mc_voice speak/upload` | Game voice | Game voice plus the **same audio** in the livestream queue |
| Audience commentary in the presentation extension | Presentation output only | Presentation output only |
| Ordinary nearby text / shout / private text | Original text channel | Original text channel |

Changing `outputMode` affects new requests; an admitted request retains its original routing. The host/operator selects its livestream mode explicitly; an enabled chat connector does not prove a live broadcast. There is no automatic dubbing of every text message, no forwarding of audience commentary into the game, and no hidden nearby text caption.

## Tools and state

- `{}` shows connection, server protocol acknowledgement (separate), output mode and recent receipts.
- `{"action":"speak","text":"One complete line.","requestId":"a saved UUID"}` requests one synthesis and asynchronously uploads it. Use the returned UUID if omitted.
- `{"action":"upload","audio_handle":"an audio/wav blob handle","requestId":"a saved UUID"}` sends existing audio. WAV: PCM16, mono/stereo, 8–96kHz, 0.1–30s, max4MiB. 48kHz mono is recommended; verified 44.1kHz PCM is supported by the server too. Do not change the sample-rate header to fake resampling.
- `{"action":"status","requestId":"the original UUID"}` checks the existing operation, never re-synthesizes/re-uploads. Its server and broadcast reads are asynchronous; inspect subsequent events/status.

Admission is persisted before effects. The bounded game-only request ledger is scoped by server/account; same ID plus changed content is rejected. Reconnect, native world changes, process replacement and timeout leave incomplete effects **unknown**, with a same-ID status recovery path. They do not replay speech. A new authenticated connection subscribes once and requests `/voice auto off`; the request itself is not a verified server acknowledgement. External uploads never use the server `say`/TTS path.

The `minecraft.voice` event contains separate `game` and `broadcast` states. `queued`/`playing` are intermediate, `sent` means the server sent audio frames, and none proves a human heard it. A broadcast admission carries an action ID; only the presentation renderer's own receipts establish playback. Producer-native text-completion evidence stays `null` when absent (including drama-rs EOF). A successful HTTP response or WAV decode does not establish full-text generation.

Nearby ASR arrives as `minecraft.chat`, `channel=nearby-voice`, with real `senderUuid`, `utteranceId`, transcript flag and native delivery-world observation. Duplicate UUID/utterance pairs are suppressed across reconnect within this client. The server caption has no source-world field: `sourceWorld` remains null, and delivery-world metadata is not invented source evidence. This channel is searchable separately in `mc_messages`. Text public/shout/private semantics are retained, never inferred from quoted speech. Native `worldState.name` is read separately from dimension type; unknown world/authentication prevents upload.

## Audio-artifact producer port

All paths below are relative to the configured producer origin and use saved UUIDs.

1. `POST /api/voice-artifacts` with `{requestId,text}` returns one finite PCM16 WAV, `X-Voice-Artifact-Id`, `X-Voice-Audio-Sha256`, and `X-Voice-Generation-Complete: true|false|null`. The producer renders the complete line once, reuses the configured voice, and emits no playback command. Same-ID retries return the original artifact, not another clone.
2. For an existing blob, `PUT /api/voice-artifacts/{requestId}` with `Content-Type: audio/wav` imports the exact audio without TTS.
3. Only in live-and-game mode: `POST /api/voice-artifacts/{requestId}/broadcast` with `{}` submits the stored audio to the **ordinary broadcast queue**, returns `{id,accepted,status}`. It must not synthesize again or bypass a shared broadcast floor. Game upload and broadcast failure are independent.
4. `GET /api/actions/{id}` returns the dated renderer action status. Read failure preserves the prior evidence; it is not playback success.

The game upload protocol needs the complete WAV length/hash before `begin`. This path therefore waits for the artifact, then uploads; it does not pretend to stream unverified PCM directly into the current server protocol. Ordinary audience-only speech retains its existing real-time streaming path.

## SDK and acceptance

```js
import {attachProximityVoice} from 'agent-mc-world/proximity-voice';
const voice = attachProximityVoice(existingBot, {
  isAuthenticated: () => actualAuthenticationReady,
  onHearing: event => retainSenderAndUtterance(event),
});
await voice.upload(wavBuffer, {requestId: savedUuid, signal});
// If unknown, await voice.status(savedUuid); do not change ID and replay.
voice.close();
```

The low-level helper is dependency-free and also distributed as the standalone `paper/integrations/proximity-voice/client.mjs`. Run its `sync-client.mjs --check` to verify it matches this core. Callers are responsible for actual authentication, native world gating and shutdown; the World lane supplies those checks and a durable ledger.

The current built-in transport is Mineflayer. Java clients must implement the same custom-payload protocol in their existing client/mod transport; absence of such a port is not parity. Humans need a compatible Simple Voice Chat client. Validate actual nearby/distant/cross-world hearing, reconnect dedup and microphone ASR with human listeners after loading. Offline packet/Opus delivery tests are not ear tests; do not create battles, drowning or another bot for acceptance.
