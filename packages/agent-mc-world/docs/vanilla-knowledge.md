# Versioned vanilla knowledge

Java **1.21.1** is the primary optimization and acceptance target. SDK `version:auto`
remains available for other servers. References always use the actual connected
version, or an explicitly configured exact version while disconnected; unknown
versions never silently become 1.21.1.

`mc_knowledge` is a core-owned, read-only reference tool. It makes no model,
embedding or network request, opens no game connection and changes no body task.
Any host can use the SDK/MCP tool; no Neko or Cortico dependency is involved.

```json
{"action":"search","query":"生肉 熟肉","limit":3}
{"action":"get","id":"food/beef"}
{"action":"get","id":"guide/health"}
{"action":"get","id":"guide/cooking"}
{"action":"search","kind":"guide","query":"没床 庇护"}
{"action":"get","id":"guide/bed"}
{"action":"search","kind":"block","query":"diamond_ore","limit":2}
{"action":"get","id":"recipe/stick","offset":4}
```

Search returns at most 10 summaries. Read one returned ID for full bounded details.
If `action` is omitted, an `id` infers get, query/filter/paging fields infer search,
and empty arguments return help. Explicit conflicting fields are still rejected.
Item, food and block indexes cover every entry in the installed exact-version
`minecraft-data@3.112.0` registry; crafting references cover all its recipe result
IDs, with four variants per page. Missing crafting data does **not** imply that
an item has no furnace, special or server recipe. Data is baseline reference, not
current inventory, server permissions, a guaranteed drop or a successful action.
Server datapacks and item components can override vanilla behavior.

For 1.21.1 the semantic layer additionally covers all 41 registered food entries,
their default effects/special behaviors, nine cooking conversions and natural
regeneration. Recipe search/get also includes these cooking outputs and charcoal,
with explicit smelting/smoking/campfire types; dried kelp retains both its crafting
conversion and its cooking recipes. Other versions expose their numeric registry references with
`semanticCoverage:unavailable`; the verified 1.21.1 mechanics are not silently
applied to another version. See the [primary-source research](research/vanilla-1.21.1-food-knowledge.md).

Raw beef restores 3 hunger/1.8 saturation; steak restores 8/12.8. These are points,
not hearts or drumstick icons. Food usually supports natural regeneration through
hunger and saturation rather than directly healing. Raw chicken/rotten flesh have
default Hunger-effect risks; an ominous bottle is not nutritive despite appearing
in the upstream food registry. Unknown stew components remain unknown.

Routine eating prefers a carried cooked counterpart rather than wasting its raw
ingredient to minimize hunger overflow. Safe raw food remains usable without a
furnace; the existing low-hunger emergency fallback remains available. Explicit
eat requests keep the requested item and receive an advisory when cooked food is
already carried. No hidden cooking task or automatic substitution is started.

## Reference retrieval and historical memory

`mc_knowledge` retrieves immutable versioned references locally. `mc_memory`
continues to store attributed game experience with server/account/agent isolation,
local keywords and explicitly configured vector/remote providers. Vanilla data
is not silently copied into a player's notebook or sent to an embedding service.
The same planner can query either as needed and recheck current observations.

Keep only discovery instructions in the stable request prefix. Put current facts
at the tail, replacing old keys; fetched references remain in bounded tool history.
Do not append the whole catalogue or duplicate a retrieved manual every turn.
No vector endpoint or model is required to use the bundled knowledge.

Since rc.88 an explicitly prepared [MineDojo external index](minedojo-knowledge.md)
can be queried through the same tool with `source:minedojo`. It stays separate
from vanilla references and personal memory; no corpus is bundled or downloaded
on install. The earlier [source/data audit and offline retrieval pilot](research/minedojo-knowledge-20261020.md)
retain the actual formats, license, capture dates and unverified version coverage.

## Optional survival cards (Java 1.21.1 only)

| ID | Discoverable topics |
| --- | --- |
| `guide/bed` | 床、羊毛、睡觉、跳夜、重生点 / bed wool sleep night spawn |
| `guide/night_shelter` | 没床、临时庇护、挖洞、等天亮 / no bed shelter hide wait dawn |
| `guide/equipment` | 武器、防具、工具、剑斧盾镐 / equipment armor weapon tools |
| `guide/base` | 房子、家、基地、营地、工作台炉子 / house home base camp |
| `guide/storage` | 箱子、收纳、背包存取 / chest storage inventory stow take |
| `guide/farming` | 食物来源、耕地、种子、补种 / farming crops seeds renewable food |

These six original Chinese references have bilingual titles and short summaries,
bounded content (at most 3500 UTF-8 bytes each), and their own first-party citations
with a 1.21.1 applicability version. The [survival research](research/vanilla-1.21.1-survival-foundations-20261016.md)
records the original Mojang client/mappings hashes and exact recipe, dimension,
crop and collision evidence. Introductory Minecraft.net examples are advisory;
exact mechanics use the pinned original inputs. Existing food/health/cooking
cards and numeric registry/recipe references remain available separately.

Priorities are conditional on fresh body, hunger, time, threats, resources and
user interests. Reading a card never chooses, queues or certifies an activity.
Mineflayer already supports bed-targeted `use {at}` and bounded waiting for wake;
no new sleep tool is introduced. Crafting, placement, spawn-setting, entering
sleep, waking and actually skipping night require distinct observations.
Nether/End beds explode; unknown dimension behavior must be resolved before use.
The optional Java-client helper has different advertised method capabilities;
its limits do not describe the active Mineflayer body.

A shelter needs observed clearance, support, enclosure, access and danger checks.
Waiting requires actual elapsed game time and new observations, not an action
terminal or a short delay labelled morning. Crops similarly require observed
growth, collected inventory and replanting; planting does not feed immediately.
Server/datapack overrides and current executor support still require inspection.
These cards are not added to the stable environment prefix or personal memory,
and are unavailable for unverified game versions.
