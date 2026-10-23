# 0.5.4: retrieve the actual named object

Live query `egg food cook` previously ranked generic cooked-food records ahead of `item/egg`: every occurrence of `food` and `cook` contributed equally to the queried object. Whole native IDs, compound phrases and exact Chinese names now outrank generic category words. Paging remains deterministic and the complete versioned catalogue is retained; no item allowlist, external model, vector service or network is required.

Non-food item search summaries explicitly say they cannot be eaten directly, so a caller does not need to open every detail page to learn that an egg is not a ration. When synchronized inventory contains no edible food, that actual absence is the first food-reserve fact; unknown inventories and risky-but-edible chicken remain distinct.

This builds on 0.5.3 native admission feedback and preserves the same host-neutral boundaries and Java 1.21.1 primary target. Search results remain baseline reference data, not proof of current stock, permissions or modified server recipes. Real autonomous survival is accepted separately.
