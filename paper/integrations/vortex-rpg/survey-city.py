"""Bounded offline building survey of the separately obtained free Floor 1 map.

Outputs candidate rooms/entrances, never claims a shop or NPC already exists.
No server connection, chunk generation or world edits. Map is not redistributed.
"""
from pathlib import Path
from collections import deque,Counter
import argparse,hashlib,io,json,re,zipfile,zlib
import nbtlib,numpy as np
from PIL import Image,ImageDraw
PIN='0ddf2c3f8c767d2acdfa3be793293a47fd7cb3d45a34bb997ff9d5861970518f'
def main():
 p=argparse.ArgumentParser();p.add_argument('--archive',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 assert hashlib.sha256(a.archive.read_bytes()).hexdigest()==PIN
 x0,z0,w,h=-960,560,768,768;b=np.zeros((128,h,w),dtype=np.uint8);doors=[];chunks=0
 with zipfile.ZipFile(a.archive)as archive:
  for name in archive.namelist():
   m=re.fullmatch(r'world/region/r\.(-?\d+)\.(-?\d+)\.mca',name)
   if not m:continue
   rx,rz=map(int,m.groups())
   if rx*512>=x0+w or (rx+1)*512<=x0 or rz*512>=z0+h or (rz+1)*512<=z0:continue
   data=archive.read(name)
   for i in range(1024):
    off=int.from_bytes(data[i*4:i*4+3],'big')*4096
    if not off:continue
    cx,cz=(rx*32+i%32)*16,(rz*32+i//32)*16
    if not(x0<=cx<x0+w and z0<=cz<z0+h):continue
    length=int.from_bytes(data[off:off+4],'big');assert data[off+4]==2
    root=nbtlib.File.parse(io.BytesIO(zlib.decompress(data[off+5:off+4+length])));c=root.get('Level',root);chunks+=1
    for section in c.get('Sections',[]):
     sy=int(section['Y'])*16
     if not 0<=sy<128:continue
     blocks=np.asarray(section['Blocks']).astype(np.uint8).reshape(16,16,16)
     b[sy:sy+16,cz-z0:cz-z0+16,cx-x0:cx-x0+16]=blocks
     raw=np.asarray(section['Data']).astype(np.uint8)
     for ly,lz,lx in np.argwhere((blocks==64)|(blocks==71)):
      at=int(ly*256+lz*16+lx);meta=(int(raw[at//2])>>(4*(at%2)))&15
      if not meta&8:doors.append((int(cx+lx),int(sy+ly),int(cz+lz)))
 def block(x,y,z):return int(b[y,z-z0,x-x0])if 0<=y<128 and x0<=x<x0+w and z0<=z<z0+h else 0
 air={0,6,31,32,37,38,39,40,50,63,68,75,76,78,83,104,105,106,115,131,132,175}
 def room_cell(x,y,z):
  if not(x0<x<x0+w-1 and z0<z<z0+h-1 and 2<y<112):return False
  return block(x,y,z)in air and block(x,y+1,z)in air and block(x,y-1,z)not in air|{8,9,10,11,18,64,71} and any(block(x,yy,z)not in air|{18} for yy in range(y+2,y+15))
 groups=[];seen=set()
 for door in doors:
  x,y,z=door
  for dx,dz in[(1,0),(-1,0),(0,1),(0,-1)]:
   seed=(x+dx,y,z+dz)
   if seed in seen or not room_cell(*seed):continue
   queue=deque([seed]);cells={seed}
   while queue and len(cells)<=1200:
    xx,yy,zz=queue.popleft()
    for ddx,ddz in[(1,0),(-1,0),(0,1),(0,-1)]:
     item=(xx+ddx,yy,zz+ddz)
     if item not in cells and room_cell(*item):cells.add(item);queue.append(item)
   seen.update(cells)
   if not 8<=len(cells)<=800:continue
   nearby=Counter(block(xx+dx,yy+dy,zz+dz)for xx,yy,zz in cells for dx,dz in[(0,0),(1,0),(-1,0),(0,1),(0,-1)]for dy in[0,1])
   bbox=[min(t[0]for t in cells),y,min(t[2]for t in cells),max(t[0]for t in cells),y+2,max(t[2]for t in cells)]
   groups.append({'entrance':list(door),'inside':list(seed),'walkableRoofedCells':len(cells),'bounds':bbox,'features':{label:nearby[bid]for bid,label in[(26,'beds'),(47,'bookshelves'),(58,'crafting_tables'),(61,'furnaces'),(62,'lit_furnaces'),(145,'anvils'),(54,'chests')]if nearby[bid]},'state':'surveyed_candidate_not_operating'})
 groups.sort(key=lambda r:((r['entrance'][0]+582)**2+(r['entrance'][2]-934)**2))
 a.output.mkdir(exist_ok=False,parents=True)
 image=np.zeros((h,w,3),dtype=np.uint8)
 colors={0:(35,40,48),1:(130,135,140),2:(91,125,73),3:(110,85,65),4:(140,145,150),5:(180,140,88),8:(47,91,137),9:(47,91,137),17:(130,95,58),18:(48,96,55),20:(170,205,205),24:(211,195,147),35:(212,208,196),44:(165,150,127),98:(174,179,180)}
 for zz in range(h):
  for xx in range(w):
   column=b[:,zz,xx];ys=np.flatnonzero(column)
   image[zz,xx]=colors.get(int(column[ys[-1]])if len(ys)else 0,(159,146,126))
 picture=Image.fromarray(image).resize((1152,1152));draw=ImageDraw.Draw(picture)
 for n,g in enumerate(groups[:60]):
  x,y,z=g['entrance'];xx=(x-x0)*1.5;zz=(z-z0)*1.5;draw.ellipse((xx-3,zz-3,xx+3,zz+3),fill='red');draw.text((xx+4,zz-5),str(n+1),fill='white')
 for x in range(x0,x0+w,64):xx=(x-x0)*1.5;draw.line((xx,0,xx,1152),fill=(95,100,100));draw.text((xx+3,3),str(x),fill='white')
 for z in range(z0,z0+h,64):zz=(z-z0)*1.5;draw.line((0,zz,1152,zz),fill=(95,100,100));draw.text((3,zz+3),str(z),fill='white')
 picture.save(a.output/'city-topography.png')
 report={'archiveSha256':PIN,'cityBounds':[x0,z0,x0+w,z0+h],'chunksRead':chunks,'doorCount':len(doors),'roomCount':len(groups),'rooms':groups,'productionChanged':False,'limitations':['Roof and door geometry only; in-game routes, ownership and service activation are not inferred.','Slab/stair collision and multi-storey accessibility require a live walk-through.']}
 (a.output/'city-survey.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({k:v for k,v in report.items()if k not in['rooms','limitations']}))
if __name__=='__main__':main()
