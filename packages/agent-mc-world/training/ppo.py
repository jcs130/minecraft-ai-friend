"""Explicit PPO fine-tuning. No expert calls, route features, online Agent or auto-adoption."""
import argparse
import copy
import json
import os
from pathlib import Path
import time
import numpy as np
import torch
from torch import nn
from torch.distributions import Categorical
from gym_env import MotorEnv
from runner import sha, write_json, window, TASKS
from trajectory import TrajectoryWriter


def transform(values, policy):
    if policy.get("inputTransform") == "goal-heading-v1":
        offset = policy["featureCount"] - 13
        dx, dz, sy, cy = values[..., offset], values[..., offset + 2], values[..., offset + 6], values[..., offset + 7]
        distance = (dx.square() + dz.square()).sqrt().clamp_min(1e-6)
        values = torch.cat((values, ((-dx * cy + dz * sy) / distance).unsqueeze(-1), ((-dx * sy - dz * cy) / distance).unsqueeze(-1)), dim=-1)
    normalization = policy.get("normalization")
    if normalization:
        values = (values - torch.tensor(normalization["mean"])) / torch.tensor(normalization["scale"])
    return values


def network(layers):
    modules = []
    for i, layer in enumerate(layers):
        linear = nn.Linear(len(layer["weight"][0]), len(layer["bias"]))
        linear.weight.data.copy_(torch.tensor(layer["weight"]))
        linear.bias.data.copy_(torch.tensor(layer["bias"]))
        modules.append(linear)
        if i + 1 < len(layers):
            modules.append(nn.ReLU())
    return nn.Sequential(*modules)


def gae(rewards, values, next_values, terminated, done, gamma=.99, lam=.95):
    """Bootstrap time limits and batch cuts, but never carry advantages into a reset episode."""
    result = torch.zeros_like(rewards)
    carry = 0.
    for i in reversed(range(len(rewards))):
        delta = rewards[i] + gamma * next_values[i] * (1 - terminated[i]) - values[i]
        carry = delta + gamma * lam * (1 - done[i]) * carry
        result[i] = carry
    return result


