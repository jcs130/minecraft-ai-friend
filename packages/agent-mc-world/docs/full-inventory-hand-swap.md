# Full-inventory main-hand swaps and empty block targets

On Java 1.21.1, moving a stored stack into the selected main-hand slot now uses
one server-confirmed number-key swap. Both full stacks remain in slots and the
cursor stays empty, including compatible stacks such as 64 and 11 torches. This
removes the intermediate cursor ownership of the old pickup/place/return
sequence. Offhand swaps keep their existing confirmed number-key path; armor,
legacy versions, stale-item validation, cursor recovery and denied/unknown click
barriers retain their existing semantics. No item is discarded to create space.

For a block `use` without `item`, a freshly read air or liquid target is rejected
before preparing the hand. A failed earlier build can leave no container at the
requested cell; a full bag must not hide that fact behind an empty-hand error.
Unloaded targets remain unknown. Explicit item uses, including buckets on water,
retain their own effect/readback rules. Ordinary containers already permit safe
ordinary-tool interaction; explicit empty-hand semantics are not relaxed.

The motivating live trace retained three acknowledged cursor clicks followed by
a hand-readback failure and an unreturnable cursor. It does not identify every
server-side intermediate stack mutation. Offline tests independently verify the
empty-cursor invariant, complete stack conservation, denial handling and actual
executor errors for loaded air/liquid cells. Live placement/storage and planning
quality still need separate evidence; a successful hand swap is not a completed
construction or survival objective.
