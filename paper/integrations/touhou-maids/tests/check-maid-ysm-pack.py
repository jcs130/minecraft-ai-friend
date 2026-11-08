"""Read-only audit of a real generated pack and original public model export."""
import argparse,base64,hashlib,importlib.util,json,zipfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--pack',type=Path,required=True);p.add_argument('--export',type=Path,required=True);p.add_argument('--base',type=Path,required=True);a=p.parse_args()
spec=importlib.util.spec_from_file_location('compiler',Path(__file__).parents[1]/'tools/build-maid-ysm-pack.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
checks=[]
def check(ok,name):
 assert ok,name
 checks.append(name)
with zipfile.ZipFile(a.pack) as z,zipfile.ZipFile(a.base) as old:
 check(len(z.namelist())==len(set(z.namelist())),'unique archive paths')
 check(not any('..' in Path(n).parts or n.startswith('/') for n in z.namelist()),'no escaping asset paths')
 parsed={n:json.loads(z.read(n)) for n in z.namelist() if n.endswith('.json')}
 check(len(parsed)>200,'all actual JSON documents parse')
 mapping=parsed['mapping.json'];rows=mapping['models'];d=parsed['entity/maid.entity.json']['minecraft:client_entity']['description']
 check([r['index'] for r in rows]==list(range(1,len(rows)+1)),'contiguous wire model slots')
 check(len({r['modelId'] for r in rows})==len(rows),'selection keys unique')
 check(d['geometry']['m0']=='geometry.allay' and d['textures']['t0']=='textures/entity/allay/allay','runtime fallback references vanilla allay assets')
 check(parsed['manifest.json']['header']['version']==[0,1,5],'new resource pack version invalidates cached old pack')
 originals=json.loads(old.read('mapping.json'))['models']
 check(rows[:204]==originals,'all 204 original native mappings preserved')
 for r in originals:
  check(z.read(r['geometry'])==old.read(r['geometry']),'native geometry retained '+str(r['index']))
  check(z.read(r['texture'])==old.read(r['texture']),'native texture retained '+str(r['index']))
 exports={x['modelId']:x for x in json.loads(a.export.read_text(encoding='utf-8'))['models']}
 for r in rows[204:]:
  source=exports[r['sourceModelId']];check(r['modelId']==m.key(r['sourceModelId'],r['textureName']),'exact YSM source/texture key '+str(r['index']))
  png=base64.b64decode(source['textures'][r['textureName']],validate=True)
  check(z.read(r['texture'])==png and hashlib.sha256(png).hexdigest()==r['textureSha256'],'original YSM PNG and UV resolution retained '+str(r['index']))
  check(parsed[r['geometry']]==source['geometry'],'reviewed YSM geometry retained '+str(r['index']))
 check(len(parsed['attribution/ysm.json'])==len(exports),'all YSM author metadata retained')
 check(mapping['ysmRejected'].get('qd_kazuha')=='YSM_BEDROCK_UV_DIMENSIONS_MISMATCH','invalid UV source remains explicitly unmapped')
check(m.key('大肥鱼.zip','月光')!=m.key('大肥鱼.zip','white'),'Unicode textures remain distinct')
print(json.dumps({'passed':True,'checks':len(checks),'nativeModels':204,'ysmModels':len(exports),'ysmTextures':len(rows)-204,'physicalDeviceRendered':False}))
