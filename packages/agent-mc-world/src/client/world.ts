import { fileURLToPath } from 'node:url';
import { MinecraftWorldProxy } from '../../core/proxy.ts';
import type { MinecraftWorldOptions } from '../../core/world.ts';
import type { ToolDef, World, WorldHost, WorldRequestFacts } from './contracts.ts';
import { observeVisual } from './visual.ts';
import { createMinecraftChoiceTool } from './choice.ts';
import { minecraftLifeTool } from './life.ts';
import { MessageInbox, messageInboxHost, messageInboxFacts } from './message-inbox.ts';
import { worldIdentityOf } from '../../core/server-config.ts';
import { withToolHelp } from './tool-help.ts';

type EnginePort = World & { requestFacts?(): WorldRequestFacts | null; publishAgentActivity?(value: unknown): void };
/** Generic game facade. No Qiandengji command rewriting, catalog, identity or progress policy. */
export class MinecraftClientWorld implements World {
  readonly id: string = 'minecraft';
  private host: WorldHost | null = null;
  private readonly engine: EnginePort;
  private readonly messages: MessageInbox;
  private readonly choice = createMinecraftChoiceTool(() => this.host, () => this.requestFacts(), () => this.choiceProvider());
  /** Adapter-owned saved connection ID; default inherits the host. No endpoint or credential resolution here. */
  protected choiceProvider(): string | undefined { return undefined; }
  /** A naming adapter may change this hint without rewriting quoted player text. */
  protected messageQueryName(): string { return 'mc_messages'; }
  constructor(options: MinecraftWorldOptions, engine?: EnginePort) {
    this.engine = engine ?? new MinecraftWorldProxy(options);
    this.messages = new MessageInbox(JSON.stringify({
      realm: worldIdentityOf(options.cfg.local.serverDir, `${options.cfg.host}:${options.cfg.port}`),
      account: `${options.cfg.auth ?? 'offline'}:${options.cfg.username}`, agent: options.botName ?? options.cfg.username,
    }), options.dataDir);
  }
  envPromptVars() { return this.engine.envPromptVars(); }
  publishAgentActivity(value: unknown): void { this.engine.publishAgentActivity?.(value); }
  requestFacts() { return messageInboxFacts(this.engine.requestFacts?.() ?? null, this.messages, this.messageQueryName()); }
  tools(): ToolDef[] {
    return withToolHelp([...this.engine.tools().map((tool): ToolDef => tool.name !== 'mc_visual' ? tool : { ...tool,
      description: 'Observe the current Minecraft scene. Image-capable hosts receive the real screenshot; otherwise return timestamped game facts. No independent vision model is required. This does not move the body or establish unseen geometry.',
      handler: (args, ctx) => observeVisual(tool, args, ctx, this.host, () => this.requestFacts(), false, 'mc'),
    }), this.messages.tool(), this.choice, minecraftLifeTool()]);
  }
  console() {
    const base = this.engine.console?.();
    return { ...base, panels: base?.panels?.filter(panel => ['connection', 'mount', 'skin', 'log'].includes(panel.id)), promptDocs: [{ key: 'minecraft.client.environment', title: 'Minecraft client',
      description: 'Game execution and observation ports for the connected Agent.', role: 'envPrompt' as const,
      path: fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)) }] };
  }
  async start(host: WorldHost) {
    this.host = host;
    try { await this.engine.start(messageInboxHost(host, this.messages)); } catch (error) { this.host = null; throw error; }
  }
  stop() { this.host = null; return this.engine.stop(); }
  onTurnEnded() { return this.engine.onTurnEnded?.(); }
}