def ppo_loss(logits, actions, old_logp, advantages, clip=.2):
    distribution = Categorical(logits=logits)
    logp = distribution.log_prob(actions)
    ratio = (logp - old_logp).exp()
    objective = torch.minimum(ratio * advantages, ratio.clamp(1-clip, 1+clip) * advantages)
    return -objective.mean(), distribution.entropy().mean(), ((ratio - 1) - (logp - old_logp)).mean()


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--node", default="node")
    parser.add_argument("--environment")
    parser.add_argument("--policy", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--trajectory", required=True)
    parser.add_argument("--tasks", nargs="+", choices=TASKS, default=list(TASKS))
    parser.add_argument("--seed-start", type=int, default=8000)
    parser.add_argument("--seed-count", type=int, default=64)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--steps", type=int, default=4096)
    parser.add_argument("--horizon", type=int, default=256)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=.0001)
    args = parser.parse_args()
    if not 16 <= args.steps <= 10_000_000 or not 16 <= args.horizon <= 8192 or not 1 <= args.epochs <= 20 or not 0 < args.learning_rate <= .001:
        parser.error("Invalid PPO budget/hyperparameters")
    for path in (args.output, args.trajectory, args.output + '.report.json', args.trajectory + '.json'):
        if Path(path).exists():
            raise FileExistsError(f"Refusing to replace an experiment artifact: {path}")
    torch.set_num_threads(min(4, os.cpu_count() or 1)); torch.manual_seed(args.seed); np.random.seed(args.seed)
    policy = json.loads(Path(args.policy).read_text(encoding="utf-8"))
    if policy.get("goalMode") != "final-target" or policy["training"].get("deploymentApproved") is not False:
        raise ValueError("PPO requires an explicitly unapproved final-target candidate")
    actor = network(policy["layers"])
    width = len(policy["layers"][0]["weight"][0])
    critic = nn.Sequential(nn.Linear(width, 128), nn.ReLU(), nn.Linear(128, 64), nn.ReLU(), nn.Linear(64, 1))
    optimizer = torch.optim.Adam(list(actor.parameters()) + list(critic.parameters()), lr=args.learning_rate)
    started = time.time(); episodes = []; updates = []; collected = 0; episode_return = 0.; episode_length = 0
    env = MotorEnv(args.node, args.environment, args.tasks, args.seed_start, args.seed_count)
    try:
        if policy["actionNames"] != env.sim.contract["actionNames"] or policy["featureCount"] != env.sim.contract["featureCount"]:
            raise ValueError("PPO actor does not match the environment feature/action contract")
        with TrajectoryWriter(args.trajectory, env.sim.contract) as writer:
            obs, _ = env.reset(seed=args.seed)
            while collected < args.steps:
                batch = []
                for _ in range(min(args.horizon, args.steps - collected)):
                    before = copy.deepcopy(env.reply)
                    with torch.no_grad():
                        x = transform(torch.from_numpy(obs), policy)
                        distribution = Categorical(logits=actor(x)); action = distribution.sample()
                        value = critic(x).squeeze(-1); logp = distribution.log_prob(action)
                    obs, reward, terminated, truncated, info = env.step(int(action))
                    with torch.no_grad():
                        next_value = critic(transform(torch.from_numpy(obs), policy)).squeeze(-1)
                    before["executedByTeacher"] = False; before["policyProposal"] = int(action)
                    writer.add(env.task, env.scene_seed, "train", before, int(action), env.reply)
                    batch.append((x, action, logp, value, next_value, reward, float(terminated), float(terminated or truncated)))
                    collected += 1; episode_return += reward; episode_length += 1
                    if terminated or truncated:
                        episodes.append({**info, "return": episode_return, "decisions": episode_length})
                        episode_return = 0.; episode_length = 0
                        obs, _ = env.reset()
                xs, actions, old_logp, values, next_values = (torch.stack([r[i] for r in batch]) for i in range(5))
                rewards, terminated, done = (torch.tensor([r[i] for r in batch]) for i in range(5,8))
                advantages = gae(rewards, values, next_values, terminated, done)
                returns = advantages + values
                advantages = (advantages - advantages.mean()) / advantages.std(unbiased=False).clamp_min(1e-6)
                kls = []
                for epoch in range(args.epochs):
                    for indices in torch.randperm(len(batch)).split(64):
                        actor_loss, entropy, kl = ppo_loss(actor(xs[indices]), actions[indices], old_logp[indices], advantages[indices])
                        value_loss = (critic(xs[indices]).squeeze(-1) - returns[indices]).square().mean()
                        loss = actor_loss + .5 * value_loss - .005 * entropy
                        if not torch.isfinite(loss):
                            raise ValueError("Non-finite PPO loss; refusing to export candidate")
                        optimizer.zero_grad(set_to_none=True); loss.backward()
                        nn.utils.clip_grad_norm_(list(actor.parameters()) + list(critic.parameters()), .5)
                        optimizer.step(); kls.append(float(kl.detach()))
                    if np.mean(kls[-max(1, len(batch)//64):]) > .03:
                        break
                update = {"steps": collected, "episodes": len(episodes), "successes": sum(r["success"] for r in episodes),
                          "approxKl": float(np.mean(kls)), "valueLoss": float(value_loss.detach()), "expertActions": 0, "teacherRouteCalls": 0}
                updates.append(update); print(json.dumps(update), flush=True)
            transitions = writer.count
        contract = env.sim.contract
        scenario_seeds = sorted(env.used_seeds)
    finally:
        env.close()
    trajectory_sha = sha(args.trajectory)
    manifest = {**contract, "datasetSha256": trajectory_sha, "split": "train", "seeds": scenario_seeds, "tasks": args.tasks,
                "episodes": len(episodes), "transitions": transitions, "collection": "stochastic-on-policy-PPO",
                "expertInterventions": 0, "teacherRouteCalls": 0, "containsPromptsOrCredentials": False, **window(started)}
    write_json(args.trajectory + '.json', manifest)
    policy["layers"] = [{"weight": layer.weight.detach().tolist(), "bias": layer.bias.detach().tolist()} for layer in actor if isinstance(layer, nn.Linear)]
    policy["training"] = {**policy["training"], "method": "PPO-after-behavioural-cloning", "parentPolicySha256": sha(args.policy),
                          "datasetSha256": trajectory_sha, "datasetHashes": list(dict.fromkeys(policy["training"].get("datasetHashes", []) + [trajectory_sha])),
                          "scenarioSeeds": sorted(set(policy["training"].get("scenarioSeeds", [])) | set(scenario_seeds)),
                          "ppoSteps": collected, "seed": args.seed, "deploymentApproved": False}
    write_json(args.output, policy)
    write_json(args.output + '.report.json', {"policySha256": sha(args.output), "parentPolicySha256": sha(args.policy),
               "trajectorySha256": trajectory_sha, "contract": contract, "steps": collected, "episodes": episodes, "updates": updates,
               "partialEpisode": {"decisions": episode_length, "return": episode_return} if episode_length else None,
               "hyperparameters": {"gamma": .99, "lambda": .95, "clip": .2, "epochs": args.epochs, "horizon": args.horizon, "learningRate": args.learning_rate},
               "critic": "fresh on each run; optimizer state not resumed", "evaluation": False, "liveValidated": False,
               "wallSeconds": time.time() - started, **window(started)})


if __name__ == "__main__":
    main()
