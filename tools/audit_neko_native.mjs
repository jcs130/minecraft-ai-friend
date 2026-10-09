// Offline operator review only. Never sends game packets or replays an action.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { NativeLedger } = require('../world/src/neko-adapter/native-runtime.cjs')
const [directory, evidenceFile, flag] = process.argv.slice(2)
if (!path.isAbsolute(directory || '') || !path.isAbsolute(evidenceFile || '') || flag !== '--release-new-actions-keep-unknown') throw Error('Usage: audit_neko_native.mjs ABS_STATE_DIRECTORY ABS_EVIDENCE_JSON --release-new-actions-keep-unknown')
const root = fs.realpathSync(directory), config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'))
const status = JSON.parse(fs.readFileSync(path.join(root, 'status.json'), 'utf8'))
const exit = JSON.parse(fs.readFileSync(path.join(root, 'process-exit.json'), 'utf8'))
if (fs.existsSync(path.join(root, 'runner.lock')) || status.phase !== 'stopped' || status.current?.native?.inFlight || exit.forced || exit.pid !== status.pid) throw Error('NEKO_NATIVE_AUDIT_PROCESS_NOT_QUIESCENT')
try { process.kill(exit.pid, 0); throw Error('NEKO_NATIVE_AUDIT_PROCESS_STILL_LIVE') } catch (error) { if (error.code !== 'ESRCH') throw error }
const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'))
const ledger = new NativeLedger(path.join(root, 'native-ledgers'), config.username)
try {
  const audit = ledger.auditRelease({ callId: evidence.callId, fingerprint: evidence.fingerprint,
    evidencePath: evidenceFile, summary: evidence.conclusion })
  console.log(JSON.stringify({ ok: true, callId: audit.callId, originalOutcome: 'unknown',
    disposition: audit.disposition, evidenceSha256: audit.evidenceSha256, retryAutomatically: false }))
} finally { ledger.close() }
