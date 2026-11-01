"""Install the exact read-only addon into a cold, already-owned Fabric 26.3 lab."""
import argparse
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import manage
from prepare import digest, copy_checked, write_json


def install(deployment, jar):
    config = json.loads(deployment.read_text(encoding='utf-8'))
    if config['port'] not in (39781, 39783) or config['controlPort'] != config['port'] + 1:
        raise ValueError('Only the independently owned loopback labs are allowed')
    manage.validate_server(config)
    state = json.loads((Path(config['cache']) / 'server-process.local.json').read_text())
    if state.get('exitCode') != 0 or manage.pid_alive(state['pid']):
        raise ValueError('Stop the lab cleanly and take cold backups before installing')
    manage.port_free(config['port']); manage.port_free(config['controlPort'])
    lock = json.loads((HERE / 'body-component.lock.json').read_text(encoding='utf-8'))
    if digest(jar) != lock['sha256']:
        raise ValueError('Addon artifact differs from the reviewed lock')
    for name, expected in lock['sourceSha256'].items():
        if digest(HERE / 'server-src' / name) != expected:
            raise ValueError('Addon source differs from its build lock')
    previous = [entry for entry in config.get('localComponents', []) if entry['filename'].startswith('maw-stock263-')]
    if previous:
        raise ValueError('Existing addon needs an explicit upgrade/reconciliation; never overwrite it')
    copy_checked(jar, Path(config['server']) / 'mods' / lock['filename'])
    config['localComponents'].append(lock)
    write_json(deployment, config)
    manage.validate_server(config)
    return lock


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--deployment', type=Path, required=True); parser.add_argument('--jar', type=Path, required=True)
    args = parser.parse_args(); print(json.dumps(install(args.deployment.resolve(), args.jar.resolve())))
