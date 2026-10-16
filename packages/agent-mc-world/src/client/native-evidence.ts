import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export class NativeEvidenceArchive {
  constructor(private readonly directory: string) {}
  save(key: string, value: unknown) {
    const text = JSON.stringify(value), sha256 = hash(text), name = hash(key);
    mkdirSync(this.directory, { recursive: true });
    writeFileSync(join(this.directory, `${name}.${sha256}.json.gz`), gzipSync(text, { level: 3 }));
    writeFileSync(join(this.directory, `${name}.json`), JSON.stringify({ key, sha256 }));
    return { key, sha256, originalChars: text.length };
  }
  read(key: string, sha256: string | undefined, offset = 0, limit = 8000, part: 'full' | 'script' = 'full') {
    if (!['full','script'].includes(part)) throw new Error('Unknown evidence part; use full or script');
    if (!key || key.length > 512 || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 16000) throw new Error('Invalid original evidence query');
    const name = hash(key), latest = sha256 ?? JSON.parse(readFileSync(join(this.directory, `${name}.json`), 'utf8')).sha256;
    if (!/^[a-f0-9]{64}$/.test(latest)) throw new Error('Invalid evidence digest');
    const text = gunzipSync(readFileSync(join(this.directory, `${name}.${latest}.json.gz`)), { maxOutputLength: 24 * 1024 * 1024 }).toString('utf8');
    if (hash(text) !== latest) throw new Error('Original evidence digest mismatch');
    let selected = text;
    if (part === 'script') {
      const original = JSON.parse(text), script = original.evidence?.script ?? original.script;
      if (script === undefined) throw new Error('This original evidence has no script report');
      selected = JSON.stringify(script);
    }
    return { key, sha256: latest, part, originalChars: text.length, totalChars: selected.length, offset, text: selected.slice(offset, offset + limit), hasMore: offset + limit < selected.length };
  }
}
export function compactItem(value: any): unknown {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(['slot', 'empty', 'count', 'name', 'displayName', 'instanceHash'].filter(key => key in value).map(key => [key, typeof value[key] === 'string' ? value[key].slice(0, 256) : value[key]]));
}
export function compactItems(value: any) { return Array.isArray(value) ? { size: value.length, occupied: value.filter(item => !item.empty).map(compactItem) } : value; }
/** Only alias an exactly equal displayed slot list; different slot mappings stay explicit. */
export function compactNativeItems(state: Record<string, any>) {
  const inventory = compactItems(state.inventory), menuSlots = compactItems(state.menuSlots);
  return { inventory, menuSlots: inventory?.occupied && menuSlots?.occupied
    && inventory.occupied.length > 0 && JSON.stringify(inventory.occupied) === JSON.stringify(menuSlots.occupied)
    ? { size: menuSlots.size, occupiedFrom: 'inventory.occupied' } : menuSlots };
}
/** A terminal notification points to the full archived receipt instead of repeating its body snapshot. */
export function compactNativeActionEvent(state: Record<string, any>) {
  const keys = ['protocol','sampledAt','generation','connected','server','uuid','username','dimension','position','health','food','yaw','pitch','onGround','selectedSlot','screen','screenToken','screenTitle','syncId','menuRevision'];
  return { ...Object.fromEntries(keys.filter(key => key in state).map(key => [key, typeof state[key] === 'string' ? state[key].slice(0,512) : state[key]])),
    cursor: compactItem(state.cursor), inventoryTransfer: compactInventoryTransfer(state.inventoryTransfer), ...(state.navigation?{navigation:compactNavigation(state.navigation)}:{}),stateQuery: 'mc_state / mc_bag', originalQuery: 'mc_evidence with raw.key and raw.sha256' };
}
export function compactNativeState(state: Record<string, any>) {
  const keys = ['protocol','sampledAt','generation','connected','server','uuid','username','dimension','position','health','food','yaw','pitch','onGround','selectedSlot','weather','time','screen','screenToken','screenTitle','syncId','menuRevision','buttons'];
  const out: Record<string, unknown> = Object.fromEntries(keys.filter(key => key in state).map(key => [key, typeof state[key] === 'string' ? state[key].slice(0, 512) : state[key]]));
  Object.assign(out, compactNativeItems(state)); out.cursor = compactItem(state.cursor);
  if(state.inventoryPick) out.inventoryPick=state.inventoryPick;
  if(state.inventoryTransfer) out.inventoryTransfer=compactInventoryTransfer(state.inventoryTransfer);
  if(state.navigationCapability)out.navigationCapability=state.navigationCapability;
  if(state.navigation)out.navigation=compactNavigation(state.navigation);
  if(state.serverAuthorization)out.serverAuthorization=Object.fromEntries(['protocol','required','generation','observedAt','phase','authorized','connectionMatched','username','server','confirmedAt'].filter(k=>k in state.serverAuthorization).map(k=>[k,state.serverAuthorization[k]]));
  out.notices = { retained: state.messages?.length ?? 0, lastSeq: state.messages?.at(-1)?.seq ?? 0 };
  if (Array.isArray(state.actions)) {
    // Past actions remain in the raw archive, not repeated in every input receipt/frame.
    // Keep pending work visible, with explicit counts for omitted/uncertain history.
    const active = state.actions.filter((a: any) => ['accepted','running'].includes(a.phase));
    const history = state.actions.filter((a: any) => !['accepted','running'].includes(a.phase))
      .sort((a: any,b: any) => a.updatedAt-b.updatedAt);
    const shown = [...active.slice(-17), ...history.slice(-4)];
    out.actions = shown;
    out.actionSummary = { retained: state.actions.length, shown: shown.length, omitted: state.actions.length-shown.length,
      pending: active.length, unknown: state.actions.filter((a: any) => a.phase === 'unknown').length, rawQuery: 'mc_queue / mc_evidence' };
  }
  return out;
}

/** Current body/queue facts without inventory/menu duplication. Originals remain queryable. */
export function compactNativeBody(state: Record<string, any>) {
  const out = compactNativeState(state);
  delete out.inventory; delete out.menuSlots;
  out.detail = 'body';
  out.inventorySummary = Array.isArray(state.inventory) ? { size: state.inventory.length,
    occupiedStacks: state.inventory.filter((item: any) => !item.empty).length,
    heldItem: Number.isInteger(state.selectedSlot) ? compactItem(state.inventory.find((item: any) => item.slot === state.selectedSlot) ?? null) : null,
  } : null;
  out.menuSummary = Array.isArray(state.menuSlots) ? { size: state.menuSlots.length,
    occupiedStacks: state.menuSlots.filter((item: any) => !item.empty).length } : null;
  out.inventoryQuery = 'mc_bag for current stacks/menu slots; mc_state detail:summary or mc_evidence raw for the complete observation';
  return out;
}

function compactNavigation(value: any){
  if(!value||typeof value!=='object')return undefined;
  return Object.fromEntries(['protocol','navigator','actionId','phase','reason','goal','feet','onGround','cleanupPending'].filter(key=>key in value).map(key=>[key,typeof value[key]==='string'?value[key].slice(0,512):value[key]]));
}

function compactInventoryTransfer(value: any) {
  if(!value || typeof value!=='object') return undefined;
  return Object.fromEntries(['protocol','id','actionId','sourceSlot','selectedSlot','phase','sentAt','dispatched','confirmedAt','confirmation','matched','reason']
    .filter(key=>key in value).map(key=>[key,typeof value[key]==='string'?value[key].slice(0,512):value[key]]));
}
