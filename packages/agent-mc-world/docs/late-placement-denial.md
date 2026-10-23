# Late placement denial and retry admission

An explicit same-cell placement denial can arrive while the second native
placement attempt waits for block confirmation. The wrapper previously consulted
protection before the first send and after the first failed attempt only. A denial
received later could therefore be followed by a third send and a generic
unconfirmed-placement error.

Before a further attempt, the wrapper now rechecks the existing protection hook.
With ordinary preflight disabled, an unknown/allowed cached result introduces no
extra diagnostic query. A cached denial ends the operation with the original
server reason. Existing first-attempt diagnosis, confirmation, bounded retries,
inventory barriers and the single native queue remain unchanged. Denials from a
different cell or dimension do not apply to the current placement.

The Java 1.21.1 regression uses the real structured-denial parser and Bridge cache,
with fake placement and no game/model connection. Both direct placement and native
path-support cases first reproduced three sends after a denial observed on send
two, then passed with only two sends. Additional cases preserve early denials,
foreign-cell/dimension isolation and eventual confirmation without a denial.

The installed rc.60 archive independently reproduced the late-denial case offline.
Live blocked tasks and direct server refusals motivated the investigation, but
their per-packet ordering was not captured. This fix is not proof that every older
three-attempt report had the same cause, or that protected routes can be completed.

Validation: 91 targeted tests, core typecheck, engine-only build and public
declarations, and the full four-worker suite (1861 passed / 3 optional skipped).
An isolated npm-pack consumer passed the default-entry check and the same
late-denial counterexample with network forbidden. The first unbuilt worktree run
failed missing compiled/declaration artifacts; a later unrestricted run had one
procedure IPC cancellation. That test passed in isolation and the full four-worker
run passed without changing its deadlines or assertions. Raw failures are retained
in local maintenance evidence. No release, real protected-placement test or
sustained-survival claim is made by this source change.
