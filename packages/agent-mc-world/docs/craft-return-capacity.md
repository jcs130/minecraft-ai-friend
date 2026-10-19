# Crafting in a full inventory

Ingredient pickup retains a partial source stack until that stack is fully
needed by the grid. A late item pickup can therefore not occupy a temporarily
emptied source slot while surplus ingredients still need to return there.
Single-item sources and recipes that consume the complete source still work;
the authoritative server slots and cursor remain the confirmation boundary.

Grid cleanup checks actual compatible-stack capacity before picking materials
up. If they cannot fit, they remain in their grid slots with an explicit error;
the core does not put them on an unreturnable cursor or discard another item.
Output capacity, component-aware stack matching, cancellation, window ownership
and unknown-click quarantine retain their existing behavior.

The motivating live receipt reports twelve coal on the cursor after a full-bag
torch craft. It does not retain every intermediate server inventory mutation.
Offline regressions reproduce the source-slot pickup race with the pinned
native inventory plugin and separate server windows, and verify count
conservation, multiple source refills, output refusal and untouched grid
materials. This establishes the bounded inventory invariants; natural live
recurrence and sustained survival need separate evidence.
