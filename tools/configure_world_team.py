"""Provision the existing project team through native Qwen Agent/File/Skill/MCP/Cron APIs.

No model requests, body/session recreation or daemon. Modes are explicit so the
deployer can restart mounted runtime code between files and driver activation.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'world/ops'), str(ROOT / 'world/sidecar')]
os.environ.setdefault('MAID_ROLES_MANIFEST_FILE', str(ROOT / 'server/mcdata/village/maid-agents/public/roles.json'))
os.environ.setdefault('PARTY_ROLES_MANIFEST_FILE', str(ROOT / 'server/mcdata/village/party/public/roles.json'))
os.environ.setdefault('TEAM_RUNTIME_HOSTS_FILE', str(ROOT / 'server/team-state/runtime-hosts.json'))
from world_team import members
from world_team_hosts import ENGINEER, SOURCE, TARGET, native_host, require_host
from world_team_profiles import bindings, persona_files, policy_payload, check_api
from world_team_schedule import SCHEDULES, team_job, validate_team_job
from role_learning_profiles import skill_references
from native_role_capabilities import configure_native
from mcp_configuration import configure_client

PORTS = {'game': 18089, 'operations': 18090}
LABELS = {'game:mc-god': '灯语女神 · 世界管理', 'game:mc-herald': '灯语女神 · 玩家交流',
          'operations:mc-god': '天神 · 世界工程师',
          'operations:mc-herald': '灯语 · 服务诊断'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('unexpected_qwen_redirect')


def api(runtime, method, path, role, body=None, headers=None):
    if method != 'GET' and {'runtime': runtime, 'agentId': role} in (SOURCE, TARGET):
        require_host(ENGINEER, runtime, role)
    request = urllib.request.Request(f'http://127.0.0.1:{PORTS[runtime]}/api' + path,
        method=method, data=None if body is None else json.dumps(body, ensure_ascii=False).encode(),
        headers={'Content-Type': 'application/json', 'X-Agent-Id': role, **(headers or {})})
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(request, timeout=45) as response:
        raw = response.read(2097153)
    if len(raw) > 2097152: raise ValueError('oversized_native_api_response')
    return json.loads(raw) if raw else None


def file_api(runtime, role, name, value=None, etag=None):
    route = '/workspace/file-content?' + urllib.parse.urlencode({'root': 'workspace', 'path': name})
    result = api(runtime, 'GET' if value is None else 'PUT', route, role,
        None if value is None else {'content': value}, {'If-Match': etag} if etag else {})
    if value is None:
        assert result['eof'] is True and result['truncated'] is False and result.get('etag')
    return result


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def agent_update(profile, **changes):
    """Make a partial native update with the role's explicit language retained."""
    language = profile['language']
    if not isinstance(language, str) or not language.strip():
        raise ValueError('missing_native_role_language')
    if {'id', 'language'} & changes.keys():
        raise ValueError('unrelated_role_identity_or_language_change')
    return {'id': profile['id'], 'name': profile['name'], 'language': language, **changes}


