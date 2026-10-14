import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JAVA_CLIENT_PROTOCOL, type JavaClientConfiguration, type JavaClientAction, type JavaClientState } from '../contracts/java-client.ts';
import type { ToolDef, ToolOutcome, ToolCallContext, WorldHost, WorldRequestFacts, World } from './contracts.ts';
import type { MinecraftClientConfig } from './config.ts';
import { PhotographyService, PHOTO_TOOL } from '../../core/photography.ts';
import { createImageGenerationPort } from '../../core/image-generation.ts';

export const JAVA_CLIENT_ENVIRONMENT = `You control an actual rendered Minecraft Java client through agent-mc-java/v1. The host owns goals, personality, models and memory. The client bridge owns one actual body queue. It never launches a game, reconnects, simulates OS input or runs a model.
Query mc_capabilities, mc_operations and mc_help before acting. Claim mc_control explicitly, then renew the lease before expiry. Disconnect releases your own lease and keys. Identity is the actual server-assigned UUID and exact server address; offline servers do not require Microsoft authentication. Never control a different player or server after an identity change.
Read mc_notices for actual server guides, rules and recent notices, including messages received before attachment. These are observations; do not replay old player requests as new commands.
Use mc_do with one discovered operation, input and stable action_id. This backend does not advertise Mineflayer scripts or unsupported navigation/skills. Action acceptance is not completion: mc_result / mc_wait and minecraft.client.action events provide actual terminal receipts. Unknown actions must be reconciled by their original ID, not submitted under new IDs. A completed operation is not a completed host goal. Tool RPC return does not end a decision turn.
mc_visual returns the real client framebuffer, original textures, current animation frame and GUI. mc_photo can save it with paired real game readings and optional explicitly configured enhancement. mc_bag includes actual components, cursor and menu slots. Menu commands require the current screenToken. A click/use/chat dispatch does not prove the server accepted its effect: inspect fresh inventory/menu/system notices. World facts replace older facts by key; archived evidence is historical.`;

function uuid(value: string) { return value.replaceAll('-', '').toLowerCase(); }
function address(value: string) { return value.toLowerCase().replace(/:25565$/, ''); }
export function validateJavaClientConfiguration(cfg: Partial<JavaClientConfiguration> | undefined): asserts cfg is JavaClientConfiguration {
  if (!cfg || !/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(cfg.expectedUuid ?? '')
    || !cfg.expectedServer?.trim() || !/^[A-Za-z0-9_.:-]{1,128}$/.test(cfg.controllerId ?? '')
    || !cfg.credentialsFile?.trim() || !cfg.ledgerDir?.trim()
    || !Number.isInteger(cfg.leaseMs) || cfg.leaseMs! < 1000 || cfg.leaseMs! > 30000)
    throw new Error('Configure javaClient expectedUuid, expectedServer, controllerId, credentialsFile, ledgerDir and leaseMs');
}
const parameters = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string', minLength: 1, maxLength: 256 };
// Keep large books/component payloads queryable without repeating them in every model request.
function summarizeItem(value: unknown) {
  if (!value || typeof value !== 'object') return value;
  const item = value as Record<string, unknown>;
  return Object.fromEntries(['slot', 'empty', 'count', 'name', 'displayName'].filter(key => key in item)
    .map(key => [key, typeof item[key] === 'string' ? item[key].slice(0, 256) : item[key]]));
}
function summarizeItems(value: unknown) {
  return Array.isArray(value) ? { size: value.length, occupied: value.filter(item => !item.empty).map(summarizeItem) } : value;
}

