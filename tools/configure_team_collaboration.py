"""Apply team capabilities to the exact live Qwen instances using native APIs."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'tools'), str(ROOT / 'world/ops'), str(ROOT / 'world/sidecar')]
from configure_world_team import api, members, native_host, file_api, agent_update, write
from native_role_capabilities import configure_native
from world_team_profiles import client, policy_payload, persona_files, check_api
from mcp_configuration import configure_client
from sync_team_skills import sync


def configure(apply=False):
    inventory = members()
    folder = ROOT / 'runtime/team-collaboration' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    rows = []
    for actor, (name, responsibility) in inventory.items():
        host = native_host(actor); runtime, role = host['runtime'], host['agentId']
        status = api(runtime, 'GET', '/agents/' + role + '/agent-status', role)
        if status.get('running_task_count') != 0:
            raise ValueError('native_role_busy:' + actor)
        profile = api(runtime, 'GET', '/agents/' + role, role)
        jobs = api(runtime, 'GET', '/cron/jobs', role)
        rows.append({'actor': actor, 'runtime': runtime, 'role': role, 'profile': profile, 'jobs': jobs})
    if not apply:
        return {'ok': True, 'apply': False, 'roles': [r['actor'] for r in rows], 'modelCalls': 0}
    write(folder / 'before.json', rows)
    journal = {'phase': 'pausing-native-jobs', 'paused': [], 'configured': []}
    write(folder / 'journal.json', journal)
    for row in rows:
        for job in row['jobs']:
            if job.get('enabled') and job['id'].startswith(('qd-team-', 'qd-learning-', 'qd-life-', 'qd-world-')):
                api(row['runtime'], 'POST', '/cron/jobs/' + job['id'] + '/pause', row['role'])
                journal['paused'].append({'runtime': row['runtime'], 'role': row['role'], 'jobId': job['id']})
                write(folder / 'journal.json', journal)
    for row in rows:
        runtime, role, actor = row['runtime'], row['role'], row['actor']
        if api(runtime, 'GET', '/agents/' + role + '/agent-status', role).get('running_task_count') != 0:
            raise ValueError('native_role_became_busy:' + actor)
        before = api(runtime, 'GET', '/agents/' + role, role)
        proposed = configure_native(before, role, runtime)
        api(runtime, 'PUT', '/agents/' + role, role, agent_update(before,
            description=inventory[actor][1], tools=proposed['tools'], security=proposed['security'],
            approval_level=proposed['approval_level']))
        files = {n: file_api(runtime, role, n) for n in ('AGENTS.md', 'PROFILE.md', 'SOUL.md')}
        write(folder / runtime / role / 'files-before.json', files)
        for name, content in persona_files(actor, {n: r['content'] for n, r in files.items()}).items():
            file_api(runtime, role, name, content, files[name]['etag'])
        old_client = before['mcp']['clients']['qd_world_team']
        wanted = client(role, runtime)
        def call(method, path, selected, body=None):
            return api(runtime, method, path, selected, body)
        configure_client(call, role, 'qd_world_team', wanted, policy_payload(wanted['tools']),
            exists=True, previous_tools=old_client['tools'])
        current = api(runtime, 'GET', '/agents/' + role, role)
        mcp = current['mcp']; mcp['clients']['qd_world_team'] = wanted
        api(runtime, 'PUT', '/agents/' + role, role, agent_update(current, mcp=mcp))
        check_api(lambda path: api(runtime, 'GET', path, role), role, runtime)
        after = api(runtime, 'GET', '/agents/' + role, role)
        for key in ('id', 'name', 'language', 'workspace_dir', 'active_model', 'running'):
            assert after[key] == before[key], 'unrelated_role_change:' + key
        assert file_api(runtime, role, 'SOUL.md')['content'] == files['SOUL.md']['content']
        journal['configured'].append(actor); write(folder / 'journal.json', journal)
        print(json.dumps({'configured': actor}, ensure_ascii=False), flush=True)
    sync(list(inventory), ['qd-world-team'], apply=True)
    journal['phase'] = 'configured-await-runtime-reload'
    write(folder / 'journal.json', journal)
    return {'ok': True, 'backup': str(folder), 'roles': len(rows), 'jobsPaused': len(journal['paused']),
            'modelCalls': 0, 'resumeRequiredAfterVerification': True}


def resume(folder):
    folder = Path(folder).resolve()
    assert folder.is_relative_to((ROOT / 'runtime/team-collaboration').resolve())
    path = folder / 'journal.json'; journal = json.loads(path.read_text(encoding='utf-8'))
    for row in journal['paused']:
        state = api(row['runtime'], 'GET', '/cron/jobs/' + row['jobId'], row['role'])
        if not state['spec']['enabled']:
            api(row['runtime'], 'POST', '/cron/jobs/' + row['jobId'] + '/resume', row['role'])
    journal['phase'] = 'native-jobs-restored'; write(path, journal)
    return {'ok': True, 'resumed': len(journal['paused'])}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--resume', type=Path)
    args = parser.parse_args()
    print(json.dumps(resume(args.resume) if args.resume else configure(args.apply), ensure_ascii=False))
