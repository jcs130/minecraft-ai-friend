# Vanilla Java 1.21.1 survival foundations

Researched 2026-10-16 for the independent Minecraft core. This note proposes **optional, on-demand references**, not a mandatory opening route, autonomous controller, or evidence of successful gameplay. Only public web research and read-only source/JAR inspection were performed. No game, model, TTS, service, SDK action, test, or Git operation was invoked.

## Findings and existing coverage

The concrete gap is practical survival guidance connecting existing facts and actions: obtaining/using a bed, surviving a night without one, choosing useful equipment, creating a usable base/storage area, and establishing renewable food. It is **not** absence of every underlying ability.

- [core/knowledge.ts](../../core/knowledge.ts) already implements offline `mc_knowledge` search/get, exact-version gates, item/block/food/crafting indexes, bounded summaries, and four recipe variants per page. Its warning already says guides are optional and references are data. Preserve that contract.
- [core/vanilla-food.ts](../../core/vanilla-food.ts) currently supplies only `guide/food`, `guide/health`, and `guide/cooking`; [vanilla-knowledge.md](../vanilla-knowledge.md) documents them. They already cover cooked/raw food, side effects, hunger/saturation, natural regeneration, nine cooking conversions, and charcoal. Link these entries rather than copying their tables into new guides.
- Beds, chests, tools, armor, torches and seeds already have generic registry references; crafting references exist where the upstream recipe index includes them. Generic recipes do not explain when a bed is usable, how to seal a shelter safely, or why a planted crop is not immediate food.
- The [Minecraft Agent skill](../../skills/minecraft-agent/SKILL.md) already teaches observation, `mc_help`, execution receipts and verification. Its [building guide](../../skills/minecraft-agent/references/building-methods.md) covers construction methods. New survival entries should point to that discovery workflow and avoid introducing another planner.

## Primary sources and version lock

The target is the [official Java 1.21.1 release](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-1). The local original inputs were read at `D:/neko-plugins/minecraft_autonomous/local/live-runtime/all-visuals-20261015/official-inputs/`; no runtime state, account history, secrets or private world data was read.