def configure(mode='preview'):
    inventory = members()
    journal = []
    backup = ROOT / 'runtime/world-team-config' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    for actor in inventory:
        host = native_host(actor)
        runtime, role = host['runtime'], host['agentId']
        require_host(actor, runtime, role)
        before = api(runtime, 'GET', '/agents/' + role, role)
        assert before['id'] == role
        if mode == 'preview':
            journal.append({'actor': actor, 'nativeHost': host, 'drivers': list(bindings(role, runtime)), 'cron': actor in SCHEDULES})
            continue
        # Do not race role prompt/tool replacement with a currently active query.
        if mode != 'activate':
            status = api(runtime, 'GET', '/agents/' + role + '/agent-status', role)
            assert status.get('running_task_count') == 0, 'native_role_busy:' + actor
        if mode == 'files':
            files = {name: file_api(runtime, role, name) for name in ('AGENTS.md', 'PROFILE.md', 'SOUL.md')}
            jobs = api(runtime, 'GET', '/cron/jobs', role)
            write(backup / runtime / role / 'before.json', {'agent': before, 'files': files, 'jobs': jobs})
            existing = {name: row['content'] for name, row in files.items()}
            for name, content in persona_files(actor, existing).items():
                file_api(runtime, role, name, content, files[name]['etag'])
                assert file_api(runtime, role, name)['content'] == content
            assert file_api(runtime, role, 'SOUL.md')['content'] == existing['SOUL.md']
            proposed = configure_native(before, role, runtime=runtime)
            api(runtime, 'PUT', '/agents/' + role, role, agent_update(before,
                name=LABELS.get(actor, before['name']), tools=proposed['tools'],
                security=proposed['security'], approval_level=proposed['approval_level']))
            skills = api(runtime, 'GET', '/skills', role)
            if not any(row['name'] == 'qd-world-team' for row in skills):
                api(runtime, 'POST', '/skills', role, {'name': 'qd-world-team', 'enable': True,
                    'content': (ROOT / 'world/ops/skills/qd-world-team/SKILL.md').read_text(encoding='utf-8'),
                    'references': skill_references('qd-world-team')})
            # Remove only the repository's obsolete quota sentence; native scan
            # remains enabled and the rest of this managed skill is unchanged.
            api(runtime, 'PUT', '/skills/save', role, {'name': 'qd-skill-evolution',
                'content': (ROOT / 'world/ops/skills/qd-skill-evolution/SKILL.md').read_text(encoding='utf-8')})
            if actor in SCHEDULES and not any(j['id'] == team_job(actor)['id'] for j in jobs):
                job = team_job(actor); job['enabled'] = False
                api(runtime, 'PUT', '/cron/jobs/' + job['id'], role, job)
        elif mode == 'drivers':
            request = lambda method, path, selected, body=None: api(runtime, method, path, selected, body)
            keys = {row['key'] for row in api(runtime, 'GET', '/mcp', role)}
            ready = False
            try:
                check_api(lambda path: api(runtime, 'GET', path, role), role, runtime)
                ready = True
            except (AssertionError, urllib.error.HTTPError):
                pass
            if not ready:
                for key, client in bindings(role, runtime).items():
                    configure_client(request, role, key, client, policy_payload(client['tools']), exists=key in keys)
            # Native DriverCards and the legacy profile mirror must agree.
            current = api(runtime, 'GET', '/agents/' + role, role)
            mcp = deepcopy(current['mcp']); mcp['clients'].update(bindings(role, runtime))
            if mcp != current['mcp']:
                api(runtime, 'PUT', '/agents/' + role, role, agent_update(current, mcp=mcp))
            check_api(lambda path: api(runtime, 'GET', path, role), role, runtime)
        elif mode == 'activate' and actor in SCHEDULES:
            job = next(j for j in api(runtime, 'GET', '/cron/jobs', role) if j['id'] == team_job(actor)['id'])
            validate_team_job(job, actor)
            if not job['enabled']: api(runtime, 'POST', '/cron/jobs/' + job['id'] + '/resume', role)
        after = api(runtime, 'GET', '/agents/' + role, role)
        for key in ('id', 'language', 'workspace_dir', 'active_model', 'fallback_models', 'running'):
            assert before[key] == after[key], 'unrelated_role_change:' + key
        journal.append({'actor': actor, 'nativeHost': host, 'phase': mode, 'verified': True})
        write(backup / 'journal.json', journal)
        print(json.dumps({'actor': actor, 'phase': mode, 'verified': True}, ensure_ascii=False), flush=True)
    result = {'ok': True, 'mode': mode, 'roles': journal, 'modelCalls': 0,
              'identitiesPreserved': True, 'backup': str(backup) if mode != 'preview' else None}
    if mode != 'preview': write(backup / 'result.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['preview', 'files', 'drivers', 'activate'], default='preview')
    args = parser.parse_args()
    print(json.dumps(configure(args.mode), ensure_ascii=False))
