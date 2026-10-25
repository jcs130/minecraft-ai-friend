import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';

const eventBytes = value => Buffer.from('data: ' + JSON.stringify(value) + '\n\n');
const latestTypes = new Set(['frame', 'motion', 'presentation']);

/** One authorized source epoch, one upstream SSE. Only a coherent checkpoint
 * and its ordered deltas are replayed. Effects/actions are never replayed.
 * Each downstream has independent, bounded backpressure; a slow phone cannot
 * stop acknowledgements to the home publisher or buffer indefinitely. */
export class SpectatorFanout extends EventEmitter {
  constructor({ playerUuid, open, maxViewers = 32, maxEventBytes = 16 * 1024 * 1024,
    maxReplayBytes = 24 * 1024 * 1024, maxDeltas = 128, maxBufferedBytes = 28 * 1024 * 1024, idleTimeoutMs = 10000 }) {
    super(); Object.assign(this, { playerUuid, open, maxViewers, maxEventBytes, maxReplayBytes, maxDeltas, maxBufferedBytes, idleTimeoutMs });
    this.clients = new Set(); this.clear(); this.closed = false; this.upstream = null;
  }
  clear() { this.decoder = new StringDecoder('utf8'); this.partial = ''; this.identity = null; this.checkpoint = null;
    this.deltas = []; this.latest = new Map(); this.epoch = null; this.sequence = null; this.replayBytes = 0; this.latestBytes = 0; this.order = 0; }
  state() { return { viewers: this.clients.size, upstreamStreams: this.upstream ? 1 : 0, replayBytes: this.replayBytes+this.latestBytes, deltas: this.deltas.length }; }
  subscribe(req, res) {
    if (this.closed || this.clients.size >= this.maxViewers) return false;
    const client = { req, res, queue: [], bytes: 0, blocked: false };
    client.close = () => { res.off('close', client.close); res.off('drain', client.drain); this.clients.delete(client);
      client.queue.length = 0; client.bytes = 0;
      if (!this.clients.size) { this.stop(); this.clear(); } };
    client.drain = () => { client.blocked = false; this.flush(client); };
    this.clients.add(client); res.once('close', client.close); res.on('drain', client.drain);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'private, no-store',
      'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' }); res.flushHeaders();
    if (this.identity) this.enqueue(client, this.identity);
    if (this.checkpoint) {
      for (const item of [this.checkpoint, ...this.deltas, ...[...this.latest.values()].sort((a,b) => a.order-b.order)]) this.enqueue(client, item);
    }
    if (!this.upstream) this.start();
    return true;
  }
  enqueue(client, item) {
    if (client.res.destroyed || !this.clients.has(client)) return;
    // Replace only consecutive motion/HUD samples, never a terrain boundary.
    if (latestTypes.has(item.type)) {
      for (let i=client.queue.length-1;i>=0;i--) {
        if (!latestTypes.has(client.queue[i].type)) break;
        if (client.queue[i].type === item.type) { client.bytes -= client.queue[i].bytes.length; client.queue.splice(i,1); break; }
      }
    }
    if (client.bytes + item.bytes.length + (client.res.writableLength || 0) > this.maxBufferedBytes) { client.res.destroy(); client.close(); return; }
    client.queue.push(item); client.bytes += item.bytes.length; this.flush(client);
  }
  flush(client) {
    while (!client.blocked && client.queue.length && this.clients.has(client)) {
      const item = client.queue.shift(); client.bytes -= item.bytes.length;
      client.blocked = !client.res.write(item.bytes);
    }
  }
  start() {
    if (this.closed || !this.clients.size || this.upstream) return;
    const sink = new EventEmitter(); sink.destroyed = false; sink.headersSent = false;
    sink.writeHead = status => { if (status !== 200) { this.close(); return; } sink.headersSent = true; };
    sink.flushHeaders = () => {};
    sink.write = bytes => {
      if (sink.destroyed || this.upstream !== sink) return true;
      this.touch();
      try { this.consume(bytes); } catch { this.close(); }
      return true; // Bounded per-viewer queues, never downstream TCP backpressure.
    };
    sink.end = sink.destroy = () => {
      if (sink.destroyed) return;
      sink.destroyed = true; sink.emit('close');
      if (this.upstream === sink) { this.upstream = null; this.close(); }
    };
    this.upstream = sink; this.touch(); this.open(sink);
  }
  touch() { clearTimeout(this.idleTimer);this.idleTimer=setTimeout(()=>this.close(),this.idleTimeoutMs);this.idleTimer.unref(); }
  stop() { clearTimeout(this.idleTimer);const sink = this.upstream; this.upstream = null; sink?.destroy(); }
  refresh() {
    if (this.refreshing || this.closed) return;
    this.refreshing = true;
    queueMicrotask(() => {
      this.refreshing = false; if (this.closed || !this.clients.size) return;
      const item = { type: 'waiting', bytes: eventBytes({ type:'waiting', epoch:this.epoch, reason:'SPECTATOR_CHECKPOINT_REFRESH' }) };
      for (const client of this.clients) this.enqueue(client,item);
      this.stop(); this.clear(); this.start();
    });
  }
  consume(bytes) {
    this.partial += this.decoder.write(bytes);
    let boundary;
    while ((boundary = /\r?\n\r?\n/.exec(this.partial))) {
      const block = this.partial.slice(0,boundary.index); this.partial = this.partial.slice(boundary.index+boundary[0].length);
      if (Buffer.byteLength(block) > this.maxEventBytes) throw Error('SPECTATOR_EVENT_LIMIT');
      const data = block.split(/\r?\n/).filter(s=>s.startsWith('data:')).map(s=>s.slice(5).replace(/^ /,'')).join('\n');
      if (data) this.receive(JSON.parse(data));
    }
    if (Buffer.byteLength(this.partial) > this.maxEventBytes) throw Error('SPECTATOR_EVENT_LIMIT');
  }
  receive(value) {
    if (!value || typeof value !== 'object' || typeof value.type !== 'string') throw Error('SPECTATOR_EVENT_INVALID');
    const item = { type:value.type, bytes:eventBytes(value), order:++this.order };
    if (value.type === 'identity') {
      if (value.playerUuid?.toLowerCase() !== this.playerUuid) throw Error('SPECTATOR_EVENT_IDENTITY');
      this.checkpoint=null; this.deltas=[]; this.latest.clear(); this.latestBytes=0; this.replayBytes=0; this.sequence=null; this.epoch=null; this.identity=item;
    } else if (['unavailable','waiting'].includes(value.type)) {
      this.checkpoint=null; this.deltas=[]; this.latest.clear(); this.latestBytes=0; this.replayBytes=0; this.sequence=null; this.epoch=null;
    } else if (['snapshot','snapshot_compact'].includes(value.type)) {
      if (!this.identity || !Number.isSafeInteger(value.epoch)) throw Error('SPECTATOR_CHECKPOINT_IDENTITY');
      if (this.epoch !== null && value.epoch < this.epoch) return;
      this.checkpoint=item; this.epoch=value.epoch; this.sequence=value.terrainSequence??null;
      this.deltas=[]; this.latest.clear(); this.latestBytes=0; this.replayBytes=item.bytes.length;
    } else if (value.type === 'snapshot_delta') {
      if (!this.checkpoint || value.epoch!==this.epoch || value.baseSequence!==this.sequence ||
          !Number.isSafeInteger(value.terrainSequence) || value.terrainSequence<=this.sequence) { this.refresh(); return; }
      // A terrain delta also contains the current pose/presentation. An older
      // cached frame must not roll a late visitor back after that newer state.
      this.latest.clear();this.latestBytes=0;
      this.sequence=value.terrainSequence; this.deltas.push(item); this.replayBytes+=item.bytes.length;
    } else if (latestTypes.has(value.type)) {
      if (!this.checkpoint || value.epoch!==this.epoch) return;
      this.latestBytes+=item.bytes.length-(this.latest.get(value.type)?.bytes.length??0);this.latest.set(value.type,item);
    } else if (!this.checkpoint || value.epoch!==this.epoch) return;
    for (const client of this.clients) this.enqueue(client,item);
    if (this.deltas.length>=this.maxDeltas || this.replayBytes+this.latestBytes>this.maxReplayBytes) this.refresh();
  }
  async check(authorize) {
    for (const client of [...this.clients]) {
      try { await authorize(client.req); } catch { client.res.destroy(); client.close(); }
    }
  }
  close() {
    if (this.closed) return;
    this.closed=true; this.stop(); this.clear();
    for (const client of [...this.clients]) { client.res.destroy(); client.close(); }
    this.emit('close');
  }
}

