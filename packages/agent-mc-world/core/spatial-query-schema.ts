import {VOXEL_BOUNDS_SCHEMA,VOXEL_CURSOR_SCHEMA,VOXEL_QUERY_DOC,SPATIAL_QUERY_LIMITS} from './voxel-query-contract.ts';
export const SPATIAL_QUERY_EXAMPLE = { mode: 'voxels', bounds: [0,0,0,0,0,0] };
export const SPATIAL_QUERY_SCHEMA = { type: 'object', required: ['mode'], additionalProperties: false,
  examples: [SPATIAL_QUERY_EXAMPLE],
  allOf: [
    { if: { required:['mode'], properties: {mode:{const:'sites'}} }, then: { required:['sites'], properties:{bounds:false,rays:false,cursor:false,format:false} } },
    { if: { required:['mode'], properties: {mode:{const:'rays'}} }, then: { properties:{bounds:false,sites:false,cursor:false,format:false} } },
    { if: { required:['mode'], properties: {mode:{const:'voxels'}} }, then: { properties:{rays:false,sites:false} } },
    { if: { required:['cursor'] }, then: { properties:{bounds:false} } },
  ], properties: {
  mode: { type: 'string', enum: ['voxels','sites','rays'] },
  bounds: { ...VOXEL_BOUNDS_SCHEMA, description: VOXEL_QUERY_DOC },
  format: {type:'string',enum:['visible','dense'],default:'dense',description:'voxels only: dense (mc_observe default) or visible surfaces (queued observe default); continuation retains its format.'},
  cursor: { ...VOXEL_CURSOR_SCHEMA, description: 'Exact next_cursor from the prior page; mutually exclusive with bounds; absolute, dimension pinned. No automatic continuation.' },
  sites: { type: 'array', minItems: 1, maxItems: SPATIAL_QUERY_LIMITS.sites, uniqueItems: true,
    items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer', minimum: -30_000_000, maximum: 30_000_000 } },
    description: 'sites only: 1..4 absolute integer block cells [x,y,z], no default. body.clear tests 0.6×1.8 clearance, not permission or reachability.' },
  rays: { type: 'array', minItems: 1, maxItems: SPATIAL_QUERY_LIMITS.rays,
    items: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'array', minItems: 3, maxItems: 3,
      items: [{ type: 'number', minimum: -90, maximum: 90 }, { type: 'number', minimum: -180, maximum: 180 },
        { type: 'number', exclusiveMinimum: 0, maximum: SPATIAL_QUERY_LIMITS.range }] },
    description: 'rays only: [relative pitch degrees,relative yaw degrees,range blocks]; default 3×5 fan at 24 blocks. Collision rays stop at glass even though vision can pass through it.' },
} };

export function spatialArgumentDiagnostic(args: Record<string,unknown>, problem: string) {
  const fields = ['cursor','bounds','format','rays','sites','mode'];
  const field = Object.keys(args).find(k => !(k in SPATIAL_QUERY_SCHEMA.properties))
    ?? fields.find(f => problem.includes(f)) ?? 'mode';
  return { status: 'invalid_arguments', reason: 'invalid_spatial_query', completed: 0, remaining: null,
    retryable: false, retry_after: null, next_safe_read: null,
    errors: [{ path: `/${field}`, expected: SPATIAL_QUERY_SCHEMA.properties[field as keyof typeof SPATIAL_QUERY_SCHEMA.properties]
      ?? { allowed_fields: Object.keys(SPATIAL_QUERY_SCHEMA.properties), additionalProperties: false },
      problem, actual: args[field] ?? null }],
    minimal_legal_example: SPATIAL_QUERY_EXAMPLE, executed: false };
}
