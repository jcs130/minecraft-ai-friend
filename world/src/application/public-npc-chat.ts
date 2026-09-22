/** Candidate identities and transport for the existing NPC inbox. No model or game executor. */
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { publicFallback, type Intent } from './jev-intent.ts'

export type PublicNpc = { key: string; display: string; calls: string[]; profession: string; topics: string[]; revision: string }
const ID = /^[a-z0-9_-]{1,64}$/

export function publicNpcs(document: unknown): PublicNpc[] {
  const rows = Array.isArray(document) ? document : (document as any)?.villagers
  if (!Array.isArray(rows)) return []
  const result: PublicNpc[] = [], seen = new Set<string>()
  for (const v of rows) {
    if (!v || !ID.test(v.key) || !/^[A-Za-z0-9_.+-]{1,64}$/.test(v.tag) || seen.has(v.key) || v.alive === false ||
        typeof v.display !== 'string' || !v.display || !Array.isArray(v.calls) || !v.calls.every((x: unknown) => typeof x === 'string')) continue
    seen.add(v.key)
    const fields = [v.key, v.tag, v.display, v.calls, v.profession ?? '', v.entityBinding?.uuid ?? '', v.entityBinding?.dimension ?? 'minecraft:overworld']
    result.push({ key: v.key, display: v.display.slice(0, 64), calls: v.calls.slice(0, 8).map((x: string) => x.slice(0, 32)),
      profession: String(v.profession ?? '').slice(0, 48), topics: (Array.isArray(v.topics) ? v.topics : []).flatMap((t: any) => Array.isArray(t?.kw) ? t.kw : [])
        .filter((x: unknown) => typeof x === 'string').slice(0, 8).map((x: string) => x.slice(0, 24)),
      revision: createHash('sha256').update(JSON.stringify(fields)).digest('hex') })
    if (result.length >= 48) break
  }
  return result
}

export function publicTarget(text: string, decision: Intent, npcs: PublicNpc[], others: string[], oldGate: boolean): string | null {
  if (decision.route === 'npc') return npcs.some(n => n.key === decision.npcKey) ? decision.npcKey! : null
  if (['reply', 'prayer'].includes(decision.route)) return 'goddess'
  if (decision.route !== 'uncertain') return null
  const t = text.trim()
  if (/^(?:灯语女神|女神|灯语|Goddess)(?:[\s,:：，、]|[你您])/i.test(t) || /^(?:问|祈愿)[：:]/.test(t)) return 'goddess'
  // Only an unambiguous direct address survives classifier failure. Mentioning
  // a person elsewhere is not authority to select or impersonate that person.
  const named = npcs.filter(n => [n.display, ...n.calls].some(name => name && t.startsWith(name) &&
    (t.length === name.length || /^[\s,:：，、你您]/u.test(t.slice(name.length)))))
  if (named.length) return named.length === 1 ? named[0].key : null
  return publicFallback(text, others, oldGate) ? 'goddess' : null
}

export function enqueuePublicNpc(path: string, npc: PublicNpc, speaker: string, text: string, createdAt: number, now = Date.now()) {
  if (!/^[A-Za-z0-9_\u4e00-\u9fff]{1,16}$/.test(speaker) || !text.trim() || text.length > 512 ||
      /[\u0000-\u001f]/u.test(text) || !Number.isFinite(createdAt) || now < createdAt || now - createdAt > 5000) return false
  const row = { schema: 1, via: 'public-routed', eventId: randomUUID(), createdAt, speaker, text,
    npcKey: npc.key, profileRevision: npc.revision }
  appendFileSync(path, JSON.stringify(row) + '\n')
  return true
}
