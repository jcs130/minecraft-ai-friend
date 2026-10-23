# Shared information contracts in autonomy 0.2.3

The consumer now pins `agent-mc-world` 0.5.7-rc.7 from
`20d731efe8e165887f8af97ff1ed13c7241c75df`. The engine-only archive is built from
that exact Git tree. `core_distribution/source.json` and the companion npm lock
record its archive and build hashes; viewer resources remain a separate pin.

The shared client owns `mc_messages` and `mc_tool_help`. Autonomy advertises their
effective schemas and delegates calls instead of replacing them with its older
documentation helper. This preserves optional tool indexes, `full:true` and schema
pointers rooted at `/properties/...`. Older bodies without shared discovery retain
the compatibility helper and its `/inputSchema/...` paths. Turn and transport
controls remain coordinator-owned.

The bounded message index is included in dynamic facts and strategic review.
Originals remain available through the core's message queries; history is not
copied into the stable persona/rules prefix. Querying or marking a message
considered counts as reading, never an action outcome or verified goal progress.
Native barriers are still acknowledged. Ordinary message-index changes do not
manufacture urgent body changes or additional model calls.

Regression coverage exercises the shared schema, original arguments/results,
both pointer roots, native barriers, read accounting, protected coordinator tools,
dynamic-tail retention and review evidence. These checks use fake model/body
ports. Package installation and disconnected SDK checks are separate from live
gameplay; they cannot establish long-term survival or server permissions.
