import { identity, keyOf } from './protocol.mjs';
import { setTimeout as wait } from 'node:timers/promises';

const playerProof = (body, state, reason) => ({
  state, bodyId: body.bodyId, playerUuid: body.playerUuid, ...(reason ? { reason } : {}),
});

/** Assemble a same-player route from the existing authorized desktop and the
 * real signed native bootstrap. An unregistered player is never resolved by name. */
export function originalPlayerHandoffs({ registrations, clientFor, roleFor, runtimeFor, bootstrap }) {
  const exactRole = (body, { characterId }) => {
    const role = identity(roleFor(characterId));
    if (role.roleUuid !== body.playerUuid) throw new Error('Player handoff UUID mismatch');
    return role;
  };
  const witness = {
    arm(body, cursor) { return bootstrap.armPlayer(exactRole(body, cursor), cursor); },
    read(body, cursor) { return bootstrap.playerState(exactRole(body, cursor), cursor); },
  };
  return {
    registrations,
    numen: { roleFor, runtimeFor },
    adapters: ({ handoff }) => ({
      mineflayer: mineflayerHandoffAdapter({
        clientFor: (characterId, playerUuid, context) => clientFor(characterId, playerUuid, { ...context, handoff }),
        witness,
      }),
    }),
  };
}

// Use the already authenticated SDK client and a separate game-side observer.
// A disconnected client alone is not evidence that the server saved a player.
export function mineflayerHandoffAdapter({ clientFor, playerState, witness, witnessTimeoutMs = 3500 }) {
  if (!witness && typeof playerState !== 'function') throw new Error('Original player save confirmation required');
  const client = (context, binding, intent, generation = context.generation) =>
    clientFor(context.characterId, binding.playerUuid, { generation, intent });
  const cursor = ({ characterId, operationId, generation }, expect) =>
    ({ characterId, requestId: operationId, generation, expect });
  const sample = (player, position) => witness
    ? witness.read(player, position)
    : playerState(player.playerUuid, position);
  async function verified(player, position, check) {
    const until = Date.now() + witnessTimeoutMs;
    while (true) {
      const row = await sample(player, position);
      if (row?.uuid === player.playerUuid && check(row)) return true;
      if (!witness || Date.now() >= until || ['expired','conflict'].includes(row?.state) ||
          (row?.uuid && row.uuid !== player.playerUuid)) return false;
      await wait(80);
    }
  }
  const present = (port, position, challenge) => {
    if (!challenge?.nonce) throw new Error('Original player connection challenge unavailable');
    return port.witnessBodyHandoff({ requestId: position.requestId, generation: position.generation, nonce: challenge.nonce });
  };
  return {
    async preflight(context) {
      const port = await client(context, context.target, 'preflight', context.generation + 1);
      return !!port && await port.readyForHandoff(context.operationId, context.generation + 1) === true;
    },
    async release(context) {
      const player = context.source;
      const port = await client(context, player, 'release');
      if (!port) return playerProof(player, 'unknown');
      const position = cursor(context, 'saved');
      if (witness) {
        const challenge = await witness.arm(player, position);
        await present(port, position, challenge);
        if (!await verified(player, position, row => row.online === true && row.witnessed === true)) {
          return playerProof(player, 'unknown');
        }
      }
      const local = await port.releaseForBodyHandoff({ requestId: context.operationId, generation: context.generation });
      if (local?.state === 'blocked') return playerProof(player, 'blocked');
      if (local?.state !== 'disconnected') return playerProof(player, 'unknown');
      const confirmed = await verified(player, position, row => row.online === false && row.saved === true);
      return playerProof(player, confirmed ? 'released' : 'unknown');
    },
    async acquire(context) {
      const player = context.target;
      const port = await client(context, player, 'acquire');
      const position = cursor(context, 'client');
      const challenge = witness && await witness.arm(player, position);
      const local = await port?.connectForBodyHandoff(context.operationId);
      if (local?.state !== 'connected' || local.playerUuid !== player.playerUuid) return playerProof(player, 'unknown');
      if (witness) await present(port, position, challenge);
      const confirmed = await verified(player, position, row => row.online === true && row.kind === 'mineflayer'
        && (!witness || row.witnessed === true));
      return playerProof(player, confirmed ? 'acquired' : 'unknown');
    },
    async complete(context) {
      const port = await client(context, context.target, 'acquire');
      await port?.refreshBodyHandoff(context.operationId);
    },
    async blocked(context) {
      const port = await client(context, context.source, 'release');
      await port?.refreshBodyHandoff(context.operationId);
    },
  };
}

// Both adapters retain the same original playerdata. A release is only
// acknowledged after the original connection can no longer edit that record.
export function numenHandoffAdapter({ hosting, roleFor, runtimeFor = () => null }) {
  const role = (context, body) => {
    const selected = identity(roleFor(context.characterId));
    if (selected.roleUuid !== body.playerUuid) throw new Error('Numen handoff UUID mismatch');
    return selected;
  };
  return {
    async preflight(context) {
      const selected = role(context, context.target);
      const row = hosting.store.get(keyOf(selected));
      if (row && (row.state !== 'detached' || hosting.store.unknown(row.id))) return false;
      const runtime = runtimeFor(context.characterId);
      if (!runtime) return false;
      hosting.profiles?.require(selected, 'harness', runtime);
      return true;
    },
    async release(context) {
      const selected = role(context, context.source);
      const row = hosting.owned(selected);
      if (row.state === 'ready' && hosting.store.unknown(row.id)) return playerProof(context.source, 'blocked');
      if (row.state !== 'ready') return playerProof(context.source, 'unknown');
      const released = await hosting.release(selected, { handoff: true });
      return playerProof(context.source, released.state === 'detached' ? 'released' : 'unknown');
    },
    async acquire(context) {
      const selected = role(context, context.target);
      const attached = await hosting.attach(selected, { handoff: true });
      if (attached.state !== 'ready' || attached.mode !== 'paused') return playerProof(context.target, 'unknown');
      const active = await hosting.switch(selected, 'harness', {
        runtime: runtimeFor(context.characterId), handoff: true,
      });
      return playerProof(context.target, active.state === 'ready' && active.mode === 'harness' ? 'acquired' : 'unknown');
    },
  };
}
