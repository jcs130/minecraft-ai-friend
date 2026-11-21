// Optional presentation assembly through the core's public extension ports.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serverEnginePort } from './server-engine-port.mjs';
import { managedRuntime } from './managed-runtime.mjs';

const file = process.argv[2];
const config = JSON.parse(readFileSync(file, 'utf8'));
const viewer = config.viewerIntegration;
const require = createRequire(resolve(viewer.packageDirectory, 'package.json'));
const load = name => import(pathToFileURL(require.resolve(name)).href);
const { startMcpStdio } = await load('agent-mc-world/mcp/stdio');
const { MinecraftAgentClient, loadMinecraftClientConfig } = await load('agent-mc-world/client');
const { MinecraftClientWorld } = await load('agent-mc-world/extension');
const moduleUrl = new URL('./viewer-engine.mjs', import.meta.url);
moduleUrl.searchParams.set('package', viewer.packageDirectory);
const serverEngine = await serverEnginePort(viewer.serverEngine);
if (serverEngine) { moduleUrl.searchParams.set('engine',serverEngine.module); moduleUrl.searchParams.set('engineSha256',serverEngine.sha256); }
await startMcpStdio((path, log) => {
  const options = loadMinecraftClientConfig(path);
  const world = new MinecraftClientWorld({ cfg: options.cfg, dataDir: options.dataDir, timezone: options.timezone,
    botName: options.cfg.username, extension: { module: moduleUrl.href, tools: serverEngine?.SERVER_TOOLS ?? [], config: viewer } });
  return managedRuntime(config.bodyHandoffDevice, options, bodyHandoff =>
    new MinecraftAgentClient({ ...options, bodyHandoff, log, agentName: options.cfg.username,
      modelFacts: { model: () => '', accepts: mime => options.acceptsImages && mime.startsWith('image/'), contextWindow: () => undefined } }, world), log);
}, 'minecraft-viewer-mcp');
