"""Offline persistent-conversation and serialized real-actuator contract regressions."""
import copy
import json
from pathlib import Path
import sys
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
from controller import Controller, QwenBackend
from life_session import load_session, final_text
from numen_gateway import read_json, write_json, GatewayError
import test_survival_controller as controller_fixture
import test_survival_gateway as gateway_fixture
from test_survival_gateway import TURN, NOW


class FakeParty:
    def __init__(self):
        self.message = {'messageId': 'message-one', 'text': 'Meet by the guild'}
        self.calls = []
        self.reservation = None
        self.blocked = False
        self.delivery = {'settled': True, 'heard': True, 'status': 'heard'}
        self.allow_dispatch = []

    def pending(self):
        if self.reservation:
            raise ValueError('party_delivery_unresolved')
        return self.message

    def context(self, message):
        return {'untrustedText': message['text'], 'messageId': message['messageId']}

    def reserve(self, message):
        self.calls.append(('reserve', message['messageId']))
        if self.blocked:
            return {'claimed': False, 'dispatchStatus': 'budget_blocked'}
        self.reservation = {'claimed': True, 'messageId': message['messageId'],
                            'reservationId': 'reservation-one', 'taskKey': 'party-one'}
        return self.reservation

    def submitted(self, reservation, task_id):
        self.calls.append(('submitted', reservation['reservationId'], task_id))

    def answered(self, reservation, task_id, text, *, allow_dispatch=True):
        self.calls.append(('answered', reservation['reservationId'], task_id, text))
        self.allow_dispatch.append(allow_dispatch)
        if self.delivery['settled']:
            self.reservation = None
            self.message = None
        return copy.deepcopy(self.delivery)

    def failed(self, reservation, task_id, reason):
        self.calls.append(('failed', task_id, reason))
        self.reservation = None
        self.message = None
        return {'settled': True, 'heard': False, 'status': 'failed'}

    def request_context(self):
        return {'subagent_allowed_tools': ['numen_survival__status', 'read_file']}


