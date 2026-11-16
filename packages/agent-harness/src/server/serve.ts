import { join, resolve } from 'node:path';
import { harnessConfigFromEnv, withAgentHarness, type AgentHarnessIntegration } from '../integration.ts';
import { loadAgentConfigs } from '../gateway/auth.ts';
import { startGateway, type GatewayServer } from '../gateway/server.ts';
import { createFakeWorld } from '../testing/fake-world.ts';

export interface HarnessServerOptions {
  env?: NodeJS.ProcessEnv;
  /** agent-mc-world private client config (same file as `minecraft-agent-mcp <config>`). */
  configPath?: string;
  /** Use the offline fake body instead of a Minecraft connection (demos/tests). */
  fakeBody?: boolean | { completeAfterMs?: number; username?: string };
  /** Data dir for the fake body (default ./.data/agent-harness-fake). */
  dataDir?: string;
  host?: string;
  port?: number;
  log?: (message: string, data?: Record<string, unknown>) => void;
}

export interface HarnessServer {
  gateway: GatewayServer;
  integration: AgentHarnessIntegration;
  /** The hosted MinecraftAgentClient (body). Not exposed to remote agents. */
  client: { tools(): Array<{ name: string }>; disconnect(): Promise<void> };
  fake: ReturnType<typeof createFakeWorld> | null;
  close(): Promise<void>;
}

const intEnv = (v: string | undefined, fallback: number) => (v && /^\d+$/.test(v) ? Number(v) : fallback);

/**
 * Server-hosted runtime: body (agent-mc-world) + harness (exclusive body owner) + message gateway.
 * Only started explicitly (CLI `serve` or this function); importing the package starts nothing.
 */
export async function startHarnessServer(options: HarnessServerOptions): Promise<HarnessServer> {
  const env = options.env ?? process.env;
  const log = options.log ?? (() => {});
  if (!options.configPath && !options.fakeBody) throw new Error('startHarnessServer needs configPath or fakeBody');
  // The hosted runtime always executes; exclusive body control is on unless AGENT_HARNESS_EXCLUSIVE=0.
  const base = harnessConfigFromEnv(env);
  const config = { ...base, enabled: true, execute: true, exclusive: env.AGENT_HARNESS_EXCLUSIVE === undefined ? true : base.exclusive };
  const agents = loadAgentConfigs(env);

  const world = await import('../../../agent-mc-world/src/client/index.ts');
  const logger = worldLogger(log);
  let clientOptions: ConstructorParameters<typeof world.MinecraftAgentClient>[0];
  let fake: ReturnType<typeof createFakeWorld> | null = null;
  if (options.fakeBody) {
    const f = typeof options.fakeBody === 'object' ? options.fakeBody : {};
    const username = f.username ?? env.AGENT_HARNESS_FAKE_USERNAME ?? 'HarnessBot';
    fake = createFakeWorld({ username, completeAfterMs: f.completeAfterMs ?? intEnv(env.AGENT_HARNESS_FAKE_TASK_MS, 300) });
    clientOptions = { dataDir: resolve(options.dataDir ?? join('.data', 'agent-harness-fake')), log: logger,
      cfg: { ...structuredClone(world.MINECRAFT_CLIENT_DEFAULTS), host: 'offline.invalid', username } };
  } else {
    const loaded = world.loadMinecraftClientConfig(options.configPath!);
    clientOptions = { cfg: loaded.cfg, dataDir: loaded.dataDir, timezone: loaded.timezone, agentName: loaded.cfg.username, log: logger,
      modelFacts: { model: () => '', accepts: () => false, contextWindow: () => undefined } };
  }

  const { options: wired, integration } = withAgentHarness(clientOptions, config, { log });
  if (!integration) throw new Error('harness integration was not created');
  const client = fake ? new world.MinecraftAgentClient(wired, fake.world as never) : new world.MinecraftAgentClient(wired);
  integration.attachClient(client);
  let gateway: GatewayServer | null = null;
  try {
    await client.connect();
    gateway = await startGateway({
      harness: integration.harness, agents, env, log,
      host: options.host ?? env.AGENT_HARNESS_GATEWAY_HOST ?? '127.0.0.1',
      port: options.port ?? intEnv(env.AGENT_HARNESS_GATEWAY_PORT, 8787),
      limits: { maxMessageBytes: intEnv(env.AGENT_HARNESS_GATEWAY_MAX_MESSAGE_BYTES, 64 * 1024) },
      allowedOrigins: (env.AGENT_HARNESS_GATEWAY_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),
      info: { execute: config.execute, exclusive: integration.exclusive },
    });
  } catch (error) {
    await client.disconnect().catch(() => {});
    await integration.close();
    throw error;
  }
  const gw = gateway;
  let closing: Promise<void> | null = null;
  return {
    gateway: gw, integration, client, fake,
    close: () => closing ??= (async () => {
      await gw.close();
      await client.disconnect().catch(() => {});
      await integration.close();
    })(),
  };
}

type LogFn = (message: string, data?: Record<string, unknown>) => void;
function worldLogger(log: LogFn, area = 'body'): import('../../../agent-mc-world/src/client/contracts.ts').Logger {
  const emit = (level: string, msg: string, options?: { data?: unknown }) => {
    if (level === 'warn' || level === 'error' || level === 'info') log(`[${area}] ${msg}`, options?.data && typeof options.data === 'object' ? options.data as Record<string, unknown> : undefined);
  };
  return { emit: emit as never, child: (name: string) => worldLogger(log, `${area}.${name}`),
    trace: () => {}, debug: () => {}, info: (m: string, d?: unknown) => emit('info', m, { data: d }),
    warn: (m: string, d?: unknown) => emit('warn', m, { data: d }), error: (m: string, d?: unknown) => emit('error', m, { data: d }) } as never;
}
