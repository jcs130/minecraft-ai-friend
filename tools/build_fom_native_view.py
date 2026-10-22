"""Build matched original viewer resources; never alter a running world or gateway."""
from pathlib import Path
import argparse,hashlib,json,sys

def sha(file):return hashlib.sha256(file.read_bytes()).hexdigest()

def add_vanilla_language_export(output,source,locales=('zh_cn',)):
    """Copy audited Mojang language objects from a matched verified export.

    Does not rewrite or merge PNG/model assets or modify the source export.
    The renderer separately merges language resource stacks per key.
    """
    file=output/'native-assets.json';manifest=json.loads(file.read_bytes());original=json.loads((source/'native-assets.json').read_bytes())
    client='499f6897d1837516680f3114072d8106e11c9adcd933fe5cf051b551089b0c99'
    if any(m.get('minecraftVersion')!='1.21.1' or m.get('clientJarSha256')!=client or m.get('assetIntegrityVerified')is not True for m in (manifest,original)):raise ValueError('Language export belongs to another client')
    pinned={'zh_cn':('10da480179ef720771e27aebec6f33a6d4cec5063401310ceb82bb576a6b7af0','f87510f4509890eaf176e0de1430f6bb326a6800',555146)}
    prepared=[]
    for locale in locales:
        if locale not in pinned:raise ValueError('Language object is not audited')
        key=f'assets/minecraft/lang/{locale}.json';entry=original.get('assets',{}).get(key,{})
        expected,obj_hash,size=pinned[locale];data=(source/key).read_bytes()
        if entry.get('sha256')!=expected or entry.get('objectSha1')!=obj_hash or entry.get('bytes')!=size or len(data)!=size or hashlib.sha256(data).hexdigest()!=expected or hashlib.sha1(data).hexdigest()!=obj_hash:raise ValueError('Mojang language object differs')
        rows=[s for s in original.get('sources',[])if s.get('name')==entry.get('source')]
        if len(rows)!=1 or rows[0].get('explicitOverride') or entry.get('source')!=f"minecraft-assets-17:{entry.get('assetIndexSha1')}" or entry.get('assetIndexSha1')!='9b16298b1dc0697878cec88bb2d96168f5239e4f' or rows[0].get('sha256')!='49b23c3977d27aa18a2aa4541f3f8a8c1e8bff238cd8c307e975a019c8153ab2':raise ValueError('Language index provenance differs')
        if key in manifest.get('assets',{})and manifest['assets'][key]!=entry:raise ValueError('Conflicting language export')
        target=output/key
        if target.exists()and sha(target)!=expected:raise ValueError('Conflicting language file')
        if any(s.get('name')==rows[0]['name']and s!=rows[0]for s in manifest['sources']):raise ValueError('Conflicting language source')
        prepared.append((key,entry,rows[0],data))
    for key,entry,origin,data in prepared:
        target=output/key;target.parent.mkdir(parents=True,exist_ok=True)
        if not target.exists():target.write_bytes(data)
        manifest['assets'][key]=entry
        if origin not in manifest['sources']:manifest['sources'].append(origin)
    manifest['counts']['files']=len(manifest['assets'])
    file.write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    return {'locales':list(locales),'clientJarSha256':client,'sourceExport':str(source),'byteExactMojangObjects':True}

def add_twilight_layers(output,source):
    expected='56dcd09468a6440b15d5258394d90da4a4d18dd9773a772dffc8149978eaf2a2'
    jar='493da16d10210f9f53a3c33b3d8fcb4ae9b14016ee420d753c894562bd9aba35'
    if source.stat().st_size>8*1024*1024 or sha(source)!=expected:raise ValueError('Unverified original Twilight model bake')
    data=json.loads(source.read_bytes());file=output/'native-assets.json';manifest=json.loads(file.read_bytes())
    if not any(row.get('sha256')==jar and not row.get('explicitOverride') for row in manifest.get('sources',[])):raise ValueError('Twilight model bake belongs to another modpack')
    if data.get('sourceJarSha256')!=jar or data.get('source')!='original_registered_LayerDefinition_bakeRoot' or len(data.get('layers',{}))!=100:raise ValueError('Invalid original Twilight model bake')
    key='assets/twilightforest/native/model-layers.json';target=output/key
    if target.exists() and sha(target)!=expected:raise ValueError('Conflicting Twilight model bake')
    target.parent.mkdir(parents=True,exist_ok=True)
    if not target.exists():target.write_bytes(source.read_bytes())
    manifest['assets'][key]={'sha256':expected,'bytes':source.stat().st_size,'source':'twilightforest-1.21.1-4.8.3345-universal.jar',
        'originalModelExport':{'source':data['source'],'sourceJarSha256':jar,'modelBytecodeModified':False}}
    manifest['counts']['files']=len(manifest['assets']);file.write_bytes(json.dumps(manifest,ensure_ascii=False,separators=(',',':')).encode())
    return {'path':key,'sha256':expected,'originalLayers':100,'integratedActors':['twilightforest:naga'],'completeSceneParityVerified':False}

def add_client_item_colors(output,shared_source):
    """Copy the versioned original-client audit artifact, never guessed RGB."""
    key='assets/minecraft/native/client-item-colors.json'
    source=shared_source/'packages/modern-viewer/asset-packs/vanilla-1.21.1'/key
    expected='21c83de83b6f57d38f93c0881edaa98a2d2c06ec8c14eceb260a79c380f9e936'
    if sha(source)!=expected:raise ValueError('Original client item-color artifact changed')
    source_data=json.loads(source.read_bytes());manifest_file=output/'native-assets.json';manifest=json.loads(manifest_file.read_bytes())
    if manifest.get('minecraftVersion')!='1.21.1' or manifest.get('clientJarSha256')!=source_data.get('clientJarSha256') or manifest.get('assetIntegrityVerified') is not True:raise ValueError('Item colors belong to another original Minecraft client')
    target=output/key
    if target.exists() and sha(target)!=expected:raise ValueError('Conflicting item-color artifact')
    target.parent.mkdir(parents=True,exist_ok=True)
    if not target.exists():target.write_bytes(source.read_bytes())
    manifest['assets'][key]={'sha256':expected,'bytes':source.stat().st_size,'source':'minecraft-1.21.1-client.jar',
        'originalClientExport':{'source':source_data['source'],'clientJarSha256':source_data['clientJarSha256']}}
    manifest['counts']['files']=len(manifest['assets'])
    manifest_file.write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    return {'path':key,'sha256':expected,'customModPotionColorsVerified':False}

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

def build(shared_source,client_jar,platform_jar,mods_dir,mods_manifest,registry_dir,output,physics=None,twilight_layers=None,vanilla_language_export=None):
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
    report['itemColors']=add_client_item_colors(output,shared_source)
    if physics:report['physics']=add_physics(output,physics)
    if twilight_layers:report['twilightLayers']=add_twilight_layers(output,twilight_layers)
    if vanilla_language_export:report['vanillaLanguages']=add_vanilla_language_export(output,vanilla_language_export)
    report['verification']=verify_export(output)
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('shared-source','client-jar','platform-jar','mods-dir','mods-manifest','registry-dir','output'):p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--physics',type=Path)
    p.add_argument('--twilight-layers',type=Path,help='Pinned original Twilight CPU model export, never a substituted mesh')
    p.add_argument('--vanilla-language-export',type=Path,help='Matched verified export containing the audited Mojang zh_cn object')
    print(json.dumps(build(**vars(p.parse_args())),ensure_ascii=False))
