import type { AtomSummary } from '../magic/contracts.ts'
import { extractDirection, extractNumber, matchChantFrame } from '../magic/spell-input.ts'
import { NATIVE_SPELL_ID } from '../native/contracts.ts'

export type SpokenIntent =
  | { kind: 'command'; verb: string; args: string[] }
  /** Recognizable, nonempty legacy chant frame, with parameter prose preserved.
   * This is an unresolved intent, not permission to cast or invoke fuzzy/LLM.
   * The spoken application currently replies unknown_chant without side effects. */
  | { kind: 'chant'; text: string }
  | { kind: 'conversation'; text: string }

// Verified display names: spell.irons_spellbooks.firebolt = 火焰箭;
// spell.irons_spellbooks.lightning_bolt = 落雷. These aliases select a native
// spell; its existing adapter still requires real equipment and native resources.
const NATIVE_ALIASES: Readonly<Record<string, string>> = {
  火焰弹: 'irons_spellbooks:firebolt',
  火焰箭: 'irons_spellbooks:firebolt',
  落雷: 'irons_spellbooks:lightning_bolt',
  雷电: 'irons_spellbooks:lightning_bolt',
  闪电术: 'irons_spellbooks:lightning_bolt',
}

const SIMPLE_COMMANDS: Readonly<Record<string, { verb: string; args: readonly string[] }>> = {
  取消施法: { verb: 'cancel', args: [] },
  停止咏唱: { verb: 'cancel', args: [] },
  打开技能罗盘: { verb: 'menu', args: [] },
  打开技能轮盘: { verb: 'menu', args: [] },
  打开铁魔法: { verb: 'menu', args: ['irons'] },
  打开铁魔法菜单: { verb: 'menu', args: ['irons'] },
  查看状态: { verb: 'status', args: [] },
  查看快捷技能: { verb: 'skillbar', args: [] },
  编辑快捷技能: { verb: 'menu', args: ['skillbar'] },
  打开快捷技能: { verb: 'menu', args: ['skillbar'] },
}

const trimEnding = (text: string): string => text.trim().replace(/[\s。.,，!！、;；]+$/u, '').trim()

/** Keep quoted, negated, hypothetical and explanatory speech out of execution.
 * This is a bounded phrase protocol, not a natural-language intent classifier. */
