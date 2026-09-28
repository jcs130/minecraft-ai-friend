// Loopback-only cross-session lifecycle control for the single Goddess bridge.
import { readFileSync } from 'node:fs';
import { createConnection } from 'node:net';

const action = process.argv[2];
if (!['status', 'stop'].includes(action)) throw new Error('Expected status or stop');
let request = action;
if (action === 'stop') {
  const state = JSON.parse(readFileSync('E:/MC/ops/goddess-bridge.control.json', 'utf8'));
  if (!/^[a-f0-9]{48}$/.test(state.token)) throw new Error('Invalid bridge control state');
  request += ` ${state.token}`;
}
const socket = createConnection({ host: '127.0.0.1', port: 25576 });
socket.setEncoding('utf8');
socket.setTimeout(3000);
socket.on('connect', () => socket.write(`${request}\n`));
socket.on('data', data => {
  const response = data.trim();
  if (action === 'status' && /^GODDESS-BRIDGE-V1 \d+$/.test(response)) {
    console.log(response);
    socket.end();
  } else if (action === 'stop' && response === 'STOPPING') {
    console.log(response);
    socket.end();
  } else {
    console.error('Unexpected Goddess bridge response');
    process.exitCode = 1;
    socket.destroy();
  }
});
socket.on('timeout', () => { console.error('Goddess bridge control timeout'); process.exitCode = 1; socket.destroy(); });
socket.on('error', error => { console.error(`Goddess bridge control: ${error.code ?? error.message}`); process.exitCode = 1; });
