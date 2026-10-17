# Motor learning: expert demonstrations, independent targets and PPO

The opt-in `agent-mc-world/motor` export provides a local voxel observation encoder and a portable MLP evaluator. Importing it starts no model, client, timer or body action. `agent-mc-world/motor/simulator` exposes the offline fixture separately. Existing navigation, reflexes, host configuration and personal memory are unchanged.

The default student input now contains the **final target**, not A* waypoints. Expert collection may call the existing route planner and physics lookahead to label actions, while keeping its privileged route outside the recorded student features. Reinforcement learning and raw evaluation never request expert labels; their `teacherRouteCalls` and interventions must remain zero. The route planner is a demonstration policy, not an infallible environment truth source. Reaching a target, colliding, falling and server position evidence determine outcomes.

The offline fixture uses `prismarine-physics@1.11.1` and Minecraft 1.21.1 block data. Its six scenarios are walking, a one-block step, detouring around a wall, a one-block gap, following a moving point and reacting to an obstacle appearing. `agent-mc-world/motor/minecraft` additionally exposes an explicit owned localhost Java 1.21.1 training server with a Mineflayer client. It never attaches to a running Agent, production server, account or save. GUI tasks, combat, spells and arbitrary modded physics are outside this experiment.

Physics uses a nominal 20 ticks/s. The policy chooses among fifteen turn/walk/jump/sprint combinations every two client physics ticks; simulated time is not wall time. Inputs contain a 7×5×7 local voxel grid, position fractions, velocity, grounded state, heading and final target. No path, expert cost, complete map, server position query or action fallback is supplied to the student. Missing native/client cells remain unknown. A native-frame adapter only projects existing observations; it does not claim a body or bypass the existing action dispatcher.

`goalMode` is part of policy/data semantics. New policies declare `final-target` and reject waypoint observations. Historical models without this field mean `teacher-waypoint`; the runner refuses to evaluate them in a final-target environment. The old 185/192 result belongs to a route-following experiment and must not be compared as though it were independent navigation.

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

Training rejects archives labelled validation/test, verifies their SHA-256 and rejects mixed goal semantics. Allocate non-overlapping scenario seeds to training, validation and final testing. Tune against validation only; use a reserved test range after freezing the candidate. Episode and policy identities, source hashes, teacher interventions, failures and measured outcomes remain in the experiment outputs. Training accuracy is not a closed-loop success rate. A teacher intervention is not a student action and must not be counted as independent student success.

## Reinforcement learning

`training/gym_env.py` implements the Gymnasium reset/step interface over the same worker. `training/ppo.py` performs categorical PPO after behavioural cloning: clipped policy objective, value loss, entropy regularization, GAE, finite-loss checks, gradient clipping and a KL stop. Time limits bootstrap the value estimate without carrying advantages into the next episode. Actor weights retain the same portable JSON format and Node inference path. Each run starts a fresh critic/optimizer; it does not pretend to resume optimizer state.

```sh
python training/ppo.py --policy training/runs/example/policy.json --steps 8192 --seed-start 8000 --seed-count 128 --trajectory training/runs/example/ppo.mcap --output training/runs/example/ppo.json
python training/runner.py evaluate --policy training/runs/example/ppo.json --episodes 32 --seed 7000 --output training/runs/example/test.json
```

PPO samples and executes the student's own actions; it calls no expert and adds no hidden shield or A* fallback. Its MCAP stores the policy proposal, executed action, reward, termination/truncation and actual observations. Stochastic training outcomes and incomplete final episodes are reported separately from deterministic held-out evaluation. Parent policy hashes, trajectory hashes and the union of training seeds carry forward through fine-tuning.

## Actual Minecraft simulation

Provide an explicit local JSON environment configuration (keep machine paths outside source control):

```json
{
  "backend": "minecraft",
  "goalMode": "final-target",
  "minecraft": {
    "java": "<Java 21 executable>",
    "serverJar": "<Minecraft 1.21.1 server jar>",
    "acceptedEulaFile": "<existing file containing eula=true>",
    "directory": "<new empty dedicated training directory>"
  }
}
```

The backend requires an already accepted Minecraft EULA, creates its own ownership marker and exclusive process lock, binds only to `127.0.0.1` on a temporary port and uses the test account `MotorTrain`. It refuses an existing non-training directory and a server version other than 1.21.1. It starts no external inference and uses no production credentials. Cleanup releases keys, disconnects the test client and stops only its own server; a stale lock after a hard process kill requires operator inspection before removal.

```sh
python training/runner.py collect --environment training/runs/example/minecraft.json --episodes 1 --seed 5200 --split train --output training/runs/example/minecraft-teacher.mcap
python training/ppo.py --environment training/runs/example/minecraft.json --policy training/runs/example/ppo.json --steps 512 --horizon 128 --seed-start 8200 --seed-count 32 --trajectory training/runs/example/minecraft-ppo.mcap --output training/runs/example/minecraft-ppo.json
python training/runner.py evaluate --environment training/runs/example/minecraft.json --policy training/runs/example/minecraft-ppo.json --episodes 2 --seed 7200 --output training/runs/example/minecraft-test.json
```

