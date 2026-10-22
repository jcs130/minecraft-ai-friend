import net from 'node:net';

const varint = n => {
  const out = [];
  for (let value = n >>> 0; ; value >>>= 7) {
    if (value < 128) { out.push(value); break; }
    out.push((value & 127) | 128);
  }
  return Buffer.from(out);
};
const packet = value => Buffer.concat([varint(value.length), value]);
const string = value => { const bytes = Buffer.from(value); return Buffer.concat([varint(bytes.length), bytes]); };

export function readVarint(buffer, offset = 0) {
  let value = 0;
  for (let index = 0; index < 5; index++) {
    if (offset + index >= buffer.length) return null;
    const byte = buffer[offset + index];
    if (index === 4 && byte > 15) throw new Error('Invalid varint');
    value |= (byte & 127) << (index * 7);
    if (!(byte & 128)) return { value: value >>> 0, offset: offset + index + 1 };
  }
  throw new Error('Oversized varint');
}

export function pingMinecraft(host, port, timeout = 2500) {
  return new Promise(resolve => {
    const started = performance.now();
    const socket = new net.Socket();
    let buffer = Buffer.alloc(0);
    let finished = false;
    const finish = result => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve({ ...result, observedAt: new Date().toISOString(), source: 'minecraft.server-list-ping' });
    };
    socket.setTimeout(timeout, () => finish({ online: null, unavailableReason: '服务器未在时限内响应' }));
    socket.on('error', () => finish({ online: null, unavailableReason: '暂时无法连接服务器' }));
    socket.on('close', () => finish({ online: null, unavailableReason: '服务器状态响应不完整' }));
    socket.on('data', chunk => {
      try {
        if (buffer.length + chunk.length > 1024 * 1024) throw new Error('Status too large');
        buffer = Buffer.concat([buffer, chunk]);
        const frame = readVarint(buffer);
        if (!frame) return;
        if (frame.value > 1024 * 1024) throw new Error('Status frame too large');
        if (buffer.length < frame.offset + frame.value) return;
        const id = readVarint(buffer, frame.offset);
        const length = id && readVarint(buffer, id.offset);
        if (!id || id.value !== 0 || !length || length.offset + length.value !== frame.offset + frame.value) throw new Error('Invalid status');
        const data = JSON.parse(buffer.subarray(length.offset, length.offset + length.value).toString('utf8'));
        finish({ online: true, version: data.version?.name || null, protocol: data.version?.protocol ?? null,
          playersOnline: Number.isInteger(data.players?.online) ? data.players.online : null,
          playersMax: Number.isInteger(data.players?.max) ? data.players.max : null,
          sample: Array.isArray(data.players?.sample) ? data.players.sample.filter(p => typeof p.name === 'string').map(p => ({ name: p.name, uuid: p.id || null })) : [],
          latencyMs: Math.round(performance.now() - started), description: data.description });
      } catch { finish({ online: null, unavailableReason: '无法解析服务器状态响应' }); }
    });
    socket.connect(port, host, () => {
      const portBytes = Buffer.alloc(2); portBytes.writeUInt16BE(port);
      socket.write(packet(Buffer.concat([varint(0), varint(766), string(host), portBytes, varint(1)])));
      socket.write(packet(varint(0)));
    });
  });
}
