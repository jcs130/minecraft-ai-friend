import { fileURLToPath } from 'node:url';
import { MinecraftWorldProxy } from '../../core/proxy.ts';
import type { MinecraftWorldOptions } from '../../core/world.ts';
import type { ToolDef, World, WorldHost, WorldRequestFacts } from './contracts.ts';
import { observeVisual } from './visual.ts';

type EnginePort = World & { requestFacts?(): WorldRequestFacts | null };
/** Generic game facade. No Qiandengji command rewriting, catalog, identity or progress policy. */
export class MinecraftClientWorld implements World {
  readonly id: string = 'minecraft';
  private host: WorldHost | null = null;
  private readonly engine: EnginePort;
  constructor(options: MinecraftWorldOptions, engine?: EnginePort) {
    this.engine = engine ?? new MinecraftWorldProxy(options);
  }
  envPromptVars() { return this.engine.envPromptVars(); }
  requestFacts() { return this.engine.requestFacts?.() ?? null; }
  tools(): ToolDef[] {
    return this.engine.tools().map(tool => tool.name !== 'mc_visual' ? tool : { ...tool,
      description: 'Observe the current Minecraft scene. Image-capable hosts receive the real screenshot; otherwise return timestamped game facts. No independent vision model is required. This does not move the body or establish unseen geometry.',
      handler: (args, ctx) => observeVisual(tool, args, ctx, this.host, () => this.requestFacts(), false, 'mc'),
    });
  }
  console() {
    const base = this.engine.console?.();
    return { ...base, panels: base?.panels?.filter(panel => ['connection', 'mount', 'skin', 'log'].includes(panel.id)), promptDocs: [{ key: 'minecraft.client.environment', title: 'Minecraft client',
      description: 'Game execution and observation ports for the connected Agent.', role: 'envPrompt' as const,
      path: fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)) }] };
  }
  async start(host: WorldHost) {
    this.host = host;
    try { await this.engine.start(host); } catch (error) { this.host = null; throw error; }
  }
  stop() { this.host = null; return this.engine.stop(); }
  onTurnEnded() { return this.engine.onTurnEnded?.(); }
}
