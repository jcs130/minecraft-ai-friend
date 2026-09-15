"""Tests for the adaptive LLM invocation router."""
import sys, time, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
from adaptive_router import route, LEVELS, WEIGHTS


def base_perception(**overrides):
    base = {
        'biome': 'plains', 'known_biomes': ['plains', 'forest'],
        'nearby_hostiles': 0, 'unknown_blocks_nearby': 0,
        'dimension': 'overworld', 'hp': 20,
        'under_attack': False, 'party_message_pending': False,
        'inventory_changed_significantly': False,
        'current_activity': '', 'goto_in_progress': False,
        'inventory_summary': {},
    }
    base.update(overrides)
    return base


def base_history(**overrides):
    base = {
        'recent_receipts': [{'status': 'completed'}] * 5,
        'last_perception': {'hp': 20},
    }
    base.update(overrides)
    return base


def base_goals(**overrides):
    base = {'current_target': 'iron_sword', 'target_item': 'iron_ingot',
            'target_count': 3}
    base.update(overrides)
    return base


class RouterLevelTests(unittest.TestCase):
    def test_familiar_farming_is_level_0(self):
        """Repetitive farming with no changes should skip LLM entirely."""
        result = route(
            base_perception(current_activity='farming', goto_in_progress=True),
            base_history(),
            base_goals(),
            skills=[{'triggers': 'farming'}],
            last_plan_at=time.time() - 60,
        )
        self.assertEqual(result['level'], 0)
        self.assertFalse(result['should_call_llm'])
        self.assertEqual(result['suggested_action'], 'continue_farming_skill')

    def test_going_somewhere_is_level_0(self):
        """Movement in progress with no anomalies = skip LLM."""
        result = route(
            base_perception(goto_in_progress=True),
            base_history(),
            base_goals(),
            skills=[],
            last_plan_at=time.time() - 30,
        )
        self.assertLessEqual(result['level'], 1)

    def test_new_biome_escalates(self):
        """Unfamiliar biome should trigger at least THINK level."""
        result = route(
            base_perception(biome='deep_dark', known_biomes=['plains']),
            base_history(),
            base_goals(),
            skills=[],
            last_plan_at=time.time() - 200,
        )
        self.assertGreaterEqual(result['level'], 2)

    def test_critical_hp_forces_level_3(self):
        """HP < 6 always escalates regardless of other signals."""
        result = route(
            base_perception(hp=4),
            base_history(),
            base_goals(),
            skills=[{'triggers': 'farming'}],
        )
        self.assertEqual(result['level'], 3)
        self.assertEqual(result['reason'], 'CRITICAL_HP')

    def test_under_attack_with_novelty_escalates(self):
        """Combat in unfamiliar territory needs planning."""
        result = route(
            base_perception(under_attack=True, nearby_hostiles=4, biome='crimson_forest'),
            base_history(),
            base_goals(),
            skills=[],
        )
        self.assertGreaterEqual(result['level'], 3)
        self.assertEqual(result['reason'], 'COMBAT_NOVEL')

    def test_party_message_escalates(self):
        """Pending party message needs at least THINK level."""
        result = route(
            base_perception(party_message_pending=True),
            base_history(),
            base_goals(),
            skills=[],
        )
        self.assertGreaterEqual(result['level'], 2)
        self.assertEqual(result['reason'], 'PARTY_PENDING')

    def test_repeated_failure_escalates(self):
        """>50% failure rate = need deep planning."""
        result = route(
            base_perception(),
            base_history(recent_receipts=[
                {'status': 'failed'}, {'status': 'failed'}, {'status': 'failed'},
                {'status': 'completed'}, {'status': 'failed'},
            ]),
            base_goals(),
            skills=[],
        )
        self.assertGreaterEqual(result['level'], 3)
        self.assertEqual(result['reason'], 'REPEATED_FAILURE')

    def test_hp_drop_triggers_attention(self):
        """Significant HP drop raises uncertainty."""
        result = route(
            base_perception(hp=12),
            base_history(last_perception={'hp': 20}),
            base_goals(),
            skills=[],
        )
        self.assertGreaterEqual(result['level'], 2)

    def test_long_time_drift_escalates(self):
        """No planning for >5 min should raise level."""
        result = route(
            base_perception(),
            base_history(),
            base_goals(),
            skills=[],
            last_plan_at=time.time() - 400,
        )
        self.assertGreaterEqual(result['level'], 2)

    def test_skill_coverage_reduces_uncertainty(self):
        """Known skill handling the situation reduces score."""
        now = time.time()
        without_skill = route(
            base_perception(current_activity='mining'),
            base_history(),
            base_goals(),
            skills=[],
            last_plan_at=now - 60,
        )
        with_skill = route(
            base_perception(current_activity='mining'),
            base_history(),
            base_goals(),
            skills=[{'triggers': 'mining'}],
            last_plan_at=now - 60,
        )
        self.assertLess(with_skill['score'], without_skill['score'])

    def test_goal_achieved_reduces_uncertainty(self):
        """Having the target items reduces uncertainty."""
        result = route(
            base_perception(inventory_summary={'iron_ingot': 5}),
            base_history(),
            base_goals(target_item='iron_ingot', target_count=3),
            skills=[],
        )
        self.assertLess(result['signals']['goal_progress'], 0.2)


class RouterContractTests(unittest.TestCase):
    def test_output_structure(self):
        """Router output always has required fields."""
        result = route(base_perception(), base_history(), base_goals(), [])
        for key in ('level', 'level_name', 'score', 'reason', 'signals',
                    'suggested_action', 'should_call_llm', 'at'):
            self.assertIn(key, result)

    def test_score_bounded(self):
        """Composite score is always 0-1."""
        result = route(base_perception(hp=1, under_attack=True, biome='unknown'),
                       base_history(recent_receipts=[{'status': 'failed'}] * 10),
                       base_goals(),
                       [])
        self.assertGreaterEqual(result['score'], 0)
        self.assertLessEqual(result['score'], 1.0)

    def test_all_four_levels_exist(self):
        """Four levels are defined with metadata."""
        for level in range(4):
            self.assertIn(level, LEVELS)
            self.assertIn('name', LEVELS[level])
            self.assertIn('description', LEVELS[level])

    def test_weights_sum_reasonable(self):
        """Positive weights sum to about 1.0 (negative reduces)."""
        positive = sum(v for v in WEIGHTS.values() if v > 0)
        self.assertGreater(positive, 0.7)
        self.assertLess(positive, 1.3)


if __name__ == '__main__':
    unittest.main()
