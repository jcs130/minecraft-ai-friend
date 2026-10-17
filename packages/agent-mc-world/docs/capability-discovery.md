# Discover methods by intended outcome

`mc_options` and `WorldRequestFacts.options` expose `minecraft-options/v1` through
the same core used by SDK, MCP and host adapters. Importing or reading them starts
no model, world scan, movement, spell or method. The current implementation samples
Mineflayer's existing cheap snapshot; it does not claim Java client parity.

Use `intent: food | travel | water | inventory | explore | method` for a bounded
shortlist. Empty arguments return the small index. Each entry contains its purpose,
implementation support, observed evidence, missing checks and focused read-tool
arguments. Support is distinct from eligibility. In particular, horse mounting is
implemented but horse/donkey/mule driving is not; the travel card says so.

The `options` current-fact part is at most 1400 characters, located near the sample
header so bounded background summaries can retain it. It is replaced by key at the
request tail, never appended to the stable prefix. Hunger/portable food, immersion,
running travel and full carried inventory select relevant index entries only. These
conditions are relevance hints, not rescue thresholds, mandatory preparations or
automatic action rules. Actual body work and priorities remain unchanged.

No registry means food classification is unknown. Unsynchronized inventory means
stock/space is unknown. No reported nearby boat is not a search of the whole world.
Route clearance, shore exits, recipes overridden by a server, ownership, taming,
mana and cooldowns require actual observations. Calling `mc_options` does not turn
any missing condition into `ready:true` for a fast selector.

An explicitly enabled server pack may append `MinecraftOption` observations with
`extendMinecraftOptions`. They cannot override generic implementation support. Space
is reserved per intent (up to four additions each); unrelated catalogue size must
not hide all food choices. Historical effects retain their source and observation
time. An adapter maps tool namespaces and reuses `readMinecraftOptions` for the
combined list. Do not embed account, persona, credentials or server rules in core.

Method entries point to a bounded library lookup and evidence retrieval, not to
source injection into every prompt. After retrieving a matching version, the Agent
still chooses whether to validate, run, revise or reuse it. Saving a method, a
syntactic validation, recording a trajectory or a model's proposed choice does not
prove learning or a better world result. Main-agent reasoning, optional fast choice
and combat method registration remain explicit host decisions.
