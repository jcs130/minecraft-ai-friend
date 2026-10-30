"""Executed by the existing ECS command channel; never accepts user web input.

Build on the pinned live image, test on a cloned database, leave production up.
Settings (including a short-lived private OSS URL) are supplied out of band.
"""
from pathlib import Path
import hashlib,json,os,shutil,socket,sqlite3,stat,subprocess,tarfile,time,urllib.request

ROOT=Path('/opt/qiandengji-portal')
CONFIG=Path('/etc/qiandengji-portal/config.json')
DB=Path('/var/lib/qiandengji-portal/data/portal.sqlite')
NAME='qiandengji-portal'
def docker(*args):return subprocess.check_output(['docker',*args],stderr=subprocess.PIPE,timeout=180).decode().strip()
def sha(file):return hashlib.sha256(file.read_bytes()).hexdigest()
def get(port,path,headers=None):
    with urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{port}'+path,headers=headers or {}),timeout=12) as r:return json.loads(r.read())
def owned_copy(source,target):
    shutil.copy2(source,target);s=source.stat();os.chown(target,s.st_uid,s.st_gid);target.chmod(stat.S_IMODE(s.st_mode))

def main(settings):
    assert (ROOT/'.portal-owner').read_text().strip()=='qiandengji-agent-portal'
    manifest=settings['manifest'];live=json.loads(docker('inspect',NAME))[0]
    assert live['State']['Running'] and live['Image']==manifest['previousImageId']
    assert docker('image','inspect','--format','{{.Id}}',manifest['previousImage'])==manifest['previousImageId']
    assert sha(CONFIG)==manifest['previousConfigSha256']
    assert settings.get('stageName') in ['stage-r2','stage-r3','stage-r4']
    stage=ROOT/'sao-shared-access-20261030'/settings['stageName'];assert not stage.exists();stage.mkdir(mode=0o700)
    archive=stage/'site-overlay.tar.gz'
    assert settings['artifactUrl'].startswith('https://qiandengji-downloads-hk-20261023.oss-cn-hongkong.aliyuncs.com/')
    with urllib.request.urlopen(settings['artifactUrl'],timeout=40) as r:raw=r.read(2*1024*1024+1)
    assert len(raw)==settings['artifactBytes']<2*1024*1024
    archive.write_bytes(raw);assert sha(archive)==settings['artifactSha256']
    source=stage/'source';source.mkdir()
    with tarfile.open(archive,'r:gz') as t:
        allowed=set(manifest['files'])|{'site-overlay-manifest.json'}
        for m in t.getmembers():assert m.isfile() and m.name in allowed and (source/m.name).resolve().is_relative_to(source.resolve())
        assert set(t.getnames())==allowed
        # All entries are already regular allowlisted files with checked paths.
        # Older cloud Python does not expose the additional extraction filter.
        try:t.extractall(source,filter='data')
        except TypeError:t.extractall(source)
    for name,digest in manifest['files'].items():assert sha(source/name)==digest
    actual=json.loads(docker('exec',NAME,'node','--input-type=module','-e',"import fs from 'node:fs';import crypto from 'node:crypto';console.log(JSON.stringify(Object.fromEntries(JSON.parse(process.argv[1]).map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(n)).digest('hex')]))));",json.dumps(list(manifest['preimageHashes']))))
    assert actual==manifest['preimageHashes'],'Production source changed; rebase instead of overwriting'
    image='qiandengji-portal:0.8.32-sao-'+settings['artifactSha256'][:12]
    (source/'Dockerfile').write_text('FROM '+manifest['previousImage']+'\nWORKDIR /app\nCOPY src/ /app/src/\nCOPY public/ /app/public/\nCOPY package.json package-lock.json /app/\n')
    build=subprocess.run(['docker','build','--network=none','--pull=false','-t',image,str(source)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180)
    (stage/'build.log').write_bytes(build.stdout);assert build.returncode==0,'Inspect private stage build log'
    image_id=docker('image','inspect','--format','{{.Id}}',image)
    check="import fs from 'node:fs';import crypto from 'node:crypto';import{spawnSync}from'node:child_process';const names=JSON.parse(process.argv[1]);for(const n of Object.keys(names)){if(crypto.createHash('sha256').update(fs.readFileSync(n)).digest('hex')!==names[n])throw Error('POSTIMAGE');if(/\\.(?:js|mjs)$/.test(n)&&spawnSync(process.execPath,['--check',n]).status!==0)throw Error('SYNTAX');}console.log(JSON.stringify({postimageAndSyntax:true}));"
    assert json.loads(docker('run','--rm','--network','none','--entrypoint','node',image,'--input-type=module','-e',check,json.dumps(manifest['files'])))['postimageAndSyntax']
    data=stage/'data';data.mkdir(mode=0o700);ds=DB.parent.stat();os.chown(data,ds.st_uid,ds.st_gid)
    src=sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True);dst=sqlite3.connect(data/'portal.sqlite')
    try:
        src.backup(dst);assert dst.execute('pragma integrity_check').fetchone()[0]=='ok'
        counts={t:dst.execute('SELECT count(*) FROM '+t).fetchone()[0] for t in ['owners','ownerships','credentials','agent_invites','gallery_images','memory_posts']}
    finally:
        dst.close();src.close()
    # A sqlite connection context commits but does not close. Close before
    # handing the clone to the unprivileged container, so root-owned WAL files
    # cannot make a writable clone appear readonly.
    os.chown(data/'portal.sqlite',DB.stat().st_uid,DB.stat().st_gid);(data/'portal.sqlite').chmod(0o600)
    config=json.loads(CONFIG.read_text());live_env=dict(x.split('=',1) for x in live['Config']['Env']);production_port=int(live_env.get('PORTAL_PORT',config['port']))
    enabled=config['downloads']['enabledPackages'];assert 'sao-client' not in enabled;config['downloads']['enabledPackages']=[*enabled,'sao-client']
    config['sharedRealmAccess']={'enabled':True,'realmId':'sao','tokenHash':settings['tokenHash']}
    production_config=stage/'production-config.json';owned_copy(CONFIG,production_config);production_config.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
    config['cloudAccounts']['enabled']=False;config['cloudSync']['enabled']=False;config['emailAuth']['enabled']=False;config['emailAuth']['smtpConfigFile']=''
    stage_config=stage/'stage-config.json';owned_copy(CONFIG,stage_config);stage_config.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
    port=18084
    with socket.socket() as s:assert s.connect_ex(('127.0.0.1',port))!=0,'Stage port already owned'
    qa='qiandengji-sao-qa-20261030';assert not docker('ps','-aq','--filter','name=^/'+qa+'$')
    env=[x for x in live['Config']['Env'] if x.split('=',1)[0] not in ['PORTAL_HOST','PORTAL_PORT','PORTAL_DATA_DIR']]+['PORTAL_HOST=127.0.0.1','PORTAL_PORT='+str(port),'PORTAL_DATA_DIR=/data']
    envfile=stage/'stage.env';envfile.write_text('\n'.join(env)+'\n');envfile.chmod(0o600)
    mounts={m['Destination']:m for m in live['Mounts']};assert set(mounts)=={'/data','/app/config.local.json','/trusted-world-viewer'}
    args=['run','-d','--name',qa,'--network','host','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--pids-limit','96','--memory','536870912','--cpus','1','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--env-file',str(envfile),
      '--mount','type=bind,src='+str(data)+',dst=/data','--mount','type=bind,src='+str(stage_config)+',dst=/app/config.local.json,readonly',
      '--mount','type=bind,src='+mounts['/trusted-world-viewer']['Source']+',dst=/trusted-world-viewer,readonly',image]
    started=False
    try:
        docker(*args);started=True
        for _ in range(30):
            try:assert get(port,'/api/v1/health')['version']=='0.8.32';break
            except Exception:time.sleep(.3)
        else:raise RuntimeError('STAGE_HEALTH_FAILED')
        downloads=get(port,'/api/v1/downloads');assert len(downloads['packages'])==len(enabled)+1
        row=next(x for x in downloads['packages'] if x['id']=='sao-client');assert row['available'] and row['sha256']=='e858aee6e22b249a32c33c3a379274683bdedf5b26bd7f682a379f69c6ddb612'
        for page,marker in [('/sao.html','共用千灯纪账号'),('/downloads.html','game-client-downloads')]:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}'+page,timeout=12) as r:assert marker in r.read().decode()
        try:get(port,'/api/v1/internal/realm-accounts/roles');raise AssertionError('Unauthenticated role feed opened')
        except urllib.error.HTTPError as e:assert e.code==401
        assert get(production_port,'/api/v1/health')['version']=='0.8.31','Live site was affected during staging'
        report={'passed':True,'version':'0.8.32','image':image,'imageId':image_id,'previousImageId':live['Image'],'previousContainerId':live['Id'],
          'previousConfigSha256':manifest['previousConfigSha256'],'newConfigSha256':sha(production_config),'artifactSha256':settings['artifactSha256'],
          'preservedDownloadIds':enabled,'newDownloadId':'sao-client','protectedCounts':counts,'productionUntouched':True,'postimagesAndSyntaxVerified':True,
          'testedPages':['/sao.html','/downloads.html'],'roleFeedUnauthorizedDenied':True,'trustedViewerMount':mounts['/trusted-world-viewer']['Source'],'productionPort':production_port}
        (stage/'stage-ready.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
    finally:
        if started:
            logs=subprocess.run(['docker','logs',qa],stdout=subprocess.PIPE,stderr=subprocess.STDOUT).stdout
            (stage/'qa.private.log').write_bytes(logs);(stage/'qa.private.log').chmod(0o600)
            docker('stop','-t','15',qa);docker('rm',qa)
