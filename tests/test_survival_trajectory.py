"""Step1a trajectory reader tests.

Fixtures mirror the real writers field for field: numen_gateway.py receipts
(schema 2, crash-safe 'unknown' marker, async in-flight settle, effect
confirmation gap) and controller.py episodes.jsonl rows (modern action_observed
with actionId/turnId, legacy rows without, decision_finished labels).
"""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import survival_trajectory as trajectory

IRON, BREAD, RAW_IRON = 'minecraft:iron_ingot', 'minecraft:bread', 'minecraft:raw_iron'
A, B, C, D, E = 'a' * 32, 'b' * 32, 'c' * 32, 'd' * 32, 'e' * 32
TURN1, TURN2, TURN3 = 'turn-20260915-0001', 'turn-20260915-0002', 'turn-20260915-0003'
PLAZA, QUARRY = {'x': -547.0, 'y': 64.0, 'z': 868.0}, {'x': -568.0, 'y': 65.0, 'z': 886.0}


def snapshot(position, counts, hp, hunger, epoch, at):
    return {'ok': True, 'bodyUuid': '00000000-0000-4000-8000-000000000001',
            'position': position, 'dimension': 'minecraft:overworld', 'counts': counts,
            'hp': hp, 'hunger': hunger, 'task': {'busy': False},
            'navigationEpoch': epoch, 'navigationResult': None, 'observedAt': at}


def receipts():
    goto_before = snapshot(PLAZA, {IRON: 3, BREAD: 2}, 18.0, 18.0, 12, 999)
    goto_after = snapshot(QUARRY, {IRON: 3, BREAD: 1}, 20.0, 17.0, 12, 5999)
    mine_before = dict(goto_after, observedAt=6999)
    mine_after = snapshot(QUARRY, {IRON: 3, BREAD: 1, RAW_IRON: 2}, 20.0, 17.0, 12, 7999)
    rejected_before = dict(mine_after, observedAt=8999)
    rejected_after = dict(mine_after, observedAt=9999)
    return [
        {'schema': 2, 'actionId': A, 'turnId': TURN1, 'tool': 'goto',
         'args': {'x': -568.0, 'z': 886.0}, 'acceptedAt': 1000,
         'result': {'ok': True, 'code': 'accepted', 'actionId': A, 'tool': 'goto',
                    'result': {'success': True, 'data': {'async': True, 'task_id': 'task-goto-1'}},
                    'completionConfirmed': False},
         'status': 'completed', 'completionConfirmed': True, 'nativeTaskId': 'task-goto-1',
         'navigationOutcome': {'task_id': 'task-goto-1', 'navigation_epoch': 12, 'success': True},
         'before': goto_before, 'after': goto_after, 'observedAt': 6000,
         'notice': 'Idle proves no action is in flight; it does not prove the requested result.'},
        {'schema': 2, 'actionId': B, 'turnId': TURN1, 'tool': 'mine',
         'args': {'block_ids': ['minecraft:iron_ore'], 'count': 2}, 'acceptedAt': 2000,
         'result': {'ok': True, 'code': 'executed', 'actionId': B, 'tool': 'mine',
                    'result': {'success': True, 'data': {}}, 'completionConfirmed': True},
         'status': 'completed', 'completionConfirmed': True,
         'before': mine_before, 'after': mine_after, 'observedAt': 8000},
        {'schema': 2, 'actionId': C, 'turnId': TURN2, 'tool': 'craft',
         'args': {'item_id': IRON, 'count': 1}, 'acceptedAt': 3000,
         'result': {'ok': False, 'code': 'action_rejected', 'actionId': C, 'tool': 'craft',
                    'result': {'success': False, 'message': '缺少材料'}},
         'status': 'rejected', 'completionConfirmed': False,
         'before': rejected_before, 'after': rejected_after, 'observedAt': 9500},
        # The spell bridge acknowledges casting without a completion API: the
        # receipt settles as effect_unconfirmed and never grows an after.
        {'schema': 2, 'actionId': D, 'turnId': TURN2, 'tool': 'game_cast',
         'args': {'spell': 'spring'}, 'acceptedAt': 4000,
         'result': {'ok': True, 'code': 'accepted', 'actionId': D, 'tool': 'game_cast',
                    'result': {'success': True, 'data': {'async': True}},
                    'completionConfirmed': False},
         'status': 'effect_unconfirmed', 'completionConfirmed': False,
         'notice': 'Casting began; no effect-completion API is available. End this work interval.'},
        # Crash-safe marker form: result is the string 'unknown', no outcome.
        {'schema': 2, 'actionId': E, 'turnId': TURN3, 'tool': 'goto',
         'args': {'x': -560.0, 'z': 880.0}, 'acceptedAt': 5000,
         'result': 'unknown', 'status': 'unknown', 'completionConfirmed': False,
         'before': dict(rejected_before, observedAt=10999)},
    ]


