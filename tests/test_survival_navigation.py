"""Real native navigation receipts must match task and server generation.

All worlds, RCON and model APIs are fixtures; nothing contacts the live server.
"""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'world/survival'))
from controller import Controller
from numen_gateway import NumenGateway, read_json, write_json

NOW = 1800000000
BODY_UUID = 'd4ac9523-4962-43ed-98c5-19b49e104048'
EPOCH = 'dfab5ecd-e1e2-4d92-9739-23686c40d53e'
OTHER_EPOCH = 'fa7bb32f-5998-4587-b567-21bdf28104ee'
TASK = 't123'


class NoLiveGateway:
    def __init__(self):
        self.actions = []

    def open_lease(self, *args, **kwargs):
        return {}

    def close_lease(self, *args, **kwargs):
        return {'ok': True}

    def action(self, turn, tool, arguments):
        self.actions.append((turn, tool, arguments))
        return {'ok': True, 'code': 'accepted', 'result': {
            'success': True, 'data': {'task_id': TASK, 'async': True}}}


class NoLiveBackend:
    def poll(self, task):
        return {'status': 'completed', 'result': {'status': 'completed'}}


class NavigationReceiptTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.state = self.root/'state'
        self.state.mkdir()
        write_json(self.state/'settings.json', {'schema': 1, 'bodyName': 'Kirito',
            'bodyUuid': BODY_UUID, 'mission': 'Explore', 'taskTimeoutSeconds': 240,
            'maxSkillSteps': 32, 'maxSkillSeconds': 900})
        write_json(self.state/'control.json', {'schema': 1, 'enabled': True, 'mission': 'Explore'})
        self.gateway = NoLiveGateway()
        self.controller = Controller(self.state, self.root/'public/survivor.json',
            gateway=self.gateway, backend=NoLiveBackend(), clock=lambda: NOW)
        self.before = {'ok': True, 'bodyUuid': BODY_UUID, 'hp': 20, 'hunger': 18,
            'position': {'x': 100.0, 'y': 70.0, 'z': 100.0},
            'counts': {'minecraft:bread': 3}, 'dimension': 'minecraft:overworld',
            'navigationEpoch': EPOCH, 'task': {'busy': False}}
        self.after = copy.deepcopy(self.before)
        self.after['position'] = {'x': 105.0, 'y': 70.0, 'z': 100.0}
        self.after['navigationResult'] = self.receipt()
        self.pending()

    def receipt(self, state='success', **updates):
        return {'task_id': TASK, 'navigation_epoch': EPOCH, 'state': state,
            'success': state == 'success', 'navigation_mode': 'walk_only_v1',
            'world_interaction_blocked': False, 'reason': 'destination reached',
            'final_x': 105.0, 'final_y': 70.0, 'final_z': 100.0, 'ground_y': 70,
            'finished_at': NOW*1000, **updates}

    def pending(self, **updates):
        self.controller.data['observeAction'] = {'action': 'goto', 'before': copy.deepcopy(self.before),
            'nativeTaskId': TASK, 'navigationEpoch': EPOCH, **updates}
        self.controller.save()

    def finish(self):
        self.controller.finish_action_observation(self.after)
        return self.controller.data['episodes'][-1]

    def test_matching_success_and_actual_position_are_recorded_once(self):
        event = self.finish()
        self.assertEqual(event['navigationOutcome'], self.receipt())
        self.assertTrue(event['navigationOutcome']['success'])
        self.assertEqual(event['positionBefore'], self.before['position'])
        self.assertEqual(event['positionAfter'], self.after['position'])
        self.assertEqual(event['inventoryDelta'], {})
        self.assertIsNone(read_json(self.state/'controller.json')['observeAction'])
        self.controller.finish_action_observation(self.after)
        self.assertEqual(len(self.controller.data['episodes']), 1)
        self.assertFalse(self.gateway.actions)

    def test_matching_failure_keeps_partial_position_and_failure_reason(self):
        self.after['navigationResult'] = self.receipt('failed', reason='wall blocks strict route',
            final_x=102.0, world_interaction_blocked=True)
        self.after.update(position={'x': 102.2, 'y': 70.0, 'z': 100.0}, hp=18.5, hunger=17)
        event = self.finish()
        self.assertFalse(event['navigationOutcome']['success'])
        self.assertEqual(event['navigationOutcome']['state'], 'failed')
        self.assertEqual(event['navigationOutcome']['reason'], 'wall blocks strict route')
        self.assertEqual(event['navigationOutcome']['final_x'], 102.0)
        self.assertEqual(event['positionAfter']['x'], 102.2)
        self.assertEqual(event['hp'], 18.5)
        self.assertEqual(event['hunger'], 17)

    def test_cancel_and_timeout_are_never_promoted_to_success(self):
        for state in ('timeout', 'cancelled'):
            with self.subTest(state=state):
                self.pending()
                self.after['navigationResult'] = self.receipt(state)
                outcome = self.finish()['navigationOutcome']
                self.assertEqual(outcome['state'], state)
                self.assertFalse(outcome['success'])

    def test_same_task_id_from_old_server_epoch_is_not_a_match(self):
        self.after['navigationResult'] = self.receipt(navigation_epoch=OTHER_EPOCH)
        self.assertIsNone(self.finish()['navigationOutcome'])

    def test_changed_current_server_epoch_rejects_even_matching_cached_receipt(self):
        self.after['navigationEpoch'] = OTHER_EPOCH
        self.assertIsNone(self.finish()['navigationOutcome'])

    def test_different_native_task_id_in_same_epoch_is_not_a_match(self):
        self.after['navigationResult'] = self.receipt(task_id='t124')
        self.assertIsNone(self.finish()['navigationOutcome'])

    def test_missing_reserved_identity_does_not_infer_success(self):
        for fields in ({'nativeTaskId': None}, {'navigationEpoch': None}):
            with self.subTest(fields=fields):
                self.pending(**fields)
                self.assertIsNone(self.finish()['navigationOutcome'])

    def test_idle_without_a_receipt_records_observation_only(self):
        self.after['navigationResult'] = None
        self.after['counts'] = {'minecraft:bread': 2}
        event = self.finish()
        self.assertIsNone(event['navigationOutcome'])
        self.assertEqual(event['inventoryDelta'], {'minecraft:bread': -1})
        self.assertIn('not a blanket task-success assertion', event['notice'])

    def test_other_action_cannot_claim_a_matching_old_navigation_receipt(self):
        self.pending(action='eat')
        self.assertIsNone(self.finish()['navigationOutcome'])

    def test_busy_task_preserves_pending_observation_even_with_cached_success(self):
        self.after['task']['busy'] = True
        self.controller.finish_action_observation(self.after)
        self.assertFalse(self.controller.data['episodes'])
        self.assertEqual(self.controller.data['observeAction']['nativeTaskId'], TASK)
        self.assertFalse(self.gateway.actions)

    def test_pending_identity_survives_controller_restart(self):
        self.controller = Controller(self.state, self.root/'public/survivor.json',
            gateway=self.gateway, backend=NoLiveBackend(), clock=lambda: NOW)
        self.assertEqual(self.finish()['navigationOutcome']['task_id'], TASK)
        self.assertFalse(self.gateway.actions)

    def test_direct_action_captures_native_identity_from_response_journal(self):
        turn = 'survival-unit-navigation'
        self.controller.data['active'] = {'turnId': turn, 'startedAt': NOW,
            'taskId': 'model-task', 'before': copy.deepcopy(self.before), 'mission': 'Explore'}
        result = {'ok': True, 'code': 'accepted', 'result': {
            'success': True, 'data': {'task_id': TASK, 'async': True}}}
        (self.state/'actions.jsonl').write_text(json.dumps({'turnId': turn,
            'phase': 'response', 'tool': 'goto', 'result': result})+'\n', encoding='utf8')
        self.controller.poll_model(self.after)
        pending = self.controller.data['observeAction']
        self.assertEqual(pending['nativeTaskId'], TASK)
        self.assertEqual(pending['navigationEpoch'], EPOCH)
        self.assertTrue(self.finish()['navigationOutcome']['success'])

    def test_programmed_action_captures_native_identity_before_next_observation(self):
        class Skills:
            def run(self, *args):
                return {'action': {'tool': 'goto', 'args': {'x': 105, 'z': 100}}, 'memory': {}}
        self.controller.skills = Skills()
        self.controller.cached_game_skills = lambda: {}
        write_json(self.state/'skill-job.json', {'schema': 1, 'name': 'walk_nearby',
            'version': 'a'*64, 'status': 'pending', 'memory': {}, 'maxSteps': 2})
        self.assertTrue(self.controller.tick_skill(self.before))
        pending = self.controller.data['observeAction']
        self.assertEqual(pending['nativeTaskId'], TASK)
        self.assertEqual(pending['navigationEpoch'], EPOCH)
        self.assertEqual(len(self.gateway.actions), 1)
        self.assertTrue(self.finish()['navigationOutcome']['success'])

    def test_finishing_between_rcon_reads_cannot_consume_an_old_receipt(self):
        receipt = self.receipt()
        class BoundaryRcon:
            finished = False
            def cmd(self, command):
                if command == 'numen_act list':
                    return 'Kirito|uuid='+BODY_UUID
                if ' task_status ' in command:
                    busy = not self.finished
                    self.finished = True  # Native task can end between consecutive read commands.
                    return json.dumps({'success': True, 'data': {'task_id': TASK} if busy else {}})
                if ' get_self_status ' in command:
                    result = {'name': 'Kirito', 'hp': 20, 'max_hp': 20, 'hunger': 18,
                        'position': {'x': 105 if self.finished else 100, 'y': 70, 'z': 100},
                        'game_mode': 'survival', 'dimension': 'minecraft:overworld',
                        'navigation_epoch': EPOCH,
                        'last_navigation_result': receipt if self.finished else None}
                    self.finished = True
                    return json.dumps(result)
                if command == 'data get entity Kirito Inventory':
                    return '[]'
                raise AssertionError('Unexpected command: '+command)
        client = NumenGateway(self.state, BoundaryRcon(), clock=lambda: NOW)
        with patch('numen_gateway.inventory_from_snbt', return_value=([], {})):
            first = client.snapshot()
            self.controller.finish_action_observation(first)
            # Either the snapshot already contains the matching receipt, or it
            # must retain pending work until the next coherent snapshot.
            if self.controller.data['observeAction'] is None:
                self.assertIsNotNone(self.controller.data['episodes'][-1]['navigationOutcome'])
            else:
                self.controller.finish_action_observation(client.snapshot())
            self.assertTrue(self.controller.data['episodes'][-1]['navigationOutcome']['success'])
            self.assertEqual(self.controller.data['episodes'][-1]['positionAfter']['x'], 105)


if __name__ == '__main__':
    unittest.main()
