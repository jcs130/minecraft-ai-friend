/** Shared bounded read recipe; actual registries, no movement or world edits. */
export const BLOCK_FIND_SCHEMA = { type: 'object', properties: {
  names: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 100 } },
  maxDistance: { type: 'integer', minimum: 1, maximum: 32 }, count: { type: 'integer', minimum: 1, maximum: 32 },
}, required: ['names'], additionalProperties: false };
const CODE = `const ids=[]; for(const name of params.names) { const entry=await bot.read('registry.blocksByName.'+name.replace(/^minecraft:/,'')); if(!entry||!Number.isInteger(entry.id)) throw new Error('Unknown actual block registry name: '+name); ids.push(entry.id); } const positions=await bot.findBlocks({matching:ids,maxDistance:params.maxDistance,count:params.count}); return {positions,observedOnly:true,goalCompleted:false};`;
export function blockFindRequest(args: Record<string, unknown>) {
  if (Object.keys(args).some(k => !['find', 'language', 'waitMs'].includes(k)) || args.language !== undefined && args.language !== 'javascript')
    throw new Error('Use find separately from code/runId/library/stop; a shared JavaScript read recipe.');
  const q = args.find as Record<string, unknown>;
  if (!q || typeof q !== 'object' || Array.isArray(q) || Object.keys(q).some(k => !['names', 'maxDistance', 'count'].includes(k))
    || !Array.isArray(q.names) || !q.names.length || q.names.length > 16
    || q.names.some(n => typeof n !== 'string' || n.length > 100 || !/^(?:[a-z0-9_]+:)?[a-z0-9_/-]+$/.test(n)))
    throw new Error('find requires1–16 actual registry names, e.g. {find:{names:["water"],maxDistance:8,count:4}}.');
  const maxDistance = q.maxDistance ?? 8, count = q.count ?? 8;
  if (!Number.isInteger(maxDistance) || Number(maxDistance) < 1 || Number(maxDistance) > 32
    || !Number.isInteger(count) || Number(count) < 1 || Number(count) > 32) throw new Error('find distance/count must be integers1..32.');
  return { name: 'bounded-block-find', code: CODE, params: { names: [...new Set(q.names)], maxDistance, count },
    ...(args.waitMs === undefined ? {} : { waitMs: args.waitMs }) };
}
