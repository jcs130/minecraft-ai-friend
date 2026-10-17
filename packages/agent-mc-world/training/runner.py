"""Explicit offline motor collection, behavioural cloning and held-out rollout evaluation."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
TASKS = ("walk", "step", "obstacle", "gap", "follow", "recovery")


class Simulator:
    def __init__(self, node: str):
        self.process = subprocess.Popen([node, "--import", "tsx", str(ROOT / "worker.ts")],
                                        cwd=ROOT.parent, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        encoding="utf-8", errors="strict", bufsize=1)
        self.contract = self.call(op="hello")

    def call(self, **request):
        self.process.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError(f"Physics worker exited: {self.process.poll()}")
        response = json.loads(line)
        if "error" in response:
            raise RuntimeError(response["error"])
        return response

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(timeout=10)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def sha(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def window(started):
    return {"startedAt": datetime.fromtimestamp(started, timezone.utc).isoformat(),
            "finishedAt": datetime.now(timezone.utc).isoformat()}


def rollout(sim, task, seed, selector="teacher", record=None, split="test", teacher_labels=False, teacher_probability=0.):
    import random
    rng = random.Random(seed)
    reply = sim.call(op="reset", task=task, seed=seed, teacher=selector == "teacher" or teacher_labels, truth=record is not None)
    inference_ms = []
    expert_actions = student_actions = 0
    while True:
        expert = selector == "teacher" or (teacher_labels and rng.random() < teacher_probability)
        if expert:
            action = reply["teacher"]
            expert_actions += 1
        else:
            before = time.perf_counter()
            action = selector(reply["features"]) if callable(selector) else reply["policy"]
            inference_ms.append((time.perf_counter() - before) * 1000 if callable(selector) else reply["policyElapsedMs"])
            student_actions += 1
        original = reply
        original["executedByTeacher"] = expert
        reply = sim.call(op="step", action=int(action), teacher=selector == "teacher" or teacher_labels, truth=True)
        if record:
            record.add(task, seed, split, original, int(action), reply)
        if reply["terminal"]:
            truth = reply["truth"]
            return {"task": task, "seed": seed, "success": reply["success"], "failure": reply["failure"],
                    "ticks": truth["tick"], "simulatedSeconds": truth["tick"] / 20,
                    "travelled": truth["travelled"], "collisionTicks": truth["collisionTicks"],
                    "longestStillSeconds": truth["longestStillTicks"] / 20,
                    "decisionCount": truth["tick"] // 2,
                    "expertActions": expert_actions, "studentActions": student_actions,
                    "inferenceMsP95": sorted(inference_ms)[int(.95 * (len(inference_ms) - 1))] if inference_ms else None}


def evaluate(args):
    from collections import defaultdict
    started = time.time()
    results = []
    with Simulator(args.node) as sim:
        if args.policy:
            policy_data = json.loads(Path(args.policy).read_text(encoding="utf-8"))
            if set(range(args.seed, args.seed + args.episodes)) & set(policy_data["training"].get("scenarioSeeds", [])):
                raise ValueError("Evaluation seeds overlap the policy training split")
            sim.call(op="load", path=str(Path(args.policy).resolve()))
        for task in args.tasks:
            for i in range(args.episodes):
                result = rollout(sim, task, args.seed + i, "policy" if args.policy else "teacher")
                results.append(result)
            print(json.dumps({"task": task, "success": sum(r["success"] for r in results if r["task"] == task),
                              "episodes": args.episodes}), flush=True)
        contract = sim.contract
    grouped = defaultdict(list)
    for r in results:
        grouped[r["task"]].append(r)
    report = {"protocol": contract["protocol"], "simulation": contract["simulation"],
              "minecraftVersion": contract["minecraftVersion"], "engine": "offline-physics-not-live-Minecraft",
              "controller": "learned-raw" if args.policy else "physics-lookahead-teacher",
              "policySha256": sha(args.policy) if args.policy else None,
              "wallSeconds": time.time() - started, "seedStart": args.seed, "episodes": len(results),
              "successRate": sum(r["success"] for r in results) / len(results),
              "expertInterventions": sum(r["expertActions"] for r in results),
              "byTask": {task: {"episodes": len(rows), "successRate": sum(r["success"] for r in rows) / len(rows)} for task, rows in grouped.items()},
              "liveValidated": False, "deploymentApproved": False, "results": results, **window(started)}
    write_json(args.output, report)
    print(json.dumps({k: report[k] for k in ("episodes", "successRate", "wallSeconds", "output") if k in report}), flush=True)


def collect(args):
    from trajectory import TrajectoryWriter
    started = time.time()
    output = Path(args.output)
    if output.exists():
        raise FileExistsError(f"Refusing to replace trajectory archive: {output}")
    with Simulator(args.node) as sim, TrajectoryWriter(output, sim.contract) as writer:
        if args.policy:
            if args.split != "train":
                raise ValueError("Dataset aggregation may only collect the training split")
            sim.call(op="load", path=str(Path(args.policy).resolve()))
        outcomes = []
        for task in args.tasks:
            for i in range(args.episodes):
                outcomes.append(rollout(sim, task, args.seed + i, "policy" if args.policy else "teacher", record=writer,
                                        split=args.split, teacher_labels=bool(args.policy), teacher_probability=args.teacher_probability))
            print(json.dumps({"task": task, "episodes": args.episodes, "records": writer.count}), flush=True)
    manifest = {"protocol": sim.contract["protocol"], "datasetSha256": sha(output), "split": args.split,
                "seedStart": args.seed, "seeds": list(range(args.seed, args.seed + args.episodes)), "tasks": args.tasks,
                "episodes": len(outcomes), "transitions": writer.count, "wallSeconds": time.time() - started,
                "observationTopic": "/motor/observation_action", "truthTopic": "/motor/environment_truth",
                "engine": sim.contract["simulation"], "minecraftVersion": sim.contract["minecraftVersion"],
                "actionNames": sim.contract["actionNames"], "featureCount": sim.contract["featureCount"], "sourceHashes": sim.contract["sourceHashes"],
                "schemaSha256": sha(ROOT / "schema/motor.bfbs"),
                "collectionPolicySha256": sha(args.policy) if args.policy else None,
                "expertInterventionProbability": args.teacher_probability if args.policy else 1.,
                "containsPromptsOrCredentials": False, "liveValidated": False, "results": outcomes, **window(started)}
    write_json(str(output) + ".json", manifest)
    print(json.dumps({"transitions": writer.count, "sha256": manifest["datasetSha256"], "wallSeconds": manifest["wallSeconds"]}), flush=True)


def train(args):
    import numpy as np
    import torch
    from trajectory import training_arrays
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    datasets = [Path(p) for p in args.datasets]
    manifests = [json.loads(Path(str(p) + ".json").read_text(encoding="utf-8")) for p in datasets]
    if any(m["split"] != "train" or m["datasetSha256"] != sha(p) for m, p in zip(manifests, datasets)):
        raise ValueError("Only integrity-checked training-split trajectories may update weights")
    first = manifests[0]
    if any(m["actionNames"] != first["actionNames"] or m["featureCount"] != first["featureCount"] for m in manifests):
        raise ValueError("Mixed feature/action schemas")
    xs, ys = zip(*(training_arrays(p, "train") for p in datasets))
    x, y = torch.from_numpy(np.concatenate(xs)), torch.from_numpy(np.concatenate(ys))
    if x.shape[1] != first["featureCount"] or y.min() < 0 or y.max() >= len(first["actionNames"]):
        raise ValueError("Training observations do not match their manifest")
    previous = json.loads(Path(args.resume).read_text(encoding="utf-8")) if args.resume else None
    transform = previous.get("inputTransform") if previous else "goal-heading-v1"
    if transform == "goal-heading-v1":
        offset = x.shape[1] - 13
        dx, dz, sy, cy = x[:, offset], x[:, offset + 2], x[:, offset + 6], x[:, offset + 7]
        d = (dx.square() + dz.square()).sqrt().clamp_min(1e-6)
        x = torch.cat((x, ((-dx * cy + dz * sy) / d).unsqueeze(1), ((-dx * sy - dz * cy) / d).unsqueeze(1)), dim=1)
    mean = x.mean(0)
    scale = x.std(0).clamp_min(.1)
    model = torch.nn.Sequential(torch.nn.Linear(x.shape[1], 128), torch.nn.ReLU(),
                                torch.nn.Linear(128, 64), torch.nn.ReLU(), torch.nn.Linear(64, len(first["actionNames"])))
    if args.resume:
        # Keep the trained input transform when aggregating on-policy samples.
        mean = torch.tensor(previous.get("normalization", {}).get("mean", mean.tolist()))
        scale = torch.tensor(previous.get("normalization", {}).get("scale", scale.tolist()))
        for layer, data in zip((m for m in model if isinstance(m, torch.nn.Linear)), previous["layers"]):
            layer.weight.data.copy_(torch.tensor(data["weight"]))
            layer.bias.data.copy_(torch.tensor(data["bias"]))
    x = (x - mean) / scale
    optimizer = torch.optim.AdamW(model.parameters(), lr=.001, weight_decay=.0001)
    # Balanced labels prevent the plentiful straight-walking samples from erasing jump/turn examples.
    counts = torch.bincount(y, minlength=len(first["actionNames"])).float()
    weights = (counts.sum() / counts.clamp_min(1)).sqrt()
    weights /= weights.mean()
    loss_fn = torch.nn.CrossEntropyLoss(weight=weights)
    losses = []
    started = time.time()
    for epoch in range(args.epochs):
        order = torch.randperm(len(y))
        total = 0.
        for batch in order.split(256):
            optimizer.zero_grad(set_to_none=True)
            loss = loss_fn(model(x[batch]), y[batch])
            loss.backward()
            optimizer.step()
            total += loss.item() * len(batch)
        losses.append(total / len(y))
        if epoch % 10 == 0 or epoch == args.epochs - 1:
            print(json.dumps({"epoch": epoch + 1, "loss": losses[-1]}), flush=True)
    with torch.no_grad():
        accuracy = (model(x).argmax(-1) == y).float().mean().item()
    layers = [{"weight": layer.weight.detach().tolist(), "bias": layer.bias.detach().tolist()}
              for layer in model if isinstance(layer, torch.nn.Linear)]
    model_data = {"protocol": first["protocol"], "minecraftVersion": first["minecraftVersion"],
                  "featureCount": first["featureCount"], "actionNames": first["actionNames"], "layers": layers,
                  "normalization": {"mean": mean.tolist(), "scale": scale.tolist()},
                  "training": {"method": "behavioural-cloning" if not args.resume else "dataset-aggregation",
                               "datasetSha256": first["datasetSha256"], "datasetHashes": [m["datasetSha256"] for m in manifests],
                               "scenarioSeeds": sorted({seed for m in manifests for seed in m["seeds"]}),
                               "seed": args.seed, "epochs": args.epochs, "samples": len(y), "deploymentApproved": False}}
    if transform:
        model_data["inputTransform"] = transform
    write_json(args.output, model_data)
    write_json(str(args.output) + ".report.json", {"trainingAccuracy": accuracy, "losses": losses, "wallSeconds": time.time() - started,
                                                "policySha256": sha(args.output), "labelCounts": counts.int().tolist(),
                                                "warning": "Training accuracy is not closed-loop success or live validation.", **window(started)})
    print(json.dumps({"samples": len(y), "trainingAccuracy": accuracy, "wallSeconds": time.time() - started}), flush=True)


def replay(args):
    import numpy as np
    from mcap.reader import make_reader
    from trajectory import MotorFrame
    episode = None
    episodes = transitions = checked = 0
    with Simulator(args.node) as sim, Path(args.dataset).open("rb") as stream:
        for _, _, message in make_reader(stream, validate_crcs=True).iter_messages(topics=["/motor/observation_action"]):
            frame = MotorFrame.GetRootAs(message.data, 0)
            current = frame.EpisodeId().decode()
            if current != episode:
                episode = current
                episodes += 1
                if episodes <= args.episodes:
                    reply = sim.call(op="reset", task=frame.Task().decode(), seed=frame.Seed())
            transitions += 1
            if episodes > args.episodes:
                continue
            np.testing.assert_allclose(reply["features"], frame.FeaturesAsNumpy(), atol=1e-6, rtol=1e-6)
            reply = sim.call(op="step", action=frame.ActionIndex())
            np.testing.assert_allclose(reply["features"], frame.NextFeaturesAsNumpy(), atol=1e-6, rtol=1e-6)
            if reply["terminal"] != frame.Terminal() or (frame.Terminal() and reply["success"] != frame.Success()):
                raise ValueError("Replayed terminal outcome differs")
            checked += 1
    result = {"datasetSha256": sha(args.dataset), "crcCheckedTransitions": transitions, "replayedEpisodes": min(episodes, args.episodes),
              "replayedTransitions": checked, "featuresAndOutcomesMatched": True, "engine": "offline-physics-not-live-Minecraft"}
    write_json(args.output, result)
    print(json.dumps(result), flush=True)


def verify_policy(args):
    import numpy as np
    import torch
    from mcap.reader import make_reader
    from trajectory import MotorFrame
    torch.set_num_threads(2)
    model = json.loads(Path(args.policy).read_text(encoding="utf-8"))
    layers = [(torch.tensor(layer["weight"]), torch.tensor(layer["bias"])) for layer in model["layers"]]
    matched = checked = 0
    durations = []
    with Simulator(args.node) as sim, Path(args.dataset).open("rb") as stream:
        sim.call(op="load", path=str(Path(args.policy).resolve()))
        for index, (_, _, message) in enumerate(make_reader(stream, validate_crcs=True).iter_messages(topics=["/motor/observation_action"])):
            if index % 31 or checked >= args.samples:
                continue
            frame = MotorFrame.GetRootAs(message.data, 0)
            values = torch.tensor(frame.FeaturesAsNumpy().copy())
            if model.get("inputTransform") == "goal-heading-v1":
                offset = model["featureCount"] - 13
                dx, dz, sy, cy = values[offset], values[offset + 2], values[offset + 6], values[offset + 7]
                d = (dx.square() + dz.square()).sqrt().clamp_min(1e-6)
                values = torch.cat((values, torch.stack(((-dx * cy + dz * sy) / d, (-dx * sy - dz * cy) / d))))
            if model.get("normalization"):
                values = (values - torch.tensor(model["normalization"]["mean"])) / torch.tensor(model["normalization"]["scale"])
            for layer_index, (weight, bias) in enumerate(layers):
                values = torch.nn.functional.linear(values, weight, bias)
                if layer_index + 1 < len(layers):
                    values = values.relu()
            observation = {"protocol": "agent-mc-motor/v1", "minecraftVersion": "1.21.1", "tick": frame.Tick(),
                           "position": frame.PositionAsNumpy().tolist(), "velocity": frame.VelocityAsNumpy().tolist(),
                           "yaw": frame.Yaw(), "onGround": frame.OnGround(), "goal": frame.GoalAsNumpy().tolist(), "voxels": frame.VoxelsAsNumpy().tolist()}
            result = sim.call(op="infer", observation=observation)
            matched += int(result["action"] == values.argmax().item())
            durations.append(result["elapsedMs"])
            checked += 1
    if checked == 0 or matched != checked:
        raise ValueError(f"Portable policy parity differs: {matched}/{checked}")
    result = {"policySha256": sha(args.policy), "samples": checked, "matchingActions": matched,
              "nodeInferenceMsP50": float(np.percentile(durations, 50)), "nodeInferenceMsP95": float(np.percentile(durations, 95)),
              "runtime": "CPU Node MLP compared with CPU PyTorch", "llmCalls": 0, "bodyActions": 0,
              "nodePolicyInferences": checked, "pytorchPolicyInferences": checked}
    write_json(args.output, result)
    print(json.dumps(result), flush=True)


def main():
    parser = argparse.ArgumentParser(__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name, function in (("collect", collect), ("evaluate", evaluate)):
        p = sub.add_parser(name)
        p.add_argument("--node", default="node")
        p.add_argument("--tasks", nargs="+", choices=TASKS, default=list(TASKS))
        p.add_argument("--episodes", type=int, default=4)
        p.add_argument("--seed", type=int, default=1000 if name == "collect" else 2000)
        p.add_argument("--output", required=True)
        if name == "collect":
            p.add_argument("--split", choices=("train", "validation", "test"), default="train")
            p.add_argument("--policy")
            p.add_argument("--teacher-probability", type=float, default=.2)
        else:
            p.add_argument("--policy")
        p.set_defaults(function=function)
    p = sub.add_parser("train")
    p.add_argument("--datasets", nargs="+", required=True)
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--output", required=True)
    p.add_argument("--resume")
    p.set_defaults(function=train)
    p = sub.add_parser("replay")
    p.add_argument("--node", default="node")
    p.add_argument("--dataset", required=True)
    p.add_argument("--episodes", type=int, default=6)
    p.add_argument("--output", required=True)
    p.set_defaults(function=replay)
    p = sub.add_parser("verify-policy")
    p.add_argument("--node", default="node")
    p.add_argument("--policy", required=True)
    p.add_argument("--dataset", required=True)
    p.add_argument("--samples", type=int, default=256)
    p.add_argument("--output", required=True)
    p.set_defaults(function=verify_policy)
    args = parser.parse_args()
    if hasattr(args, "episodes") and not 1 <= args.episodes <= 10000:
        parser.error("episodes must be 1..10000")
    if hasattr(args, "teacher_probability") and not 0 <= args.teacher_probability <= 1:
        parser.error("teacher-probability must be 0..1")
    if hasattr(args, "seed") and (args.seed < 0 or args.seed + getattr(args, "episodes", 1) > 2 ** 32):
        parser.error("scenario seed range must fit uint32")
    if hasattr(args, "epochs") and not 1 <= args.epochs <= 5000:
        parser.error("epochs must be 1..5000")
    args.function(args)


if __name__ == "__main__":
    main()
