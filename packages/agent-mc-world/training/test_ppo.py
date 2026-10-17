import os
import unittest
import numpy as np
import torch
from gymnasium.utils.env_checker import check_env
from ppo import gae, ppo_loss
from gym_env import MotorEnv


class ReinforcementTests(unittest.TestCase):
    def test_time_limit_bootstraps_but_never_leaks_next_episode(self):
        advantages = gae(torch.tensor([1., 2., 999.]), torch.tensor([.5, .6, .7]), torch.tensor([.6, .8, .9]),
                         torch.tensor([0., 0., 1.]), torch.tensor([0., 1., 1.]), gamma=.9, lam=.8)
        self.assertAlmostEqual(advantages[1].item(), 2 + .9*.8 - .6, places=5)
        self.assertAlmostEqual(advantages[0].item(), 1 + .9*.6 - .5 + .9*.8*advantages[1].item(), places=5)
        self.assertAlmostEqual(advantages[2].item(), 999 - .7, places=4)

    def test_clipping_prevents_an_already_excessive_policy_update(self):
        logits = torch.tensor([[4., 0.]], requires_grad=True)
        loss, _, kl = ppo_loss(logits, torch.tensor([0]), torch.log(torch.tensor([.5])), torch.tensor([1.]))
        loss.backward()
        self.assertAlmostEqual(loss.item(), -1.2, places=5)
        self.assertEqual(logits.grad.abs().sum().item(), 0.)
        self.assertGreater(kl.item(), 0.)

    def test_gym_contract_and_expert_free_lifecycle(self):
        node = os.environ.get('MOTOR_TEST_NODE', 'node')
        env = MotorEnv(node=node, tasks=['walk'], seed_start=10000, seed_count=4)
        try:
            check_env(env, skip_render_check=True)
            _, info = env.reset(seed=42)
            self.assertEqual(info['task'], 'walk')
            for _ in range(5):
                _, _, terminated, truncated, info = env.step(7)
                self.assertEqual(info['teacherRouteCalls'], 0)
            with self.assertRaises(ValueError):
                env.reset(options={'scenario_seed': 9000})
        finally:
            env.close()


if __name__ == '__main__':
    unittest.main()
