"""Scoped offline deployment fixtures; no live services or model calls."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('scope_fixture', ROOT / 'tools/sync_survivor_driver_scope.py')
scope = importlib.util.module_from_spec(spec); spec.loader.exec_module(scope)


class ScopeTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        names = [name for name in scope.TOOL_NAMES if name != 'drop_items']
        self.agent = {'id': scope.ROLE, 'workspace_dir': '/state/work/workspaces/' + scope.ROLE,
            'active_model': {'provider_id': 'current-cloud-choice', 'model': 'unchanged'},
            'name': 'Current Kirito', 'custom': {'preserve': 'PRIVATE_FIXTURE'},
            'mcp': {'clients': {scope.DRIVER: {'enabled': True, 'transport': 'streamable_http',
                'url': scope.ENDPOINT, 'headers': {'Authorization': 'Bearer ${SURVIVOR_MCP_TOKEN}'}, 'tools': names},
                'other-driver': {'enabled': True, 'keep': 123}}}}
        self.card = {'name': scope.DRIVER, 'protocol': 'mcp', 'enabled': True,
            'endpoint': {'transport': 'streamable_http', 'url': scope.ENDPOINT,
                'headers': {'Authorization': {'source': 'credential', 'credential': 'survivor_env',
                                              'field': 'value', 'format': 'Bearer {value}'}}},
            'credentials': {'survivor_env': {'kind': 'static', 'ref': 'env:SURVIVOR_MCP_TOKEN'}},
            'config': {'tools': names, 'description': 'Original description'},
            'policy': {'default_effect': 'deny', 'rules': [{'subject': '*', 'effect': 'allow',
                'target': {'kind': 'tool', 'name': name}, 'condition': None,
                'principal': {'source_type': '*', 'source_value': '*', 'subject_type': '*', 'subject_value': '*'}}
                for name in reversed(names)]}}
        self.control = {'schema': 1, 'enabled': False}
        self.controller = {'schema': 1, 'status': 'paused', 'active': None, 'actionExecution': {'inFlight': False}}
        self.state = self.root / 'server/survival-agent-state/survival'
        self.save()
        for name in scope.PERSONAL_FILES:
            (self.root / scope.FOLDER / name).write_bytes(('original bytes PRIVATE_FIXTURE ' + name).encode())
        self.containers = [{'Name': '/qiandengji-' + service + '-1', 'Id': service + '-exact-id',
            'Config': {'Labels': {'com.docker.compose.project': 'qiandengji', 'com.docker.compose.service': service}},
            'State': {'Status': 'exited', 'Running': False, 'Paused': False, 'Restarting': False},
            'Mounts': [{'Type': 'bind', 'Destination': '/state', 'Source': str(self.root / path)}]}
            for service, path in [('qwenpaw', 'server/agents'), ('survivor', 'server/survival-agent-state')]]
        self.calls = []

    def save(self):
        for relative, data in [(scope.FILES[0], self.agent), (scope.FILES[1], self.card),
                (Path('server/survival-agent-state/survival/control.json'), self.control),
                (Path('server/survival-agent-state/survival/controller.json'), self.controller),
                (Path('server/survival-agent-state/survival/lease.json'), {'schema': 1, 'status': 'closed'})]:
            path = self.root / relative; path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, ensure_ascii=False, indent=4) + '\n', encoding='utf8')

    def inspect_runtime(self, command, **kwargs):
        self.calls.append(command)
        self.assertEqual(command, ['docker', 'inspect', 'qiandengji-qwenpaw-1', 'qiandengji-survivor-1'])
        return SimpleNamespace(returncode=0, stdout=json.dumps(self.containers), stderr='')

    def test_default_plan_has_no_writes_or_docker_and_does_not_expose_config(self):
        before = {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result = scope.sync(self.root, run=lambda *a, **kw: self.fail('read-only plan must not inspect runtime'))
        self.assertEqual(result['addedTools'], ['drop_items'])
        self.assertEqual(result['toolCount'], len(scope.TOOL_NAMES))
        self.assertNotIn('PRIVATE_FIXTURE', json.dumps(result))
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_apply_changes_only_tool_leaves_keeps_personas_credentials_and_backups(self):
        before = {str(p.relative_to(self.root)): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result = scope.sync(self.root, apply=True, run=self.inspect_runtime)
        self.assertEqual(result['phase'], 'verified')
        agent = scope.read_document(self.root / scope.FILES[0])[1]
        card = scope.read_document(self.root / scope.FILES[1])[1]
        self.assertEqual(agent['mcp']['clients'][scope.DRIVER]['tools'], list(scope.TOOL_NAMES))
        self.assertEqual(card['config']['tools'], list(scope.TOOL_NAMES))
        self.assertEqual(card['policy']['rules'][:-1], self.card['policy']['rules'])
        self.assertEqual(card['policy']['rules'][-1]['target']['name'], 'drop_items')
        agent['mcp']['clients'][scope.DRIVER]['tools'] = self.agent['mcp']['clients'][scope.DRIVER]['tools']
        self.assertEqual(agent, self.agent)
        card['config']['tools'] = self.card['config']['tools']; card['policy']['rules'] = self.card['policy']['rules']
        self.assertEqual(card, self.card)
        allowed = {str(relative) for relative in scope.FILES}
        for relative, raw in before.items():
            if relative not in allowed: self.assertEqual((self.root / relative).read_bytes(), raw)
        backup = Path(result['backup'])
        self.assertEqual((backup / 'agent.json').read_bytes(), before[str(scope.FILES[0])])
        self.assertEqual((backup / 'numen_survival.yaml').read_bytes(), before[str(scope.FILES[1])])
        second = scope.sync(self.root, apply=True, run=self.inspect_runtime)
        self.assertFalse(second['changed'])
        self.assertEqual(second['changedFiles'], [])
        self.assertEqual(len(list(backup.parent.iterdir())), 1)

    def test_running_or_wrong_container_or_other_state_mount_rejected_before_backup(self):
        original = deepcopy(self.containers)
        for mutate in (lambda c: c[0]['State'].update(Running=True, Status='running'),
                       lambda c: c[1]['Config']['Labels'].update({'com.docker.compose.project': 'other'}),
                       lambda c: c[0]['Mounts'][0].update(Source=str(self.root / 'elsewhere'))):
            self.containers = deepcopy(original); mutate(self.containers)
            with self.assertRaises(ValueError): scope.sync(self.root, apply=True, run=self.inspect_runtime)
            self.assertFalse((self.root / 'runtime').exists())

    def test_active_unknown_inflight_or_open_lease_never_migrates(self):
        for name in ('unknown.json', 'inflight-action.json'):
            path = self.state / name; path.write_text('{}')
            with self.assertRaises(ValueError): scope.sync(self.root, apply=True, run=self.inspect_runtime)
            path.unlink()
        self.controller['active'] = {'taskId': 'old-pending'}; self.save()
        with self.assertRaises(ValueError): scope.sync(self.root, apply=True, run=self.inspect_runtime)
        self.controller['active'] = None; self.save()
        (self.state / 'lease.json').write_text('{"status":"open"}')
        with self.assertRaises(ValueError): scope.sync(self.root, apply=True, run=self.inspect_runtime)
        self.assertFalse((self.root / 'runtime').exists())

    def test_exhausted_lease_from_completed_drain_is_not_an_active_action(self):
        (self.state / 'lease.json').write_text('{"status":"used","actionLimit":6,"actionsUsed":6}')
        self.assertTrue(scope.require_idle(self.root)['paused'])

    def test_masked_credentials_unknown_policy_or_scope_drift_are_not_overwritten(self):
        for target, key, value in ((self.agent['mcp']['clients'][scope.DRIVER], 'headers', {'Authorization': 'MASKED'}),
                                  (self.card['credentials']['survivor_env'], 'ref', 'secret:other'),
                                  (self.card['policy'], 'default_effect', 'allow')):
            old = deepcopy(target[key]); target[key] = value
            with self.assertRaises(ValueError): scope.desired_documents(self.agent, self.card)
            target[key] = old
        self.agent['mcp']['clients'][scope.DRIVER]['tools'] = ['status']
        with self.assertRaises(ValueError): scope.desired_documents(self.agent, self.card)

    def test_known_legacy_and_native_card_difference_is_scoped_to_new_plan_tool(self):
        legacy = [name for name in scope.TOOL_NAMES
                  if name not in {'navigate', 'navigate_plan', 'say', 'say_status'}]
        native = [name for name in scope.TOOL_NAMES if name != 'navigate_plan']
        self.agent['mcp']['clients'][scope.DRIVER]['tools'] = legacy
        self.card['config']['tools'] = native
        self.card['policy']['rules'] = [row for row in self.card['policy']['rules']
                                        if row['target']['name'] in native]
        existing = {row['target']['name'] for row in self.card['policy']['rules']}
        for name in native:
            if name not in existing:
                rule = deepcopy(self.card['policy']['rules'][0])
                rule['target']['name'] = name
                self.card['policy']['rules'].append(rule)
        updated_agent, updated_card, added = scope.desired_documents(self.agent, self.card)
        self.assertEqual(added, ['navigate_plan'])
        self.assertEqual(updated_agent['mcp']['clients'][scope.DRIVER]['tools'], list(scope.TOOL_NAMES))
        self.assertEqual(updated_card['config']['tools'], list(scope.TOOL_NAMES))
        self.assertEqual(len(updated_card['policy']['rules']), len(scope.TOOL_NAMES))

    def test_partial_config_write_rolls_back_exact_original_bytes(self):
        before = [path.read_bytes() for path in (self.root / r for r in scope.FILES)]
        original = scope.atomic_bytes
        failed = False
        def write(path, raw):
            nonlocal failed
            if path == self.root / scope.FILES[1] and not failed:
                failed = True
                raise OSError('fixture second replacement failed')
            original(path, raw)
        with patch.object(scope, 'atomic_bytes', side_effect=write):
            with self.assertRaises(OSError): scope.sync(self.root, apply=True, run=self.inspect_runtime)
        self.assertEqual([path.read_bytes() for path in (self.root / r for r in scope.FILES)], before)
        manifest = next((self.root / 'runtime').rglob('manifest.json'))
        self.assertEqual(json.loads(manifest.read_text())['phase'], 'rolled_back')


if __name__ == '__main__':
    unittest.main()
