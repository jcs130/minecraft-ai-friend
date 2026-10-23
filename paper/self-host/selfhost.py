"""Prepare a separate, empty local Paper sandbox and compile public sources.

No production paths, credential stores or operator/player lists are read. This
is a source build, not a byte-for-byte recreation of the maintained home world.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
LOCK = Path(__file__).with_name('dependencies.lock.json')
USER_AGENT = 'qiandengji-selfhost/1.0 (https://github.com/jcs130/minecraft-ai-friend)'
PORTAL_REF = 'cb51ba79bbfb6377dee10eb3e8c45020dce00b59'
PORTAL_VERSION = '0.8.8'
MARKER = '.qiandengji-self-host.json'


def jdk_tools(home=None):
    home = home or os.environ.get('JAVA_HOME')
    suffix = '.exe' if os.name == 'nt' else ''
    result = {name: str(Path(home)/'bin'/(name+suffix)) if home else shutil.which(name)
              for name in ['java', 'javac']}
    if not all(result.values()) or any(not Path(p).is_file() for p in result.values()):
        raise ValueError('A JDK 21 is required; set JAVA_HOME or pass --jdk.')
    version = subprocess.run([result['javac'], '-version'], capture_output=True, text=True, check=True)
    if not re.search(r'\bjavac 21(?:\.|\s|$)', version.stdout + version.stderr):
        raise ValueError('Use JDK 21 for this locked Minecraft 1.21.1 source build.')
    return result


def load_lock():
    lock = json.loads(LOCK.read_text(encoding='utf-8'))
    if lock['minecraft'] != '1.21.1' or lock['paperBuild'] != 133:
        raise ValueError('Review a changed core lock before using this helper.')
    for item in lock['artifacts']:
        rel = Path(item['path'])
        url=urlsplit(item['url'])
        if rel.is_absolute() or '..' in rel.parts or '\\' in item['path'] or ':' in item['path'] or url.scheme!='https' or url.username or url.password or url.query or url.fragment or url.hostname not in ['fill-data.papermc.io','cdn.modrinth.com','github.com','repo.maven.apache.org']:
            raise ValueError('Invalid dependency path or non-HTTPS source.')
        if item['algorithm'] not in ['sha256', 'sha512'] or not re.fullmatch('[a-f0-9]{64}' if item['algorithm']=='sha256' else '[a-f0-9]{128}', item['digest']):
            raise ValueError('Invalid dependency checksum.')
    return lock


def fetch_artifact(item, target):
    target = Path(target)
    if target.exists():
        if hashlib.new(item['algorithm'], target.read_bytes()).hexdigest() != item['digest']:
            raise ValueError('Existing dependency has a different checksum: ' + item['path'])
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(target.suffix+'.part')
    try:
        digest = hashlib.new(item['algorithm']); size = 0
        with urllib.request.urlopen(urllib.request.Request(item['url'], headers={'User-Agent': USER_AGENT}), timeout=90) as response, temp.open('xb') as out:
            if not response.url.startswith('https://'):
                raise ValueError('Dependency download redirected away from HTTPS.')
            while block := response.read(1024*1024):
                size += len(block)
                if size > 256*1024*1024:
                    raise ValueError('Dependency exceeded download size limit.')
                digest.update(block); out.write(block)
        if digest.hexdigest() != item['digest']:
            raise ValueError('Downloaded dependency checksum mismatch: '+item['path'])
        temp.replace(target)
    finally:
        temp.unlink(missing_ok=True)


def prepare(target, tools, accept_eula=False, resume=False, port=25565):
    target = Path(target).resolve(); lock = load_lock()
    if not accept_eula:
        raise ValueError('Read https://aka.ms/MinecraftEULA and explicitly pass --accept-eula.')
    if not 1024 <= port <= 65535:
        raise ValueError('Use a game port from 1024 to 65535.')
    marker = target/MARKER
    digest = hashlib.sha256(LOCK.read_bytes()).hexdigest()
    if target.exists():
        if not resume or not marker.is_file() or json.loads(marker.read_text()) != {'dependencyLock':digest,'port':port}:
            raise ValueError('Use a new directory; --resume is only for this helper\'s matching unfinished sandbox.')
    else:
        target.mkdir(parents=True)
        marker.write_text(json.dumps({'dependencyLock':digest,'port':port})+'\n')
    for item in lock['artifacts']:
        print('Verify/download '+item['path'], flush=True)
        fetch_artifact(item, target/item['path'])
    # Paperclip's patch-only mode prepares Mojang-mapped compile inputs without
    # starting a game server or creating a world. Paper checks its own library
    # hashes; third-party plugins remain locked above.
    subprocess.run([tools['java'],'-Dpaperclip.patchonly=true','-jar','server.jar'], cwd=target, check=True)
    properties = target/'server.properties'
    if not properties.exists():
        properties.write_text('server-ip=127.0.0.1\nserver-port='+str(port)+'\nonline-mode=false\nenforce-secure-profile=false\nenable-rcon=false\nenable-query=false\nmax-players=16\nview-distance=6\nsimulation-distance=6\ndifficulty=normal\nspawn-protection=0\nallow-flight=true\nlevel-name=world\nmotd=Qiandengji isolated source sandbox\n', encoding='utf-8')
    if not (target/'eula.txt').exists():
        (target/'eula.txt').write_text('eula=true\n')
    print('Prepared a local-only sandbox. No game server has been started.')


def resource_entries(directory):
    return {p.relative_to(directory).as_posix():p.read_bytes() for p in sorted(directory.rglob('*')) if p.is_file()}


def export_portal(target, output, port=25565):
    """Export the public production website ref, never local dirty/private files."""
    import io
    target,output=Path(target).resolve(),Path(output).resolve()
    if output.exists():raise ValueError('Use a new portal output directory.')
    if not 1024<=port<=65535:raise ValueError('Invalid game port.')
    exists=subprocess.run(['git','cat-file','-e',PORTAL_REF+'^{commit}'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if exists.returncode:
        subprocess.run(['git','-c','credential.helper=','-c','credential.interactive=never','fetch','--no-tags','--depth=1','https://github.com/jcs130/minecraft-ai-friend.git',PORTAL_REF],cwd=ROOT,check=True,env={**os.environ,'GIT_TERMINAL_PROMPT':'0'})
    raw=subprocess.check_output(['git','archive','--format=zip',PORTAL_REF,'paper/integrations/agent-portal'],cwd=ROOT)
    prefix='paper/integrations/agent-portal/'
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        output.mkdir(parents=True)
        for entry in archive.infolist():
            if entry.is_dir():continue
            if not entry.filename.startswith(prefix):raise ValueError('Unexpected source archive entry.')
            rel=Path(entry.filename[len(prefix):]);file=output/rel
            if rel.is_absolute() or '..' in rel.parts or not file.resolve().is_relative_to(output):raise ValueError('Unsafe source archive entry.')
            file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(archive.read(entry))
    config={'serverDir':str(target),'opsDir':str(target/'private'),'gameHost':'127.0.0.1','gamePort':port,
        'authHeartbeat':str(target/'private/auth-heartbeat.json'),'agentRegistry':str(target/'private/agent-eye-pairs.json'),
        'portalIdentitiesFile':None,'publicRoster':[],'hiddenPlayers':[],'includeKnownPlayers':True,
        'authBridge':{'enabled':False},'cloudAccounts':{'enabled':False},'sourceMode':'local',
        'publicGameAddress':'127.0.0.1:'+str(port),'publicMedia':{}}
    (output/'config.local.json').write_text(json.dumps(config,indent=2)+'\n',encoding='utf-8')
    print('Exported public portal '+PORTAL_VERSION+' from '+PORTAL_REF+'. Configure your own account bridge separately.')


def build(target, output, tools, component='all'):
    target, output = Path(target).resolve(), Path(output).resolve()
    lock = load_lock()
    if not (target/MARKER).is_file():
        raise ValueError('Build only against a sandbox created by prepare, not a live server.')
    for item in lock['artifacts']:
        file=target/item['path']
        if not file.is_file() or hashlib.new(item['algorithm'], file.read_bytes()).hexdigest()!=item['digest']:
            raise ValueError('Missing or mismatched locked dependency: '+item['path'])
    paper=target/'versions/1.21.1/paper-1.21.1.jar'
    if not paper.is_file():
        raise ValueError('Paper patch-only preparation has not finished.')
    if output.exists():
        raise ValueError('Use a new output directory to avoid stale compiled classes.')
    output.mkdir(parents=True)
    classpath=os.pathsep.join(map(str,[paper,*sorted((target/'libraries').rglob('*.jar')),*sorted((target/'plugins').glob('*.jar'))]))
    projects=['AgentFriend','CortiEyeMirror'] if component=='all' else [component]
    summaries=[]
    for name in projects:
        project=ROOT/'paper/plugins'/name; classes=output/(name+'-classes');classes.mkdir()
        sources=[*sorted((project/'src').rglob('*.java')),*sorted((ROOT/'paper/plugins/shared/src').rglob('*.java'))]
        args=['-proc:none','-encoding','UTF-8','--release','21','-cp',classpath,'-d',str(classes),*map(str,sources)]
        argfile=output/(name+'.args')
        argfile.write_text('\n'.join('"'+a.replace('\\','/').replace('"','\\"')+'"' for a in args),encoding='utf-8')
        subprocess.run([tools['javac'],'@'+str(argfile)],check=True)
        entries=resource_entries(classes);entries.update(resource_entries(project/'resources'))
        version=re.search(r"(?m)^version:\s*['\"]?([^'\"\s]+)",entries['plugin.yml'].decode()).group(1)
        if name=='AgentFriend':
            entries['item-appearances.json']=(ROOT/'paper/item-appearances/catalog.json').read_bytes()
            sqlite=next(row for row in lock['artifacts'] if row['path'].endswith('sqlite-jdbc-3.46.0.0.jar'))
            with zipfile.ZipFile(target/sqlite['path']) as driver:
                for entry in driver.infolist():
                    if not entry.is_dir() and re.match(r'^(org/sqlite/|META-INF/services/java.sql.Driver$|META-INF/maven/org.xerial/sqlite-jdbc/|META-INF/(LICENSE|NOTICE))',entry.filename):
                        if '..' in Path(entry.filename).parts:raise ValueError('Unsafe driver entry.')
                        entries[entry.filename]=driver.read(entry)
        entries['META-INF/LICENSE-qiandengji.txt']=(ROOT/'LICENSE').read_bytes()
        entries['META-INF/MANIFEST.MF']=b'Manifest-Version: 1.0\r\npaperweight-mappings-namespace: mojang\r\n\r\n'
        jar=output/(name+'-'+version+'.jar')
        with zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED) as archive:
            for filename,data in sorted(entries.items()):
                info=zipfile.ZipInfo(filename,(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
                archive.writestr(info,data)
        summaries.append({'component':name,'version':version,'jar':jar.name,'sha256':hashlib.sha256(jar.read_bytes()).hexdigest(),'sourceFiles':len(sources)})
    (output/'build.json').write_text(json.dumps({'minecraft':'1.21.1','productionEquivalent':False,'outputs':summaries},indent=2)+'\n')
    print(json.dumps(summaries,indent=2))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['doctor','prepare','build','export-portal'])
    parser.add_argument('--directory',type=Path)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--jdk',type=Path)
    parser.add_argument('--component',choices=['all','AgentFriend','CortiEyeMirror'],default='all')
    parser.add_argument('--accept-eula',action='store_true')
    parser.add_argument('--resume',action='store_true')
    parser.add_argument('--port',type=int,default=25565)
    args=parser.parse_args()
    if args.action=='export-portal':
        if not args.directory or not args.output:parser.error('--directory and --output are required')
        export_portal(args.directory,args.output,args.port);return
    tools=jdk_tools(args.jdk);load_lock()
    if args.action=='doctor':print('JDK 21 and public dependency lock are available; no server paths or credentials were read.')
    elif not args.directory:parser.error('--directory is required')
    elif args.action=='prepare':prepare(args.directory,tools,args.accept_eula,args.resume,args.port)
    elif not args.output:parser.error('--output is required for build')
    else:build(args.directory,args.output,tools,args.component)


if __name__=='__main__':
    try:main()
    except (OSError,ValueError,subprocess.CalledProcessError) as error:
        print('Self-host preparation stopped: '+str(error),file=sys.stderr)
        sys.exit(1)
