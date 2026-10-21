"""Freeze a FOM Agent gateway release; never edit a running service or world."""
from pathlib import Path
import argparse,hashlib,json,shutil,os,subprocess,tempfile,zipfile

REPO=Path(__file__).resolve().parents[1]
REGISTRY_FILES=('components.tsv','particles.tsv','entity-data-serializers.tsv','network-channels.json')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def prepare_mapping(output,node,dependencies,registry):
    """Derive all IDs from this native export; language files only label items."""
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    registry=Path(registry);vanilla=output/'vanilla';vanilla.mkdir()
    env={**os.environ,'NODE_PATH':str(dependencies)}
    script="const fs=require('fs'),p=require('path'),d=require('minecraft-data')('1.21.1');for(const k of ['blocks','items'])fs.writeFileSync(p.join(process.argv[1],k+'.json'),JSON.stringify(Object.values(d[k])))"
    subprocess.run([str(node),'-e',script,str(vanilla)],env=env,check=True,capture_output=True)
    env.update(MINECRAFT_DATA_DIR=str(vanilla),IDMAP_DUMP_DIR=str(registry),IDMAP_OUTPUT_FILE=str(output/'idmap.json'))
    subprocess.run([str(node),str(REPO/'world/src/neoforge-handshake/build-idmap.cjs')],env=env,check=True,capture_output=True)
    language={}
    for jar in sorted((registry.parents[1]/'mods').glob('*.jar')):
        with zipfile.ZipFile(jar) as archive:
            for name in sorted(archive.namelist()):
                if name.startswith('assets/') and name.endswith('/lang/zh_cn.json'):
                    language.update(json.loads(archive.read(name)))
    base=json.loads((vanilla/'items.json').read_text('utf-8'));names={'minecraft:'+item['name'] for item in base}
    items=[]
    for line in (registry/'items.tsv').read_text('utf-8').splitlines():
        name,raw_id=line.split('\t')
        if name in names:continue
        namespace,short=name.split(':',1)
        items.append({'nativeId':int(raw_id),'nativeItem':name,
            'displayName':language.get('item.'+namespace+'.'+short,language.get('block.'+namespace+'.'+short,name)),
            'customModelData':8000000+len(items)})
    (output/'items.json').write_text(json.dumps({'schemaVersion':1,'items':items},ensure_ascii=False),encoding='utf-8')

def build(output,node,dependencies,registry,mapping,mods_manifest,native_viewer=False):
    output=Path(output).resolve()
    if output.exists():raise ValueError('Use a new immutable gateway release directory')
    dependencies=Path(dependencies).resolve();registry=Path(registry).resolve()
    if mapping is None:
        with tempfile.TemporaryDirectory(prefix='fom-gateway-mapping-') as temporary:
            prepare_mapping(temporary,node,dependencies,registry)
            return build(output,node,dependencies,registry,temporary,mods_manifest,native_viewer)
    mapping=Path(mapping).resolve()
    if json.loads((dependencies/'minecraft-protocol/package.json').read_text('utf-8'))['version']!='1.68.0':raise ValueError('Validated minecraft-protocol 1.68.0 required')
    if not (registry/'complete.json').is_file():raise ValueError('Completed native export required')
    idmap=json.loads((mapping/'idmap.json').read_text('utf-8'))
    if not idmap.get('reverseVanillaStates') or not idmap.get('reverseVanillaItems'):raise ValueError('Exact vanilla reverse maps required')
    for source in dependencies.rglob('*'):
        if source.is_symlink():raise ValueError('Pinned dependency tree must contain real files')
    output.mkdir(parents=True)
    shutil.copy2(node,output/'node.exe')
    shutil.copytree(dependencies,output/'node_modules',ignore=shutil.ignore_patterns('.cache','.bin'))
    (output/'gate').mkdir();(output/'registry').mkdir()
    for source in (REPO/'world/src/neoforge-handshake').glob('*.cjs'):
        if not source.name.endswith('.test.cjs'):shutil.copy2(source,output/'gate'/source.name)
    for name in REGISTRY_FILES:shutil.copy2(registry/name,output/'registry'/name)
    if native_viewer:
        for name in ('block-states.jsonl','blocks.tsv','items.tsv','entities.tsv'):
            shutil.copy2(registry/name,output/'registry'/name)
    for name in ('idmap.json','items.json'):shutil.copy2(mapping/name,output/'registry'/name)
    files={p.relative_to(output).as_posix():sha(p) for p in sorted(output.rglob('*')) if p.is_file()}
    record={'schemaVersion':1,'minecraft':'1.21.1','protocol':767,'scope':'partial_vanilla_agent_projection',
        'modFiles':json.loads(Path(mods_manifest).read_text('utf-8'))['files'],'files':files,
        'nativeExport':{name:sha(registry/name) for name in (*REGISTRY_FILES,'blocks.tsv','items.tsv','block-states.jsonl')},
        'exactVanillaStates':idmap['report']['exactVanillaStates'],'additionalMinecraftNames':idmap['report']['additionalMinecraftNames']}
    if native_viewer:record['nativeViewer']={'schemaVersion':1,'channel':'mcviewer:native_packet','registrySha256':sha(registry/'block-states.jsonl'),'scope':'same_connection_original_before_projection'}
    (output/'release.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
    return {'release':str(output),'files':len(files),'bytes':sum((output/name).stat().st_size for name in files),'manifestSha256':sha(output/'release.json')}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ('output','node','dependencies','registry','mods-manifest'):parser.add_argument('--'+key,type=Path,required=True)
    parser.add_argument('--mapping',type=Path,help='Optional existing mapping; otherwise derive it from the native export')
    parser.add_argument('--native-viewer',action='store_true',help='Preserve original packets for the same Mineflayer connection and freeze matching registries')
    args=vars(parser.parse_args());print(json.dumps(build(**args)))
