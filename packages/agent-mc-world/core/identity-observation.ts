import type { WorldSnapshot } from './terrain.ts';
/** Compact UUID joins from the SAME bounded perception snapshot as the prose.
 * Absence is unknown (occlusion/range/truncation), never a teleport failure.
 * Does not expose entities excluded by the existing observation policy. */
export function identityObservations(snapshot: Pick<WorldSnapshot,'entities'>, sampledAtMs: number) {
  return snapshot.entities.filter(e=>e.identity).slice(0,8).map(e=>({
    uuid:e.identity!.uuid,entityId:e.entityId??null,identitySource:e.identity!.source,
    sampledAt:new Date(sampledAtMs).toISOString(),source:'entity-snapshot' as const,
    distance:e.distance,direction:e.direction,dy:e.dy,
    visibility:e.observation?.visibility??(e.visible?'visible':'unknown'),
    lineOfSight:e.observation?.lineOfSight??(e.visible?true:null),
  }));
}
export type IdentityObservation = ReturnType<typeof identityObservations>[number];
