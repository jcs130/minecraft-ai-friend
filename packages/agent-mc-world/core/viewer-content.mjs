/** Vanilla 1.20.6 content from the action bot's connection, with bounded replay. */
import {decodeTextDisplay,textDisplayMetadataKeys} from './text-display.mjs';
const finite = n => typeof n === 'number' && Number.isFinite(n);
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const pos = p => p && [p.x, p.y, p.z].every(finite) ? { x: p.x, y: p.y, z: p.z } : null;
const rgb = p => Array.isArray(p) && p.length === 3 && p.every(n => finite(n) && n >= 0 && n <= 1) ? p : null;
// Keep complete 64-point guides after a spell's cosmetic burst, including two guides in one tick.
// This remains a hard bound; match ServerParticles.batch at the browser boundary.
export const VIEWER_CONTENT_LIMITS = Object.freeze({ maps: 64, frames: 128, textDisplays: 64, particleBatch: 256, flushMs: 50, range: 80, longDistanceRange: 512 });

export function transitionFieldOrder(protocol) {
  const fields = protocol?.types?.Particle?.[1]?.find(f => f.name === 'data')?.type?.[1]?.fields?.dust_color_transition?.[1];
  return Array.isArray(fields) ? fields.map(f => f.name).join(',') : null;
}

export function viewerParticlePacket(packet, { version = '1.20.6', protocol } = {}) {
  const position = pos(packet);
  const name = packet?.particle?.type;
  if (!position || typeof name !== 'string' || !/^[a-z_]{1,64}$/.test(name)
      || !integer(packet.amount, 0, 4096) || ![packet.offsetX, packet.offsetY, packet.offsetZ, packet.velocityOffset].every(finite)) return null;
  const data = packet.particle.data;
  // Preserve the native force/long-distance bit. Guide endpoints can be beyond
  // the ordinary content radius; dropping this bit silently clipped whole lines.
  const result = { kind: 'particle', name, position, longDistance: packet.longDistance === true, spread: {
    x: Math.max(-8, Math.min(8, packet.offsetX)), y: Math.max(-8, Math.min(8, packet.offsetY)), z: Math.max(-8, Math.min(8, packet.offsetZ)) },
    count: Math.min(48, packet.amount), speed: Math.max(0, Math.min(4, packet.velocityOffset)), exact: packet.amount === 1
      && packet.offsetX === 0 && packet.offsetY === 0 && packet.offsetZ === 0 && packet.velocityOffset === 0 };
  if (name === 'dust' || name === 'dust_color_transition') {
    if (!data) return null;
    let color, colorEnd, scale;
    if (name === 'dust') { color = [data.red, data.green, data.blue]; scale = data.scale; }
    else {
      color = [data.fromRed, data.fromGreen, data.fromBlue];
      // Protocol 766 writes two vectors then scale. Some minecraft-data releases
      // label the fourth float scale: reinterpret those labels without mutating the bot.
      const order = transitionFieldOrder(protocol);
      if (version === '1.20.6' && order === 'fromRed,fromGreen,fromBlue,scale,toRed,toGreen,toBlue') {
        colorEnd = [data.scale, data.toRed, data.toGreen]; scale = data.toBlue;
      } else if (order === 'fromRed,fromGreen,fromBlue,toRed,toGreen,toBlue,scale') {
        colorEnd = [data.toRed, data.toGreen, data.toBlue]; scale = data.scale;
      } else return null;
    }
    if (!rgb(color) || colorEnd && !rgb(colorEnd) || !finite(scale) || scale < .01 || scale > 4) return null;
    result.color = color; result.size = scale;
    if (colorEnd) result.colorEnd = colorEnd;
  }
  return result;
}

