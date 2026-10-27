"""Add isolated Geyser/Floodgate/ViaVersion using binary-only reads, no live keys."""
from pathlib import Path
import hashlib,json,shutil,zipfile
import yaml
stage=Path('E:/MC/staging/vortex-mmo-20261027');assert 'motd=QD_VORTEX_MMO_QA_ONLY' in (stage/'server.properties').read_text()
plugins=stage/'plugins';receipts=[]
for name in ['Geyser-Spigot.jar','floodgate-spigot.jar','ViaVersion.jar']:
 source=Path('E:/MC/server/plugins')/name;shutil.copy2(source,plugins/name);receipts.append({'name':name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest()})
with zipfile.ZipFile(plugins/'Geyser-Spigot.jar')as jar:
 names=[n for n in jar.namelist()if n in ['config.yml','config.yml.example']]
 # Current Geyser bootstrap no longer embeds the core's config template.
 # Reuse only the previously validated *isolated* config, never a live key/store.
 config=yaml.safe_load(jar.read(names[0]))if names else yaml.safe_load(Path('E:/MC/staging/life-challenges-20261014/paper/plugins/Geyser-Spigot/config.yml').read_text(encoding='utf8'))
config['bedrock']['address']='127.0.0.1';config['bedrock']['port']=19186
remote='remote' if 'remote' in config else 'java'
config[remote]['address']='127.0.0.1';config[remote]['port']=25926;config[remote]['auth-type']='floodgate'
config['forward-player-ping']=True
config['saved-user-logins']=[]
if 'metrics'in config:config['metrics']['enabled']=False
out=plugins/'Geyser-Spigot';out.mkdir(exist_ok=False);(out/'config.yml').write_text(yaml.safe_dump(config,sort_keys=False,allow_unicode=True),encoding='utf8')
(stage/'bedrock-binary-inputs.json').write_text(json.dumps(receipts,indent=2),encoding='utf8')
print(json.dumps({'geyserPort':19186,'bind':'127.0.0.1','liveSecretsCopied':False}))
