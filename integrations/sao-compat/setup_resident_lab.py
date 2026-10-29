"""Create fresh loopback-only test credentials; never import production keys."""
import argparse
import hashlib
import json
from pathlib import Path
import secrets
import uuid

def setup(root):
    root=Path(root).resolve(strict=True)
    if json.loads((root/'pack-source.json').read_text('utf-8'))['scope']!='isolated_testing':raise ValueError('marked_lab_required')
    settings=root/'server/config/maw-numen-server.json'
    private=root/'server/config/maw-numen-private';private.mkdir(parents=True,exist_ok=True)
    credentials=root/'lab-controller.private.json'
    if not credentials.exists():
        owner=str(uuid.uuid4());token=secrets.token_hex(32)
        credentials.write_text(json.dumps({'ownerUuid':owner,'token':token,'endpoint':'http://127.0.0.1:39689/mcp'},indent=2),encoding='utf-8')
        (private/'accounts.json').write_text(json.dumps({'accounts':[{'ownerUuid':owner,'label':'SAO lab owner','tokenHash':hashlib.sha256(token.encode()).hexdigest()}]},indent=2),encoding='utf-8')
        (private/'bridge.json').write_text(json.dumps({'secret':secrets.token_hex(32)}),encoding='utf-8')
    config={'enabled':True,'bind':'127.0.0.1','port':39689,'allowedHosts':['127.0.0.1:39689','localhost:39689'],
            'publicEndpoint':'http://127.0.0.1:39689/mcp','allowedModelHosts':[]}
    if settings.exists() and json.loads(settings.read_text('utf-8'))!=config:raise ValueError('review_existing_lab_config')
    settings.write_text(json.dumps(config,indent=2),encoding='utf-8')
    print(json.dumps({'configured':True,'bind':config['bind'],'port':config['port'],'credentialsPrinted':False}))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',required=True);setup(p.parse_args().root)
