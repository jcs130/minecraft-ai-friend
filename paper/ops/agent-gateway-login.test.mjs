import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { watchLoginSuccess } from './agent-gateway-login.mjs';

function vi(value) {
  const bytes = [];
  do { bytes.push((value & 127) | (value > 127 ? 128 : 0)); value >>>= 7; } while (value);
  return Buffer.from(bytes);
}
const frame = bytes => Buffer.concat([vi(bytes.length), bytes]);
const success = Buffer.concat([vi(2), Buffer.alloc(16), vi(4), Buffer.from('Neko'), vi(0)]);

test('backend login success survives fragmented, compressed and uncompressed frames, once only', () => {
  for (const compression of ['none', 'small', 'deflated']) {
    let calls = 0;
    const observe = watchLoginSuccess(() => calls++);
    const payload = compression === 'none' ? success : compression === 'small'
      ? Buffer.concat([vi(0), success]) : Buffer.concat([vi(success.length), deflateSync(success)]);
    const bytes = Buffer.concat([
      ...(compression === 'none' ? [] : [frame(Buffer.from([3, 0]))]),
      frame(payload), Buffer.from([255, 255]) // Following play/configuration data is ignored.
    ]);
    for (const byte of bytes) observe(Buffer.from([byte]));
    observe(frame(success));
    assert.equal(calls, 1, compression);
  }
});

test('failed, encrypted, truncated and malformed logins cannot seed a session or throw', () => {
  for (const bytes of [frame(Buffer.from([0])), frame(Buffer.from([1])),
    Buffer.from([128]), Buffer.from([255,255,255,255,255,255]),
    Buffer.from([0]), Buffer.from([255,255,255,127]),
    Buffer.concat([frame(Buffer.from([3,0])), frame(Buffer.from([10,1,2,3]))])]) {
    let calls = 0;
    const observe = watchLoginSuccess(() => calls++);
    assert.doesNotThrow(() => observe(bytes));
    assert.equal(calls, 0);
  }
});
