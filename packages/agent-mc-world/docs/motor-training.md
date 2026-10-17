# `src/motor` and `training/runner.py`: local motor training

The opt-in `agent-mc-world/motor` export provides a local voxel observation encoder and a portable MLP evaluator. Importing it starts no model, client, timer or body action. `agent-mc-world/motor/simulator` exposes the offline fixture separately. Existing navigation, reflexes, host configuration and personal memory are unchanged.

The first experiment learns **motor following**, using a shared known-map A* route followed by either a physics-lookahead teacher or a learned policy. It does not learn global route planning. The fixture uses `prismarine-physics@1.11.1` and Minecraft 1.21.1 block data. Its six scenarios are walking, a one-block step, detouring around a wall, a one-block gap, following a moving point and replanning after an obstacle appears. These are generated offline physics scenarios, not runs of a real Minecraft client or server. Damage, entities, networking, GUI tasks, spells and arbitrary modded physics are outside this acceptance scope.

Physics advances at 20 ticks/s. The policy chooses among fifteen turn/walk/jump/sprint combinations every two ticks (10 Hz); simulated time is not wall time. Inputs contain a 7×5×7 local voxel grid, position fractions, velocity, grounded state, heading and the current route waypoint. Missing native cells remain unknown. A native-frame adapter only projects existing observations; it does not claim a body or bypass the existing action dispatcher.

## Reproduce

Use Node 22+ and the package's locked dependencies. Create a Python 3.13 environment and install `training/requirements.txt`; the first run uses CPU PyTorch. Run from this package directory:

```sh
python training/runner.py collect --episodes 48 --seed 1200 --split train --output training/runs/example/train.mcap
python training/runner.py train --datasets training/runs/example/train.mcap --epochs 80 --output training/runs/example/policy.json
python training/runner.py evaluate --policy training/runs/example/policy.json --episodes 8 --seed 2000 --output training/runs/example/validation.json
python training/runner.py replay --dataset training/runs/example/train.mcap --episodes 6 --output training/runs/example/replay.json
```

`--node <executable>` selects Node for collect/evaluate/replay. Dataset aggregation collects the student's visited states with expert labels and explicit interventions:

```sh
python training/runner.py collect --policy training/runs/example/policy.json --teacher-probability 0.2 --seed 1400 --episodes 32 --split train --output training/runs/example/aggregation.mcap
python training/runner.py train --datasets training/runs/example/train.mcap training/runs/example/aggregation.mcap --resume training/runs/example/policy.json --epochs 50 --output training/runs/example/policy-2.json
```

Training rejects archives labelled validation/test and verifies their SHA-256. Allocate non-overlapping scenario seeds to training, validation and final testing. Tune against validation only; use a reserved test range after freezing the candidate. Episode and policy identities, source hashes, teacher interventions, failures and measured outcomes remain in the experiment outputs. Training accuracy is not a closed-loop success rate. A teacher intervention is not a student action and must not be counted as independent student success.

## Trajectories

MCAP contains FlatBuffers messages with the embedded binary reflection schema (`motor.bfbs`), Zstandard chunks and CRCs. `/motor/observation_action` stores the actual pre-action inputs, chosen action, expert label, post-action inputs, reward and measured terminal outcome. `/motor/environment_truth` separately stores the generated map and its changes. The training loader reads only the former and rejects world-truth fields in that channel. Unknown labels use -1; success remains null until an episode terminates. MCAP timestamps use Unix wall-clock nanoseconds; `simTimeNs` carries simulation time separately.

The schema is `training/schema/motor.fbs`; regenerate Python bindings and `.bfbs` with FlatBuffers 25.9.23:

```sh
flatc --python --gen-object-api -o training/generated training/schema/motor.fbs
flatc --binary --schema -o training/schema training/schema/motor.fbs
```

Archives, environments, compiler binaries and learned weights stay under ignored `training/runs`, `.venv` and `.tools`. Records contain game state and actions only, without chat, prompts, replies or credentials. Dataset/model hashes and episode IDs can be linked from the host's existing game-learning evidence; no personal memory is overwritten and recording does not promote a skill.

## Evaluation and adoption

Evaluate the raw learned policy and the physics teacher on the same reserved task/seed pairs, with no teacher interventions during evaluation. Report each task's completion rate, simulated duration, stationary time, collisions and falls. Preserve unsuccessful episodes. `replay` verifies CRCs and reconstructs selected episodes from their exact seed and action sequence, comparing observed features and outcomes.

Exported policy JSON contains validated layer dimensions, finite weights, feature/action identifiers, training metadata and `deploymentApproved: false`. The SDK evaluator can consume these weights without Python. A candidate does not automatically replace navigation or acquire live control. Actual Minecraft 1.21.1 acceptance, cancellation/ownership handoff and environmental hazards must be verified before explicit adoption through the existing core dispatcher. An offline pass is not production validation.

The first completed experiment is recorded in [`training/results/motor-20261017.json`](../training/results/motor-20261017.json). The frozen candidate completed 185/192 reserved physics scenarios with zero expert interventions; the physics teacher completed 192/192. Six gap crossings failed and one dynamic-obstacle episode timed out. Training, validation and test seeds are separate. These results cover basic motor following in generated maps, not real-server play or high-level intelligence.

`verify-policy` compares the exported Node evaluator with CPU PyTorch on sampled recorded observations and measures only local network inference, excluding observation, IPC, physics and server delay:

```sh
python training/runner.py verify-policy --policy training/runs/example/policy.json --dataset training/runs/example/train.mcap --output training/runs/example/parity.json
```

Implementation references: [Prismarine physics](https://github.com/PrismarineJS/prismarine-physics), [pathfinder physics lookahead](https://github.com/PrismarineJS/mineflayer-pathfinder/blob/master/lib/physics.js), [MCAP encoding registry](https://mcap.dev/spec/registry), [FlatBuffers reflection schemas](https://flatbuffers.dev/intermediate_representation/).
