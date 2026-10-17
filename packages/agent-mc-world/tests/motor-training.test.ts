import { describe, expect, it } from 'vitest';
import { MOTOR_ACTIONS, FEATURE_COUNT, MOTOR_PROTOCOL, motorFeatures, loadMotorPolicy, motorObservationFromNative, type MotorPolicy } from '../src/motor/index.ts';
import { MotorSimulator, TASKS } from '../src/motor/simulator.ts';

describe('offline motor fixtures', () => {
  it.each(TASKS)('closes the %s loop with actual Prismarine physics and no model calls', task => {
    const env = new MotorSimulator(task, 9101);
    const initialBlocks = JSON.stringify(env.truth().blocks);
    while (!env.terminal) { const observation = env.observation(); env.step(env.teacher(observation)); }
    expect(env.success, JSON.stringify({ task, failure: env.failure })).toBe(true);
    expect(env.travelled).toBeGreaterThan(3);
    if (task === 'recovery') expect(JSON.stringify(env.truth().blocks)).not.toBe(initialBlocks);
  });
  it('does not count an idle body as successful or infer progress from ticks', () => {
    const env = new MotorSimulator('walk', 9101);
    while (!env.terminal) env.step(0);
    expect(env.success).toBe(false);
    expect(env.failure).toBe('timeout');
    expect(env.travelled).toBe(0);
  });
  it('replays the same seed and actions to the same measured state', () => {
    const a = new MotorSimulator('gap', 9102), b = new MotorSimulator('gap', 9102);
    for (let i = 0; i < 12; i++) { const action = a.teacher(); a.step(action); b.step(action); }
    expect(a.observation()).toEqual(b.observation());
  });
});

it('preserves unknown native voxels and excludes unrelated sample data', () => {
  const frame = { protocol: 'agent-mc-reflex/v1' as const, minecraftVersion: '1.21.1', sampledAtMs: 1000,
    state: { position: [0.5, 64, 0.5] as [number, number, number], yaw: 90 }, velocity: [0, 0, 0] as [number, number, number], onGround: true,
    cells: [[0, 63, 0, 0]], palette: [{ name: 'minecraft:stone', shapes: [[0, 0, 0, 1, 1, 1]] }], privateText: 'not motor input' };
  const observation = motorObservationFromNative(frame, [4, 64, 0], 1100);
  expect(observation.voxels.filter(v => v === 3)).toHaveLength(1);
  expect(observation.voxels.filter(v => v === 0)).toHaveLength(244);
  expect(observation.yaw).toBeCloseTo(Math.PI / 2);
  expect(observation.tick).toBeNull();
  expect(motorFeatures(observation)).toHaveLength(FEATURE_COUNT);
  expect(JSON.stringify(observation)).not.toContain('privateText');
  expect(() => motorObservationFromNative(frame, [4, 64, 0], 1600)).toThrow(/stale/);
});

it('loads portable weights but rejects incompatible or non-finite policy data', () => {
  const model: MotorPolicy = { protocol: MOTOR_PROTOCOL, minecraftVersion: '1.21.1', featureCount: FEATURE_COUNT,
    actionNames: MOTOR_ACTIONS.map(a => a.name), training: { method: 'test', datasetSha256: 'a'.repeat(64), deploymentApproved: false },
    layers: [{ weight: MOTOR_ACTIONS.map(() => Array(FEATURE_COUNT).fill(0)), bias: MOTOR_ACTIONS.map((_, i) => i === 3 ? 1 : 0) }] };
  const policy = loadMotorPolicy(model);
  expect(policy(new MotorSimulator('walk', 9101).observation())).toBe(3);
  const broken = structuredClone(model); broken.layers[0].weight[0][0] = NaN;
  expect(() => loadMotorPolicy(broken)).toThrow(/layer/);
  expect(() => loadMotorPolicy({ ...model, actionNames: ['different'] })).toThrow(/mismatch/);
});
