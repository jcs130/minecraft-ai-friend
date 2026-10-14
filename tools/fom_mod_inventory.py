"""Inventory actual client/server JARs, author-disabled files and release hashes."""
from pathlib import Path
import argparse,collections,hashlib,json,re,tomllib,zipfile

# Classification describes file roles; installation on both ends is reported separately.
GROUPS=[
 ('Agent 客户端组件',r'^(maw-client-bridge|minescript|baritone)', '可选的真实客户端控制、脚本执行与导航；普通玩家不必安装。'),
 ('登录与多人运维',r'^(mixauth|maw-fom-support|open-parties-and-claims|SimpleBackups|e4mc|mcwifipnp)', '登录、领地、备份或多人连接工具。'),
 ('航空与移动物理',r'^(create-aeronautics|sable-neoforge|aeroengine|aeroworks|azimuth|struts|cosmonautics|createpropulsion|create_radar)', '航空学、移动结构物理、推进器及航空扩展。'),
 ('铁路、船舶与火炮',r'^(railways|createrailwaysnavigator|tracks-|bellsandwhistles|interiors|create_submarine|submarinefix|createbigcannons)', '铁路、列车信息、船舶或火炮相关内容。'),
 ('仓储与物流',r'^(sophisticatedbackpacks|functionalstorage|toms_storage|cmpackagecouriers|createendertransmission)', '背包、仓库、存储或包裹物流。'),
 ('机械动力与生产',r'^(create|copycats|petrolsparts|bits_n_bobs)', '机械动力本体、生产、配方、控制或构件扩展。'),
 ('探索、建筑与生活',r'^(NaturesCompass|ExplorersCompass|waystones|effortless|VanillaBackport|gravestone|vein_vantage)', '群系/结构导航、传送、建造、原版内容回移或死亡保管。'),
 ('性能与诊断',r'^(ferritecore|lithium|modernfix|spark|packetfixer|sodium|ImmediatelyFast|entityculling|Ixeris|c2me|noisium|flerovium)', '内存、逻辑、渲染、区块优化或性能诊断；具体侧别见安装列。'),
 ('画面、声音与摄影',r'^(iris|BetterThirdPerson|entity_model_features|entity_texture_features|freecam|reforgedplaymod|sablereforgedplay|sounds|zume|watut|seamless-loading-screen)', '客户端画面、声音、第三人称、摄影或录制兼容。'),
 ('配方、地图与操作界面',r'^(appleskin|extra-mod-integrations|reeses-sodium-options|emi|jei|jecharacters|Jade|InventoryProfilesNext|MouseTweaks|Controlling|xaero|fancymenu|Resourcify|tia-)', '配方、物品信息、地图、菜单或操作便利功能。'),
]
NOTES={
 'create-1.21.1-':'机械动力本体：旋转动力、加工机器、传送带和自动化。',
 'create-aeronautics-':'机械动力航空学；移动结构物理由 Sable 提供。',
 'sable-neoforge':'移动方块结构的物理与同步基础；本次公网发布使用官方 TCP 回退。',
 'createbigcannons':'机械动力：大炮，包含火炮结构及弹药。',
 'railways-':'机械动力铁路扩展 Steam n Rails。',
 'createrailwaysnavigator':'列车导航、时刻和信息显示。',
 'sophisticatedbackpacks':'精妙背包及其升级系统。',
 'functionalstorage':'抽屉式仓储与存储升级。',
 'toms_storage':'仓储终端和容器连接。',
 'waystones':'传送石碑与传送网络。',
 'NaturesCompass':'自然罗盘，用于寻找群系。',
 'ExplorersCompass':'探索者罗盘，用于寻找结构。',
 'open-parties-and-claims':'队伍、领地与强制加载管理；需遵守服务器权限。',
 'SimpleBackups':'服务端自动存档备份；另有发布前冷备份。',
 'mixauth':'服务端混合认证：正版会话验证及离线账号密码。',
 'maw-fom-support':'服务端复用现役首次访客、设密和认证查询规则；不包含旧 RPG 内容。',
 'maw-client-bridge':'可选的真实客户端状态、输入、原生 GUI 和画面桥。',
 'minescript':'可选的客户端 Python 脚本执行。',
 'baritone':'可选的客户端寻路、采矿和跟随执行工具。',
 'ferritecore':'降低内存占用。',
 'modernfix':'加载、内存及部分运行时优化。',
 'lithium':'游戏逻辑优化；保留已记录的单方法 JVM 编译规避。',
 'spark':'性能分析与 TPS/MSPT 诊断。',
 'copycats':'机械动力仿制构件与形状扩展。',
 'vein_vantage':'为挖矿工具增加独特附魔；具体效果和配方以原生界面为准。',
 'appleskin':'食物、饥饿和饱和度 HUD 信息。',
 'sodium-neoforge':'客户端渲染优化；不放入专用服务端。',
 'iris-neoforge':'客户端光影支持。',
 'reforgedplaymod':'客户端录制工具；专用服务端分离此 JAR，保留客户端原件。',
 'sablereforgedplay':'Sable 与录制系统的兼容组件。',
 'freecam':'客户端自由摄影视角工具。',
 'sounds-':'环境/操作音效扩展，不是实时语音聊天。',
 'e4mc':'客户端局域网世界穿透；本专用公网服无需使用。',
 'VanillaBackport':'把后续原版内容回移到 1.21.1，具体内容以该版本实际物品/配方为准。',
}

