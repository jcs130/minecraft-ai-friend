"""Explicit model-selected completion, never inferred from repeated polling."""
import copy
import json
from pathlib import Path
import sys
from types import SimpleNamespace as NS
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
from survival_turn_runtime import (completion_summary, wrap_reasoning_impl, TOOL, START_TOOL, CONTRACT,
                                   ENDED_CONTRACT, ENDED_SUMMARY)
from test_survival_skill_tools import SurvivalSkillToolsTests, TURN

EXTERNAL_SESSION = 'life-0123456789abcdef0123456789abcdef'


def request_identity():
    return {'session_id': EXTERNAL_SESSION, 'agent_id': 'qd-survivor',
            'user_id': 'survival-controller', 'channel': 'console'}


class Message:
    id = 'reply-current'
    def __init__(self, calls, results):
        self.calls, self.results = calls, results
    def get_content_blocks(self, kind):
        return self.calls if kind == 'tool_call' else self.results


class TurnCompletionTests(unittest.TestCase):
    setUp = SurvivalSkillToolsTests.setUp

    def fixture(self, **values):
        args = {'turn_id': TURN, 'goal': 'wait', 'finish_turn': True, 'summary': '等待下一次观察。'} | values
        result = self.tools.remember(**args)
        self.message = Message([NS(id='call-current', name=TOOL, input=args)],
            [NS(id='call-current', name=TOOL, state='success', output=json.dumps(result))])
        self.agent = NS(_workspace_dir='/state/work/workspaces/qd-survivor',
            _agent_config=NS(id='qd-survivor'), _request_context=request_identity(),
            state=NS(session_id='74f2411062c74127979644d532ba4b99', reply_id=self.message.id),
            _get_last_msg=lambda: self.message, name='Kirito')
        return args, result

    def test_model_selects_end_and_checkpoint_keeps_authority_and_idempotence(self):
        _, result = self.fixture()
        lease = (self.state / 'lease.json').read_bytes()
        saved = (self.state / 'memory.json').read_bytes()
        self.assertEqual(completion_summary(self.agent), '等待下一次观察。')
        _, repeated = self.fixture()
        self.assertFalse(repeated['changed'])
        self.assertEqual((self.state / 'memory.json').read_bytes(), saved)
        self.assertEqual((self.state / 'lease.json').read_bytes(), lease)
        self.assertTrue(result['memorySaved'])

    def test_plain_remember_and_rejected_finish_do_not_end(self):
        self.fixture(finish_turn=False)
        self.assertIsNone(completion_summary(self.agent))
        _, result = self.fixture(turn_id='wrong-turn')
        self.assertFalse(result['ok'])
        self.assertIsNone(completion_summary(self.agent))

    def test_missing_summary_names_field_without_saving_or_closing_and_can_be_corrected(self):
        self.fixture(finish_turn=False)
        saved = (self.state / 'memory.json').read_bytes()
        lease = (self.state / 'lease.json').read_bytes()
        _, rejected = self.fixture(summary='')
        self.assertEqual(rejected['code'], 'invalid_turn_completion')
        self.assertIn('summary', rejected['fields'])
        self.assertFalse(rejected['memorySaved'])
        self.assertFalse(rejected['writePerformed'])
        self.assertFalse(rejected['turnFinished'])
        self.assertIsNone(completion_summary(self.agent))
        self.assertEqual((self.state / 'memory.json').read_bytes(), saved)
        self.assertEqual((self.state / 'lease.json').read_bytes(), lease)
        _, corrected = self.fixture(summary='已完成本轮观察。')
        self.assertTrue(corrected['memorySaved'])
        self.assertEqual(completion_summary(self.agent), '已完成本轮观察。')
        self.assertEqual((self.state / 'lease.json').read_bytes(), lease)

    def test_old_reply_other_role_other_tool_and_unmatched_receipt_cannot_end(self):
        self.fixture()
        original = copy.deepcopy(self.agent)
        self.agent.state.reply_id = 'next-reply'
        self.assertIsNone(completion_summary(self.agent))
        self.agent.state.reply_id = self.message.id
        self.agent._agent_config.id = 'qd-engineer'
        self.assertIsNone(completion_summary(self.agent))
        self.agent._agent_config.id = original._agent_config.id
        self.message.results[0].id = 'unrelated-call'
        self.assertIsNone(completion_summary(self.agent))
        self.message.results[0].id = 'call-current'
        self.message.calls.append(NS(id='later', name='numen_survival__eat', input={}))
        self.assertIsNone(completion_summary(self.agent))

    def test_malformed_missing_or_error_receipt_is_not_completion(self):
        self.fixture()
        result = self.message.results[0]
        for value in ('not json', '[]', '{"ok": true}', json.dumps({'turnCompletion': []})):
            result.output = value
            self.assertIsNone(completion_summary(self.agent))
        self.fixture()
        self.message.results[0].state = 'error'
        self.assertIsNone(completion_summary(self.agent))

    def test_already_emitted_current_call_cannot_repeat(self):
        self.fixture()
        self.agent._qiandeng_survival_finish_emitted = (self.message.id, 'call-current')
        self.assertIsNone(completion_summary(self.agent))

    def test_exact_closed_authority_ends_without_claiming_game_success(self):
        from numen_gateway import write_json, cognition_rejection
        self.fixture(finish_turn=False)
        write_json(self.state / 'cognition-lease.json', {'schema': 1, 'turnId': TURN,
            'status': 'closed', 'bodyAccess': 'queued', 'expiresAt': 9999999999999})
        value = cognition_rejection(self.state, TURN, 'cognition_closed')
        self.message.calls[0] = NS(id='call-current', name='numen_survival__eat', input={'turn_id': TURN})
        self.message.results[0] = NS(id='call-current', name='numen_survival__eat',
            state='success', output=json.dumps(value))
        self.assertEqual(completion_summary(self.agent), ENDED_SUMMARY)
        self.assertFalse(value['turnEnded']['gameOutcomeConfirmed'])
        self.assertFalse(value['writePerformed'])
        for field, changed in (('turnId', 'survival-other00000'), ('ok', True), ('dispatched', True),
                               ('writePerformed', True), ('code', 'outcome_unknown')):
            self.message.results[0].output = json.dumps(value | {field: changed})
            self.assertIsNone(completion_summary(self.agent), field)
        self.message.results[0].output = json.dumps(value)
        self.message.calls[0].name = self.message.results[0].name = 'other__eat'
        self.assertIsNone(completion_summary(self.agent))

    def test_authority_end_requires_own_lease_and_known_terminal_authorization(self):
        from numen_gateway import write_json, cognition_rejection
        self.fixture(finish_turn=False)
        path = self.state / 'cognition-lease.json'
        valid = {'schema': 1, 'turnId': TURN, 'status': 'closed', 'bodyAccess': 'queued', 'expiresAt': 2000}
        for change in ({'turnId': 'survival-other00000'}, {'schema': 9}, {'bodyAccess': 'direct'},
                       {'status': 'unknown'}, {'status': 'open'}):
            write_json(path, valid | change)
            self.assertNotIn('turnEnded', cognition_rejection(self.state, TURN, 'cognition_closed', lambda: 3))
        write_json(path, valid)
        for code in ('outcome_unknown', 'autonomy_disabled', 'cognition_goal_changed', 'lease_invalid'):
            self.assertNotIn('turnEnded', cognition_rejection(self.state, TURN, code, lambda: 3))
        write_json(path, valid | {'status': 'open'})
        self.assertNotIn('turnEnded', cognition_rejection(self.state, TURN, 'cognition_expired', lambda: 1))
        self.assertTrue(cognition_rejection(self.state, TURN, 'cognition_expired', lambda: 3)['turnEnded']['authorityEnded'])

    def test_closed_remember_rejection_does_not_write_or_renew(self):
        from numen_gateway import write_json
        self.fixture(finish_turn=False)
        write_json(self.state / 'settings.json', {'asyncMotor': True})
        write_json(self.state / 'cognition-lease.json', {'schema': 1, 'turnId': TURN,
            'status': 'closed', 'bodyAccess': 'queued', 'expiresAt': 9999999999999})
        before = {p.name: p.read_bytes() for p in self.state.glob('*.json')}
        result = self.tools.remember(TURN, goal='must not save', finish_turn=True, summary='不能保存本轮。')
        self.assertEqual(result['code'], 'cognition_closed')
        self.assertTrue(result['turnEnded']['authorityEnded'])
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.state.glob('*.json')})

    def test_native_single_text_result_is_accepted_but_mixed_evidence_is_not(self):
        self.fixture()
        payload = self.message.results[0].output
        self.message.results[0].output = [NS(type='text', text=payload)]
        self.assertEqual(completion_summary(self.agent), '等待下一次观察。')
        for output in ([{'type': 'text', 'text': payload}, {'type': 'text', 'text': payload}],
                       [{'type': 'data', 'text': payload}], []):
            self.message.results[0].output = output
            self.assertIsNone(completion_summary(self.agent))

    def test_external_request_identity_required_without_internal_id_fallback(self):
        self.fixture()
        native_id = self.agent.state.session_id
        for key, value in (('session_id', 'chat-other'), ('session_id', 'life-'),
                           ('session_id', 'life-0123456789abcdef0123456789abcdeg'),
                           ('session_id', None), ('agent_id', 'qd-engineer'),
                           ('user_id', 'another-user'), ('channel', 'a2a')):
            self.agent._request_context = request_identity() | {key: value}
            self.assertIsNone(completion_summary(self.agent), (key, value))
        for key in request_identity():
            self.agent._request_context = {k:v for k,v in request_identity().items() if k != key}
            self.assertIsNone(completion_summary(self.agent), key)
        self.agent._request_context = request_identity()
        self.assertEqual(completion_summary(self.agent), '等待下一次观察。')
        self.assertEqual(self.agent.state.session_id, native_id)
        self.agent.state.session_id = EXTERNAL_SESSION
        self.agent._request_context = {}
        self.assertIsNone(completion_summary(self.agent))

    def start_fixture(self, **values):
        self.fixture(finish_turn=False)
        args = {'turn_id': TURN, 'name': 'gather', 'version': 'a' * 64,
                'summary': '程序已排队，等待实际执行回执。'} | values
        result = {'ok': True, 'code': 'skill_queued', 'executionConfirmed': False,
                  'name': args['name'], 'version': args['version'], 'turnId': args['turn_id'],
                  'turnCompletion': {'requested': True, 'contract': CONTRACT,
                                     'summary': str(args['summary']).strip()}}
        self.message.calls[0] = NS(id='call-current', name=START_TOOL, input=args)
        self.message.results[0] = NS(id='call-current', name=START_TOOL, state='success',
                                     output=json.dumps(result))
        return args, result

    def test_start_receipt_ends_with_only_current_model_summary(self):
        args, result = self.start_fixture(summary='  程序已排队，等待实际执行回执。  ')
        self.assertEqual(completion_summary(self.agent), args['summary'].strip())
        self.assertFalse(result['executionConfirmed'])
        self.message.calls[0].input = json.dumps(args)
        self.message.results[0].output = [{'type': 'text', 'text': json.dumps(json.dumps(result))}]
        self.assertEqual(completion_summary(self.agent), args['summary'].strip())

    def test_start_missing_invalid_or_unrequested_summary_does_not_end(self):
        for summary in ('', '  ', None, False, 'x' * 601):
            with self.subTest(summary_type=type(summary).__name__):
                self.start_fixture(summary=summary)
                self.assertIsNone(completion_summary(self.agent))
        _, result = self.start_fixture()
        result['turnCompletion']['requested'] = False
        self.message.results[0].output = json.dumps(result)
        self.assertIsNone(completion_summary(self.agent))
        self.start_fixture()
        self.message.calls[0].input.pop('summary')
        self.assertIsNone(completion_summary(self.agent))

    def test_start_requires_matching_queue_identity_and_unexecuted_receipt(self):
        for key, value in (('ok', False), ('code', 'skill_rejected'),
                           ('executionConfirmed', True), ('executionConfirmed', 0),
                           ('executionConfirmed', None), ('name', 'other'),
                           ('version', 'b' * 64), ('turnId', 'other-turn')):
            with self.subTest(key=key, value=value):
                _, result = self.start_fixture()
                result[key] = value
                self.message.results[0].output = json.dumps(result)
                self.assertIsNone(completion_summary(self.agent))
        for key in ('name', 'version', 'turnId', 'executionConfirmed', 'turnCompletion'):
            _, result = self.start_fixture()
            result.pop(key)
            self.message.results[0].output = json.dumps(result)
            self.assertIsNone(completion_summary(self.agent), key)
        for key in ('name', 'version', 'turn_id'):
            self.start_fixture(**{key: ''})
            self.assertIsNone(completion_summary(self.agent), key)
        for key, value in (('contract', 'other-contract'), ('summary', 'another summary')):
            _, result = self.start_fixture()
            result['turnCompletion'][key] = value
            self.message.results[0].output = json.dumps(result)
            self.assertIsNone(completion_summary(self.agent), key)

    def test_start_ambiguous_receipt_foreign_reply_and_later_tool_never_shortcut(self):
        self.start_fixture()
        self.message.results.append(copy.deepcopy(self.message.results[0]))
        self.assertIsNone(completion_summary(self.agent))
        self.start_fixture()
        self.message.results[0].state = 'error'
        self.assertIsNone(completion_summary(self.agent))
        self.start_fixture()
        self.message.calls.append(NS(id='later', name='numen_survival__status', input={}))
        self.assertIsNone(completion_summary(self.agent))
        self.start_fixture()
        self.agent.state.reply_id = 'older-reply'
        self.assertIsNone(completion_summary(self.agent))
        self.start_fixture()
        self.agent._request_context['user_id'] = 'another-user'
        self.assertIsNone(completion_summary(self.agent))


