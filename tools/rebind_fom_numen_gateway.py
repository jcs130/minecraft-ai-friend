"""Revalidate content-free Numen additions before retaining frozen FOM resources."""
from pathlib import Path
import argparse,hashlib,json,math,os,shutil
from fom_numen import FILES

IDENTITIES=('blocks.tsv','items.tsv','entities.tsv','components.tsv','particles.tsv','entity-data-serializers.tsv')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()

def state_identity(old,new):
    # IDs and every semantic property must be exact. Repeated original JVM
    # shape exports have last-bit AABB roundoff; no network value is rounded.
    count=0;roundoff=0;maximum=0.0
    with Path(old).open(encoding='utf-8') as a,Path(new).open(encoding='utf-8') as b:
        while True:
            left,right=a.readline(),b.readline()
            if not left or not right:
                if bool(left)!=bool(right):raise ValueError('Native state count changed')
                break
            x,y=json.loads(left),json.loads(right);count+=1
            if x==y:continue
            xboxes=x.pop('occlusionBoxes',None);yboxes=y.pop('occlusionBoxes',None)
            if x!=y or not isinstance(xboxes,list) or not isinstance(yboxes,list) or len(xboxes)!=len(yboxes):
                raise ValueError('Native state identity or geometry changed')
            for first,second in zip(xboxes,yboxes):
                if not isinstance(first,list) or not isinstance(second,list) or len(first)!=6 or len(second)!=6:
                    raise ValueError('Native shape layout changed')
                for u,v in zip(first,second):
                    if not isinstance(u,(int,float)) or not isinstance(v,(int,float)) or not math.isfinite(u) or not math.isfinite(v) or abs(u-v)>1e-12:
                        raise ValueError('Native shape changed beyond original JVM roundoff')
                    maximum=max(maximum,abs(u-v))
            roundoff+=1
    return {'states':count,'networkIdsAndPropertiesExact':True,'originalShapeRoundoffRows':roundoff,'maxOriginalShapeRoundoff':maximum,'shapeComparisonTolerance':1e-12}

def channel_identity(old,new):
    flatten=lambda d:{(protocol,r['id']):r for protocol,rows in d['protocols'].items() for r in rows}
    before,after=map(flatten,(old,new))
    if any(after.get(k)!=v for k,v in before.items()):raise ValueError('Existing network channel contract changed')
    extra=[v for k,v in after.items() if k not in before]
    if not extra or any(not v['id'].startswith('numen_api:') or v.get('optional') is not True for v in extra):
        raise ValueError('Only optional official Numen channels may be added')
    return {'additionalOptionalNumenChannels':len(extra),'oldChannelsUnchanged':True}

def rebind(source,registry,mods_manifest,output):
    source,registry,mods_manifest,output=map(Path,(source,registry,mods_manifest,output))
    if output.exists():raise ValueError('Choose a new immutable gateway release')
    release=json.loads((source/'release.json').read_bytes());mods=json.loads(mods_manifest.read_bytes())['files']
    if mods!={**release['modFiles'],**FILES}:raise ValueError('Only the pinned Numen additions may change this mod set')
    for name,digest in release['files'].items():
        p=source/name
        if not p.resolve().is_relative_to(source.resolve()) or sha(p)!=digest:raise ValueError('Source gateway is not the verified frozen release')
    for name in IDENTITIES:
        if (source/'registry'/name).read_bytes()!=(registry/name).read_bytes():raise ValueError('Native content registry changed: '+name)
    audit=state_identity(source/'registry/block-states.jsonl',registry/'block-states.jsonl')
    channels=channel_identity(json.loads((source/'registry/network-channels.json').read_bytes()),json.loads((registry/'network-channels.json').read_bytes()))
    audit.update(channels,rawExportSha256=sha(registry/'block-states.jsonl'),retainedCanonicalSha256=sha(source/'registry/block-states.jsonl'),rawCompletedExportSha256=sha(registry/'complete.json'))
    shutil.copytree(source,output,copy_function=os.link)
    target=output/'registry/network-channels.json';target.unlink();shutil.copy2(registry/'network-channels.json',target)
    release['modFiles']=mods;release['files']['registry/network-channels.json']=sha(target)
    release['nativeExport']['network-channels.json']=sha(target);release['numenContentRevalidation']=audit
    (output/'release.json').unlink();(output/'release.json').write_text(json.dumps(release,indent=2)+'\n',encoding='utf-8')
    return audit

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ('source','registry','mods-manifest','output'):parser.add_argument('--'+key,type=Path,required=True)
    print(json.dumps(rebind(**vars(parser.parse_args()))))