// Cache original assets only inside an already-authorized source instance.
// No global hash URL can bypass role authorization, even on an LRU hit.
export const cacheableSpectatorAsset = path => /^(?:assets\/|textures\/gui\/|sounds\/|api\/(?:server-appearance|server-items|bundled-appearances)\/assets\/)/.test(path);
export class SpectatorAssetCache {
  constructor({ maxBytes=64*1024*1024, maxEntryBytes=8*1024*1024, maxInflight=8 }={}) {
    Object.assign(this,{maxBytes,maxEntryBytes,maxInflight});this.entries=new Map();this.loading=new Map();this.bytes=0;this.closed=false;
  }
  async read(path, open) {
    if (this.closed) return null;
    const hit=this.entries.get(path);
    if(hit){this.entries.delete(path);this.entries.set(path,hit);return hit;}
    if(this.loading.has(path))return this.loading.get(path);
    if(this.loading.size>=this.maxInflight)return null;
    const promise=new Promise(resolve=>{
      const sink=new EventEmitter();let chunks=[],size=0,status=0,contentType=null,done=false;
      const finish=value=>{if(done)return;done=true;chunks=[];sink.destroyed=true;sink.emit('close');resolve(value);};
      sink.headersSent=false;sink.destroyed=false;
      sink.writeHead=(code,headers)=>{status=code;contentType=headers?.['Content-Type'];sink.headersSent=true;};sink.flushHeaders=()=>{};
      sink.write=bytes=>{if(done)return true;size+=bytes.length;if(size>this.maxEntryBytes){finish(null);return true;}chunks.push(bytes);return true;};
      sink.end=()=>{
        if(done)return;
        if(status!==200||this.closed)return finish(null);
        const bytes=Buffer.concat(chunks),value={bytes,contentType,etag:'"'+createHash('sha256').update(bytes).digest('hex')+'"'};
        while(this.bytes+bytes.length>this.maxBytes&&this.entries.size){const [key,old]=this.entries.entries().next().value;this.entries.delete(key);this.bytes-=old.bytes.length;}
        if(bytes.length<=this.maxBytes){this.entries.set(path,value);this.bytes+=bytes.length;}
        finish(value);
      };
      sink.destroy=()=>finish(null);open(sink);
    });
    this.loading.set(path,promise);
    try{return await promise;}finally{this.loading.delete(path);}
  }
  clear(){this.closed=true;this.entries.clear();this.loading.clear();this.bytes=0;}
}
