"""Read-only, repeatable sample of the live survivor's body and two loops."""
import argparse
import json
import math
import time
from pathlib import Path


def read(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


def distance(a, b):
    try:
        return math.dist((a['x'], a['y'], a['z']), (b['x'], b['y'], b['z']))
    except (KeyError, TypeError, ValueError):
        return 0


def sample(public, state, seconds, output):
    output.mkdir(parents=True, exist_ok=True)
    start = time.time()
    last_observed = None
    last_fresh_at = None
    anchor, anchor_at = None, None
    longest = 0
    movement = 0
    fresh = 0
    task_ids, focus_sources, skill_versions = set(), {}, set()
    samples = []
    while time.time() - start < seconds:
        now = time.time()
        live = read(public)
        controller = read(state / 'controller.json')
        job = read(state / 'skill-job.json')
        body = live.get('body') or {}
        position = body.get('position') or {}
        observed = body.get('observedAt')
        is_fresh = (body.get('ok') is True and body.get('online') is True
                    and isinstance(observed, (int, float)) and observed != last_observed
                    and -2 <= now - observed / 1000 <= 10)
        if is_fresh:
            fresh += 1
            last_observed = observed
            if anchor is None or last_fresh_at is not None and now - last_fresh_at > 10:
                if anchor_at is not None and last_fresh_at is not None:
                    longest = max(longest, last_fresh_at - anchor_at)
                anchor, anchor_at = position, now
            elif distance(position, anchor) > .25:
                longest = max(longest, now - anchor_at)
                movement += 1
                anchor, anchor_at = position, now
            last_fresh_at = now
        task = (controller.get('active') or {}).get('taskId')
        if task:
            task_ids.add(task)
        focus = controller.get('lastToolFocus') or {}
        if focus.get('at'):
            focus_sources[focus['at']] = {'source': focus.get('source'),
                                            'category': focus.get('category'),
                                            'latencyMs': focus.get('latencyMs')}
        if job.get('name') == 'base_motion_plan' and job.get('version'):
            skill_versions.add(job['version'])
        samples.append({'at': round(now, 3), 'fresh': is_fresh,
                        'position': position if is_fresh else None,
                        'hp': body.get('hp') if is_fresh else None,
                        'slowTask': task, 'slowStatus': controller.get('status'),
                        'motorStatus': (live.get('motor') or {}).get('status'),
                        'jobStatus': job.get('status'), 'jobReason': job.get('reason'),
                        'jobSteps': job.get('steps'), 'toolFocus': focus.get('category'),
                        'contextBytes': (controller.get('active') or {}).get('contextStats', {}).get('inputBytes')})
        elapsed = time.time() - now
        time.sleep(max(0, 1 - elapsed))
    if anchor_at is not None and last_fresh_at is not None:
        longest = max(longest, last_fresh_at - anchor_at)
    with (output / 'samples.jsonl').open('w', encoding='utf-8') as stream:
        for row in samples:
            stream.write(json.dumps(row, ensure_ascii=False) + '\n')
    summary = {'seconds': round(time.time() - start, 1), 'samples': len(samples),
               'freshBodyObservations': fresh, 'positionChangesOverQuarterBlock': movement,
               'longestStationarySeconds': round(longest, 1),
               'slowTasksObserved': sorted(task_ids), 'jevToolFocus': list(focus_sources.values()),
               'motionPlanVersionsObserved': sorted(skill_versions),
               'final': samples[-1] if samples else None}
    (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seconds', type=int, default=600)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    sample(root / 'server/panel-state/survivor.json',
           root / 'server/survival-agent-state/survival', args.seconds, args.output)
