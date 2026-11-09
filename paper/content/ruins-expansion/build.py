"""Build bounded encounters from locally installed structure packs, never a live world.

Third-party templates are not redistributed. Inputs are SHA256-pinned in sources.json.
Outputs are an explicit-placement datapack, a merge-only encounter overlay and geometry
evidence. No load/tick functions, automatic placements, entities, loot or spawners.
Requires Python 3.11+, nbtlib 2.x and PyYAML 6.x in a task-local environment.
"""
from pathlib import Path
from collections import deque,Counter
import argparse,gzip,hashlib,heapq,io,json,re,zipfile
import nbtlib,yaml
from nbtlib import Compound,List,Int,String

HERE=Path(__file__).resolve().parent
AIR={'minecraft:air','minecraft:cave_air','minecraft:void_air'}
HAZARD={'minecraft:lava','minecraft:fire','minecraft:soul_fire','minecraft:campfire','minecraft:soul_campfire','minecraft:magma_block','minecraft:cactus','minecraft:sweet_berry_bush','minecraft:powder_snow'}
DISALLOWED={'minecraft:command_block','minecraft:chain_command_block','minecraft:repeating_command_block','minecraft:structure_block','minecraft:structure_void','minecraft:spawner','minecraft:trial_spawner','minecraft:vault','minecraft:tnt'}

def state(name,properties=None):
 out=Compound({'Name':String(name)})
 if properties:out['Properties']=Compound({k:String(v)for k,v in properties.items()})
 return out

def sanitize(data):
 """Resolve connector final states, remove all executable/entity/container payloads."""
 palette=list(data.get('palette',[]));blocks=[];counts=Counter()
 if not palette:raise ValueError('single_palette_required')
 indices={}
 def index(s):
  key=str(s)
  if key not in indices:indices[key]=len(new_palette);new_palette.append(s)
  return indices[key]
 new_palette=[]
 for b in data['blocks']:
  original=palette[int(b['state'])];name=str(original['Name']);s=original
  if name=='minecraft:grass':
   s=state('minecraft:short_grass');name='minecraft:short_grass';counts['renamed_legacy_grass']+=1
  if name=='minecraft:jigsaw':
   final=str(b.get('nbt',{}).get('final_state','minecraft:air'))
   if not re.fullmatch(r'minecraft:[a-z0-9_]+(?:\[[a-z0-9_=,]+\])?',final):raise ValueError('invalid_connector_final_state')
   raw,_,props=final.partition('[');properties=dict(x.split('=')for x in props.rstrip(']').split(','))if props else None
   s=state(raw,properties);name=raw;counts['connectors']+=1
  if name in DISALLOWED:s=state('minecraft:air');counts['disabled_blocks']+=1
  if str(s.get('Properties',{}).get('waterlogged','false'))=='true':
   s=Compound(dict(s));s['Properties']=Compound(dict(s['Properties']));s['Properties']['waterlogged']=String('false');counts['disabled_waterlogging']+=1
  if 'nbt'in b:counts['removed_block_payloads']+=1
  blocks.append(Compound({'pos':List[Int](list(map(int,b['pos']))),'state':Int(index(s))}))
 counts['removed_entities']=len(data.get('entities',[]))
 clean=nbtlib.File({'DataVersion':Int(3955),'size':data['size'],'palette':List[Compound](new_palette),'blocks':List[Compound](blocks),'entities':List[Compound]([])})
 return clean,dict(counts)

def names(data):return [str(s['Name'])for s in data['palette']]
def volume(data):
 p=names(data);return {tuple(map(int,b['pos'])):p[int(b['state'])]for b in data['blocks']if p[int(b['state'])]not in AIR}

def state_key(s):
 return str(s['Name'])+'['+','.join(k+'='+str(v)for k,v in sorted(s.get('Properties',{}).items()))+']'

