// test-social —— 女神传声 & 信差纯函数单测（node --experimental-strip-types test-social.mts）
import { parseVoice, matchShout, dist3d, radiusFor, RateLimiter, parseSocialCommand, voiceLine } from './src/mc-social.ts'

let failures = 0
let checks = 0
function ok(cond: boolean, label: string) {
  checks++
  if (!cond) { failures++; console.error(`FAIL ${label}`) }
}

// ── parseVoice：说/喊/悄悄 + 英文别名 + 冒号变体 ──
{
  const a = parseVoice('说：大家好，我是桐人')
  ok(a !== null && a.mode === 'say' && a.text === '大家好，我是桐人', `parseVoice say ${JSON.stringify(a)}`)
  const b = parseVoice('喊 着火了！！')
  ok(b !== null && b.mode === 'shout' && b.text === '着火了！！', `parseVoice shout ${JSON.stringify(b)}`)
  const c = parseVoice('悄悄：跟我来')
  ok(c !== null && c.mode === 'whisper' && c.text === '跟我来', `parseVoice whisper ${JSON.stringify(c)}`)
  const d = parseVoice('whisper follow me')
  ok(d !== null && d.mode === 'whisper' && d.text === 'follow me', `parseVoice en-alias ${JSON.stringify(d)}`)
  const e = parseVoice('SHOUT big news')
  ok(e !== null && e.mode === 'shout' && e.text === 'big news', `parseVoice en-upper ${JSON.stringify(e)}`)
  ok(parseVoice('普通的愿望') === null, 'parseVoice rejects non-voice')
  ok(parseVoice('说') === null, 'parseVoice rejects bare verb (no text)')
  ok(parseVoice('/mail read') === null, 'parseVoice rejects slash cmd')
}

// ── matchShout：公屏喊话（真人平权通道）──
{
  ok(matchShout('喊：小心苦力怕') === '小心苦力怕', 'matchShout cn')
  ok(matchShout('喊 救命') === '救命', 'matchShout cn-space')
  ok(matchShout('!!!快跑') === '快跑', 'matchShout bangs')
  ok(matchShout('！！围着火堆') === '围着火堆', 'matchShout fullwidth-bangs')
  ok(matchShout('你好') === null, 'matchShout plain chat ignored')
  ok(matchShout('!一个感叹号不算') === null, 'matchShout single bang ignored')
}

// ── dist3d / radiusFor ──
{
  const o = { x: 0, y: 0, z: 0 }
  const p = { x: 3, y: 4, z: 0 }
  ok(Math.abs(dist3d(o, p) - 5) < 1e-9, 'dist3d 3-4-5')
  const cfg = { sayRadius: 48, shoutRadius: 96, whisperRadius: 6 }
  ok(radiusFor('say', cfg) === 48 && radiusFor('shout', cfg) === 96 && radiusFor('whisper', cfg) === 6, 'radiusFor')
}

// ── RateLimiter：10 封/分钟滑动窗口 ──
{
  const l = new RateLimiter(10, 60_000)
  const t0 = 1_000_000
  for (let i = 0; i < 10; i++) ok(l.allow(t0 + i * 100), `limiter allows #${i + 1}`)
  ok(!l.allow(t0 + 1_500), 'limiter blocks 11th within window')
  ok(l.allow(t0 + 60_200), 'limiter recovers after window slides')
  const l2 = new RateLimiter(2, 1_000)
  l2.allow(0); l2.allow(100)
  const retry = l2.retryInSec(200)
  ok(retry === 1, `retryInSec ${retry}s`)
}

// ── parseSocialCommand ──
{
  const a = parseSocialCommand('/mail send Kirito 晚上一起挖矿？')
  ok(a?.kind === 'mail-send' && a.to === 'Kirito' && a.body === '晚上一起挖矿？', `mail-send ${JSON.stringify(a)}`)
  const b = parseSocialCommand('/mail read')
  ok(b?.kind === 'mail-read', 'mail-read')
  const c = parseSocialCommand('/friend add MengMeng')
  ok(c?.kind === 'friend-add' && c.to === 'MengMeng', 'friend-add')
  const d = parseSocialCommand('/friend accept Kirito')
  ok(d?.kind === 'friend-accept', 'friend-accept')
  const e = parseSocialCommand('/friend list')
  ok(e?.kind === 'friend-list', 'friend-list')
  const f = parseSocialCommand('/friend remove Naruto')
  ok(f?.kind === 'friend-remove', 'friend-remove')
  const g = parseSocialCommand('/friend')
  ok(g?.kind === 'friend-list', 'bare /friend = list')
  ok(parseSocialCommand('mail send x') === null, 'no leading slash rejected')
  ok(parseSocialCommand('/mail send') === null, 'mail-send without body rejected')
  const h = parseSocialCommand('/MAIL READ')
  ok(h?.kind === 'mail-read', 'case-insensitive')
  const i = parseSocialCommand('/mail send Naruto\n明天去下界\n记得带盔甲')
  ok(i?.kind === 'mail-send' && i.body.includes('\n'), 'multiline body kept')
}

// ── voiceLine：三档文案与颜色 ──
{
  const s = voiceLine('桐人', 'say', '你好')
  ok(s.color === 'white' && !s.italic && s.text === '[桐人] 你好', 'voiceLine say')
  const sh = voiceLine('桐人', 'shout', '集合！')
  ok(sh.color === 'gold' && sh.text.includes('喊道'), 'voiceLine shout')
  const w = voiceLine('桐人', 'whisper', '别出声')
  ok(w.color === 'gray' && w.italic && w.text.includes('低语'), 'voiceLine whisper')
}

console.log(failures === 0 ? `\ntest-social: ${checks} checks passed` : `\ntest-social: ${failures}/${checks} FAILED`)
process.exit(failures === 0 ? 0 : 1)
