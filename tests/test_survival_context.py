"""Working-memory retrieval bounds and event acknowledgement use real context code."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_survival_controller as fixtures


class ContextTests(unittest.TestCase):
    setUp = fixtures.ControllerTests.setUp
    create = fixtures.ControllerTests.create
    write = fixtures.ControllerTests.write

    def test_full_valid_memory_does_not_pause_or_fill_prompt(self):
        row = {'goal': '目标' * 500, 'lesson': '经验' * 500, 'nextFocus': '下一步' * 333}
        self.write('memory.json', {**row, 'history': [row] * 16})
        self.controller.data['wakeReason'] = 'new_mission'
        context = self.controller.planning_context(self.gateway.body, {}, 'turn')
        self.assertLessEqual(len(json.dumps(context, ensure_ascii=False)), 19500)
        self.assertNotIn('history', context['memory'])
        self.assertEqual(len(context['memory']['recentLessons']), 2)
        self.assertEqual(context['body']['counts'], self.gateway.body['counts'])
        self.assertEqual(context['mission'], self.settings['mission'])

    def test_only_events_delivered_in_context_can_be_acknowledged(self):
        events = [{'id': str(n), 'text': 'public observation'} for n in range(12)]
        self.controller.awareness = {'events': events, 'pendingEventIds': [r['id'] for r in events]}
        self.controller.data['wakeReason'] = 'world_event'
        context = self.controller.planning_context(self.gateway.body, {}, 'turn')
        self.assertEqual(context['perception']['pendingEventIds'], [str(n) for n in range(6)])
        self.assertEqual(len(self.controller.awareness['events']), 12)

    def test_rejected_action_feedback_survives_between_native_sessions(self):
        self.controller.data['wakeReason'] = 'world_event'
        self.controller.data['lastDecision'] = {'actions': [{'tool': 'craft', 'result': {
            'ok': False, 'code': 'action_rejected', 'result': {'success': False,
            'message': 'Recipe requires a crafting table within reach.'}}}]}
        context = self.controller.planning_context(self.gateway.body, {}, 'turn')
        self.assertEqual(context['lastActionReceipt']['code'], 'action_rejected')
        self.assertIn('crafting table', context['lastActionReceipt']['message'])
        self.assertFalse(context['lastActionReceipt']['completionConfirmed'])

    def test_missing_native_tools_never_spends_a_model_reservation(self):
        with patch.dict('os.environ', {'SURVIVOR_QWEN_MODE': 'external'}), \
             patch.dict('sys.modules', {'native_tools': SimpleNamespace(require_ready=lambda: False)}):
            self.controller.submit_model(self.gateway.body, {})
        self.assertEqual(self.controller.data['status'], 'waiting_for_tools')
        self.assertEqual(self.controller.data['decisions'], [])
        self.assertIsNone(self.controller.data['active'])
        self.assertEqual(self.gateway.opened, [])
        self.assertEqual(self.backend.submitted, [])
        self.assertTrue(self.controller.root.joinpath('control.json').exists())

    def test_new_book_identity_wakes_without_equipment_slot_churn(self):
        body = self.gateway.body
        body['skillBooks'] = [{'bookName': '羽落之靴', 'count': 1, 'slot': 0}]
        original = self.controller.decision_signature(body, {})
        body['skillBooks'][0]['slot'] = 9
        self.assertEqual(self.controller.decision_signature(body, {}), original)
        body['skillBooks'][0]['bookName'] = '生命泉水'
        self.assertNotEqual(self.controller.decision_signature(body, {}), original)

    def test_repeated_unchanged_action_observation_is_not_a_new_fact(self):
        outcome = {'kind': 'action_observed', 'action': 'craft', 'inventoryDelta': {}, 'at': 'first'}
        self.controller.data['episodes'] = [outcome]
        original = self.controller.decision_signature(self.gateway.body, {})
        self.controller.data['episodes'].append({**outcome, 'at': 'later'})
        self.assertEqual(self.controller.decision_signature(self.gateway.body, {}), original)
        self.controller.data['episodes'][-1]['inventoryDelta'] = {'minecraft:iron_sword': 1}
        self.assertNotEqual(self.controller.decision_signature(self.gateway.body, {}), original)

    def test_large_catalog_and_public_board_are_retrievable_without_discarding_goal(self):
        self.controller.data['wakeReason'] = 'world_event'
        self.controller.awareness = {'world': {'quests': ['任务' * 1000] * 30},
            'events': [{'id': 'pending', 'text': '真实聊天'}], 'pendingEventIds': ['pending']}
        self.skills.catalog = lambda: {'skills': [{'name': 'skill_' + str(n),
            'description': '动作经验' * 1000, 'activeVersion': 'a' * 64} for n in range(100)]}
        context = self.controller.planning_context(self.gateway.body, {'mission': '继续自主生活'}, 'turn')
        self.assertLessEqual(len(json.dumps(context, ensure_ascii=False)), 19500)
        self.assertEqual(context['mission'], '继续自主生活')
        self.assertEqual(context['body']['position'], self.gateway.body['position'])
        self.assertTrue(context['contextTrimmed'])
        self.assertEqual(context['perception']['pendingEventIds'], ['pending'])


if __name__ == '__main__':
    unittest.main()
