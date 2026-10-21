"""Convert locked FOM static block models into native Geyser block palettes.

No vanilla IDs or helper entities are used. JSON cuboids, exact source UVs and
native collision boxes are retained. Unsupported renderers are reported, never
counted as complete. Generated third-party assets stay in the private workspace.
"""
from __future__ import annotations
import argparse, collections, copy, functools, io, json, math, shutil, subprocess, tempfile, uuid, zipfile
from pathlib import Path
from PIL import Image
from maw_bedrock_resources import Assets, encoded, sha
from maw_bedrock_visuals import Models, resource, GEYSER_SHA
from maw_bedrock_modpacks import archive

PACK='maw-native-blocks.mcpack'
CATALOG='native-block-catalog.json'
CONTRACT='native-block-contract.json'
REPORT='native-block-coverage.json'
EXTENSION='MawNativeBlocks.jar'
VERSION=[1,0,0]

class CachedAssets(Assets):
    @functools.lru_cache(maxsize=None)
    def read(self,key):return super().read(key)
    @functools.lru_cache(maxsize=None)
    def json(self,key):return json.loads(self.read(key))

class BlockModels(Models):
    @functools.lru_cache(maxsize=None)
    def read(self,name,seen=()):return super().read(name,seen)

def matches(test, properties):
    if 'OR' in test:return any(matches(x,properties) for x in test['OR'])
    if 'AND' in test:return all(matches(x,properties) for x in test['AND'])
    for k,v in test.items():
        if str(properties.get(k)).lower() not in str(v).split('|'):return False
    return True

def selected(document,properties):
    def one(value):
        if isinstance(value,list):
            if len(value)!=1:raise ValueError('position_weighted_variant_requires_adapter')
            value=value[0]
        if not isinstance(value,dict) or not value.get('model'):raise ValueError('invalid_block_model')
        if value.get('uvlock') and (value.get('x',0) or value.get('y',0)):raise ValueError('uvlock_requires_adapter')
        return value
    if 'multipart' in document:
        parts=[one(p['apply']) for p in document['multipart'] if 'when' not in p or matches(p['when'],properties)]
        if not parts:raise ValueError('empty_multipart')
        return parts
    values=[]
    for condition,value in document.get('variants',{}).items():
        tests=dict(p.split('=') for p in condition.split(',') if p)
        if matches(tests,properties):values.append(one(value))
    if len(values)!=1:raise ValueError('ambiguous_blockstate_variant')
    return values

def joined(models,parts,identifier):
    entries=[]
    for n,part in enumerate(parts):
        model=models.read(part['model'])
        if any('tintindex' in face and face['tintindex']>=0 for el in model.get('elements',[]) for face in el.get('faces',{}).values()):raise ValueError('native_biome_tint_requires_adapter')
        geo,png=models.convert(model,identifier,x=part.get('x',0),y=part.get('y',0))
        entries.append((geo['minecraft:geometry'][0],Image.open(io.BytesIO(png)).convert('RGBA'),list(models.frames)))
    width=max(im.width for _,im,_ in entries);height=2**math.ceil(math.log2(sum(im.height for _,im,_ in entries)))
    period=math.lcm(*(len(frames) or 1 for _,_,frames in entries))
    if period>512:raise ValueError('multipart_animation_period_budget')
    if period>1:width=height=max(width,height)
    if max(width,height)>2048:raise ValueError('multipart_atlas_budget')
    atlas=Image.new('RGBA',(width,height));bones=[];offset=0
    offsets=[]
    for n,(body,im,_) in enumerate(entries):
        offsets.append(offset)
        atlas.paste(im,(0,offset))
        for original in body['bones']:
            bone=copy.deepcopy(original);bone['name']=f'p{n}_'+bone['name']
            if 'parent' in bone:bone['parent']=f'p{n}_'+bone['parent']
            for cube in bone.get('cubes',[]):
                for face in cube['uv'].values():face['uv'][1]+=offset
            bones.append(bone)
        offset+=im.height
    body={'description':{'identifier':identifier,'texture_width':width,'texture_height':height,'visible_bounds_width':4,'visible_bounds_height':4,'visible_bounds_offset':[0,1,0]},'bones':bones}
    out=io.BytesIO();atlas.save(out,'PNG');animation=None
    if period>1:
        if height*period>8192:raise ValueError('flipbook_texture_budget')
        strip=Image.new('RGBA',(width,height*period))
        for tick in range(period):
            for (_,im,frames),offset in zip(entries,offsets):
                image=Image.open(io.BytesIO(frames[tick%len(frames)])).convert('RGBA') if frames else im
                strip.paste(image,(0,tick*height+offset))
        raw=io.BytesIO();strip.save(raw,'PNG');animation=raw.getvalue()
    return {'format_version':'1.21.0','minecraft:geometry':[body]},out.getvalue(),animation

