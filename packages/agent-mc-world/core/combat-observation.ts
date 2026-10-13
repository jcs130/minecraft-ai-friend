export interface CombatScene {
  dimension: string | null;
  position: { x: number; y: number; z: number };
  hostileRadius: number;
  nearbyHostiles: Record<string, number>;
  equipment: Record<string, string | null>;
}

export interface CombatResult {
  startedAt: string;
  endedAt: string;
  reason: string;
  healthBefore: number | null;
  healthAfter: number | null;
  kills: Record<string, number>;
  swings: number;
  meleeLanded: number;
  arrows: number;
  rangedLanded: number;
  sceneBefore?: CombatScene;
}

