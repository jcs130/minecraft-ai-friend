import { deflateSync, deflateRawSync } from 'node:zlib';
import { crc32 } from '../src/appearance-files.mjs';
export function png(width = 64, height = 64) {
  function chunk(type, bytes) { const out = Buffer.alloc(bytes.length + 12); out.writeUInt32BE(bytes.length); out.write(type, 4); bytes.copy(out, 8); out.writeUInt32BE(crc32(out.subarray(4, out.length - 4)), out.length - 4); return out; }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height, 180); for (let y = 0; y < height; y++) pixels[y * (width * 4 + 1)] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export function zip(files, { mode = 0o100644 } = {}) {
  let offset = 0; const locals = [], central = [];
  for (const [name, value] of Object.entries(files)) {
    const raw = Buffer.isBuffer(value) ? value : Buffer.from(value), compressed = deflateRawSync(raw), title = Buffer.from(name), crc = crc32(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(title.length, 26);
    locals.push(local, title, compressed);
    const row = Buffer.alloc(46); row.writeUInt32LE(0x02014b50); row.writeUInt16LE(0x0314, 4); row.writeUInt16LE(20, 6); row.writeUInt16LE(8, 10); row.writeUInt32LE(crc, 16); row.writeUInt32LE(compressed.length, 20); row.writeUInt32LE(raw.length, 24); row.writeUInt16LE(title.length, 28); row.writeUInt32LE((mode << 16) >>> 0, 38); row.writeUInt32LE(offset, 42); central.push(row, title); offset += local.length + title.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...locals, directory, end]);
}
export function modelFiles() { return {
  'ysm.json': JSON.stringify({ spec: 2, properties: { free: true }, files: { player: { model: { main: 'model.json', arm: 'model.json' }, animation: { main: 'animation.json' }, texture: ['default.png'] } } }),
  'model.json': JSON.stringify({ format_version: '1.12.0', 'minecraft:geometry': [{ description: { identifier: 'geometry.player', texture_width: 64, texture_height: 64 }, bones: [{ name: 'head', pivot: [0, 24, 0], cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] }] }] }] }),
  'animation.json': JSON.stringify({ format_version: '1.8.0', animations: { 'animation.idle': { loop: true, bones: {} } } }), 'default.png': png()
}; }
