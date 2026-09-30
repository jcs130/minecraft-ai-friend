// Read-only local gateway identity probe. Never opens a public listener.
import net from 'node:net';

const socket = net.connect({ host: '127.0.0.1', port: 25577 });
let reply = '';
socket.setTimeout(2000, () => socket.destroy(new Error('gateway control timed out')));
socket.on('data', chunk => {
  reply += chunk.toString('utf8');
  if (reply.length > 128) socket.destroy(new Error('gateway control reply too long'));
});
socket.on('end', () => {
  if (!/^AGENT-GATEWAY-V1 [1-9]\d*\n$/.test(reply)) {
    console.error('invalid gateway control reply');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(reply);
});
socket.on('error', error => {
  console.error(error.message);
  process.exitCode = 1;
});
