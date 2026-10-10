// Offline Mineflayer entry. Paper itself stays on loopback. Registered Agent
// and Eye login names are bound to ingress IPs before private UI is mirrored.
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { eyeLoginAllowed } from './agent-eye-names.mjs';

const listenHost = process.env.AGENT_GATEWAY_LISTEN_HOST || '192.168.3.163';
const listenPort = Number(process.env.AGENT_GATEWAY_LISTEN_PORT || 25565);
const backendHost = process.env.AGENT_GATEWAY_BACKEND_HOST || '127.0.0.1';
const backendPort = Number(process.env.AGENT_GATEWAY_BACKEND_PORT || 25565);
const controlHost = '127.0.0.1';
const controlPort = Number(process.env.AGENT_GATEWAY_CONTROL_PORT || 25577);
let rejected = 0;
let reservedRejected = 0;
let identityRejected = 0;
const opsFile = process.env.AGENT_GATEWAY_OPS_FILE || 'E:/MC/server/ops.json';
const pairsFile = process.env.AGENT_GATEWAY_PAIRS_FILE || 'E:/MC/ops/agent-eye-pairs.json';
const accessFile = process.env.AGENT_GATEWAY_ACCESS_FILE || 'E:/MC/ops/agent-gateway-access.json';

function reservedName(name) {
  if (name.toLowerCase() === 'goddess' || name.startsWith('.')) return true;
  // Read on each login so RCON OP changes take effect without gateway reload.
  const ops = JSON.parse(readFileSync(opsFile, 'utf8'));
  if (!Array.isArray(ops)) throw new Error('invalid ops list');
  return ops.some(entry => entry.name?.toLowerCase() === name.toLowerCase());
}

function normalizedIp(address) {
  return address?.startsWith('::ffff:') ? address.slice(7) : address;
}

function loginAllowed(name, address) {
  const registry = JSON.parse(readFileSync(pairsFile, 'utf8'));
  const access = JSON.parse(readFileSync(accessFile, 'utf8'));
  return eyeLoginAllowed(registry, access, name, normalizedIp(address));
}

// Inspect the cleartext login name before forwarding an offline-mode connection.
// Status pings still pass through unchanged. The backend sees all gateway clients
// as 127.0.0.1, so it cannot distinguish a LAN name spoof on its own.
function varInt(bytes, at) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (at + i >= bytes.length) return null;
    const octet = bytes[at + i];
    value += (octet & 0x7f) * 2 ** (7 * i);
    if (!(octet & 0x80)) return { value, at: at + i + 1 };
  }
  throw new Error('oversized VarInt');
}

function packet(bytes, at) {
  const size = varInt(bytes, at);
  if (!size) return null;
  if (size.value > 4096) throw new Error('oversized packet');
  const end = size.at + size.value;
  if (bytes.length < end) return null;
  return { at: size.at, end };
}

function string(bytes, at, end, max) {
  const size = varInt(bytes, at);
  if (!size) throw new Error('missing string length');
  if (size.value > max || size.at + size.value > end) throw new Error('invalid string length');
  return { value: bytes.toString('utf8', size.at, size.at + size.value), at: size.at + size.value };
}

function decision(bytes, address) {
  // Old status ping (0xfe) has no modern handshake.
  if (bytes[0] === 0xfe) return 'allow';
  const handshake = packet(bytes, 0);
  if (!handshake) return null;
  let field = varInt(bytes, handshake.at);
  if (!field || field.value !== 0) throw new Error('expected handshake');
  field = varInt(bytes, field.at); // protocol version
  if (!field) throw new Error('missing protocol version');
  const host = string(bytes, field.at, handshake.end, 255);
  if (host.at + 2 > handshake.end) throw new Error('missing port');
  const state = varInt(bytes, host.at + 2);
  if (!state || state.at !== handshake.end) throw new Error('invalid handshake state');
  if (state.value === 1) return 'allow';
  if (state.value !== 2) throw new Error('unsupported handshake state');

  const login = packet(bytes, handshake.end);
  if (!login) return null;
  const id = varInt(bytes, login.at);
  if (!id || id.value !== 0) throw new Error('expected login start');
  const name = string(bytes, id.at, login.end, 16);
  if (reservedName(name.value)) return 'reject-reserved';
  if (!loginAllowed(name.value, address)) return 'reject-identity';
  return 'allow';
}

function allowed(address) {
  const ip = normalizedIp(address);
  if (net.isIP(ip) !== 4) return false;
  // The live gateway has allowed WAN Mineflayer clients since 2026-09-30.
  // Keep that behavior; registered Agent/Eye names have their own IP gate.
  if (process.env.AGENT_GATEWAY_ALLOW_WAN !== '0') return true;
  const octets = ip.split('.').map(Number);
  return octets[0] === 192 && octets[1] === 168 && octets[2] === 3 && octets[3] > 0 && octets[3] < 255;
}

const gateway = net.createServer({ pauseOnConnect: true }, client => {
  if (!allowed(client.remoteAddress)) {
    rejected++;
    client.destroy();
    return;
  }
  let pending = Buffer.alloc(0);
  const timer = setTimeout(() => client.destroy(), 10_000);
  const inspect = chunk => {
    pending = Buffer.concat([pending, chunk]);
    if (pending.length > 8192) { client.destroy(); return; }
    let result;
    try { result = decision(pending, client.remoteAddress); }
    catch { client.destroy(); return; }
    if (result === null) return;
    clearTimeout(timer);
    client.pause();
    client.off('data', inspect);
    if (result === 'reject-reserved') {
      reservedRejected++;
      client.destroy();
      return;
    }
    if (result === 'reject-identity') {
      identityRejected++;
      client.destroy();
      return;
    }
    const backend = net.connect({ host: backendHost, port: backendPort });
    backend.setTimeout(30_000, () => backend.destroy());
    backend.once('connect', () => {
      backend.setTimeout(0);
      backend.write(pending);
      client.pipe(backend);
      backend.pipe(client);
      client.resume();
    });
    backend.on('error', () => client.destroy());
    client.on('error', () => backend.destroy());
    backend.on('close', () => client.destroy());
    client.on('close', () => backend.destroy());
  };
  client.on('data', inspect);
  client.on('error', () => {});
  client.on('close', () => clearTimeout(timer));
  client.resume();
});

gateway.maxConnections = 40;
gateway.on('error', error => {
  console.error(`Agent LAN gateway failed: ${error.message}`);
  process.exitCode = 1;
});
gateway.listen(listenPort, listenHost, () => {
  console.log(`Agent LAN gateway listening on ${listenHost}:${listenPort}; backend ${backendHost}:${backendPort}`);
});
// Read-only local identity endpoint lets interactive maintenance verify a
// Session 0 gateway when Windows hides its executable path and command line.
const control = net.createServer(socket => {
  if (socket.remoteAddress !== controlHost && socket.remoteAddress !== '::ffff:127.0.0.1') {
    socket.destroy();
    return;
  }
  socket.end(`AGENT-GATEWAY-V1 ${process.pid}\n`);
});
control.on('error', error => {
  console.error(`Agent LAN gateway control failed: ${error.message}`);
  process.exit(1);
});
control.listen(controlPort, controlHost);
setInterval(() => {
  if (rejected || reservedRejected || identityRejected) {
    console.log(`Rejected ${rejected} network, ${reservedRejected} reserved-name and ${identityRejected} Agent/Eye identity connections in the last minute`);
    rejected = 0;
    reservedRejected = 0;
    identityRejected = 0;
  }
}, 60_000).unref();