def checked_shape(row):
    if row.get('context')!='native_empty_block_getter' or row.get('shapeUnavailable'):raise ValueError('native_shape_unavailable')
    for key in ['collisionBoxes','selectionBoxes']:
        if not isinstance(row.get(key),list) or len(row[key])>(16 if key=='collisionBoxes' else 64):raise ValueError('shape_budget')
        for a in row[key]:
            if len(a)!=6 or any(not math.isfinite(v) for v in a):raise ValueError('invalid_native_shape')
            # Bedrock custom block bounds, not a silently clamped native shape.
            if any(a[i]<0 or a[i+3]>1 for i in [0,2]) or a[1]<0 or a[4]>1:raise ValueError('shape_outside_bedrock_bounds')
    return {key:row[key] for key in ['collisionBoxes','selectionBoxes','hardness','friction','canBreakWithHand','lightEmission']}

def block_items(catalog,assets_root,items_file,idmap_file,projection_file):
    """Use native Bedrock block icons, only for identical native item meshes.

    No front-face crop or invented inventory sprite is generated. Reordering a
    block's permutations puts the verified native inventory pose first; every
    world state is updated to keep its original geometry and physical shape.
    """
    assets=CachedAssets(Path(assets_root));models=BlockModels(assets)
    registry=dict((p[0],int(p[1])) for p in (line.split('\t') for line in Path(items_file).read_text('utf-8').splitlines()))
    by_id={v:k for k,v in registry.items()};table=json.loads(Path(idmap_file).read_bytes())
    bases={int(v):by_id[int(n)] for v,n in table['reverseVanillaItems'].items()}
    labels={r['nativeItem']:r for r in json.loads(Path(projection_file).read_bytes())['items']}
    blocks={r['name']:r for r in catalog['blocks']};rows=[];skipped=collections.Counter()
    standard=models.read('minecraft:block/block').get('display',{}).get('gui',{})
    for name,block in blocks.items():
        if name not in registry:continue
        try:
            model=models.read(name.replace(':',':item/'))
            if model.get('display',{}).get('gui',{})!=standard:raise ValueError('custom_native_gui_pose_requires_adapter')
            geo,png,animation=joined(models,[{'model':name.replace(':',':item/')}],'geometry.maw_native.placeholder')
            gid='geometry.maw_native.'+sha(encoded(geo))[:20];texture='maw_block_'+sha(animation or png)[:20]
            match=next((v for v in block['variants'] if v['geometry']==gid and v['texture']==texture),None)
            if match is None:raise ValueError('native_item_mesh_not_equal_to_world_variant')
            old=match['index']
            if old:
                block['variants'][0],block['variants'][old]=block['variants'][old],block['variants'][0]
                for i,v in enumerate(block['variants']):v['index']=i
                for state in catalog['states']:
                    if state['block']==block['identifier']:
                        if state['variant']==old:state['variant']=0
                        elif state['variant']==0:state['variant']=old
            n=registry[name];base=bases[int(table['items'][str(n)])]
            rows.append({'nativeItem':name,'nativeId':n,'baseItem':base,'block':block['identifier'],'bedrockIdentifier':'maw_native:item_'+sha(name.encode())[:20],'customModelData':8_000_000+n,'displayName':labels.get(name,{}).get('displayName',name),'method':'native_bedrock_block_icon'})
        except (ValueError,KeyError) as error:skipped[str(error)]+=1
    catalog['blockItems']=rows
    return {'count':len(rows),'excludedReasons':dict(skipped),'usedAssets':assets.used}

