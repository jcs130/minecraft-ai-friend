# Independent server queries

`mc_query {}` lists read-only queries explicitly declared by the installed server extension. A definition validates arguments, builds one command and matches attributed replies. The generic core never infers read-only permissions from words such as `status` or `info`.

`mc_query {query:"declared-id",arguments:[]}` sends without taking the body queue or cancelling navigation. It returns a request ID and an honest `sent` state. Read `mc_query {requestId:"..."}` for its result. One query may be in flight per connection; duplicates reuse its identity, and recent replies are briefly reusable. There is no automatic resend. History is bounded and a disconnect/respawn invalidates outstanding work.

Only fresh server-position messages after player/private provenance checks can match. Reply matchers should validate recipient and subject, and preserve server evidence. Protocols without an echoed request nonce cannot prove unique request identity: receipts disclose `requestNonce:false`. A timeout means the result is unknown, not that the server rejected the request or the gameplay goal failed.

Unknown commands and mutating commands remain ordered `mc_do` steps. Explicit `queue` instructions and multi-step dependencies remain intact. Do not append a query behind a long route and then interpret its unexecuted state as server silence.

Ordinary queued chat also begins its reply association at the actual transport call, after validation and chat deduplication. A request accepted into the body queue has not been sent. Transport failure and cancellation must not fabricate a server reply.

The same declarations and runtime are available to independent SDK/MCP consumers; server extensions import the `ServerQueryDefinition`, `ServerQueryLane` and `SERVER_QUERY_TOOL` public exports from `agent-mc-world/extension`. Server-specific command names and rules stay in that optional extension.