function nonCommandSpeech(text: string, ordinalParticle = false): boolean {
  return /[?？"'“”‘’「」『』《》`\r\n\0]/u.test(text) ||
    /不要|不用|不能|不想|不许|不必|不准|不得|不放|不施|不释|不使用|不咏|不开|不传送|不发动|禁止|请勿|切勿|勿|并非|不是|没有|没想|别(?:再)?(?:给我|帮我)?(?:放|用|施|释|咏|开|传|发动)/u.test(text) ||
    /怎么|怎样|如何|为何|为什么|什么|能否|是否|可否|能不能|可不可以|会不会|为啥|(?:吗|么|嘛)\s*$/u.test(text) ||
    (!ordinalParticle && /呢\s*$/u.test(text)) ||
    /如果|假如|假设|的话|例如|比如|举例|示例|例子|这句话|这个词|意思|提到|说过/u.test(text) ||
    /\b(?:not|no|never|without|cannot|what|how|why|whether)\b/i.test(text)
}

function chantBody(text: string): string | null {
  // The legacy matcher intentionally has no ASCII word boundary. Speech must
  // not mistake "chanting" or "spellbook" for a declared casting frame.
  const firstWord = /^[a-z_]+/i.exec(text)?.[0].toLowerCase()
  if (firstWord && /^(?:cast|chant|spell)/.test(firstWord) && !['cast_spell', 'cast', 'chant', 'spell'].includes(firstWord)) return null
  const framed = matchChantFrame(text)
  if (framed !== null) return framed.replace(/^[\s,:：，、]+/u, '').trim()
  // The next real TTS/ASR sample also wrote 咏唱 as 永唱. Restrict
  // these same-pronunciation forms to the leading chant marker; the full
  // following skill must still resolve and all negation gates still run.
  const spokenFrame = /^(?:永唱|泳唱|勇唱|用唱)[\s,:：，、]*(.+)$/u.exec(text)
  if (spokenFrame) return spokenFrame[1].trim()
  const added = /^(?:施放技能|施放法术|施放|释放|铁魔法)[\s,:：，、]*(.+)$/u.exec(text)
  return added ? added[1].trim() : null
}

function exactSkill(body: string, atoms: AtomSummary[]): string | null {
  const nativeBody = body.replace(/^铁魔法[\s:：]+/u, '').trim()
  if (Object.hasOwn(NATIVE_ALIASES, nativeBody)) return NATIVE_ALIASES[nativeBody]
  if (NATIVE_SPELL_ID.test(nativeBody)) return nativeBody
  const lower = body.toLowerCase()
  const exact = atoms.filter(atom => atom.id.toLowerCase() === lower || atom.name === body)
  const matches = exact.length ? exact : atoms.filter(atom => atom.words.some(word => word.toLowerCase() === lower))
  if (matches.length !== 1) return null
  const atom = matches[0]
  // Catalog-free callers retain the existing legacy compatibility. A supplied
  // archive or passive is never silently enabled or mapped via nativeHints.
  return atom.type !== 'passive' && (!atom.catalog || atom.catalog.status === 'featured') ? atom.id : null
}

function spokenPositiveNumber(text: string): number | null {
  // Validate the entire token before using the shared extractor: 十十, 二八,
  // mixed scripts and decimals must never acquire a guessed numeric meaning.
  if (!/^(?:[0-9]{1,9}|[一二两三四五六七八九]|[一二两三四五六七八九]?十[一二两三四五六七八九]?|一百)$/u.test(text)) return null
  const value = extractNumber(text)
  return value !== null && Number.isSafeInteger(value) && value > 0 ? value : null
}

function numberedWaypoint(text: string): string | null {
  // Existing mc-god door-number voice protocol, including a single ASR filler.
  // "呢" is accepted only in this complete bounded form, never a general question.
  const match = /^([0-9一二两三四五六七八九十]{1,3})(?:号|点|号点)?[哎呀啊呢哦了]?$/u.exec(text)
  if (!match || (/^[0-9]+$/.test(match[1]) && match[1].length > 2)) return null
  const value = spokenPositiveNumber(match[1])
  return value !== null && value <= 99 ? String(value) : null
}

function exactTeleport(body: string, atoms: AtomSummary[]): SpokenIntent | null {
  const match = /^(.+?)\s*[,，:：]?\s*向(东南|东北|西南|西北|东|南|西|北)\s*([0-9一二两三四五六七八九十百]+)\s*格$/u.exec(body)
  if (!match || exactSkill(match[1].trim(), atoms) !== 'tp') return null
  const distance = spokenPositiveNumber(match[3]), direction = extractDirection(match[2])
  if (distance === null || direction === null) return null
  // No clamping/defaults here. The same cast parameter validator enforces the
  // live skill's limits and charges its normal resources, including rejections.
  return { kind: 'command', verb: 'cast', args: ['tp', `distance=${distance}`, `direction=${direction}`] }
}

/** Parse only whole utterances or an explicit chant frame. Conversation results
 * must not be fed through a second keyword/sniff-based execution fallback. */
export function parseSpokenIntent(text: string, atoms: AtomSummary[]): SpokenIntent {
  const original = text.trim()
  const conversation = (): SpokenIntent => ({ kind: 'conversation', text: original })
  if (!original || original.length > 2048) return conversation()
  let utterance = trimEnding(original)
  // 女神在上 is itself an existing anime chant frame, not a vocative to strip.
  if (chantBody(utterance) === null) {
    utterance = utterance.replace(/^(?:灯语女神|女神|灯语)[\s,:：，、]*/u, '').trim()
  }
  utterance = utterance.replace(/^请(?!问)/u, '').trim()
  const waypoint = numberedWaypoint(utterance)
  if (!utterance || nonCommandSpeech(original, waypoint !== null) || nonCommandSpeech(utterance, waypoint !== null)) return conversation()
  if (waypoint) return { kind: 'command', verb: 'goto', args: [waypoint] }

  const simple = Object.hasOwn(SIMPLE_COMMANDS, utterance) ? SIMPLE_COMMANDS[utterance] : undefined
  if (simple) return { kind: 'command', verb: simple.verb, args: [...simple.args] }
  const slotEdit = /^(?:第)?([1-8一二三四五六七八])号快捷(?:技能|槽)设为\s*(.+)$/u.exec(utterance)
  if (slotEdit) {
    const slot = spokenPositiveNumber(slotEdit[1]), skill = exactSkill(slotEdit[2].trim(), atoms)
    if (slot && skill) return { kind: 'command', verb: 'skillbar', args: ['set', String(slot), skill] }
  }
  const slotClear = /^清空(?:第)?([1-8一二三四五六七八])号快捷(?:技能|槽)$/u.exec(utterance)
  if (slotClear) return { kind: 'command', verb: 'skillbar', args: ['clear', String(spokenPositiveNumber(slotClear[1]))] }
  const quick = /^快捷技能设为\s*(.+)$/u.exec(utterance)?.[1].trim()
  if (quick) {
    const skill = exactSkill(quick, atoms)
    if (skill) return { kind: 'command', verb: 'skillbar', args: ['set', '1', skill] }
  }
  const destination = /^传送到\s*(.+)$/u.exec(utterance)?.[1].trim()
  if (destination && !/[，,。;；]/u.test(destination) && !/然后|之后|接着|并且|否则/u.test(destination))
    return { kind: 'command', verb: 'goto', args: [destination] }

  const framed = chantBody(utterance)
  const teleport = exactTeleport(framed ?? utterance, atoms)
  if (teleport) return teleport
  // Real local Paraformer samples of synthetic "咏唱烟花术" wrote 烟花树
  // and 用唱烟花束 (captured transcript SHA-256 03fc9c28…47ec6).
  // Correct only this exact body after a declared chant frame. Bare mentions,
  // negation/question gates, catalog restrictions and cast authorization remain.
  const corrected = framed === '烟花树' || framed === '烟花束' ? '烟花术' : framed
  const skill = exactSkill(corrected ?? utterance, atoms)
  if (skill) return { kind: 'command', verb: 'cast', args: [skill] }
  // Preserve legacy anime framing verbatim. Added prefixes are normalized once
  // here, so callers never have to guess which matcher accepts chant.text.
  if (!framed) return conversation()
  const legacyText = matchChantFrame(utterance) !== null ? utterance :
    `施法：${utterance.startsWith('铁魔法') ? utterance : framed}`
  return { kind: 'chant', text: legacyText }
}
