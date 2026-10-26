# Decisions during a journey

Long navigation keeps its body task while the host considers new evidence. Journey observations identify their original task, step, destination, sampling time and visible clues. A villager, sign or landmark is not proof of village boundaries, a new settlement or a reachable entrance. Bounded notification novelty is not a persistent record of unexplored places; use scoped game notes and host memory when deciding whether to visit.

`mc_choose` with `category:"route"` compares the Agent's evidenced candidates through the explicitly configured host decision service. It starts no background model loop and executes no movement. Fresh request facts include the current journey observation. Older observations are labeled historical; inspect again before relying on them as nearby evidence.

During a resumable `goto`, route advice uses the producing core's typed task, connection, body ownership and safety evidence. Ordinary movement may survive the model response delay. The horizontal tolerance in blocks is:

`min(choiceMaxBlocks, choiceMinBlocks + measuredSpeedBlocksPerSecond * decisionElapsedSeconds)`

Defaults are `journey.choiceMinBlocks:10`, `journey.choiceMaxBlocks:20`, and `journey.dangerChoiceMaxBlocks:5`. An observed risk further caps the tolerance at `dangerChoiceMaxBlocks`. At 4.3 blocks/second and one second of decision time, the normal tolerance is 14.3 blocks; at 5.6 blocks/second and 1.5 seconds, it is 18.4 blocks. The values are hot configuration fields, not an enemy engagement radius. Nearby players are not automatically enemies.

The short advice lifetime, separate vertical limit, task/step/queue identity, connection generation, server position corrections, injury, combat, environmental ownership and actual scene changes still invalidate advice. Missing producer evidence uses conservative expiry. These tolerances establish neither a safe route nor permission to move.

After choosing a short visit, submit bounded actions using `mc_do` with `queue:"afterCheckpoint"`. The executor yields the running route only on safe footing, waits for its movement cleanup, runs the inserted task, then resumes the original task ID and destination. Combat, environmental rescue, unsafe footing, open containers and transactions retain their ownership boundaries. Do not run an independent movement script against the same body or recreate the journey with `stop`/`now` merely to inspect a landmark.

Read-only `mc_query`, host reasoning and speech can overlap navigation. Mutating server commands remain ordered actions. Task acceptance, a decision suggestion and a completed movement each have different meanings; none alone proves exploration or the original goal completed.
