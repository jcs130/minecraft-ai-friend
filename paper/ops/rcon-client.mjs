import net from 'node:net';
import { readFileSync } from 'node:fs';

// Paper's spatial entity lookup scans the bounding-box sections, even when
// almost all of them are empty. Never turn a loaded-entity census into a
// world-sized spatial query (the 2026-10-26 diagnostic caused a watchdog stop).
export function assertSafeSelectorRanges(text) {
  for (const match of text.matchAll(/\b(distance|dx|dy|dz)\s*=\s*([^\s,\]]+)/g)) {
    const [_, key, value] = match;
    const upper = key === 'distance' ? value.split('..').at(-1) : value;
    if (!upper) continue; // An open upper bound does not construct a huge AABB.
    const size = Number(upper);
    if (Number.isFinite(size) && Math.abs(size) > 256) throw new Error('Unsafe spatial selector: use a radius/extent of at most 256 blocks or inspect saved entity data');
  }
}

export function command(text, timeoutMs = 60000, connection = {}) {
  assertSafeSelectorRanges(text);
  const properties = readFileSync(connection.properties ?? 'E:/MC/server/server.properties', 'utf8');
  const password = properties.match(/^rcon\.password=(.*)$/m)?.[1].trim();
  if (!password) throw new Error('RCON password is not configured');
  const packet = (id, type, body) => {
    const payload = Buffer.from(body, 'utf8');
    const out = Buffer.alloc(payload.length + 14);
    out.writeInt32LE(out.length - 4, 0);
    out.writeInt32LE(id, 4);
    out.writeInt32LE(type, 8);
    payload.copy(out, 12);
    return out;
  };
  return new Promise((resolve, reject) => {
    const socket = net.connect(connection.port ?? 25575, '127.0.0.1');
    let buffer = Buffer.alloc(0);
    let authed = false;
    let answer = '';
    let settle;
    const finish = (error) => {
      clearTimeout(timer);
      clearTimeout(settle);
      socket.destroy();
      if (error) reject(error); else resolve(answer);
    };
    const timer = setTimeout(() => finish(new Error('RCON command timed out')), timeoutMs);
    socket.on('error', finish);
    socket.on('connect', () => socket.write(packet(1, 3, password)));
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readInt32LE(0);
        if (length < 10 || length > 16777216) return finish(new Error('Invalid RCON frame'));
        if (buffer.length < length + 4) break;
        const id = buffer.readInt32LE(4);
        const type = buffer.readInt32LE(8);
        const body = buffer.subarray(12, length + 2).toString('utf8');
        buffer = buffer.subarray(length + 4);
        if (id === -1) return finish(new Error('RCON authentication failed'));
        if (!authed && id === 1 && type === 2) {
          authed = true;
          socket.write(packet(2, 2, text));
        } else if (authed && id === 2 && type === 0) {
          answer += body;
          clearTimeout(settle);
          settle = setTimeout(() => finish(), 150);
        }
      }
    });
  });
}
