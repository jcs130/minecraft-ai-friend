import { createRequire } from 'node:module';

// minecraft-data 3.112.0 erroneously includes the 1.21.2 customName field
// in protocol 766 potion_contents. Apply before the first client compiles its
// protocol. This changes only this process, never installed dependencies.
export function fix1206PotionProtocol(resolveMineflayer) {
  const require = createRequire(resolveMineflayer.resolve('mineflayer'));
  const data = require('minecraft-data')('1.20.6');
  if (data.version.version !== 766) throw new Error('unexpected 1.20.6 protocol');
  const fields = data.protocol.types.SlotComponent?.[1]?.find(f => f.name === 'data')
    ?.type?.[1]?.fields?.potion_contents?.[1];
  if (!Array.isArray(fields)) throw new Error('potion component schema unavailable');
  const names = fields.map(f => f.name).join(',');
  if (names === 'potionId,customColor,customEffects') return false;
  if (names !== 'potionId,customColor,customEffects,customName'
      || JSON.stringify(fields[3].type) !== '["option","string"]')
    throw new Error('unrecognized 1.20.6 potion schema');
  fields.splice(3, 1);
  return true;
}
