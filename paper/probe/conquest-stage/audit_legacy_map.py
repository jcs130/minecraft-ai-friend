"""Read an original pre-flattening map offline; never loads/generates live chunks.

Local QA dependencies: nbtlib, numpy, Pillow. The map itself is not redistributed.
Produces a topographic inspection image and sign/chest locations for route review.
"""
import argparse, hashlib, io, json, re, zipfile, zlib
from pathlib import Path
import nbtlib
import numpy as np
from PIL import Image, ImageDraw

def main():
    p = argparse.ArgumentParser()
    p.add_argument('archive', type=Path)
    p.add_argument('output', type=Path)
    a = p.parse_args()
    if a.archive.stat().st_size > 512 * 1024**2:
        raise ValueError('Archive exceeds inspection limit')
    a.output.mkdir(parents=True, exist_ok=True)
    colors = {0:(21,28,34), 1:(111,117,124), 2:(81,128,65), 3:(112,84,57),
        4:(123,128,131), 5:(163,127,73), 7:(65,66,70), 8:(46,96,153), 9:(46,96,153),
        10:(202,73,25), 11:(202,73,25), 12:(215,206,145), 13:(127,125,122),
        17:(114,83,52), 18:(42,98,46), 20:(160,202,211), 24:(206,193,137),
        35:(213,208,199), 45:(155,81,64), 48:(104,127,93), 49:(45,31,62),
        53:(153,112,65), 67:(118,121,124), 98:(162,169,172), 109:(158,165,168)}
    with zipfile.ZipFile(a.archive) as z:
        names = [n for n in z.namelist() if re.fullmatch(r'world/region/r\.-?\d+\.-?\d+\.mca', n)]
        if not names or len(names)>128: raise ValueError('Unexpected region count')
        regions = [(int(n.split('.')[-3]),int(n.split('.')[-2])) for n in names]
        x0,z0=min(x for x,_ in regions)*512,min(z for _,z in regions)*512
        x1,z1=(max(x for x,_ in regions)+1)*512,(max(z for _,z in regions)+1)*512
        if max(x1-x0,z1-z0)>8192: raise ValueError('Map exceeds bounded preview')
        pixels=np.zeros(((z1-z0)//4,(x1-x0)//4,3),dtype=np.uint8)
        signs=[];chests=[];chunks=0
        for name in names:
            b=z.read(name)
            for i in range(0,4096,4):
                offset=int.from_bytes(b[i:i+3],'big')*4096
                if not offset: continue
                length=int.from_bytes(b[offset:offset+4],'big')
                if b[offset+4]!=2: raise ValueError('Expected zlib region')
                root=nbtlib.File.parse(io.BytesIO(zlib.decompress(b[offset+5:offset+4+length])))
                c=root.get('Level',root); chunks+=1
                x,zz=int(c['xPos'])*16,int(c['zPos'])*16
                sections={int(s['Y']):s for s in c['Sections']}
                height=c['HeightMap']
                for lz in range(0,16,4):
                    for lx in range(0,16,4):
                        y=max(0,int(height[lz*16+lx])-1);s=sections.get(y//16)
                        block=int(s['Blocks'][(y%16)*256+lz*16+lx])&255 if s else 0
                        shade=max(.6,min(1.25,.72+y/250))
                        pixels[(zz+lz-z0)//4,(x+lx-x0)//4]=[min(255,int(v*shade)) for v in colors.get(block,(145,128,114))]
                for te in c.get('TileEntities',[]):
                    kind=str(te.get('id',''));pos=[int(te[k]) for k in ('x','y','z')]
                    if kind.lower().endswith('sign'):
                        signs.append({'at':pos,'text':[str(te.get('Text'+str(j),'')) for j in range(1,5)]})
                    if 'chest' in kind.lower(): chests.append(pos)
        image=Image.fromarray(pixels);draw=ImageDraw.Draw(image)
        for x in range(x0,x1,512):
            px=(x-x0)//4;draw.line((px,0,px,image.height),fill=(80,80,80));draw.text((px+4,5),str(x),fill='white')
        for zz in range(z0,z1,512):
            py=(zz-z0)//4;draw.line((0,py,image.width,py),fill=(80,80,80));draw.text((5,py+4),str(zz),fill='white')
        image.save(a.output/'topography.png')
        report={'sha256':hashlib.sha256(a.archive.read_bytes()).hexdigest(),'bounds':[x0,z0,x1,z1],
            'regions':len(names),'chunks':chunks,'signs':signs,'chests':chests}
        (a.output/'map-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps({k:v for k,v in report.items() if k not in ('signs','chests')}))
        print('signs',len(signs),'chests',len(chests))

if __name__=='__main__': main()
