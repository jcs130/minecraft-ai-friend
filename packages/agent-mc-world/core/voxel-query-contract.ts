/** Shared discovery and budget constants; paging/signatures live only in voxel-paging.ts. */
export type VoxelPoint = [number,number,number];
export type VoxelBox = [number,number,number,number,number,number];
export type VoxelCursor = string;
export const VOXEL_BUDGET=512, VOXEL_OFFSET=16, VOXEL_RESPONSE_TEXT_CAP=24000;
export const SPATIAL_QUERY_LIMITS={cells:VOXEL_BUDGET,visibleScans:2048,offset:VOXEL_OFFSET,rays:64,range:64,reads:16384,entities:512,text:VOXEL_RESPONSE_TEXT_CAP,sites:4} as const;
export const DEFAULT_VOXEL_BOUNDS:VoxelBox=[-1,-1,-1,1,2,1];
export const VOXEL_BOUNDS_SCHEMA={type:'array',minItems:6,maxItems:6,items:{type:'integer',minimum:-VOXEL_OFFSET,maximum:VOXEL_OFFSET},default:DEFAULT_VOXEL_BOUNDS};
export const VOXEL_CURSOR_MAX_LENGTH=1024;
export const VOXEL_CURSOR_PATTERN=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
export const VOXEL_CURSOR_SCHEMA={type:'string',maxLength:VOXEL_CURSOR_MAX_LENGTH,pattern:VOXEL_CURSOR_PATTERN.source};
export const VOXEL_QUERY_DOC=`voxels: bounds=[xmin,ymin,zmin,xmax,ymax,zmax], inclusive integer block offsets ±${VOXEL_OFFSET} from floor(feet) at the first read; default=${JSON.stringify(DEFAULT_VOXEL_BOUNDS)}. mc_observe defaults to dense, queued observe defaults to visible surfaces. Dense reads return at most ${VOXEL_BUDGET} cells as a contiguous rectangular prefix in y,z,x order (x fastest); oversize returns real partial data. Visible mode returns at most ${VOXEL_BUDGET} non-air surfaces, checking at most 2048 nearby original-anchor cells. Text budget ${VOXEL_RESPONSE_TEXT_CAP} UTF-16 characters; verbose geometry reduces coverage. cursor replaces bounds and pins coordinates, connection, dimension and respawn scope; invalid scope is rejected, never reanchored. Each page has its own observed_at; not a snapshot. returned_regions/count, requested_bounds/count, remaining_count (outside this response), remaining_after_page, query_anchor, coordinate_system=absolute_block, next_cursor/next_safe_read describe coverage. Continuation is caller-selected, never automatic. Hidden/unloaded/omitted cells stay unknown, never air or safe. Vision through glass is separate from collision; sites body.clear tests clearance, not permission.`;
export const voxelVolume=(b:readonly number[]) => (b[3]-b[0]+1)*(b[4]-b[1]+1)*(b[5]-b[2]+1);
