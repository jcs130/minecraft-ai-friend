# Agent MC World 0.5.0

Primary development/acceptance target is Minecraft Java 1.21.1. The public SDK
retains automatic version negotiation; explicit other versions remain available.

Added `mc_knowledge`, a local, model-free reference search/get tool exposed by
SDK and MCP, including before game connection with an exact configured version.
It covers complete registered item/block/food/crafting indexes and source-verified
1.21.1 food, cooking and natural-regeneration semantics. Results are bounded and
carry version/source attribution; current server facts and historical memory stay
distinct. No endpoint or embedding provider is selected implicitly.

Fixed routine eating choosing raw beef/pork/mutton despite carrying their cooked
counterparts because hunger-overflow penalties outweighed nutrition. Cooked stock
now takes precedence over its raw ingredient. Safe raw food and the existing
low-hunger emergency fallback remain available. Explicit requests retain their
selected item and receive a soft cooked-stock advisory.

Food-reserve facts include baseline hunger/saturation and cooking gains, preserve
unknown inventory state and exclude non-nutritive ominous bottles from ration
totals/automatic selection. Rotten flesh and raw chicken show their default
Hunger-effect risk. This is a policy/reference correction, not proof of long-run
survival or a new server-side recipe.
