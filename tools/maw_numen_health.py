"""Read-only official Numen install and supervised server check; no MCP/model calls."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import time
from urllib.request import urlopen
import zipfile

ROOT = Path('E:/QiandengJiSocietyLab')
VERSION = '0.1.4.1'
NAME = 'numen-neoforge-1.21.1-0.1.4.1.jar'
SHA = 'ed4a5936aa182b0d9ab685cb993da54f72514eafb0838bb9a64cd69962cb1226'
API_SHA = 'bbc481ea8324b56989627c1f9f9c867e5e82cfd7f35ae5ec2107fb7e34430da5'


def probe(root=ROOT, fetch=urlopen):
    checks = {}
    report = {'schemaVersion': 1, 'scope': 'official_numen_install_and_supervised_server',
              'numenVersion': VERSION, 'modelRequests': 0, 'worldActions': 0,
              'clientOptional': True, 'numenRequiredOnServer': True,
              'unattendedServerMcpImplemented': False,
              'officialMcp': {'location': 'owner_java_client', 'liveClientVerified': False},
              'checks': checks, 'ok': False}
    try:
        root = Path(root)
        mods = root/'server/mods'
        jar = mods/NAME
        checks['one-numen-core-no-duplicate-api'] = sorted(p.name for p in mods.glob('numen*.jar')) == [NAME]
        checks['official-release-sha256'] = hashlib.sha256(jar.read_bytes()).hexdigest() == SHA
        with zipfile.ZipFile(jar) as z:
            apis = [n for n in z.namelist() if n.startswith('META-INF/jarjar/') and 'numen_api' in n and n.endswith('.jar')]
            checks['exact-embedded-api'] = len(apis) == 1 and hashlib.sha256(z.read(apis[0])).hexdigest() == API_SHA
            checks['release-metadata'] = f'version = "{VERSION}"' in z.read('META-INF/neoforge.mods.toml').decode()
        bridge = mods/'maw_agent_bridge-0.1.0.jar'
        build = json.loads((root/'build/society-bridge/build-record.json').read_text('utf-8'))
        checks['compiled-compatible-bridge'] = (hashlib.sha256(bridge.read_bytes()).hexdigest() == build['sha256']
                                                and build['numenSha256'] == SHA and build['apiSha256'] == API_SHA)
        with zipfile.ZipFile(bridge) as z:
            checks['lua-and-existing-player-providers'] = all('dev/qiandeng/maw/'+n+'.class' in z.namelist()
                                                            for n in ('NumenBodyBridge', 'PlayerBodyState', 'PlayerMenuBridge'))
        install = json.loads((root/'integrations/numen/installation.json').read_text('utf-8'))
        client_jar = Path(install['clientJar']).resolve()
        checks['reviewable-client-artifact'] = (root/'integrations/numen').resolve() in client_jar.parents and hashlib.sha256(client_jar.read_bytes()).hexdigest() == SHA
        checks['mcp-scope-not-overclaimed'] = install['officialMcp']['location'] == 'owner_java_client' and install['officialMcp']['liveClientVerified'] is False
        owner = json.load(fetch('http://127.0.0.1:28985/healthz', timeout=5))
        checks['fresh-owned-service'] = owner['healthy'] is True and 0 <= time.time()-owner['heartbeatEpoch'] < 20
        checks['native-lan-entrance-ready'] = any(r['id'] == 'gate' and r['port'] == 28977 and r['ready'] for r in owner['services'])
        log = (root/'server/logs/latest.log').read_text('utf-8', errors='replace')
        checks['new-core-and-api-loaded'] = all(f'Numen {VERSION} ({mod})' in log for mod in ('numen', 'numen_api'))
        compat = mods/'maw_numen_compat-0.1.0.jar'
        compiled = json.loads((root/'build/numen-optional-client/build-record.json').read_text('utf-8'))
        repo = Path(__file__).resolve().parents[1]
        lock = json.loads((repo/'manifests/society-lab-1.21.1.lock.json').read_text('utf-8'))
        locked = next(item for item in lock['builtArtifacts'] if item['name'] == compat.name)
        checks['optional-client-compat-jar-and-lock'] = (hashlib.sha256(compat.read_bytes()).hexdigest()
                == compiled['sha256'] == locked['sha256'] and compiled['numenSha256'] == SHA
                and compiled['apiSha256'] == API_SHA)
        with zipfile.ZipFile(compat) as z:
            mixins = json.loads(z.read('maw_numen_compat.mixins.json'))
            checks['optional-client-server-mixins'] = (mixins['required'] is True
                and mixins['server'] == ['NumenNetworkChannelMixin', 'NumenClientTransportMixin']
                and not mixins.get('client')
                and all('dev/qiandeng/maw/numencompat/mixin/'+name+'.class' in z.namelist()
                        for name in mixins['server']))
        checks['optional-client-compat-loaded'] = 'Numen 0.1.4.1 client channels are optional' in log
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'[:350]
    report['ok'] = len(checks) == 14 and all(checks.values())
    return report


if __name__ == '__main__':
    result = probe()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['ok'] else 1)
