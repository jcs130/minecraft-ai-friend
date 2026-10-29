import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Explicit local dependency, never inferred from chat, address or appearance. */
export async function serverEnginePort(config, bases) {
  if (!config?.module && !config?.sha256) return null;
  if (typeof config.module !== 'string' || !isAbsolute(config.module) || !/\.(?:mjs|js)$/.test(config.module)
      || !/^[a-f0-9]{64}$/.test(config.sha256 ?? '')) throw Error('Invalid explicit server engine port');
  const bytes = readFileSync(config.module);
  if (bytes.length > 8*1024*1024 || createHash('sha256').update(bytes).digest('hex') !== config.sha256) throw Error('Server engine hash mismatch');
  const port = await import(pathToFileURL(config.module).href);
  if (typeof port.createEngine !== 'function' || typeof port.EngineWorld !== 'function' || typeof port.EngineBridge !== 'function'
      || !Array.isArray(port.SERVER_TOOLS) || port.SERVER_TOOLS.some(t=>typeof t.name!=='string'||!/^mc_[a-z_]+$/.test(t.name))) throw Error('Unsupported server engine contract');
  if (bases && (!(port.EngineWorld.prototype instanceof bases.World) || !(port.EngineBridge.prototype instanceof bases.Bridge))) throw Error('Server engine/core contract mismatch');
  return { ...port, module: config.module, sha256: config.sha256 };
}
