import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

/** Release preflight: compare the deployed worker's actual bundle with the
 * portal artifact. Preparation never polls Minecraft or creates a game body.
 * Run after moving/freezing the renderer, before switching either service. */
export async function verifyTrustedSite(configFile, siteDirectory) {
  if (!path.isAbsolute(configFile ?? '') || !path.isAbsolute(siteDirectory ?? ''))
    throw Error('OBSERVER_SITE_ABSOLUTE_PATHS_REQUIRED');
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  if (!path.isAbsolute(config.workerModule ?? '')) throw Error('OBSERVER_SITE_WORKER_REQUIRED');
  const { createObservationWorker } = await import(pathToFileURL(config.workerModule).href);
  const manifest = JSON.parse(await fs.readFile(path.join(siteDirectory, 'spectator-site.json'), 'utf8'));
  if (manifest.protocol !== 'mc-spectator/1') throw Error('OBSERVER_SITE_PROTOCOL_MISMATCH');
  const worker = await createObservationWorker(config);
  let view;
  try {
    view = worker.prepared.attach({ playerUuid: randomUUID(), name: 'ObserverQA',
      registry: worker.registry, decodePacket: worker.decodePacket,
      simplifyNBT: worker.simplifyNBT, scope: 'scene' });
    const build = view.host.status().build;
    const files = {};
    for (const [name, key] of [['client.js', 'browserBundleSha256'], ['native-console.js', 'consoleBundleSha256']]) {
      const digest = createHash('sha256').update(await fs.readFile(path.join(siteDirectory, name))).digest('hex');
      if (digest !== build[key] || digest !== manifest.files?.[name]?.sha256)
        throw Error('OBSERVER_SITE_RUNTIME_BUNDLE_MISMATCH');
      files[name] = digest;
    }
    if (manifest.buildSource?.sourceSha256 !== build.buildSource?.sourceSha256)
      throw Error('OBSERVER_SITE_SOURCE_MISMATCH');
    return { passed: true, files, readOnly: true, gamePolls: 0, gameConnections: 0 };
  } finally {
    try { await view?.close(); } finally { await worker.close(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await verifyTrustedSite(process.argv[2], process.argv[3]))); }
  catch (error) {
    // Do not expose private paths, configuration or credentials from file errors.
    console.error(JSON.stringify({ passed: false, reason: /^OBSERVER_SITE_[A-Z_]+$/.test(error.message)
      ? error.message : 'OBSERVER_SITE_CHECK_FAILED' }));
    process.exitCode = 1;
  }
}
