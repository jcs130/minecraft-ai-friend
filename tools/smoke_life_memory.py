"""Read native life-memory configuration, scheduler and real persisted evidence.

Never submits a model, Dream, timer or game action. A configured capability and
an observed learning result are deliberately reported as separate facts.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import sys

from configure_life_memory import ROOT, api, party_members, validate_profile
from life_review_schedule import JOB_ID, validate_job


def smoke():
    roles = []
    for member in party_members():
        role = member['agentId']
        profile = api('GET', '/agents/' + role, role)
        validate_profile(profile, role)
        runtime = api('GET', '/agents/' + role + '/memory/runtime-status', role)
        status = api('GET', '/agents/' + role + '/memory/status', role)
        workspace = ROOT / 'server/agents/work/workspaces' / role
        files = []
        for folder in ('memory', 'digest'):
            for path in sorted((workspace / folder).rglob('*.md')):
                if path.is_symlink():
                    raise ValueError('linked_memory_evidence')
                data = path.read_bytes()
                files.append({'path': path.relative_to(workspace).as_posix(), 'bytes': len(data),
                              'sha256': hashlib.sha256(data).hexdigest()})
        # Keep status statistics but never publish source conversations or note content.
        roles.append({'role': role, 'name': member['displayName'],
            'memory': profile['running']['reme_light_memory_config'],
            'worker': runtime['worker'],
            'autoMemoryCompleted': [{'id': task['task_id'], 'finishedAt': task.get('finished_at'),
                'messageCount': task.get('message_count')} for task in runtime.get('tasks', [])
                if task.get('status') == 'completed'],
            'memoryStatusReadable': isinstance(status, dict), 'files': files})
        # The selected public config must not include future credential-bearing fields.
        config = roles[-1]['memory']
        roles[-1]['memory'] = {key: config.get(key) for key in (
            'auto_memory_interval', 'memory_search_enabled', 'auto_memory_search_config',
            'dream_cron_enabled', 'dream_cron')}
    cron = api('GET', '/cron/jobs/' + JOB_ID, 'qd-survivor')
    validate_job(cron['spec'], 'qd-survivor')
    state = ROOT / 'server/survival-agent-state/survival'
    read = lambda name: json.loads((state / name).read_text(encoding='utf-8-sig'))
    session, controller, control = read('life-session.json'), read('controller.json'), read('control.json')
    with sqlite3.connect((state / 'reviews.sqlite3').as_uri() + '?mode=ro', uri=True) as db:
        signals = db.execute('SELECT seq,reason,at FROM requests ORDER BY seq').fetchall()
        acknowledgements = db.execute('SELECT watermark,task_id,at FROM acknowledgements ORDER BY watermark').fetchall()
    result = {'schema': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(),
        'configured': len(roles) == 2 and all(role['memoryStatusReadable'] for role in roles),
        'roles': roles, 'cron': {'id': JOB_ID, 'enabled': cron['spec']['enabled'],
            'schedule': cron['spec']['schedule'], 'state': cron.get('state')},
        'life': {'enabled': control['enabled'], 'status': controller['status'],
            'sessionId': session['primarySessionId'], 'chatId': session['chatId'],
            'bodyUuid': session['bodyUuid'],
            'activeTask': (controller.get('active') or {}).get('taskId'),
            'lastTask': (controller.get('lastDecision') or {}).get('taskId')},
        'reviewSignals': [{'id': row[0], 'reason': row[1], 'at': row[2]} for row in signals],
        'reviewAcknowledgements': [{'watermark': row[0], 'taskId': row[1], 'at': row[2]}
                                  for row in acknowledgements],
        'modelCallsSubmittedByProbe': 0, 'worldActions': 0,
        'scope': 'Native configuration, readable memory statistics and persisted files/receipts; '
                 'does not certify factual accuracy, new game skills, full-night sleep or endless autonomy.'}
    (ROOT / 'reports/qwen-life-memory-smoke.json').write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    result = smoke()
    print(json.dumps({'configured': result['configured'], 'life': result['life'],
        'cron': result['cron'], 'roles': [{'role': r['role'],
            'completedAutoMemoryTasks': len(r['autoMemoryCompleted']), 'files': len(r['files'])}
            for r in result['roles']], 'modelCallsSubmittedByProbe': 0}, ensure_ascii=True))
    sys.exit(0 if result['configured'] else 1)
