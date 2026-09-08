"""Validate learning cards through the installed Qwen 2.2 native YAML contract."""
from contextlib import ExitStack
from copy import deepcopy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
import role_learning_profiles as profiles

try:
    from qwenpaw.drivers.contracts import DriverCard
    from qwenpaw.drivers.storage import dump_card, load_card
    NATIVE = True
except ImportError:
    NATIVE = False


@unittest.skipUnless(NATIVE, 'Requires the pinned QwenPaw 2.2 runtime image')
class NativeLearningCardTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.role, self.runtime = 'mc-herald', 'operations'
        self.folder = self.root / self.role; self.folder.mkdir()
        self.path = self.folder / 'drivers/mcp/qd_learning.yaml'
        self.path.parent.mkdir(parents=True)
        (self.folder / 'agent.json').write_text('{}')
        (self.folder / 'jobs.json').write_text('{}')
        self.raw = profiles.learning_card(self.role, self.runtime)
        stack = self.enterContext(ExitStack())
        # These contracts have their own suites; exercise the actual native
        # storage parser and final workspace card validation without skill IO.
        stack.enter_context(patch.object(profiles, 'validate_learning_profile'))
        stack.enter_context(patch.object(profiles, 'validate_jobs'))
        stack.enter_context(patch.object(profiles, 'validate_role_skills', return_value={'required': 6}))

    def check(self):
        return profiles.validate_learning_workspace(self.folder, self.role, self.runtime)

    def save(self, value=None):
        dump_card(DriverCard(**(self.raw if value is None else value)), self.path)

    def test_initial_json_and_native_yaml_rewrite_are_equivalent(self):
        self.path.write_text(json.dumps(self.raw, ensure_ascii=False), encoding='utf8')
        self.assertEqual(self.check(), {'required': 6})
        dump_card(load_card(self.path), self.path)
        self.assertFalse(self.path.read_text(encoding='utf8').lstrip().startswith('{'))
        self.assertEqual(self.check(), {'required': 6})

    def test_official_console_builder_relabels_only_to_canonical_driver_name(self):
        from qwenpaw.app.mcp.schemas import MCPClientUpdateRequest
        from qwenpaw.drivers.adapters.mcp_card_builder import build_mcp_driver_card
        original = DriverCard(**self.raw)
        client = MCPClientUpdateRequest.model_validate(profiles.learning_client(self.role, self.runtime))
        updated = build_mcp_driver_card('qd_learning', client, 'unused-no-credentials', existing=original)
        self.assertEqual(updated.config['display_name'], 'qd_learning')
        self.assertEqual(updated.config['description'], original.config['description'])
        self.assertEqual(updated.policy, original.policy)
        self.assertEqual(updated.endpoint, original.endpoint)
        self.assertEqual(updated.credentials, {})
        dump_card(updated, self.path)
        self.assertEqual(self.check(), {'required': 6})

    def test_unknown_display_names_are_not_treated_as_native_compatibility(self):
        for name in ('', 'another-driver', 'qd-learning', 'qd_learning ', 'untrusted title'):
            row = deepcopy(self.raw); row['config']['display_name'] = name
            with self.subTest(name=name):
                self.save(row)
                with self.assertRaises(AssertionError): self.check()

    def test_every_operations_role_retains_its_native_endpoint_and_rules(self):
        for role in profiles.OPS_ROLES:
            with self.subTest(role=role):
                self.role = role
                self.save(profiles.learning_card(role, self.runtime))
                self.check()

    def test_native_tools_mirror_accepts_only_exact_unordered_whitelist(self):
        self.raw['config']['tools'] = list(reversed(profiles.TOOL_NAMES))
        self.save(); self.check()
        for tools in ([], list(profiles.TOOL_NAMES[:-1]), list(profiles.TOOL_NAMES)+[profiles.TOOL_NAMES[0]],
                      ['*'], list(profiles.TOOL_NAMES[:-1])+['arbitrary_shell'], 'learning_status'):
            with self.subTest(tools=tools):
                row = deepcopy(self.raw); row['config']['tools'] = tools
                self.save(row)
                with self.assertRaises(AssertionError): self.check()

    def test_policy_default_effect_and_each_exact_rule_remain_required(self):
        for change in ('allow-default', 'missing', 'duplicate', 'target', 'deny-rule', 'scope'):
            with self.subTest(change=change):
                row = deepcopy(self.raw)
                rules = row['policy']['rules']
                if change == 'allow-default': row['policy']['default_effect'] = 'allow'
                elif change == 'missing': rules.pop()
                elif change == 'duplicate': rules.append(deepcopy(rules[0]))
                elif change == 'target': rules[0]['target']['name'] = '*'
                elif change == 'deny-rule': rules[0]['effect'] = 'deny'
                else: rules[0]['subject'] = 'another-principal'
                self.save(row)
                with self.assertRaises(AssertionError): self.check()

    def test_native_policy_rule_sorting_preserves_the_exact_permission_contract(self):
        self.raw['policy']['rules'].sort(key=lambda rule: rule['target']['name'])
        self.save(); self.check()
        self.raw['policy']['rules'].reverse()
        self.save(); self.check()
        # Canonical sorting cannot make duplicate or principal changes valid.
        self.raw['policy']['rules'][0] = deepcopy(self.raw['policy']['rules'][1])
        self.save()
        with self.assertRaises(AssertionError): self.check()

    def test_endpoint_role_runtime_and_extra_environment_do_not_drift(self):
        for change in ('role', 'runtime', 'environment', 'extra-endpoint'):
            row = deepcopy(self.raw)
            if change == 'role': row['endpoint']['args'][2] = 'mc-god'
            elif change == 'runtime': row['endpoint']['args'][4] = 'game'
            elif change == 'environment': row['endpoint']['env']['OTHER'] = 'fixture'
            else: row['endpoint']['cwd'] = '/production'
            with self.subTest(change=change):
                self.save(row)
                with self.assertRaises(AssertionError): self.check()

    def test_credentials_enabled_and_unknown_config_are_not_ignored(self):
        for change in ('credential', 'enabled', 'metadata', 'extra'):
            row = deepcopy(self.raw)
            if change == 'credential': row['credentials'] = {'fixture': {'kind': 'env', 'ref': 'FIXTURE_UNUSED_CREDENTIAL'}}
            elif change == 'enabled': row['enabled'] = False
            elif change == 'metadata': row['config']['description'] = 'changed'
            else: row['config']['unknown_override'] = True
            with self.subTest(change=change):
                self.save(row)
                with self.assertRaises(AssertionError): self.check()

    def test_oversized_file_is_rejected_before_native_parse(self):
        self.path.write_bytes(b' ' * 262145)
        with patch('qwenpaw.drivers.storage.load_card') as parser:
            with self.assertRaises(AssertionError): self.check()
            parser.assert_not_called()

    def test_linked_card_is_rejected_before_native_parse(self):
        target = self.root / 'real.yaml'
        dump_card(DriverCard(**self.raw), target)
        try: self.path.symlink_to(target)
        except OSError: self.skipTest('symlink creation unavailable in this environment')
        with patch('qwenpaw.drivers.storage.load_card') as parser:
            with self.assertRaises(AssertionError): self.check()
            parser.assert_not_called()


if __name__ == '__main__': unittest.main()
