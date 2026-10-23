import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadBaseUrl } from './download-mirror.mjs';
import { packageReleases } from './download-catalog.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(overrides = {}) {
  let local = {};
  const localPath = path.join(projectRoot, 'config.local.json');
  // Isolated fixtures must never inherit a developer's live bridge or SMTP.
  if (!overrides.skipLocalConfig && fs.existsSync(localPath)) local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
  const defaults = JSON.parse(fs.readFileSync(path.join(projectRoot, 'config.example.json'), 'utf8'));
  const config = { ...defaults, ...local, ...overrides };
  config.host = process.env.PORTAL_HOST || config.host;
  config.port = Number(process.env.PORTAL_PORT || config.port);
  config.dataDir = overrides.dataDir || process.env.PORTAL_DATA_DIR || path.join(projectRoot, '.local');
  config.publicDir = path.join(projectRoot, 'public');
  config.authBridge = { ...defaults.authBridge, ...local.authBridge, ...overrides.authBridge };
  config.live = { ...defaults.live, ...local.live, ...overrides.live };
  config.cloudSync = { ...defaults.cloudSync, ...local.cloudSync, ...overrides.cloudSync };
  config.cloudAccounts = { ...defaults.cloudAccounts, ...local.cloudAccounts, ...overrides.cloudAccounts };
  config.emailAuth = { ...defaults.emailAuth, ...local.emailAuth, ...overrides.emailAuth };
  config.agentAccess = { ...defaults.agentAccess, ...local.agentAccess, ...overrides.agentAccess };
  config.downloads = { baseUrl: '', enabledPackages: [], ...defaults.downloads, ...local.downloads, ...overrides.downloads };
  config.downloads.baseUrl = downloadBaseUrl(config.downloads.baseUrl);
  if (!Array.isArray(config.downloads.enabledPackages) || config.downloads.enabledPackages.some(id => !packageReleases.some(row => row.id === id))) throw new Error('Unknown reviewed download package');
  config.appearance = { enabled: true, bridgeEnabled: false, tokenHash: '', ...defaults.appearance, ...local.appearance, ...overrides.appearance };
  if (!['email', 'username', 'optional-email'].includes(config.emailAuth.registrationMode)) throw new Error('Invalid registration mode');
  if (!['local', 'cloud'].includes(config.sourceMode)) throw new Error('Invalid portal source mode');
  if (config.sourceMode === 'cloud' && config.authBridge.enabled) throw new Error('The cloud website must not open a local game authentication bridge');
  config.publicOrigin = process.env.PORTAL_PUBLIC_ORIGIN || config.publicOrigin;
  if (config.publicOrigin) {
    const origin = new URL(config.publicOrigin);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('PORTAL_PUBLIC_ORIGIN must be an HTTPS origin without a path or credentials');
    config.publicOrigin = origin.origin;
  }
  for (const origin of config.localOrigins || []) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid local origin');
  }
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error('Invalid portal port');
  if (!['127.0.0.1', '::1', 'localhost'].includes(config.host) && process.env.PORTAL_ALLOW_PRIVATE_BIND !== '1') {
    throw new Error('Private-network binding requires PORTAL_ALLOW_PRIVATE_BIND=1 and a reviewed access configuration.');
  }
  return config;
}
