# Recorded scene practice

The Mineflayer backend can capture current loaded geometry without moving the body:

```json
{"scene":{"op":"capture","id":"stair-approach","target":[4.5,65,0.5],"radius":8}}
```

This is a branch of `mc_script`. `scene:{"op":"list"}` returns a bounded index; `scene:{"op":"read","id":"stair-approach"}` expands one immutable recording. Captures require an authenticated play connection and persistent data directory. Records are isolated by realm/account/agent. Unknown cells stay unknown. The Java bridge does not expose this capture branch until it supplies equivalent block-state evidence.

`RecordedScene`, `RecordedSceneStore`, `recordedCase`, `reconstructRecordedScene` and `createPhysicsMethodPractice` are exported from `agent-mc-world/learning`. The replay restores exact Java 1.21.1 block states/collision shapes, starting pose and velocity. Each trial resets these inputs and runs the candidate with real Prismarine collision physics. It does not replay the historical player's positions as the candidate's output. Optional ordered external block updates can be supplied with tick, position, block state and source; live capture currently records a snapshot, not an automatic event subscription.

Choose recorded training and held-out cases with `mc_practice start.caseIds`. `cases` discovers available captures; `help` states the mounted environment's capabilities. Omitting `caseIds` explicitly uses the built-in flat-ground fixtures. Renaming a recording or changing its timestamp does not make it independent. Original case hashes, source revision, trial SDK calls, before/after observations and eligibility are retained in the job journal. Baseline and candidate use identical inputs and budgets.

This adapter measures local collision traversal, including steps, ceilings and water physics. It does not model health damage, oxygen depletion, enchantments, item changes, enemy decisions or Paper plugin rules. Health is fixed in these trials. Unknown geometry or a mismatched block registry aborts instead of inventing air. Effects and elytra captures are rejected because this adapter cannot restore them faithfully. Successful traversal is not evidence of survival, combat victory or server-side skill effects. Use a matching simulator for those outcomes, or replay recorded protocol events only to check the client's handling logic.

Syntax validation has its own slot and never clears an active body's controls. Background `learningCall` metadata permits editing/versioning and isolated trials; it does not grant live execution. Practice admission and completion share an `execution` identity with `goalCompleted:false`. Staging saves a candidate, without adoption or live action. Natural execution, measured world change, review and adoption remain explicit subsequent steps.
