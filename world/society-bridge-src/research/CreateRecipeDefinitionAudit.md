# Loaded Create processing recipe definitions

Source: `create-1.21.1-6.0.10.jar`, SHA-256
`ef87fe5709f1ba1f5b8bb20a2925b5afb4669e178fd6d8bf10c167759eefe37a`.
The NeoForge API is 21.1.248. Resources, generated classes and wire captures stay
in the private lab, outside Git. This is definition coverage, not acceptance of
automatic machine operation or all Create gameplay.

`PlayerRecipeCatalog` reads the loaded server recipe manager. Exact original
`MillingRecipe`, `CrushingRecipe`, `CuttingRecipe`, `PressingRecipe`,
`FillingRecipe` and `EmptyingRecipe` classes are supported when their registered
type/serializer match, item predicates are simple and all bounded inputs/results
can be represented. Subclasses, basin mixing/compacting, sequenced assembly,
dynamic handlers and unknown component predicates remain explicitly unavailable.
Conditional JAR recipes do not establish that a recipe was loaded by the server.

The locked `ProcessingRecipe` getters supply item ingredients, sized fluid
ingredients, every `ProcessingOutput`, fluid results, base duration and heat.
Its `getResultItem()` returns only the first display output. Create rows therefore
use `processing.rollableResults`, matching the Farmer's Delight result field
shape, and omit the ambiguous single `output`. `outputId` queries search all
declared Create item outputs, including probabilistic byproducts. This is an item
output filter; it does not search fluid IDs or sample results.
The query reports that other recipe classes retain their display-result filter;
this is not a claim of complete output discovery for unknown dynamic recipes.

Every simple item Ingredient occurrence consumes one item. Tag expansions remain
alternatives; their example stack counts are not multiplied into the input
quantity. The ingredient codec is retained. Sized fluid inputs retain their
native codec, exact amount in mB and bounded alternatives. Fluid stacks retain
native `FluidStack.CODEC` JSON and SNBT so component patches survive projection.
Non-simple fluid predicates, such as the potion-components predicate in
`create:filling/glowstone`, keep `definitionAvailable:false` rather than being
converted to a bare fluid ID.

`ProcessingOutput.rollOutput` tests each item in the defined stack independently
with `nextFloat() <= chance` when chance is below 1. Exported counts and
`baseChancePerItem` are definitions, not observed drops. The catalog never calls
`rollResults`, `rollOutput`, `enforceNextResult` or the world's random source.
For milling/crushing/cutting, `processingDurationTicks` is recipe base work;
machine speed, batch size and actual operation can change elapsed time. The
duration field does not affect pressing/filling/emptying and is labelled as such.

Accepted Create rows have `definitionAvailable:true`, `executionAvailable:false`
and explicit false flags for sampled results, dynamic handlers, recipe-selection
priority, machine execution and fluid handling. Existing generic player actions
still require their own actual receipts and world postconditions. Discovering a
fluid definition does not imply that the Agent can operate pipes or automate it.
The 64-alternative, 8 KiB definition and 15 KiB query-page limits remain enforced.

The locked `create:milling/wheat` resource declares one `minecraft:wheat`
occurrence, base duration 150, and three output entries in this order:

| Item | Defined count | Base chance per item |
| --- | --- | --- |
| `create:wheat_flour` | 1 | 1 |
| `create:wheat_flour` | 2 | 0.25 |
| `minecraft:wheat_seeds` | 1 | 0.25 |

`tools/test_player_recipe_catalog.py` audits the actual JAR resources and compiles
the production catalog against actual MC/NeoForge/Create/Ponder/FD APIs. It
inspects compiled calls to verify that the projection cannot sample a result.
Set `MAW_RECIPE_AUDIT_ROOT` to the private lab root and run the test with Python.
No classpath change to `build_society_bridge.py` is required. Set
`MAW_RECIPE_CAPTURE` to an owner-captured recipe-query JSON to additionally compare
exported definitions with every source result, quantity, chance and fluid field.
The optional capture test is not runtime evidence until a real capture is supplied.
