"""Read-only deployment and public view-entry smoke; never wakes a body."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen
from urllib.error import HTTPError
from society_lab import DEFAULT_ROOT

def source_digest(root):
    files=[]
    def walk(folder):
        for p in folder.iterdir():
            if p.name.startswith('.') or p.name in ('node_modules','assets','asset-packs','public','dist','test'):continue
            if p.is_dir():walk(p)
            elif p.suffix in ('.mjs','.mts','.js','.ts','.json'):files.append(p)
    walk(root);walk(root.parent/'src')
    digest=hashlib.sha256()
    for p in sorted(files,key=lambda p:str(p)):
        digest.update(p.relative_to(root.parent).as_posix().encode()+b'\0')
        digest.update(p.read_text('utf-8').replace('\r\n','\n').encode()+b'\0')
    return digest.hexdigest()

def probe(root=DEFAULT_ROOT):
    checks={};report={'scope':'numen_read_only_web_viewer','checks':checks,'worldActions':0,'modelRequests':0,'ok':False}
    try:
        config=json.loads((root/'services/agent.json').read_text('utf-8'));base=f"http://127.0.0.1:{config['viewerPort']}"
        with urlopen(base+'/numen/view/health',timeout=5) as r:health=json.load(r)
        checks['managed_private_body_entry']=health['ok'] and health['readOnly'] and health['maxSessions']==4 and health['newMinecraftConnections']==0
        with urlopen(base+'/numen/view/',timeout=5) as r:page=r.read(32768).decode('utf-8')
        checks['usable_login_page']='Numen 第一人称观战' in page and 'type="password"' in page
        try:
            urlopen(base+'/numen/view/01234567-89ab-cdef-0123-456789abcdef/status.json',timeout=5)
            checks['anonymous_body_denied']=False
        except HTTPError as e:checks['anonymous_body_denied']=e.code==401
        with urlopen(base+'/build.json',timeout=5) as r:build=json.load(r)
        renderer=Path(config['viewerHostModule']).parent.parent
        checks['live_latest_renderer_sources']=build['buildSource']['sourceSha256']==source_digest(renderer)
        with urlopen(base+'/index.js',timeout=8) as r:bundle=r.read(12*1024*1024)
        checks['served_bundle_matches_runtime']=hashlib.sha256(bundle).hexdigest()==build['consoleBundleSha256']
        with urlopen('http://127.0.0.1:28989/healthz',timeout=5) as r:native=json.load(r)
        checks['native_body_viewer_ready']=native.get('nativeViewerAvailable') is True
        with urlopen('http://127.0.0.1:28985/healthz',timeout=5) as r:owner=json.load(r)
        checks['existing_supervisor_healthy']=owner['healthy'] and not owner['paused']
        report['build']=build
    except Exception as e:report['error']=type(e).__name__+': '+str(e)
    report['ok']=len(checks)==7 and all(checks.values())
    return report

if __name__=='__main__':
    result=probe();print(json.dumps(result,ensure_ascii=False,indent=2));raise SystemExit(0 if result['ok'] else 1)
