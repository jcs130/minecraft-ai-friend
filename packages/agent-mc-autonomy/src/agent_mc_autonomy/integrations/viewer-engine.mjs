import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicAgentReader } from './viewer-public.mjs';

const require = createRequire(resolve(new URL(import.meta.url).searchParams.get('package'), 'package.json'));
const { MinecraftWorld, Bridge } = await import(pathToFileURL(require.resolve('agent-mc-world/extension')).href);
const { simplify } = require('prismarine-nbt');

export function createEngine(options) {
  const cfg = options.extension.config;
  let prepared, streamFactory, presentation, attached, stream, timer, stopped = false;
  let state = { available: false, reason: 'VIEWER_PREPARING', url: null };
  const record = patch => {
    state = { ...state, ...patch, session: cfg.session, updated_at: new Date().toISOString() };
    const temporary = cfg.stateFile + '.tmp';
    writeFileSync(temporary, JSON.stringify(state));
    renameSync(temporary, cfg.stateFile);
  };
  const close = async () => {
    clearInterval(timer); timer = null;
    const previous = attached; attached = null;
    stream?.close(); stream = null;
    await previous?.close();
  };
  return new class extends MinecraftWorld {
    async start(host) {
      stopped = false;
      try {
        const load = relative => import(pathToFileURL(resolve(cfg.rendererDirectory, relative)).href);
        const [{ prepareNativeWorldPreviewHost }, { selectViewerPack }, vanilla] = await Promise.all([
          load('tools/native-world-preview-host.mjs'), load('host/viewer-pack-selection.mjs'), load('host/vanilla-native-stream.mjs')]);
        const catalog = JSON.parse(readFileSync(cfg.catalogFile, 'utf8'));
        const selected = selectViewerPack(catalog.packs, { minecraftVersion: options.cfg.version });
        if (!selected.available) throw Error(selected.reason);
        prepared = await prepareNativeWorldPreviewHost({ assetDirectory: resolve(dirname(cfg.catalogFile), selected.pack.assetDirectory), port: cfg.port });
        if (prepared.registrySha256 !== selected.pack.registrySha256) throw Error('VIEWER_CATALOG_REGISTRY_MISMATCH');
        streamFactory = vanilla.observeVanillaNativeStream;
        presentation = bot => vanilla.vanillaPlayerPresentation(bot, stream?.handState?.(), stream?.menuState?.());
        record({ pack: selected.pack.id, minecraftVersion: selected.minecraftVersion, registrySha256: prepared.registrySha256 });
      } catch (error) {
        prepared = null;
        record({ available: false, reason: 'VIEWER_PREPARE_FAILED', detail: String(error.message).slice(0, 180) });
        host.log.warn('Optional viewer unavailable; game execution continues');
      }
      return super.start(host);
    }
    createBridge(bridgeOptions) {
      return new Bridge({ ...bridgeOptions, onBotCreated: bot => {
        bridgeOptions.onBotCreated?.(bot);
        if (!prepared || stopped) return;
        // Reconnects must release the old listener before binding this same body's
        // next connection. Never open a second Minecraft account for rendering.
        const oldClose = close();
        stream = streamFactory(bot, prepared.registrySha256, options.cfg.version);
        const view = attached = prepared.attach({ bot, nativeStream: stream, simplifyNBT: simplify,
          expectedUsername: options.cfg.username, getAgentStatus: publicAgentReader(cfg.agentStateFile, cfg.session, options.cfg.username),
          getPresentationState: () => presentation(bot), logger: { error() {} } });
        const publish = () => {
          if (attached !== view || stopped) return;
          const current = view.status();
          const connected = bot.version === options.cfg.version && !!bot.entity && !!bot._client.uuid;
          record({ available: connected && current.viewer.available && !!view.url, url: view.url ? view.url + 'dungeon/' : null,
            reason: current.viewer.reason, player: current.selfPlayer ?? null, status: current });
        };
        void oldClose.then(() => view.listen()).then(() => {
          if (attached !== view || stopped) return view.close();
          publish(); timer = setInterval(publish, 1000); timer.unref();
        }).catch(() => record({ available: false, reason: 'VIEWER_LISTEN_FAILED', url: null }));
        bot.once('end', () => {
          if (attached === view) { record({ available: false, reason: 'GAME_DISCONNECTED', url: null }); void close(); }
        });
      } });
    }
    async stop() {
      stopped = true;
      try { await super.stop(); }
      finally { await close(); record({ available: false, reason: 'STOPPED', url: null }); }
    }
  }(options);
}
