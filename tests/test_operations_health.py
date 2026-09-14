"""Operations health never reuses a green snapshot after collection failure."""
from contextlib import ExitStack, nullcontext, redirect_stdout
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]/'world/ops/health/health_mon.py'
spec = importlib.util.spec_from_file_location('operations_health', SOURCE)
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class OperationsHealth(unittest.TestCase):
    NOW = 1_788_782_400.0

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='qd-operations-health-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.path = self.root/'server/panel-state/operations.json'
        self.events = []
        self.source = {'schema': 1, 'project': 'qiandengji', 'generatedAt': self.iso(self.NOW-1.123456),
            'runtimes': [{'id': name, 'label': name, 'kind': 'host' if name == 'host' else 'container',
                          'version': None, 'endpoint': None, 'state': 'unverified', 'purpose': 'fixture',
                          'enabledAgentCount': None, 'agentCount': None} for name in ('qiandengji', 'qiandengji-ops', 'shadow', 'host')],
            'agents': [{'id': name, 'label': name, 'runtimeId': 'qiandengji', 'enabled': True,
                        'role': 'fixture', 'modelProvider': None, 'model': None, 'toolCount': 0,
                        'mcpCount': 1 if name == 'qd-survivor' else 0, 'jobCount': None}
                       for name in ('mc-god', 'mc-herald', 'qd-survivor')],
            'services': [{'id': name, 'label': name, 'group': 'shared' if name == 'shared-tts' else 'game',
                          'container': 'shadow-tts' if name == 'shared-tts' else 'qiandengji-'+name+'-1',
                          'state': 'running', 'health': 'healthy', 'purpose': 'fixture', 'managedBy': 'fixture',
                          'dependencies': ['shared-tts'] if name == 'voice' else []} for name in (*health.MANIFEST, 'shared-tts')],
            'issues': [], 'commands': [{'label': 'status', 'command': 'python tools/operations.py status'}],
            'checks': {'currentServices': True, 'sharedTts': {'ok': True, 'endpoint': 'http://127.0.0.1:8100/health'}}}
        self.source['agents'].extend({'id': name, 'label': name, 'runtimeId': 'qiandengji-ops', 'enabled': True,
            'role': 'fixture', 'modelProvider': None, 'model': None, 'toolCount': 0, 'mcpCount': 1, 'jobCount': 0}
            for name in health.OPERATIONS_TEAM_ROLES)
        self.adapter = SimpleNamespace(collect_snapshot=self.collect, write_snapshot=self.write)
        for patcher in (patch.object(health, 'PROJECT', self.root), patch.object(health.time, 'time', return_value=self.NOW),
                        patch.object(health, 'OPERATIONS_COLLECTION', None),
                        patch.object(health, 'load_operations_adapter', return_value=self.adapter),
                        patch.object(health, 'load_inventory_lock', return_value=lambda *a, **kw: nullcontext(True)),
                        patch.object(health.subprocess, 'run', side_effect=AssertionError('No Docker in health tests')),
                        patch.object(health.urllib.request, 'urlopen', side_effect=AssertionError('No HTTP in health tests'))):
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def iso(seconds):
        return datetime.fromtimestamp(seconds, timezone.utc).isoformat()

    def collect(self, *, root):
        self.assertEqual(root, self.root)
        self.events.append('collect')
        return deepcopy(self.source)

    def write(self, value, *, root):
        self.assertEqual(root, self.root)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(value), encoding='utf-8')
        self.events.append('write')

    def public(self):
        result = {key: deepcopy(self.source[key]) for key in ('schema', 'project', *health.OPERATIONS_FIELDS)}
        stamp = health.operations_time(self.source['generatedAt'])
        result.update({'generatedAt': stamp.replace(microsecond=stamp.microsecond//1000*1000).isoformat(),
                       'available': True, 'stale': False, 'staleReason': None, 'ageSeconds': 2, 'ttlSeconds': 300})
        result.update({name: deepcopy(self.source.get(name)) for name in health.OPERATIONS_TEAM_FIELDS})
        return result

    def refresh(self):
        return health.refresh_operations_snapshot()

    def probe(self, value=None):
        return health.probe_operations(self.public() if value is None else value)

    def run_offline_main(self):
        with ExitStack() as stack, redirect_stdout(io.StringIO()):
            for name in ('probe_recorded_behavior', 'probe_extension_files', 'probe_architecture',
                         'probe_panel_smoke', 'probe_statusbook', 'probe_content_files', 'probe_guild'):
                stack.enter_context(patch.object(health, name, return_value={'ok': True}))
            def services():
                self.events.append('services')
                return {'ok': True, 'checks': {}}
            stack.enter_context(patch.object(health, 'probe_services', side_effect=services))
            (self.root/'reports').mkdir(exist_ok=True)
            return health.main()

    def test_current_collection_and_strict_public_projection_pass_with_microsecond_source(self):
        result = self.refresh()
        self.assertTrue(result['ok'])
        self.assertEqual(self.events, ['collect', 'write'])
        result = self.probe()
        for key in ('ok', 'same_collection', 'runtimes', 'agents', 'services', 'current_services', 'shared_tts'):
            self.assertTrue(result[key], key)

    def test_main_collects_before_other_probes_and_shared_tts_failure_turns_overall_red(self):
        self.source['checks']['sharedTts']['ok'] = False
        self.assertEqual(self.run_offline_main(), 1)
        self.assertEqual(self.events[:3], ['collect', 'write', 'services'])
        report = json.loads((self.root/'reports/runtime-health.json').read_text('utf-8'))
        self.assertFalse(report['ok']); self.assertTrue(report['services']['ok'])
        self.assertFalse(report['operations_inventory']['shared_tts'])
        public = json.loads((self.root/'server/panel-state/health.json').read_text('utf-8'))
        self.assertFalse(public['ok']); self.assertFalse(public['services']['shared-tts']['ok'])

    def test_busy_health_waits_ten_seconds_and_publishes_failure_without_collecting(self):
        self.run_offline_main()
        self.events.clear()
        def busy(root, wait_seconds):
            self.assertEqual(root, self.root)
            self.assertEqual(wait_seconds, 10)
            return nullcontext(False)
        with patch.object(health, 'load_inventory_lock', return_value=busy):
            self.assertEqual(self.run_offline_main(), 1)
        self.assertEqual(self.events, [])
        report = json.loads((self.root/'reports/runtime-health.json').read_text('utf-8'))
        public = json.loads((self.root/'server/panel-state/health.json').read_text('utf-8'))
        self.assertFalse(report['ok']); self.assertFalse(public['ok'])
        self.assertEqual(report['operations_inventory']['reason'], 'inventory_busy')
        self.assertTrue(public['retry'])
        self.assertFalse(health.OPERATIONS_COLLECTION['collected'])

    def test_missing_lock_helper_never_runs_unprotected_or_preserves_previous_green(self):
        self.run_offline_main()
        self.events.clear()
        with patch.object(health, 'load_inventory_lock', side_effect=ImportError('PRIVATE')):
            self.assertEqual(self.run_offline_main(), 1)
        self.assertEqual(self.events, [])
        result = (self.root/'reports/runtime-health.json').read_text('utf-8')
        self.assertNotIn('PRIVATE', result)
        self.assertFalse(json.loads(result)['ok'])
        self.assertEqual(json.loads(result)['operations_inventory']['reason'], 'inventory_lock_unavailable')

    def test_collector_failure_overwrites_old_success_and_never_returns_its_evidence(self):
        self.refresh()
        old = self.public()
        self.adapter.collect_snapshot = lambda **_: (_ for _ in ()).throw(RuntimeError('PRIVATE_ERROR_DETAIL'))
        result = self.refresh()
        self.assertFalse(result['ok']); self.assertFalse(result['collected'])
        self.assertNotIn('PRIVATE_ERROR_DETAIL', json.dumps(result))
        current = json.loads(self.path.read_text('utf-8'))
        self.assertEqual(current['runtimes'], [])
        self.assertFalse(current['checks']['currentServices'])
        self.assertEqual(current['issues'][0]['severity'], 'error')
        self.assertFalse(self.probe(old)['ok'])
        self.assertEqual(self.run_offline_main(), 1)

    def test_no_collection_in_this_run_cannot_accept_a_fresh_historical_snapshot(self):
        self.write(self.source, root=self.root)
        self.assertFalse(self.probe()['ok'])

    def test_bad_collector_identity_or_time_publishes_failure(self):
        original = deepcopy(self.source)
        for change in ({'schema': True}, {'schema': 2}, {'project': 'shadow'}, {'generatedAt': self.iso(self.NOW+1)},
                       {'generatedAt': self.iso(self.NOW-301)}, {'generatedAt': '2026-09-07T12:00:00'}, {'checks': None}):
            with self.subTest(change=change):
                self.source = {**original, **change}
                result = self.refresh()
                self.assertFalse(result['ok']); self.assertFalse(result['collected'])

    def test_writer_must_publish_exactly_the_collected_snapshot(self):
        self.adapter.write_snapshot = lambda value, **_: self.write({**value, 'scope': 'a different run'}, root=self.root)
        result = self.refresh()
        self.assertFalse(result['ok']); self.assertFalse(result['collected'])

    def test_failed_publication_is_explicit_and_cannot_fall_back_to_old_success(self):
        self.refresh()
        old = self.public()
        self.adapter.write_snapshot = lambda *a, **k: (_ for _ in ()).throw(OSError('write failed'))
        with patch.object(Path, 'write_text', side_effect=OSError('No writes')):
            result = self.refresh()
        self.assertFalse(result['ok']); self.assertTrue(result['publication_failed'])
        self.assertFalse(self.probe(old)['ok'])

    def test_public_contract_rejects_extra_config_and_sensitive_fields_everywhere(self):
        self.refresh()
        for key in ('token', 'checks', 'config', 'secret', 'sourceConfig'):
            public = self.public(); public[key] = 'PRIVATE'
            self.assertFalse(self.probe(public)['ok'])
        for collection in health.OPERATIONS_FIELDS:
            public = self.public()
            if not public[collection]:
                public[collection].append({'code': 'fixture', 'severity': 'info', 'title': 'fixture', 'detail': None})
            public[collection][0]['token'] = 'PRIVATE'
            self.assertFalse(self.probe(public)['ok'])

    @staticmethod
    def team_summary():
        usage = {'modelCalls': 1, 'promptTokens': 120, 'completionTokens': 0, 'elapsedSeconds': 1.25}
        return {
            'teamPolicy': {'packageVersion': '2.2.0', 'mode': 'manual', 'maxConcurrentModels': 1,
                'maxQueriesPerMinute': 6, 'maxIterations': 5, 'automaticRetries': False,
                'delegationCooldownSeconds': 1800, 'maxDelegationsPerDay': 4, 'scheduledJobs': 0,
                'heartbeat': False, 'roleSkills': {role: ['qd-evidence-report'] for role in health.OPERATIONS_TEAM_ROLES}},
            'teamUsage': {'callCount': 1, 'promptTokens': 120, 'completionTokens': 0, 'cachedTokens': None,
                          'window': 'today', 'generatedAt': '2026-09-08T00:00:00+08:00'},
            'teamRound': {'runId': 'fixture-round', 'ok': True, 'finishedAt': '2026-09-08T00:00:00+08:00',
                'mode': 'manual', **usage, 'roles': [{'role': role, 'ok': True, 'requestId': 'fixture-'+role,
                    'summary': '资料已记录，现场效果待验', 'errorType': None, **usage} for role in health.OPERATIONS_TEAM_ROLES]},
        }

    def test_nullable_and_complete_team_projection_are_accepted(self):
        self.refresh()
        self.assertTrue(self.probe()['ok'])
        self.source.update(self.team_summary())
        self.refresh()
        self.assertTrue(self.probe()['ok'])
        value = self.public()
        for name, fields in health.OPERATIONS_TEAM_FIELDS.items():
            for field, kind in fields.items():
                if kind not in ('bool', 'manual', 'role', 'roles', 'role_skills'):
                    value[name][field] = None
        value['teamPolicy']['roleSkills'] = {role: None for role in health.OPERATIONS_TEAM_ROLES}
        value['teamRound']['roles'] = []
        value['teamRound']['ok'] = False  # A previous failed round is data, not a live runtime check.
        self.assertTrue(self.probe(value)['ok'])

    def test_team_projection_rejects_unknown_fields_at_every_nested_level(self):
        self.source.update(self.team_summary()); self.refresh()
        paths = [('teamPolicy',), ('teamPolicy', 'roleSkills'), ('teamUsage',),
                 ('teamRound',), ('teamRound', 'roles', 0)]
        for path in paths:
            value = self.public(); target = value
            for key in path: target = target[key]
            target['secret'] = 'PRIVATE'
            self.assertFalse(self.probe(value)['ok'], path)
        for name in health.OPERATIONS_TEAM_FIELDS:
            for bad in ([], True, 'PRIVATE', {}):
                value = self.public(); value[name] = bad
                self.assertFalse(self.probe(value)['ok'], (name, bad))
            value = self.public(); value.pop(name)
            self.assertFalse(self.probe(value)['ok'])

    def test_team_counts_booleans_enums_and_roles_are_not_coerced(self):
        self.source.update(self.team_summary()); self.refresh()
        cases = [(('teamUsage', 'callCount'), bad) for bad in (True, -1, 1.5, '1', 9_007_199_254_740_992)]
        cases += [(('teamRound', 'elapsedSeconds'), bad) for bad in (True, -0.1, float('nan'), float('inf'))]
        cases += [(('teamPolicy', 'automaticRetries'), 0), (('teamPolicy', 'mode'), 'automatic'),
                  (('teamUsage', 'window'), 'all'), (('teamRound', 'mode'), None),
                  (('teamRound', 'ok'), 1), (('teamRound', 'roles', 0, 'role'), 'foreign-agent'),
                  (('teamRound', 'roles', 0, 'ok'), None),
                  (('teamRound', 'roles', 0, 'summary'), {'text': 'PRIVATE'})]
        for path, bad in cases:
            value = self.public(); target = value
            for key in path[:-1]: target = target[key]
            target[path[-1]] = bad
            self.assertFalse(self.probe(value)['ok'], path)

    def test_team_strings_and_collections_have_projection_bounds(self):
        self.source.update(self.team_summary()); self.refresh()
        value = self.public()
        value['teamRound']['runId'] = '😀'*50
        value['teamRound']['roles'][0]['summary'] = '文'*1600
        value['teamUsage']['callCount'] = 9_007_199_254_740_991
        self.assertTrue(self.probe(value)['ok'])
        for path, bad in [(('teamRound', 'runId'), '😀'*51),
                          (('teamRound', 'roles', 0, 'summary'), '文'*1601),
                          (('teamPolicy', 'packageVersion'), 'x'*41),
                          (('teamUsage', 'generatedAt'), 'x'*65),
                          (('teamPolicy', 'roleSkills', 'default'), ['s']*13),
                          (('teamPolicy', 'roleSkills', 'default'), ['s'*101]),
                          (('teamPolicy', 'roleSkills', 'default'), [{'script': 'PRIVATE'}])]:
            value = self.public(); target = value
            for key in path[:-1]: target = target[key]
            target[path[-1]] = bad
            self.assertFalse(self.probe(value)['ok'], path)
        value = self.public(); value['teamRound']['roles'] *= 2
        self.assertFalse(self.probe(value)['ok'])
        value = self.public(); value['teamPolicy']['roleSkills'].pop('default')
        self.assertFalse(self.probe(value)['ok'])

    def test_unknown_runtime_and_missing_or_duplicate_agent_service_ids_are_rejected(self):
        self.refresh()
        values = []
        for name in ('runtimes', 'agents', 'services'):
            value = self.public(); value[name] = value[name][1:]; values.append(value)
            value = self.public(); value[name].append(deepcopy(value[name][0])); values.append(value)
        value = self.public(); value['agents'][0]['runtimeId'] = 'unregistered'; values.append(value)
        value = self.public(); value['runtimes'][0]['id'] = 'foreign'; values.append(value)
        for value in values:
            self.assertFalse(self.probe(value)['ok'])

    def test_operations_runtime_and_all_six_project_roles_are_required_in_inventory(self):
        self.refresh()
        for role in health.OPERATIONS_TEAM_ROLES:
            value = self.public()
            value['agents'] = [row for row in value['agents']
                               if (row['runtimeId'], row['id']) != ('qiandengji-ops', role)]
            self.assertFalse(self.probe(value)['ok'])
        value = self.public()
        value['runtimes'] = [row for row in value['runtimes'] if row['id'] != 'qiandengji-ops']
        self.assertFalse(self.probe(value)['ok'])

    def test_public_scalar_types_and_safe_endpoints_are_required(self):
        self.refresh()
        for collection, key, bad in [('agents', 'enabled', 1), ('agents', 'toolCount', True),
                                     ('agents', 'jobCount', -1), ('agents', 'mcpCount', 1.0),
                                     ('services', 'dependencies', [{}]), ('runtimes', 'label', {})]:
            value = self.public(); value[collection][0][key] = bad
            self.assertFalse(self.probe(value)['ok'])
        for endpoint in ('file:///private', 'javascript:alert(1)', 'http://user:secret@localhost',
                         'http://localhost?token=PRIVATE', 'https://localhost/#PRIVATE', 'http://localhost:65536', 'http://localhost:0'):
            value = self.public(); value['runtimes'][0]['endpoint'] = endpoint
            self.assertFalse(self.probe(value)['ok'])
        value = self.public(); value['runtimes'][0]['endpoint'] = 'http://127.0.0.1:18089/'
        self.assertTrue(self.probe(value)['ok'])

    def test_public_timestamp_must_be_current_and_match_the_actual_collection(self):
        self.refresh()
        for change in ({'generatedAt': self.iso(self.NOW-2)}, {'generatedAt': self.iso(self.NOW+1)},
                       {'generatedAt': '2026-09-07T12:00:00'}, {'available': 1}, {'stale': True},
                       {'staleReason': 'expired'}, {'schema': True}, {'project': 'shadow'}, {'ttlSeconds': 299},
                       {'ttlSeconds': 300.0}, {'ageSeconds': True}, {'ageSeconds': -1}, {'ageSeconds': 301},
                       {'ageSeconds': float('nan')}):
            self.assertFalse(self.probe({**self.public(), **change})['ok'])
        with patch.object(health.time, 'time', return_value=self.NOW+301):
            self.assertFalse(self.probe()['ok'])

    def test_current_services_and_actual_shared_health_require_exact_success_values(self):
        for bad in (False, 1, 'true', None):
            self.source['checks']['currentServices'] = bad
            self.refresh()
            self.assertFalse(self.probe()['ok'])
        self.source['checks']['currentServices'] = True
        for bad in (False, 1, 'true', None):
            self.source['checks']['sharedTts']['ok'] = bad
            self.refresh()
            self.assertFalse(self.probe()['ok'])
        self.source['checks']['sharedTts'] = {'ok': True, 'endpoint': 'http://127.0.0.1:9999/health'}
        self.refresh(); self.assertFalse(self.probe()['ok'])

    def test_changed_deleted_or_oversized_snapshot_cannot_reuse_collection_receipt(self):
        self.refresh()
        original = self.path.read_bytes()
        for raw in (b'{partial', original+b'\n', b'x'*(2*1024*1024+1)):
            self.path.write_bytes(raw)
            self.assertFalse(self.probe()['ok'])
        self.path.unlink(); self.assertFalse(self.probe()['ok'])

    def test_http_and_panel_smoke_require_valid_operations_even_when_other_statuses_pass(self):
        self.refresh()
        state = {'available': True, 'stale': False, 'world': {'stale': False},
                 'npc': {'stale': False, 'llmEnabled': False}, 'guild': {'pollingOk': True},
                 'skills': {'available': True}, 'agent': {'id': 'qwenpaw'}, 'operations': self.public()}
        def read(url, **kwargs):
            return io.StringIO(json.dumps({'ok': True, 'service': 'qiandengji-panel'} if url.endswith('/healthz') else state))
        with patch.object(health.urllib.request, 'urlopen', side_effect=read), ExitStack() as stack:
            for name in ('probe_management', 'probe_recorded_behavior', 'probe_source_record', 'probe_player_commands', 'probe_voice_commands',
                         'probe_chanting_staff', 'probe_voice_recording', 'probe_voice_boundary_deployment',
                         'probe_skillbar_editor', 'probe_chanting_client', 'probe_operations_team', 'probe_game_qwenpaw', 'probe_survivor', 'probe_model_routing', 'probe_survivor_party', 'probe_world_team'):
                stack.enter_context(patch.object(health, name, return_value={'ok': True}))
            self.assertTrue(health.probe_panel_smoke()['ok'])
            state.pop('operations')
            result = health.probe_panel_smoke()
            self.assertFalse(result['ok']); self.assertFalse(result['operations']['ok'])

    def test_project_tools_import_path_exists_only_during_collection(self):
        before = list(sys.path)
        def collect(**kwargs):
            self.assertEqual(sys.path[0], str(self.root/'tools'))
            return deepcopy(self.source)
        self.adapter.collect_snapshot = collect
        self.assertTrue(self.refresh()['ok'])
        self.assertEqual(sys.path, before)
        self.adapter.collect_snapshot = lambda **_: (_ for _ in ()).throw(ImportError('inventory failed'))
        self.assertFalse(self.refresh()['ok'])
        self.assertEqual(sys.path, before)


class OperationsTeamProbe(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='qd-operations-team-health-')
        self.root = Path(temporary.name).resolve()
        def cleanup():
            if (not self.root.is_relative_to(Path(tempfile.gettempdir()).resolve())
                    or not self.root.name.startswith('qd-operations-team-health-')):
                raise AssertionError('Unsafe temporary cleanup target')
            temporary.cleanup()
        self.addCleanup(cleanup)
        self.report_path = self.root/'reports/operations-team-smoke.json'
        self.report_path.parent.mkdir()
        self.now = 1_788_782_400.0
        self.receipt = {'ok': True, 'project': 'qiandengji-ops', 'packageVersion': '2.2.0', 'roles': 6,
            'authEnforced': False, 'authEnabled': False, 'authMode': 'local-passwordless',
            'anonymousAccess': True, 'installedSkillBindings': 36, 'rateLimitVerified': True,
            'driverPolicyVerified': True, 'builtinTools': 7, 'managedWeeklyJobs': 6, 'nativeToolPolicyVerified': True,
            'unmanagedAutomaticJobs': 0, 'cronBudgetGuardVerified': True}
        self.report = {'schema': 1, 'project': 'qiandengji', 'ok': True,
            'finishedAt': datetime.fromtimestamp(self.now-60, timezone.utc).isoformat(),
            'checks': [{'name': name, 'ok': True} for name in health.OPERATIONS_TEAM_SMOKE_CHECKS]}
        self.write_report()
        for patcher in (patch.object(health, 'PROJECT', self.root),
                        patch.object(health.time, 'time', return_value=self.now),
                        patch.object(health.urllib.request, 'urlopen', side_effect=AssertionError('No HTTP or model calls'))):
            patcher.start(); self.addCleanup(patcher.stop)

    def write_report(self, value=None):
        self.report_path.write_text(json.dumps(self.report if value is None else value), encoding='utf-8')

    def probe(self, receipt=None, *, output=None, returncode=0, exception=None):
        output = json.dumps(self.receipt if receipt is None else receipt) if output is None else output
        result = SimpleNamespace(returncode=returncode, stdout=output, stderr='PRIVATE_DIAGNOSTIC')
        with patch.object(health.subprocess, 'run', return_value=result, side_effect=exception) as run:
            value = health.probe_operations_team()
        self.assertNotIn('PRIVATE', json.dumps(value))
        return value, run

    def test_fixed_runtime_probe_and_complete_actual_behavior_contract(self):
        value, run = self.probe(output='startup log\n'+json.dumps({**self.receipt, 'private': 'PRIVATE_SECRET'}))
        self.assertTrue(value['ok']); self.assertTrue(value['live']); self.assertTrue(value['behavior']['ok'])
        self.assertEqual(run.call_args.args[0], ['docker', 'exec', 'qiandengji-qwenpaw-ops-1',
                         'python', '/ops/operations_team_health.py'])
        self.assertEqual(run.call_args.kwargs['timeout'], 60)
        self.assertEqual(run.call_args.kwargs['creationflags'], getattr(health.subprocess, 'CREATE_NO_WINDOW', 0))
        self.assertTrue(health.MANIFEST['qwenpaw-ops']['health_required'])

    def test_old_version_wrong_scope_counts_or_missing_guards_never_pass(self):
        changes = [{'packageVersion': '2.1.0'}, {'project': 'shadow'}, {'roles': 5}, {'roles': 6.0},
                   {'installedSkillBindings': 11}, {'installedSkillBindings': '12'}, {'builtinTools': False},
                   {'builtinTools': 1}, {'managedWeeklyJobs': 0}, {'unmanagedAutomaticJobs': 1},
                   {'unmanagedAutomaticJobs': False}, {'cronBudgetGuardVerified': False}, {'ok': 1}]
        changes.extend({'authMode': bad} for bad in ('authenticated', 'local', None))
        for key in ('authEnforced', 'authEnabled'):
            changes.extend({key: bad} for bad in (True, 0, None, 'false'))
        for key in ('anonymousAccess', 'rateLimitVerified', 'driverPolicyVerified', 'nativeToolPolicyVerified'):
            changes.extend({key: bad} for bad in (False, 1, None, 'true'))
        for change in changes:
            with self.subTest(change=change):
                value, _ = self.probe({**self.receipt, **change})
                self.assertFalse(value['ok']); self.assertFalse(value['live'])
                self.assertTrue(value['behavior']['ok'])

    def test_failed_process_timeout_and_invalid_output_cannot_reuse_green_report(self):
        cases = [{'returncode': 1}, {'output': ''}, {'output': 'PRIVATE not JSON'}, {'output': '[]'},
                 {'output': json.dumps(self.receipt)+'\ntrailing garbage'}, {'output': 'x'*65537},
                 {'exception': OSError('PRIVATE')},
                 {'exception': health.subprocess.TimeoutExpired('PRIVATE', 60)}]
        for kwargs in cases:
            with self.subTest(kwargs=tuple(kwargs)):
                value, _ = self.probe(**kwargs)
                self.assertFalse(value['ok']); self.assertFalse(value['live'])

    def test_live_runtime_cannot_replace_missing_or_partial_behavior_evidence(self):
        self.report_path.unlink()
        value, _ = self.probe()
        self.assertTrue(value['live']); self.assertFalse(value['ok'])
        self.assertEqual(value['behavior']['missing_checks'], list(health.OPERATIONS_TEAM_SMOKE_CHECKS))
        for text in ('{partial', '[]', 'null', 'x'*(256*1024+1)):
            self.report_path.write_text(text, encoding='utf-8')
            value, _ = self.probe(); self.assertFalse(value['ok']); self.assertTrue(value['live'])

    def test_required_behavior_names_exact_success_and_identity_are_enforced(self):
        changes = [{'checks': self.report['checks'][:-1]}, {'schema': True}, {'project': 'shadow'},
                   {'ok': False}, {'finishedAt': '2026-09-07T12:00:00'},
                   {'finishedAt': datetime.fromtimestamp(self.now+60, timezone.utc).isoformat()},
                   {'checks': self.report['checks']+[self.report['checks'][0]]}]
        for bad in (False, 1, 'true', None):
            changes.append({'checks': [{**self.report['checks'][0], 'ok': bad}, *self.report['checks'][1:]]})
        for change in changes:
            with self.subTest(change=change):
                self.write_report({**self.report, **change})
                value, _ = self.probe(); self.assertFalse(value['ok']); self.assertTrue(value['live'])
        self.write_report({**self.report, 'project': 'qiandengji-ops',
            'checks': {row['name']: {'ok': True} for row in self.report['checks']}})
        self.assertTrue(self.probe()[0]['ok'])

    def test_team_runtime_or_behavior_failure_turns_panel_red(self):
        other = ('probe_panel_http', 'probe_management', 'probe_recorded_behavior', 'probe_source_record',
                 'probe_player_commands', 'probe_voice_commands', 'probe_chanting_staff', 'probe_voice_recording',
                 'probe_voice_boundary_deployment', 'probe_skillbar_editor', 'probe_chanting_client', 'probe_game_qwenpaw', 'probe_survivor', 'probe_model_routing', 'probe_survivor_party', 'probe_world_team')
        with ExitStack() as stack:
            for name in other:
                stack.enter_context(patch.object(health, name, return_value={'ok': True}))
            process = stack.enter_context(patch.object(health.subprocess, 'run', return_value=SimpleNamespace(
                returncode=0, stdout=json.dumps(self.receipt), stderr='')))
            self.assertTrue(health.probe_panel_smoke()['ok'])
            self.report_path.unlink()
            value = health.probe_panel_smoke()
            self.assertFalse(value['ok']); self.assertTrue(value['operations_team']['live'])
            self.write_report()
            process.return_value.returncode = 1
            value = health.probe_panel_smoke()
            self.assertFalse(value['ok']); self.assertFalse(value['operations_team']['live'])
            self.assertTrue(value['operations_team']['behavior']['ok'])


class ConsolidatedOperationsProbe(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root=Path(temporary.name)
        (self.root/'config').mkdir()
        (self.root/'config/operations-runtime.json').write_bytes(
            (SOURCE.parents[3]/'config/operations-runtime.json').read_bytes())
        mapping=self.root/'server/team-state/runtime-hosts.json'
        mapping.parent.mkdir(parents=True)
        mapping.write_text(json.dumps({'schema':2,'phases':{
            'steward-to-game-v1':'active','engineer-to-game-v1':'active'}}))
        patcher=patch.object(health,'PROJECT',self.root)
        patcher.start();self.addCleanup(patcher.stop)

    def test_current_services_require_thirteen_and_ignore_absent_archive(self):
        active=health.current_service_manifest()
        self.assertEqual(len(active),13)
        self.assertNotIn('qwenpaw-ops',active)
        rows=[{'Service':name,'State':'running','Health':'healthy'} for name in active]
        process=SimpleNamespace(returncode=0,stdout=json.dumps(rows))
        with patch.object(health.subprocess,'run',return_value=process):
            result=health.probe_services()
            self.assertTrue(result['ok']);self.assertEqual(len(result['checks']),13)
            rows[0]['Health']='unhealthy';process.stdout=json.dumps(rows)
            self.assertFalse(health.probe_services()['ok'])

    def test_managed_refresh_and_failure_never_publish_from_host(self):
        folder=self.root/'server/panel-state';folder.mkdir(parents=True,exist_ok=True)
        source={'schema':1,'project':'qiandengji','generatedAt':datetime.now(timezone.utc).isoformat(),
                'checks':{'currentServices':True,'sharedTts':{'ok':True,'endpoint':'http://127.0.0.1:8100/health'}}}
        path=folder/'operations.json';path.write_text(json.dumps(source));original=path.read_bytes()
        (folder/'health.json').write_text('collector-owned')
        adapter=SimpleNamespace(managed_snapshot=lambda **_: source)
        with patch.object(health,'load_operations_adapter',return_value=adapter):
            self.assertTrue(health.refresh_operations_snapshot()['ok'])
            adapter.managed_snapshot=lambda **_: (_ for _ in ()).throw(RuntimeError('refresh failed'))
            self.assertFalse(health.refresh_operations_snapshot()['ok'])
            self.assertEqual(path.read_bytes(),original)
            with redirect_stdout(io.StringIO()):health.inventory_lock_failure('inventory_busy')
        self.assertEqual((folder/'health.json').read_text(),'collector-owned')

    def test_archived_team_uses_current_game_and_world_team_without_old_acceptance(self):
        with patch.object(health,'probe_game_qwenpaw',return_value={'runtime':{'ok':True},'behavior':{'ok':False}}),\
             patch.object(health,'probe_world_team',return_value={'ok':True}) as team,\
             patch.object(health.subprocess,'run',side_effect=AssertionError('Do not execute archived Qwen')):
            result=health.probe_operations_team()
            self.assertTrue(result['ok'])
            self.assertEqual(result['container'],'qiandengji-qwenpaw-1')
            self.assertFalse(result['archived']['historicalAcceptanceReused'])
            self.assertNotIn('six_roles',result.get('checks',{}))
            team.return_value={'ok':False}
            self.assertFalse(health.probe_operations_team()['ok'])

    def test_game_readiness_requires_current_native_role_and_skill_inventory_receipt(self):
        roles=['mc-god','mc-herald','qd-survivor','qd-engineer','qd-steward',
               'qd-guild-planner','qd-villager-dialogue','qd-maid-dialogue','yui','other-maid']
        receipt={'ok':True,'project':'qiandengji','packageVersion':'2.2.0','agents':10,
                 'baseAgents':6,'maidAgents':2,'hostedAgents':2,'expectedAgents':roles,
                 'configuredSkillBindings':94,'installedSkillBindings':94,'skillInventoryVerified':True,
                 'cronBudgetGuardVerified':True,'enabledTools':7,'nativeToolPolicyVerified':True,
                 'lifeContextStrategy':'scroll','lifeHistoryRetentionDays':0,'lifeMemoryEvidenceVersion':2,
                 'lifeHistoryVerified':True,'lifeHistoryAgents':2,
                 'authMode':'local-passwordless','anonymousAccess':True}
        process=SimpleNamespace(returncode=0,stdout=json.dumps(receipt))
        with patch.object(health.subprocess,'run',return_value=process) as run,\
             patch.object(health,'probe_recorded_behavior',return_value={'ok':False}):
            self.assertTrue(health.probe_game_qwenpaw()['runtime']['ok'])
            self.assertEqual(run.call_args.kwargs['timeout'],120)
            for changed in ({'skillInventoryVerified':False},{'agents':9},{'expectedAgents':roles[:-1]},
                            {'expectedAgents':roles+[roles[0]]},{'hostedAgents':0}):
                process.stdout=json.dumps({**receipt,**changed})
                self.assertFalse(health.probe_game_qwenpaw()['runtime']['ok'])


class PasswordlessRuntimeProbe(unittest.TestCase):
    @staticmethod
    def learning_reply(request, routes):
        from agent_learning import TOOL_NAMES, managed_job
        from role_learning_profiles import role_skills
        from native_role_capabilities import NATIVE_SKILLS, enabled_native_tools
        route = request.full_url.removeprefix('http://127.0.0.1:8088/api')
        role = request.get_header('X-agent-id')
        if route == '/tools':
            disabled={row['name'] for row in routes['/tools'] if row.get('enabled') is False}
            return [{'name':name,'enabled':name not in disabled} for name in enabled_native_tools(role)]
        if route == '/mcp/tools/qd_learning': return [{'name': name, 'enabled': True} for name in TOOL_NAMES]
        if route == '/mcp': return [{'key': name} for name in
            (('numen_survival', 'qd_learning') if role == 'qd-survivor' else ('qd_learning',))]
        if route == '/skills': return [{'name': name, 'enabled': True} for name in (*role_skills(role, 'game'), *NATIVE_SKILLS)]
        if route == '/cron/jobs': return [{'spec': managed_job(role, 'game'), 'state': {}}]
        return routes[route]

    def load_probe(self, filename):
        path = SOURCE.parents[1]/filename
        spec = importlib.util.spec_from_file_location('isolated_'+filename[:-3], path)
        module = importlib.util.module_from_spec(spec)
        stub = SimpleNamespace(ROLES=(), TOOLS=(), role_tools=lambda _: (),operation_arguments=lambda *args: [])
        with patch.dict(sys.modules, {'operations_team_mcp': stub}):
            spec.loader.exec_module(module)
        if filename == 'qwenpaw_health.py':
            # This fixture isolates passwordless GETs, role tools and readiness.
            # Real migration/team/party policies have their own focused tests.
            temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
            root=Path(temporary.name)
            # patch.dict restores newly imported modules too. Match the module
            # imported later by the real party-driver helper, not an orphaned
            # import retained by this isolated health module.
            module.world_team=importlib.import_module('world_team_profiles')
            from role_learning_profiles import GAME_ROLES,role_skills
            from native_role_capabilities import NATIVE_SKILLS
            for role in GAME_ROLES:
                folder=root/role;folder.mkdir()
                (folder/'skill.json').write_text(json.dumps({'schema_version':'workspace-skill-manifest.v1',
                    'skills':{name:{'enabled':True} for name in (*role_skills(role,'game'),*NATIVE_SKILLS)}}),encoding='utf-8')
            def fixture_path(value):
                path=Path(value)
                prefix=Path('/state/work/workspaces')
                return root/path.relative_to(prefix) if path.is_relative_to(prefix) else path
            patches=(patch.object(module,'Path',side_effect=fixture_path),
                     patch.object(module,'roles',return_value=GAME_ROLES),
                     patch.object(module,'maid_roles',return_value=()),
                     patch.object(module,'party_roles',return_value=set()),
                     patch.object(module,'hosted_source',return_value=None),
                     patch.object(module.world_team,'actor_for',return_value=None))
            for patcher in patches:
                patcher.start();self.addCleanup(patcher.stop)
        return module

    def test_both_versions_require_explicit_zero_and_actual_disabled_status(self):
        for filename in ('qwenpaw_health.py', 'operations_team_health.py'):
            module = self.load_probe(filename)
            with self.subTest(filename=filename), patch.dict(module.os.environ, {'QWENPAW_AUTH_ENABLED': '0'}):
                calls = []
                module.check_passwordless_auth(lambda route: calls.append(route) or {'enabled': False})
                self.assertEqual(calls, ['/auth/status'])
                for bad in (True, 0, None, 'false'):
                    with self.assertRaises(AssertionError):
                        module.check_passwordless_auth(lambda _: {'enabled': bad})
            for flag in ('1', 'false', '', 'no'):
                with patch.dict(module.os.environ, {'QWENPAW_AUTH_ENABLED': flag}):
                    with self.assertRaises(AssertionError):
                        module.check_passwordless_auth(lambda _: self.fail('Environment must fail before HTTP'))

    def test_game_probe_uses_anonymous_gets_and_checks_exact_native_tools(self):
        module = self.load_probe('qwenpaw_health.py')
        roles = ['mc-god', 'mc-herald', 'qd-survivor', 'qd-villager-dialogue', 'qd-guild-planner', 'qd-maid-dialogue']
        routes = {'/auth/status': {'enabled': False},
                  '/version': {'version': '2.2.0'},
                  '/healthz': {'status': 'ok', 'agents_loaded': roles},
                  '/agents': {'agents': [{'id': name, 'enabled': True} for name in roles]},
                  '/tools': [{'name': name, 'enabled': True} for name in module.NATIVE_TOOLS]}
        requests = []
        def get(request, **kwargs):
            requests.append(request)
            self.assertEqual(request.get_method(), 'GET')
            self.assertIsNone(request.get_header('Authorization'))
            return io.BytesIO(json.dumps(self.learning_reply(request, routes)).encode())
        with patch.dict(module.os.environ, {'QWENPAW_AUTH_ENABLED': '0'}), \
                patch.object(module, 'check_runtime_config', return_value={'default', 'QwenPaw_QA_Agent_0.2'}), \
                patch.object(module, 'validate_guard', return_value=True), \
                patch.object(module.urllib.request, 'urlopen', side_effect=get):
            output = io.StringIO()
            with redirect_stdout(output):
                module.main()
            result = json.loads(output.getvalue())
            self.assertTrue(result['ok']); self.assertIs(result['authEnforced'], False)
            self.assertEqual(result['authMode'], 'local-passwordless')
            self.assertEqual(result['agents'], 6)
            self.assertEqual(result['expectedAgents'],sorted(roles))
            self.assertTrue(result['skillInventoryVerified'])
            self.assertEqual(result['configuredSkillBindings'],result['installedSkillBindings'])
            self.assertEqual([r.full_url for r in requests[1:3]], [
                'http://127.0.0.1:8088/api/version', 'http://127.0.0.1:8088/api/healthz'])
            self.assertCountEqual([r.get_header('X-agent-id') for r in requests if r.full_url.endswith('/api/tools')],
                             ['mc-god', 'mc-herald', 'qd-villager-dialogue', 'qd-guild-planner', 'qd-maid-dialogue'])
            routes['/tools'][0]['enabled'] = False
            with self.assertRaises(AssertionError):
                module.main()
            routes['/tools'][0]['enabled'] = True
            routes['/agents']['agents'].append({'id': 'foreign', 'enabled': True})
            with self.assertRaises(AssertionError):
                module.main()

    def test_game_probe_rejects_incomplete_readiness_even_when_config_and_agent_list_are_valid(self):
        module = self.load_probe('qwenpaw_health.py')
        roles = ['mc-god', 'mc-herald', 'qd-survivor', 'qd-villager-dialogue', 'qd-guild-planner', 'qd-maid-dialogue']
        routes = {'/auth/status': {'enabled': False}, '/version': {'version': '2.2.0'},
                  '/healthz': {'status': 'ok', 'agents_loaded': roles},
                  '/agents': {'agents': [{'id': name, 'enabled': True} for name in roles]},
                  '/tools': [{'name': name, 'enabled': True} for name in module.NATIVE_TOOLS]}
        def get(request, **kwargs):
            return io.BytesIO(json.dumps(self.learning_reply(request, routes)).encode())
        with patch.dict(module.os.environ, {'QWENPAW_AUTH_ENABLED': '0'}), \
                patch.object(module, 'check_runtime_config', return_value={'default', 'QwenPaw_QA_Agent_0.2'}) as config, \
                patch.object(module, 'validate_guard', return_value=True), \
                patch.object(module.urllib.request, 'urlopen', side_effect=get):
            for value in ({'status': 'loading', 'agents_loaded': ['mc-god', 'mc-herald']},
                          {'status': 'ok', 'agents_loaded': ['mc-god', 'mc-herald', 'qd-survivor']},
                          {'status': 'ok', 'agents_loaded': ['mc-god', 'mc-herald']},
                          {'status': 'ok', 'agents_loaded': []},
                          {'status': 'ok', 'agents_loaded': ['mc-god']},
                          {'status': 'ok', 'agents_loaded': ['mc-god', 'mc-god']},
                          {'status': 'ok', 'agents_loaded': ['mc-god', 'mc-herald', 'foreign']},
                          {'status': 'ok', 'agents_loaded': {'mc-god': True, 'mc-herald': True}},
                          {'status': 'ok'}):
                routes['/healthz'] = value
                with self.subTest(readiness=value), self.assertRaises(AssertionError):
                    module.main()
            routes['/healthz'] = {'status': 'ok', 'agents_loaded': roles}
            for value in ('2.1.0', None, 2.2):
                routes['/version'] = {'version': value}
                with self.subTest(version=value), self.assertRaises(AssertionError):
                    module.main()
            routes['/version'] = {'version': '2.2.0'}
            for extra in (['default'], ['QwenPaw_QA_Agent_0.2'], ['default', 'QwenPaw_QA_Agent_0.2']):
                routes['/healthz'] = {'status': 'ok', 'agents_loaded': [*roles, *extra]}
                with self.subTest(disabled_builtins=extra), redirect_stdout(io.StringIO()):
                    module.main()
            config.return_value = set()
            routes['/healthz'] = {'status': 'ok', 'agents_loaded': [*roles, 'default']}
            with self.assertRaises(AssertionError):
                module.main()


if __name__ == '__main__':
    unittest.main()
