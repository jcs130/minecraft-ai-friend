# Per-skill generation contracts

The legacy `mc_do` / `mc_scout` step schema remains a flat field pool for providers
that cannot reliably generate discriminated object unions. It carries a native
annotation, `x-agent-mc-skill-contracts`, mapping each advertised skill to an array
of generation schemas. These schemas come from the same skill registry as parsing
and help; they contain no live facts, proposed coordinates or permissions.

A provider adapter that explicitly supports object unions may replace the flat
step schema with `anyOf` over these alternatives. Each alternative requires its
skill name and applicable required fields and excludes unrelated skill fields.
Harvest requires `block` and a three-component `at`; craft chooses `item` or `grid`;
build chooses a material target form or a blueprint. An already-bound blueprint
may resume without supplying a new origin. Scout exposes only its own allowlist.
Other custom parser conditions, geometry, inventory, permissions and native task
outcomes must still be checked at execution. This is not a full semantic validator.

Unsupported providers must retain the flat schema and strip the annotation from
outbound requests. Do not silently enable unions for every provider: some parsers
drop fields nested inside unions. Keep the selected tool declarations stable
across temporary queue policy, voice subscriptions and changing world facts.

A pre-dispatch correction receipt also includes the selected skill's `inputSchema`
in `meta.admission` when available. It is a contract, not a repaired action or an
instruction to replay the batch. Preserve the original call and receipt. Missing
coordinates cannot be supplied by changing position, time or request ID.

Native SDK/MCP validation and the existing single task queue remain authoritative.
No model response or accepted task proves a completed goal. Offline schema/parser
checks do not prove natural action recovery or model semantic accuracy.
