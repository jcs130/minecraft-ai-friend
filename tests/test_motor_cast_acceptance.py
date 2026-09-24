"""Confirmed spell admission is not effect success or an unknown dispatch."""
import copy
from pathlib import Path
import sys
from types import MethodType, SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
sys.path.insert(0, str(ROOT / 'tests'))
import test_survival_gateway as fixtures
from test_survival_gateway import NOW, TURN, BODY_UUID
from controller import Controller
from game_skills import GameSkills
from motor_loop import dispatch, reconcile
from motor_mailbox import open_cognition, public, view
from numen_gateway import read_json, write_json


class CastAcceptanceTests(unittest.TestCase):
    def setUp(self):
        fixtures.GatewayTests.setUp(self)
        self.settings['asyncMotor'] = True
        self.write('settings.json', self.settings)
        open_cognition(self.state, TURN, (NOW + 60) * 1000, lambda: NOW)
        self.queue = self.state / 'spell-queue'
        self.queue.mkdir()
        self.requests = []
        self.answer = True
        self.skill_id = 'irons_spellbooks:shield'
        self.native = {'schema': 1, 'engine': 'irons_spellbooks', 'action': 'cast',
            'ok': True, 'code': 'casting_started', 'actor': 'Kirito', 'actorUuid': BODY_UUID,
            'accepted': True, 'phase': 'casting', 'acceptanceEvidence': 'native_quick_cast',
            'spell': {'id': 'irons_spellbooks:shield'}, 'summary': 'Native casting began.'}
        self.c = SimpleNamespace(root=self.state, gateway=self.client, clock=lambda: NOW,
            data={}, discard_policy=lambda: None, save=lambda: None,
            collect_action_receipts=lambda turn: self.client.turn_receipts(turn),
            record=lambda *args, **kwargs: None)
        self.c.pause = MethodType(Controller.pause, self.c)

    write = fixtures.GatewayTests.write

    def respond(self, _):
        for path in (self.queue / 'requests').glob('*/request.json'):
            request = read_json(path)
            result = self.queue / 'results' / (request['id'] + '.json')
            if result.exists():
                continue
            self.requests.append(request)
            write_json(result, self.native | {'requestId': request['id']})

    def run_cast(self):
        self.payload = {'tool': 'game_cast', 'args': {'skill_id': self.skill_id, 'params': {}}}
        queued = self.client.action(TURN, **self.payload)
        self.assertEqual(queued['code'], 'motor_queued')
        def bridge(gateway):
            return GameSkills(gateway, self.queue, timeout=1 if self.answer else 0, sleep=self.respond)
        with patch('game_skills.GameSkills', side_effect=bridge):
            dispatch(self.c)
        return view(self.state)['requests'][0]

    def assert_admitted_only(self):
        row = self.run_cast()
        self.assertEqual(row['status'], 'dispatched')
        self.assertEqual(row['receipt']['status'], 'effect_unconfirmed')
        self.assertFalse(row['receipt']['completionConfirmed'])
        self.assertTrue(row['receipt']['dispatchConfirmed'])
        self.assertFalse(row['receipt']['effectConfirmed'])
        self.assertTrue(read_json(self.state / 'control.json')['enabled'])
        self.assertFalse((self.state / 'unknown.json').exists())
        self.assertFalse((self.state / 'inflight-action.json').exists())
        self.assertFalse(self.client.action_status()['inFlight'])
        visible = public(self.state, detail='brief')
        self.assertEqual(visible['active'], [])
        self.assertEqual(visible['recent'][0]['receipt']['castRequestId'], self.requests[0]['id'])
        self.assertIn('not confirmed', visible['recent'][0]['receipt']['notice'])
        self.c.settings = {'livestreamMode': True, 'asyncMotor': True}
        self.c.last_body = self.client.snapshot()
        self.c.data.update(motorQueue=visible, actionExecution=self.client.action_status())
        pacing = Controller.livestream_pacing(self.c, {'goalState': 'ongoing'})
        self.assertEqual(pacing['reason'], 'goal_ongoing')
        self.assertEqual(pacing['idleCapSeconds'], 45)
        duplicate = self.client.action(TURN, **self.payload)
        self.assertEqual(duplicate['requestId'], row['requestId'])
        self.assertEqual(duplicate['status'], 'dispatched')
        self.assertFalse(dispatch(self.c))
        reconcile(self.c)
        self.assertEqual(len(self.requests), 1)

    def test_casting_is_known_dispatch_without_effect_success_or_pause(self):
        self.assert_admitted_only()

    def test_instant_native_acceptance_has_the_same_honest_boundary(self):
        self.native['phase'] = 'accepted'
        self.assert_admitted_only()

    def test_legacy_alias_keeps_nested_native_acceptance_without_claiming_effect(self):
        self.skill_id = 'rasengan'
        self.native = {'ok': True, 'code': 'casting_started', 'actor': 'Kirito',
            'skillId': self.skill_id, 'engine': 'irons_spellbooks',
            'nativeSpell': 'irons_spellbooks:shield', 'executionConfirmed': False,
            'effectReceipt': self.native, 'summary': 'Native mapped spell began.'}
        self.assert_admitted_only()

    def test_lost_ack_remains_unknown_and_never_replays(self):
        self.answer = False
        row = self.run_cast()
        self.assertEqual(row['status'], 'unknown')
        self.assertFalse(read_json(self.state / 'control.json')['enabled'])
        self.assertTrue((self.state / 'unknown.json').exists())
        self.assertEqual(len(list((self.queue / 'requests').glob('*/request.json'))), 1)
        reconcile(self.c)
        self.assertFalse(dispatch(self.c))
        self.assertEqual(len(list((self.queue / 'requests').glob('*/request.json'))), 1)

    def test_effect_unconfirmed_without_native_acceptance_still_pauses(self):
        self.native.pop('accepted')
        row = self.run_cast()
        self.assertEqual(row['status'], 'unknown')
        self.assertFalse(read_json(self.state / 'control.json')['enabled'])

    def test_program_observation_keeps_effect_unconfirmed(self):
        from fast_execution import execution_state
        self.c.collect_practice_receipts = lambda turn, rows: None
        self.c.reviews = SimpleNamespace(sleep_receipt=lambda row: None)
        def collect(turn):
            write_json(self.state / 'skill-job.json', {'status': 'running',
                'lastTurnId': turn, 'lastExecution': {'turnId': turn, 'status': 'accepted'}})
            return Controller.collect_action_receipts(self.c, turn)
        self.c.collect_action_receipts = collect
        row = self.run_cast()
        job = read_json(self.state / 'skill-job.json')
        self.assertEqual(row['status'], 'dispatched')
        self.assertEqual(job['lastExecution']['status'], 'observed')
        self.assertFalse(job['lastExecution']['completionConfirmed'])
        self.assertFalse(job['lastExecution']['observationAvailable'])
        observed = execution_state(job, [], self.client.snapshot(), NOW)
        self.assertEqual(observed['lastExecution'], job['lastExecution'])

    def test_changed_receipt_identity_never_authorizes_dispatch_terminal(self):
        row = self.run_cast()
        receipt_path = self.state / 'action-receipts' / (row['receipt']['actionId'] + '.json')
        original = read_json(receipt_path)
        inbox = view(self.state)
        inbox['requests'][0].update(status='claimed', payload=self.payload)
        changes = (
            lambda r: r.update(turnId='unrelated-turn-0001'),
            lambda r: r.update(tool='eat'),
            lambda r: r.update(args={'skill_id': 'irons_spellbooks:firebolt', 'params': {}}),
            lambda r: r['result'].update(actionId='0' * 32),
            lambda r: r['result']['result']['data']['receipt'].update(requestId='00000000-0000-0000-0000-000000000000'),
            lambda r: r['result']['result']['data']['receipt'].update(actorUuid='other-body'),
            lambda r: r['result']['result']['data']['receipt']['spell'].update(id='irons_spellbooks:firebolt'),
        )
        for change in changes:
            with self.subTest(change=changes.index(change)):
                receipt = copy.deepcopy(original)
                change(receipt)
                write_json(receipt_path, receipt)
                write_json(self.state / 'motor-inbox.json', copy.deepcopy(inbox))
                write_json(self.state / 'control.json', {'schema': 1, 'enabled': True})
                reconcile(self.c)
                self.assertEqual(view(self.state)['requests'][0]['status'], 'unknown')
                self.assertFalse(read_json(self.state / 'control.json')['enabled'])
        self.assertEqual(len(self.requests), 1)


if __name__ == '__main__':
    unittest.main()
