// Reusable MC Server List Ping. Usage: node mcstatus.mjs <host> <port> [protocol] [ipv6]
// protocol 768 = 1.20.6, 767 = 1.21.x family (servers answer SLP regardless).
import net from 'node:net';

const [, , HOST, PORT_ARG, PROTO_ARG, V6_ARG] = process.argv;
const PORT = parseInt(PORT_ARG || '25565', 10);
const PROTOCOL = parseInt(PROTO_ARG || '768', 10);
const family = V6_ARG === 'v6' ? 6 : 4;

function varint(n) {
  const out = [];
  let x = n >>> 0;
  for (;;) {
    if (x < 0x80) { out.push(x); break; }
    out.push((x & 0x7f) | 0x80);
    x >>>= 7;
  }
  return Buffer.from(out);
}
const packet = (p) => Buffer.concat([varint(p.length), p]);
const str = (s) => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint(b.length), b]); };

const portBuf = Buffer.alloc(2); portBuf.writeUInt16BE(PORT);
const handshake = packet(Buffer.concat([varint(0x00), varint(PROTOCOL), str(HOST), portBuf, varint(1)]));
const statusReq = packet(varint(0x00));

class Reader {
  constructor() { this.buf = Buffer.alloc(0); }
  push(c) { this.buf = Buffer.concat([this.buf, c]); }
  tryStatus() {
    let off = 0;
    const readVarint = () => {
      let value = 0, shift = 0, cur = off;
      for (;;) {
        if (cur >= this.buf.length) return null;
        const b = this.buf[cur++];
        value |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
        if (shift > 28) throw new Error('varint too long');
      }
      off = cur;
      return value >>> 0;
    };
    const len = readVarint();
    if (len === null) return null;
    if (this.buf.length < off + len) return null;
    const id = readVarint();
    const slen = readVarint();
    const json = this.buf.subarray(off, off + slen).toString('utf8');
    return { id, json };
  }
}

const sock = new net.Socket();
const r = new Reader();
const to = setTimeout(() => { console.log('TIMEOUT'); process.exit(3); }, 8000);
sock.on('data', (c) => {
  r.push(c);
  let res;
  try { res = r.tryStatus(); } catch (e) { console.log('PARSE ' + e.message); process.exit(3); }
  if (!res) return;
  clearTimeout(to);
  const d = JSON.parse(res.json);
  const desc = typeof d.description === 'string' ? d.description : JSON.stringify(d.description);
  console.log(`OK ${HOST}:${PORT} | ${d.version.name} (proto ${d.version.protocol}) | ${desc} | online ${d.players.online}/${d.players.max} ${JSON.stringify((d.players.sample || []).map((p) => p.name))}`);
  process.exit(0);
});
sock.on('error', (e) => { clearTimeout(to); console.log(`ERR ${HOST}:${PORT} ${e.code || ''} ${e.message}`); process.exit(2); });
sock.connect(PORT, HOST, () => { sock.write(handshake); sock.write(statusReq); });
