"""Offline, read-only trajectory audit. Never dispatches or replays an action.

Run: run-python.bat -X utf8 tools/audit_survival_evidence.py --state PATH --output PATH
Keep reports in ignored runtime/: they contain local action IDs and arguments.
"""
import argparse
import json
import sys
from collections import defaultdict, deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'world/survival'))
from execution_evidence import classify, load_receipts, observed_delta, repeats, signature, summarize


def system_one_chains(events, records):
    """Join an actual choice to its dispatch and terminal receipt, never by time proximity."""
    choices, dispatches, receipts = defaultdict(list), [], defaultdict(list)
    def key(event, policy):
        fields = [event.get(k) for k in ('practiceRunId', 'name', 'version')]
        fields += [policy.get(k) for k in ('stateSha256', 'observedAt', 'choice', 'model')]
        return tuple(fields) if all(type(v) in (str, int, float) and v != '' for v in fields) else None
    for record in records:
        row = record['receipt']
        if isinstance(row.get('turnId'), str):
            receipts[row['turnId']].append(row)
    for index, event in enumerate(events):
        if event.get('kind') == 'system_one_choice':
            selection = event.get('selection')
            if isinstance(selection, dict) and (identity := key(event, selection)):
                choices[identity].append((index, selection))
        elif event.get('kind') == 'system_one_dispatch':
            dispatches.append((index, event))
    turns = [event.get('turnId') for _, event in dispatches]
    chains = []
    for dispatch_index, event in dispatches:
        policy = event.get('policy') or {}
        identity = key(event, policy) if isinstance(policy, dict) else None
        selections = choices.get(identity, [])
        turn = event.get('turnId')
        matched = receipts.get(turn, []) if isinstance(turn, str) else []
        item = {k: event.get(k) for k in ('practiceRunId', 'name', 'version', 'turnId')}
        item.update(verifiedActionLoop=False, outcome='unverified', reason='missing_or_ambiguous_link')
        if len(selections) == len(matched) == 1 and turns.count(turn) == 1:
            (choice_index, selection), row = selections[0], matched[0]
            state = selection.get('state') if isinstance(selection.get('state'), dict) else {}
            body = state.get('body') if isinstance(state.get('body'), dict) else {}
            before = row.get('before') if isinstance(row.get('before'), dict) else {}
            action = selection.get('action')
            if (choice_index < dispatch_index and selection.get('ok') is True and policy.get('ok') is True
                    and isinstance(action, dict) and action == {'tool': row.get('tool'), 'args': row.get('args')}
                    and body.get('bodyUuid') and body.get('dimension')
                    and all(body.get(k) == before.get(k) for k in ('bodyUuid', 'dimension'))):
                outcome = classify(row)
                item.update(actionId=row['actionId'], tool=row['tool'], outcome=outcome,
                    verifiedActionLoop=outcome == 'succeeded', reason='bound_receipt',
                    choice=selection.get('choice'), model=selection.get('model'),
                    latencyMs=selection.get('latencyMs'), confidence=selection.get('confidence'),
                    delta=observed_delta(row))
            else:
                item['reason'] = 'choice_action_or_body_mismatch'
        chains.append(item)
    return {'choices': sum(len(rows) for rows in choices.values()), 'dispatches': len(dispatches),
            'verifiedActionLoops': sum(row['verifiedActionLoop'] for row in chains), 'chains': chains,
            'notice': 'Bound action completion only; not goal success, mastery or policy improvement.'}


def read_system_one_events(state, limit):
    path = Path(state) / 'episodes.jsonl'
    rows, errors = deque(maxlen=limit * 2), []
    if path.exists():
        with path.open(encoding='utf8') as source:
            for line_number, line in enumerate(source, 1):
                try:
                    row = json.loads(line)
                    if not isinstance(row, dict):
                        raise ValueError('not_object')
                    if row.get('kind') in ('system_one_choice', 'system_one_dispatch'):
                        rows.append(row)
                except ValueError:
                    errors.append({'source': 'episodes.jsonl', 'line': line_number, 'code': 'invalid_event'})
    return list(rows), errors


def audit(state, limit=400):
    records, errors = load_receipts(Path(state) / 'action-receipts', limit)
    events, event_errors = read_system_one_events(state, limit)
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
            'outcomes': summarize(receipts), 'repeats': repetition, 'errors': errors + event_errors,
            'systemOne': system_one_chains(events, records),
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
                      'systemOne': {k: report['systemOne'][k] for k in ('choices', 'dispatches', 'verifiedActionLoops')},
                      'errors': report['errors']}, ensure_ascii=False))
    return 1 if report['errors'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
