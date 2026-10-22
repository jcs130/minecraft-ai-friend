import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSecret } from '../skills/qiandengji-agent/scripts/private.mjs';

// This process only publishes an already-running local viewer. It cannot start
// a game client, change a controller, execute a command or run a model.
if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) throw Error('usage_node_publish_mc_spectator_absolute_private_config');
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
if (!path.isAbsolute(config.rendererDirectory ?? '') || !path.isAbsolute(config.tokenFile ?? '')) throw Error('spectator_paths_must_be_absolute');
const { startSpectatorPublisher } = await import(pathToFileURL(path.join(config.rendererDirectory, 'host/spectator-publisher.mjs')));
let stopping = false, publisher = null, wake = null, failures = 0;
const stop = () => { stopping = true; publisher?.close(); wake?.(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
try {
  while (!stopping) {
    let bytes;
    try {
      bytes = readSecret(config.tokenFile, config.tokenFormat ?? 'file');
      publisher = await startSpectatorPublisher({ sourceUrl: config.sourceUrl, portalUrl: config.portalUrl,
        channelId: config.channelId, token: bytes.toString('utf8') });
      bytes.fill(0); bytes = null; failures = 0;
      console.log(JSON.stringify({ phase: 'publishing', readOnly: true, playerUuid: publisher.state().playerUuid }));
      if (stopping) publisher.close();
      const result = await publisher.done;
      console.log(JSON.stringify({ phase: 'disconnected', reason: result.reason, readOnly: true }));
    } catch {
      // Native exceptions may contain URLs or payload fragments. Report a fixed
      // status; the caller can inspect private configuration locally.
      console.error(JSON.stringify({ phase: 'waiting', reason: 'source_or_authorization_unavailable', readOnly: true }));
    } finally { bytes?.fill(0); publisher?.close(); publisher = null; }
    if (!stopping) await new Promise(resolve => {
      const timer = setTimeout(resolve, Math.min(30000, 2000 * 2 ** Math.min(failures++, 4)));
      wake = () => { clearTimeout(timer); resolve(); };
    });
  }
} finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); publisher?.close(); }
