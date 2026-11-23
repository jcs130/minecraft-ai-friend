import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
const validUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);
const validGeneration = value => Number.isSafeInteger(value) && value >= 1;

/**
 * Private transport for the existing desktop Minecraft login. This socket is
 * independent of the game connection and remains present while Numen drives.
 */
export async function startMineflayerDevice({
  endpoint, token, characterId, createRuntime, pollMs = 250, requestMs = 6000, onStop,
}) {
  let url;
  try { url = new URL(endpoint); } catch { throw Error('Invalid managed player-device endpoint'); }
  if (!(url.protocol === 'https:' || url.protocol === 'http:' && url.hostname === '127.0.0.1') ||
      url.username || url.password || url.hash || url.search ||
      !/^qdh_[a-zA-Z0-9_-]{43}$/.test(token) || !validId(characterId)) throw Error('Invalid managed player-device binding');
  const instanceId = randomUUID(), lifetime = new AbortController();

  async function submit(message) {
    const response = await fetch(url, {
      method: 'POST', redirect: 'error',
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(requestMs)]),
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ ...message, instanceId, characterId }),
    });
    const envelope = await response.json();
    if (!response.ok || !Object.hasOwn(envelope, 'value')) {
      const error = new Error('Managed player-device request was rejected');
      error.code = envelope.error;
      error.terminal = [401, 403].includes(response.status) ||
        ['DEVICE_INSTANCE_CONFLICT', 'BODY_HANDOFF_NOT_FOUND'].includes(envelope.error);
      throw error;
    }
    return envelope.value;
  }

  const initial = await submit({ op: 'hello' });
  const { playerUuid, generation } = initial;
  if (initial.characterId !== characterId || !validUuid(playerUuid) || !validGeneration(generation)) {
    throw Error('Managed player-device identity could not be verified');
  }
  const port = next => ({
    characterId, playerUuid, generation: next, witnessChannel: 'qiandengji:handoff',
    request(message) {
      if (message?.characterId !== characterId || !['current', 'lookup', 'controllerSwitch'].includes(message.op) ||
          message.op === 'controllerSwitch' && message.expectedGeneration !== next) throw Error('Invalid managed player request');
      return submit(message);
    },
  });
  const runtime = await createRuntime(port(generation));
  let activeGeneration = generation;

  async function execute({ action, requestId, generation, nonce }) {
    if (action === 'ready') {
      const ready = await runtime.prepareTargetBodyHandoff(port(generation), requestId);
      if (ready) activeGeneration = generation;
      return ready;
    }
    if (activeGeneration !== generation) throw Error('Invalid managed player-device generation');
    if (action === 'witness') {
      await runtime.witnessBodyHandoff({ requestId, generation, nonce });
      return null;
    }
    if (action === 'release') {
      const receipt = await submit({ op: 'lookup', requestId });
      if (receipt?.requestId !== requestId || receipt.generation !== generation || receipt.status !== 'switching' ||
          receipt.phase !== 'releasing' || receipt.activeKind !== 'mineflayer') {
        throw Error('Managed player-device release is no longer active');
      }
      return runtime.releaseForBodyHandoff({ requestId, generation });
    }
    if (action === 'connect') return runtime.connectForBodyHandoff(requestId);
    if (action === 'refresh') {
      await runtime.refreshBodyHandoff(requestId);
      return null;
    }
    throw Error('Invalid managed player-device command');
  }

  const polling = (async () => {
    let answer = null;
    try {
      while (!lifetime.signal.aborted) {
        try {
          if (answer) {
            const result = await submit(answer);
            if (result.accepted !== true) throw Error('Managed player-device answer was not confirmed');
            answer = null;
          }
          const { command } = await submit({ op: 'next' });
          if (command) {
            const { commandId, action, requestId, generation } = command;
            if (!validUuid(commandId) || !validId(requestId) || !validGeneration(generation)) {
              throw Error('Invalid managed player-device command');
            }
            answer = { op: 'answer', commandId, action, requestId, generation, ok: false };
            try {
              const result = await execute(command);
              answer = { ...answer, ok: true, result };
            } catch {
              // An unanswered effect is never executed twice. Send the original command receipt.
            }
          }
        } catch (error) {
          if (error.terminal) break;
          if (answer && ['DEVICE_REPLY_CLOSED', 'DEVICE_REPLY_MISMATCH', 'DEVICE_REPLY_CONFLICT'].includes(error.code)) answer = null;
        }
        await delay(pollMs, undefined, { signal: lifetime.signal, ref: false });
      }
    } finally {
      if (!lifetime.signal.aborted) {
        await runtime.disconnect();
        onStop?.();
      }
    }
  })().catch(error => {
    if (!lifetime.signal.aborted) onStop?.();
  });
  return { runtime, async close() { lifetime.abort(); await polling; } };
}
