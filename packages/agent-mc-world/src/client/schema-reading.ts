/** Request-only schema annotations; full declarations remain available for help and generation. */
export const CONTEXT_SCHEMA_ANNOTATIONS: readonly string[] = Object.freeze(['x-agent-mc-skill-contracts']);
const maps = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependencies', 'dependentSchemas']);
const arrays = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const children = new Set(['items', 'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'contains',
  'additionalItems', 'unevaluatedItems', 'contentSchema', 'not', 'if', 'then', 'else']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** A small field index from declared alternatives; never infers an action or a default. */
function skillSignatures(schema: Record<string, unknown>): string | null {
  const contracts=schema['x-agent-mc-skill-contracts'];
  const discriminator=object(schema.properties) && schema.properties.skill;
  if (!object(contracts) || !object(discriminator) || !Array.isArray(discriminator.enum)) return null;
  const lines: string[]=[];
  for (const [name, variants] of Object.entries(contracts)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || !discriminator.enum.includes(name)
      || !Array.isArray(variants) || variants.length===0) return null;
    const forms: string[]=[];
    for (const variant of variants) {
      if (!object(variant) || !object(variant.properties) || !Array.isArray(variant.required)
        || !object(variant.properties.skill) || variant.properties.skill.const!==name) return null;
      const properties=variant.properties;
      if (variant.required.some(key=>typeof key!=='string' || !(key in properties))) return null;
      const required=new Set(variant.required);
      const fields=Object.entries(variant.properties).filter(([key])=>key!=='skill' && key!=='needs').map(([key,value])=>{
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || !object(value)) return null;
        const constant=Object.hasOwn(value,'const') ? '='+JSON.stringify(value.const) : '';
        return key+constant+(required.has(key)?'*':'?');
      });
      if (fields.some(field=>field===null)) return null;
      forms.push(`${name}(${fields.join(',')})`);
    }
    lines.push([...new Set(forms)].join(' | '));
  }
  return lines.length ? '[技能字段索引：*为该形态必填，?为可选或条件字段；执行条件仍查完整帮助，needs/expect沿用原契约]\n'+lines.join('\n') : null;
}

/** Reattach compact discriminator notes after a host abbreviates parameter prose. */
export function withSkillInputSignatures(source: unknown, projected: unknown): unknown {
  if (!object(source) || !object(projected)) return projected;
  const result={...projected};
  let changed=false;
  for (const [key,child] of Object.entries(source)) {
    if (!(key in result)) continue;
    if (maps.has(key) && object(child) && object(result[key])) {
      const values={...result[key]};
      for (const [name,entry] of Object.entries(child)) {
        if (!(name in values)) continue;
        const next=withSkillInputSignatures(entry,values[name]);
        if (next!==values[name]) {values[name]=next;changed=true;}
      }
      if (changed) result[key]=values;
    } else if (arrays.has(key) && Array.isArray(child) && Array.isArray(result[key])) {
      const values=result[key];
      const next=values.map((entry,index)=>withSkillInputSignatures(child[index],entry));
      if (next.some((entry,index)=>entry!==values[index])) {result[key]=next;changed=true;}
    } else if (children.has(key)) {
      if (Array.isArray(child) && Array.isArray(result[key])) {
        const values=result[key],next=values.map((entry,index)=>withSkillInputSignatures(child[index],entry));
        if (next.some((entry,index)=>entry!==values[index])) {result[key]=next;changed=true;}
      } else {
        const next=withSkillInputSignatures(child,result[key]);
        if (next!==result[key]) {result[key]=next;changed=true;}
      }
    }
  }
  const notes=skillSignatures(source);
  if (notes && object(result.properties) && object(result.properties.skill)) {
    const field=result.properties.skill;
    const description=typeof field.description==='string' && field.description.endsWith(notes)
      ? field.description : [typeof field.description==='string'?field.description:null,notes].filter(Boolean).join('\n');
    if (field.description!==description) {
      result.properties={...result.properties,skill:{...field,description}};
      changed=true;
    }
  }
  return changed?result:projected;
}

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
