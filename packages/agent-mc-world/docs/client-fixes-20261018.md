# Client regressions after d794e8e0

These fixes belong to the independent Minecraft core. No host framework changes or server-specific matching rules are required. Java 1.21.1 remains the primary target; the reported Java 1.20.6 paths have explicit compatibility tests.

## Private-message provenance

Ordinary `chat` transport may contain plugin private messages without a vanilla whisper marker. The rendered `ag_CorMy whispers to you: …` sentence, including optional rank/tag prefixes, is accepted only when the claimed player matches the packet sender UUID or the online player list. A conflicting UUID wins over the text. Public `<Name> …` and `Name: …` quotations remain public.

`You whisper to ag_CorMy: …` is recorded with the local account as sender and the other account as recipient. The outgoing event has `deliver:false` and `meta.outgoing:true`; it does not request another reply. Registered vanilla incoming/outgoing formats and the viewer use the same provenance rules.

Tests: `plugin-whisper.test.ts`, `client-regressions.test.ts`.

## Script observations and body ownership

Use an explicit fresh observation in the isolated worker:

```js
const scene = await bot.read('entitySnapshot');
const self = scene.self;
const tracked = Object.values(scene.entities);
const online = Object.values(scene.players);
return { sampledAt: scene.sampledAt, self, tracked, online };
```

The snapshot includes source, dimension, availability, detached entity positions/velocities, and online player identities. Online does not establish proximity; tracked does not establish visibility. Missing source availability is unknown. `await bot.read('entity')`, `'entities'`, and `'players'` expose individual projections. Synchronous `bot.entity/entities/players` are not live worker objects; their error now points to the supported read API. No client, credentials or arbitrary metadata are exposed.

A pure computation or observation-only script does not hold the body and survives an unrelated task admission. A program that owns native input or has an outstanding `mc.do` still participates in preemption and cleanup. `waitForTicks` alone does not claim the body; input already acquired remains owned across the wait.

`name` is optional, including validation. Omitted names are stable `inline-` plus the first 12 hexadecimal SHA-256 characters of the source; explicit names contain 1–80 characters. This matches the runtime and corrects the older October 13 document.

Tests: `method-observation-isolation.test.ts`, `method-mineflayer.test.ts`, existing method-runner tests.

## Connection cleanup and heartbeat timeout

Independent features previously added enough `end` listeners to exceed the default EventEmitter threshold. Core feature cleanup now shares one disposable connection-end dispatcher. Breathing, flight and hearing initialization is idempotent; rebinding GUI presentation revokes its old subscription. Ending a connection releases packet subscriptions and does not replay callbacks on the next connection. The listener limit is unchanged.

`keepalive-reconnect.test.ts` executes the installed `minecraft-protocol` heartbeat timer through Bridge on 1.20.6 and 1.21.1: timeout, one disconnect, reconnect, new spawn, stale old-generation end, and explicit shutdown. This is a simulation of the protocol lifecycle, not a production network-timeout claim.

Tests: `connection-end.test.ts`, `keepalive-reconnect.test.ts`.

## Duplicate replies

`chatDuplicateWindowMs` defaults to 120000 ms and can be hot-configured; 0 disables it. Only identical player-facing text in the same public/private recipient scope is suppressed when no new relevant inbound message has arrived. New content, different recipients and ordinary server commands remain available. `/msg`, `/tell`, and `/w` share private-recipient scope. Dispatch failures are not remembered as sends.

Suppression returns a `noop` receipt explicitly stating that no message was sent again; it does not terminate subsequent steps or report an internal error. This prevents the observed five-copy reply from reaching the server five times. It does not claim to fix the model's reason for proposing the repeated sentence or duplicate TTS in another extension.

Tests: `chat-dedup.test.ts`.
