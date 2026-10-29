"""Fresh isolated Vortex + LAC test, never copies player data or secrets."""
from pathlib import Path
import argparse,json,shutil,zipfile,hashlib
import yaml
ROOT=Path(__file__).resolve().parents[3]
REPAIR=Path('E:/MC/ops/repairs/vortex-mmo-20261027')
STAGE=Path('E:/MC/staging/vortex-mmo-20261027')
SOURCE=Path('E:/MC/staging/vortex-rpg-fixed-20261026')
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--vortex',type=Path,required=True);args=parser.parse_args()
 assert STAGE.parent.resolve()==Path('E:/MC/staging').resolve() and not STAGE.exists()
 assert 'motd=VORTEX_COMPATIBILITY_QA_ONLY' in (SOURCE/'server.properties').read_text()
 STAGE.mkdir()
 for name in ['server.jar','eula.txt','libraries','versions','cache']:
  src=SOURCE/name;dst=STAGE/name
  if src.is_dir():shutil.copytree(src,dst)
  elif src.is_file():shutil.copy2(src,dst)
 plugins=STAGE/'plugins';plugins.mkdir()
 vortex=Path('E:/MC/ops/repairs/conquest-rpg-20261026/vortex/VortexRPG-1.2.2-alpha-paper1211-compat.jar')
 assert hashlib.sha512(vortex.read_bytes()).hexdigest()=='4cafc171905350e5a56e94239f4f247ad34141d965f93b71c6daf7f8b3af84f75d668fea7eff31eb783b57cd964aecb11a06a036a6c6d9ed64b9ed0a79741d7f'
 patched=args.vortex
 receipt=json.loads(patched.with_suffix('.json').read_text())
 assert hashlib.sha256(patched.read_bytes()).hexdigest()==receipt['sha256']
 for f in [patched,REPAIR/'QiandengjiRpg-0.1.0.jar',REPAIR/'LightAntiCheat-1.2.6.jar']:shutil.copy2(f,plugins/f.name)
 for name in ['VortexRPG','QiandengjiRpg','LightAntiCheat','bStats']:(plugins/name).mkdir()
 def write(name,c):name.write_text(yaml.safe_dump(c,sort_keys=False,allow_unicode=True),encoding='utf8')
 with zipfile.ZipFile(vortex)as z:c=yaml.safe_load(z.read('config.yml'))
 for key in ['fracture-realm','fracture-gateway']:c[key]['enabled']=False
 c['fracture-gateway']['auto-create-primary']=False;c['fracture-gateway']['auto-create-return']=False;c['smart-systems']['director']['enabled']=False
 c['npc']['base-url']='http://127.0.0.1:1/disabled-test-only';c['scoreboard']['enabled']=False
 c['class-selection']['effects']['firework']=False
 write(plugins/'VortexRPG/config.yml',c)
 shutil.copy2(ROOT/'integrations/vortex-rpg/resources/config.yml',plugins/'QiandengjiRpg/config.yml')
 shutil.copy2(REPAIR/'anticheat-candidate/config.yml',plugins/'LightAntiCheat/config.yml')
 write(plugins/'bStats/config.yml',{'enabled':False})
 # Only adventure, combat and healing paths are exposed; no farming prerequisite.
 quests={'resource-version':1,'quests':{'qd_first_hunt':{'name':'公会初战','description':'击败2只僵尸，学习战斗后回公会交付。','required-level':1,'repeatable':False,'objectives':{'zombies':{'type':'KILL_MOB','target':'zombie','amount':2,'description':'击败僵尸'}},'rewards':[{'type':'EXPERIENCE','amount':180}]},'qd_city_scout':{'name':'起始之城的道路','description':'前往东北侦察点；测试用目标(12, -60, 12)，后续绑定真实主城。','required-level':1,'repeatable':False,'objectives':{'scout':{'type':'VISIT_LOCATION','target':'qa_world:12:-60:12:4','amount':1,'description':'抵达侦察点'}},'rewards':[{'type':'EXPERIENCE','amount':80}]}}}
 write(plugins/'VortexRPG/quests.yml',quests)
 props={'server-ip':'127.0.0.1','server-port':'25926','online-mode':'false','enforce-secure-profile':'false','level-name':'qa_world','level-type':'minecraft:flat','generator-settings':json.dumps({'biome':'minecraft:plains','layers':[{'block':'minecraft:bedrock','height':1},{'block':'minecraft:dirt','height':2},{'block':'minecraft:grass_block','height':1}]}),'generate-structures':'false','spawn-protection':'0','view-distance':'3','simulation-distance':'3','max-players':'4','enable-rcon':'false','enable-query':'false','allow-nether':'false','allow-flight':'true','motd':'QD_VORTEX_MMO_QA_ONLY','sync-chunk-writes':'true'}
 (STAGE/'server.properties').write_text('\n'.join(k+'='+v for k,v in props.items())+'\n',encoding='utf8')
 print(json.dumps({'stage':str(STAGE),'productionChanged':False}))
if __name__=='__main__':main()
