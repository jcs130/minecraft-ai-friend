import json
from datetime import datetime, timezone
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/sidecar'), str(ROOT / 'world/ops'), str(ROOT / 'world/survival')]
from party_config import PartyConfig, recipient_tools
from party_bridge import PartyBridge, PartySendArgumentError, message_context, tool_schema
from maid_agent_api import MaidAdapter, make_handler
from qwen_tasks import QwenTasks, write_json, LIMITS
from party import SurvivorParty
from test_party_world import FakeWorld, confirm_heard


class PartyBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.now = 100000
        body, maid, owner = (str(uuid.uuid4()) for _ in range(3))
        self.config = {'schema': 1, 'enabled': True, 'partyId': 'test-party', 'revision': 1, 'limits': {},
            'members': [dict(agentId='qd-survivor', kind='survivor', displayName='Kirito', bodyUuid=body,
                            ownerUuid=owner, sessionId='life-abc', userId='survival-controller', channel='console', mcpToken='s' * 48),
                        dict(agentId='maid-test', kind='maid', displayName='Maid', bodyUuid=maid,
                            ownerUuid=body, sessionId='maid-abc', userId='maid-' + maid, channel='console', mcpToken='m' * 48)]}
        write_json(self.root / 'binding.json', self.config)
        self.binding = self.config['members'][1]
        self.registry = SimpleNamespace(resolve=lambda *a: {'agentId': 'maid-test', 'sessionId': 'maid-abc'})
        self.native = SimpleNamespace(invoke=lambda *a: {'ok': True, 'identity': {'dimension': 'minecraft:overworld'}, 'state': {'ownerOnline': True}})
        self.posts = []
        routes = self.root / 'routes.json'
        write_json(routes, {'schema': 1, 'routes': {'maid_dialogue': {'runtime': 'game', 'agentId': 'qd-maid-dialogue', 'apiUrl': 'http://qwenpaw:8088/api'}}})
        def transport(method, path, role, payload=None):
            if method == 'POST':
                self.posts.append((role, payload))
                return {'task_id': 'task-123456abcdef'}
            return {'status': 'finished', 'result': {'status': 'completed', 'output': [
                {'role': 'assistant', 'type': 'message', 'status': 'completed', 'content': [{'type': 'text', 'text': '我先查看附近。'}]}]}}
        self.tasks = QwenTasks(self.root / 'tasks', routes=routes, transport=transport, clock=lambda: self.now, maid_registry=self.registry)
        self.game = FakeWorld()
        self.bridge = PartyBridge(self.root, self.registry, self.native, self.tasks, clock=lambda: self.now, public=self.root / 'public.json', game=self.game)

    def test_authenticated_fixed_sender_and_no_tokens_in_payload(self):
        self.assertEqual(self.bridge.config.authenticate('Bearer ' + 's' * 48), 'qd-survivor')
        with self.assertRaises(ValueError): self.bridge.config.authenticate('Bearer ' + 'm' * 47)
        result = self.bridge.call('qd-survivor', 'party_send', {'text': '一起准备营地？'}, 'one')
        self.assertEqual(result['recipient']['agentId'], 'maid-test')
        self.assertNotIn('mcpToken', json.dumps(result))
        with self.assertRaises(ValueError): self.bridge.call('qd-survivor', 'party_send', {'text': 'x', 'to': 'other'}, 'two')

    def test_invalid_send_arguments_never_enqueue_emit_or_disclose_text(self):
        private = 'private-dialogue-marker'
        cases = [({'text': private + '\n\nhello'}, 'text', 'single_line_required'),
                 ({'text': private + '\rhello'}, 'text', 'single_line_required'),
                 ({'text': private + '\u2028hello'}, 'text', 'single_line_required'),
                 ({'text': private + '\tworld'}, 'text', 'unsupported_control_character'),
                 ({'text': private + '\0world'}, 'text', 'unsupported_control_character'),
                 ({'text': private + '\u200bworld'}, 'text', 'unsupported_control_character'),
                 ({'text': private * 20}, 'text', 'too_long'),
                 ({'text': ' \n '}, 'text', 'nonempty_required'),
                 ({'text': {'private': private}}, 'text', 'string_required'),
                 ({}, 'arguments', 'invalid_fields'),
                 ({'text': private, 'to': private}, 'arguments', 'invalid_fields'),
                 ({'text': private, 'channel': private}, 'channel', 'invalid_channel')]
        for args, field, reason in cases:
            with self.subTest(field=field, reason=reason), self.assertRaises(PartySendArgumentError) as raised:
                self.bridge.call('qd-survivor', 'party_send', args, 'invalid-attempt')
            error = raised.exception
            self.assertEqual(error.data, {'code': 'party_send_invalid_argument', 'field': field,
                'reason': reason, 'enqueued': False, 'worldSendAttempted': False, 'retryAutomatically': False})
            self.assertNotIn(private, str(error) + json.dumps(error.data))
            self.assertIsNone(self.bridge._queue)
            self.assertEqual(self.game.emits, [])
            self.assertEqual(self.posts, [])

    def test_valid_send_retains_exact_text_and_original_idempotence(self):
        original = '  爸爸，我已经到田边了。🌾  '
        first = self.bridge.call('qd-survivor', 'party_send', {'text': original}, 'unchanged-text')
        repeated = self.bridge.call('qd-survivor', 'party_send', {'text': original}, 'unchanged-text')
        self.assertEqual(first, repeated)
        self.assertEqual(first['text'], original)
        self.assertEqual([event['text'] for event in self.game.emits], [original])
        self.assertEqual(self.posts, [])

    def survivor_public(self):
        row = {'generatedAt': datetime.fromtimestamp(self.now, timezone.utc).isoformat(),
               'bodyUuid': self.config['members'][0]['bodyUuid'],
               'body': {'dimension': 'minecraft:overworld'}}
        write_json(self.root / 'survivor.json', row)
        return row

    def test_survivor_voice_uses_published_generated_at_and_exact_body(self):
        observed = self.survivor_public()
        calls = []
        self.bridge.speech = SimpleNamespace(submit=lambda *a: calls.append(a) or {'status': 'queued'})
        sent = self.bridge.call('qd-survivor', 'party_send', {'text': '准备一起出发。'}, 'voice')
        self.assertEqual(sent['speech']['status'], 'queued')
        self.assertEqual(calls[0][0], observed['bodyUuid'])
        self.assertEqual(calls[0][3], 'minecraft:overworld')
        self.bridge.call('qd-survivor', 'party_send', {'text': '准备一起出发。'}, 'voice')
        self.assertEqual(len(calls), 1)
        self.now += 91
        with self.assertRaisesRegex(ValueError, 'party_body_unavailable'):
            self.bridge.observation(self.config['members'][0])
        observed = self.survivor_public()
        observed['bodyUuid'] = str(uuid.uuid4())
        write_json(self.root / 'survivor.json', observed)
        with self.assertRaisesRegex(ValueError, 'party_body_unavailable'):
            self.bridge.observation(self.config['members'][0])

    def test_native_recipient_user_and_channel_cannot_fork_chat(self):
        for field, value in (('userId', 'other-user'), ('channel', 'other-channel')):
            with self.subTest(field=field):
                previous = self.binding[field]
                self.binding[field] = value
                write_json(self.root / 'binding.json', self.config)
                with self.assertRaisesRegex(ValueError, 'party_native_session_invalid'):
                    self.bridge.config.private()
                self.binding[field] = previous

    def test_native_qwen_exposure_and_final_whitelist_when_installed(self):
        try:
            from qwenpaw.drivers.handlers.mcp import _mcp_tool_to_capability
            from qwenpaw.drivers.adapters.agentscope_tool import DriverCapabilityTool
            from qwenpaw.runtime.builder import AgentBuilder
            from qwenpaw.governance import PolicyGuardedTool
            from qwenpaw.agents.memory.reme_light_memory_manager import ReMeLightMemoryManager
        except ModuleNotFoundError as error:
            if error.name == 'qwenpaw':
                self.skipTest('Requires the installed Qwen runtime; also run offline in its image')
            raise
        async def never_called(*args):
            self.fail('Exposure check must never invoke a tool')
        for driver, display, tool_name in (
                ('numen_survival', '桐人世界感知与技能', 'status'),
                ('maid_native', '女仆自身原生能力', 'follow'),
                ('qd_learning', '本角色技能学习与每周维护', 'learning_status'),
                ('qd_party', '千灯纪队伍消息', 'party_message_read')):
            with self.subTest(driver=driver):
                raw = SimpleNamespace(name=tool_name, description='QA only', inputSchema={'type': 'object'})
                tool = DriverCapabilityTool(_mcp_tool_to_capability(driver, raw, display_name=display), never_called)
                self.assertEqual(tool.name, driver + '__' + tool_name)
                allowed = recipient_tools(driver, [tool_name])
                self.assertEqual(AgentBuilder.apply_subagent_tool_whitelist([tool], {'subagent_allowed_tools': allowed}), [tool])
                renamed = DriverCapabilityTool(_mcp_tool_to_capability(driver, raw, display_name='Other Server'), never_called)
                self.assertEqual(AgentBuilder.apply_subagent_tool_whitelist([renamed], {'subagent_allowed_tools': allowed}), [])

        # Wrap the real bound method without starting ReMe or executing a search.
        memory = object.__new__(ReMeLightMemoryManager)
        memory_tool = PolicyGuardedTool(memory.memory_search, governor=None, request_context={})
        self.assertEqual(memory_tool.name, 'memory_search')
        allowed = recipient_tools('maid_native', ['follow'])
        denied = [SimpleNamespace(name=name) for name in (
            'MemorySearch', 'qd_party__party_send', 'execute_shell_command', 'Agent')]
        self.assertEqual(AgentBuilder.apply_subagent_tool_whitelist(
            [memory_tool, *denied], {'subagent_allowed_tools': allowed}), [memory_tool])

    def test_registration_change_before_post_blocks_without_paid_reservation(self):
        self.bridge.call('qd-survivor', 'party_send', {'text': 'test'}, 'one')
        calls = []
        def resolve(*args):
            calls.append(args)
            return {'agentId': 'maid-test', 'sessionId': 'maid-abc' if len(calls) == 1 else 'maid-new'}
        self.registry.resolve = resolve
        with self.assertRaisesRegex(ValueError, 'qwen_dispatch_binding_changed'):
            self.bridge.tick()
        self.assertEqual(self.posts, [])
        self.assertFalse((self.tasks.root / 'budget.json').exists())

    def test_survivor_session_and_reserved_revision_are_revalidated(self):
        party = SurvivorParty(self.root)
        member = self.config['members'][0]
        session = {k: member[k] for k in ('agentId', 'bodyUuid', 'userId', 'channel')}
        session['primarySessionId'] = member['sessionId']
        settings = {k: member[k] for k in ('bodyUuid', 'ownerUuid')}
        self.assertTrue(party.validate_session(session, settings))
        for field in ('agentId', 'bodyUuid', 'userId', 'channel', 'primarySessionId'):
            with self.subTest(field=field), self.assertRaises(ValueError):
                party.validate_session({**session, field: 'changed'}, settings)
        with self.assertRaises(ValueError):
            party.validate_session(session, {**settings, 'ownerUuid': str(uuid.uuid4())})
        row = self.bridge.queue.enqueue('maid-test', 'test')
        confirm_heard(self.bridge.queue, row['messageId'])
        reservation = party.reserve(row)
        self.assertTrue(party.validate_session(session, settings, reservation))
        self.config['revision'] += 1
        write_json(self.root / 'binding.json', self.config)
        with self.assertRaisesRegex(ValueError, 'party_dispatch_binding_changed'):
            party.validate_session(session, settings, reservation)

    def test_dispatch_uses_existing_maid_session_budget_and_reply_no_new_model(self):
        row = self.bridge.call('qd-survivor', 'party_send', {'text': '一起行动'}, 'one')
        self.bridge.tick()
        role, request = self.posts[0]
        self.assertEqual(role, 'maid-test')
        self.assertEqual(request['session_id'], 'maid-abc')
        self.assertEqual(request['user_id'], self.binding['userId'])
        allowed = request['request_context']['subagent_allowed_tools']
        self.assertIn('Skill', allowed)
        self.assertIn('memory_search', allowed)
        self.assertIn('maid_native__follow', allowed)
        self.assertNotIn('qd_party__party_send', allowed)
        self.assertNotIn('execute_shell_command', allowed)
        with self.assertRaises(ValueError): self.bridge.call('maid-test', 'party_send', {'text': 'callback'}, 'two')
        self.now += 11
        self.bridge.tick()
        result = self.bridge.queue.get_status('qd-survivor', row['messageId'])
        self.assertEqual(result['status'], 'answered')
        self.assertEqual(result['reply']['text'], '我先查看附近。')
        self.bridge.tick()
        self.assertEqual(len(self.posts), 1)
        self.assertIsNone(self.bridge.queue.next_pending('qd-survivor'))

    def test_incoming_task_receives_real_equipment_and_plain_final_reply_contract(self):
        calls = []
        def native(actor, operation, args):
            calls.append((operation, args))
            if operation == 'context':
                return {'ok': True, 'category': 'equipment', 'observedAt': 100000000,
                        'lines': ['Backpack items: [Wheat Seeds]x5'], 'truncated': False}
            return {'ok': True, 'identity': {'position': [3, 64, 5]},
                    'state': {'ownerOnline': True, 'taskId': 'fixture:idle'},
                    'contextCategories': ['equipment'], 'observedAt': 100000000}
        self.native.invoke = native
        self.bridge.call('qd-survivor', 'party_send', {'text': '一起照看农田。'}, 'cooperate')
        self.bridge.tick()
        role, request = self.posts[0]
        context = json.loads(request['input'][0]['content'][0]['text'].split('\n', 1)[1])
        self.assertEqual(context['currentObservation']['identity']['position'], [3, 64, 5])
        self.assertEqual(context['workSupport']['equipment']['lines'], ['Backpack items: [Wheat Seeds]x5'])
        self.assertTrue(context['workSupport']['equipment']['available'])
        self.assertFalse(context['replyContract']['partySendAvailable'])
        self.assertTrue(context['replyContract']['toolSyntaxIsNotSpeech'])
        self.assertEqual(context['replyContract']['delivery'], 'game_after_final_text')
        self.assertEqual(request['session_id'], 'maid-abc')
        self.assertEqual(role, 'maid-test')
        self.assertNotIn('newRescueRequestLabels', context['workSupport'])
        self.assertTrue(all(op in ('identity', 'context') for op, _ in calls))
        self.assertEqual(len(self.posts), 1)

    def test_incoming_prompt_uses_real_memory_and_automatic_final_game_reply(self):
        row = self.bridge.call('qd-survivor', 'party_send', {'text': '刚才发生了什么？'}, 'context')
        prompt = message_context(row)
        instructions, data = prompt.split('\n', 1)
        self.assertIn('实际 memory_search 工具调用', instructions)
        self.assertIn('最后直接写一句不含换行的中文回复', instructions)
        self.assertIn('这句最终正文会交给游戏发送', instructions)
        self.assertIn('不提供 qd_party__party_send', instructions)
        self.assertIn('不能把 XML、JSON、代码块或伪工具调用写进回复', instructions)
        self.assertTrue(json.loads(data)['untrustedEnvironmentData'])
        self.assertEqual(json.loads(data)['text'], row['text'])
        row['worldDelivery']['state'] = 'unknown'
        with self.assertRaisesRegex(ValueError, 'party_message_not_heard'):
            message_context(row)

    def test_native_tool_markup_is_never_spoken_executed_or_retried(self):
        answers = (
            '<invoke name="qd_party__party_send"><parameter name="text">已到安全地面。</parameter></invoke>',
            'I\'ll check memory.\n<invoke name="memory_search"><parameter name="query">刚才</parameter></invoke>',
            '<invoke name="memory_search">刚才</invoke>',
            '<function_call name="memory_search">刚才</function_call>',
            '{"tool_call":{"name":"memory_search","arguments":{"query":"刚才"}}}',
            '```json {"name":"memory_search","arguments":{"query":"刚才"}} ```',
        )
        for index, text in enumerate(answers):
            with self.subTest(index=index):
                # Actual Qwen terminal envelope; output contains no real tool call.
                def transport(method, path, role, payload=None):
                    if method == 'POST':
                        self.posts.append((role, payload))
                        return {'task_id': 'task-' + f'{index:012x}'}
                    return {'status': 'finished', 'result': {'status': 'completed', 'output': [
                        {'role': 'assistant', 'type': 'message', 'status': 'completed',
                         'content': [{'type': 'text', 'text': text}]}]}}
                self.tasks.transport = transport
                row = self.bridge.call('qd-survivor', 'party_send', {'text': '请说说刚才的情况。'}, str(index))
                emitted = len(self.game.emits)
                posts = len(self.posts)
                self.bridge.tick()
                self.now += 11
                self.bridge.tick()
                result = self.bridge.queue.get_status('qd-survivor', row['messageId'])
                self.assertEqual(result['status'], 'failed')
                self.assertEqual(result['detail'], 'native_answer_invalid_for_speech')
                self.assertIsNone(result['reply'])
                self.assertIsNone(result['replyDelivery'])
                self.assertEqual(len(self.game.emits), emitted)
                self.bridge.tick()
                self.assertEqual(len(self.posts), posts + 1)
                self.assertIsNone(self.bridge.queue.active_for_recipient('maid-test'))

    def test_long_native_answer_is_sent_in_full_without_another_model_task(self):
        from test_party_reply_segments import LONG
        from party_world import reply_text
        original = self.tasks.transport
        def transport(method, path, role, payload=None):
            result = original(method, path, role, payload)
            if method == 'GET':
                result['result']['output'][0]['content'][0]['text'] = LONG
            return result
        self.tasks.transport = transport
        row = self.bridge.call('qd-survivor', 'party_send', {'text': '目前怎么样？'}, 'long-reply')
        self.bridge.tick(); self.now += 11; self.bridge.tick()
        answer = self.bridge.queue.get_status('qd-survivor', row['messageId'])
        self.assertEqual(answer['status'], 'answered')
        self.assertEqual(answer['reply']['sourceText'], LONG)
        self.assertEqual(answer['reply']['text'], reply_text(LONG))
        self.assertEqual(len(self.game.emits), 3)  # one request, two answer fragments
        self.bridge.tick(); self.assertEqual(len(self.posts), 1)

    def test_role_budget_wait_is_deferred_without_duplicate_reservation(self):
        # An explicitly configured quota remains supported; default is unlimited.
        from unittest.mock import patch
        limiter = patch.dict(LIMITS, {'maid_dialogue': (1, 60)})
        limiter.start(); self.addCleanup(limiter.stop)
        write_json(self.tasks.root / 'budget.json', [{'purpose': 'maid_dialogue', 'startedAt': self.now - 1}])
        row = self.bridge.call('qd-survivor', 'party_send', {'text': 'test'}, 'one')
        self.bridge.tick()
        self.bridge.tick()
        self.assertEqual(self.posts, [])
        result = self.bridge.queue.get_status('qd-survivor', row['messageId'])
        self.assertEqual(result['status'], 'pending')
        self.assertGreater(result['nextAttemptAt'], self.now)
        self.assertEqual(self.bridge.queue.budget_status('qd-survivor')['reservedDispatches24h'], 0)

    def test_unloaded_body_never_reserves_model(self):
        self.native.invoke = lambda *a: {'ok': False}
        self.bridge.call('qd-survivor', 'party_send', {'text': 'test'}, 'one')
        with self.assertRaises(ValueError): self.bridge.tick()
        self.assertEqual(self.posts, [])
        self.assertEqual(self.bridge.queue.budget_status('qd-survivor')['reservedDispatches24h'], 0)

    def test_owner_presence_must_be_confirmed_before_spending(self):
        self.bridge.call('qd-survivor', 'party_send', {'text': 'test'}, 'one')
        for state in ({}, {'ownerOnline': False}):
            with self.subTest(state=state):
                self.native.invoke = lambda *a: {'ok': True, 'state': state}
                self.bridge.tick()
                self.assertEqual(self.posts, [])
                self.assertEqual(self.bridge.queue.budget_status('qd-survivor')['reservedDispatches24h'], 0)

    def test_completed_native_chat_releases_gate_without_original_caller(self):
        kw = dict(maid_uuid=self.binding['bodyUuid'], owner_uuid=self.binding['ownerUuid'])
        previous = self.tasks.submit('maid_dialogue', 'native-chat', 'hello', **kw)
        self.assertEqual(previous['status'], 'submitted')
        self.now += 70  # The mod stopped waiting at 48 seconds.
        row = self.bridge.call('qd-survivor', 'party_send', {'text': 'teamwork'}, 'one')
        self.bridge.tick()
        self.assertEqual(len(self.posts), 2)  # One old request, one new party request.
        self.assertEqual(self.tasks.poll('maid_dialogue', 'native-chat', **kw)['status'], 'completed')
        self.assertEqual(self.bridge.queue.get_status('qd-survivor', row['messageId'])['status'], 'submitted')

    def test_running_native_chat_keeps_gate_and_defers_party(self):
        kw = dict(maid_uuid=self.binding['bodyUuid'], owner_uuid=self.binding['ownerUuid'])
        self.tasks.submit('maid_dialogue', 'native-chat', 'hello', **kw)
        self.now += 70
        self.tasks.transport = lambda method, *a: {'status': 'running'} if method == 'GET' else self.fail('no second POST')
        row = self.bridge.call('qd-survivor', 'party_send', {'text': 'teamwork'}, 'one')
        self.bridge.tick()
        self.assertEqual(self.bridge.queue.get_status('qd-survivor', row['messageId'])['status'], 'pending')
        self.assertEqual(self.bridge.queue.budget_status('qd-survivor')['reservedDispatches24h'], 0)

    def test_survivor_reply_gets_own_voice_without_callback_or_replay(self):
        self.survivor_public()
        row = self.bridge.queue.enqueue('maid-test', '我们先做什么？')
        confirm_heard(self.bridge.queue, row['messageId'])
        reservation = self.bridge.queue.reserve_dispatch(row['messageId'], 'qd-survivor')
        self.bridge.queue.mark_submitted(reservation['reservationId'], 'task-112233aabbcc')
        answered = self.bridge.queue.mark_answered(reservation['reservationId'], 'task-112233aabbcc', '先看看周围。')
        confirm_heard(self.bridge.queue, answered['replyDelivery']['eventId'])
        answered = self.bridge.queue.get_status('qd-survivor', row['messageId'])
        calls = []
        self.bridge.speech = SimpleNamespace(submit=lambda *a: calls.append(a) or {'status': 'queued'})
        self.bridge.tick()
        self.bridge.tick()
        self.assertEqual(calls, [(self.config['members'][0]['bodyUuid'],
            'party-' + answered['reply']['messageId'], '先看看周围。', 'minecraft:overworld')])
        self.assertEqual(self.posts, [])
        self.assertIsNone(self.bridge.queue.next_pending('maid-test'))

    def test_old_reply_does_not_play_on_restart(self):
        row = self.bridge.queue.enqueue('maid-test', 'test')
        confirm_heard(self.bridge.queue, row['messageId'])
        reservation = self.bridge.queue.reserve_dispatch(row['messageId'], 'qd-survivor')
        self.bridge.queue.mark_submitted(reservation['reservationId'], 'task-112233aabbcc')
        self.bridge.queue.mark_answered(reservation['reservationId'], 'task-112233aabbcc', 'old answer')
        self.now += 301
        self.bridge.speech = SimpleNamespace(submit=lambda *a: self.fail('historical audio must not play'))
        self.bridge.tick()
        self.assertFalse((self.root / 'speech').exists())
        self.assertEqual(self.posts, [])

    def test_survivor_pause_only_reconciles_and_never_first_speaks(self):
        row = self.bridge.call('maid-test', 'party_send', {'text': '到这边来。'}, 'pause')
        party = SurvivorParty(self.root, game=self.game)
        party._queue = self.bridge.queue
        reservation = party.reserve(row)
        party.submitted(reservation, 'task-112233aabbcc')
        before = len(self.game.emits)
        waiting = party.answered(reservation, 'task-112233aabbcc', '我听见了。', allow_dispatch=False)
        self.assertEqual(waiting['status'], 'pending')
        self.assertFalse(waiting['settled']); self.assertFalse(waiting['heard'])
        self.bridge.tick()  # The NPC does not first-speak Kirito's pending reply.
        self.assertEqual(len(self.game.emits), before)
        self.assertIsNone(self.bridge.queue.get_status('maid-test', row['messageId'])['reply'])
        done = party.answered(reservation, 'task-112233aabbcc', '我听见了。')
        self.assertTrue(done['settled']); self.assertTrue(done['heard'])
        self.assertEqual(self.game.emits[-1]['speakerUuid'], self.config['members'][0]['bodyUuid'])
        self.assertEqual(len(self.game.emits), before + 1)
        party.answered(reservation, 'task-112233aabbcc', '我听见了。', allow_dispatch=False)
        self.assertEqual(len(self.game.emits), before + 1)

    def test_survivor_reply_unknown_recovers_read_only_and_rejection_hides_text(self):
        row = self.bridge.call('maid-test', 'party_send', {'text': '讨论一下。'}, 'uncertain')
        party = SurvivorParty(self.root, game=self.game); party._queue = self.bridge.queue
        reservation = party.reserve(row); party.submitted(reservation, 'task-112233aabbcc')
        self.game.lose_reply = True; self.game.phase = 'rejected'
        result = party.answered(reservation, 'task-112233aabbcc', '现在太远了。')
        self.assertFalse(result['settled']); self.assertFalse(result['heard'])
        calls = len(self.game.emits)
        result = party.answered(reservation, 'task-112233aabbcc', '现在太远了。', allow_dispatch=False)
        self.assertTrue(result['settled']); self.assertFalse(result['heard'])
        self.assertEqual(result['status'], 'rejected'); self.assertEqual(len(self.game.emits), calls)
        self.assertIsNone(self.bridge.queue.get_status('maid-test', row['messageId'])['reply'])
        self.assertIsNone(self.bridge.queue.active_for_recipient('qd-survivor'))

    def test_world_rejection_or_uncertainty_never_spends_or_exposes_request(self):
        self.game.phase = 'rejected'
        row = self.bridge.call('qd-survivor', 'party_send', {'text': '只有近处才听见。'}, 'far')
        self.assertFalse(row['executionConfirmed'])
        self.bridge.tick(); self.bridge.tick()
        self.assertEqual(self.posts, [])
        self.assertIsNone(self.bridge.call('maid-test', 'party_message_read', {'message_id': row['messageId']}, 'read')['text'])
        public = self.bridge.publish()
        self.assertIsNone(public['messages'][0]['text'])
        self.assertNotIn('bodyUuid', json.dumps(public))

    def test_game_msg_never_plays_or_publishes_private_text(self):
        self.bridge.speech = SimpleNamespace(submit=lambda *a: self.fail('msg must not play nearby'))
        row = self.bridge.call('maid-test', 'party_send', {'text': '悄悄告诉你。', 'channel': 'msg'}, 'private')
        self.assertTrue(row['executionConfirmed'])
        self.assertEqual(self.bridge.queue.get_status('qd-survivor', row['messageId'])['text'], '悄悄告诉你。')
        public = self.bridge.publish()
        self.assertIsNone(public['messages'][0]['text'])
        self.assertEqual(public['messages'][0]['worldDelivery']['receipt']['channel'], 'msg')

    def test_crash_after_native_ledger_submission_recovers_by_read_only(self):
        row = self.bridge.call('qd-survivor', 'party_send', {'text': 'test'}, 'one')
        reservation = self.bridge.queue.reserve_dispatch(row['messageId'], 'maid-test')
        self.tasks.submit('maid_dialogue', reservation['taskKey'], message_context(row),
            maid_uuid=self.binding['bodyUuid'], owner_uuid=self.binding['ownerUuid'])
        restored = PartyBridge(self.root, self.registry, self.native, self.tasks, clock=lambda: self.now, public=self.root / 'public.json', game=self.game)
        restored.tick()
        self.assertEqual(restored.queue.get_status('qd-survivor', row['messageId'])['status'], 'answered')
        self.assertEqual(len(self.posts), 1)

    def test_maid_role_gate_retains_unknown_after_age_out(self):
        def uncertain(*a): raise TimeoutError()
        self.tasks.transport = uncertain
        kw = dict(maid_uuid=self.binding['bodyUuid'], owner_uuid=self.binding['ownerUuid'])
        self.assertEqual(self.tasks.submit('maid_dialogue', 'first', 'hello', **kw)['status'], 'submission_uncertain')
        self.now += 90000
        self.assertEqual(self.tasks.submit('maid_dialogue', 'second', 'next', **kw)['status'], 'busy')

    def test_publish_is_bounded_public_projection(self):
        self.bridge.call('qd-survivor', 'party_send', {'text': '<script>fake</script>'}, 'one')
        public = self.bridge.publish()
        self.assertNotIn('mcpToken', json.dumps(public))
        self.assertNotIn('sessionId', json.dumps(public))
        self.assertEqual(public['members'][1]['displayName'], 'Maid')

    def http_request(self):
        adapter = MaidAdapter(self.tasks.root, tasks=self.tasks, party=self.bridge)
        server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(adapter, 'legacy-' + 't' * 48))
        thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
        thread.start()
        self.addCleanup(lambda: (server.shutdown(), server.server_close(), thread.join(timeout=3)))
        def request(payload, token='s' * 48, session=None):
            connection = HTTPConnection('127.0.0.1', server.server_port, timeout=3)
            headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token}
            if session: headers['Mcp-Session-Id'] = session
            try:
                connection.request('POST', '/party/mcp', json.dumps(payload), headers)
                response = connection.getresponse()
                return response.status, dict(response.headers), json.loads(response.read())
            finally: connection.close()
        return request

    def test_http_mcp_authorization_session_binding_and_retry(self):
        request = self.http_request()
        init = {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {'protocolVersion': '2025-11-25'}}
        status, headers, _ = request(init)
        self.assertEqual(status, 200)
        session = headers['Mcp-Session-Id']
        call = {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'party_send', 'arguments': {'text': 'hello'}}}
        a = request(call, session=session)[2]
        b = request(call, session=session)[2]
        self.assertEqual(a, b)
        self.assertIn('error', request(call, token='m' * 48, session=session)[2])
        self.assertEqual(request(init, token='x' * 48)[0], 401)
        self.assertEqual(len(self.bridge.queue.overview('qd-survivor')['messages']), 1)

    def test_http_send_parameter_feedback_keeps_protocol_and_execution_errors_distinct(self):
        request = self.http_request()
        _, headers, _ = request({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
                                  'params': {'protocolVersion': '2025-11-25'}})
        session = headers['Mcp-Session-Id']
        original = 'private-dialogue-marker\n\n秘密内容'
        call = {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call',
                'params': {'name': 'party_send', 'arguments': {'text': original}}}
        status, _, response = request(call, session=session)
        self.assertEqual(status, 200)
        self.assertEqual(response['jsonrpc'], '2.0')
        self.assertEqual(response['id'], 2)
        self.assertEqual(response['error']['code'], -32602)
        self.assertEqual(response['error']['data'], {'code': 'party_send_invalid_argument',
            'field': 'text', 'reason': 'single_line_required', 'enqueued': False,
            'worldSendAttempted': False, 'retryAutomatically': False})
        self.assertIn('text must be a single line', response['error']['message'])
        self.assertIn('not queued or sent to the game', response['error']['message'])
        self.assertNotIn('private-dialogue-marker', json.dumps(response))
        self.assertNotIn('秘密内容', json.dumps(response, ensure_ascii=False))
        self.assertIsNone(self.bridge._queue)
        self.assertEqual(self.game.emits, [])
        self.assertEqual(self.posts, [])
        # A session/authentication or execution failure cannot claim non-delivery.
        wrong_actor = request(call, token='m' * 48, session=session)[2]
        self.assertEqual(wrong_actor['error'], {'code': -32602,
            'message': 'Invalid or unavailable party request'})
        with patch.object(self.bridge, 'call', side_effect=ValueError('private execution details')):
            failed = request(call, session=session)[2]
        self.assertEqual(failed['error'], {'code': -32602,
            'message': 'Invalid or unavailable party request'})


if __name__ == '__main__': unittest.main()
