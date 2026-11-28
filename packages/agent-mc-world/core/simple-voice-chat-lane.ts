import { SvcHearing, transcribeSvcWav, type VoiceSpeaker, type VoiceTranscript } from './svc-hearing.ts';
import { SvcPerformance, songEndpoint } from './svc-performance.ts';
import { SvcPublicSpeech } from './svc-public-speech.ts';
import type { ChatDeliveryReceipt } from '../src/contracts/chat-delivery.ts';
import { randomUUID } from 'node:crypto';
import type { ToolDef } from './support/host-contract.ts';
import { attachSimpleVoiceChat, createOfficialOpusCodec, type SimpleVoiceChatClient, type SimpleVoiceChatOpus } from '../src/simple-voice-chat.ts';
import { inspectVoiceWav } from './proximity-voice.mjs';
import { resolveMinecraftConnectEndpoint } from './connect-endpoint.ts';

/** Resolve an SVC voice host with the same public-DNS fallback as the game connection (box/fake-IP resolvers). */
export async function resolveSvcUdpHost(host: string): Promise<string> {
  const endpoint = await resolveMinecraftConnectEndpoint({ host, port: 24454, publicDnsFallback: true });
  return endpoint.host;
}

export interface SimpleVoiceChatConfig {
  enabled: boolean;
  /** Optional official Simple Voice Chat jar for the Concentus codec. Not a TTS credential. */
  officialJar: string;
  javaPath: string;
  compatibilityVersion: number;
  bindHost?: string;
  /** Override the remote UDP port for a server behind an operator-provided port mapping. */
  udpPort?: number;
  transcriptionEndpoint?: string;
  publicChatArtifactUrl?: string;
}
export interface SimpleVoiceChatContext {
  bot: Parameters<typeof attachSimpleVoiceChat>[0];
  stillCurrent(): boolean;
  speaker?(uuid:string):VoiceSpeaker | undefined;
  deliver?(row:VoiceTranscript):void;
}

export const SIMPLE_VOICE_CHAT_TOOL: Omit<ToolDef, 'handler'> = {
  name: 'mc_svc', tags: ['speak'], bodyControl: 'independent',
  description: 'Native Simple Voice Chat client on the current authenticated connection. '
    + 'This is not mc_voice / mcagent:voice. {} reports handshake state. '
    + '{action:"upload",audio_handle,requestId?} sends a PCM16 WAV (0.1–30s) as official 48 kHz 20 ms Opus frames after request_secret and UDP auth. '
    + 'For nearby singing, songs lists available vocal track IDs; perform(trackId,requestId) returns immediately; status/cancel use that same requestId. Speech takes microphone priority and the song resumes. No body lease. '
    + 'sent means frames were written to UDP, not that anyone heard them. Cancel with AbortSignal via the host; close() leaves no UDP socket. '
    + 'Disabled by default. Requires an Opus codec (official SVC jar Concentus, or a provided codec).',
  parameters: { type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', enum: ['status', 'upload', 'songs', 'perform', 'cancel'] },
    trackId:{type:'string',pattern:'^[A-Za-z0-9_-]{1,128}$'},
    audio_handle: { type: 'string', minLength: 1, maxLength: 300 },
    requestId: { type: 'string', format: 'uuid' },
    whisper: { type: 'boolean' },
  } },
};

