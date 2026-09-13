"""Native managed-file sync must not clobber concurrent edits or active roles."""
from copy import deepcopy
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import sync_team_skills as syncer


class NativeSkills:
    def __init__(self):
        self.profile = {'id': 'qd-engineer', 'name': 'Original name', 'language': 'zh', 'active_model': {'model': 'chosen'}}
        self.files = {'skills/qd-test/SKILL.md': ['old', 'v1'], 'skills/qd-test/references/a.md': ['old ref', 'v2'],
                      'skills/qd-test/references/personal.md': ['personal note', 'v3']}
        self.skills = {'qd-test': True}
        self.calls = []; self.busy = False; self.race = False; self.scan_failure = False; self.revision = 10

    def __call__(self, runtime, method, route, role, body=None, headers=None):
        assert (runtime, role) == ('game', 'qd-engineer')
        self.calls.append((method, route, deepcopy(body), deepcopy(headers)))
        if route == '/agents/qd-engineer': return deepcopy(self.profile)
        if route.endswith('/agent-status'): return {'running_task_count': int(self.busy)}
        if route == '/skills' and method == 'GET': return [{'name': n, 'enabled': e} for n, e in self.skills.items()]
        if route.startswith('/workspace/tree'): return {'entries': [], 'nextCursor': None}
        if route.startswith('/workspace/file-content?'):
            path = urllib.parse.parse_qs(urllib.parse.urlparse(route).query)['path'][0]
            if method == 'GET':
                if path not in self.files: raise urllib.error.HTTPError('local', 404, 'missing', None, None)
                content, etag = self.files[path]
                return {'content': content, 'etag': etag, 'eof': True, 'offset': 0, 'truncated': False}
            if self.race:
                self.files[path] = ['concurrent personal edit', 'new-etag']; self.race = False
            if headers['If-Match'] != self.files[path][1]:
                raise urllib.error.HTTPError('local', 409, 'changed', None, None)
            self.revision += 1; self.files[path] = [body['content'], str(self.revision)]
            return {'etag': str(self.revision)}
        if route.endswith('/disable'):
            self.skills[route.split('/')[2]] = False; return {'disabled': True}
        if route.endswith('/enable'):
            if self.scan_failure: raise urllib.error.HTTPError('local', 422, 'scan failure', None, None)
            self.skills[route.split('/')[2]] = True; return {'enabled': True}
        if route == '/skills' and method == 'POST':
            name = body['name']
            if name in self.skills: raise urllib.error.HTTPError('local', 409, 'exists', None, None)
            self.skills[name] = body['enable']; self.files['skills/' + name + '/SKILL.md'] = [body['content'], 'created']
            for p, v in body['references'].items(): self.files['skills/' + name + '/references/' + p] = [v, 'created']
            return {'created': True, 'name': name}
        raise AssertionError((method, route))

    def upload(self, runtime, role, path, content):
        assert (runtime, role) == ('game', 'qd-engineer')
        self.calls.append(('UPLOAD', path, None, None))
        if path in self.files: raise urllib.error.HTTPError('local', 409, 'exists', None, None)
        self.files[path] = [content, 'uploaded']


class SyncTeamSkillTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        folder = self.root / 'world/ops/skills/qd-test'; (folder / 'references').mkdir(parents=True)
        (folder / 'SKILL.md').write_text('new skill', encoding='utf8')
        (folder / 'references/a.md').write_text('new ref', encoding='utf8')
        (folder / 'references/b.md').write_text('brand new ref', encoding='utf8')
        self.native = NativeSkills()
        for p in (patch.object(syncer, 'members', return_value={'operations:mc-god': ('name', 'duty')}),
                  patch.object(syncer, 'native_host', return_value={'runtime': 'game', 'agentId': 'qd-engineer'}),
                  patch.object(syncer, 'require_host')):
            p.start(); self.addCleanup(p.stop)

    def run_sync(self, apply=True):
        return syncer.sync(['operations:mc-god'], ['qd-test'], apply=apply, root=self.root,
                           call=self.native, upload=self.native.upload)

    def test_preview_has_no_mutations_or_backup_and_resolves_engineer(self):
        result = self.run_sync(False)
        self.assertEqual(result['skills'][0]['nativeHost']['agentId'], 'qd-engineer')
        self.assertEqual(result['skills'][0]['changes'], ['SKILL.md', 'references/a.md', 'references/b.md'])
        self.assertTrue(all(c[0] == 'GET' for c in self.native.calls))
        self.assertFalse((self.root / 'runtime').exists())

    def test_sync_cas_new_reference_scan_preserves_notes_then_noop(self):
        result = self.run_sync()
        puts = [c for c in self.native.calls if c[0] == 'PUT']
        self.assertEqual([c[3]['If-Match'] for c in puts], ['v1', 'v2'])
        self.assertTrue(any(c[0] == 'UPLOAD' for c in self.native.calls))
        self.assertTrue(self.native.skills['qd-test'])
        self.assertEqual(self.native.files['skills/qd-test/references/personal.md'][0], 'personal note')
        journal = json.loads((Path(result['backup']) / 'journal.json').read_text('utf8'))
        self.assertEqual(journal['phase'], 'verified')
        self.native.calls.clear()
        self.assertEqual(self.run_sync()['mode'], 'noop')
        self.assertTrue(all(c[0] == 'GET' for c in self.native.calls))

    def test_initial_busy_never_writes(self):
        self.native.busy = True
        with self.assertRaisesRegex(ValueError, 'native_role_busy'): self.run_sync()
        self.assertTrue(all(c[0] == 'GET' for c in self.native.calls))

    def test_reference_only_update_invalidates_scan_with_same_content_etag_save(self):
        self.native.files['skills/qd-test/SKILL.md'][0] = 'new skill'
        result = self.run_sync()
        puts = [c for c in self.native.calls if c[0] == 'PUT']
        self.assertEqual(puts[-1][2], {'content': 'new skill'})
        self.assertEqual(puts[-1][3], {'If-Match': 'v1'})
        self.assertEqual(urllib.parse.parse_qs(urllib.parse.urlparse(puts[-1][1]).query)['path'],
                         ['skills/qd-test/SKILL.md'])
        self.assertLess(self.native.calls.index(puts[-1]),
                        next(i for i,c in enumerate(self.native.calls) if c[1].endswith('/enable')))
        self.assertEqual(self.native.files['skills/qd-test/SKILL.md'][0], 'new skill')
        journal = json.loads((Path(result['backup'])/'journal.json').read_text('utf8'))
        self.assertTrue(any(r.get('nativeSameContentSaveForScan') for r in journal['completed']))

    def test_reference_only_scan_touch_preserves_concurrent_skill_edit(self):
        self.native.files['skills/qd-test/SKILL.md'][0] = 'new skill'
        def call(*args, **kwargs):
            if args[1] == 'PUT' and urllib.parse.parse_qs(urllib.parse.urlparse(args[2]).query).get('path') == ['skills/qd-test/SKILL.md']:
                self.native.race = True
            return self.native(*args, **kwargs)
        with self.assertRaises(urllib.error.HTTPError):
            syncer.sync(['operations:mc-god'], ['qd-test'], apply=True, root=self.root, call=call, upload=self.native.upload)
        self.assertEqual(self.native.files['skills/qd-test/SKILL.md'][0], 'concurrent personal edit')
        self.assertFalse(self.native.skills['qd-test'])
        self.assertFalse(any(c[1].endswith('/enable') for c in self.native.calls))

    def test_native_same_value_save_changes_actual_scan_signature(self):
        try:
            from qwenpaw.services.workspace_files import save_text_file, file_etag
            from qwenpaw.security.skill_scanner import _get_dir_mtime, compute_skill_content_hash
        except ImportError:
            self.skipTest('pinned Qwen file/scanner implementation is tested in the Linux image')
        skill = self.root/'native-scan-fixture'; refs = skill/'references'; refs.mkdir(parents=True)
        main = skill/'SKILL.md'; ref = refs/'a.md'
        main.write_text('Unchanged skill',encoding='utf8'); ref.write_text('Old reference',encoding='utf8')
        for path in (main, ref, refs, skill): os.utime(path, (1000,1000))
        before = _get_dir_mtime(skill)
        save_text_file(skill, 'references/a.md', 'Updated reference', file_etag(ref.stat()))
        self.assertEqual(_get_dir_mtime(skill), before)
        source_hash = compute_skill_content_hash(skill)
        save_text_file(skill, 'SKILL.md', main.read_text('utf8'), file_etag(main.stat()))
        self.assertNotEqual(_get_dir_mtime(skill), before)
        self.assertEqual(compute_skill_content_hash(skill), source_hash)

    def test_becomes_busy_at_mutation_boundary_does_not_write(self):
        original = self.native
        checks = 0
        def call(*args, **kwargs):
            nonlocal checks
            if args[2].endswith('/agent-status'):
                checks += 1
                if checks == 2: original.busy = True
            return original(*args, **kwargs)
        with self.assertRaisesRegex(ValueError, 'native_role_became_busy'):
            syncer.sync(['operations:mc-god'], ['qd-test'], apply=True, root=self.root, call=call, upload=original.upload)
        self.assertTrue(all(c[0] == 'GET' for c in original.calls))

    def test_etag_conflict_preserves_concurrent_edit_and_leaves_disabled(self):
        self.native.race = True
        with self.assertRaises(urllib.error.HTTPError): self.run_sync()
        self.assertEqual(self.native.files['skills/qd-test/SKILL.md'][0], 'concurrent personal edit')
        self.assertFalse(self.native.skills['qd-test'])
        self.assertFalse(any(c[1].endswith('/enable') for c in self.native.calls))
        journal = next((self.root / 'runtime/team-skill-sync').glob('*/journal.json'))
        self.assertEqual(json.loads(journal.read_text())['phase'], 'requires-review')

    def test_scan_failure_is_not_success_and_does_not_replay(self):
        self.native.scan_failure = True
        with self.assertRaises(urllib.error.HTTPError): self.run_sync()
        self.assertFalse(self.native.skills['qd-test'])
        self.assertEqual(sum(c[1].endswith('/enable') for c in self.native.calls), 1)

    def test_new_skill_created_with_references_disabled_until_native_scan(self):
        self.native.skills = {}; self.native.files = {}
        self.run_sync()
        create = next(c for c in self.native.calls if c[0] == 'POST' and c[1] == '/skills')
        self.assertFalse(create[2]['enable'])
        self.assertEqual(set(create[2]['references']), {'a.md', 'b.md'})
        self.assertTrue(self.native.skills['qd-test'])

    def test_user_disabled_existing_is_not_silently_reenabled(self):
        self.native.skills['qd-test'] = False
        with self.assertRaisesRegex(ValueError, 'disabled_skill_update_requires_review'): self.run_sync()
        self.assertTrue(all(c[0] == 'GET' for c in self.native.calls))

    def test_unknown_actor_and_nonmanaged_skill_refused_before_network(self):
        with self.assertRaisesRegex(ValueError, 'registered_team_actor_required'):
            syncer.sync(['game:other'], ['qd-test'], root=self.root, call=self.native)
        with self.assertRaisesRegex(ValueError, 'managed_qd_skill_required'):
            syncer.sync(['operations:mc-god'], ['../escape'], root=self.root, call=self.native)
        self.assertEqual(self.native.calls, [])


if __name__ == '__main__': unittest.main()