export function viewerMapPacket(packet) {
  if (!packet || !integer(packet.itemDamage, 0, 2147483647) || !integer(packet.scale, 0, 4)
      || !integer(packet.columns, 0, 128)) return null;
  const row = { schemaVersion: 1, mapId: packet.itemDamage, scale: packet.scale, locked: packet.locked === true };
  if (Array.isArray(packet.icons)) row.icons = packet.icons.slice(0, 256).filter(i => integer(i.type, 0, 255)
    && integer(i.x, -128, 127) && integer(i.z, -128, 127) && integer(i.direction, 0, 255))
    .map(i => ({ type: i.type, x: i.x, z: i.z, direction: i.direction }));
  if (packet.columns === 0) return { ...row, columns: 0 };
  if (!integer(packet.rows, 1, 128) || !integer(packet.x, 0, 127) || !integer(packet.y, 0, 127)
      || packet.x + packet.columns > 128 || packet.y + packet.rows > 128
      || !(packet.data instanceof Uint8Array) || packet.data.length !== packet.columns * packet.rows) return null;
  return { ...row, x: packet.x, y: packet.y, columns: packet.columns, rows: packet.rows, data: Uint8Array.from(packet.data) };
}

export function frameMapId(slot, registry) {
  if (!slot || registry?.items?.[slot.itemId ?? slot.type]?.name !== 'filled_map') return null;
  const component = slot.components?.find(c => c.type === 'map_id' || c.type === 'minecraft:map_id');
  return integer(component?.data, 0, 2147483647) ? component.data : null;
}
const normals = [[0,-1,0],[0,1,0],[0,0,-1],[0,0,1],[-1,0,0],[1,0,0]];
export function frameTileCenter(tile,normal) {
  if(!pos(tile)||![tile.x,tile.y,tile.z].every(Number.isInteger))return null;
  return Object.fromEntries(['x','y','z'].map((axis,i)=>[axis,tile[axis]+.5-normal[i]*.46875]));
}
function nativeFrameCenter(position,normal) {
  const tileCenter=frameTileCenter(position,normal);
  if(tileCenter)return tileCenter;
  // Subsequent entity_teleport packets carry the calculated center, whereas
  // spawn_entity carries BlockPos. Verify the native 1/32 hanging-entity grid.
  return pos(position)&&['x','y','z'].every((axis,i)=>Number.isInteger(position[axis]+normal[i]*.46875-.5))?pos(position):null;
}

// A late-starting host may already have frames in Mineflayer's entity cache.
// ItemFrame.setDirection writes cardinal yaw or +/-90 pitch. Mineflayer converts
// those bytes to radians. Accept only exact cardinal poses, never guess a face.
export function cachedMapFrame(entity, registry) {
  if (!['item_frame','glow_item_frame'].includes(entity?.name) || !integer(entity.id,0,2147483647)
      || !pos(entity.position) || !finite(entity.yaw) || !finite(entity.pitch)) return null;
  let normal;
  if (Math.abs(Math.abs(entity.pitch)-Math.PI/2)<1e-5) normal = [0,Math.sign(entity.pitch),0];
  else if (Math.abs(entity.pitch)<1e-5) {
    const notchYaw = Math.PI-entity.yaw, quarter=Math.round(notchYaw/(Math.PI/2));
    if (Math.abs(notchYaw-quarter*Math.PI/2)>1e-5) return null;
    normal = [[0,0,1],[-1,0,0],[0,0,-1],[1,0,0]][((quarter%4)+4)%4];
  } else return null;
  const rotation=entity.metadata?.[9] ?? 0;
  if (!integer(rotation,0,7)) return null;
  const position=nativeFrameCenter(entity.position,normal);
  if(!position)return null;
  return {id:entity.id,uuid:entity.uuid,name:entity.name,position,normal,rotation,
    mapId:frameMapId(entity.metadata?.[8],registry),invisible:((entity.metadata?.[0]??0)&32)!==0};
}

