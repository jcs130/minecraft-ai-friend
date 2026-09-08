"""Read-only local routing/configuration probe; never submits tasks or uses HTTP."""
from pathlib import Path
import hmac
import json
import math
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
from world_agent_profiles import WORLD_ROLES, validate_profile
from role_learning_profiles import validate_learning_workspace

RUNTIMES = {
    'game': ('server/agents/work', 'http://qwenpaw:8088/api'),
    'operations': ('server/operations-agent-state/work', 'http://qwenpaw-ops:8088/api'),
}
ROUTE_NAMES = {
    'world.oracle', 'world.herald', 'world.saga', 'world.evolution_review', 'world.daily_report',
    'survivor.autonomy', 'npc_dialogue', 'guild_quest', 'maid_dialogue',
    'operations.coordination', 'operations.priority', 'operations.diagnostics',
    'operations.events', 'operations.controls', 'operations.exploration',
}
MAID_URL = 'http://npc:8091/v1/chat/completions'
MAID_IDENTITY_URL = 'http://npc:8091/v1/maid/chat/completions'
SMOKE_CHECKS = (
    'routes-resolve-to-enabled-agents', 'three-text-only-profiles',
    'maid-sites-preserved-and-routed', 'maid-adapter-auth-and-budget',
    'native-task-attribution', 'existing-models-and-history-preserved',
)
CHECK_NAMES = (
    'route_manifest_owned', 'all_route_targets_enabled', 'quiet_world_task_profiles',
    'maid_sites_through_agent', 'maid_adapter_token_match', 'npc_maid_thread_fresh',
)


def read_text(path, limit=262144):
    path = Path(path)
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)()
           for p in (path, *path.parents)) or path.stat().st_size > limit:
        raise ValueError('invalid_probe_file')
    with path.open('r', encoding='utf-8-sig') as source:
        text = source.read(limit + 1)
    if len(text) > limit:
        raise ValueError('invalid_probe_file')
    return text


def read_json(path):
    value = json.loads(read_text(path))
    if not isinstance(value, dict):
        raise ValueError('invalid_probe_shape')
    return value


def no_enabled(value):
    if isinstance(value, dict):
        return all(item is False if name == 'enabled' else no_enabled(item)
                   for name, item in value.items())
    if isinstance(value, list):
        return all(no_enabled(item) for item in value)
    return True


def bounded_model_labels(value):
    """Mod-provided display aliases are not the bridge's Qwen model selector."""
    if not isinstance(value, list) or not 1 <= len(value) <= 64:
        return False
    identifiers = set()
    def label(text, maximum=256):
        return isinstance(text, str) and 0 < len(text) <= maximum and all(ord(c) >= 32 and ord(c) != 127 for c in text)
    for entry in value:
        if isinstance(entry, str):
            if not label(entry):
                return False
            identifiers.add(entry)
        elif isinstance(entry, dict):
            if not 1 <= len(entry) <= 8 or not all(label(key, 40) and label(item) for key, item in entry.items()):
                return False
            identifiers.update(entry[key] for key in ('id', 'model', 'name') if key in entry)
        else:
            return False
    return 'qd-maid-dialogue' in identifiers


