'use strict'
// Real SVC 2.6.x authentication and audio routing. Test audio is encoded Opus
// silence, never a microphone recording. Fixture teleports are QA-only.
const fs = require('node:fs'), path = require('node:path'), dgram = require('node:dgram')
const crypto = require('node:crypto'), assert = require('node:assert/strict')
const mineflayer = require('mineflayer')
const { attachNativeBody, attachOfflineLogin } = require('../world/src/native-sdk/index.cjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const CHANNELS = ['request_secret', 'secret', 'update_state', 'state', 'states', 'remove_state',
  'add_group', 'remove_group', 'create_group', 'set_group', 'joined_group', 'leave_group', 'add_category', 'remove_category']
  .map(name => `voicechat:${name}`)

const vi = value => {
  const bytes = []
  do { let b = value & 127; value >>>= 7; if (value) b |= 128; bytes.push(b) } while (value)
  return Buffer.from(bytes)
}
const uuidBytes = id => Buffer.from(id.replaceAll('-', ''), 'hex')
const uuidText = b => { const t = b.toString('hex'); return `${t.slice(0, 8)}-${t.slice(8, 12)}-${t.slice(12, 16)}-${t.slice(16, 20)}-${t.slice(20)}` }
class Reader {
  constructor (b) { this.b = b; this.p = 0 }
  take (n) { assert.ok(Number.isInteger(n) && n >= 0 && this.p + n <= this.b.length); const v = this.b.subarray(this.p, this.p + n); this.p += n; return v }
  byte () { return this.take(1)[0] }
  int () { return this.take(4).readInt32BE() }
  long () { return this.take(8).readBigInt64BE() }
  float () { return this.take(4).readFloatBE() }
  double () { return this.take(8).readDoubleBE() }
  variable () { let n = 0; for (let i = 0; i < 5; i++) { const b = this.byte(); n += (b & 127) * 2 ** (7 * i); if (!(b & 128)) return n } throw Error('VOICE_VARINT') }
  array (limit) { const n = this.variable(); assert.ok(n <= limit); return this.take(n) }
  text (limit) { return new TextDecoder('utf8', { fatal: true }).decode(this.array(limit)) }
  uuid () { return uuidText(this.take(16)) }
  end () { assert.equal(this.p, this.b.length) }
}
function readSecret (data) {
  const r = new Reader(data)
  const v = { key: Buffer.from(r.take(16)), port: r.int(), uuid: r.uuid(), codec: r.byte(), mtu: r.int(),
    range: r.double(), keepAliveMs: r.int(), groupsEnabled: !!r.byte(), host: r.text(32767), recordingAllowed: !!r.byte() }
  r.end(); return v
}
function seal (plain, key) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-128-gcm', key, iv)
  return Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()])
}
function open (encrypted, key) {
  assert.ok(encrypted.length >= 29)
  const c = crypto.createDecipheriv('aes-128-gcm', key, encrypted.subarray(0, 12))
  c.setAuthTag(encrypted.subarray(-16))
  return Buffer.concat([c.update(encrypted.subarray(12, -16)), c.final()])
}
function readAudio (type, r) {
  const value = { type, channelId: r.uuid(), sender: r.uuid() }
  if (type === 4) value.position = { x: r.double(), y: r.double(), z: r.double() }
  value.opus = Buffer.from(r.array(1275)); value.sequence = r.long()
  if (type !== 3) value.range = r.float()
  const flags = r.byte(); value.whisper = !!(flags & 1)
  if (flags & 2) value.category = r.text(64)
  r.end(); return value
}
class TestVoice {
  constructor (bot, host, port) {
    this.bot = bot; this.host = host; this.port = port; this.audio = []; this.sequence = 0n
    this.secret = null; this.udp = null; this.connected = false
  }
  async connect () {
    let timer
    await new Promise((resolve, reject) => {
      const fail = error => { clearTimeout(timer); this.bot._client.removeListener('custom_payload', receive); reject(error) }
      const receive = p => {
        if (p.channel !== 'voicechat:secret') return
        try {
          this.secret = readSecret(p.data)
          assert.equal(this.secret.uuid, this.bot._client.uuid.toLowerCase())
          assert.equal(this.secret.port, this.port)
          assert.equal(this.secret.host, `${this.host}:${this.port}`)
          clearTimeout(timer); this.bot._client.removeListener('custom_payload', receive); resolve()
        } catch (error) { fail(error) }
      }
      this.bot._client.on('custom_payload', receive)
      timer = setTimeout(() => fail(Error('VOICE_SECRET_TIMEOUT')), 12000)
      this.bot._client.write('custom_payload', { channel: 'minecraft:register', data: Buffer.from(CHANNELS.join('\0')) })
      const version = Buffer.alloc(4); version.writeInt32BE(20)
      this.bot._client.write('custom_payload', { channel: 'voicechat:request_secret', data: version })
    })
    this.udp = dgram.createSocket('udp4')
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error('VOICE_UDP_AUTH_TIMEOUT')), 10000)
      this.udp.on('error', reject)
      this.udp.on('message', data => {
        try {
          const wire = new Reader(data); assert.equal(wire.byte(), 255)
          const plain = open(wire.array(2048), this.secret.key); wire.end()
          const r = new Reader(plain), type = r.byte()
          if (type === 6) { r.end(); this.send(9) }
          else if (type === 8) { r.end(); this.send(8) }
          else if (type === 10) { r.end(); this.connected = true; this.disabled(false); clearTimeout(timer); resolve() }
          else if ([2, 3, 4].includes(type)) { const a = readAudio(type, r); if (this.audio.length < 500) this.audio.push(a) }
          else if (type === 7) { this.send(7, r.take(24)); r.end() }
        } catch (error) { this.error = error.message; reject(error) }
      })
      this.udp.connect(this.port, this.host, () => this.send(5, Buffer.concat([uuidBytes(this.secret.uuid), this.secret.key])))
    }).finally(() => clearTimeout(timer))
    return { uuid: this.secret.uuid, range: this.secret.range, groupsEnabled: this.secret.groupsEnabled }
  }
  send (type, body = Buffer.alloc(0)) {
    const encrypted = seal(Buffer.concat([Buffer.from([type]), body]), this.secret.key)
    this.udp.send(Buffer.concat([Buffer.from([255]), uuidBytes(this.secret.uuid), vi(encrypted.length), encrypted]))
  }
  disabled (value) { this.bot._client.write('custom_payload', { channel: 'voicechat:update_state', data: Buffer.from([value ? 1 : 0]) }) }
  async silence (whisper = false) {
    for (let i = 0; i < 6; i++) {
      const opus = Buffer.from([0xf8, 0xff, 0xfe]), tail = Buffer.alloc(9)
      tail.writeBigInt64BE(this.sequence++); tail[8] = whisper ? 1 : 0
      this.send(1, Buffer.concat([vi(opus.length), opus, tail])); await sleep(25)
    }
    await sleep(150)
  }
  close () {
    if (this.connected) this.disabled(true)
    this.connected = false
    if (this.udp) { try { this.udp.close() } catch (e) { if (e.code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') throw e } }
    this.secret?.key.fill(0)
  }
}

async function run (c) {
  assert.ok(['127.0.0.1', '192.168.3.163'].includes(c.host) && [28977, 28979].includes(c.port))
  assert.equal(c.voiceHost, c.port === 28979 ? '127.0.0.1' : '192.168.3.163')
  assert.equal(c.voicePort, c.port === 28979 ? 28980 : 28989)
  const qa = c.port === 28979
  assert.ok(path.isAbsolute(c.report) && !fs.existsSync(c.report))
  if (qa) assert.ok(path.resolve(c.consoleFile).startsWith(path.resolve('E:/QiandengJiSocietyLab/research/proximity-voice-20261012/qa') + path.sep))
  const report = { ok: false, checks: {}, scope: qa ? 'isolated routing with fixture teleports' : 'production own-account handshake only',
    paidModelCalls: 0, microphoneCaptured: false, audiblePlaybackTested: false, secretsRedacted: true }
  const bodies = [], voices = []
  const console = command => fs.appendFileSync(c.consoleFile, JSON.stringify({ command }) + '\n')
  async function join (name, credentialPath) {
    const bot = mineflayer.createBot({ username: name, auth: 'offline', version: '1.21.1', host: c.host, port: c.port, hideErrors: false })
    const body = { bot, sdk: attachNativeBody(bot, { ledgerDir: path.join(path.dirname(c.report), 'voice-smoke-ledgers'),
      controllerId: 'bounded-voice-smoke', account: name }) }
    bodies.push(body)
    bot.on('error', error => { report.gameError = error.message })
    let login
    if (credentialPath) login = attachOfflineLogin(bot, { credentialPath, username: name, query: () => body.sdk.capabilities() })
    let timer
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error('VOICE_GAME_LOGIN_TIMEOUT')), 35000)
      bot.once('spawn', resolve); bot.once('kicked', reason => reject(Error('VOICE_GAME_KICKED')))
    }).finally(() => clearTimeout(timer))
    if (login) { const end = Date.now() + 35000; while (!login.ready() && Date.now() < end) await sleep(100); assert.ok(login.ready()) }
    const cap = await body.sdk.capabilities(); assert.ok(cap.ok)
    await sleep(500)
    return body
  }
  try {
    const a = await join(c.username || 'MawMotionQA', c.loginFile)
    const va = new TestVoice(a.bot, c.voiceHost, c.voicePort); voices.push(va)
    const state = await va.connect()
    report.checks.same_player_secret = state.uuid === a.bot._client.uuid
    report.checks.authenticated_udp = va.connected
    report.checks.native_range_and_proximity = state.range === 32 && !state.groupsEnabled
    if (qa) {
      const b = await join('MawVoicePeer'), f = await join('MawVoiceFar')
      const vb = new TestVoice(b.bot, c.voiceHost, c.voicePort), vf = new TestVoice(f.bot, c.voiceHost, c.voicePort)
      voices.push(vb, vf); await vb.connect(); await vf.connect()
      console('tp MawMotionQA 0.5 -60 0.5'); console('tp MawVoicePeer 3.5 -60 0.5'); console('tp MawVoiceFar 96.5 -60 0.5')
      await sleep(1800)
      report.positions = bodies.map(({ bot }) => ({ name: bot.username, uuid: bot._client.uuid, position: bot.entity.position }))
      assert.ok(a.bot.entity.position.distanceTo(b.bot.entity.position) < 8)
      assert.ok(a.bot.entity.position.distanceTo(f.bot.entity.position) > 64)
      await va.silence()
      report.checks.nearby_audio_received = vb.audio.length > 0
      report.checks.sender_uuid_and_bytes = vb.audio.every(p => p.sender === state.uuid && p.type === 2 && p.range === 32 && p.opus.equals(Buffer.from([0xf8, 0xff, 0xfe])))
      report.checks.outside_radius_no_audio = vf.audio.length === 0
      vb.audio = []; await va.silence(true)
      report.checks.whisper_eight_block_range = vb.audio.length > 0 && vb.audio.every(p => p.whisper && p.range === 8)
      vb.disabled(true); await sleep(400); vb.audio = []; await va.silence()
      report.checks.disabled_listener_no_audio = vb.audio.length === 0
      vb.disabled(false); await sleep(300); vb.audio = []; await va.silence()
      report.checks.listener_reenabled = vb.audio.length > 0
      console('gamemode creative MawVoicePeer'); console('execute in minecraft:the_nether run tp MawVoicePeer 3.5 80 0.5')
      await sleep(2000); vb.audio = []; await va.silence()
      assert.equal(b.bot.game.dimension, 'the_nether')
      report.checks.other_dimension_no_audio = vb.audio.length === 0
      report.checks.no_protocol_errors = voices.every(v => !v.error)
    }
    assert.ok(Object.values(report.checks).every(Boolean), JSON.stringify(report.checks))
    report.ok = true
  } finally {
    for (const v of voices) v.close()
    for (const { bot, sdk } of bodies) { sdk.close(); bot.quit('Voice smoke completed') }
    await sleep(750)
    report.finishedAt = new Date().toISOString()
    fs.writeFileSync(c.report, JSON.stringify(report, null, 2))
  }
  return report
}
module.exports = { Reader, readSecret, readAudio, seal, open, TestVoice, run }
if (require.main === module) run(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')))
  .then(r => { console.log(JSON.stringify({ ok: r.ok, checks: r.checks, paidModelCalls: 0 })) })
  .catch(error => { console.error(error.message); process.exitCode = 1 })