export class SimpleVoiceChatLane {
  private readonly publicSpeech = new SvcPublicSpeech(row=>this.options.publicSpeechReceipt?.({...row}));
  private uploadTail:Promise<void>=Promise.resolve();
  private readonly performance=new SvcPerformance(row=>this.options.performanceReceipt?.({...row}));
  private microphone<T>(run:()=>Promise<T>):Promise<T>{
    const result=this.uploadTail.then(run);
    this.uploadTail=result.then(()=>{},()=>{});
    return result;
  }
  /** A single microphone stream serves captions, authored speech and file uploads. */
  private upload(client:SimpleVoiceChatClient, wav:Buffer, options:Parameters<SimpleVoiceChatClient['upload']>[1]) {
    const scope=this.context;
    this.performance.yieldToSpeech();
    return this.microphone(()=>{
      options?.signal?.throwIfAborted();
      if(this.client!==client || !scope?.stillCurrent()) throw Error('SVC_CONNECTION_CHANGED');
      return client.upload(wav,options);
    });
  }
  speechUpload() {
    const client=this.client;
    if(!client || !this.context?.stillCurrent() || !client.state().udpValidated) return undefined;
    return (wav:Buffer,options?:Parameters<SimpleVoiceChatClient['upload']>[1])=>this.upload(client,wav,options);
  }
  publicChat(chat:ChatDeliveryReceipt) {
    const cfg=this.options.config();
    if (!cfg.enabled || !cfg.publicChatArtifactUrl) return;
    const client=this.client, context=this.context;
    return this.publicSpeech.enqueue(chat,cfg.publicChatArtifactUrl,client && context ? {
      current:()=>this.client===client && context.stillCurrent() && client.state().udpAuthenticated && client.state().udpValidated,
      send:(bytes,requestId,signal)=>this.upload(client,bytes,{requestId,signal}),
    } : null);
  }
  private hearing:SvcHearing | null=null;
  private client: SimpleVoiceChatClient | null = null;
  private context: SimpleVoiceChatContext | null = null;
  private codec: (SimpleVoiceChatOpus & { close?(): void }) | null = null;
  constructor(private readonly options: {
    config: () => SimpleVoiceChatConfig;
    serverHost?: () => string;
    performanceReceipt?:(receipt:Readonly<Record<string,unknown>>)=>void;
    publicSpeechReceipt?:(receipt:Readonly<Record<string,unknown>>)=>void;
    blob: (handle: string) => { bytes: Uint8Array; mime?: string } | null;
    /** Optional host-provided Opus codec; otherwise the official SVC jar's Concentus is used. */
    opus?: () => SimpleVoiceChatOpus & { close?(): void };
    /** Optional resolver override (tests / hosts); defaults to public-DNS fallback. */
    resolveUdpHost?: (host: string) => Promise<string>;
  }) {}
  sync(context?: SimpleVoiceChatContext) {
    if (this.client && this.context && !this.context.stillCurrent()) this.disconnect('connection-or-world-changed');
    if (context) this.context = context;
    const cfg = this.options.config();
    if (!cfg.enabled || !this.context?.stillCurrent()) { this.disconnect('disabled-or-stale'); return; }
    if (this.client) return;
    this.lastError = null;
    try {
      const decoder=()=>this.options.opus ? this.options.opus() : createOfficialOpusCodec({jar:cfg.officialJar,javaPath:cfg.javaPath||undefined});
      this.codec ??= decoder();
      const live=this.context;
      const endpoint=cfg.transcriptionEndpoint;
      if(endpoint && live.speaker && live.deliver){
        this.hearing=new SvcHearing({decoder,transcribe:(wav,signal)=>transcribeSvcWav(endpoint,wav,signal),
          speaker:live.speaker,deliver:live.deliver,current:live.stillCurrent});
      }
      this.client = attachSimpleVoiceChat(this.context.bot, {
        opus: this.codec, isAuthenticated: () => this.context!.stillCurrent(),
        compatibilityVersion: cfg.compatibilityVersion || 20, bindHost: cfg.bindHost || '0.0.0.0',
        serverHost:this.options.serverHost?.(), udpPort:cfg.udpPort === 0 ? undefined : cfg.udpPort,
        onAudio: this.hearing ? row=>this.hearing?.receive(row) : undefined,
        resolveUdpHost: this.options.resolveUdpHost ?? resolveSvcUdpHost,
      });
    } catch (error) {
      this.client = null;
      this.hearing?.close();this.hearing=null;
      this.lastError = error instanceof Error ? error.message : 'SVC_ATTACH_FAILED';
    }
  }
  private lastError: string | null = null;
  /** True while a native SVC client is attached to the current connection. */
  get attached(): boolean { return this.client !== null; }
  status() {
    return {...(this.client?.state() ?? {connected:false,udpAuthenticated:false,udpValidated:false,udpPort:null,reason:this.lastError,recipientHeard:'unknown'}),hearing:this.hearing?.status()??null, publicSpeech:this.publicSpeech.status(),performance:this.performance.status()};
  }
  disconnect(_reason?: string) {
    this.performance.cancel(undefined,'connection-closed');
    this.publicSpeech.disconnect();
    this.hearing?.close();this.hearing=null;
    try { this.client?.close(); } catch {}
    this.client = null;
  }
  async stop() {
    this.disconnect('stop');
    try { this.codec?.close?.(); } catch {}
    this.codec = null;
  }
  async call(args: Record<string, unknown> = {}, signal?: AbortSignal) {
    const cfg = this.options.config();
    const action = typeof args.action === 'string' ? args.action : 'status';
    const answer=(data:Record<string,unknown>)=>({text:'[mc_svc] '+JSON.stringify(data),data});
    if(action==='status' && typeof args.requestId==='string')
      return answer({requestId:args.requestId,performance:this.performance.status(args.requestId)});
    if(action==='cancel'){
      if(typeof args.requestId!=='string')throw Error('SVC_REQUEST_UUID_REQUIRED');
      const cancelRequested=this.performance.cancel(args.requestId);
      return answer({cancelRequested,performance:this.performance.status(args.requestId)});
    }
    if (!cfg.enabled) {
      return { text: '[mc_svc] 未启用。这是原生 Simple Voice Chat 客户端，不是 mc_voice/mcagent:voice。在配置中打开 simpleVoiceChat.enabled 并提供 officialJar（官方 Concentus）后，才能在已认证连接上上传 WAV。', data: { transport: 'simple-voice-chat', enabled: false, recipientHeard: 'unknown' } as Record<string, unknown> };
    }
    this.sync(this.context ?? undefined);
    if (!this.client) {
      return { text: `[mc_svc] 当前无法握手：${this.lastError ?? '未附着'}。检查已认证 play、officialJar，以及服务端是否登记了 voicechat 通道。`, data: { transport: 'simple-voice-chat', enabled: true, connected: false, recipientHeard: 'unknown' } as Record<string, unknown> };
    }
    if (action === 'status' || !action) {
      const state = {...this.client.state(), hearing:this.hearing?.status()??null, performance:this.performance.status(typeof args.requestId==='string'?args.requestId:undefined)};
      return { text: `[mc_svc] 原生 SVC 协议 ${state.compatibilityVersion}；${state.connected ? '已拿到密钥并解析语音地址' : '尚未完成握手'}；UDP 认证回执：${state.udpAuthenticated ? '已收到' : '未收到'}；recipientHeard=unknown。sent 不等于听见。`, data: { ...state } as Record<string, unknown> };
    }
    if(action==='songs' || action==='perform'){
      const origin=cfg.publicChatArtifactUrl, client=this.client,scope=this.context;
      if(!origin)throw Error('SVC_SONG_LIBRARY_NOT_CONFIGURED');
      if(action==='songs'){
        const response=await fetch(songEndpoint(origin),{redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(5000),...(signal?[signal]:[])])});
        if(!response.ok)throw Error('SVC_SONG_CATALOG_UNAVAILABLE: '+response.status);
        const value=await response.json() as {tracks?:unknown[]};
        if(!Array.isArray(value.tracks))throw Error('SVC_SONG_CATALOG_INVALID');
        return answer({tracks:value.tracks});
      }
      const requestId=args.requestId??randomUUID();
      if(typeof requestId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId))throw Error('SVC_REQUEST_UUID_REQUIRED');
      if(typeof args.trackId!=='string')throw Error('SVC_SONG_ID_REQUIRED');
      return answer(this.performance.start(origin,args.trackId,requestId,{current:()=>client===this.client && !!scope?.stillCurrent() && client.state().udpValidated,
        send:client.uploadFrames.bind(client),microphone:run=>this.microphone(run)}));
    }
    if (action === 'upload') {
      if (typeof args.audio_handle !== 'string' || !args.audio_handle) return { text: '[mc_svc] 需要 audio_handle 指向 PCM16 WAV。', data: { state: 'failed', reason: 'SVC_WAV_HANDLE_REQUIRED', recipientHeard: 'unknown' } as Record<string, unknown> };
      const blob = this.options.blob(args.audio_handle);
      if (!blob || !/^audio\/(wav|x-wav|wave)$/.test(blob.mime ?? 'audio/wav')) return { text: '[mc_svc] audio_handle 必须是 PCM16 WAV blob。', data: { state: 'failed', reason: 'SVC_WAV_BLOB_REQUIRED', recipientHeard: 'unknown' } as Record<string, unknown> };
      const wav = Buffer.from(blob.bytes);
      inspectVoiceWav(wav);
      const result = await this.upload(this.client, wav, { requestId: typeof args.requestId === 'string' ? args.requestId : randomUUID(), whisper: args.whisper === true, signal });
      return { text: `[mc_svc] 状态 ${result.state}，recipientHeard=unknown。这不是听见证明。`, data: { ...result } as Record<string, unknown> };
    }
    return { text: '[mc_svc] 未知 action。支持 status、upload、songs、perform 和 cancel。', data: { state: 'failed', reason: 'SVC_ACTION_UNKNOWN', recipientHeard: 'unknown' } as Record<string, unknown> };
  }
}
