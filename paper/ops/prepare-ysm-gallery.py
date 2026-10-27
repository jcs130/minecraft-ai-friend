"""Prepare an offline, bounded YSM gallery; never writes a running service.

Input records are acquired public archives with reviewed source hashes/credits.
Encrypted .ysm assets are not decoded. Incomplete/static legacy archives are
reported rather than silently acquiring somebody else's animation.
"""
from pathlib import Path,PurePosixPath
import argparse,json,zipfile,hashlib,struct

def normalize(row,archive,out):
 assert hashlib.sha256(archive.read_bytes()).hexdigest()==row['sha256'],'archive hash'
 files={}
 with zipfile.ZipFile(archive)as z:
  assert len(z.infolist())<=1000 and sum(i.file_size for i in z.infolist())<=32*1024*1024,'archive capacity'
  for info in z.infolist():
   path=PurePosixPath(info.filename.replace('\\','/'));assert not path.is_absolute() and '..'not in path.parts and ':'not in str(path) and '\x00'not in str(path),'archive path'
   if not info.is_dir() and path.suffix.lower()in ['.json','.png','.ogg','.txt','.md']:
    assert str(path)not in files,'duplicate archive path';files[str(path)]=z.read(info)
 parts=[PurePosixPath(n).parts for n in files]
 if parts and all(len(p)>1 and p[0]==parts[0][0]for p in parts):files={'/'.join(PurePosixPath(n).parts[1:]):v for n,v in files.items()}
 jsons={n:json.loads(v.decode('utf-8-sig'))for n,v in files.items()if n.lower().endswith('.json')}
 if 'ysm.json'in jsons:
  config=jsons['ysm.json'];kind='original_spec'
 else:
  models=[n for n,v in jsons.items()if isinstance(v,dict)and 'minecraft:geometry'in v and 'arm'not in PurePosixPath(n).name.lower()]
  animations=[n for n,v in jsons.items()if isinstance(v,dict)and v.get('animations')and 'arm'not in PurePosixPath(n).name.lower()]
  if len(models)!=1 or len(animations)!=1:raise ValueError('missing_or_ambiguous_legacy_animation')
  textures=[n for n in files if n.lower().endswith('.png')and 'avatar'not in n.lower()and 'icon'not in n.lower()];assert textures,'texture missing'
  model={'main':models[0]};animation={'main':animations[0]}
  for n in jsons:
   if PurePosixPath(n).name.lower()=='arm.json':model['arm']=n
   if PurePosixPath(n).name.lower()=='arm.animation.json':animation['arm']=n
  config={'spec':2,'metadata':{'name':row['name'],'tips':row['style']+'；公开合集，原作者权利保留。','authors':[{'name':'原模型作者','role':'模型与动画','comment':'源包及署名保留；来源 Elaina69/Yes-Steve-Model-Repo，未声明为千灯纪原创。'}],'link':{'home':'https://github.com/Elaina69/Yes-Steve-Model-Repo'},'license':{'type':'All Rights Reserved'}},'properties':{'height_scale':1,'width_scale':1,'free':True},'files':{'player':{'model':model,'animation':animation,'texture':textures}}}
  files['ysm.json']=json.dumps(config,ensure_ascii=False,indent=2).encode('utf8');jsons['ysm.json']=config;kind='legacy_layout_wrapped_without_asset_edits'
 assert config.get('spec')==2,'unsupported source spec'
 assert config.get('properties',{}).get('free')is True,'source_not_publicly_selectable'
 player=config['files']['player'];refs=[]
 def paths(value):
  if isinstance(value,str):refs.append(value)
  elif isinstance(value,list):
   for item in value:paths(item)
  elif isinstance(value,dict):
   for item in value.values():paths(item)
 for key in ['model','animation','texture','controller','animation_controller','animation_controllers']:
  if key in player:paths(player[key])
 for n in refs:assert n in files,('missing reference',n)
 # Keep original authorship/images and all files needed by optional controllers;
 # authoring projects, executable files and unrelated payloads were excluded.
 geometry=[];textures=[];animations=0
 for name,data in files.items():
  if name.lower().endswith('.png'):
   assert data.startswith(b'\x89PNG\r\n\x1a\n'),'PNG signature';w,h=struct.unpack('>II',data[16:24]);assert 0<w<=4096 and 0<h<=4096,'PNG capacity';textures.append({'file':name,'size':[w,h]})
  obj=jsons.get(name)
  if isinstance(obj,dict):
   animations+=len(obj.get('animations',{}))
   for geo in obj.get('minecraft:geometry',[]):
    bones=geo.get('bones',[]);cubes=sum(len(b.get('cubes',[]))for b in bones);assert len(bones)<=512 and cubes<=2000,'geometry capacity'
    geometry.append({'file':name,'bones':len(bones),'cubes':cubes})
 assert geometry and animations,'animated geometry required'
 out.mkdir()
 for name,data in files.items():target=out/name;target.parent.mkdir(exist_ok=True,parents=True);target.write_bytes(data)
 return {**{k:row[k]for k in ['id','name','style','sourcePath','sourceCommit','sha256']},'kind':kind,'files':{n:hashlib.sha256(d).hexdigest()for n,d in files.items()},'bytes':sum(len(d)for d in files.values()),'geometry':geometry,'textures':textures,'animationCount':animations,'status':'prepared_pending_native_and_web_validation'}

def main():
 p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True);p.add_argument('--archives',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 assert not a.output.exists(),'new offline output required';a.output.mkdir(parents=True)
 rows=json.loads(a.manifest.read_text(encoding='utf8'));assert len(rows)<=64
 accepted=[];rejected=[]
 for row in rows:
  assert row['id'].isascii() and row['id'].replace('_','').isalnum() and len(row['id'])<=48
  try:accepted.append(normalize(row,a.archives/Path(row['sourcePath']).name,a.output/row['id']))
  except (ValueError,AssertionError,KeyError,zipfile.BadZipFile)as e:rejected.append({'id':row['id'],'reason':str(e)})
 result={'schemaVersion':1,'productionChanged':False,'models':accepted,'rejected':rejected}
 (a.output/'gallery-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({'prepared':len(accepted),'rejected':rejected,'runtimeBytes':sum(r['bytes']for r in accepted)},ensure_ascii=True))
if __name__=='__main__':main()