def metadata(file):
    with zipfile.ZipFile(file) as jar:
        target=next((n for n in ('META-INF/neoforge.mods.toml','META-INF/mods.toml') if n in jar.namelist()),None)
        if not target:return {'ids':[],'names':[],'versions':[],'description':''}
        doc=tomllib.loads(jar.read(target).decode('utf-8'));mods=doc.get('mods',[])
        manifest=jar.read('META-INF/MANIFEST.MF').decode('utf-8',errors='replace') if 'META-INF/MANIFEST.MF' in jar.namelist() else ''
        version=re.search(r'^Implementation-Version:\s*(.+)$',manifest,re.M)
        def resolve(value):
            return str(value).replace('${file.jarVersion}',version.group(1).strip() if version else '版本见文件名')
        return {'ids':[m.get('modId','') for m in mods],'names':[m.get('displayName',m.get('modId','')) for m in mods],
            'versions':[resolve(m.get('version','unknown')) for m in mods],'description':' / '.join(str(m.get('description','')).strip()[:300] for m in mods),
            'license':doc.get('license','unknown')}

def inventory(client,server,index,output):
    client,server,output=Path(client),Path(server),Path(output)
    authored=json.loads(Path(index).read_bytes());sources={Path(row['path']).name:row for row in authored['files'] if row['path'].startswith('mods/')}
    names=sorted({p.name for p in (client/'mods').iterdir() if p.name.endswith(('.jar','.jar.disabled'))}|{p.name for p in (server/'mods').glob('*.jar')},key=str.casefold)
    rows=[]
    for name in names:
        cp=client/'mods'/name;sp=server/'mods'/name;path=cp if cp.is_file() else sp
        data=metadata(path);category='基础库与兼容依赖';purpose='模组依赖或兼容基础；保留作者所选版本。'
        for label,pattern,note in GROUPS:
            if re.search(pattern,name,re.I):category,purpose=label,note;break
        for prefix,note in NOTES.items():
            if name.casefold().startswith(prefix.casefold()):purpose=note;break
        row={'file':name,**data,'category':category,'purpose':purpose,'clientInstalled':cp.is_file(),'serverInstalled':sp.is_file(),
            'enabled':name.endswith('.jar'),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'authorEnvironment':sources.get(name,{}).get('env'),
            'sourceDownloads':sources.get(name,{}).get('downloads',[])}
        if cp.is_file() and sp.is_file() and hashlib.sha256(sp.read_bytes()).hexdigest()!=row['sha256']:raise ValueError('Different client/server bytes: '+name)
        rows.append(row)
    counts={'clientEnabled':sum(r['clientInstalled'] and r['enabled'] for r in rows),'serverEnabled':sum(r['serverInstalled'] and r['enabled'] for r in rows),
            'authorDisabled':sum(not r['enabled'] for r in rows),'agentOptional':sum(r['category']=='Agent 客户端组件' and r['enabled'] for r in rows)}
    report={'schemaVersion':1,'pack':'FOM 2.42','minecraft':'1.21.1','neoforge':'21.1.248','counts':counts,
        'jarCountIsNotLoadedModCount':True,'disabledReasonKnown':False,'allModGameplayVerified':False,'rows':rows}
    output.mkdir(parents=True,exist_ok=True)
    (output/'mods-index.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    parts=['命运齿轮 FOM 2.42 · 模组分类清单（实际文件核对）',
        'Minecraft 1.21.1 / NeoForge 21.1.248 / Java 21。',
        f"客户端启用 {counts['clientEnabled']} 个 JAR，服务端启用 {counts['serverEnabled']} 个 JAR，作者禁用 {counts['authorDisabled']} 个文件。",
        f"Agent 客户端组件 {counts['agentOptional']} 个为可选；普通玩家使用作者客户端整包即可。",
        'JAR 数不等于加载器显示的模组数，部分 JAR 内嵌多个模组或依赖。',
        '下方“客户端/服务端”表示实际放置位置，不等于所有功能已逐项验收。分类按模组名称、元数据及用途整理。','']
    for category in [g[0] for g in GROUPS]+['基础库与兼容依赖']:
        subset=[r for r in rows if r['category']==category and r['enabled']]
        if not subset:continue
        parts.append(category+'（'+str(len(subset))+'）')
        for r in subset:
            sides='/'.join(s for s,present in [('客户端',r['clientInstalled']),('服务端',r['serverInstalled'])] if present)
            parts.append(f"- {' / '.join(r['names']) or r['file']} | {' / '.join(r['versions'])} | {sides}\n  {r['purpose']}\n  文件：{r['file']}")
        parts.append('')
    parts+=['作者禁用文件（继续禁用）']
    parts += ['- '+r['file'] for r in rows if not r['enabled']]
    parts+=['作者未逐项注明禁用原因；不把禁用文件擅自恢复为启用，也不据此断言它们均有冲突。','',
        '功能范围','本包重点是机械自动化、航空、铁路/船舶和仓储。旧千灯纪的 /mycli 技能、公会、试炼、女仆和殖民地不是本整合包自带内容。',
        '多人使用统一版本整包。不要单独升级 Sable、航空学或 Create；按完整版本测试升级。',
        '本次切换保留原包的玩法模组，没有将新物品/方块翻译为原版近似物。',
        '性能优化来自原包已有 ModernFix、FerriteCore、Lithium、spark 等；尚未做负载对照，不能据此宣称提升百分比。',
        '实时 Java 距离语音不在原包中，sounds 是音效扩展。基岩转换和普通 Mineflayer 直接操作整包尚未发布。']
    (output/'模组说明.txt').write_text('\n'.join(parts)+'\n',encoding='utf-8-sig')
    difference=['命运齿轮 · 客户端和服务端文件差异','']
    for label,predicate in [('仅客户端启用',lambda r:r['enabled'] and r['clientInstalled'] and not r['serverInstalled']),
                            ('仅服务端启用',lambda r:r['enabled'] and r['serverInstalled'] and not r['clientInstalled'])]:
        difference.append(label)
        difference += ['- '+r['file'] for r in rows if predicate(r)];difference.append('')
    difference+=['服务端不渲染画面；Sodium、Iris、实体材质等客户端组件不能作为服务端性能优化安装。',
                 'MixAuth 与 FOM Server Support 只放服务端；Minescript、Baritone、客户端桥只放 Agent 的真实客户端。',
                 '作者客户端录制 JAR 留在客户端，服务端保留 Sable 录制兼容组件。']
    (output/'客户端服务端差异.txt').write_text('\n'.join(difference)+'\n',encoding='utf-8-sig')
    return counts

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ('client','server','index','output'):parser.add_argument('--'+key,type=Path,required=True)
    a=parser.parse_args();print(json.dumps(inventory(a.client,a.server,a.index,a.output),ensure_ascii=False))
