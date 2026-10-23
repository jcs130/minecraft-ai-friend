import { randomUUID } from 'node:crypto';

export type AgentViewDelivery = 'captured' | 'tool-result' | 'host-event' | 'failed' | 'discarded';
export interface AgentViewInput {
  png: Uint8Array;
  capturedAt: string;
  mode: string;
  width: number;
  height: number;
  dimension: string;
  position: { x: number; y: number; z: number };
  focus?: string;
  callId?: string;
}
export interface AgentViewRecord extends Omit<AgentViewInput, 'png'> {
  id: string;
  url: string;
  delivery: AgentViewDelivery;
  /** Only a host request acknowledgement could establish this; capture is not delivery. */
  modelReceived: null;
}

/** Viewer-owned, bounded, ephemeral images. No prompts, model output, or host files. */
export class AgentViewGallery {
  private readonly entries = new Map<string, { record: AgentViewRecord; png: Buffer }>();
  private bytes = 0;
  constructor(private readonly maxEntries = 8, private readonly maxBytes = 32 * 1024 * 1024) {}

  add(input: AgentViewInput): string | null {
    const png = Buffer.from(input.png);
    if (png.length > this.maxBytes || png.length < 8 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
      || ![input.position.x, input.position.y, input.position.z, input.width, input.height].every(Number.isFinite)
      || !Number.isFinite(Date.parse(input.capturedAt))) return null;
    while (this.entries.size && (this.entries.size >= this.maxEntries || this.bytes + png.length > this.maxBytes)) {
      const id = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(id)!.png.length;
      this.entries.delete(id);
    }
    const id = randomUUID();
    const record: AgentViewRecord = { id, url: `/agent-views/${id}.png`, capturedAt: input.capturedAt,
      mode: input.mode, width: input.width, height: input.height, dimension: input.dimension,
      position: { ...input.position }, focus: input.focus?.slice(0, 160), callId: input.callId?.slice(0, 128),
      delivery: 'captured', modelReceived: null };
    this.entries.set(id, { record, png }); this.bytes += png.length;
    return id;
  }
  mark(id: string, delivery: AgentViewDelivery): void {
    const entry = this.entries.get(id);
    if (entry) entry.record.delivery = delivery;
  }
  list(): AgentViewRecord[] {
    return [...this.entries.values()].reverse().map(({ record }) => ({ ...record, position: { ...record.position } }));
  }
  image(id: string): Buffer | undefined { return this.entries.get(id)?.png; }
  clear(): void { this.entries.clear(); this.bytes = 0; }
}
