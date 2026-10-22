import fs from 'node:fs';
import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { digest, hashPassword } from './store.mjs';

const fail = (status, reason, message) => Object.assign(new Error(message), { status, reason });
const duration = 10 * 60 * 1000;
export function normalizeEmail(value) {
  // Do not remove dots or +suffixes: those rules belong to individual providers.
  if (typeof value !== 'string' || value.length > 254 || /[\r\n\s]/.test(value)) throw fail(400, 'INVALID_EMAIL', '请输入有效的邮箱地址');
  const email = value.toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) || email.startsWith('.') || email.includes('..')) throw fail(400, 'INVALID_EMAIL', '请输入有效的邮箱地址');
  return email;
}

export function smtpOptions(settings) {
  if (!settings || typeof settings.host !== 'string' || !/^[a-z0-9.-]+$/i.test(settings.host) || !Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535 || typeof settings.user !== 'string' || !settings.user || typeof settings.password !== 'string' || !settings.password) throw Error('SMTP 配置不完整，请在服务器私有配置中填写发信服务');
  normalizeEmail(settings.from);
  return { host: settings.host, port: settings.port, secure: settings.secure === true, requireTLS: settings.secure !== true,
    auth: { user: settings.user, pass: settings.password }, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false };
}

export class SmtpMailer {
  constructor(config) {
    this.ready = false;
    const file = config.emailAuth.smtpConfigFile;
    if (!file) return;
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 16384) throw Error('SMTP 私有配置文件无效');
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    this.transport = nodemailer.createTransport(smtpOptions(settings));
    this.from = { name: config.siteName, address: normalizeEmail(settings.from) }; this.ready = true;
  }
  async send({ email, code, purpose }) {
    const action = { register: '注册网站账号', bind: '绑定邮箱', reset: '重设网站密码' }[purpose];
    const info = await this.transport.sendMail({ from: this.from, to: email, subject: `千灯纪 · ${action}验证码`,
      text: `你正在${action}。\n\n验证码：${code}\n\n验证码十分钟内有效，只能使用一次。不要把验证码或密码发给其他人。\n如果这不是你的操作，请忽略本邮件。\n本次操作不会修改游戏角色密码。` });
    if (!info.accepted?.some(address => String(address).toLowerCase() === email)) throw Error('SMTP did not accept the recipient');
  }
  close() { this.transport?.close(); }
}

