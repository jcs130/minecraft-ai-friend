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
nothing is stowed or discarded. With rules and no explicit `sort` field, only
those dispositions run: there is no additional whole-bag merging or sorting,
including when every rule is already satisfied. Unmentioned stacks keep their
slots. This avoids turning a discard/storage request into an unrelated exchange
with a server-controlled shortcut item. The core does not infer which items a
server locks from their name, texture or Minecraft item ID.

To explicitly add arrangement after the rules, use `sort:false` for merging or
`sort:true` for merging and sorting. Ordinary `organize` without rules keeps its
existing merge-and-sort default. The preview uses the same choice and shows no
arrangement moves for a rules-only request; it does not predict the slots freed
by unexecuted dispositions.

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

## Rules-only scope correction (0.5.7-rc.52)

A live discard of eleven rotten flesh completed, but the old action then
implicitly sorted the whole bag. It picked up fourteen bread and attempted an
unrequested exchange with another occupied slot. The server's complete frame
kept that slot and the carried bread unchanged; strict confirmation correctly
stopped subsequent item clicks. No server plugin or lock rule is inferred from
that response alone.

Rules-only calls now finish after their requested dispositions, including when
no surplus exists. Native 1.21.1 and 1.20.6 tests reproduce the original rejected
exchange with an authoritative server fixture, then verify only the requested
discard occurs. Stow, preview, explicit merge/sort, empty cursor and unchanged
unrelated slots are checked separately. Pure organize and explicit sorting are
still available; a server may legitimately reject a requested item move.
The strict confirmation barrier, unknown-operation quarantine and no-replay
contract are unchanged. Source tests do not establish deployment, live recovery
or long-term survival.
