"""Evidence regressions: dispatch != completion, repetition != stagnation."""
import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
sys.path.insert(0, str(ROOT / 'tools'))
import coherence
from execution_evidence import classify, load_receipts, observed_delta, repeats, signature, summarize
from audit_survival_evidence import audit


def receipt(identity='a', tool='craft', args=None):
    body = {'ok': True, 'bodyUuid': 'body-a', 'dimension': 'minecraft:overworld',
            'counts': {'minecraft:stick': 0}, 'hp': 20, 'hunger': 15,
            'position': {'x': 0, 'y': 64, 'z': 0}, 'navigationEpoch': 'epoch-a'}
    return {'actionId': identity, 'acceptedAt': 1000, 'tool': tool,
            'args': args or {'item_id': 'minecraft:stick', 'count': 1},
            'status': 'completed', 'completionConfirmed': True,
            'before': body, 'after': copy.deepcopy(body),
            'result': {'ok': True, 'code': 'accepted', 'result': {'success': True}}}


class OutcomeTests(unittest.TestCase):
    def test_dispatch_is_pending_not_success(self):
        row = receipt()
        row.update(status='in_flight', completionConfirmed=False)
        self.assertEqual(classify(row), 'pending')
        self.assertEqual(summarize([row])['rate'], 0)

    def test_unknown_does_not_inherit_dispatch_success(self):
        for status in ('unknown', 'observed_ended'):
            row = receipt()
            row['status'] = status
            self.assertEqual(classify(row), 'unknown')

    def test_confirmed_sync_native_reply(self):
        self.assertEqual(classify(receipt()), 'succeeded')
        self.assertIsNone(summarize([receipt()])['objectiveSuccessRate'])

    def test_contradictions_do_not_succeed(self):
        changes = [{'completionConfirmed': False}, {'result': {'ok': True}},
                   {'result': {'ok': False, 'result': {'success': True}}},
                   {'result': {'ok': True, 'code': 'outcome_unknown', 'result': {'success': True}}}]
        for change in changes:
            row = receipt()
            row.update(change)
            self.assertEqual(classify(row), 'unknown')

    def test_rejection_and_failure_remain_distinct(self):
        for status in ('failed', 'rejected'):
            row = receipt()
            row.update(status=status, result={'ok': False, 'result': {'success': False}})
            self.assertEqual(classify(row), status)

    def test_navigation_requires_original_task_and_epoch(self):
        row = receipt(tool='goto')
        row['nativeTaskId'] = 't1'
        self.assertEqual(classify(row), 'unknown')
        row['navigationOutcome'] = {'task_id': 't1', 'navigation_epoch': 'epoch-a', 'success': True}
        self.assertEqual(classify(row), 'succeeded')
        for key, value in [('task_id', 't2'), ('navigation_epoch', 'epoch-b')]:
            broken = copy.deepcopy(row)
            broken['navigationOutcome'][key] = value
            self.assertEqual(classify(broken), 'unknown')

    def test_navigation_terminal_failure_overrides_accepted_reply(self):
        row = receipt(tool='goto')
        row.update(status='failed', nativeTaskId='t1',
                   navigationOutcome={'task_id': 't1', 'navigation_epoch': 'epoch-a', 'success': False})
        self.assertEqual(classify(row), 'failed')

    def test_observed_arrival_requires_same_body_and_dimension(self):
        row = receipt(tool='goto')
        row.update(nativeTaskId='t1', navigationOutcome={
            'task_id': 't1', 'navigation_mode': 'observed_from_body', 'success': True})
        self.assertEqual(classify(row), 'succeeded')
        row['after']['bodyUuid'] = 'body-b'
        self.assertEqual(classify(row), 'unknown')

    def test_food_requires_exact_terminal_binding(self):
        row = receipt(tool='eat', args={'item_id': 'minecraft:bread'})
        food = {'epoch': 'food-epoch', 'actorUuid': 'body-a', 'requestId': 'a', 'tool': 'eat',
                'args': row['args'], 'nativeTaskId': 'f1', 'status': 'terminal',
                'nativeState': 'SUCCESS', 'result': {'success': True}}
        row.update(nativeTaskId='f1', nativeFoodOutcome=copy.deepcopy(food))
        row['result']['result']['nativeFoodReceipt'] = copy.deepcopy(food)
        self.assertEqual(classify(row), 'succeeded')
        for key in ('epoch', 'actorUuid', 'requestId', 'nativeTaskId', 'tool', 'args'):
            broken = copy.deepcopy(row)
            broken['nativeFoodOutcome'][key] = 'wrong'
            self.assertEqual(classify(broken), 'unknown', key)

    def test_empty_sample_is_unknown_not_zero(self):
        self.assertIsNone(summarize([])['rate'])


