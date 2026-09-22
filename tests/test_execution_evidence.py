"""Evidence regressions: dispatch != completion, repetition != stagnation."""
import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/survival'))
sys.path.insert(0, str(ROOT / 'tools'))
import coherence
from execution_evidence import (behavior_summary, classify, load_receipts, observed_delta,
                                repeats, signature, summarize, time_buckets)
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
            (Path(tmp) / 'settings.json').write_text(json.dumps({
                'brainProtocol': 1, 'memoryEpoch': 'current', 'memoryStartedAt': 1000}), encoding='utf-8')
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


class GenerationMetricsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.start = datetime(2026, 9, 20, 3, tzinfo=timezone.utc).timestamp()
        self.now = self.start + 3 * 3600
        self.settings = {'brainProtocol': 1, 'memoryEpoch': 'new', 'memoryStartedAt': self.start * 1000}
        (self.root / 'settings.json').write_text(json.dumps(self.settings), encoding='utf-8')
        (self.root / 'action-receipts').mkdir()
        (self.root / 'episodes.jsonl').write_text('', encoding='utf-8')
        state = patch.object(coherence, 'STATE', self.root)
        clock = patch.object(coherence.time, 'time', return_value=self.now)
        state.start(); clock.start()
        self.addCleanup(state.stop); self.addCleanup(clock.stop)

    def action(self, identity, offset=1, **changes):
        row = receipt(identity)
        row['acceptedAt'] = (self.start + offset) * 1000
        row.update(changes)
        (self.root / 'action-receipts' / (identity + '.json')).write_text(json.dumps(row), encoding='utf-8')
        return row

    def episodes(self, rows):
        values = []
        for task, offset in rows:
            values.append({'kind': 'decision_finished', 'taskId': task, 'completed': True,
                           'at': datetime.fromtimestamp(self.start + offset, timezone.utc).isoformat()})
        (self.root / 'episodes.jsonl').write_text('\n'.join(json.dumps(row) for row in values), encoding='utf-8')

    def test_current_generation_excludes_old_and_reports_unassigned(self):
        self.action('old', -1)
        self.action('boundary', 0)
        self.action('no-time', acceptedAt=None)
        self.action('future', 4 * 3600)
        self.action('conflicting-epoch', memoryEpoch='other')
        result = coherence.collect({'memoryEpoch': 'new'})
        self.assertEqual(result['generation']['status'], 'current')
        self.assertEqual(result['generation']['startedAt'], self.start * 1000)
        coverage = result['evidence']['coverage']
        self.assertEqual((coverage['currentGeneration'], coverage['priorGeneration'], coverage['unassigned']), (1, 1, 3))
        self.assertEqual(result['closedLoop']['sampled'], 1)
        self.assertIsNone(result['closedLoop']['rate'])
        self.assertIsNone(result['closedLoop']['objectiveSuccessRate'])
        self.assertIsNone(result['repeats']['share'])

    def test_generation_boundary_must_be_available_and_match_controller(self):
        self.action('a')
        for settings in ({}, dict(self.settings, memoryStartedAt=True),
                         dict(self.settings, memoryStartedAt=float('nan')),
                         dict(self.settings, memoryStartedAt=(self.now + 1) * 1000)):
            with self.subTest(settings=settings):
                (self.root / 'settings.json').write_text(json.dumps(settings), encoding='utf-8')
                result = coherence.collect()
                self.assertEqual(result['generation']['status'], 'unavailable')
                self.assertEqual(result['evidence']['coverage']['unassigned'], 1)
                self.assertEqual(result['closedLoop']['sampled'], 0)
                self.assertIsNone(result['closedLoop']['rate'])
        (self.root / 'settings.json').write_text(json.dumps(self.settings), encoding='utf-8')
        self.assertEqual(coherence.collect({'memoryEpoch': 'other'})['generation']['status'], 'unavailable')

    def test_broken_receipt_cannot_improve_success_rate(self):
        self.action('good')
        (self.root / 'action-receipts' / 'broken.json').write_text('{', encoding='utf-8')
        result = coherence.collect()
        self.assertEqual(result['evidence']['coverage']['readFailures'], 1)
        self.assertEqual(result['closedLoop']['succeeded'], 1)
        self.assertIsNone(result['closedLoop']['rate'])
        self.assertIsNone(result['behaviors'][0]['rate'])
        self.assertTrue(all(bucket['rate'] is None for bucket in result['trends']['buckets']))

    def test_model_completion_is_not_a_game_success_and_epoch_filters_gaps(self):
        self.episodes([('old', -3600), ('first', 10), ('first', 20), ('second', 70)])
        result = coherence.collect()
        self.assertEqual(result['closedLoop']['sampled'], 0)
        self.assertIsNone(result['closedLoop']['rate'])
        self.assertEqual(result['evidence']['episodes']['priorGeneration'], 1)
        self.assertEqual(result['evidence']['episodes']['duplicateIds'], 1)
        self.assertEqual(result['decisionGaps']['samples'], 1)
        self.assertEqual(result['decisionGaps']['maxSeconds'], 60)

    def test_runtime_refresh_keeps_pause_explicit_without_model_text(self):
        (self.root / 'control.json').write_text(json.dumps({
            'enabled': False, 'pauseReason': 'controller_FileNotFoundError'}), encoding='utf-8')
        (self.root / 'controller.json').write_text(json.dumps({
            'status': 'paused', 'pauseReason': 'controller_FileNotFoundError',
            'active': {'turnId': 'original-turn', 'prompt': 'PRIVATE_PROMPT'},
            'lastDecision': {'text': 'PRIVATE_ANSWER'}}), encoding='utf-8')
        result = coherence.collect()
        self.assertEqual(result['runtime']['status'], 'paused')
        self.assertIs(result['runtime']['enabled'], False)
        self.assertEqual(result['runtime']['pauseReason'], 'controller_FileNotFoundError')
        self.assertEqual(result['runtime']['activeTurnId'], 'original-turn')
        self.assertNotIn('PRIVATE', json.dumps(result))
        (self.root / 'control.json').unlink()
        self.assertIsNone(coherence.collect()['runtime']['enabled'])
        self.assertIn('control_unavailable', coherence.collect()['runtime']['readErrors'])

    def test_time_buckets_keep_empty_unknowns_and_outcomes_separate(self):
        self.action('success', 1)
        self.action('pending', 5, status='in_flight', completionConfirmed=False)
        self.action('unknown', 3601, status='unknown')
        self.action('failure', 3602, status='failed', result={'ok': False, 'result': {'success': False}})
        result = coherence.collect()
        buckets = result['trends']['buckets']
        self.assertEqual([bucket['sampled'] for bucket in buckets], [2, 2, 0, 0])
        self.assertEqual([bucket['rate'] for bucket in buckets], [.5, 0, None, None])
        self.assertEqual(buckets[0]['outcomes']['pending'], 1)
        self.assertEqual(buckets[1]['outcomes']['unknown'], 1)
        self.assertEqual(buckets[1]['outcomes']['failed'], 1)
        self.assertTrue(all(bucket['partial'] for bucket in buckets))
        self.assertFalse(result['trends']['causallyComparable'])
        self.assertEqual(result['behaviors'][0]['category'], 'production')
        self.assertEqual(result['behaviors'][0]['tools'], {'craft': 4})

    def test_sampling_and_epoch_cutoff_do_not_join_repeat_sequences(self):
        for i in range(4):
            self.action('old-' + str(i), -10 + i)
        self.action('new-1', 1)
        self.action('new-2', 2)
        result = coherence.collect()
        self.assertEqual(result['repeats']['window'], 2)
        self.assertEqual(result['repeats']['inRepeats'], 0)
        with patch.object(coherence, 'ACTION_WINDOW', 2):
            result = coherence.collect()
        self.assertTrue(result['evidence']['coverage']['sampleTruncated'])
        self.assertEqual(result['evidence']['coverage']['availableFiles'], 6)
        self.assertEqual(result['evidence']['coverage']['selectedFiles'], 2)

    def test_duplicate_receipt_identity_counts_only_once(self):
        row = self.action('one')
        generation = coherence._generation({}, self.now)
        selected, coverage = coherence._current_generation([row, copy.deepcopy(row)], generation, self.now)
        self.assertEqual(len(selected), 1)
        self.assertEqual(coverage['duplicateIds'], 1)

    def test_trend_display_cap_reports_older_samples(self):
        rows = [self.action('first', 1), self.action('last', 30 * 3600)]
        trend = time_buckets(rows, started_at=self.start, now=self.start + 30 * 3600)
        self.assertEqual(len(trend['buckets']), 24)
        self.assertEqual(trend['olderSamples'], 1)
        self.assertEqual(sum(bucket['sampled'] for bucket in trend['buckets']), 1)
        self.assertEqual(behavior_summary([dict(rows[0], tool='unrecognized')])[0]['category'], 'other')


if __name__ == '__main__':
    unittest.main()
