"""Extract only authored chunks from a cold QA snapshot into NEW region files.

Caller must stop the QA JVM normally and retain its exit proof. Output is a
private artifact, never a live world. prepare_overlay.py still gates deployment
on every target region/entities/poi file being absent.
"""
from pathlib import Path
import argparse,gzip,hashlib,io,json,struct,zlib
import nbtlib

def compact_region(raw,coordinates):
 if len(raw)<8192 or len(raw)%4096:raise ValueError('invalid_region_size')
 header=bytearray(8192);sectors=[];offset=2
 for x,z in sorted(coordinates):
  slot=(x%32)+(z%32)*32;location=struct.unpack_from('>I',raw,slot*4)[0];start=location>>8;count=location&255
  if start<2 or not count or(start+count)*4096>len(raw):raise ValueError('missing_or_invalid_requested_chunk')
  size=struct.unpack_from('>I',raw,start*4096)[0]
  if size<1 or size+4>count*4096:raise ValueError('invalid_chunk_length')
  compression=raw[start*4096+4];payload=raw[start*4096+5:start*4096+4+size]
  if compression not in (1,2,3):raise ValueError('unsupported_or_external_chunk')
  decoded=gzip.decompress(payload)if compression==1 else zlib.decompress(payload)if compression==2 else payload
  chunk=nbtlib.File.parse(io.BytesIO(decoded))
  if int(chunk.get('xPos',2**31))!=x or int(chunk.get('zPos',2**31))!=z:raise ValueError('chunk_coordinate_mismatch')
  if int(chunk.get('DataVersion',0))!=3955 or str(chunk.get('Status',''))!='minecraft:full':raise ValueError('complete_1_21_1_chunk_required')
  if chunk.get('entities')or chunk.get('Entities'):raise ValueError('qa_entities_not_publishable')
  for entity in chunk.get('block_entities',[]):
   if entity.get('Items')or entity.get('LootTable')or entity.get('Command'):raise ValueError('qa_inventory_or_executable_payload')
  record=raw[start*4096:start*4096+4+size];length=(len(record)+4095)//4096
  if length>255:raise ValueError('external_chunk_required')
  struct.pack_into('>I',header,slot*4,(offset<<8)|length);sectors.append(record+b'\0'*(length*4096-len(record)));offset+=length
 return bytes(header)+b''.join(sectors)

def prepare(world,manifest_path,out):
 if out.exists():raise ValueError('output_must_be_new')
 manifest=json.loads(manifest_path.read_text(encoding='utf-8'));groups={}
 for site in manifest['sites']:
  x0,_,z0,x1,_,z1=site['bounds']
  for x in range(x0//16,x1//16+1):
   for z in range(z0//16,z1//16+1):groups.setdefault(f'r.{x//32}.{z//32}.mca',set()).add((x,z))
 out.mkdir(parents=True);region=out/'region';region.mkdir();rows=[]
 for name,coordinates in sorted(groups.items()):
  data=compact_region((world/'region'/name).read_bytes(),coordinates);(region/name).write_bytes(data)
  rows.append({'name':name,'chunks':len(coordinates),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
 result={'schemaVersion':1,'contentRevision':manifest['revision'],'manifestSha256':hashlib.sha256(manifest_path.read_bytes()).hexdigest(),'files':rows,'chunks':sum(x['chunks']for x in rows),'entitiesOrPoiCopied':False,'neighborQaChunksCopied':False,'productionModified':False}
 (out/'region-manifest.json').write_text(json.dumps(result,indent=2),encoding='utf-8');return result

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--world',type=Path,required=True);p.add_argument('--manifest',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();r=prepare(a.world,a.manifest,a.out);print(json.dumps({'regionFiles':len(r['files']),'chunks':r['chunks'],'productionModified':False}))
