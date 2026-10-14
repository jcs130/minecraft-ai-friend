"""Read-only deployment/contract checks, never logs in or claims a body."""
import hashlib
import json
from pathlib import Path
import time
from urllib.request import urlopen
from society_lab import DEFAULT_ROOT, REPO

def probe(root=DEFAULT_ROOT):
    checks={}; report={'scope':'unified_world_adapter_files_and_entrances','checks':checks,'modelRequests':0,'worldActions':0}
    try:
        installation=json.loads((root/'integrations/world-adapter/installation.json').read_text('utf-8'))
        directory=Path(installation['directory']).resolve()
        checks['owned_bundle']=(root/'integrations/world-adapter').resolve() in directory.parents
        checks['exact_bundle']=all(hashlib.sha256((directory/name).read_bytes()).hexdigest()==digest for name,digest in installation['files'].items())
        checks['live_source_matches_distribution']=all(hashlib.sha256((REPO/'world/src'/name).read_bytes()).hexdigest()==digest for name,digest in installation['sourceFiles'].items())
        checks['explicit_body_providers']=installation['providers']==['mineflayer','numen','java-client']
        checks['both_private_stdio_and_js_entries']=all((directory/name).is_file() for name in ('world-adapter/index.cjs','world-adapter/stdio.cjs','world-adapter/numen-client.cjs','native-sdk/index.cjs'))
        checks['guides_installed']=all((directory/name).read_bytes()==(REPO/'docs'/name).read_bytes() for name in ('MY-AGENT-WORLD-WORLD-ADAPTER.md','MY-AGENT-WORLD-WORLD-ADAPTER.txt','MY-AGENT-WORLD-LOGIN.txt','MY-AGENT-WORLD-CONTROL-API.txt'))
        with urlopen('http://127.0.0.1:28985/healthz',timeout=5) as response: main=json.load(response)
        checks['existing_owner_fresh']=main['healthy'] and not main['paused'] and 0<=time.time()-main['heartbeatEpoch']<20
        with urlopen('http://127.0.0.1:28989/healthz',timeout=5) as response: numen=json.load(response)
        checks['existing_numen_ready']=numen['ok'] and numen['serverResident']
    except Exception as error:
        report['error']=type(error).__name__
    report['ok']=len(checks)==8 and all(checks.values())
    return report

if __name__=='__main__':
    result=probe(); print(json.dumps(result,ensure_ascii=False,indent=2)); raise SystemExit(0 if result['ok'] else 1)
