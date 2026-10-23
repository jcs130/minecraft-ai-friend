/** Protocol 766 TextDisplay. Interpret metadata with the connection's exact registry. */
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const vector = (v, fallback) => v===undefined ? fallback : v && ['x','y','z'].every(k => Number.isFinite(v[k]) && Math.abs(v[k]) <= 64)
  ? {x:v.x,y:v.y,z:v.z} : null;
const colors = Object.freeze({black:'#000000',dark_blue:'#0000aa',dark_green:'#00aa00',dark_aqua:'#00aaaa',dark_red:'#aa0000',dark_purple:'#aa00aa',gold:'#ffaa00',gray:'#aaaaaa',dark_gray:'#555555',blue:'#5555ff',green:'#55ff55',aqua:'#55ffff',red:'#ff5555',light_purple:'#ff55ff',yellow:'#ffff55',white:'#ffffff'});

// NBT is decoded before the generic host serializer's shallow metadata budget.
// No selector, score, NBT lookup, click event, HTML or external font is evaluated.
export function textDisplayRuns(input) {
  let nodes=0, length=0;
  function nbt(value, depth=0) {
    if (++nodes>512 || depth>16) throw Error('component_budget');
    if (!value || typeof value!=='object') return value;
    if (value.type==='compound') return Object.fromEntries(Object.entries(value.value).map(([k,v])=>[k,nbt(v,depth+1)]));
    if (value.type==='list') return value.value.value.map(v=>nbt({type:value.value.type,value:v},depth+1));
    if (['string','byte','int','float','double'].includes(value.type)) return value.value;
    if (Array.isArray(value)) return value.map(v=>nbt(v,depth+1));
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,nbt(v,depth+1)]));
  }
  const runs=[];
  function visit(value, color='#ffffff', depth=0) {
    if (++nodes>512 || depth>16) throw Error('component_budget');
    if (typeof value==='string') { length += [...value].length; if(length>512)throw Error('text_budget'); if(value)runs.push({text:value,color}); return; }
    if (Array.isArray(value)) { for(const v of value)visit(v,color,depth+1);return; }
    if (!value || typeof value!=='object') throw Error('component_type');
    if (['translate','selector','score','nbt','keybind'].some(k=>Object.hasOwn(value,k))
        || value.obfuscated || value.bold || value.italic || value.underlined || value.strikethrough
        || value.font && value.font!=='minecraft:default') throw Error('component_unsupported');
    if (value.color!==undefined) {
      color=colors[value.color] ?? (/^#[0-9a-f]{6}$/i.test(value.color)?value.color:null);
      if(!color)throw Error('component_color');
    }
    if(Object.hasOwn(value,'text'))visit(value.text,color,depth+1);
    if(value.extra!==undefined) { if(!Array.isArray(value.extra))throw Error('component_extra'); for(const v of value.extra)visit(v,color,depth+1); }
  }
  try {
    let value=nbt(input);
    if(typeof value==='string'&&value.length>16384)return null;
    if(typeof value==='string' && /^[\[{]/.test(value.trim())) { try{value=JSON.parse(value);}catch{/* Native string components may literally start with a bracket. */} }
    visit(value);
    if(runs.some(r=>/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(r.text)))return null;
    return runs;
  } catch { return null; }
}

export function textDisplayMetadataKeys(registry) {
  const keys=registry?.entitiesByName?.text_display?.metadataKeys;
  return Array.isArray(keys) && keys[23]==='text' && keys[27]==='style_flags' ? keys : null;
}

export function decodeTextDisplay(entity, registry) {
  const keys=textDisplayMetadataKeys(registry);
  if(!keys || entity?.name!=='text_display' || !integer(entity.id,0,2147483647))return null;
  const position=entity.position;
  if(!position || !['x','y','z'].every(k=>Number.isFinite(position[k])))return null;
  const values=entity.metadata ?? {};
  const get=(key,fallback)=>values[keys.indexOf(key)] ?? fallback;
  const runs=textDisplayRuns(get('text',''));
  const translation=vector(get('translation'),{x:0,y:0,z:0}),scale=vector(get('scale'),{x:1,y:1,z:1});
  const identity=v=>!v || v.x===0 && v.y===0 && v.z===0 && (v.w===1 || v.w===-1);
  const flags=get('style_flags',0),billboard=get('billboard_render_constraints',0);
  const lineWidth=get('line_width',200),opacity=get('text_opacity',-1),background=get('background_color',0x40000000);
  const viewRange=get('view_range',1),teleportTicks=get('pos_rot_interpolation_duration',0);
  // This first renderer supports the actual bubble profile and static transforms.
  // Unsupported rotations/transformation interpolation stay explicitly unavailable.
  const reason=!runs?'text-component':!identity(get('left_rotation')) || !identity(get('right_rotation'))?'rotation'
    :get('transformation_interpolation_duration',0)!==0?'transform-interpolation':flags&~31?'style-flags':null;
  if(!integer(flags,-128,255)||!integer(billboard,0,3)||!integer(lineWidth,1,2048)
      ||!integer(opacity,-128,255)||!integer(background,-2147483648,4294967295)||!translation||!scale
      ||!Number.isFinite(viewRange)||viewRange<0||viewRange>4||!integer(teleportTicks,0,59))return null;
  return {schemaVersion:1,id:entity.id,uuid:entity.uuid,name:'text_display',position:{...position},
    yaw:Number.isFinite(entity.yaw)?entity.yaw:Math.PI,pitch:Number.isFinite(entity.pitch)?entity.pitch:0,
    runs:runs ?? [],translation,scale,billboard,flags:flags&255,lineWidth,opacity:opacity&255,background:background>>>0,
    viewRange,teleportTicks,
    invisible:((get('shared_flags',0)&32)!==0),unavailable:reason};
}
