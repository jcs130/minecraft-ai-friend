"""Optional Wandscape 2.1.3 original ModelPart/PNG to Bedrock display pack.

Only the locked wizard NPC is supported. AI, UUIDs and gameplay stay native;
custom head/held item, tourist and spell renderer parity are not claimed.
"""
from pathlib import Path
import json, math, uuid, copy
from maw_bedrock_resources import encoded, sha
from maw_bedrock_animations import adapt

SHA='b9ff4debb039f1fbcac006fd8b53d306e49f8042611b9eb385f292f8c75f0788'
RECIPE=Path(__file__).resolve().parents[1]/'world/compat/wandscape/model-parts.json'

def geometry(definition, identifier):
    """Invert the shared native Bedrock ModelPart coordinate conversion."""
    absolute={};bones=[]
    for part in definition['parts']:
        parent=part.get('parent');base=absolute[parent] if parent else [0,0,0]
        pivot=[base[i]+part['pivot'][i] for i in range(3)];absolute[part['name']]=pivot
        bone={'name':part['name'],'pivot':[pivot[0],24-pivot[1],pivot[2]],'cubes':[]}
        if parent:bone['parent']=parent
        if any(part.get('rotation',[])):bone['rotation']=[r*180/math.pi for r in part['rotation']]
        for c in part['cubes']:
            x,y,z=c['origin'];dx,dy,dz=c['size']
            cube={'origin':[pivot[0]+x,24-pivot[1]-y-dy,pivot[2]+z],'size':c['size'],'uv':c['uv'],'inflate':c.get('dilation',0)}
            if c.get('mirror'):cube['mirror']=True
            bone['cubes'].append(cube)
        bones.append(bone)
    return {'format_version':'1.12.0','minecraft:geometry':[{'description':{'identifier':identifier,'texture_width':64,'texture_height':64,'visible_bounds_width':3,'visible_bounds_height':4,'visible_bounds_offset':[0,1.5,0]},'bones':bones}]}

def extend(assets, entries, rows):
    if not any(s['sha256']==SHA and not s.get('explicitOverride') for s in assets.manifest.get('sources',[])):return None
    raw=RECIPE.read_bytes();recipe=json.loads(raw)
    if recipe['sourceJarSha256']!=SHA:raise ValueError('Wandscape geometry recipe version mismatch')
    content={};entries['wandscape']=content
    definitions={}
    for layer,parts in recipe['layers'].items():
        ident='geometry.maw_wandscape.'+layer
        geo=geometry(parts,ident);key='models/entity/maw/wandscape_'+layer+'.geo.json'
        content[key]=encoded(geo);definitions[layer]=(ident,key)
    textures=sorted(k for k in assets.manifest['assets'] if k.startswith('assets/wandscape/textures/entity/wizard/') and k.endswith('.png'))
    hatkey='assets/wandscape/textures/entity/wizard_hat.png';hat=assets.read(hatkey)
    hatpath='textures/entity/maw/'+sha(hat)[:32];content[hatpath+'.png']=hat
    controllers={}
    for layer in ['body','edge','tint']:
        controller={'geometry':'Geometry.'+('default' if layer=='body' else layer),'materials':[{'*':'Material.default'}],'textures':['Texture.'+('default' if layer=='body' else 'wizard_hat')]}
        if layer=='tint':controller['color']={channel:expr for channel,expr in zip(['r','g','b','a'],['math.mod(math.floor(query.mark_variant / 65536),256)/255','math.mod(math.floor(query.mark_variant / 256),256)/255','math.mod(query.mark_variant,256)/255','1.0'])}
        controllers['controller.render.maw_wandscape_'+layer]=controller
    content['render_controllers/wandscape.json']=encoded({'format_version':'1.8.0','render_controllers':controllers})
    for index,key in enumerate(textures):
        png=assets.read(key);texturepath='textures/entity/maw/'+sha(png)[:32];content[texturepath+'.png']=png
        fingerprint=sha(encoded(['wandscape',index]))[:24];identifier='maw_native:wandscape_'+fingerprint
        animation=adapt([p['name'] for p in recipe['layers']['body']['parts']],fingerprint,roots=[p['name'] for p in recipe['layers']['body']['parts'] if not p.get('parent')])
        # HumanoidModel.setupAnim copies the head ModelPart onto the base hat.
        # The extra wizard hat layers already share the animated head bone.
        for clip in animation['clips'].values():
            if 'head' in clip.get('bones',{}):clip['bones']['hat']=copy.deepcopy(clip['bones']['head'])
        animationfile='animations/maw/'+fingerprint+'.json';controllerfile='animation_controllers/maw/'+fingerprint+'.json'
        content[animationfile]=encoded({'format_version':'1.8.0','animations':animation['clips']});content[controllerfile]=encoded({'format_version':'1.10.0','animation_controllers':animation['controller']})
        content['entity/maw/'+fingerprint+'.entity.json']=encoded({'format_version':'1.10.0','minecraft:client_entity':{'description':{
            'identifier':identifier,'materials':{'default':'entity_alphatest'},'textures':{'default':texturepath,'wizard_hat':hatpath},
            'geometry':{'default':definitions['body'][0],'edge':definitions['edge'][0],'tint':definitions['tint'][0]},
            'render_controllers':['controller.render.maw_wandscape_'+s for s in ['body','edge','tint']],**animation['descriptor']}}})
        rows.append({'kind':'wandscape','modelId':'wizard_'+str(index),'textureId':key,'bedrockIdentifier':identifier,'pack':'maw-wandscape-models.mcpack',
            'geometry':definitions['body'][1],'texture':texturepath+'.png','geometryIdentifier':definitions['body'][0],'scale':1.0,
            'sourceDefinition':'world/compat/wandscape/model-parts.json','sourceModel':'WizardHatModel.createLayer + PlayerModel.createMesh',
            'sourceTexture':key,'sourcePngSha256':sha(png),'sourceGeometryRecipeSha256':sha(raw),'sourceJarSha256':SHA,'metadata':{'skinVariant':index},
            'animations':animation['ids'],'animationFile':animationfile,'controllerFile':controllerfile,'nativeClips':animation['nativeClips'],
            'unsupportedNativeClips':animation['unsupportedNativeClips'],'movingAnimationAvailable':animation['moving'],'sourceAnimation':None,
            'javaAnimationControllersAdapted':False,'animationClockParityVerified':False,'playerSkinEligible':False})
    content['credits/wandscape.json']=encoded({'license':'MIT','source':'https://github.com/CheesePaste/Wandscape','commit':recipe['sourceCommit'],'jarSha256':SHA,'recipeSha256':sha(raw)})
    content['credits/Wandscape-LICENSE.txt']=(RECIPE.parent/'LICENSE').read_bytes()
    return {'version':'2.1.3-1211','jarSha256':SHA,'entity':'wandscape:wandscape_npc','skinVariant':16,'hatColor':17,'casting':18,'status':20,'castSpellId':21,'skinCount':len(textures),'hatColorCarrier':'query.mark_variant','javaDisplayCarrier':'minecraft:iron_golem','completeRendererParityVerified':False}
