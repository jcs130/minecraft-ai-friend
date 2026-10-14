import type { JavaClientState } from '../contracts/java-client.ts';

export const JAVA_LEGACY_HELP = `Compatibility: mc_do also accepts ONE legacy steps:[{skill,...}] command. Supported: chat(text), control(keys,durationMs; ground only), look(at:[absolute x,y,z]), equip(item; main hand hotbar only), eat(item already held), use(with no target/options; held item). Explicit queue append/now supported; the native default preserves queued work. Each converts to one native operation with the SAME action_id and original terminal receipt. Multiple steps, dependencies/expect, navigation, mining, crafting, scripts, offhand/armor and flight planning require a native execution backend and are rejected before dispatch; never simulate success. Query mc_operations for native primitives.`;
const fail = (why: string): never => { throw new Error('Legacy command unavailable: ' + why + '. Query mc_help / mc_operations.'); };
/** Pure translation only. No network, queue, retry, model or inferred route. */
export function translateJavaLegacy(args: Record<string, unknown>, state: JavaClientState) {
  if (!Array.isArray(args.steps) || args.steps.length !== 1) fail('submit exactly one supported step; multi-step programs are not yet supported');
  if (args.operation !== undefined || args.input !== undefined) fail('choose steps OR operation/input');
  if (args.queue !== undefined && !['append', 'now'].includes(String(args.queue))) fail('only append/now queue modes');
  const step = (args.steps as unknown[])[0] as Record<string, unknown>;
  if (!step || typeof step !== 'object' || Array.isArray(step)) fail('invalid step');
  const allowed: Record<string, string[]> = { chat: ['text'], control: ['keys', 'durationMs', 'mode'], look: ['at'], equip: ['item', 'hand'], eat: ['item'], use: [] };
  const skill = String(step.skill);
  if (!allowed[skill]) fail('skill ' + skill + ' needs a native executor');
  if (Object.keys(step).some(key => key !== 'skill' && !allowed[skill].includes(key))) fail('unsupported step options/dependencies');
  let operation: string, input: Record<string, unknown>;
  if (skill === 'chat') { operation = 'chat'; input = { text: step.text }; }
  else if (skill === 'control') {
    const keys = ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'];
    if (!Array.isArray(step.keys) || !step.keys.every(key => keys.includes(String(key))) || step.mode && step.mode !== 'ground') fail('control keys or mode');
    const ms = Number(step.durationMs ?? 500);
    if (!Number.isInteger(ms) || ms < 50 || ms > 10000 || ms % 50 !== 0) fail('durationMs must be 50..10000, a multiple of 50');
    operation = 'move'; input = { ...Object.fromEntries(keys.map(key => [key, (step.keys as string[]).includes(key)])), ticks: ms / 50 };
  } else if (skill === 'look') {
    if (!Array.isArray(step.at) || step.at.length !== 3 || !step.at.every(v => typeof v === 'number' && Number.isFinite(v)) || !state.position) fail('look requires absolute [x,y,z] and current position');
    const [x, y, z] = step.at as number[], [sx, sy, sz] = state.position!;
    const dx = x + .5 - sx, dy = y + .5 - (sy + 1.62), dz = z + .5 - sz;
    operation = 'look'; input = { yaw: Math.atan2(-dx, dz) * 180 / Math.PI, pitch: -Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI };
  } else if (skill === 'equip' || skill === 'eat') {
    if (step.hand && step.hand !== 'main' || typeof step.item !== 'string' || !step.item) fail('named main-hand hotbar item required');
    const id = step.item as string, inventory = state.inventory as Array<Record<string, unknown>> | undefined;
    const matches = inventory?.filter(item => !item.empty && Number(item.slot) >= 0 && Number(item.slot) <= 8 && (item.name === id || item.name === 'minecraft:' + id || item.displayName === id)) ?? [];
    if (matches.length !== 1) fail('item must uniquely match a hotbar slot; use mc_bag/menu_click for other slots');
    if (skill === 'eat' && matches[0].slot !== state.selectedSlot) fail('equip the food first');
    operation = skill === 'equip' ? 'hotbar' : 'use'; input = skill === 'equip' ? { slot: matches[0].slot } : { ticks: 40 };
  } else { operation = 'use'; input = { ticks: 1 }; }
  return { ...args, operation, input, steps: undefined };
}
