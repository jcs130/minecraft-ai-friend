"""One-shot website publication, with a cold portal DB backup and safe rollback.

No game server, authentication database or world is modified by this script.
The original container, image, data mount and viewer mount are retained.
"""
from pathlib import Path
import base64,hashlib,json,os,pwd,re,shutil,sqlite3,stat,subprocess,time,urllib.request,zipfile
ROOT=Path('/opt/qiandengji-portal');CONFIG=Path('/etc/qiandengji-portal/config.json')
DB=Path('/var/lib/qiandengji-portal/data/portal.sqlite');NAME='qiandengji-portal'
def docker(*args):return subprocess.check_output(['docker',*args],stderr=subprocess.PIPE,timeout=120).decode().strip()
def digest(file):return hashlib.sha256(file.read_bytes()).hexdigest()
def get(port,path):
    with urllib.request.urlopen(f'http://127.0.0.1:{port}'+path,timeout=10) as r:return json.loads(r.read())
def write_owned(path,data,original):
    tmp=path.with_name(path.name+'.sao-publish.tmp');assert not tmp.exists();tmp.write_bytes(data)
    os.chown(tmp,original.st_uid,original.st_gid);tmp.chmod(stat.S_IMODE(original.st_mode));os.replace(tmp,path)
def snapshot():
    db=sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True)
    try:
        assert db.execute('pragma integrity_check').fetchone()[0]=='ok'
        # Login/session timestamps and activity counters are allowed to advance.
        owners={row[0]:hashlib.sha256(json.dumps(row,default=str).encode()).hexdigest() for row in db.execute('select id,username,password_hash,role,created_at from owners')}
        ownerships={tuple(row) for row in db.execute('select owner_id,agent_uuid,proof,created_at from ownerships')}
        counts={t:db.execute('select count(*) from '+t).fetchone()[0] for t in ['owners','ownerships','credentials','gallery_images','memory_posts','agent_invites']}
        return owners,ownerships,counts
    finally:db.close()
def backup_db(path):
    source=sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True);target=sqlite3.connect(path)
    try:source.backup(target);assert target.execute('pragma integrity_check').fetchone()[0]=='ok'
    finally:target.close();source.close()
    path.chmod(0o600)
def grant_backup(archive,public_key):
    parts=public_key.split();assert len(parts)>=2 and parts[0]=='ssh-ed25519' and re.fullmatch(r'[A-Za-z0-9+/=]{60,120}',parts[1])
    account=pwd.getpwnam('desktopuser');export=Path('/home/desktopuser/portal-sao-backup-20261030');assert not export.exists();export.mkdir(mode=0o700);os.chown(export,account.pw_uid,account.pw_gid)
    target=export/'website-before.zip';shutil.copy2(archive,target);target.chmod(0o600);os.chown(target,account.pw_uid,account.pw_gid)
    tag='sao-shared-access-20261030-backup';keys=Path('/home/desktopuser/.ssh/authorized_keys');before=keys.read_text();assert not any(x.endswith(' '+tag) for x in before.splitlines())
    # The single-use command removes its exact grant before streaming the fixed
    # archive. It cannot execute a supplied command, forward ports or open a PTY.
    payload="""from pathlib import Path
import shutil,sys
root=Path('/home/desktopuser/portal-sao-backup-20261030')
with (root/'.used').open('x') as used:used.write('one-shot backup transfer')
keys=Path('/home/desktopuser/.ssh/authorized_keys')
lines=keys.read_text().splitlines()
tag='sao-shared-access-20261030-backup'
assert sum(x.endswith(' '+tag) for x in lines)==1
keys.write_text(chr(10).join(x for x in lines if not x.endswith(' '+tag))+chr(10))
keys.chmod(0o600)
with (root/'website-before.zip').open('rb') as data:shutil.copyfileobj(data,sys.stdout.buffer)
"""
    encoded=base64.b64encode(payload.encode()).decode();command=ROOT/'sao-shared-access-20261030/backup-transfer.sh'
    command.write_text('#!/bin/sh\nset -eu\n[ "${SSH_ORIGINAL_COMMAND-}" = "site-backup" ] || exit 126\nexec python3 -c \'import base64;exec(base64.b64decode("'+encoded+'"))\'\n');command.chmod(0o755)
    line='restrict,command="'+str(command)+'" '+parts[0]+' '+parts[1]+' '+tag
    assert keys.read_text()==before;keys.write_text(before.rstrip('\n')+'\n'+line+'\n');keys.chmod(0o600)
    return {'temporaryBackupGrant':True,'oneShot':True,'command':'site-backup','sha256':digest(target),'bytes':target.stat().st_size}

