# Model-organized scene guidance

`mc_memory {action:"scene",operation:"help"}` exposes `agent-mc-scenes/v1` through the same SDK, MCP and World tool. Tool metadata declares `sceneKnowledge.protocol`; hosts need not identify a tool by a Minecraft-specific name.

The caller reads current server documentation and native receipts, then chooses scene labels, applicable conditions, methods, counterexamples and observable verification criteria. The core does not map named spells to scenes or call a model. A capability can belong to several scenes. Do not treat a passive talent as a castable skill.

`upsert` stores an attributed method in the existing realm/account/agent notebook. Updating a card requires its ID and expected revision. Identical writes are reused; old revisions remain readable. `list`, `recall`, `get` and `archive` provide progressive discovery and explicit retirement. Dated source references and excerpts are required, but their authenticity is not established by storage: `referencesVerified`, `currentWorldVerified` and `benefitVerified` remain false.

`recall` accepts current task terms and a character budget. It returns only matching cards; an oversized original is replaced by its ID, revision and short applicability summary, with `detailOmitted:true`. Read the original with `get`. A host should project these results only into the relevant task request, replace the projection on a resumed slice, and omit it from ordinary conversation history. A miss is not proof that the capability is unavailable.

For repeated failures, compare alternatives with the existing `experience/policy_help`, `rank` and `feedback` contracts. Preserve original task IDs, native terminal outcomes and net changes; reconcile unknown outcomes before replaying anything. Edit scripts/tactics through declared learning interfaces, validate and compare with Harness² where a scenario is supported, then verify actual adoption. A saved card or successful test alone does not establish better gameplay or weight training.

## Minimal flow

1. Read `scene/help` and current server capability descriptions.
2. Let the host model propose a card with `title`, `scenes`, `when`, `guidance`, `verify`, `counterexamples`, `author` and dated `sources`.
3. Save with `scene/upsert`; retain the returned ID and revision.
4. Recall by the next task's terms, check current prerequisites, and choose an executable method.
5. Link actual execution evidence to ranking feedback; revise or archive the card when contradicted.

Cards use existing game-memory persistence and isolation. Personal relationship memory, speech playback and other Worlds are not imported into this library. The optional remote memory service is not required to read or update this local notebook.
