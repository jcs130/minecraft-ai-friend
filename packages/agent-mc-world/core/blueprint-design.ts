import { blockIdOf, isAirState, isStructureVoidState, type NormalizedBlueprint } from './blueprint.ts';
import { blueprintCollisionShapes } from './blueprint-registry.ts';

/** Design-only measurements; neither beauty scores nor evidence of the current world. */
export function reviewBlueprintDesign(blueprint: NormalizedBlueprint): Array<{ path: string; state: string; reason: string; cells: number }> {
  const [sx, sy, sz] = blueprint.size_xyz;
  if (sx * sy * sz > 32768) return [{ path: 'layers', state: '', cells: 1,
    reason: '空间与外观复核超过 32768 格预算，本次未验证；按局部区域读取，不能把格式受理当成通行或美观验收。' }];
  const at = (x: number, y: number, z: number): string | null => blueprint.layers[y]?.[z]?.[x] ?? null;
  const solid = (s: string | null): s is string => !!s && !isAirState(s) && !isStructureVoidState(s);
  const palette = new Map<string, number>();
  const tops = new Set<number>();
  let placed = 0, unknown = 0, low = 0, lowExample = '';
  const faces = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    let top: number | null = null;
    for (let y = 0; y < sy; y++) {
      const state = at(x, y, z)!;
      if (isStructureVoidState(state)) { unknown++; continue; }
      if (solid(state)) {
        placed++; top = y;
        if (faces.some(([dx,dy,dz]) => { const next = at(x+dx,y+dy,z+dz); return next === null || isAirState(next); })) {
          const id = blockIdOf(state); palette.set(id, (palette.get(id) ?? 0) + 1);
        }
      }
      if (!isAirState(state)) continue;
      const floor = at(x, y-1, z), head = at(x, y+1, z);
      if (!solid(floor) || !solid(head)) continue;
      // Only a known full supporting cube; partial floors and unknown retrofit cells need live sites/rays.
      if (!blueprintCollisionShapes(floor)?.some(s => s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 1 && s[4] === 1 && s[5] === 1)) continue;
      const blocked = blueprintCollisionShapes(head)?.some(s => s[0] < .8 && s[3] > .2 && s[2] < .8 && s[5] > .2 && 1 + s[1] < 1.8 && s[4] > 0);
      if (blocked) { low++; lowExample ||= `局部(${x},${y},${z})`; }
    }
    if (top !== null) tops.add(top);
  }
  const out: ReturnType<typeof reviewBlueprintDesign> = [];
  if (low) out.push({ path: lowExample, state: '', cells: 1,
    reason: `图内 ${low} 个有完整地板的空气格，头顶碰撞净空不足 1.8 格，首处 ${lowExample}；若作为门口、房间或通道应修改，若是装饰孔洞可保留。这里只检查图内几何，未验证现场路线。` });
  if (placed >= 16) {
    const colors = [...palette].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0]));
    const total = colors.reduce((n,[,count]) => n+count,0);
    const main = colors[0];
    out.push({ path: 'size_xyz', state: '', cells: 1,
      reason: `设计复核（不是当前世界读数）：长宽高 X/Z/Y=${sx}/${sz}/${sy}；图内外壳 ${colors.length} 种材料`
        + (main ? `，${main[0]} 约 ${Math.round(main[1]/total*100)}%` : '')
        + `；各列顶面共有 ${tops.size} 个高度。${unknown ? `${unknown} 格 structure_void 为现场未知。` : ''}`
        + '结合用途核对比例、主辅材、立面层次与屋顶轮廓；单色、对称或平顶均不自动判差。开工前测入口/净空，完成后从常用视角看实景、核对通行并清理临时垫脚。' });
  }
  return out;
}
