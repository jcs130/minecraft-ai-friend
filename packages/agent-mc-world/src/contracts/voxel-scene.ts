/** Historical, client-observed scene data. Rendering/model choice belongs to the consumer. */
export const VOXEL_SCENE_PROTOCOL = 'agent-mc-voxel-scene/v1' as const;
export type ScenePoint = [number, number, number];
export type SceneShape = [number, number, number, number, number, number];
export interface VanillaBlockRegistry {
  schema:'agent-mc-block-registry/v1'; minecraftVersion:string;
  blocks:{id:number;name:string;displayName:string;minStateId:number;maxStateId:number;defaultState:number;
    states:unknown[];transparent:boolean;boundingBox:string}[];
}
export interface SceneBlockType {
  name: string;
  stateId: number | null;
  properties: Record<string, string | number | boolean>;
  material: string | null;
  /** Collision evidence, not a claim of exact rendered geometry. */
  collisionShapes: SceneShape[] | null;
  boundingBox: string | null;
  transparent: boolean | null;
}
export interface VoxelScene {
  schema: typeof VOXEL_SCENE_PROTOCOL;
  sampledAt: string;
  source: {
    kind: 'client-loaded-chunks'; minecraftVersion: string; dimension: string;
    username: string; uuid: string; realmVerified: boolean; connectionEpoch?: string;
  };
  camera: { feet: ScenePoint; eye: ScenePoint; yaw: number; pitch: number; roll: 0;
    fovDegrees: number; convention: 'mineflayer-radians'; source: 'player-pose-with-explicit-projection' };
  bounds: { min: ScenePoint; max: ScenePoint };
  /** For x=min..max, then y=min..max, then z=min..max. -1 means unknown, never air. */
  order: 'x-y-z';
  cells: number[];
  palette: SceneBlockType[];
  coverage: { total: number; known: number; unknown: number; air: number; nonAir: number; complete: boolean };
}
