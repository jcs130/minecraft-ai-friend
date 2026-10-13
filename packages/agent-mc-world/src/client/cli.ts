import { loadMinecraftClientConfig } from './config-file.ts';
import { MinecraftAgentClient } from './runtime.ts';
import { serveClientConsole } from './console-server.ts';
import { nullLogger } from '../../core/support/runtime.mjs';

export async function startMinecraftClientConsole(): Promise<void> {
  if (process.argv.length !== 3) throw new Error('Usage: minecraft-agent-client <private-config.json>');
  const options = loadMinecraftClientConfig(process.argv[2]);
  const runtime = new MinecraftAgentClient({ ...options, log: nullLogger() });
  const console = await serveClientConsole(options.consolePort || 7796, runtime);
  process.stderr.write(`Minecraft connection console: ${console.url}\n`);
  let closing: Promise<void> | undefined;
  const close = () => closing ??= runtime.disconnect().finally(() => console.close());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void close(); });
}
