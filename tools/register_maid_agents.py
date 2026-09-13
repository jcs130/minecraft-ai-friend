"""Register real owned maid identities through native Qwen APIs, never an LLM.

Run in the NPC environment, with its existing RCON/Qwen token paths. --check is
read-only. --apply qiandengji copies only the closed maid template and configures
fixed-self MCP; private backups and the public allowlist live in the registry.
An administrator may pre-register an independently verified unloaded owned maid
using --identity-file + --allow-unloaded-owned. This does not load/summon/adopt it.
"""
import argparse
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SIDECAR = ROOT / 'world/sidecar'
if not SIDECAR.is_dir() and Path('/opt/sidecar').is_dir():
    SIDECAR = Path('/opt/sidecar')
sys.path.insert(0, str(SIDECAR))
from maid_identity import identity, canonical_uuid
from maid_registry import MaidRegistry
from maid_native_tools import MaidNativeTools


def register(registry, identities, *, apply=False, allow_unloaded=False, name=None, persona=None):
    if not isinstance(identities, list) or len(identities) > 64:
        raise ValueError('maid_identity_list_limit')
    checked = []
    for item in identities:
        if isinstance(item, dict) and item.get('ownerUuid') is None:
            checked.append({'maidUuid': canonical_uuid(item.get('maidUuid')), 'status': 'unowned_waiting_for_adoption'})
        else:
            checked.append(identity(item, require_loaded=not allow_unloaded))
    if len({r['maidUuid'] for r in checked}) != len(checked):
        raise ValueError('duplicate_maid_identity')
    if (name or persona) and len(checked) != 1:
        raise ValueError('personality_override_requires_one_maid')
    result = {'ok': True, 'mode': 'apply' if apply else 'check', 'modelCalls': 0,
              'worldActions': 0, 'maids': []}
    for item in checked:
        if item.get('status') == 'unowned_waiting_for_adoption':
            result['maids'].append(item)
            continue
        if not apply:
            path = registry.path(item['maidUuid'])
            if path.exists():
                row = registry.resolve(item['maidUuid'], item['ownerUuid'])
                status, role = 'registered', row['agentId']
            else:
                status, role = 'owned_identity_ready_to_register', None
        else:
            try:
                row = registry.ensure(item, name=name, persona=persona, allow_unloaded=allow_unloaded)
                status, role = 'registered', row['agentId']
            except Exception as error:
                code = str(error) if isinstance(error, ValueError) and re.fullmatch('[a-z_]+', str(error)) else type(error).__name__
                result['maids'].append({'maidUuid': item['maidUuid'], 'status': 'registration_unavailable', 'code': code})
                result['ok'] = False
                continue
        result['maids'].append({'maidUuid': item['maidUuid'], 'status': status,
                               'agentId': role, 'bodyLoaded': item['loaded']})
    result['registry'] = registry.publish() if apply else registry.health_summary()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--check', action='store_true')
    group.add_argument('--apply', choices=['qiandengji'])
    parser.add_argument('--registry-dir')
    parser.add_argument('--identity-file', help='Explicit administrator-verified identity or {maids:[...]} JSON')
    parser.add_argument('--allow-unloaded-owned', action='store_true')
    parser.add_argument('--name')
    parser.add_argument('--persona-file', help='Optional administrator persona text; only for one new identity')
    args = parser.parse_args()
    if args.allow_unloaded_owned and not args.identity_file:
        parser.error('--allow-unloaded-owned requires an explicit verified --identity-file')
    try:
        registry = MaidRegistry(args.registry_dir)
        if args.identity_file:
            path = Path(args.identity_file)
            if path.is_symlink() or path.stat().st_size > 65536:
                raise ValueError('invalid_identity_file')
            data = json.loads(path.read_text(encoding='utf8'))
            identities = data.get('maids', [data]) if isinstance(data, dict) else data
        else:
            identities = MaidNativeTools(registry).discover()
        persona = None
        if args.persona_file:
            path = Path(args.persona_file)
            if path.is_symlink() or path.stat().st_size > 8000:
                raise ValueError('invalid_persona_file')
            persona = path.read_text(encoding='utf8')
        result = register(registry, identities, apply=bool(args.apply), allow_unloaded=args.allow_unloaded_owned,
                          name=args.name, persona=persona)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result['ok'] else 1
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch('[a-z_]+', str(error)) else type(error).__name__
        print(json.dumps({'ok': False, 'code': code, 'modelCalls': 0, 'worldActions': 0}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
