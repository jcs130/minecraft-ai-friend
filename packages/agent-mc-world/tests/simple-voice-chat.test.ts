import { SvcPublicSpeech } from '../core/svc-public-speech.ts';
import type { ChatDeliveryReceipt } from '../src/contracts/chat-delivery.ts';
import { EventEmitter } from 'node:events';
import { createSocket } from 'node:dgram';
import { createDecipheriv, createCipheriv, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import {
  attachSimpleVoiceChat, parseVoicechatSecret, createOfficialOpusCodec,
  inspectVoiceWav, SVC_COMPATIBILITY_VERSION, SVC_CHANNELS,
} from '../src/simple-voice-chat.ts';
import { SIMPLE_VOICE_CHAT_TOOL } from '../core/simple-voice-chat-lane.ts';
import { PROXIMITY_VOICE_TOOL } from '../core/proximity-voice-lane.ts';
import { vint, readv } from '../core/simple-voice-chat.mjs';
import { pcm16Mono48kFromWav, SVC_FRAME_SAMPLES } from '../core/simple-voice-chat-opus.mjs';

// Official SVC jar (Concentus codec) is not redistributed; point SVC_OFFICIAL_JAR at a local copy.
const OFFICIAL_JAR = process.env.SVC_OFFICIAL_JAR || '';
const JAVA = process.env.SVC_JAVA || (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/java') : 'java');
const HAS_JAR = !!OFFICIAL_JAR && existsSync(OFFICIAL_JAR);
const itJar = it.skipIf(!HAS_JAR);
const JAVAC = JAVA.replace(/java$/, 'javac');

function makeWav(durationMs = 200, sampleRate = 48000) {
  const samples = Math.round(sampleRate * durationMs / 1000);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function secretPacket({ port, key, uuid, host }: { port: number; key: Buffer; uuid: Buffer; host: string }) {
  const hostBuf = Buffer.from(host, 'utf8');
  const out = Buffer.alloc(55 + hostBuf.length + 10);
  key.copy(out, 0);
  out.writeInt32BE(port, 16);
  uuid.copy(out, 20);
  out[36] = 0;
  out.writeInt32BE(1024, 37);
  out.writeDoubleBE(48, 41);
  out.writeInt32BE(1000, 49);
  out[53] = 1;
  let at = 54;
  const vintBuf = vint(hostBuf.length);
  vintBuf.copy(out, at); at += vintBuf.length;
  hostBuf.copy(out, at); at += hostBuf.length;
  out[at++] = 1;
  return out.subarray(0, at);
}

// Official NetworkMessage.writeServer: magic 0xFF + varint length + iv/ciphertext/tag. No player UUID.
function serverDatagram(encrypted: Buffer) {
  return Buffer.concat([Buffer.from([255]), vint(encrypted.length), encrypted]);
}
function encryptFor(key: Buffer, plain: Buffer) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-128-gcm', key, iv);
  return Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

function fakeBot() {
  const client = new EventEmitter() as EventEmitter & { state: string; write: (name: string, pkt: any) => void };
  client.state = 'play';
  const writes: any[] = [];
  client.write = (name, pkt) => { writes.push({ name, ...pkt }); };
  const bot: any = { _client: client, on: client.on.bind(client), once: client.once.bind(client), off: client.off.bind(client), emit: client.emit.bind(client) };
  return { bot, client, writes };
}

async function listenUdp() {
  const sock = createSocket('udp4');
  const port: number = await new Promise((resolve) => sock.bind(0, '127.0.0.1', () => resolve(sock.address().port)));
  return { sock, port };
}

const clean: Array<() => void> = [];
afterEach(() => { for (const fn of clean.splice(0)) try { fn(); } catch {} });

describe('native Simple Voice Chat client (jcs130 contract + official codec)', () => {
  it('parses official SecretPacket order including voiceHost, without exposing the key', () => {
    const key = randomBytes(16), uuid = randomBytes(16);
    const body = secretPacket({ port: 24454, key, uuid, host: '127.0.0.1:24454' });
    const parsed = parseVoicechatSecret(body);
    expect(parsed).toMatchObject({ port: 24454, udpHost: '127.0.0.1', udpPort: 24454, voiceHost: '127.0.0.1:24454', keepAlive: 1000 });
    expect(JSON.stringify(parsed)).not.toContain(key.toString('hex'));
    expect(parsed).not.toHaveProperty('key');
    expect(parseVoicechatSecret(secretPacket({port:24454,key,uuid,host:'35527'}))).toMatchObject({udpHost:null,udpPort:35527});
    expect(parseVoicechatSecret(secretPacket({port:24454,key,uuid,host:'65536'}))).toBeNull();
    expect(SVC_COMPATIBILITY_VERSION).toBe(20);
    expect(SVC_CHANNELS).toContain('voicechat:request_secret');
  });

  it('resamples recorded-style WAV to official 960-sample 48 kHz frames', () => {
    const wav = makeWav(200, 44100);
    expect(inspectVoiceWav(wav).sampleRate).toBe(44100);
    const pcm = pcm16Mono48kFromWav(wav);
    expect(pcm.length).toBeGreaterThanOrEqual(SVC_FRAME_SAMPLES);
    expect(pcm.length).toBeCloseTo(48000 * 0.2, -2);
  });

  itJar('official Concentus in SVC 2.6.22 decodes frames this client would upload', async () => {
    expect(existsSync(OFFICIAL_JAR)).toBe(true);
    const codec = createOfficialOpusCodec({ jar: OFFICIAL_JAR, javaPath: JAVA });
    clean.push(() => codec.close?.());
    const wav = makeWav(240);
    const pcm = pcm16Mono48kFromWav(wav);
    const frame = pcm.subarray(0, SVC_FRAME_SAMPLES);
    const opus = await codec.encode(frame);
    expect(opus.length).toBeGreaterThan(0);
    expect(opus.length).toBeLessThanOrEqual(4096);
    const decoded = await codec.decode(opus);
    expect(decoded.length).toBe(SVC_FRAME_SAMPLES);
    // Energy survives official encode/decode; this is codec compatibility, not hearing.
    const energy = Array.from(decoded).reduce((s, v) => s + v * v, 0) / decoded.length;
    expect(energy).toBeGreaterThan(1000);
  }, 20000);

  itJar('completes request_secret, UDP auth, sends WAV as Opus, and a peer can decrypt+decode; sent is not heard', async () => {
    const { sock, port } = await listenUdp();
    clean.push(() => sock.close());
    const key = randomBytes(16), uuid = randomBytes(16);
    let authed = 0, checks = 0, received: Buffer[] = [], datagrams = 0, decryptErrors = 0;
    let peer: { port: number; address: string } | null = null;
    sock.on('message', (packet, rinfo) => {
      datagrams++;
      try {
        if (packet[0] !== 255 || packet.length < 18) return;
        const [len, at] = readv(packet, 17);
        const enc = packet.subarray(at, at + len);
        const dec = createDecipheriv('aes-128-gcm', key, enc.subarray(0, 12));
        dec.setAuthTag(enc.subarray(-16));
        const data = Buffer.concat([dec.update(enc.subarray(12, -16)), dec.final()]);
        if (data[0] === 9) checks++;
        if (data[0] === 5) {
          authed++;
          peer = { port: rinfo.port, address: rinfo.address };
          const iv = randomBytes(12), cipher = createCipheriv('aes-128-gcm', key, iv);
          const encrypted = Buffer.concat([iv, cipher.update(Buffer.from([6])), cipher.final(), cipher.getAuthTag()]);
          sock.send(serverDatagram(encrypted), rinfo.port, rinfo.address);
        } else if (data[0] === 1) {
          const [size, start] = readv(data, 1);
          if (size > 0) received.push(Buffer.from(data.subarray(start, start + size)));
        }
      } catch { decryptErrors++; }
    });

    const { bot, client, writes } = fakeBot();
    const codec = createOfficialOpusCodec({ jar: OFFICIAL_JAR, javaPath: JAVA });
    clean.push(() => codec.close?.());
    const voice = attachSimpleVoiceChat(bot, { opus: codec, bindHost: '127.0.0.1', timeoutMs: 8000 });
    clean.push(() => voice.close());
    await new Promise((r) => setTimeout(r, 80));
    expect(writes.some((w) => w.channel === 'voicechat:request_secret' && w.data.readInt32BE(0) === 20)).toBe(true);
    expect(writes.some((w) => w.channel === 'minecraft:register' && w.data.includes('voicechat:secret'))).toBe(true);
    client.emit('custom_payload', { channel: 'voicechat:secret', data: secretPacket({ port, key, uuid, host: `127.0.0.1:${port}` }) });
    await voice.ready();
    expect(voice.state().connected).toBe(true);
    expect(voice.state().recipientHeard).toBe('unknown');
    const result = await voice.upload(makeWav(200));
    expect(result).toMatchObject({ transport: 'simple-voice-chat', state: 'sent', recipientHeard: 'unknown' });
    expect(result.frames).toBeGreaterThan(0);
    expect(authed, JSON.stringify({authed, datagrams, decryptErrors, udpPort: voice.state().udpPort, serverPort: port})).toBeGreaterThan(0);
    expect(received.length).toBeGreaterThan(0);
    const decoded = await codec.decode(received[0]);
    expect(decoded.length).toBe(SVC_FRAME_SAMPLES);
    const energy = Array.from(decoded).reduce((s, v) => s + v * v, 0) / decoded.length;
    expect(energy).toBeGreaterThan(1000);
    // The client must decode the server's ack (official no-UUID layout) and answer with ConnectionCheck.
    expect(checks, 'client decoded AuthenticateAck and sent ConnectionCheck').toBeGreaterThan(0);
    expect(voice.state().udpAuthenticated).toBe(true);
    expect(JSON.stringify(writes)).not.toMatch(key.toString('hex'));
  }, 25000);

  itJar('decodes server sound packets in the official writeServer layout (player, group, location)', async () => {
    const { sock, port } = await listenUdp();
    clean.push(() => sock.close());
    const key = randomBytes(16), uuid = randomBytes(16);
    const heard: { kind: string; bytes: number; heard: string }[] = [];
    const codec = createOfficialOpusCodec({ jar: OFFICIAL_JAR, javaPath: JAVA });
    clean.push(() => codec.close?.());
    const frame = Buffer.from(await codec.encode(pcm16Mono48kFromWav(makeWav(200)).subarray(0, SVC_FRAME_SAMPLES)));
    sock.on('message', (packet, rinfo) => {
      try {
        const [len, at] = readv(packet, 17);
        const enc = packet.subarray(at, at + len);
        const dec = createDecipheriv('aes-128-gcm', key, enc.subarray(0, 12));
        dec.setAuthTag(enc.subarray(-16));
        const data = Buffer.concat([dec.update(enc.subarray(12, -16)), dec.final()]);
        if (data[0] !== 5) return;
        const send = (plain: Buffer) => sock.send(serverDatagram(encryptFor(key, plain)), rinfo.port, rinfo.address);
        send(Buffer.from([6]));
        const ids = Buffer.concat([randomBytes(16), randomBytes(16)]);
        const tail = Buffer.concat([vint(frame.length), frame, Buffer.alloc(8)]);
        const dist = Buffer.alloc(4); dist.writeFloatBE(48);
        send(Buffer.concat([Buffer.from([2]), ids, tail, dist, Buffer.from([0])]));
        send(Buffer.concat([Buffer.from([3]), ids, tail, Buffer.from([0])]));
        send(Buffer.concat([Buffer.from([4]), ids, Buffer.alloc(24), tail, dist, Buffer.from([0])]));
      } catch {}
    });
    const { bot, client } = fakeBot();
    const voice = attachSimpleVoiceChat(bot, {
      opus: codec, bindHost: '127.0.0.1', timeoutMs: 8000,
      onAudio: (row) => heard.push({ kind: row.kind, bytes: row.bytes, heard: row.heard }),
    });
    clean.push(() => voice.close());
    await new Promise((r) => setTimeout(r, 50));
    client.emit('custom_payload', { channel: 'voicechat:secret', data: secretPacket({port,key,uuid,host:`127.0.0.1:${port}`}) });
    await voice.ready();
    const end = Date.now() + 5000;
    while (heard.length < 3 && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    expect(voice.state().udpAuthenticated).toBe(true);
    expect(heard.map((h) => h.kind).sort()).toEqual(['group', 'nearby', 'positional']);
    expect(heard.every((h) => h.bytes === frame.length && h.heard === 'unknown')).toBe(true);
  }, 25000);

  itJar('times out the handshake, cancels an in-flight upload, and cleans up sockets on close and disconnect', async () => {
    const { bot, client } = fakeBot();
    const codec = createOfficialOpusCodec({ jar: OFFICIAL_JAR, javaPath: JAVA });
    clean.push(() => codec.close?.());
    const voice = attachSimpleVoiceChat(bot, { opus: codec, bindHost: '127.0.0.1', timeoutMs: 80 });
    await expect(voice.ready()).rejects.toThrow(/SVC_HANDSHAKE_TIMEOUT/);
    voice.close();

    const again = attachSimpleVoiceChat(bot, { opus: codec, bindHost: '127.0.0.1', timeoutMs: 8000 });
    clean.push(() => again.close());
    const { sock, port } = await listenUdp();
    clean.push(() => sock.close());
    const key = randomBytes(16), uuid = randomBytes(16);
    sock.on('message', (packet, rinfo) => {
      try {
        if (packet[0] !== 255 || packet.length < 18) return;
        const [len, at] = readv(packet, 17);
        const enc = packet.subarray(at, at + len);
        const dec = createDecipheriv('aes-128-gcm', key, enc.subarray(0, 12));
        dec.setAuthTag(enc.subarray(-16));
        const data = Buffer.concat([dec.update(enc.subarray(12, -16)), dec.final()]);
        if (data[0] === 5) {
          const iv = randomBytes(12), cipher = createCipheriv('aes-128-gcm', key, iv);
          const encrypted = Buffer.concat([iv, cipher.update(Buffer.from([6])), cipher.final(), cipher.getAuthTag()]);
          sock.send(serverDatagram(encrypted), rinfo.port, rinfo.address);
        }
      } catch {}
    });
    await new Promise((r) => setTimeout(r, 50));
    client.emit('custom_payload', { channel: 'voicechat:secret', data: secretPacket({ port, key, uuid, host: `127.0.0.1:${port}` }) });
    await again.ready();
    const abort = new AbortController();
    const pending = again.upload(makeWav(800), { signal: abort.signal });
    abort.abort();
    const cancelled = await pending;
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.recipientHeard).toBe('unknown');
    const bot2 = fakeBot();
    const third = attachSimpleVoiceChat(bot2.bot, { opus: codec, bindHost: '127.0.0.1', timeoutMs: 200 });
    bot2.bot.emit('end');
    await expect(third.ready()).rejects.toThrow(/SVC_CONNECTION_ENDED|SVC_HANDSHAKE_TIMEOUT/);
  }, 25000);

  it('resolves a DNS voiceHost before UDP auth, accepts replies from the resolved address, and rejects fake-IP answers', async () => {
    const { sock, port } = await listenUdp();
    clean.push(() => sock.close());
    const key = randomBytes(16), uuid = randomBytes(16);
    sock.on('message', (packet, rinfo) => {
      try {
        const [len, at] = readv(packet, 17);
        const enc = packet.subarray(at, at + len);
        const dec = createDecipheriv('aes-128-gcm', key, enc.subarray(0, 12));
        dec.setAuthTag(enc.subarray(-16));
        const data = Buffer.concat([dec.update(enc.subarray(12, -16)), dec.final()]);
        if (data[0] === 5) sock.send(serverDatagram(encryptFor(key, Buffer.from([6]))), rinfo.port, rinfo.address);
      } catch {}
    });
    const codec = { encode: () => Buffer.from([248, 255, 254]) };
    const asked: string[] = [];
    const { bot, client } = fakeBot();
    const voice = attachSimpleVoiceChat(bot, {
      opus: codec, bindHost: '127.0.0.1', timeoutMs: 4000,
      resolveUdpHost: async (host) => { asked.push(host); return '127.0.0.1'; },
    });
    clean.push(() => voice.close());
    await new Promise((r) => setTimeout(r, 50));
    client.emit('custom_payload', { channel: 'voicechat:secret', data: secretPacket({ port, key, uuid, host: `voice.example.test:${port}` }) });
    await voice.ready();
    const end = Date.now() + 3000;
    while (!voice.state().udpAuthenticated && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    expect(asked).toEqual(['voice.example.test']);
    expect(voice.state()).toMatchObject({ connected: true, udpAuthenticated: true, voiceHost: `voice.example.test:${port}` });

    const fake = fakeBot();
    const bad = attachSimpleVoiceChat(fake.bot, { opus: codec, bindHost: '127.0.0.1', timeoutMs: 2000, resolveUdpHost: async () => '198.18.0.1' });
    clean.push(() => bad.close());
    await new Promise((r) => setTimeout(r, 50));
    fake.client.emit('custom_payload', { channel: 'voicechat:secret', data: secretPacket({ port, key, uuid, host: `voice.example.test:${port}` }) });
    await expect(bad.ready()).rejects.toThrow(/SVC_UDP_HOST_UNRESOLVED/);
    expect(bad.state().connected).toBe(false);
  }, 15000);

  it('retries Authenticate like the official AuthThread when the first datagram is lost, then validates', async () => {
    const { sock, port } = await listenUdp();
    clean.push(() => sock.close());
    const key = randomBytes(16), uuid = randomBytes(16);
    let authSeen = 0, checkSeen = 0;
    sock.on('message', (packet, rinfo) => {
      try {
        const [len, at] = readv(packet, 17);
        const enc = packet.subarray(at, at + len);
        const dec = createDecipheriv('aes-128-gcm', key, enc.subarray(0, 12));
        dec.setAuthTag(enc.subarray(-16));
        const data = Buffer.concat([dec.update(enc.subarray(12, -16)), dec.final()]);
        if (data[0] === 5 && ++authSeen >= 2) sock.send(serverDatagram(encryptFor(key, Buffer.from([6]))), rinfo.port, rinfo.address);
        if (data[0] === 9 && ++checkSeen >= 1) sock.send(serverDatagram(encryptFor(key, Buffer.from([10]))), rinfo.port, rinfo.address);
      } catch {}
    });
    const states: string[] = [];
    const { bot, client } = fakeBot();
    const voice = attachSimpleVoiceChat(bot, { opus: { encode: () => Buffer.from([248, 255, 254]) }, serverHost:'127.0.0.1', udpPort:port, bindHost:'127.0.0.1', timeoutMs: 6000,
      onState: (row) => states.push(String(row.state)) });
    clean.push(() => voice.close());
    await new Promise((r) => setTimeout(r, 50));
    client.emit('custom_payload', { channel: 'voicechat:secret', data: secretPacket({port:24454,key,uuid,host:''}) });
    await voice.ready();
    const end = Date.now() + 5000;
    while (!voice.state().udpValidated && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    expect(authSeen).toBeGreaterThanOrEqual(2);
    expect(voice.state()).toMatchObject({ udpAuthenticated: true, udpValidated: true, recipientHeard: 'unknown' });
    expect(states).toEqual(expect.arrayContaining(['secret-received', 'udp-auth-sent', 'udp-authenticated', 'udp-validated']));
  }, 15000);

  it('is a different API from the mcagent:voice proximity bridge', async () => {
    const { attachProximityVoice } = await import('../src/proximity-voice.ts');
    expect(attachSimpleVoiceChat).not.toBe(attachProximityVoice);
    const { bot } = fakeBot();
    expect(() => attachSimpleVoiceChat(bot, { opus: undefined as never })).toThrow(/SVC_OPUS_CODEC_REQUIRED/);
  });
});

  it('exposes mc_svc as a distinct Agent tool from mc_voice', () => {
    expect(SIMPLE_VOICE_CHAT_TOOL.name).toBe('mc_svc');
    expect(PROXIMITY_VOICE_TOOL.name).toBe('mc_voice');
    expect(SIMPLE_VOICE_CHAT_TOOL.name).not.toBe(PROXIMITY_VOICE_TOOL.name);
    expect(SIMPLE_VOICE_CHAT_TOOL.description).toMatch(/not mc_voice/i);
  });

describe('confirmed public speech to native SVC',()=>{
  const chat:ChatDeliveryReceipt={protocol:'agent-mc/chat-delivery/v1',id:'send-1',text:'一起走吧',channel:'public',
    status:'sent',sentAt:new Date().toISOString(),recipientRead:'unknown',boundary:'client-transport'};
  it('shares one render ID, serializes sends, and excludes whispers and existing speech captions',async()=>{
    const {vi}=await import('vitest');
    const ids:string[]=[],sent:string[]=[];
    const wav=makeWav();
    vi.stubGlobal('fetch',async(_url:URL,options:RequestInit)=>{
      const {requestId,text}=JSON.parse(String(options.body)); expect(text).toBe(chat.text);ids.push(requestId);
      return new Response(new Uint8Array(wav),{headers:{'x-voice-artifact-id':requestId}});
    });
    try {
      const lane=new SvcPublicSpeech(), connection={current:()=>true,send:async(bytes:Buffer,id:string)=>{
        expect(bytes.equals(wav)).toBe(true);sent.push(id);return {state:'sent',frames:10};
      }};
      const url='http://localhost';
      const first=lane.enqueue(chat,url,connection);
      expect(lane.enqueue(chat,url,connection)).toBe(first);
      for(const change of [{channel:'private' as const},{text:'/login secret'},{voiceRequestId:'caption'}])
        expect(lane.enqueue({...chat,...change},url,connection)).toBeUndefined();
      const second=lane.enqueue({...chat,id:'send-2'},url,connection);
      await vi.waitFor(()=>expect(sent).toEqual([first,second]));
      expect(ids).toEqual(sent);expect(lane.status()[1]).toMatchObject({state:'sent',frames:10,recipientHeard:'unknown'});
    } finally {vi.unstubAllGlobals();}
  });
  it('cancels queued audio on disconnect without replay into the next connection',async()=>{
    const {vi}=await import('vitest');
    const lane=new SvcPublicSpeech(),send=vi.fn();
    lane.enqueue(chat,'http://localhost',{current:()=>true,send});
    lane.disconnect();
    await vi.waitFor(()=>expect(lane.status()[0]?.state).toBe('cancelled'));
    expect(send).not.toHaveBeenCalled();
  });
});
