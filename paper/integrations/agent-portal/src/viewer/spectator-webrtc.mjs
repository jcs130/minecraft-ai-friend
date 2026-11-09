import { EventEmitter } from 'node:events';
import { NATIVE_RTC_PROTOCOL, NATIVE_RTC_LABEL, NATIVE_RTC_CHUNK_BYTES,
  NATIVE_RTC_EVENT_BYTES, NATIVE_RTC_SDP_BYTES, validNativeRtcDescription } from './native-rtc-protocol.js';

const HIGH_WATER = 256 * 1024, LOW_WATER = 64 * 1024;
const reply = (res, status, value) => {
  if (res.destroyed || res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
};

/** Passive per-source streams only. The host owns ICE configuration and the
 * optional peer backend. Existing portal authorization and public projection
 * apply before a peer is allocated and throughout its lifetime. */
export function createSpectatorWebRtc({ createPeerConnection, iceServers = [], maxPeers = 4,
  handshakeTimeoutMs = 12000, stallTimeoutMs = 10000, authorize, subscribe, live }) {
  if (typeof createPeerConnection !== 'function' || typeof authorize !== 'function'
      || typeof subscribe !== 'function' || typeof live !== 'function' || !Number.isInteger(maxPeers) || maxPeers < 1 || maxPeers > 64
      || !Number.isFinite(handshakeTimeoutMs) || handshakeTimeoutMs < 50 || handshakeTimeoutMs > 30000
      || !Number.isFinite(stallTimeoutMs) || stallTimeoutMs < 50 || stallTimeoutMs > 30000
      || !Array.isArray(iceServers) || iceServers.length > 8) throw Error('SPECTATOR_RTC_CONFIGURATION');
  const peers = new Set();
  let closed = false;
  async function permitted(peer) {
    if (closed || peer.closed || !live(peer.source)) return false;
    try {
      const grant = await authorize(peer.req, peer.source);
      return !closed && !peer.closed && live(peer.source) && (grant?.scope ?? 'owner') === peer.scope;
    } catch { return false; }
  }
  function closePeer(peer) {
    if (peer.closed) return;
    peer.closed = true; peers.delete(peer);
    clearTimeout(peer.deadline); clearTimeout(peer.pumpTimer); clearTimeout(peer.disconnectTimer);
    peer.req.off('aborted', peer.abort); peer.res.off('close', peer.httpClosed);
    peer.pending = null;
    if (peer.sink && !peer.sink.destroyed) { peer.sink.destroyed = true; peer.sink.emit('close'); }
    try { peer.channel?.close(); } catch {}
    try { void Promise.resolve(peer.pc?.close()).catch(() => {}); } catch {}
    reply(peer.res, 503, { available: false, reason: 'SPECTATOR_RTC_UNAVAILABLE' });
    if (!peer.req.complete) peer.req.destroy();
  }
  function sinkFor(peer, channel) {
    const sink = new EventEmitter(); sink.destroyed = false; sink.headersSent = false;
    Object.defineProperty(sink, 'writableLength', { get: () => (channel.bufferedAmount || 0) + (peer.pending?.length ?? 0) });
    sink.writeHead = code => { if (code !== 200) closePeer(peer); else sink.headersSent = true; };
    sink.flushHeaders = () => {};
    sink.end = sink.destroy = () => closePeer(peer);
    channel.bufferedAmountLowThreshold = LOW_WATER;
    let pumping = false, blocked = false, lastProgress = Date.now(), lastBuffered = 0;
    function pump() {
      if (pumping || peer.closed) return;
      pumping = true; clearTimeout(peer.pumpTimer); peer.pumpTimer = null;
      try {
        if (channel.readyState !== 'open') { closePeer(peer); return; }
        if (channel.bufferedAmount < lastBuffered) lastProgress = Date.now();
        while (peer.pending?.length && channel.bufferedAmount < HIGH_WATER) {
          const chunk = peer.pending.subarray(0, NATIVE_RTC_CHUNK_BYTES);
          channel.send(chunk); peer.sentBytes += chunk.length; lastProgress = Date.now();
          peer.pending = peer.pending.subarray(chunk.length);
        }
        lastBuffered = channel.bufferedAmount;
        if (!peer.pending?.length && channel.bufferedAmount <= LOW_WATER) {
          peer.pending = null;
          if (blocked) { blocked = false; queueMicrotask(() => { if (!peer.closed) sink.emit('drain'); }); }
        } else {
          if (Date.now() - lastProgress > stallTimeoutMs) { closePeer(peer); return; }
          // Some Node backends do not emit bufferedamountlow in every drain.
          peer.pumpTimer = setTimeout(pump, 25); peer.pumpTimer.unref?.();
        }
      } catch { closePeer(peer); }
      finally { pumping = false; }
    }
    channel.onbufferedamountlow = pump;
    sink.write = value => {
      if (peer.closed) return false;
      const bytes = Buffer.from(value);
      if (peer.pending?.length || bytes.length > NATIVE_RTC_EVENT_BYTES) { closePeer(peer); return false; }
      peer.pending = bytes; pump();
      blocked = !!peer.pending?.length || channel.bufferedAmount > LOW_WATER;
      return !blocked && !peer.closed;
    };
    return sink;
  }
  async function http(req, res, source, scope) {
    if (closed || !live(source)) { reply(res, 503, { available: false, reason: 'SPECTATOR_SOURCE_OFFLINE' }); return; }
    if (req.method === 'GET') {
      reply(res, 200, { schemaVersion: 1, protocol: NATIVE_RTC_PROTOCOL, enabled: true, readOnly: true,
        iceServers, maxChunkBytes: NATIVE_RTC_CHUNK_BYTES, maxEventBytes: NATIVE_RTC_EVENT_BYTES }); return;
    }
    // A browser must deliberately make this same-origin JSON request. No cookie
    // or publisher credential is copied into SDP or a DataChannel message.
    if (req.method !== 'POST' || req.headers['content-type']?.split(';')[0] !== 'application/json'
        || req.headers['x-mcvisual-transport'] !== NATIVE_RTC_PROTOCOL
        || req.headers['sec-fetch-site'] === 'cross-site') {
      reply(res, 400, { available: false, reason: 'SPECTATOR_RTC_REQUEST_INVALID' }); return;
    }
    if ([...peers].filter(peer => peer.source === source).length >= maxPeers) {
      reply(res, 429, { available: false, reason: 'SPECTATOR_RTC_PEER_LIMIT' }); return;
    }
    const peer = { req, res, source, scope, pc: null, channel: null, sink: null, closed: false, pending: null, sentBytes: 0 };
    peer.abort = () => closePeer(peer);
    peer.httpClosed = () => { if (!res.writableEnded) closePeer(peer); };
    peers.add(peer); req.once('aborted', peer.abort); res.once('close', peer.httpClosed);
    peer.deadline = setTimeout(() => closePeer(peer), handshakeTimeoutMs); peer.deadline.unref?.();
    try {
      let length = 0; const chunks = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > NATIVE_RTC_SDP_BYTES + 8192) {
          reply(res, 413, { available: false, reason: 'SPECTATOR_RTC_REQUEST_LIMIT' }); closePeer(peer); return;
        }
        if (peer.closed) return;
        chunks.push(chunk);
      }
      const offer = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (offer.protocol !== NATIVE_RTC_PROTOCOL || !validNativeRtcDescription(offer, 'offer')
          || !['owner', 'scene'].includes(scope)) throw Error('invalid');
      if (!await permitted(peer)) { reply(res, 403, { available: false, reason: 'SPECTATOR_VIEW_FORBIDDEN' }); closePeer(peer); return; }
      peer.pc = createPeerConnection();
      peer.pc.ondatachannel = ({ channel }) => {
        if (peer.closed || peer.channel || channel.label !== NATIVE_RTC_LABEL || channel.protocol !== NATIVE_RTC_PROTOCOL
            || channel.ordered !== true || channel.maxRetransmits != null || channel.maxPacketLifeTime != null) { channel.close(); closePeer(peer); return; }
        peer.channel = channel;
        channel.onmessage = () => closePeer(peer); // read-only, never a command bridge
        channel.onclose = channel.onerror = () => closePeer(peer);
        const opened = async () => {
          if (peer.sink || peer.closed) return;
          if (!await permitted(peer)) { closePeer(peer); return; }
          if (peer.sink || peer.closed) return;
          clearTimeout(peer.deadline);
          peer.sink = sinkFor(peer, channel);
          if (!subscribe(source, req, peer.sink, scope)) closePeer(peer);
        };
        channel.onopen = () => { void opened().catch(() => closePeer(peer)); };
        if (channel.readyState === 'open') channel.onopen();
      };
      peer.pc.onconnectionstatechange = () => {
        const state = peer.pc.connectionState;
        if (state === 'failed' || state === 'closed') closePeer(peer);
        clearTimeout(peer.disconnectTimer);
        if (state === 'disconnected') { peer.disconnectTimer = setTimeout(() => closePeer(peer), 5000); peer.disconnectTimer.unref?.(); }
      };
      await peer.pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
      if (peer.closed) return;
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      if (!await permitted(peer)) { reply(res, 403, { available: false, reason: 'SPECTATOR_VIEW_FORBIDDEN' }); closePeer(peer); return; }
      const answer = peer.pc.localDescription;
      if (!validNativeRtcDescription(answer, 'answer')) throw Error('invalid answer');
      reply(res, 200, { schemaVersion: 1, protocol: NATIVE_RTC_PROTOCOL, type: 'answer', sdp: answer.sdp });
    } catch {
      reply(res, 400, { available: false, reason: 'SPECTATOR_RTC_NEGOTIATION_FAILED' }); closePeer(peer);
    }
  }
  return {
    http,
    async check(source) { for (const peer of [...peers]) if (peer.source === source && !await permitted(peer)) closePeer(peer); },
    retire(source) { for (const peer of [...peers]) if (peer.source === source) closePeer(peer); },
    state(source) { const active = [...peers].filter(peer => peer.source === source); return { peers: active.length,
      connected: active.filter(peer => peer.channel?.readyState === 'open').length, sentBytes: active.reduce((n, peer) => n + peer.sentBytes, 0) }; },
    close() { closed = true; for (const peer of [...peers]) closePeer(peer); }
  };
}
