"""Account for every frozen FOM content entry, including unconverted renderers.

An available source model is not counted as working Bedrock coverage. Only
entries in the validated deployed contracts qualify; the rest retain a reason.
Generated row-level reports belong in private research, not the source repo.
"""
from __future__ import annotations
import argparse,collections,csv,hashlib,json
from functools import lru_cache
from pathlib import Path
from maw_bedrock_resources import Assets

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def audit(registry:Path,assets:Path,geyser:Path,output:Path):
    source=Assets(assets);models=source.manifest['assets']
    icons=json.loads((geyser/'maw-native-items.json').read_bytes())['items']
    covered={row['nativeItem']:row for row in icons}
    world_states=set();block_item_rows={}
    if (geyser/'native-block-contract.json').is_file():
        from fom_bedrock_block_contract import validate
        validate(geyser,deployed=True)
        block_catalog=json.loads((geyser/'native-block-catalog.json').read_bytes())
        world_states={r['nativeId'] for r in block_catalog['states']};block_item_rows={r['nativeItem']:r for r in block_catalog.get('blockItems',[])}
    @lru_cache(maxsize=None)
    def model_kind(identifier,parents=()):
        if ':' not in identifier:identifier='minecraft:'+identifier
        if identifier in parents or len(parents)>24:return 'cyclic_model_parent'
        ns,local=identifier.split(':',1);key=f'assets/{ns}/models/{local}.json'
        if identifier in ('minecraft:item/generated','minecraft:item/handheld','minecraft:item/handheld_rod'):return 'generated_item'
        if identifier in ('minecraft:builtin/entity','minecraft:builtin/generated'):return 'native_special_renderer'
        if key not in models:return 'source_model_missing'
        try:model=source.json(key)
        except (ValueError,OSError) as error:return str(error)
        if model.get('loader'):return 'custom_loader:'+str(model['loader'])
        if model.get('overrides'):return 'stateful_item_model'
        if model.get('elements') is not None:return 'java_cuboids' if model['elements'] else 'empty_static_model'
        return model_kind(model['parent'],(*parents,identifier)) if model.get('parent') else 'native_special_renderer'
    item_rows=[];block_rows=[];state_rows=[];blocks={};modstats=collections.defaultdict(collections.Counter)
    for line in (registry/'items.tsv').read_text('utf-8').splitlines():
        name,number=line.split('\t');ns,local=name.split(':',1)
        if ns=='minecraft':continue
        icon=covered.get(name) or block_item_rows.get(name);kind=model_kind(ns+':item/'+local)
        row={'nativeItem':name,'nativeId':int(number),'sourceKind':kind,
             'coverage':('native_block_item' if name in block_item_rows else 'deployed_icon') if icon else 'unadapted','method':icon.get('method') if icon else None,
             'heldModelVerified':False,'reason':None if icon else kind}
        item_rows.append(row);modstats[ns]['items']+=1;modstats[ns][row['coverage']]+=1
    for line in (registry/'block-states.jsonl').open(encoding='utf-8'):
        row=json.loads(line);name=row['name'];ns,local=name.split(':',1)
        if ns=='minecraft':continue
        group=blocks.setdefault(name,{'name':name,'states':0,'hasBlockEntity':False,'dynamicShape':False,'renderShapes':set()})
        group['states']+=1;group['hasBlockEntity']|=row['hasBlockEntity'];group['dynamicShape']|=row['dynamicShape'];group['renderShapes'].add(row['renderShape'])
        mapped=row['stateId'] in world_states
        group.setdefault('mappedStates',0);group['mappedStates']+=int(mapped)
        state_rows.append({'stateId':row['stateId'],'name':name,'properties':row['properties'],'coverage':('native_static_base_only' if row['hasBlockEntity'] else 'native_model') if mapped else 'vanilla_projection_only'})
    for name,group in sorted(blocks.items()):
        ns,local=name.split(':',1);key=f'assets/{ns}/blockstates/{local}.json'
        kinds=collections.Counter();variants=False;multipart=False;random=False;reason=None
        try:
            document=source.json(key);variants='variants' in document;multipart='multipart' in document
            entries=list(document.get('variants',{}).values())+[p['apply'] for p in document.get('multipart',[])]
            for entry in entries:
                if isinstance(entry,list):random|=len(entry)>1;entry_rows=entry
                else:entry_rows=[entry]
                for item in entry_rows:kinds[model_kind(item['model'])]+=1
        except (ValueError,KeyError,OSError) as error:reason=str(error)
        coverage='native_model_all_states' if group['mappedStates']==group['states'] else 'native_model_some_states' if group['mappedStates'] else 'vanilla_projection_only'
        group['renderShapes']=sorted(group['renderShapes']);group.update({'coverage':coverage,'blockEntityRendererParity':False if group['hasBlockEntity'] else None,'sourceModelKinds':dict(kinds),'multipart':multipart,'weightedVariants':random,'reason':reason})
        block_rows.append(group);modstats[ns]['blocks']+=1;modstats[ns]['blockStates']+=group['states']
        if group['hasBlockEntity']:modstats[ns]['blockEntityTypes']+=1
    entities=[]
    for line in (registry/'entities.tsv').read_text('utf-8').splitlines():
        name,number=line.split('\t')
        if not name.startswith('minecraft:'):entities.append({'name':name,'nativeId':int(number),'coverage':'deployed_native_model' if name=='touhou_little_maid:maid' else 'not_rendered'})
    summary={'schemaVersion':1,'registry':{name:digest(registry/name) for name in ['items.tsv','blocks.tsv','block-states.jsonl','entities.tsv']},
        'assetManifestSha256':digest(assets/'native-assets.json'),'items':len(item_rows),'deployedIcons':sum(r['coverage']=='deployed_icon' for r in item_rows),'nativeBlockItems':sum(r['coverage']=='native_block_item' for r in item_rows),
        'blocks':len(block_rows),'blockStates':len(state_rows),'customWorldBlockStates':len(world_states),'customWorldBlocks':sum(r['mappedStates']>0 for r in block_rows),'entities':entities,'perNamespace':dict(sorted(modstats.items())),
        'unadaptedItemReasons':dict(collections.Counter(r['reason'] for r in item_rows if r['reason'])),
        'blockSourceKinds':dict(sum((collections.Counter(r['sourceModelKinds']) for r in block_rows),collections.Counter())),
        'sourceAvailableIsNotAcceptance':True,'allContentAdapted':False}
    output.mkdir(parents=True,exist_ok=True)
    for name,rows in [('items',item_rows),('blocks',block_rows),('states',state_rows)]:
        with (output/(name+'.jsonl')).open('w',encoding='utf-8') as file:
            for row in rows:file.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n')
    (output/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return summary

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['registry','assets','geyser','output']:p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args();value=audit(a.registry,a.assets,a.geyser,a.output);print(json.dumps({k:v for k,v in value.items() if k not in ['perNamespace','registry','entities']},ensure_ascii=False,indent=2))
