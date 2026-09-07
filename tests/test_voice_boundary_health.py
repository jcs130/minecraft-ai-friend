"""Offline restoration gate: a successful inner QA cannot retain its recorder."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]/'world/ops/health/health_mon.py'
spec = importlib.util.spec_from_file_location('voice_boundary_health', SOURCE)
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class VoiceBoundaryHealth(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='qd-voice-boundary-health-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.config = self.root/'server/mc/data/godvoice/config.json'
        self.marker = self.root/'server/world-data/.qiandengji-recorder-qa.json'
        self.marker.parent.mkdir(parents=True)
        self.write(self.config, {'listen': ['MengMeng']})
        self.report_path = self.root/'reports/voice-boundary-deployment.json'
        self.smoke_path = self.root/'reports/voice-casting-smoke.json'
        self.deployment_path = self.root/'reports/voice-casting-deployment.json'
        self.report = {
            'schema': 1, 'project': 'qiandengji', 'ok': True, 'restored': True,
            'normalRecorderRestored': True, 'normalRecorderSha256': self.sha(self.config),
            'startedAt': '2026-09-07T11:55:00Z', 'finishedAt': '2026-09-07T12:05:00Z',
        }
        self.smoke = {'schema': 1, 'project': 'qiandengji', 'ok': True,
                      'startedAt': '2026-09-07T20:00:30+08:00', 'finishedAt': '2026-09-07T20:01:00+08:00'}
        self.deployment = {'schema': 1, 'ok': True, 'restored': True,
                           'startedAt': '2026-09-07T20:00:00+08:00', 'finishedAt': '2026-09-07T20:02:00+08:00'}
        for path, value in self.reports():
            self.write(path, value)
        for patcher in (patch.object(health, 'PROJECT', self.root),
                        patch.object(health.subprocess, 'run', side_effect=AssertionError('No Docker')),
                        patch.object(health.urllib.request, 'urlopen', side_effect=AssertionError('No HTTP'))):
            patcher.start()
            self.addCleanup(patcher.stop)

    def reports(self):
        return ((self.report_path, self.report), (self.smoke_path, self.smoke),
                (self.deployment_path, self.deployment))

    @staticmethod
    def write(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf-8')

    @staticmethod
    def sha(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def probe(self):
        return health.probe_voice_boundary_deployment()

    def test_exact_restoration_after_both_voice_runs_uses_instants_not_text_order(self):
        result = self.probe()
        self.assertTrue(result['ok'])
        for key in ('config_matches', 'allowlist_exact', 'marker_absent', 'normal_recorder_restored',
                    'voice_reports_ok', 'after_voice_smoke', 'after_voice_deployment'):
            self.assertTrue(result[key], key)
        self.assertFalse((self.root/'runtime').exists())

    def test_restoration_identity_and_boolean_flags_are_strict(self):
        changes = [{'schema': value} for value in (True, 1.0, '1', 2, None)]
        changes += [{'project': value} for value in ('shadow', None, True)]
        changes += [{key: value} for key in ('ok', 'restored', 'normalRecorderRestored')
                    for value in (False, 1, 'true', None)]
        for change in changes:
            with self.subTest(change=change):
                self.write(self.report_path, {**self.report, **change})
                self.assertFalse(self.probe()['ok'])

    def test_config_requires_recorded_original_hash_and_exact_current_bytes(self):
        for digest in (None, True, '', 'a'*63, 'g'*64, '0'*64):
            self.write(self.report_path, {**self.report, 'normalRecorderSha256': digest})
            result = self.probe()
            self.assertFalse(result['ok'])
            self.assertFalse(result['config_matches'])
        self.write(self.report_path, self.report)
        self.config.write_bytes(self.config.read_bytes() + b'\n')
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertTrue(result['allowlist_exact'])
        self.assertFalse(result['config_matches'])

    def test_matching_hash_cannot_authorize_a_changed_or_expanded_allowlist(self):
        for value in ({'listen': ['QDGuildProbe']}, {'listen': ['MengMeng', 'QDGuildProbe']},
                      {'listen': ['MengMeng', 'MengMeng']}, {'listen': 'MengMeng'},
                      {'listen': ['mengmeng']}, {'listen': []}, {'listen': ['MengMeng'], 'extra': True},
                      {}, [], None):
            with self.subTest(value=value):
                self.write(self.config, value)
                self.write(self.report_path, {**self.report, 'normalRecorderSha256': self.sha(self.config)})
                result = self.probe()
                self.assertFalse(result['ok'])
                self.assertTrue(result['config_matches'])
                self.assertFalse(result['allowlist_exact'])

    def test_temporary_owner_marker_must_be_absent_even_if_empty_or_malformed(self):
        for raw in ('', '{partial', '{"owner":"still-running"}'):
            self.marker.write_text(raw, encoding='utf-8')
            result = self.probe()
            self.assertFalse(result['ok'])
            self.assertFalse(result['marker_absent'])
        self.marker.unlink()
        self.marker.mkdir()
        self.assertFalse(self.probe()['ok'])
        self.marker.rmdir()
        self.assertTrue(self.probe()['ok'])

    def test_missing_or_malformed_outer_report_and_config_fail_closed(self):
        for path, original in ((self.report_path, self.report_path.read_bytes()),
                               (self.config, self.config.read_bytes())):
            for raw in ('{partial', '{}', 'null', '[]'):
                path.write_text(raw, encoding='utf-8')
                self.assertFalse(self.probe()['ok'])
            path.unlink()
            self.assertFalse(self.probe()['ok'])
            path.write_bytes(original)
        self.assertTrue(self.probe()['ok'])

    def test_missing_or_malformed_inner_reports_cannot_use_old_outer_success(self):
        for path, original in self.reports()[1:]:
            for raw in ('{partial', '{}', 'null', '[]'):
                path.write_text(raw, encoding='utf-8')
                self.assertFalse(self.probe()['ok'])
            path.unlink()
            self.assertFalse(self.probe()['ok'])
            self.write(path, original)

    def test_failed_inner_smoke_or_deployment_cannot_use_green_outer_report(self):
        for path, original in self.reports()[1:]:
            for key in ('ok', 'restored') if path == self.deployment_path else ('ok',):
                for value in (False, None, 'true', 1):
                    self.write(path, {**original, key: value})
                    result = self.probe()
                    self.assertFalse(result['ok'])
                    self.assertFalse(result['voice_reports_ok'])
            self.write(path, original)

    def test_all_report_intervals_require_timezone_and_ordered_endpoints(self):
        for path, original in self.reports():
            changes = [{'startedAt': value} for value in (None, 1, 'invalid', '2026-09-07T12:00:00')]
            changes += [{'finishedAt': value} for value in (None, 1, 'invalid', '2026-09-07T12:01:00')]
            changes += [{'startedAt': '2026-09-08T00:00:00Z'}, {'finishedAt': '2026-09-06T00:00:00Z'}]
            for change in changes:
                with self.subTest(path=path.name, change=change):
                    self.write(path, {**original, **change})
                    self.assertFalse(self.probe()['ok'])
            self.write(path, original)

    def test_outer_finish_must_be_strictly_later_than_both_current_voice_reports(self):
        for path, original in self.reports()[1:]:
            for finish in ('2026-09-07T12:05:00Z', '2026-09-07T20:05:00+08:00', '2026-09-07T20:06:00+08:00'):
                self.write(path, {**original, 'finishedAt': finish})
                self.assertFalse(self.probe()['ok'])
            self.write(path, original)
        self.write(self.report_path, {**self.report, 'finishedAt': '2026-09-07T20:00:45+08:00'})
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertFalse(result['after_voice_smoke'])
        self.assertFalse(result['after_voice_deployment'])

    def test_panel_requires_final_normal_recorder_restoration(self):
        with patch.object(health, 'probe_panel_http', return_value={'ok': True}), \
                patch.object(health, 'probe_management', return_value={'ok': True}), \
                patch.object(health, 'probe_operations_team', return_value={'ok': True}), \
                patch.object(health, 'probe_game_qwenpaw', return_value={'ok': True}), \
                patch.object(health, 'probe_survivor', return_value={'ok': True}), \
                patch.object(health, 'probe_recorded_behavior', return_value={'ok': True}), \
                patch.object(health, 'probe_source_record', return_value={'ok': True}), \
                patch.object(health, 'probe_player_commands', return_value={'ok': True}), \
                patch.object(health, 'probe_voice_commands', return_value={'ok': True}), \
                patch.object(health, 'probe_chanting_staff', return_value={'ok': True}), \
                patch.object(health, 'probe_voice_recording', return_value={'ok': True}), \
                patch.object(health, 'probe_skillbar_editor', return_value={'ok': True}), \
                patch.object(health, 'probe_chanting_client', return_value={'ok': True}):
            self.assertTrue(health.probe_panel_smoke()['ok'])
            self.marker.write_text('temporary QA owner', encoding='utf-8')
            result = health.probe_panel_smoke()
            self.assertFalse(result['ok'])
            self.assertFalse(result['voice_boundary_deployment']['ok'])
            self.assertTrue(result['voice_commands']['ok'])


if __name__ == '__main__':
    unittest.main()