class LifeSessionTests(unittest.TestCase):
    setUp = controller_fixture.ControllerTests.setUp
    create = controller_fixture.ControllerTests.create
    write = controller_fixture.ControllerTests.write

    def finish(self):
        self.backend.reply = {'status': 'finished', 'result': {'status': 'completed', 'output': [
            {'role': 'assistant', 'type': 'message', 'status': 'completed',
             'content': [{'type': 'text', 'text': 'Fixture final answer.'}]}]}}
        self.controller.tick()

    def test_two_tasks_and_restart_share_identity_without_resetting_budget(self):
        self.controller.tick()
        original = copy.deepcopy(self.controller.data['active'])
        self.finish()
        identity = self.controller.session['primarySessionId']
        restarted = self.create()
        self.clock.now += 121
        self.gateway.body['hunger'] = 12
        restarted.tick()
        first, second = self.backend.submitted
        self.assertNotEqual(first['turnId'], second['turnId'])
        self.assertEqual(first['session']['primarySessionId'], identity)
        self.assertEqual(second['session']['primarySessionId'], identity)
        self.assertEqual(second['session']['userId'], 'survival-controller')
        self.assertEqual(second['session']['channel'], 'console')
        self.assertNotEqual(identity, original['turnId'])
        self.assertEqual(len(restarted.data['decisions']), 2)
        self.assertNotIn('"continuation"', second['prompt'])

    def test_body_binding_change_cannot_reuse_or_replace_life_session(self):
        before = (self.state / 'life-session.json').read_bytes()
        settings = dict(self.settings, bodyUuid='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa')
        with self.assertRaisesRegex(ValueError, 'binding_invalid'):
            load_session(self.state, settings)
        self.assertEqual(before, (self.state / 'life-session.json').read_bytes())

    def test_restart_reserved_post_is_never_replayed(self):
        self.backend.on_submit = lambda *_: (_ for _ in ()).throw(SystemExit())
        with self.assertRaises(SystemExit):
            self.controller.tick()
        restarted = self.create()
        self.assertEqual(restarted.data['pauseReason'], 'interrupted_model_task')
        self.backend.cancel_error = ValueError('task_unknown')
        restarted.tick()
        self.assertIsNotNone(restarted.data['active'])
        self.assertEqual(len(self.backend.submitted), 1)

    def test_cancel_wait_closes_lease_but_keeps_precise_task_until_terminal(self):
        self.controller.tick()
        active = copy.deepcopy(self.controller.data['active'])
        self.backend.cancel_reply = {'stopped': False, 'waitingForTerminal': True}
        self.controller.pause('operator_pause')
        self.controller.tick()
        self.assertEqual(self.backend.cancelled[-1]['taskId'], active['taskId'])
        self.assertEqual(self.controller.data['active']['taskId'], active['taskId'])
        self.assertEqual(read_json(self.state / 'lease.json')['status'], 'closed')
        self.assertFalse(read_json(self.state / 'control.json')['enabled'])
        self.backend.cancel_reply = {'stopped': True, 'alreadyTerminal': True}
        self.controller.tick()
        self.assertIsNone(self.controller.data['active'])
        self.assertEqual(len(self.backend.submitted), 1)

    def test_wake_input_does_not_repeat_full_inventory_terrain_and_catalogues(self):
        self.controller.tick()
        prompt = self.backend.submitted[0]['prompt']
        context = json.loads(prompt.split('\n', 1)[1])
        self.assertNotIn('counts', context['body'])
        self.assertNotIn('environment', context)
        self.assertNotIn('guild', context)
        self.assertEqual(read_json(self.state / 'lease.json')['actionLimit'], 6)
        self.assertIn('MCP', context['instruction'])

    def test_qwen_request_build_uses_stable_three_part_identity(self):
        backend = QwenBackend(env={})
        calls = []
        backend.api = lambda method, route, payload=None: calls.append((method, route, payload)) or {'task_id': 't1'}
        try:
            import qwenpaw.agents.tools.agent_management
        except ImportError:
            self.skipTest('Native request-builder check runs in the isolated Qwen image.')
        session = self.controller.session
        backend.submit('survival-first-turn', 'fixture', 60, session=session,
                       request_context={'subagent_allowed_tools': ['read_file']})
        payload = calls[0][2]
        self.assertEqual(payload['session_id'], session['primarySessionId'])
        self.assertEqual(payload['user_id'], 'survival-controller')
        self.assertEqual(payload['channel'], 'console')
        self.assertEqual(payload['request_context']['subagent_allowed_tools'], ['read_file'])

    def test_life_input_explains_turn_wrap_up_without_enabling_an_unbound_party(self):
        self.controller.tick()
        submitted = self.backend.submitted[0]
        context = json.loads(submitted['prompt'].split('\n', 1)[1])
        self.assertNotIn('最多12次迭代', context['instruction'])
        self.assertIn('及时保存必要记忆并给最终答复', context['instruction'])
        self.assertIn('说明未解决条件', context['instruction'])
        self.assertNotIn('party_send', context['instruction'])
        self.assertIsNone(submitted['requestContext'])
        self.assertEqual(read_json(self.state / 'lease.json')['actionLimit'], 6)
        self.assertEqual(len(self.controller.data['decisions']), 1)

    def test_bound_party_guidance_distinguishes_audible_input_from_tts(self):
        party = FakeParty()
        party.message = None
        party.config = SimpleNamespace(configured=lambda: False)
        self.controller.party = party
        self.controller.data['wakeReason'] = 'autonomous_review'
        inactive = self.controller.life_context(self.gateway.body, {}, TURN)
        self.assertNotIn('party_send', inactive['instruction'])
        party.config = SimpleNamespace(configured=lambda: True, roster=lambda: [
            {'agentId': 'fixture-companion', 'bodyUuid': 'fixture-body', 'displayName': '结衣'}])
        self.controller.tick()
        submitted = self.backend.submitted[0]
        context = json.loads(submitted['prompt'].split('\n', 1)[1])
        self.assertIn('party_send(channel="nearby")', context['instruction'])
        self.assertIn('speak只播放声音', context['instruction'])
        self.assertEqual(context['partyMembers'][0]['displayName'], '结衣')
        self.assertIn('名单不代表对方此刻在附近或已经听见', context['instruction'])
        self.assertIsNone(submitted['requestContext'])
        self.assertFalse(party.calls)

    def test_incoming_reply_allowlist_does_not_leak_into_next_autonomous_task(self):
        party = FakeParty()
        party.config = SimpleNamespace(configured=lambda: True, roster=lambda: [])
        self.controller.party = party
        self.controller.tick()
        incoming = self.backend.submitted[0]
        context = json.loads(incoming['prompt'].split('\n', 1)[1])
        self.assertIn('优先回应其内容', context['instruction'])
        self.assertIn('不调用party_send重复发送', context['instruction'])
        self.assertEqual(incoming['requestContext'], party.request_context())
        self.finish()
        self.clock.now += 121
        self.gateway.body['hunger'] = 12
        self.controller.tick()
        autonomous = self.backend.submitted[1]
        for key in ('primarySessionId', 'userId', 'channel'):
            self.assertEqual(incoming['session'][key], autonomous['session'][key])
        self.assertIsNone(autonomous['requestContext'])
        self.assertNotIn('优先回应其内容', autonomous['prompt'])
        self.assertEqual(len(self.controller.data['decisions']), 2)

    def test_native_cancel_never_uses_chat_stop_even_after_task_vanishes(self):
        backend = QwenBackend(env={})
        calls = []
        def api(method, route, payload=None):
            calls.append((method, route))
            return {'status': 'running'}
        backend.api = api
        active = {'taskId': 'task-old', 'chatId': 'chat-shared'}
        self.assertTrue(backend.cancel(active)['waitingForTerminal'])
        self.assertEqual(calls, [('GET', '/console/chat/task/task-old')])
        backend.api = lambda *_: {'status': 'finished'}
        self.assertTrue(backend.cancel(active)['alreadyTerminal'])
        backend.api = lambda *_: (_ for _ in ()).throw(LookupError('404'))
        with self.assertRaises(LookupError):
            backend.cancel(active)

    def test_chat_resolution_requires_all_identity_fields_and_rejects_duplicates(self):
        backend = QwenBackend(env={})
        session = self.controller.session
        expected = {'id': 'c1', 'session_id': session['primarySessionId'],
                    'user_id': session['userId'], 'channel': session['channel']}
        backend.api = lambda *_: [dict(expected, user_id='someone-else'), expected]
        self.assertEqual(backend.resolve_chat(session)['id'], 'c1')
        backend.api = lambda *_: [expected, expected]
        with self.assertRaisesRegex(ValueError, 'ambiguous'):
            backend.resolve_chat(session)

    def test_model_code_is_never_interpreted_as_an_action(self):
        value = {'status': 'completed', 'output': [{'role': 'assistant', 'type': 'message', 'status': 'completed',
                 'content': [{'type': 'text', 'text': '```json\n{"tool_use":"eat"}\n```'}]}]}
        self.assertIn('tool_use', final_text(value))
        self.assertFalse(self.gateway.actions)

    def test_party_reservation_is_durable_before_post_and_answer_is_correlated(self):
        party = FakeParty()
        self.controller.party = party
        def inspect_reservation(*_):
            active = read_json(self.state / 'controller.json')['active']
            self.assertEqual(active['partyReservation']['reservationId'], 'reservation-one')
            self.assertIsNone(active['taskId'])
        self.backend.on_submit = inspect_reservation
        self.controller.tick()
        self.assertEqual(self.backend.submitted[0]['requestContext'], party.request_context())
        self.assertIn('Meet by the guild', self.backend.submitted[0]['prompt'])
        self.backend.reply = {'status': 'finished', 'result': {'status': 'completed', 'output': [
            {'role': 'assistant', 'type': 'message', 'status': 'completed',
             'content': [{'type': 'text', 'text': 'I will check the route.'}]}]}}
        self.controller.tick()
        self.assertEqual(party.calls[-1], ('answered', 'reservation-one', 'native-task-1', 'I will check the route.'))
        self.assertEqual(len(self.controller.data['decisions']), 1)

    def test_party_message_cannot_bypass_busy_body_or_planning_budget(self):
        party = FakeParty()
        self.controller.party = party
        self.gateway.body['task']['busy'] = True
        self.controller.tick()
        self.assertFalse(party.calls)
        self.gateway.body['task']['busy'] = False
        self.controller.data['decisions'] = [{'startedAt': self.clock()}] * 2
        self.controller.tick()
        self.assertFalse(party.calls)
        self.assertFalse(self.backend.submitted)

    def test_blocked_party_reservation_does_not_submit_or_charge_model_budget(self):
        party = FakeParty()
        party.blocked = True
        self.controller.party = party
        self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'party_wait')
        self.assertFalse(self.backend.submitted)
        self.assertFalse(self.controller.data['decisions'])
        self.assertEqual(read_json(self.state / 'lease.json')['status'], 'closed')

    def test_party_unknown_submission_is_not_repeated_on_restart(self):
        party = FakeParty()
        self.controller.party = party
        self.backend.on_submit = lambda *_: (_ for _ in ()).throw(TimeoutError())
        self.backend.cancel_error = ValueError('no task id')
        self.controller.tick()
        restarted = self.create()
        restarted.party = party
        restarted.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(party.calls, [('reserve', 'message-one')])
        self.assertIsNotNone(restarted.data['active']['partyReservation'])

    def test_known_failed_party_task_is_recorded_without_automatic_retry(self):
        party = FakeParty()
        self.controller.party = party
        self.controller.tick()
        self.backend.reply = {'status': 'finished', 'result': {'status': 'failed'}}
        self.controller.tick()
        self.assertEqual(party.calls[-1], ('failed', 'native-task-1', 'native_task_failed'))
        self.assertEqual(len(self.backend.submitted), 1)

    def test_iteration_limit_keeps_game_actions_but_never_sends_party_answer(self):
        party = FakeParty()
        self.controller.party = party
        self.controller.tick()
        turn = self.controller.data['active']['turnId']
        action = {'schema': 2, 'turnId': turn, 'actionId': 'a' * 32, 'tool': 'eat',
            'status': 'completed', 'completionConfirmed': True,
            'before': {'ok': True, 'counts': {'minecraft:bread': 1}},
            'after': {'ok': True, 'counts': {}}, 'result': {'ok': True, 'completionConfirmed': True}}
        self.gateway.turn_receipts = lambda _: [copy.deepcopy(action)]
        def message(text):
            return {'role': 'assistant', 'type': 'message', 'status': 'completed', 'metadata': None,
                    'content': [{'type': 'text', 'text': text}]}
        self.backend.reply = {'status': 'finished', 'result': {'status': 'completed', 'metadata': None,
            'session_id': self.controller.session['primarySessionId'],
            'output': [message('Earlier narration.'), message('Max iterations (6) reached')]}}
        self.controller.tick()
        self.assertEqual(party.calls[-1], ('failed', 'native-task-1', 'native_final_answer_missing'))
        self.assertFalse(any(call[0] == 'answered' for call in party.calls))
        self.assertIsNone(self.controller.data['active'])
        self.assertFalse(self.controller.data['lastDecision']['completed'])
        self.assertFalse(self.controller.data['lastDecision']['modelCompleted'])
        self.assertTrue(self.controller.data['lastDecision']['nativeTaskCompleted'])
        self.assertEqual(self.controller.data['lastDecision']['actions'][0]['actionId'], action['actionId'])
        self.assertEqual(len(self.controller.data['decisions']), 1)
        self.assertEqual(self.controller.data['failures'], 1)
        self.assertEqual(read_json(self.state / 'lease.json')['status'], 'closed')
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertNotIn('Max iterations', self.public.read_text())

    def test_completed_party_task_with_empty_final_fails_without_speech(self):
        party = FakeParty(); self.controller.party = party
        self.controller.tick()
        self.backend.reply = {'status': 'finished', 'result': {'status': 'completed', 'output': []}}
        self.controller.tick()
        self.assertEqual(party.calls[-1], ('failed', 'native-task-1', 'native_final_answer_missing'))
        self.assertFalse(party.allow_dispatch)

    def party_reply_waiting(self):
        party = FakeParty()
        party.delivery = {'settled': False, 'heard': False, 'status': 'unknown'}
        self.controller.party = party
        self.controller.tick()
        self.backend.reply = {'status': 'finished', 'result': {'status': 'completed', 'output': [
            {'role': 'assistant', 'type': 'message', 'status': 'completed',
             'content': [{'type': 'text', 'text': 'PRIVATE_UNHEARD_RESPONSE'}]}]}}
        self.controller.tick()
        return party

    def test_unheard_reply_holds_exact_task_without_repoll_or_duplicate_bookkeeping(self):
        party = self.party_reply_waiting()
        turn = self.controller.data['active']['turnId']
        reviews = self.controller.data['noActionReviews']
        self.backend.reply = AssertionError('Completed native task must not be read again')
        for _ in range(3):
            self.clock.now += 15
            self.controller.tick()
        self.assertEqual(self.controller.data['status'], 'party_reply_wait')
        self.assertEqual(self.controller.data['active']['turnId'], turn)
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(len(self.backend.polled), 1)
        self.assertEqual(len(self.controller.data['decisions']), 1)
        self.assertEqual(self.controller.data['noActionReviews'], reviews)
        self.assertEqual(sum(row['kind'] == 'decision_finished' for row in self.controller.data['episodes']), 1)
        self.assertFalse(self.controller.data['lastDecision']['completed'])
        self.assertTrue(self.controller.data['lastDecision']['modelCompleted'])
        self.assertEqual(read_json(self.state/'lease.json')['status'], 'closed')
        self.assertTrue(read_json(self.state/'control.json')['enabled'])
        self.assertNotIn('PRIVATE_UNHEARD_RESPONSE', self.public.read_text())
        self.assertNotIn('PRIVATE_UNHEARD_RESPONSE', (self.state/'episodes.jsonl').read_text())

    def test_cached_reply_reconciles_after_restart_only_when_game_heard(self):
        party = self.party_reply_waiting()
        restarted = self.create()
        restarted.party = party
        self.backend.reply = AssertionError('Do not repeat completed native read')
        restarted.tick()
        self.assertIsNotNone(restarted.data['active'])
        party.delivery = {'settled': True, 'heard': True, 'status': 'heard'}
        restarted.tick()
        self.assertIsNone(restarted.data['active'])
        self.assertTrue(restarted.data['lastDecision']['completed'])
        self.assertTrue(restarted.data['partyDelivery']['heard'])
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(len(self.backend.polled), 1)
        self.assertEqual(sum(row['kind'] == 'decision_finished' for row in restarted.data['episodes']), 1)
        self.assertEqual(sum(row['kind'] == 'party_reply_finished' for row in restarted.data['episodes']), 1)

    def test_physical_rejection_finishes_without_claiming_answer_success(self):
        party = self.party_reply_waiting()
        party.delivery = {'settled': True, 'heard': False, 'status': 'out_of_range'}
        self.controller.tick()
        self.assertIsNone(self.controller.data['active'])
        self.assertFalse(self.controller.data['lastDecision']['completed'])
        self.assertTrue(self.controller.data['lastDecision']['modelCompleted'])
        self.assertEqual(self.controller.data['partyDelivery']['status'], 'not_heard')
        event = next(row for row in self.controller.data['episodes'] if row['kind'] == 'party_reply_finished')
        self.assertFalse(event['completed'])
        self.assertEqual(len(self.backend.submitted), 1)

    def test_operator_pause_reconciles_reply_read_only_without_clearing_unknown(self):
        party = self.party_reply_waiting()
        self.controller.pause('operator_pause')
        self.controller.tick()
        self.assertEqual(party.allow_dispatch, [True, False])
        self.assertEqual(self.controller.data['status'], 'paused')
        self.assertEqual(self.controller.data['cancellationStatus'], 'waiting_for_party_delivery')
        self.assertIsNotNone(self.controller.data['active'])
        self.assertFalse(read_json(self.state/'control.json')['enabled'])
        self.assertFalse(self.backend.cancelled)
        self.assertEqual(len(self.backend.submitted), 1)
        party.delivery = {'settled': True, 'heard': True, 'status': 'heard'}
        self.controller.tick()
        self.assertEqual(party.allow_dispatch, [True, False, False])
        self.assertIsNone(self.controller.data['active'])
        self.assertFalse(read_json(self.state/'control.json')['enabled'])

    def test_invalid_heard_receipt_keeps_cache_and_does_not_claim_success(self):
        party = self.party_reply_waiting()
        party.delivery = {'settled': False, 'heard': True, 'status': 'invented'}
        self.controller.tick()
        self.assertEqual(self.controller.data['pauseReason'], 'party_answer_receipt_pending')
        self.assertIsNotNone(self.controller.data['active']['nativeTerminal'])
        self.assertFalse(self.controller.data['lastDecision']['completed'])
        self.assertEqual(len(self.backend.submitted), 1)

    def test_paused_native_task_keeps_lane_until_failure_receipt_is_settled(self):
        party = FakeParty()
        self.controller.party = party
        self.controller.tick()
        party.failed = lambda *a: {'settled': False, 'heard': False, 'status': 'pending'}
        self.controller.pause('operator_pause')
        self.controller.tick()
        self.assertIsNotNone(self.controller.data['active'])
        self.assertEqual(self.controller.data['active']['nativeTerminal']['failureReason'], 'native_task_stopped')
        self.assertEqual(self.controller.data['cancellationStatus'], 'waiting_for_party_delivery')
        self.assertEqual(len(self.backend.cancelled), 1)
        self.controller.tick()
        self.assertEqual(len(self.backend.cancelled), 1)
        self.assertIsNotNone(self.controller.data['active'])
        party.failed = lambda *a: {'settled': True, 'heard': False, 'status': 'failed'}
        self.controller.tick()
        self.assertIsNone(self.controller.data['active'])
        self.assertFalse(party.allow_dispatch)

    def test_real_party_queue_and_wrapper_require_world_receipt_across_restart(self):
        from party import SurvivorParty
        from party_messages import PartyMessages
        from types import SimpleNamespace
        owner, maid = str(uuid.uuid4()), str(uuid.uuid4())
        self.settings['ownerUuid'] = owner
        self.write('settings.json', self.settings)
        self.controller.settings = self.settings
        root = self.state.parent/'party'
        root.mkdir()
        config = {'schema': 1, 'enabled': True, 'partyId': 'life-integration', 'revision': 1, 'limits': {},
            'members': [dict(agentId='qd-survivor', kind='survivor', displayName='桐人',
                bodyUuid=self.settings['bodyUuid'], ownerUuid=owner,
                sessionId=self.controller.session['primarySessionId'], userId='survival-controller',
                channel='console', mcpToken='s'*48),
                dict(agentId='maid-test', kind='maid', displayName='队友', bodyUuid=maid,
                ownerUuid=self.settings['bodyUuid'], sessionId='maid-'+maid, userId='maid-'+maid,
                channel='console', mcpToken='m'*48)]}
        write_json(root/'binding.json', config)
        events, emitted, reads = {}, [], []
        heard = [False]
        def receipt(event, phase):
            at = int(self.clock()*1000)
            return {k: event[k] for k in ('eventId','speakerUuid','listenerUuid','textSha256','channel')} | {
                'schema': 1, 'ok': phase=='heard', 'heard': phase=='heard', 'phase': phase,
                'code': 'nearby_speech_heard' if phase=='heard' else 'outcome_unknown',
                'dimension': 'minecraft:overworld', 'speakerPosition': [0,64,0], 'listenerPosition': [2,64,0],
                'distance': 2, 'radius': 24, 'emittedAt': at if phase=='heard' else None, 'observedAt': at}
        def emit(event):
            emitted.append(event['eventId']); events[event['eventId']] = copy.deepcopy(event)
            return receipt(event, 'unknown')
        def observe(event_id):
            reads.append(event_id)
            return receipt(events[event_id], 'heard' if heard[0] else 'unknown')
        game = SimpleNamespace(emit=emit, status=observe)
        party = SurvivorParty(root, game=game)
        party._queue = PartyMessages(root, party.config.binding, clock=self.clock)
        row = party.queue.enqueue('maid-test', '一起查看营地。')
        self.assertIsNone(party.pending())
        self.assertIsNone(party.queue.get_status('qd-survivor',row['messageId'])['text'])
        event = party.queue.claim_world(row['messageId'])
        party.queue.record_world_receipt(event['eventId'], receipt(event,'heard'))
        self.controller.party = party
        original_submit = self.backend.submit
        def submit(*args, **kwargs):
            original_submit(*args, **kwargs)
            return 'task-123456abcdef'
        self.backend.submit = submit
        self.controller.tick()
        self.backend.reply = {'status': 'finished', 'result': {'status': 'completed', 'output': [
            {'role': 'assistant','type': 'message','status': 'completed',
             'content': [{'type': 'text','text': 'PRIVATE_UNHEARD_RESPONSE'}]}]}}
        self.controller.tick()
        self.assertEqual(len(emitted),1)
        self.assertIsNone(party.queue.get_status('maid-test',row['messageId'])['reply'])
        self.assertNotIn('PRIVATE_UNHEARD_RESPONSE',json.dumps(party.queue.overview('maid-test')))
        self.assertFalse(self.controller.data['lastDecision']['completed'])
        self.controller.pause('operator_pause')
        self.controller.tick()
        self.assertEqual(len(emitted),1)
        self.assertEqual(len(reads),1)
        restarted = self.create()
        restarted.party = SurvivorParty(root, game=game)
        restarted.party._queue = party.queue
        heard[0] = True
        restarted.tick()  # Still paused: only read a prior world event.
        self.assertIsNone(restarted.data['active'])
        self.assertEqual(len(emitted),1)
        self.assertEqual(len(self.backend.submitted),1)
        self.assertEqual(len(self.backend.polled),1)
        self.assertTrue(restarted.data['lastDecision']['completed'])
        final = party.queue.get_status('maid-test',row['messageId'])
        self.assertEqual(final['status'],'answered')
        self.assertEqual(final['reply']['text'],'PRIVATE_UNHEARD_RESPONSE')
        self.assertFalse(read_json(self.state/'control.json')['enabled'])

    def test_party_binding_is_checked_before_reading_and_again_before_model_post(self):
        party = FakeParty()
        checks = []
        def validate(session, settings, reservation=None):
            checks.append((copy.deepcopy(session), copy.deepcopy(settings), reservation))
            if reservation:
                raise ValueError('binding_changed_after_reservation')
        party.validate_session = validate
        self.controller.party = party
        self.controller.tick()
        self.assertEqual(len(checks), 2)
        self.assertIsNone(checks[0][2])
        self.assertEqual(checks[1][2]['reservationId'], 'reservation-one')
        self.assertEqual(checks[0][0]['bodyUuid'], self.settings['bodyUuid'])
        self.assertFalse(self.backend.submitted)
        self.assertEqual(self.controller.data['pauseReason'], 'model_submission_uncertain')

    def test_mismatched_party_session_cannot_reserve_or_call_model(self):
        party = FakeParty()
        party.validate_session = lambda *a, **k: (_ for _ in ()).throw(ValueError('party_session_mismatch'))
        self.controller.party = party
        with self.assertRaisesRegex(ValueError, 'party_session_mismatch'):
            self.controller.tick()
        self.assertFalse(party.calls)
        self.assertFalse(self.backend.submitted)
        self.assertFalse(self.controller.data['decisions'])

    def test_final_text_uses_only_last_completed_assistant_message(self):
        def message(text, **changes):
            return {'role': 'assistant', 'type': 'message', 'status': 'completed',
                    'content': [{'type': 'text', 'text': text}], **changes}
        value = {'status': 'completed', 'output': [message('Earlier step.'),
            message('SECRET reasoning', type='reasoning'), message('SECRET tool output', type='plugin_call_output'),
            message('SECRET progress', type='progress', role=None), message('unfinished', status='in_progress'),
            message('Final answer.') ]}
        self.assertEqual(final_text(value), 'Final answer.')
        value['status'] = 'failed'
        self.assertEqual(final_text(value), '')
        value = {'status': 'completed', 'output': [message('x' * 6001)]}
        self.assertEqual(final_text(value), '')

    def test_native_qwen_message_schema_round_trips_into_party_final_text(self):
        try:
            from qwenpaw.schemas import AgentResponse, Message
        except ImportError:
            self.skipTest('Native serialization verified inside the isolated Qwen image.')
        response = AgentResponse(status='completed', output=[
            Message(role='assistant', type='reasoning', status='completed', content=[{'type': 'text', 'text': 'private'}]),
            Message(role='assistant', type='message', status='completed', content=[{'type': 'text', 'text': 'Native final.'}])])
        self.assertEqual(final_text(response.model_dump(mode='json')), 'Native final.')
        response.output.append(Message(role='assistant', type='message', status='completed', metadata=None,
            content=[{'type': 'text', 'text': 'Max iterations (6) reached'}]))
        self.assertEqual(final_text(response.model_dump(mode='json')), '')

    def test_final_native_sentinel_never_falls_back_to_prior_narration(self):
        def message(text):
            return {'role': 'assistant', 'type': 'message', 'status': 'completed', 'metadata': None,
                    'content': [{'type': 'text', 'text': text}]}
        for text in ('Max iterations (6) reached', 'Max iterations (12) reached', '  Max iterations (4) reached\n', ''):
            self.assertEqual(final_text({'status': 'completed', 'metadata': None,
                'output': [message('Earlier narration'), message(text)]}), '')
        explanation = 'The log says Max iterations (6) reached; I will wait.'
        self.assertEqual(final_text({'status': 'completed', 'output': [message(explanation)]}), explanation)

    def test_per_action_observations_do_not_attribute_every_change_to_whole_turn(self):
        self.controller.tick()
        turn_id = self.controller.data['active']['turnId']
        rows = []
        for n, (before, after) in enumerate(((2, 3), (3, 5))):
            rows.append({'schema': 2, 'turnId': turn_id, 'actionId': str(n) * 32,
                'tool': 'craft', 'status': 'completed', 'completionConfirmed': True,
                'before': {'ok': True, 'counts': {'minecraft:stick': before}},
                'after': {'ok': True, 'counts': {'minecraft:stick': after}},
                'result': {'ok': True, 'completionConfirmed': True}})
        self.gateway.turn_receipts = lambda _: copy.deepcopy(rows)
        self.finish()
        self.assertEqual(len(self.controller.data['lastDecision']['actions']), 2)
        observed = [r for r in self.controller.data['episodes'] if r.get('actionId')]
        self.assertEqual([r['inventoryDelta']['minecraft:stick'] for r in observed], [1, 2])
        self.controller.collect_action_receipts(turn_id)
        self.assertEqual(len([r for r in self.controller.data['episodes'] if r.get('actionId')]), 2)


