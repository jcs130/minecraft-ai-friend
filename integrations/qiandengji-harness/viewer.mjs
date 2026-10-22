import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { observeQiandengji } from './protocol.mjs';
import { skillPresentation, observeWhenPlaying } from './viewer-state.mjs';

/** Opt-in nativeView.module for the existing public SDK, no second body/loop. */
export async function prepareNativeConnection({ assetDirectory, viewerPort = 0 }) {
  const file = process.env.QD_NATIVE_VIEWER_CONFIG;
  if (!file || !path.isAbsolute(file)) throw Error('QD_NATIVE_VIEWER_CONFIG_MUST_BE_ABSOLUTE');
  const config = JSON.parse(await readFile(file, 'utf8'));
  if (!path.isAbsolute(config.rendererDirectory ?? '')) throw Error('QD_NATIVE_RENDERER_DIRECTORY_REQUIRED');
  const { prepareNativeConnection: prepare } = await import(pathToFileURL(path.join(config.rendererDirectory, 'host/vanilla-mineflayer.mjs')));
  const observers = new WeakMap();
  const prepared = await prepare({ assetDirectory, viewerPort,
    bundledAppearanceCatalogFile: config.bundledAppearanceCatalogFile ?? '',
    serverItemCatalogFile: config.serverItemCatalogFile ?? '', serverItemCatalogSha256: config.serverItemCatalogSha256 ?? '',
    decoratePresentation(bot, value) {
      const skills = skillPresentation(observers.get(bot)?.snapshot(), bot._client.uuid);
      return { ...value, skills };
    } });
  return { attach(bot) {
    const observer = observeWhenPlaying(bot, observeQiandengji);
    observers.set(bot, observer);
    let value;
    try { value = prepared.attach(bot); }
    catch (e) { observer.close(); observers.delete(bot); throw e; }
    return { ...value, get url() { return value.url; }, async close() {
      observer.close(); observers.delete(bot); await value.close();
    } };
  } };
}
