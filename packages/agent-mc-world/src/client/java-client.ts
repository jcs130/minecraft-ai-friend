import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JAVA_CLIENT_PROTOCOL, type JavaClientConfiguration, type JavaClientAction, type JavaClientState } from '../contracts/java-client.ts';
import type { ToolDef, ToolOutcome, ToolCallContext, WorldHost, WorldRequestFacts, World } from './contracts.ts';
import type { MinecraftClientConfig } from './config.ts';
import { PhotographyService, PHOTO_TOOL } from '../../core/photography.ts';
import { KNOWLEDGE_TOOL, readMinecraftKnowledge } from '../../core/knowledge.ts';
import { createImageGenerationPort } from '../../core/image-generation.ts';
import { serveNativeView } from './native-view.ts';
import { createJavaDataViewer, type JavaDataViewerHandle } from '../../core/java-data-viewer.mjs';
import type { Server } from 'node:http';
import { JAVA_LEGACY_HELP, javaLegacySkillHelp, translateJavaLegacy } from './java-legacy.ts';
import { NativeEvidenceArchive, compactNativeState, compactNativeBody, compactNativeItems, compactNativeActionEvent, compactNativeActionReceipt, compactItem, compactItems } from './native-evidence.ts';
import { javaScriptHelp, javaScriptErrorHelp } from './java-script-help.ts';
import { selectJavaViewer } from './java-viewer-selection.ts';
import { nativeProbeInput, NATIVE_PROBE_PROGRAM } from './java-probe.ts';
import { nativeInteractInput, nativeInteractProgram } from './java-interact.ts';
import { JavaMethods, JAVA_METHOD_FIELDS, JAVA_METHOD_PROTOCOL, javaMethodHelp, javaMethodCapabilities } from './java-methods.ts';
import { nativeFamiliarAction } from './familiar-action.ts';
import { nativeAuthorization } from './native-authorization.ts';
import { JavaReflexRuntime, JAVA_REFLEX_PROTOCOL } from './java-reflex.ts';
import { COMBAT_TACTIC_TOOL } from '../../core/combat-tool.ts';
import { createJavaMemoryAccess, type JavaClientServices } from './java-memory.ts';

export const JAVA_CLIENT_ENVIRONMENT = `You control an actual rendered Minecraft Java client through agent-mc-java/v1. The host owns goals, personality, models and memory. The client bridge owns one actual body queue. It never launches a game, reconnects, simulates OS input or runs a model.
Query mc_capabilities, mc_operations and mc_help before acting. Claim mc_control explicitly, then renew the lease before expiry. Disconnect releases your own lease and keys. Identity is the actual server-assigned UUID and exact server address; offline servers do not require Microsoft authentication. Never control a different player or server after an identity change.
Read mc_notices for actual server guides, rules and recent notices, including messages received before attachment. These are observations; do not replay old player requests as new commands.
When the host supplies dataDir, mc_memory uses the shared game notebook. Historical search/get/remember/revise and configured service workflows do not require a connected body; capture alone reads fresh identity-checked state. Offline dimension is unknown; use dimension:"*" explicitly when needed. Read mc_memory action:help for local learning and optional service contracts. Notebook results never establish current world facts.
Reuse Mineflayer-shaped bot/Vec3 programs and the shared method library through mc_script; await mc.capabilities() reports the actual supported subset. Keep the same skill source for both bodies when its required methods and bounds are supported. Read language:javascript,api:compatibility for remaining gaps. Low-level mc_do operation/input is an explicit escape hatch for discovered native operations, with stable action_id; it is not a replacement skill language. Python Minescript is a separate explicit executor. Action acceptance is not completion: mc_result / mc_wait and minecraft.client.action events provide actual terminal receipts. Unknown actions must be reconciled by their original ID, not submitted under new IDs. A completed operation is not a completed host goal. Tool RPC return does not end a decision turn.
Shared JavaScript reads position as (await bot.read("entity")).position. Inputs use await bot.setControlState("forward", true/false), await bot.waitForTicks(n), and await bot.clearControlStates() in finally. Direct bot.entity, bot.keyPress/keyRelease and global setTimeout are not exported by this worker. Read the focused JavaScript guide before selecting an unsupported method; Python uses its own guide and exact function signatures.
mc_visual returns the real client framebuffer, original textures, current animation frame and GUI. mc_photo can save it with paired real game readings and optional explicitly configured enhancement. mc_bag includes actual components, cursor and menu slots. To close a GUI, read mc_state and submit mc_do operation:close_screen with that current screenToken. There is no generic Escape/key operation or server chat command for closing a client menu. A stale token rejection supplies a fresh GUI observation when available; never reuse historical tokens or attribute an already closed screen to a rejected action. A click/use/chat dispatch does not prove the server accepted its effect: inspect fresh inventory/menu/system notices. World facts replace older facts by key; archived evidence is historical.`;

