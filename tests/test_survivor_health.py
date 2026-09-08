"""Read-only survivor health uses current evidence, including intentional pauses."""
from datetime import datetime, timezone
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
        self.container = {'State': {'Status': 'running', 'Health': {'Status': 'healthy'}},
            'Config': {'Labels': {'com.docker.compose.project': 'qiandengji', 'com.docker.compose.service': 'survivor'}},
            'HostConfig': {'RestartPolicy': {'Name': 'unless-stopped'}}}

    def probe(self, behavior=True, public=None, adventure=True):
        target = self.root/'server/panel-state/survivor.json'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(self.source), encoding='utf-8')
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
        result = self.probe()
        self.assertTrue(result['ok'])
        self.assertTrue(result['paused'])

    def test_runtime_error_pause_cannot_be_reported_as_healthy_observation(self):
        self.source.update(status='paused', enabled=False, pauseReason='controller_SkillError')
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

    def test_old_autonomy_evidence_cannot_stand_in_for_new_adventure_validation(self):
        self.assertFalse(self.probe(adventure=False)['ok'])
        self.assertIn('loaded-block-scan', health.SURVIVOR_ADVENTURE_CHECKS)

    def test_life_projection_must_keep_source_unknown_state_and_authorized_area_shape(self):
        self.source['adventure']['equipment']['known'] = True
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertFalse(result['checks']['adventure_projection'])


if __name__ == '__main__':
    unittest.main()
