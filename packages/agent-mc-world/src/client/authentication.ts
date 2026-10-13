import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

export type AuthenticationMode = 'offline' | 'microsoft';
export interface AccountSettings { mode: AuthenticationMode; account: string; profilesFolder?: string }
export interface PublicAccountState {
  mode: AuthenticationMode;
  phase: 'not-required' | 'idle' | 'authenticating' | 'awaiting-user' | 'ready' | 'failed' | 'stopped';
  profile: { name: string; uuid: string } | null;
  challenge: { verificationUri: string; userCode: string; expiresAt: string } | null;
  detail: string | null;
}
/** Private launch credentials. Never put this object in events, model context, logs or HTTP responses. */
export interface JavaCredentials { username: string; uuid: string; accessToken: string }
type AuthResult = { token: string; profile: { id?: string; name?: string } };
export type JavaAuthenticator = (account: string, directory: string, onCode: (code: unknown) => void) => Promise<AuthResult>;
const javaAuthenticator: JavaAuthenticator = async (account, directory, onCode) => {
  const { Authflow, Titles } = createRequire(import.meta.url)('prismarine-auth') as {
    Authflow: new (account: string, directory: string, options: object, code: (value: unknown) => void) => {
      getMinecraftJavaToken(options: { fetchProfile: boolean }): Promise<AuthResult>;
    };
    Titles: { MinecraftNintendoSwitch: string };
  };
  return new Authflow(account, directory, { flow: 'live', authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo' }, onCode)
    .getMinecraftJavaToken({ fetchProfile: true });
};

function profile(value: unknown): PublicAccountState['profile'] {
  const row = value as { name?: unknown; id?: unknown } | null;
  if (!row || typeof row.name !== 'string' || !/^[A-Za-z0-9_]{1,16}$/.test(row.name)
    || typeof row.id !== 'string' || !/^[a-f0-9]{32}$/i.test(row.id.replaceAll('-', ''))) return null;
  return { name: row.name, uuid: row.id.replaceAll('-', '') };
}
/** UI-only device challenge. Ignore device_code, tokens, complete URLs and free-form provider messages. */
export function publicDeviceChallenge(value: unknown, now = Date.now()): PublicAccountState['challenge'] {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.user_code !== 'string' || !/^[A-Z0-9-]{4,24}$/i.test(row.user_code)) return null;
  let uri = 'https://www.microsoft.com/link';
  try {
    const url = new URL(String(row.verification_uri ?? uri));
    if (url.protocol === 'https:' && ['microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com'].includes(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash) uri = url.href;
  } catch { /* Use the official device login entry. */ }
  const seconds = typeof row.expires_in === 'number' && Number.isFinite(row.expires_in)
    ? Math.max(1, Math.min(row.expires_in, 1800)) : 900;
  return { verificationUri: uri, userCode: row.user_code, expiresAt: new Date(now + seconds * 1000).toISOString() };
}

/** One account lane; the game protocol and Java launcher share the public lifecycle, not credentials. */
export class MinecraftAuthentication {
  private epoch = 0;
  private pending?: Promise<JavaCredentials | undefined>;
  private state: PublicAccountState = { mode: 'offline', phase: 'idle', profile: null, challenge: null, detail: null };
  constructor(private readonly settings: () => AccountSettings, private readonly dataDir: string,
    private readonly lane: 'agent' | 'observer' | 'player', private readonly authenticate: JavaAuthenticator = javaAuthenticator) {
    this.state.mode = settings().mode;
  }
  snapshot(): PublicAccountState {
    const state = structuredClone(this.state);
    if (state.challenge && Date.parse(state.challenge.expiresAt) <= Date.now()) {
      state.challenge = null;
      state.detail = '登录码已过期，请结束本次连接后重新登录。';
    }
    return state;
  }
  private begin() {
    const settings = this.settings(), epoch = ++this.epoch;
    this.state = { mode: settings.mode, phase: settings.mode === 'offline' ? 'not-required' : 'authenticating',
      profile: null, challenge: null, detail: null };
    const onCode = (value: unknown) => {
      if (epoch !== this.epoch) return;
      const challenge = publicDeviceChallenge(value);
      if (challenge) this.state = { ...this.state, phase: 'awaiting-user', challenge, detail: '请在微软页面完成授权。' };
    };
    let directory = '';
    if (settings.mode === 'microsoft') {
      if (!settings.profilesFolder && !this.dataDir) throw new Error('Microsoft authentication requires a private dataDir or profilesFolder.');
      directory = resolve(settings.profilesFolder || join(this.dataDir, 'auth', this.lane));
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    return { settings, epoch, directory, onCode };
  }
  /** Pass through to Mineflayer; it performs OAuth, refresh, ownership/profile checks and chat signing. */
  botOptions() {
    const { settings, directory, onCode } = this.begin();
    return settings.mode === 'microsoft'
      ? { auth: 'microsoft' as const, profilesFolder: directory, onMsaCode: onCode }
      : { auth: 'offline' as const };
  }
  acceptProtocolSession(session: unknown): void {
    const selected = profile((session as { selectedProfile?: unknown } | null)?.selectedProfile);
    if (this.state.mode === 'microsoft' && selected && this.state.phase !== 'stopped')
      this.state = { ...this.state, phase: 'ready', profile: selected, challenge: null, detail: null };
  }
  failPending(): void {
    if (['authenticating', 'awaiting-user'].includes(this.state.phase)) this.state = { ...this.state, phase: 'failed',
      challenge: null, detail: '正版登录未完成；请检查网络、账号的 Java 版资格及授权状态。不会回退为离线账号。' };
  }
  stop(): void { this.epoch++; this.pending = undefined; this.state = { ...this.state, phase: 'stopped', challenge: null }; }
  javaCredentials(): Promise<JavaCredentials | undefined> {
    if (this.pending) return this.pending;
    const { settings, directory, onCode, epoch } = this.begin();
    if (settings.mode === 'offline') return Promise.resolve(undefined);
    const pending = (async () => {
      try {
        const result = await Promise.resolve().then(() => this.authenticate(settings.account, directory, onCode));
        if (epoch !== this.epoch) throw new Error('Authentication cancelled.');
        const selected = profile(result.profile);
        if (!selected || !result.token) throw new Error('No Java profile.');
        this.state = { ...this.state, phase: 'ready', profile: selected, challenge: null, detail: null };
        return { username: selected.name, uuid: selected.uuid, accessToken: result.token };
      } catch {
        if (epoch === this.epoch) this.failPending();
        throw new Error(epoch === this.epoch ? this.state.detail ?? 'Microsoft authentication failed.' : 'Authentication cancelled.');
      } finally { if (epoch === this.epoch) this.pending = undefined; }
    })();
    this.pending = pending;
    return pending;
  }
}

export function protocolVersion(value: string): string | false {
  const version = value.trim();
  if (!version || version === 'auto') return false;
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(version)) throw new Error('Use auto or an explicit supported Java version, for example 1.20.6.');
  return version;
}
