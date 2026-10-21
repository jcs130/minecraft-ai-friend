"""Build matched original viewer resources; never alter a running world or gateway."""
from pathlib import Path
import argparse,hashlib,json,sys

def sha(file):return hashlib.sha256(file.read_bytes()).hexdigest()

def add_physics(output,source):
    manifest_file=output/'native-assets.json';manifest=json.loads(manifest_file.read_bytes())
    states={r['stateId']:r for r in map(json.loads,(output/'registry/block-states.jsonl').read_text('utf-8').splitlines())}
    shapes=[];indexes={};pairs=[];seen=set()
    with source.open(encoding='utf-8') as stream:
        for line in stream:
            row=json.loads(line);native=states.get(row['stateId'])
            if not native or row['stateId'] in seen or row['name']!=native['name'] or row['properties']!=native['properties'] or row['context']!='native_empty_block_getter':raise ValueError('Physics and rendering registries differ')
            seen.add(row['stateId'])
            shape={k:row[k] for k in ('collisionBoxes','hardness','friction','canBreakWithHand')}
            key=json.dumps(shape,sort_keys=True,separators=(',',':'))
            if key not in indexes:indexes[key]=len(shapes);shapes.append(shape)
            pairs.append([row['stateId'],indexes[key]])
    if seen!=set(states):raise ValueError('Incomplete native physics export')
    data={'schemaVersion':1,'nativeRegistrySha256':manifest['registryHashes']['block-states.jsonl'],'source':'native_empty_block_getter','sourceSha256':sha(source),'shapes':shapes,'states':pairs}
    target=output/'registry/native-physics.json';target.write_text(json.dumps(data,separators=(',',':')),encoding='utf-8')
    manifest['registryHashes'][target.name]=sha(target)
    manifest['nativePhysics']={'source':data['source'],'sourceSha256':data['sourceSha256'],'states':len(pairs),'shapes':len(shapes),'contextDependentShapesRequireLiveVerification':True}
    manifest_file.write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    return manifest['nativePhysics']

def build(shared_source,client_jar,platform_jar,mods_dir,mods_manifest,registry_dir,output,physics=None):
    if output.exists():raise ValueError('Choose a new native resource directory')
    expected=json.loads(mods_manifest.read_bytes())['files']
    actual={p.name:p for p in mods_dir.glob('*.jar')}
    if set(actual)!=set(expected) or any(sha(actual[n])!=v for n,v in expected.items()):raise ValueError('Actual FOM JARs differ from lock')
    sys.path.insert(0,str(shared_source/'packages/modern-viewer/renderer-src/tools'))
    from native_viewer_assets import export,verify_export
    lock=output.with_name(output.name+'.lock.json')
    if lock.exists():raise ValueError('Existing native source lock')
    lock.write_text(json.dumps({'schemaVersion':1,'minecraftVersion':'1.21.1','scope':'FOM original server JAR resources; user pack overrides are not assumed','artifacts':[{'kind':'mod','name':n,'sha256':v} for n,v in expected.items()]},indent=2),encoding='utf-8')
    report=export(client_jar,lock,mods_dir,registry_dir,output,platform_jars=[platform_jar])
    if physics:report['physics']=add_physics(output,physics)
    report['verification']=verify_export(output)
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('shared-source','client-jar','platform-jar','mods-dir','mods-manifest','registry-dir','output'):p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--physics',type=Path)
    print(json.dumps(build(**vars(p.parse_args())),ensure_ascii=False))
