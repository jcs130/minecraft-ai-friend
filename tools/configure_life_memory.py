"""Configure native Qwen memory/persona files for the existing Kirito/Yui pair.

Preview is read-only. Apply requires a drained life controller and stopped NPC
ingress. Native API updates preserve model choices, drivers, and conversations.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/ops'), str(ROOT / 'world/sidecar'), str(ROOT / 'world/survival')]
os.environ.setdefault('PARTY_ROLES_MANIFEST_FILE', str(ROOT / 'server/mcdata/village/party/public/roles.json'))
os.environ.setdefault('MAID_ROLES_MANIFEST_FILE', str(ROOT / 'server/mcdata/village/maid-agents/public/roles.json'))
from configure_survivor_party import api
from configure_sao_characters import require_idle, require_terminal_tasks
from life_memory_policy import apply_profile, validate_profile
from life_persona import prepare_files
from life_review_schedule import managed_job, validate_job, JOB_ID
from native_role_capabilities import configure_native
from party_role_capabilities import party_members
from qwen_tasks import write_json, NoRedirect


def file_api(role, path, content=None, etag=None):
    route = '/workspace/file-content?' + urllib.parse.urlencode({'root': 'workspace', 'path': path})
    headers = {'X-Agent-Id': role, 'Content-Type': 'application/json'}
    if etag: headers['If-Match'] = etag
    request = urllib.request.Request('http://127.0.0.1:18089/api' + route,
        method='GET' if content is None else 'PUT', headers=headers,
        data=None if content is None else json.dumps({'content': content}, ensure_ascii=False).encode())
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=25) as response:
            raw = response.read(262145)
    except urllib.error.HTTPError as error:
        if content is None and error.code == 404: return None
        raise
    if len(raw) > 262144: raise ValueError('workspace_response_too_large')
    value = json.loads(raw)
    if content is None and (value.get('eof') is not True or value.get('truncated') is not False
                            or not isinstance(value.get('content'), str) or not value.get('etag')):
        raise ValueError('complete_workspace_file_required')
    return value


def create_file(role, path, content):
    """Native upload refuses a concurrent existing file instead of overwriting it."""
    relative = Path(path)
    folder = ROOT / 'server/agents/work/workspaces' / role / relative.parent
    assert folder.resolve().is_relative_to((ROOT / 'server/agents/work/workspaces' / role).resolve())
    folder.mkdir(parents=True, exist_ok=True)
    boundary = 'qd' + uuid.uuid4().hex
    body = ('--' + boundary + '\r\nContent-Disposition: form-data; name="files"; filename="' + relative.name +
            '"\r\nContent-Type: text/markdown; charset=utf-8\r\n\r\n' + content + '\r\n--' + boundary + '--\r\n').encode()
    route = '/workspace/file-upload?' + urllib.parse.urlencode({
        'root': 'workspace', 'path': '' if relative.parent == Path('.') else relative.parent.as_posix()})
    request = urllib.request.Request('http://127.0.0.1:18089/api' + route, method='POST', data=body,
        headers={'X-Agent-Id': role, 'Content-Type': 'multipart/form-data; boundary=' + boundary})
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=25) as response:
        return json.loads(response.read(262144))


def configure(apply=False):
    members = party_members()
    assert len(members) == 2 and {m['displayName'] for m in members} == {'桐人', '结衣'}
    plans = []
    for member in members:
        role = member['agentId']
        before = api('GET', '/agents/' + role, role)
        proposed = configure_native(apply_profile(before, role), role)
        files = {path: file_api(role, path) for path in
                 ('AGENTS.md', 'SOUL.md', 'PROFILE.md', 'MEMORY.md', 'memory/goals.md')}
        desired = prepare_files(role, member['displayName'],
            {path: value['content'] for path, value in files.items() if value is not None})
        plans.append({'role': role, 'before': before, 'proposed': proposed, 'files': files, 'desired': desired})
    jobs = api('GET', '/cron/jobs', 'qd-survivor')
    found = [job for job in jobs if job['id'] == JOB_ID]
    assert len(found) <= 1
    if found: validate_job(found[0], 'qd-survivor')
    result = {'ok': True, 'mode': 'apply' if apply else 'preview',
        'roles': [{'role': row['role'], 'files': sorted(row['desired']),
                   'memoryChanged': row['before']['running'] != row['proposed']['running']} for row in plans],
        'cron': JOB_ID, 'cronAlreadyPresent': bool(found), 'modelCalls': 0, 'worldActions': 0}
    if not apply: return result
    require_idle(next(m['agentId'] for m in members if m['kind'] == 'maid'))
    require_terminal_tasks(next(m['agentId'] for m in members if m['kind'] == 'maid'))
    import subprocess
    assert subprocess.check_output(['docker', 'inspect', '--format', '{{.State.Running}}',
        'qiandengji-npc-1'], timeout=15, text=True).strip() == 'false', 'NPC ingress must be stopped'
    backup = ROOT / 'runtime/life-memory-configuration' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    write_json(backup / 'before.json', {'plans': plans, 'jobs': jobs})
    journal = {'steps': [], 'modelCallsSubmittedByConfigurator': 0}
    def mark(step):
        journal['steps'].append(step); write_json(backup / 'journal.json', journal)
    # Prepare files before enabling background memory work.
    for row in plans:
        role = row['role']
        for path, content in row['desired'].items():
            prior = row['files'].get(path)
            if prior is None: create_file(role, path, content)
            else: file_api(role, path, content, prior['etag'])
            if file_api(role, path)['content'] != content: raise ValueError('persona_file_not_applied')
            mark(role + '/' + path)
    for row in plans:
        role, proposed, before = row['role'], row['proposed'], row['before']
        current = api('GET', '/agents/' + role, role)
        if any(current[key] != before[key] for key in ('running', 'security', 'active_model')):
            raise ValueError('concurrent_agent_configuration_change')
        if any(proposed[key] != before[key] for key in ('running', 'security')):
            # Official agent update merges these top-level fields under its lock.
            # The embedding settings are identical, so no vector-space migration.
            api('PUT', '/agents/' + role, role, {'id': role, 'name': before['name'],
                'running': proposed['running'], 'security': proposed['security']})
        actual = api('GET', '/agents/' + role, role)
        validate_profile(actual, role)
        for key in ('active_model', 'mcp', 'workspace_dir', 'id', 'name'):
            if actual[key] != before[key]: raise ValueError('unrelated_agent_configuration_changed:' + key)
        mark(role + '/native-memory')
    if not found:
        # Starts disabled; the deployer enables after the new cron adapter and
        # survivor request_review endpoint have both been verified active.
        job = managed_job(); job['enabled'] = False
        # POST deliberately replaces client IDs with a UUID in Qwen 2.2.
        # Native PUT create-or-replace keeps this single managed identity.
        api('PUT', '/cron/jobs/' + JOB_ID, 'qd-survivor', job)
        mark('native-cron-created-paused')
    actual_jobs = api('GET', '/cron/jobs', 'qd-survivor')
    actual = next(job for job in actual_jobs if job['id'] == JOB_ID)
    validate_job(actual, 'qd-survivor')
    result.update(backup=str(backup), configured=True, cronEnabled=actual['enabled'])
    write_json(backup / 'receipt.json', result)
    return result


def activate_runtime():
    """Enable the reviewed signal after the new MCP endpoint is running."""
    import time
    from mcp_server import TOOL_NAMES
    assert len(TOOL_NAMES) == 44 and 'request_review' in TOOL_NAMES
    role = 'qd-survivor'
    control = json.loads((ROOT / 'server/survival-agent-state/survival/control.json').read_text(encoding='utf-8-sig'))
    controller = json.loads((ROOT / 'server/survival-agent-state/survival/controller.json').read_text(encoding='utf-8-sig'))
    assert control.get('enabled') is False and not controller.get('active'), 'drained controller required'
    value = api('GET', '/mcp/tools/numen_survival', role)
    assert {row['name'] for row in value} == set(TOOL_NAMES), 'new MCP endpoint required'
    client = api('GET', '/mcp/numen_survival', role)
    assert client.get('url') == 'http://survivor:8089/mcp' and client.get('enabled') is True
    assert set(client.get('tools') or []) in (set(TOOL_NAMES), set(TOOL_NAMES) - {'request_review'})
    before = api('GET', '/mcp/policy/numen_survival', role)
    assert before['default_effect'] == 'deny' and before['unmanaged_rules_count'] == 0
    assert not before['client_overrides'] and not before['tool_overrides']
    assert all(row['effect'] == 'allow' for row in before['tool_defaults'])
    assert {row['tool_name'] for row in before['tool_defaults']} in (set(TOOL_NAMES), set(TOOL_NAMES) - {'request_review'})
    proposed = {key: deepcopy(before[key]) for key in ('default_effect', 'client_overrides', 'tool_defaults', 'tool_overrides')}
    if not any(row['tool_name'] == 'request_review' for row in proposed['tool_defaults']):
        proposed['tool_defaults'].append({'tool_name': 'request_review', 'effect': 'allow'})
    backup = ROOT / 'runtime/life-memory-activation' / str(time.time_ns())
    write_json(backup / 'before.json', {'client': client, 'policy': before})
    # Preserve credentials and all existing rules; write policy before the
    # native whitelist reconnect so it cannot restore the old deny policy.
    api('PUT', '/mcp/policy/numen_survival', role, proposed)
    api('PUT', '/mcp/tools/numen_survival', role, {'tools': list(TOOL_NAMES)})
    deadline = time.monotonic() + 30
    while True:
        value = api('GET', '/mcp/tools/numen_survival', role)
        if len(value) == 44 and all(row.get('enabled') is True for row in value): break
        if time.monotonic() >= deadline: raise ValueError('native_review_tool_not_ready')
        time.sleep(.25)
    actual = api('GET', '/mcp/policy/numen_survival', role)
    assert all(actual[key] == proposed[key] for key in proposed)
    after_client = api('GET', '/mcp/numen_survival', role)
    assert all(after_client.get(key) == client.get(key) for key in ('url', 'transport', 'headers', 'command', 'args', 'env', 'cwd'))
    # The 2.2 whitelist API updates the authoritative DriverCard only. Keep
    # the existing legacy mirror consistent through the native profile API;
    # use the local original so masked credentials are never written back.
    profile_path = ROOT / 'server/agents/work/workspaces' / role / 'agent.json'
    profile = json.loads(profile_path.read_text(encoding='utf-8-sig'))
    legacy = profile['mcp']['clients']['numen_survival']
    assert legacy['url'] == after_client['url'] and legacy['transport'] == after_client['transport']
    if set(legacy.get('tools') or []) != set(TOOL_NAMES):
        assert set(legacy.get('tools') or []) == set(TOOL_NAMES) - {'request_review'}
        write_json(backup / 'legacy-profile-before.json', profile)
        legacy['tools'] = list(TOOL_NAMES)
        api('PUT', '/agents/' + role, role, {'id': role, 'name': profile['name'], 'mcp': profile['mcp']})
    job = next(job for job in api('GET', '/cron/jobs', role) if job['id'] == JOB_ID)
    validate_job(job, role)
    api('POST', '/cron/jobs/' + JOB_ID + '/resume', role)
    actual_job = next(job for job in api('GET', '/cron/jobs', role) if job['id'] == JOB_ID)
    assert actual_job['enabled'] is True
    result = {'ok': True, 'cron': JOB_ID, 'nativeTools': 44,
              'controllerStillPaused': True, 'modelCalls': 0, 'worldActions': 0, 'backup': str(backup)}
    write_json(backup / 'receipt.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--apply', choices=['qiandengji'])
    actions.add_argument('--activate', choices=['qiandengji'])
    args = parser.parse_args()
    print(json.dumps(activate_runtime() if args.activate else configure(bool(args.apply)), ensure_ascii=True))