def main(settings):
    assert (ROOT/'.portal-owner').read_text().strip()=='qiandengji-agent-portal'
    assert settings['stageName'] in ['stage-r3','stage-r4']
    stage=ROOT/'sao-shared-access-20261030'/settings['stageName'];candidate=json.loads((stage/'stage-ready.json').read_text());assert candidate['passed']
    deployment=ROOT/'sao-shared-access-20261030/deployment';assert not deployment.exists();deployment.mkdir(mode=0o700)
    transaction=deployment/'transaction.json';transaction.write_text(json.dumps({'phase':'preflight','at':time.time()}))
    live=json.loads(docker('inspect',NAME))[0];hc=live['HostConfig'];mounts={m['Destination']:m for m in live['Mounts']}
    assert live['Id']==candidate['previousContainerId'] and live['Image']==candidate['previousImageId'] and live['State']['Running']
    assert digest(CONFIG)==candidate['previousConfigSha256']
    assert docker('image','inspect','--format','{{.Id}}',candidate['image'])==candidate['imageId']
    assert set(mounts)=={'/data','/app/config.local.json','/trusted-world-viewer'} and mounts['/data']['Source']=='/var/lib/qiandengji-portal/data'
    assert not mounts['/app/config.local.json']['RW'] and not mounts['/trusted-world-viewer']['RW']
    assert hc['ReadonlyRootfs'] and hc['NetworkMode']=='host' and hc['CapDrop']==['ALL'] and hc['Memory']==536870912 and hc['NanoCpus']==1000000000 and hc['PidsLimit']==96 and 'no-new-privileges:true' in hc['SecurityOpt']
    previous='qiandengji-portal-before-sao-20261030';assert not docker('ps','-aq','--filter','name=^/'+previous+'$')
    port=candidate['productionPort'];assert get(port,'/api/v1/health')['version']=='0.8.31'
    downloads_before=get(port,'/api/v1/downloads');site_before=get(port,'/api/v1/site');config_bytes=CONFIG.read_bytes();config_stat=CONFIG.stat()
    backup=deployment/'backup';backup.mkdir(mode=0o700)
    for name,contents in [('config.json',config_bytes),('container.json',json.dumps(live).encode()),('release.json',(ROOT/'release.json').read_bytes())]:
        file=backup/name;file.write_bytes(contents);file.chmod(0o600)
    env=live['Config']['Env'];assert all('\n' not in x and '\r' not in x for x in env)
    envfile=backup/'container.env';envfile.write_text('\n'.join(env)+'\n');envfile.chmod(0o600)
    stopped=renamed=started=False
    try:
        transaction.write_text(json.dumps({'phase':'stopping-original','at':time.time()}));docker('stop','-t','25',NAME);stopped=True
        old=json.loads(docker('inspect',NAME))[0];assert old['State']['ExitCode']==0,'Original portal did not stop normally'
        owners_before,ownerships_before,counts_before=snapshot();backup_db(backup/'portal.sqlite')
        manifest={f.name:{'bytes':f.stat().st_size,'sha256':digest(f)} for f in backup.iterdir() if f.is_file()}
        (backup/'manifest.json').write_text(json.dumps(manifest,indent=2));(backup/'manifest.json').chmod(0o600)
        archive=deployment/'website-before.zip'
        with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            for f in sorted(backup.iterdir()):z.write(f,f.name)
        archive.chmod(0o600)
        with zipfile.ZipFile(archive) as z:
            assert z.testzip() is None
            for name,entry in manifest.items():assert hashlib.sha256(z.read(name)).hexdigest()==entry['sha256']
        transaction.write_text(json.dumps({'phase':'cold-backup-verified','archiveSha256':digest(archive),'at':time.time()}))
        assert digest(CONFIG)==candidate['previousConfigSha256'];new_config=(stage/'production-config.json').read_bytes();assert hashlib.sha256(new_config).hexdigest()==candidate['newConfigSha256']
        write_owned(CONFIG,new_config,config_stat);docker('rename',NAME,previous);renamed=True
        args=['run','-d','--name',NAME,'--label','app=qiandengji-agent-portal','--label','release=sao-shared-access-20261030','--restart',hc['RestartPolicy']['Name'],'--network','host','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--pids-limit',str(hc['PidsLimit']),'--memory',str(hc['Memory']),'--cpus',str(hc['NanoCpus']/1e9),'--env-file',str(envfile)]
        for path,options in hc['Tmpfs'].items():args+=['--tmpfs',path+':'+options]
        args+=['--log-driver',hc['LogConfig']['Type']]
        for key,value in hc['LogConfig']['Config'].items():args+=['--log-opt',key+'='+value]
        for destination,mount in mounts.items():args+=['--mount','type=bind,src='+mount['Source']+',dst='+destination+('' if mount['RW'] else ',readonly')]
        args.append(candidate['image']);docker(*args);started=True
        for _ in range(40):
            try:assert get(port,'/api/v1/health')['version']=='0.8.32';break
            except Exception:time.sleep(.3)
        else:raise RuntimeError('NEW_SITE_HEALTH_FAILED')
        after=get(port,'/api/v1/downloads');by_id={x['id']:x for x in after['packages']}
        assert all(by_id[row['id']]==row for row in downloads_before['packages'])
        assert by_id['sao-client']['available'] and by_id['sao-client']['sha256']=='e858aee6e22b249a32c33c3a379274683bdedf5b26bd7f682a379f69c6ddb612'
        assert get(port,'/api/v1/site')==site_before,'Existing public site/account discovery changed unexpectedly'
        owners_after,ownerships_after,counts_after=snapshot();assert all(owners_after.get(key)==value for key,value in owners_before.items()) and ownerships_before<=ownerships_after
        for page in ['/sao.html','/downloads.html']:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}'+page,timeout=10) as r:assert r.status==200
        release=json.loads((ROOT/'release.json').read_text());release.update(version='0.8.32',image=candidate['image'],imageId=candidate['imageId'],saoSharedAccess={'at':time.time(),'previousImageId':candidate['previousImageId'],'artifactSha256':candidate['artifactSha256']})
        (ROOT/'release.json').write_text(json.dumps(release,ensure_ascii=False,indent=2)+'\n')
        grant=grant_backup(archive,settings['publicKey'])
        report={'passed':True,'version':'0.8.32','imageId':candidate['imageId'],'previousContainerRetained':previous,'previousImageRetained':candidate['previousImageId'],
            'databaseNotRestored':True,'consistentColdDatabaseBackup':True,'protectedOwnershipsAndPasswordsPreserved':True,'beforeCounts':counts_before,'afterCounts':counts_after,
            'originalNineDownloadsPreserved':True,'viewerMountPreserved':True,'configSha256':digest(CONFIG),'backup':grant,'website':'https://mc.kangqiang.site/sao.html'}
        (deployment/'result.json').write_text(json.dumps(report,indent=2));transaction.write_text(json.dumps({'phase':'complete','passed':True,'at':time.time()}));print(json.dumps(report))
    except Exception:
        # Roll back code/config only. Never replace the live database with an
        # older copy, even when another user acted during the publication.
        if started:
            current=json.loads(docker('inspect',NAME))[0];assert current['Image']==candidate['imageId'];docker('stop','-t','15',NAME);docker('rm',NAME)
        if digest(CONFIG)!=hashlib.sha256(config_bytes).hexdigest():
            assert digest(CONFIG)==candidate['newConfigSha256'],'Concurrent configuration change needs operator reconciliation'
            write_owned(CONFIG,config_bytes,config_stat)
        if renamed:docker('rename',previous,NAME)
        if stopped:docker('start',NAME)
        transaction.write_text(json.dumps({'phase':'rolled-back-code-only','databaseRestored':False,'at':time.time()}));raise
