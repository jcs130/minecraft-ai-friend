"""Prepare immutable bridge files and authentic static item assets; no start/deploy."""
from pathlib import Path,PurePosixPath
import argparse,hashlib,json,os,shutil,zipfile
import fom_service as fom
import maw_bedrock_service as original
import maw_bedrock_resources as resources
from fom_bedrock_service import geyser_config

REPO=Path(__file__).resolve().parents[1]
MAIN=Path('E:/MC/servers/fom-2.42/ops/service.json')
VANILLA=Path('E:/MC/clients/fom-2.42/minecraft/versions/1.21.1/1.21.1.jar')

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def reused_asset_manifest(assets,archives):
    """Accept a hash-bound native exporter output, including platform/JarJar inputs.

    Do not require another bridge's sibling prepare.json: the standard exporter
    already records the exact original archives. Each direct client/mod source
    must occur once and match the JAR used by this server before reuse.
    """
    value=json.loads((Path(assets)/'native-assets.json').read_bytes())
    if value.get('assetIntegrityVerified') is not True:raise ValueError('Unverified reused assets')
    sources=value.get('sources',[])
    for jar in archives:
        rows=[row for row in sources if row.get('name')==jar.name]
        if len(rows)!=1 or rows[0].get('sha256')!=sha(jar):raise ValueError('Reused asset export belongs to a different exact mod set')
    return value['assets']

def projection_catalog(output):
    output=Path(output).resolve();native=output/'gateway/registry/items.json';icons=output/'resources'/resources.CATALOG
    texture_rows=json.loads(icons.read_text(encoding='utf-8'))['items'];by_id={row['nativeId']:row for row in texture_rows}
    rows=[]
    for original_row in json.loads(native.read_text(encoding='utf-8'))['items']:
        row={**original_row,'customModelData':resources.MARKER_BASE+original_row['nativeId']}
        row.update(by_id.get(row['nativeId'],{}));rows.append(row)
    if not set(by_id).issubset({row['nativeId'] for row in rows}):raise ValueError('Icon catalog is not part of the current FOM catalog')
    directory=output/'prototype/plugins/Geyser';directory.mkdir(parents=True,exist_ok=True)
    target=directory/'fom-item-projection.json';target.write_bytes(resources.encoded({'schemaVersion':1,'items':rows}))
    (directory/'fom-projection-contract.json').write_bytes(resources.encoded({'schemaVersion':1,'nativeCatalogSha256':sha(native),'iconCatalogSha256':sha(icons),'projectionSha256':sha(target),'itemCount':len(rows)}))
    return len(rows)

def install_blocks(workspace,source):
    """Attach a separately verified block build to a new private candidate."""
    import fom_bedrock_block_contract as blocks
    workspace,source=Path(workspace).resolve(),Path(source).resolve()
    if not workspace.is_relative_to(Path('E:/MC/research').resolve()) or (workspace/'prototype/ops').exists():raise ValueError('Blocks are installed only in an unstarted private candidate')
    contract=blocks.validate(source);record=json.loads((workspace/'gateway/release.json').read_bytes());target=workspace/'prototype/plugins/Geyser'
    if contract['inputs']['statesSha256']!=record['nativeExport']['block-states.jsonl']:raise ValueError('Block model registry differs from prepared gateway')
    if contract.get('blockItemCount',0) and contract['blockItemInputs']['projectionSha256']!=sha(target/'fom-item-projection.json'):raise ValueError('Block item labels differ from prepared projection')
    if sha(target.parent/'Geyser-ViaProxy.jar')!=contract['geyserJarSha256']:raise ValueError('Block extension Geyser build differs')
    for name,meta in contract['files'].items():
        destination=target/meta['directory']/name;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source/name,destination)
    shutil.copy2(source/blocks.CONTRACT,target/blocks.CONTRACT);blocks.validate(target,deployed=True)
    return {'blockCount':contract['blockCount'],'stateCount':contract['stateCount'],'blockItemCount':contract.get('blockItemCount',0),'productionModified':False}

