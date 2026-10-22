import { MinecraftAgentClient, loadMinecraftClientConfig } from 'agent-mc-world/client';
import { MinecraftClientWorld, MinecraftWorldProxy } from 'agent-mc-world/extension';
import { startMcpStdio } from 'agent-mc-world/mcp/stdio';
import { STATE_TOOL, GUIDE } from './contract.mjs';

class QiandengjiClient extends MinecraftAgentClient {
  async environment() { return (await super.environment()) + '\n' + GUIDE; }
}
await startMcpStdio((path, log) => {
  const config = loadMinecraftClientConfig(path);
  const options = { ...config, log, agentName: config.cfg.username,
    modelFacts: { model: () => '', accepts: () => false, contextWindow: () => undefined } };
  const engine = new MinecraftWorldProxy({ cfg: config.cfg, dataDir: config.dataDir, timezone: config.timezone,
    botName: config.cfg.username, extension: { module: new URL('./engine.mjs', import.meta.url).href, tools: [STATE_TOOL] } });
  const world = new MinecraftClientWorld({ cfg: config.cfg, dataDir: config.dataDir, timezone: config.timezone,
    botName: config.cfg.username }, engine);
  return { runtime: new QiandengjiClient(options, world), metricsPort: config.metricsPort,
    consolePort: config.consolePort, instructions: GUIDE };
}, 'qiandengji-harness-mcp');
