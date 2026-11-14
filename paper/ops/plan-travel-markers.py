"""Read-only, bounded native beacon/sign plans. Never edits a world or invokes RCON.

Input points must carry a checked landing or an explicit unverified/private label.
The installer must recheck every before-image and preserve changed player builds.
"""
import argparse
from functools import lru_cache
import gzip, io, json, math, re, struct, zlib
from pathlib import Path

AIR = {'minecraft:air', 'minecraft:cave_air', 'minecraft:void_air', 'minecraft:short_grass', 'minecraft:tall_grass', 'minecraft:snow'}
NATURAL = {'minecraft:stone','minecraft:deepslate','minecraft:tuff','minecraft:calcite','minecraft:dirt','minecraft:grass_block','minecraft:mycelium','minecraft:podzol','minecraft:netherrack','minecraft:basalt','minecraft:blackstone','minecraft:end_stone','minecraft:sand','minecraft:red_sand','minecraft:sandstone','minecraft:red_sandstone','minecraft:gravel','minecraft:granite','minecraft:andesite','minecraft:diorite','minecraft:moss_block'}
# A supported base may replace plain structural flooring, never containers, ore,
# redstone, beds, portals or an existing marker. Clearing a niche is natural-only.
FLOOR = NATURAL | {'minecraft:cobblestone','minecraft:stone_bricks','minecraft:smooth_stone','minecraft:smooth_sandstone'} | {'minecraft:'+wood+'_planks' for wood in ('oak','spruce','birch','jungle','acacia','dark_oak','mangrove','cherry','bamboo','crimson','warped')}
FLOOR |= {'minecraft:'+b for b in ('polished_andesite','polished_diorite','polished_granite','mossy_stone_bricks','mossy_cobblestone','chiseled_stone_bricks','tuff_bricks','polished_tuff','chiseled_tuff_bricks','polished_blackstone_bricks','polished_blackstone','black_terracotta','gray_terracotta','prismarine','prismarine_bricks','dark_prismarine','purpur_block','nether_wart_block','warped_wart_block')}
FLOOR |= {'minecraft:'+b for b in ('waxed_copper_block','waxed_exposed_copper','waxed_weathered_copper','waxed_oxidized_copper','waxed_cut_copper','waxed_exposed_cut_copper','waxed_weathered_cut_copper','waxed_oxidized_cut_copper')}
FACES = [('east',1,0),('west',-1,0),('south',0,1),('north',0,-1)]
def kind(block): return block.split('[')[0]
def floor(block): return 'waterlogged=true' not in block and (kind(block) in FLOOR or kind(block).endswith('_slab'))

