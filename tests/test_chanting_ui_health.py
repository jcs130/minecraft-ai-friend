"""Offline regressions: old green reports cannot certify the new editor/client."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1]/'world/ops/health/health_mon.py'
spec = importlib.util.spec_from_file_location('chanting_ui_health', SOURCE)
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)
EDITOR_CHECKS = ['skillbar:compass-editor-eight-slots', 'skillbar:shift-cannot-edit',
    'skillbar:click-set-mirrored-and-unique', 'skillbar:click-clear-preserves-positions',
    'skillbar:click-auto-same-service', 'skillbar:editing-does-not-cast']
CLIENT_CHECKS = ['qa-backed-up', 'real-neoforge-joined', 'both-items-registered',
    'two-item-framebuffers-captured', 'editor-framebuffer-captured', 'current-client-log-no-new-errors']
CLIENT_CLEANUP = ['qaOffline', 'ownedClientStopped', 'qaNativeRestored', 'qaMagicRestored',
    'otherProfilesPreservedDuringRestore', 'historicalRuntimeRestored', 'worldHealthy',
    'mcNotRestarted', 'audioRecorderUnchanged', 'lockReleased']


class ChantingUiHealth(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='qd-ui-health-')
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.editor_path = self.root/'reports/skillbar-editor-smoke.json'
        self.client_path = self.root/'reports/chanting-client-smoke.json'
        self.restore_path = self.root/'reports/chanting-gameplay-restoration.json'
        self.botgate = self.root/'server/mc/mods/botgate.jar'
        self.editor_source = self.root/'tools/smoke_skillbar_editor.mjs'
        self.jars = [self.root/path/'qiandeng-chanting-0.1.0.jar' for path in ('server/mc/mods', 'client/mods')]
        for path in [self.botgate, self.editor_source, *self.jars]:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'current UI build/source identity fixture')
        interval = {'startedAt': '2026-09-07T17:00:00+08:00', 'finishedAt': '2026-09-07T09:01:00Z'}
        self.editor = {'schema': 1, 'project': 'qiandengji', 'actor': 'QDGuildProbe', 'ok': True, **interval,
            'checks': [{'name': name, 'ok': True} for name in EDITOR_CHECKS],
            'cleanup': {'clientDisconnected': True, 'actorOffline': True, 'lockReleased': True},
            'preflight': {'botgateSha256': self.sha(self.botgate)},
            'sourceHashes': {'tools/smoke_skillbar_editor.mjs': self.sha(self.editor_source)}}
        self.restoration = {'ok': True, 'restored': True, 'startedAt': '2026-09-07T08:59:00Z',
                            'finishedAt': '2026-09-07T17:02:00+08:00'}
        screenshots = []
        for i, kind in enumerate(['qiandeng_chanting:whispering_staff', 'qiandeng_chanting:resonance_staff', 'skillbar-editor']):
            path = self.root/'client/screenshots'/f'reviewed-{i}.png'
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'PNG identity fixture '+str(i).encode())
            screenshots.append({'kind': kind, 'path': str(path), 'sha256': self.sha(path), 'visualReviewed': True})
        self.client = {'schema': 1, 'project': 'qiandengji', 'actor': 'QiandengTest', 'ok': True, **interval,
            'status': 'verified', 'visualReview': 'verified', 'restored': True,
            'checks': [{'name': name, 'ok': True} for name in CLIENT_CHECKS],
            'jarSha256': self.sha(self.jars[0]), 'screenshots': screenshots,
            'cleanup': {name: True for name in CLIENT_CLEANUP}, 'clientLog': {'newErrorCount': 0},
            'unverified': ['physical controller', 'microphone capture', 'actual held-use HUD']}
        self.write(self.editor_path, self.editor)
        self.write(self.restore_path, self.restoration)
        self.write(self.client_path, self.client)
        for patcher in (patch.object(health, 'PROJECT', self.root),
                        patch.object(health.subprocess, 'run', side_effect=AssertionError('No Docker')),
                        patch.object(health.urllib.request, 'urlopen', side_effect=AssertionError('No HTTP'))):
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def sha(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    @staticmethod
    def write(path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding='utf-8')

    def test_current_editor_and_reviewed_client_pass_with_hardware_scope_preserved(self):
        self.assertTrue(health.probe_skillbar_editor()['ok'])
        result = health.probe_chanting_client()
        self.assertTrue(result['ok'])
        self.assertEqual(result['unverified'], self.client['unverified'])
        self.assertFalse((self.root/'runtime').exists())

    def test_editor_requires_exact_identity_and_all_six_passed_checks(self):
        for change in [{'ok': False}, {'ok': 1}, {'schema': True}, {'project': 'shadow'}, {'actor': 'MengMeng'}]:
            self.write(self.editor_path, {**self.editor, **change})
            self.assertFalse(health.probe_skillbar_editor()['ok'])
        for name in EDITOR_CHECKS:
            for value in (False, 'true', 1, None):
                with self.subTest(name=name, value=value):
                    checks = [{'name': n, 'ok': value if n == name else True} for n in EDITOR_CHECKS]
                    self.write(self.editor_path, {**self.editor, 'checks': checks})
                    self.assertFalse(health.probe_skillbar_editor()['ok'])

    def test_editor_matches_current_botgate_and_all_recorded_sources(self):
        for path in (self.botgate, self.editor_source):
            before = path.read_bytes()
            path.write_bytes(b'changed after editor QA')
            self.assertFalse(health.probe_skillbar_editor()['ok'])
            path.write_bytes(before)
        for hashes in ({}, {'tools/smoke_skillbar_editor.mjs': '0'*64},
                       {**self.editor['sourceHashes'], '../outside': '0'*64}):
            self.write(self.editor_path, {**self.editor, 'sourceHashes': hashes})
            self.assertFalse(health.probe_skillbar_editor()['ok'])

    def test_editor_requires_cleanup_and_restoration_covering_this_run(self):
        for key in self.editor['cleanup']:
            self.write(self.editor_path, {**self.editor, 'cleanup': {**self.editor['cleanup'], key: False}})
            self.assertFalse(health.probe_skillbar_editor()['ok'])
        self.write(self.editor_path, self.editor)
        for change in [{'ok': False}, {'restored': False}, {'restored': 1},
                       {'startedAt': '2026-09-07T09:00:01Z'}, {'finishedAt': '2026-09-07T09:00:59Z'}]:
            self.write(self.restore_path, {**self.restoration, **change})
            self.assertFalse(health.probe_skillbar_editor()['ok'])

    def test_client_capture_without_completed_visual_review_is_not_a_pass(self):
        for change in [{'status': 'captured_awaiting_visual_review'}, {'visualReview': 'pending'},
                       {'visualReview': True}, {'ok': 1}]:
            self.write(self.client_path, {**self.client, **change})
            self.assertFalse(health.probe_chanting_client()['ok'])
        for i in range(3):
            shots = [{**row, 'visualReviewed': False if n == i else True} for n, row in enumerate(self.client['screenshots'])]
            self.write(self.client_path, {**self.client, 'screenshots': shots})
            self.assertFalse(health.probe_chanting_client()['ok'])

    def test_client_jar_hash_must_match_both_current_installations(self):
        for path in self.jars:
            before = path.read_bytes()
            path.write_bytes(b'previous model build')
            self.assertFalse(health.probe_chanting_client()['ok'])
            path.unlink()
            self.assertFalse(health.probe_chanting_client()['ok'])
            path.write_bytes(before)
            self.assertTrue(health.probe_chanting_client()['ok'])

    def test_reviewed_screenshots_require_current_hashes_kinds_and_owned_paths(self):
        for i, row in enumerate(self.client['screenshots']):
            path = Path(row['path'])
            before = path.read_bytes()
            path.write_bytes(b'replaced screenshot')
            self.assertFalse(health.probe_chanting_client()['ok'])
            path.write_bytes(before)
            for change in [{'path': str(self.root/'elsewhere.png')}, {'kind': 'unexpected'}, {'sha256': '0'*64}]:
                shots = [{**s, **(change if n == i else {})} for n, s in enumerate(self.client['screenshots'])]
                self.write(self.client_path, {**self.client, 'screenshots': shots})
                self.assertFalse(health.probe_chanting_client()['ok'])
            self.write(self.client_path, self.client)
        for shots in ([], self.client['screenshots'][:2], [self.client['screenshots'][0]]*3):
            self.write(self.client_path, {**self.client, 'screenshots': shots})
            self.assertFalse(health.probe_chanting_client()['ok'])

    def test_client_restore_claim_cannot_hide_any_failed_cleanup_flag(self):
        for key in CLIENT_CLEANUP:
            for value in (False, 1, None):
                self.write(self.client_path, {**self.client, 'cleanup': {**self.client['cleanup'], key: value}})
                self.assertFalse(health.probe_chanting_client()['ok'])
        self.write(self.client_path, {**self.client, 'restored': False})
        self.assertFalse(health.probe_chanting_client()['ok'])

    def test_client_requires_six_behavior_checks_and_no_new_logged_errors(self):
        for name in CLIENT_CHECKS:
            checks = [row for row in self.client['checks'] if row['name'] != name]
            self.write(self.client_path, {**self.client, 'checks': checks})
            self.assertFalse(health.probe_chanting_client()['ok'])
        for log in ({'newErrorCount': 1}, {'newErrorCount': False}, {}, None):
            self.write(self.client_path, {**self.client, 'clientLog': log})
            self.assertFalse(health.probe_chanting_client()['ok'])

    def test_chronology_uses_timezone_aware_instants_not_string_order(self):
        self.assertGreater(self.editor['startedAt'], self.editor['finishedAt'])
        self.assertTrue(health.report_interval_ok(self.editor))
        self.assertTrue(health.probe_skillbar_editor()['ok'])
        for change in [{'finishedAt': '2026-09-07T08:59:59Z'}, {'startedAt': '2026-09-07T09:00:00'},
                       {'finishedAt': None}, {'startedAt': 'invalid'}]:
            self.write(self.editor_path, {**self.editor, **change})
            self.write(self.client_path, {**self.client, **change})
            self.assertFalse(health.probe_skillbar_editor()['ok'])
            self.assertFalse(health.probe_chanting_client()['ok'])

    def test_missing_or_malformed_reports_fail_closed(self):
        for path, probe in [(self.editor_path, health.probe_skillbar_editor), (self.client_path, health.probe_chanting_client)]:
            for raw in ('{partial', '{}', 'null', '[]'):
                path.write_text(raw, encoding='utf-8')
                self.assertFalse(probe()['ok'])
            path.unlink()
            self.assertFalse(probe()['ok'])

    def test_old_green_panel_cannot_hide_new_editor_or_client_failures(self):
        with patch.object(health, 'probe_panel_http', return_value={'ok': True}), \
                patch.object(health, 'probe_management', return_value={'ok': True}), \
                patch.object(health, 'probe_recorded_behavior', return_value={'ok': True}), \
                patch.object(health, 'probe_source_record', return_value={'ok': True}), \
                patch.object(health, 'probe_player_commands', return_value={'ok': True}), \
                patch.object(health, 'probe_voice_commands', return_value={'ok': True}), \
                patch.object(health, 'probe_chanting_staff', return_value={'ok': True}), \
                patch.object(health, 'probe_operations_team', return_value={'ok': True}), \
                patch.object(health, 'probe_voice_boundary_deployment', return_value={'ok': True}), \
                patch.object(health, 'probe_voice_recording', return_value={'ok': True}):
            self.assertTrue(health.probe_panel_smoke()['ok'])
            self.editor_path.unlink()
            result = health.probe_panel_smoke()
            self.assertFalse(result['ok'])
            self.assertFalse(result['skillbar_editor']['ok'])
            self.assertTrue(result['chanting_client']['ok'])
            self.write(self.editor_path, self.editor)
            self.write(self.client_path, {**self.client, 'visualReview': 'pending'})
            self.assertFalse(health.probe_panel_smoke()['ok'])


if __name__ == '__main__':
    unittest.main()
