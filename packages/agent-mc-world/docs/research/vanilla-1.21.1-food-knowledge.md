# Vanilla Java 1.21.1 food knowledge

Researched on 2026-10-15. This is a versioned reference for the independent Minecraft core, not a report that a live agent has learned or successfully used these rules. No game, model or production process was invoked for this research.

## Verified inputs

The official [1.21.1 release](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-1) identifies the target Java release. Its [pinned version metadata](https://piston-meta.mojang.com/v1/packages/499680d659b7a0ccb2fa9a809c345c5baf2ace7d/1.21.1.json) supplies these immutable download objects:

| Input | SHA-1 | Role |
| --- | --- | --- |
| [Official client JAR](https://piston-data.mojang.com/v1/objects/30c73b1c5da787909b2f73340419fdf13b9def88/client.jar) | `30c73b1c5da787909b2f73340419fdf13b9def88` | Actual classes and `data/minecraft/recipe/*.json` |
| [Official client mappings](https://piston-data.mojang.com/v1/objects/2244b6f072256667bcd9a73df124d6c58de77992/client.txt) | `2244b6f072256667bcd9a73df124d6c58de77992` | Names and source line ranges for the obfuscated classes |

Both local inputs were checked against these SHA-1 values. The metadata URL was read from the official local manifest; the web reader could not render that JSON endpoint. The release page and Prismarine source links below were independently opened online. No unpinned latest-release assumption is needed to reproduce the results.

The installed dependency is `minecraft-data@3.112.0`, requested with `require('minecraft-data')('1.21.1')`; it reports protocol 767 and data version 3955. Its [version routing](https://github.com/PrismarineJS/minecraft-data/blob/master/data/dataPaths.json) selects `pc/1.21.1/foods.json`. The [food schema](https://github.com/PrismarineJS/minecraft-data/blob/master/schemas/foods_schema.json) contains nutrition and saturation fields, but no effects, probabilities, custom components or cooking method. Therefore that table is a numerical input, not a safe-food policy.

## Complete registered food table

All 41 entries below were read from the installed [1.21.1 food table](https://github.com/PrismarineJS/minecraft-data/blob/master/data/pc/1.21.1/foods.json) and compared programmatically with all 41 `Foods` declarations in the official JAR. Nutrition and saturation differed in **zero** entries. Saturation here is the amount added, not the builder's saturation modifier: official `FoodConstants.saturationByModifier` computes `nutrition * modifier * 2`.

| Item | Nutrition | Saturation |
| --- | ---: | ---: |
| `apple` | 4 | 2.4 |
| `mushroom_stew` | 6 | 7.2 |
| `bread` | 5 | 6 |
| `porkchop` | 3 | 1.8 |
| `cooked_porkchop` | 8 | 12.8 |
| `golden_apple` | 4 | 9.6 |
| `enchanted_golden_apple` | 4 | 9.6 |
| `cod` | 2 | 0.4 |
| `salmon` | 2 | 0.4 |
| `tropical_fish` | 1 | 0.2 |
| `pufferfish` | 1 | 0.2 |
| `cooked_cod` | 5 | 6 |
| `cooked_salmon` | 6 | 9.6 |
| `cookie` | 2 | 0.4 |
| `melon_slice` | 2 | 1.2 |
| `dried_kelp` | 1 | 0.6 |
| `beef` | 3 | 1.8 |
| `cooked_beef` | 8 | 12.8 |
| `chicken` | 2 | 1.2 |
| `cooked_chicken` | 6 | 7.2 |
| `rotten_flesh` | 4 | 0.8 |
| `spider_eye` | 2 | 3.2 |
| `carrot` | 3 | 3.6 |
| `potato` | 1 | 0.6 |
| `baked_potato` | 5 | 6 |
| `poisonous_potato` | 2 | 1.2 |
| `golden_carrot` | 6 | 14.4 |
| `pumpkin_pie` | 8 | 4.8 |
| `rabbit` | 3 | 1.8 |
| `cooked_rabbit` | 5 | 6 |
| `rabbit_stew` | 10 | 12 |
| `mutton` | 2 | 1.2 |
| `cooked_mutton` | 6 | 9.6 |
| `chorus_fruit` | 4 | 2.4 |
| `beetroot` | 1 | 1.2 |
| `beetroot_soup` | 6 | 7.2 |
| `suspicious_stew` | 6 | 7.2 |
| `sweet_berries` | 2 | 0.4 |
| `glow_berries` | 2 | 0.4 |
| `honey_bottle` | 6 | 1.2 |
| `ominous_bottle` | 1 | 0.2 |

**Important exception:** the final row describes the declared food component, not actual nourishment. Official `OminousBottleItem.finishUsingItem` adds Bad Omen and consumes the bottle without calling the normal item/player eating path. It must not be offered as an ordinary hunger-recovery food. This exception is visible in the official client JAR and mappings, not in `minecraft-data`'s schema.

## Side effects and special consumption

The following tuples were read from official `Foods` bytecode, with names resolved through `MobEffects` mappings. `amplifier` is zero-based; ticks are game ticks, not wall-clock guarantees. These defaults apply to the unmodified vanilla item. They are not statements about an arbitrary server-customized stack. Source: [official client](https://piston-data.mojang.com/v1/objects/30c73b1c5da787909b2f73340419fdf13b9def88/client.jar), `Foods` / `FoodProperties` / `MobEffects`, identified by the [official mappings](https://piston-data.mojang.com/v1/objects/2244b6f072256667bcd9a73df124d6c58de77992/client.txt).

| Item | Effect | Duration ticks | Amplifier | Chance |
| --- | --- | ---: | ---: | ---: |
| `chicken` | `hunger` | 600 | 0 | 0.3 |
| `rotten_flesh` | `hunger` | 600 | 0 | 0.8 |
| `poisonous_potato` | `poison` | 100 | 0 | 0.6 |
| `spider_eye` | `poison` | 100 | 0 | 1 |
| `pufferfish` | `poison` | 1200 | 1 | 1 |
| `pufferfish` | `hunger` | 300 | 2 | 1 |
| `pufferfish` | `nausea` | 300 | 0 | 1 |
| `golden_apple` | `regeneration` | 100 | 1 | 1 |
| `golden_apple` | `absorption` | 2400 | 0 | 1 |
| `enchanted_golden_apple` | `regeneration` | 400 | 1 | 1 |
| `enchanted_golden_apple` | `resistance` | 6000 | 0 | 1 |
| `enchanted_golden_apple` | `fire_resistance` | 6000 | 0 | 1 |
| `enchanted_golden_apple` | `absorption` | 2400 | 3 | 1 |

The other `Foods` declarations have no fixed `effects` entries. Special item subclasses still matter:

| Item | Additional behavior and source class |
| --- | --- |
| `honey_bottle` | `HoneyBottleItem` removes Poison; drinking takes 40 ticks and returns a glass bottle. It still invokes normal food consumption. |
| `chorus_fruit` | `ChorusFruitItem` attempts random teleportation, with at most 16 candidate positions and a 20-tick cooldown. Teleportation can alter the route and must not be hidden by a generic food score. |
| `suspicious_stew` | `SuspiciousStewItem` applies the individual stack's `minecraft:suspicious_stew_effects`. A name-only record cannot establish which effects are present. Read complete components; an unavailable/incomplete component observation is unknown, not verified harmless. |
| `ominous_bottle` | `OminousBottleItem` adds `bad_omen` for 120000 ticks at the stack's `minecraft:ominous_bottle_amplifier` (0–4), with certainty. No normal nourishment path. |

These behaviors were read from the corresponding official classes. The [official component documentation](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-20-5) also documents customizable `minecraft:food` fields and effects. A customized item can change nutrition, saturation, eat time and effects; actual stack components take precedence over an unmodified vanilla default. Do not project this 1.21.1 schema onto later Java versions whose consumption components changed.

The official default eat time is 32 ticks; `dried_kelp` uses 16. `chorus_fruit`, both golden apples and `suspicious_stew` set `canAlwaysEat`; honey and ominous bottles have their own use methods. In contrast, the installed [Mineflayer 4.37.1 consume implementation](https://github.com/PrismarineJS/mineflayer/blob/4.37.1/lib/plugins/inventory.js) has a smaller full-hunger allowlist. A knowledge fact about vanilla behavior does not prove that the current executor exposes that action correctly.

Raw beef, pork, mutton, rabbit, cod and salmon do **not** have raw chicken's fixed Hunger effect in vanilla 1.21.1. They are inefficient relative to their cooked forms, not all equally poisonous. Rotten flesh's Hunger effect accelerates exhaustion rather than being a direct damage effect; official `HungerMobEffect` adds `0.005 * (amplifier + 1)` exhaustion each tick. Avoid promising that every food directly restores health.

## Hunger, saturation and natural regeneration

Official `FoodData.tick` in the [client JAR](https://piston-data.mojang.com/v1/objects/30c73b1c5da787909b2f73340419fdf13b9def88/client.jar), named by the [mappings](https://piston-data.mojang.com/v1/objects/2244b6f072256667bcd9a73df124d6c58de77992/client.txt), establishes:

- Ordinary eating increases food level, capped at 20. Added saturation is capped at the resulting food level.
- With `naturalRegeneration` enabled, an injured player at food level **18 or higher** can recover **1 health point every 80 ticks**, adding 6 exhaustion.
- At food level **20** with saturation above zero, the accelerated branch runs every **10 ticks**: heal `min(saturation, 6) / 6` health points and add `min(saturation, 6)` exhaustion.
- Exhaustion above 4 removes 4 exhaustion, first reducing saturation by 1; when saturation is exhausted, food level can decrease outside Peaceful difficulty.
- At zero food level, starvation damage is evaluated every 80 ticks; the stopping health threshold depends on difficulty.

Thus a high-saturation cooked food can sustain recovery much better than the same quantity of raw meat. That is a consequence of these rules, not an intrinsic "health restored" field on steak. Different gamerules, difficulty, custom effects or server implementations require current-world verification. Nominal 20 ticks/second is not a timing guarantee on a lagging server.

Mineflayer exposes current `health`, `food` and `foodSaturation` from actual `update_health` packets in its [health plugin](https://github.com/PrismarineJS/mineflayer/blob/4.37.1/lib/plugins/health.js). Use those observations to decide urgency and validate actual recovery; missing synchronization must remain unknown.

## Complete vanilla cooking conversions

The verified official client JAR contains **1290** `data/minecraft/recipe/*.json` files. Each conversion below has three real recipes. `R` in the path is the output item ID. Sources are those original JSON members of the [pinned client JAR](https://piston-data.mojang.com/v1/objects/30c73b1c5da787909b2f73340419fdf13b9def88/client.jar), not inferred working-table recipes.

| Input | Output `R` | Smelting filename |
| --- | --- | --- |
| `beef` | `cooked_beef` | `cooked_beef.json` |
| `chicken` | `cooked_chicken` | `cooked_chicken.json` |
| `cod` | `cooked_cod` | `cooked_cod.json` |
| `mutton` | `cooked_mutton` | `cooked_mutton.json` |
| `porkchop` | `cooked_porkchop` | `cooked_porkchop.json` |
| `rabbit` | `cooked_rabbit` | `cooked_rabbit.json` |
| `salmon` | `cooked_salmon` | `cooked_salmon.json` |
| `potato` | `baked_potato` | `baked_potato.json` |
| `kelp` | `dried_kelp` | `dried_kelp_from_smelting.json` |

All paths are under `data/minecraft/recipe/`. The parallel filenames are `R_from_smoking.json` and `R_from_campfire_cooking.json`:

| Recipe type | Declared cooking time | Prerequisite |
| --- | ---: | --- |
| `minecraft:smelting` | 200 ticks | Furnace and usable fuel |
| `minecraft:smoking` | 100 ticks | Smoker and usable fuel |
| `minecraft:campfire_cooking` | 600 ticks | Usable lit campfire |

`dried_kelp.json` is a **different** shapeless conversion from one dried kelp block to nine dried kelp. `charcoal.json` is `minecraft:smelting` using the `minecraft:logs_that_burn` tag, 200 ticks; it is not a workbench charcoal recipe. These source records identify method and ingredients, not current station accessibility, protection permissions, available fuel or successful execution.

The installed `minecraft-data.recipes` lookup has no entries for `cooked_beef`, `baked_potato` or `charcoal`; it is insufficient for cooking discovery. The [recipes schema](https://github.com/PrismarineJS/minecraft-data/blob/master/schemas/recipes_schema.json) primarily describes crafting shapes. Keep recipe type explicit and consult versioned cooking records or current server recipe information.

## Non-held-food cases

The original `cake.json` and `pumpkin_pie.json` recipes use `egg`; there is no default directly edible egg in `Foods`, and the vanilla cooking records contain no cooked-egg conversion. Cake is also absent from `foodsArray`, but official `CakeBlock.eat` restores 2 nutrition and 0.4 saturation per placed slice, up to seven slices. Consequently, "not in held-food table" does not mean "has no food-related use." Source: official client `CakeBlock`, `Foods` and those two recipe JSON members, resolved through the [mappings](https://piston-data.mojang.com/v1/objects/2244b6f072256667bcd9a73df124d6c58de77992/client.txt).

## Retrieval design and decision implications

The recommended implementation is a read-only, versioned vanilla reference distinct from the historical [game notebook](../game-memory.md). Structured item, recipe, entity, effect and block registry entries can be searched locally; explicit semantic cards add behaviors that numerical tables omit. Return bounded titles, IDs, versions and provenance first, then one requested full entry. A deterministic local path needs no embeddings service, hidden model call or server scan. Optional configured semantic retrieval can supplement this later without making the reference dependent on it.

Practical decision policy should use current hunger, health, accessible food, safety, station/fuel availability and time to danger. Prefer already available safe cooked food when appropriate; preserve some valuable recovery items; plan cooking when feasible. Do not enforce a blanket "never eat raw food" rule that leaves an endangered or starving player waiting for unavailable fuel. Unknown or harmful effects require explicit treatment rather than a single `nutrition + saturation` ranking. These are proposed control policies derived from the verified mechanics, not additional vanilla rules or a live acceptance result.

For cache-friendly host context, keep stable reference contracts in the stable prefix and load selected findings on demand. Current inventory, component values, health, hunger and task receipts belong in the changing tail. A retrieved vanilla entry is background knowledge, never proof of a current server recipe, current stock, protected-block permission or completed task.

## Reproduction

Read-only checks used Java `javap -c -p` against the pinned original JAR and Python `zipfile` to read original recipe JSON. No decompiled source or binary assets are committed here.

| Mapped class | Obfuscated 1.21.1 name | Relevant member |
| --- | --- | --- |
| `net.minecraft.world.food.Foods` | `cps` | All 41 default declarations |
| `net.minecraft.world.food.FoodProperties$Builder` | `cpr$a` | Nutrition, modifier, always-edible and fast flags |
| `net.minecraft.world.food.FoodConstants` | `cpp` | Saturation formula |
| `net.minecraft.world.food.FoodData` | `cpq` | `tick`, `add`, `eat` |
| `net.minecraft.world.effect.MobEffects` | `bsb` | Effect identities |
| `net.minecraft.world.effect.HungerMobEffect` | `bru` | Exhaustion effect |
| `net.minecraft.world.item.HoneyBottleItem` | `cuf` | Poison removal and use time |
| `net.minecraft.world.item.OminousBottleItem` | `cvh` | Bad Omen and consumption override |
| `net.minecraft.world.item.ChorusFruitItem` | `csx` | Teleportation and cooldown |
| `net.minecraft.world.item.SuspiciousStewItem` | `cwf` | Stack-specific effects |
| `net.minecraft.world.item.component.SuspiciousStewEffects` | `cxw` | Effect component |
| `net.minecraft.world.level.block.CakeBlock` | `dgk` | Placed-slice eating |

The comparison check read each `Foods` static declaration's nutrition and saturation modifier, applied the official formula, and compared by item name against all installed `foodsArray` entries. Result: 41 versus 41 entries, zero numerical differences; only four always-edible food declarations and one fast food declaration. Source defaults and live stack overrides remain separate. Exact source hashes, version gates, component completeness and tests should accompany the implementation; this research alone does not validate a deployed food selector.
