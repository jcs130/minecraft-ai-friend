import { MOTOR_PROTOCOL, MOTOR_VERSION, motorFeatures, type MotorObservation, type Point } from './policy.ts';
export interface NativeMotorSample {
  protocol: 'agent-mc-reflex/v1';
  minecraftVersion: string;
  sampledAtMs: number;
  state: { position: Point; yaw: number };
  velocity: Point;
  onGround: boolean;
  palette: { name: string; shapes: number[][] }[];
  cells: number[][];
}
/** Extract only the local motor input. Missing cells stay unknown; no inventory, text or world truth enters features. */
export function motorObservationFromNative(sample: NativeMotorSample, goal: Point, nowMs = Date.now()): MotorObservation {
  if (sample.protocol !== 'agent-mc-reflex/v1' || sample.minecraftVersion !== MOTOR_VERSION
    || !Number.isFinite(sample.sampledAtMs) || sample.sampledAtMs > nowMs + 50 || nowMs - sample.sampledAtMs > 500
    || typeof sample.onGround !== 'boolean' || !Array.isArray(sample.cells) || !Array.isArray(sample.palette)) throw Error('Native motor frame unavailable or stale');
  const cells = new Map(sample.cells.map(cell => [cell.slice(0, 3).join(','), cell[3]]));
  const [bx, by, bz] = sample.state.position.map(Math.floor), voxels: number[] = [];
  for (let x = -3; x <= 3; x++) for (let y = -2; y <= 2; y++) for (let z = -3; z <= 3; z++) {
    const index = cells.get([bx + x, by + y, bz + z].join(','));
    const cell = index === undefined ? undefined : sample.palette[index];
    const name = cell?.name.replace(/^minecraft:/, '');
    voxels.push(cell ? 1 | (cell.shapes.length ? 2 : 0) | (name === 'lava' ? 4 : 0) | (name === 'lava' || name === 'water' ? 8 : 0) : 0);
  }
  const observation: MotorObservation = { protocol: MOTOR_PROTOCOL, minecraftVersion: MOTOR_VERSION, tick: null,
    position: [...sample.state.position], velocity: [...sample.velocity], yaw: Math.PI - sample.state.yaw * Math.PI / 180,
    onGround: sample.onGround, goal: [...goal], goalMode: 'final-target', voxels };
  motorFeatures(observation);
  return observation;
}