class Reader:
    def __init__(self, root): self.root=root
    @lru_cache(maxsize=12)
    def region(self,world,rx,rz):
        if not re.fullmatch('[a-zA-Z0-9_-]{1,80}',world):raise ValueError('Invalid world name')
        folder=self.root/world
        # Youer keeps extra vanilla dimension directories under world as well.
        # Those are not the Bukkit world's region directory; never guess from
        # the number of directories found.
        region=folder/({'world_nether':'DIM-1/region','world_the_end':'DIM1/region'}.get(world,'region'))
        path=region/f'r.{rx}.{rz}.mca'
        if not path.is_file():return None
        before=path.stat();data=path.read_bytes();after=path.stat()
        if before.st_mtime_ns!=after.st_mtime_ns or len(data)!=after.st_size:raise ValueError('Region changed during snapshot')
        return data
    @lru_cache(maxsize=128)
    def chunk(self,world,cx,cz):
        import nbtlib
        data=self.region(world,cx//32,cz//32)
        if data is None:return None
        entry=struct.unpack_from('>I',data,4*((cx%32)+32*(cz%32)))[0];offset=(entry>>8)*4096
        if not offset:return None
        size=struct.unpack_from('>I',data,offset)[0];mode=data[offset+4]
        if size<1 or size>(entry&255)*4096-4 or mode not in (1,2,3):raise ValueError('Invalid region record')
        body=data[offset+5:offset+4+size]
        nbt=nbtlib.File.parse(io.BytesIO({1:gzip.decompress,2:zlib.decompress,3:lambda v:v}[mode](body)))
        if int(nbt['xPos'])!=cx or int(nbt['zPos'])!=cz:raise ValueError('Chunk coordinate mismatch')
        return {int(s['Y']):s.get('block_states') for s in nbt['sections']}
    def get(self,world,x,y,z):
        sections=self.chunk(world,x//16,z//16)
        if sections is None:return 'unknown'
        states=sections.get(y//16)
        if not states:return 'minecraft:air'
        palette=states['palette'];index=((y%16)*16+z%16)*16+x%16
        bits=max(4,(len(palette)-1).bit_length());per=64//bits
        i=0 if len(palette)==1 else (int(states['data'][index//per])>>((index%per)*bits))&((1<<bits)-1)
        block=palette[i];props=','.join(f'{k}={v}' for k,v in sorted(block.get('Properties',{}).items()))
        return str(block['Name'])+('['+props+']' if props else '')

def choose(point, read, reserved, accept=None):
    world=point['worldName'];x,y,z=point.get('safeDestination',[point['x'],point['y'],point['z']])
    x,y,z=math.floor(x),math.floor(y),math.floor(z)
    candidates=[]
    for dx in range(-8,9):
        for dz in range(-8,9):
            if not 4<=dx*dx+dz*dz<=64:continue
            for dy in (0,-1,1,-2,2):candidates.append((dx*dx+dz*dz+4*dy*dy,dx,dy,dz))
    # Prefer recessed foundations. Only use an adjacent 3x3 extension if no
    # recessed spot exists; the reader still stands on the original safe path.
    sizes=(True,False) if point.get('compactPreferred') else (False,True)
    for compact,extension,(_,dx,dy,dz) in ((small,ext,c) for small in sizes for ext in (False,True) for c in sorted(candidates)):
        bx,by,bz=x+dx,y+dy,z+dz
        for face,fx,fz in sorted(FACES,key=lambda f:(bx+2*f[1]-x)**2+(bz+2*f[2]-z)**2):
            # The person reads the sign from an existing walkable cell. The beacon
            # is behind it, never planted across a one-block tunnel or on arrival.
            wx,wz=bx+2*fx,bz+2*fz
            reader_floor=read(world,wx,by-1,wz)
            if not floor(reader_floor) or any(kind(read(world,wx,yy,wz)) not in AIR for yy in (by,by+1)):continue
            reader_y=by-.5 if '_slab[' in reader_floor and 'type=bottom' in reader_floor else by
            footprint=[(bx,by-1,bz)] if compact else [(bx+u,by-1,bz+v) for u in (-1,0,1) for v in (-1,0,1)]
            clear=[(bx,by,bz),(bx,by+1,bz),(bx+fx,by,bz+fz),(bx+fx,by+1,bz+fz)]
            if any(px==x and pz==z for px,_,pz in footprint+clear):continue
            cells=footprint+clear
            if any((world,*c) in reserved for c in cells):continue
            before={c:read(world,*c) for c in cells}
            if any(not floor(before[c]) and not (extension and kind(before[c]) in AIR) for c in footprint):continue
            if extension and not any(floor(before[c]) for c in footprint):continue
            if any(kind(before[c]) not in AIR|NATURAL or 'waterlogged=true' in before[c] for c in clear):continue
            # A solid beacon must not plug an existing one-block corridor.
            # A recess in a natural wall is fine; on a path there must already
            # be room to walk around at least one side (or on the new side pad).
            if kind(before[(bx,by,bz)]) in AIR:
                bypass=False
                for sx,sz in ((-fz,fx),(fz,-fx)):
                    px,pz=bx+sx,bz+sz
                    if (floor(read(world,px,by-1,pz)) or extension and kind(read(world,px,by-1,pz)) in AIR) and all(kind(read(world,px,yy,pz)) in AIR for yy in (by,by+1)):bypass=True
                if not bypass:continue
            after={c:'minecraft:iron_block' for c in footprint}
            after.update({c:'minecraft:air' for c in clear})
            after[(bx,by,bz)]='minecraft:beacon'
            after[(bx+fx,by,bz+fz)]=f'minecraft:oak_wall_sign[facing={face},waterlogged=false]'
            # Include unchanged clear cells as well: they are part of the protected
            # reading space and must not silently become a wall during installation.
            changes=[{'position':list(c),'before':before[c],'after':after[c]} for c in cells]
            geometry={'beacon':[bx,by,bz],'sign':[bx+fx,by,bz+fz],'reader':[wx+.5,reader_y,wz+.5],'extension':extension,
                    'changes':changes,'niche':any(kind(before[c]) in NATURAL for c in clear),'compact':compact,
                    'beam':'compact_light_marker_no_buff' if compact else 'open_sky_required_do_not_remove_roof','protection':{'min':[bx-1,by-1,bz-1],'max':[bx+1,by+1,bz+1]}}
            if accept is not None and not accept(geometry):continue
            reserved.update((world,*c) for c in cells)
            return geometry
    return None

def plan(points, read):
    markers=[];blocked=[];reserved=set();groups={}
    # No marker may cover another destination's arrival space, even if that
    # destination appears later in the file or belongs to another player.
    for point in points:
        at=point.get('safeDestination',[point.get('x'),point.get('y'),point.get('z')])
        if point.get('worldName') and all(v is not None and math.isfinite(v) for v in at):
            x,y,z=at
            reserved.update((point['worldName'],xx,yy,zz) for xx in range(math.floor(x-.3+1e-5),math.floor(x+.3-1e-5)+1) for zz in range(math.floor(z-.3+1e-5),math.floor(z+.3-1e-5)+1) for yy in range(math.floor(y)-1,math.ceil(y+1.8)))
    for point in points:
        world=point.get('worldName');coords=point.get('safeDestination',[point.get('x'),point.get('y'),point.get('z')])
        if not world or any(v is None or not math.isfinite(v) for v in coords):blocked.append({'id':point['id'],'reason':'missing_verified_location'});continue
        key=(world,*coords)
        if key in groups:groups[key]['aliases'].append(point['id']);continue
        geometry=choose(point,read,reserved)
        if geometry is None:blocked.append({'id':point['id'],'reason':'no_safe_side_marker_within_8_blocks'});continue
        public=point['kind']=='public';title=point.get('name',point['id']) if public else '个人点·'+point.get('name','')
        target=point['id'] if public else 'personal:'+point.get('name',point['id'])
        marker={'id':point['id'],'aliases':[],'kind':point['kind'],'worldName':world,'anchor':coords,
                'owner':point.get('owner'),'title':title,'target':target,'geometry':geometry,'usage':point.get('usage','公共地点；右键选择目的地，到达才耗魔。' if public else '玩家自定坐标，并非官方副本入口；右键查看本人有权限的地点。'),
                'signLines':[title[:10],{'world':'主世界','world_nether':'下界','world_the_end':'末地','aincrad':'艾恩葛朗特'}.get(world,world)[:10],'右键打开地点目录','安全到达才耗魔'],
                'clickCommand':'/mycli menu places' if public else '/mycli waypoint menu'}
        groups[key]=marker;markers.append(marker)
    return {'schema':1,'readOnlyPlan':True,'sourcePoints':len(points),'markers':markers,'blocked':blocked,
            'installationRequirement':'native collision + walk access check; all before-images must match; protect beacon/base/sign; no replacement of later builds',
            'rollback':'restore only exact after-images; keep changed terrain, latest player state and waypoint records'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server-root',type=Path,required=True);parser.add_argument('--points',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.output.resolve().is_relative_to(args.server_root.resolve()):parser.error('Read-only planner output must be outside the server root')
    points=json.loads(args.points.read_text(encoding='utf8'));reader=Reader(args.server_root)
    result=plan(points,reader.get);args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'points':len(points),'markers':len(result['markers']),'coalesced':sum(len(m['aliases']) for m in result['markers']),'blocked':result['blocked']},ensure_ascii=False))