def supported(name):
 if name in AIR|HAZARD or name in {'minecraft:water','minecraft:barrier'}:return False
 if name in {'minecraft:snow','minecraft:grass','minecraft:short_grass','minecraft:tall_grass','minecraft:brown_mushroom','minecraft:red_mushroom'}:return False
 if any(x in name for x in ['fence','wall','pane','trapdoor','door','leaves','torch','lantern','chain','carpet','rail','slab','button','pressure_plate','rod','sign','plant','sapling','flower','vine','cobweb','ladder','scaffolding']):return False
 return True

def walk_nodes(vox,collision=None):
 # Conservative full-cube walking graph; never equate an unread cell with air.
 # All cells inside the explicit template volume are known; omitted structure
 # cells are explicitly placed as air by the generated bounding-box template.
 nodes=set()
 if collision is not None:
  def free(x,y,z):
   for by in range(int(y),int(y+1.8)+1):
    if vox.get((x,by,z))in HAZARD|{'minecraft:water'}:return False
    for box in collision.get((x,by,z),[]):
     if box[0]<.8 and box[3]>.2 and box[2]<.8 and box[5]>.2 and by+box[1]<y+1.8 and by+box[4]>y+.001:return False
   return True
  for(x,y,z),name in vox.items():
   if name in HAZARD or name in {'minecraft:water','minecraft:barrier'}:continue
   tops=[box[4]for box in collision.get((x,y,z),[])if box[0]<.8 and box[3]>.2 and box[2]<.8 and box[5]>.2]
   if not tops:continue
   top=max(tops)
   if top not in (.5,1):continue
   feet=y+top
   if free(x,feet,z):nodes.add((x,feet,z))
  return nodes
 for(x,y,z),name in vox.items():
  if supported(name)and vox.get((x,y+1,z),'minecraft:air')in AIR and vox.get((x,y+2,z),'minecraft:air')in AIR:nodes.add((x,y+1,z))
 return nodes

def neighbours(p,nodes):
 x,y,z=p
 for dx,dz in ((1,0),(-1,0),(0,1),(0,-1)):
  for dy in (0,.5,-.5,1,-1):
   q=x+dx,y+dy,z+dz
   if q in nodes:yield q

def bfs(start,nodes):
 parent={start:None};queue=deque([start])
 while queue:
  p=queue.popleft()
  for q in neighbours(p,nodes):
   if q not in parent:parent[q]=p;queue.append(q)
 return parent

def route(a,b,nodes):
 parent=bfs(a,nodes)
 if b not in parent:raise ValueError('unreachable_room')
 out=[];p=b
 while p is not None:out.append(p);p=parent[p]
 return out[::-1]

