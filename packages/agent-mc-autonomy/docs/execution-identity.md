# Native execution identity

The native protocol identifies an execution with `kind` and `id`, inside its
existing game/run scope. Task and method counters may issue the same `id`. The
coordinator already keyed pending work this way, but its retained-terminal guard,
original-event lookup, viewer playback and offline recovery assessment used the
ID alone. A prior task could hide a method acceptance or be confused with a
method's validation terminal.

Native outcomes now retain `execution_kind`; same-scope late acceptance checks
known kind and ID. Original references, public playback, queue labels and recovery
evidence keep that namespace. Same-kind late acceptance remains suppressed.
Kindless controller history keeps its prior conservative guard. Kindless or
foreign-kind recovery evidence never proves a terminal; unlinked work remains
unknown, and assessment cannot clear a barrier or replay an action.

The installed 0.2.83 counterexample runs the real controller with fake body ports,
temporary state and network/process calls prohibited. After completing task 1,
accepting method 1 incorrectly left pending empty. New compact/full, original
reference, viewer and recovery regressions exercise this collision; syntax
validation remains distinct from method execution, goal success and reuse.

Two natural method candidates motivated this audit, but both only reached
`validated` with zero SDK calls. Their existence is not evidence of method
execution, saved versions, reuse or the cause of every earlier project delay.
No game action, automatic acknowledgement or extra inference is part of testing.
