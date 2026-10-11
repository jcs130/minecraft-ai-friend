"""Read a live Paper content directory; export definitions, never accounts or world coordinates.

Requires PyYAML 6.0.3 (install into an isolated tools directory). No source writes.
The private audit contains hashes/counts only; historical ledgers stay on Paper.
"""
from pathlib import Path
import argparse,hashlib,json,re,subprocess

REPO=Path(__file__).resolve().parents[1]

def export(source, source_repo, revision, destination, audit):
    import yaml
    def read(name):return yaml.safe_load((source/name).read_text('utf-8')) or {}
    def text(name):return subprocess.run(['git','show',f'{revision}:paper/plugins/AgentFriend/src/org/afuhome/agentfriend/{name}.java'],cwd=source_repo,check=True,capture_output=True,text=True,encoding='utf8').stdout
    professions=read('professions.yml')['professions'];skills=read('skills.yml')['skills'];points=read('skill-points.yml')
    common=[
      ('selfheal','圣愈术','GOLDEN_APPLE','selfheal',6,15,1,1,8,1),('heal','范围治疗','GLISTERING_MELON_SLICE','mend',6,12,8,24,6,1),
      ('food','饱食术','BREAD','food',3,30,1,1,4,1),('home','归乡术','RED_BED','home',6,1,1,1,1,1),
      ('blink','闪现术','ENDER_PEARL','blink',4,8,25,1,1,1),('fireworks','烟花术','FIREWORK_ROCKET','fireworks',1,10,1,1,1,1),
      ('starlight','星尘术','GLOWSTONE_DUST','starlight',1,10,1,1,1,1),('starbolt','星芒箭','AMETHYST_SHARD','arcane_bolt',4,3,18,1,5,1),
      ('frostnova','霜环','SNOWBALL','frost_ring',7,14,5.5,4,2,4),('flamewave','焰浪','BLAZE_POWDER','flame_cone',8,10,9,4,4,3),
      ('prospect','探矿术','SPYGLASS','prospect',6,30,24,12,1,12),('leap','跃空术','RABBIT_FOOT','sky_leap',6,20,1,1,8,20),
      ('flight','飞行术','FEATHER','soar',8,90,1,1,1,20),('sense','寻敌术','ENDER_EYE','sense',4,20,32,12,1,8),
      ('golem','召唤铁卫','IRON_BLOCK','golem',12,90,16,1,1,45),('feather','羽落术','FEATHER','feather',3,20,1,1,1,30),
      ('night','夜视术','GOLDEN_CARROT','night',3,30,1,1,1,120)]
    # Keep old effect text for provenance; the server adds explicit new-world requirements.
    guide=text('SpellGuide')
    for id,title,icon,effect,mana,cooldown,range_,targets,power,duration in common:
      match=re.search(r'new Entry\("'+id+r'".*?"/mycli[^\n]*?", "([^"\n]+)"',guide,re.S)
      skills[id]={'title':title,'profession':'common','icon':icon,'effect':effect,'equipment':'none','mana':mana,'cooldown-seconds':cooldown,
        'limits':{'range':range_,'targets':targets,'power':power,'duration-seconds':duration},'description':match.group(1) if match else title,
        'origin':'基础技能花1点学习；熟练8/24次并花点升级；新世界按本人实际事件成长。'}
    effect_descriptions={
      'sword_thrust':'前方可见敌对目标的单次突刺伤害；须按装备要求持剑。',
      'sword_cone':'前方锥形范围内的可见敌对目标伤害。',
      'sword_beam':'前方较远的可见敌对目标伤害。',
      'sword_combo':'双剑秘技：按等级参数结算一次总伤害，须满足主副手装备；目前并非四次独立攻击动画。',
      'arcane_bolt':'自动锁定前方可见敌对生物；无前方目标时可在近处锁敌，排除友方。',
      'frost_cone':'前方可见敌对生物受到伤害与减速。',
      'frost_ring':'周围可见敌对生物受到伤害与减速。',
      'flame_cone':'前方可见敌对生物受到伤害；通用焰浪另附短时燃烧。',
      'sword_step':'沿无碰撞的路径闪到前方敌人附近，检查安全落脚后结算伤害。',
      'sword_parry':'短时抵挡下一次来自面前敌怪的部分伤害，最多减免一半且不超过等级上限。',
      'ward':'为范围内队友赋予一次正面减伤，实际范围、人数、持续和减免上限见等级参数。',
      'mark':'侦察并短时标记可见敌对目标，返回类型、UUID及绝对坐标；不穿墙读取。',
      'sense':'探查周围可见敌对目标，返回类型、UUID及绝对坐标；不穿墙读取。',
      'mend':'治疗范围内受伤的自己及非敌对队友，优先治疗低生命比例者；不需点选队友。',
      'selfheal':'治疗受伤的自己；满血时不收费、不进入冷却。',
      'cleanse':'移除自己身上的中毒与凋零；没有这些效果时不收费。',
      'food':'为自己补充4点饥饿和相应饱和度；饥饿已满时不收费。',
      'home':'同主世界内返回世界出生点附近的安全落脚点；不在试炼中强行离队。',
      'blink':'沿视线闪现到已加载且可站立的位置；不会穿过实体方块或闯入禁入领地。',
      'prospect':'有界扫描已加载方块；半径24至40格随采矿实践成长，最多12处矿物绝对坐标和私有粒子。',
      'sky_leap':'从地面跃起，成功后附羽落保护；高度随技能熟练等级提升。',
      'soar':'临时开放飞行能力20/30/40秒；使用客户端飞行操作，结束、离线或换维度时回收权限。',
      'golem':'在前方空位召唤一个本人铁傀儡助手，最多一个，45秒后消失。',
      'blessing':'范围内队友获得短时速度与抗性；按等级限制人数和持续时间。',
      'night':'为自己施加夜视，持续时间以等级参数为准。',
      'feather':'为自己施加缓降，持续时间以等级参数为准。',
      'fireworks':'播放烟花粒子、声音与标题，不生成会爆炸的火箭实体。',
      'starlight':'播放星尘粒子、声音与标题。'
    }
    for definition in skills.values():
      definition['paperDescription']=definition.get('description','')
      definition['description']=effect_descriptions[definition['effect']]+' 魔力、冷却、伤害/治疗量、范围及人数以本人 actualLimits/manaCost 为准。'
    dungeon=text('DungeonManager')
    pattern=r'new Theme\("([^"\n]+)", Material\.(\w+), Material\.(\w+), Material\.(\w+),\s*new EntityType\[\]\{(.*?)\},\s*new Loot\[\]\{(.*?)\}\)'
    floors=[]
    for i,m in enumerate(re.finditer(pattern,dungeon,re.S),1):
      floors.append({'floor':i,'name':m[1],'floorBlock':'minecraft:'+m[2].lower(),'wallBlock':'minecraft:'+m[3].lower(),'pillarBlock':'minecraft:'+m[4].lower(),
        'enemies':[{'type':'minecraft:'+x.lower()} for x in re.findall(r'EntityType\.(\w+)',m[5])],
        'supplies':[{'item':'minecraft:'+item.lower(),'count':int(n)} for item,n in re.findall(r'new Loot\(Material\.(\w+), (\d+)\)',m[6])]})
    if len(floors)!=15:raise ValueError(f'Expected actual 15-floor source, found {len(floors)}')
    overrides=read('trial-waves.yml')['floors']
    for floor in floors:
      floor['enhancedEnemies']=[{'type':'minecraft:'+e['type'].lower(),**{k:v for k,v in e.items() if k not in ('type','count','mythic')}} for e in overrides.get(str(floor['floor']),[]) for _ in range(e.get('count',1))]
    content={'schemaVersion':1,'source':{'server':'Paper 1.20.6','plugin':'AgentFriend 0.4.23','revision':revision},'professions':professions,'skills':skills,
      'points':points,'unlocks':read('skill-unlocks.yml')['unlocks'],'floors':floors,
      'relocationRequired':['lands','structure_masks','waypoints','site_dungeons','guild_buildings','assessment_courses'],
      'historicalDataImported':False}
    destination.parent.mkdir(parents=True,exist_ok=True);destination.write_text(json.dumps(content,ensure_ascii=False,indent=2)+'\n','utf8')
    values={'schemaVersion':1,'revision':revision,'sourceJarSha256':hashlib.sha256((source.parent/'AgentFriend-0.4.23.jar').read_bytes()).hexdigest(),
      'sourceFiles':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in source.glob('*.yml')},
      'counts':{'skills':len(skills),'professions':len(professions),'trialFloors':len(floors),'lands':len(read('lands.yml')['lands']),
        'siteDungeons':len(read('dungeons.yml')['sites']),'marketTasks':len(read('task-market.yml')['tasks']),'residentTasks':len(read('resident-contracts.yml')['tasks'])},
      'oldServerWrites':0,'historicalAccountsImported':0}
    audit.parent.mkdir(parents=True,exist_ok=True);audit.write_text(json.dumps(values,ensure_ascii=False,indent=2)+'\n','utf8');return values

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=Path,required=True);p.add_argument('--source-repo',type=Path,required=True);p.add_argument('--revision',required=True);p.add_argument('--destination',type=Path,required=True);p.add_argument('--audit',type=Path,required=True);a=p.parse_args()
 print(json.dumps(export(a.source,a.source_repo,a.revision,a.destination,a.audit),ensure_ascii=False))
