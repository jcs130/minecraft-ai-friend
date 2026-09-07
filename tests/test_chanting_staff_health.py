"""Offline checks for live staff protocol and the exact tested item deployment."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / 'world/ops/health/health_mon.py'
spec = importlib.util.spec_from_file_location('chanting_staff_health', SOURCE)
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)

# The actual live smoke contract, intentionally independent of probe constants.
ITEMS = ['qiandeng_chanting:whispering_staff', 'qiandeng_chanting:resonance_staff']
CHECKS = [
    'staff:registered-items-and-recipes', 'staff:direct-voice-without-staff',
    'staff:holding-needs-gesture', 'staff:whispering-gesture-single-claim',
    'staff:resonance-gesture-single-claim', 'staff:release-grace-claim',
    'staff:expired-release-rejected', 'staff:hand-swap-rejected',
    'staff:same-item-replacement-rejected', 'staff:mode-payload-and-late-voice',
    'staff:audio-boundary-handshake',
]
PREFIX = 'QD_CHANT_JSON '


class ChantingStaffHealth(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='qd-staff-health-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.behavior_path = self.root / 'reports/chanting-staff-smoke.json'
        self.smoke_path = self.root / 'tools/smoke_chanting_staff.mjs'
        self.smoke_path.parent.mkdir(parents=True)
        self.smoke_path.write_text('// offline smoke fixture\n', encoding='utf-8')
        self.source_path = self.root / 'world/chanting-items-src/GestureBook.java'
        self.source_path.parent.mkdir(parents=True)
        self.source_path.write_text('// offline Java fixture\n', encoding='utf-8')
        self.name = 'qiandeng-chanting-0.1.0.jar'
        self.jar_paths = [self.root / path / self.name for path in ('server/mc/mods', 'client/mods')]
        for path in self.jar_paths:
            path.parent.mkdir(parents=True)
            path.write_bytes(b'fixture for artifact identity only')
        self.behavior = {
            'schema': 1, 'project': 'qiandengji', 'actor': 'QDGuildProbe', 'ok': True,
            'finishedAt': '2026-09-07T12:00:00Z',
            'checks': [{'name': name, 'ok': True} for name in CHECKS],
            'cleanup': {'actorOffline': True, 'lockReleased': True, 'clientDisconnected': True},
            'preflight': {'mod': {'filename': self.name, 'sha256': self.sha(self.jar_paths[0])}},
            'sourceHashes': {'tools/smoke_chanting_staff.mjs': self.sha(self.smoke_path)},
        }
        self.source_record = {'ok': True, 'source_files': [
            {'path': str(path.relative_to(self.root)).replace('\\', '/'), 'sha256': self.sha(path)}
            for path in (self.source_path, self.smoke_path)]}
        self.write(self.behavior_path, self.behavior)
        self.write(self.root / 'reports/architecture-current.json', self.source_record)
        self.ready = {'schema': 1, 'ok': True, 'code': 'ready', 'items': ITEMS, 'audioBoundaryProtocol': 1}
        self.response = SimpleNamespace(returncode=0, stdout=PREFIX + json.dumps(self.ready), stderr='')
        for patcher in (patch.object(health, 'PROJECT', self.root),
                        patch.object(health.urllib.request, 'urlopen', side_effect=AssertionError('No HTTP'))):
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(health.subprocess, 'run', return_value=self.response)
        self.docker = patcher.start()
        self.addCleanup(patcher.stop)

    @staticmethod
    def write(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf-8')

    @staticmethod
    def sha(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def probe(self):
        return health.probe_chanting_staff()

    def test_live_protocol_and_matching_dual_installation_pass(self):
        result = self.probe()
        self.assertTrue(result['ok'])
        self.assertEqual(result['protocol']['registered_items'], ITEMS)
        self.assertEqual(result['behavior']['missing_checks'], [])
        self.assertTrue(result['artifacts']['smoke_source_matches'])
        self.docker.assert_called_once_with(
            ['docker', 'exec', 'qiandengji-mc-1', 'rcon-cli', 'qdchant health'],
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=15)

    def test_bad_current_protocol_cannot_be_hidden_by_historical_pass(self):
        changes = [{'ok': False}, {'ok': 1}, {'schema': True}, {'schema': '1'}, {'schema': 2},
                   {'code': 'ready_later'}, {'items': []}, {'items': ITEMS[:1]},
                   {'items': ITEMS[1:]}, {'items': ','.join(ITEMS)}, {'items': None}]
        for change in changes:
            with self.subTest(change=change):
                self.response.stdout = PREFIX + json.dumps({**self.ready, **change})
                result = self.probe()
                self.assertFalse(result['ok'])
                self.assertFalse(result['protocol']['ok'])
                self.assertTrue(result['behavior']['ok'])

    def test_loaded_server_must_advertise_exact_audio_boundary_protocol(self):
        old_ready = {key: value for key, value in self.ready.items() if key != 'audioBoundaryProtocol'}
        for value in [old_ready, *({**self.ready, 'audioBoundaryProtocol': version}
                                  for version in (None, True, 1.0, '1', 0, 2))]:
            with self.subTest(value=value):
                self.response.stdout = PREFIX + json.dumps(value)
                result = self.probe()
                self.assertFalse(result['ok'])
                self.assertFalse(result['protocol']['ok'])
                self.assertTrue(result['behavior']['ok'])
                self.assertTrue(result['artifacts']['ok'])
        self.response.stdout = PREFIX + json.dumps(self.ready)
        result = self.probe()
        self.assertTrue(result['ok'])
        self.assertEqual(result['protocol']['audio_boundary_protocol'], 1)

    def test_missing_ambiguous_invalid_or_oversized_envelope_rejected(self):
        valid = PREFIX + json.dumps(self.ready)
        for raw in ['', 'Unknown command', valid + '\n' + valid, PREFIX + '{partial',
                    PREFIX + 'null', PREFIX + '[]', 'x' * 8193, '\u4e2d' * 3000]:
            with self.subTest(raw=raw[:40]):
                self.response.stdout = raw
                self.assertFalse(self.probe()['ok'])
        self.response.stdout = 'harmless transport line\n' + valid + '\n'
        self.assertTrue(self.probe()['ok'])

    def test_process_failure_timeout_or_missing_docker_fails_closed_without_raw_error(self):
        self.response.returncode = 1
        self.response.stderr = 'simulated sensitive process output'
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertNotIn(self.response.stderr, json.dumps(result))
        for error in (OSError('private path'), subprocess.TimeoutExpired('private command', 15),
                      subprocess.SubprocessError('private error')):
            with self.subTest(error=type(error).__name__):
                self.docker.side_effect = error
                result = self.probe()
                self.assertFalse(result['ok'])
                self.assertNotIn('private', json.dumps(result))

    def test_each_of_eleven_gesture_checks_must_exist_and_really_pass(self):
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

    def test_report_identity_schema_cleanup_and_completeness_required(self):
        changes = [{'ok': False}, {'ok': 1}, {'schema': True}, {'schema': 2}, {'project': 'shadow'},
                   {'actor': 'MengMeng'}, {'checks': None}, {'checks': {}}, {'cleanup': None},
                   {'cleanup': {}}, {'preflight': None}, {'preflight': {}}, {'sourceHashes': {}}]
        for key in self.behavior['cleanup']:
            for value in [False, 1, None]:
                changes.append({'cleanup': {**self.behavior['cleanup'], key: value}})
        for change in changes:
            with self.subTest(change=change):
                self.write(self.behavior_path, {**self.behavior, **change})
                self.assertFalse(self.probe()['ok'])
        for raw in ['{partial', 'null', '[]']:
            self.behavior_path.write_text(raw, encoding='utf-8')
            self.assertFalse(self.probe()['ok'])
        self.behavior_path.unlink()
        self.assertFalse(self.probe()['ok'])

    def test_both_installed_jars_and_smoke_source_must_match_tested_bytes(self):
        for path in [*self.jar_paths, self.smoke_path]:
            with self.subTest(path=str(path.relative_to(self.root))):
                original = path.read_bytes()
                path.write_bytes(b'changed since live QA')
                result = self.probe()
                self.assertFalse(result['ok'])
                self.assertFalse(result['artifacts']['ok'])
                path.unlink()
                self.assertFalse(self.probe()['ok'])
                path.write_bytes(original)
                self.assertTrue(self.probe()['ok'])

    def test_unsafe_or_invalid_artifact_identity_is_rejected(self):
        for name in ['../outside.jar', '..\\outside.jar', '/absolute.jar',
                     'qiandeng-chanting-../outside.jar', 'old-controls.jar', None]:
            with self.subTest(name=name):
                self.write(self.behavior_path, {**self.behavior, 'preflight': {'mod': {
                    'filename': name, 'sha256': self.behavior['preflight']['mod']['sha256']}}})
                self.assertFalse(self.probe()['ok'])
        for digest in ['', 'z' * 64, 1, None, 'a' * 63]:
            with self.subTest(digest=digest):
                self.write(self.behavior_path, {**self.behavior, 'preflight': {'mod': {
                    'filename': self.name, 'sha256': digest}}})
                self.assertFalse(self.probe()['ok'])

    def test_current_java_source_or_missing_architecture_record_blocks_pass(self):
        self.source_path.write_text('// Java changed\n', encoding='utf-8')
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertTrue(result['protocol']['ok'])
        self.assertTrue(result['behavior']['ok'])
        self.assertTrue(result['artifacts']['ok'])
        self.assertFalse(result['sources']['ok'])
        (self.root / 'reports/architecture-current.json').unlink()
        self.assertFalse(self.probe()['ok'])

    def test_panel_smoke_requires_staff_protocol_and_behavior(self):
        with patch.object(health, 'probe_panel_http', return_value={'ok': True}), \
                patch.object(health, 'probe_management', return_value={'ok': True}), \
                patch.object(health, 'probe_operations_team', return_value={'ok': True}), \
                patch.object(health, 'probe_game_qwenpaw', return_value={'ok': True}), \
                patch.object(health, 'probe_survivor', return_value={'ok': True}), \
                patch.object(health, 'probe_recorded_behavior', return_value={'ok': True}), \
                patch.object(health, 'probe_player_commands', return_value={'ok': True}), \
                patch.object(health, 'probe_voice_commands', return_value={'ok': True}), \
                patch.object(health, 'probe_voice_recording', return_value={'ok': True}), \
                patch.object(health, 'probe_voice_boundary_deployment', return_value={'ok': True}), \
                patch.object(health, 'probe_skillbar_editor', return_value={'ok': True}), \
                patch.object(health, 'probe_chanting_client', return_value={'ok': True}):
            self.assertTrue(health.probe_panel_smoke()['ok'])
            self.response.stdout = 'Unknown command'
            result = health.probe_panel_smoke()
            self.assertFalse(result['ok'])
            self.assertFalse(result['chanting_staff']['ok'])
            self.assertTrue(result['voice_commands']['ok'])
            self.response.stdout = PREFIX + json.dumps(self.ready)
            self.behavior_path.unlink()
            self.assertFalse(health.probe_panel_smoke()['ok'])

    def test_pre_handshake_staff_success_cannot_hide_new_boundary_behavior(self):
        required = {'staff:mode-payload-and-late-voice', 'staff:audio-boundary-handshake'}
        report = {**self.behavior, 'checks': [row for row in self.behavior['checks'] if row['name'] not in required]}
        self.write(self.behavior_path, report)
        result = self.probe()
        self.assertFalse(result['ok'])
        self.assertTrue(result['protocol']['ok'])
        self.assertTrue(result['artifacts']['ok'])
        self.assertEqual(result['behavior']['missing_checks'], sorted(required))


if __name__ == '__main__':
    unittest.main()
