"""Build original Qiandengji item art for Java 1.20.6, Geyser and the Web.

One catalog and authored cuboids are authoritative. No third-party models or
textures are fetched. Output stays outside Git. Python 3 + Pillow are required.
"""
from __future__ import annotations
import argparse, hashlib, json, math, uuid, zipfile
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
CLIENT_SHA256 = '02dfd345ac1ad55692d5dbc8486ac7e4fea72cd54ac494a79cd48963048e56b2'
SIDES = ('north', 'south', 'east', 'west', 'up', 'down')
DISPLAY = {
    'thirdperson_righthand': {'rotation': [0, -90, 55], 'translation': [0, 4, .5], 'scale': [.85]*3},
    'thirdperson_lefthand': {'rotation': [0, 90, -55], 'translation': [0, 4, .5], 'scale': [.85]*3},
    'firstperson_righthand': {'rotation': [0, -90, 25], 'translation': [1.13, 3.2, 1.13], 'scale': [.68]*3},
    'firstperson_lefthand': {'rotation': [0, 90, -25], 'translation': [1.13, 3.2, 1.13], 'scale': [.68]*3},
    'gui': {'rotation': [30, 225, 0], 'translation': [0, -2, 0], 'scale': [.55]*3},
    'ground': {'rotation': [0, 0, 0], 'translation': [0, 2, 0], 'scale': [.4]*3},
    'fixed': {'rotation': [0, 180, 0], 'translation': [0, -2, 0], 'scale': [.6]*3}
}

def js(value): return (json.dumps(value, ensure_ascii=False, separators=(',', ':'))+'\n').encode('utf-8')
def digest(raw): return hashlib.sha256(raw).hexdigest()
def write(root, name, raw):
    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
