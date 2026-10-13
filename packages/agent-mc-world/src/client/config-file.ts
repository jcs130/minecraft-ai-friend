import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Ajv } from 'ajv';
import { MINECRAFT_CLIENT_CONFIG_GROUP, MINECRAFT_CONFIG_GROUP, MINECRAFT_PLAYER_CONFIG_GROUP, MINECRAFT_RHYTHM_CONFIG_GROUP } from '../../core/config.ts';
import type { ConfigGroup } from './contracts.ts';
import { MINECRAFT_CLIENT_DEFAULTS, assertMinecraftReady, type MinecraftClientConfig } from './config.ts';

function merge(base: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(base, key)) throw new Error(`Unknown Minecraft configuration field: ${key}`);
    const previous = base[key];
    if (previous && typeof previous === 'object' && !Array.isArray(previous)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected object: ${key}`);
      merge(previous as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      if (typeof previous !== typeof value) throw new Error(`Invalid Minecraft configuration type: ${key}`);
      base[key] = value;
    }
  }
}
/** Shared decoding only. Integrations supply defaults, schema namespace and their own preflight. */
export function loadPrivateClientConfig<T extends MinecraftClientConfig>(path: string, policy: {
  defaults: T; groups: readonly ConfigGroup[]; schemaPrefix: string; validate(cfg: T): void;
}) {
  const fullPath = resolve(path), input = JSON.parse(readFileSync(fullPath, 'utf8')) as Record<string, unknown>;
  if (!input.world || typeof input.world !== 'object' || Array.isArray(input.world)) throw new Error('Configuration requires a world object.');
  if (typeof input.dataDir !== 'string' || !input.dataDir.trim()) throw new Error('Configuration requires a private dataDir.');
  if (input.acceptsImages !== undefined && typeof input.acceptsImages !== 'boolean') throw new Error('acceptsImages must be boolean.');
  if (input.timezone !== undefined && typeof input.timezone !== 'string') throw new Error('timezone must be a string.');
  if (input.metricsPort !== undefined && (!Number.isInteger(input.metricsPort) || Number(input.metricsPort) < 0 || Number(input.metricsPort) > 65535))
    throw new Error('metricsPort must be an integer between 0 (disabled) and 65535.');
  if (input.consolePort !== undefined && (!Number.isInteger(input.consolePort) || Number(input.consolePort) < 0 || Number(input.consolePort) > 65535))
    throw new Error('consolePort must be an integer between 0 (disabled) and 65535.');
  const cfg = structuredClone(policy.defaults);
  merge(cfg as unknown as Record<string, unknown>, input.world as Record<string, unknown>);
  const ajv = new Ajv({ strict: false, validateFormats: false });
  for (const group of policy.groups) for (const [key, schema] of Object.entries(group.schema.properties)) {
    if (!key.startsWith(policy.schemaPrefix)) continue;
    const value = key.slice(policy.schemaPrefix.length).split('.').reduce<unknown>((object, part) =>
      object && typeof object === 'object' ? (object as Record<string, unknown>)[part] : undefined, cfg);
    if (value === undefined) continue;
    const validate = ajv.compile(schema);
    if (!validate(value)) throw new Error(`Invalid ${key}: ${ajv.errorsText(validate.errors)}`);
  }
  if (cfg.loginConfigFile) cfg.loginConfigFile = resolve(dirname(fullPath), cfg.loginConfigFile);
  for (const account of [cfg, cfg.client, cfg.player] as Array<{ profilesFolder?: string }>)
    if (account.profilesFolder) account.profilesFolder = resolve(dirname(fullPath), account.profilesFolder);
  policy.validate(cfg);
  return { cfg, dataDir: resolve(dirname(fullPath), input.dataDir), timezone: String(input.timezone ?? 'UTC'),
    acceptsImages: input.acceptsImages === true, metricsPort: Number(input.metricsPort ?? 0), consolePort: Number(input.consolePort ?? 0) };
}
export const loadMinecraftClientConfig = (path: string) => loadPrivateClientConfig(path, {
  defaults: MINECRAFT_CLIENT_DEFAULTS, schemaPrefix: 'worlds.minecraft.', validate: assertMinecraftReady,
  groups: [MINECRAFT_CONFIG_GROUP, MINECRAFT_RHYTHM_CONFIG_GROUP, MINECRAFT_CLIENT_CONFIG_GROUP, MINECRAFT_PLAYER_CONFIG_GROUP],
});
