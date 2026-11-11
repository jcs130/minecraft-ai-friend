/** Explicit local polyline, not another path search. */
export interface WalkRoute {
 waypoints:{at:[number,number,number];posture:'walk'|'sneak'|'sprint'}[];
 avoid:[number,number,number][];avoidBlocks:string[];radius:number;timeoutMs:number;
 dimension?:string;dryRun?:true;
}
const pointSchema={type:'array',items:{type:'number'},minItems:3,maxItems:3};
export const WALK_ROUTE_FIELDS={
 waypoints:{type:'array',minItems:1,maxItems:32,items:{type:'object',properties:{at:pointSchema,posture:{type:'string',enum:['walk','sneak','sprint']}},required:['at'],additionalProperties:false}},
 avoid:{type:'array',maxItems:128,items:{...pointSchema,items:{type:'integer'}}},
 avoidBlocks:{type:'array',maxItems:32,items:{type:'string',maxLength:80}},
 radius:{type:'number',minimum:.06,maximum:.25,default:.12},
 timeoutMs:{type:'integer',minimum:500,maximum:120000,default:30000},
};
export function parseWalkRoute(c:Record<string,unknown>):WalkRoute|{error:string}{
 const point=(p:unknown):p is [number,number,number]=>Array.isArray(p)&&p.length===3&&p.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=30000000);
 if(!Array.isArray(c.waypoints)||!c.waypoints.length||c.waypoints.length>32)return {error:'follow_route.waypoints 要1–32个绝对脚坐标路点；不加0.5、不取整'};
 const waypoints:WalkRoute['waypoints']=[];
 for(const p of c.waypoints){
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['at','posture'].includes(k))||!point(p.at)||!['walk','sneak','sprint'].includes(p.posture??'walk'))return {error:'路点形如 {at:[x,y,z],posture:"sneak"}；posture控制走向这个点的一段'};
  waypoints.push({at:[...p.at] as [number,number,number],posture:p.posture??'walk'});
 }
 const avoid=c.avoid??[],avoidBlocks=c.avoidBlocks??[],radius=c.radius??.12,timeoutMs=c.timeoutMs??30000;
 if(!Array.isArray(avoid)||avoid.length>128||!avoid.every(p=>point(p)&&p.every(Number.isInteger)))return {error:'avoid 要最多128个绝对方块坐标 [整数x,整数y,整数z]'};
 if(!Array.isArray(avoidBlocks)||avoidBlocks.length>32||!avoidBlocks.every(p=>typeof p==='string'&&/^(?:minecraft:)?[a-z0-9_]{1,64}$/.test(p)))return {error:'avoidBlocks 要最多32个准确方块ID，不支持类别'};
 if(typeof radius!=='number'||!Number.isFinite(radius)||radius<.06||radius>.25)return {error:'radius 要0.06–0.25格'};
 if(!Number.isSafeInteger(timeoutMs)||Number(timeoutMs)<500||Number(timeoutMs)>120000)return {error:'timeoutMs 要500–120000整数毫秒'};
 if(c.dimension!==undefined&&(typeof c.dimension!=='string'||!c.dimension.trim()))return {error:'dimension 要当前维度名称'};
 if(c.dryRun!==undefined&&typeof c.dryRun!=='boolean')return {error:'dryRun 要布尔值'};
 return {waypoints,avoid:avoid.map(p=>[...p] as [number,number,number]),avoidBlocks:[...new Set(avoidBlocks.map(s=>s.replace(/^minecraft:/,'')))],radius,timeoutMs:Number(timeoutMs),
  ...(typeof c.dimension==='string'?{dimension:c.dimension}:{}),...(c.dryRun===true?{dryRun:true}:{})};
}