def select_rooms(data,number=3,shapes=None):
 vox=volume(data)
 collision=None
 if shapes is not None:
  palette=data['palette'];keys=[state_key(s)for s in palette]
  missing=[k for k in keys if k not in shapes]
  if missing:raise ValueError('unknown_1_21_1_blocks:'+','.join(missing))
  collision={tuple(map(int,b['pos'])):shapes[keys[int(b['state'])]]for b in data['blocks']if keys[int(b['state'])]in shapes}
 nodes=walk_nodes(vox,collision);remaining=set(nodes);components=[]
 while remaining:
  component=bfs(min(remaining),nodes);remaining.difference_update(component);components.append(set(component))
 if not components:raise ValueError('no_walkable_template_geometry')
 def flat(p):
  x,y,z=p
  if y!=int(y):return False
  floor=vox.get((x,y-1,z),'minecraft:air')
  if not supported(floor):return False
  return collision is None or collision.get((x,y-1,z))==[[0,0,0,1,1,1]]
 def centre_count(c):
  return sum(flat(p)and all((p[0]+dx,p[1],p[2]+dz)in c for dx,dz in((1,0),(-1,0),(0,1),(0,-1)))for p in c)
 connected=max(components,key=lambda c:(centre_count(c),len(c),tuple(-x for x in min(c))))
 def spawn_points(p):
  x,y,z=p
  return sorted((q for q in connected if flat(q)and abs(q[0]-x)<=6 and abs(q[2]-z)<=6 and abs(q[1]-y)<=2 and sum((a-b)**2 for a,b in zip(p,q))>=12),key=lambda q:(abs(q[1]-y),-sum((a-b)**2 for a,b in zip(p,q)),q))
 def score(p):
  x,y,z=p
  ceiling=any((x,y+d,z)in vox for d in range(2,9))
  return (ceiling,sum((x+dx,y,z+dz)in nodes for dx,dz in((1,0),(-1,0),(0,1),(0,-1))),-y)
 candidates=[p for p in connected if flat(p)and len(spawn_points(p))>=8 and all((p[0]+dx,p[1],p[2]+dz)in connected for dx,dz in((1,0),(-1,0),(0,1),(0,-1)))]
 if len(candidates)<number:raise ValueError('insufficient_safe_room_centres')
 first=max(candidates,key=lambda p:(score(p),-p[2],-p[0],p))
 selected=[first]
 for _ in range(number-1):
  choices=[p for p in candidates if all(max(abs(p[i]-s[i])for i in range(3))<=128 and sum((p[i]-s[i])**2 for i in range(3))>=10**2 for s in selected)]
  if not choices:raise ValueError('insufficient_distinct_encounter_rooms')
  chosen=max(choices,key=lambda p:(min(sum((p[i]-s[i])**2 for i in range(3))for s in selected),score(p),p))
  selected.append(chosen)
 paths=[route(a,b,connected)for a,b in zip(selected,selected[1:])]
 return [tuple(map(int,p))for p in selected],[[tuple(map(int,q))for q in spawn_points(p)][:24]for p in selected],paths,{'walkableNodes':len(nodes),'connectedNodes':len(connected),'components':len(components)}

def load_template(pack,entry):
 with zipfile.ZipFile(pack)as z:raw=z.read(entry)
 return nbtlib.File.parse(io.BytesIO(gzip.decompress(raw)if raw[:2]==b'\x1f\x8b'else raw))

def sky_annex(data,centres,spawns,paths):
 """Authored third room: covered bridge, raised flanks and a lit boss hall.

 The source tower has only two sufficiently large dry fighting floors. Do not
 relax spawn safety or use an inaccessible roof just to advertise three rooms.
 """
 palette=list(data['palette']);index={state_key(s):i for i,s in enumerate(palette)}
 cells={tuple(map(int,b['pos'])):int(b['state'])for b in data['blocks']}
 def put(x,y,z,name):
  s=state('minecraft:'+name);key=state_key(s)
  if key not in index:index[key]=len(palette);palette.append(s)
  cells[(x,y,z)]=index[key]
 x,y,start=centres[-1];end=max(int(data['size'][2])+13,start+24)
 # The three-wide bridge is an intentional doorway through the old outer wall.
 for z in range(start,end+1):
  for dx in range(-1,2):
   put(x+dx,y-1,z,'stone_bricks')
   for dy in range(3):put(x+dx,y+dy,z,'air')
  for dx in (-2,2):put(x+dx,y,z,'stone_brick_wall')
 for dx in range(-10,11):
  for dz in range(-10,11):
   put(x+dx,y-1,end+dz,'stone_bricks')
   for dy in range(6):put(x+dx,y+dy,end+dz,'air')
   edge=abs(dx)==10 or abs(dz)==10
   if edge:
    for dy in range(5):put(x+dx,y+dy,end+dz,'glass'if dy in(2,3)else 'stone_bricks')
   put(x+dx,y+5,end+dz,'glowstone'if dx%5==0 and dz%5==0 else 'stone_bricks')
 # North doorway and four large cover pillars, leaving the central route clear.
 for dx in range(-1,2):
  for dy in range(3):put(x+dx,y+dy,end-10,'air')
 for dx in(-5,5):
  for dz in(-5,5):
   for dy in range(4):put(x+dx,y+dy,end+dz,'stone_bricks')
 # Raised flanks can be jumped onto for cover, while the required route is level.
 for dx in(-8,8):
  for dz in range(-5,6):put(x+dx,y,end+dz,'stone_bricks')
 size=[max(int(data['size'][0]),x+11),max(int(data['size'][1]),y+6),end+11]
 result=nbtlib.File({'DataVersion':Int(3955),'size':List[Int](size),'palette':List[Compound](palette),'blocks':List[Compound]([Compound({'pos':List[Int](p),'state':Int(i)})for p,i in sorted(cells.items())]),'entities':List[Compound]([])})
 goal=(x,y,end);centres.append(goal)
 spawns.append([(x+dx,y,end+dz)for dx,dz in[(-6,-3),(-3,-6),(3,-6),(6,-3),(6,3),(3,6),(-3,6),(-6,3),(-4,-2),(-2,-4),(2,-4),(4,-2),(4,2),(2,4),(-2,4),(-4,2)]])
 paths.append([(x,y,z)for z in range(start,end+1)])
 return result,centres,spawns,paths

