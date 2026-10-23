/** Fixed, read-only program through the optional executor; no host model or implicit body inputs. */
export function nativeProbeInput(args: Record<string, unknown>) {
  const integer = (key:string, fallback:number, maximum:number) => {const v=args[key]??fallback;if(!Number.isInteger(v)||Number(v)<0||Number(v)>maximum)throw new Error(`Invalid ${key}`);return Number(v);};
  const radius=integer('radius',3,6),below=integer('below',1,3),above=integer('above',2,3),limit=integer('limit',12,32);
  if(limit<1)throw new Error('limit must be 1..32');
  const names=args.names??[];
  if(!Array.isArray(names)||names.length>16||!names.every(n=>typeof n==='string'&&/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(n)))throw new Error('Use namespaced block IDs in names');
  let positions: number[][]|undefined;
  if(args.positions!==undefined){
    if(['radius','below','above'].some(k=>args[k]!==undefined))throw new Error('Use absolute positions OR nearby radius/below/above');
    const points=args.positions;
    if(!Array.isArray(points)||points.length<1||points.length>512||!points.every(p=>Array.isArray(p)&&p.length===3&&p.every((n:unknown)=>Number.isInteger(n))&&Math.abs(p[0])<=30000000&&Math.abs(p[2])<=30000000&&Math.abs(p[1])<=2048))throw new Error('positions must contain 1..512 absolute integer [x,y,z] coordinates');
    positions=points;
  }
  return {radius,below,above,limit,names,...(positions?{positions}:{})};
}
export const NATIVE_PROBE_PROGRAM = `import math, datetime
p = [math.floor(v) for v in minescript.player_position()]
d = input_data
points = d.get('positions')
if points is None:
    r = d['radius']
    points = [[x,y,z] for x in range(p[0]-r,p[0]+r+1) for y in range(p[1]-d['below'],p[1]+d['above']+1) for z in range(p[2]-r,p[2]+r+1)]
    points.sort(key=lambda q: sum((q[i]-p[i])**2 for i in range(3)))
wanted = set(d['names'])
matches, count, unknown = [], 0, 0
for start in range(0,len(points),256):
    batch = points[start:start+256]
    values = minescript.getblocklist(batch)
    if len(values) != len(batch): raise RuntimeError('Incomplete block batch; unknown positions are not air')
    for pos,raw in zip(batch,values):
        name,sep,tail = raw.partition('[')
        if name == 'minecraft:void_air': unknown += 1
        if (wanted and name not in wanted) or (not wanted and name in ('minecraft:air','minecraft:cave_air','minecraft:void_air')): continue
        count += 1
        if len(matches) < d['limit']:
            props = dict(part.split('=',1) for part in tail.rstrip(']').split(',') if '=' in part) if sep else {}
            matches.append({'position':pos,'name':name,'properties':props,'raw':raw})
result = {'origin':p,'checked':len(points),'count':count,'blocks':matches,'unknownCount':unknown,'truncated':count>len(matches),'sampledAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'minescript4.client_cache','serverConfirmed':False}
`;
