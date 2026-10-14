"""Read-only host bundle checks. Never connects a player, claims a lease or calls a model."""
import hashlib
import json
from pathlib import Path
import time
from urllib.request import urlopen
from society_lab import DEFAULT_ROOT, REPO

def probe(root=DEFAULT_ROOT):
    checks = {}
    report = {'scope': 'independent_core_native_host_distribution', 'checks': checks,
              'modelRequests': 0, 'bodyConnections': 0, 'worldActions': 0, 'newServices': 0}
    try:
        base = (root / 'integrations/agent-mc-world').resolve()
        installation = json.loads((base / 'installation.json').read_text('utf-8'))
        directory = Path(installation['directory']).resolve()
        checks['owned_bundle'] = base in directory.parents
        def exact(parent, records):
            for name, digest in records.items():
                target = (parent / name).resolve()
                if parent.resolve() not in target.parents or not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
                    return False
            return True
        checks['exact_distribution'] = checks['owned_bundle'] and exact(directory, installation['files'])
        checks['native_sources_match'] = exact(REPO / 'world/src', installation['sourceFiles'])
        checks['core_sources_match'] = exact(REPO / 'packages/agent-mc-world', installation['coreSourceFiles'])
        core = directory / 'node_modules/agent-mc-world'
        checks['packed_independent_core_installed'] = json.loads((core / 'package.json').read_text('utf-8'))['version'] == installation['coreVersion'] == '0.4.0'
        build = json.loads((core / 'dist/build.json').read_text('utf-8'))
        checks['installed_runtime_matches_build'] = exact(core, {row['file']: row['sha256'] for row in build['files'] if row['file'].startswith('dist/runtime/')})
        checks['explicit_body_providers'] = installation['providers'] == ['mineflayer', 'numen', 'java-client']
        checks['no_model_or_body_autostart'] = installation['modelRequests'] == installation['bodyConnections'] == installation['newServices'] == 0
        checks['runtime_protocol_pins'] = all(json.loads((directory / 'node_modules' / name / 'package.json').read_text('utf-8'))['version'] == version
                                            for name, version in [('mineflayer', '4.37.1'), ('minecraft-protocol', '1.66.2'), ('minecraft-data', '3.112.0')])
        with urlopen('http://127.0.0.1:28985/healthz', timeout=5) as response:
            main = json.load(response)
        checks['existing_supervisor_healthy'] = main['healthy'] and not main['paused'] and 0 <= time.time() - main['heartbeatEpoch'] < 30
    except Exception as exc:
        report['error'] = type(exc).__name__
    report['ok'] = len(checks) == 10 and all(checks.values())
    return report

if __name__ == '__main__':
    result = probe()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['ok'] else 1)
