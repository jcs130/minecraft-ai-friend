/**
 * Named Minecraft server profiles for one world instance.
 *
 * A world section may list several servers under `servers` and pick one with `server`
 * (or the `AGENT_MC_SERVER` environment variable, which wins for a single process start).
 * The selected profile's connection fields replace the section's top-level ones before the
 * engine starts, so every existing consumer keeps reading `cfg.host`, `cfg.version`, ...
 * Profiles never contain secrets: accounts point at a login-config file whose entries
 * reference environment variables or private credential files.
 *
 * Switching servers is a connection change: write `worlds.<id>.server` (config file or the
 * host config API) and restart the world. Nothing here connects anywhere.
 */

/** Per-server conduct rules; enforcement of chat/commands lives in installServerChatPolicy. */
export interface ServerSafetyRules {
  /** Ordinary public chat. Default true. */
  publicChat?: boolean;
  chat?: { minIntervalMs?: number; perMinute?: number; dedupMs?: number; maxChars?: number };
  /**
   * `all` = any player command except `block`; `allowlist` = only `allow` (+ auth commands).
   * Commands are compared by their first word without namespace, lower case.
   */
  commands?: { mode?: 'all' | 'allowlist'; allow?: string[]; block?: string[]; minIntervalMs?: number };
  /** Private messages (/msg, /tell, /r ...). Default true; extensions may still gate them. */
  privateMessages?: boolean;
  /** No dig/place inside these circles (e.g. the public spawn). `world` limits it to one native world key. */
  protectedCircles?: Array<{ name?: string; x: number; z: number; r: number; world?: string }>;
  /** Hints for deployment structure guards (ownership-based protection). */
  structureGuard?: { enabled?: boolean; radius?: number; relaxedWorlds?: string[] };
  /** Stop mining/pathing when the server or an admin warns (merged into miningLimits). Default true. */
  stopOnWarning?: boolean;
  warningKeywords?: string[];
}

/** Account rules checked by validateServerProfile; they never touch credentials. */
export interface ServerAccountRules { usernamePrefix?: string; maxLength?: number; avoidNames?: string[] }

export interface MinecraftServerProfile {
  label?: string;
  host: string;
  port?: number;
  version?: string;
  username?: string;
  auth?: 'offline' | 'microsoft';
  /** Login-config file (AuthMe etc.); it references env vars or private files, never inline passwords. */
  loginConfigFile?: string;
  fakeHost?: string;
  publicDnsFallback?: boolean;
  connectAddresses?: string[];
  dohResolvers?: string[];
  connectTimeoutMs?: number;
  maxReconnectAttempts?: number;
  viewerAssetsDir?: string;
  account?: ServerAccountRules;
  safety?: ServerSafetyRules;
  /** false = config-only entry: it can be validated and listed, but applyServerProfile refuses to select it. */
  selectable?: boolean;
  notes?: string;
}

export interface ServerProfileSection {
  server?: string;
  servers?: Record<string, MinecraftServerProfile>;
}

/**
 * Keys that belong to one server only. When a profile is selected and does not set them, the
 * section's values are NOT inherited (a pinned IP or SNI host of server A must never be dialed for
 * server B): port falls back to 25565, version to 'auto', fakeHost/connectAddresses are cleared.
 * Account (username/auth/loginConfigFile) and transport tuning (DoH, timeouts, viewer assets) inherit.
 */
export const SERVER_SPECIFIC_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
  port: 25565, version: 'auto', fakeHost: undefined, connectAddresses: undefined,
});

/** Connection keys a profile may override on the world section. */
export const SERVER_PROFILE_FIELDS = [
  'host', 'port', 'version', 'username', 'auth', 'loginConfigFile', 'fakeHost', 'publicDnsFallback',
  'connectAddresses', 'dohResolvers', 'connectTimeoutMs', 'maxReconnectAttempts', 'viewerAssetsDir',
] as const;

const SECRET_KEYS = /^(password|passwd|pwd|secret|token|credential|credentials)$/i;
export const SERVER_ENV = 'AGENT_MC_SERVER';

