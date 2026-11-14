/** Bounded local operator controls routed through the normal Agent action queue. No eval/chat endpoint. */
export function operatorPlaySteps(action: string, input: unknown): Record<string, unknown>[] | null {
  if (!action.startsWith('play.')) return null;
  const args = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const keys = Object.keys(args);
  if (action === 'play.menu') {
    if (keys.length) throw Error('Menu takes no arguments');
    return [{ skill: 'chat', text: '/menu' }];
  }
  if (action === 'play.look') {
    if (keys.some(key => !['yawDeg', 'pitchDeg'].includes(key))) throw Error('Unknown look input');
    const yaw = args.yawDeg ?? 0, pitch = args.pitchDeg ?? 0;
    if (typeof yaw !== 'number' || !Number.isFinite(yaw) || Math.abs(yaw) > 180
      || typeof pitch !== 'number' || !Number.isFinite(pitch) || Math.abs(pitch) > 90) throw Error('Look angle out of range');
    return [{ skill: 'control', mode: 'ground', keys: [], durationMs: 100,
      orientation: 'relative', yawDeg: yaw, pitchDeg: pitch }];
  }
  if (action === 'play.walk') {
    if (keys.some(key => !['direction', 'durationMs'].includes(key))) throw Error('Unknown walk input');
    const direction = args.direction ?? 'forward', duration = args.durationMs ?? 250;
    if (!['forward', 'back', 'left', 'right'].includes(String(direction))
      || typeof duration !== 'number' || !Number.isInteger(duration) || duration < 50 || duration > 500) throw Error('Bounded ground walk only (50–500ms)');
    return [{ skill: 'control', mode: 'ground', keys: [direction], durationMs: duration }];
  }
  if (action === 'play.close') {
    if (keys.length) throw Error('Close takes no arguments');
    return [];
  }
  throw Error('Unknown local play action');
}
