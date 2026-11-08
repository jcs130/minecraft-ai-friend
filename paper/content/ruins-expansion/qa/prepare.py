"""Prepare a fresh, unstarted loopback fixture from read-only installed binaries.

Never copies player data, auth, NPC registries, private keys, model/voice settings
or live worlds. The original deployed payload adapter is reused byte-for-byte.
"""
from pathlib import Path
import argparse,hashlib,json,os,re,secrets,shutil,socket,subprocess,zipfile
import yaml

def prepare(source,bundle,stage,java):
 if stage.exists():raise ValueError('stage_must_be_new')
 if not(bundle/'manifest.json').is_file():raise ValueError('complete_bundle_required')
 for port in(40081,40085):
  with socket.socket()as s:s.bind(('127.0.0.1',port))
 stage.mkdir(parents=True);(stage/'.qa-only').write_text('QD_RUINS_EXPANSION_20261108');(stage/'plugins').mkdir()
 shutil.copy2(source/'server.jar',stage/'server.jar');shutil.copytree(source/'libraries',stage/'libraries')
 prefixes=['AgentFriend-','AuraSkills-','MagicSpells-','FastAsyncWorldEdit-','worldguard-bukkit-','ProtocolLib-','MythicMobs-','Multiverse-Core-','VortexRPG-','Vault-','EssentialsX-','QiandengjiRpg-','Citizens-']
 binaries=[]
 for prefix in prefixes:
  matches=list((source/'plugins').glob(prefix+'*.jar'))
  if len(matches)!=1:raise ValueError('exactly_one_binary_required:'+prefix)
  jar=matches[0];shutil.copy2(jar,stage/'plugins'/jar.name);binaries.append({'name':jar.name,'sha256':hashlib.sha256(jar.read_bytes()).hexdigest()})
 for name in['ViaVersion.jar','ViaBackwards.jar']:
  jar=source/'plugins'/name;shutil.copy2(jar,stage/'plugins'/name);binaries.append({'name':name,'sha256':hashlib.sha256(jar.read_bytes()).hexdigest()})
 (stage/'mods').mkdir();proxy=list((source/'mods').glob('proxy-compatible-forge-*.jar'))
 if len(proxy)!=1:raise ValueError('exactly_one_proxy_compat_binary_required')
 shutil.copy2(proxy[0],stage/'mods'/proxy[0].name)
 (stage/'config').mkdir(exist_ok=True)
 (stage/'config/proxy-compatible-forge.toml').write_text('[forwarding]\nenabled = false\n[crossStitch]\nenabled = true\nforceWrapVanillaArguments = false\n',encoding='utf-8')
 af=next((stage/'plugins').glob('AgentFriend-*.jar'))
 with zipfile.ZipFile(af)as z:config=yaml.safe_load(z.read('config.yml'))
 def scrub(v):
  if isinstance(v,dict):return {k:scrub(x)for k,x in v.items()}
  if isinstance(v,list):return list(map(scrub,v))
  if isinstance(v,str):
   if re.match(r'^[A-Za-z]:[/\\]',v):return (stage/'disabled-external'/Path(v).name).as_posix()
   if v.startswith(('http://','https://')):return 'http://127.0.0.1:1/qa-disabled'
  return v
 config=scrub(config);config['rpg-backend']='vortex';config['conquest-world']={'enabled':False}
 def write(rel,data):
  p=stage/rel;p.parent.mkdir(exist_ok=True,parents=True);p.write_text(yaml.safe_dump(data,allow_unicode=True,sort_keys=False),encoding='utf-8')
 write('plugins/AgentFriend/config.yml',config)
 write('plugins/QiandengjiRpg/config.yml',{'backend':'vortex'})
 write('plugins/bStats/config.yml',{'enabled':False})
 overlay=yaml.safe_load((bundle/'dungeons-overlay.yml').read_text(encoding='utf-8'))
 for site in overlay['sites'].values():site['world']='world'
 write('plugins/AgentFriend/dungeons.yml',overlay)
 for name in['bosses.yml','dungeons.yml','effects.yml','fractures.yml','gateways.yml','items.yml','quests.yml','spells.yml','talents.yml']:
  p=stage/'plugins/VortexRPG'/name;p.parent.mkdir(exist_ok=True,parents=True);shutil.copy2(source/'plugins/VortexRPG'/name,p)
 for sub,name in[('Mobs','qiandengji-ruins-mobs.yml'),('Skills','qiandengji-ruins-skills.yml')]:
  p=stage/'plugins/MythicMobs'/sub/name;p.parent.mkdir(exist_ok=True,parents=True);shutil.copy2(bundle/'MythicMobs'/name,p)
 shutil.copytree(bundle,stage/'ruins-content')
 props={'server-ip':'127.0.0.1','server-port':40081,'rcon.port':40085,'rcon.password':secrets.token_urlsafe(32),'enable-rcon':'true','online-mode':'false','enforce-secure-profile':'false','white-list':'false','spawn-protection':0,'view-distance':3,'simulation-distance':3,'allow-nether':'false','enable-command-block':'false','level-name':'world','level-type':'minecraft:flat','generate-structures':'false','generator-settings':json.dumps({'biome':'minecraft:plains','layers':[{'block':'minecraft:bedrock','height':1},{'block':'minecraft:stone','height':63}]}),'motd':'QD_RUINS_EXPANSION_20261108_QA_ONLY','max-players':8}
 (stage/'server.properties').write_text('\n'.join(str(k)+'='+str(v)for k,v in props.items())+'\n');(stage/'eula.txt').write_text('eula=true\n')
 for name in['ops.json','whitelist.json','usercache.json']:(stage/name).write_text('[]\n')
 bridge=list((source/'plugins').glob('qiandengji-maid-native-*.jar'))
 if len(bridge)!=1:raise ValueError('exactly_one_deployed_payload_adapter_required')
 classes=stage/'qa-classes';classes.mkdir()
 cp=os.pathsep.join(map(str,[bridge[0],*stage.glob('libraries/**/*.jar'),*stage.glob('plugins/*.jar')]))
 args=['-proc:none','--release','21','-encoding','UTF-8','-cp',cp,'-d',str(classes),str(Path(__file__).with_name('RuinsFixture.java'))]
 argfile=stage/'qa-compile.args';argfile.write_text('\n'.join('"'+x.replace('\\','/')+'"'for x in args),encoding='utf-8')
 subprocess.run([str(java/'javac.exe'),'@'+str(argfile)],check=True)
 with zipfile.ZipFile(stage/'plugins/RuinsFixture.jar','w',zipfile.ZIP_DEFLATED)as out:
  for f in classes.rglob('*.class'):out.write(f,f.relative_to(classes).as_posix())
  with zipfile.ZipFile(bridge[0])as original:
   for name in original.namelist():
    if name.startswith('local/tlmcompat/hybrid/HybridPluginPayloads')and name.endswith('.class'):out.writestr(name,original.read(name))
  out.writestr('plugin.yml','name: RuinsFixture\nversion: 1.0\nmain: org.qiandengji.ruinsqa.RuinsFixture\napi-version: "1.21.1"\ndepend: [AgentFriend, AuraSkills, VortexRPG, ProtocolLib]\ncommands:\n  qruins: {}\n')
 (stage/'qa-baseline.json').write_text(json.dumps({'binaries':binaries,'contentRevision':json.loads((bundle/'manifest.json').read_text(encoding='utf-8'))['revision'],'manifestSha256':hashlib.sha256((bundle/'manifest.json').read_bytes()).hexdigest(),'payloadAdapterSource':bridge[0].name,'payloadAdapterSha256':hashlib.sha256(bridge[0].read_bytes()).hexdigest(),'productionModified':False},indent=2))
 print(json.dumps({'prepared':True,'stage':str(stage),'autoStarted':False,'productionModified':False}))

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,required=True);p.add_argument('--bundle',type=Path,required=True);p.add_argument('--stage',type=Path,required=True);p.add_argument('--java-bin',type=Path,required=True);a=p.parse_args();prepare(a.source,a.bundle,a.stage,a.java_bin)
