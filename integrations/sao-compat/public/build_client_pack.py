"""Build a credential-free Modrinth client pack from the pinned author archive.

Never reads a player's launcher/account directory. Installed server-only code,
worlds, auth databases and the operator's API keys are not input paths.
"""
from pathlib import Path,PurePosixPath
import argparse,hashlib,json,re,struct,zipfile

SOURCE_SHA='707f8a9db948a9ad5855b28246ec46738a9a7fe953ed30d0531e4291967360bd'
VOICE_SHA='e48098690a01ba75e4f5549cbfda142de4513ec421001914a4a11164cceaccd0'
SENSITIVE={'api_key','apikey','api_token','access_token','accesstoken','secret_key','secretkey','access_key','accesskey','authorization','password','refresh_token'}
SECRET_PATTERN=re.compile(rb'(?:sk-(?:sp-)?[A-Za-z0-9_.-]{20,}|LTAI[A-Za-z0-9]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)')
def sha(p):
 with Path(p).open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def clean_json(value,changes,path=''):
 if isinstance(value,dict):
  out={}
  for key,item in value.items():
   at=path+'.'+key
   if key.lower().replace('-','_')in SENSITIVE and isinstance(item,str)and item:
    changes.append(at);out[key]=''
   else:out[key]=clean_json(item,changes,at)
  return out
 if isinstance(value,list):return [clean_json(item,changes,path+'[]')for item in value]
 return value
def server_list(address):
 def string(value):raw=value.encode('utf-8');return struct.pack('>H',len(raw))+raw
 def tag(name,value):return b'\x08'+string(name)+string(value)
 return b'\x0a\0\0\x09'+string('servers')+b'\x0a'+struct.pack('>i',1)+tag('name','My Agent World · SAO')+tag('ip',address)+b'\x01'+string('hideAddress')+b'\0\0\0'
def build(source,voice,output):
 source,voice,output=map(Path,(source,voice,output))
 if sha(source)!=SOURCE_SHA or sha(voice)!=VOICE_SHA:raise ValueError('pinned_client_source_required')
 if output.exists():raise FileExistsError('immutable_client_package_already_exists')
 changes=[];skipped=[];entries={}
 with zipfile.ZipFile(source)as archive:
  index=json.loads(archive.read('modrinth.index.json'))
  if index.get('dependencies')!={'minecraft':'1.20.1','forge':'47.4.10'}:raise ValueError('exact_sao_client_version_required')
  for entry in archive.infolist():
   name=entry.filename;p=PurePosixPath(name)
   if entry.is_dir():continue
   if p.is_absolute()or'..'in p.parts or'\\'in name or entry.file_size>128*1024*1024 or (entry.external_attr>>16)&0o170000==0o120000:raise ValueError('unsafe_client_archive_path')
   lower=name.lower()
   if name in entries:raise ValueError('duplicate_client_archive_path')
   if lower=='overrides/config/resourceful-config-web.json':
    # Per-install web configuration contains a generated validator password.
    # Let the mod create its own protected defaults; an empty password would
    # change the authentication semantics instead of removing local state.
    skipped.append(name);continue
   if any(part in lower.split('/')for part in ['logs','saves','screenshots','crash-reports','.git'])or any(lower.endswith(x)for x in ['accounts.json','launcher_accounts.json','usercache.json','servers.dat','servers.dat_old']):skipped.append(name);continue
   raw=archive.read(entry)
   if lower.endswith('.json')and'/config/'in lower:
    try:value=json.loads(raw)
    except (UnicodeDecodeError,json.JSONDecodeError):value=None
    if value is not None:
     fields=[];clean=clean_json(value,fields)
     if fields:raw=(json.dumps(clean,ensure_ascii=False,indent=2)+'\n').encode();changes.append({'file':name,'clearedFields':fields})
   if name=='overrides/options.txt':raw=b'\n'.join(line for line in raw.splitlines()if not line.startswith((b'lastServer:',b'lastServerAddress:')))+b'\n'
   if not lower.endswith(('.jar','.zip','.png','.ogg','.mp3','.ttf','.otf','.nbt'))and SECRET_PATTERN.search(raw):raise ValueError('credential_pattern_requires_review:'+name)
   entries[name]=raw
  index.update(name='My Agent World · SAO 0.76.1-lite',versionId='maw-sao-0.76.1-lite-20261030.2',summary='SAO 1.20.1 multiplayer client. Shared Qiandengji game account; world progress remains separate.')
  entries['modrinth.index.json']=(json.dumps(index,ensure_ascii=False,indent=2)+'\n').encode()
 entries['overrides/servers.dat']=server_list('micro.kangqiang.site:28976')
 entries['overrides/mods/voicechat-forge-1.20.1-2.6.27.jar']=voice.read_bytes()
 entries['overrides/My Agent World 连接说明.txt']=('My Agent World · SAO 0.76.1-lite\nMinecraft 1.20.1 / Forge 47.4.10 / Java 17\n\n在支持 Modrinth 整合包的启动器中导入本 mrpack，按提示下载声明的依赖。\n服务器已添加到多人游戏列表：micro.kangqiang.site:28976\n网站：https://mc.kangqiang.site\n使用本人千灯纪游戏角色；网页账号可管理并加入本世界，游戏进度各服独立。\n不要向他人提供密码或模型 Key。真人账号与启动器微软登录由本人完成。\nJava 距离语音：UDP28989，包内有 Simple Voice Chat。\n基岩无需导入本包，使用 micro.kangqiang.site / UDP28988，接受资源包。\n作者原包：https://pan.quark.cn/s/1a81ea41915c\n本包仅调整服务器列表、清除配置凭据并加入语音客户端；不含维护者账号、存档、模型或个人记忆。\n').encode('utf-8')
 output.parent.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(output,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6)as archive:
  for name,raw in sorted(entries.items()):
   info=zipfile.ZipInfo(name,date_time=(2026,10,30,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;archive.writestr(info,raw)
 with zipfile.ZipFile(output)as archive:
  if archive.testzip():raise ValueError('invalid_completed_client_archive')
 report={'schemaVersion':1,'id':'sao-client','version':'0.76.1-lite-20261030.2','filename':output.name,'path':str(output.resolve()),'bytes':output.stat().st_size,'sha256':sha(output),'sourceSha256':SOURCE_SHA,'minecraft':'1.20.1','loader':'Forge 47.4.10','java':17,'indexDownloads':len(index['files']),'archiveEntries':len(entries),'clearedConfigurationFields':changes,'omittedEntries':skipped,'serverList':'micro.kangqiang.site:28976','voiceVersion':'2.6.27','launcherAccountsIncluded':False,'worldSavesIncluded':False,'operatorModelKeysReadOrIncluded':False,'dependencyDownloadsRequired':True}
 output.with_suffix('.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');return report
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',required=True);p.add_argument('--voice',required=True);p.add_argument('--output',required=True);a=p.parse_args();print(json.dumps(build(a.source,a.voice,a.output),ensure_ascii=False))
