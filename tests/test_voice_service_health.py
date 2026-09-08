"""Offline voice readiness: historical success cannot hide a broken live inbox."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'world/ops/health/health_mon.py'
spec = importlib.util.spec_from_file_location('voice_service_health', SOURCE)
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)

# This is the actual smoke protocol, independent of the probe's constant.
CHECKS = (
    'voice:model-endpoint-unreachable', 'voice:reserved-qa-fixture',
    'voice:tts-wav-generated', 'voice:asr-recording-time-preserved',
    'voice:command-receipt', 'voice:three-firework-entities',
    'voice:replay-no-second-cast', 'voice:custom-staff-armed', 'voice:audio-boundary-ack',
)


class VoiceServiceHealth(unittest.TestCase):
    NOW = 1_800_000_000

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='qd-voice-health-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.heartbeat_path = self.root / 'server/world-data/world-heartbeat.json'
        self.behavior_path = self.root / 'reports/voice-casting-smoke.json'
        self.source_path = self.root / 'world/src/voice-command-inbox.ts'
        self.source_path.parent.mkdir(parents=True)
        self.source_path.write_text('// offline source fixture\n', encoding='utf-8')
        self.source_record = {
            'ok': True,
            'source_files': [{'path': 'world/src/voice-command-inbox.ts',
                              'sha256': hashlib.sha256(self.source_path.read_bytes()).hexdigest()}],
        }
        self.heartbeat = {
            'ts': (self.NOW - 10) * 1000,
            'voiceCommands': {'schema': 1, 'ready': True, 'modelRequired': False},
            'playerCommands': {'schema': 1, 'ready': True, 'queueEnabled': True, 'modelRequired': False},
        }
        self.behavior = {
            'schema': 1, 'project': 'qiandengji', 'ok': True, 'customStaff': True,
            'finishedAt': '2026-09-07T12:00:00Z',
            'checks': [{'name': name, 'ok': True} for name in CHECKS],
            'cleanup': {'actorOffline': True, 'lockReleased': True},
        }
        self.write(self.heartbeat_path, self.heartbeat)
        self.write(self.behavior_path, self.behavior)
        self.write(self.root / 'reports/architecture-current.json', self.source_record)
        for patcher in (patch.object(health, 'PROJECT', self.root),
                        patch.object(health.time, 'time', return_value=self.NOW)):
            patcher.start()
            self.addCleanup(patcher.stop)
        # No probe under test may touch Docker, HTTP, or real runtime files.
        for patcher in (patch.object(health.subprocess, 'run', side_effect=AssertionError('No Docker')),
                        patch.object(health.urllib.request, 'urlopen', side_effect=AssertionError('No HTTP'))):
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def write(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf-8')

    def probe(self):
        return health.probe_voice_commands()

    def test_live_current_sources_and_all_real_behavior_checks_pass(self):
        result = self.probe()
        self.assertTrue(result['ok'])
        self.assertTrue(result['live'])
        self.assertEqual(result['age_seconds'], 10)
        self.assertEqual(result['behavior']['missing_checks'], [])
        self.assertEqual(result['sources']['source_file_count'], 1)

    def test_freshness_and_clock_skew_exact_boundaries(self):
        for age, expected in [(-5.001, False), (-5, True), (-3, True),
                              (0, True), (179.999, True), (180, False), (3600, False)]:
            with self.subTest(age=age):
                self.heartbeat['ts'] = (self.NOW - age) * 1000
                self.write(self.heartbeat_path, self.heartbeat)
                result = self.probe()
                self.assertIs(result['live'], expected)
                self.assertIs(result['ok'], expected)
                self.assertTrue(result['behavior']['ok'])

    def test_failed_receipt_journal_cannot_be_hidden_by_historical_green(self):
        self.heartbeat['voiceCommands']['ready'] = False
        self.write(self.heartbeat_path, self.heartbeat)
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertFalse(result['live'])
        self.assertTrue(result['behavior']['ok'])
        self.assertTrue(result['sources']['ok'])

    def test_capabilities_require_exact_schema_and_boolean_values(self):
        valid = {'schema': 1, 'ready': True, 'modelRequired': False}
        for key, value in [('schema', True), ('schema', 2), ('schema', '1'),
                           ('ready', 1), ('ready', 'true'), ('modelRequired', True),
                           ('modelRequired', 0), ('modelRequired', None)]:
            with self.subTest(key=key, value=value):
                self.heartbeat['voiceCommands'] = {**valid, key: value}
                self.write(self.heartbeat_path, self.heartbeat)
                self.assertFalse(self.probe()['ok'])
        for key in valid:
            with self.subTest(missing=key):
                self.heartbeat['voiceCommands'] = {k: v for k, v in valid.items() if k != key}
                self.write(self.heartbeat_path, self.heartbeat)
                self.assertFalse(self.probe()['ok'])

    def test_missing_malformed_or_invalid_timestamp_heartbeat_fails_closed(self):
        for stamp in [None, True, '1800000000000', 0, -1, float('nan'), float('inf'), {}, []]:
            with self.subTest(stamp=stamp):
                self.write(self.heartbeat_path, {**self.heartbeat, 'ts': stamp})
                result = self.probe()
                self.assertFalse(result['ok'])
                self.assertIsNone(result['age_seconds'])
        for value in [{}, [], None, {'ts': self.NOW * 1000, 'voiceCommands': None},
                      {'ts': self.NOW * 1000, 'voiceCommands': []}]:
            with self.subTest(heartbeat=value):
                self.write(self.heartbeat_path, value)
                self.assertFalse(self.probe()['ok'])
        self.heartbeat_path.write_text('{partial', encoding='utf-8')
        self.assertFalse(self.probe()['ok'])
        self.heartbeat_path.unlink()
        self.assertFalse(self.probe()['ok'])

    def test_each_required_check_must_exist_and_really_pass(self):
        for name in CHECKS:
            for status in [False, 'true', 1, None]:
                with self.subTest(name=name, status=status):
                    report = {**self.behavior, 'checks': [
                        {'name': n, 'ok': status if n == name else True} for n in CHECKS]}
                    self.write(self.behavior_path, report)
                    result = self.probe()
                    self.assertFalse(result['ok'])
                    self.assertEqual(result['behavior']['missing_checks'], [name])
            self.write(self.behavior_path, {**self.behavior, 'checks': [
                row for row in self.behavior['checks'] if row['name'] != name]})
            self.assertFalse(self.probe()['ok'])

    def test_failed_incomplete_or_other_project_report_is_rejected(self):
        for change in [{'ok': False}, {'ok': 'true'}, {'schema': True}, {'schema': 2},
                       {'project': 'shadow'}, {'checks': {}}, {'checks': None},
                       {'customStaff': False}, {'customStaff': None}, {'customStaff': 1},
                       {'cleanup': None}, {'cleanup': {}},
                       {'cleanup': {'actorOffline': False, 'lockReleased': True}},
                       {'cleanup': {'actorOffline': True, 'lockReleased': False}},
                       {'cleanup': {'actorOffline': 1, 'lockReleased': True}}]:
            with self.subTest(change=change):
                self.write(self.behavior_path, {**self.behavior, **change})
                self.assertFalse(self.probe()['ok'])
        for raw in ['{partial', 'null', '[]']:
            self.behavior_path.write_text(raw, encoding='utf-8')
            self.assertFalse(self.probe()['ok'])
        self.behavior_path.unlink()
        self.assertFalse(self.probe()['ok'])

    def test_current_source_drift_or_missing_evidence_blocks_historical_success(self):
        self.source_path.write_text('// changed after recorded validation\n', encoding='utf-8')
        self.assertFalse(self.probe()['ok'])
        self.assertEqual(self.probe()['sources']['mismatches'], ['world/src/voice-command-inbox.ts'])
        self.source_path.write_text('// offline source fixture\n', encoding='utf-8')
        self.assertTrue(self.probe()['ok'])
        self.write(self.root / 'reports/architecture-split.json', self.source_record)
        self.write(self.root / 'reports/player-command-service.json', self.source_record)
        (self.root / 'reports/architecture-current.json').write_text('{partial', encoding='utf-8')
        self.assertFalse(self.probe()['ok'])
        (self.root / 'reports/architecture-current.json').unlink()
        self.assertFalse(self.probe()['ok'])
        with patch.object(health, 'probe_recorded_behavior', return_value={'ok': True}):
            self.assertFalse(health.probe_player_commands()['ok'])
            self.assertFalse(health.probe_architecture()['ok'])

    def test_panel_retains_player_service_and_adds_voice_readiness_gate(self):
        with patch.object(health, 'probe_panel_http', return_value={'ok': True}), \
                patch.object(health, 'probe_management', return_value={'ok': True}), \
                patch.object(health, 'probe_operations_team', return_value={'ok': True}), \
                patch.object(health, 'probe_game_qwenpaw', return_value={'ok': True}), \
                patch.object(health, 'probe_survivor', return_value={'ok': True}), \
                patch.object(health, 'probe_model_routing', return_value={'ok': True}), \
                patch.object(health, 'probe_recorded_behavior', return_value={'ok': True}), \
                patch.object(health, 'probe_chanting_staff', return_value={'ok': True}), \
                patch.object(health, 'probe_voice_recording', return_value={'ok': True}), \
                patch.object(health, 'probe_voice_boundary_deployment', return_value={'ok': True}), \
                patch.object(health, 'probe_skillbar_editor', return_value={'ok': True}), \
                patch.object(health, 'probe_chanting_client', return_value={'ok': True}):
            self.assertTrue(health.probe_panel_smoke()['ok'])
            self.heartbeat['voiceCommands']['ready'] = False
            self.write(self.heartbeat_path, self.heartbeat)
            result = health.probe_panel_smoke()
            self.assertFalse(result['ok'])
            self.assertFalse(result['voice_commands']['ok'])
            self.assertTrue(result['player_commands']['ok'])
            self.heartbeat['voiceCommands']['ready'] = True
            self.heartbeat['playerCommands']['queueEnabled'] = False
            self.write(self.heartbeat_path, self.heartbeat)
            result = health.probe_panel_smoke()
            self.assertFalse(result['ok'])
            self.assertTrue(result['voice_commands']['ok'])
            self.assertFalse(result['player_commands']['ok'])

    def test_old_non_staff_voice_success_does_not_satisfy_new_behavior(self):
        report = {key: value for key, value in self.behavior.items() if key != 'customStaff'}
        report['checks'] = [row for row in report['checks'] if row['name'] != 'voice:custom-staff-armed']
        self.write(self.behavior_path, report)
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertFalse(result['behavior']['custom_staff'])
        self.assertEqual(result['behavior']['missing_checks'], ['voice:custom-staff-armed'])

    def test_pre_handshake_voice_success_cannot_hide_missing_audio_boundary_ack(self):
        report = {**self.behavior, 'checks': [row for row in self.behavior['checks']
                                             if row['name'] != 'voice:audio-boundary-ack']}
        self.write(self.behavior_path, report)
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertTrue(result['behavior']['custom_staff'])
        self.assertEqual(result['behavior']['missing_checks'], ['voice:audio-boundary-ack'])


if __name__ == '__main__':
    unittest.main()
