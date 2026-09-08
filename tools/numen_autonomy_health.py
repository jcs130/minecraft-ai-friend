"""Read two native body tick samples; never dispatch an action or load a chunk."""
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
CAPABILITY = 'autonomous_body_tick_v1'
PREFIX = 'QD_NUMEN_AUTONOMY_JSON'
BUILD_RECORD = 'runtime/numen-autonomous-build/latest.json'
CONFIG = 'server/mc/config/numen-autonomous-bodies.json'
JAR = 'server/mc/mods/numen-neoforge-1.21.1-0.1.1.jar'
CHECKS = ('artifact_matches_build', 'source_current', 'exact_body_binding',
          'native_policy_loaded', 'bounded_native_ticket', 'entity_ticking', 'body_tick_progress')


def safe_path(root, path):
    root = Path(root).resolve()
    path = Path(path)
    if not path.is_absolute():
        path = root / path
    if any(p.is_symlink() or getattr(p, 'is_junction', lambda: False)() for p in (path, *path.parents)):
        raise ValueError('linked_probe_file')
    path = path.resolve()
    if not path.is_relative_to(root):
        raise ValueError('outside_project')
    return path


def content(root, path, maximum=1048576):
    with safe_path(root, path).open('rb') as handle:
        raw = handle.read(maximum + 1)
    if len(raw) > maximum:
        raise ValueError('probe_file_too_large')
    return raw


def document(root, path, maximum=1048576):
    return json.loads(content(root, path, maximum).decode('utf-8-sig'))


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def digest_file(root, path):
    digest = hashlib.sha256()
    with safe_path(root, path).open('rb') as handle:
        for block in iter(lambda: handle.read(1048576), b''):
            digest.update(block)
    return digest.hexdigest()


def canonical(value):
    return isinstance(value, str) and str(uuid.UUID(value)) == value


def read_status():
    result = subprocess.run(['docker', 'exec', 'qiandengji-mc-1', 'rcon-cli', 'numen_autonomy_status'],
        capture_output=True, text=True, encoding='utf8', timeout=10, check=True)
    raw = re.sub(r'\x1b\[[0-9;]*m', '', result.stdout).strip()
    if len(raw.encode('utf8')) > 65536 or raw.count(PREFIX) != 1:
        raise ValueError('native_status_unavailable')
    payload = raw.split(PREFIX, 1)[1].lstrip(' :=')
    status, end = json.JSONDecoder().raw_decode(payload)
    if payload[end:].strip():
        raise ValueError('native_status_ambiguous')
    return status


def integer(value):
    return type(value) is int and value >= 0


def fresh(sample, now):
    at = sample.get('observedAt')
    return type(at) in (int, float) and math.isfinite(at) and -5 <= now - at / 1000 <= 15


def check(root=ROOT, sample=read_status, pause=time.sleep, clock=time.time):
    root = Path(root)
    checks = dict.fromkeys(CHECKS, False)
    evidence = {'samples': 0, 'entityTicking': False, 'bodyTicksAdvanced': None,
                'serverTicksAdvanced': None, 'loadedChunkAloneIsEvidence': False}
    try:
        record = document(root, BUILD_RECORD)
        checks['artifact_matches_build'] = (record.get('ok') is True
            and record.get('capability') == CAPABILITY
            and isinstance(record.get('sha256'), str)
            and digest_file(root, JAR) == record['sha256'])
        sources = record.get('sourceFiles')
        checks['source_current'] = (isinstance(sources, dict) and len(sources) >= 3
            and any(name.endswith('/AutonomousBodyTick.java') for name in sources)
            and any(name.startswith('tools/build_numen_') for name in sources)
            and any(name.endswith('/AutonomousTickPolicyTest.java') for name in sources)
            and all(isinstance(name, str) and isinstance(digest, str)
                    and digest_file(root, name) == digest for name, digest in sources.items()))
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        pass
    try:
        raw = content(root, CONFIG, 16384)
        config = json.loads(raw.decode('utf-8-sig'))
        settings = document(root, 'server/survival-agent-state/survival/settings.json')
        expected = {k: settings[k] for k in ('bodyUuid', 'ownerUuid', 'bodyName')}
        assert canonical(expected['bodyUuid']) and canonical(expected['ownerUuid'])
        assert isinstance(expected['bodyName'], str) and expected['bodyName']
        # This rollout authorizes one existing survivor. Extra configured bodies need review.
        checks['exact_body_binding'] = (config.get('schema') == 1 and config.get('enabled') is True
            and config.get('bodies') == [expected])
        first = sample(); evidence['samples'] += 1
        pause(0.75)
        second = sample(); evidence['samples'] += 1
        now = clock()
        samples = (first, second)
        checks['native_policy_loaded'] = all(s.get('schema') == 1
            and s.get('capability') == CAPABILITY and s.get('configValid') is True
            and s.get('configEnabled') is True and s.get('configSha256') == sha(raw)
            and fresh(s, now) for s in samples)
        checks['bounded_native_ticket'] = all(s.get('nativePadEnabled') is True
            and s.get('nativePadRadius') == 2 and s.get('nativePadTimeoutTicks') == 40
            and s.get('nativePadRefreshTicks') == 20 for s in samples)
        rows = []
        for status in samples:
            bodies = status.get('bodies')
            assert isinstance(bodies, list) and len(bodies) == 1
            body = bodies[0]
            assert all(body.get(k) == value for k, value in expected.items())
            assert body.get('online') is True and body.get('identityValid') is True
            assert body.get('eligible') is True or body.get('ownerOnline') is True
            rows.append(body)
        checks['entity_ticking'] = all(row.get('entityTicking') is True for row in rows)
        evidence['entityTicking'] = checks['entity_ticking']
        ticks = [r.get('bodyTickCount') for r in rows]
        server_ticks = [s.get('serverTick') for s in samples]
        assert all(integer(n) for n in (*ticks, *server_ticks))
        assert rows[0].get('dimension') == rows[1].get('dimension') and isinstance(rows[0].get('dimension'), str)
        body_delta = ticks[1] - ticks[0]
        server_delta = server_ticks[1] - server_ticks[0]
        evidence.update(bodyTicksAdvanced=body_delta, serverTicksAdvanced=server_delta)
        checks['body_tick_progress'] = (checks['entity_ticking'] and 0 < body_delta <= server_delta
            and server_delta <= 400 and first['observedAt'] < second['observedAt'])
    except (OSError, ValueError, KeyError, TypeError, AttributeError, AssertionError,
            subprocess.SubprocessError):
        pass
    return {'ok': all(checks.values()), 'checks': checks, 'evidence': evidence,
            'modelRequests': 0, 'worldActions': 0,
            'scope': 'Current source and artifact, exact authorization, two native entity-ticking/body-tick samples; not navigation success'}


if __name__ == '__main__':
    result = check()
    print(json.dumps(result, ensure_ascii=True))
    raise SystemExit(0 if result['ok'] else 1)
