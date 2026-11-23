import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { managedRuntime } from './managed-runtime.mjs';

const binding = JSON.parse(readFileSync(process.argv[2], 'utf8')).bodyHandoffDevice;
const require = createRequire(resolve(binding.packageDirectory, 'package.json'));
const load = name => import(pathToFileURL(require.resolve(name)).href);
const { startMcpStdio } = await load('agent-mc-world/mcp/stdio');
const { MinecraftAgentClient, loadMinecraftClientConfig } = await load('agent-mc-world/client');

await startMcpStdio((path, log) => {
  const options = loadMinecraftClientConfig(path);
  return managedRuntime(binding, options, bodyHandoff => new MinecraftAgentClient({ ...options, bodyHandoff, log,
    agentName: options.cfg.username, modelFacts: { model: () => '',
      accepts: mime => options.acceptsImages && mime.startsWith('image/'), contextWindow: () => undefined } }), log);
}, 'minecraft-managed-device-mcp');