def author_routes(data,centres,site):
 """Build real encounter floors and stairs without changing any game gate.

 Original graph candidates can have a passage too narrow for a player's body.
 Reserve full room floors and three-block headroom, then plan physical corridors
 between them. Floors from other levels cannot be removed to fake connectivity.
 """
 pad=24;palette=list(data['palette']);indices={state_key(s):i for i,s in enumerate(palette)}
 cells={(int(b['pos'][0])+pad,int(b['pos'][1]),int(b['pos'][2])+pad):int(b['state'])for b in data['blocks']}
 centres=[(x+pad,y,z+pad)for x,y,z in centres];solid=set();free=set();room_floors=set()
 def put(p,name,props=None):
  s=state('minecraft:'+name,props);key=state_key(s)
  if key not in indices:indices[key]=len(palette);palette.append(s)
  cells[p]=indices[key]
 material={'corsair_cove':'dark_oak_planks','tide_sanctum':'prismarine_bricks','sunken_dynasty':'smooth_sandstone','frost_keep':'stone_bricks','ember_foundry':'polished_blackstone_bricks','jungle_covenant':'mossy_stone_bricks','sky_watch':'stone_bricks','void_citadel':'purpur_block','deep_mineworks':'spruce_planks','winter_manor':'dark_oak_planks'}[site['id']]
 for cx,y,cz in centres:
  for dx in range(-7,8):
   for dz in range(-7,8):
    floor=(cx+dx,y-1,cz+dz);solid.add(floor);room_floors.add(floor)
    for dy in range(3):free.add((cx+dx,y+dy,cz+dz))
 if solid&free:raise ValueError('authored_room_headroom_conflict')
 for p in solid:put(p,material)
 for p in free:put(p,'air')
 low=[min(p[i]for p in centres)-(24 if i!=1 else 8)for i in range(3)];low[1]=max(1,low[1]);high=[max(p[i]for p in centres)+(24 if i!=1 else 12)for i in range(3)]
 def allowed(p):
  x,y,z=p
  return all(low[i]<=p[i]<=high[i]for i in range(3))and(x,y-1,z)not in free and all((x,y+d,z)not in solid for d in range(3))
 routes=[];centreline=[]
 for start,goal in zip(centres,centres[1:]):
  queue=[(0,0,start)];cost={start:0};parents={start:None};counter=0
  while queue:
   _,_,p=heapq.heappop(queue)
   if p==goal:break
   for dx,dz in((1,0),(-1,0),(0,1),(0,-1)):
    for dy in(0,1,-1):
     q=(p[0]+dx,p[1]+dy,p[2]+dz)
     if not allowed(q)or dy>0 and(p[0],p[1]+3,p[2])in solid:continue
     score=cost[p]+1+abs(dy)*2
     if score>=cost.get(q,10**9):continue
     cost[q]=score;parents[q]=p;counter+=1
     heuristic=max(abs(q[0]-goal[0])+abs(q[2]-goal[2]),abs(q[1]-goal[1]))
     heapq.heappush(queue,(score+heuristic,counter,q))
   if len(cost)>250000:raise ValueError('route_search_budget')
  if goal not in parents:raise ValueError('physical_corridor_unavailable')
  route=[];p=goal
  while p is not None:route.append(p);p=parents[p]
  route.reverse();routes.append(route);centreline.extend(route)
  for x,y,z in route:
   solid.add((x,y-1,z));free.update((x,y+d,z)for d in range(3))
  for x,y,z in route:
   put((x,y-1,z),material)
   for dy in range(3):put((x,y+dy,z),'air')
   if(x,y+3,z)not in solid:put((x,y+3,z),'air')
  for a,p in zip(route,route[1:]):
   if p[1]>a[1]and(p[0],p[1]-1,p[2])not in room_floors:
    facing='east'if p[0]>a[0]else 'west'if p[0]<a[0]else 'south'if p[2]>a[2]else 'north'
    put((p[0],p[1]-1,p[2]),'stone_brick_stairs',{'facing':facing,'half':'bottom','shape':'straight','waterlogged':'false'})
 # Add width wherever it does not erase another floor or its required headroom.
 for x,y,z in centreline:
  for dx,dz in((1,0),(-1,0),(0,1),(0,-1)):
   q=(x+dx,y,z+dz)
   if not allowed(q):continue
   floor=(q[0],y-1,q[2]);solid.add(floor);free.update((q[0],y+d,q[2])for d in range(3))
   if floor not in cells or not str(palette[cells[floor]]['Name']).endswith('_stairs'):put(floor,material)
   for dy in range(3):put((q[0],y+dy,q[2]),'air')
 def prop(p,name,props=None):
  if p in solid or p in free and any(abs(p[0]-x)<=1 and abs(p[2]-z)<=1 and y<=p[1]<=y+3 for x,y,z in centreline):return
  put(p,name,props)
 spawns=[]
 for cx,y,cz in centres:
  # Four cover pillars and jumpable side perches; main axes remain open.
  for dx in(-5,5):
   for dz in(-5,5):
    for dy in range(2):prop((cx+dx,y+dy,cz+dz),material)
    prop((cx+dx,y+2,cz+dz),'glowstone')
  for dz in(-6,6):
   for dx in(-4,-3,3,4):prop((cx+dx,y,cz+dz),material)
  # These eight points have a clear 3x3 footprint, including for spiders.
  points=[(cx+dx,y,cz+dz)for dx,dz in[(0,-6),(0,6),(-6,0),(6,0),(-3,-3),(-3,3),(3,-3),(3,3)]]
  for p in points:
   for dx in(-1,0,1):
    for dz in(-1,0,1):
     put((p[0]+dx,y-1,p[2]+dz),material)
     for dy in range(2):put((p[0]+dx,y+dy,p[2]+dz),'air')
  put((cx,y-1,cz),'sea_lantern'if site['id']in {'tide_sanctum','frost_keep','void_citadel'}else 'glowstone')
  if site['id']in {'ember_foundry','tide_sanctum'}:
   for dx,dz in[(-6,-6),(6,6)]:
    p=(cx+dx,y-1,cz+dz)
    if not any(abs(p[0]-x)<=2 and abs(p[2]-z)<=2 and abs(y-yy)<=2 for x,yy,z in centreline):put(p,'lava'if site['id']=='ember_foundry'else 'water')
  spawns.append(points)
 # Guard exposed edges, with openings along the actual shared route. No flight,
 # fire-resistance or permission changes are used to make these levels playable.
 for cx,y,cz in centres:
  for dx in range(-8,9):
   for dz in range(-8,9):
    if max(abs(dx),abs(dz))!=8:continue
    p=(cx+dx,y,cz+dz)
    if not allowed(p):continue
    if any(abs(p[0]-x)<=7 and abs(p[2]-z)<=7 and abs(y-yy)<=2 for x,yy,z in centres):continue
    floor=(p[0],y-1,p[2])
    if floor not in cells or not str(palette[cells[floor]]['Name']).endswith('_stairs'):put(floor,material)
    if any(abs(p[0]-x)<=1 and abs(p[2]-z)<=1 and abs(y-yy)<=1 for x,yy,z in centreline):continue
    put(p,'stone_brick_wall')
 for i,(x,y,z)in enumerate(centreline):
  floor=(x,y-1,z)
  if i%7==0 and not str(palette[cells[floor]]['Name']).endswith('_stairs'):put(floor,'glowstone')
 size=[max(int(data['size'][0])+2*pad,max(p[0]for p in cells)+1),max(int(data['size'][1]),max(p[1]for p in cells)+1),max(int(data['size'][2])+2*pad,max(p[2]for p in cells)+1)]
 result=nbtlib.File({'DataVersion':Int(3955),'size':List[Int](size),'palette':List[Compound](palette),'blocks':List[Compound]([Compound({'pos':List[Int](p),'state':Int(i)})for p,i in sorted(cells.items())]),'entities':List[Compound]([])})
 shifted=dict(site);shifted['origin']=[site['origin'][0]-pad,site['origin'][1],site['origin'][2]-pad]
 return result,centres,spawns,routes,shifted

