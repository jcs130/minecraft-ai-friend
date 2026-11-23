import { TacticalMinecraftWorld } from 'agent-mc-world/tactics';
import { Bridge } from 'agent-mc-world/extension';
import { readServerDisplay } from 'agent-mc-world/client';
import { matchesTangerine, tangerineConfigOverlay, TANGERINE_PROFILE } from './profile.mjs';
import { createTangerineRoute } from './route.mjs';
import { observeTangerine } from './observer.mjs';
import { applyVulcanPace } from './pace.mjs';
import { STATE_TOOL, GUIDE, PLUGINS, KNOWN_ISSUES } from './contract.mjs';

/** Bridge whose pathfinder movements keep the Vulcan clamps after every core retune. */
class TangerineBridge extends Bridge {
  applyTuning(bot, movements) {
    super.applyTuning(bot, movements);
    applyVulcanPace(movements);
  }
}

/**
 * 橘乡 server pack engine. Off for every other host unless `pack.force` is set.
 * pack: { force?, keepVersion?, autoMain?, acceptResourcePack?, vulcanPace? }
 */
export class TangerineEngine extends TacticalMinecraftWorld {
  constructor(options, pack = {}) {
    const active = matchesTangerine(options?.cfg, pack);
    // Mutate in place: the engine child applies later hot config to this same object.
    if (active && options?.cfg) Object.assign(options.cfg, tangerineConfigOverlay(options.cfg, pack));
    super(options);
    this.tangerine = { active, pack: { autoMain: true, acceptResourcePack: true, vulcanPace: true, ...pack } };
    this.tangerineRoute = null;
    this.tangerineObserver = null;
    this.tangerineTimer = null;
  }

  createBridge(options) {
    if (!this.tangerine?.active && !matchesTangerine(options?.cfg ?? this.cfg)) return super.createBridge(options);
    const vulcan = this.tangerine?.pack?.vulcanPace !== false;
    return vulcan ? new TangerineBridge(options) : super.createBridge(options);
  }

  attachExtension(bot) {
    super.attachExtension?.(bot);
    this.disposeTangerine();
    if (!this.tangerine.active) return;
    const log = (row) => { try { this.diag?.write?.({ lane: 'link', event: `tangerine.${row.event}`, msg: row.event, data: row }); } catch {} };
    this.tangerineObserver = observeTangerine(bot, { acceptResourcePack: this.tangerine.pack.acceptResourcePack !== false, onEvent: log });
    this.tangerineRoute = createTangerineRoute({
      rootLiterals: () => readServerDisplay(bot).commandTree?.rootLiterals ?? null,
      loggedIn: () => this.bridge?.bot === bot && this.bridge?.connected === true,
      send: (command) => bot.chat(command),
      onEvent: log,
    }, { autoMain: this.tangerine.pack.autoMain !== false });
    this.tangerineRoute.tick();
    this.tangerineTimer = setInterval(() => { if (this.bridge?.bot === bot) this.tangerineRoute?.tick(); }, 1000);
    this.tangerineTimer.unref?.();
    bot.once?.('end', () => this.disposeTangerine());
  }

  disposeTangerine() {
    if (this.tangerineTimer) clearInterval(this.tangerineTimer);
    this.tangerineTimer = null;
    this.tangerineRoute?.stop(); this.tangerineRoute = null;
    this.tangerineObserver?.close(); this.tangerineObserver = null;
  }

  disposeExtension() { this.disposeTangerine(); super.disposeExtension(); }

  /** SVC lives on the survival backend behind voicechatproxy; hold it in limbo/lobby. */
  simpleVoiceChatGate(bot) {
    if (!this.tangerine?.active) return super.simpleVoiceChatGate(bot);
    this.tangerineRoute?.tick();
    return this.tangerineRoute?.voiceAllowed() === true;
  }

  tangerineState() {
    if (!this.tangerine.active) return { active: false, reason: 'host_not_tangerinecology', profile: TANGERINE_PROFILE.host };
    if (!this.bridge?.connected || !this.tangerineRoute) return { active: true, available: false, reason: 'body_not_authenticated_or_offline' };
    return { active: true, available: true, sampledAt: new Date().toISOString(),
      route: this.tangerineRoute.snapshot(), svcGateOpen: this.tangerineRoute.voiceAllowed(),
      vulcanPace: this.tangerine.pack.vulcanPace !== false, ...this.tangerineObserver?.snapshot() };
  }

  extensionTools() {
    return [...super.extensionTools(), { ...STATE_TOOL, handler: (args = {}) => {
      if (args.action === 'guide') return { text: GUIDE };
      if (args.action === 'plugins') return { text: JSON.stringify({ observedAt: '2026-11-23', plugins: PLUGINS, knownIssues: KNOWN_ISSUES }) };
      return { text: JSON.stringify(this.tangerineState()) };
    } }];
  }
}

/** Engine-child factory. Optional pack switches come from `cfg.tangerinecology` (data only). */
export const createEngine = (options) => {
  const pack = options?.cfg?.tangerinecology;
  return new TangerineEngine(options, pack && typeof pack === 'object' && !Array.isArray(pack) ? pack : {});
};
