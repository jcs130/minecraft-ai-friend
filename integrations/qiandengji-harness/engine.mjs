import { TacticalMinecraftWorld } from 'agent-mc-world/tactics';
import { Bridge } from 'agent-mc-world/extension';
import { observeQiandengji } from './protocol.mjs';
import { pauseDuringConfiguration } from './configuration.mjs';
import { STATE_TOOL, GUIDE } from './contract.mjs';

class QiandengjiEngine extends TacticalMinecraftWorld {
  observer = null;
  createBridge(options) {
    const onBotCreated = options.onBotCreated;
    return new Bridge({ ...options, onBotCreated: bot => {
      pauseDuringConfiguration(bot);
      onBotCreated?.(bot);
    } });
  }
  attachExtension(bot) {
    this.observer?.close();
    this.observer = observeQiandengji(bot);
  }
  disposeExtension() { this.observer?.close(); this.observer = null; super.disposeExtension(); }
  extensionTools() {
    return [...super.extensionTools(), { ...STATE_TOOL, handler: args => {
      if (args.action === 'guide') return { text: GUIDE };
      return { text: JSON.stringify(this.bridge?.connected && this.observer
        ? this.observer.snapshot() : { available: false, reason: 'body_not_authenticated_or_offline' }) };
    } }];
  }
}
export const createEngine = options => new QiandengjiEngine(options);
