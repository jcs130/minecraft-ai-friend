"""Install the verified optional server component only after a clean cold stop."""
import json
from pathlib import Path
import sys
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from manage import settings, validate_server
from backup import assert_stopped
from prepare import copy_checked, digest, write_json


def install():
    config = settings()
    validate_server(config)
    assert_stopped(config)
    entry = json.loads((HERE / 'native-component.lock.json').read_text())
    jar = Path(config['cache'])/'mineflayer/native-build'/entry['filename']
    if digest(jar) != entry['sha256']:
        raise ValueError('Built native component differs from accepted artifact')
    for name, sha in entry['sourceSha256'].items():
        if Path(name).name != name or digest(HERE/'native-src'/name) != sha:
            raise ValueError('Native component source differs from accepted artifact')
    target = (Path(config['server'])/'mods'/entry['filename']).resolve()
    if not target.is_relative_to(Path(config['server']).resolve()): raise ValueError('Target escaped owned server')
    prior = [e for e in config.get('localComponents', []) if e['filename'].startswith('maw-native263-')]
    if prior and prior != [entry]: raise ValueError('Review a version migration before replacing an existing native component')
    copy_checked(jar, target)
    if not prior:
        config.setdefault('localComponents', []).append(entry)
        write_json(HERE.parent/'deployment.local.json', config)
    validate_server(config)
    return {'status': 'installed', 'component': entry['filename'], 'sha256': entry['sha256'], 'serverOnly': True}


if __name__ == '__main__': print(json.dumps(install()))
