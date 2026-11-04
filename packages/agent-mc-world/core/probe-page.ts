import type { Bot } from 'mineflayer';
import type { SkillCall } from './skills.ts';
import { resolveAt, shapeCells } from './cell-facts.ts';
import { SkillBlocked } from './skill-context.ts';

type Probe = Extract<SkillCall, { skill: 'probe' }>;
type Box = [number, number, number, number, number, number];
const volume = (b: Box) => (b[3]-b[0]+1)*(b[4]-b[1]+1)*(b[5]-b[2]+1);

/** Read-only paging. Shared write-skill shape limits are deliberately unchanged. */
export function probePage(bot: Bot, call: Probe, cap: number, observedAt: string) {
  if (call.shape !== 'box' || call.fill && call.fill !== 'solid' || call.anchors.length !== 2) {
    return {partial: false, cells: shapeCells(bot,call.shape,call.anchors,call.fill,cap), wrap: (text:string,_unknown:number) => text};
  }
  const [a,b] = call.anchors.map(anchor => resolveAt(bot,anchor));
  const requested: Box = [Math.min(a.x,b.x),Math.min(a.y,b.y),Math.min(a.z,b.z),Math.max(a.x,b.x),Math.max(a.y,b.y),Math.max(a.z,b.z)];
  const count = volume(requested);
  if (!Number.isSafeInteger(count)) throw new SkillBlocked('probe 请求格数超出安全整数范围；尚未读取，请缩小范围');
  if (count <= cap) return {partial: false, cells: shapeCells(bot,call.shape,call.anchors,call.fill,cap), wrap: (text:string,_unknown:number) => text};
  const [x,y,z,xmax,ymax,zmax] = requested;
  const width=xmax-x+1,depth=zmax-z+1;
  const w=Math.min(width,cap),d=w===width?Math.min(depth,Math.floor(cap/w)):1;
  const h=w===width&&d===depth?Math.min(ymax-y+1,Math.floor(cap/(w*d))):1;
  const returned: Box=[x,y,z,x+w-1,y+h-1,z+d-1];
  // Disjoint slabs covering exactly the unscanned complement. All coordinates
  // are absolute, so a later caller move cannot silently shift the query.
  const remaining: Box[]=[];
  if(w<width) remaining.push([x+w,y,z,xmax,y+h-1,z+d-1]);
  if(d<depth) remaining.push([x,y,z+d,xmax,y+h-1,zmax]);
  if(y+h<=ymax) remaining.push([x,y+h,z,xmax,ymax,zmax]);
  const anchors = [returned.slice(0,3),returned.slice(3)] as [number,number,number][];
  const cells = shapeCells(bot,'box',anchors,'solid',cap);
  return {partial:true,cells,wrap(text:string,unknown:number) {
    return JSON.stringify({kind:'probe',status:'partial',complete:false,reason:'cell_budget',
      warning:`扫描超限：本次已读取 ${cells.length}/${count} 格；以下结果仅属于已扫描范围，未扫描或未观察的格不能排除目标存在。`,
      observedAt,dimension:bot.game?.dimension??null,
      coverage:{coordinateFrame:'absolute block coordinates; inclusive bounds',requestedBounds:requested,requestedCount:count,
        returnedBounds:returned,returnedCount:cells.length,observedCount:cells.length-unknown,unknownCount:unknown,
        remainingCount:count-cells.length,remainingRegions:remaining,coverageComplete:false},
      result:text,next:remaining.map(bounds=>({tool:'mc_scout',arguments:{steps:[{...call,
        anchors:[bounds.slice(0,3),bounds.slice(3)]}]}})),
      note:'续读由调用者决定；每次重新观察当时可见数据，不自动扫描，也不是同一时刻的全量快照。'});
  }};
}