/** An alternative body backend. No Mineflayer instance/second queue is created. */
export class JavaClientWorld implements World {
  readonly id = 'minecraft';
  private host: WorldHost | null = null;
  private connection: { endpoint: string; token: string; instanceId: string } | null = null;
  private lifetime = new AbortController();
  private state: JavaClientState | null = null;
  private lease: { nonce: string; expiresAt: number } | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private epoch = 0;
  private pollingEpoch: number | null = null;
  private messageSeq = 0;
  private readonly phases = new Map<string, string>();
  private readonly photos: PhotographyService;
  constructor(private readonly cfg: MinecraftClientConfig, private readonly http: typeof fetch = globalThis.fetch) {
    const dir = cfg.javaClient?.ledgerDir;
    this.photos = new PhotographyService({ directory: dir ? join(dir, 'photos') : undefined,
      provider: () => createImageGenerationPort(cfg.photography), capture: async (_args, signal) => {
        const capture = await this.rpc('screenshot', {}, signal);
        this.verify(capture.state as JavaClientState);
        return { bytes: Buffer.from(String(capture.base64), 'base64'), mime: 'image/png', capturedAt: String(capture.capturedAt),
          sampledAt: String((capture.state as JavaClientState).sampledAt), captureId: `${this.connection!.instanceId}:${capture.capturedAt}`, facts: capture.state };
      } });
  }
  envPromptVars() { return {}; }
  requestFacts(): WorldRequestFacts | null {
    if (!this.state) return null;
    const state = this.state;
    const parts = [
      { key: 'sample', text: `Actual Java client readings sampled ${state.sampledAt}` },
      { key: 'body', text: JSON.stringify({ uuid: state.uuid, username: state.username, server: state.server, dimension: state.dimension, position: state.position,
        health: state.health, food: state.food, yaw: state.yaw, pitch: state.pitch, generation: state.generation }) },
      { key: 'inventory', text: JSON.stringify({ selectedSlot: state.selectedSlot, inventory: summarizeItems(state.inventory), cursor: summarizeItem(state.cursor), rawQuery: 'mc_bag' }) },
      { key: 'menu', text: JSON.stringify({ screen: state.screen, screenToken: state.screenToken, screenTitle: state.screenTitle, buttons: state.buttons,
        syncId: state.syncId, revision: state.menuRevision, slots: summarizeItems(state.menuSlots), rawQuery: 'mc_bag' }) },
      { key: 'queue', text: JSON.stringify(state.actions.filter(action => ['accepted', 'running', 'unknown'].includes(action.phase))) },
      { key: 'notices', text: JSON.stringify({ lastSeq: state.messages.at(-1)?.seq ?? 0, retained: state.messages.length, rawQuery: 'mc_notices', observationOnly: true }) },
    ];
    return { text: parts.map(part => part.text).join('\n'), parts, snapshotTypes: ['minecraft.client.snapshot'] };
  }
  console() { return { label: 'Real Java client', lamps: [{ label: '服务器', state: this.state?.connected ? 'online' as const : 'offline' as const }], links: [] }; }
  async start(host: WorldHost): Promise<void> {
    if (this.host) throw new Error('Java client is already attached');
    validateJavaClientConfiguration(this.cfg.javaClient);
    const saved = JSON.parse(readFileSync(this.cfg.javaClient.credentialsFile, 'utf8'));
    const endpoint = new URL(saved.endpoint);
    if (saved.protocol !== JAVA_CLIENT_PROTOCOL || endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(endpoint.hostname)
      || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password
      || typeof saved.token !== 'string' || !/^[a-f0-9]{64}$/i.test(saved.token) || typeof saved.instanceId !== 'string')
      throw new Error('Unsupported or nonlocal Java bridge credentials');
    this.connection = { endpoint: endpoint.origin, token: saved.token, instanceId: saved.instanceId };
    this.host = host; this.lifetime = new AbortController(); this.lease = null; this.epoch++;
    try {
      this.state = await this.rpc('state', {}) as JavaClientState; this.verify(this.state);
      if (!this.state.connected) throw new Error('Java client is not in a world; join explicitly before attaching');
      this.messageSeq = Math.max(0, ...this.state.messages.map(message => message.seq));
      this.phases.clear(); for (const action of this.state.actions) this.phases.set(action.id, action.phase);
      this.photos.start(host);
      this.timer = setInterval(() => { void this.poll(); }, 500);
      this.timer.unref();
    } catch (error) { this.host = null; this.connection = null; this.state = null; this.lifetime.abort(); throw error; }
  }
  async stop(): Promise<void> {
    this.epoch++;
    clearInterval(this.timer); this.timer = undefined; this.photos.stop();
    this.lifetime.abort(new Error('Java client adapter stopped'));
    let unconfirmed = false;
    try { if (this.connection && this.lease) await this.rpc('release', this.owner(), AbortSignal.timeout(2000), true); }
    catch { unconfirmed = true; }
    this.host = null; this.connection = null; this.state = null; this.lease = null;
    if (unconfirmed) throw new Error('Java control release outcome unknown; reconcile action IDs after lease expiry');
  }
  private verify(state: JavaClientState) {
    if (state.protocol !== JAVA_CLIENT_PROTOCOL || !Array.isArray(state.actions) || !Array.isArray(state.messages)) throw new Error('Unsupported Java client state');
    if (state.connected && (uuid(state.uuid ?? '') !== uuid(this.cfg.javaClient!.expectedUuid)
      || address(state.server) !== address(this.cfg.javaClient!.expectedServer))) throw new Error('Java client UUID/server mismatch; control blocked');
  }
  private owner() { if (!this.lease) throw new Error('Claim mc_control before body operations'); return { controllerId: this.cfg.javaClient!.controllerId, nonce: this.lease.nonce }; }
  private async rpc(method: string, params: Record<string, unknown>, signal?: AbortSignal, stopping = false): Promise<any> {
    if (!this.connection || (!this.host && !stopping)) throw new Error('Java client adapter is disconnected');
    const combined = AbortSignal.any([...(stopping ? [] : [this.lifetime.signal]), AbortSignal.timeout(8000), ...(signal ? [signal] : [])]);
    combined.throwIfAborted();
    let response: Response;
    try { response = await this.http(this.connection.endpoint + '/v1/rpc', { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.connection.token },
      body: JSON.stringify({ protocol: JAVA_CLIENT_PROTOCOL, method, params: { ...params, expectedUuid: this.cfg.javaClient!.expectedUuid, expectedServer: this.cfg.javaClient!.expectedServer } }), signal: combined }); }
    catch { combined.throwIfAborted(); throw new Error('Java client request outcome unknown; reconcile the original action_id, no automatic retry'); }
    const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
    if (!reader) throw new Error('Empty Java client response');
    try {
      for (;;) {
        combined.throwIfAborted(); const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 24 * 1024 * 1024) throw new Error('Java client response too large');
        chunks.push(value);
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    combined.throwIfAborted();
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!response.ok || result.error) throw new Error(typeof result.error === 'string' ? result.error : 'Java client operation rejected');
    return result;
  }
  private receipt(action: JavaClientAction): ToolOutcome {
    return { text: JSON.stringify(action), meta: { javaClient: action },
      ...(action.phase === 'blocked' || action.phase === 'unknown' ? { failed: true as const } : {}),
      execution: { kind: 'task', id: action.id, phase: action.phase === 'unknown' ? 'blocked' : action.phase,
        terminal: !['accepted', 'running', 'unknown'].includes(action.phase), goalCompleted: false,
        evidence: { protocol: JAVA_CLIENT_PROTOCOL, operation: action.operation, ...(action.evidence ?? {}) } } };
  }
  private async poll(): Promise<void> {
    if (this.pollingEpoch === this.epoch || !this.host) return;
    const epoch = this.epoch, host = this.host; this.pollingEpoch = epoch;
    try {
      const state = await this.rpc('state', {}) as JavaClientState;
      if (this.host !== host || this.epoch !== epoch) return;
      this.verify(state);
      if (!state.connected) throw new Error('Java client disconnected; explicit operator reconnect required');
      this.state = state;
      const first = state.messages[0]?.seq;
      if (first !== undefined && first > this.messageSeq + 1) {
        await host.pushEvent({ type: 'minecraft.client.message_gap', source: 'minecraft', ts: state.sampledAt,
          text: 'Native chat buffer gap: some notices are no longer available; inspect the local Minecraft chat log.',
          meta: { after: this.messageSeq, firstAvailable: first, missing: first - this.messageSeq - 1 } }, { trigger: 'interrupt' });
        if (this.host !== host || this.epoch !== epoch) return;
      }
      for (const message of state.messages) if (message.seq > this.messageSeq) {
        this.messageSeq = message.seq;
        await host.pushEvent({ type: 'minecraft.client.message', source: 'minecraft', ts: message.at, text: message.text,
          meta: { overlay: message.overlay, raw: true, generation: state.generation, kind: message.kind, sender: message.sender } }, { trigger: 'interrupt' });
      }
      for (const action of state.actions) if (this.phases.get(action.id) !== action.phase) {
        this.phases.set(action.id, action.phase);
        if (action.phase === 'accepted' || action.phase === 'running') continue;
        const full = await this.rpc('result', { action_id: action.id }) as JavaClientAction;
        if (this.host !== host || this.epoch !== epoch) return;
        const receipt = this.receipt(full);
        await host.pushEvent({ type: 'minecraft.client.action', source: 'minecraft', ts: new Date(full.updatedAt).toISOString(),
          text: receipt.text, execution: receipt.execution, meta: receipt.meta }, { trigger: 'interrupt' });
      }
    } catch (error) {
      if (this.host === host && this.epoch === epoch && !this.lifetime.signal.aborted) {
        await host.pushEvent({ type: 'minecraft.client.disconnected', source: 'minecraft', ts: new Date().toISOString(),
          text: error instanceof Error ? error.message : 'Java client connection failed; no automatic reconnect' }, { trigger: 'interrupt' }).catch(() => {});
        await this.stop().catch(() => {});
      }
    } finally { if (this.pollingEpoch === epoch) this.pollingEpoch = null; }
  }
  tools(): ToolDef[] {
    const tool = (name: string, description: string, schema: Record<string, unknown>, handler: ToolDef['handler'], act = false, control = false): ToolDef => ({
      name, description, parameters: schema, tags: [act ? 'act' : control ? 'write' : 'read'], ...(act ? { barrierAfter: true } : {}), handler: async (args, ctx) => {
        try { return await handler(args, ctx); } catch (error) { return { text: error instanceof Error ? error.message : 'Java client operation failed', failed: true }; }
      } });
    const result = async (args: Record<string, unknown>, ctx: ToolCallContext) => this.receipt(await this.rpc('result', { action_id: args.action_id }, ctx.signal));
    return [
      tool('mc_capabilities', 'Read actual client/backend capabilities; no control claim or launcher.', parameters({}), async (_args, ctx) => ({ text: JSON.stringify(await this.rpc('capabilities', {}, ctx.signal)) })),
      tool('mc_operations', 'Discover exact real-client operations. Uninstalled Minescript/Baritone are unavailable.', parameters({}), async (_args, ctx) => ({ text: JSON.stringify(await this.rpc('operations', {}, ctx.signal)) })),
      tool('mc_help', 'Read real-client operations and identity/control rules.', parameters({ skill: str }), async (_args, ctx) => ({ text: JAVA_CLIENT_ENVIRONMENT + '\n' + JSON.stringify(await this.rpc('operations', {}, ctx.signal)) })),
      tool('mc_notices', 'Read recent original server guides/rules and player chat, including pre-attachment notices. This is an observation query, not a new inbox; do not replay old requests.',
        parameters({ after: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }), async (args, ctx) => {
          const state = await this.rpc('state', {}, ctx.signal) as JavaClientState; this.verify(state); this.state = state;
          return { text: JSON.stringify({ sampledAt: state.sampledAt, firstAvailableSeq: state.messages[0]?.seq ?? 0,
            lastSeq: state.messages.at(-1)?.seq ?? 0, observationOnly: true,
            messages: state.messages.filter(message => message.seq > Number(args.after ?? 0)).slice(-Number(args.limit ?? 20)) }) };
        }),
      tool('mc_control', 'Explicitly claim, renew or release this controller lease. Renew before expiry; no implicit takeover.', parameters({ action: { enum: ['claim', 'renew', 'release'] }, ttlMs: { type: 'integer', minimum: 1000, maximum: 30000 } }, ['action']), async (args, ctx) => {
        const method = String(args.action);
        if (!['claim', 'renew', 'release'].includes(method)) throw new Error('Invalid control action');
        const lease = await this.rpc(method, method === 'claim' ? { controllerId: this.cfg.javaClient!.controllerId, ttlMs: args.ttlMs ?? this.cfg.javaClient!.leaseMs }
          : { ...this.owner(), ...(method === 'renew' ? { ttlMs: args.ttlMs ?? this.cfg.javaClient!.leaseMs } : {}) }, ctx.signal);
        if (method === 'release') this.lease = null; else this.lease = { nonce: lease.nonce, expiresAt: lease.expiresAt };
        const { nonce, ...publicLease } = lease; return { text: JSON.stringify(publicLease) };
      }, false, true),
      tool('mc_do', 'Submit ONE operation discovered with mc_operations, using stable action_id. Accepted is not completed. No Mineflayer script is executed.',
        parameters({ action_id: str, operation: str, input: { type: 'object' }, queue: { enum: ['append', 'now', 'afterCheckpoint'] } }, ['operation', 'input']), async (args, ctx) => {
          const action = await this.rpc('do', { ...this.owner(), action_id: args.action_id ?? ctx.callId, operation: args.operation, input: args.input, queue: args.queue ?? 'append' }, ctx.signal);
          this.phases.set(action.id, action.phase); return this.receipt(action);
        }, true),
      tool('mc_result', 'Reconcile the original action ID, including uncertain dispatch and archived terminals.', parameters({ action_id: str }, ['action_id']), result),
      tool('mc_cancel', 'Cancel this controller action by its original ID and release held game inputs. A cancelled wait alone does not stop an action.', parameters({ action_id: str }, ['action_id']),
        async (args, ctx) => this.receipt(await this.rpc('cancel', { ...this.owner(), action_id: args.action_id }, ctx.signal)), true),
      tool('mc_wait', 'Wait cancellably for the original action terminal. Cancelling this wait does not cancel the body action.', parameters({ action_id: str, timeoutMs: { type: 'integer', minimum: 0, maximum: 30000 } }, ['action_id']), async (args, ctx) => {
        const until = Date.now() + Number(args.timeoutMs ?? 10000);
        for (;;) {
          ctx.signal?.throwIfAborted(); const value = await result(args, ctx);
          if (value.execution?.terminal || Date.now() >= until || value.failed) return value;
          await new Promise<void>((resolve, reject) => {
            const done = () => { clearTimeout(timer); ctx.signal?.removeEventListener('abort', abort); };
            const abort = () => { done(); reject(ctx.signal?.reason ?? new Error('Wait cancelled')); };
            const timer = setTimeout(() => { done(); resolve(); }, 100); ctx.signal?.addEventListener('abort', abort, { once: true });
            if (ctx.signal?.aborted) abort();
          });
        }
      }),
      tool('mc_bag', 'Read actual full item encoding/components, cursor, slots and menu revision.', parameters({ item: str }), async (_args, ctx) => {
        const state = await this.rpc('state', {}, ctx.signal) as JavaClientState; this.verify(state); this.state = state;
        return { text: JSON.stringify({ sampledAt: state.sampledAt, inventory: state.inventory, cursor: state.cursor, slots: state.menuSlots, revision: state.menuRevision, screenToken: state.screenToken }) };
      }),
      tool('mc_visual', 'Capture the actual rendered Java framebuffer with original textures, animation and GUI; no vision model.', parameters({ raw: { type: 'boolean' }, focus: str }), async (_args, ctx) => {
        const capture = await this.rpc('screenshot', {}, ctx.signal); this.verify(capture.state);
        return { text: JSON.stringify({ capturedAt: capture.capturedAt, state: capture.state, source: 'real-java-framebuffer' }),
          blobs: [{ bytes: Buffer.from(capture.base64, 'base64'), mime: 'image/png', fallbackText: 'Actual Java client framebuffer and GUI' }] };
      }),
      tool('mc_queue', 'Read actual client action queue and original action IDs.', parameters({}), async (_args, ctx) => ({ text: JSON.stringify((await this.rpc('state', {}, ctx.signal)).actions) })),
      tool('mc_stop', 'Explicitly cancel this controller body queue and release held game inputs.', parameters({}), async (_args, ctx) => ({ text: JSON.stringify(await this.rpc('stop', this.owner(), ctx.signal)) }), true),
      { ...PHOTO_TOOL, handler: (args, ctx) => this.photos.execute(args, ctx) },
    ];
  }
}
