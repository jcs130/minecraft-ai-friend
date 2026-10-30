import type { FamiliarAction } from '../contracts/host.ts';
import type { JavaClientState } from '../contracts/java-client.ts';
import { translateJavaLegacy } from './java-legacy.ts';
import { navigationGoal } from '../../core/navigation-goal.ts';
import { RISKY_FOODS } from '../../core/nutrition.ts';
const familiar = new Set(['goto', 'look', 'equip', 'eat', 'fish', 'surface', 'flee']);
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Pure recognition of exact caller-authorized work. No action, model or input rewrite. */
export function familiarStepAction(args: Record<string, unknown>): FamiliarAction | null {
  if (Object.keys(args).some(k => !['steps', 'queue', 'action_id', 'waitMs'].includes(k))
    || args.queue !== undefined && args.queue !== 'append' || args.action_id !== undefined && (typeof args.action_id !== 'string' || !args.action_id)
    || args.waitMs !== undefined && (!Number.isInteger(args.waitMs) || Number(args.waitMs) < 0 || Number(args.waitMs) > 2000)
    || !Array.isArray(args.steps) || !args.steps.length || args.steps.length > 4) return null;
  for (const s of args.steps) {
    if (!plain(s) || !familiar.has(String(s.skill)) || s.dryRun === true || ['command', 'script', 'text', 'queue'].some(k => k in s)
      || Buffer.byteLength(JSON.stringify(s)) > 1800) return null;
    if (s.skill === 'goto' && (!Array.isArray(s.at) || s.at.length !== 3 || !s.at.every(finite) || s.walkOnly !== true)) return null;
    if (s.skill === 'eat' && (typeof s.item !== 'string' || RISKY_FOODS.has(s.item.replace(/^minecraft:/, '')))) return null;
  }
  return { steps: structuredClone(args.steps), command: structuredClone(args),
    label: 'Planner-authorized familiar operation', condition: 'Execute these exact authorized steps only when fresh body, queue, equipment and target facts permit them; escalate danger, missing facts or a failed prerequisite.' };
}
/** Native primitives retain their action_id/input; semantic steps are decision metadata only. */
export function nativeFamiliarAction(args: Record<string, unknown>, state: JavaClientState | null): FamiliarAction | null {
  if (!state?.connected) return null;
  if (args.steps !== undefined) {
    const candidate = familiarStepAction(args); if (!candidate) return null;
    try { translateJavaLegacy(args, state); return candidate; } catch { return null; }
  }
  if (Object.keys(args).some(k => !['operation', 'input', 'action_id', 'queue', 'waitMs'].includes(k))
    || args.queue !== undefined && args.queue !== 'append' || !plain(args.input)
    || args.action_id !== undefined && (typeof args.action_id !== 'string' || !args.action_id)
    || args.waitMs !== undefined && (!Number.isInteger(args.waitMs) || Number(args.waitMs) < 0 || Number(args.waitMs) > 2000)) return null;
  const input = args.input, inventory = Array.isArray(state.inventory) ? state.inventory as Record<string, unknown>[] : [];
  let step: Record<string, unknown> | null = null;
  if (args.operation === 'navigate') {
    const goal = input.goal;
    if (state.navigationCapability !== 'agent-mc-navigation/v1' || !plain(goal)
      || Object.keys(input).some(k => !['goal', 'timeoutMs'].includes(k))
      || Object.keys(goal).some(k => !['x', 'y', 'z', 'rangeSq'].includes(k))
      || !['x', 'y', 'z'].every(k => finite(goal[k]) && Number.isInteger(goal[k]) && Math.abs(Number(goal[k])) <= 30_000_000)
      || input.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || Number(input.timeoutMs) < 1000 || Number(input.timeoutMs) > 120000)) return null;
    try { navigationGoal(goal); } catch { return null; }
    step = { skill: 'goto', at: [goal.x, goal.y, goal.z], walkOnly: true, exact: !goal.rangeSq,
      arrivalRange: Math.sqrt(Number(goal.rangeSq ?? 0)),
      ...(typeof state.dimension === 'string' ? { dimension: state.dimension } : {}) };
  } else if (args.operation === 'hotbar' || args.operation === 'equip') {
    if (args.operation === 'hotbar' && input.instanceHash !== undefined) return null;
    if (Object.keys(input).some(k => !['slot', 'instanceHash'].includes(k)) || !Number.isInteger(input.slot)
      || Number(input.slot) < 0 || Number(input.slot) > (args.operation === 'hotbar' ? 8 : 35)) return null;
    const item = inventory.find(i => i.slot === input.slot && i.empty === false && typeof i.name === 'string');
    if (!item || args.operation === 'equip' && (state.inventoryPick !== 'agent-mc-inventory-pick/v1'
      || typeof input.instanceHash !== 'string' || item.instanceHash !== input.instanceHash)) return null;
    step = { skill: 'equip', item: item.name, hand: 'main' };
  } else if (args.operation === 'look') {
    if (Object.keys(input).some(k => !['yaw', 'pitch'].includes(k)) || !finite(input.yaw) || Math.abs(input.yaw) > 180
      || !finite(input.pitch) || Math.abs(input.pitch) > 90) return null;
    step = { skill: 'look', yawDeg: input.yaw, pitchDeg: input.pitch };
  }
  if (!step) return null;
  return { steps: [step], command: structuredClone(args), label: `Planner-authorized ${step.skill}`,
    condition: 'The planner selected this exact native command and target. Check fresh body, queue, gear, safety and target validity; execute once without changing its action ID or parameters. Escalate unknown or changed prerequisites.' };
}
