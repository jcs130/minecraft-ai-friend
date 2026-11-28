/**
 * Native Simple Voice Chat client for an existing authenticated Mineflayer play connection.
 * Contract reused from jcs130/minecraft-ai-friend loopback clients that already completed
 * encrypted UDP auth and synthetic Opus exchange against real SVC Bukkit 2.6.27:
 *   paper/integrations/login-guard/tests/protocol/live_svc.mjs
 *   paper/integrations/touhou-maids/tests/svc-receiver.mjs
 *   paper/integrations/proximity-voice/tests/delivery-integration.mjs
 * Distinct from the optional mcagent:voice / attachProximityVoice bridge.
 * Secret material is kept in process memory only and is never logged or returned.
 */
import { randomBytes, createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { inspectVoiceWav } from './proximity-voice.mjs';
import { pcm16Mono48kFromWav, pcmFrames, SVC_FRAME_SAMPLES, SVC_SAMPLE_RATE } from './simple-voice-chat-opus.mjs';

export const SVC_COMPATIBILITY_VERSION = 20;
export const SVC_CHANNELS = [
  'voicechat:secret', 'voicechat:state', 'voicechat:states',
  'voicechat:request_secret', 'voicechat:update_state',
];
const REGISTER = Buffer.from(SVC_CHANNELS.join('\0'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const attached = new WeakMap();

export function vint(n) {
  const out = [];
  do { let b = n & 127; n >>>= 7; if (n) b |= 128; out.push(b); } while (n);
  return Buffer.from(out);
}
export function readv(data, offset) {
  let n = 0, s = 0, p = offset;
  for (; p < data.length && s < 35; s += 7) {
    const v = data[p++];
    n |= (v & 127) << s;
    if (!(v & 128)) return [n, p];
  }
  throw Error('SVC_VARINT_INVALID');
}

/** Parse a received voicechat:secret body. Official SecretPacket 2.6.x field order. Never returns the key. */
export function parseVoicechatSecret(data) {
  if (!Buffer.isBuffer(data) || data.length < 55) return null;
  const port = data.readInt32BE(16);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const playerUuid = data.subarray(20, 36);
  const codec = data[36];
  const mtuSize = data.readInt32BE(37);
  const voiceChatDistance = data.readDoubleBE(41);
  const keepAlive = data.readInt32BE(49);
  const groupsEnabled = !!data[53];
  const [hostLen, hostAt] = readv(data, 54);
  if (hostLen < 0 || hostAt + hostLen > data.length) return null;
  const voiceHost = data.toString('utf8', hostAt, hostAt + hostLen);
  let allowRecording = null, at = hostAt + hostLen;
  if (at < data.length) { allowRecording = !!data[at]; at += 1; }
  let udpHost = null, udpPort = port;
  if (/^\d+$/.test(voiceHost)) {
    udpPort = Number(voiceHost);
  } else if (voiceHost) {
    const cut = voiceHost.lastIndexOf(':');
    if (cut > 0 && /^\d+$/.test(voiceHost.slice(cut + 1))) {
      udpHost = voiceHost.slice(0, cut);
      udpPort = Number(voiceHost.slice(cut + 1));
    } else udpHost = voiceHost;
  }
  if (!Number.isInteger(udpPort) || udpPort < 1 || udpPort > 65535) return null;
  return {
    port, udpHost, udpPort, playerUuid, codec, mtuSize, voiceChatDistance,
    keepAlive, groupsEnabled, voiceHost, allowRecording, byteLength: data.length,
  };
}

function requestSecretBody(version = SVC_COMPATIBILITY_VERSION) {
  const body = Buffer.alloc(4);
  body.writeInt32BE(version);
  return body;
}

/** RFC 2544 benchmark range used by fake-IP / intercepting resolvers; never a real voice server. */
const fakeAddress = (ip) => /^198\.(18|19)\./.test(ip);
async function defaultResolveUdpHost(host) {
  if (isIP(host)) return host;
  const { address } = await dnsLookup(host, { family: 4 });
  return address;
}

export function attachSimpleVoiceChat(bot, {
  onAudio, onState, isAuthenticated, opus, bindHost = '0.0.0.0', resolveUdpHost = defaultResolveUdpHost,
  serverHost, udpPort,
  compatibilityVersion = SVC_COMPATIBILITY_VERSION, timeoutMs = 15000,
} = {}) {
  const ready = () => bot?._client?.state === 'play' && (!isAuthenticated || isAuthenticated());
  if (!ready()) throw Error('SVC_AUTHENTICATED_PLAY_REQUIRED');
  if (!opus || typeof opus.encode !== 'function') throw Error('SVC_OPUS_CODEC_REQUIRED');
  if (udpPort !== undefined && (!Number.isSafeInteger(udpPort) || udpPort < 1 || udpPort > 65535)) throw Error('SVC_UDP_PORT_INVALID');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw Error('SVC_TIMEOUT_INVALID');
  attached.get(bot)?.close();
  let closed = false, key, uuid, secretMeta = null, sock = null, sequence = 0n, keepalive = null, uploading = false, udpAuthenticated = false, udpValidated = false, udpAddress = null, resolveError = null, authTimer = null, authTries = 0;
  const pendingAudio = [];
  const stateOf = () => ({
    transport: 'simple-voice-chat',
    compatibilityVersion,
    connected: !closed && ready() && !!secretMeta && !!udpAddress,
    udpPort: secretMeta?.udpPort ?? null,
    voiceHost: secretMeta?.voiceHost ?? '',
    codec: secretMeta?.codec ?? null,
    keepAlive: secretMeta?.keepAlive ?? null,
    receivedAudioFrames: pendingAudio.length,
    // True only after the server's AuthenticateAck datagram was decrypted. Still not hearing evidence.
    udpAuthenticated: !closed && udpAuthenticated,
    /** Server answered ConnectionCheck (official AuthThread second phase). */
    udpValidated: !closed && udpValidated,
    recipientHeard: 'unknown',
  });
  const emitState = (row) => { try { onState?.(row); } catch {} };

  const send = (id, body = Buffer.alloc(0)) => {
    if (closed || !key || !uuid || !sock || !secretMeta || !udpAddress) throw Error('SVC_NOT_CONNECTED');
    const iv = randomBytes(12), cipher = createCipheriv('aes-128-gcm', key, iv);
    const encrypted = Buffer.concat([iv, cipher.update(Buffer.concat([Buffer.from([id]), body])), cipher.final(), cipher.getAuthTag()]);
    sock.send(Buffer.concat([Buffer.from([255]), uuid, vint(encrypted.length), encrypted]), secretMeta.udpPort, udpAddress, (err)=>{ if(err) emitState({state:'udp-send-failed', reason:String(err)}); });
  };

  const onUdp = (packet, rinfo) => {
    if (closed || !key || !uuid) return;
    try {
      // voiceHost may be a DNS name (e.g. "voice.example:24454"); replies come from its resolved address.
      if (!udpAddress || rinfo.address !== udpAddress) return;
      if (rinfo.port !== secretMeta.udpPort) return;
      if (packet[0] !== 255 || packet.length < 2) return;
      // Server-to-client datagrams follow official NetworkMessage.writeServer: magic, then a
      // length-prefixed ciphertext. Only client-to-server datagrams carry the player UUID
      // (readPacketServer), so the receive path must not skip 16 bytes here.
      const [len, at] = readv(packet, 1);
      const enc = packet.subarray(at, at + len);
      const dec = createDecipheriv('aes-128-gcm', key, enc.subarray(0, 12));
      dec.setAuthTag(enc.subarray(-16));
      const data = Buffer.concat([dec.update(enc.subarray(12, -16)), dec.final()]);
      if (data[0] === 6) {
        if (!udpAuthenticated) { udpAuthenticated = true; emitState({ state: 'udp-authenticated', ...stateOf() }); }
        if (!udpValidated) send(9);
      }
      else if (data[0] === 10) {
        if (!udpValidated) { udpValidated = true; stopAuthLoop(); emitState({ state: 'udp-validated', ...stateOf() }); }
      }
      else if (data[0] === 8) send(8);
      else if (data[0] === 9) send(10);
      else if (data[0] === 2 || data[0] === 3 || data[0] === 4) {
        const pos = data[0] === 4 ? 57 : 33;
        const [size, start] = readv(data, pos);
        if (size > 0) {
          const frame = Buffer.from(data.subarray(start, start + size));
          const row = { kind: data[0] === 3 ? 'group' : data[0] === 4 ? 'positional' : 'nearby', bytes: frame.length, heard: 'unknown' };
          if (pendingAudio.length < 512) pendingAudio.push(row);
          onAudio?.({ ...row, opus: frame });
        }
      }
    } catch { /* malformed datagrams are dropped; they are not hearing evidence */ }
  };

  // Official ClientVoicechatConnection.AuthThread: resend Authenticate every second until the
  // AuthenticateAck arrives, then ConnectionCheck every second until ConnectionCheckAck.
  // A single datagram is not enough over a real network / proxy (first packets are often lost).
  const AUTH_INTERVAL_MS = 1000, AUTH_MAX_TRIES = 30;
  const stopAuthLoop = () => { if (authTimer) { clearInterval(authTimer); authTimer = null; } };
  const authStep = () => {
    if (closed || !udpAddress) { stopAuthLoop(); return; }
    if (udpValidated) { stopAuthLoop(); return; }
    if (++authTries > AUTH_MAX_TRIES) {
      stopAuthLoop();
      emitState({ state: udpAuthenticated ? 'udp-validate-timeout' : 'udp-auth-timeout', tries: authTries - 1, ...stateOf() });
      return;
    }
    try { if (!udpAuthenticated) send(5, Buffer.concat([uuid, key])); else send(9); } catch {}
  };
  const startAuthLoop = () => {
    stopAuthLoop(); authTries = 0;
    authStep();
    authTimer = setInterval(authStep, AUTH_INTERVAL_MS);
    authTimer.unref?.();
  };

  const onPayload = (packet) => {
    if (closed || !ready() || packet.channel !== 'voicechat:secret' || !Buffer.isBuffer(packet.data)) return;
    const parsed = parseVoicechatSecret(packet.data);
    if (!parsed) return;
    key = Buffer.from(packet.data.subarray(0, 16));
    uuid = Buffer.from(packet.data.subarray(20, 36));
    secretMeta = parsed;
    if (!secretMeta.udpHost) secretMeta.udpHost = serverHost || bot._client?.socket?.remoteAddress || bindHost;
    if (udpPort !== undefined) secretMeta.udpPort = udpPort;
    udpAddress = null; resolveError = null;
    emitState({ state: 'secret-received', ...stateOf() });
    const meta = secretMeta;
    Promise.resolve().then(() => resolveUdpHost(meta.udpHost)).then((address) => {
      if (closed || secretMeta !== meta) return;
      if (!address || !isIP(address) || fakeAddress(address)) throw Error('SVC_UDP_HOST_UNRESOLVED');
      udpAddress = address;
      if (!sock) return;
      startAuthLoop();
      if (!keepalive) {
        const interval = Number.isInteger(meta.keepAlive) && meta.keepAlive >= 200 ? meta.keepAlive : 1000;
        keepalive = setInterval(() => { if (udpAuthenticated) { try { send(8); } catch {} } }, interval);
      }
      emitState({ state: 'udp-auth-sent', ...stateOf() });
    }).catch((err) => {
      if (closed || secretMeta !== meta) return;
      resolveError = String(err?.message || err).includes('SVC_') ? String(err.message) : 'SVC_UDP_HOST_UNRESOLVED';
      emitState({ state: 'udp-host-unresolved', reason: resolveError, recipientHeard: 'unknown' });
    });
  };

  const handshake = () => {
    if (closed || !ready()) return;
    bot._client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from(REGISTER) });
    bot._client.write('custom_payload', { channel: 'voicechat:request_secret', data: requestSecretBody(compatibilityVersion) });
    bot._client.write('custom_payload', { channel: 'voicechat:update_state', data: Buffer.from([0]) });
  };

  const close = (unregister = true) => {
    if (closed) return;
    closed = true;
    if (keepalive) { clearInterval(keepalive); keepalive = null; }
    stopAuthLoop();
    try { bot._client.off('custom_payload', onPayload); } catch {}
    try { bot.off('end', ended); } catch {}
    if (unregister && bot?._client?.state === 'play') {
      try { bot._client.write('custom_payload', { channel: 'minecraft:unregister', data: Buffer.from(REGISTER) }); } catch {}
    }
    if (sock) { try { sock.close(); } catch {} sock = null; }
    key = undefined; uuid = undefined; secretMeta = null; udpAuthenticated = false; udpValidated = false; udpAddress = null;
    if (attached.get(bot)?.close === close) attached.delete(bot);
    emitState({ state: 'closed', recipientHeard: 'unknown' });
  };
  const ended = () => close(false);

  const waitReady = async (signal, requireAuth = false) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (closed) throw Error('SVC_CONNECTION_ENDED');
      if (signal?.aborted) throw Error('SVC_CANCELLED');
      if (secretMeta && sock && udpAddress && (!requireAuth || udpAuthenticated)) return;
      if (resolveError) throw Error(resolveError);
      await sleep(20);
    }
    if (requireAuth && udpAddress) throw Error('SVC_UDP_AUTH_TIMEOUT');
    throw Error(secretMeta ? 'SVC_UDP_HOST_UNRESOLVED' : 'SVC_HANDSHAKE_TIMEOUT');
  };

  const client = {
    transport: 'simple-voice-chat',
    compatibilityVersion,
    state: stateOf,
    async ready(signal) { await waitReady(signal); return stateOf(); },
    async upload(wav, { requestId = randomUUID(), signal, whisper = false } = {}) {
      if (!UUID.test(requestId)) throw Error('SVC_REQUEST_UUID_REQUIRED');
      if (uploading) throw Error('SVC_UPLOAD_ALREADY_PENDING');
      inspectVoiceWav(wav);
      if (!opus) throw Error('SVC_OPUS_CODEC_REQUIRED');
      uploading = true;
      try {
        await waitReady(signal,true);
        const frames = pcmFrames(pcm16Mono48kFromWav(wav));
        for (const frame of frames) {
          if (closed || !ready() || signal?.aborted) {
            return { requestId, transport: 'simple-voice-chat', state: 'cancelled', reason: 'SVC_UPLOAD_CANCELLED_OR_DISCONNECTED', recipientHeard: 'unknown' };
          }
          const encoded = await opus.encode(frame);
          const seq = Buffer.alloc(8); seq.writeBigInt64BE(sequence++);
          send(1, Buffer.concat([vint(encoded.length), encoded, seq, Buffer.from([whisper ? 1 : 0])]));
          await sleep(Math.round(1000 * SVC_FRAME_SAMPLES / SVC_SAMPLE_RATE));
        }
        const seq = Buffer.alloc(8); seq.writeBigInt64BE(sequence++);
        send(1, Buffer.concat([vint(0), seq, Buffer.from([0])]));
        return { requestId, transport: 'simple-voice-chat', state: 'sent', frames: frames.length, recipientHeard: 'unknown' };
      } finally { uploading = false; }
    },
    close,
  };
  sock = createSocket('udp4');
  sock.on('message', onUdp);
  bot._client.on('custom_payload', onPayload);
  bot.once('end', ended);
  attached.set(bot, client);
  sock.bind(0, bindHost, () => { if (!closed) handshake(); });
  return client;
}

export { createOfficialOpusCodec, pcm16Mono48kFromWav, pcmFrames, SVC_SAMPLE_RATE, SVC_FRAME_SAMPLES } from './simple-voice-chat-opus.mjs';
