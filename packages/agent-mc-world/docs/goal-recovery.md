# Goal recovery and combat equipment

`mc_goal` keeps at most five intentions, not a growing task queue. With the existing
`dataDir` option, semantic goal writes now update `minecraft-goals/<scope-hash>.json`
atomically. A scope contains the world identity, authentication mode/account, and
`memoryAgentId` (or the host's `botName`). Without `dataDir`, goals remain temporary.

After a restart, the same scope restores the original slot, identity timestamp,
revision, plan, reported progress, and dated host judgments. It resets mechanical
steps to pending and discards their live observation evidence. Coordinates in a
predicate retain their explicit dimension. Reported progress is still historical;
only fresh world reads can verify current conditions. Recovery never queues a task,
replays an unknown result, declares goal completion, or loads another account's
intentions. A newly chosen goal must not be overwritten with an older maintenance
snapshot. Existing deployments without a checkpoint need a one-time reviewed
handoff of their current intention, not a reconstruction from stale dialogue.

The public SDK and extension exports provide `GoalCheckpointBook`,
`createGoalCheckpoint`, and `restoreGoalCheckpoint` for consumers that need an
explicit reviewed handoff. The ordinary SDK/MCP `mc_goal` tool uses the same core
implementation; no host-specific prompt or duplicate goal store is required.
Invalid, oversized, mismatched, or duplicate-slot snapshots are rejected. Corrupt
files are retained, and subsequent saves report that recovery could not be stored.
Clearing the **目标恢复与暂态表** storage section explicitly removes saved intentions
as well as the in-memory tables. Personal memory and event archives are separate.
If every milestone already has a record, another judgment call reports that
there is no next step and points to `reopen`, `revise`, or evidence-backed `done`.
It cannot direct the host to a nonexistent step or rewrite a prior judgment.

Combat now uses the existing authoritative hand-equipment helper. A weapon found
in inventory is not proof that it is in the main hand. Automatic combat can keep
maneuvering during one bounded equip attempt, but does not swing until the actual
hand reading is armed. A rejected/unconfirmed/timed-out equip causes retreat;
the existing cornered escape fallback remains explicit. A direct `attack` reports
equipment failure instead of silently replacing the selected weapon with fists.
Deliberately unarmed actions when no weapon is available remain supported.
An explicit attack also checks cancellation and low health during equipment
waits. Its validity check follows cursor recovery and each subsequent inventory
dispatch: an original click may receive its late acknowledgement, but the ended
attack cannot dispatch another click or restore its attack controls. The existing
pending/quarantined inventory barrier is preserved.
If only a loaded ranged weapon is available, automatic combat keeps ranged
spacing even when an enemy moves close; a bow in inventory cannot qualify an
empty melee hand as armed.

These are lifecycle and execution fixes. Offline tests cannot establish improved
survival or goal completion in a live server.
## Full hotbar and main-hand equipment

When equipping a stored item, the core prefers an empty hotbar slot. If the
hotbar is full and the selected item has a custom name, it prefers exchanging
an ordinary hotbar stack, preserving the named item in place. A custom name is
not proof of server protection; the exchange still requires authoritative
confirmation of both stacks and an empty cursor. A rejected exchange does not
try other slots, and cancellation prevents a late acknowledgement from changing
the selected hand. This applies to the shared equipment path used by explicit
equip, combat, ranged weapons and building.
