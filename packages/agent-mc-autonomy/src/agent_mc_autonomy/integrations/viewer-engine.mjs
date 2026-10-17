import { readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicAgentReader } from './viewer-public.mjs';
import { presentationFactory, mergePresentation } from './server-presentation.mjs';

const require = createRequire(resolve(new URL(import.meta.url).searchParams.get('package'), 'package.json'));
const { Bridge, bindNativeGuiPresentation } = await import(pathToFileURL(require.resolve('agent-mc-world/extension')).href);
const { TacticalMinecraftWorld } = await import(pathToFileURL(require.resolve('agent-mc-world/tactics')).href);
const { simplify } = require('prismarine-nbt');

export function createEngine(options) {
  const cfg = options.extension.config;
  let prepared, streamFactory, presentation, attached, stream, timer, stopped = false;
  let createServerObserver=null,serverObserver=null;
  let logger, generation = 0, closing = Promise.resolve(), sequence = 0, failed = false;
  const writer = `${process.pid}.${randomUUID()}`;
  const diagnostics = new Map();
  const closeServerObserver = () => {
    const observer=serverObserver;serverObserver=null;
    try{observer?.close();}catch{warn('Optional server presentation cleanup failed');}
  };
  const serverCapabilities = () => {
    try{return serverObserver?.capabilities?.()??{active:false};}
    catch{closeServerObserver();warn('Optional server presentation failed; standard presentation retained');return {active:false};}
  };
  const warn = message => { try { logger?.warn(message); } catch {} };
  const diagnostic = (operation, error) => {
    // Never log paths, renderer payloads or arbitrary error text.
    const code = ['EPERM', 'EACCES', 'EBUSY', 'ENOSPC', 'EROFS', 'ENOENT', 'EIO', 'EEXIST'].includes(error?.code)
      ? error.code : 'OTHER';
    const key = `${operation}:${code}`, now = Date.now();
    if (now - (diagnostics.get(key) ?? -Infinity) < 60_000) return;
    diagnostics.set(key, now);
    warn(`Optional viewer persistence failed (${key}); last complete snapshot retained; next publication will try again`);
  };
  let state = { available: false, reason: 'VIEWER_PREPARING', url: null };
  const record = patch => {
    state = { ...state, ...patch, session: cfg.session, updated_at: new Date().toISOString() };
    const temporary = `${cfg.stateFile}.${writer}.${++sequence}.tmp`;
    let descriptor, owned = false, operation = 'write';
    try {
      descriptor = openSync(temporary, 'wx'); owned = true;
      writeFileSync(descriptor, JSON.stringify(state));
      closeSync(descriptor); descriptor = undefined;
      operation = 'rename';
      renameSync(temporary, cfg.stateFile); owned = false;
      if (failed) {
        const now = Date.now();
        if (now - (diagnostics.get('recovery') ?? -Infinity) >= 60_000) {
          diagnostics.set('recovery', now);
          warn('Optional viewer persistence recovered; latest snapshot persisted');
        }
      }
      failed = false;
    } catch (error) { failed = true; diagnostic(operation, error); }
    finally {
      if (descriptor !== undefined) { try { closeSync(descriptor); } catch (error) { diagnostic('cleanup', error); } }
      if (owned) { try { unlinkSync(temporary); } catch (error) { diagnostic('cleanup', error); } }
    }
  };
  const close = () => {
    clearInterval(timer); timer = null;
    const previous = attached; attached = null;
    closeServerObserver();
    previous?.revokeGui?.();
    const previousStream = stream; stream = null;
    try { previousStream?.close(); } catch { warn('Optional viewer stream close failed'); }
    const cleanup = async () => {
      // A pending listen must settle before close, and before the next listen.
      try { await previous?.listening; } catch {}
      try { await previous?.view.close(); } catch { warn('Optional viewer listener close failed'); }
    };
    closing = Promise.all([closing, cleanup()]).then(() => {});
    return closing;
  };
  // Presentation decorates the default tactical body; it must retain its tools,
  // battlefield sampling, combat receipts and extension lifecycle hooks.
  return new class extends TacticalMinecraftWorld {
    async start(host) {
      stopped = false; logger = host.log;
      const currentGeneration = ++generation;
      try{createServerObserver=await presentationFactory(cfg);}
      catch{createServerObserver=null;record({server_extension:{active:false,reason:'SERVER_PRESENTATION_UNAVAILABLE'}});warn('Optional server presentation unavailable; standard gameplay and viewer remain independent');}
      try {
        const load = relative => import(pathToFileURL(resolve(cfg.rendererDirectory, relative)).href);
        const [{ prepareNativeWorldPreviewHost }, { selectViewerPack }, vanilla] = await Promise.all([
          load('tools/native-world-preview-host.mjs'), load('host/viewer-pack-selection.mjs'), load('host/vanilla-native-stream.mjs')]);
        if (stopped || generation !== currentGeneration) return;
        const catalog = JSON.parse(readFileSync(cfg.catalogFile, 'utf8'));
        const selected = selectViewerPack(catalog.packs, { minecraftVersion: options.cfg.version });
        if (!selected.available) throw Error(selected.reason);
        const preparedHost = await prepareNativeWorldPreviewHost({ assetDirectory: resolve(dirname(cfg.catalogFile), selected.pack.assetDirectory), port: cfg.port,
          bundledAppearanceCatalogFile: cfg.bundledAppearanceCatalogFile || '', defaultAppearance: cfg.defaultAppearance ?? 'server',
          selectionScope: cfg.selectionScope });
        if (stopped || generation !== currentGeneration) return;
        prepared = preparedHost;
        if (prepared.registrySha256 !== selected.pack.registrySha256) throw Error('VIEWER_CATALOG_REGISTRY_MISMATCH');
        streamFactory = vanilla.observeVanillaNativeStream;
        presentation = bot => vanilla.vanillaPlayerPresentation(bot, stream?.handState?.(), stream?.menuState?.(), stream?.selfState?.());
        record({ pack: selected.pack.id, minecraftVersion: selected.minecraftVersion, registrySha256: prepared.registrySha256 });
      } catch (error) {
        if (stopped || generation !== currentGeneration) return;
        prepared = null;
        record({ available: false, reason: 'VIEWER_PREPARE_FAILED', detail: String(error.message).slice(0, 180) });
        warn('Optional viewer unavailable; game execution continues');
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
        let view;
        try {
          stream = streamFactory(bot, prepared.registrySha256, options.cfg.version);
          try{serverObserver=createServerObserver?.(bot)??null;}
          catch{serverObserver=null;warn('Optional server presentation could not attach; standard viewer continues');}
          view = prepared.attach({ bot, nativeStream: stream, simplifyNBT: simplify,
            expectedUsername: options.cfg.username, getAgentStatus: publicAgentReader(cfg.agentStateFile, cfg.session, options.cfg.username),
            getPresentationState: () => {
              const base=presentation(bot);let extra=null;
              try{extra=serverObserver?.snapshot();}catch{closeServerObserver();warn('Optional server presentation failed; standard presentation retained');}
              return mergePresentation(base,extra,bot);
            }, logger: { error() {} } });
        } catch {
          record({ available: false, reason: 'VIEWER_ATTACH_FAILED', url: null });
          warn('Optional viewer attachment unavailable; game execution continues');
          void close(); return;
        }
        const attachment = attached = { view, listening: null, revokeGui: null };
        let admission = null;
        const publish = () => {
          if (attached !== attachment || stopped) return;
          admission = null;
          const current = view.status();
          const identity = current.identity, player = current.selfPlayer;
          const uuid = typeof bot._client.uuid === 'string' ? bot._client.uuid.toLowerCase() : null;
          const epoch = current.viewer?.epoch;
          if (uuid && player?.uuid === uuid && player?.name === options.cfg.username
            && player?.entityId === bot.entity?.id && identity?.confirmed === true
            && identity.playerUuid?.toLowerCase() === uuid && identity.epoch === epoch
            && Number.isSafeInteger(epoch) && current.connection?.ended === false
            && current.viewer.available === true && current.viewer.state === 'snapshot'
            && current.presentation?.available === true && current.presentation.playerUuid === uuid
            && current.presentation.nativeState?.available === true) {
            admission = { epoch, uuid, entity: bot.entity, entityId: bot.entity.id, client: bot._client, expires: Date.now() + 1500 };
          }
          const connected = bot.version === options.cfg.version && !!bot.entity && !!bot._client.uuid;
          record({ available: connected && current.viewer.available && !!view.url, url: view.url ? view.url + '3dview/' : null,
            reason: current.viewer.reason, player: current.presentation?.self ?? current.selfPlayer ?? null, status: current,
            server_extension:serverCapabilities(),
            active_viewers: typeof view.activeViewers === 'function' ? view.activeViewers() : null });
        };
        attachment.listening = oldClose.then(() => {
          if (attached !== attachment || stopped) return;
          return view.listen();
        });
        void attachment.listening.then(() => {
          if (attached !== attachment || stopped) return;
          attachment.revokeGui = bindNativeGuiPresentation(bot, () => {
            if (attached !== attachment || stopped) return null;
            // status() serializes entities/inventory and reads agent state. Reuse
            // the existing 1s publication; pacing checks only current cheap state.
            const world = view.world, epoch = world?.epoch, entity = bot.entity;
            const uuid = typeof bot._client.uuid === 'string' ? bot._client.uuid.toLowerCase() : null;
            if (!uuid || !Number.isSafeInteger(epoch)) return null;
            return { epoch, playerUuid: uuid, ready: !!(admission && Date.now() < admission.expires
              && admission.epoch === epoch && admission.uuid === uuid && admission.entity === entity
              && admission.client === bot._client && bot.version === options.cfg.version
              && (bot.username || bot._client.username) === options.cfg.username
              && entity?.isValid !== false && entity?.id === admission.entityId && Number.isSafeInteger(entity?.id)
              && (!entity.username || entity.username === options.cfg.username)
              && (!entity.uuid || (typeof entity.uuid === 'string' && entity.uuid.toLowerCase() === uuid))
              && [entity?.position?.x, entity?.position?.y, entity?.position?.z].every(Number.isFinite)
              && Array.isArray(bot.inventory?.slots) && view.server?.listening === true
              && !world.error && world.dimension && world.pose && view.activeViewers?.() > 0) };
          });
          publish(); timer = setInterval(publish, 1000); timer.unref();
        }).catch(() => {
          if (attached === attachment && !stopped) {
            record({ available: false, reason: 'VIEWER_LISTEN_FAILED', url: null }); void close();
          }
        });
        bot.once('end', () => {
          if (attached === attachment && !stopped) { record({ available: false, reason: 'GAME_DISCONNECTED', url: null }); void close(); }
        });
      } });
    }
    disposeExtension() {
      stopped = true; ++generation;
      void close();
      super.disposeExtension();
    }
    async stop() {
      stopped = true; ++generation;
      try { await super.stop(); }
      finally { await close(); record({ available: false, reason: 'STOPPED', url: null }); }
    }
  }(options);
}
