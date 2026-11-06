"""Prepare a resident-camera launch manifest from a verified installed NeoForge profile.

Uses Mojang/NeoForge launch metadata, with no launcher-account tokens or gameplay
automation. The original installed runtime, client mods and assets stay separate.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import uuid
import zipfile


def allowed(rules):
    if not rules:return True
    result=False
    for rule in rules:
        matches=all(re.search(pattern,{'name':'windows','arch':'amd64','version':'10.0'}[name]) for name,pattern in rule.get('os',{}).items())
        matches=matches and all(value is False for value in rule.get('features',{}).values())
        if matches:result=rule['action']=='allow'
    return result


def manifest(runtime,game,assets,username,player_uuid):
    if not re.fullmatch(r'[A-Za-z0-9_]{1,16}',username):raise ValueError('Invalid camera name')
    uuid.UUID(player_uuid)
    base=json.loads((runtime/'versions/1.21.1/1.21.1.json').read_text())
    profile=json.loads((runtime/'versions/neoforge-21.1.252/neoforge-21.1.252.json').read_text())
    if profile.get('inheritsFrom')!='1.21.1':raise ValueError('Unreviewed game version')
    libraries={}
    for row in base['libraries']+profile['libraries']:
        parts=row['name'].split(':');libraries[tuple(parts[:2]+parts[3:])]=row
    cp=[];receipt=[];natives=game/'natives';natives.mkdir(exist_ok=True)
    for row in libraries.values():
        if not allowed(row.get('rules',[])):continue
        artifact=row.get('downloads',{}).get('artifact')
        if artifact:path=runtime/'libraries'/artifact['path'];expected=artifact.get('sha1')
        else:
            group,name,version,*classifier=row['name'].split(':')
            path=runtime/'libraries'/group.replace('.','/')/name/version/(name+'-'+version+('-'+classifier[0] if classifier else '')+'.jar');expected=None
        path=path.resolve()
        if not path.is_relative_to((runtime/'libraries').resolve()):raise ValueError('Library path escapes installed runtime')
        data=path.read_bytes();digest=hashlib.sha1(data).hexdigest()
        if expected and digest!=expected:raise ValueError('Library checksum mismatch: '+row['name'])
        cp.append(str(path));receipt.append({'name':row['name'],'sha256':hashlib.sha256(data).hexdigest()})
        if 'natives-windows' in path.name and not any(x in path.name for x in ['-arm64','-x86.jar']):
            with zipfile.ZipFile(path) as z:
                for name in z.namelist():
                    if name.lower().endswith('.dll') and '/' not in name and '\\' not in name:(natives/name).write_bytes(z.read(name))
    client=runtime/'versions/1.21.1/1.21.1.jar';data=client.read_bytes()
    if hashlib.sha1(data).hexdigest()!=base['downloads']['client']['sha1']:raise ValueError('Original client checksum mismatch')
    # NeoForge's ignoreList names the inherited client using version_name.
    # Adding 1.21.1.jar itself creates a second automatic Minecraft module.
    inherited=runtime/'versions'/profile['id']/(profile['id']+'.jar')
    if inherited.exists():
        if hashlib.sha256(inherited.read_bytes()).digest()!=hashlib.sha256(data).digest():raise ValueError('Inherited client differs from original')
    else:inherited.write_bytes(data)
    cp.append(str(inherited))
    values={'auth_player_name':username,'version_name':profile['id'],'game_directory':str(game),'assets_root':str(assets),'assets_index_name':base['assetIndex']['id'],'auth_uuid':player_uuid,'auth_access_token':'0','clientid':'','auth_xuid':'0','user_type':'legacy','version_type':'release','natives_directory':str(natives),'launcher_name':'QiandengNativeCamera','launcher_version':'0.2.0','classpath':os.pathsep.join(cp),'classpath_separator':os.pathsep,'library_directory':str(runtime/'libraries')}
    def expand(arguments):
        output=[]
        for item in arguments:
            if isinstance(item,dict):
                if not allowed(item.get('rules',[])):continue
                parts=item['value'] if isinstance(item['value'],list) else [item['value']]
            else:parts=[item]
            for part in parts:
                for name,value in values.items():part=part.replace('${'+name+'}',value)
                if '${' in part:raise ValueError('Unknown launcher argument')
                output.append(part)
        return output
    args=['-Xms512M','-Xmx2G','-XX:ActiveProcessorCount=2','-Dfile.encoding=UTF-8']+expand(base['arguments']['jvm'])+expand(profile['arguments']['jvm'])+[profile['mainClass']]+expand(base['arguments']['game'])+expand(profile['arguments']['game'])+['--width','1280','--height','1280']
    return {'loader':'neoforge','version':'21.1.252','arguments':args,'libraries':receipt}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('runtime','game','assets'):parser.add_argument('--'+name,type=Path,required=True)
    for name in ('username','uuid'):parser.add_argument('--'+name,required=True)
    args=parser.parse_args();game=args.game.resolve();target=game/'launch.json'
    if target.exists():raise SystemExit('Refuse to replace an existing launch manifest')
    game.mkdir(parents=True,exist_ok=True)
    value=manifest(args.runtime.resolve(),game,args.assets.resolve(),args.username,args.uuid)
    target.write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'prepared':True,'loader':value['loader'],'libraries':len(value['libraries'])}))


if __name__=='__main__':main()
