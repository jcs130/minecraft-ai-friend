import { PROTOCOL } from '../contracts/protocol.ts';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type { ArchiveQuery, BlobInput, BlobRef, EventEnvelope, EventStoreReader, WorldHost } from './contracts.ts';

/** An adapter-owned execution journal. Agent memory and interpretation remain with the caller. */
export class AgentJournal {
  readonly run = randomUUID();
  private cursor = 0;
  private readonly events: EventEnvelope[] = [];
  private pending = new Set<number>();
  private readonly deferred = new Map<string, { event: Parameters<WorldHost['pushDeferred']>[0]; options?: Parameters<WorldHost['pushDeferred']>[1] }>();
  private readonly blobDirectory: string;
  private readonly eventFile: string;

  constructor(readonly dataDir: string, private readonly maxRecentEvents = 1024, private readonly source = 'minecraft') {
    this.blobDirectory = join(dataDir, 'artifacts');
    mkdirSync(this.blobDirectory, { recursive: true });
    this.eventFile = join(dataDir, `events-${this.run}.jsonl`);
  }

  saveBlobs(inputs: readonly BlobInput[] = []): BlobRef[] {
    return inputs.map(input => {
      if ('handle' in input) {
        const got = this.blob(input.handle);
        if (!got) throw new Error(`Artifact unavailable: ${input.handle}`);
        return { handle: input.handle, mime: got.mime, fallbackText: input.fallbackText };
      }
      const digest = createHash('sha256').update(input.mime).update('\0').update(input.bytes).digest('hex');
      const handle = `log:${digest}`;
      const path = join(this.blobDirectory, digest);
      if (!existsSync(path)) {
        writeFileSync(path, input.bytes);
        writeFileSync(`${path}.json`, JSON.stringify({ mime: input.mime }));
      }
      return { handle, mime: input.mime, name: input.name, fallbackText: input.fallbackText };
    });
  }

  blob(handle: string): { bytes: Uint8Array; mime: string } | null {
    const match = /^log:([a-f0-9]{64})$/.exec(handle);
    if (!match) return null;
    const path = join(this.blobDirectory, match[1]);
    if (!existsSync(path) || !existsSync(`${path}.json`)) return null;
    return { bytes: readFileSync(path), mime: JSON.parse(readFileSync(`${path}.json`, 'utf8')).mime };
  }

  async pushEvent(input: Parameters<WorldHost['pushEvent']>[0], options?: Parameters<WorldHost['pushEvent']>[1]): Promise<EventEnvelope> {
    const { blobs, ...plain } = input;
    const event: EventEnvelope = { ...plain, protocol: PROTOCOL, cursor: ++this.cursor, run: this.run,
      origin: input.origin ?? 'external', contextDelivery: options?.deliver === false ? 'archive-only' : 'deliver',
      ...(options?.trigger ? { trigger: options.trigger } : {}),
      ...(blobs?.length ? { blobs: this.saveBlobs(blobs) } : {}) };
    appendFileSync(this.eventFile, JSON.stringify(event) + '\n');
    this.events.push(event);
    if (event.contextDelivery === 'deliver') this.pending.add(event.cursor);
    while (this.events.length > this.maxRecentEvents) this.pending.delete(this.events.shift()!.cursor);
    return structuredClone(event);
  }

  pushDeferred(event: Parameters<WorldHost['pushDeferred']>[0], options?: Parameters<WorldHost['pushDeferred']>[1]): void {
    this.deferred.set(`${event.type}\0${event.senderKey ?? ''}`, { event, options });
  }

  clearDeferred(): void { this.deferred.clear(); }

