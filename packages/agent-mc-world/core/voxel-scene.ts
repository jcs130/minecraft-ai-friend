import { VOXEL_SCENE_PROTOCOL, type SceneBlockType, type ScenePoint, type SceneShape, type VoxelScene } from '../src/contracts/voxel-scene.ts';
import {createRequire} from 'node:module';
import type {VanillaBlockRegistry} from '../src/contracts/voxel-scene.ts';
export * from '../src/contracts/voxel-scene.ts';
/** Explicit vanilla edition/version registry; it never substitutes a mod/server rendering registry. */
export function readVanillaBlockRegistry(minecraftVersion:string):VanillaBlockRegistry {
  const data=createRequire(import.meta.url)('minecraft-data')(minecraftVersion);
  if(!data||data.version?.minecraftVersion!==minecraftVersion)throw Error('Exact Minecraft registry version required');
  return {schema:'agent-mc-block-registry/v1',minecraftVersion,blocks:data.blocksArray.map((block:any)=>({
    id:block.id,name:`minecraft:${block.name}`,displayName:block.displayName,minStateId:block.minStateId,
    maxStateId:block.maxStateId,defaultState:block.defaultState,states:JSON.parse(JSON.stringify(block.states??[])),
    transparent:block.transparent,boundingBox:block.boundingBox}))};
}

export interface SceneBlockReading {
  name: string; stateId?: number; material?: string | null; boundingBox?: string; transparent?: boolean;
  shapes?: readonly (readonly number[])[];
  getProperties?(): Record<string, unknown>;
  properties?: Record<string, unknown>;
}
export interface VoxelSceneInput {
  source: VoxelScene['source'];
  feet: ScenePoint; yaw: number; pitch: number;
  /** Explicit projection parameters; not inferred from a game screenshot. */
  eyeHeight: number; fovDegrees: number;
  bounds: VoxelScene['bounds'];
  sampledAt?: string;
  blockAt(x: number, y: number, z: number): SceneBlockReading | null | undefined;
}

export function sceneBlockIsAir(name: string): boolean {
  return ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(name);
}

function reading(value: SceneBlockReading): SceneBlockType | null {
  if (typeof value.name !== 'string' || value.name.length > 200 || !/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(value.name)) return null;
  const name = value.name.includes(':') ? value.name : `minecraft:${value.name}`;
  const properties: SceneBlockType['properties'] = Object.create(null);
  const raw = value.getProperties?.() ?? value.properties ?? {};
  for (const key of Object.keys(raw).sort()) {
    const item = raw[key];
    if (/^[\w:.-]{1,80}$/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key)
      && (typeof item === 'boolean' || (typeof item === 'string' && item.length <= 256) || (typeof item === 'number' && Number.isFinite(item)))) properties[key] = item as string | boolean | number;
  }
  const shapes = value.shapes;
  const validShapes = Array.isArray(shapes) && shapes.length <= 64 && shapes.every(box => box.length === 6
    && box.every((n:unknown) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 4)
    && box[0] <= box[3] && box[1] <= box[4] && box[2] <= box[5]);
  return { name, stateId: Number.isSafeInteger(value.stateId) && value.stateId! >= 0 ? value.stateId! : null,
    properties, material: typeof value.material === 'string' ? value.material : null,
    collisionShapes: validShapes ? shapes!.map(box => [...box] as SceneShape) : null,
    boundingBox: typeof value.boundingBox === 'string' ? value.boundingBox : null,
    transparent: typeof value.transparent === 'boolean' ? value.transparent : null };
}

/** Bounded read-only export. No top-surface filtering, category substitution, model or game connection. */
export function captureVoxelScene(input: VoxelSceneInput): VoxelScene {
  const { min, max } = input.bounds;
  if (min.length !== 3 || max.length !== 3 || ![...min, ...max].every(Number.isSafeInteger)
    || min.some((n, axis) => n > max[axis])) throw Error('Finite integer scene bounds required');
  const total = min.reduce((n, value, axis) => n * (max[axis] - value + 1), 1);
  if (!Number.isSafeInteger(total) || total > 250_000) throw Error('Scene volume exceeds 250000 cells; choose explicit smaller bounds');
  if (input.feet.length !== 3 || ![...input.feet, input.yaw, input.pitch, input.eyeHeight, input.fovDegrees].every(Number.isFinite)
    || input.eyeHeight < 0 || input.eyeHeight > 4 || input.fovDegrees < 10 || input.fovDegrees > 150) throw Error('Explicit finite scene camera required');
  const sampledAt = input.sampledAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(sampledAt))) throw Error('Invalid scene sample time');
  const palette: SceneBlockType[] = [], cells: number[] = [], indices = new Map<string, number>();
  let known = 0, air = 0;
  for (let x = min[0]; x <= max[0]; x++) for (let y = min[1]; y <= max[1]; y++) for (let z = min[2]; z <= max[2]; z++) {
    let block: SceneBlockType | null;
    try { const raw = input.blockAt(x, y, z); block = raw ? reading(raw) : null; } catch { block = null; }
    if (!block) { cells.push(-1); continue; }
    const key = JSON.stringify(block);
    let index = indices.get(key);
    if (index === undefined) { index = palette.length; indices.set(key, index); palette.push(block); }
    cells.push(index); known++; if (sceneBlockIsAir(block.name)) air++;
  }
  return { schema: VOXEL_SCENE_PROTOCOL, sampledAt, source: { ...input.source },
    camera: { feet: [...input.feet], eye: [input.feet[0], input.feet[1] + input.eyeHeight, input.feet[2]],
      yaw: input.yaw, pitch: input.pitch, roll: 0, fovDegrees: input.fovDegrees,
      convention: 'mineflayer-radians', source: 'player-pose-with-explicit-projection' },
    bounds: { min: [...min], max: [...max] }, order: 'x-y-z', palette, cells,
    coverage: { total, known, unknown: total - known, air, nonAir: known - air, complete: known === total } };
}
