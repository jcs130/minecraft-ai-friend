"""Read-only native maid readiness; never returns names, personality text or credentials."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'world/sidecar'))
from maid_native_tools import NativeRcon, parse_reply

SMOKE_CHECKS = (
    'real-neoforge-start', 'two-owned-isolated-bodies', 'native-deepseek-site-codec',
    'native-persona-fixture', 'loaded-identity-discovery', 'native-identity', 'native-persona-diagnostic',
    'native-context', 'native-task-catalog', 'cross-owner-rejected', 'native-state-switch-and-restore',
    'durable-idempotence-no-reapply', 'request-id-conflict', 'native-follow-schedule-work',
    'real-native-chat-callback', 'signed-two-identity-isolation', 'isolated-save-written',
    'save-restart-identity-preserved', 'save-restart-idempotence-preserved', 'isolated-services-removed',
)


def read(path, limit=262144):
    path = Path(path)
    if (any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents))
            or not path.is_file() or path.stat().st_size > limit):
        raise ValueError('invalid_probe_file')
    value = json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(value, dict): raise ValueError('invalid_probe_shape')
    return value


def adapter_health():
    # Only this fixed read-only HTTP request is permitted. Raw error text is never returned.
    expected = hashlib.sha256((ROOT / 'server/mc/config/qiandeng_maid_bridge/identity.key').read_text('ascii').strip().encode('ascii')).hexdigest()
    script = "import hashlib,json,os,sys,urllib.request; from pathlib import Path; r=urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:8091/healthz',timeout=5); raw=r.read(16385); assert len(raw)<=16384; value=json.loads(raw); value['mountedIdentityKeyMatches']=hashlib.sha256(Path(os.environ['MAID_IDENTITY_KEY_FILE']).read_text('ascii').strip().encode('ascii')).hexdigest()==sys.argv[1]; print(json.dumps(value))"
    result = subprocess.run(['docker', 'exec', 'qiandengji-npc-1', 'python', '-c', script, expected],
        capture_output=True, text=True, encoding='utf8', errors='replace', timeout=12)
    if result.returncode != 0 or len(result.stdout) > 16384: raise ValueError('maid_adapter_unavailable')
    return json.loads(result.stdout)


def check(root=ROOT, now=None, run_rcon=None, fetch=adapter_health):
    root, now = Path(root), time.time() if now is None else now
    checks = {key: False for key in ('shared_mod_installed', 'signed_site_configuration',
        'identity_key_present', 'native_loaded_discovery', 'native_diagnostic_available',
        'owned_chat_settings', 'managed_settings_reload_safe', 'signed_adapter_ready',
        'registered_bindings_valid', 'isolated_native_smoke')}
    counts = {'loadedMaids': 0, 'ownedLoadedMaids': 0, 'loadedMaidsMissingNativeSettings': 0,
              'ownedLoadedMaidsMissingNativeSettings': 0, 'registeredCharacters': 0}
    config_hash = None
    try:
        record = read(root / 'world/maid-bridge-src/build/build-record.json', 1048576)
        expected = record['sha256']
        checks['shared_mod_installed'] = all(hashlib.sha256((root / location).read_bytes()).hexdigest() == expected
            for location in ('server/mc/mods/qiandeng-maid-bridge-0.1.0.jar', 'client/mods/qiandeng-maid-bridge-0.1.0.jar'))
        checks['shared_mod_installed'] = checks['shared_mod_installed'] and bool(record.get('sources')) and all(
            isinstance(path, str) and (root / path).resolve().is_relative_to(root.resolve())
            and hashlib.sha256((root / path).read_bytes()).hexdigest() == digest for path, digest in record.get('sources', {}).items())
        sites_path = root / 'server/mc/config/touhou_little_maid/sites/llm.json'
        sites = read(sites_path)
        checks['signed_site_configuration'] = (0 < len(sites) <= 64 and all(isinstance(v, dict)
            and v.get('id') == k and v.get('api_type') == 'qiandeng-qwen'
            and v.get('url') == 'http://npc:8091/v1/maid/chat/completions'
            and v.get('secret_key', '') == '' and not v.get('headers') for k, v in sites.items()))
        if checks['signed_site_configuration']: config_hash = hashlib.sha256(sites_path.read_bytes()).hexdigest()
        legacy = root / 'server/mc/config/touhou_little_maid/settings'
        pack = root / 'server/mc/tlm_custom_pack/qiandeng-native-chat-1.0.0/assets/qiandeng_bridge/settings'
        checks['managed_settings_reload_safe'] = all(
            not path.is_symlink() and not (pack / path.name).is_symlink()
            and path.stat().st_size <= 65536 and (pack / path.name).is_file()
            and path.read_bytes() == (pack / path.name).read_bytes()
            for path in legacy.glob('qd-bridge-*.yml'))
        key_path = root / 'server/mc/config/qiandeng_maid_bridge/identity.key'
        if not key_path.is_symlink() and key_path.is_file() and key_path.stat().st_size <= 258:
            key = key_path.read_text('ascii').strip()
            checks['identity_key_present'] = 32 <= len(key) <= 256 and all(33 <= ord(c) <= 126 for c in key)
        native = run_rcon or NativeRcon(host='127.0.0.1', port=25577, password_file=root / 'server/world-data/rcon-secret.txt')
        seen = set(); total = None; offset = 0; rows = []
        for _ in range(16):
            reply = parse_reply(native('qdmaid list ' + str(offset)))
            if (reply.get('ok') is not True or reply.get('code') != 'loaded_maids_observed'
                or reply.get('unloadedNotScanned') is not True or not isinstance(reply.get('maids'), list)
                or not -5000 <= now * 1000 - reply.get('observedAt', 0) <= 15000):
                raise ValueError('invalid_loaded_discovery')
            current_total = reply.get('totalLoaded')
            if type(current_total) is not int or not 0 <= current_total <= 64 or (total is not None and current_total != total):
                raise ValueError('loaded_discovery_changed')
            total = current_total
            for maid in reply['maids']:
                uid = maid.get('maidUuid')
                if uid in seen or not isinstance(uid, str) or not re.fullmatch('[a-f0-9-]{36}', uid):
                    raise ValueError('invalid_discovery_identity')
                seen.add(uid); rows.append(maid)
            if reply.get('truncated') is False: break
            new_offset = reply.get('nextOffset')
            if type(new_offset) is not int or new_offset <= offset: raise ValueError('discovery_not_progressing')
            offset = new_offset
        checks['native_loaded_discovery'] = total == len(rows)
        checks['native_diagnostic_available'] = all(type(m.get('nativeChatSetting')) is bool for m in rows)
        counts['loadedMaids'] = len(rows)
        counts['ownedLoadedMaids'] = sum(m.get('ownerUuid') is not None for m in rows)
        counts['loadedMaidsMissingNativeSettings'] = sum(m.get('nativeChatSetting') is not True for m in rows)
        counts['ownedLoadedMaidsMissingNativeSettings'] = sum(m.get('ownerUuid') is not None and m.get('nativeChatSetting') is not True for m in rows)
        checks['owned_chat_settings'] = checks['native_diagnostic_available'] and counts['ownedLoadedMaidsMissingNativeSettings'] == 0
        adapter = fetch()
        checks['signed_adapter_ready'] = (adapter.get('ok') is True and adapter.get('trustedIdentityEnabled') is True
            and adapter.get('nativeMcpEnabled') is True and adapter.get('mountedIdentityKeyMatches') is True)
        registry = read(root / 'server/mcdata/village/maid-agents/public/roles.json')
        ids = registry.get('activeRoleIds', [])
        count = registry.get('registeredCount')
        checks['registered_bindings_valid'] = (registry.get('schema') == 1 and registry.get('bindingsValid') is True
            and registry.get('independentSessions') is True and type(count) is int and isinstance(ids, list)
            and all(isinstance(i, str) for i in ids) and count == len(ids) == len(set(ids)) and 0 <= count <= 64
            and adapter.get('registry') == registry)
        counts['registeredCharacters'] = count if type(count) is int else 0
        smoke = read(root / 'reports/maid-bridge-smoke.json', 1048576)
        checks['isolated_native_smoke'] = (smoke.get('ok') is True and smoke.get('jarSha256') == expected
            and smoke.get('modelCalls') == 0 and smoke.get('ttsCalls') == 0 and smoke.get('productionMutations') == 0
            and all(smoke.get('checks', {}).get(name) is True for name in SMOKE_CHECKS)
            and smoke.get('fixtureSha256') == hashlib.sha256((root / 'world/maid-bridge-src/qa/MaidQa.java').read_bytes()).hexdigest()
            and smoke.get('toolSha256') == hashlib.sha256((root / 'tools/smoke_maid_bridge.py').read_bytes()).hexdigest())
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        pass
    return {'ok': all(checks.values()), 'checks': checks, **counts, 'siteConfigSha256': config_hash,
        'unloadedCharactersNotEvaluated': True, 'modelCalls': 0, 'ttsCalls': 0, 'worldActions': 0}


if __name__ == '__main__':
    result = check()
    print(json.dumps(result, ensure_ascii=True))
    raise SystemExit(0 if result['ok'] else 1)
