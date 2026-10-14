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
  read(key: string, sha256: string | undefined, offset = 0, limit = 8000) {
    if (!key || key.length > 512 || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 16000) throw new Error('Invalid original evidence query');
    const name = hash(key), latest = sha256 ?? JSON.parse(readFileSync(join(this.directory, `${name}.json`), 'utf8')).sha256;
    if (!/^[a-f0-9]{64}$/.test(latest)) throw new Error('Invalid evidence digest');
    const text = gunzipSync(readFileSync(join(this.directory, `${name}.${latest}.json.gz`)), { maxOutputLength: 24 * 1024 * 1024 }).toString('utf8');
    if (hash(text) !== latest) throw new Error('Original evidence digest mismatch');
    return { key, sha256: latest, totalChars: text.length, offset, text: text.slice(offset, offset + limit), hasMore: offset + limit < text.length };
  }
}
export function compactItem(value: any): unknown {
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(['slot', 'empty', 'count', 'name', 'displayName'].filter(key => key in value).map(key => [key, typeof value[key] === 'string' ? value[key].slice(0, 256) : value[key]]));
}
export function compactItems(value: any) { return Array.isArray(value) ? { size: value.length, occupied: value.filter(item => !item.empty).map(compactItem) } : value; }
export function compactNativeState(state: Record<string, any>) {
  const keys = ['protocol','sampledAt','generation','connected','server','uuid','username','dimension','position','health','food','yaw','pitch','onGround','selectedSlot','weather','time','screen','screenToken','screenTitle','syncId','menuRevision','buttons'];
  const out: Record<string, unknown> = Object.fromEntries(keys.filter(key => key in state).map(key => [key, typeof state[key] === 'string' ? state[key].slice(0, 512) : state[key]]));
  out.inventory = compactItems(state.inventory); out.menuSlots = compactItems(state.menuSlots); out.cursor = compactItem(state.cursor);
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
