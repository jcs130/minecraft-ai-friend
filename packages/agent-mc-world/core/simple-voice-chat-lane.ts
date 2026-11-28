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
}
export interface SimpleVoiceChatContext {
  bot: Parameters<typeof attachSimpleVoiceChat>[0];
  stillCurrent(): boolean;
}

export const SIMPLE_VOICE_CHAT_TOOL: Omit<ToolDef, 'handler'> = {
  name: 'mc_svc', tags: ['speak'], bodyControl: 'independent',
  description: 'Native Simple Voice Chat client on the current authenticated connection. '
    + 'This is not mc_voice / mcagent:voice. {} reports handshake state. '
    + '{action:"upload",audio_handle,requestId?} sends a PCM16 WAV (0.1–30s) as official 48 kHz 20 ms Opus frames after request_secret and UDP auth. '
    + 'sent means frames were written to UDP, not that anyone heard them. Cancel with AbortSignal via the host; close() leaves no UDP socket. '
    + 'Disabled by default. Requires an Opus codec (official SVC jar Concentus, or a provided codec).',
  parameters: { type: 'object', additionalProperties: false, properties: {
    action: { type: 'string', enum: ['status', 'upload'] },
    audio_handle: { type: 'string', minLength: 1, maxLength: 300 },
    requestId: { type: 'string', format: 'uuid' },
    whisper: { type: 'boolean' },
  } },
};

export class SimpleVoiceChatLane {
  private client: SimpleVoiceChatClient | null = null;
  private context: SimpleVoiceChatContext | null = null;
  private codec: (SimpleVoiceChatOpus & { close?(): void }) | null = null;
  constructor(private readonly options: {
    config: () => SimpleVoiceChatConfig;
    serverHost?: () => string;
    blob: (handle: string) => { bytes: Uint8Array; mime?: string } | null;
    /** Optional host-provided Opus codec; otherwise the official SVC jar's Concentus is used. */
    opus?: () => SimpleVoiceChatOpus & { close?(): void };
    /** Optional resolver override (tests / hosts); defaults to public-DNS fallback. */
    resolveUdpHost?: (host: string) => Promise<string>;
  }) {}
  sync(context?: SimpleVoiceChatContext) {
    if (context) this.context = context;
    const cfg = this.options.config();
    if (!cfg.enabled || !this.context?.stillCurrent()) { this.disconnect('disabled-or-stale'); return; }
    if (this.client) return;
    this.lastError = null;
    try {
      this.codec = this.codec ?? (this.options.opus ? this.options.opus() : createOfficialOpusCodec({ jar: cfg.officialJar, javaPath: cfg.javaPath || undefined }));
      this.client = attachSimpleVoiceChat(this.context.bot, {
        opus: this.codec, isAuthenticated: () => this.context!.stillCurrent(),
        compatibilityVersion: cfg.compatibilityVersion || 20, bindHost: cfg.bindHost || '0.0.0.0',
        serverHost:this.options.serverHost?.(), udpPort:cfg.udpPort === 0 ? undefined : cfg.udpPort,
        resolveUdpHost: this.options.resolveUdpHost ?? resolveSvcUdpHost,
      });
    } catch (error) {
      this.client = null;
      this.lastError = error instanceof Error ? error.message : 'SVC_ATTACH_FAILED';
    }
  }
  private lastError: string | null = null;
  /** True while a native SVC client is attached to the current connection. */
  get attached(): boolean { return this.client !== null; }
  status() {
    return this.client?.state() ?? {connected:false,udpAuthenticated:false,udpValidated:false,udpPort:null,reason:this.lastError,recipientHeard:'unknown'};
  }
  disconnect(_reason?: string) {
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
    if (!cfg.enabled) {
      return { text: '[mc_svc] 未启用。这是原生 Simple Voice Chat 客户端，不是 mc_voice/mcagent:voice。在配置中打开 simpleVoiceChat.enabled 并提供 officialJar（官方 Concentus）后，才能在已认证连接上上传 WAV。', data: { transport: 'simple-voice-chat', enabled: false, recipientHeard: 'unknown' } as Record<string, unknown> };
    }
    this.sync(this.context ?? undefined);
    if (!this.client) {
      return { text: `[mc_svc] 当前无法握手：${this.lastError ?? '未附着'}。检查已认证 play、officialJar，以及服务端是否登记了 voicechat 通道。`, data: { transport: 'simple-voice-chat', enabled: true, connected: false, recipientHeard: 'unknown' } as Record<string, unknown> };
    }
    if (action === 'status' || !action) {
      const state = this.client.state();
      return { text: `[mc_svc] 原生 SVC 协议 ${state.compatibilityVersion}；${state.connected ? '已拿到密钥并解析语音地址' : '尚未完成握手'}；UDP 认证回执：${state.udpAuthenticated ? '已收到' : '未收到'}；recipientHeard=unknown。sent 不等于听见。`, data: { ...state } as Record<string, unknown> };
    }
    if (action === 'upload') {
      if (typeof args.audio_handle !== 'string' || !args.audio_handle) return { text: '[mc_svc] 需要 audio_handle 指向 PCM16 WAV。', data: { state: 'failed', reason: 'SVC_WAV_HANDLE_REQUIRED', recipientHeard: 'unknown' } as Record<string, unknown> };
      const blob = this.options.blob(args.audio_handle);
      if (!blob || !/^audio\/(wav|x-wav|wave)$/.test(blob.mime ?? 'audio/wav')) return { text: '[mc_svc] audio_handle 必须是 PCM16 WAV blob。', data: { state: 'failed', reason: 'SVC_WAV_BLOB_REQUIRED', recipientHeard: 'unknown' } as Record<string, unknown> };
      const wav = Buffer.from(blob.bytes);
      inspectVoiceWav(wav);
      const result = await this.client.upload(wav, { requestId: typeof args.requestId === 'string' ? args.requestId : randomUUID(), whisper: args.whisper === true, signal });
      return { text: `[mc_svc] 状态 ${result.state}，recipientHeard=unknown。这不是听见证明。`, data: { ...result } as Record<string, unknown> };
    }
    return { text: '[mc_svc] 未知 action。仅 status 与 upload。', data: { state: 'failed', reason: 'SVC_ACTION_UNKNOWN', recipientHeard: 'unknown' } as Record<string, unknown> };
  }
}
