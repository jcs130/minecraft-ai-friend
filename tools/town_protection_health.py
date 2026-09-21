"""Read-only native town protection and deployed artifact checks; no game actions."""
import importlib.util
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PREFIX = 'QD_TOWN_PROTECTION_JSON '
JAR = 'server/mc/mods/qiandeng-irons-bridge-0.1.0.jar'
NUMEN = 'server/mc/mods/numen-neoforge-1.21.1-0.1.3.jar'
BUILD = 'world/irons-bridge-src/build/build-record.json'
SMOKE = 'reports/town-protection-smoke.json'
MASK = 'world/irons-bridge-src/resources/qiandeng-town-blocks.json'
EXPECTED = {'schema': 2, 'enabled': True, 'dimension': 'minecraft:overworld',
            'minX': -715, 'maxX': -375, 'minZ': 695, 'maxZ': 1035,
            'allY': True, 'manualOpBypass': False,
            'maintenance': 'trusted_console_native_commands_only',
            'mode': 'reviewed_blocks', 'maskReady': True, 'fallback': 'none'}
BEHAVIOR = {'manual-blocked', 'explosion-blocked', 'fire-blocked', 'farming-usable',
            'doors-and-storage-usable', 'trusted-maintenance-usable', 'outside-usable',
            'bed-place', 'bed-remove', 'player-build', 'player-remove', 'replace-blocked', 'op-blocked'}


def read_status():
    result = subprocess.run(['docker', 'exec', 'qiandengji-mc-1', 'rcon-cli',
                             'qdworldprotect status'], capture_output=True, text=True,
                            encoding='utf8', errors='replace', timeout=12,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    raw = re.sub(r'\x1b\[[0-9;]*m', '', result.stdout)
    if result.returncode or len(raw.encode('utf8')) > 8192 or raw.count(PREFIX) != 1:
        raise ValueError('town_protection_native_status_unavailable')
    return json.loads(raw.split(PREFIX, 1)[1].strip())


def check(root=ROOT, sample=read_status):
    checks = dict.fromkeys(('native_boundary', 'no_manual_op_bypass',
                           'artifact_and_sources_current', 'native_qa_matches_artifact', 'block_mask_current'), False)
    evidence = {}
    reply = {}
    try:
        reply = sample()
        if not isinstance(reply, dict):
            raise ValueError('town_protection_native_status_not_object')
        checks['native_boundary'] = all(type(reply.get(k)) is type(v) and reply[k] == v
            for k, v in EXPECTED.items())
        checks['no_manual_op_bypass'] = reply.get('manualOpBypass') is False
        evidence['refusals'] = reply.get('refusals')
    except (ValueError, OSError, TypeError, subprocess.TimeoutExpired):
        pass
    try:
        spec = importlib.util.spec_from_file_location('town_artifact_reader', Path(root)/'tools/world_interaction_health.py')
        helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
        record = helper.document(root, BUILD)
        installed = helper.digest(root, JAR)
        manifest = helper.document(root, 'manifests/server-extensions.lock.json')
        rows = [r for r in manifest['files'] if r.get('path') == JAR]
        sources = record.get('sources', {})
        required = {'tools/build_irons_bridge.py',
                    'world/irons-bridge-src/src/dev/qiandeng/irons/TownProtection.java',
                    'world/irons-bridge-src/src/dev/qiandeng/irons/TownProtectionPolicy.java',
                    'world/irons-bridge-src/src/dev/qiandeng/irons/TownBlockMask.java', MASK}
        mask = helper.document(root, MASK)
        checks['block_mask_current'] = (reply.get('maskSha256') == helper.digest(root, MASK)
            and type(reply.get('protectedBlocks')) is int and reply['protectedBlocks'] == mask['blocks'] > 0)
        checks['artifact_and_sources_current'] = (record.get('ok') is True
            and manifest.get('schema_version') == 1
            and len(rows) == 1 and rows[0].get('sha256') == installed == record.get('sha256')
            and helper.digest(root, 'world/irons-bridge-src/build/qiandeng-irons-bridge-0.1.0.jar') == installed
            and required <= set(sources) and len(sources) <= 100
            and all(helper.digest(root, name) == value for name, value in sources.items()))
        evidence['artifactSha256'] = installed
        smoke = helper.document(root, SMOKE)
        behavior = smoke.get('checks', {})
        numen = helper.digest(root, NUMEN)
        checks['native_qa_matches_artifact'] = (smoke.get('ok') is True
            and smoke.get('environment') == 'isolated_native_qa'
            and smoke.get('candidateSha256') == installed
            and smoke.get('numenSha256') == numen == record.get('dependencies', {}).get(Path(NUMEN).name)
            and BEHAVIOR <= set(behavior) and all(behavior[k] is True for k in BEHAVIOR))
    except (ValueError, OSError, TypeError, KeyError, AttributeError, ImportError):
        pass
    return {'ok': all(checks.values()), 'checks': checks, 'evidence': evidence,
            'modelRequests': 0, 'worldActions': 0,
            'scope': 'Current server boundary and artifact; separate real isolated QA. Trusted administrator commands remain maintenance authority.'}


if __name__ == '__main__':
    result = check()
    print(json.dumps(result))
    raise SystemExit(0 if result['ok'] else 1)
