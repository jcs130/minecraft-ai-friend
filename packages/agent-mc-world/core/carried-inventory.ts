import { createHash, randomUUID } from 'node:crypto';
import type { Bot } from 'mineflayer';
import { inventoryStackKind } from './inventory-click-sync.ts';
import { itemCustomName } from './item-display.ts';
import type { ItemLike } from './item-facts.ts';

type Slots = Bot['inventory']['slots'];
type Change = { name: string; variant?: string; displayName?: string; before: number; after: number };
export interface CarriedInventoryReading {
  protocol: 'agent-mc-carried-inventory/v1'; kind: 'baseline' | 'delta'; observedAt: string;
  previousAt: string | null; usedSlots: number; freeSlots: number; changes: Change[]; omittedChanges: number;
  revision: string; offset: number; totalChanges: number;
  next_safe_read: { tool: 'mc_bag'; arguments: { detail: 'slots' } | {detail:'changes';offset:number;revision:string} };
}
type Entry = Omit<Change, 'before' | 'after'> & { count: number };
type Frame = { stock: Map<string, Entry>; used: number };

/** Links component-patched stacks to the exact slot read without emitting their raw payload. */
export function carriedItemVariant(item: ItemLike, displayName: string | null): string | undefined {
  const patch = item as ItemLike & {metadata?:number; components?:unknown[]; removedComponents?:unknown[]};
  if (item.nbt == null && !patch.metadata && !patch.components?.length && !patch.removedComponents?.length && !displayName)
    return undefined;
  return createHash('sha256').update(inventoryStackKind(item)).update(displayName ?? '').digest('hex').slice(0,16);
}

/** Sample only the native player's main and hotbar slots, after inventory sync. */
function capture(slots: Slots): Frame {
  const stock = new Map<string, Entry>();
  let used = 0;
  for (const item of slots.slice(9,45)) {
    if (!item || item.count <= 0) continue;
    used++;
    const displayName = itemCustomName(item);
    const variant = carriedItemVariant(item, displayName);
    const key = item.name + '/' + (variant ?? '');
    const entry = stock.get(key);
    if (entry) entry.count += item.count;
    else stock.set(key, { name:item.name, ...(variant ? {variant} : {}), ...(displayName ? {displayName} : {}), count:item.count });
  }
  return { stock, used };
}

/** One published comparison frame per body. Queries cannot consume a pending event. */
export class CarriedInventoryObserver {
  private frame?: Frame;
  private last?: CarriedInventoryReading;
  private rows: Change[] = [];
  private pending?: { signature: string; reading: CarriedInventoryReading; rows: Change[] };
  private published = false;

  read(slots: Slots, at: string, publish = false): { reading: CarriedInventoryReading; changed: boolean } {
    const next = capture(slots);
    const changes: Change[] = [];
    if (this.frame) for (const key of new Set([...this.frame.stock.keys(),...next.stock.keys()])) {
      const old = this.frame.stock.get(key), current = next.stock.get(key);
      const before = old?.count ?? 0, after = current?.count ?? 0;
      if (before === after) continue;
      const { count: _count, ...identity } = (current ?? old)!;
      changes.push({ ...identity, before, after });
    }
    const different = !this.frame || this.frame.used !== next.used || changes.length > 0;
    if (!different && this.last) {
      this.pending = undefined;
      const changed = !this.published;
      if (publish) this.published = true;
      return { reading:this.last, changed };
    }
    changes.sort((a,b) => Math.abs(b.after-b.before)-Math.abs(a.after-a.before)
      || a.name.localeCompare(b.name) || (a.variant ?? '').localeCompare(b.variant ?? ''));
    const signature = JSON.stringify([next.used,changes]);
    const revision = this.pending?.signature === signature ? this.pending.reading.revision : randomUUID();
    const reading: CarriedInventoryReading = this.pending?.signature === signature ? this.pending.reading : { protocol:'agent-mc-carried-inventory/v1',
      kind:this.frame ? 'delta' : 'baseline', observedAt:at, previousAt:this.last?.observedAt ?? null,
      usedSlots:next.used, freeSlots:36-next.used, revision, ...pageOf(changes,0,revision) };
    if (publish || !this.frame) {
      this.frame = next; this.last = reading; this.rows = changes; this.published = publish; this.pending = undefined;
    } else this.pending = {signature,reading,rows:changes};
    return { reading, changed:true };
  }

  page(reading: CarriedInventoryReading, revision: unknown, offset: unknown): CarriedInventoryReading | null {
    if (reading.revision !== revision || typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) return null;
    const rows = this.last?.revision === revision ? this.rows : this.pending?.reading.revision === revision ? this.pending.rows : null;
    if (!rows || (offset > 0 && offset >= rows.length)) return null;
    return {...reading,...pageOf(rows,offset,reading.revision)};
  }
}

function pageOf(rows: Change[], offset: number, revision: string) {
  const changes = rows.slice(offset,offset+8);
  const omittedChanges = rows.length - offset - changes.length;
  const args: CarriedInventoryReading['next_safe_read']['arguments'] = omittedChanges
    ? {detail:'changes',offset:offset+changes.length,revision} : {detail:'slots'};
  return {changes,offset,omittedChanges,totalChanges:rows.length,next_safe_read:{tool:'mc_bag' as const,arguments:args}};
}

export function carriedInventoryText(reading: CarriedInventoryReading | undefined): string {
  if (!reading) return '本人随身库存未同步，数量与空格未知。';
  const entries = reading.changes.map(row => (row.displayName ?? row.name) + (row.variant ? '#' + row.variant.slice(0,8) : '')
    + ' ' + row.before + '→' + row.after);
  const suffix = reading.omittedChanges ? '，另有' + reading.omittedChanges + '类变化' : '';
  const delta = reading.kind === 'baseline' ? '已同步基线 ' + reading.observedAt
    : '上次观察变化 ' + reading.observedAt + '：' + (entries.join('、') || '仅占格数变化') + suffix;
  return '随身 ' + reading.usedSlots + '/36 格，空 ' + reading.freeSlots + '。' + delta + '。明细 mc_bag {detail:"slots"}。';
}
