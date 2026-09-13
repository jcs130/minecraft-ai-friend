"""Pure selection policy tests: no provider files, Docker, network or credentials."""
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[2] / 'tools' / 'init_qwenpaw.py'
spec = importlib.util.spec_from_file_location('qiandeng_init_for_policy_test', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture():
    return {'project': 'qiandengji', 'profiles': [
        {'id': 'mc-god', 'name': 'God role', 'active_model': {'provider_id': 'cloud-fixture', 'model': 'cloud-model'},
         'provider_kind': 'builtin', 'local_model': False},
        {'id': 'mc-herald', 'name': 'Herald role', 'active_model': {'provider_id': 'local-fixture', 'model': 'local-model'},
         'provider_kind': 'custom', 'local_model': True}]}


class ModelPolicyTest(unittest.TestCase):
    def test_default_uses_cloud_without_changing_roles_and_keeps_restore_choice(self):
        source = fixture()
        selected = module.select_oracle_models(source)
        god, herald = selected['profiles']
        self.assertEqual(herald['name'], 'Herald role')
        self.assertEqual(herald['active_model'], god['active_model'])
        self.assertFalse(herald['local_model'])
        self.assertEqual(herald['source_model_selection']['active_model'], source['profiles'][1]['active_model'])
        self.assertEqual(source, fixture())
        herald['active_model']['model'] = 'changed-fixture'
        self.assertEqual(god['active_model']['model'], 'cloud-model')

    def test_explicit_source_choice_is_required_to_keep_local_herald(self):
        selected = module.select_oracle_models(fixture(), True)
        self.assertEqual(selected['profiles'][1]['active_model']['provider_id'], 'local-fixture')
        self.assertEqual(selected['model_policy'], 'explicit-source-herald-model')

    def test_default_does_not_assume_a_local_god_provider_is_cloud(self):
        source = fixture()
        source['profiles'][0]['local_model'] = True
        with self.assertRaises(ValueError):
            module.select_oracle_models(source)


if __name__ == '__main__':
    unittest.main()
