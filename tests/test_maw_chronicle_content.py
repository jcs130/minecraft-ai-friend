from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import unittest

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('life_builder', REPO/'tools/build_maw_life_content.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class ChronicleContentTest(unittest.TestCase):
    def setUp(self):
        self.content = json.loads((REPO/'config/maw-life-content.json').read_bytes())

    def test_native_story_graph_and_generated_rewards(self):
        builder.validate_content(self.content)
        story = self.content['story']
        rows = {f"maw:{q['id']}": q for q in self.content['quests']}
        self.assertEqual(len(story['questIds']), 12)
        self.assertEqual(story['questProvider'], 'simplequests')
        self.assertEqual(story['economyProvider'], 'economycraft')
        for id in story['questIds']:
            row = rows[id]
            self.assertEqual(row['repeatTicks'], -1)
            path = builder.PACK / f"data/maw/simplequests_api/quest/{row['id']}.json"
            native = json.loads(path.read_bytes())
            self.assertEqual(native['parent_id'], ['maw:'+p for p in row['parents']])
            task = native['tasks']['objective']
            self.assertEqual(task.get('consume_items'), {'item': True, 'inspect': False}.get(row['kind']))
            self.assertEqual((builder.PACK/f"data/maw/function/rewards/{row['id']}.mcfunction").read_text('utf8'),
                f"eco addmoney @s[type=minecraft:player] {row['money']}\n")

    def test_reject_missing_parent_before_generating(self):
        self.content['quests'][0]['parents'] = ['missing_quest']
        with self.assertRaisesRegex(ValueError, 'Unknown parent'): builder.validate_content(self.content)

    def test_reject_dependency_cycle(self):
        self.content['quests'][0]['parents'] = [self.content['quests'][1]['id']]
        self.content['quests'][1]['parents'] = [self.content['quests'][0]['id']]
        with self.assertRaisesRegex(ValueError, 'Cyclic'): builder.validate_content(self.content)

    def test_reject_duplicate_and_invalid_ids(self):
        bad = deepcopy(self.content); bad['quests'].append(deepcopy(bad['quests'][0]))
        with self.assertRaisesRegex(ValueError, 'uniquely'): builder.validate_content(bad)
        bad = deepcopy(self.content); bad['quests'][-1]['id'] = '../other_world'
        with self.assertRaisesRegex(ValueError, 'Invalid'): builder.validate_content(bad)

    def test_no_second_currency_or_unimplemented_task_kinds(self):
        self.content['quests'][0]['kind'] = 'pretend_windmill_operational'
        with self.assertRaisesRegex(ValueError, 'Unsupported'): builder.validate_content(self.content)


if __name__ == '__main__': unittest.main()