function uuid(value: string) { return value.replaceAll('-', '').toLowerCase(); }
function address(value: string) { return value.toLowerCase().replace(/:25565$/, ''); }
export function validateJavaClientConfiguration(cfg: Partial<JavaClientConfiguration> | undefined): asserts cfg is JavaClientConfiguration {
  if (cfg?.sharedReflexes !== undefined && typeof cfg.sharedReflexes !== 'boolean') throw new Error('Java sharedReflexes must be boolean');
  if (cfg?.requireServerAuthorization !== undefined && typeof cfg.requireServerAuthorization !== 'boolean') throw new Error('Java requireServerAuthorization must be boolean');
  if (cfg?.actionWaitMs !== undefined && (!Number.isInteger(cfg.actionWaitMs) || cfg.actionWaitMs < 0 || cfg.actionWaitMs > 2000)) throw new Error('Java actionWaitMs must be 0..2000');
  if (cfg?.methodWaitMs !== undefined && (!Number.isInteger(cfg.methodWaitMs) || cfg.methodWaitMs < 0 || cfg.methodWaitMs > 30000)) throw new Error('Java methodWaitMs must be 0..30000');
  if (cfg?.stateDetail !== undefined && !['body', 'summary'].includes(cfg.stateDetail)) throw new Error('Java stateDetail must be body or summary');
  if (cfg?.viewerMode !== undefined && !['auto', 'data', 'framebuffer'].includes(cfg.viewerMode)) throw new Error('Unknown Java viewer mode');
  if (!cfg || !/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(cfg.expectedUuid ?? '')
    || !cfg.expectedServer?.trim() || !/^[A-Za-z0-9_.:-]{1,128}$/.test(cfg.controllerId ?? '')
    || !cfg.credentialsFile?.trim() || !cfg.ledgerDir?.trim()
    || !Number.isInteger(cfg.leaseMs) || cfg.leaseMs! < 1000 || cfg.leaseMs! > 30000)
    throw new Error('Configure javaClient expectedUuid, expectedServer, controllerId, credentialsFile, ledgerDir and leaseMs');
}
const parameters = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string', minLength: 1, maxLength: 256 };
/** An alternative body backend. No Mineflayer instance/second queue is created. */
export class JavaClientWorld implements World {
  readonly id = 'minecraft';
  private host: WorldHost | null = null;
  private connection: { endpoint: string; token: string; instanceId: string } | null = null;
  private lifetime = new AbortController();
  private state: JavaClientState | null = null;
  private lease: { nonce: string; expiresAt: number } | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private viewer?: Server;
  private dataViewer?: JavaDataViewerHandle;
  private viewerError: string | null = null;
  private viewerSelection: ReturnType<typeof selectJavaViewer> | null = null;
  private epoch = 0;
  private pollingEpoch: number | null = null;
  private messageSeq = 0;
  private readonly phases = new Map<string, string>();
  private readonly photos: PhotographyService;
  private readonly evidence: NativeEvidenceArchive;
  private readonly methods: JavaMethods | null;
  private readonly memoryTool: ToolDef | null;
  private readonly memoryAccess: ReturnType<typeof createJavaMemoryAccess> | null;
  private nativeMethodsAvailable = false;
  private reflex: JavaReflexRuntime | null = null;
  private knowledgeVersion: string | null = null;
  constructor(private readonly cfg: MinecraftClientConfig, private readonly http: typeof fetch = globalThis.fetch,
    private readonly services?: JavaClientServices) {
    const dir = cfg.javaClient?.ledgerDir;
    this.evidence = new NativeEvidenceArchive(join(dir || '.', 'native-evidence'));
    this.memoryAccess = this.services ? createJavaMemoryAccess(this.cfg, this.services, async signal => {
      const state = await this.rpc('state', {}, signal) as JavaClientState;
      this.verify(state);
      return state;
    }, () => this.state) : null;
    this.memoryTool = this.memoryAccess?.tool ?? null;
    this.methods = cfg.javaClient ? new JavaMethods(cfg.javaClient,{rpc:(method,args,signal)=>this.rpc(method,args,signal),
      state:async signal=>{const state=await this.rpc('state',{},signal) as JavaClientState;this.verify(state);this.state=state;return state;},owner:()=>this.owner(),host:()=>this.host}) : null;
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
    const items = compactNativeItems(state);
    const parts = [
      { key: 'sample', text: `Actual Java client readings sampled ${state.sampledAt}` },
      { key: 'bodyRestriction', text: JSON.stringify({ connection: this.connectionReadiness(), authorizationRequired: nativeAuthorization(state, this.cfg.javaClient?.requireServerAuthorization).required,
        instruction: 'Authorization is scoped to this connection; pending/required/blocked forbids body dispatch. The private login owner handles credentials. Read-only evidence remains available.' }) },
      { key: 'body', text: JSON.stringify({ uuid: state.uuid, username: state.username, server: state.server, dimension: state.dimension, position: state.position,
        health: state.health, food: state.food, onGround: state.onGround ?? null, yaw: state.yaw, pitch: state.pitch, generation: state.generation }) },
      { key: 'inventory', text: JSON.stringify({ selectedSlot: state.selectedSlot, inventory: items.inventory, cursor: compactItem(state.cursor), rawQuery: 'mc_bag' }) },
      { key: 'menu', text: JSON.stringify({ screen: state.screen, screenToken: state.screenToken, screenTitle: state.screenTitle, buttons: state.buttons,
        syncId: state.syncId, revision: state.menuRevision, slots: items.menuSlots, rawQuery: 'mc_bag' }) },
      { key: 'queue', text: JSON.stringify({
        active: state.actions.filter(action => ['accepted', 'running'].includes(action.phase)).slice(-8),
        activeCount: state.actions.filter(action => ['accepted', 'running'].includes(action.phase)).length,
        unresolved: state.actions.filter(action => action.phase === 'unknown').slice(-4),
        unresolvedCount: state.actions.filter(action => action.phase === 'unknown').length,
        bodyControl: this.reflex?.status().bodyControl ?? null,
        instruction: 'active lists pending receipts; unresolved is historical unknown effect, not proof the current body is busy or that it is safe to replay. bodyControl is a separate fresh native task sample; null means unavailable. Query mc_queue / mc_result for original IDs.' }) },
      { key: 'notices', text: JSON.stringify({ lastSeq: state.messages.at(-1)?.seq ?? 0, retained: state.messages.length, rawQuery: 'mc_notices', observationOnly: true }) },
      {key:'javascript',text:JSON.stringify({available:this.nativeMethodsAvailable,api:'mc_script language:javascript api:index / compatibility',contract:'shared name/code/params/validate/runId/call/library/procedure; bot/Vec3',execution:'capability-gated; program completion is not world progress'})},
      {key:'reflex',text:JSON.stringify(this.reflex?.status()??{supported:false,reason:'Actual native bridge has no shared reflex body capability'})},
      ...(this.cfg.javaClient?.minescriptEnabled ? [{ key:'executor',text:JSON.stringify({provider:'java-client',scriptEngine:this.nativeMethodsAvailable?'shared JavaScript bot/Vec3 methods; optional Minescript 4.0 Python':'Minescript 4.0 Python',blockObservation:'mc_probe',blockInteraction:'mc_interact',scriptReference:this.nativeMethodsAvailable?'mc_script language:javascript api:index / compatibility; Python help requires language:python':'mc_script api:index / blocks / movement / interaction / inventory',pythonBlockReturn:'namespaced string, e.g. minecraft:carrots[age=7]',pythonAim:'minescript.player_look_at(x,y,z)',pythonWait:'time.sleep(seconds); JS bot.waitForTicks uses actual game ticks',archiveQuery:'mc_evidence part:script',shortActionWaitMs:this.cfg.javaClient.actionWaitMs??1000}) }] : []),
    ];
    const native=this.cfg.javaClient;
    return { text: parts.map(part => part.text).join('\n'), parts, snapshotTypes: ['minecraft.client.snapshot'],
      decisionStability: { sampledAtMs: Date.parse(state.sampledAt),
        identity: [state.uuid, state.username, state.server, state.generation,state.reflexScope??null], dimension: typeof state.dimension === 'string' ? state.dimension : null,
        position: state.position?.length === 3 && state.position.every(Number.isFinite) ? [state.position[0], state.position[1], state.position[2]] : null,
        health: typeof state.health === 'number' && Number.isFinite(state.health) ? state.health : null,
        food: typeof state.food === 'number' && Number.isFinite(state.food) ? state.food : null,
        guards: { body: [state.uuid, state.username, state.server, state.generation, state.dimension,state.reflexScope??null], authorization: this.connectionReadiness() } },
      ...(native ? {experience:{scope:{realm:`java:${native.expectedServer.toLowerCase().replace(/:25565$/, '')}`,
        account:`uuid:${native.expectedUuid.replaceAll('-', '').toLowerCase()}`,agent:this.services?.agentName??native.controllerId},
        observation:state.connected?{at:state.sampledAt,dimension:typeof state.dimension==='string'?state.dimension:null,
          position:state.position?.length===3?{x:state.position[0],y:state.position[1],z:state.position[2]}:null,
          health:typeof state.health==='number'?state.health:null,food:typeof state.food==='number'?state.food:null,inventory:null}:null}}:{}) };
  }
  connectionReadiness() {
    if (!this.state?.connected) return { ready: false, phase: this.host ? 'offline' : 'detached' };
    const auth = nativeAuthorization(this.state, this.cfg.javaClient?.requireServerAuthorization);
    return { ready: auth.ready, phase: auth.ready ? 'online' : auth.phase === 'blocked' ? 'auth-blocked'
      : auth.phase === 'required' ? 'login-required' : 'authenticating' };
  }
  console() { return { label: 'Real Java client', connection: this.connectionReadiness(), lamps: [{ label: '服务器', state: this.state?.connected ? 'online' as const : 'offline' as const },
    ...(this.cfg.viewerPort > 0 ? [{label:'画面',state:this.viewerError || (this.dataViewer && !this.dataViewer.status().ok) ? 'error' as const : this.dataViewer || this.viewer ? 'online' as const : 'offline' as const,
      hint:this.viewerError ?? (this.dataViewer?.status().error as string | undefined) ?? this.viewerSelection?.reason}] : [])],
    links: this.dataViewer ? [{label: '游戏三维画面',href:this.dataViewer.url}] : this.viewer ? [{ label: '原生截图预览', href: `http://127.0.0.1:${this.cfg.viewerPort}` }] : [] }; }
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
    this.host = host; this.lifetime = new AbortController(); this.lease = null; this.nativeMethodsAvailable=false; this.knowledgeVersion=null; this.epoch++;
    try {
      this.state = await this.rpc('state', {}) as JavaClientState; this.verify(this.state);
      if (!this.state.connected) throw new Error('Java client is not in a world; join explicitly before attaching');
      if (this.cfg.javaClient.minescriptEnabled && !(await this.rpc('capabilities', {})).minescript) throw new Error('Configured Minescript executor is unavailable in the actual native client');
      this.messageSeq = Math.max(0, ...this.state.messages.map(message => message.seq));
      this.phases.clear(); for (const action of this.state.actions) this.phases.set(action.id, action.phase);
      this.photos.start(host);
      this.viewerError = null;
      this.viewerSelection = null;
      try {
      const capabilities = await this.rpc('capabilities', {});
      this.knowledgeVersion = typeof capabilities.minecraftVersion === 'string' ? capabilities.minecraftVersion : null;
      this.nativeMethodsAvailable = capabilities.methodAdapter === JAVA_METHOD_PROTOCOL;
      if(capabilities.reflexAdapter===JAVA_REFLEX_PROTOCOL&&this.cfg.javaClient.sharedReflexes!==false){
        this.reflex=new JavaReflexRuntime(this.cfg,{rpc:(method,args,signal)=>this.rpc(method,args,signal),owner:()=>this.owner(),canControl:()=>!!this.lease,
          verify:state=>this.verify(state),host:()=>this.host});this.reflex.start();
      }
      if (this.cfg.viewerPort > 0) this.viewerSelection = selectJavaViewer(this.cfg.javaClient, capabilities);
      if (this.viewerSelection?.mode === 'data') {
        this.dataViewer = await createJavaDataViewer({port:this.cfg.viewerPort,assetsDir:this.cfg.viewerAssetsDir,minecraftVersion:String(capabilities.minecraftVersion),
          uuid:this.cfg.javaClient.expectedUuid,server:this.cfg.javaClient.expectedServer,rpc:(method,params)=>this.rpc(method,params)});
      } else if (this.viewerSelection?.mode === 'framebuffer') {
        if (!this.cfg.javaClient.viewerPageFile) throw new Error('Framebuffer mode requires viewerPageFile');
        this.viewer = await serveNativeView(this.cfg.viewerPort, this.cfg.javaClient.viewerPageFile, async () => {
          const capture = await this.rpc('screenshot', {}); this.verify(capture.state);
          return Buffer.from(capture.base64, 'base64');
        }, () => ({ connected: this.state?.connected ?? false, username: this.state?.username, health: this.state?.health, food: this.state?.food, viewer: this.viewerSelection }), this.viewerSelection.reason);
      }
      } catch (error) {
        // Rendering availability is separate from the action body's lifecycle.
        // Report it without detaching an otherwise valid running player or
        // switching silently to screenshots.
        this.viewerError = error instanceof Error ? error.message.slice(0,300) : 'Native viewer unavailable';
      }
      this.timer = setInterval(() => { void this.poll(); }, 500);
      this.timer.unref();
    } catch (error) { await this.dataViewer?.close(); this.dataViewer=undefined; this.photos.stop(); this.viewer?.closeAllConnections(); this.viewer?.close(); this.viewer = undefined; this.host = null; this.connection = null; this.state = null; this.lifetime.abort(); throw error; }
  }
  async stop(): Promise<void> {
    this.epoch++;
    await this.reflex?.close();this.reflex=null;
    clearInterval(this.timer); this.timer = undefined; this.photos.stop();
    await this.methods?.stop('Java client adapter stopped');
    await this.dataViewer?.close(); this.dataViewer=undefined;
    this.viewerError = null;
    const viewer = this.viewer; this.viewer = undefined;
    if (viewer) { viewer.closeAllConnections(); await new Promise<void>(resolve => viewer.close(() => resolve())); }
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
    if (['do','method_claim','method_call','reflex_control','reflex_item'].includes(method) && !nativeAuthorization(this.state, this.cfg.javaClient?.requireServerAuthorization).ready)
      throw new Error('Server authorization is not confirmed for this connection; no body request dispatched. Wait for the private login owner; read-only state/results remain available.');
    const combined = AbortSignal.any([...(stopping ? [] : [this.lifetime.signal]), AbortSignal.timeout(8000), ...(signal ? [signal] : [])]);
    combined.throwIfAborted();
    let response: Response;
    try { response = await this.http(this.connection.endpoint + '/v1/rpc', { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.connection.token },
      body: JSON.stringify({ protocol: JAVA_CLIENT_PROTOCOL, method, params: { ...params,...(['do','method_call'].includes(method)&&Number.isSafeInteger(this.state?.reflexScope)?{expectedBodyScope:this.state!.reflexScope}:{}), expectedUuid: this.cfg.javaClient!.expectedUuid, expectedServer: this.cfg.javaClient!.expectedServer } }), signal: combined }); }
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
    if(method==='do'&&params.operation==='method.run'&&['accepted','running'].includes(result.phase))await this.reflex?.beforeBody();
    return result;
  }
  private receipt(action: JavaClientAction, notification = false): ToolOutcome {
    const raw = this.evidence.save(action.id, action), state = action.evidence ?? {};
    const script = state.script as any;
    const apiCorrection = javaScriptErrorHelp(script?.error);
    const result = script ? JSON.stringify(script.result ?? null) : '';
    const compact = { ...action, evidence: { ...(notification ? compactNativeActionEvent(state) : compactNativeActionReceipt(state)), ...(script ? { script: { ok: script.ok, jobId: script.jobId, programReport: true, error: script.error, ...(apiCorrection ? {apiCorrection} : {}),
      ...(result.length <= 4000 ? { result: script.result } : { preview: result.slice(0, 4000), truncated: true }) } } : {}), raw } };
    return { text: JSON.stringify(compact), meta: { javaClient: compact },
      ...(action.phase === 'blocked' || action.phase === 'unknown' ? { failed: true as const } : {}),
      execution: { kind: 'task', id: action.id, phase: action.phase === 'unknown' ? 'blocked' : action.phase,
        terminal: !['accepted', 'running', 'unknown'].includes(action.phase), goalCompleted: false,
        evidence: { protocol: JAVA_CLIENT_PROTOCOL, operation: action.operation, ...compact.evidence } } };
  }
  /** Recovery is observation only: a changed GUI must never be clicked or closed by replay. */
  private async staleGuiOutcome(actionId: string, operation: string, signal?: AbortSignal): Promise<ToolOutcome> {
    let currentGui: Record<string, unknown> | null = null;
    let observationError: string | undefined;
    try {
      const state = await this.rpc('state', {}, signal) as JavaClientState;
      this.verify(state);
      if (!state.connected) throw new Error('Client is disconnected; current in-game GUI is unverified');
      this.state = state;
      const fields = ['sampledAt','generation','screen','screenTitle','screenToken','syncId','menuRevision'] as const;
      currentGui = { ...Object.fromEntries(fields.map(key => [key, state[key]])), cursor: compactItem(state.cursor),
        alreadyClosed: state.screen === '', closureAttributedToAction: false };
    } catch (error) {
      signal?.throwIfAborted(); this.lifetime.signal.throwIfAborted();
      observationError = error instanceof Error ? error.message : 'Current GUI observation failed';
    }
    return { failed: true, text: JSON.stringify({ action_id: actionId, operation, error: 'Stale screenToken',
      rejectedThisAttempt: true, retried: false, currentGui, observationError,
      recovery: 'The supplied token belongs to an older GUI. This attempt did not close or click a screen. If currentGui is unavailable, read mc_state. If alreadyClosed is true, no close is needed; the cause is unknown and is not this rejected action. Otherwise inspect the fresh screen and use its token only if the intended GUI is still appropriate. For menu_click/gui_click read current slots/buttons first. An earlier attempt under this action_id must still be reconciled with mc_result; never infer its outcome or replay it from this rejection.' }) };
  }
  private async settle(action: JavaClientAction, waitMs: number, signal?: AbortSignal): Promise<JavaClientAction> {
    const until = Date.now() + waitMs;
    const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    while (['accepted','running'].includes(action.phase) && Date.now() < until) {
      await new Promise<void>((resolve,reject) => {
        const done = () => { clearTimeout(timer); combined.removeEventListener('abort', abort); };
        const abort = () => { done(); reject(combined.reason); };
        const timer = setTimeout(() => { done(); resolve(); }, Math.min(100, Math.max(0,until-Date.now())));
        combined.addEventListener('abort',abort,{once:true}); if(combined.aborted)abort();
      });
      action = await this.rpc('result', { action_id: action.id }, combined) as JavaClientAction;
    }
    return action;
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
        // Identity comes only from the bridge's player channel metadata, never message text.
        const player = !message.overlay && message.kind === 'player' && /^[A-Za-z0-9_]{1,16}$/.test(message.sender ?? '')
          ? message.sender! : null;
        const own = player !== null && player.toLowerCase() === state.username?.toLowerCase();
        const recall = player && !own ? this.memoryAccess?.recallPlayer(player) : null;
        if (recall) {
          await host.pushEvent({ type: 'minecraft.memory', source: 'minecraft', ts: message.at, text: recall.text,
            meta: { gamePlayerMemory: recall.meta } }, { trigger: 'piggyback' });
          if (this.host !== host || this.epoch !== epoch) return;
        }
        await host.pushEvent({ type: player ? 'minecraft.chat' : 'minecraft.client.message', source: 'minecraft', ts: message.at, text: message.text,
          ...(player && !own ? { senderKey: player } : {}),
          meta: { overlay: message.overlay, raw: true, nativeType: 'minecraft.client.message', sequence: message.seq,
            generation: state.generation, kind: message.kind, sender: message.sender,
            ...(player ? { uname: player, socialScope: 'minecraft-server', outgoing: own } : {}),
            ...(recall ? { gamePlayerMemory: recall.meta } : {}) } },
          { trigger: message.overlay || own ? 'piggyback' : player ? 'preempt' : 'debounce' });
      }
      for (const action of state.actions) if (this.phases.get(action.id) !== action.phase) {
        this.phases.set(action.id, action.phase);
        if (action.phase === 'accepted' || action.phase === 'running') continue;
        const full = await this.rpc('result', { action_id: action.id }) as JavaClientAction;
        if (this.host !== host || this.epoch !== epoch) return;
        const receipt = this.receipt(full, true);
        await host.pushEvent({ type: 'minecraft.client.action', source: 'minecraft', ts: new Date(full.updatedAt).toISOString(),
          text: receipt.text, execution: receipt.execution, meta: receipt.meta }, { trigger: 'flush' });
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
        try { if(act&&!['mc_script','mc_stop','mc_cancel'].includes(name))this.methods?.guard();return await handler(args, ctx); } catch (error) { return { text: error instanceof Error ? error.message : 'Java client operation failed', failed: true }; }
      } });
    const result = async (args: Record<string, unknown>, ctx: ToolCallContext) => this.receipt(await this.rpc('result', { action_id: args.action_id }, ctx.signal));
    const tools: ToolDef[] = [
      {...COMBAT_TACTIC_TOOL,runtimeAvailable:()=>this.reflex!==null,readOnlyCall:args=>args.battlefield===true||args.decisions===true||args.decision!==undefined||args.report!==undefined||!Object.keys(args).length,
        handler:async(args,ctx)=>{try{if(!this.reflex)throw new Error('Shared native reflex body capability unavailable; no combat action dispatched');return await this.reflex.tool(args,ctx);}catch(error){return{text:String(error),failed:true};}}},
      { ...KNOWLEDGE_TOOL, handler: async (args, ctx) => {
        ctx.signal?.throwIfAborted();
        try {
          return { text: JSON.stringify(readMinecraftKnowledge(args,
            typeof this.state?.minecraftVersion === 'string' ? this.state.minecraftVersion : this.knowledgeVersion ?? this.cfg.version)) };
        } catch (error) { return { text: String(error), failed: true }; }
      } },
      tool('mc_capabilities', 'Read actual client/backend capabilities, including the common Mineflayer-shaped JavaScript subset; no control claim or launcher.', parameters({}), async (_args, ctx) => {
        const caps = await this.rpc('capabilities', {}, ctx.signal);
        return { text: JSON.stringify({ ...caps, javascript: javaMethodCapabilities(caps) }) };
      }),
      tool('mc_state', 'Read fresh actual client state, position, health, food, GUI identity and action queue. detail:body omits inventory/menu stack lists; use mc_bag when those change. detail:summary returns the original full summary. No action or cached disconnected observation.', parameters({ detail: { enum: ['body', 'summary'] } }), async (args, ctx) => {
        const detail = args.detail ?? this.cfg.javaClient?.stateDetail ?? 'summary';
        if (!['body', 'summary'].includes(String(detail))) throw new Error('detail must be body or summary');
        const state = await this.rpc('state', {}, ctx.signal) as JavaClientState; this.verify(state); this.state = state;
        return { text: JSON.stringify({ ...(detail === 'body' ? compactNativeBody(state) : compactNativeState(state)), raw: this.evidence.save('state:' + state.sampledAt, state) }) };
      }),
      tool('mc_evidence', 'Read original native evidence by raw.key and optional raw.sha256. part:script pages the program report directly without repeated inventory/books; default full preserves the entire original.', parameters({ key: str, sha256: str, part: {enum:['full','script']}, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 16000 } }, ['key']), async args => ({ text: JSON.stringify(this.evidence.read(String(args.key), args.sha256 as string | undefined, Number(args.offset ?? 0), Number(args.limit ?? 8000), args.part as 'full'|'script'|undefined)) })),
      tool('mc_operations', 'Discover exact real-client operations. Uninstalled Minescript/Baritone are unavailable.', parameters({}), async (_args, ctx) => ({ text: JSON.stringify(await this.rpc('operations', {}, ctx.signal)) })),
      tool('mc_help', 'Read real-client operations, legacy compatibility and identity/control rules. Supply skill for one compatible legacy step or discovered native operation and exact input fields.', parameters({ skill: str }), async (args, ctx) => {
        const operations = await this.rpc('operations', {}, ctx.signal);
        if (args.skill) {
          const key = String(args.skill);
          const legacy = javaLegacySkillHelp(key);
          if (legacy) return { text: legacy };
          if (key === 'script') return { text: javaMethodHelp()+(this.cfg.javaClient?.minescriptEnabled?'\n'+javaScriptHelp():'') };
          if (!Object.hasOwn(operations.operations ?? {}, key)) return { text: `Unknown native operation ${key}. Available: ${Object.keys(operations.operations ?? {}).join(', ')}. Query mc_operations or omit skill for legacy compatibility.`, failed: true };
          return { text: JSON.stringify({ operation: key, input: operations.operations[key] })
            + '\nSubmit mc_do with operation/input and a stable action_id. Use mc_result/mc_wait for the actual terminal; acceptance/input dispatch is not goal completion. Inspect fresh state/GUI/inventory/server notices; do not replay unknown actions. Close an unintended GUI using its current screenToken before movement.' };
        }
        return { text: JAVA_CLIENT_ENVIRONMENT + '\n' + JAVA_LEGACY_HELP + '\n' + javaMethodHelp() + (this.cfg.javaClient?.minescriptEnabled ? '\n' + javaScriptHelp() : '') + '\n' + JSON.stringify(operations) };
      }),
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
        if(method==='release')await this.methods?.stop('Controller released');
        const lease = await this.rpc(method, method === 'claim' ? { controllerId: this.cfg.javaClient!.controllerId, ttlMs: args.ttlMs ?? this.cfg.javaClient!.leaseMs }
          : { ...this.owner(), ...(method === 'renew' ? { ttlMs: args.ttlMs ?? this.cfg.javaClient!.leaseMs } : {}) }, ctx.signal);
        if (method === 'release') this.lease = null; else this.lease = { nonce: lease.nonce, expiresAt: lease.expiresAt };
        const { nonce, ...publicLease } = lease; return { text: JSON.stringify(publicLease) };
      }, false, true),
      tool('mc_do', 'Submit ONE discovered operation/input or ONE supported legacy steps command, using stable action_id. Accepted is not completed. Read mc_help for compatibility; no navigation/script emulation.',
        parameters({ action_id: str, operation: str, input: { type: 'object' }, waitMs: {type:'integer',minimum:0,maximum:2000}, steps: { type: 'array', minItems: 1, maxItems: 1, items: { type: 'object', properties: { skill: str }, required: ['skill'] } }, queue: { enum: ['append', 'now'] } }), async (args, ctx) => {
          const firstStep=Array.isArray(args.steps)?args.steps[0]:undefined;
          if (args.steps !== undefined) {
            const state = await this.rpc('state', {}, ctx.signal) as JavaClientState; this.verify(state); this.state = state;
            args = translateJavaLegacy(args, state);
          }
          if (typeof args.operation !== 'string' || !args.input || typeof args.input !== 'object' || Array.isArray(args.input)) throw new Error('Supply operation/input OR one compatible legacy step');
          if (args.queue !== undefined && !['append', 'now'].includes(String(args.queue))) throw new Error('Native queue supports append/now only');
          const waitMs = args.waitMs ?? this.cfg.javaClient?.actionWaitMs ?? 1000;
          if (!Number.isInteger(waitMs) || Number(waitMs) < 0 || Number(waitMs) > 2000) throw new Error('waitMs must be 0..2000');
          const actionId = String(args.action_id ?? ctx.callId);
          let action: JavaClientAction;
          try {
            action = await this.rpc('do', { ...this.owner(), action_id: actionId, operation: args.operation, input: args.input, queue: args.queue ?? 'append' }, ctx.signal);
          } catch (error) {
            if (['close_screen','menu_click','gui_click'].includes(args.operation) && error instanceof Error && error.message === 'Stale screenToken')
              return this.staleGuiOutcome(actionId, args.operation, ctx.signal);
            throw error;
          }
          await this.reflex?.beforeBody(firstStep);
          this.phases.set(action.id, action.phase); return this.receipt(await this.settle(action,Number(waitMs),ctx.signal));
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
      tool('mc_bag', 'Read actual inventory/menu summaries and raw evidence reference. For full components select item and detail:components; offset/limit page through the original. No huge books are repeated by default.', parameters({ item: str, detail: { enum: ['summary', 'components'] }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 16000 } }), async (args, ctx) => {
        const state = await this.rpc('state', {}, ctx.signal) as JavaClientState; this.verify(state); this.state = state;
        const raw = this.evidence.save('bag:' + state.sampledAt, state);
        if (args.detail === 'components') {
          if (!args.item) return { text: 'Select item by native id/display name before querying component pages.', failed: true };
          const matches = [...state.inventory as any[], ...state.menuSlots as any[]].filter(item => item.name === args.item || item.name === 'minecraft:' + args.item || String(item.displayName ?? '').replace(/§./g, '') === args.item);
          const original = JSON.stringify(matches), offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 8000);
          if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 16000) return { text: 'Invalid component page offset/limit', failed: true };
          return { text: JSON.stringify({ sampledAt: state.sampledAt, raw, totalChars: original.length, offset, text: original.slice(offset, offset + limit), hasMore: offset + limit < original.length }) };
        }
        return { text: JSON.stringify({ sampledAt: state.sampledAt, inventory: compactItems(state.inventory), cursor: compactItem(state.cursor), slots: compactItems(state.menuSlots), revision: state.menuRevision, screenToken: state.screenToken, raw }) };
      }),
      tool('mc_visual', 'Capture the actual rendered Java framebuffer with original textures, animation and GUI; no vision model.', parameters({ raw: { type: 'boolean' }, focus: str }), async (_args, ctx) => {
        const capture = await this.rpc('screenshot', {}, ctx.signal); this.verify(capture.state);
        return { text: JSON.stringify({ capturedAt: capture.capturedAt, state: compactNativeState(capture.state), raw: this.evidence.save('visual:' + capture.capturedAt, capture.state), source: 'real-java-framebuffer' }),
          blobs: [{ bytes: Buffer.from(capture.base64, 'base64'), mime: 'image/png', fallbackText: 'Actual Java client framebuffer and GUI' }] };
      }),
      tool('mc_queue', 'Read actual client action queue and original action IDs.', parameters({}), async (_args, ctx) => ({ text: JSON.stringify((await this.rpc('state', {}, ctx.signal)).actions) })),
      tool('mc_stop', 'Cancel the native task queue. Shared combat stops attacking and withdraws from active danger; configured environmental survival remains active.', parameters({}), async (_args, ctx) => {await this.methods?.stop('mc_stop explicit cancellation');const result=await this.rpc('stop',this.owner(),ctx.signal);const combat=await this.reflex?.requestStop();return{text:JSON.stringify({...result,combat:combat??null})};}, true),
      { ...PHOTO_TOOL, handler: (args, ctx) => this.photos.execute(args, ctx) },
    ];
    tools.push(tool('mc_script', 'Shared JavaScript mc/bot/Vec3 methods with validate/runId/call/library/procedure; read language:javascript,api:index and compatibility. Requires matching native bridge for execution. Inline code defaults to JavaScript when Python is disabled; name is optional with a stable source-hash default. find:{names,maxDistance,count} is a bounded read-only block search. Legacy unnamed code remains Python only when that executor is enabled. Explicit Python Minescript has its own language:python guide. A program ending never proves the goal.', parameters({ ...JAVA_METHOD_FIELDS, api: str, language: { enum: ['python','javascript'] }, code: { type: 'string', minLength: 1, maxLength: 32768 }, input: {}, timeoutMs: { type: 'integer', minimum: 100, maximum: 30000 }, action_id: str }), async (args, ctx) => {
      const js=args.language==='javascript'||args.language===undefined&&(!this.cfg.javaClient?.minescriptEnabled||args.name!==undefined||args.procedure!==undefined||args.library!==undefined||args.runId!==undefined||args.stop!==undefined||args.validate!==undefined||(!args.code&&!args.api));
      if(js){if(['input','timeoutMs','action_id'].some(k=>args[k]!==undefined))throw new Error('JS uses params/durationMs/runId; Python input/timeoutMs/action_id cannot be mixed');if(!this.methods)throw new Error('Configure javaClient first');return this.methods.execute(args,ctx);}
      if(!this.cfg.javaClient?.minescriptEnabled)throw new Error('Python Minescript is not enabled; select language:javascript for shared methods');
      if (args.api) return { text: javaScriptHelp(String(args.api)) + (args.api==='index'?'\n'+javaMethodHelp():'') + (args.code ? '\nAPI query only: supplied code was not executed. Omit api to run a program.' : '') };
      if ((args.language ?? 'python') !== 'python' || typeof args.code !== 'string') return { text: 'Select javascript with name/code or explicit python code; no automatic source translation.', failed: true };
      const body = tools.find(tool => tool.name === 'mc_do')!;
      return body.handler({ action_id: args.action_id, operation: 'minescript.run', input: { code: args.code, input: args.input, timeoutMs: args.timeoutMs ?? 10000 } }, ctx);
    }, true));
    if (this.cfg.javaClient?.minescriptEnabled) tools.push(tool('mc_probe', 'Observe nearby cached blocks through one bounded Minescript batch, without writing Python. Default radius 3, below 1, above 2; names optionally filters namespaced IDs. Or supply absolute integer positions. Queued read uses the same body lease and stable action_id, waits briefly for the real terminal, never moves or loads chunks. Read script.result; partial is a program report, not goal completion.', parameters({action_id:str,
      positions:{type:'array',minItems:1,maxItems:512,items:{type:'array',minItems:3,maxItems:3,items:{type:'integer'}}},
      radius:{type:'integer',minimum:0,maximum:6},below:{type:'integer',minimum:0,maximum:3},above:{type:'integer',minimum:0,maximum:3},
      names:{type:'array',maxItems:16,items:{type:'string'}},limit:{type:'integer',minimum:1,maximum:32}}), async(args,ctx)=>{
        const input=nativeProbeInput(args);
        return tools.find(t=>t.name==='mc_do')!.handler({action_id:args.action_id,operation:'minescript.run',input:{code:NATIVE_PROBE_PROGRAM,input,timeoutMs:5000}},ctx);
      },true));
    if (this.cfg.javaClient?.minescriptEnabled) tools.push(tool('mc_interact', 'Interact with one absolute target block without writing Python. Checks GUI, actual crosshair hit/distance before bounded attack/use, always releases the key, returns observed before/after in script.result. For planting target actual support farmland, aimOffset [.5,.9,.5], observePositions including the space above; select the held item separately. blocked/no_observed_change requires new evidence or position. Raycast bound does not grant reach/permission. Same native lease, queue, stable action_id and cancellation; partial is not goal completion.', parameters({action_id:str,
      target:{type:'array',minItems:3,maxItems:3,items:{type:'integer'}},action:{enum:['attack','use']},holdMs:{type:'integer',minimum:50,maximum:2000},
      maxDistance:{type:'number',minimum:.5,maximum:8},aimOffset:{type:'array',minItems:3,maxItems:3,items:{type:'number',minimum:0,maximum:1}},
      observePositions:{type:'array',maxItems:4,items:{type:'array',minItems:3,maxItems:3,items:{type:'integer'}}},waitMs:{type:'integer',minimum:0,maximum:2000}},['target']), async(args,ctx)=>{
        const input=nativeInteractInput(args),code=nativeInteractProgram();
        return tools.find(t=>t.name==='mc_do')!.handler({action_id:args.action_id,operation:'minescript.run',waitMs:args.waitMs??this.cfg.javaClient?.actionWaitMs??2000,input:{code,input,timeoutMs:10000}},ctx);
      },true));
    const action = tools.find(t => t.name === 'mc_do');
    if (action) action.familiarAction = args => nativeFamiliarAction(args, this.state);
    const script = tools.find(t => t.name === 'mc_script');
    if (script) script.readOnlyCall = args => args.find !== undefined || !!args.api;
    if (this.memoryTool) tools.push(this.memoryTool);
    return tools;
  }
}
