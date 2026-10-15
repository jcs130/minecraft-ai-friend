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
{"action":"search","kind":"block","query":"diamond_ore","limit":2}
{"action":"get","id":"recipe/stick","offset":4}
```

Search returns at most 10 summaries. Read one returned ID for full bounded details.
Item, food and block indexes cover every entry in the installed exact-version
`minecraft-data@3.112.0` registry; crafting references cover all its recipe result
IDs, with four variants per page. Missing crafting data does **not** imply that
an item has no furnace, special or server recipe. Data is baseline reference, not
current inventory, server permissions, a guaranteed drop or a successful action.
Server datapacks and item components can override vanilla behavior.

For 1.21.1 the semantic layer additionally covers all 41 registered food entries,
their default effects/special behaviors, nine cooking conversions and natural
regeneration. Other versions expose their numeric registry references with
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
