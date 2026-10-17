import type { Cell } from './geometry.ts';

/** Shared preview/execution diagnosis; never moves or changes the requested endpoint. */
export function spiralAlignmentError(start: Cell, target: Cell, projected = false): string | null {
  const run = Math.max(Math.abs(target.x - start.x), Math.abs(target.z - start.z));
  if (run === 0) return null;
  return `spiral 是垂直升降用的螺旋楼梯；${projected ? '预计起点' : '当前'}脚格 `
    + `(${start.x}, ${start.y}, ${start.z})，目标 (${target.x}, ${target.y}, ${target.z})，横向差 ${run} 格。`
    + 'at 的 X/Z 要与起点一致；goto 默认允许邻格，需要精确站位时加 exact:true，'
    + '或根据实际脚格重新选择正上/正下目标；斜通道不带 spiral。';
}
