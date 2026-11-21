#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { loadMinecraftClientConfig, MinecraftAgentClient } from 'agent-mc-world';
import { startMcpStdio } from 'agent-mc-world/mcp/stdio';
import { startMineflayerDevice } from './mineflayer-device.mjs';

await startMcpStdio(async (path, log) => {
  const options = loadMinecraftClientConfig(path);
  const binding = JSON.parse(readFileSync(path, 'utf8')).bodyHandoffDevice;
  if (!binding || options.cfg.provider === 'java-client') throw Error('A private Mineflayer device binding is required');
  const device = await startMineflayerDevice({
    endpoint: binding.endpoint, token: binding.token, characterId: binding.characterId,
    createRuntime: bodyHandoff => new MinecraftAgentClient({ ...options, bodyHandoff, log,
      agentName: options.cfg.username, modelFacts: { model: () => '',
        accepts: mime => options.acceptsImages && mime.startsWith('image/'), contextWindow: () => undefined } }),
    onStop: () => log.warn('Managed player-device authorization ended'),
  });
  return { runtime: device.runtime, metricsPort: options.metricsPort, consolePort: options.consolePort,
    operatorBinding: options.operatorBinding, close: device.close };
}, 'minecraft-agent-device-stdio');
