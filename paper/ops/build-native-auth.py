"""Prepare an empty loopback authentication world with the current immutable Youer/mod inputs."""
from pathlib import Path
import argparse,hashlib,json,secrets,shutil

# A reviewed server-only command wrapper is not an authentication content mod.
OPTIONAL_SERVER_ONLY_MODS={
    'proxy-compatible-forge-1.3.1.jar': 'dba5b70fedcb0f5fdc014801ab43e6d048f24b531de8aea5b70ea223760b66ae9fba3033c2ccd9d78793b9ea2f9d3b47ae1f4caa95aa129d989f97e63636b4ab'
}

def authentication_content_mods(server):
    all_mods=sorted((server/'mods').glob('*.jar'))
    if any(p.is_symlink() for p in all_mods):
        raise ValueError('Authentication inputs must be regular immutable files')
    content=[]
    for mod in all_mods:
        expected=OPTIONAL_SERVER_ONLY_MODS.get(mod.name)
        if expected is None:
            content.append(mod)
        elif hashlib.sha512(mod.read_bytes()).hexdigest()!=expected:
            raise ValueError('Unreviewed optional server-only PCF artifact')
    if len(content)!=3 or not any(p.name.startswith('touhoulittlemaid-') for p in content) or not any(p.name.startswith('ysm-2.6.5-neoforge') for p in content) or not any(p.name.startswith('qiandengji-native-platform-') for p in content):
        raise ValueError('Review the current content-mod set before preparing its authentication peer')
    return content

def prepare(server,output,port,rcon_port):
    server=server.resolve();output=output.resolve()
    if output.exists()or output==server or server.is_relative_to(output)or output.is_relative_to(server):raise ValueError('Use a fresh separate authentication directory')
    if port==rcon_port or any(not 1024<=value<=65535 for value in [port,rcon_port]):raise ValueError('Use two distinct local ports')
    required=['server.jar','eula.txt','libraries','mods']
    if any(not(server/name).exists()for name in required):raise ValueError('Current Youer server inputs missing')
    mods=authentication_content_mods(server)
    ysm=next(p for p in mods if p.name.startswith('ysm-2.6.5-neoforge'))
    if hashlib.sha256(ysm.read_bytes()).hexdigest()!='b285c73d4ec010d9a9be3c53c1bee890cf269645be5f1bcf1c27a2e8e82807cb':raise ValueError('Use the pinned original NeoForge YSM 2.6.5 artifact')
    libraries=list((server/'libraries').rglob('*'))
    if not libraries or (server/'libraries').is_symlink()or any(p.is_symlink()for p in libraries):raise ValueError('Use a complete regular library directory')
    sources=[server/'server.jar',server/'eula.txt',*mods,*[p for p in libraries if p.is_file()]]
    if any(p.is_symlink()for p in sources):raise ValueError('Authentication inputs must be regular immutable files')
    output.mkdir(parents=True);manifest={}
    for source in sources:
        relative=source.relative_to(server);target=output/relative;target.parent.mkdir(parents=True,exist_ok=True)
        before=hashlib.sha256(source.read_bytes()).hexdigest()
        shutil.copyfile(source,target)
        if hashlib.sha256(target.read_bytes()).hexdigest()!=before:raise RuntimeError('Immutable input changed during preparation')
        manifest[relative.as_posix()]=before
    props={'server-ip':'127.0.0.1','server-port':str(port),'rcon.port':str(rcon_port),'rcon.password':secrets.token_urlsafe(32),'enable-rcon':'true','online-mode':'false','enforce-secure-profile':'false','gamemode':'spectator','force-gamemode':'true','difficulty':'peaceful','pvp':'false','spawn-protection':'0','view-distance':'2','simulation-distance':'2','allow-nether':'false','level-name':'world','level-type':'minecraft:flat','generate-structures':'false','generator-settings':json.dumps({'biome':'minecraft:the_void','layers':[]},separators=(',',':')),'max-players':'40','motd':'Qiandengji authentication','sync-chunk-writes':'true'}
    (output/'server.properties').write_text('\n'.join(k+'='+v for k,v in props.items())+'\n',encoding='utf-8')
    for name in ['ops.json','whitelist.json']:(output/name).write_text('[]',encoding='utf-8')
    (output/'.native-auth-only').write_text('QIANDENGJI_NATIVE_AUTH_ONLY')
    result={'schemaVersion':1,'immutableFiles':manifest,'port':port,'rconPort':rcon_port,'playerDataCopied':False,'credentialsCopied':False,'sourceWorldCopied':False,'requiresOriginalProxyAuthentication':True}
    (output/'auth-build.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--server',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--port',type=int,required=True);p.add_argument('--rcon-port',type=int,required=True);a=p.parse_args()
    r=prepare(a.server,a.output,a.port,a.rcon_port);print(json.dumps({'prepared':True,'immutableFiles':len(r['immutableFiles']),'sourceWorldCopied':False,'credentialsCopied':False,'started':False}))
