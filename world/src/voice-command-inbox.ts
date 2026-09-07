import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { PlayerReceipt } from './application/player-command-ports.ts'

const MAX_AGE = 120_000
const MAX_SKEW = 5_000
const NAME = /^[A-Za-z0-9_]{1,16}$/
const ID = /^[A-Za-z0-9_-]{1,100}$/
type Transcript = { id: string; player: string; text: string; ts: number; recordedAt: number; recordingEndedAt: number }

/** Only the local recorder/ASR volume is trusted to assert a player identity. */
export function validateTranscript(value: unknown, filename: string, now: number,
  allowed: ReadonlySet<string>, online: ReadonlySet<string>): Transcript | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (v.schema !== 2) return null
  const id = filename.endsWith('.json') ? filename.slice(0, -5) : ''
  if (!ID.test(id) || v.wav !== `${id}.wav` || typeof v.player !== 'string' || !NAME.test(v.player)
    || !allowed.has(v.player) || !online.has(v.player)) return null
  if (typeof v.text !== 'string' || !v.text.trim() || v.text.length > 2048 || /[\r\n\0]/.test(v.text)) return null
  if (typeof v.ts !== 'number' || typeof v.recordedAt !== 'number' || typeof v.recordingEndedAt !== 'number'
    || typeof v.emittedAt !== 'number' || ![v.ts,v.recordedAt,v.recordingEndedAt,v.emittedAt].every(n => Number.isSafeInteger(n) && n > 0)
    || v.recordedAt > v.recordingEndedAt || v.recordingEndedAt > v.emittedAt || v.emittedAt > v.ts
    || now - v.recordedAt > MAX_AGE || v.recordedAt - now > MAX_SKEW
    || now - v.ts > MAX_AGE || v.ts - now > MAX_SKEW) return null
  return { id, player: v.player, text: v.text.trim(), ts: v.ts, recordedAt: v.recordedAt, recordingEndedAt: v.recordingEndedAt }
}

export function createVoiceCommandInbox(ports: {
  directory: string; receipts: string; allowed: ReadonlySet<string>
  online(): ReadonlySet<string>; now(): number
  execute(actor: string, text: string, context: { recordedAt: number; recordingEndedAt: number }): Promise<PlayerReceipt>
  observed(actor: string, text: string): void
  log(message: string): void
}) {
  let polling = false, journalReady = true, inputReady = true
  const seen = new Map<string, number>()
  let rows: Record<string, unknown>[] = []
  function compact() {
    const temporary = `${ports.receipts}.tmp`
    writeFileSync(temporary, rows.map(item => JSON.stringify(item)).join('\n') + (rows.length ? '\n' : ''), 'utf8')
    renameSync(temporary, ports.receipts)
  }
  try {
    if (existsSync(ports.receipts)) {
      rows = readFileSync(ports.receipts, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
      rows = rows.filter(row => typeof row.at === 'number' && ports.now() - row.at < MAX_AGE + MAX_SKEW)
      for (const row of rows) if (typeof row.id === 'string' && typeof row.at === 'number') seen.set(row.id, row.at)
      compact()
    }
  } catch { journalReady = false; ports.log('[voice] receipt journal unreadable; casting input disabled') }
  function record(row: Record<string, unknown>) {
    // A claim is persisted BEFORE execution. A crash may lose a chant, but never
    // retries an uncertain spell automatically. No raw speech is stored here.
    try {
      rows.push(row)
      if (rows.length > 2000) {
        rows = rows.filter(item => typeof item.at === 'number' && ports.now() - item.at < MAX_AGE + MAX_SKEW)
        compact()
      } else appendFileSync(ports.receipts, JSON.stringify(row) + '\n', 'utf8')
    } catch (error) { journalReady = false; throw error }
  }
  async function poll(): Promise<void> {
    if (polling || !journalReady) return
    polling = true
    try {
      for (const [id, at] of seen) if (ports.now() - at > MAX_AGE + MAX_SKEW) seen.delete(id)
      let names: string[]
      try { names = await readdir(ports.directory); inputReady = true }
      catch { inputReady = false; return }
      const files = names.filter(f => /^[A-Za-z0-9_-]{1,100}\.json$/.test(f)).sort()
      for (const filename of files) {
        const path = join(ports.directory, filename), id = filename.slice(0, -5)
        try {
          if (seen.has(id)) { await rm(path, { force: true }); continue }
          const size = (await stat(path)).size
          let input: unknown = null
          if (size <= 16384) {
            const raw = await readFile(path, 'utf8')
            try { input = JSON.parse(raw) } catch { /* Malformed input is rejected below, not a journal failure. */ }
          }
          const transcript = validateTranscript(input, filename, ports.now(), ports.allowed, ports.online())
          if (!transcript) { await rm(path, { force: true }); ports.log(`[voice] rejected input ${id}`); continue }
          record({ id, actor: transcript.player, kind: 'claimed', at: ports.now() })
          seen.set(id, ports.now())
          await rm(path, { force: true }).catch(() => { inputReady = false })
          try { ports.observed(transcript.player, transcript.text) }
          catch { ports.log(`[voice] transcript display unavailable ${id}`) }
          let result: PlayerReceipt
          try { result = await ports.execute(transcript.player, transcript.text, { recordedAt: transcript.recordedAt, recordingEndedAt: transcript.recordingEndedAt }) }
          catch { result = { kind: 'error', ok: false, code: 'outcome_unknown' } }
          const row: Record<string, unknown> = { id, actor: transcript.player, at: ports.now() }
          for (const key of ['kind', 'verb', 'ok', 'code', 'skillId', 'manaLeft'])
            if (['string', 'boolean', 'number'].includes(typeof result[key])) row[key] = result[key]
          record(row)
        } catch (error) {
          // Transient queue I/O can recover on the next poll; a failed journal
          // is different and remains closed until repaired/restarted.
          if ((error as { code?: string })?.code === 'ENOENT') continue
          inputReady = false
          ports.log(`[voice] input failed ${id}: ${error instanceof Error ? error.message : String(error)}`)
          break
        }
      }
    } finally { polling = false }
  }
  return { poll, status: () => ({ schema: 1, ready: journalReady && inputReady, modelRequired: false }) }
}