| Input | Verified SHA-1 | Use |
| --- | --- | --- |
| [Pinned 1.21.1 metadata](https://piston-meta.mojang.com/v1/packages/499680d659b7a0ccb2fa9a809c345c5baf2ace7d/1.21.1.json) | Version identity supplied by original local JSON | Immutable client/mappings URLs |
| [Original client JAR](https://piston-data.mojang.com/v1/objects/30c73b1c5da787909b2f73340419fdf13b9def88/client.jar) | `30c73b1c5da787909b2f73340419fdf13b9def88` | Original recipes, tags, loot tables, dimension types and class bytecode |
| [Official client mappings](https://piston-data.mojang.com/v1/objects/2244b6f072256667bcd9a73df124d6c58de77992/client.txt) | `2244b6f072256667bcd9a73df124d6c58de77992` | Resolve original class/member identities and source line ranges |

The original JAR hash matched local metadata. Official mappings were fetched publicly into memory and their hash matched metadata; no mapping file or binary was added to this repository. Exact mechanics below use those original inputs, not a community wiki or the current latest game.

Useful first-party explanatory sources, read online:

| Source | Suitable scope and limits |
| --- | --- |
| [How to survive your first night](https://www.minecraft.net/en-us/article/how-survive-your-first-night-minecraft), 2023-06-05 | Alternative ways to handle night: barriers, lighting, underground shelter, defense, bed and furnace. Its broad statements about mob sight/light are introductory advice, not universal safety guarantees. |
| [How to Survive your First Day](https://www.minecraft.net/de-de/article/how-survive-your-first-day), 2017 | Example hillside/L-shaped shelter, lighting and waiting until morning. Treat its specific resource counts and order as one illustrative route. |
| [Taking Inventory: Bed](https://www.minecraft.net/en-us/article/taking-inventory--bed), 2019-07-05 | Beds, nearby-monster restrictions and sleep/rest context. Use 1.21.1 code for exact checks. |
| [How to craft](https://www.minecraft.net/en-us/article/how-craft), 2023-06-05 | Inventory grid versus crafting table and ingredient/recipe discovery. Use original JSON for exact shapes and quantities. |
| [Taking Inventory: Shield](https://www.minecraft.net/en-us/article/taking-inventory--shield), 2019-07-25 | Shield ingredients and active frontal blocking; a carried/equipped shield alone does not establish protection. |
| [Block of the Week: Chest](https://www.minecraft.net/en-us/article/block-week-chest), 2017-07-28 | Storage and practical organization, without imposing one sorting scheme. |
| [Block of the Week: Farmland](https://www.minecraft.net/en-us/article/block-week-farmland), 2017-01-13 | Hoe, seeds, nearby irrigation, light and trampling. Exact hydration/light/age checks are independently pinned below. |
| [Taking Inventory: Wheat](https://www.minecraft.net/fr-fr/article/taking-inventory--wheat), 2022-04-21 | Plant, wait, harvest; wheat is an ingredient in bread and animal breeding. |

Later articles can be misleading for this target: [Java 1.21.9](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-9) adds copper equipment. Copper swords/armor/chests are not a vanilla 1.21.1 survival tier. A modded server may add its own, which requires actual registry/recipe evidence.

## Suggested retrieval taxonomy

Retain the current `guide/<snake_case>` ID format. These IDs are **proposals**, not available entries created by this note. Each card should expose a short applicability summary, alternatives, prerequisites, failure conditions, verification and precise sources. Chinese and English discovery terms belong in titles/searchable text.

| Proposed ID | Discovery terms | Main question; existing entries to reuse |
| --- | --- | --- |
| `guide/bed` | 床、羊毛、睡觉、跳过夜晚、重生点 / bed wool sleep night spawn | Can I obtain/place/use a bed safely here? Link actual-color `recipe/*_bed`, `item/shears`. |
| `guide/night_shelter` | 没床、夜晚、临时庇护、封闭、挖洞、埋地、等天亮 / no bed shelter hide wait dawn | Can I make a small enclosed refuge and actually wait safely? Link torches, suitable blocks and observation/build help. |
| `guide/equipment` | 武器、防具、工具、剑、盾、镐 / equipment armor weapon shield tools | Which available equipment improves this task or escape? Link concrete recipes and block harvest-tool requirements. |
| `guide/base` | 房子、家、基地、营地、工作台、炉子 / house home base camp | What would make this location a usable home now? Link shelter, bed, storage and cooking cards. |
| `guide/storage` | 箱子、收纳、背包满、存取 / chest storage inventory stow take | How do I create/access storage while retaining emergency supplies? Link `recipe/chest`, container help. |
| `guide/farming` | 食物来源、种田、种子、小麦、胡萝卜、马铃薯、耕地、补种 / farm crops seeds renewable food | How can food become renewable without waiting hungry for immature crops? Link existing food/health/cooking and bread/crop records. |

Search summaries should help the Agent choose whether to read a card; reading must not enqueue a task, enforce an activity sequence, or promote a historical lesson. Avoid hard-coded coordinates, target quotas, or assumed server commands. Current time, dimension, danger, inventory and permissions remain fresh observations outside the reference.

## Bed and sleep: verified facts and advisory use

Original `data/minecraft/recipe/white_bed.json` and `red_bed.json` each use a row of **three wool of that recipe's color** over a row of **three `minecraft:planks` tag members**, producing one bed. The shape is 3 columns wide, so the ordinary 2×2 inventory grid is insufficient. Mixed plank species can satisfy the tag; mixing arbitrary wool colors is not this shaped recipe. Other bed recoloring recipes should be retrieved separately. The official [first-night article](https://www.minecraft.net/en-us/article/how-survive-your-first-night-minecraft) also presents wool collection and beds as an option. [Original recipe source](https://piston-data.mojang.com/v1/objects/30c73b1c5da787909b2f73340419fdf13b9def88/client.jar).

`BedBlock` (`dfr`) owns interaction and placement. Its `useWithoutItem` (mapped lines 89–130) first handles the two bed halves and the dimension's `bed_works` property; when false it removes the bed and creates an explosion with power **5**, before ordinary sleep checks. Original dimension-type JSON sets `bed_works:true` for the Overworld and `false` for the Nether and End. For safe survival, do not experiment by clicking a bed in an unsafe/unknown dimension; a custom dimension's actual type matters, not only its display name. [Official JAR](https://piston-data.mojang.com/v1/objects/30c73b1c5da787909b2f73340419fdf13b9def88/client.jar), [official mappings](https://piston-data.mojang.com/v1/objects/2244b6f072256667bcd9a73df124d6c58de77992/client.txt).

`ServerPlayer.startSleepInBed` (`aqv`, lines 1002–1045) checks living/not-already-sleeping state, natural dimension, range, overhead obstruction and daytime. It sets the personal respawn position **before** rejecting daytime or nearby-danger sleep. In ordinary Survival it queries dangerous `Monster` entities around the bed in an axis-aligned region extending **8 blocks in X/Z and 5 in Y**; this is not a universal spherical radius for every hostile entity or mod. Occupied beds and blocked/range failures also matter. Night or thunder-darkened conditions can permit sleeping; an arbitrary rain shower is not equivalent to a thunderstorm. Use current server feedback rather than deriving permission from an approximate time label. [Official JAR and mappings above], `Level.isDay` (`dcw.R`, mapped line 388), `BedBlock.useWithoutItem`.

Skipping to morning additionally depends on sufficient deep-sleeping players and gamerules. `ServerLevel.tick` (`aqu`, lines 303–419) consults `playersSleepingPercentage`, `SleepStatus.areEnoughSleeping/areEnoughDeepSleeping`, and only advances day time when `doDaylightCycle` is enabled. Lying down, setting spawn, waking, and successfully skipping night are distinct outcomes. An early wake, a timeout, or another player's absence can leave it dark. [Official JAR](https://piston-data.mojang.com/v1/objects/30c73b1c5da787909b2f73340419fdf13b9def88/client.jar), classes `aqu`, `auu`, `cmx`, `dcs` resolved by the official mappings.

**Suggested card advice:** compare an existing accessible bed, crafting one from available wool/planks, and a temporary refuge. Before placement, inspect a horizontal two-cell footprint, usable floor, clearance and safe approach/wake/exit positions. Both-floor support is a conservative executor/shelter recommendation, not an assertion that vanilla `getStateForPlacement` universally demands full support under both halves. Verify actual head/foot states after placement, real sleeping state after use, and dimension/time/health after waking. Removing or obstructing the bed can invalidate later respawn; do not treat an old location note as current proof.

## A night without a bed

The official [first-night guide](https://www.minecraft.net/en-us/article/how-survive-your-first-night-minecraft) explicitly offers dirt/cobblestone barriers, a small house or a dug refuge, with lighting; the [first-day example](https://www.minecraft.net/de-de/article/how-survive-your-first-day) includes waiting inside an enclosed lit hillside shelter. This supports a practical alternative when seeking wool is too risky, not a requirement to build a full house first.

**Suggested card advice, derived from mechanics and executor constraints:**

1. Inspect the intended occupied cells, nearby threats, loaded geometry, fluid exposure and materials. Choose a reachable dry site or a shallow side-cut into known terrain; do not dig blindly straight down or under unseen water/lava/falling material.
2. Leave ordinary standing room: a solid floor and two clear vertical cells for feet/body/head. Place walls/roof around those cells, not inside the player's hitbox. A buried refuge means enclosing air cells around the player, not filling the player's head with a block. A roof is needed for overhead exposure; a side slit or a door alone is not a universal mob barrier.
3. Keep an identified exit and a way to reopen it with carried tools/blocks. Prefer stable dirt/cobblestone-style enclosure over unsupported sand/gravel. Inspect overhead and adjacent blocks before digging or removing support. Place light where feasible and verify closure/clearance; light reduces ordinary spawning risk but neither removes existing mobs nor excludes every special spawn/mechanic.
4. Actually remain inside for elapsed game time, with bounded waits and fresh observations. Stop unnecessary movement/attacks that spend food or break enclosure; respond if health/air/threat facts change. Waiting for a command receipt or ending a reasoning turn is not waiting until morning.
5. Recheck daylight, immediate exterior threats and a usable exit before unsealing. Dawn does not guarantee all mobs are gone. If time progression is disabled or no safe waiting method is available, report that condition and reconsider options.

This checklist is advisory engineering synthesis, not a new vanilla rule or a verified shelter-building program. Original `Entity.isInWall` (`bsr`, lines 2105–2112), `LivingEntity.baseTick` (`btn`, lines 395–506) and `FallingBlock` (`diu`) are the relevant collision/suffocation/air/falling-block sources; local placement checks independently reject body overlap/unknown support. Here “air” means breathable occupied space and avoiding fluids/solid head collision; a sealed refuge should not be described as requiring a real-world ventilation system. [Official classes and mappings](https://piston-data.mojang.com/v1/objects/2244b6f072256667bcd9a73df124d6c58de77992/client.txt), [original JAR](https://piston-data.mojang.com/v1/objects/30c73b1c5da787909b2f73340419fdf13b9def88/client.jar).

## Equipment, base and storage

Equipment is task-dependent. A pickaxe enables relevant harvesting, an axe speeds wood collection and can defend, a sword provides another weapon, a shovel helps dirt work, and a hoe enables farming. Obtaining everything before taking shelter is not necessary. Check the actual block's `harvestTools`, carried equipment, durability and present danger. Better tools/armor improve possibilities without guaranteeing combat success. The official [shield article](https://www.minecraft.net/en-us/article/taking-inventory--shield) distinguishes equipping from active frontal blocking and notes unblockable attacks/axe disabling.

The following quantities were read directly from named original `data/minecraft/recipe/<id>.json` members. Retrieve their full shape/tag alternatives on demand; counts are inputs per recipe, not executor `count` semantics. [Original 1.21.1 JAR](https://piston-data.mojang.com/v1/objects/30c73b1c5da787909b2f73340419fdf13b9def88/client.jar).

| Recipe ID | Ingredients → output |
| --- | --- |
| `crafting_table` | 4 planks → 1 table |
| `stick` | 2 planks → 4 sticks |
| `wooden_pickaxe` | 3 planks + 2 sticks → 1 |
| `stone_pickaxe` / `stone_axe` | 3 stone-tool-material items + 2 sticks → 1 each |
| `stone_sword` | 2 stone-tool-material items + 1 stick → 1 |
| `stone_shovel` | 1 stone-tool-material item + 2 sticks → 1 |
| `wooden_hoe` | 2 planks + 2 sticks → 1 |
| `iron_helmet` / `iron_chestplate` / `iron_leggings` / `iron_boots` | 5 / 8 / 7 / 4 iron ingots → 1 corresponding piece; full set totals 24 |
| `shield` | 6 planks + 1 iron ingot → 1 |
| `chest` | 8 planks, empty center → 1 |
| `furnace` | 8 stone-crafting-material items, empty center → 1 |
| `torch` | 1 coal **or charcoal** + 1 stick → 4 |
| `bread` | 3 wheat → 1; crafting, no furnace |
| `bucket` / `shears` | 3 / 2 iron ingots → 1 corresponding item |

Original `data/minecraft/tags/item/stone_tool_materials.json` and `stone_crafting_materials.json` both contain cobblestone, blackstone and cobbled deepslate. Do not turn a tutorial's “cobblestone” example into an exclusive recipe restriction. Smelting raw iron and making charcoal require their actual furnace recipes/fuel; intermediate materials do not appear automatically.

**Suggested base advice:** select a dry, reachable site with safe work space, manageable access and food/water/resources appropriate to current needs. A tiny usable shelter can grow into a house. Add reachable table/furnace/storage, interior lighting, room for movement and bed access when available. Preserve a route in/out and record the location with dimension; a coordinate note or blueprint is not proof that the house exists or is safe. Building methods remain the Agent's choice.

**Suggested storage advice:** craft/place an accessible chest when carrying capacity is constraining useful work; verify opening and real deposits/withdrawals. Leave usable space above the lid and a safe approach; original `ChestBlock.isChestBlockedAt/isBlockedChestByBlock` (`dhb`, mapped lines 324–329) handles obstruction and another branch checks cats. Keep emergency food, essential tools, light and exit blocks available rather than storing every useful item. Organization can be chosen by the Agent; the official [chest article](https://www.minecraft.net/en-us/article/block-week-chest) supplies examples, not a required sorting policy.

## Safe food and renewable crops

Use [existing food research](vanilla-1.21.1-food-knowledge.md) and `guide/food`, `guide/health`, `guide/cooking` for detailed values/effects: food generally supports natural regeneration through hunger/saturation; it does not usually heal directly. Safe cooked counterparts are often more nourishing. Raw chicken, rotten flesh, poisonous potatoes, spider eyes and pufferfish have specific risks; ordinary raw beef/pork/mutton/rabbit/cod/salmon do not all share those risks. Unknown stew/custom components remain unknown. If cooking is inaccessible and starvation is urgent, available safe raw food can be preferable to waiting. Current saturation must not be invented from nutrition tables or assumed to be fully synchronized.

For renewable food, the official [farmland](https://www.minecraft.net/en-us/article/block-week-farmland) and [wheat](https://www.minecraft.net/fr-fr/article/taking-inventory--wheat) articles support preparing soil, irrigation, planting, growth, harvesting and replanting. These are medium-term supply options, not immediate hunger relief or permission to take another player's crops.

Pinned 1.21.1 mechanics:

- `FarmBlock.isNearWater` (`div`, lines 126–131) searches from relative `[-4,0,-4]` through `[4,1,4]` for water-tag fluid. Water within four blocks horizontally, including diagonals, at farmland height or one above can hydrate it. Its random tick also handles rain and moisture loss. Water is beneficial; planting is not universally impossible on temporarily dry farmland.
- `CropBlock.randomTick` (`dht`, lines 88–98) checks brightness **at least 9**, maturity and a random growth test influenced by surroundings. A planted seed and a fixed elapsed wall-clock interval do not guarantee mature food; loaded/ticking chunks, random-tick settings and server changes matter.
- Original crop loot tables and `getMaxAge` confirm mature wheat/carrots/potatoes at **age 7**, beetroots at **age 3**. Query each actual block's properties rather than applying age 7 to every crop. Original paths: `data/minecraft/loot_table/blocks/{wheat,carrots,potatoes,beetroots}.json`.
- Wheat seeds plant wheat; carrots and ordinary potatoes serve as their own planting items. Preserve some planting stock/replant after harvest. Poisonous potatoes are a separate risky food item, not the ordinary potato used by the baking recipe. Use `recipe/bread` for wheat conversion and existing cooking knowledge for baked potatoes.

Sources: [original JAR](https://piston-data.mojang.com/v1/objects/30c73b1c5da787909b2f73340419fdf13b9def88/client.jar), [official mappings](https://piston-data.mojang.com/v1/objects/2244b6f072256667bcd9a73df124d6c58de77992/client.txt), classes `FarmBlock`, `CropBlock`, `BeetrootBlock`, and original loot/recipe JSON. The planting-item relationships are also explicitly handled by the core's [interaction probes](../../core/skills-interact.ts).

**Suggested farming advice:** secure immediate edible food first when hungry; choose a small reachable patch near existing water if bucket iron is unavailable. Hoe suitable ground, plant the correct item on actual farmland, provide useful light and safe access, reduce trampling, inspect maturity, harvest/collect and replant. Verify block **and inventory** changes; a use receipt is not proof of a crop, and a broken crop is not proof the drops were collected. Reserve seeds/crops and compare the real time/resources required against other accessible food sources.

## Actual source capabilities and limits

These are source-supported contracts, not a claim that a given deployment exposes them or that any strategy was executed. The inspected generic core has two distinct body paths. The current task's active Mineflayer context must not be diagnosed using optional Java-client compatibility gaps.

| Intent | Mineflayer/core source capability | Evidence still required |
| --- | --- | --- |
| Read guide/recipe | `mc_knowledge` search/get in [knowledge.ts](../../core/knowledge.ts); read-only | Exact version; current server rules/components/stock separately |
| Inspect surroundings/resources | `probe`/`observe`, `mc_bag`, current state and script `mc.state`; contracts in [skills.ts](../../core/skills.ts), [world.ts](../../core/world.ts), [method-api.ts](../../core/method-api.ts) | Loaded geometry, sample freshness, known threats; null is unknown |
| Craft bed/tools/chest | `craft {item,count}` or explicit grid; [skills-craft.ts](../../core/skills-craft.ts), [skills.ts](../../core/skills.ts) | Actual material/table availability and resulting inventory; no automatic intermediate-material chain |
| Place refuge/bed/chest | `build {material,anchors}` / `on` / blueprint; [skills-build.ts](../../core/skills-build.ts), [placement.ts](../../core/placement.ts) | Reach/support/body collision/permissions and placed states; beds occupy horizontal two-cell footprints |
| Sleep in a placed bed | `use {at:[x,y,z]}`; [skills-interact.ts](../../core/skills-interact.ts), `useProbeAt` around line 414, `waitForWake` around 595, `skillUse` around 1102 | `bot.isSleeping`, server feedback, wake and fresh time; no special `sleep` skill is needed |
| Stay asleep | `waitForWake` polls every 250 ms, up to 60 seconds; can wake on timeout/cancellation | Waking does not prove dawn. The current explosion note is advisory after interaction, not a preventive dimension guard |
| Wait inside shelter | Shared script allowlist includes awaited `bot.waitForTicks`; [method-capabilities.ts](../../core/method-capabilities.ts), [method-mineflayer.ts](../../core/method-mineflayer.ts) | A bounded actual wait plus fresh time/health/threat observations; no registered `wait_until_dawn` skill or automatic shelter certification |
| Equip | `equip {item}` infers armor slot; `hand:main/off` explicitly selects hand; [skills-craft.ts](../../core/skills-craft.ts), `skillEquip` around 509 | Real worn/held state, durability; crafting/carrying armor does not wear it, shield selection does not establish blocking |
| Store/retrieve/cook | `stow`, `take`, `smelt {input,count,fuel,at?}`; [skills-container.ts](../../core/skills-container.ts), [skills.ts](../../core/skills.ts) | Container access, fuel/start state, real output and inventory deltas; `smelt` starts work then returns, `take` collects output |
| Hoe/plant/harvest | `use {item:hoe,at}` / `use {item:seed_or_crop,at:farmland}`; probes read farmland/crop. Break using appropriate dig/excavate method, then collect/pickup | Observed soil/crop age, dropped/collected items, replant state; use on furnace only opens UI, not smelting |

`mc_do` admission is not terminal completion; script `await mc.do(...)` waits for the group's terminal but that terminal still does not prove the host's objective. Existing [method-api.ts](../../core/method-api.ts) explicitly separates these. A matching postcondition can predate an action: compare before/after when claiming a new change.

### Optional Java-client path, kept separate

[java-methods.ts](../../src/client/java-methods.ts) exposes shared JavaScript only when the actual bridge advertises the required `agent-mc-method/v1` methods. It supports observed blocks/inventory, `activateBlock`, held-item use, `waitForTicks(1..200)` counting actual game ticks, and hand equip with advertised inventory-pick support. Its compatibility page explicitly lacks `dig`, `placeBlock`, armor/offhand equip and broad `mc.do` skills; it has no high-level bed-sleep/crafting/furnace recipe executor. Check `await mc.capabilities()` before sharing a program between bodies.

[java-legacy.ts](../../src/client/java-legacy.ts) accepts one limited legacy step; targeted `use at`, multi-step crafting/building/armor routines are rejected, not simulated. Do not offer Mineflayer JSON as a universally executable Java-client procedure.

When explicitly configured, [java-client.ts](../../src/client/java-client.ts) offers `mc_interact` (actual target, attack/use, bounded hold, raycast/GUI checks) through the packaged [agent_mc.py](../../skills/java-client/agent_mc.py) helper. Targeting a bed this way is low-level interaction, not an implemented sleeping-until-dawn workflow. Planting should target support farmland and observe the crop cell above. [Java helper README](../../skills/java-client/README.md) documents `agent_mc.wait(0..5 seconds)`; explicit Python uses `time.sleep`, never a nonexistent `minescript.sleep`. Shared JS uses bounded `waitForTicks`, not ambient timers. All remain within program/lease budgets and release inputs.

Java `mc_wait {action_id,timeoutMs<=30000}` waits for the **original action terminal**; cancelling that wait does not cancel the body action. It is not a command to wait out a game night. Preserve the original action ID for unknown outcomes; verify fresh game facts after script/action completion. These Java limitations are source-only compatibility findings and do not establish which bridge is installed or any live failure cause.

## Actionable gaps for a later implementation

1. Add the six proposed advisory cards through the existing version-gated retrieval surface, with small bilingual summaries and per-card sources; extend discovery documentation without injecting the whole handbook into stable context. Preserve food/cooking tables and `mc_memory` separation.
2. Make bed/night guidance distinguish crafting, placement, spawn-setting, entering sleep, waking and actual dawn. Include unsafe dimensions, nearby-danger/obstruction feedback, multiplayer sleeping rules and `doDaylightCycle`; never recommend clicking an unknown-dimension bed as a test.
3. Express the no-bed alternative as safe enclosure **plus real bounded waiting and re-observation**. Avoid inventing a sleep/wait skill, a guaranteed dig-in macro, a safety classifier, or a ventilation requirement. Geometry and escape plans need current evidence.
4. Add equipment/base/storage/farming connective advice; reuse recipe/item/block IDs and existing action help rather than duplicate recipe tables or promise a full automatic supply chain. Expose prerequisite failures so the Agent can choose alternatives.
5. Keep executor-specific examples conditional. Mineflayer capabilities are already sufficient building blocks; Java primitive compatibility is partial. Source existence, a successful click, local syntax validation and a completed program must remain distinct from a survived night, usable house or renewed food supply.

Remaining source/acceptance gaps: exact clock-boundary recommendations and every special/modded hostile/shelter interaction were not exhaustively audited; server datapacks, protection, dimensions, gamerules, custom food and actual bridge availability were not queried. There is no live shelter, bed, equipment, chest or farm success evidence in this research. A later implementation should validate retrieval coverage and relevant edge cases; gameplay claims require separate actual-world evidence.

## Reproduction scope

Read-only checks used Python standard-library `zipfile`/JSON/hashlib for original JAR members and hashes, public HTTPS for official mappings, and local Java `javap -c -p` for the mapped 1.21.1 classes. Representative identities: `BedBlock=dfr`, `ServerPlayer=aqv`, `ServerLevel=aqu`, `SleepStatus=auu`, `Level=dcw`, `GameRules=dcs`, `FarmBlock=div`, `CropBlock=dht`, `BeetrootBlock=dft`, `ChestBlock=dhb`, `Entity=bsr`, `LivingEntity=btn`, `FallingBlock=diu`. No decompiled source, copyrighted asset payload, generated runtime artifact or new dependency is included. This Markdown file is the sole output.
