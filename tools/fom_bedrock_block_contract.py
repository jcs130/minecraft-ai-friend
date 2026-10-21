"""Standard-library release validation and owned-process readiness for blocks."""
from pathlib import Path
import datetime,hashlib,json,re
PACK='maw-native-blocks.mcpack'
CATALOG='native-block-catalog.json'
CONTRACT='native-block-contract.json'
REPORT='native-block-coverage.json'
EXTENSION='MawNativeBlocks.jar'
GEYSER_SHA='b3b39ada8f56a44f018d5e405874cbb2152527fab0240603309831e89e5e95c7'

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def validate(directory,*,deployed=False):
    directory=Path(directory);contract=json.loads((directory/CONTRACT).read_bytes())
    if contract.get('schemaVersion')!=1 or contract.get('geyserJarSha256')!=GEYSER_SHA:raise ValueError('invalid_native_block_contract')
    required={PACK:'packs',EXTENSION:'extensions',CATALOG:'',REPORT:''}
    if set(contract['files'])!=set(required):raise ValueError('incomplete_native_block_contract')
    for name,meta in contract['files'].items():
        if meta['directory']!=required[name]:raise ValueError('invalid_block_artifact')
        path=directory/meta['directory']/name if deployed else directory/name
        if path.is_symlink() or not path.is_file() or path.stat().st_size!=meta['bytes'] or sha(path)!=meta['sha256']:raise ValueError('native_block_hash_mismatch:'+name)
    catalog=json.loads((directory/CATALOG).read_bytes())
    if catalog['schemaVersion']!=1 or catalog['packUuid']!=contract['packUuid'] or len(catalog['states'])!=contract['stateCount'] or len(catalog['blocks'])!=contract['blockCount']:raise ValueError('native_block_catalog_mismatch')
    natives=set();virtuals=set();definitions={r['identifier']:r for r in catalog['blocks']}
    if len(catalog.get('blockItems',[]))!=contract.get('blockItemCount',0):raise ValueError('block_item_count_mismatch')
    item_ids=set();item_names=set()
    for row in catalog.get('blockItems',[]):
        if row['block'] not in definitions or type(row['nativeId'])!=int or row['customModelData']!=8_000_000+row['nativeId'] or not row['baseItem'].startswith('minecraft:') or row['nativeId'] in item_ids or row['bedrockIdentifier'] in item_names:raise ValueError('invalid_native_block_item')
        item_ids.add(row['nativeId']);item_names.add(row['bedrockIdentifier'])
    for row in catalog['states']:
        n,v=row['nativeId'],row['javaId'];block=definitions.get(row['block'])
        if type(n)!=int or n<0 or type(v)!=int or not 65536<=v<=1048575 or n in natives or v in virtuals:raise ValueError('invalid_or_duplicate_native_block_state')
        if block is None or type(row['variant'])!=int or not 0<=row['variant']<len(block['variants']):raise ValueError('invalid_native_block_variant')
        natives.add(n);virtuals.add(v)
    return contract

def registered_blocks(log,contract,started_after):
    log=Path(log)
    with log.open('rb') as stream:
        stream.seek(max(0,log.stat().st_size-262144));text=stream.read().decode('utf-8',errors='replace')
    matches=re.findall(r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3}).*MAW_NATIVE_BLOCKS definitions=(\d+) states=(\d+) interceptor=true',text)
    if not matches:raise ValueError('Native blocks not registered')
    stamp,blocks,states=matches[-1]
    if datetime.datetime.strptime(stamp,'%Y-%m-%d %H:%M:%S,%f').timestamp()<started_after or [int(blocks),int(states)]!=[contract['blockCount'],contract['stateCount']]:raise ValueError('Native block registration stale/incomplete')
    packs=re.findall(r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3}).*MAW_NATIVE_BLOCKS packLoaded=true',text)
    if not packs or datetime.datetime.strptime(packs[-1],'%Y-%m-%d %H:%M:%S,%f').timestamp()<started_after:raise ValueError('Native block download pack not registered')
    items=0
    if contract.get('blockItemCount',0):
        matches=re.findall(r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3}).*MAW_NATIVE_BLOCK_ITEMS registered=(\d+) sourceGeometry=true',text)
        if not matches or datetime.datetime.strptime(matches[-1][0],'%Y-%m-%d %H:%M:%S,%f').timestamp()<started_after or int(matches[-1][1])!=contract['blockItemCount']:raise ValueError('Native block item registration incomplete')
        items=int(matches[-1][1])
        linked=re.findall(r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3}).*MAW_NATIVE_BLOCK_ITEMS linked=(\d+) protocolVersions=(\d+)',text)
        if not linked or datetime.datetime.strptime(linked[-1][0],'%Y-%m-%d %H:%M:%S,%f').timestamp()<started_after or int(linked[-1][1])!=items or int(linked[-1][2])<1:raise ValueError('Native block item runtimes not linked')
    return {'registeredBlocks':int(blocks),'registeredStates':int(states),'registeredBlockItems':items,'packLoaded':True}
