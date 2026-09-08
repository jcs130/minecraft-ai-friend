"""Read-only survivor health uses current evidence, including intentional pauses."""
from datetime import datetime, timezone
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('survivor_health', Path(__file__).resolve().parents[1]/'world/ops/health/health_mon.py')
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class SurvivorHealthTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.now = 1800000000
        self.source = {'schema': 1, 'project': 'qiandengji-survivor', 'character': '桐人', 'bodyName': 'Kirito',
            'generatedAt': datetime.fromtimestamp(self.now, timezone.utc).isoformat(), 'status': 'observing', 'enabled': True,
            'adventure': {'schema': 1, 'resources': {'known': True}, 'equipment': {'known': False}}, 'constructionAreas': []}
        self.source['executionSystems'] = {'schema': 1, 'automaticFoodReflex': False,
            'fast': {'owner': 'native-ai-and-tested-programs', 'active': False, 'waiting': False,
                     'name': None, 'nextCheckAt': None, 'steps': 0, 'observations': 0, 'requiresModelPerStep': False},
            'slow': {'owner': 'qwenpaw', 'active': False, 'status': 'observing',
                     'readiness': {'ready': True, 'checkedAt': self.now * 1000, 'warning': None}}}
        self.source['budgets'] = {'decisionsUsed': 106, 'decisionLimit': None, 'dailyPlanningLimit': None,
            'inferenceLimitPolicy': 'unrestricted', 'decisionCountScope': 'rolling_24h', 'cooldownSeconds': 0}
        self.settings = {'dailyPlanningLimit': None, 'decisionCooldownSeconds': 0}
        self.heartbeat = {'schema': 1, 'ok': True, 'at': self.now * 1000, 'fastSystemProtocol': 1}
        self.fast_report = {'schema': 1, 'project': 'qiandengji', 'fastSystemProtocol': 1,
            'ok': True, 'finishedAt': self.source['generatedAt'],
            'checks': [{'name': name, 'ok': True} for name in health.SURVIVOR_FAST_SYSTEM_CHECKS]}
        self.container = {'State': {'Status': 'running', 'Health': {'Status': 'healthy'}},
            'Config': {'Labels': {'com.docker.compose.project': 'qiandengji', 'com.docker.compose.service': 'survivor'}},
            'HostConfig': {'RestartPolicy': {'Name': 'unless-stopped'}}}

    def probe(self, behavior=True, public=None, adventure=True):
        target = self.root/'server/panel-state/survivor.json'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(self.source), encoding='utf-8')
        for name, value in [('server/survival-agent-state/survival/heartbeat.json', self.heartbeat),
                            ('server/survival-agent-state/survival/settings.json', self.settings),
                            ('reports/survivor-fast-system-smoke.json', self.fast_report)]:
            path = self.root / name
            if value is None:
                path.unlink(missing_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(value), encoding='utf-8')
        projection = public or {'available': True, 'stale': False, **self.source,
            'adventure': {'available': True, 'resources': {'known': True}, 'equipment': {'known': False}},
            'constructionAreasKnown': True}
        with patch.object(health, 'PROJECT', self.root), patch.object(health.time, 'time', return_value=self.now), \
             patch.object(health.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=json.dumps([self.container]))), \
             patch.object(health.urllib.request, 'urlopen', return_value=io.BytesIO(json.dumps({'survivor': projection}).encode())), \
             patch.object(health, 'probe_recorded_behavior', side_effect=lambda name, *a: {'ok': adventure if name=='survivor-adventure-smoke.json' else behavior}):
            return health.probe_survivor()

    def test_current_bound_supervised_status_and_behavior_are_all_required(self):
        self.assertTrue(self.probe()['ok'])
        self.assertFalse(self.probe(behavior=False)['ok'])
        self.container['State']['Health']['Status'] = 'unhealthy'
        self.assertFalse(self.probe()['ok'])

    def test_intentionally_paused_worker_remains_healthy_without_model_work(self):
        self.source.update(status='paused', enabled=False)
        self.source['executionSystems']['slow']['status'] = 'paused'
        result = self.probe()
        self.assertTrue(result['ok'])
        self.assertTrue(result['paused'])

    def test_runtime_error_pause_cannot_be_reported_as_healthy_observation(self):
        self.source.update(status='paused', enabled=False, pauseReason='controller_SkillError')
        self.source['executionSystems']['slow']['status'] = 'paused'
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertFalse(result['checks']['no_unexpected_pause'])

    def test_stale_future_foreign_or_missing_identity_is_not_live(self):
        for changes in ({'generatedAt': datetime.fromtimestamp(self.now-91, timezone.utc).isoformat()},
                        {'generatedAt': datetime.fromtimestamp(self.now+6, timezone.utc).isoformat()},
                        {'project': 'host'}, {'bodyName': 'Naruto'}, {'character': 'other'}):
            original = dict(self.source)
            with self.subTest(changes=changes):
                self.source.update(changes)
                self.assertFalse(self.probe()['ok'])
            self.source = original

    def test_stopped_container_or_public_projection_mismatch_cannot_reuse_green(self):
        self.assertFalse(self.probe(public={'available': False})['ok'])
        self.container['State']['Status'] = 'exited'
        self.assertFalse(self.probe()['ok'])

    def test_manifest_tracks_only_dedicated_survivor(self):
        self.assertIn('survivor', health.MANIFEST)
        self.assertIn('autonomous-task-evidence', health.SURVIVOR_SMOKE_CHECKS)

    def test_missing_or_artificial_large_limits_cannot_claim_unrestricted(self):
        for settings in ({'decisionsPerDay': 96, 'decisionCooldownSeconds': 180},
                         {'dailyPlanningLimit': 999999, 'decisionCooldownSeconds': 0},
                         {'dailyPlanningLimit': 0, 'decisionCooldownSeconds': 0},
                         {'dailyPlanningLimit': None, 'decisionCooldownSeconds': False},
                         {'dailyPlanningLimit': None, 'decisionCooldownSeconds': 180}):
            with self.subTest(settings=settings):
                self.settings = settings
                self.assertFalse(self.probe()['checks']['inference_limits_unrestricted'])

    def test_old_or_coerced_budget_projection_cannot_hide_actual_policy(self):
        original = dict(self.source['budgets'])
        for changed in ({'decisionLimit': 0}, {'dailyPlanningLimit': 96}, {'cooldownSeconds': 180},
                        {'decisionCountScope': 'recent_100'}, {'decisionsUsed': True}):
            with self.subTest(changed=changed):
                self.source['budgets'] = {**original, **changed}
                self.assertFalse(self.probe()['checks']['inference_limits_unrestricted'])
        self.source['budgets'] = original
        public = {'available': True, 'stale': False, **self.source, 'budgets': {**original, 'decisionLimit': 0}}
        self.assertFalse(self.probe(public=public)['checks']['inference_limits_unrestricted'])

    def test_old_autonomy_evidence_cannot_stand_in_for_new_adventure_validation(self):
        self.assertFalse(self.probe(adventure=False)['ok'])
        self.assertIn('loaded-block-scan', health.SURVIVOR_ADVENTURE_CHECKS)

    def test_life_projection_must_keep_source_unknown_state_and_authorized_area_shape(self):
        self.source['adventure']['equipment']['known'] = True
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertFalse(result['checks']['adventure_projection'])

    def test_old_live_snapshot_without_fast_slow_contract_cannot_reuse_green_reports(self):
        self.source.pop('executionSystems')
        result = self.probe()
        self.assertTrue(result['fast_system_behavior']['ok'])
        self.assertFalse(result['checks']['execution_systems'])
        self.assertFalse(result['ok'])

    def test_fast_slow_contract_cannot_claim_model_per_step_or_automatic_reflex(self):
        original = copy.deepcopy(self.source['executionSystems'])
        invalid = [dict(original, schema=True), dict(original, automaticFoodReflex=True),
            dict(original, fast={**original['fast'], 'requiresModelPerStep': True}),
            dict(original, fast={**original['fast'], 'steps': True}),
            dict(original, fast={**original['fast'], 'nextCheckAt': float('nan')}),
            dict(original, slow={**original['slow'], 'owner': 'direct-provider'})]
        for value in invalid:
            with self.subTest(value=value):
                self.source['executionSystems'] = value
                result = self.probe()
                self.assertFalse(result['checks']['execution_systems'])
                self.assertFalse(result['ok'])

    def test_missing_old_stale_or_future_heartbeat_cannot_establish_current_protocol(self):
        original = dict(self.heartbeat)
        for value in (None, {k: v for k, v in original.items() if k != 'fastSystemProtocol'},
                      dict(original, fastSystemProtocol=True), dict(original, at=(self.now - 91) * 1000),
                      dict(original, at=(self.now + 6) * 1000)):
            with self.subTest(value=value):
                self.heartbeat = value
                result = self.probe()
                self.assertFalse(result['checks']['fast_system_protocol'])
                self.assertFalse(result['ok'])

    def test_old_generic_reports_do_not_replace_specific_behavior_evidence(self):
        original = copy.deepcopy(self.fast_report)
        invalid = [None, {k: v for k, v in original.items() if k != 'fastSystemProtocol'},
            dict(original, fastSystemProtocol=True), dict(original, checks=original['checks'][:-1]),
            dict(original, checks=[{'name': name, 'ok': 1} for name in health.SURVIVOR_FAST_SYSTEM_CHECKS]),
            dict(original, checks=original['checks'] + [original['checks'][0]]),
            dict(original, project='host'), dict(original, finishedAt=datetime.fromtimestamp(self.now + 6, timezone.utc).isoformat())]
        for value in invalid:
            with self.subTest(value=value):
                self.fast_report = value
                result = self.probe()
                self.assertTrue(all(result['checks'].values()))
                self.assertFalse(result['fast_system_behavior']['ok'])
                self.assertFalse(result['ok'])

    def test_offline_qwen_diagnostics_do_not_invalidate_fast_layer_protocol(self):
        self.source['executionSystems']['slow']['readiness'] = {
            'ready': False, 'checkedAt': self.now * 1000, 'warning': 'native_survivor_tools_unavailable'}
        result = self.probe()
        self.assertTrue(result['checks']['execution_systems'])
        self.assertTrue(result['checks']['fast_system_protocol'])
        # The separate existing Qwen/container probes still determine health.
        self.container['State']['Health']['Status'] = 'unhealthy'
        self.assertFalse(self.probe()['ok'])


if __name__ == '__main__':
    unittest.main()
