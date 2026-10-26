import { publicNativeItemStack } from './native-item-stack.js';

const pick=(value,keys)=>value&&typeof value==='object'?Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]])):value;
const selfKeys='uuid name playerUuid entityId position yaw pitch eyeHeight bodyYaw headYaw health maxHealth absorption food saturation armor oxygen airSupply maxAirSupply experienceLevel experienceProgress experiencePoints quickBarSlot mainArm onGround sprinting flying inWater surfaceBlock sneaking crouching velocity skin paperAppearance locomotion pose spinAttack swinging usingItem useItemRemainingTicks attackAnim climbing isPassenger vehicleType ysm handAnimation'.split(' ');
const stateKeys='schemaVersion mode minecraftVersion registrySha256 epoch revision packetSequence dimension pose time bounds states groups occludedSolidRuns kinetic cuttingBoards missingColumns particleCollisions entityState neighbors biomeSeed biomeGrid biomes viewCoverage entityRenderingAvailable lightingParityVerified completeSceneParityVerified terrainEncoding terrainSequence terrainSignature motion handAnimation playerUuid'.split(' ');
function equipment(row) {
  if(!row)return null;
  const result=pick(row,['source','playerUuid','entityId']);
  for(const key of ['mainHand','offHand','head','chest','legs','feet']) {
    try{result[key]=publicNativeItemStack(row[key]??null);}catch{result[key]=null;}
  }
  return result;
}
function self(row){const out=pick(row,selfKeys);if(out&&Object.hasOwn(row,'equipment'))out.equipment=equipment(row.equipment);return out;}
export function publicGameMessages(rows){return (Array.isArray(rows)?rows:[]).slice(-24).filter(row=>
  typeof row?.text==='string'&&row.text.length<=2000&&!/(?:MC_AUTH_|\/(?:[\w-]+:)?(?:login|register|changepassword|changepass|password|2fa|totp|auth)\b|password|passwd|api[ _-]?key|authorization|bearer\s|(?:sk[-_]|(?:srv|obs|pub|pat)_)[A-Za-z0-9_-]{16}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.|密码|口令|验证码|密钥|令牌)/i.test(row.text))
  .map(row=>pick(row,['seq','kind','text','observedAt']));}
function inventory(row){
  if(!row||!Array.isArray(row.slots)||row.slots.length>64)return null;
  return {...pick(row,['playerUuid','windowId','selectedHotbarSlot','inventoryStart','hotbarStart','offhandSlot']),
    slots:row.slots.map(slot=>{let item=null;try{item=publicNativeItemStack(slot.item??null);}catch{}return {slot:slot.slot,item};}),carried:null};
}
export function publicSpectatorPresentation(value){
  if(!value)return null;
  const out=pick(value,'schemaVersion playerUuid available source sampledAt reason profile serverItemPackId nativeState renderRegistries entityRenderStates contraptionRenderStates time weather'.split(' '));
  out.self=self(value.self);out.inventory=inventory(value.inventory);out.nativeMenu=null;out.gameMessages=publicGameMessages(value.gameMessages);out.skills=null;out.modOperations=[];out.agentPlayback=null;
  return out;
}
function state(value){
  const out=pick(value,stateKeys);
  if(Object.hasOwn(value,'selfPlayer'))out.selfPlayer=self(value.selfPlayer);
  if(Object.hasOwn(value,'presentation'))out.presentation=publicSpectatorPresentation(value.presentation);
  return out;
}
/** Explicit public projection at the cloud boundary. A private upstream is
 * shared, but neither its replay cache nor raw status/Agent endpoints go to a
 * guest. Unknown event types fail closed. Terrain is unchanged, not re-meshed. */
export function publicSpectatorEvent(value){
  if(!value||typeof value!=='object')return null;
  if(value.type==='identity')return pick(value,'type player confirmed playerUuid entityId epoch profile viewerBuild minecraftVersion registrySha256 mode readOnly'.split(' '));
  if(['unavailable','waiting'].includes(value.type))return pick(value,['type','epoch','reason']);
  if(['snapshot','snapshot_compact','frame','motion','presentation'].includes(value.type))return {type:value.type,...state(value)};
  if(value.type==='snapshot_delta')return {...pick(value,['type','schemaVersion','epoch','registrySha256','mode','baseSequence','terrainSequence','groups','occludedSolidRuns','neighbors']),
    set:state(value.set??{}),drop:(value.drop??[]).filter(k=>[...stateKeys,'selfPlayer','presentation'].includes(k))};
  if(value.type==='world_effect')return pick(value,['type','epoch','playerUuid','source','effect','sequence','observedAt','tick']);
  if(value.type==='entity_collect')return pick(value,['type','epoch','playerUuid','source','collectedEntityId','collectorEntityId','sequence','count','target','tick']);
  return null;
}
export function publicSpectatorStatus(value){return {...pick(value,['schemaVersion','mode','readOnly','build','identity','connection','viewer']),
  selfPlayer:self(value.selfPlayer),presentation:publicSpectatorPresentation(value.presentation),agent:{available:false,reason:'PUBLIC_SCENE_ONLY'}};}
