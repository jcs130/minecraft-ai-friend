# Harness gateway message protocol v1

`agent-mc-harness-gateway`, version `1`. Third-party agents (persona hosts such as N.E.K.O, Cortico, DSH, or any
Python/JS program) talk to the **server-hosted harness** with small JSON messages. They never call body tools
(`mc_*`): in gateway mode the harness owns the body exclusively.

Implementation: `packages/agent-harness/src/gateway/` · TS SDK: `src/sdk/client.ts` · examples: `examples/`.

## Transports

| Transport | Endpoint | Use |
| --- | --- | --- |
| WebSocket | `ws://HOST:PORT/v1/ws` | primary: requests + server push on one connection |
| HTTP | `POST /v1/messages` (one envelope per request, `content-type: application/json`) | fallback; same messages, no push |
| HTTP | `GET /v1/events?after=&limit=&minSeverity=&kinds=a,b&stream=` | convenience for `pull_events` |
| SSE | `GET /v1/events/stream?after=&minSeverity=&kinds=&stream=` (+ `Last-Event-ID`) | push without WebSocket; `id:` = event seq |
| HTTP | `GET /v1/health` (no auth) | liveness, protocol, stream id |

Authentication: `Authorization: Bearer <token>` (HTTP, SSE, WS upgrade) **or** a `hello` message carrying `token`
(needed by clients that cannot set WS headers, e.g. browsers/Node's built-in WebSocket). A WebSocket must authenticate
within 10 s. Requests carrying an `Origin` header are refused unless that origin is configured
(`AGENT_HARNESS_GATEWAY_ORIGINS`), which blocks drive-by browser pages.

## Envelope

```jsonc
// client → server
{ "v": 1, "id": "c-17", "type": "submit_intent", "ts": "2026-11-16T13:00:00Z", "agent": "neko", "payload": { … } }
// server → client (correlated by `re` = request id)
{ "v": 1, "id": "s-42", "re": "c-17", "type": "result", "ts": "…", "payload": { … } }
{ "v": 1, "id": "s-43", "re": "c-18", "type": "error",  "ts": "…", "payload": { "code": "forbidden", "message": "intent belongs to another agent" } }
// server push (no `re`)
{ "v": 1, "id": "s-44", "type": "event", "ts": "…", "payload": { "subscription": "sub_1a2b3c4d", "stream": "stream_…", "event": { … } } }
```

* `v` required, must be a supported version (else `unsupported_version` with `supported: [1]`).
* `id` required, `[A-Za-z0-9._:-]{1,128}`, unique per client; responses echo it as `re`.
* `ts`, `agent` optional. If `agent` is present it must equal the authenticated agent id.
* Unknown fields are rejected (`bad_request`) — strict by design; new fields come with a new version.
* Response `type`: `welcome` (hello), `pong` (ping), `result` (everything else), `error`.
* Max message size: 64 KiB default (`too_large`; WebSocket closes with 1009).

## Message types

| type | payload | result payload |
| --- | --- | --- |
| `hello` | `{ token?, protocols?: [1], client?: {name, version} }` | `welcome`: `{ protocol, v, session, agent, admin, anonymous, stream, latest, limits, server: {execute, exclusiveBody} }` |
| `submit_intent` | `{ goal (≤500), priority?: 0..100 \| low\|normal\|high\|urgent, constraints?: { steps?: [{tool, args, note?}] (1..20), deadlineMs?, rules?: string[] }, hostRef? }` | `{ intentId, state }` |
| `update_intent` | `{ intentId, goal?, priority?, constraints? }` (one of the three) | `{ intent }` |
| `control` | `{ action: pause\|resume\|cancel\|get\|list, intentId?, reason?, states?, limit? }` | `{ intent }` / `{ intents }` / `{ executor }` |
| `get_summary` | `{ topic? (≤100), maxTokens? (80..800, default 300) }` | `{ summary: { text, tokens, budget, truncated, generatedAt } }` |
| `subscribe` | `{ minSeverity?: 1\|2\|3, kinds?: [...], after?: seq, stream? }` (push transports only) | `{ subscription, stream, latest, replay, streamReset, dropped }` |
| `unsubscribe` | `{ subscription }` | `{ subscription, unsubscribed: true }` |
| `pull_events` | `{ after?, limit? (≤100), minSeverity?, kinds?, stream? }` | `{ events, cursor, latest, stream, streamReset, dropped, hasMore }` |
| `ping` | `{ nonce? }` | `pong`: `{ nonce, latest }` |

Event kinds: `death`, `task_completed`, `task_failed`, `interaction`, `skill`, `player_presence`, `intent_state`, `reflection`.
Severity: 1 info · 2 notable · 3 important (interrupt-worthy). `intent_state` events carry
`data: { from, state, needsHost }`; `needsHost: true` means the harness needs concrete steps from the agent
(no free-text planner yet).

`control` without `intentId` pauses/resumes the whole harness executor (admin only). `cancel`/`get` require `intentId`.
Intent steps may only use allow-listed body tools (`mc_do`, `mc_goal`, `mc_stop`, `mc_queue`, `mc_observe`, …).

## Resume / replay

Every event has a monotonically increasing `seq` within a **stream** (`stream_<uuid>`, new on every server start).

* Keep `cursor` (last seq processed) and `stream`.
* WebSocket: after reconnecting, `subscribe` with `{ after: cursor, stream }` — the server replays buffered events
  after `cursor` and continues live, without duplicates. The TS SDK does this automatically.
* HTTP: loop `pull_events { after: cursor, stream }`, then set `cursor = result.cursor` (advances past filtered events too).
* `streamReset: true` → the server restarted; cursors restarted at 0 and replay starts from the buffer start.
* `dropped: true` → events older than the ring buffer (500) were lost; call `get_summary` to resync.
* Events for an intent may arrive **before** the `submit_intent` result (execution starts immediately). Queue them.

## Errors

| code | HTTP | meaning |
| --- | --- | --- |
| `bad_request` | 400 | invalid JSON/envelope/payload, disallowed step tool, subscribe over plain HTTP |
| `unsupported_version` | 400 | `v` not supported (`supported` lists versions) |
| `unknown_type` | 400 | unknown `type` |
| `unauthorized` | 401 | missing/invalid token (WebSocket then closes with 1008) |
| `forbidden` | 403 | other agent's intent, admin-only action, priority above the agent's max, origin refused |
| `not_found` | 404 | unknown intent/subscription |
| `conflict` | 409 | invalid state transition (e.g. cancel a finished intent, change goal of an active intent) |
| `too_large` | 413 | message over the limit |
| `rate_limited` | 429 | per-agent rate or failed-auth throttle; `retryAfterMs` (+ `Retry-After` header) |
| `quota_exceeded` | 429 | too many open intents / connections / subscriptions |
| `unavailable`, `internal` | 503, 500 | server side |

## Multi-tenancy

* Agents come from `AGENT_HARNESS_GATEWAY_AGENTS_FILE` (or inline `AGENT_HARNESS_GATEWAY_AGENTS`), JSON:
  `{"agents":[{"id":"neko","tokenEnv":"NEKO_HARNESS_TOKEN"},{"id":"ops","tokenSha256":"<hex>","admin":true,"ratePerMinute":600}]}`.
  Token **values never appear in config**: `tokenEnv` names an env var (≥16 chars) or `tokenSha256` stores a digest
  (`pnpm serve --hash-token < token.txt`). Plaintext `token` fields are rejected. Tokens are compared as SHA-256 digests
  with `timingSafeEqual` and are never logged.
* Per agent: `admin`, `maxPriority` (default 75; `urgent` ≥90 preempts and needs a higher cap), `ratePerMinute`/`burst`
  (120/30), `maxOpenIntents` (20); 8 connections per agent, 8 subscriptions per connection.
* Ownership: intents belong to the submitting agent; others get `forbidden`. `list` shows own intents (admin: all).
  Other agents' intent events are not delivered; their goals are redacted in `get_summary`. Body events
  (death, chat, level …) are shared — it is one body.
* Binding: `127.0.0.1` by default. With no agents configured a loopback server accepts an anonymous non-admin agent;
  binding a non-loopback address without agents is refused. Use TLS termination (reverse proxy) for remote access.

## Examples

Hello and welcome:

```json
{"v":1,"id":"c-1","type":"hello","payload":{"token":"<from env>","protocols":[1],"client":{"name":"neko","version":"1"}}}
{"v":1,"id":"s-1","re":"c-1","type":"welcome","ts":"2026-11-16T13:30:45Z","payload":{"protocol":"agent-mc-harness-gateway","v":1,
 "session":"ses_…","agent":"neko","admin":false,"anonymous":false,"stream":"stream_…","latest":0,
 "limits":{"maxMessageBytes":65536,"ratePerMinute":120,"burst":30,"maxPriority":75,"maxOpenIntents":20,"maxSubscriptions":8},
 "server":{"name":"agent-mc-harness","execute":true,"exclusiveBody":true}}}
```

Submit with explicit steps, subscribe, get pushes:

```json
{"v":1,"id":"c-2","type":"subscribe","payload":{"minSeverity":2}}
{"v":1,"id":"s-2","re":"c-2","type":"result","payload":{"subscription":"sub_5f1c2a90","stream":"stream_…","latest":0,"replay":false,"streamReset":false,"dropped":false}}
{"v":1,"id":"c-3","type":"submit_intent","payload":{"goal":"砍几棵树","priority":"normal","constraints":{"steps":[{"tool":"mc_do","args":{"steps":[{"skill":"chop_tree"}]}}]}}}
{"v":1,"id":"s-3","re":"c-3","type":"result","payload":{"intentId":"int_a3fb…","state":"queued"}}
{"v":1,"id":"s-6","type":"event","payload":{"subscription":"sub_5f1c2a90","stream":"stream_…","event":{"seq":3,"at":"…","kind":"task_completed","severity":2,"text":"任务 t1 completed：…","data":{"executionId":"t1","phase":"completed"}}}}
{"v":1,"id":"s-7","type":"event","payload":{"subscription":"sub_5f1c2a90","stream":"stream_…","event":{"seq":4,"kind":"intent_state","severity":2,"intentId":"int_a3fb…","text":"意图完成：砍几棵树（step 1/1 done）","data":{"from":"active","state":"done","needsHost":false}}}}
```

Free-text goal → host supplies steps:

```json
{"v":1,"id":"c-4","type":"submit_intent","payload":{"goal":"去村庄看看"}}
// push: intent_state severity 3, data.needsHost = true
{"v":1,"id":"c-5","type":"update_intent","payload":{"intentId":"int_…","constraints":{"steps":[{"tool":"mc_do","args":{"steps":[{"skill":"goto_village"}]}}]}}}
{"v":1,"id":"c-6","type":"control","payload":{"action":"resume","intentId":"int_…"}}
```

Resume after reconnect, summary, errors:

```json
{"v":1,"id":"c-7","type":"subscribe","payload":{"after":4,"stream":"stream_…","minSeverity":2}}
{"v":1,"id":"c-8","type":"get_summary","payload":{"topic":"Steve","maxTokens":200}}
{"v":1,"id":"s-9","re":"c-8","type":"result","payload":{"summary":{"text":"【游戏状态摘要】…","tokens":143,"budget":200,"truncated":false,"generatedAt":"…"}}}
{"v":1,"id":"c-9","type":"control","payload":{"action":"cancel","intentId":"int_of_someone_else"}}
{"v":1,"id":"s-10","re":"c-9","type":"error","payload":{"code":"forbidden","message":"intent belongs to another agent"}}
```

HTTP (`curl`), token read from an env var:

```bash
curl -s -X POST http://127.0.0.1:8787/v1/messages -H 'content-type: application/json' \
  -H "authorization: Bearer $NEKO_HARNESS_TOKEN" \
  -d '{"v":1,"id":"c-1","type":"pull_events","payload":{"after":0,"minSeverity":2}}'
curl -N http://127.0.0.1:8787/v1/events/stream?minSeverity=2 -H "authorization: Bearer $NEKO_HARNESS_TOKEN"
```

Python (stdlib only): `packages/agent-harness/examples/python_agent.py`. TypeScript SDK:
`packages/agent-harness/examples/third-party-agent.ts`.