class RepetitionTests(unittest.TestCase):
    def test_different_destinations_are_not_repeats(self):
        rows = [receipt(str(i), 'goto', {'x': i, 'z': 0}) for i in range(9)]
        self.assertEqual(repeats(rows)['inRepeats'], 0)
        self.assertEqual(repeats(rows)['longestIdenticalRun'], 1)

    def test_overlapping_patterns_count_once(self):
        result = repeats([receipt(str(i)) for i in range(9)])
        self.assertEqual(result['inRepeats'], 9)
        self.assertEqual(result['longestIdenticalRun'], 9)
        self.assertEqual(result['share'], 1)

    def test_alternating_sequence_and_nonrepeated_tail(self):
        rows = [receipt(str(i), args={'x': i % 2}) for i in range(6)]
        rows += [receipt('tail', args={'x': 99})]
        self.assertEqual(repeats(rows)['inRepeats'], 6)
        self.assertEqual(repeats(rows)['longestIdenticalRun'], 1)

    def test_scattered_occurrences_are_not_consecutive(self):
        rows = [receipt(str(i), args={'x': value}) for i, value in enumerate([1, 2, 7, 1, 2, 8, 1, 2])]
        self.assertEqual(repeats(rows)['inRepeats'], 0)

    def test_missing_or_different_identity_breaks_run(self):
        rows = [receipt(str(i)) for i in range(5)]
        rows[2]['before'] = {}
        self.assertEqual(repeats(rows)['inRepeats'], 0)
        self.assertEqual(repeats(rows)['longestIdenticalRun'], 2)
        a, b = receipt(), receipt()
        b['before']['dimension'] = 'minecraft:the_nether'
        self.assertNotEqual(signature(a), signature(b))

    def test_argument_order_normalized_values_preserved(self):
        a, b = receipt(args={'x': 1, 'z': 2}), receipt(args={'z': 2, 'x': 1})
        self.assertEqual(signature(a), signature(b))
        b['args']['x'] = '1'
        self.assertNotEqual(signature(a), signature(b))


class AuditTests(unittest.TestCase):
    def test_panel_renders_unknown_and_legacy_schema_honestly(self):
        sys.path.insert(0, str(ROOT / 'world/ops'))
        from evolution_policy import PAGE_HTML
        result = subprocess.run(['node', str(ROOT / 'tests/evolution_evidence_ui.mjs')],
                                input=json.dumps(PAGE_HTML), text=True, encoding='utf-8',
                                capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_deltas_require_same_body_and_are_observations(self):
        row = receipt()
        row['after']['counts']['minecraft:stick'] = 4
        row['after']['position']['x'] = 3
        self.assertEqual(observed_delta(row)['inventory'], {'minecraft:stick': 4})
        self.assertEqual(observed_delta(row)['distance'], 3)
        row['after']['dimension'] = 'minecraft:the_end'
        self.assertIsNone(observed_delta(row))

    def test_hashes_original_bytes_and_reports_corruption(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw = json.dumps(receipt(), indent=3).encode()
            (root / 'a.json').write_bytes(raw)
            (root / 'bad.json').write_text('{', encoding='utf-8')
            (root / 'mismatch.json').write_bytes(raw)
            records, errors = load_receipts(root)
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]['sha256'], hashlib.sha256(raw).hexdigest())
            self.assertEqual(len(errors), 2)

    def test_invalid_limit_rejected(self):
        for limit in (0, -1, 10001, True):
            with self.assertRaises(ValueError):
                load_receipts(Path('unused'), limit)

    def test_contrasts_never_claim_causal_comparison(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'action-receipts'
            root.mkdir()
            a, b = receipt('a'), receipt('b')
            b.update(status='failed', result={'ok': False, 'result': {'success': False}})
            for row in (a, b):
                (root / (row['actionId'] + '.json')).write_text(json.dumps(row), encoding='utf-8')
            report = audit(Path(tmp))
            self.assertEqual(len(report['contrasts']), 1)
            self.assertFalse(report['contrasts'][0]['causallyComparable'])
            self.assertFalse(report['comparability']['established'])
            self.assertEqual(report['evidence'][0]['source'], 'a.json')

    def test_coherence_uses_receipts_not_dispatch_log(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(coherence, 'STATE', Path(tmp)):
            root = Path(tmp) / 'action-receipts'
            root.mkdir()
            row = receipt()
            row.update(status='failed', result={'ok': False, 'result': {'success': False}})
            (root / 'a.json').write_text(json.dumps(row), encoding='utf-8')
            (Path(tmp) / 'actions.jsonl').write_text(json.dumps(receipt()) + '\n', encoding='utf-8')
            result = coherence.collect()
            self.assertEqual(result['schema'], 2)
            self.assertEqual(result['closedLoop']['outcomes']['failed'], 1)
            self.assertEqual(result['closedLoop']['succeeded'], 0)

    def test_missing_source_and_corruption_are_visible(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(coherence, 'STATE', Path(tmp)):
            result = coherence.collect()
            self.assertIsNone(result['closedLoop']['rate'])
            self.assertTrue(result['evidence']['errors'])
            self.assertIsNone(result['repeats']['share'])

    def test_decision_intervals_respect_timezone_and_duplicates(self):
        rows = [{'kind': 'decision_finished', 'at': value} for value in
                ['2026-09-20T08:00:00+08:00', '2026-09-20T00:00:00Z',
                 '2026-09-20T00:01:00Z', '2026-09-20T03:00:00', None]]
        self.assertEqual(coherence._decision_gaps(rows),
                         {'samples': 1, 'medianSeconds': 60, 'maxSeconds': 60})


if __name__ == '__main__':
    unittest.main()
