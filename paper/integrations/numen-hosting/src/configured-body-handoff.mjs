import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { identity } from './protocol.mjs';
import { createDeviceHandoffBroker } from './device-handoff.mjs';
import { nativeEntityHandoffAdapters, nativeResidentHandoffClient } from './native-entity-handoff.mjs';
import { originalPlayerHandoffs } from './player-body-handoff.mjs';

// A missing private enrollment leaves the current game and login paths alone.
export async function configuredBodyHandoff(config, { bootstrap, bootstrapKey }) {
  if (!config || !Number.isInteger(config.custodyPort) || config.custodyPort < 1024 || config.custodyPort > 65535 ||
      typeof config.custodyKeyFile !== 'string' || !isAbsolute(config.custodyKeyFile) ||
      !Array.isArray(config.characters) || !config.characters.length || config.characters.length > 24) {
    throw new Error('Explicit private body custody enrollment is required');
  }
  const key = await readFile(config.custodyKeyFile);
  if (key.equals(bootstrapKey)) throw new Error('Native custody and Numen bootstrap must use different keys');
  const custodyProvider = nativeResidentHandoffClient({
    endpoint: `http://127.0.0.1:${config.custodyPort}/v1/native-resident-handoff`, controlKey: key,
  });
  const deviceBroker = config.devices === true ? createDeviceHandoffBroker() : null;
  const roles = new Map();
  const registrations = config.characters.map(({ numenRole, ...registration }) => {
    const { characterId, active, targets } = registration;
    const kinds = [active, ...targets];
    if (roles.has(characterId)) throw new Error('Repeated body custody enrollment');
    const player = kinds.find(body => body.playerUuid);
    if (kinds.some(body => body.kind === 'mineflayer') && !deviceBroker) {
      throw new Error('Mineflayer enrollment requires the owner-approved device transport');
    }
    if (player && (!numenRole || identity(numenRole).roleUuid !== player.playerUuid)) {
      throw new Error('Player custody requires an exact original player bootstrap identity');
    }
    roles.set(characterId, player ? identity(numenRole) : null);
    return registration;
  });
  const native = nativeEntityHandoffAdapters({ maid: custodyProvider, villager: custodyProvider });
  const player = originalPlayerHandoffs({
    registrations, bootstrap, roleFor: characterId => roles.get(characterId),
    runtimeFor: () => 'opencode', clientFor: deviceBroker?.clientFor,
  });
  return {
    registrations, custodyProvider, deviceBroker, numen: player.numen,
    adapters: context => deviceBroker ? { ...native, ...player.adapters(context) } : native,
  };
}
