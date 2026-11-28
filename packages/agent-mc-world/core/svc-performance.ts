import { programFrames } from './simple-voice-chat-opus.mjs';
import type { SimpleVoiceChatClient } from '../src/simple-voice-chat.ts';

const validTrack = /^[a-zA-Z0-9_-]{1,128}$/;
export function songEndpoint(origin: string, track?: string) {
  const url = new URL(origin);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw Error('SVC_SONG_ORIGIN_INVALID');
  if (track !== undefined && !validTrack.test(track))
    throw Error('SVC_SONG_ID_INVALID');
  return new URL('/api/music-artifacts' + (track ? '/' + track : ''), url);
}

async function fetchSong(url: URL, signal: AbortSignal) {
  const res = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    redirect: 'error',
  });
  const length = Number(res.headers.get('content-length'));
  if (
    !res.ok ||
    !res.body ||
    res.headers.get('content-type')?.split(';')[0] !== 'audio/wav' ||
    !Number.isSafeInteger(length) ||
    length < 44 ||
    length > 64 * 1024 * 1024
  ) {
    await res.body?.cancel();
    throw Error('SVC_SONG_ASSET_UNAVAILABLE');
  }
  const reader = res.body.getReader(),
    bytes = Buffer.allocUnsafe(length);
  let offset = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (offset + part.value.length > length)
        throw Error('SVC_SONG_SIZE_CHANGED');
      bytes.set(part.value, offset);
      offset += part.value.length;
    }
    if (offset !== length) throw Error('SVC_SONG_TRUNCATED');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return bytes;
}
type Receipt = {
  requestId: string;
  trackId: string;
  state: string;
  frames: number;
  totalFrames?: number;
  reason?: string;
  recipientHeard: 'unknown';
};
type Connection = {
  current: () => boolean;
  send: SimpleVoiceChatClient['uploadFrames'];
  microphone: <T>(run: () => Promise<T>) => Promise<T>;
};

export class SvcPerformance {
  private readonly recent = new Map<string, Receipt>();
  private active?: {
    receipt: Receipt;
    life: AbortController;
    segment?: AbortController;
  };
  constructor(
    private emit: (row: Receipt) => void,
    private load = fetchSong,
  ) {}
  status(id?: string) {
    const row = id
      ? this.recent.get(id)
      : (this.active?.receipt ?? [...this.recent.values()].at(-1));
    return row ? { ...row } : null;
  }
  yieldToSpeech() {
    this.active?.segment?.abort('foreground-speech');
  }
  cancel(id?: string, reason = 'cancelled') {
    if (
      !this.active ||
      (id && this.active.receipt.requestId !== id) ||
      this.active.life.signal.aborted
    )
      return false;
    this.active.life.abort(reason);
    return true;
  }
  start(
    origin: string,
    trackId: string,
    requestId: string,
    connection: Connection,
  ) {
    const url = songEndpoint(origin, trackId);
    const prior = this.recent.get(requestId);
    if (prior) {
      if (prior.trackId !== trackId) throw Error('SVC_REQUEST_ID_CONFLICT');
      return { ...prior };
    }
    if (this.active)
      throw Error('SVC_SONG_ALREADY_ACTIVE: ' + this.active.receipt.requestId);
    if (!connection.current()) throw Error('SVC_CONNECTION_NOT_READY');
    const receipt: Receipt = {
      requestId,
      trackId,
      state: 'queued',
      frames: 0,
      recipientHeard: 'unknown',
    };
    const active: {
      receipt: Receipt;
      life: AbortController;
      segment?: AbortController;
    } = { receipt, life: new AbortController() };
    this.active = active;
    this.recent.set(requestId, receipt);
    if (this.recent.size > 32)
      this.recent.delete(this.recent.keys().next().value!);
    const record = (state: string) => {
      receipt.state = state;
      this.emit({ ...receipt });
    };
    record('queued');
    void (async () => {
      const signal = active.life.signal;
      try {
        const audio = programFrames(await this.load(url, signal));
        receipt.totalFrames = audio.total;
        while (receipt.frames < audio.total) {
          signal.throwIfAborted();
          if (!connection.current()) throw Error('SVC_CONNECTION_CHANGED');
          const segment = new AbortController();
          active.segment = segment;
          const result = await connection.microphone(async () => {
            signal.throwIfAborted();
            if (!connection.current()) throw Error('SVC_CONNECTION_CHANGED');
            if (segment.signal.aborted)
              return { state: 'cancelled', frames: 0 };
            record('sending');
            return connection.send(audio.stream(receipt.frames), {
              requestId,
              program: true,
              signal: AbortSignal.any([signal, segment.signal]),
            });
          });
          receipt.frames += result.frames ?? 0;
          signal.throwIfAborted();
          if (result.state === 'sent' && receipt.frames === audio.total) break;
          if (segment.signal.aborted && connection.current()) {
            record('yielded-to-speech');
            continue;
          }
          throw Error('SVC_PROGRAM_SEND_INCOMPLETE');
        }
        record('sent');
      } catch (e) {
        receipt.reason = String(
          signal.aborted ? signal.reason : e instanceof Error ? e.message : e,
        );
        record(signal.aborted ? 'cancelled' : 'failed');
      } finally {
        if (this.active === active) this.active = undefined;
      }
    })();
    return { ...receipt };
  }
}
