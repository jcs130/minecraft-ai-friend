"""Append reviewed public YSM bundles to the existing native maid pack, offline only."""
import argparse,base64,copy,hashlib,json,zipfile
from pathlib import Path

def key(model,texture):
    enc=lambda s:base64.urlsafe_b64encode(s.encode()).decode().rstrip('=')
    return 'ysm:'+enc(model)+':'+enc(texture)

def build(base,export,output):
    if output.exists():raise ValueError('Fresh output required')
    if hashlib.sha256(base.read_bytes()).hexdigest()!='8294b170fa8484ad726e40c4576093a64936e87c6e0d791d3e6f37bed264bb08':raise ValueError('Review changed native maid pack')
    models=json.loads(export.read_text(encoding='utf-8'))
    with zipfile.ZipFile(base) as jar:files={n:jar.read(n) for n in jar.namelist()}
    js=lambda value:(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n').encode()
    mapping=json.loads(files['mapping.json']);rows=mapping['models'];original_count=len(rows)
    if original_count!=204:raise ValueError('Review changed original maid catalog')
    client=json.loads(files['entity/maid.entity.json']);d=client['minecraft:client_entity']['description']
    render=json.loads(files['render_controllers/maid.render_controllers.json'])
    original=render['render_controllers']['controller.render.qiandengji.maid']
    # A runtime switch to an unsupported model also remains an allay, never a magenta box.
    d['geometry']['m0']='geometry.allay';d['textures']['t0']='textures/entity/allay/allay'
    native=f"query.property('qiandengji:model') <= {original_count}"
    d['render_controllers']=[{'controller.render.qiandengji.maid':native}]
    d['scripts']['animate']=[{'pose':native}]
    d['animations']['allay_idle']='animation.allay.idle'
    d['scripts']['animate'].append({'allay_idle':"query.property('qiandengji:model') == 0"})
    merged={};attribution={};selected=[]
    prop=lambda n:"query.property('qiandengji:"+n+"')"
    for model in models['models']:
        if len(selected)>=32:raise ValueError('YSM model budget')
        index=len(selected);prefix=f'qdmaid_ysm_{index}';active='variable.'+prefix+'_active'
        geo=copy.deepcopy(model['geometry']);geometry_id=geo['minecraft:geometry'][0]['description']['identifier']
        clips=copy.deepcopy(model['animations']);clips['__qd_scale']={'loop':True,'bones':{'qdysm_scale_root':{'scale':[model['widthScale'],model['heightScale'],model['widthScale']]}}}
        files[f'models/entity/{prefix}.geo.json']=js(geo)
        slots=[]
        for texture,png64 in model['textures'].items():
            if len(rows)>=332:raise ValueError('YSM texture budget')
            png=base64.b64decode(png64,validate=True)
            if not png.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('PNG required')
            slot=len(rows)+1;alias=f'y{slot}';path=f'textures/entity/qiandengji/{prefix}_{slot}'
            files[path+'.png']=png;d['geometry'][alias]=geometry_id;d['textures'][alias]=path
            ctl='controller.render.qiandengji.'+alias
            render['render_controllers'][ctl]={'geometry':'Geometry.'+alias,'materials':[{'*':'Material.default'}],'textures':['Texture.'+alias]}
            d['render_controllers'].append({ctl:prop('model')+f' == {slot}'})
            row={'modelId':key(model['modelId'],texture),'index':slot,'scale':1,'sourceModelId':model['modelId'],'textureName':texture,'sourceSha256':model['sourceSha256'],'geometry':f'models/entity/{prefix}.geo.json','texture':path+'.png','textureSha256':hashlib.sha256(png).hexdigest(),'kind':'ysm'}
            rows.append(row);slots.append(slot)
        d['scripts'].setdefault('pre_animation',[]).append(active+' = ('+' || '.join(prop('model')+f' == {s}' for s in slots)+');')
        aliases={name:prefix+'_a'+hashlib.sha256(name.encode()).hexdigest()[:16] for name in clips}
        for name,clip in clips.items():
            aid='animation.qiandengji.'+aliases[name];merged[aid]=clip;d['animations'][aliases[name]]=aid
        # Shared native movement facts drive source YSM clips. Extras/controllers are not invented.
        conditions={'sleep':prop('sleeping'),'ride':prop('sitting'),'run':prop('speed')+' > 0.4','walk':prop('speed')+' > 0.01','idle':'1'}
        prior='0'
        for name,when in conditions.items():
            if name not in clips:continue
            d['scripts']['animate'].append({aliases[name]:active+' && ('+when+') && !('+prior+')'})
            prior+=' || ('+when+')'
        for name in ['__qd_scale','head:default','pre_parallel0','pre_parallel1','pre_parallel2','parallel2','parallel3','parallel4']:
            if name in clips:d['scripts']['animate'].append({aliases[name]:active})
        if 'swing_hand' in clips:d['scripts']['animate'].append({aliases['swing_hand']:active+' && '+prop('attack')+' > 0'})
        attribution[model['modelId']]=model['metadata'];selected.append(model['modelId'])
    files['entity/maid.entity.json']=js(client);files['render_controllers/maid.render_controllers.json']=js(render)
    files['animations/maid_ysm.animation.json']=js({'format_version':'1.8.0','animations':merged})
    files['attribution/ysm.json']=js(attribution)
    manifest=json.loads(files['manifest.json']);manifest['header']['version']=[0,1,5];manifest['modules'][0]['version']=[0,1,5]
    manifest['header']['name']='千灯纪女仆 · 原生与YSM外观';files['manifest.json']=js(manifest)
    mapping.update(version='0.1.5',fallback='minecraft:allay',ysmModels=selected,ysmRejected=models['rejected'],fullAnimationParity=False)
    files['mapping.json']=js(mapping)
    if sum(len(v) for v in files.values())>64*1024*1024:raise ValueError('Resource bytes budget')
    output.mkdir(parents=True)
    pack=output/'maid.mcpack'
    with zipfile.ZipFile(pack,'w',zipfile.ZIP_DEFLATED) as z:
        for name,data in sorted(files.items()):
            info=zipfile.ZipInfo(name,(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;z.writestr(info,data)
    (output/'maid-models.tsv').write_bytes((''.join(f"{r['modelId']}\t{r['index']}\t{r['scale']}\n" for r in rows)).encode())
    report={'nativeModels':original_count,'ysmModels':len(selected),'ysmTextures':len(rows)-original_count,'rejected':models['rejected'],'sha256':hashlib.sha256(pack.read_bytes()).hexdigest(),'bytes':pack.stat().st_size,'productionChanged':False}
    (output/'build.json').write_bytes(js(report));print(json.dumps(report))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--base',type=Path,required=True);p.add_argument('--export',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();build(a.base,a.export,a.output)
