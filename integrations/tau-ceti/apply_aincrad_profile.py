"""Apply an explicit map profile to a new, stopped Tau candidate; never to Paper."""
from pathlib import Path
import json, shutil


def apply(server):
    server=Path(server).resolve()
    if server!=Path('E:/MC/servers/tau-ceti-1.3.3/server').resolve():raise ValueError('Exact new Tau candidate only')
    scripts=server/'kubejs/server_scripts/tauceti'
    changes={
        'aaworld.js':[("const TC_WORLD_SEED = '2119110022'","const TC_WORLD_SEED = '27594263'")],
        'spawn.js':[
            ('{ x: 24, y: 113, z: 72 }','{ x: -583, y: 69, z: 934 }'),
            ('{ x: 138, y: 104, z: 62 }','{ x: -583, y: 69, z: 934 }'),
            ('Welcome to Tau Ceti. Behold Olympus across the water — /spawnolympus when you are ready.','欢迎来到艾恩葛朗特第一层。/mycli help 查看探索与资源世界入口。')],
        'tower.js':[
            ('min: [225, 195, 75], max: [273, 212, 123]','min: [-589, 68, 928], max: [-577, 73, 940]'),
            ('min: [233, 199, 83], max: [265, 206, 115]','min: [-584, 69, 933], max: [-580, 73, 937]'),
            ('138.5 104 62.5','-582.5 69 934.5')],
        'zones.js':[
            ('min: [114, 0, -60], max: [295, 319, 160]','min: [-591, 60, 926], max: [-575, 90, 942]'),
            ('min: [-196, -64, -336], max: [604, 320, 464]','min: [-640, -64, 877], max: [-526, 320, 991]'),
            ('interactWhitelist: true','interactWhitelist: false'),
            ('145.5 105 75.5','-582.5 69 934.5')],
    }
    for name,edits in changes.items():
        path=scripts/name;text=path.read_text(encoding='utf-8-sig')
        for old,new in edits:
            if old not in text:raise ValueError('Unreviewed Tau script: '+name+' missing '+old)
            text=text.replace(old,new)
        path.write_text(text,encoding='utf-8')
    warps=scripts/'warps.js';text=warps.read_text(encoding='utf-8-sig')
    for value in ('24, 113, 72','138, 104, 62','185, 167, 65','266, 176, 71','-132, 39, 37','-132, 55, -42'):
        text=text.replace(value,'-583, 69, 934')
    text=text.replace('the village shore','起始之城').replace('Olympus','起始之城（兼容旧入口）').replace('the White Tower','第一层试炼入口')
    text=text.replace('the Arena (lower gallery)','竞技场尚未开放，返回主城').replace('the Arena (upper gallery)','竞技场尚未开放，返回主城')
    warps.write_text(text,encoding='utf-8')
    # Keep the exact original source in the cold archive. These coordinates have
    # no corresponding PvP arena in the replacement map, so do not offer a lie.
    (scripts/'duels.js').write_text("// Aincrad beta: original arena coordinates are not in this map. PvP is disabled.\n",encoding='utf-8')
    (scripts/'help.js').write_text("// Replaced by the shared /mycli help beta guide.\n",encoding='utf-8')
    shutil.copy2(Path(__file__).with_name('aincrad-profile.js'),scripts/'aaa_maw_aincrad.js')
    dimension=server/'kubejs/data/myagentworld/dimension/wilderness.json';dimension.parent.mkdir(parents=True,exist_ok=True)
    dimension.write_text(json.dumps({'type':'minecraft:overworld','generator':{'type':'minecraft:noise','settings':'minecraft:overworld','biome_source':{'type':'minecraft:multi_noise','preset':'minecraft:overworld'}}}),encoding='utf-8')
    properties=server/'server.properties';lines=properties.read_text(encoding='utf-8-sig').splitlines()
    overrides={'motd':'My Agent World | Aincrad Beta | Java + Agent','pvp':'false','spawn-protection':'0','difficulty':'normal','gamemode':'survival','allow-flight':'true','view-distance':'6','simulation-distance':'4','max-players':'20'}
    seen=set();out=[]
    for line in lines:
        key=line.split('=',1)[0]
        if key in overrides:line=key+'='+overrides[key];seen.add(key)
        out.append(line)
    out.extend(k+'='+v for k,v in overrides.items() if k not in seen)
    properties.write_text('\n'.join(out)+'\n',encoding='utf-8')
    print(json.dumps({'profile':'aincrad-beta-v1','seed':27594263,'resourceDimension':'myagentworld:wilderness','pvp':False}))


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('server');apply(parser.parse_args().server)