class ContinuousActionTests(unittest.TestCase):
    setUp = gateway_fixture.GatewayTests.setUp
    write = gateway_fixture.GatewayTests.write

    def lease(self):
        self.client.open_lease(TURN, NOW * 1000 + 120000, action_limit=6)

    def test_six_sync_actions_are_serial_and_each_has_distinct_before_after_receipt(self):
        self.lease()
        self.rcon.reply = {'success': True, 'data': {}}
        receipts = []
        for n in range(6):
            self.rcon.position['x'] = 100 + n
            result = self.client.action(TURN, 'craft', {'item_id': 'minecraft:stick', 'count': 1})
            self.assertTrue(result['completionConfirmed'])
            receipts.append(result['actionId'])
        self.assertEqual(len(set(receipts)), 6)
        self.assertEqual([r['before']['position']['x'] for r in self.client.turn_receipts(TURN)], list(range(100, 106)))
        self.assertFalse(self.client.action(TURN, 'craft', {'item_id': 'minecraft:stick', 'count': 1})['ok'])
        self.assertEqual(len(self.rcon.mutations()), 6)

    def test_async_move_requires_same_native_task_and_epoch_before_next_action(self):
        self.lease()
        first = self.client.action(TURN, 'goto', {'x': 110, 'z': 100})
        self.assertEqual(first['code'], 'accepted')
        self.rcon.busy = True
        self.assertEqual(self.client.action(TURN, 'eat', {'item_id': 'minecraft:bread'})['code'], 'body_action_in_flight')
        self.rcon.busy = False
        self.rcon.navigation_result = {'task_id': 'wrong', 'navigation_epoch': self.rcon.navigation_epoch,
                                       'state': 'success', 'success': True}
        self.assertEqual(self.client.action_status()['code'], 'navigation_terminal_unconfirmed')
        self.assertFalse(self.client.action(TURN, 'eat', {'item_id': 'minecraft:bread'})['ok'])
        self.rcon.navigation_result['task_id'] = 't1'
        self.rcon.navigation_result.update(state='failed', success=False)
        result = self.client.action_status()
        self.assertFalse(result['inFlight'])
        self.assertEqual(result['receipt']['status'], 'failed')
        self.assertTrue(result['receipt']['completionConfirmed'])
        self.rcon.reply = {'success': True}
        self.assertTrue(self.client.action(TURN, 'eat', {'item_id': 'minecraft:bread'})['ok'])
        self.assertEqual(len(self.rcon.mutations()), 2)

    def test_unknown_mutation_blocks_all_following_actions_and_survives_restart(self):
        from numen_gateway import NumenGateway
        self.lease()
        self.rcon.reply = TimeoutError()
        first = self.client.action(TURN, 'eat', {'item_id': 'minecraft:bread'})
        self.assertEqual(first['code'], 'outcome_unknown')
        client = NumenGateway(self.state, self.rcon, clock=lambda: NOW)
        self.assertFalse(client.action(TURN, 'eat', {'item_id': 'minecraft:bread'})['ok'])
        self.assertEqual(client.turn_receipts(TURN)[0]['status'], 'unknown')
        self.assertEqual(len(self.rcon.mutations()), 1)

    def test_async_mining_idle_records_ended_observation_not_goal_success(self):
        self.lease()
        self.client.action(TURN, 'mine', {'block_ids': ['minecraft:oak_log'], 'count': 1})
        receipt = self.client.action_status()['receipt']
        self.assertEqual(receipt['status'], 'observed_ended')
        self.assertFalse(receipt['completionConfirmed'])
        self.assertIsNone(receipt['navigationOutcome'])
        self.assertEqual(len(self.rcon.mutations()), 1)

    def test_new_native_epoch_does_not_clear_a_previous_move_barrier(self):
        self.lease()
        self.client.action(TURN, 'goto', {'x': 110, 'z': 100})
        self.rcon.navigation_epoch = 'different-server-process'
        self.assertEqual(self.client.action_status()['code'], 'inflight_epoch_changed')
        self.assertFalse(self.client.action(TURN, 'eat', {'item_id': 'minecraft:bread'})['ok'])
        self.assertEqual(len(self.rcon.mutations()), 1)

    def test_controller_observation_does_not_consume_receipt_before_model_reads_it(self):
        self.lease()
        self.client.action(TURN, 'goto', {'x': 110, 'z': 100})
        self.rcon.navigation_result = {'task_id': 't1', 'navigation_epoch': self.rcon.navigation_epoch,
                                      'state': 'success', 'success': True}
        first = self.client.action_status()['receipt']
        from mcp_server import read_status
        second = read_status(self.client)['actionExecution']['receipt']
        self.assertEqual(first['actionId'], second['actionId'])
        self.assertEqual(second['status'], 'completed')
        self.assertNotIn('turnId', second)
        self.assertEqual(len(self.rcon.mutations()), 1)


class BoundedStatusTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.waits = []
        self.snapshots = 0
        self.finish_at = None
        self.failed = False

    def snapshot(self):
        self.snapshots += 1
        return {'ok': True, 'task': {'busy': True}}

    def action_status(self, body):
        return {'ok': not self.failed, 'inFlight': self.finish_at is None or self.now < self.finish_at,
                'receipt': {'actionId': 'a', 'turnId': 'private-current-capability'}}

    def sleep(self, seconds):
        self.waits.append(seconds)
        self.now += seconds

    def read(self, seconds):
        from mcp_server import read_status
        return read_status(self, seconds, monotonic=lambda: self.now, sleep=self.sleep)

    def test_wait_is_bounded_to_ten_seconds_and_two_second_samples(self):
        result = self.read(10)
        self.assertTrue(result['actionExecution']['inFlight'])
        self.assertEqual(self.snapshots, 6)
        self.assertEqual(self.waits, [2] * 5)
        self.assertNotIn('turnId', result['actionExecution']['receipt'])

    def test_terminal_returns_early_and_unknown_never_busy_polls(self):
        self.finish_at = 2
        self.assertFalse(self.read(10)['actionExecution']['inFlight'])
        self.assertEqual(self.waits, [2])
        self.failed = True
        self.waits.clear()
        self.read(10)
        self.assertFalse(self.waits)

    def test_bad_wait_has_no_io_and_default_is_one_immediate_sample(self):
        for value in (-1, 11, float('nan'), float('inf'), True, None, '2'):
            self.assertEqual(self.read(value)['code'], 'invalid_wait_seconds')
        self.assertEqual(self.snapshots, 0)
        self.read(0)
        self.assertEqual(self.snapshots, 1)
        self.assertFalse(self.waits)


if __name__ == '__main__':
    unittest.main()
