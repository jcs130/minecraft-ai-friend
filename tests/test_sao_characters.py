import json
from copy import deepcopy
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from configure_sao_characters import managed_text, START, END
import configure_sao_characters as migration


class PersonaTests(unittest.TestCase):
    def rescue_fixture(self):
        from party_role_capabilities import YUI_AGENT_ID, YUI_BODY_UUID, SURVIVOR_BODY_UUID
        settings = json.loads((ROOT / 'config/characters/sao.json').read_text(encoding='utf8'))
        binding = {'agentId': YUI_AGENT_ID, 'maidUuid': YUI_BODY_UUID, 'ownerUuid': SURVIVOR_BODY_UUID,
            'name': '结衣', 'persona': '旧设定：桐人和亚丝娜是我的家人。', 'personaRevision': 4,
            'generation': 1, 'sessionId': 'same-old-session', 'mcpToken': 'fixture-secret-not-for-plan'}
        text = {
            'SOUL.md': '# 结衣\n我的已有经历。\n' + START + '\n' + binding['persona'] + '\n' + END + '\n新记忆保持。\n',
            'PROFILE.md': '<!-- qiandeng-life-profile-v1 -->\n现有长期方向\n<!-- /qiandeng-life-profile-v1 -->\n'
                '<!-- qiandeng-world-team-profile-v1 -->\n保持自己的姓名、人格、主人和生活会话\n<!-- /qiandeng-world-team-profile-v1 -->\n'
                '个人引用：保持自己的姓名、人格、主人和生活会话。\n',
            'AGENTS.md': '身体操作使用身份绑定的七项 maid_native MCP；技能工具以本角色实际启用清单为准。\n'
                '任意shell、网页和其他角色控制权不在当前工具范围，不进行第二套推理。\n'
                '<!-- qiandeng-life-memory-v1 -->\n原生活记忆说明和私有索引\n<!-- /qiandeng-life-memory-v1 -->\n',
        }
        files = {name: {'content': value, 'etag': 'original-' + name, 'eof': True, 'truncated': False, 'offset': 0}
                 for name, value in text.items()}
        return binding, files, settings

    def test_rescue_native_plan_preserves_personal_history_and_is_idempotent(self):
        binding, files, settings = self.rescue_fixture()
        prior = json.dumps({'binding': binding, 'files': files}, ensure_ascii=False)
        plan = migration.native_file_patch(binding, files, settings)
        self.assertEqual({row['path'] for row in plan['files']}, set(migration.PERSONAL_FILES))
        after = {row['path']: row['content'] for row in plan['files']}
        self.assertIn('我的已有经历。', after['SOUL.md']); self.assertIn('新记忆保持。', after['SOUL.md'])
        self.assertIn('现有长期方向', after['PROFILE.md'])
        self.assertIn('个人引用：保持自己的姓名、人格、主人和生活会话。', after['PROFILE.md'])
        self.assertIn('原生活记忆说明和私有索引', after['AGENTS.md'])
        self.assertNotIn('fixture-secret-not-for-plan', json.dumps(plan))
        self.assertEqual(json.dumps({'binding': binding, 'files': files}, ensure_ascii=False), prior)
        next_files = {name: {**row, 'content': after[name], 'etag': 'new-' + name} for name, row in files.items()}
        self.assertEqual(migration.native_file_patch(binding, next_files, settings)['files'], [])
        self.assertEqual(plan['productionMutations'], 0)

    def test_rescue_plan_refuses_unrelated_body_partial_files_and_edited_soul(self):
        binding, files, settings = self.rescue_fixture()
        with self.assertRaisesRegex(ValueError, 'authorized_yui_pair'):
            migration.native_file_patch({**binding, 'agentId': 'other-yui'}, files, settings)
        with self.assertRaisesRegex(ValueError, 'file_inventory'):
            migration.native_file_patch(binding, {k: v for k, v in files.items() if k != 'SOUL.md'}, settings)
        for change in ({'etag': ''}, {'truncated': True}, {'eof': False}, {'offset': 9}):
            changed = {**files, 'SOUL.md': {**files['SOUL.md'], **change}}
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, 'complete_file'):
                migration.native_file_patch(binding, changed, settings)
        changed = {**files, 'SOUL.md': {**files['SOUL.md'], 'content': START + '\n个人另改设定\n' + END}}
        with self.assertRaisesRegex(ValueError, 'changed_requires_review'):
            migration.native_file_patch(binding, changed, settings)

    def test_rescue_markers_do_not_overwrite_unknown_personal_regions(self):
        for original in (migration.RESCUE_START, migration.RESCUE_END, migration.RESCUE_END + migration.RESCUE_START):
            with self.subTest(original=original), self.assertRaises(ValueError): migration.rescue_text(original, 'new')
        original = 'trailing personal whitespace  \n\n'
        updated = migration.rescue_text(original, 'rescue')
        self.assertTrue(updated.startswith(original))
        self.assertEqual(migration.rescue_text(updated, 'rescue'), updated)

    def test_managed_updates_preserve_other_memory_and_are_idempotent(self):
        prior = '# My life\nI learned how to build a camp.\n'
        initial = managed_text(prior, 'first persona')
        self.assertTrue(initial.startswith(prior))
        self.assertEqual(managed_text(initial, 'first persona'), initial)
        updated = managed_text(initial + '\nNew memories.\n', 'new persona')
        self.assertIn('New memories.', updated)
        self.assertNotIn('first persona', updated)
        self.assertEqual(updated.count(START), 1)

    def test_ambiguous_marker_refuses_overwriting_personal_content(self):
        with self.assertRaises(ValueError): managed_text(START + START + END, 'new')

    def test_character_contract_is_familial_and_actual_game_permissions_still_apply(self):
        settings = json.loads((ROOT / 'config/characters/sao.json').read_text(encoding='utf8'))
        self.assertEqual(settings['yui']['name'], '结衣')
        self.assertIn('心理健康咨询', settings['yui']['persona'])
        self.assertIn('爸爸', settings['kirito']['persona'])
        self.assertIn('真实游戏状态', settings['kirito']['persona'])
        self.assertIn('临时称呼', settings['yui']['persona'])

    def test_native_file_chunk_and_etag_are_required_before_any_put(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, limit): return json.dumps(self.value).encode()[:limit]
        response = Response()
        good = {'content': '完整的人设\n', 'etag': 'current-version', 'eof': True,
                'truncated': False, 'offset': 0}
        requests = []
        def opened(request, **kwargs):
            requests.append(request); return response
        with patch.object(migration.urllib.request, 'build_opener', return_value=SimpleNamespace(open=opened)):
            response.value = good
            self.assertEqual(migration.workspace_file('fixture-role', 'SOUL.md'), good)
            for change in ({'eof': False, 'truncated': True}, {'etag': None}, {'offset': 16}):
                response.value = good | change
                with self.assertRaises(ValueError): migration.workspace_file('fixture-role', 'SOUL.md')
            count = len(requests)
            with self.assertRaises(ValueError): migration.workspace_file('fixture-role', 'SOUL.md', 'new')
            self.assertEqual(len(requests), count)
            response.value = {'etag': 'new-version'}
            migration.workspace_file('fixture-role', 'SOUL.md', 'new', good['etag'])
            self.assertEqual(requests[-1].get_header('If-match'), good['etag'])

    def test_idle_boundary_checks_native_roles_body_lease_and_large_controller(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = root / 'server/survival-agent-state/survival'; state.mkdir(parents=True)
            (state / 'control.json').write_text(json.dumps({'enabled': False}))
            (state / 'controller.json').write_text(json.dumps({'active': None, 'history': 'x' * 300000}))
            calls = []
            def api(method, path, role):
                calls.append((method, path, role)); return {'running_task_count': 0}
            migration.require_idle('fixture-yui', root=root, call=api)
            self.assertEqual({c[2] for c in calls}, {'fixture-yui', 'qd-survivor'})
            for value in (None, True, 1):
                with self.subTest(count=value), self.assertRaises(ValueError):
                    migration.require_idle('fixture-yui', root=root, call=lambda *_: {'running_task_count': value})
            for status in ('unknown', 'reserved', 'open'):
                (state / 'lease.json').write_text(json.dumps({'status': status}))
                with self.subTest(lease=status), self.assertRaises(ValueError):
                    migration.require_idle('fixture-yui', root=root, call=api)
            (state / 'lease.json').write_text(json.dumps({'status': 'closed'}))
            migration.require_idle('fixture-yui', root=root, call=api)
            (state / 'inflight-action.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'still_in_flight'):
                migration.require_idle('fixture-yui', root=root, call=api)

    def test_unknown_submission_is_not_replayed_and_known_native_must_be_terminal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / 'server/mcdata/village/qwen-tasks/requests/task.json'
            path.parent.mkdir(parents=True)
            row = {'agentId': 'fixture-yui', 'status': 'submission_uncertain', 'taskId': None}
            path.write_text(json.dumps(row))
            with self.assertRaisesRegex(ValueError, 'unknown_submission'):
                migration.require_terminal_tasks('fixture-yui', root=root, call=lambda *_: self.fail('no network'))
            row['taskId'] = 'task-000000000000'; path.write_text(json.dumps(row))
            with self.assertRaisesRegex(ValueError, 'still_active'):
                migration.require_terminal_tasks('fixture-yui', root=root, call=lambda *_: {'status': 'running'})
            original = path.read_bytes()
            migration.require_terminal_tasks('fixture-yui', root=root, call=lambda *_: {'status': 'finished'})
            self.assertEqual(path.read_bytes(), original)


class RescueApplyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        binding, files, settings = PersonaTests().rescue_fixture()
        self.binding = binding | {'schema': 1, 'status': 'ready', 'generation': '012345abcdef',
            'sessionId': 'maid-' + binding['maidUuid'] + '-012345abcdef', 'mcpToken': 'x' * 40}
        self.settings = settings
        self.kirito = {'content': '原矿坑经历保留。\n' + managed_text('', settings['kirito']['persona']) + '\n另一篇私记。',
            'etag': 'kirito-original', 'offset': 0, 'eof': True, 'truncated': False}
        self.files = {(binding['agentId'], p): deepcopy(v) for p, v in files.items()}
        self.files[('qd-survivor', 'SOUL.md')] = deepcopy(self.kirito)
        self.plan = migration.rescue_batch_patch(self.binding, files, self.kirito, settings)
        self.candidate = self.root / 'runtime/candidate.json'
        migration.write_json(self.candidate, self.plan)
        migration.write_json(self.root / 'config/characters/sao.json', settings)
        self.registry_path = self.root / 'server/mcdata/village/maid-agents/bindings' / (binding['maidUuid'] + '.json')
        migration.write_json(self.registry_path, self.binding)
        self.party = {'schema': 1, 'enabled': True, 'members': [
            {'kind': 'survivor', 'agentId': 'qd-survivor', 'bodyUuid': binding['ownerUuid'],
             'userId': 'survival-controller', 'channel': 'console', 'mcpToken': 'y' * 40},
            {'kind': 'maid', 'agentId': binding['agentId'], 'bodyUuid': binding['maidUuid'],
             'ownerUuid': binding['ownerUuid'], 'userId': 'maid-' + binding['maidUuid'],
             'channel': 'console', 'mcpToken': 'z' * 40}]}
        migration.write_json(self.root / 'server/mcdata/village/party/binding.json', self.party)
        state = self.root / 'server/survival-agent-state/survival'
        migration.write_json(state / 'control.json', {'enabled': False})
        migration.write_json(state / 'controller.json', {'active': None})
        migration.write_json(state / 'lease.json', {'status': 'closed'})
        self.profiles = {role: {'id': role, 'language': 'zh', 'active_model': {'model_id': 'preserve-me'}}
                         for role in (binding['agentId'], 'qd-survivor')}
        for role in self.profiles:
            folder = self.root / 'server/agents/work/workspaces' / role
            migration.write_json(folder / 'chats.json', {'same-session': 'retained'})
            migration.write_json(folder / 'sessions/old.json', {'messages': ['original history']})
        self.writes = []; self.commands = []; self.setting = '旧结衣聊天设定'
        self.running = False; self.running_tasks = 0; self.fail_write = None
        self.protected = True; self.enabled = True
        self.args = {'root': self.root, 'call': self.api, 'file_api': self.file,
                     'run': self.rcon, 'npc_running': lambda: self.running}

    def api(self, method, path, role):
        self.assertEqual(method, 'GET')  # No agent PUT/reload or model task creation.
        from world_team_mcp import COMMON_TOOLS
        from world_admin_tools import TOOL_NAMES
        from world_team_profiles import policy_payload
        tools = list(COMMON_TOOLS) + list(TOOL_NAMES)
        if path.endswith('/agent-status'): return {'running_task_count': self.running_tasks}
        if path == '/agents/' + role: return deepcopy(self.profiles[role])
        if path == '/mcp/qd_world_team':
            return {'name': 'qd_world_team', 'enabled': self.enabled, 'transport': 'stdio', 'command': 'python',
                'args': ['/ops/world_team_mcp.py', '--actor', 'game:' + role], 'env': {}, 'tools': tools}
        if path == '/mcp/tools/qd_world_team': return [{'name': n, 'enabled': True} for n in tools]
        if path == '/mcp/policy/qd_world_team': return policy_payload(tools) | {'unmanaged_rules_count': 0}
        self.fail('unexpected API path: ' + path)

    def file(self, role, name, content=None, etag=None):
        key = (role, name)
        if content is not None:
            self.assertEqual(etag, self.files[key]['etag'])
            self.writes.append(key)
            # Simulate a write accepted by native service before its response is lost.
            self.files[key] = self.files[key] | {'content': content, 'etag': 'new-' + str(len(self.writes))}
            if self.fail_write == len(self.writes): raise TimeoutError('ambiguous response')
        return deepcopy(self.files[key])

    def rcon(self, command):
        self.commands.append(command)
        if command.startswith('qdmaid protection_status '):
            return 'QD_MAID_JSON ' + json.dumps({'schema': 1, 'ok': True,
                'identity': {'maidUuid': self.binding['maidUuid'], 'ownerUuid': self.binding['ownerUuid'], 'loaded': True},
                **{k: self.protected for k in ('configMatched', 'nativeInvulnerable', 'tlmInvulnerable', 'damageGuard', 'deathGuard', 'alive')}})
        prefix = 'data modify entity ' + self.binding['maidUuid'] + ' MaidAIChat.CustomSetting set value '
        if command.startswith(prefix): self.setting = json.loads(command[len(prefix):]); return 'Modified entity data'
        if command == 'data get entity ' + self.binding['maidUuid'] + ' MaidAIChat.CustomSetting':
            return '结衣 has the following entity data: ' + json.dumps(self.setting, ensure_ascii=False)
        self.fail('unexpected world command')

    def test_four_files_registry_and_single_native_field_preserve_all_other_state(self):
        history = migration.session_inventory(self.root, self.profiles)
        before = deepcopy(self.binding)
        result = migration.apply_rescue_files(self.candidate, **self.args)
        self.assertEqual(len(self.writes), 4)
        self.assertEqual(result['reloadRequired'], [self.binding['agentId'], 'qd-survivor'])
        after = migration.read_json(self.registry_path)
        self.assertEqual(after.pop('persona'), self.settings['yui']['persona'])
        self.assertEqual(after.pop('personaRevision'), before.pop('personaRevision') + 1)
        before.pop('persona'); self.assertEqual(after, before)
        self.assertEqual(migration.session_inventory(self.root, self.profiles), history)
        self.assertEqual(migration.read_json(self.root / 'server/mcdata/village/party/binding.json'), self.party)
        soul = self.files[('qd-survivor', 'SOUL.md')]['content']
        self.assertIn('原矿坑经历保留。', soul); self.assertIn('另一篇私记。', soul)
        self.assertIn(self.settings['kirito']['rescueGuidance'], soul)
        self.assertEqual(sum(c.startswith('data modify') for c in self.commands), 1)
        backup = Path(result['backup']); self.assertTrue((backup / 'before.json').is_file())
        self.assertEqual(migration.read_json(backup / 'journal.json')['phase'], 'completed')
        with self.assertRaisesRegex(ValueError, 'already_claimed'):
            migration.apply_rescue_files(self.candidate, **self.args)
        self.assertEqual(len(self.writes), 4)

    def test_no_writes_for_maintenance_stale_files_registry_or_unauthorized_tools(self):
        self.running = True
        with self.assertRaisesRegex(ValueError, 'npc_ingress'): migration.apply_rescue_files(self.candidate, **self.args)
        self.running = False; self.running_tasks = 1
        with self.assertRaisesRegex(ValueError, 'task_still_active'): migration.apply_rescue_files(self.candidate, **self.args)
        self.running_tasks = 0
        key = ('qd-survivor', 'SOUL.md'); original = deepcopy(self.files[key])
        for change in ({'etag': 'concurrently-edited'}, {'content': 'concurrent same-etag edit'}):
            self.files[key] = original | change
            with self.assertRaisesRegex(ValueError, 'file_changed'): migration.apply_rescue_files(self.candidate, **self.args)
        self.files[key] = original
        migration.write_json(self.registry_path, self.binding | {'personaRevision': 99})
        with self.assertRaisesRegex(ValueError, 'registry_changed'): migration.apply_rescue_files(self.candidate, **self.args)
        migration.write_json(self.registry_path, self.binding)
        self.enabled = False
        with self.assertRaisesRegex(ValueError, 'driver_not_ready'): migration.apply_rescue_files(self.candidate, **self.args)
        self.enabled = True; self.protected = False
        with self.assertRaisesRegex(ValueError, 'protection_not_ready'): migration.apply_rescue_files(self.candidate, **self.args)
        self.assertEqual(self.writes, []); self.assertFalse(any(c.startswith('data modify') for c in self.commands))

    def test_lost_native_response_keeps_unknown_journal_and_never_replays(self):
        self.fail_write = 2
        with self.assertRaises(TimeoutError): migration.apply_rescue_files(self.candidate, **self.args)
        journals = list((self.root / 'runtime/yui-rescue-persona-apply').glob('*/journal.json'))
        self.assertEqual(len(journals), 1)
        journal = migration.read_json(journals[0])
        self.assertEqual(journal['phase'], 'unknown'); self.assertEqual(len(journal['completed']), 1)
        with self.assertRaisesRegex(ValueError, 'already_claimed'):
            migration.apply_rescue_files(self.candidate, **self.args)
        self.assertEqual(len(self.writes), 2)
        self.assertEqual(migration.read_json(self.registry_path), self.binding)
        self.assertFalse(any(c.startswith('data modify') for c in self.commands))

    def test_entity_write_response_lost_is_unknown_even_if_effect_already_happened(self):
        native = self.rcon
        def disconnected(command):
            result = native(command)
            if command.startswith('data modify'): raise TimeoutError('lost after command acceptance')
            return result
        with self.assertRaises(TimeoutError):
            migration.apply_rescue_files(self.candidate, **(self.args | {'run': disconnected}))
        self.assertEqual(self.setting, self.settings['yui']['nativeSetting'])
        journal = migration.read_json(next((self.root / 'runtime/yui-rescue-persona-apply').glob('*/journal.json')))
        self.assertEqual(journal['phase'], 'unknown'); self.assertEqual(journal['step'], 'nativeSetting')
        self.assertEqual(migration.read_json(self.registry_path), self.binding)
        with self.assertRaisesRegex(ValueError, 'already_claimed'):
            migration.apply_rescue_files(self.candidate, **self.args)
        self.assertEqual(sum(c.startswith('data modify') for c in self.commands), 1)

    def test_candidate_cannot_inject_other_files_or_arbitrary_content(self):
        for corrupt in ('path', 'content'):
            plan = deepcopy(self.plan)
            plan['files'][0][corrupt] = '../other-role/SOUL.md' if corrupt == 'path' else 'arbitrary replacement'
            migration.write_json(self.candidate, plan)
            with self.assertRaisesRegex(ValueError, 'candidate_or_registry_changed'):
                migration.apply_rescue_files(self.candidate, **self.args)
        self.assertEqual(self.writes, [])
        changed = self.kirito | {'content': managed_text('', 'privately edited persona')}
        with self.assertRaisesRegex(ValueError, 'kirito_soul_changed'):
            migration.rescue_batch_patch(self.binding, {p: self.files[(self.binding['agentId'], p)] for p in migration.PERSONAL_FILES},
                                        changed, self.settings)

    def test_historical_native_404_is_recorded_without_fabricating_terminal_or_rewriting_it(self):
        row = {'agentId': self.binding['agentId'], 'status': 'poll_unavailable', 'taskId': 'task-old'}
        path = self.root / 'server/mcdata/village/qwen-tasks/requests/old.json'
        migration.write_json(path, row); original = path.read_bytes()
        native = self.api
        def with_missing(method, route, role):
            if route == '/console/chat/task/task-old':
                raise migration.urllib.error.HTTPError(route, 404, 'not found', {}, None)
            return native(method, route, role)
        with self.assertRaises(migration.urllib.error.HTTPError):
            migration.require_terminal_tasks(self.binding['agentId'], root=self.root, call=with_missing)
        result = migration.apply_rescue_files(self.candidate, **(self.args | {'call': with_missing}))
        self.assertEqual(result['oldTaskUnresolved'][0]['terminalVerified'], False)
        self.assertEqual(result['oldTaskUnresolved'][0]['taskId'], 'task-old')
        self.assertEqual(path.read_bytes(), original)

    def test_native_setting_quoted_string_parser_rejects_ambiguous_replies(self):
        for value in ('含中文"引号\\斜线', '', "single'quote"):
            self.assertEqual(migration.native_setting_value('结衣 has the following entity data: ' + json.dumps(value, ensure_ascii=False)), value)
        self.assertEqual(migration.native_setting_value("结衣 has the following entity data: '单引号\\\'内容'"), "单引号'内容")
        for reply in ('', 'No entity was found', '结衣 has the following entity data: 1b',
                      '结衣 has the following entity data: "wrong" extra', '结衣 has the following entity data: "bad\\n"'):
            with self.subTest(reply=reply), self.assertRaises(ValueError): migration.native_setting_value(reply)


if __name__ == '__main__': unittest.main()
