"""Read-only installed SDK/bridge supervision check, not a gameplay claim."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import time
from urllib.request import urlopen
import zipfile

ROOT = Path('E:/QiandengJiSocietyLab')

def probe(root: Path = ROOT) -> dict:
    checks = {}
    result = {'schemaVersion': 1, 'scope': 'installed_native_sdk_and_owned_bridge_not_agent_gameplay',
              'modelRequests': 0, 'worldActions': 0, 'checks': checks, 'ok': False}
    try:
        manifest = json.loads((root/'integrations/native-sdk/installation.json').read_text('utf-8'))
        directory = Path(manifest['directory']).resolve()
        checks['owned-bundle'] = (root/'integrations/native-sdk').resolve() in directory.parents
        files = manifest['files']
        checks['exact-bundle-files'] = bool(files) and all(
            directory in (directory/name).resolve().parents and
            hashlib.sha256((directory/name).read_bytes()).hexdigest() == digest for name, digest in files.items())
        catalog = json.loads((directory/'operations.json').read_text('utf-8'))
        rows = catalog['operations']
        checks['70-explicit-operations'] = len(rows) == len({row['id'] for row in rows}) == manifest['operationCount'] == 70
        checks['machine-readable-contracts'] = all(row.get('parameters') and row.get('permission') and row.get('execution') and row.get('returns') for row in rows)
        checks['no-fake-player-claim'] = catalog['numenFakePlayerControl'] is False and catalog['numenRestoreExisting'] is False
        jar = root/'server/mods/maw_agent_bridge-0.1.0.jar'
        build = json.loads((root/'build/society-bridge/build-record.json').read_text('utf-8'))
        checks['exact-compiled-bridge'] = hashlib.sha256(jar.read_bytes()).hexdigest() == build['sha256']
        with zipfile.ZipFile(jar) as archive:
            checks['body-queries-compiled'] = 'dev/qiandeng/maw/PlayerBodyState.class' in archive.namelist()
        owner = json.load(urlopen('http://127.0.0.1:28985/healthz', timeout=5))
        checks['fresh-owned-service'] = owner['healthy'] is True and 0 <= time.time()-owner['heartbeatEpoch'] < 20
        checks['native-entrance-ready'] = any(row['id'] == 'gate' and row['port'] == 28977 and row['ready'] is True for row in owner['services'])
        result['directory'] = str(directory)
    except Exception as error:
        result['error'] = str(error)[:350]
    result['ok'] = bool(checks) and len(checks) == 9 and all(checks.values())
    return result

if __name__ == '__main__':
    value = probe()
    print(json.dumps(value, ensure_ascii=False, indent=2))
    raise SystemExit(0 if value['ok'] else 1)