export function createViewerContentBridge(bot, { now = Date.now, schedule = setInterval, unschedule = clearInterval } = {}) {
  if (bot.version !== '1.20.6') throw Error('viewer_content_requires_1.20.6');
  const protocol = bot._client, maps = new Map(), frames = new Map(), textEntities=new Map(), textDisplays=new Map(), listeners = new Set(), hooks = [], socketDrainers=new Set(), socketDisposers=new Set();
  let epoch = 0, queue = [], disposed = false;
  const diagnostics = { particles: 0, droppedParticles: 0, mapPatches: 0, rejected: 0, subscriberErrors: 0, cachedFrames: 0, cachedTextDisplays:0, rejectedTextDisplays:0 };
  const nearby = (p, range = VIEWER_CONTENT_LIMITS.range) => !bot.entity?.position || Math.hypot(p.x-bot.entity.position.x, p.y-bot.entity.position.y, p.z-bot.entity.position.z) <= range;
  const deliver = (publish,name,value) => { try { publish(name,value); } catch { diagnostics.subscriberErrors++; } };
  const send = (name, value) => { for (const publish of listeners) deliver(publish,name,{ ...value, epoch }); };
  const on = (emitter, name, fn) => { emitter.on(name, fn); hooks.push(() => emitter.off(name, fn)); };
  function textSnapshot(display) { return {...display,position:{...display.position},translation:{...display.translation},scale:{...display.scale},runs:display.runs.map(r=>({...r}))}; }
  function publishText(entity) {
    const display=decodeTextDisplay(entity,bot.registry);
    if(!display){diagnostics.rejectedTextDisplays++;if(textDisplays.delete(entity.id))send('textDisplay',{schemaVersion:1,id:entity.id,delete:true});return;}
    textDisplays.set(display.id,display);send('textDisplay',textSnapshot(display));
  }
  function removeText(id) {
    textEntities.delete(id);
    if(textDisplays.delete(id))send('textDisplay',{schemaVersion:1,id,delete:true});
  }
  on(protocol,'spawn_entity',packet=>{
    // Numeric IDs are reusable, including replacement by a different entity type.
    removeText(packet.entityId);
    if(bot.registry?.entities?.[packet.type]?.name!=='text_display'||!textDisplayMetadataKeys(bot.registry)
        ||!integer(packet.entityId,0,2147483647)||!pos(packet))return;
    if(textEntities.size>=VIEWER_CONTENT_LIMITS.textDisplays){diagnostics.rejectedTextDisplays++;return;}
    const entity={id:packet.entityId,uuid:packet.objectUUID,name:'text_display',position:pos(packet),metadata:{},
      yaw:Math.PI-(packet.yaw??0)*Math.PI/128,pitch:-(packet.pitch??0)*Math.PI/128};
    textEntities.set(entity.id,entity);publishText(entity);
  });
  on(protocol,'entity_metadata',packet=>{
    const entity=textEntities.get(packet.entityId);if(!entity||!Array.isArray(packet.metadata))return;
    for(const field of packet.metadata.slice(0,64))if(integer(field.key,0,27))entity.metadata[field.key]=field.value;
    publishText(entity);
  });
  on(protocol,'entity_teleport',packet=>{
    const entity=textEntities.get(packet.entityId),position=pos(packet);if(!entity||!position)return;
    const yaw=integer(packet.yaw,-128,255)?Math.PI-packet.yaw*Math.PI/128:entity.yaw;
    const pitch=integer(packet.pitch,-128,255)?-packet.pitch*Math.PI/128:entity.pitch;
    if(['x','y','z'].every(k=>entity.position[k]===position[k])&&entity.yaw===yaw&&entity.pitch===pitch)return;
    entity.position=position;
    entity.yaw=yaw;entity.pitch=pitch;
    publishText(entity);
  });
  on(bot,'entityMoved',moved=>{
    const entity=textEntities.get(moved.id);if(!entity||!pos(moved.position))return;
    if(JSON.stringify(entity.position)===JSON.stringify(pos(moved.position))&&entity.yaw===moved.yaw&&entity.pitch===moved.pitch)return;
    entity.position=pos(moved.position);entity.yaw=moved.yaw;entity.pitch=moved.pitch;publishText(entity);
  });
  on(protocol,'entity_destroy',packet=>{for(const id of packet.entityIds??[])removeText(id);});
  on(protocol, 'world_particles', packet => {
    const event = viewerParticlePacket(packet, { version: bot.version, protocol: bot.registry?.protocol });
    if (!event) { diagnostics.rejected++; return; }
    if (!nearby(event.position, event.longDistance ? VIEWER_CONTENT_LIMITS.longDistanceRange : VIEWER_CONTENT_LIMITS.range) || !listeners.size) return;
    if (queue.length >= VIEWER_CONTENT_LIMITS.particleBatch) { diagnostics.droppedParticles++; return; }
    queue.push(event); diagnostics.particles++;
  });
  function flush() {
    if(disposed)return;
    for(const drain of socketDrainers)try{drain();}catch{diagnostics.subscriberErrors++;}
    if(!queue.length)return;
    const events=queue;queue=[];send('particleBatch',{schemaVersion:1,atMs:now(),events});
  }
  const timer = schedule(flush, VIEWER_CONTENT_LIMITS.flushMs); timer?.unref?.();
  on(protocol, 'map', packet => {
    const patch = viewerMapPacket(packet);
    if (!patch) { diagnostics.rejected++; return; }
    let map = maps.get(patch.mapId);
    if (!map) {
      if (maps.size >= VIEWER_CONTENT_LIMITS.maps) maps.delete(maps.keys().next().value);
      map = { mapId: patch.mapId, scale: patch.scale, locked: patch.locked, data: new Uint8Array(16384), coverage: new Uint8Array(2048), icons: [] }; maps.set(patch.mapId, map);
    }
    map.scale = patch.scale; map.locked = patch.locked;
    if (patch.icons) map.icons = patch.icons;
    for (let y = 0; y < (patch.rows ?? 0); y++) for (let x = 0; x < patch.columns; x++) {
      const index = (patch.y+y)*128+patch.x+x;
      map.data[index] = patch.data[y*patch.columns+x]; map.coverage[index>>3] |= 1<<(index&7);
    }
    diagnostics.mapPatches++; send('mapPixels', patch);
  });
  on(protocol, 'spawn_entity', packet => {
    const name = bot.registry?.entities?.[packet.type]?.name;
    if (!['item_frame','glow_item_frame'].includes(name) || !integer(packet.entityId,0,2147483647) || !pos(packet)
        || !integer(packet.objectData,0,5)) return;
    if (frames.size >= VIEWER_CONTENT_LIMITS.frames) return;
    // Unlike ordinary entities, ItemFrame.getAddEntityPacket sends its tile
    // BlockPos. The Java client derives the actual hanging-entity center.
    const normal=normals[packet.objectData],position=frameTileCenter(packet,normal);if(!position)return;
    frames.set(packet.entityId, { id: packet.entityId, uuid: packet.objectUUID, name, position, normal, rotation: 0, mapId: null, invisible: false });
  });
  on(protocol, 'entity_metadata', packet => {
    const frame = frames.get(packet.entityId); if (!frame || !Array.isArray(packet.metadata)) return;
    for (const field of packet.metadata) {
      if (field.key === 0 && integer(field.value,-128,255)) frame.invisible = (field.value & 32) !== 0;
      if (field.key === 8) frame.mapId = frameMapId(field.value, bot.registry);
      if (field.key === 9 && integer(field.value,0,7)) frame.rotation = field.value;
    }
    if (nearby(frame.position)) send('mapFrame', { schemaVersion: 1, ...frame });
  });
  on(protocol,'entity_teleport',packet=>{
    const frame=frames.get(packet.entityId);if(!frame)return;
    const position=nativeFrameCenter(packet,frame.normal);if(!position){diagnostics.rejected++;return;}
    frame.position=position;if(nearby(position))send('mapFrame',{schemaVersion:1,...frame});
  });
  on(protocol, 'entity_destroy', packet => {
    for (const id of packet.entityIds ?? []) if (frames.delete(id)) send('mapFrame', { schemaVersion: 1, id, delete: true });
  });
  for (const entity of Object.values(bot.entities ?? {})) {
    if (frames.size>=VIEWER_CONTENT_LIMITS.frames) break;
    const frame=cachedMapFrame(entity,bot.registry);
    if (frame) {frames.set(frame.id,frame);diagnostics.cachedFrames++;}
  }
  for(const entity of Object.values(bot.entities??{})) {
    if(textEntities.size>=VIEWER_CONTENT_LIMITS.textDisplays)break;
    if(entity.name!=='text_display')continue;
    const display=decodeTextDisplay(entity,bot.registry);if(!display)continue;
    textEntities.set(entity.id,{...entity,position:pos(entity.position),metadata:{...entity.metadata}});
    textDisplays.set(entity.id,display);diagnostics.cachedTextDisplays++;
  }
  function reset() { epoch++; maps.clear(); frames.clear();textEntities.clear();textDisplays.clear(); queue = []; send('contentReset', { schemaVersion: 1 }); }
  on(bot, 'respawn', reset); on(bot, 'end', reset);
  function snapshot(map) {
    return {schemaVersion:1,epoch,...map,data:Uint8Array.from(map.data),coverage:Uint8Array.from(map.coverage),snapshot:true,x:0,y:0,columns:128,rows:128};
  }
  function subscribe(publish) {
      if (disposed) throw Error('viewer_content_disposed');
      if (typeof publish !== 'function') throw TypeError('viewer_content_publish_required');
      listeners.add(publish); deliver(publish,'contentReset', { schemaVersion: 1, epoch });
      for (const map of maps.values()) deliver(publish,'mapPixels',snapshot(map));
      for (const frame of frames.values()) if (nearby(frame.position)) deliver(publish,'mapFrame', { schemaVersion: 1, epoch, ...frame });
      for (const display of textDisplays.values()) deliver(publish,'textDisplay',{...textSnapshot(display),epoch});
      return () => listeners.delete(publish);
  }
  function subscribeSocket(socket,{writable=()=>socket.connected&&socket.conn?.transport?.writable!==false&&(socket.conn?.writeBuffer?.length??0)<=4}={}) {
    let closed=false,resetPending=false;
    const mapIds=new Set(),frameIds=new Set(),textIds=new Set();
    const fullReplay=()=>{resetPending=true;mapIds.clear();frameIds.clear();textIds.clear();for(const id of maps.keys())mapIds.add(id);for(const id of frames.keys())frameIds.add(id);for(const id of textDisplays.keys())textIds.add(id);};
    function drain() {
      if(closed||!writable())return;
      if(resetPending){socket.emit('contentReset',{schemaVersion:1,epoch});resetPending=false;}
      let sent=0;
      // Retire private dialogue before replaying potentially large photo caches.
      for(const id of textIds){if(!writable()||sent>=4)break;textIds.delete(id);const display=textDisplays.get(id);
        socket.emit('textDisplay',display?{...textSnapshot(display),epoch}:{schemaVersion:1,epoch,id,delete:true});sent++;}
      for(const id of mapIds){if(!writable()||sent>=4)break;mapIds.delete(id);const map=maps.get(id);if(map){socket.emit('mapPixels',snapshot(map));sent++;}}
      for(const id of frameIds){if(!writable()||sent>=4)break;frameIds.delete(id);const frame=frames.get(id);
        socket.emit('mapFrame',frame?{schemaVersion:1,epoch,...frame}:{schemaVersion:1,epoch,id,delete:true});sent++;}
    }
    const off=subscribe((name,value)=>{
      if(name==='contentReset'){resetPending=true;mapIds.clear();frameIds.clear();textIds.clear();}
      if(writable()&&!resetPending&&!mapIds.size&&!frameIds.size&&!textIds.size){socket.emit(name,value);return;}
      if(name==='mapPixels')mapIds.add(value.mapId);
      if(name==='mapFrame')frameIds.add(value.id);
      if(name==='textDisplay')textIds.add(value.id);
      if(mapIds.size>VIEWER_CONTENT_LIMITS.maps||frameIds.size>VIEWER_CONTENT_LIMITS.frames||textIds.size>VIEWER_CONTENT_LIMITS.textDisplays)fullReplay();
      // Old particles have no useful replay; cached pixels/frames can be resent.
      drain();
    });
    function close(){if(closed)return;closed=true;off();mapIds.clear();frameIds.clear();textIds.clear();socketDrainers.delete(drain);socketDisposers.delete(close);socket.off('disconnect',close);}
    socketDrainers.add(drain);socketDisposers.add(close);socket.on('disconnect',close);
    return close;
  }
  return {
    subscribe,subscribeSocket,
    flush,
    stats: () => ({ ...diagnostics, epoch, maps: maps.size, frames: frames.size, textDisplays:textDisplays.size, viewers: listeners.size, pendingParticles: queue.length }),
    dispose() { if (disposed) return; disposed = true; unschedule(timer);for(const close of [...socketDisposers])close();for (const off of hooks) off(); maps.clear(); frames.clear();textEntities.clear();textDisplays.clear(); listeners.clear(); queue = []; }
  };
}
