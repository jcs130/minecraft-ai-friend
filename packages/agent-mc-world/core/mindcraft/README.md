# Mindcraft programs on Mineflayer

The Mineflayer backend provides Mindcraft's `world` and `skills` namespaces in the existing JavaScript program and versioned procedure tools. A model writes the body of one async function. It can branch on a fresh observation, perform a sequence and inspect the result before returning. The same source works in `mc_script` through the standalone SDK or MCP and in Cortico's mounted `mymc_script`.

```js
const before = world.getInventoryCounts(bot);
if ((before.oak_log ?? 0) < 1) return { missing: "oak_log" };
const crafted = await skills.craftRecipe(bot, "oak_planks", 1);
const after = world.getInventoryCounts(bot);
return { crafted, gained: (after.oak_planks ?? 0) - (before.oak_planks ?? 0), detail: bot.output };
```

Discover `{api:"mindcraft"}` or one entry such as `{api:"skills.takeFromChest"}`. Source, calls, result and errors have the ordinary script run identity. `skills.log(bot, text)` adds local program notes. Action helpers and native `await bot.*` primitives share the connection and body lease. Read-only world queries leave the body free. An explicit program cancellation revokes further calls. Previously submitted operations still require observation.

## Upstream and adaptations

Game library source comes from [Mindcraft revision e1c1fc3](https://github.com/mindcraft-bots/mindcraft/tree/e1c1fc3ffa481506c2445fc639e16dba504b5920/src/agent/library) and its [registry and recipe utilities](https://github.com/mindcraft-bots/mindcraft/blob/e1c1fc3ffa481506c2445fc639e16dba504b5920/src/utils/mcdata.js). Copyright 2024 Kolby Nottingham. The original MIT license is included alongside these files.

The 21 world and 39 skill entry names follow upstream. The additional world.getDetailedCraftingPlan query returns a structured adaptation of the upstream recipe planner, with ordered recipe applications, missing inputs, a search-limit flag and a ready boolean. It reads the current inventory and exact-version ingredient tags. The world queries, recipe and resource calculations, station selection, block/entity approach, trade inspection and execution, furnace extraction, and downward digging derive from its code. Operations that already have an owned body implementation reuse the existing executor or native primitives. Body control, observation scope, cancellation, and reports belong to the active Agent MC World connection. The runtime does not start Mindcraft's second model loop or log in another account.

Queries use the connection's registry. Hidden or unloaded cells are unknown. Block searches inspect visible candidates up to 32 blocks away, with at most 64 results. Function block predicates filter that bounded sample of non-air cells. For a targeted search pass the names to `getNearestBlocks` or IDs to `getNearestBlocksWhere`. Entity predicates run in the calling program. World queries are synchronous from the program’s perspective. Only its worker waits. Physical actions return a promise.

`craftRecipe` counts recipe applications and checks the output delta. Container helpers open a visible container and release their own window; their log is available through `bot.output`. A combat request or a dropped item still needs a server receipt to establish kill attribution or delivery. `goToBed` returns after sleep is observed. `goToSurface` requires an observed sunlit surface. `stay` and `followPlayer` run within the caller's existing program deadline. A task that needs another segment can observe its current state and start a new program.
