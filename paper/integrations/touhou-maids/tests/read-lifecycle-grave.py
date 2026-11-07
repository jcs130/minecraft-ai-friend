"""Read only a synthetic QA grave from its flushed entity-region snapshot."""
from pathlib import Path
import hashlib,io,json,os,sys,time,zlib
stage=Path(sys.argv[1]).resolve();target=sys.argv[2]
assert (stage/'.maid-lifecycle-qa').read_text()=='FRESH_MAID_LIFECYCLE_QA_NO_PLAYER_DATA'
props=(stage/'server.properties').read_text()
assert 'server-ip=127.0.0.1\n' in props and 'server-port=25938\n' in props
if os.environ.get('MAID_LIFE_QA_NBT_MODULES'):sys.path.insert(0,os.environ['MAID_LIFE_QA_NBT_MODULES'])
import nbtlib
path=stage/'qa_world/entities/r.0.0.mca'
blob=path.read_bytes();time.sleep(.1);assert blob==path.read_bytes(),'QA snapshot changed; read again without repeating a game action'
def uid(values):
    h=''.join(f'{int(n)&0xffffffff:08x}' for n in values)
    return '-'.join([h[:8],h[8:12],h[12:16],h[16:20],h[20:]])
def canonical(value):
    tag=getattr(value,'tag_id',None)
    if isinstance(value,dict):return [tag,{str(k):canonical(v) for k,v in sorted(value.items())}]
    if isinstance(value,str):return [tag,str(value)]
    if hasattr(value,'__iter__'):return [tag,[canonical(v) for v in value]]
    return [tag,str(value)]
matches=[]
for slot in range(1024):
    offset=int.from_bytes(blob[4*slot:4*slot+3],'big')*4096
    if not offset:continue
    size=int.from_bytes(blob[offset:offset+4],'big');assert blob[offset+4]==2
    entities=nbtlib.File.parse(io.BytesIO(zlib.decompress(blob[offset+5:offset+4+size]))).get('Entities',[])
    matches.extend(e for e in entities if uid(e['UUID'])==target)
assert len(matches)==1,'Synthetic grave not found exactly once'
grave=matches[0];assert str(grave['id'])=='touhou_little_maid:tombstone'
items=grave['TombstoneItems']['Items']
assert all(str(i['id'])!='touhou_little_maid:film' for i in items),'QA film must already be consumed'
print(json.dumps({'itemsSha256':hashlib.sha256(json.dumps(canonical(items),sort_keys=True).encode()).hexdigest(),'stacks':len(items),'syntheticOnly':True}))
