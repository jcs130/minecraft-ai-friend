"""Offline, read-only trajectory audit. Never dispatches or replays an action.

Run: run-python.bat -X utf8 tools/audit_survival_evidence.py --state PATH --output PATH
Keep reports in ignored runtime/: they contain local action IDs and arguments.
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
from execution_evidence import classify, load_receipts, observed_delta, repeats, signature, summarize


def audit(state, limit=400):
    records, errors = load_receipts(Path(state) / 'action-receipts', limit)
    groups = defaultdict(list)
    evidence = []
    for record in records:
        row = record['receipt']
        item = {key: record[key] for key in ('source', 'sha256')}
        item.update(actionId=row['actionId'], outcome=classify(row), delta=observed_delta(row))
        evidence.append(item)
        key = signature(row)
        if key is not None:
            groups[key].append(item)
    contrasts = []
    for key, rows in groups.items():
        good = [row for row in rows if row['outcome'] == 'succeeded']
        bad = [row for row in rows if row['outcome'] in ('failed', 'rejected')]
        if good and bad:
            body, dimension, tool, args = json.loads(key)
            contrasts.append({'body': body, 'dimension': dimension, 'tool': tool, 'args': args,
                              'success': good[-1], 'failure': bad[-1],
                              'causallyComparable': False})
    receipts = [record['receipt'] for record in records]
    repetition = repeats(receipts)
    if errors:
        # Missing records could join two runs that were not actually adjacent.
        repetition = {'window': len(receipts), 'share': None, 'inRepeats': None,
                      'longestIdenticalRun': None, 'reason': 'incomplete_receipt_sequence'}
    return {'schema': 1, 'kind': 'observational_evidence_audit',
            'outcomes': summarize(receipts), 'repeats': repetition, 'errors': errors,
            'evidence': evidence, 'contrasts': contrasts,
            'comparability': {'established': False, 'reason': 'No controlled trial manifest supplied.',
                'required': ['task_and_objective_hash', 'initial_world_snapshot', 'body_and_dimension',
                             'harness_bundle_hash', 'model_and_prompt_config', 'budget_and_seed_policy',
                             'baseline_candidate_generation', 'independent_evaluator_version']},
            'notice': 'Same arguments do not establish the same task or initial world. '
                      'Deltas are observations, not proof of action causality. '
                      'This audit cannot certify goal success, skill promotion or improvement.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--limit', type=int, default=400)
    args = parser.parse_args()
    state, output = args.state.resolve(), args.output.resolve()
    if output == state or state in output.parents:
        parser.error('--output must be outside the evidence directory')
    report = audit(state, args.limit)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    print(json.dumps({'output': str(output), 'outcomes': report['outcomes'],
                      'repeats': report['repeats'], 'contrasts': len(report['contrasts']),
                      'errors': report['errors']}, ensure_ascii=False))
    return 1 if report['errors'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
