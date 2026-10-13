import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Logger } from '../client/contracts.ts';
import { MinecraftAgentClient } from '../client/runtime.ts';
import { createMinecraftMcpServer } from './server.ts';
import { loadMinecraftClientConfig } from '../client/config-file.ts';
import { serveAgentMetrics } from '../client/metrics.ts';
import { serveClientConsole } from '../client/console-server.ts';

function logger(area: string): Logger {
  const emit: Logger['emit'] = (level, msg, options) => process.stderr.write(JSON.stringify({ level, area, msg, ...options }) + '\n');
  return { emit, child: name => logger(`${area}.${name}`),
    trace: (msg, data) => emit('trace', msg, { data }), debug: (msg, data) => emit('debug', msg, { data }),
    info: (msg, data) => emit('info', msg, { data }), warn: (msg, data) => emit('warn', msg, { data }),
    error: (msg, data) => emit('error', msg, { data }) };
}
export interface McStdioRuntime { runtime: MinecraftAgentClient; metricsPort: number; consolePort?: number }
export type McStdioFactory = (configPath: string, log: Logger) => McStdioRuntime;
const nativeClient: McStdioFactory = (path, log) => {
  const options = loadMinecraftClientConfig(path);
  return { metricsPort: options.metricsPort, consolePort: options.consolePort, runtime: new MinecraftAgentClient({ ...options, agentName: options.cfg.username, log,
    modelFacts: { model: () => '', accepts: mime => options.acceptsImages && mime.startsWith('image/'), contextWindow: () => undefined } }) };
};
/** Integrations may supply an assembly factory; core transport never imports them. */
export async function startMcpStdio(factory: McStdioFactory = nativeClient, command = 'minecraft-agent-mcp'): Promise<void> {
const configPath = process.argv[2];
if (!configPath || process.argv.length !== 3) throw new Error(`Usage: ${command} <private-config.json>`);
const { runtime, metricsPort, consolePort } = factory(configPath, logger(command));
const manifest = JSON.parse(readFileSync(createRequire(import.meta.url).resolve('agent-mc-world/package.json'), 'utf8'));
const server = createMinecraftMcpServer(runtime, manifest.version);
let operator: Awaited<ReturnType<typeof serveClientConsole>> | null = null;
let monitor: Awaited<ReturnType<typeof serveAgentMetrics>> | null = null;
let closing: Promise<void> | undefined;
const onSignal = () => { void close(); };
const close = () => closing ??= runtime.disconnect().finally(async () => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.removeListener(signal, onSignal);
  await Promise.allSettled([monitor?.close(), operator?.close()]);
  await server.close();
});
server.onclose = () => { void close(); };
try {
  operator = consolePort ? await serveClientConsole(consolePort, runtime) : null;
  monitor = metricsPort && metricsPort !== consolePort ? await serveAgentMetrics(metricsPort, () => runtime.metrics.snapshot(runtime.status().phase)) : null;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, onSignal);
  await server.connect(new StdioServerTransport());
} catch (error) { await close(); throw error; }
}
