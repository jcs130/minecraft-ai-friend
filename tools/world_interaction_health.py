"""Read-only native receipt capability and installed build provenance; no clicks."""
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
JAR = 'server/mc/mods/qiandeng-irons-bridge-0.1.0.jar'
BUILD_JAR = 'world/irons-bridge-src/build/qiandeng-irons-bridge-0.1.0.jar'
BUILD_RECORD = 'world/irons-bridge-src/build/build-record.json'
NUMEN = 'server/mc/mods/numen-neoforge-1.21.1-0.1.1.jar'
MANIFEST = 'manifests/server-extensions.lock.json'
SETTINGS = 'server/survival-agent-state/survival/settings.json'
CONFIG = 'server/mc/config/numen-autonomous-bodies.json'
PREFIX = 'QD_WORLD_INTERACTION_JSON '
CAPABILITY = 'numen_interaction_receipt_v1'
REQUIRED_SOURCES = {'tools/build_irons_bridge.py',
    'world/irons-bridge-src/src/dev/qiandeng/irons/QiandengIronsBridge.java',
    'world/irons-bridge-src/src/dev/qiandeng/irons/NativeDropTask.java',
    'world/irons-bridge-src/src/dev/qiandeng/irons/WorldInteractionBridge.java'}


def safe(root, name):
    path = Path(root) / name
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)):
        raise ValueError('linked_probe_file')
    path = path.resolve()
    if not path.is_relative_to(Path(root).resolve()):
        raise ValueError('outside_project')
    return path


def digest(root, name):
    result = hashlib.sha256()
    with safe(root, name).open('rb') as stream:
        for block in iter(lambda: stream.read(1048576), b''):
            result.update(block)
    return result.hexdigest()


def document(root, name):
    with safe(root, name).open('rb') as stream:
        raw = stream.read(262145)
    if len(raw) > 262144:
        raise ValueError('probe_file_too_large')
    return json.loads(raw.decode('utf-8-sig'))


def canonical(value):
    return isinstance(value, str) and str(uuid.UUID(value)) == value


def parse_reply(raw):
    if not isinstance(raw, str) or len(raw.encode('utf8')) > 65536:
        raise ValueError('native_reply_invalid')
    raw = re.sub(r'\x1b\[[0-9;]*m', '', raw)
    if raw.count(PREFIX) != 1:
        raise ValueError('native_reply_missing_or_ambiguous')
    # RCON CLI may put chunk line breaks in JSON and Minecraft may append logs.
    payload = ''.join(raw.split(PREFIX, 1)[1].splitlines()).lstrip()
    value, _ = json.JSONDecoder().raw_decode(payload)
    return value


def read_status(body, request, operation='interaction'):
    if operation not in ('interaction', 'dropping') or not canonical(body) or not re.fullmatch('[0-9a-f]{32}', request):
        raise ValueError('invalid_probe_identity')
    result = subprocess.run(['docker', 'exec', 'qiandengji-mc-1', 'rcon-cli',
        f'qdworld {operation} {body} {request}'], capture_output=True, text=True,
        encoding='utf8', errors='replace', timeout=12, check=False)
    if result.returncode:
        raise ValueError('native_query_unavailable')
    return parse_reply(result.stdout)


def check(root=ROOT, sample=read_status, clock=time.time):
    checks = dict.fromkeys(('artifact_matches_build_and_manifest', 'source_current', 'pinned_numen_dependency',
                           'exact_body_binding', 'native_receipt_protocol', 'native_drop_receipt_protocol'), False)
    evidence = {'queries': 0}
    try:
        record = document(root, BUILD_RECORD)
        manifest = document(root, MANIFEST)
        rows = [row for row in manifest['files'] if row.get('path') == JAR]
        installed = digest(root, JAR)
        checks['artifact_matches_build_and_manifest'] = (record.get('ok') is True
            and manifest.get('schema_version') == 1 and len(rows) == 1
            and rows[0].get('sha256') == installed == record.get('sha256') == digest(root, BUILD_JAR))
        evidence['artifactSha256'] = installed
        sources = record.get('sources')
        checks['source_current'] = (isinstance(sources, dict) and REQUIRED_SOURCES <= set(sources)
            and len(sources) <= 100 and all(digest(root, name) == sha for name, sha in sources.items()))
        checks['pinned_numen_dependency'] = record.get('dependencies', {}).get(Path(NUMEN).name) == digest(root, NUMEN)
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        pass
    try:
        settings = document(root, SETTINGS)
        config = document(root, CONFIG)
        expected = {k: settings[k] for k in ('bodyUuid', 'ownerUuid', 'bodyName')}
        checks['exact_body_binding'] = (canonical(expected['bodyUuid']) and canonical(expected['ownerUuid'])
            and expected['bodyName'] == 'Kirito' and config.get('schema') == 1
            and config.get('enabled') is True and config.get('bodies') == [expected])
        if checks['exact_body_binding']:
            for operation, tool, key in (('interaction', 'interact_at', 'native_receipt_protocol'),
                                        ('dropping', 'drop_items', 'native_drop_receipt_protocol')):
                request = uuid.uuid4().hex
                evidence.update(queries=evidence['queries'] + 1, bodyUuid=expected['bodyUuid'])
                reply = sample(expected['bodyUuid'], request, operation)
                at = reply.get('observedAt')
                checks[key] = (type(reply.get('schema')) is int and reply['schema'] == 1
                    and reply.get('capability') == CAPABILITY and reply.get('actorUuid') == expected['bodyUuid']
                    and reply.get('requestId') == request and canonical(reply.get('epoch'))
                    and reply.get('tool') == tool and reply.get('status') == 'unknown'
                    and reply.get('code') == 'request_not_found' and 'result' not in reply
                    and reply.get('dispatched') is not True and type(at) in (int, float)
                    and math.isfinite(at) and -5 <= clock() - at / 1000 <= 15)
                evidence[operation] = {'requestId': request, 'status': reply.get('status'),
                                       'code': reply.get('code'), 'epoch': reply.get('epoch')}
    except (OSError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError):
        pass
    return {'ok': all(checks.values()), 'checks': checks, 'evidence': evidence,
        'modelRequests': 0, 'worldActions': 0, 'interactionSubmissions': 0, 'dropSubmissions': 0,
        'scope': 'Current installed build and unused interaction/drop request queries; no action or historical proof rewrite.'}


if __name__ == '__main__':
    result = check()
    print(json.dumps(result, ensure_ascii=True))
    raise SystemExit(0 if result['ok'] else 1)
