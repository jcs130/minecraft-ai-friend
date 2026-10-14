import { readFileSync } from 'node:fs';

/** Select parameters for one fixed program; never interpolate caller text into Python. */
export function nativeInteractInput(args: Record<string, unknown>) {
  const point = (value: unknown): number[] => {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isInteger)
      || Math.abs(value[0]) > 30000000 || Math.abs(value[1]) > 2048 || Math.abs(value[2]) > 30000000)
      throw new Error('Use absolute integer [x,y,z] positions');
    return [...value];
  };
  const action = args.action ?? 'attack', holdMs = args.holdMs ?? 300, maxDistance = args.maxDistance ?? 4.5;
  if (typeof action !== 'string' || !['attack','use'].includes(action)) throw new Error('action must be attack or use');
  if (!Number.isInteger(holdMs) || Number(holdMs) < 50 || Number(holdMs) > 2000) throw new Error('holdMs must be 50..2000');
  if (typeof maxDistance !== 'number' || !Number.isFinite(maxDistance) || maxDistance < .5 || maxDistance > 8) throw new Error('maxDistance must be .5..8');
  const aimOffset = args.aimOffset ?? [.5,.5,.5], observePositions = args.observePositions ?? [];
  if (!Array.isArray(aimOffset) || aimOffset.length !== 3 || !aimOffset.every(n=>typeof n==='number' && Number.isFinite(n) && n>=0 && n<=1)) throw new Error('aimOffset must contain three 0..1 numbers');
  if (!Array.isArray(observePositions) || observePositions.length > 4) throw new Error('Observe at most four related positions');
  return {position:point(args.target),action,hold:Number(holdMs)/1000,max_distance:maxDistance,aim_offset:[...aimOffset],observe_positions:observePositions.map(point)};
}

/** Own MIT source, shipped in the package. No client helper installation or network lookup. */
export function nativeInteractProgram(): string {
  for (const relative of ['../../skills/java-client/agent_mc.py','../../../../skills/java-client/agent_mc.py']) {
    try { return readFileSync(new URL(relative,import.meta.url),'utf8') + '\nresult = interact_block(**input_data)\n'; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  throw new Error('Packaged interaction program is missing; reinstall the complete agent-mc-world package');
}
