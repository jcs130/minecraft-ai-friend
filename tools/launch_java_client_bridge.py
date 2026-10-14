"""Launch an explicit isolated offline QA client using an official NeoForge cache.

For public authenticated servers install the optional mod in a normal launcher
and log in normally. This helper never reads or copies launcher account tokens.
"""
from pathlib import Path
import argparse, hashlib, json, os, re, subprocess, uuid, zipfile

def allowed(lib):
    rules=lib.get('rules',[]);value=not rules
    for rule in rules:
        system=rule.get('os',{})
        if system.get('name','windows')!='windows' or rule.get('features'):continue
        if system.get('arch','amd64') not in ('amd64','x86_64'):continue
        value=rule['action']=='allow'
    return value

def launch(minecraft:Path,game:Path,java:Path,username:str,server:str,*,qa_quit=False,memory='2304M'):
    minecraft=minecraft.resolve();game=game.resolve()
    if game==minecraft or not re.fullmatch('[A-Za-z0-9_]{3,16}',username) or not re.fullmatch(r'127\.0\.0\.1:\d{1,5}',server):
        raise ValueError('Offline QA requires a separate game directory, explicit identity and loopback server')
    if not (game/'mods').is_dir():raise ValueError('Prepare the isolated client mods explicitly')
    base=json.loads((minecraft/'versions/1.21.1/1.21.1.json').read_bytes())
    neo=json.loads((minecraft/'versions/neoforge-21.1.248/neoforge-21.1.248.json').read_bytes())
    if neo['inheritsFrom']!='1.21.1':raise ValueError('Unexpected NeoForge cache')
    jars=[];natives=game/'bridge-launch/natives';natives.mkdir(parents=True,exist_ok=True)
    for lib in neo['libraries']+base['libraries']:
        if not allowed(lib):continue
        artifact=lib.get('downloads',{}).get('artifact')
        if not artifact:continue
        file=minecraft/'libraries'/artifact['path']
        if not file.is_file():raise ValueError('Missing official library: '+artifact['path'])
        if artifact.get('sha1') and hashlib.sha1(file.read_bytes()).hexdigest()!=artifact['sha1']:raise ValueError('Library hash mismatch: '+artifact['path'])
        jars.append(file)
        if 'natives-windows' in lib['name']:
            with zipfile.ZipFile(file) as z:
                for name in z.namelist():
                    if name.endswith('.dll'):(natives/Path(name).name).write_bytes(z.read(name))
    values={'natives_directory':natives,'launcher_name':'MyAgentWorld-ClientBridge-QA','launcher_version':'0.1.0',
        'classpath':os.pathsep.join(map(str,dict.fromkeys(jars))),'library_directory':minecraft/'libraries','classpath_separator':os.pathsep,
        'version_name':neo['id'],'auth_player_name':username,'game_directory':game,'assets_root':minecraft/'assets',
        'assets_index_name':base['assetIndex']['id'],'auth_uuid':uuid.UUID(bytes=hashlib.md5(('OfflinePlayer:'+username).encode()).digest(),version=3).hex,
        'auth_access_token':'0','clientid':'','auth_xuid':'','user_type':'legacy','version_type':'isolated Agent bridge QA'}
    def expand(items):
        out=[]
        for item in items:
            if not isinstance(item,str):continue # No demo/custom-resolution/quickplay feature branches.
            for key,value in values.items():item=item.replace('${'+key+'}',str(value))
            if '${' in item:raise ValueError('Unresolved launch placeholder')
            out.append(item)
        return out
    args=['-Xms256M','-Xmx'+memory,'-Dfile.encoding=UTF-8','-Dstdout.encoding=UTF-8','-Dstderr.encoding=UTF-8']
    if qa_quit:args.append('-Dmaw.clientBridge.qaQuit=true')
    args+=expand(base['arguments']['jvm'])+expand(neo['arguments']['jvm'])+[neo['mainClass']]
    args+=expand(base['arguments']['game'])+expand(neo['arguments']['game'])+['--quickPlayMultiplayer',server]
    def quote(value):return '"'+str(value).replace('\\','/').replace('"','\\"')+'"'
    argfile=game/'bridge-launch/java.args';argfile.write_text('\n'.join(map(quote,args)),encoding='utf-8')
    log=(game/'bridge-launch/client.log').open('w',encoding='utf-8')
    child=subprocess.Popen([str(java),'@'+str(argfile)],cwd=game,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
    (game/'bridge-launch/process.json').write_text(json.dumps({'pid':child.pid,'username':username,'server':server,'isolated':True,'accountTokensRead':False}),encoding='utf-8')
    return child,log

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    for name in ('minecraft','game','java'):ap.add_argument('--'+name,type=Path,required=True)
    ap.add_argument('--username',required=True);ap.add_argument('--server',required=True);ap.add_argument('--qa-quit',action='store_true')
    a=ap.parse_args();child,log=launch(a.minecraft,a.game,a.java,a.username,a.server,qa_quit=a.qa_quit)
    try:print(json.dumps({'clientExitCode':child.wait()}))
    finally:log.close()
