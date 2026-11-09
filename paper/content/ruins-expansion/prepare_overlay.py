"""Prepare a reviewable merge without writing any live file or world.

Existing site IDs and their definitions must remain byte-for-byte equivalent as
YAML values. Publishing needs the normal maintenance/backup workflow separately.
"""
from pathlib import Path
import argparse,copy,json
import yaml

def merge(existing,addition):
 if existing.get('schema-version')!=1 or addition.get('schema-version')!=1:raise ValueError('schema_version')
 old=existing.get('sites');new=addition.get('sites')
 if not isinstance(old,dict)or not isinstance(new,dict):raise ValueError('sites_mapping_required')
 if old.keys()&new.keys():raise ValueError('existing_site_id_conflict')
 if len(old)+len(new)>16:raise ValueError('sites_limit_16')
 result=copy.deepcopy(existing);result['sites'].update(copy.deepcopy(new))
 return result

def regions(bounds):
 minx,_,minz,maxx,_,maxz=bounds
 return {f'r.{x}.{z}.mca'for x in range(minx//512,maxx//512+1)for z in range(minz//512,maxz//512+1)}

def preflight(world,manifest):
 needed=sorted(set().union(*(regions(site['bounds'])for site in manifest['sites'])))
 # Whole-region installation is allowed only when the original region, entity
 # and POI files are all absent. Presence is not permission to overwrite a chunk.
 conflicts=[(Path(kind)/name).as_posix()for kind in ['region','entities','poi']for name in needed if(world/kind/name).exists()]
 return {'world':str(world),'regionFiles':needed,'conflicts':conflicts,'canPrepare':not conflicts,'productionModified':False}

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--existing',type=Path,required=True);p.add_argument('--bundle',type=Path,required=True);p.add_argument('--world',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
 if a.out.exists():raise ValueError('output_must_be_new')
 base=yaml.safe_load(a.existing.read_text(encoding='utf-8'));extra=yaml.safe_load((a.bundle/'dungeons-overlay.yml').read_text(encoding='utf-8'));result=merge(base,extra)
 manifest=json.loads((a.bundle/'manifest.json').read_text(encoding='utf-8'));plan=preflight(a.world,manifest)
 if not plan['canPrepare']:raise ValueError('region_conflict:'+','.join(plan['conflicts']))
 a.out.mkdir(parents=True);(a.out/'dungeons.yml').write_text(yaml.safe_dump(result,allow_unicode=True,sort_keys=False),encoding='utf-8');(a.out/'preflight.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'sitesBefore':len(base['sites']),'sitesAfter':len(result['sites']),'regions':len(plan['regionFiles']),'productionModified':False}))
