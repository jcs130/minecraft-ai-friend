"""Incremental inputs are delivery transactions, not inferred model memory."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
from behavior_context import acknowledge, prepare, MAX_TURNS
from numen_gateway import read_json
import test_survival_life_session as life_tests


class BehaviorContextTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.life = {'bodyUuid': 'body-1', 'primarySessionId': 'life-' + 'a' * 32,
                     'userId': 'survival-controller', 'channel': 'console', 'agentId': 'qd-survivor'}
        self.memory = {'goal': 'Harvest wheat', 'nextFocus': 'Check mature crops'}
        self.context = {'turn_id': 'survival-' + '1' * 32, 'currentTime': '2026-09-20T01:00:00Z',
                        'wakeReason': 'world_changed', 'mission': 'Live autonomously',
                        'body': {'hp': 20, 'observedAt': 1000},
                        'perception': {'events': [{'id': 'event-1', 'text': 'rain'}]},
                        'recentActionReceipts': [{'actionId': 'a1', 'status': 'in_flight'}],
                        'instruction': 'long fixed instructions' * 100,
                        'planning': {'instruction': 'long planning guidance' * 100},
                        'resources': {'wheat': 3}, 'partyReplies': []}

    def prepare(self, **kw):
        return prepare(self.root, self.life, self.context, self.memory, **kw)

    def advance(self):
        self.context['turn_id'] = 'survival-' + '2' * 32
        self.context['body']['observedAt'] += 1000

    def test_same_behavior_is_incremental_after_ack(self):
        session, first, delivery = self.prepare()
        acknowledge(self.root, self.life, delivery)
        self.advance()
        second_session, second, _ = self.prepare()
        self.assertEqual(session, second_session)
        self.assertNotEqual(session['primarySessionId'], self.life['primarySessionId'])
        self.assertEqual(second['baseTurn'], first['turn_id'])
        self.assertEqual(second['updates'], {})
        self.assertEqual(second['events'], {})
        self.assertNotIn('instruction', second)
        self.assertEqual(second['body']['observedAt'], 2000)
        self.assertLess(len(json.dumps(first)), len(json.dumps(self.context)))

    def test_no_ack_repeats_evidence_and_bootstrap(self):
        a, first, _ = self.prepare()
        b, again, _ = self.prepare()
        self.assertEqual(a, b)
        self.assertEqual(first, again)
        self.assertIsNone(again['baseTurn'])

    def test_review_guidance_is_acknowledged_delta_not_repeated_action_prompt(self):
        self.context['review'] = {'id': 'review-one'}
        self.context['reviewGuidance'] = {'goalFile': 'memory/goals.md', 'instruction': 'Review actual receipts'}
        _, first, delivery = self.prepare()
        self.assertIn('reviewGuidance', first['updates'])
        acknowledge(self.root, self.life, delivery)
        self.advance()
        _, second, _ = self.prepare()
        self.assertNotIn('reviewGuidance', second['updates'])
        self.context.pop('review')
        self.context.pop('reviewGuidance')
        _, action, _ = self.prepare()
        self.assertNotIn('reviewGuidance', action['updates'])

    def test_changed_same_action_receipt_is_delivered(self):
        _, _, delivery = self.prepare()
        acknowledge(self.root, self.life, delivery)
        self.advance()
        self.context['recentActionReceipts'][0]['status'] = 'completed'
        _, value, _ = self.prepare()
        self.assertEqual(value['events']['receipts'][0]['status'], 'completed')

    def test_changed_and_removed_values_are_explicit(self):
        _, _, delivery = self.prepare()
        acknowledge(self.root, self.life, delivery)
        self.advance()
        self.context.pop('resources')
        self.context['nearby'] = None
        _, value, _ = self.prepare()
        self.assertIn('resources', value['removed'])
        self.assertIn('nearby', value['updates'])
        self.assertIsNone(value['updates']['nearby'])

    def test_behavior_change_new_session_keeps_life_identity(self):
        session, _, _ = self.prepare()
        original = copy.deepcopy(self.life)
        self.memory['goal'] = 'Craft a chest'
        other, value, _ = self.prepare()
        self.assertNotEqual(session['primarySessionId'], other['primarySessionId'])
        self.assertEqual(self.life, original)
        self.assertEqual(value['handoff']['goal'], 'Craft a chest')

    def test_review_learning_and_action_are_isolated(self):
        action, _, _ = self.prepare()
        learning, _, _ = self.prepare(learning=True)
        self.context['review'] = {'id': 'r1'}
        review, _, _ = self.prepare()
        self.context.pop('review')
        resumed, _, _ = self.prepare()
        self.assertEqual(action, resumed)
        self.assertEqual(len({x['primarySessionId'] for x in (action, learning, review)}), 3)

    def test_dialogue_preserves_registered_party_address(self):
        self.context['partyMessage'] = {'messageId': 'm1', 'text': 'hello'}
        session, value, _ = self.prepare(learning=True)
        self.assertEqual(session['primarySessionId'], self.life['primarySessionId'])
        self.assertEqual(value['purpose'], 'dialogue')

    def test_ack_is_idempotent_and_stale_ack_cannot_advance(self):
        _, _, first = self.prepare()
        acknowledge(self.root, self.life, first)
        acknowledge(self.root, self.life, first)
        self.advance()
        _, _, second = self.prepare()
        acknowledge(self.root, self.life, second)
        with self.assertRaisesRegex(ValueError, 'out_of_order'):
            acknowledge(self.root, self.life, first)
        self.assertEqual(read_json(self.root / 'behavior-context.json')['lanes']['action']['turns'], 2)

    def test_death_rotates_behavior_without_reusing_previous_context(self):
        session, _, delivery = self.prepare()
        acknowledge(self.root, self.life, delivery)
        self.life['primarySessionId'] = 'life-' + 'b' * 32
        other, value, _ = self.prepare()
        self.assertNotEqual(session['primarySessionId'], other['primarySessionId'])
        self.assertIsNone(value['baseTurn'])

    def test_bounded_session_handoff_does_not_reset_caller_state(self):
        first, _, _ = self.prepare()
        for i in range(MAX_TURNS):
            self.context['turn_id'] = 'survival-' + format(i, '032x')
            _, _, delivery = self.prepare()
            acknowledge(self.root, self.life, delivery)
        other, value, _ = self.prepare()
        self.assertNotEqual(first['primarySessionId'], other['primarySessionId'])
        self.assertIn('handoff', value)

    def test_body_rebinding_is_rejected(self):
        self.prepare()
        self.life['bodyUuid'] = 'another-body'
        with self.assertRaisesRegex(ValueError, 'binding_invalid'):
            self.prepare()

    def test_context_and_memory_not_mutated_or_duplicated_on_disk(self):
        before = copy.deepcopy(self.context)
        _, _, delivery = self.prepare()
        acknowledge(self.root, self.life, delivery)
        self.assertEqual(before, self.context)
        saved = (self.root / 'behavior-context.json').read_text(encoding='utf-8')
        self.assertNotIn('long fixed instructions', saved)
        self.assertNotIn('rain', saved)


class BehaviorControllerTests(unittest.TestCase):
    setUp = life_tests.LifeSessionTests.setUp
    create = life_tests.LifeSessionTests.create
    write = life_tests.LifeSessionTests.write
    finish = life_tests.LifeSessionTests.finish

    def test_controller_submits_incremental_native_session_after_completion(self):
        self.controller.settings['contextProtocol'] = 2
        self.controller.tick()
        first = self.backend.submitted[-1]
        envelope = json.loads(first['prompt'].split('\n', 1)[1])
        self.assertEqual(envelope['contextProtocol'], 2)
        self.assertEqual(envelope['sessionId'], first['session']['primarySessionId'])
        self.assertNotEqual(envelope['sessionId'], self.controller.session['primarySessionId'])
        self.finish()
        self.clock.now += 121
        self.gateway.body['hunger'] = 12
        self.controller.tick()
        second = self.backend.submitted[-1]
        delta = json.loads(second['prompt'].split('\n', 1)[1])
        self.assertEqual(first['session']['primarySessionId'], second['session']['primarySessionId'])
        self.assertEqual(delta['baseTurn'], first['turnId'])
        self.assertNotIn('instruction', delta)
        self.assertEqual(delta['body']['hunger'], 12)

    def test_failed_model_request_does_not_ack_context(self):
        self.controller.settings['contextProtocol'] = 2
        self.controller.tick()
        self.backend.reply = {'status': 'failed', 'result': {'status': 'failed'}}
        self.controller.tick()
        state = read_json(self.state / 'behavior-context.json')
        self.assertTrue(all('ackTurn' not in lane for lane in state['lanes'].values()))

    def test_reserved_submission_is_not_replayed_after_restart(self):
        self.settings['contextProtocol'] = 2
        self.write('settings.json', self.settings)
        self.controller = self.create()
        self.backend.on_submit = lambda *_: (_ for _ in ()).throw(SystemExit())
        with self.assertRaises(SystemExit):
            self.controller.tick()
        before = self.controller.data['active']['sessionId']
        restarted = self.create()
        self.assertEqual(restarted.data['active']['sessionId'], before)
        self.assertEqual(len(self.backend.submitted), 1)
        self.assertEqual(restarted.data['pauseReason'], 'interrupted_model_task')


if __name__ == '__main__':
    unittest.main()
