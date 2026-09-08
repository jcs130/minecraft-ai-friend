"""Read project-owned Agent processes, native skills and schedules; never calls LLMs."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
from agent_learning import GAME_ROLES, OPS_ROLES, TOOL_NAMES
from native_role_capabilities import NATIVE_TOOLS, NATIVE_SKILLS


def get(port, route, role=None):
    request = urllib.request.Request(f'http://127.0.0.1:{port}/api' + route, headers={'X-Agent-Id': role} if role else {})
    with urllib.request.urlopen(request, timeout=12) as response: raw = response.read(262145)
    if len(raw) > 262144: raise ValueError('audit_response_limit')
    return json.loads(raw)


def audit():
    report = {'schema': 1, 'project': 'qiandengji', 'checkedAt': datetime.now(timezone.utc).isoformat(),
        'runtimes': {}, 'supervision': {}, 'modelCalls': 0, 'worldActions': 0}
    for name, port, expected in (('game', 18089, set(GAME_ROLES)), ('operations', 18090, set(OPS_ROLES))):
        if name == 'game':
            manifest = ROOT / 'server/mcdata/village/maid-agents/public/roles.json'
            if manifest.exists(): expected |= set(json.loads(manifest.read_text(encoding='utf8'))['activeRoleIds'])
        agents = get(port, '/agents')['agents']
        enabled = {a['id'] for a in agents if a.get('enabled')}
        rows = []
        for role in sorted(expected):
            skills = get(port, '/skills', role)
            jobs = get(port, '/cron/jobs', role)
            tools = get(port, '/mcp/tools/qd_learning', role)
            native_tools = get(port, '/tools', role)
            state = get(port, '/agents/' + role + '/agent-status')
            rows.append({'id': role, 'skills': [s['name'] for s in skills if s.get('enabled')],
                'jobs': [{'id': j['id'], 'name': j['name'], 'enabled': j['enabled'], 'schedule': j['schedule'],
                    'taskType': j['task_type']} for j in jobs], 'learningTools': sorted(t['name'] for t in tools if t.get('enabled')),
                'nativeTools': sorted(t['name'] for t in native_tools if t.get('enabled')),
                'status': state.get('status'), 'runningTaskCount': state.get('running_task_count')})
        report['runtimes'][name] = {'ok': enabled == expected and all(
            'qd-skill-evolution' in row['skills'] and set(row['learningTools']) == set(TOOL_NAMES)
            and set(NATIVE_SKILLS) <= set(row['skills']) and set(row['nativeTools']) == set(NATIVE_TOOLS)
            and any(j['id'] == 'qd-learning-' + row['id'] for j in row['jobs']) for row in rows), 'agents': rows}
    for service in ('qwenpaw', 'qwenpaw-ops', 'survivor'):
        container = 'qiandengji-' + service + '-1'
        # Docker inspect has secrets; select only these fields in-memory.
        raw = subprocess.check_output(['docker', 'inspect', container], timeout=15)
        row = json.loads(raw)[0]
        report['supervision'][service] = {'container': container, 'running': row['State']['Running'],
            'restartPolicy': row['HostConfig']['RestartPolicy']['Name'],
            'health': row['State'].get('Health', {}).get('Status'),
            'managedBy': 'Docker Compose', 'role': 'Qwen native runtime' if service != 'survivor' else 'Fast game execution adapter; no separate LLM agent'}
    sources = ['world/ops/agent_learning.py', 'world/ops/agent_learning_mcp.py', 'world/ops/cron_guard.py',
        'world/ops/learning_service.py', 'world/ops/native_tool_runtime.py', 'world/ops/native_role_capabilities.py',
        'world/ops/native-role-skills.json', 'world/ops/role_learning_profiles.py',
        'world/survival/game_service.py', 'compose.yml', 'tools/audit_agent_runtime.py']
    report['sourceHashes'] = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in sources}
    report['ok'] = all(r['ok'] for r in report['runtimes'].values()) and all(
        r['running'] and r['restartPolicy'] == 'unless-stopped' and r['health'] == 'healthy' for r in report['supervision'].values())
    report['scope'] = 'Native Qwen API exposure and Docker supervision. Does not assert model task success or inspect unrelated host agents.'
    (ROOT / 'reports/agent-runtime-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    return report


if __name__ == '__main__':
    try:
        report = audit()
        print(json.dumps({'ok': report['ok'], 'runtimes': {key: {'roles': len(value['agents']),
            'skillBindings': sum(len(a['skills']) for a in value['agents'])} for key, value in report['runtimes'].items()},
            'supervision': report['supervision'], 'modelCalls': 0}, ensure_ascii=False))
        sys.exit(0 if report['ok'] else 1)
    except Exception as exc:
        print(json.dumps({'ok': False, 'errorType': type(exc).__name__, 'modelCalls': 0}))
        sys.exit(1)
