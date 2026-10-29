# Failed navigation interactions

Mineflayer pathfinder's `useOne` branch keeps its placement step after an
`activateBlock` rejection. A hand preparation failure can therefore repeat
every physics tick while the body waits for the work-stall deadline. Searching
several workstations multiplies the delay and holds later recovery tasks.

The core now records the actual interaction failure against the current goal
and path generation, cancels that path, and propagates the original cause to
the task terminal. Inventory preparation failures use
`interaction-hand-unavailable`; workstation selection returns that prerequisite
failure without trying every station or adding a false reachability blacklist.
Queued work may then proceed through the existing single-body executor.

An ended or replaced path cannot cancel a later path or issue a late right-click.
Explicit prepared interactions retain their own owner. Connection cleanup removes
the observers. The change neither discards inventory nor substitutes unsafe held
items, invents a successful interaction, retries unknown effects or declares the
destination unreachable.

Regression coverage uses the installed pathfinder and local voxel physics with a
closed gate, full inventory, multiple workstations, queued work, and cancellation.
These isolated results do not establish live gameplay improvement until the
matching core package has been loaded and observed.