def compile_extension(geyser,proxy,java_bin,output):
    if sha(geyser.read_bytes())!=GEYSER_SHA:raise ValueError('geyser_not_pinned')
    source=Path(__file__).resolve().parents[1]/'world/bedrock-blocks-src';output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output) as temp:
        classes=Path(temp)/'classes';classes.mkdir()
        subprocess.run([str(java_bin/'javac.exe'),'-J-Duser.language=en','-proc:none','--release','21','-encoding','UTF-8','-cp',str(geyser)+';'+str(proxy),'-d',str(classes),*map(str,sorted((source/'src').rglob('*.java')))],check=True)
        entries={p.relative_to(classes).as_posix():p.read_bytes() for p in classes.rglob('*.class')}
    entries['extension.yml']=(source/'extension.yml').read_bytes();(output/EXTENSION).write_bytes(archive(entries))

def build(assets_root,states_file,shapes_file,output,*,extension):
    output=Path(output);output.mkdir(parents=True,exist_ok=True);assets=CachedAssets(Path(assets_root));models=BlockModels(assets)
    shapes={}
    with Path(shapes_file).open(encoding='utf-8') as f:
        for line in f:
            row=json.loads(line)
            if not row['name'].startswith('minecraft:'):shapes[row['stateId']]=row
    entries={};blocks={};states=[];coverage={};visuals={};failed={};reason_counts=collections.Counter();ns_counts=collections.Counter();flipbooks={}
    with Path(states_file).open(encoding='utf-8') as f:
        for line in f:
            row=json.loads(line);name=row['name']
            if name.startswith('minecraft:'):continue
            report=coverage.setdefault(name,{'states':0,'mappedStates':0,'fullyStaticStates':0,'reasons':collections.Counter()});report['states']+=1
            try:
                native=shapes[row['stateId']]
                if native['name']!=name or native['properties']!=row['properties']:raise ValueError('native_shape_identity_mismatch')
                if row['renderShape']!='MODEL':raise ValueError('native_special_renderer')
                if row.get('dynamicShape'):raise ValueError('context_dependent_shape')
                if row.get('hasOffsetFunction'):raise ValueError('native_position_offset_requires_adapter')
                shape=checked_shape(native)
                doc=assets.json(resource(name,'blockstates','.json'));parts=selected(doc,row['properties']);visual_key=encoded(parts)
                if visual_key in failed:raise ValueError(failed[visual_key])
                if visual_key not in visuals:
                    try:geo,png,animation=joined(models,parts,'geometry.maw_native.placeholder')
                    except (ValueError,KeyError) as error:failed[visual_key]=str(error);raise ValueError(str(error))
                    identity=sha(encoded(geo))[:20];identifier='geometry.maw_native.'+identity
                    geo['minecraft:geometry'][0]['description']['identifier']=identifier
                    texture_id=sha(animation or png)[:20];texture='maw_block_'+texture_id;path='textures/maw_blocks/'+texture_id
                    entries['models/blocks/'+identity+'.geo.json']=encoded(geo);entries[path+'.png']=png
                    if animation:
                        entries[path+'_anim.png']=animation
                        flipbooks[texture]={'flipbook_texture':path+'_anim','atlas_tile':texture,'ticks_per_frame':1,'blend_frames':False}
                    # Full source alpha is retained; alpha_test handles cutout.
                    image=Image.open(io.BytesIO(png));alpha=image.getchannel('A').getextrema()
                    visuals[visual_key]={'geometry':identifier,'texture':texture,'texturePath':path,'renderMethod':'opaque' if alpha==(255,255) else 'alpha_test'}
                visual=visuals[visual_key];block=blocks.setdefault(name,{'identifier':'maw_native:b_'+sha(name.encode())[:20],'variants':[],'_index':{}})
                fields={**shape,'friction':round(1-shape['friction'],9),**{k:visual[k] for k in ['geometry','texture','renderMethod']},'lightDampening':15 if row['canOcclude'] and row['solid'] else 0,'waterlogged':row['properties'].get('waterlogged')=='true'}
                variant_key=encoded(fields)
                if variant_key not in block['_index']:
                    n=len(block['variants'])
                    if n>=64:raise ValueError('block_permutation_budget')
                    block['_index'][variant_key]=n;block['variants'].append({'index':n,'displayName':name,**fields})
                n=block['_index'][variant_key]
                props=','.join(k+'='+str(v).lower() for k,v in sorted(row['properties'].items()))
                states.append({'nativeId':row['stateId'],'javaId':65536+row['stateId'],'nativeState':name+('['+props+']' if props else ''),'block':block['identifier'],'variant':n})
                report['mappedStates']+=1;ns_counts[name.split(':')[0]]+=1
                if not row['hasBlockEntity']:report['fullyStaticStates']+=1
                else:report['reasons']['block_entity_static_base_only']+=1
            except (ValueError,KeyError) as error:reason=str(error);report['reasons'][reason]+=1;reason_counts[reason]+=1
    blocks={k:v for k,v in blocks.items() if v['variants']}
    for group,name in enumerate(sorted(blocks),65536):
        block=blocks[name];del block['_index'];block['name']=name;block['stateGroupId']=group
    pack_id=str(uuid.uuid5(uuid.NAMESPACE_URL,'maw:fom:blocks:'+sha(Path(states_file).read_bytes())))
    entries['manifest.json']=encoded({'format_version':2,'header':{'name':'My Agent World · 原生方块','description':'Original static mod textures and cuboids; coverage report records unsupported renderers.','uuid':pack_id,'version':VERSION,'min_engine_version':[1,21,0]},'modules':[{'type':'resources','uuid':str(uuid.uuid5(uuid.UUID(pack_id),'resources')),'version':VERSION}]})
    used_geometry={v['geometry'] for b in blocks.values() for v in b['variants']};used_textures={v['texture'] for b in blocks.values() for v in b['variants']}
    entries={k:v for k,v in entries.items() if not k.startswith('models/blocks/') or 'geometry.maw_native.'+Path(k).name.split('.')[0] in used_geometry}
    entries={k:v for k,v in entries.items() if not k.startswith('textures/maw_blocks/') or 'maw_block_'+Path(k).stem.removesuffix('_anim') in used_textures}
    entries['textures/flipbook_textures.json']=encoded([r for key,r in flipbooks.items() if key in used_textures])
    entries['textures/terrain_texture.json']=encoded({'resource_pack_name':'maw_native_blocks','texture_name':'atlas.terrain','texture_data':{v['texture']:{'textures':v['texturePath']} for v in visuals.values() if v['texture'] in used_textures},'padding':8,'num_mip_levels':4})
    entries['blocks.json']=encoded({'format_version':[1,1,0],**{b['identifier']:{'sound':'stone'} for b in blocks.values()}})
    (output/PACK).write_bytes(archive(entries));(output/EXTENSION).write_bytes(Path(extension).read_bytes())
    catalog={'schemaVersion':1,'packUuid':pack_id,'blocks':list(blocks.values()),'states':states,'nativeShapeContext':'native_empty_block_getter'}
    (output/CATALOG).write_bytes(encoded(catalog))
    report={'schemaVersion':1,'totalBlocks':len(coverage),'totalStates':sum(r['states'] for r in coverage.values()),'mappedBlocks':len(blocks),'mappedStates':len(states),'fullyStaticStates':sum(r['fullyStaticStates'] for r in coverage.values()),'geometries':len(used_geometry),'textureAtlases':len(used_textures),'animatedTextures':sum(k in used_textures for k in flipbooks),'remainingReasons':dict(reason_counts),'perNamespaceMappedStates':dict(ns_counts),'blocks':coverage,'allModVisualsComplete':False}
    (output/REPORT).write_bytes(encoded(report))
    files={n:{'directory':d,'sha256':sha((output/n).read_bytes()),'bytes':(output/n).stat().st_size} for n,d in [(PACK,'packs'),(EXTENSION,'extensions'),(CATALOG,''),(REPORT,'')]}
    contract={'schemaVersion':1,'minecraft':'1.21.1','geyserJarSha256':GEYSER_SHA,'blockCount':len(blocks),'stateCount':len(states),'packUuid':pack_id,'files':files,'inputs':{'statesSha256':sha(Path(states_file).read_bytes()),'shapesSha256':sha(Path(shapes_file).read_bytes()),'assetManifestSha256':sha(assets.manifest_bytes)},'sourceAssets':assets.used}
    (output/CONTRACT).write_bytes(encoded(contract));return {k:v for k,v in report.items() if k!='blocks'}

