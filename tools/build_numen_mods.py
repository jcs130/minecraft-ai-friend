"""Build optional Numen gameplay modules from shared native handlers, without installing them."""
from pathlib import Path
import argparse,importlib.util,json,os,re,subprocess,tempfile,zipfile
from society_lab import REPO,DEFAULT_JAVA,sha256
from build_society_bridge import NUMEN_NAME,NUMEN_SHA,API_SHA,add_bytes

NAME='maw_numen_mods-0.1.0.jar'
SOURCE=REPO/'world/numen-mods-src/src/main'
SHARED=REPO/'world/society-bridge-src/src/main'
PACKAGE='dev.qiandeng.maw.numenmods'
COLONY_FILES=('PlayerColonyBridge.java','ColonyManagement.java','ColonyActionReplay.java','ColonyConstructionRules.java','ColonyResourcePage.java','ModRequest.java','DomumCutterBridge.java','DomumCutterRules.java','TlmMinecoloniesBurningCompat.java')

def method(text,name):
    """Extract a top-level static method; braces in strings/comments are not Java blocks."""
    match=re.search(r'^    (?:(?:public|private|protected) )?static [^\n;{}=]*?\b'+re.escape(name)+r'\(',text,re.M)
    if not match:raise ValueError('Shared method missing: '+name)
    start=match.start();at=text.index('{',match.end());depth=0;mode='code';i=at
    while i<len(text):
        char=text[i];pair=text[i:i+2]
        if mode in ('string','char'):
            if char=='\\':i+=2;continue
            if char==('"' if mode=='string' else "'"):mode='code'
        elif mode=='line':
            if char=='\n':mode='code'
        elif mode=='comment':
            if pair=='*/':mode='code';i+=2;continue
        elif pair=='//':mode='line';i+=2;continue
        elif pair=='/*':mode='comment';i+=2;continue
        elif char=='"':mode='string'
        elif char=="'":mode='char'
        elif char=='{':depth+=1
        elif char=='}':
            depth-=1
            if depth==0:return text[start:i+1]
        i+=1
    raise ValueError('Unbalanced shared method: '+name)

def contracts():
    old=json.loads((SHARED/'resources/maw-native-operations.json').read_bytes());rows=[]
    selected=lambda id:id.startswith(('colony.','domum.','create.','curios.')) or id in ('menu.snapshot','menu.close','menu.button','menu.nativeClick')
    for source in old['operations']:
        if not selected(source['id']):continue
        row=json.loads(json.dumps(source));id=row['id'];row.pop('invocation',None)
        if id.startswith('menu.') and not row['readOnly']:
            row['parameters']['properties']['expectedControlHash']={'type':'string','pattern':'^[0-9a-f]{64}$'}
        if id.startswith(('colony.','domum.','create.','curios.')):
            row['requiredMod']={'colony':'minecolonies','domum':'domum_ornamentum','create':'create','curios':'curios'}[id.split('.')[0]]
        row['route']='machine' if row['route']=='mod' else 'menu' if row['route']=='control' else row['route'];rows.append(row)
    empty={'type':'object','properties':{},'required':[],'additionalProperties':False}
    def spec(id,read,desc,props=None,required=(),mod=None):
        shape={**empty,'properties':props or {},'required':list(required)}
        r={'id':id,'readOnly':read,'description':desc,'parameters':shape,'route':id.split('.')[0],'kind':id,'defaults':{}}
        if mod:r['requiredMod']=mod
        rows.append(r)
    spec('mods.list',True,'分页读取实际加载模组、专用接口与玩法路径；不把依赖库伪称玩法。',{'offset':{'type':'integer','minimum':0,'maximum':10000},'limit':{'type':'integer','minimum':1,'maximum':24}})
    spec('mods.explain',True,'查询一个模组的实际可用能力与未验收边界；未安装会明确返回。',{'modId':{'type':'string','pattern':'^[a-z][a-z0-9_]{0,127}$'}},('modId',))
    for action in ('list','status','cancel'):spec('iron.'+action,action!='cancel','本人 Iron 原生法术 '+action+'；实际魔力、装备、冷却及施法状态。',mod='irons_spellbooks')
    spec('iron.cast',False,'从实际装备的书或手持卷轴发起原生施法；消耗与目标检查由模组处理，accepted 不冒充效果已命中。',{'spellId':{'type':'string','pattern':'^[a-z0-9_.-]+:[a-z0-9_./-]+$','maxLength':256}},('spellId',),mod='irons_spellbooks')
    rows.sort(key=lambda r:r['id']);assert len({r['id'] for r in rows})==len(rows)
    return {'schemaVersion':1,'source':'owned_numen_native_mod_extensions','operationCount':len(rows),'operations':rows}

