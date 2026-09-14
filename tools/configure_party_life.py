"""Preview/create the existing Yui's native life signal Cron, without running it.

Default preview is read-only. New jobs start paused; --enable is an explicit
deployment step after the native adapter and NPC consumer have been verified.
No model/profile/driver/permission/SOUL/session changes are made.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/ops'), str(ROOT / 'world/sidecar'), str(ROOT / 'tools')]
os.environ.setdefault('PARTY_ROLES_MANIFEST_FILE', str(ROOT / 'server/mcdata/village/party/public/roles.json'))
os.environ.setdefault('MAID_ROLES_MANIFEST_FILE', str(ROOT / 'server/mcdata/village/maid-agents/public/roles.json'))
from party_life_schedule import JOB_ID, ROLE, managed_job, validate_job
from party_role_capabilities import is_bound_yui
from configure_survivor_party import api
from qwen_tasks import write_json


def runtime_ready():
    # A mounted source change is not an in-process adapter upgrade. The live
    # process/start-tick guard marker is written only when Qwen installs it.
    script = ("import sys,json; from pathlib import Path; sys.path.insert(0,'/ops'); "
        "from role_learning_profiles import validate_guard; "
        "validate_guard('/state/work','game'); "
        "m=json.loads(Path('/state/work/learning-runtime.json').read_text()); "
        "assert m.get('guardVersion')==3 and m.get('partyLifeSignalVersion')==1; print('ready')")
    value = subprocess.run(['docker', 'exec', 'qiandengji-qwenpaw-1', 'python', '-c', script],
                           capture_output=True, text=True, timeout=25)
    if value.returncode != 0 or value.stdout.strip() != 'ready':
        raise ValueError('native_party_life_adapter_not_running')


def configure(*, apply=False, enable=False, call=api, root=ROOT):
    if enable and not apply:
        raise ValueError('enable_requires_apply')
    if not is_bound_yui('game:' + ROLE):
        raise ValueError('original_yui_party_required')
    jobs = call('GET', '/cron/jobs', ROLE)
    matches = [row for row in jobs if row['id'] == JOB_ID]
    if len(matches) > 1: raise ValueError('duplicate_party_life_job')
    prior = matches[0] if matches else None
    if prior: validate_job(prior, ROLE)
    proposed = prior.copy() if prior else managed_job() | {'enabled': False}
    if enable: proposed['enabled'] = True
    result = {'role': ROLE, 'jobId': JOB_ID, 'exists': prior is not None, 'proposed': proposed,
              'applied': False, 'modelTasksSubmitted': 0, 'gameActions': 0}
    if not apply: return result
    active = call('GET', '/agents/' + ROLE + '/agent-status', ROLE)
    if active.get('status') != 'idle' or active.get('running_task_count') != 0:
        raise ValueError('yui_native_task_must_finish_first')
    if enable:
        runtime_ready()
        public = json.loads((Path(root) / 'server/panel-state/party.json').read_text(encoding='utf-8-sig'))
        if (public.get('life', {}).get('enabled') is not True
                or public.get('life', {}).get('signalVersion') != 1
                or public.get('status') != 'running' or public.get('error') is not None
                or not -5 <= time.time() - public.get('updatedAt', 0) / 1000 <= 90):
            raise ValueError('npc_party_life_consumer_not_loaded')
    workspace = Path(root) / 'server/agents/work/workspaces' / ROLE
    before = {name: hashlib.sha256((workspace / name).read_bytes()).hexdigest()
              for name in ('agent.json', 'SOUL.md', 'PROFILE.md')}
    backup = Path(root) / 'runtime/party-life-config' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    write_json(backup / 'before.json', {'job': prior, 'roleFilesSha256': before})
    # Qwen 2.2 POST replaces supplied IDs; PUT preserves one fixed managed ID.
    call('PUT', '/cron/jobs/' + JOB_ID, ROLE, proposed)
    actual = next(row for row in call('GET', '/cron/jobs', ROLE) if row['id'] == JOB_ID)
    validate_job(actual, ROLE)
    if actual['enabled'] != proposed['enabled']: raise ValueError('party_life_enable_not_applied')
    after = {name: hashlib.sha256((workspace / name).read_bytes()).hexdigest() for name in before}
    if after != before: raise ValueError('unrelated_role_files_changed')
    result.update(applied=True, enabled=actual['enabled'], backup=str(backup), roleFilesPreserved=True)
    write_json(backup / 'result.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', choices=['qiandengji'])
    parser.add_argument('--enable', action='store_true')
    args = parser.parse_args()
    print(json.dumps(configure(apply=bool(args.apply), enable=args.enable), ensure_ascii=False))
