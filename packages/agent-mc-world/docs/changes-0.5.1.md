# Agent MC World 0.5.1

Live acceptance of 0.5.0 found a read-only query with `query/kind/limit` but no
`action`. The optional action defaulted to help and rejected otherwise meaningful
search fields. The tool now infers search/get from their fields; empty arguments
still return help, and explicitly conflicting action fields remain rejected.

Recipe search/get now includes the verified Java 1.21.1 cooking conversions and
charcoal, with their actual smelting/smoking/campfire types. Previously these were
only discoverable through the cooking guide and food entries, so a recipe-filtered
search missed useful production knowledge. Dried kelp keeps its separate crafting
conversion as well as its three cooking recipes. These are reference reads, never
an automatic cooking task or a claim that the server accepted a recipe.
