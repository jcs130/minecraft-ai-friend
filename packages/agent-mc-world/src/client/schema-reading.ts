/** Request-only schema annotations; full declarations remain available for help and generation. */
export const CONTEXT_SCHEMA_ANNOTATIONS: readonly string[] = Object.freeze(['x-agent-mc-skill-contracts']);
const maps = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependencies', 'dependentSchemas']);
const arrays = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const children = new Set(['items', 'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'contains',
  'additionalItems', 'unevaluatedItems', 'contentSchema', 'not', 'if', 'then', 'else']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Remove only owned discovery annotations at schema positions, preserving validation and literal data. */
export function omitContextSchemaAnnotations(schema: unknown): unknown {
  let changed = false;
  const visit = (value: unknown): unknown => {
    if (!object(value)) return value;
    return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
      if (CONTEXT_SCHEMA_ANNOTATIONS.includes(key)) { changed = true; return []; }
      if (maps.has(key) && object(child)) return [[key, Object.fromEntries(Object.entries(child).map(([name, item]) => [name, visit(item)]))]];
      if (arrays.has(key) && Array.isArray(child)) return [[key, child.map(visit)]];
      if (children.has(key)) return [[key, Array.isArray(child) ? child.map(visit) : visit(child)]];
      return [[key, child]];
    }));
  };
  const result = visit(schema); return changed ? result : schema;
}
