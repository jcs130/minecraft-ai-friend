"""Read-only local routing/configuration probe; never submits tasks or uses HTTP."""
from pathlib import Path
import hashlib
import hmac
import json
import math
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/ops'))
sys.path.insert(0, str(ROOT / 'world/sidecar'))
from world_agent_profiles import WORLD_ROLES, validate_profile, validate_workspace
from qwen_tasks import LIMITS as NPC_TASK_LIMITS
from native_role_capabilities import package_version
from qwenpaw_runtime_contract import RELEASES

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
PROFILE_SOURCES = ('world_agent_profiles.py', 'role_learning_profiles.py',
    'native_role_capabilities.py', 'native-role-skills.json', 'llm_runtime_policy.py',
    'world_team_profiles.py', 'qwenpaw_runtime_contract.py')

# Host Qwen may deliberately remain on the previous release. Validate an
# upgraded game with its installed native contracts instead of weakening the
# tool/security/package checks to match the host. This only reads state.
NATIVE_PROFILE_PROBE = r'''
import hashlib,json,sys
from pathlib import Path
sys.path.insert(0,'/ops')
from qwenpaw_runtime_contract import release
from role_learning_profiles import validate_guard
from world_agent_profiles import WORLD_ROLES,validate_workspace
version=release()
assert version == sys.argv[1]
state=Path('/state/work')
marker=json.loads((state/'learning-runtime.json').read_text())
assert marker['qwenVersion'] == version
assert validate_guard(state,'game')
def no_enabled(value):
    if isinstance(value,dict):
        return all(item is False if name == 'enabled' else no_enabled(item) for name,item in value.items())
    if isinstance(value,list):
        return all(no_enabled(item) for item in value)
    return True
for role in WORLD_ROLES:
    folder=state/'workspaces'/role
    drivers=folder/'drivers'
    assert not drivers.is_symlink()
    agent=validate_workspace(folder,role,team=True)
    assert no_enabled(agent['acp'])
sources=json.loads(sys.argv[2])
assert all('/' not in name and '\\' not in name for name in sources)
print(json.dumps({'ok':True,'packageVersion':version,'roles':list(WORLD_ROLES),
    'modelCalls':0,'guardVerified':True,'sourceHashes':{
        name:hashlib.sha256((Path('/ops')/name).read_bytes()).hexdigest() for name in sources}}))
'''


def check_native_world_profiles(version, root):
    """Fixed game container only; never redirect arbitrary fixture roots."""
    assert Path(root).resolve() == ROOT.resolve()
    assert version in RELEASES
    result = subprocess.run(['docker', 'exec', 'qiandengji-qwenpaw-1', 'python', '-c',
        NATIVE_PROFILE_PROBE, version, json.dumps(PROFILE_SOURCES)],
        capture_output=True, text=True, encoding='utf-8', timeout=45,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    assert result.returncode == 0 and len(result.stdout.encode('utf8')) <= 16384
    value = json.loads(result.stdout.strip().splitlines()[-1])
    assert value.get('ok') is True and value.get('packageVersion') == version
    assert value.get('roles') == list(WORLD_ROLES) and value.get('modelCalls') == 0
    assert value.get('guardVerified') is True
    assert value.get('sourceHashes') == {name: hashlib.sha256(
        (Path(root)/'world/ops'/name).read_bytes()).hexdigest() for name in PROFILE_SOURCES}


def validate_world_profiles(root):
    root = Path(root)
    state = root / RUNTIMES['game'][0]
    local_version = package_version()
    marker_path = state / 'learning-runtime.json'
    if marker_path.exists():
        marker = read_json(marker_path)
        assert marker.get('runtime') == 'game' and marker.get('qwenVersion') in RELEASES
        target_version = marker['qwenVersion']
    else:
        assert root.resolve() != ROOT.resolve(), 'game_runtime_marker_required'
        target_version = local_version
    if target_version != local_version:
        check_native_world_profiles(target_version, root)
        return
    for role in WORLD_ROLES:
        folder = state / 'workspaces' / role
        agent = read_json(folder / 'agent.json')
        validate_profile(agent, role, team=True)
        assert no_enabled(agent['acp'])
        drivers = folder / 'drivers'
        assert not drivers.is_symlink() and not getattr(drivers, 'is_junction', lambda: False)()
        validate_workspace(folder, role, team=True)


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
            and policy.get('unknownSubmissionRetry') is False
            and all((routes.get(purpose, {}).get('dailyLimit'), routes.get(purpose, {}).get('cooldownSeconds')) == limits
                    for purpose, limits in NPC_TASK_LIMITS.items()))
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
        validate_world_profiles(root)
        checks['quiet_world_task_profiles'] = True
    except (OSError, ValueError, TypeError, KeyError, AttributeError, AssertionError,
            IndexError, subprocess.SubprocessError):
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
        # Native cross-release profile validation can take several seconds;
        # compare the latest heartbeat to the time it was actually sampled.
        checked_now = time.time() if now is None else now
        checks['npc_maid_thread_fresh'] = (
            type(updated) in (int, float) and math.isfinite(updated) and -5 <= checked_now - updated <= 90
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