def validate(directory,*,deployed=False):
    from fom_bedrock_block_contract import validate as checked
    return checked(directory,deployed=deployed)

def add_block_items(source,output,assets,items,idmap,projection,extension):
    contract=validate(source);output=Path(output)
    if output.exists():raise ValueError('new_block_item_output_required')
    shutil.copytree(source,output);catalog=json.loads((output/CATALOG).read_bytes())
    result=block_items(catalog,assets,items,idmap,projection);(output/CATALOG).write_bytes(encoded(catalog))
    report=json.loads((output/REPORT).read_bytes());report['blockItems']={k:v for k,v in result.items() if k!='usedAssets'};(output/REPORT).write_bytes(encoded(report))
    shutil.copy2(extension,output/EXTENSION)
    contract['blockItemCount']=result['count'];contract['sourceAssets'].update(result['usedAssets'])
    contract['blockItemInputs']={key:sha(Path(value).read_bytes()) for key,value in [('itemsSha256',items),('idmapSha256',idmap),('projectionSha256',projection)]}
    for name,meta in contract['files'].items():meta.update(sha256=sha((output/name).read_bytes()),bytes=(output/name).stat().st_size)
    (output/CONTRACT).write_bytes(encoded(contract));validate(output)
    return {k:v for k,v in result.items() if k!='usedAssets'}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--assets',type=Path);p.add_argument('--states',type=Path);p.add_argument('--shapes',type=Path);p.add_argument('--output',type=Path,required=True);p.add_argument('--extension',type=Path);p.add_argument('--compile',action='store_true');p.add_argument('--geyser',type=Path);p.add_argument('--proxy',type=Path);p.add_argument('--java-bin',type=Path);p.add_argument('--verify',action='store_true')
    p.add_argument('--block-items',action='store_true');p.add_argument('--input',type=Path);p.add_argument('--items',type=Path);p.add_argument('--idmap',type=Path);p.add_argument('--projection',type=Path);a=p.parse_args()
    if a.verify:result=validate(a.output)
    elif a.compile:compile_extension(a.geyser,a.proxy,a.java_bin,a.output);result={'compiled':True}
    elif a.block_items:result=add_block_items(a.input,a.output,a.assets,a.items,a.idmap,a.projection,a.extension)
    else:result=build(a.assets,a.states,a.shapes,a.output,extension=a.extension)
    print(json.dumps(result,ensure_ascii=False,indent=2))
