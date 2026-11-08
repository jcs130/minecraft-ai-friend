# Independent server queries

`mc_query {}` lists read-only queries explicitly declared by the installed server extension. A definition validates arguments, builds one command and matches attributed replies. The generic core never infers read-only permissions from words such as `status` or `info`.

`mc_query {query:"declared-id",arguments:[]}` sends without taking the body queue or cancelling navigation. It waits up to 350 ms for a matched reply, so a fast server response can return in the same tool invocation instead of requiring another model round. Otherwise it returns the original request ID and an honest `sent` state; read `mc_query {requestId:"..."}` later. This short observation window does not renew the five-second query deadline. One query may be in flight per connection; duplicates reuse its identity, and recent replies are briefly reusable. There is no automatic resend. History is bounded and a disconnect/respawn invalidates outstanding work.

SDK consumers may keep using synchronous `ServerQueryLane.call()`, or explicitly select `callAndWait(...,{waitMs,signal})`. `waitMs` is an integer from 0 to 1,000; zero returns immediately. Cancelling the short read wait preserves the original query and request ID with `readWaitAborted:true`; it does not report completion or replay the command. Connection resets still settle the underlying query as cancelled. A busy response for another query is never converted into the requested result.

The mounted tool schema keeps flat `query`, `arguments` and `requestId` fields, and binds each registered query to its declared argument count, item pattern and length. Its call-form union separates index reads, sends and receipt reads. These constraints survive catalogue compaction; queries with the same argument shape share one branch. A required subject must still come from observed server data: schema validity cannot establish that an ID exists, and the definition's command builder remains the dispatch authority.

Rejected query arguments return that query's configured description, bounded to 1,024 characters, and an index read entry. The core does not guess a missing subject or send a corrected command automatically. Error recovery does not expand every protocol description into the active context.

Only fresh server-position messages after player/private provenance checks can match. Reply matchers should validate recipient and subject, and preserve server evidence. Protocols without an echoed request nonce cannot prove unique request identity: receipts disclose `requestNonce:false`. A timeout means the result is unknown, not that the server rejected the request or the gameplay goal failed.

Unknown commands and mutating commands remain ordered `mc_do` steps. Explicit `queue` instructions and multi-step dependencies remain intact. Do not append a query behind a long route and then interpret its unexecuted state as server silence.

Ordinary queued chat also begins its reply association at the actual transport call, after validation and chat deduplication. A request accepted into the body queue has not been sent. Transport failure and cancellation must not fabricate a server reply.

The same declarations and runtime are available to independent SDK/MCP consumers; server extensions import the `ServerQueryDefinition`, `ServerQueryLane` and `SERVER_QUERY_TOOL` public exports from `agent-mc-world/extension`. Server-specific command names and rules stay in that optional extension.

For a protocol that sends a list as several messages, set `maxReplyParts` (1–64).
`matchReply(text, args, username, parts)` receives retained rows and may return
`{partial:true,data:row}`. Partial rows do not end the query, renew its deadline,
or emit completion events. Only a validated protocol terminator returns the
complete data without `partial`; the extension must check page, row count and
server stream ID where available. Preserve nulls and distinguish an empty page
from missing replies. Payloads are bounded at 64 KiB; overflow cancels rather
than pretending a truncated catalogue is complete. Timeout/cancel receipts keep
`partialReply:{complete:false,parts}`. Reconnect starts with no retained rows.
Do not include serialized item/audio bytes in model-facing rows; keep relevant
names, attributes and identity hashes. Reads remain single-flight and never
reserve the physical action queue or automatically retry a purchase/transfer.