def landscape(data,site):
 """Give imported ruins bounded terrain instead of leaving a floating empty box.

 Only new construction cells are authored. A dry dock surrounds the ship; water
 pools stay outside the template and never flood its rooms. Nothing runs on tick.
 """
 margin,depth=12,8;sx,sy,sz=map(int,data['size']);palette=list(data['palette'])
 indices={state_key(s):i for i,s in enumerate(palette)};cells={}
 def put(x,y,z,name):
  s=state('minecraft:'+name);key=state_key(s)
  if key not in indices:indices[key]=len(palette);palette.append(s)
  cells[(x,y,z)]=indices[key]
 top={'corsair_cove':'sand','tide_sanctum':'prismarine_bricks','sunken_dynasty':'sandstone','frost_keep':'snow_block','ember_foundry':'blackstone','jungle_covenant':'moss_block','sky_watch':'stone_bricks','void_citadel':'end_stone_bricks','deep_mineworks':'andesite','winter_manor':'coarse_dirt'}[site['id']]
 # Rounded terrain corners, full support beneath the original building footprint.
 for x in range(sx+2*margin):
  for z in range(sz+2*margin):
   dx=max(margin-x,0,x-(sx+margin-1));dz=max(margin-z,0,z-(sz+margin-1))
   if dx*dx+dz*dz>margin*margin:continue
   for y in range(depth):put(x,y,z,top if y==depth-1 else 'stone')
 # Two shallow, stone-lined ponds on the outer apron. These have real vanilla
 # water and collision; they do not grant swimming or fire immunity effects.
 if site['id']in {'corsair_cove','tide_sanctum','jungle_covenant'}:
  for x in range(3,9):
   for z in range(margin+3,min(sz+margin-3,margin+17)):
    put(x,depth-2,z,'stone_bricks');put(x,depth-1,z,'water')
 blocks=[Compound({'pos':List[Int](p),'state':Int(i)})for p,i in sorted(cells.items())]
 for b in data['blocks']:
  x,y,z=map(int,b['pos']);blocks.append(Compound({'pos':List[Int]([x+margin,y+depth,z+margin]),'state':b['state']}))
 result=nbtlib.File({'DataVersion':Int(3955),'size':List[Int]([sx+2*margin,sy+depth,sz+2*margin]),'palette':List[Compound](palette),'blocks':List[Compound](blocks),'entities':List[Compound]([])})
 return result,[site['origin'][0]-margin,site['origin'][1]-depth,site['origin'][2]-margin]