def prepare(output,assets_root=None,main_config=MAIN):
    # Fail before copying a gateway if the image build dependency is absent.
    from PIL import Image
    output=Path(output).resolve()
    if output.exists():raise ValueError('Prepare in a new private workspace')
    if not output.is_relative_to(Path('E:/MC/research').resolve()):raise ValueError('Preparation stays in the private research directory')
    main=fom.load_config(main_config);raw=main['_raw'];source=Path(raw['agentGateway']['releaseDir']);server=Path(main['serverDir'])
    output.mkdir(parents=True);assets=Path(assets_root).resolve() if assets_root else output/'assets';manifest={}
    archives=[VANILLA,*sorted((server/'mods').glob('*.jar'))]
    if assets_root:
        manifest=reused_asset_manifest(assets,archives)
    else:assets.mkdir()
    for jar in ([] if assets_root else archives):
        with zipfile.ZipFile(jar) as archive:
            for info in archive.infolist():
                key=info.filename;path=PurePosixPath(key)
                if info.is_dir() or not key.startswith('assets/') or path.suffix not in ('.json','.png','.mcmeta'):continue
                if path.is_absolute() or '..' in path.parts or '\\' in key or info.file_size>32*1024*1024:raise ValueError('Unsafe or oversized native asset')
                data=archive.read(info);digest=hashlib.sha256(data).hexdigest()
                if key in manifest:
                    previous=manifest[key]
                    if previous['sha256']!=digest:previous.setdefault('variants',[]).append({'source':jar.name,'sha256':digest,'bytes':len(data)})
                    continue
                target=assets/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
                manifest[key]={'sha256':digest,'bytes':len(data),'source':jar.name}
    if not assets_root:(assets/'native-assets.json').write_text(json.dumps({'schemaVersion':1,'assetIntegrityVerified':True,'scope':'vanilla and locked FOM jar assets; ambiguous priorities excluded','sources':[{'name':jar.name,'sha256':sha(jar)} for jar in archives],'assets':manifest},ensure_ascii=False),encoding='utf-8')
    release=output/'gateway';release.mkdir();source_record=json.loads((source/'release.json').read_text(encoding='utf-8'))
    for relative,digest in source_record['files'].items():
        src=source/relative;dst=release/relative;dst.parent.mkdir(parents=True,exist_ok=True)
        # Immutable libraries may share bytes, mutable gateway source is copied.
        if relative.startswith('node_modules/') or relative=='node.exe':os.link(src,dst)
        else:shutil.copy2(src,dst)
    # Keep registry/dependency inputs frozen, but prepare the reviewed Bedrock
    # fixes from this checkout rather than reviving an older Agent-only gate.
    for source_file in sorted((REPO/'world/src/neoforge-handshake').glob('*.cjs')):
        if source_file.name.endswith('.test.cjs'):continue
        name=source_file.name
        target=release/'gate'/name;shutil.copy2(REPO/'world/src/neoforge-handshake'/name,target)
        source_record['files']['gate/'+name]=sha(target)
    gateway=release/'gate/gate.cjs';old=gateway.read_text(encoding='utf-8')
    needle='const username = p.username'
    patched="const username = require('./bedrock-account.cjs').bedrockAccountName(p.username, process.env.GATE_BEDROCK_ACCOUNT_NAMESPACE === '1')"
    if old.count(needle)==1:old=old.replace(needle,patched,1)
    elif old.count(patched)!=1:raise ValueError('Unknown gateway account-name implementation')
    gateway.write_text(old,encoding='utf-8')
    shutil.copy2(REPO/'world/src/neoforge-handshake/bedrock-account.cjs',release/'gate/bedrock-account.cjs')
    source_record['files']['gate/gate.cjs']=sha(gateway);source_record['files']['gate/bedrock-account.cjs']=sha(release/'gate/bedrock-account.cjs')
    source_record['scope']='partial_vanilla_bedrock_projection';source_record['sourceGatewayManifestSha256']=sha(source/'release.json')
    (release/'release.json').write_text(json.dumps(source_record,indent=2)+'\n',encoding='utf-8')
    native=server/'dump/maw-registry-ids/items.tsv'
    if sha(native)!=source_record['nativeExport']['items.tsv']:raise ValueError('Native item export differs from gateway')
    labels={row['nativeItem']:row['displayName'] for row in json.loads((release/'registry/items.json').read_text(encoding='utf-8'))['items']}
    contract=resources.build(assets,native,release/'registry/idmap.json',output/'resources',identity='fom-2.42-'+sha(release/'registry/idmap.json')[:12],display_names=labels)
    prototype=output/'prototype';(prototype/'plugins/Geyser').mkdir(parents=True)
    for name,digest in original.ARTIFACTS.items():
        src=Path('E:/QiandengJiSocietyLab/bedrock')/name
        if sha(src)!=digest:raise ValueError('Pinned Geyser/ViaProxy bytes differ')
        dst=prototype/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
    for name,subdir in [(resources.PACK,'packs'),(resources.MAPPINGS,'custom_mappings'),(resources.CATALOG,'')]:
        dst=prototype/'plugins/Geyser'/subdir/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(output/'resources'/name,dst)
    shutil.copy2(output/'resources'/resources.CONTRACT,prototype/'plugins/Geyser'/resources.CONTRACT)
    (prototype/'plugins/Geyser/config.yml').write_bytes(geyser_config('lan').encode('utf-8'))
    projection_count=projection_catalog(output)
    receipt={'schemaVersion':1,'mainConfigSha256':sha(main_config),'gatewayRelease':str(release),'gatewayManifestSha256':sha(release/'release.json'),'assetFiles':len(manifest),'jarInputs':{jar.name:sha(jar) for jar in archives},'resourceContract':contract,'productionModified':False}
    (output/'prepare.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    return {'workspace':str(output),'assetFiles':len(manifest),'customItems':contract['itemCount'],'namedNativeItems':projection_count,'perNamespace':contract['perNamespace'],'productionModified':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--projection-only',action='store_true');parser.add_argument('--assets',type=Path)
    parser.add_argument('--main-config',type=Path,default=MAIN)
    parser.add_argument('--install-blocks',type=Path)
    args=parser.parse_args();print(json.dumps(install_blocks(args.output,args.install_blocks) if args.install_blocks else {'namedNativeItems':projection_catalog(args.output)} if args.projection_only else prepare(args.output,args.assets,args.main_config),ensure_ascii=False))
