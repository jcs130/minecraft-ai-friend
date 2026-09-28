// Minimal Source RCON client (loopback) — used to inspect or gracefully stop
// the standalone server:  node E:\MC\probe\rcon.mjs "list"
//                        node E:\MC\probe\rcon.mjs "stop"   <- saves the world and exits
import net from 'node:net';
import { readFileSync } from 'node:fs';

const HOST = '127.0.0.1';
const PORT = 25575;
const PASSWORD = readFileSync('E:/MC/server/server.properties', 'utf8').match(/^rcon\.password=(.*)$/m)?.[1].trim();
if (!PASSWORD) throw new Error('RCON password is not configured');
const SERVERDATA_AUTH = 3, SERVERDATA_EXECCOMMAND = 2, SERVERDATA_RESPONSE_VALUE = 0;

function pkt(id, type, body) {
  const b = Buffer.from(body, 'utf8');
  const payload = 10 + b.length; // id(4) + type(4) + body + two nulls
  const out = Buffer.alloc(4 + payload);
  out.writeInt32LE(payload, 0); // size of everything after this field
  out.writeInt32LE(id, 4);
  out.writeInt32LE(type, 8);
  b.copy(out, 12);
  out[12 + b.length] = 0;
  out[13 + b.length] = 0;
  return out;
}

const cmd = process.argv[2] || 'list';
const sock = net.connect(PORT, HOST);
let nextId = 1;
let buf = Buffer.alloc(0);
const responses = [];
let authed = false;

const finish = (code, why) => {
  if (why) console.log(why);
  for (const r of responses) console.log(r.length ? r : '(empty response)');
  sock.destroy();
  process.exit(code);
};

sock.on('error', (e) => finish(2, 'RCON ERROR: ' + e.message));
sock.on('connect', () => {
  sock.write(pkt(nextId, SERVERDATA_AUTH, PASSWORD));
});
sock.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    if (buf.length < 12) return;
    const len = buf.readInt32LE(0);
    if (buf.length < 4 + len) return;
    const id = buf.readInt32LE(4);
    const type = buf.readInt32LE(8);
    const body = buf.subarray(12, 4 + len - 2).toString('utf8');
    buf = buf.subarray(4 + len);
    if (!authed) {
      if (id === -1) { finish(3, 'RCON AUTH FAILED'); return; }
      authed = true;
      console.log('auth ok');
      sock.write(pkt(nextId + 10, SERVERDATA_EXECCOMMAND, cmd));
      continue;
    }
    if (type === SERVERDATA_RESPONSE_VALUE && body === '') continue; // split-marker reply
    responses.push(body);
    finish(0, `> ${cmd}`);
    return;
  }
});
setTimeout(() => finish(4, 'RCON TIMEOUT (no response in 8s)'), 8000);