export function validateServerProfile(id: string, profile: MinecraftServerProfile): string[] {
  const errors: string[] = [];
  if (!profile || typeof profile !== 'object') return [`${id}: profile must be an object`];
  if (typeof profile.host !== 'string' || !profile.host.trim()) errors.push(`${id}: host is required`);
  if (profile.port !== undefined && !(Number.isInteger(profile.port) && profile.port > 0 && profile.port < 65536)) errors.push(`${id}: port must be 1..65535`);
  for (const key of Object.keys(profile)) if (SECRET_KEYS.test(key)) errors.push(`${id}: "${key}" is not allowed; reference a login-config file instead`);
  const name = profile.username ?? '';
  const rules = profile.account ?? {};
  if (name) {
    const max = rules.maxLength ?? 16;
    if ([...name].length > max) errors.push(`${id}: username longer than ${max}`);
    if (!/^[A-Za-z0-9_]+$/.test(name)) errors.push(`${id}: username may only use letters, digits and _`);
    if (rules.usernamePrefix && !name.startsWith(rules.usernamePrefix)) errors.push(`${id}: username must start with ${rules.usernamePrefix}`);
    const lower = name.toLowerCase();
    for (const avoid of rules.avoidNames ?? []) if (avoid && lower === avoid.toLowerCase()) errors.push(`${id}: username ${name} is reserved on this server`);
  }
  const safety = profile.safety;
  for (const c of safety?.protectedCircles ?? []) {
    if (![c?.x, c?.z, c?.r].every((n) => typeof n === 'number' && Number.isFinite(n)) || c.r <= 0) errors.push(`${id}: protectedCircles need finite x, z and r > 0`);
  }
  return errors;
}

/** The selected profile id, or null when the section has no profiles. */
export function selectedServerId(section: ServerProfileSection, env: Record<string, string | undefined> = process.env): string | null {
  const servers = section.servers ?? {};
  if (Object.keys(servers).length === 0) return null;
  const pick = (env[SERVER_ENV] ?? '').trim() || (section.server ?? '').trim();
  return pick || null;
}

/**
 * Overlay the selected profile on a copy of the section.
 * Adds `activeServer` and `serverSafety`; throws on an unknown, unselectable or invalid profile.
 */
export function applyServerProfile<T extends object>(section: T, env: Record<string, string | undefined> = process.env):
  T & { activeServer?: string; serverSafety?: ServerSafetyRules } {
  const s = section as T & ServerProfileSection & Record<string, unknown>;
  const id = selectedServerId(s, env);
  if (id === null) return section as T & { activeServer?: string; serverSafety?: ServerSafetyRules };
  const profile = s.servers?.[id];
  if (!profile) throw new Error(`Unknown Minecraft server profile "${id}" (known: ${Object.keys(s.servers ?? {}).join(', ')})`);
  if (profile.selectable === false) throw new Error(`Minecraft server profile "${id}" is config-only (selectable: false)`);
  const errors = validateServerProfile(id, profile);
  if (errors.length) throw new Error(`Invalid Minecraft server profile: ${errors.join('; ')}`);
  const out: Record<string, unknown> = { ...(s as Record<string, unknown>), activeServer: id };
  for (const [key, value] of Object.entries(SERVER_SPECIFIC_DEFAULTS)) {
    if (value === undefined) delete out[key]; else out[key] = value;
  }
  for (const key of SERVER_PROFILE_FIELDS) if (profile[key] !== undefined) out[key] = structuredClone(profile[key]);
  if (profile.safety) {
    out.serverSafety = structuredClone(profile.safety);
    const ml = { ...((s as Record<string, unknown>).miningLimits as Record<string, unknown> | undefined) };
    if (profile.safety.stopOnWarning !== false) ml.hardStopOnWarning = true;
    if (profile.safety.warningKeywords?.length) {
      const base = Array.isArray(ml.warningKeywords) ? ml.warningKeywords as string[] : [];
      ml.warningKeywords = [...new Set([...base, ...profile.safety.warningKeywords])];
    }
    out.miningLimits = ml;
  } else {
    delete out.serverSafety;
  }
  return out as T & { activeServer?: string; serverSafety?: ServerSafetyRules };
}

/** Secret-free listing for consoles/APIs. */
export function describeServerProfiles(section: ServerProfileSection, env: Record<string, string | undefined> = process.env) {
  const active = selectedServerId(section, env);
  return Object.entries(section.servers ?? {}).map(([id, p]) => ({
    id, label: p.label ?? id, host: p.host, port: p.port ?? 25565, version: p.version ?? null,
    username: p.username ?? null, selectable: p.selectable !== false, active: id === active,
    publicChat: p.safety?.publicChat !== false, errors: validateServerProfile(id, p),
  }));
}

const AUTH_COMMANDS = new Set(['login', 'l', 'register', 'reg']);
const PRIVATE_COMMANDS = new Set(['msg', 'tell', 'w', 'whisper', 'pm', 'reply', 'r', 'm', 't']);