def generated():
    """Keep shared colony/casting implementations single-sourced and record the complete provenance."""
    source_files=[];result={}
    for name in COLONY_FILES:
        p=SHARED/'java/dev/qiandeng/maw'/name;source_files.append(p)
        text=p.read_text('utf-8');assert text.count('package dev.qiandeng.maw;')==1
        result[name]=text.replace('package dev.qiandeng.maw;','package '+PACKAGE+';',1)
    p=SHARED/'java/dev/qiandeng/maw/NativeModAccess.java';source_files.append(p);text=p.read_text('utf-8')
    validation=text[text.index('    private static boolean valid('):text.rindex('}')]
    result['SchemaValidation.java']='package '+PACKAGE+';\nimport com.google.gson.*;\nimport java.util.*;\nfinal class SchemaValidation {\n'+validation.replace('private static void validate(','static void validate(',1)+'}\n'
    p=SHARED/'java/dev/qiandeng/maw/ModOperationsBridge.java';source_files.append(p);text=p.read_text('utf-8')
    imports=text[text.index('import '):text.index('/** Only allowlisted')]
    helpers='\n'.join(method(text,n) for n in ('base','visible','machine','behaviour','setting','settings','curios','property'))
    guard='''            var colony = com.minecolonies.api.colony.IColonyManager.getInstance().getColonyByPosFromWorld(player.level(), p);
            if (colony != null && !colony.getPermissions().hasPermission(player, com.minecolonies.api.colony.permissions.Action.ACCESS_HUTS)) ModRequest.fail("colony_machine_access_denied");'''
    assert helpers.count(guard)==1;helpers=helpers.replace(guard,'            WorldPermissions.check(player,p);')
    start=text.index('} else if (kind.startsWith("create_")) {');end=text.index('\n        } catch (ModRequest.Invalid',start)
    branches=text[start:end].replace('} else if (kind.startsWith("create_")) {','if (kind.startsWith("create_")) {',1)
    invoke='''
    static JsonObject invoke(ServerPlayer player,JsonObject input,boolean mutation) {
        String id=input.get("requestId").getAsString(),kind=input.get("kind").getAsString();
        JsonObject result=base(player,id,kind);boolean started=false;
        try { %s
        }catch(ModRequest.Invalid e){result.addProperty("ok",false);result.addProperty("code",e.getMessage());}
        catch(RuntimeException e){result.addProperty("ok",false);result.addProperty("code",started?"mod_operation_outcome_unknown":"invalid_mod_request");result.addProperty("outcomeKnown",!started);}
        return result;
    }
'''%branches
    result['MachineNative.java']='package '+PACKAGE+';\n'+imports+'\nfinal class MachineNative {\n'+helpers+invoke+'}\n'
    p=REPO/'world/irons-bridge-src/src/dev/qiandeng/irons/QiandengIronsBridge.java';source_files.append(p);text=p.read_text('utf-8')
    imports=text[text.index('import '):text.index('/** Server-only')]
    body=text[text.index('    public static JsonObject describe('):text.index('    private static JsonObject openMenu(')]
    body=body.replace(method(text,'progression'),'');body=method(text,'response')+'\n'+body
    result['IronsBody.java']='package '+PACKAGE+';\n'+imports+'\nfinal class IronsBody {\nprivate static final int MAX_LIST=256;\n'+body+'\nstatic final class BridgeFailure extends RuntimeException {final String code;BridgeFailure(String c,String m){super(m);code=c;}}\n}\n'
    return result,source_files

