// Bedrock "Unconnected Ping" per wiki.bedrock.dev/servers/raknet:
//   0x01 | client alive time in ms (uint64) | Magic | client GUID
// Magic = 00ffff00fefefefefdfdfdfd12345678 (16 bytes)
// Reply = 0x1c Unconnected Pong with the MCPE;... string.
import dgram from 'node:dgram';

const targets = [];
for (let i = 2; i < process.argv.length; i += 2) {
  targets.push({ host: process.argv[i], port: parseInt(process.argv[i + 1], 10) });
}
if (!targets.length) targets.push({ host: '127.0.0.1', port: 19132 });

const MAGIC = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');
const time = Buffer.alloc(8); time.writeBigUInt64BE(BigInt(Date.now() % 1e15));
const guid = Buffer.from('123456789abcdef0', 'hex');
const ping = (id) => Buffer.concat([Buffer.from([id]), time, MAGIC, guid]);

const sock = dgram.createSocket('udp4');
let answered = 0;
sock.on('message', (m, rinfo) => {
  answered++;
  const id = m[0];
  let txt = '';
  for (let i = 0; i < m.length; i++) {
    if (m.subarray(i, i + 5).toString('latin1') === 'MCPE;') { txt = m.subarray(i).toString('utf8'); break; }
  }
  console.log(`REPLY ${rinfo.address}:${rinfo.port} id=0x${id.toString(16)} len=${m.length}`);
  console.log(`  raw: ${txt || m.toString('hex').slice(0, 120)}`);
  if (txt) {
    const p = txt.split(';');
    console.log(`  Edition=${p[0]} MOTD="${p[1]}" proto=${p[2]} ver=${p[3]} players=${p[4]}/${p[5]} name=${p[7]} mode=${p[8]} v4port=${p[11]} v6port=${p[12]}`);
  }
});

for (const t of targets) {
  for (const id of [0x01, 0x04]) {
    console.log(`-> ${t.host}:${t.port} ping id=0x${id.toString(16)} (${ping(id).length} B)`);
    sock.send(ping(id), t.port, t.host);
  }
}
setTimeout(() => { console.log(answered ? `answered=${answered}` : 'NO REPLY at all'); sock.close(); process.exit(0); }, 4000);
