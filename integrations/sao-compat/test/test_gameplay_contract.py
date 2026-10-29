import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from build_sao_contract import CONTRACT


class GameplayContract(unittest.TestCase):
    def test_runtime_schema_and_generated_help_share_the_source_contract(self):
        path = Path(__file__).resolve().parents[1] / 'sao-operations.json'
        self.assertEqual(json.loads(path.read_text('utf-8')), CONTRACT)
        ids = [op['id'] for op in CONTRACT['operations']]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(CONTRACT['scope'], 'requesting_player_only')
        self.assertEqual(CONTRACT['limits']['stateBytes'], 16384)


if __name__ == '__main__':
    unittest.main()
