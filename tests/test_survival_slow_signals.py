"""Slow planner signals keep fast observations exact, without live model/game I/O."""
import copy
import json
import unittest

import test_survival_controller as fixtures
from perception import WorldPerception, slow_vitals


class SlowSignals(unittest.TestCase):
    setUp = fixtures.ControllerTests.setUp
    create = fixtures.ControllerTests.create
    write = fixtures.ControllerTests.write
    finish_no_action_decision = fixtures.ControllerTests.finish_no_action_decision

    def hearing(self):
        self.world = self.state.parent / 'observations'
        self.world.mkdir(exist_ok=True)
        self.reader = WorldPerception(self.state, self.world, self.public.parent, clock=self.clock)
        self.controller.perception = self.reader
        return self.reader

    def chat(self, text, **fields):
        with (self.world / 'player-chat.jsonl').open('a', encoding='utf-8') as stream:
            stream.write(json.dumps({'ts': self.clock() * 1000, 'user': 'Player', 'text': text, **fields}) + '\n')

    def finish(self):
        self.backend.reply = {'status': 'finished', 'result': {'status': 'completed', 'output': [{'role': 'assistant', 'type': 'message', 'status': 'completed', 'content': [{'type': 'text', 'text': 'Fixture final answer.'}]}]}}
        self.controller.tick()

    def advance(self, seconds=121):
        self.clock.now += seconds
        self.controller.tick()

    def test_small_healing_and_food_changes_preserve_exact_body_without_buying_turns(self):
        self.hearing()
        self.finish_no_action_decision()
        for hp, hunger in ((19.5, 17), (20, 18), (19, 16), (20, 19)):
            self.gateway.body.update(hp=hp, hunger=hunger)
            self.advance()
            self.assertEqual(len(self.backend.submitted), 1)
            self.assertEqual(self.controller.last_body['hp'], hp)
            self.assertEqual(self.controller.last_body['hunger'], hunger)
        self.assertTrue(self.reader.data['pending'])  # Small damage remains observable.
        self.assertEqual(self.reader.data['view']['pendingWakeEventIds'], [])

    def test_recovery_hysteresis_prevents_repeated_threshold_flips(self):
        self.gateway.body.update(hp=16, hunger=13)
        self.hearing()
        self.finish_no_action_decision()
        for hp, hunger in ((17.9, 14), (18.1, 15), (19, 16), (17.8, 14)):
            self.gateway.body.update(hp=hp, hunger=hunger)
            self.advance()
            self.assertEqual(len(self.backend.submitted), 1)
        self.gateway.body.update(hp=20, hunger=18)
        self.advance()
        self.assertEqual(len(self.backend.submitted), 2)

    def test_critical_damage_wakes_after_cooldown_and_further_small_hits_are_batched(self):
        self.controller.settings['decisionsPerDay'] = 8
        self.hearing()
        self.finish_no_action_decision()
        self.gateway.body['hp'] = 6
        self.controller.tick()
        self.assertEqual(len(self.backend.submitted), 1)
        self.advance()
        self.assertEqual(len(self.backend.submitted), 2)
        prompt = json.loads(self.backend.submitted[-1]['prompt'].split('\n', 1)[1])
        self.assertEqual(prompt['body']['hp'], 6)
        self.assertTrue(any(row.get('requiresReview') for row in prompt['perception']['events']))
        self.finish()
        for hp in (5.75, 5.5, 5.25):
            self.gateway.body['hp'] = hp
            self.advance()
        self.assertEqual(len(self.backend.submitted), 2)
        self.assertFalse(self.gateway.actions)

    def test_real_food_shortage_still_wakes_and_raw_counts_remain_meaningful(self):
        self.finish_no_action_decision()
        self.gateway.body['hunger'] = 12
        self.advance()
        self.assertEqual(len(self.backend.submitted), 2)
        signal = self.controller.decision_signature(self.gateway.body, {})
        self.gateway.body['counts']['minecraft:bread'] += 1
        self.assertNotEqual(self.controller.decision_signature(self.gateway.body, {}), signal)

    def test_ambient_flood_and_environment_edges_wait_but_direct_message_is_first(self):
        self.hearing()
        weather = {'ok': True, 'world': {'weather': 'clear'}, 'hostiles': []}
        self.gateway.observe = lambda radius: copy.deepcopy(weather)
        self.finish_no_action_decision()
        for n in range(40):
            self.chat('unaddressed conversation ' + str(n))
        for n in range(5):
            weather['world']['weather'] = 'rain' if n % 2 else 'clear'
            weather['hostiles'] = [{'type': 'minecraft:zombie'}] if n % 2 else []
            self.advance()
        self.assertEqual(len(self.backend.submitted), 1)
        self.chat('桐人，请帮我检查仓库。')
        self.advance()
        self.assertEqual(len(self.backend.submitted), 2)
        prompt = json.loads(self.backend.submitted[-1]['prompt'].split('\n', 1)[1])
        self.assertEqual(prompt['perception']['events'][0]['text'], '桐人，请帮我检查仓库。')
        self.finish()
        self.assertTrue(self.reader.data['pending'])
        self.assertEqual(self.reader.data['view']['pendingWakeEventIds'], [])
        self.advance()
        self.assertEqual(len(self.backend.submitted), 2)

    def test_direct_messages_arriving_during_thinking_are_not_acknowledged_early(self):
        self.hearing()
        self.chat('Kirito, inspect the storage first.')
        self.controller.tick()
        delivered = self.controller.data['active']['eventIds'][:]
        self.chat('桐人，然后告诉我缺什么。')
        self.finish()
        pending = self.reader.data['pending']
        self.assertTrue(pending)
        self.assertTrue(all(row['id'] not in delivered for row in pending))
        self.assertIn('然后', pending[0]['text'])
        self.advance()
        self.assertEqual(len(self.backend.submitted), 2)
        self.assertIn('然后告诉我缺什么', self.backend.submitted[-1]['prompt'])

    def test_failed_model_does_not_acknowledge_received_instructions(self):
        self.hearing()
        self.chat('桐人，报告当前物资。')
        self.controller.tick()
        delivered = self.controller.data['active']['eventIds'][:]
        self.backend.reply = {'status': 'failed', 'result': {'status': 'failed'}}
        self.controller.tick()
        self.assertEqual([row['id'] for row in self.reader.data['pending']], delivered)

    def test_large_receipt_cannot_trim_the_addressed_instruction_or_ack_ambient_overflow(self):
        events = [{'id': str(n), 'kind': 'chat', 'text': 'ambient', 'addressed': False} for n in range(12)]
        events.append({'id': 'direct', 'kind': 'chat', 'text': '桐人，先检查补给。', 'addressed': True, 'trusted': False})
        self.controller.awareness = {'events': events, 'pendingEventIds': [row['id'] for row in events]}
        self.controller.data['episodes'] = [{'kind': 'historical_receipt', 'details': 'x' * 19500}]
        self.controller.data['wakeReason'] = 'world_or_goal_changed'
        context = self.controller.planning_context(self.gateway.body, {}, 'turn')
        self.assertTrue(context['contextTrimmed'])
        self.assertLessEqual(len(json.dumps(context, ensure_ascii=False)), 19500)
        self.assertEqual(context['perception']['pendingEventIds'], ['direct'])
        self.assertEqual(context['perception']['events'][0]['text'], events[-1]['text'])
        self.assertEqual(self.controller.awareness['events'], events)

    def test_environment_noise_cannot_evict_a_queued_direct_message(self):
        self.hearing()
        self.chat('桐人，等我回来。')
        self.reader.poll(self.gateway.body)
        for n in range(70):
            self.reader._enqueue({'kind': 'environment_changed', 'at': n, 'conditions': {'weather': str(n)}})
        view = self.reader.poll(self.gateway.body)
        self.assertLessEqual(view['pendingCount'], 32)
        self.assertTrue(view['events'][0]['addressed'])
        self.assertEqual(view['pendingWakeEventIds'], [view['events'][0]['id']])

    def test_repeat_failed_navigation_ignores_correlation_ids_but_keeps_raw_evidence(self):
        outcome = {'kind': 'action_observed', 'action': 'goto', 'at': 'first', 'hp': 18,
            'positionBefore': {'x': 100.1}, 'positionAfter': {'x': 100.2}, 'inventoryDelta': {},
            # Exact snake_case schema emitted by WalkOnlyNavigation.recordResult.
            'navigationOutcome': {'task_id': 't1', 'navigation_epoch': 'epoch-1', 'state': 'failed',
                'success': False, 'finished_at': 100, 'final_x': 100.2, 'final_y': 64, 'final_z': 100,
                'ground_y': 64, 'requested_y': 64, 'reason': 'no safe path'}}
        self.controller.data['episodes'] = [outcome]
        before = copy.deepcopy(outcome)
        signal = self.controller.decision_signature(self.gateway.body, {})
        self.assertEqual(outcome, before)
        repeated = copy.deepcopy(outcome)
        repeated.update(at='later', hp=18.5, positionAfter={'x': 100.3})
        repeated['navigationOutcome'].update(task_id='t77', navigation_epoch='epoch-2', finished_at=999,
                                             final_x=100.3)
        self.controller.data['episodes'].append(repeated)
        self.assertEqual(self.controller.decision_signature(self.gateway.body, {}), signal)
        self.assertEqual(self.controller.data['episodes'][-1], repeated)
        repeated['navigationOutcome']['requested_y'] = 68
        self.assertNotEqual(self.controller.decision_signature(self.gateway.body, {}), signal)

    def test_ambient_messages_arriving_during_thinking_wait_for_periodic_review(self):
        self.write('control.json', {'schema': 1, 'enabled': True, 'autonomous': True})
        self.controller.settings['autonomyReviewSeconds'] = 1800
        self.hearing()
        self.controller.tick()
        self.chat('Ordinary public conversation.')
        self.finish()
        self.advance(600)
        self.assertEqual(len(self.backend.submitted), 1)
        self.advance(1201)
        self.assertEqual(len(self.backend.submitted), 2)
        self.assertEqual(self.controller.data['wakeReason'], 'autonomous_review')
        self.assertIn('Ordinary public conversation.', self.backend.submitted[-1]['prompt'])

    def test_vital_baseline_and_pending_priorities_survive_restart_without_budget_reset(self):
        self.gateway.body.update(hp=16, hunger=13)
        self.hearing()
        self.finish_no_action_decision()
        baseline = copy.deepcopy(self.controller.data['slowVitalBaseline'])
        decisions = copy.deepcopy(self.controller.data['decisions'])
        self.chat('quiet ambient message')
        self.controller.tick()
        self.controller = self.create()
        self.hearing()
        self.gateway.body.update(hp=18.2, hunger=15)
        self.advance()
        self.assertEqual(self.controller.data['slowVitalBaseline'], baseline)
        self.assertEqual(self.controller.data['decisions'], decisions)
        self.assertEqual(len(self.backend.submitted), 1)

    def test_migration_preserves_unacknowledged_legacy_direct_and_serious_damage(self):
        self.hearing()
        self.reader.data['pending'] = [
            {'id': 'direct', 'kind': 'system', 'addressed': True, 'text': 'preserved request'},
            {'id': 'damage', 'kind': 'damage_observed', 'beforeHp': 20, 'afterHp': 5},
            {'id': 'minor', 'kind': 'damage_observed', 'beforeHp': 20, 'afterHp': 19.5},
        ]
        view = self.reader.poll(self.gateway.body)
        self.assertEqual(view['pendingWakeEventIds'], ['direct', 'damage'])
        self.assertEqual(view['pendingCount'], 3)
        self.assertEqual(slow_vitals({'hp': None, 'hunger': None})['health'], 'unknown')


if __name__ == '__main__':
    unittest.main()