  async renderDeferred(signal?: AbortSignal): Promise<void> {
    const batch = [...this.deferred.values()];
    this.deferred.clear();
    await Promise.all(batch.map(async ({ event, options }) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const controller=new AbortController(), combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
      let onAbort=()=>{};
      try {
        const rendered = await Promise.race([Promise.resolve().then(() => {if(combined.aborted)return null;return event.render(combined);}),
          new Promise<null>(resolve => {onAbort=()=>resolve(null);combined.addEventListener('abort',onAbort,{once:true});
            if(combined.aborted)onAbort();timer=setTimeout(()=>controller.abort(),3000);})]);
        if (rendered === null || signal?.aborted) return;
        const { render: _render, ...plain } = event;
        await this.pushEvent({ ...plain, source: this.source, ts: new Date().toISOString(),
          ...(typeof rendered === 'string' ? { text: rendered } : rendered) }, options);
      } catch { /* A deferred sample can expire before it is rendered. */ }
      finally { clearTimeout(timer);combined.removeEventListener('abort',onAbort); }
    }));
  }

  drainPendingEvents(filter: (event: EventEnvelope) => boolean): Promise<EventEnvelope[]> {
    const selected = this.events.filter(event => this.pending.has(event.cursor) && filter(event));
    for (const event of selected) this.pending.delete(event.cursor);
    return Promise.resolve(structuredClone(selected));
  }

  read(after: number, limit: number, run?: string, includeArchived = false) {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 256)
      throw new Error('Invalid event page');
    if (after > 0 && run !== this.run) throw new Error('Event run changed; read after:0 to obtain the new run and cursor.');
    if (after > this.cursor) throw new Error('Event cursor is ahead of this runtime.');
    const oldestCursor = this.events[0]?.cursor ?? this.cursor + 1;
    const selected = this.events.filter(event => event.cursor > after);
    const scanned = selected.slice(0, limit);
    return { protocol: PROTOCOL, run: this.run, oldestCursor, latestCursor: this.cursor,
      nextCursor: scanned.at(-1)?.cursor ?? after, gap: after < oldestCursor - 1,
      hasMore: selected.length > scanned.length,
      events: structuredClone(scanned.filter(event => includeArchived || event.contextDelivery !== 'archive-only')) };
  }

  archiveRuns(): string[] {
    return readdirSync(this.dataDir).flatMap(file => /^events-([a-f0-9-]{36})\.jsonl$/.exec(file)?.slice(1) ?? []);
  }

  /** Includes original delivered and archive-only bodies, including events evicted from the recent ring. */
  async archive(query: ArchiveQuery = {}) {
    const run = query.run ?? this.run, after = query.after ?? 0, limit = query.limit ?? 64;
    if (!/^[a-f0-9-]{36}$/.test(run) || !Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 256)
      throw new Error('Invalid archive query');
    const file = join(this.dataDir, `events-${run}.jsonl`);
    if (!existsSync(file)) return { protocol: PROTOCOL, run, events: [], nextCursor: after, hasMore: false };
    const input = createReadStream(file, { encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    const events: EventEnvelope[] = [];
    let nextCursor = after, hasMore = false;
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        const event: EventEnvelope = JSON.parse(line);
        if (event.cursor <= after) continue;
        if (events.length === limit) { hasMore = true; break; }
        nextCursor = event.cursor;
        if (query.type && query.type !== event.type || query.keyword && !event.text.includes(query.keyword)) continue;
        events.push(event);
      }
    } finally { lines.close(); input.destroy(); }
    return { protocol: PROTOCOL, run, events, nextCursor, hasMore };
  }

  readonly store: EventStoreReader = {
    get: cursor => structuredClone(this.events.find(event => event.cursor === cursor)),
    latestCursor: () => this.cursor,
    range: query => {
      const selected = this.events.filter(event => (query.fromCursor === undefined || event.cursor >= query.fromCursor)
        && (query.toCursor === undefined || event.cursor <= query.toCursor)
        && (!query.fromTs || event.ts >= query.fromTs) && (!query.toTs || event.ts <= query.toTs)
        && (!query.senderKey || event.senderKey === query.senderKey) && (!query.source || event.source === query.source)
        && (!query.origin || event.origin === query.origin));
      return structuredClone(query.limit === undefined ? selected : selected.slice(-query.limit));
    },
    around: (cursor, before, after) => structuredClone(this.events.filter(event => event.cursor >= cursor - before && event.cursor <= cursor + after)),
    grep: query => this.store.range(query).filter(event => event.text.toLowerCase().includes(query.keyword.toLowerCase()))
      .slice(-(query.limit ?? this.maxRecentEvents)).map(event => ({ hitCursor: event.cursor,
        events: this.store.around(event.cursor, query.context, query.context) })),
  };
}
