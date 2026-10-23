export const MOTOR_PROTOCOL = 'agent-mc-motor/v1';
export const MOTOR_VERSION = '1.21.1';
export const GRID = [7, 5, 7] as const;
export const ACTION_TICKS = 2;
export const FEATURE_COUNT = GRID[0] * GRID[1] * GRID[2] * 4 + 13;
export type Point = [number, number, number];
export type MotorGoalMode = 'final-target' | 'teacher-waypoint';
export interface MotorAction { name: string; yawDelta: number; forward?: boolean; jump?: boolean; sprint?: boolean }
export const MOTOR_ACTIONS: readonly MotorAction[] = Object.freeze([
  { name: 'idle', yawDelta: 0 },
  { name: 'turn-left', yawDelta: Math.PI / 3 }, { name: 'turn-right', yawDelta: -Math.PI / 3 },
  ...[-Math.PI / 6, 0, Math.PI / 6].flatMap(yawDelta => [
    { name: `walk:${yawDelta}`, yawDelta, forward: true },
    { name: `jump:${yawDelta}`, yawDelta, forward: true, jump: true },
    { name: `sprint:${yawDelta}`, yawDelta, forward: true, sprint: true },
    { name: `sprint-jump:${yawDelta}`, yawDelta, forward: true, sprint: true, jump: true },
  ]),
]);
export interface MotorObservation {
  protocol: typeof MOTOR_PROTOCOL;
  minecraftVersion: string;
  /** Simulation tick; native samples without a client tick retain null. */
  tick: number | null;
  position: Point;
  velocity: Point;
  /** Prismarine yaw, radians. Java yaw is Math.PI - degrees * Math.PI / 180. */
  yaw: number;
  onGround: boolean;
  goal: Point;
  /** Explicit for new policies; omitted only by historical waypoint recordings. */
  goalMode?: MotorGoalMode;
  /** x/y/z order, centred at floor(position), y offsets -2..2. Bits: known=1, solid=2, hazard=4, liquid=8. */
  voxels: number[];
}
export function motorFeatures(o: MotorObservation): number[] {
  if (o.protocol !== MOTOR_PROTOCOL || o.minecraftVersion !== MOTOR_VERSION || o.voxels.length !== GRID[0] * GRID[1] * GRID[2]
    || o.position.length !== 3 || o.velocity.length !== 3 || o.goal.length !== 3 || typeof o.onGround !== 'boolean'
    || (o.tick !== null && (!Number.isSafeInteger(o.tick) || o.tick < 0))
    || ![...o.position, ...o.velocity, ...o.goal, o.yaw].every(Number.isFinite)
    || !o.voxels.every(v => Number.isInteger(v) && v >= 0 && v <= 15)) throw Error('Invalid motor observation');
  const features = o.voxels.flatMap(v => [v & 1 ? 1 : 0, v & 2 ? 1 : 0, v & 4 ? 1 : 0, v & 8 ? 1 : 0]);
  features.push(...o.goal.map((v, i) => Math.max(-1, Math.min(1, (v - o.position[i]) / 8))),
    ...o.velocity, Math.sin(o.yaw), Math.cos(o.yaw), o.onGround ? 1 : 0,
    ...o.position.map(v => v - Math.floor(v)), Math.min(1, Math.hypot(o.goal[0] - o.position[0], o.goal[2] - o.position[2]) / 8));
  return features;
}
export interface MotorPolicy {
  protocol: typeof MOTOR_PROTOCOL;
  minecraftVersion: typeof MOTOR_VERSION;
  featureCount: number;
  actionNames: string[];
  goalMode?: MotorGoalMode;
  inputTransform?: 'goal-heading-v1';
  normalization?: { mean: number[]; scale: number[] };
  layers: { weight: number[][]; bias: number[] }[];
  training: { method: string; datasetSha256: string; deploymentApproved: false };
}
export function validateMotorPolicy(model: MotorPolicy): void {
  if (model.protocol !== MOTOR_PROTOCOL || model.minecraftVersion !== MOTOR_VERSION || model.featureCount !== FEATURE_COUNT
    || JSON.stringify(model.actionNames) !== JSON.stringify(MOTOR_ACTIONS.map(a => a.name))
    || model.training?.deploymentApproved !== false || !/^[a-f0-9]{64}$/.test(model.training.datasetSha256)
    || !Array.isArray(model.layers) || model.layers.length < 1 || model.layers.length > 4) throw Error('Motor policy contract mismatch');
  if (model.inputTransform !== undefined && model.inputTransform !== 'goal-heading-v1') throw Error('Unknown motor input transform');
  if (model.goalMode !== undefined && !['final-target', 'teacher-waypoint'].includes(model.goalMode)) throw Error('Unknown motor goal mode');
  let width = FEATURE_COUNT + (model.inputTransform ? 2 : 0);
  if (model.normalization && (model.normalization.mean.length !== width || model.normalization.scale.length !== width
    || !model.normalization.mean.every(Number.isFinite) || !model.normalization.scale.every(v => Number.isFinite(v) && v >= .01))) throw Error('Invalid motor normalization');
  for (const layer of model.layers) {
    if (!Array.isArray(layer.weight) || !layer.weight.length || layer.weight.length > 512 || layer.bias.length !== layer.weight.length
      || !layer.bias.every(Number.isFinite) || !layer.weight.every(row => row.length === width && row.every(Number.isFinite))) throw Error('Invalid motor policy layer');
    width = layer.bias.length;
  }
  if (width !== MOTOR_ACTIONS.length) throw Error('Motor policy action head mismatch');
}
/** Validate once when loading; evaluate observations without invoking a language model. */
export function loadMotorPolicy(model: MotorPolicy): (observation: MotorObservation) => number {
  validateMotorPolicy(model);
  return observation => {
    if (model.goalMode && model.goalMode !== observation.goalMode) throw Error('Motor policy goal mode mismatch');
    let values = motorFeatures(observation);
    if (model.inputTransform === 'goal-heading-v1') {
      const offset = FEATURE_COUNT - 13, dx = values[offset], dz = values[offset + 2], sy = values[offset + 6], cy = values[offset + 7], d = Math.max(1e-6, Math.hypot(dx, dz));
      values.push((-dx * cy + dz * sy) / d, (-dx * sy - dz * cy) / d);
    }
    if (model.normalization) values = values.map((v, i) => (v - model.normalization!.mean[i]) / model.normalization!.scale[i]);
    for (let n = 0; n < model.layers.length; n++) {
      const layer = model.layers[n];
      values = layer.weight.map((row, i) => {
        let value = layer.bias[i];
        for (let j = 0; j < row.length; j++) value += row[j] * values[j];
        return n + 1 < model.layers.length ? Math.max(0, value) : value;
      });
    }
    return values.indexOf(Math.max(...values));
  };
}
