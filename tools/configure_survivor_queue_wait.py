"""Preview one native Kirito queue-wait change; only --apply can write.

The operator must first drain/pause the original life controller and pause its
existing Cron jobs. This tool never pauses, resumes, starts or retries work.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/sidecar'), str(ROOT / 'world/survival'),
               str(ROOT / 'world/ops')]
from configure_survivor_party import api
from configure_sao_characters import require_idle
from qwen_tasks import write_json

ROLE = 'qd-survivor'
ROUTE = '/agents/' + ROLE
JOB_ID = 'qd-life-review-qd-survivor'
WAIT_SECONDS = 120


def planned_profile(profile):
    """Only the original 30-second value or this tool's 120 is accepted."""
    if (not isinstance(profile, dict) or profile.get('id') != ROLE
            or not isinstance(profile.get('name'), str) or not profile['name'].strip()
            or not isinstance(profile.get('running'), dict)):
        raise ValueError('original_survivor_profile_required')
    current = profile['running'].get('llm_acquire_timeout')
    if type(current) not in (int, float) or current not in (30, WAIT_SECONDS):
        raise ValueError('unexpected_survivor_queue_wait')
    proposed = deepcopy(profile)
    proposed['running']['llm_acquire_timeout'] = WAIT_SECONDS
    return proposed


def require_maintenance(root, call):
    require_idle(ROLE, root=root, call=call)
    jobs = call('GET', '/cron/jobs', ROLE)
    if (not isinstance(jobs, list)
            or sum(isinstance(job, dict) and job.get('id') == JOB_ID for job in jobs) != 1
            or any(not isinstance(job, dict) or job.get('enabled') is not False for job in jobs)):
        raise ValueError('original_survivor_cron_jobs_must_be_paused')
    return jobs


def configure(*, apply=False, call=api, root=ROOT):
    root = Path(root)
    before = call('GET', ROUTE, ROLE)
    proposed = planned_profile(before)
    result = {'ok': True, 'mode': 'apply' if apply else 'preview', 'agentId': ROLE,
              'field': 'running.llm_acquire_timeout',
              'before': before['running']['llm_acquire_timeout'], 'after': WAIT_SECONDS,
              'changed': before != proposed, 'applied': False,
              'modelCalls': 0, 'worldActions': 0, 'retryAutomatically': False}
    if not apply or before == proposed:
        return result
    jobs = require_maintenance(root, call)
    backup = root / 'runtime/survivor-queue-wait' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    write_json(backup / 'profile-before.json', before)
    write_json(backup / 'cron-before.json', jobs)
    journal = {'agentId': ROLE, 'field': result['field'], 'before': result['before'],
               'after': WAIT_SECONDS, 'stage': 'prepared', 'retryAutomatically': False}

    def mark(stage):
        journal['stage'] = stage
        write_json(backup / 'journal.json', journal)

    mark('prepared')
    try:
        # Native PUT merges top-level fields under its own lock. Do not send a
        # GET's masked credentials or any unrelated profile field back to it.
        if call('GET', ROUTE, ROLE) != before or require_maintenance(root, call) != jobs:
            raise ValueError('concurrent_survivor_configuration_change')
        mark('native_put_started')
        call('PUT', ROUTE, ROLE, {'id': ROLE, 'name': before['name'],
                                'running': proposed['running']})
        mark('native_put_returned')
        actual = call('GET', ROUTE, ROLE)
        write_json(backup / 'profile-after.json', actual)
        if actual != proposed:
            raise ValueError('survivor_profile_readback_mismatch')
        if call('GET', '/cron/jobs', ROLE) != jobs:
            raise ValueError('survivor_cron_changed_during_configuration')
        mark('verified')
    except Exception as error:
        journal['failedAt'] = journal['stage']
        journal['errorType'] = type(error).__name__
        mark('failed_or_uncertain')
        raise
    result.update(applied=True, backup=str(backup))
    write_json(backup / 'receipt.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply only at the maintained idle boundary.')
    args = parser.parse_args()
    try:
        print(json.dumps(configure(apply=args.apply), ensure_ascii=False))
    except Exception as error:
        # Transport exception text can contain response/profile material.
        print(json.dumps({'ok': False, 'errorType': type(error).__name__,
                          'retryAutomatically': False}), file=sys.stderr)
        raise SystemExit(1)
