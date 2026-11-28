import { inspectVoiceWav, inspectPcmWav } from './proximity-voice.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/** Official Simple Voice Chat codec constants (2.6.x OpusManager): 48 kHz, 20 ms, VOIP. */
export const SVC_SAMPLE_RATE = 48000;
export const SVC_FRAME_SAMPLES = 960;
export const SVC_MAX_OPUS_BYTES = 4096;

export function pcm16Mono48kFromWav(wav) {
  const pcm=wavSamples(wav,inspectVoiceWav(wav));
  return pcm.read(0,pcm.length);
}

export function programFrames(wav) {
  const pcm=wavSamples(wav,inspectPcmWav(wav,64*1024*1024,300000));
  const total=Math.ceil(pcm.length/SVC_FRAME_SAMPLES);
  return {total, stream(offset) {
    let cursor=offset;
    return new ReadableStream({pull(controller) {
      if(cursor>=total) {controller.close();return;}
      controller.enqueue(pcm.read(cursor++*SVC_FRAME_SAMPLES,SVC_FRAME_SAMPLES));
    }});
  }};
}

function wavSamples(wav,info) {
  let dataAt, dataBytes;
  for (let at = 12; at + 8 <= wav.length;) {
    const size = wav.readUInt32LE(at + 4), kind = wav.toString('ascii', at, at + 4);
    if (kind === 'data') { dataAt = at + 8; dataBytes = size; break; }
    at += 8 + size + (size % 2);
  }
  const src = wav.subarray(dataAt, dataAt + dataBytes);
  const channels = info.channels, srcRate = info.sampleRate;
  const frames = src.length / (channels * 2);
  const duration = frames / srcRate;
  const outCount = Math.round(duration * SVC_SAMPLE_RATE);
  return {length:outCount,read(start,count) {
    const out = new Int16Array(count);
    for (let i = start; i < Math.min(outCount,start+count); i++) {
      const srcPos = i * srcRate / SVC_SAMPLE_RATE;
      const i0 = Math.min(frames - 1, Math.floor(srcPos));
      const i1 = Math.min(frames - 1, i0 + 1);
      const t = srcPos - i0;
      const sample = (c) => {
        const at = (i, c) => src.readInt16LE((i * channels + c) * 2);
        return at(i0, c) + (at(i1, c) - at(i0, c)) * t;
      };
      const mono = channels === 1 ? sample(0) : (sample(0) + sample(1)) / 2;
      out[i-start] = Math.max(-32768, Math.min(32767, Math.round(mono)));
    }
    return out;
  }};
}

export function pcmFrames(pcm) {
  const frames = [];
  for (let at = 0; at < pcm.length; at += SVC_FRAME_SAMPLES) {
    const frame = new Int16Array(SVC_FRAME_SAMPLES);
    frame.set(pcm.subarray(at, Math.min(pcm.length, at + SVC_FRAME_SAMPLES)));
    frames.push(frame);
  }
  return frames;
}

function frameBytes(frame) {
  return Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
}

/**
 * Talk to the official Concentus encoder/decoder shipped in a Simple Voice Chat jar.
 * Used as an independent codec (not a second invented Opus). Requires a JDK at runtime.
 */
const compiledOracles = new Set();
export function createOfficialOpusCodec({ jar, javaPath, classDir, sourcePath } = {}) {
  if (!jar || !existsSync(jar)) throw Error('SVC_OFFICIAL_OPUS_JAR_REQUIRED');
  const java = javaPath || process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin/java') || 'java';
  const javac = java.replace(/java$/, 'javac');
  const here = dirname(fileURLToPath(import.meta.url));
  const src = sourcePath || join(here, 'official-svc-opus/OfficialSvcOpusOracle.java');
  const out = classDir || join(tmpdir(), 'agent-mc-world-official-svc-opus');
  const buildKey=JSON.stringify([java,jar,src,out]);
  if (!compiledOracles.has(buildKey) || !existsSync(join(out, 'OfficialSvcOpusOracle.class'))) {
    mkdirSync(out, { recursive: true });
    if (existsSync(src)) {
      const compiled = spawnSync(javac, ['--release', '17', '-cp', jar, '-d', out, src], { encoding: 'utf8' });
      if (compiled.status !== 0) throw Error('SVC_OFFICIAL_OPUS_COMPILE_FAILED');
      compiledOracles.add(buildKey);
    }
  }
  const child = spawn(java, ['-cp', `${out}${sep()}${jar}`, 'OfficialSvcOpusOracle'], { windowsHide:true, stdio: ['pipe', 'pipe', 'pipe'] });
  let leftover = Buffer.alloc(0), waiters = [];
  child.stdout.on('data', (chunk) => {
    leftover = Buffer.concat([leftover, chunk]);
    for (;;) {
      if (!waiters.length || leftover.length < 2) return;
      const size = leftover.readUInt16BE(0);
      if (leftover.length < 2 + size) return;
      const body = leftover.subarray(2, 2 + size);
      leftover = leftover.subarray(2 + size);
      waiters.shift().resolve(body);
    }
  });
  const fail = (error) => { for (const waiter of waiters) waiter.reject(error); waiters = []; };
  child.on('error', fail);
  child.stdin.on('error', fail);
  let stderr=''; child.stderr.on('data', (chunk)=>{stderr+=chunk.toString(); if(stderr.length>4000)stderr=stderr.slice(-4000);});
  child.on('exit', (code) => fail(Error(`SVC_OFFICIAL_OPUS_EXIT_${code}${stderr?': '+stderr.slice(0,800):''}`)));
  const request = (payload) => new Promise((resolve, reject) => {
    if (!child.stdin.writable) return reject(Error('SVC_OFFICIAL_OPUS_CLOSED'));
    waiters.push({ resolve, reject });
    child.stdin.write(payload);
  });
  return {
    kind: 'official-simple-voice-chat-concentus',
    async encode(frame) {
      const raw = frameBytes(frame);
      const header = Buffer.alloc(3);
      header[0] = 1;
      header.writeUInt16BE(frame.length, 1);
      const opus = await request(Buffer.concat([header, raw]));
      if (opus.length > SVC_MAX_OPUS_BYTES) throw Error('SVC_OPUS_FRAME_TOO_LARGE');
      return opus;
    },
    async decode(opus) {
      if (!Buffer.isBuffer(opus) || opus.length > SVC_MAX_OPUS_BYTES) throw Error('SVC_OPUS_FRAME_INVALID');
      const header = Buffer.alloc(3);
      header[0] = 2;
      header.writeUInt16BE(opus.length, 1);
      const pcm = await request(Buffer.concat([header, opus]));
      const out = new Int16Array(pcm.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = pcm.readInt16LE(i * 2);
      return out;
    },
    close() {
      try { child.stdin.write(Buffer.from([3])); } catch {}
      try { child.kill(); } catch {}
    },
  };
}

function sep() { return process.platform === 'win32' ? ';' : ':'; }
