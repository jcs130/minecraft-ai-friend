"""A listed skill alone must not certify missing references or recipe capability."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('knowledge_health', ROOT / 'tools/game_knowledge_health.py')
health = importlib.util.module_from_spec(spec); spec.loader.exec_module(health)


class KnowledgeHealthTests(unittest.TestCase):
    def test_missing_reference_and_disabled_recipe_fail_even_if_skill_is_listed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); references = {'crafting.md': 'checked reference', **{f'page-{i}.md': 'data' for i in range(7)}}
            broken = None
            def pages(name, source):
                return {} if broken == 'disk' and 'workspaces' in str(source) else references
            def request(route, role):
                if route == '/skills':
                    return [{'name': health.NAME, 'enabled': broken != 'disabled', 'channels': ['all']}]
                if route.endswith('/references/crafting.md'):
                    return {'content': 'stale' if broken == 'api' else references['crafting.md']}
                return [{'name': 'lookup_recipe', 'enabled': broken != 'recipe',
                         'input_schema': {'required': ['item_id']}}]
            with patch.object(health, 'GAME_ROLES', ('qd-survivor',)), patch.object(health, 'maid_roles', return_value=()), \
                    patch.object(health, 'skill_references', side_effect=pages):
                self.assertTrue(health.check(root, request)['ok'])
                for broken in ('disk', 'api', 'disabled', 'recipe'):
                    with self.subTest(broken=broken), self.assertRaises(AssertionError):
                        health.check(root, request)


if __name__ == '__main__': unittest.main()
