import { inflateSync } from 'node:zlib';

const maxFrame = 1024 * 1024;

function varInt(bytes, offset = 0) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset + i >= bytes.length) return null;
    const byte = bytes[offset + i];
    value += (byte & 0x7f) * 2 ** (7 * i);
    if (!(byte & 0x80)) return { value, offset: offset + i + 1 };
  }
  throw new Error('Invalid login VarInt');
}

// Observe only backend login frames. Forwarding is untouched, and this listener
// is removed at Login Success so configuration/chunk traffic is never inspected.
// A status request, failed login or unfinished handshake cannot seed an Agent.
export function watchLoginSuccess(onSuccess) {
  let pending = Buffer.alloc(0), compression = false, finished = false;
  return chunk => {
    if (finished) return true;
    try {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length) {
        const frame = varInt(pending);
        if (!frame) break;
        if (frame.value < 1 || frame.value > maxFrame) throw new Error('Invalid login frame');
        const end = frame.offset + frame.value;
        if (end > pending.length) break;
        let payload = pending.subarray(frame.offset, end);
        pending = pending.subarray(end);
        if (compression) {
          const length = varInt(payload);
          if (!length || length.value > maxFrame) throw new Error('Invalid compressed login');
          payload = payload.subarray(length.offset);
          if (length.value) {
            payload = inflateSync(payload, { maxOutputLength: maxFrame });
            if (payload.length !== length.value) throw new Error('Login length mismatch');
          }
        }
        const id = varInt(payload);
        if (!id) throw new Error('Missing login packet id');
        if (id.value === 2) {
          finished = true;
          onSuccess();
          return true;
        }
        if (id.value === 0 || id.value === 1) {
          finished = true; // Disconnect or encryption: no confirmed offline session.
          return true;
        }
        if (id.value === 3) {
          const threshold = varInt(payload, id.offset);
          if (compression || !threshold || threshold.value > maxFrame) throw new Error('Invalid compression threshold');
          compression = true;
        }
      }
      if (pending.length > maxFrame + 5) throw new Error('Oversized login buffer');
    } catch {
      // Unknown/malformed framing cannot grant access; it also cannot interrupt
      // the user's original stream or crash the gateway.
      finished = true;
    }
    return finished;
  };
}
