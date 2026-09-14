import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('interaction_health', ROOT/'tools/world_interaction_health.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class WorldInteractionHealthTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.now = 1800000000
        self.identity = {'bodyUuid': 'd4ac9523-4962-43ed-98c5-19b49e104048',
            'ownerUuid': 'e5005711-be9f-44b7-aaad-6993c0ba5df4', 'bodyName': 'Kirito'}
        self.write(probe.SETTINGS, self.identity)
        self.write(probe.CONFIG, {'schema': 1, 'enabled': True, 'bodies': [self.identity]})
        for name in (probe.JAR, probe.BUILD_JAR, probe.NUMEN, *probe.REQUIRED_SOURCES):
            path = self.root/name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b'fixture')
        self.record = {'ok': True, 'sha256': probe.digest(self.root, probe.JAR),
            'sources': {name: probe.digest(self.root, name) for name in probe.REQUIRED_SOURCES},
            'dependencies': {Path(probe.NUMEN).name: probe.digest(self.root, probe.NUMEN)}}
        self.write(probe.BUILD_RECORD, self.record)
        self.manifest = {'schema_version': 1, 'files': [{'path': probe.JAR, 'sha256': self.record['sha256']}]}
        self.write(probe.MANIFEST, self.manifest)
        self.calls = []

    def write(self, name, value):
        path = self.root/name; path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding='utf8')

    def sample(self, body, request, operation='interaction'):
        self.calls.append((body, request, operation))
        return {'schema': 1, 'capability': probe.CAPABILITY, 'actorUuid': body, 'requestId': request,
            'epoch': '90123456-1234-1234-1234-123456789abc', 'tool': 'drop_items' if operation == 'dropping' else 'interact_at',
            'status': 'unknown', 'code': 'request_not_found', 'observedAt': self.now*1000}

    def check(self, sample=None):
        return probe.check(self.root, sample or self.sample, lambda: self.now)

    def test_healthy_is_two_unused_queries_without_writes(self):
        before = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        result = self.check()
        self.assertTrue(result['ok'])
        self.assertEqual(len(self.calls), 2)
        self.assertRegex(self.calls[0][1], '^[0-9a-f]{32}$')
        self.assertEqual(result['interactionSubmissions'], 0)
        self.assertEqual(result['dropSubmissions'], 0)
        self.assertEqual([row[2] for row in self.calls], ['interaction', 'dropping'])
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_build_manifest_installed_and_sources_must_all_match(self):
        self.manifest['files'].append(copy.deepcopy(self.manifest['files'][0]))
        self.write(probe.MANIFEST, self.manifest)
        self.assertFalse(self.check()['checks']['artifact_matches_build_and_manifest'])
        self.manifest['files'].pop(); self.write(probe.MANIFEST, self.manifest)
        (self.root/probe.BUILD_JAR).write_bytes(b'another-build')
        self.assertFalse(self.check()['checks']['artifact_matches_build_and_manifest'])
        source = next(iter(probe.REQUIRED_SOURCES)); (self.root/source).write_bytes(b'changed')
        self.assertFalse(self.check()['checks']['source_current'])

    def test_wrong_protocol_identity_stale_or_existing_request_is_unhealthy(self):
        for changes in ({'schema': True}, {'requestId': 'a'*32}, {'actorUuid': self.identity['ownerUuid']},
                {'epoch': 'invalid'}, {'code': 'native_runtime_interrupted'}, {'status': 'accepted'},
                {'observedAt': (self.now-16)*1000}, {'result': {'success': True}}):
            with self.subTest(changes=changes):
                result = self.check(lambda body, request, operation: self.sample(body, request, operation) | changes)
                self.assertFalse(result['checks']['native_receipt_protocol'])

    def test_drop_protocol_or_numen_dependency_cannot_be_substituted(self):
        def wrong_drop(body, request, operation):
            return self.sample(body, request, 'interaction')
        result = self.check(wrong_drop)
        self.assertTrue(result['checks']['native_receipt_protocol'])
        self.assertFalse(result['checks']['native_drop_receipt_protocol'])
        (self.root/probe.NUMEN).write_bytes(b'new Numen requires actual rebuild')
        self.assertFalse(self.check()['checks']['pinned_numen_dependency'])

    def test_wrong_body_binding_prevents_native_query(self):
        self.write(probe.CONFIG, {'schema': 1, 'enabled': True, 'bodies': []})
        self.assertFalse(self.check()['ok'])
        self.assertEqual(self.calls, [])

    def test_cli_uses_only_query_and_tolerates_surrounding_logs(self):
        body, request = self.identity['bodyUuid'], 'b'*32
        value = self.sample(body, request)
        raw = '[server] ready\n' + probe.PREFIX + json.dumps(value, indent=2) + '\n[server] another log\n'
        with patch.object(probe.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=raw)) as run:
            self.assertEqual(probe.read_status(body, request), value)
        self.assertEqual(run.call_args.args[0], ['docker', 'exec', 'qiandengji-mc-1', 'rcon-cli',
            f'qdworld interaction {body} {request}'])
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            probe.parse_reply(raw + raw)

    def test_query_failures_do_not_expose_raw_stderr_or_retry(self):
        with patch.object(probe.subprocess, 'run', return_value=SimpleNamespace(returncode=1,
                stdout='', stderr='private fixture secret')) as run:
            with self.assertRaisesRegex(ValueError, '^native_query_unavailable$'):
                probe.read_status(self.identity['bodyUuid'], 'b'*32)
            self.assertEqual(run.call_count, 1)
        def timeout(*args):
            raise subprocess.TimeoutExpired('private fixture command', 12)
        result = self.check(timeout)
        self.assertFalse(result['ok'])
        self.assertNotIn('private fixture', json.dumps(result))


if __name__ == '__main__': unittest.main()
