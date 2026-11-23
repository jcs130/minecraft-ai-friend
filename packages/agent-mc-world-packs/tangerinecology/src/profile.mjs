/**
 * 橘乡 (mc.tangerinecology.top) server profile. Data only: no credentials, no account, no persona.
 * The pack is active only when the configured host matches, or when a host passes `force: true`.
 */
export const TANGERINE_HOSTS = Object.freeze(['mc.tangerinecology.top']);
export const TANGERINE_PROFILE = Object.freeze({
  id: 'tangerinecology',
  name: '橘乡',
  host: 'mc.tangerinecology.top',
  port: 25565,
  /** Velocity 1.7.2-26.2 front, Lophine/Purpur 26.2 backends. Experimental core stack. */
  version: '26.2',
  /** Plain SRV/DNS name the proxy expects in the handshake. */
  fakeHost: 'mc.tangerinecology.top',
  /** Simple Voice Chat network compatibility observed on the backend (SVC 2.6.20 via voicechatproxy). */
  svcCompatibilityVersion: 20,
});

/** Anti-cheat warning phrases to stop automatic movement/mining. Unverified wording; extend, never shrink. */
export const VULCAN_WARNING_KEYWORDS = Object.freeze(['Vulcan', 'Unfair Advantage', '反作弊', '疑似作弊', '外挂', '自动化模组']);

export function hostOf(cfg) {
  return String(cfg?.host ?? '').trim().toLowerCase().replace(/\.$/, '');
}

/** True only for the 橘乡 public address. A different server never enables this pack implicitly. */
export function matchesTangerine(cfg, { force = false } = {}) {
  return force === true || TANGERINE_HOSTS.includes(hostOf(cfg));
}

/**
 * Connection/pace settings for 橘乡. Pins version 26.2 and fills a missing fakeHost; other explicit
 * values win, except that pace limits and the anti-cheat stop are switched on (they only slow down).
 * `simpleVoiceChat.enabled` is never turned on here: it needs an explicit host choice and codec.
 */
export function tangerineConfigOverlay(cfg = {}, { keepVersion = false } = {}) {
  const out = { ...cfg };
  // Joining was verified only with an explicit 26.2 client (the core default 1.21.1 is not a choice
  // for this server). `keepVersion` leaves an explicit other version alone for experiments.
  if (!keepVersion || !out.version || out.version === 'auto') out.version = TANGERINE_PROFILE.version;
  if (!out.fakeHost) out.fakeHost = TANGERINE_PROFILE.fakeHost;
  if (out.publicDnsFallback === undefined) out.publicDnsFallback = true;
  out.movementPace = { ...(cfg.movementPace ?? {}), enabled: true, hardStopOnWarning: true };
  const keywords = [...new Set([...(cfg.miningLimits?.warningKeywords ?? []), ...VULCAN_WARNING_KEYWORDS])];
  out.miningLimits = { ...(cfg.miningLimits ?? {}), enabled: true, hardStopOnWarning: true, warningKeywords: keywords };
  const svc = cfg.simpleVoiceChat ?? {};
  out.simpleVoiceChat = { enabled: false, officialJar: '', javaPath: '', ...svc,
    compatibilityVersion: svc.compatibilityVersion || TANGERINE_PROFILE.svcCompatibilityVersion };
  return out;
}

/**
 * MaxAuth account entry for the core's server-login file. The password is read at runtime from
 * `credentialEnv` (or an encrypted `credentialFile`); this function never accepts a password.
 */
export function maxAuthLoginAccount({ username, credentialEnv, credentialFile } = {}) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(username)) throw new Error('TANGERINE_USERNAME_REQUIRED');
  if (!credentialEnv && !credentialFile) throw new Error('TANGERINE_CREDENTIAL_REFERENCE_REQUIRED');
  if (credentialEnv && !/^[A-Z][A-Z0-9_]{2,80}$/.test(credentialEnv)) throw new Error('TANGERINE_CREDENTIAL_ENV_INVALID');
  return {
    server: `${TANGERINE_PROFILE.host}:${TANGERINE_PROFILE.port}`,
    username,
    command: 'login',
    ...(credentialEnv ? { credentialEnv } : { credentialFile }),
    timeoutMs: 90000,
    reauthenticateOnRevoked: false,
  };
}