def probe(root=ROOT, now=None):
    """Return only named booleans/counts, never configuration bodies or credentials."""
    root = Path(root).absolute()
    now = time.time() if now is None else now
    checks = dict.fromkeys(CHECK_NAMES, False)
    routes, sites = {}, {}
    try:
        manifest = read_json(root / 'config/model-task-routes.json')
        routes = manifest.get('routes', {})
        policy = manifest.get('policy', {})
        checks['route_manifest_owned'] = (
            type(manifest.get('schema')) is int and manifest['schema'] == 1 and manifest.get('project') == 'qiandengji'
            and isinstance(routes, dict) and set(routes) == ROUTE_NAMES
            and policy.get('generationOwner') == 'qwenpaw-agent'
            and policy.get('providerCredentialsOwner') == 'qwenpaw'
            and policy.get('automaticProviderFallback') is False
            and policy.get('unknownSubmissionRetry') is False)
        enabled = {}
        for runtime, (folder, _) in RUNTIMES.items():
            profiles = read_json(root / folder / 'config.json')['agents']['profiles']
            enabled[runtime] = {aid for aid, row in profiles.items() if row.get('enabled') is True}
        valid = bool(routes) and checks['route_manifest_owned']
        for row in routes.values():
            runtime, aid = row.get('runtime'), row.get('agentId')
            if runtime not in RUNTIMES or aid not in enabled[runtime] or row.get('apiUrl') != RUNTIMES[runtime][1]:
                valid = False
                continue
            # Only a registered simple role identifier may become a local path.
            if not isinstance(aid, str) or not aid or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in aid):
                valid = False
                continue
            agent = read_json(root / RUNTIMES[runtime][0] / 'workspaces' / aid / 'agent.json')
            valid = valid and agent.get('id') == aid
        checks['all_route_targets_enabled'] = valid
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        pass
    try:
        for role in WORLD_ROLES:
            folder = root / RUNTIMES['game'][0] / 'workspaces' / role
            agent = read_json(folder / 'agent.json')
            validate_profile(agent, role)
            assert no_enabled(agent['acp'])
            validate_learning_workspace(folder, role, 'game')
            drivers = folder / 'drivers'
            assert not drivers.is_symlink() and not getattr(drivers, 'is_junction', lambda: False)()
            assert {p.relative_to(drivers).as_posix() for p in drivers.rglob('*.yaml')
                    if p.name != '.legacy_mcp_migration_report.yaml'} == {'mcp/qd_learning.yaml'}
        checks['quiet_world_task_profiles'] = True
    except (OSError, ValueError, TypeError, KeyError, AttributeError, AssertionError):
        pass
    try:
        sites = read_json(root / 'server/mc/config/touhou_little_maid/sites/llm.json')
        checks['maid_sites_through_agent'] = bool(sites) and any(row.get('enabled') is True for row in sites.values()) and all(
            isinstance(row, dict) and row.get('id') == site_id and type(row.get('enabled')) is bool
            and (row.get('url'), row.get('api_type')) in ((MAID_URL, 'openai'), (MAID_IDENTITY_URL, 'qiandeng-qwen'))
            and bounded_model_labels(row.get('models')) and row.get('headers') == {}
            for site_id, row in sites.items())
        token = read_text(root / 'server/mcdata/village/maid-agent-token', 512).strip()
        valid_token = 32 <= len(token) <= 256 and token.isascii() and all(33 <= ord(c) <= 126 for c in token)
        identity_key_valid = False
        if any(row.get('api_type') == 'qiandeng-qwen' for row in sites.values()):
            identity_key = read_text(root / 'server/mc/config/qiandeng_maid_bridge/identity.key', 258).strip()
            identity_key_valid = (32 <= len(identity_key) <= 256 and identity_key.isascii()
                                  and all(33 <= ord(c) <= 126 for c in identity_key))
        checks['maid_adapter_token_match'] = valid_token and bool(sites) and all(
            (identity_key_valid and row.get('secret_key') == '' if row.get('api_type') == 'qiandeng-qwen'
             else isinstance(row.get('secret_key'), str) and row['secret_key'].isascii()
                  and hmac.compare_digest(row['secret_key'], token)) for row in sites.values())
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        pass
    try:
        heartbeat = read_json(root / 'server/mcdata/npc-health.json')
        updated = heartbeat.get('updated_at')
        checks['npc_maid_thread_fresh'] = (
            type(updated) in (int, float) and math.isfinite(updated) and -5 <= now - updated <= 90
            and heartbeat.get('maid_agent_enabled') is True
            and heartbeat.get('threads', {}).get('maid-agent') is True)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, OverflowError):
        pass
    return {'project': 'qiandengji', 'ok': all(checks.values()), 'checks': checks,
            'routeCount': len(routes) if isinstance(routes, dict) else 0,
            'maidSiteCount': len(sites), 'modelCalls': 0,
            'scope': 'Current local routing, closed task profiles and fresh adapter heartbeat; recorded native-task behavior checked separately.'}


if __name__ == '__main__':
    result = probe()
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result['ok'] else 1)
