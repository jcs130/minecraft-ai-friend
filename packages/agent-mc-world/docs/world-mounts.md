# Reusable World mounts

The host chooses a World id and supplies its private data root. Import the helpers
from `agent-mc-world/client` or `agent-mc-world/extension`.

`worldDataDirectory(root, id)` selects an isolated child directory. Pass that same
directory to the body, game-learning collector, method library and optional
services. This does not move or open an existing deployment.

For an upgrade, `planWorldStorage({dataDir: root, id, entries})` scans only explicit
top-level legacy entries. It reports file sizes, hashes, destination conflicts
and a plan id, without connecting a game or model. `copyWorldStorage(options,
planId)` accepts only the current plan, creates independent copies, verifies the
bytes and retains originals. Changed sources, differing destinations, symbolic
links and junctions require reconciliation. A completed marker is written last;
an interrupted copy can be reviewed again and reuse identical destination files.
Host configuration, personal memory, connection leases and unknown files must
not be added to the allowlist by discovery. Paths inside a copied identity or
configuration file are not silently rewritten. The host must review references
when adopting a different directory.

`prepareWorldStorage(options)` initializes fresh storage or checks a completed
migration. It refuses to silently start with an empty notebook when allowlisted
legacy records have not been reviewed. An adapter can remain available to the
operator while holding the game connection until that review finishes.

`mapWorldEventNamespace` and `namespaceWorldHost` rename envelope source/type and
sender prefixes. Text, attachment bytes, timestamps, event cursors, execution
identities, metadata and actual Minecraft dimension ids remain original.
Bare sender ids are preserved because they may be actual player names. Pending
filters and returned envelopes are translated back for the inner implementation.
`namespaceWorldStorage` changes UI storage keys while retaining their original
stat/clear closures. `extendWorldHost` adds ports without freezing capability
getters or dropping non-enumerable host services.

## Explicit decision service

`createHttpDecisionPort` from `agent-mc-world/decisions` is an optional host-side
transport for the existing `state/questions` and `answers` protocol. Supply an
explicit full endpoint, model and credential-name resolver. Importing the helper
starts no requests. It does not discover endpoints or inspect a host's private
provider registry. The game engine does not import or own this transport.

The caller supplies only the necessary measured state and candidate criteria.
Complete choice probabilities and confidence are validated using the existing
typed-choice contract. Cancellation, timeout and configuration changes reject
late answers. A returned choice is advice; the game executor still checks current
identity, scene, permissions and control ownership. Unknown usage counters remain
null. Provider error bodies and credentials are not copied into observations.
