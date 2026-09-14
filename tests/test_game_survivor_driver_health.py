from pathlib import Path
from types import SimpleNamespace as N
import importlib.util,unittest,copy
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('survivor_driver_health',ROOT/'world/ops/qwenpaw_health.py')
health=importlib.util.module_from_spec(spec);spec.loader.exec_module(health)

class SurvivorDriverHealth(unittest.TestCase):
    def setUp(self):
        self.names=['status','look','view_scene']
        self.card=N(config={'tools':list(self.names)},policy=N(default_effect='deny',rules=[
            N(subject='*',effect='allow',condition=None,target=N(kind='tool',name=t),
              principal=N(source_type='*',source_value='*',subject_type='*',subject_value='*')) for t in self.names]))

    def test_complete_exact_card_is_valid(self):
        health.check_survivor_card_scope(self.card,self.names)

    def test_discoverable_tool_without_policy_is_not_ready(self):
        self.card.policy.rules.pop()
        with self.assertRaises(AssertionError):health.check_survivor_card_scope(self.card,self.names)

    def test_equally_stale_config_and_policy_cannot_pass_new_source_inventory(self):
        self.card.config['tools'].pop();self.card.policy.rules.pop()
        with self.assertRaises(AssertionError):health.check_survivor_card_scope(self.card,self.names)

    def test_duplicate_denied_conditional_or_other_scope_is_rejected(self):
        original=copy.deepcopy(self.card)
        for change in ('duplicate','deny','condition','principal','default'):
            with self.subTest(change=change):
                self.card=copy.deepcopy(original)
                if change=='duplicate':self.card.policy.rules[2]=self.card.policy.rules[1]
                if change=='deny':self.card.policy.rules[2].effect='deny'
                if change=='condition':self.card.policy.rules[2].condition={'unexpected':True}
                if change=='principal':self.card.policy.rules[2].principal.source_type='other'
                if change=='default':self.card.policy.default_effect='allow'
                with self.assertRaises(AssertionError):health.check_survivor_card_scope(self.card,self.names)

if __name__=='__main__':unittest.main()
