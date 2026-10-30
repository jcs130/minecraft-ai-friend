# Query discovery and deployed capability integration

The rc.139 candidate combines main `07b8757f` with the client/core changes from
the deployed rc.137 line `298cc635`. Server files remain those of main. This
retains proximity voice, explicit chat audience evidence, memory-service identity,
container diagnostics and preemption terminal behavior alongside main's inventory
access, plan review, command feedback inspection and measured motion review.
None of these source integrations loads a running client or establishes gameplay
improvement.

Configured read-only queries now publish their allowed IDs in the mounted tool
schema. Each definition can provide `argumentsSchema` for offline discovery and
selected invalid-argument receipts. The schema uses the same definition as the
command builder; `command()` still decides whether dispatch is allowed. Missing
subject IDs remain missing: the core does not infer a dungeon, fabricate a request
ID, or resend an unknown result. Existing query provenance, single-flight and
connection-generation boundaries remain in effect.

Consumers must verify the full packed package, including the optional extension
surface. Merely checking the standalone SDK can miss a deployed adapter's dependency
on `ChatAudienceEvidence` or proximity voice. A candidate missing those existing
capabilities must not replace the deployed package.