def episodes_lines():
    return [
        json.dumps({'at': '2026-09-15T04:00:01+00:00', 'kind': 'action_observed', 'actionId': A,
                    'turnId': TURN1, 'action': 'goto', 'receiptStatus': 'completed',
                    'completionConfirmed': True,
                    'navigationOutcome': {'task_id': 'task-goto-1', 'navigation_epoch': 12, 'success': True},
                    'inventoryDelta': {BREAD: -1}, 'positionBefore': PLAZA, 'positionAfter': QUARRY,
                    'hp': 20.0, 'hunger': 17.0,
                    'notice': 'These are observed changes, not a blanket task-success assertion.'}),
        json.dumps({'at': '2026-09-15T04:00:20+00:00', 'kind': 'decision_finished', 'turnId': TURN1,
                    'taskId': 'task-1111', 'resultStatus': 'completed', 'completed': True,
                    'nativeTaskCompleted': True}),
        json.dumps({'at': '2026-09-15T04:02:00+00:00', 'kind': 'skill_finished',
                    'name': 'gather-iron', 'status': 'succeeded', 'steps': 3}),
        # Legacy observation row written before receipts carried identifiers.
        json.dumps({'at': '2026-09-15T04:03:00+00:00', 'kind': 'action_observed', 'action': 'mine',
                    'inventoryDelta': {RAW_IRON: 2}, 'positionBefore': QUARRY,
                    'positionAfter': QUARRY, 'hp': 20.0, 'hunger': 17.0, 'navigationOutcome': None,
                    'notice': 'These are observed changes, not a blanket task-success assertion.'}),
        '{"at": "torn write without closing brace',
        json.dumps({'at': '2026-09-15T04:06:00+00:00', 'kind': 'action_response', 'actionId': D,
                    'turnId': TURN2, 'action': 'game_cast', 'receiptStatus': 'effect_unconfirmed',
                    'completionConfirmed': False, 'observationAvailable': False, 'notice': 'No after snapshot.'}),
        json.dumps({'at': '2026-09-15T04:05:20+00:00', 'kind': 'decision_finished', 'turnId': TURN2,
                    'taskId': 'task-2222', 'resultStatus': 'failed', 'completed': False,
                    'nativeTaskCompleted': False}),
    ]


def actions_lines():
    return [
        json.dumps({'phase': 'dispatching', 'actionId': A, 'turnId': TURN1, 'tool': 'goto',
                    'result': 'unknown', 'acceptedAt': 1000}),
        json.dumps({'phase': 'response', 'actionId': A, 'turnId': TURN1, 'tool': 'goto',
                    'result': {'ok': True, 'code': 'accepted'}, 'finishedAt': 1100}),
        json.dumps({'phase': 'observation', 'actionId': A, 'turnId': TURN1, 'tool': 'goto',
                    'status': 'completed', 'completionConfirmed': True, 'observedAt': 6000}),
        'not json at all',
    ]


class TrajectoryReaderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        folder = self.root / 'action-receipts'
        folder.mkdir()
        # Written in reverse name order; the reader must order by acceptedAt.
        for name, receipt in sorted(((action_id + '.json', row) for action_id, row in
                                     zip((A, B, C, D, E), receipts())), reverse=True):
            (folder / name).write_text(json.dumps(row), encoding='utf-8')
        (folder / ('z' * 32 + '.json')).write_text('{}', encoding='utf-8')  # not hex: ignored
        (folder / ('9' * 32 + '.json')).write_text('{"schema": 1}', encoding='utf-8')  # invalid
        (folder / 'notes.txt').write_text('operator note', encoding='utf-8')
        (self.root / 'episodes.jsonl').write_text('\n'.join(episodes_lines()) + '\n', encoding='utf-8')
        (self.root / 'actions.jsonl').write_text('\n'.join(actions_lines()) + '\n', encoding='utf-8')

    def test_receipt_loader_orders_counts_and_flags(self):
        loaded = trajectory.load_receipts(self.root)
        self.assertEqual([row['actionId'] for row in loaded['receipts']], [A, B, C, D, E])
        self.assertEqual(loaded['ignoredFiles'], 2)  # notes.txt and the non-hex name
        self.assertEqual(loaded['invalid'], [{'file': '9' * 32 + '.json',
                                              'reason': 'unreadable_or_invalid'}])

    def test_goto_transition_carries_reward_hooks(self):
        row = trajectory.transitions(trajectory.load_receipts(self.root)['receipts'])[0]
        self.assertTrue(row['settled'] and row['observationAvailable'])
        self.assertEqual(row['inventoryDelta'], {BREAD: -1})
        self.assertAlmostEqual(row['displacement']['horizontal'], 27.6586337, places=6)
        self.assertAlmostEqual(row['displacement']['dy'], 1.0)
        self.assertAlmostEqual(row['hpDelta'], 2.0)
        self.assertAlmostEqual(row['hungerDelta'], -1.0)
        self.assertIs(row['navigationSuccess'], True)
        self.assertEqual(row['before']['counts'][IRON], 3)

    def test_mine_transition_reports_gain_without_navigation(self):
        row = trajectory.transitions(trajectory.load_receipts(self.root)['receipts'])[1]
        self.assertEqual(row['inventoryDelta'], {RAW_IRON: 2})
        self.assertAlmostEqual(row['displacement']['horizontal'], 0.0)
        self.assertIsNone(row['navigationSuccess'])

    def test_rejected_and_effect_unconfirmed_stay_honest(self):
        rows = trajectory.transitions(trajectory.load_receipts(self.root)['receipts'])
        rejected, cast = rows[2], rows[3]
        self.assertEqual(rejected['status'], 'rejected')
        self.assertTrue(rejected['observationAvailable'])
        self.assertEqual(rejected['inventoryDelta'], {})
        self.assertTrue(cast['settled'])  # effect_unconfirmed is terminal...
        self.assertFalse(cast['observationAvailable'])  # ...but has no after snapshot
        self.assertNotIn('inventoryDelta', cast)

    def test_unknown_marker_is_unsettled_and_tolerated(self):
        row = trajectory.transitions(trajectory.load_receipts(self.root)['receipts'])[4]
        self.assertEqual(row['status'], 'unknown')
        self.assertFalse(row['settled'])
        self.assertFalse(row['observationAvailable'])
        self.assertNotIn('displacement', row)

    def test_turn_rows_group_and_label_decisions(self):
        rows = trajectory.transitions(trajectory.load_receipts(self.root)['receipts'])
        turns = trajectory.turn_rows(rows, trajectory.load_jsonl(self.root / 'episodes.jsonl')['rows'])
        self.assertEqual([turn['turnId'] for turn in turns], [TURN1, TURN2, TURN3])
        self.assertEqual(turns[0]['toolSequence'], ['goto', 'mine'])
        self.assertTrue(turns[0]['decision']['completed'])
        self.assertEqual(turns[1]['decision']['resultStatus'], 'failed')
        self.assertFalse(turns[1]['decision']['completed'])
        self.assertIsNone(turns[2]['decision'])
        # skill_finished without turnId stays in the timeline, never joins a turn
        self.assertEqual(turns[0]['skillEvents'], [])

    def test_inventory_delta_counts_lost_items_negative(self):
        before, after = {'counts': {'a': 2, 'b': 1}}, {'counts': {'a': 2, 'c': 3}}
        self.assertEqual(trajectory.inventory_delta(before, after), {'c': 3, 'b': -1})
        self.assertEqual(trajectory.inventory_delta(None, after), {})
        self.assertIsNone(trajectory.displacement({}, {}))

    def test_summarize_builds_data_card_from_files(self):
        card = trajectory.summarize(self.root)
        self.assertEqual(card['schema'], 1)
        self.assertEqual(card['receipts']['total'], 5)
        self.assertEqual(card['receipts']['byStatus'],
                         {'completed': 2, 'effect_unconfirmed': 1, 'rejected': 1, 'unknown': 1})
        self.assertEqual(card['receipts']['invalidFiles'], ['9' * 32 + '.json'])
        self.assertEqual(card['transitions'], {'total': 5, 'observed': 3, 'settled': 4})
        self.assertEqual(card['episodes']['rows'], 6)
        self.assertEqual(card['episodes']['malformed'], 1)
        self.assertEqual(card['episodes']['byKind'],
                         {'action_observed': 2, 'action_response': 1, 'decision_finished': 2,
                          'skill_finished': 1})
        self.assertEqual(card['actionsLog']['byPhase'],
                         {'dispatching': 1, 'observation': 1, 'response': 1})
        self.assertEqual(card['turns'], {'total': 3, 'withDecision': 2, 'decisionCompleted': 1})
        self.assertEqual(card['timeRange']['firstReceiptAcceptedAt'], 1000)
        self.assertEqual(card['timeRange']['lastReceiptAcceptedAt'], 5000)
        self.assertEqual(card['timeRange']['firstEpisodeAt'], '2026-09-15T04:00:01+00:00')
        self.assertEqual(card['timeRange']['lastEpisodeAt'], '2026-09-15T04:06:00+00:00')

    def test_missing_state_directory_is_empty_not_error(self):
        card = trajectory.summarize(self.root / 'absent')
        self.assertEqual(card['receipts']['total'], 0)
        self.assertEqual(card['transitions'], {'total': 0, 'observed': 0, 'settled': 0})
        self.assertEqual(card['turns']['total'], 0)
        self.assertEqual(trajectory.dataset(self.root / 'absent')['turns'], [])

    def test_dataset_bundles_rows_and_summary(self):
        bundle = trajectory.dataset(self.root)
        self.assertEqual(len(bundle['transitions']), 5)
        self.assertEqual(len(bundle['turns']), 3)
        self.assertEqual(bundle['summary']['receipts']['total'], 5)


if __name__ == '__main__':
    unittest.main()