def build(pack_root,out,catalog=None,sources=None,shapes=None):
 if out.exists():raise ValueError('output_must_be_new')
 catalog=catalog or json.loads((HERE/'catalog.json').read_text(encoding='utf-8'))
 sources=sources or json.loads((HERE/'sources.json').read_text(encoding='utf-8'))
 out.mkdir(parents=True);pack=out/'datapack';structure=pack/'data/qd_ruins/structure';structure.mkdir(parents=True)
 (pack/'pack.mcmeta').write_text(json.dumps({'pack':{'pack_format':48,'description':'千灯纪·十境遗迹；仅显式放置，不自动改世界'}},ensure_ascii=False),encoding='utf-8')
 overlay={'schema-version':1,'sites':{}};manifest={'schemaVersion':1,'revision':catalog['revision'],'sources':sources,'sites':[]}
 for site in catalog['sites']:
  src=pack_root/site['pack'];digest=hashlib.sha256(src.read_bytes()).hexdigest()
  if digest!=sources[site['pack']]['sha256']:raise ValueError('source_hash_mismatch:'+site['pack'])
  original=load_template(src,site['template']);clean,removed=sanitize(original)
  try:
   centres,spawns,paths,stats=select_rooms(clean,2 if site['id']=='sky_watch'else len(site['rooms']),shapes)
   if site['id']=='sky_watch':clean,centres,spawns,paths=sky_annex(clean,centres,spawns,paths);stats['authoredAnnex']=True
  except ValueError as e:raise ValueError(site['id']+':'+str(e))from e
  clean,centres,spawns,paths,site=author_routes(clean,centres,site);stats['authoredPlayableRoutes']=True
  placed,placement_origin=landscape(clean,site)
  encoded=io.BytesIO();placed.write(encoded)
  (structure/(site['id']+'.nbt')).write_bytes(gzip.compress(encoded.getvalue(),mtime=0))
  origin=site['origin'];absolute=lambda p:[a+b for a,b in zip(p,origin)]
  rooms=[]
  for i,(title,centre,points)in enumerate(zip(site['rooms'],centres,spawns)):
   mobs=[{'type':site['mobs'][i%len(site['mobs'])],'count':2,'health':28+i*6},{'type':site['mobs'][(i+1)%len(site['mobs'])],'count':1,'health':32+i*6}]
   if i==len(centres)-1:mobs.append({'type':site['boss'],'count':1,'health':90,'name':title,'mythic':'QD_Ruin_'+site['id']})
   approach=paths[i-1]if i else [centres[0]]
   checkpoints=[approach[min(len(approach)-1,j*max(1,len(approach)//3))]for j in range(1,3)]+[centres[i]]if i else [centres[0]]
   hint='本室路线 '+ ' → '.join(','.join(str(int(v))if v==int(v)else str(v)for v in absolute(p))for p in checkpoints)+'；清怪后用 /mycli dungeon status '+site['id']+' 核对下一步。'
   if i==len(centres)-1:hint+='全部完成后 /mycli dungeon claim '+site['id']+' 领取到个人箱。'
   rooms.append({'name':title,'center':absolute(centre),'radius':6,'spawn-points':[absolute(p)for p in points],'hint':hint,'mobs':mobs})
  size=list(map(int,placed['size']));bounds=placement_origin+[placement_origin[i]+size[i]-1 for i in range(3)]
  overlay['sites'][site['id']]={'name':site['name'],'world':catalog['world'],'entry':rooms[0]['center'],'icon':site['icon'],'hint':site['theme']+'；3室，普通/冒险/末日可选。','reward':site['reward'],'protection-boxes':[bounds],'rooms':rooms}
  manifest['sites'].append({'id':site['id'],'name':site['name'],'origin':placement_origin,'encounterOrigin':origin,'bounds':bounds,'size':size,'template':site['template'],'source':site['pack'],'removed':removed,'geometry':stats,'centres':[absolute(p)for p in centres],'paths':[[absolute(p)for p in path]for path in paths],'blockCount':len(placed['blocks']),'templateSha256':hashlib.sha256((structure/(site['id']+'.nbt')).read_bytes()).hexdigest()})
 (out/'dungeons-overlay.yml').write_text(yaml.safe_dump(overlay,allow_unicode=True,sort_keys=False),encoding='utf-8')
 bosses={}
 weapons={'PILLAGER':'CROSSBOW','VINDICATOR':'IRON_AXE','DROWNED':'TRIDENT','SKELETON':'BOW','STRAY':'BOW','WITHER_SKELETON':'STONE_SWORD','HUSK':'IRON_SWORD'}
 for site in catalog['sites']:
  mob={'Type':site['boss'],'Display':'&c'+site['rooms'][-1],'Health':90,'Damage':5,
   'Options':{'MovementSpeed':0.23,'PreventOtherDrops':True,'PreventRandomEquipment':True,'PreventSunburn':True,'PreventRenaming':True,'AlwaysShowName':True,'Despawn':False,'KnockbackResistance':0.25},
   'BossBar':{'Enabled':True,'Title':'&c'+site['name'],'Range':24,'Color':'PURPLE','Style':'SEGMENTED_10'},
   'Skills':['skill{s=QD_Ruins_Rally} @self ~onTimer:140']}
  if site['boss']in weapons:mob['Equipment']=[weapons[site['boss']]+' HAND']
  bosses['QD_Ruin_'+site['id']]=mob
 folder=out/'MythicMobs';folder.mkdir()
 (folder/'qiandengji-ruins-mobs.yml').write_text(yaml.safe_dump(bosses,allow_unicode=True,sort_keys=False),encoding='utf-8')
 (folder/'qiandengji-ruins-skills.yml').write_text(yaml.safe_dump({'QD_Ruins_Rally':{'Cooldown':7,'Skills':['effect:particlering{particle=crit;radius=3;points=24;amount=1} @self','sound{s=block.amethyst_block.chime;v=0.6;p=0.7} @self','potion{type=GLOWING;duration=30;level=0} @self','delay 30','potion{type=SPEED;duration=40;level=0} @self']}},allow_unicode=True,sort_keys=False),encoding='utf-8')
 (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
 return manifest

def export_states(pack_root):
 catalog=json.loads((HERE/'catalog.json').read_text(encoding='utf-8'));sources=json.loads((HERE/'sources.json').read_text(encoding='utf-8'));states={}
 for site in catalog['sites']:
  path=pack_root/site['pack']
  if hashlib.sha256(path.read_bytes()).hexdigest()!=sources[site['pack']]['sha256']:raise ValueError('source_hash_mismatch:'+site['pack'])
  clean,_=sanitize(load_template(path,site['template']))
  for s in clean['palette']:states[state_key(s)]={'name':str(s['Name']),'properties':{k:str(v)for k,v in s.get('Properties',{}).items()}}
 for name in ['stone','sand','prismarine_bricks','sandstone','snow_block','blackstone','moss_block','stone_bricks','end_stone_bricks','andesite','coarse_dirt','water','glass','glowstone','stone_brick_wall','air']:
  s=state('minecraft:'+name);states[state_key(s)]={'name':str(s['Name']),'properties':{}}
 return [states[key]for key in sorted(states)]

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--packs',type=Path,required=True);p.add_argument('--out',type=Path);p.add_argument('--collisions',type=Path);p.add_argument('--export-states',type=Path);a=p.parse_args()
 if a.export_states:
  if a.export_states.exists():p.error('states_output_must_be_new')
  a.export_states.write_text(json.dumps(export_states(a.packs)),encoding='utf-8');raise SystemExit(0)
 if not a.out or not a.collisions:p.error('build requires --out and --collisions')
 collision=json.loads(a.collisions.read_text());assert collision['minecraftVersion']=='1.21.1' and not collision['unknown']
 result=build(a.packs,a.out,shapes=collision['shapes']);print(json.dumps({'sites':len(result['sites']),'rooms':sum(len(s['centres'])for s in result['sites'])}))
