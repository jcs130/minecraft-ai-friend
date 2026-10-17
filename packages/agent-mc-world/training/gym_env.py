"""Gymnasium port over the same opt-in worker, with final-target observations only."""
import numpy as np
import gymnasium as gym
from gymnasium import spaces
from runner import Simulator, TASKS


class MotorEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, node="node", environment=None, tasks=TASKS, seed_start=10000, seed_count=64):
        if not tasks or any(task not in TASKS for task in tasks) or seed_count < 1 or seed_start < 0 or seed_start + seed_count > 2**32:
            raise ValueError("Invalid training curriculum")
        self.sim = Simulator(node, environment)
        if self.sim.contract["goalMode"] != "final-target":
            self.sim.close()
            raise ValueError("RL requires final-target observations without expert waypoints")
        self.tasks, self.seed_start, self.seed_count = tuple(tasks), seed_start, seed_count
        self.observation_space = spaces.Box(-np.inf, np.inf, (self.sim.contract["featureCount"],), dtype=np.float32)
        self.action_space = spaces.Discrete(len(self.sim.contract["actionNames"]))
        self.reply = None
        self.done = True
        self.used_seeds = set()

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        options = options or {}
        task = options.get("task", self.tasks[int(self.np_random.integers(len(self.tasks)))])
        scene_seed = options.get("scenario_seed", self.seed_start + int(self.np_random.integers(self.seed_count)))
        if task not in self.tasks or not self.seed_start <= scene_seed < self.seed_start + self.seed_count:
            raise ValueError("Episode lies outside the declared training curriculum")
        self.task, self.scene_seed = task, scene_seed
        self.used_seeds.add(scene_seed)
        self.reply = self.sim.call(op="reset", task=task, seed=scene_seed, teacher=False, truth=True)
        self.done = False
        return np.asarray(self.reply["features"], dtype=np.float32), {"task": task, "scenarioSeed": scene_seed}

    def step(self, action):
        if self.done or not self.action_space.contains(action):
            raise ValueError("Reset before stepping; action must be in the declared action space")
        self.reply = self.sim.call(op="step", action=int(action), teacher=False, truth=True)
        self.done = self.reply["terminal"]
        truncated = self.reply.get("failure") == "timeout"
        terminated = self.done and not truncated
        if self.reply["truth"]["teacherRouteCalls"] != 0:
            raise ValueError("An independent RL step unexpectedly invoked the expert")
        return np.asarray(self.reply["features"], dtype=np.float32), float(self.reply["reward"]), terminated, truncated, {
            "task": self.task, "scenarioSeed": self.scene_seed, "success": self.reply["success"],
            "failure": self.reply.get("failure"), "teacherRouteCalls": 0}

    def close(self):
        self.sim.close()