export class EmailAuth {
  constructor(config, store, sender = null) {
    this.config = config; this.store = store; this.sender = sender || new SmtpMailer(config);
    store.db.exec(`CREATE TABLE IF NOT EXISTS owner_emails(owner_id TEXT PRIMARY KEY REFERENCES owners(id) ON DELETE CASCADE,email TEXT NOT NULL UNIQUE,verified_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS email_challenges(id TEXT PRIMARY KEY,purpose TEXT NOT NULL,email TEXT NOT NULL,owner_id TEXT REFERENCES owners(id) ON DELETE CASCADE,session_hash TEXT NOT NULL,username TEXT,password_hash TEXT,code_hash TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,sent_at INTEGER,used_at INTEGER);
      CREATE INDEX IF NOT EXISTS email_challenge_rate ON email_challenges(email,created_at);
      DELETE FROM email_challenges WHERE expires_at < ${Date.now() - 86400000};`);
  }
  capabilities() {
    return { mode: this.config.emailAuth.registrationMode, available: this.config.emailAuth.enabled && this.sender.ready,
      verification: 'email-code', expiresInSeconds: 600,
      unavailableReason: this.config.emailAuth.enabled && this.sender.ready ? null : this.config.emailAuth.registrationMode === 'optional-email'
        ? '邮箱验证暂不可用；可先用用户名和密码注册，之后再绑定邮箱。' : '邮箱发信服务尚未配置，请稍后注册；已有账号可以继续登录。',
      registrationOptions: { usernamePassword: this.config.emailAuth.registrationMode !== 'email', emailVerification: this.config.emailAuth.enabled && this.sender.ready },
      phone: { available: false }, wechat: { available: false } };
  }
  identity(ownerId) {
    const row = this.store.db.prepare('SELECT email,verified_at FROM owner_emails WHERE owner_id=?').get(ownerId);
    return row ? { address: row.email, verified: true, verifiedAt: new Date(row.verified_at).toISOString() } : { address: null, verified: false, verifiedAt: null };
  }
  ownerByEmail(email) { return this.store.db.prepare('SELECT o.* FROM owners o JOIN owner_emails e ON e.owner_id=o.id WHERE e.email=?').get(email); }
  requireReady() { if (!this.capabilities().available) throw fail(503, 'EMAIL_NOT_CONFIGURED', '邮箱发信服务尚未配置，请稍后重试；已有账号可以继续登录'); }
  async begin(purpose, values, session) {
    this.requireReady(); const email = normalizeEmail(values.email), db = this.store.db, now = Date.now();
    const recent = db.prepare('SELECT count(*) AS count,max(created_at) AS latest FROM email_challenges WHERE email=? AND created_at>?').get(email, now - 3600000);
    if (recent.count >= 5 || recent.latest > now - 60000) throw fail(429, 'EMAIL_RATE_LIMIT', '验证码发送较频繁，请一分钟后再试');
    let owner = null, passwordHash = null, username = null;
    if (purpose === 'register') { username = values.username; passwordHash = await hashPassword(values.password); }
    else if (purpose === 'bind') owner = this.store.ownerById(session.owner_id);
    else if (purpose === 'reset') owner = this.ownerByEmail(email);
    else throw fail(400, 'INVALID_EMAIL_PURPOSE', '此邮箱操作不受支持');
    // Check the persisted cooldown again after password hashing, before inserting.
    if (db.prepare('SELECT 1 FROM email_challenges WHERE email=? AND created_at>?').get(email, Date.now() - 60000)) throw fail(429, 'EMAIL_RATE_LIMIT', '请一分钟后再发送验证码');
    const id = randomUUID(), code = String(randomInt(0, 100000000)).padStart(8, '0');
    const suppressed = purpose === 'reset' && !owner || purpose === 'register' && !!this.ownerByEmail(email);
    const created = Date.now();
    db.prepare('INSERT INTO email_challenges(id,purpose,email,owner_id,session_hash,username,password_hash,code_hash,created_at,expires_at,attempts,sent_at,used_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,NULL,?)')
      .run(id, purpose, email, owner?.id || null, session.id_hash, username, passwordHash || owner?.password_hash || null, digest(id + ':' + code), created, created + duration, suppressed ? created : null);
    try {
      if (!suppressed) await this.sender.send({ email, code, purpose });
      db.prepare('UPDATE email_challenges SET sent_at=? WHERE id=? AND used_at IS NULL').run(Date.now(), id);
    } catch {
      db.prepare('UPDATE email_challenges SET used_at=? WHERE id=?').run(Date.now(), id);
      throw fail(503, 'EMAIL_DELIVERY_FAILED', '邮件暂时发送失败，请稍后重试；账号和密码尚未更改');
    }
    // No codes/passwords/email-existence flags are returned or written to logs.
    return { verificationRequired: true, challengeId: id, expiresInSeconds: 600, retryAfterSeconds: 60,
      message: purpose === 'reset' ? '如果该邮箱已绑定账号，你将收到重设密码验证码。' : '请到邮箱查看验证码；如果已有账号，请直接登录或找回密码。' };
  }
  checked(id, code, session) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || typeof code !== 'string' || !/^\d{8}$/.test(code)) throw fail(400, 'EMAIL_CODE_INVALID', '请输入邮件中的八位验证码');
    const row = this.store.db.prepare('SELECT * FROM email_challenges WHERE id=?').get(id);
    if (!row || row.session_hash !== session.id_hash || row.used_at || !row.sent_at || row.expires_at <= Date.now() || row.attempts >= 5) throw fail(400, 'EMAIL_CODE_EXPIRED', '验证码已失效，请重新发送并在当前浏览器完成验证');
    const matches = timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(digest(id + ':' + code), 'hex'));
    if (!matches) { this.store.db.prepare('UPDATE email_challenges SET attempts=attempts+1 WHERE id=?').run(id); throw fail(400, 'EMAIL_CODE_INCORRECT', '验证码不正确，请核对邮件；最多可尝试五次'); }
    if (row.purpose !== 'register') {
      const owner = this.store.ownerById(row.owner_id);
      if (!owner || owner.password_hash !== row.password_hash || row.purpose === 'bind' && owner.id !== session.owner_id) throw fail(400, 'EMAIL_CODE_EXPIRED', '账号状态已更新，请重新发送验证码');
    }
    return row;
  }
  async finish(id, code, session, newPassword) {
    let row = this.checked(id, code, session);
    if (row.purpose === 'reset' && (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 128)) throw fail(400, 'INVALID_PASSWORD', '新网站密码需为 6–128 个字符');
    const passwordHash = row.purpose === 'reset' ? await hashPassword(newPassword) : null;
    row = this.checked(id, code, session); // Recheck after asynchronous hashing.
    const db = this.store.db, now = Date.now(); let owner;
    db.exec('BEGIN IMMEDIATE');
    try {
      if (row.purpose === 'register') {
        if (this.ownerByEmail(row.email) || this.store.ownerByName(row.username)) throw fail(409, 'ACCOUNT_CONFLICT', '账号或邮箱已被使用，请登录或找回密码');
        owner = { id: randomUUID(), username: row.username, normalized: row.username.toLowerCase(), password_hash: row.password_hash, role: 'owner', created_at: now };
        db.prepare('INSERT INTO owners(id,username,normalized,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(...Object.values(owner));
        db.prepare('INSERT INTO owner_emails VALUES(?,?,?)').run(owner.id, row.email, now);
      } else {
        owner = this.store.ownerById(row.owner_id);
        if (row.purpose === 'bind') {
          const existing = this.ownerByEmail(row.email);
          if (existing && existing.id !== owner.id) throw fail(409, 'EMAIL_ALREADY_USED', '该邮箱已绑定其他账号，请使用自己的其他邮箱');
          db.prepare('INSERT INTO owner_emails VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET email=excluded.email,verified_at=excluded.verified_at').run(owner.id, row.email, now);
        } else {
          db.prepare('UPDATE owners SET password_hash=? WHERE id=?').run(passwordHash, owner.id);
          db.prepare('DELETE FROM sessions WHERE owner_id=?').run(owner.id);
          db.prepare('UPDATE credentials SET revoked_at=? WHERE owner_id=? AND revoked_at IS NULL').run(now, owner.id);
        }
      }
      db.prepare('UPDATE email_challenges SET used_at=? WHERE id=? OR owner_id=? AND used_at IS NULL').run(now, id, owner.id);
      this.store.audit(owner.id, { register: 'account.email-register', bind: 'account.email-bind', reset: 'account.password-reset' }[row.purpose], owner.id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { owner, purpose: row.purpose };
  }
  invalidate(ownerId) { this.store.db.prepare('UPDATE email_challenges SET used_at=? WHERE owner_id=? AND used_at IS NULL').run(Date.now(), ownerId); }
  close() { this.sender.close?.(); }
}
