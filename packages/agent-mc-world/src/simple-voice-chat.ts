import {
  attachSimpleVoiceChat as attach,
  parseVoicechatSecret as parseSecret,
  createOfficialOpusCodec as officialOpus,
} from '../core/simple-voice-chat.mjs';
import { pcm16Mono48kFromWav as wavToPcm } from '../core/simple-voice-chat-opus.mjs';
import { inspectVoiceWav } from '../core/proximity-voice.mjs';

export interface SimpleVoiceChatOpus {
  kind?: string;
  encode(frame: Int16Array): Promise<Buffer> | Buffer;
  decode?(frame: Buffer): Promise<Int16Array> | Int16Array;
  close?(): void;
}
export interface SimpleVoiceChatBot {
  _client: { state: string; write(name: string, value: unknown): void; on(name: string, fn: (value: any) => void): unknown; off(name: string, fn: (value: any) => void): unknown };
  on(name: string, fn: () => void): unknown;
  once(name: string, fn: () => void): unknown;
  off(name: string, fn: (value?: any) => void): unknown;
}
export interface SimpleVoiceChatResult {
  requestId: string;
  transport: 'simple-voice-chat';
  state: 'sent' | 'cancelled' | 'failed' | 'unknown';
  frames?: number;
  reason?: string;
  recipientHeard: 'unknown';
}
export interface SimpleVoiceChatState {
  transport: 'simple-voice-chat';
  compatibilityVersion: number;
  connected: boolean;
  udpPort: number | null;
  voiceHost: string;
  codec: number | null;
  keepAlive: number | null;
  receivedAudioFrames: number;
  /** Server AuthenticateAck was received and decrypted (official writeServer layout). Not hearing evidence. */
  udpAuthenticated: boolean;
  /** Server answered ConnectionCheck (official AuthThread second phase). Not hearing evidence. */
  udpValidated: boolean;
  recipientHeard: 'unknown';
}
export interface SimpleVoiceChatClient {
  transport: 'simple-voice-chat';
  compatibilityVersion: number;
  state(): SimpleVoiceChatState;
  ready(signal?: AbortSignal): Promise<SimpleVoiceChatState>;
  upload(wav: Buffer, options?: { requestId?: string; signal?: AbortSignal; whisper?: boolean }): Promise<SimpleVoiceChatResult>;
  close(unregister?: boolean): void;
}
export interface SimpleVoiceChatOptions {
  opus: SimpleVoiceChatOpus;
  isAuthenticated?: () => boolean;
  bindHost?: string;
  serverHost?: string;
  udpPort?: number;
  /** Resolve the SecretPacket voice host (may be a DNS name) to an IPv4 address. Fake 198.18/15 answers are rejected. */
  resolveUdpHost?: (host: string) => Promise<string>;
  compatibilityVersion?: number;
  timeoutMs?: number;
  onAudio?: (row: { kind: string; bytes: number; heard: 'unknown'; opus: Buffer; speakerUuid: string; channelUuid: string; sequence: string; ended: boolean }) => void;
  onState?: (row: Record<string, unknown>) => void;
}
export const attachSimpleVoiceChat: (bot: SimpleVoiceChatBot, options: SimpleVoiceChatOptions) => SimpleVoiceChatClient = attach;
export const parseVoicechatSecret: (data: Buffer) => {
  port: number; udpHost: string | null; udpPort: number; voiceHost: string;
  codec: number; mtuSize: number; voiceChatDistance: number; keepAlive: number;
  groupsEnabled: boolean; allowRecording: boolean | null; byteLength: number;
} | null = parseSecret;
export const createOfficialOpusCodec: (options: { jar: string; javaPath?: string; classDir?: string; sourcePath?: string }) => SimpleVoiceChatOpus = officialOpus;
export const pcm16Mono48kFromWav: (wav: Buffer) => Int16Array = wavToPcm;
export const SVC_COMPATIBILITY_VERSION = 20 as const;
export const SVC_CHANNELS = [
  'voicechat:secret', 'voicechat:state', 'voicechat:states',
  'voicechat:request_secret', 'voicechat:update_state',
] as const;
export { inspectVoiceWav };
export { SvcHearing, transcribeSvcWav, type SvcHearingOptions, type VoiceSpeaker, type VoiceTranscript } from '../core/svc-hearing.ts';
