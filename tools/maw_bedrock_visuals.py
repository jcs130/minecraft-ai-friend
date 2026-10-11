"""Build a reproducible Bedrock presentation pack from hash-verified Java assets.

Gameplay, inventory and motion remain authoritative on NeoForge. The additional
Geyser extension consumes only the requesting connection's opt-in scene stream.
Generated packs, shapes exported by an isolated matching server, and JARs stay
outside the source repository.
"""
from __future__ import annotations
import argparse
import copy
import io
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile
import uuid
import zipfile
from PIL import Image
from maw_bedrock_resources import Assets, encoded, sha, MARKER_BASE
from maw_bedrock_modpacks import archive, geometry

PACK='maw-world-visuals.mcpack'
CATALOG='visual-catalog.json'
CONTRACT='visual-contract.json'
EXTENSION='MawVisuals.jar'
VERSION=[1,0,0]
GEYSER_SHA='b3b39ada8f56a44f018d5e405874cbb2152527fab0240603309831e89e5e95c7'
BLOCKS={'farmersdelight:stove','farmersdelight:cutting_board','create:cogwheel',
        'create:large_cogwheel','create:shaft','create:millstone','create:windmill_bearing','create:white_sail','create:sail_frame'}
COLORS=['white','orange','magenta','light_blue','yellow','lime','pink','gray',
        'light_gray','cyan','purple','blue','brown','green','red','black']
BOOKS={'novice_spell_book':1,'apprentice_spell_book':2,'archmage_spell_book':3,'creative_spell_book':3}

class SceneAssets(Assets):
    def __init__(self,root):
        super().__init__(root);self.resolutions={}
        for key,meta in self.manifest['assets'].items():
            variants=meta.get('variants',[])
            # The verified exporter records this exact NeoForge priority. Only
            # one mod above vanilla is resolved; competing mods stay rejected.
            if (meta.get('priorityResolution')=='neoforge-21.1.248-mods-above-vanilla' and len(variants)==2
                    and variants[0].get('source')=='minecraft-1.21.1-client.jar'
                    and variants[1].get('source')==meta.get('source') and meta['source']!='minecraft-1.21.1-client.jar'
                    and variants[1].get('sha256')==meta.get('sha256') and variants[1].get('bytes')==meta.get('bytes')):
                self.resolutions[key]={'source':meta['source'],'sha256':meta['sha256'],'priorityResolution':meta['priorityResolution']}
                meta['variants']=[];meta['overriddenSources']=[]

def resource(key,folder,suffix):
    if ':' not in key:key='minecraft:'+key
    if not re.fullmatch(r'[a-z0-9_.-]+:[a-z0-9_./-]+',key) or '..' in key:raise ValueError('unsafe_resource')
    ns,local=key.split(':');return f'assets/{ns}/{folder}/{local}{suffix}'

