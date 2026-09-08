"""Native profile language contracts; no live API, task or model calls."""
from copy import deepcopy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
with patch.dict(os.environ):
    import configure_world_team as team
import init_qwenpaw as init

HAS_QWEN = importlib.util.find_spec('qwenpaw') is not None


class TeamLanguageTests(unittest.TestCase):
    def test_partial_update_keeps_language_without_importing_unrelated_fields(self):
        for language in ('zh', 'en', 'zh-CN'):
            with self.subTest(language=language):
                before = {'id': 'mc-god', 'name': 'old', 'language': language,
                          'active_model': {'provider_id': 'keep', 'model': 'keep'},
                          'opaque': {'keep': [1, 2]}}
                saved = deepcopy(before)
                payload = team.agent_update(before, name='new', mcp={'clients': {}})
                self.assertEqual(payload, {'id': 'mc-god', 'name': 'new',
                    'language': language, 'mcp': {'clients': {}}})
                self.assertEqual(before, saved)

    def test_missing_or_blank_language_does_not_silently_choose_a_default(self):
        for language in (None, '', '  ', 1):
            with self.subTest(language=language), self.assertRaises(ValueError):
                team.agent_update({'id': 'mc-god', 'name': 'old', 'language': language})
        with self.assertRaises(KeyError):
            team.agent_update({'id': 'mc-god', 'name': 'old'})

    def test_cannot_override_identity_or_language_through_partial_changes(self):
        before = {'id': 'mc-god', 'name': 'old', 'language': 'zh'}
        for changes in ({'id': 'another'}, {'language': 'en'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                team.agent_update(before, **changes)

    @unittest.skipUnless(HAS_QWEN, 'native Qwen schema required')
    def test_real_native_agent_schema_accepts_explicit_language_for_both_put_paths(self):
        from qwenpaw.config.config import AgentProfileConfig
        before = AgentProfileConfig(id='mc-god', name='old', language='en').model_dump(mode='json')
        for changes in ({'name': 'new', 'tools': before['tools'], 'security': before['security'],
                         'approval_level': before['approval_level']}, {'mcp': before['mcp']}):
            payload = team.agent_update(before, **changes)
            native = AgentProfileConfig.model_validate(payload)
            self.assertEqual(native.language, 'en')
            self.assertEqual(native.model_fields_set, set(payload))
            # This is the native route's partial-update contract, not a full
            # profile replacement importing constructor defaults.
            merged = deepcopy(before)
            merged.update(native.model_dump(mode='json', exclude_unset=True))
            self.assertEqual(merged['language'], before['language'])
            for key in ('active_model', 'fallback_models', 'running', 'workspace_dir'):
                self.assertEqual(merged[key], before[key])

    def test_new_project_manifest_selects_chinese_without_copying_source_tools(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, secret, target = root / 'source', root / 'secret', root / 'target'
            for role in init.PROFILES:
                folder = source / 'workspaces' / role
                folder.mkdir(parents=True)
                (folder / 'agent.json').write_text(json.dumps({
                    'active_model': {'provider_id': 'fixture', 'model': 'fixture-model'},
                    'language': 'en', 'tools': {'untrusted': True}}), encoding='utf-8')
            provider = secret / 'providers/custom/fixture.json'
            provider.parent.mkdir(parents=True)
            provider.write_text(json.dumps({'base_url': 'https://example.invalid/v1',
                'chat_model': 'OpenAIChatModel', 'api_key': ''}), encoding='utf-8')
            args = type('Args', (), {'source_work': str(source), 'source_secret': str(secret),
                                    'use_source_herald_model': False})()
            completed = subprocess.CompletedProcess([], 0, json.dumps({'project': 'qiandengji', 'ok': True}), '')
            with patch.object(init, 'TARGET', target), patch.object(init.subprocess, 'run', return_value=completed), patch('builtins.print'):
                init.prepare(args)
            manifest = json.loads((target / 'init-manifest.json').read_text(encoding='utf-8'))
            self.assertEqual({row['id'] for row in manifest['profiles']}, set(init.PROFILES))
            self.assertTrue(all(row['language'] == 'zh' for row in manifest['profiles']))
            self.assertTrue(all('tools' not in row for row in manifest['profiles']))


if __name__ == '__main__':
    unittest.main()