def build(root,java=DEFAULT_JAVA):
    root=Path(root).resolve();mods=root/'server/mods';core=mods/NUMEN_NAME
    if sha256(core)!=NUMEN_SHA:raise ValueError('Pinned official Numen required')
    out=root/'build/numen-mods';out.mkdir(parents=True,exist_ok=True);api=out/'numen_api.jar'
    with zipfile.ZipFile(core) as z:
        keys=[n for n in z.namelist() if n.startswith('META-INF/jarjar/') and 'numen_api' in n and n.endswith('.jar')];assert len(keys)==1;api.write_bytes(z.read(keys[0]))
    if sha256(api)!=API_SHA:raise ValueError('Pinned embedded API differs')
    generated_files,shared=generated();own=sorted((SOURCE/'java').rglob('*.java'));resource=SOURCE/'resources/META-INF/neoforge.mods.toml'
    spec=importlib.util.spec_from_file_location('numen_mods_cp',REPO/'world/botgate-src/build.py');helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    cp=[helper.full_cp(root/'server/libraries'),str(api),*[str(p) for p in sorted(mods.glob('*.jar'))]]
    # Optional modules are compiled against pinned local targets even for a minimal QA host.
    for p in sorted(Path('E:/QiandengJiSocietyLab/server/mods').glob('*.jar')):
        if any(x in p.name for x in ('minecolonies-','structurize-','blockui-','domum-ornamentum-')) and not (mods/p.name).exists():cp.append(str(p))
    embedded=out/'embedded';embedded.mkdir(exist_ok=True)
    for jar in (mods/'create-1.21.1-6.0.10.jar',):
        with zipfile.ZipFile(jar) as z:
            for n in z.namelist():
                if n.startswith('META-INF/jarjar/') and n.endswith('.jar'):
                    p=embedded/Path(n).name;p.write_bytes(z.read(n));cp.append(str(p))
    contract=contracts()
    with tempfile.TemporaryDirectory(prefix='compile-',dir=out) as temp:
        work=Path(temp);derived=work/'src';derived.mkdir();classes=work/'classes';classes.mkdir()
        sources=list(own)
        for name,content in generated_files.items():p=derived/name;p.write_text(content,encoding='utf-8');sources.append(p)
        quote=lambda s:'"'+str(s).replace('\\','/')+'"'
        args=work/'javac.args';args.write_text('\n'.join(['-proc:none','--release','21','-encoding','UTF-8','-cp',quote(os.pathsep.join(cp)),'-d',quote(classes),*[quote(p) for p in sources]]),encoding='utf-8')
        run=subprocess.run([str(Path(java).with_name('javac.exe')),'-J-Duser.language=en','@'+str(args)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180)
        if run.returncode:raise RuntimeError(run.stderr[-15000:])
        artifact=out/NAME
        with zipfile.ZipFile(artifact,'w') as z:
            add_bytes(z,'META-INF/neoforge.mods.toml',resource.read_bytes());add_bytes(z,'maw-numen-mod-operations.json',json.dumps(contract,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
            for p in sorted(classes.rglob('*.class')):add_bytes(z,p.relative_to(classes).as_posix(),p.read_bytes())
        with zipfile.ZipFile(artifact) as z:assert z.testzip() is None
    source_files=sorted(set([*own,*shared,resource,Path(__file__),SHARED/'resources/maw-native-operations.json']))
    rec={'schemaVersion':1,'jar':str(artifact),'sha256':sha256(artifact),'numenSha256':NUMEN_SHA,'apiSha256':API_SHA,'operations':contract['operationCount'],
         'clientRequired':False,'oldLoginOrRpgEntryPointsIncluded':False,'sourceFiles':{p.relative_to(REPO).as_posix():sha256(p) for p in source_files}}
    (out/'build-record.json').write_text(json.dumps(rec,indent=2)+'\n',encoding='utf-8');return rec

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,required=True);p.add_argument('--java',type=Path,default=DEFAULT_JAVA)
    a=p.parse_args();print(json.dumps(build(a.root,a.java)))