class Models:
    def __init__(self,assets):self.assets=assets;self.active_animations={};self.frames=[]
    def read(self,name,seen=()):
        if name in seen or len(seen)>16:raise ValueError('model_parent_cycle')
        model=self.assets.json(resource(name,'models','.json'))
        if model.get('loader') or model.get('overrides'):raise ValueError('custom_or_stateful_renderer')
        parent=model.get('parent')
        base={} if not parent or parent in ('builtin/entity','minecraft:builtin/entity') else self.read(parent,(*seen,name))
        return {**base,**model,'textures':{**base.get('textures',{}),**model.get('textures',{})},
                'display':{**base.get('display',{}),**model.get('display',{})}}
    def texture(self,reference,textures):
        seen=set()
        while reference.startswith('#'):
            if reference in seen:raise ValueError('texture_reference_cycle')
            seen.add(reference);reference=textures[reference[1:]]
        key=resource(reference,'textures','.png')
        raw=self.assets.read(key)
        if key+'.mcmeta' in self.assets.manifest['assets'] and (meta:=self.assets.json(key+'.mcmeta').get('animation')):
            image=Image.open(io.BytesIO(raw)).convert('RGBA');w=meta.get('width',image.width);h=meta.get('height',w)
            if image.width!=w or image.height%h or w!=h:raise ValueError('animation_layout_requires_adapter')
            frames=meta.get('frames',list(range(image.height//h)));timeline=[]
            for frame in frames:
                index=frame if isinstance(frame,int) else frame['index'];duration=meta.get('frametime',1) if isinstance(frame,int) else frame.get('time',meta.get('frametime',1))
                if not 0<=index<image.height//h or not 1<=duration<=100:raise ValueError('invalid_texture_animation')
                timeline.append((image.crop((0,index*h,w,(index+1)*h)),duration))
            self.active_animations[reference]=(timeline,bool(meta.get('interpolate')))
            out=io.BytesIO();timeline[0][0].save(out,'PNG');return out.getvalue()
        return raw
    def convert(self,model,identifier,*,x=0,y=0):
        self.active_animations={};self.frames=[]
        elements=model.get('elements')
        if not isinstance(elements,list) or not 1<=len(elements)<=256:raise ValueError('no_bounded_cube_geometry')
        # Keep each native texel unscaled in an atlas. Java UVs use 0..16 even
        # for 32/64px textures. UV rotations and element pivots are retained.
        textures={};images={}
        for element in elements:
            for face in element.get('faces',{}).values():
                name=face['texture']
                if name not in images:
                    raw=self.texture(name,model.get('textures',{}));im=Image.open(io.BytesIO(raw)).convert('RGBA')
                    if im.width>512 or im.height>512:raise ValueError('texture_budget')
                    if im.width!=im.height:raise ValueError('non_square_model_texture')
                    images[name]=im
        if not images:raise ValueError('model_without_faces')
        size=max(im.width for im in images.values());columns=math.ceil(math.sqrt(len(images)))
        width=2**math.ceil(math.log2(max(1,columns*size)));height=2**math.ceil(math.log2(max(1,math.ceil(len(images)/columns)*size)))
        if max(width,height)>2048:raise ValueError('atlas_budget')
        atlas=Image.new('RGBA',(width,height))
        for i,(name,im) in enumerate(sorted(images.items())):
            px=(i%columns)*size;py=(i//columns)*size;atlas.paste(im,(px,py));textures[name]=(px,py,im.width,im.height)
        bones=[{'name':'root','pivot':[0,8,0]}, {'name':'orient','parent':'root','pivot':[0,8,0],'rotation':[x,-y,0]}]
        for index,element in enumerate(elements):
            lo=element['from'];hi=element['to']
            if len(lo)!=3 or len(hi)!=3 or any(not math.isfinite(v) or abs(v)>128 for v in [*lo,*hi]):raise ValueError('invalid_cube')
            uv={}
            for direction,face in element.get('faces',{}).items():
                if direction not in ('north','south','east','west','up','down'):raise ValueError('invalid_face')
                # Textureless faces are absent, rather than rendered with an
                # unrelated atlas quadrant. The same native alpha is retained.
                defaults={'down':[lo[0],16-hi[2],hi[0],16-lo[2]],'up':[lo[0],lo[2],hi[0],hi[2]],
                    'north':[16-hi[0],16-hi[1],16-lo[0],16-lo[1]],'south':[lo[0],16-hi[1],hi[0],16-lo[1]],
                    'west':[lo[2],16-hi[1],hi[2],16-lo[1]],'east':[16-hi[2],16-hi[1],16-lo[2],16-lo[1]]}
                a,b,c,d=face.get('uv',defaults[direction]);px,py,w,h=textures[face['texture']]
                if any(v<0 or v>16 for v in [a,b,c,d]):raise ValueError('wrapped_uv_requires_adapter')
                entry={'uv':[px+a*w/16,py+b*h/16],'uv_size':[(c-a)*w/16,(d-b)*h/16]}
                if face.get('rotation'):entry['uv_rotation']=face['rotation']
                uv[{'east':'west','west':'east'}.get(direction,direction)]=entry
            cube={'origin':[8-hi[0],lo[1],lo[2]-8],'size':[hi[i]-lo[i] for i in range(3)],'uv':uv}
            bone={'name':'cube'+str(index),'parent':'orient','pivot':[0,8,0],'cubes':[cube]}
            if 'rotation' in element:
                rotation=element['rotation']
                if rotation.get('rescale'):raise ValueError('element_rescale_requires_adapter')
                origin=rotation['origin'];bone['pivot']=[8-origin[0],origin[1],origin[2]-8]
                axis=rotation['axis'];angle=rotation['angle'];bone['rotation']=[angle if axis=='x' else 0,-angle if axis=='y' else 0,-angle if axis=='z' else 0]
            bones.append(bone)
        geo={'format_version':'1.21.0','minecraft:geometry':[{'description':{'identifier':identifier,
            'texture_width':width,'texture_height':height,'visible_bounds_width':4,'visible_bounds_height':4,'visible_bounds_offset':[0,1,0]},'bones':bones}]}
        if self.active_animations:
            period=math.lcm(*(sum(d for _,d in frames) for frames,_ in self.active_animations.values()))
            if period>512:raise ValueError('texture_animation_period_budget')
            for tick in range(period):
                frame_atlas=atlas.copy()
                for name,(px,py,_,_) in textures.items():
                    reference=name;seen=set()
                    while reference.startswith('#'):
                        if reference in seen:raise ValueError('texture_reference_cycle')
                        seen.add(reference);reference=model['textures'][reference[1:]]
                    if reference not in self.active_animations:continue
                    timeline,interpolate=self.active_animations[reference];at=tick%sum(d for _,d in timeline)
                    for j,(image,duration) in enumerate(timeline):
                        if at<duration:
                            if interpolate:image=Image.blend(image,timeline[(j+1)%len(timeline)][0],at/duration)
                            frame_atlas.paste(image,(px,py));break
                        at-=duration
                raw=io.BytesIO();frame_atlas.save(raw,'PNG');self.frames.append(raw.getvalue())
        buffer=io.BytesIO();atlas.save(buffer,'PNG');return geo,buffer.getvalue()

def selected_variant(document,properties):
    values=[]
    for predicate,value in document.get('variants',{}).items():
        tests=dict(p.split('=') for p in predicate.split(',') if p)
        if all(str(properties.get(k)).lower()==v for k,v in tests.items()):values.append(value)
    if len(values)!=1 or not isinstance(values[0],dict) or 'multipart' in document:raise ValueError('ambiguous_blockstate_variant')
    return values[0]

def display_entity(identifier,geo,texture,axis=None,frames=0):
    description={'identifier':identifier,'materials':{'default':'entity_alphatest'},'textures':{'default':texture},
        'geometry':{'default':geo},'render_controllers':['controller.render.maw_scene']}
    if axis:
        # MARK_VARIANT is a live server angle in millidegrees. A stopped device
        # receives an unchanged angle: there is no decorative endless rotation.
        description['animations']={'motion':'animation.maw_scene.'+axis}
        description['scripts']={'animate':['motion']}
    if frames:
        description['textures']={f'frame{i}':texture+'_'+str(i) for i in range(frames)}
        description['render_controllers']=['controller.render.'+identifier.replace(':','_')]
    return {'format_version':'1.10.0','minecraft:client_entity':{'description':description}}

def attachable(identifier,geo,texture,display):
    description={'identifier':identifier,'materials':{'default':'entity_alphatest','enchanted':'entity_alphatest_glint'},
        'textures':{'default':texture,'enchanted':'textures/misc/enchanted_item_glint'},
        'geometry':{'default':geo},'render_controllers':['controller.render.item_default'],
        'animations':{'first_person':'animation.maw_hold.'+identifier.split(':')[1]+'.first',
                      'third_person':'animation.maw_hold.'+identifier.split(':')[1]+'.third'},
        'scripts':{'animate':[{'first_person':'context.is_first_person == 1.0'},{'third_person':'context.is_first_person == 0.0'}]}}
    animations={}
    for key,kind in [('firstperson_righthand','first'),('thirdperson_righthand','third')]:
        d=display.get(key,{});translation=d.get('translation',[0,0,0]);rotation=d.get('rotation',[0,0,0])
        animations['animation.maw_hold.'+identifier.split(':')[1]+'.'+kind]={'loop':True,'bones':{'maw_item_root':{
            'rotation':[rotation[0],-rotation[1],-rotation[2]],'position':[-translation[0],translation[1],translation[2]],'scale':d.get('scale',[1,1,1])}}}
    return {'format_version':'1.10.0','minecraft:attachable':{'description':description}},animations

def book_geometry(assets,tier,identifier,opened=True):
    value,_=geometry(assets.read('assets/ars_nouveau/geo/spellbook_'+('open' if opened else 'closed')+'.geo.json'),identifier)
    body=value['minecraft:geometry'][0];bones=body['bones'];selected={}
    def chosen(bone):
        if bone['name'] in selected:return selected[bone['name']]
        selected[bone['name']]=chosen(next(b for b in bones if b['name']==bone['parent'])) if bone.get('parent') else bone['name']=='tier'+str(tier)
        return selected[bone['name']]
    kept=[copy.deepcopy(b) for b in bones if chosen(b)]
    for bone in kept:
        if not bone.get('parent'):bone['parent']='maw_item_root'
    body['bones']=[{'name':'maw_item_root','pivot':[0,8,0],'binding':"q.item_slot_to_bone_name(c.item_slot)"},*kept]
    return value

def compile_extension(geyser,java_bin,output):
    if sha(geyser.read_bytes())!=GEYSER_SHA:raise ValueError('geyser_not_pinned')
    src=Path(__file__).resolve().parents[1]/'world/bedrock-visuals-src';output.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output) as temp:
        classes=Path(temp)/'classes';classes.mkdir()
        subprocess.run([str(java_bin/'javac.exe'),'-J-Duser.language=en','-proc:none','--release','21','-encoding','UTF-8',
            '-cp',str(geyser),'-d',str(classes),*map(str,sorted((src/'src').rglob('*.java')))],check=True)
        entries={p.relative_to(classes).as_posix():p.read_bytes() for p in classes.rglob('*.class')}
    entries['extension.yml']=(src/'extension.yml').read_bytes();(output/EXTENSION).write_bytes(archive(entries))

def build(asset_root,registry,states,shapes,icons,output,*,geyser,extension):
    assets=SceneAssets(asset_root);models=Models(assets);output.mkdir(parents=True,exist_ok=True)
    source_shapes=json.loads(shapes.read_bytes())
    if source_shapes.get('schemaVersion')!=1 or source_shapes.get('source')!='installed_native_block_collision_shapes':raise ValueError('native_shape_source_required')
    expected={};part_states=[]
    for line in states.read_text('utf-8').splitlines():
        row=json.loads(line)
        if row['name'] in BLOCKS:expected[row['stateId']]=row
        if re.fullmatch(r'create:(?:[a-z_]+_sail|sail_frame)|minecraft:(?:[a-z_]+_planks|oak_log|white_wool)',row['name']):part_states.append(row)
    if set(expected)!=set(row['stateId'] for row in source_shapes['states']):raise ValueError('native_shape_registry_mismatch')
    catalog={'schemaVersion':1,'blocks':[],'parts':{},'entities':[],'foods':{},'books':{},'actualPhoneTested':False};entries={};excluded=[]
    for row in source_shapes['states']:
        native=expected[row['stateId']]
        if row['name']!=native['name'] or row['properties']!=native['properties']:raise ValueError('native_shape_identity_mismatch')
        try:
            variant=selected_variant(assets.json(resource(row['name'],'blockstates','.json')),row['properties'])
            code='b'+str(row['stateId']);identifier='maw_scene:'+code;gid='geometry.maw_scene.'+code
            geo,png=models.convert(models.read(variant['model']),gid,x=variant.get('x',0),y=variant.get('y',0))
            entries['models/entity/'+code+'.json']=encoded(geo);entries['textures/scene/'+code+'.png']=png
            axis=row['properties'].get('axis') if row['name'] in ('create:cogwheel','create:large_cogwheel','create:shaft') else None
            entries['entity/'+code+'.json']=encoded(display_entity(identifier,gid,'textures/scene/'+code,axis,len(models.frames)))
            if models.frames:
                for i,raw in enumerate(models.frames):entries['textures/scene/'+code+'_'+str(i)+'.png']=raw
                entries['render_controllers/'+code+'.json']=encoded({'format_version':'1.8.0','render_controllers':{
                    'controller.render.'+identifier.replace(':','_'):{'arrays':{'textures':{'Array.frames':['Texture.frame'+str(i) for i in range(len(models.frames))]}},
                        'geometry':'Geometry.default','materials':[{'*':'Material.default'}],'textures':['Array.frames[math.mod(math.floor(q.life_time * 20), '+str(len(models.frames))+')]']}}})
            block={**row,'identifier':identifier,'geometry':gid,'texture':'maw_scene_'+code,'axis':axis,
                   'geometryPath':'models/entity/'+code+'.json','png':'textures/scene/'+code+'.png'}
            catalog['blocks'].append(block);catalog['entities'].append(identifier)
        except (ValueError,KeyError,FileNotFoundError) as e:excluded.append({'block':row['name'],'stateId':row['stateId'],'reason':str(e)})
    # Bearing parts retain their exact original block models and orientations.
    # A contraption with an unavailable part is hidden as a whole, never filled
    # with a guessed vanilla cube or a partial rotor.
    for row in part_states:
        try:
            variant=selected_variant(assets.json(resource(row['name'],'blockstates','.json')),row['properties'])
            code='p'+str(row['stateId']);gid='geometry.maw_scene.'+code
            geo,png=models.convert(models.read(variant['model']),gid,x=variant.get('x',0),y=variant.get('y',0))
            if models.frames:raise ValueError('animated_contraption_part_requires_adapter')
            entries['models/entity/'+code+'.json']=encoded(geo);entries['textures/scene/'+code+'.png']=png
            ids={a:'maw_scene:'+code+a for a in ('x','y','z')}
            for axis,identifier in ids.items():
                entries['entity/'+code+axis+'.json']=encoded(display_entity(identifier,gid,'textures/scene/'+code,axis));catalog['entities'].append(identifier)
            catalog['parts'][str(row['stateId'])]={'id':row['name'],'properties':row['properties'],'entities':ids,'geometryPath':'models/entity/'+code+'.json','png':'textures/scene/'+code+'.png'}
        except (ValueError,KeyError,FileNotFoundError) as e:excluded.append({'part':row['name'],'stateId':row['stateId'],'reason':str(e)})
    # Millstone block model deliberately omits its renderer's inner mechanism.
    geo,png=models.convert(models.read('create:block/millstone/inner'),'geometry.maw_scene.millstone_inner')
    entries['models/entity/millstone_inner.json']=encoded(geo);entries['textures/scene/millstone_inner.png']=png
    identifier='maw_scene:millstone_inner';catalog['entities'].append(identifier);catalog['millstoneInner']=identifier
    entries['entity/millstone_inner.json']=encoded(display_entity(identifier,'geometry.maw_scene.millstone_inner','textures/scene/millstone_inner','y'))
    animations={}
    for axis in ('x','y','z'):
        # Java/Bedrock local X reflection reverses Y and Z handedness.
        rotation=[('q.mark_variant / 1000.0' if axis=='x' else '-q.mark_variant / 1000.0') if a==axis else 0 for a in ('x','y','z')]
        animations['animation.maw_scene.'+axis]={'loop':True,'bones':{'root':{'rotation':rotation}}}
    entries['animations/motion.json']=encoded({'format_version':'1.8.0','animations':animations})
    entries['render_controllers/scene.json']=encoded({'format_version':'1.8.0','render_controllers':{'controller.render.maw_scene':{'geometry':'Geometry.default','materials':[{'*':'Material.default'}],'textures':['Texture.default']}}})
    entries['models/blocks/empty.json']=encoded({'format_version':'1.12.0','minecraft:geometry':[{'description':{'identifier':'geometry.maw_scene.empty','texture_width':16,'texture_height':16},'bones':[{'name':'root','pivot':[0,0,0]}]}]})
    entries['textures/terrain_texture.json']=encoded({'resource_pack_name':'maw_scene','texture_name':'atlas.terrain','texture_data':{b['texture']:{'textures':b['png'][:-4]} for b in catalog['blocks']}})
    # Food models use original item sprites, including vanilla meals. Geometry
    # lies on the appliance; its identity/count/progress always comes from Java.
    native_icons=json.loads((icons/'maw-native-items.json').read_bytes())['items']
    for row in native_icons:
        key=row['nativeItem']
        if key.startswith('farmersdelight:') and not any(w in key for w in ('knife','stove','board','pot','cabinet','crate','sign','door','sack','basket','block')):
            try:raw=models.texture('farmersdelight:item/'+key.split(':')[1],{})
            except (ValueError,KeyError,FileNotFoundError):continue
            code='f'+str(row['nativeId']);catalog['foods'][key]={'identifier':'maw_scene:'+code,'geometry':'geometry.maw_scene.'+code}
            entries['textures/scene/'+code+'.png']=raw
    for i,key in enumerate(['beef','porkchop','chicken','mutton','rabbit','cod','salmon','potato','baked_potato','cooked_beef','cooked_porkchop','cooked_chicken','cooked_mutton','cooked_rabbit','cooked_cod','cooked_salmon','bread','carrot','apple','wheat']):
        code='v'+str(i)
        try:entries['textures/scene/'+code+'.png']=models.texture('minecraft:item/'+key,{})
        except (ValueError,KeyError,FileNotFoundError):continue
        catalog['foods']['minecraft:'+key]={'identifier':'maw_scene:'+code,'geometry':'geometry.maw_scene.'+code}
    for key,row in catalog['foods'].items():
        code=row['identifier'].split(':')[1]
        geo={'format_version':'1.12.0','minecraft:geometry':[{'description':{'identifier':row['geometry'],'texture_width':16,'texture_height':16,'visible_bounds_width':1,'visible_bounds_height':1},'bones':[{'name':'root','pivot':[0,0,0],'cubes':[{'origin':[-2.5,0,-2.5],'size':[5,0,5],'uv':{'up':{'uv':[0,0],'uv_size':[16,16]},'down':{'uv':[0,0],'uv_size':[16,16]}}}]}]}]}
        entries['models/entity/'+code+'.json']=encoded(geo);entries['entity/'+code+'.json']=encoded(display_entity(row['identifier'],row['geometry'],'textures/scene/'+code,'y'));catalog['entities'].append(row['identifier'])
    # Merge into the existing marker/catalog so each connection still restores
    # complete original mod components, never a guessed paper or stone item.
    with zipfile.ZipFile(icons/'maw-native-icons.mcpack') as z:icon_entries={n:z.read(n) for n in z.namelist()}
    item_catalog=json.loads((icons/'maw-native-items.json').read_bytes());mapping=json.loads((icons/'maw-native-icons.json').read_bytes())
    registry_items=dict((p[0],int(p[1])) for p in (line.split('\t') for line in registry.read_text('utf-8').splitlines()))
    idmap=json.loads((icons/'resource-contract.json').read_bytes())
    # The actual base aliases come from the original registry/idmap input.
    input_map=json.loads((registry.parent.parent/'idmap.json').read_bytes())['items']
    reverse={n:key for key,n in registry_items.items() if key.startswith('minecraft:')}
    atlas=json.loads(icon_entries['textures/item_texture.json']);held_animations={}
    lang={}
    for ns in ('ars_nouveau','create'):
        for locale in ('en_us','zh_cn'):
            key=f'assets/{ns}/lang/{locale}.json'
            if key in assets.manifest['assets']:lang.update(assets.json(key))
    def add_item(key,geo,png,display,variant=''):
        number=registry_items[key];base=reverse[int(input_map[str(number)])]
        code='i'+str(number)+(('_'+variant) if variant else '');identifier='maw_native:'+code
        marker=MARKER_BASE+number if not variant else 9_000_000+number*32+COLORS.index(variant)
        title=lang.get('item.'+key.replace(':','.'),key);gid='geometry.maw_hold.'+code
        geo=copy.deepcopy(geo);geo['minecraft:geometry'][0]['description']['identifier']=gid
        texture='textures/held/'+code
        icon_entries['models/entity/'+code+'.json']=encoded(geo);icon_entries[texture+'.png']=png
        held,anim=attachable(identifier,gid,texture,display);held_animations.update(anim);icon_entries['attachables/'+code+'.json']=encoded(held)
        # Preserve an existing inventory sprite where one exists. For books,
        # the original sheet requires a model-rendered icon (see preview tool).
        existing=next((r for r in item_catalog['items'] if r['nativeItem']==key),None)
        icon='maw_held_'+code
        if existing and not variant:icon_path=existing['png'];icon_raw=icon_entries[icon_path]
        else:
            icon_path='textures/items/'+code+'.png';icon_raw=book_icon(png,geo);icon_entries[icon_path]=icon_raw
        atlas['texture_data'][icon]={'textures':icon_path[:-4]}
        definition={'type':'legacy','custom_model_data':marker,'bedrock_identifier':identifier,'display_name':title,
                    'bedrock_options':{'icon':icon,'display_handheld':True,'creative_category':'none'}}
        mapping['items'].setdefault(base,[]).append(definition)
        if not existing:
            existing={'nativeItem':key,'nativeId':number,'baseItem':base,'customModelData':marker,'bedrockIdentifier':identifier,
                'displayName':title,'icon':icon,'png':icon_path,'pngSha256':sha(icon_raw),'method':'native_3d_model','handheld':True};item_catalog['items'].append(existing)
        if variant:
            existing.setdefault('variants',{})[variant]={'customModelData':marker,'bedrockIdentifier':identifier,'icon':icon,'png':icon_path,'pngSha256':sha(icon_raw)}
        else:
            # Replace an older flat entry for the same marker, not register a
            # duplicate matching definition with unspecified precedence.
            mapping['items'][base]=[d for d in mapping['items'][base] if d is definition or d['custom_model_data']!=marker]
            existing.update({'bedrockIdentifier':identifier,'icon':icon,'method':'native_3d_model'})
        return identifier
    for leaf,tier in BOOKS.items():
        key='ars_nouveau:'+leaf
        if key not in registry_items:continue
        model=assets.json(resource('ars_nouveau:item/'+leaf,'models','.json'))
        for color in COLORS:
            geo=book_geometry(assets,tier,'geometry.placeholder');raw=assets.read('assets/ars_nouveau/textures/item/spellbook_'+color+'.png')
            identifier=add_item(key,geo,raw,model.get('display',{}),color)
            catalog['books'][key+':'+color]=identifier
        row=next(r for r in item_catalog['items'] if r['nativeItem']==key);row['variantComponent']='base_color';row['variantDefault']='purple'
        row.update(row['variants']['purple'])
        # The unsuffixed default marker is unused; the default selects purple.
    for key in ('create:wrench',):
        if key not in registry_items:continue
        try:
            model=models.read(key.split(':')[0]+':item/'+key.split(':')[1]);geo,png=models.convert(model,'geometry.placeholder')
            bones=geo['minecraft:geometry'][0]['bones'];bones[0]['name']='maw_item_root';bones[0]['binding']="q.item_slot_to_bone_name(c.item_slot)";bones[1]['parent']='maw_item_root'
            add_item(key,geo,png,model.get('display',{}))
        except (ValueError,KeyError,FileNotFoundError) as e:excluded.append({'item':key,'reason':str(e)})
    for leaf,shape,texture in [('wand','wand','wand'),('enchanters_sword','sword','enchanters_sword')]:
        key='ars_nouveau:'+leaf
        if key not in registry_items:continue
        geo,_=geometry(assets.read('assets/ars_nouveau/geo/'+shape+'.geo.json'),'geometry.placeholder')
        bones=geo['minecraft:geometry'][0]['bones']
        for bone in bones:
            if not bone.get('parent'):bone['parent']='maw_item_root'
        bones.insert(0,{'name':'maw_item_root','pivot':[0,8,0],'binding':'q.item_slot_to_bone_name(c.item_slot)'})
        png=assets.read('assets/ars_nouveau/textures/item/'+texture+'.png')
        model=assets.json(resource(key.replace(':',':item/'),'models','.json'))
        add_item(key,geo,png,model.get('display',{}))
    icon_entries['animations/held.json']=encoded({'format_version':'1.8.0','animations':held_animations})
    icon_entries['textures/item_texture.json']=encoded(atlas)
    im=json.loads(icon_entries['manifest.json']);im['header']['version']=[1,1,0];im['header']['description']='原生图标与魔艺法术书 / 机械工具模型；实际组件身份保留。';im['modules'][0]['version']=[1,1,0];icon_entries['manifest.json']=encoded(im)
    # Keep language names complete for new definitions as well as existing ones.
    for locale in ('zh_CN','en_US'):
        icon_entries['texts/'+locale+'.lang']+=('\n'+'\n'.join('item.'+d['bedrock_identifier']+'.name='+d['display_name'] for rows in mapping['items'].values() for d in rows)+'\n').encode('utf-8')
    icon_artifacts={'maw-native-icons.mcpack':archive(icon_entries),'maw-native-items.json':encoded(item_catalog),'maw-native-icons.json':encoded(mapping)}
    old=json.loads((icons/'resource-contract.json').read_bytes());old.update({'packVersion':[1,1,0],'itemCount':len(item_catalog['items']),
        'definitionCount':sum(map(len,mapping['items'].values())),'scope':'Static original sprites plus explicit native 3D held models and original spell-book color variants',
        'files':{n:{'sha256':sha(raw),'bytes':len(raw)} for n,raw in icon_artifacts.items()}})
    old['perNamespace']={ns:sum(r['nativeItem'].startswith(ns+':') for r in item_catalog['items']) for ns in sorted(set(r['nativeItem'].split(':')[0] for r in item_catalog['items']))}
    adapted=set(r['nativeItem'] for r in item_catalog['items'])
    old['excluded']=[r for r in old.get('excluded',[]) if r.get('item') not in adapted and r.get('nativeItem') not in adapted]
    old['inputs']['usedNativeAssets'].update(assets.used);icon_artifacts['resource-contract.json']=encoded(old)
    pack_uuid=str(uuid.uuid5(uuid.NAMESPACE_URL,'https://github.com/jcs130/minecraft-ai-friend/bedrock-visuals'))
    entries['manifest.json']=encoded({'format_version':2,'header':{'name':'My Agent World · 生活与机械','description':'原生灶台、食物、真实机械运动与新手引导资源','uuid':pack_uuid,'version':VERSION,'min_engine_version':[1,21,0]},'modules':[{'type':'resources','uuid':str(uuid.uuid5(uuid.UUID(pack_uuid),'resources')),'version':VERSION}]})
    entries['credits/sources.json']=encoded({'sources':assets.manifest.get('sources',[]),'notice':'Original artwork and models retain their authors and licenses. Adapter source does not relicense third-party artwork.'})
    # Button icons use original artwork. No text labels masquerade as icons.
    for name,key in [('food','minecraft:item/bread'),('magic','ars_nouveau:item/source_gem'),('machine','create:item/andesite_alloy'),('guide','minecraft:item/book'),('tools','minecraft:item/iron_pickaxe')]:
        try:entries['textures/guide/'+name+'.png']=models.texture(key,{})
        except (ValueError,KeyError,FileNotFoundError):raise ValueError('guide_icon_missing:'+name)
    catalog['packUuid']=pack_uuid;catalog['packVersion']=VERSION
    artifacts={PACK:archive(entries),CATALOG:encoded(catalog),EXTENSION:extension.read_bytes()}
    repo=Path(__file__).resolve().parents[1];source=repo/'world/bedrock-visuals-src'
    source_files=[Path(__file__),source/'extension.yml',*sorted((source/'src').rglob('*.java'))]
    contract={'schemaVersion':1,'geyserSha256':sha(geyser.read_bytes()),'packUuid':pack_uuid,'packVersion':VERSION,
        'sourceFiles':{p.relative_to(repo).as_posix():sha(p.read_bytes()) for p in source_files},
        'blockCount':len(catalog['blocks']),'partCount':len(catalog['parts']),'entityCount':len(catalog['entities']),'foodCount':len(catalog['foods']),
        'heldModelCount':len(held_animations)//2,'nativeItemCount':old['itemCount'],'itemDefinitionCount':old['definitionCount'],
        'files':{n:{'sha256':sha(raw),'bytes':len(raw),'directory':'packs' if n.endswith('.mcpack') else 'extensions' if n.endswith('.jar') else ''} for n,raw in artifacts.items()},
        'inputs':{'nativeAssetsSha256':sha(assets.manifest_bytes),'statesSha256':sha(states.read_bytes()),'shapesSha256':sha(shapes.read_bytes()),'usedNativeAssets':assets.used,'resolvedPriorities':{k:v for k,v in assets.resolutions.items() if k in assets.used}},
        'excluded':excluded,'actualPhoneTested':False,'visualPixelParityVerified':False,
        'limits':{'sceneHz':4,'radius':16,'unassembledSailRadius':6,'blocks':24,'helperEntities':128,'payloadBytes':65536},
        'limitations':['Complex contraptions require every constituent model; unavailable parts stay explicit.',
            'Special-item inventory previews crop the original model texture; they are not Java GUI pixel parity.',
            'GUI lighting/hand placement and smooth motion need real Bedrock visual acceptance.']}
    for name,raw in {**artifacts,**icon_artifacts,CONTRACT:encoded(contract)}.items():(output/name).write_bytes(raw)
    validate(output);return contract

def book_icon(png,geo):
    # A compact original-texture book preview. The full 3D held geometry above
    # is independent of this GUI representation; no unrelated vanilla icon.
    image=Image.open(io.BytesIO(png)).convert('RGBA')
    body=geo['minecraft:geometry'][0]
    cubes=[copy.deepcopy(c) for b in body['bones'] for c in b.get('cubes',[]) if c.get('uv') is not None]
    for c in cubes:
        if isinstance(c['uv'],list):
            u,v=c['uv'];w,h,d=c['size'];c['uv']={'north':{'uv':[u+d,v+d],'uv_size':[w,h]}}
    cubes=[c for c in cubes if 'north' in c['uv']]
    if not cubes:raise ValueError('item_icon_requires_adapter')
    cube=max(cubes,key=lambda c:abs(math.prod(c['uv']['north']['uv_size'])))
    face=cube['uv']['north'];u,v=face['uv'];w,h=face['uv_size']
    icon=image.crop((int(min(u,u+w)),int(min(v,v+h)),int(max(u,u+w)),int(max(v,v+h))))
    target=Image.new('RGBA',(32,32));icon.thumbnail((20,28),Image.Resampling.NEAREST);target.alpha_composite(icon,((32-icon.width)//2,(32-icon.height)//2))
    out=io.BytesIO();target.save(out,'PNG');return out.getvalue()

def validate(directory,*,deployed=False):
    c=json.loads((directory/CONTRACT).read_bytes())
    if c.get('schemaVersion')!=1 or c.get('geyserSha256')!=GEYSER_SHA or set(c['files'])!={PACK,CATALOG,EXTENSION}:raise ValueError('invalid_visual_contract')
    for name,meta in c['files'].items():
        if Path(name).name!=name or meta['directory'] not in ('','packs','extensions'):raise ValueError('unsafe_visual_path')
        path=directory/meta['directory']/name if deployed else directory/name
        if path.is_symlink():raise ValueError('visual_symlink')
        raw=path.read_bytes()
        if len(raw)!=meta['bytes'] or sha(raw)!=meta['sha256']:raise ValueError('visual_integrity:'+name)
    catalog=json.loads((directory/CATALOG).read_bytes())
    if (catalog.get('schemaVersion')!=1 or len(catalog['blocks'])!=c['blockCount'] or len(catalog['parts'])!=c['partCount'] or
        len(catalog['entities'])!=c['entityCount'] or len(set(catalog['entities']))!=c['entityCount']):raise ValueError('visual_catalog_count')
    path=directory/'packs'/PACK if deployed else directory/PACK
    with zipfile.ZipFile(path) as z:
        if z.testzip() or len(set(z.namelist()))!=len(z.namelist()):raise ValueError('visual_zip')
        manifest=json.loads(z.read('manifest.json'))
        if manifest['header']['uuid']!=c['packUuid'] or manifest['header']['version']!=c['packVersion']:raise ValueError('visual_pack_version')
        client_ids=[]
        for path in z.namelist():
            if path.startswith('entity/') and path.endswith('.json'):client_ids.append(json.loads(z.read(path))['minecraft:client_entity']['description']['identifier'])
        if set(client_ids)!=set(catalog['entities']) or len(client_ids)!=len(catalog['entities']):raise ValueError('visual_entity_definitions')
        for b in catalog['blocks']:
            if b['name'] not in BLOCKS or not isinstance(b['collisionBoxes'],list):raise ValueError('visual_block_identity')
            for box in b['collisionBoxes']:
                if len(box)!=6 or any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in box) or any(not 0<=box[i]<box[i+3]<=1 for i in range(3)):raise ValueError('visual_collision_shape')
            if not json.loads(z.read(b['geometryPath']))['minecraft:geometry'][0]['bones']:raise ValueError('visual_geometry')
            Image.open(io.BytesIO(z.read(b['png']))).verify()
        for p in catalog['parts'].values():
            if set(p['entities'])!={'x','y','z'} or any(v not in client_ids for v in p['entities'].values()):raise ValueError('visual_part_definitions')
            if not json.loads(z.read(p['geometryPath']))['minecraft:geometry'][0]['bones']:raise ValueError('visual_part_geometry')
            Image.open(io.BytesIO(z.read(p['png']))).verify()
    return c

def registered(log,contract,started_after):
    import datetime
    text=log.read_bytes()[-262144:].decode('utf-8','replace')
    pattern=r'(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d{3}).*MAW_VISUALS blocks=(\d+) entities=(\d+) packLoaded=true'
    found=re.findall(pattern,text)
    if not found:raise ValueError('visual_registration_missing')
    stamp,blocks,entities=found[-1]
    if datetime.datetime.strptime(stamp,'%Y-%m-%d %H:%M:%S,%f').timestamp()<started_after or int(blocks)!=contract['blockCount'] or int(entities)!=contract['entityCount']:raise ValueError('visual_registration_stale')
    return {'blocks':int(blocks),'entities':int(entities),'actualPhoneTested':False}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('assets','registry','states','shapes','icons','output','geyser','java-bin'):p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True);compile_extension(a.geyser,a.java_bin,a.output)
    result=build(a.assets,a.registry,a.states,a.shapes,a.icons,a.output,geyser=a.geyser,extension=a.output/EXTENSION)
    print(json.dumps({k:result[k] for k in ('blockCount','entityCount','foodCount','heldModelCount','nativeItemCount','itemDefinitionCount','excluded')},ensure_ascii=False))
