"""Read-only deployed party/session, native tools and management projection probe."""
import json
from pathlib import Path
import sys
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]


def get(url, role=None):
    request = urllib.request.Request(url, headers={'X-Agent-Id': role} if role else {})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=5) as response:
        raw = response.read(262145)
    if len(raw) > 262144:
        raise ValueError('response_too_large')
    return json.loads(raw)


def check():
    checks = {}
    before_path = list(sys.path)
    try:
        sys.path[:0] = [str(Path(__file__).resolve().parents[1] / 'world/ops'),
                       str(Path(__file__).resolve().parents[1] / 'world/sidecar'),
                       str(Path(__file__).resolve().parent)]
        from party_role_capabilities import party_members, TOOLS, URL, policy_payload
        from party_config import PartyConfig
        from party_messages import validate_binding
        from maid_registry import MaidRegistry
        from qwen_tasks import read_json
        maids = json.loads((ROOT / 'server/mcdata/village/maid-agents/public/roles.json').read_text(encoding='utf-8-sig'))
        members = party_members(ROOT / 'server/mcdata/village/party/public/roles.json', maids['activeRoleIds'])
        config = PartyConfig(ROOT / 'server/mcdata/village/party').private()
        validate_binding(config)
        projected = sorted([{k: m[k] for k in ('agentId', 'bodyUuid', 'displayName', 'kind')}
                            for m in config['members']], key=lambda m: m['agentId'])
        checks['fixed_two_members'] = len(members) == 2 and list(members) == projected
        maid = next(m for m in config['members'] if m['kind'] == 'maid')
        registry = MaidRegistry(ROOT / 'server/mcdata/village/maid-agents')
        registered = registry.resolve(maid['bodyUuid'], maid['ownerUuid'])
        checks['registered_body_binding'] = all(registered.get(k) == maid[k] for k in ('agentId', 'ownerUuid', 'sessionId'))
        for member in members:
            role = member['agentId']
            actual = get('http://127.0.0.1:18089/api/mcp/tools/qd_party', role)
            checks[member['kind'] + '_party_tools'] = isinstance(actual, list) and len(actual) == len(TOOLS) and {
                t.get('name') for t in actual if t.get('enabled') is True} == set(TOOLS)
            client = get('http://127.0.0.1:18089/api/mcp/qd_party', role)
            checks[member['kind'] + '_party_endpoint'] = (client.get('enabled') is True
                and client.get('url') == URL and client.get('transport') == 'streamable_http'
                and set(client.get('headers', {})) == {'Authorization'}
                and not any(client.get(k) for k in ('command', 'args', 'env', 'cwd'))
                and len(client.get('tools') or []) == len(TOOLS) and set(client.get('tools') or []) == set(TOOLS))
            policy = get('http://127.0.0.1:18089/api/mcp/policy/qd_party', role)
            desired = policy_payload()
            overrides = policy.get('tool_overrides')
            checks[member['kind'] + '_party_policy'] = (policy.get('default_effect') == 'deny'
                and policy.get('client_overrides') == [] and policy.get('tool_defaults') == []
                and policy.get('unmanaged_rules_count') == 0 and isinstance(overrides, list)
                and len(overrides) == len(TOOLS) and all(v in desired['tool_overrides'] for v in overrides)
                and {v['tool_name'] for v in overrides} == set(TOOLS))
            skill = json.loads((ROOT / 'server/agents/work/workspaces' / role / 'skill.json').read_text(encoding='utf-8-sig'))
            checks[member['kind'] + '_cooperation_skill'] = skill.get('skills', {}).get('qd-party-cooperation', {}).get('enabled') is True
        value = json.loads((ROOT / 'server/panel-state/party.json').read_text(encoding='utf-8-sig'))
        checks['supervised_dispatch_fresh'] = (value.get('enabled') is True and value.get('status') == 'running'
            and value.get('error') is None and value.get('partyId') == config['partyId']
            and -5 <= time.time() - value.get('updatedAt', 0) / 1000 <= 90)
        panel = get('http://127.0.0.1:19091/api/state').get('party', {})
        checks['panel_party_live'] = (panel.get('available') is True and panel.get('enabled') is True
            and panel.get('stale') is False and panel.get('status') == 'running' and panel.get('error') is None
            and sorted([{k: m[k] for k in ('agentId', 'kind')} for m in panel.get('members', [])],
                       key=lambda m: m['agentId']) == [{k: m[k] for k in ('agentId', 'kind')} for m in projected])
        session = read_json(ROOT / 'server/survival-agent-state/survival/life-session.json')
        settings = read_json(ROOT / 'server/survival-agent-state/survival/settings.json')
        survivor = next(m for m in config['members'] if m['kind'] == 'survivor')
        checks['persistent_life_identity'] = (session.get('agentId') == 'qd-survivor'
            and all(session.get(k) == survivor[k] for k in ('bodyUuid', 'userId', 'channel'))
            and session.get('primarySessionId') == survivor['sessionId']
            and settings.get('bodyUuid') == survivor['bodyUuid'] and settings.get('ownerUuid') == survivor['ownerUuid']
            and isinstance(session.get('chatId'), str) and str(uuid.UUID(session['chatId'])) == session['chatId'])
        report = ROOT / 'reports/survivor-party-smoke.json'
        evidence = json.loads(report.read_text(encoding='utf-8-sig')) if report.exists() else {}
        checks['verified_behavior'] = evidence.get('ok') is True and all(evidence.get('checks', {}).get(k) is True for k in (
            'same_life_session', 'maid_owned_by_kirito', 'party_request_answer', 'native_tools_active', 'game_world_communication'))
        from smoke_survivor_party import behavior_source_hashes
        checks['verified_game_transport'] = (evidence.get('transport') == 'game_channel_v1'
            and evidence.get('behaviorSourceHashes') == behavior_source_hashes(ROOT))
        checks['behavior_matches_binding'] = (type(evidence.get('schema')) is int and evidence['schema'] == 1
            and evidence.get('partyId') == config['partyId'] and evidence.get('bindingRevision') == config['revision']
            and sorted(evidence.get('members', []), key=lambda m: m['agentId']) == [
                {k: m[k] for k in ('agentId', 'bodyUuid')} for m in projected]
            and evidence.get('lifeSession') == {k: session[k] for k in ('primarySessionId', 'userId', 'channel')})
    except Exception as error:
        checks['probe_completed'] = False
        return {'ok': False, 'checks': checks, 'errorType': type(error).__name__, 'modelCalls': 0, 'worldActions': 0}
    finally:
        sys.path[:] = before_path
    return {'ok': all(checks.values()), 'checks': checks, 'modelCalls': 0, 'worldActions': 0}


if __name__ == '__main__':
    result = check()
    print(json.dumps(result, ensure_ascii=True))
    raise SystemExit(0 if result['ok'] else 1)
