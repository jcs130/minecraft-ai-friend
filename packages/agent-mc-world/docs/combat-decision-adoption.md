# Fast combat decision adoption

Fast inference is an explicit host service. The core supplies executable candidates and current facts; it does not select a model, infer allies from proximity, or start a hidden model loop.

## Ranking and abstention

Candidate scores are a distribution over the supplied choices, not calibrated probabilities of winning a fight. Applying an implicit 0.75 floor to every multi-choice ranking prevented clear alternatives from being considered. The optional service now defaults to `minConfidence: 0` and `minMargin: 0.1`: the winner must lead the strongest alternative by at least 0.1. Ties abstain even when the configured margin is zero. An explicit `minConfidence` remains an additional probability floor, and stricter settings introduced during an in-flight request apply to its result.

For example, ranks `[0.45, 0.30, 0.20, 0.05]` have a clear lead; `[0.40, 0.39, 0.16, 0.05]` do not. This comparison grants no attack or movement permission. The current game candidate, entity identity, execution policy, task ownership, connection generation, tactic revision, age and physical conditions still have to pass before dispatch.

Every candidate retains its own intent in the inference criteria. Two different enemies, step directions, abilities or authored methods must not be replaced by identical descriptions. The complete candidate parameters remain available in `state.options`; UUIDs and source bindings stay local for execution checks.

## Relevant changes

`assessCombatDecisionScene` is a pure public comparison through `agent-mc-world/decisions`. It reports blocking `changed` categories and explicitly `tolerated` categories. Unknown identities are never matched by name or array position.

The visibility of an existing, unselected unknown bystander may change without granting it an ally relation. A non-target hostile that is not attacking the party may disappear, die or lose line of sight without invalidating another executable target. New relevant actors, newly visible threats, changed relations, attacks against the party, selected target loss/identity/sight changes, allies, omitted coverage, ownership and critical vital changes still require a fresh decision. Opaque authored methods retain strict actor comparisons because their dependencies are not declared by typed primitive parameters.

The host always applies the freshly recomputed candidate, not the old model projection. A comparison alone never proves that the candidate is executable.

## Observation, following and attack continuity

Default fast combat choices offer proactive engagement and withdrawal, rather than non-attacking enemy observation. They do not require a previous hit. Acquisition uses the native controller's actual bounded pursuit pool (the configured chase distance plus its existing four-block retention band), with fresh visibility, health, weapon policy, provocation and task checks. It no longer hides 6–10 block targets that the default controller can already pursue. This does not enlarge the native pursuit/exit radius or the automatic close-range self-defense trigger.

The executor now reports whether the exact current step is safely resumable, using the same check as suspend/resume. Native combat may pause that work, retain its progress and pending queue, then resume it. Unproven or non-repeatable steps, open containers, eating, environmental escape and scripts retain their ownership checks. Authored method options still require a free executor because they do not use the native combat suspension lifecycle. Once an engagement enters fighting, existing spell rules and fast spell choices become eligible without waiting for injury.

`track` remains an explicit authored action-pool primitive: it watches an observed hostile with a bounded distance lease and does not attack. Selecting it while fighting cancels the current attack controller. Its candidate intent states that transition, target type, distance and lease; `keep` states when it continues an attack, an observation lease or an explicit body follow task. The viewer calls the action “停火盯防”. An observed hostile remains hostile throughout this choice. Normal follow tasks retain their existing contract.

Rule `enemyTypes` compare entity registry IDs: a bare native `zombie` and `minecraft:zombie` refer to the same vanilla type. Explicit other namespaces remain distinct and unknown types do not match. Candidate construction and automatic rule evaluation use the same comparison. Authored rule text, identity, revisions, relation evidence, mana and cooldown checks remain intact.

When evaluating logs, count request candidates, model selections, validation results, accepted dispatches and world effects separately. A rejected tracking selection does not mean that the body followed that enemy. A short isolated replay checks the input contract; it does not establish improved combat outcomes.

`describeCombatDecision` is a pure public presentation helper from `agent-mc-world/decisions`. It uses the original request frame for attributed target relations and reads explicit application flags for dispatch. Missing application flags remain unknown; even `sent` alone is not promoted to an accepted dispatch. Display stages and acknowledgements are not effect or goal verification.

## Receipts and evaluation

A restored authored program that times out during cold worker startup now gets the same existing single delayed retry as a worker response timeout. The next evaluation reads a new sample at least one second later; the old output is never reused and execution budgets do not change. Syntax/contract failures do not retry, and a second timeout requires an authored revision. Source, parameters and author identity remain unchanged. This is lifecycle recovery, not a newly learned tactic or evidence of combat improvement.

Result metadata contains `validation.ranking`, tolerated changes and selected-candidate eligibility. `application.attempted`, `application.dispatched`, and `application.keptCurrent` distinguish a dispatch attempt, an accepted dispatch and no change to the existing controller. Legacy outcome `moved` means **the observation origin moved and the choice was rejected**; its application reason is `origin-moved`. It does not mean a successful movement.

`sent` still means accepted by the game port. Subsequent observation and original task/method terminal records are required to evaluate actual displacement, damage, resources and goal progress. Do not optimize an acceptance percentage by counting `keep`, a stale origin or saved code as a successful action or learned improvement.
