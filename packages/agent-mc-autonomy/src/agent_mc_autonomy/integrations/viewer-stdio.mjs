// Optional presentation assembly through the core's public extension ports.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const file = process.argv[2];
const viewer = JSON.parse(readFileSync(file, 'utf8')).viewerIntegration;
const require = createRequire(resolve(viewer.packageDirectory, 'package.json'));
const load = name => import(pathToFileURL(require.resolve(name)).href);
const { startMcpStdio } = await load('agent-mc-world/mcp/stdio');
const { MinecraftAgentClient, loadMinecraftClientConfig } = await load('agent-mc-world/client');
const { MinecraftClientWorld } = await load('agent-mc-world/extension');
const moduleUrl = new URL('./viewer-engine.mjs', import.meta.url);
moduleUrl.searchParams.set('package', viewer.packageDirectory);
await startMcpStdio((path, log) => {
  const options = loadMinecraftClientConfig(path);
  const world = new MinecraftClientWorld({ cfg: options.cfg, dataDir: options.dataDir, timezone: options.timezone,
    botName: options.cfg.username, extension: { module: moduleUrl.href, tools: [], config: viewer } });
  return { metricsPort: options.metricsPort, consolePort: options.consolePort,
    runtime: new MinecraftAgentClient({ ...options, log, agentName: options.cfg.username,
      modelFacts: { model: () => '', accepts: mime => options.acceptsImages && mime.startsWith('image/'), contextWindow: () => undefined } }, world) };
}, 'minecraft-viewer-mcp');