The expert uses `mineflayer-pathfinder.getPathTo` plus the shared physics action scorer. A raw student does not load the pathfinder plugin. Only the dedicated test client's keys and heading are dispatched. Client physics pauses between bounded two-tick actions, observations and optimization; the server continues at wall time. This is actual Minecraft networking and server acceptance with Mineflayer physics, not native Java client parity, faster-than-real-time server training or a production play test. World geometry is server-constructed and read back through loaded client chunks; this is not an independent omniscient server block snapshot. Server player positions are queried separately, and a successful new-backend episode requires server-confirmed goal proximity. Position corrections reject success.

Exact `replay` is deliberately offline-only. Minecraft MCAP can be inspected and rerun statistically, but server/network timing cannot be advertised as a deterministic byte-identical replay. The `liveValidated: false` candidate flag remains conservative: no production adoption or continuous gameplay acceptance has occurred.

## Trajectories

MCAP contains FlatBuffers messages with the embedded binary reflection schema (`motor.bfbs`), Zstandard chunks and CRCs. `/motor/observation_action` stores the actual pre-action inputs, chosen action, expert label, post-action inputs, reward and measured terminal outcome. `/motor/environment_truth` separately stores the scene map and changes, target motion and available server position evidence. The training loader reads only the former and rejects map/server-truth fields in that channel. Unknown labels use -1; success remains null until an episode terminates. New episodes have unique instance IDs, including repeated task/seed pairs. MCAP timestamps use Unix wall-clock nanoseconds; `simTimeNs` carries nominal client/offline physics time separately, not the server's game clock.

The schema is `training/schema/motor.fbs`; regenerate Python bindings and `.bfbs` with FlatBuffers 25.9.23:

```sh
flatc --python --gen-object-api -o training/generated training/schema/motor.fbs
flatc --binary --schema -o training/schema training/schema/motor.fbs
```

Archives, environments, compiler binaries and learned weights stay under ignored `training/runs`, `.venv` and `.tools`. Records contain game state and actions only, without chat, prompts, replies or credentials. Dataset/model hashes and episode IDs can be linked from the host's existing game-learning evidence; no personal memory is overwritten and recording does not promote a skill.

## Evaluation and adoption

Evaluate the raw learned policy and the physics teacher on the same reserved task/seed pairs, with no teacher interventions during evaluation. Report each task's completion rate, simulated duration, stationary time, collisions and falls. Preserve unsuccessful episodes. `replay` verifies CRCs and reconstructs selected episodes from their exact seed and action sequence, comparing observed features and outcomes.

Exported policy JSON contains validated layer dimensions, finite weights, feature/action identifiers, training metadata and `deploymentApproved: false`. The SDK evaluator can consume these weights without Python. A candidate does not automatically replace navigation or acquire live control. Actual Minecraft 1.21.1 acceptance, cancellation/ownership handoff and environmental hazards must be verified before explicit adoption through the existing core dispatcher. An offline pass is not production validation.

The historical route-following experiment remains in [`training/results/motor-20261017.json`](../training/results/motor-20261017.json). Its frozen candidate completed 185/192 reserved waypoint-assisted physics scenarios; the teacher completed 192/192. Six gap crossings failed and one dynamic-obstacle episode timed out. Those files and failures remain unchanged. The independent final-target/PPO experiment is recorded separately in [`training/results/motor-final-target-20261018.json`](../training/results/motor-final-target-20261018.json).

The independent experiment collected 14,680 offline demonstrations, ran 8,192 offline PPO steps and then 512 Minecraft PPO steps. Five additional actual Minecraft expert episodes produced 130 diagnostic demonstration transitions; they were not silently mixed into the model's imitation dataset. Training, validation and reserved test seeds are separate.

| Reserved evaluation | Behavioural cloning | After offline PPO | After Minecraft PPO |
| --- | ---: | ---: | ---: |
| Offline physics, same 192 task/seed pairs | 181/192 | 182/192 | 182/192 |
| Minecraft 1.21.1, same 12 task/seed pairs | 10/12 | not measured | 11/12 |

All these evaluations used final targets, zero expert interventions and zero route calls. Successful Minecraft endpoints were confirmed by server position queries. One net extra success is preliminary evidence only; individual offline cases also regressed. The final candidate still failed nine of 32 gap cases and one recovery case offline, and one of two gap cases in Minecraft. No candidate was adopted in production.

`verify-policy` compares the exported Node evaluator with CPU PyTorch on sampled recorded observations and measures only local network inference, excluding observation, IPC, physics and server delay:

```sh
python training/runner.py verify-policy --policy training/runs/example/policy.json --dataset training/runs/example/train.mcap --output training/runs/example/parity.json
```

Implementation references: [Prismarine physics](https://github.com/PrismarineJS/prismarine-physics), [pathfinder API](https://github.com/PrismarineJS/mineflayer-pathfinder), [Gymnasium environment API](https://gymnasium.farama.org/api/env/), [PPO paper](https://arxiv.org/abs/1707.06347), [PyTorch PPO tutorial](https://docs.pytorch.org/tutorials/intermediate/reinforcement_ppo.html), [MCAP encoding registry](https://mcap.dev/spec/registry), [FlatBuffers reflection schemas](https://flatbuffers.dev/intermediate_representation/).
