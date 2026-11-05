/** Exact branches, shared by direct engines, SDK and IPC descriptors. */
export function methodLearningCall(args: Record<string, unknown>): boolean {
  if(args.scene&&typeof args.scene==='object'&&!Array.isArray(args.scene))return Object.keys(args).length===1&&['capture','list','read'].includes(String((args.scene as Record<string,unknown>).op));
  const keys=Object.keys(args);
  if(args.library && typeof args.library==='object' && !Array.isArray(args.library))
    return keys.length===1 && ['list','read','save','evidence','review','adopt'].includes(String((args.library as {op?:unknown}).op));
  if(args.validate===true) return keys.every(k=>['validate','name','code','params','durationMs','procedure','waitMs'].includes(k));
  if(!keys.length)return true;
  if(args.runId!==undefined)return keys.every(k=>['runId','call'].includes(k));
  if(args.api!==undefined)return keys.length===1;
  if(args.find!==undefined)return keys.every(k=>['find','waitMs'].includes(k));
  const routine=args.routine as {op?:unknown}|undefined;
  return keys.length===1 && !!routine && ['list','read'].includes(String(routine.op));
}
