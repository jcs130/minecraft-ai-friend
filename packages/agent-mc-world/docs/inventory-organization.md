# Inventory organization

The Mineflayer `organize` action is shared by `mc_do`, `mc_scout`, scripts,
SDK/MCP clients and host adapters. It performs a complete mechanical plan in one
body task; the model does not need to issue an instruction for each click.
The Java native backend does not yet implement this action.

## Basic use

```json
{"steps":[{"skill":"organize"}]}
```

This merges identical stacks and sorts the 27 main inventory slots by item ID
and exact variant identity. It preserves quickbar layout, armor, offhand and
crafting slots. `includeHotbar:true` includes the quickbar; `sort:false` merges
without sorting. Already organized slots require no clicks. Sorting alone
cannot free slots occupied by nonmergeable items.

For an opened chest or server backpack, use a single task containing the opener
and `{ "skill":"organize", "target":"open" }`. Only the actual storage area
is rearranged; menu buttons and workstation inputs/outputs are not storage.
Custom storage names are allowed. `target:"inventory"` can also organize the
player area while a storage window is open.

## Explicit surplus policy

```json
{"steps":[{"skill":"organize","rules":[
  {"item":"cobblestone","keep":64,"action":"stow"},
  {"item":"rotten_flesh","keep":0,"action":"toss"}
],"at":[103,63,-31]}]}
```

Rules run in order using fresh player stock. `keep` is the number retained among
items matching `item` and optional `pick`. Selectors use the same item/category
and label contracts as existing stow/toss. Disposition includes the 36 carried
slots, including quickbar, but does not unequip armor or offhand. With no rules,
nothing is stowed or discarded. Unmentioned items are retained.

Stow uses normal nearby storage discovery, or `at` for one specified chest,
or `into:"open"` for the current custom container. `at` and `into` are mutually
exclusive. These fields apply only to stow rules. Toss closes any open window;
a later rule requiring `into:"open"` must still have a valid open container.
A failed disposition stops the remaining plan and reports prior results.
Discarded items can be picked up again; toss checks the actual inventory after
settlement rather than treating the click as freed capacity.

The core does not decide which objects are junk, install a background cleanup
loop or force inventory organization ahead of other goals. Hosts can select a
policy when useful or save a script that calls the same action and reviews its
actual outcome. There is no automatic skill promotion or learning claim.

## Preview and evidence

`dryRun:true`, or the same action through `mc_scout`, returns a read-only plan
and the currently observed surplus. Final layout/free slots describe the current
sorting scope; preview does not simulate unobserved chest capacity or post-rule
stock. Execution replans using current slots.

Each click waits for server slots and cursor confirmation. Merging compares
legacy NBT and modern components/removals, including custom stack limits.
Swapping needs no spare slot. Cancellation returns only a confirmed cursor
owned by this action; unknown acknowledgments retain the window and cursor and
stop all subsequent clicks. No uncertain transaction is automatically replayed.
The terminal reports confirmed merges/swaps and actual free-slot changes;
arrangement verifies item-data/count conservation and unchanged outside slots.
Acceptance, a preview and task completion do not establish a broader goal.

Portable planning is exported from `agent-mc-world/client` and `/extension`:
`planInventoryOrganization`, `inventoryOrganizationKey`,
`inventoryOrganizationLimit`, `inventoryOrganizationTotals` and their interfaces.
`/contracts` exports the data interfaces. These functions do not acquire a body,
click, discover a server or choose a storage/discard policy.