class NativeReplyTests(unittest.IsolatedAsyncioTestCase):
    """Real Qwen/AgentScope reply, tool execution, text events and persistence.

    Only model responses and the local remember fixture are replayed. No model
    provider, game server, production workspace or process is accessed.
    """
    async def scenario(self, order=('remember',), finish=True, role='qd-survivor', gate_continue=False,
                       unlimited=False, high_iteration=None, request_overrides=None,
                       start_receipt_overrides=None, summary_value=None, ended_receipt_overrides=None):
        from unittest.mock import patch
        from agentscope.agent import ReActConfig
        from agentscope.message import ToolCallBlock, TextBlock, UserMsg
        from agentscope.model import ChatResponse
        from agentscope.tool import FunctionTool, Toolkit
        from qwenpaw.agents.react_agent import QwenPawAgent
        from qwenpaw.config.config import AgentProfileConfig
        from qwenpaw.runtime.builder import AgentBuilder

        summary = '已保存本轮观察，等待下一轮。' if summary_value is None else summary_value
        calls, executed, saved = [], [], []
        async def remember(finish_turn: bool, summary: str):
            executed.append('remember')
            return json.dumps({'ok': True, 'code': 'memory_recorded', 'memorySaved': True,
                'turnCompletion': {'requested': finish_turn, 'summary': summary if finish_turn else '',
                    'contract': 'qiandeng-survival-turn-v1'}})
        async def other():
            executed.append('other')
            return 'observed'
        async def ended(turn_id: str):
            executed.append('ended')
            return json.dumps({'ok': False, 'code': 'cognition_closed', 'turnId': turn_id,
                'dispatched': False, 'writePerformed': False,
                'turnEnded': {'contract': ENDED_CONTRACT, 'authorityEnded': True,
                              'gameOutcomeConfirmed': False}} | (ended_receipt_overrides or {}))
        async def start(turn_id: str, name: str, version: str, summary: str = ''):
            executed.append('start')
            return json.dumps({'ok': True, 'code': 'skill_queued', 'executionConfirmed': False,
                'name': name, 'version': version, 'turnId': turn_id,
                'turnCompletion': {'requested': bool(summary.strip()), 'summary': summary.strip(),
                    'contract': CONTRACT}} | (start_receipt_overrides or {}))
        toolkit = Toolkit()
        await toolkit.add_tool(FunctionTool(remember, name=TOOL, is_concurrency_safe=False))
        await toolkit.add_tool(FunctionTool(start, name=START_TOOL, is_concurrency_safe=False))
        await toolkit.add_tool(FunctionTool(other, name='other', is_concurrency_safe=False))
        await toolkit.add_tool(FunctionTool(ended, name='numen_survival__eat', is_concurrency_safe=False))
        manager = NS(on_save=lambda agent, blocks: saved.extend(blocks))
        async def compress(agent, config): pass
        manager.compress = compress
        async def count_tokens(*args, **kwargs): return 20
        # Use the official builder shape and retain AgentScope's default random
        # internal session ID, exactly as the production session demonstrated.
        identity = request_identity() | (request_overrides or {})
        identity['agent_id'] = role
        request_context = AgentBuilder._build_request_context(NS(
            session_id=identity['session_id'], agent_id=identity['agent_id'],
            request=NS(channel=identity['channel'], user_id=identity['user_id'], request_context=None)))
        agent = QwenPawAgent(name='Kirito', model=NS(model='replay-only', context_size=32768,
            count_tokens=count_tokens, formatter=NS(supported_input_media_types=set())),
            system_prompt='Replay fixture.', toolkit=toolkit, react_config=ReActConfig(max_iters=12),
            middlewares=[], agent_config=AgentProfileConfig(id=role, name='Kirito'),
            request_context=request_context,
            workspace_dir='/state/work/workspaces/qd-survivor', context_manager=manager)
        agent._agent_config.running.loop.iteration.enabled = not unlimited
        native_internal_session = agent.state.session_id
        if gate_continue:
            from qwenpaw.loop.gates.base import StopAction, StopHandlerResult
            async def gate(ctx):
                final = ctx.get('final_msg')
                if final is not None and final.get_text_content() == summary:
                    return StopHandlerResult(action=StopAction.INTERRUPT_AND_CONTINUE,
                                             continuation_message='Fixture asks to continue.')
                return StopHandlerResult(action=StopAction.TERMINATE)
            agent._get_stop_handlers = lambda: [NS(scope='', priority=1, name='fixture', handler=gate)]
        async def prepare(): return {}
        agent._prepare_model_input = prepare
        async def model_call(**kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                if high_iteration is not None:
                    agent.state.cur_iter = high_iteration
                names = {'remember': TOOL, 'start': START_TOOL, 'other': 'other', 'ended': 'numen_survival__eat'}
                args = {'remember': {'finish_turn': finish, 'summary': summary},
                        'start': {'turn_id': TURN, 'name': 'gather', 'version': 'a' * 64, 'summary': summary},
                        'other': {}, 'ended': {'turn_id': TURN}}
                return ChatResponse(content=[ToolCallBlock(id=f'call-{i}', name=names[name],
                    input=json.dumps(args[name]))
                    for i, name in enumerate(order)], is_last=True)
            return ChatResponse(content=[TextBlock(text='模型后续文本。')], is_last=True)
        agent._call_model = model_call
        original = QwenPawAgent._reasoning_impl
        from llm_runtime_policy import wrap_next_action
        with patch.object(QwenPawAgent, '_reasoning_impl', wrap_reasoning_impl(original)), \
             patch.object(QwenPawAgent, '_next_action', wrap_next_action(QwenPawAgent._next_action)):
            events = [event async for event in agent.reply_stream(UserMsg('user', 'observe'))]
            first_state = copy.deepcopy(agent.state_dict())
            first_calls = len(calls)
            first_saved = list(saved)
            next_events = [event async for event in agent.reply_stream(UserMsg('user', 'next round'))]
        return NS(summary=summary, calls=first_calls, executed=executed, saved=first_saved,
                  events=events, state=first_state, next_events=next_events, total_calls=len(calls),
                  native_internal_session=native_internal_session, final_internal_session=agent.state.session_id,
                  external_session=agent._request_context['session_id'])

    async def test_native_stream_saved_summary_no_extra_model_and_next_round_continues(self):
        from agentscope.event import TextBlockDeltaEvent, ReplyEndEvent, ModelCallStartEvent
        result = await self.scenario()
        self.assertEqual(result.calls, 1)
        self.assertEqual(result.executed, ['remember'])
        self.assertEqual(''.join(e.delta for e in result.events if isinstance(e, TextBlockDeltaEvent)), result.summary)
        self.assertEqual(sum(isinstance(e, ModelCallStartEvent) for e in result.events), 1)
        self.assertEqual([e.finished_reason for e in result.events if isinstance(e, ReplyEndEvent)], ['completed'])
        self.assertTrue(any(getattr(b, 'text', None) == result.summary for b in result.saved))
        text = json.dumps(result.state, ensure_ascii=False)
        self.assertIn(result.summary, text)
        context = result.state['state']['context']
        self.assertEqual(context[-1]['content'][-1]['type'], 'text')
        self.assertEqual(context[-1]['content'][-1]['text'], result.summary)
        self.assertEqual(result.total_calls, 2)
        self.assertNotEqual(result.native_internal_session, EXTERNAL_SESSION)
        self.assertEqual(result.state['state']['session_id'], result.native_internal_session)
        self.assertEqual(result.final_internal_session, result.native_internal_session)
        self.assertEqual(result.external_session, EXTERNAL_SESSION)
        self.assertEqual(''.join(e.delta for e in result.next_events if isinstance(e, TextBlockDeltaEvent)), '模型后续文本。')

    async def test_native_later_tool_is_executed_and_prevents_shortcut(self):
        result = await self.scenario(order=('remember', 'other'))
        self.assertEqual(result.executed, ['remember', 'other'])
        self.assertEqual(result.calls, 2)

    async def test_native_closed_authority_finishes_without_another_model_call(self):
        from agentscope.event import TextBlockDeltaEvent, ReplyEndEvent
        result = await self.scenario(order=('ended',))
        self.assertEqual(result.calls, 1)
        self.assertEqual(result.executed, ['ended'])
        self.assertEqual(''.join(e.delta for e in result.events if isinstance(e, TextBlockDeltaEvent)), ENDED_SUMMARY)
        self.assertEqual([e.finished_reason for e in result.events if isinstance(e, ReplyEndEvent)], ['completed'])
        self.assertEqual(result.total_calls, 2)
        self.assertEqual(result.final_internal_session, result.native_internal_session)

    async def test_native_closed_authority_preserves_other_tools_and_foreign_context(self):
        for options in ({'order': ('ended', 'other')}, {'order': ('ended',), 'role': 'qd-engineer'},
                        {'order': ('ended',), 'ended_receipt_overrides': {'code': 'outcome_unknown'}}):
            with self.subTest(options=options):
                result = await self.scenario(**options)
                self.assertEqual(result.calls, 2)

    async def test_native_start_queue_stream_persists_summary_without_next_model_call(self):
        from agentscope.event import TextBlockDeltaEvent, ReplyEndEvent, ModelCallStartEvent
        result = await self.scenario(order=('start',), summary_value='程序已排队，等待实际执行回执。')
        self.assertEqual(result.calls, 1)
        self.assertEqual(result.executed, ['start'])
        self.assertEqual(''.join(e.delta for e in result.events if isinstance(e, TextBlockDeltaEvent)), result.summary)
        self.assertEqual(sum(isinstance(e, ModelCallStartEvent) for e in result.events), 1)
        self.assertEqual([e.finished_reason for e in result.events if isinstance(e, ReplyEndEvent)], ['completed'])
        self.assertEqual(result.state['state']['context'][-1]['content'][-1]['text'], result.summary)
        self.assertEqual(result.total_calls, 2)

    async def test_native_start_rejected_optional_summary_and_other_identity_keep_model_loop(self):
        for options in ({'summary_value': ''}, {'start_receipt_overrides': {'ok': False}},
                        {'start_receipt_overrides': {'version': 'b' * 64}},
                        {'role': 'qd-engineer'}):
            with self.subTest(options=options):
                result = await self.scenario(order=('start',), **options)
                self.assertEqual(result.calls, 2)

    async def test_native_start_never_drops_later_tools(self):
        result = await self.scenario(order=('start', 'other'))
        self.assertEqual(result.executed, ['start', 'other'])
        self.assertEqual(result.calls, 2)
        result = await self.scenario(order=('other', 'start'))
        self.assertEqual(result.executed, ['other', 'start'])
        self.assertEqual(result.calls, 1)

    async def test_native_earlier_queued_tool_executes_before_finish(self):
        result = await self.scenario(order=('other', 'remember'))
        self.assertEqual(result.executed, ['other', 'remember'])
        self.assertEqual(result.calls, 1)

    async def test_native_checkpoint_and_other_identity_keep_model_loop(self):
        for options in ({'finish': False}, {'role': 'qd-engineer'}):
            result = await self.scenario(**options)
            self.assertEqual(result.calls, 2)

    async def test_native_builder_foreign_user_channel_and_conversation_cannot_finish(self):
        for values in ({'user_id': 'manual-console-user'}, {'channel': 'a2a'}, {'session_id': 'chat-other'}):
            result = await self.scenario(request_overrides=values)
            self.assertEqual(result.calls, 2)

    async def test_real_qwen_stop_handler_can_continue_after_explicit_finish(self):
        from agentscope.event import TextBlockDeltaEvent
        result = await self.scenario(gate_continue=True)
        self.assertEqual(result.calls, 2)
        self.assertEqual(sum(getattr(b, 'text', None) == result.summary for b in result.saved), 1)
        self.assertEqual(''.join(e.delta for e in result.events if isinstance(e, TextBlockDeltaEvent)),
                         result.summary + '模型后续文本。')

    async def test_disabled_iteration_policy_finishes_beyond_native_serialized_limit(self):
        from agentscope.event import TextBlockDeltaEvent, ReplyEndEvent
        result = await self.scenario(unlimited=True, high_iteration=50)
        self.assertEqual(result.calls, 1)
        self.assertEqual(''.join(e.delta for e in result.events if isinstance(e, TextBlockDeltaEvent)), result.summary)
        self.assertEqual([e.finished_reason for e in result.events if isinstance(e, ReplyEndEvent)], ['completed'])

    async def test_enabled_iteration_limit_keeps_native_stop(self):
        from agentscope.event import TextBlockDeltaEvent, ReplyEndEvent
        result = await self.scenario(high_iteration=50)
        self.assertNotIn(result.summary, ''.join(e.delta for e in result.events if isinstance(e, TextBlockDeltaEvent)))
        self.assertEqual([e.finished_reason for e in result.events if isinstance(e, ReplyEndEvent)], ['exceed_max_iters'])

    def test_native_install_keeps_next_action_and_outer_reasoning_intact(self):
        from unittest.mock import patch
        from qwenpaw.agents.react_agent import QwenPawAgent
        from survival_turn_runtime import install, VERSION
        original = QwenPawAgent._reasoning_impl
        next_action, outer = QwenPawAgent._next_action, QwenPawAgent._reasoning
        with patch.object(QwenPawAgent, '_reasoning_impl', original), \
             patch.object(QwenPawAgent, '_qiandeng_survival_finish', None, create=True):
            self.assertEqual(install('game'), VERSION)
            installed = QwenPawAgent._reasoning_impl
            self.assertEqual(install('game'), VERSION)
            self.assertIs(QwenPawAgent._reasoning_impl, installed)
            self.assertIs(QwenPawAgent._next_action, next_action)
            self.assertIs(QwenPawAgent._reasoning, outer)


if __name__ == '__main__':
    unittest.main()
