# Fire routes and combat program evaluation

`mc_scout` / `mc_do` expose `cross_fire`. A script can use the same step through
`mc.do`. First compare `dryRun:true`, optional absolute foot position `at` within
four blocks, and `mode:auto|walk|jump`. The returned alternatives show estimated
damage, time and a combined cost. `maxDamage` and `reserveHealth` let the caller
choose a loss budget; ordinary long-distance pathfinding still avoids fire.

Candidates use the installed Prismarine collision physics against received
blocks. They need a supported clear landing; unknown blocks, lava and unrelated
hazards do not become air. Damage is an unarmoured vanilla heuristic including
residual burning, not a server guarantee or a claim that a jump avoids all fire.
Actual losses and terrain changes are checked during execution. Completion
means arrival at the predicted landing, not survival of a later fight.

One body controller owns the action. Only its bounded, verified fire crossing
temporarily yields the ordinary fire-contact reflex. Cancellation, teleport,
death, scene changes and a depleted loss budget release that ownership. Emergency
fire contact compares local walk/jump exits; a blocked reflex releases controls
and its queue hold instead of repeatedly pushing a wall. It reports unresolved
danger and the conditions for another attempt.

Combat program learning uses `mc_combat_tactic`:

1. Read `history:true`, a specific `version`, and `samples:true` to locate the
   actual policy revision and pre-program battlefield samples.
2. Submit `probe:{program:{...},samples:[...]}` to compare baseline and candidate
   menus against the same recorded facts. This does not alter the live policy,
   choose actions with a model, simulate a whole fight or prove better outcomes.
3. Adopt a tested candidate through the normal execution scope with
   `expectedRevision`. The revision check also runs after asynchronous syntax
   validation. Saving code cannot replace another newly adopted policy.
4. Match subsequent combat receipts' start/end revisions and policy hashes with
   actual actions, health/resource changes and objective results. A mid-fight
   policy change is explicit. Keep failures; retrieve and evaluate the method
   in a later comparable situation before claiming learning.

Automatic spell rules, target choice, weapon selection and candidate programs
are separate controls. An empty melee preference list does not prohibit melee;
a higher healing threshold means healing earlier, not later. A program that
filters every attack away can cause inactivity despite producing valid code.

Related primary sources: [Mineflayer Pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder),
[Prismarine Physics](https://github.com/PrismarineJS/prismarine-physics),
[Harness2](https://github.com/google-research/harness2).