/**
 * Wrap bot.chat with the server's chat/command rules. Refusals throw `LOCAL_*` errors before
 * anything is sent, so callers can tell them from server replies. Auth commands always pass.
 */
export function installServerChatPolicy(
  bot: { chat: (message: string, ...rest: unknown[]) => unknown },
  rules: ServerSafetyRules | null | undefined,
  now: () => number = Date.now,
): void {
  if (!rules) return;
  const inner = bot.chat.bind(bot);
  const chatRule = { minIntervalMs: 2_000, perMinute: 8, dedupMs: 60_000, maxChars: 200, ...rules.chat };
  const cmdRule = { mode: 'all' as const, allow: [] as string[], block: [] as string[], minIntervalMs: 1_000, ...rules.commands };
  const allow = new Set(cmdRule.allow.map((c) => c.toLowerCase()));
  const block = new Set(cmdRule.block.map((c) => c.toLowerCase()));
  const sent: number[] = [];
  const recent = new Map<string, number>();
  let lastCommand = 0;
  bot.chat = (message: string, ...rest: unknown[]) => {
    const text = String(message).trim();
    const t = now();
    if (text.startsWith('/')) {
      const words = text.slice(1).split(/\s+/);
      const cmd = (words[0] ?? '').split(':').pop()!.toLowerCase();
      const full = text.slice(1).toLowerCase().replace(/\s+/g, ' ');
      if (AUTH_COMMANDS.has(cmd)) return inner(message, ...rest);
      if (block.has(cmd) || block.has(full)) throw new Error(`LOCAL_COMMAND_BLOCKED: /${cmd} 在当前服务器配置里被禁用；这次没发出。`);
      if (cmdRule.mode === 'allowlist' && !allow.has(cmd) && !allow.has(full)) throw new Error(`LOCAL_COMMAND_NOT_ALLOWED: 当前服务器只允许这些命令：${[...allow].join('、') || '（无）'}；/${cmd} 没发出。`);
      if (rules.privateMessages === false && PRIVATE_COMMANDS.has(cmd)) throw new Error(`LOCAL_PRIVATE_MESSAGE_DISABLED: 当前服务器配置不发私聊；/${cmd} 没发出。`);
      if (t - lastCommand < cmdRule.minIntervalMs) throw new Error(`LOCAL_COMMAND_PACING: 两条命令至少间隔 ${Math.ceil(cmdRule.minIntervalMs / 1000)} 秒；这次没发出。`);
      lastCommand = t;
      return inner(message, ...rest);
    }
    if (rules.publicChat === false) throw new Error('LOCAL_PUBLIC_CHAT_DISABLED: 当前服务器配置不在公屏说话；这次没发出。');
    if ([...text].length > chatRule.maxChars) throw new Error(`LOCAL_CHAT_TOO_LONG: 一句最多 ${chatRule.maxChars} 个字；这次没发出。`);
    while (sent.length && t - sent[0] > 60_000) sent.shift();
    if (sent.length && t - sent[sent.length - 1] < chatRule.minIntervalMs) throw new Error(`LOCAL_CHAT_PACING: 两句话至少间隔 ${Math.ceil(chatRule.minIntervalMs / 1000)} 秒（防刷屏）；这次没发出。`);
    if (sent.length >= chatRule.perMinute) throw new Error(`LOCAL_CHAT_PACING: 一分钟最多 ${chatRule.perMinute} 句（防刷屏）；这次没发出。`);
    const key = text.replace(/\s+/g, '');
    if (chatRule.dedupMs > 0 && t - (recent.get(key) ?? -Infinity) < chatRule.dedupMs) throw new Error(`LOCAL_CHAT_DEDUP: 同一句话 ${Math.round(chatRule.dedupMs / 1000)} 秒内已经说过；这次没发出。`);
    sent.push(t); recent.set(key, t);
    if (recent.size > 64) recent.delete(recent.keys().next().value as string);
    return inner(message, ...rest);
  };
}

/** Is a block position inside one of the profile's protected circles? */
export function insideProtectedCircle(rules: ServerSafetyRules | null | undefined, x: number, z: number, worldKey: string | null = null): string | null {
  for (const c of rules?.protectedCircles ?? []) {
    if (c.world && worldKey && c.world !== worldKey) continue;
    if (Math.hypot(x - c.x, z - c.z) < c.r) return c.name ?? `(${c.x}, ${c.z}) r=${c.r}`;
  }
  return null;
}