def archive(root, filename):
    with zipfile.ZipFile(filename, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for file in sorted(root.rglob('*')):
            if file.is_file():
                entry = zipfile.ZipInfo(file.relative_to(root).as_posix(), (2026, 10, 12, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(entry, file.read_bytes())

def load_catalog(root=ROOT):
    catalog = json.loads((root/'catalog.json').read_text('utf-8-sig'))
    if catalog['schemaVersion'] != 1 or catalog['minecraftVersion'] != '1.20.6' or catalog['namespace'] != 'qiandengji':
        raise ValueError('Unsupported catalog')
    if not 1 <= len(catalog['items']) <= 64: raise ValueError('Item budget')
    ids, numbers = set(), set()
    import re
    for item in catalog['items']:
        if not re.fullmatch('[a-z][a-z0-9_]{1,47}', item['id']) or item['id'] in ids: raise ValueError('Duplicate/invalid id')
        if not isinstance(item['modelData'], int) or not 700000 <= item['modelData'] < 800000 or item['modelData'] in numbers:
            raise ValueError('Duplicate/invalid model data')
        if item['model'] != f"models/{item['id']}.json": raise ValueError('Unsafe model path')
        if item['baseId'] not in ('minecraft:iron_sword', 'minecraft:crossbow', 'minecraft:blaze_rod'): raise ValueError('Unsupported base item')
        ids.add(item['id']); numbers.add(item['modelData'])
        model = json.loads((root/item['model']).read_text('utf-8-sig'))
        if not 1 <= len(model['palette']) <= 64 or not 1 <= len(model['boxes']) <= 96: raise ValueError('Geometry budget')
        for color in model['palette']:
            if not re.fullmatch('[0-9A-Fa-f]{6}', color): raise ValueError('Invalid palette')
        for box in model['boxes']:
            a,b = box['from'],box['to']
            if len(a)!=3 or len(b)!=3 or not all(isinstance(n,(int,float)) and math.isfinite(n) and -16<=n<=32 for n in a+b) or not all(x<y for x,y in zip(a,b)):
                raise ValueError('Invalid cuboid')
            if not isinstance(box['color'],int) or not 0<=box['color']<len(model['palette']): raise ValueError('Palette index')
    return catalog

def png(image):
    from io import BytesIO
    out=BytesIO(); image.save(out,format='PNG',compress_level=9); return out.getvalue()

def palette_texture(palette):
    image=Image.new('RGBA',(32,32))
    for index,hex_color in enumerate(palette):
        rgb=tuple(bytes.fromhex(hex_color))
        for y in range(4):
            for x in range(4):
                light = [0,4,-4,2][(x+y*3)%4]
                image.putpixel((index%8*4+x,index//8*4+y), tuple(max(0,min(255,v+light)) for v in rgb)+(255,))
    return png(image)

def cuboid_faces(box):
    x,y,z=box['from']; X,Y,Z=box['to']
    return [[(x,y,z),(X,y,z),(X,Y,z),(x,Y,z)],[(X,y,Z),(x,y,Z),(x,Y,Z),(X,Y,Z)],
            [(X,y,z),(X,y,Z),(X,Y,Z),(X,Y,z)],[(x,y,Z),(x,y,z),(x,Y,z),(x,Y,Z)],
            [(x,Y,z),(X,Y,z),(X,Y,Z),(x,Y,Z)],[(x,y,Z),(X,y,Z),(X,y,z),(x,y,z)]]

def icon(model):
    # Orthographic rendering of the very same cuboid faces; not replacement art.
    faces=[]; ay,ax=math.radians(40),math.radians(24)
    def project(p):
        x,y,z=p; x-=8; y-=8; z-=8
        x,z=x*math.cos(ay)+z*math.sin(ay), -x*math.sin(ay)+z*math.cos(ay)
        y,z=y*math.cos(ax)-z*math.sin(ax), y*math.sin(ax)+z*math.cos(ax)
        return (x,-y,z)
    for box in model['boxes']:
        rgb=bytes.fromhex(model['palette'][box['color']])
        for side,verts in enumerate(cuboid_faces(box)):
            points=[project(p) for p in verts]
            shade=[.77,.88,.72,.88,1,.65][side]
            faces.append((sum(p[2] for p in points)/4,points,tuple(round(c*shade) for c in rgb)+(255,)))
    points=[p for _,face,_ in faces for p in face]
    lo=[min(p[n] for p in points) for n in range(2)]; hi=[max(p[n] for p in points) for n in range(2)]
    scale=112/max(hi[0]-lo[0],hi[1]-lo[1]); image=Image.new('RGBA',(128,128)); draw=ImageDraw.Draw(image)
    for _,face,color in sorted(faces,key=lambda f:f[0]):
        draw.polygon([((p[0]-(lo[0]+hi[0])/2)*scale+64,(p[1]-(lo[1]+hi[1])/2)*scale+64) for p in face],fill=color)
    return png(image)

def build(output, catalog_root=ROOT, client_jar=None):
    catalog=load_catalog(catalog_root); output=Path(output)
    if not client_jar or digest(Path(client_jar).read_bytes()) != CLIENT_SHA256:
        raise ValueError('Use the locked official Java 1.20.6 client JAR; crossbow base models must match the server version')
    # Refuse reuse: stale assets must never silently survive a smaller catalog.
    output.mkdir(parents=True,exist_ok=False)
    java=output/'java'; bedrock=output/'bedrock'; web=output/'web'
    source_hash=digest(js(catalog)+b''.join((catalog_root/i['model']).read_bytes() for i in catalog['items']))
    version=catalog['packVersion']
    write(java,'pack.mcmeta',js({'pack':{'pack_format':32,'description':'千灯纪 · 特色武器外观'}}))
    stable_uuid=lambda label:str(uuid.uuid5(uuid.NAMESPACE_URL,'qiandengji:item-appearances:'+label))
    write(bedrock,'manifest.json',js({'format_version':2,'header':{'name':'千灯纪 · 特色武器','description':'原版属性与自定义装备外形','uuid':stable_uuid('header'),'version':version,'min_engine_version':[1,20,60]},'modules':[{'type':'resources','uuid':stable_uuid('resources'),'version':version}]}))
    runtime={'schemaVersion':1,'enabled':True,'catalogSha256':source_hash,'items':catalog['items']}
    write(output,'item-appearances.json',js(runtime))
    mapping={'format_version':2,'items':{}}
    item_texture={'resource_pack_name':'qiandengji_items','texture_name':'atlas.items','texture_data':{}}
    manifest={'schemaVersion':1,'minecraftVersion':'1.20.6','catalogSha256':source_hash,'items':[],'assets':{}}
    base_overrides={}
    with zipfile.ZipFile(client_jar) if client_jar else __import__('contextlib').nullcontext() as jar:
        for item in catalog['items']:
            id=item['id']; model=json.loads((catalog_root/item['model']).read_text('utf-8-sig'))
            elements=[]; cubes=[]
            for box in model['boxes']:
                index=box['color']; u=index%8*2; v=index//8*2; uv=[u+.125,v+.125,u+1.875,v+1.875]
                elements.append({'from':box['from'],'to':box['to'],'faces':{side:{'texture':'#palette','uv':uv} for side in SIDES}})
                cubes.append({'origin':[box['from'][n]-8 for n in range(3)],'size':[box['to'][n]-box['from'][n] for n in range(3)],
                              'uv':{side:{'uv':[uv[0]*2,uv[1]*2],'uv_size':[(uv[2]-uv[0])*2,(uv[3]-uv[1])*2]} for side in SIDES}})
            java_model={'textures':{'palette':f'qiandengji:item/{id}'},'display':DISPLAY,'elements':elements,'gui_light':'front'}
            texture=palette_texture(model['palette']); image=icon(model)
            write(java,f'assets/qiandengji/models/item/{id}.json',js(java_model))
            write(java,f'assets/qiandengji/textures/item/{id}.png',texture)
            for filename,raw in [(f'models/{id}.json',js(java_model)),(f'textures/{id}.png',texture),(f'icons/{id}.png',image)]:
                write(web,filename,raw); manifest['assets'][filename]={'sha256':digest(raw),'bytes':len(raw)}
            manifest['items'].append({k:item[k] for k in ('id','name','baseId','modelData')} | {'model':f'models/{id}.json','texture':f'textures/{id}.png','icon':f'icons/{id}.png'})
            geometry_id='geometry.qiandengji.'+id
            write(bedrock,f'models/entity/{id}.geo.json',js({'format_version':'1.12.0','minecraft:geometry':[{'description':{'identifier':geometry_id,'texture_width':32,'texture_height':32,'visible_bounds_width':3,'visible_bounds_height':3,'visible_bounds_offset':[0,.5,0]},'bones':[{'name':'item','pivot':[0,0,0],'binding':"q.item_slot_to_bone_name(c.item_slot)",'cubes':cubes}]}]}))
            write(bedrock,f'textures/items/{id}.png',image)
            write(bedrock,f'textures/entity/{id}.png',texture)
            attach={'format_version':'1.10.0','minecraft:attachable':{'description':{'identifier':'qiandengji:'+id,'materials':{'default':'entity_alphatest','enchanted':'entity_alphatest_glint'},'textures':{'default':f'textures/entity/{id}','enchanted':'textures/misc/enchanted_item_glint'},'geometry':{'default':geometry_id},'animations':{'first':'animation.qiandengji.item.first','third':'animation.qiandengji.item.third'},'scripts':{'animate':[{'first':'c.is_first_person'},{'third':'!c.is_first_person'}]},'render_controllers':['controller.render.item_default']}}}
            write(bedrock,f'attachables/{id}.json',js(attach))
            item_texture['texture_data']['qiandengji.'+id]={'textures':f'textures/items/{id}'}
            mapping['items'].setdefault(item['baseId'],[]).append({'type':'legacy','custom_model_data':item['modelData'],'bedrock_identifier':'qiandengji:'+id,'display_name':item['name'],'bedrock_options':{'icon':'qiandengji.'+id,'display_handheld':True,'allow_offhand':True}})
            base_overrides.setdefault(item['baseId'],[]).append(item)
        for base,items in base_overrides.items():
            key=base.split(':')[1]
            if jar:
                original=json.loads(jar.read(f'assets/minecraft/models/item/{key}.json'))
            else:
                if key=='crossbow': raise ValueError('Crossbow needs the original 1.20.6 client JAR to preserve vanilla charging models')
                original={'parent':'minecraft:item/handheld','textures':{'layer0':'minecraft:item/'+key}}
            plain={k:v for k,v in original.items() if k!='overrides'}
            write(java,f'assets/qiandengji/models/item/base/{key}.json',js(plain))
            overrides=list(original.get('overrides',[]))
            for item in sorted(items,key=lambda i:i['modelData']):
                overrides.append({'predicate':{'custom_model_data':item['modelData']},'model':'qiandengji:item/'+item['id']})
                overrides.append({'predicate':{'custom_model_data':item['modelData']+1},'model':'qiandengji:item/base/'+key})
            write(java,f'assets/minecraft/models/item/{key}.json',js(plain|{'overrides':overrides}))
    # Bound item bones inherit the real player's swing/use movement. These
    # authored poses do not replace player.entity.json or other packs' rigs.
    write(bedrock,'animations/qiandengji_items.animation.json',js({'format_version':'1.8.0','animations':{
        'animation.qiandengji.item.first':{'loop':True,'bones':{'item':{'rotation':[0,90,-25],'position':[0,-24,0],'scale':.68}}},
        'animation.qiandengji.item.third':{'loop':True,'bones':{'item':{'rotation':[0,90,-55],'position':[0,-24,0],'scale':.85}}}
    }}))
    write(bedrock,'textures/item_texture.json',js(item_texture))
    write(output,'qiandengji-items.geyser.json',js(mapping))
    write(web,'manifest.json',js(manifest))
    archive(java,output/'qiandengji-items-java-1.20.6.zip')
    archive(bedrock,output/'qiandengji-items-bedrock.mcpack')
    hashes={p.relative_to(output).as_posix():digest(p.read_bytes()) for p in sorted(output.rglob('*')) if p.is_file()}
    write(output,'build-manifest.json',js({'schemaVersion':1,'catalogSha256':source_hash,'minecraftVersion':'1.20.6','clientSha256':CLIENT_SHA256,'items':len(catalog['items']),'files':hashes,'javaPixelParityVerified':False,'bedrockPixelParityVerified':False}))
    return manifest

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('output',type=Path); parser.add_argument('--client-jar',type=Path,required=True)
    args=parser.parse_args(); result=build(args.output,client_jar=args.client_jar)
    print(json.dumps({'output':str(args.output),'items':len(result['items']),'catalogSha256':result['catalogSha256']},ensure_ascii=False))
