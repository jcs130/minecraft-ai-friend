// Offline operator disposition for text lost when an owned process exited.
// Does not claim a provider result, replay the request or execute game actions.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { reviewedDiscardedResponses } = require('../world/src/neko-adapter/codingplan-bridge.cjs')
const [directory, evidenceFile, flag] = process.argv.slice(2)
if (!path.isAbsolute(directory ?? '') || !path.isAbsolute(evidenceFile ?? '') || flag !== '--discard-unreturned-text-keep-unknown') throw Error('Expected absolute state/evidence paths and --discard-unreturned-text-keep-unknown')
const root = fs.realpathSync(directory), read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'))
const status = read('status.json'), exit = read('process-exit.json'), config = read('model-config.json')
const legacyGracefulWatchdog = exit.forced === true && exit.watchdogReason === undefined && exit.exitCode === 0 &&
  status.reason === 'operator_stop' && status.current?.native?.connected === false && status.current?.model?.inFlight === false
if (status.phase !== 'stopped' || exit.pid !== status.pid || exit.forced && !legacyGracefulWatchdog || status.current?.native?.inFlight ||
    fs.existsSync(path.join(root, 'runner.lock')) || fs.existsSync(path.join(root, 'native-ledgers', status.username.toLowerCase(), 'writer.lock'))) throw Error('NEKO_MODEL_AUDIT_PROCESS_NOT_QUIESCENT')
try { process.kill(exit.pid, 0); throw Error('NEKO_MODEL_AUDIT_PROCESS_STILL_LIVE') } catch (error) { if (error.code !== 'ESRCH') throw error }
if (path.dirname(path.resolve(config.journalPath)) !== root) throw Error('NEKO_MODEL_AUDIT_FOREIGN_JOURNAL')
const rows = fs.readFileSync(config.journalPath, 'utf8').trim().split('\n').map(JSON.parse)
const bytes = fs.readFileSync(evidenceFile), evidence = JSON.parse(bytes)
if (!Number.isInteger(evidence.processPid) || evidence.processPid < 1) throw Error('NEKO_MODEL_AUDIT_PROCESS_EVIDENCE_MISSING')
try { process.kill(evidence.processPid, 0); throw Error('NEKO_MODEL_AUDIT_ORIGINAL_PROCESS_STILL_LIVE') } catch (error) { if (error.code !== 'ESRCH') throw error }
const intent = rows.find(row => row.kind === 'intent' && row.requestId === evidence.requestId)
if (!intent || !Number.isFinite(Date.parse(intent.at))) throw Error('NEKO_MODEL_AUDIT_INTENT_MISSING')
const commands = fs.readFileSync(path.join(root, 'command-results.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
if (commands.some(row => Date.parse(row.at) >= Date.parse(intent.at))) throw Error('NEKO_MODEL_AUDIT_LATER_GAME_COMMANDS')
const hash = value => createHash('sha256').update(value).digest('hex')
const audit = { at: new Date().toISOString(), kind: 'operator_audit', requestId: intent.requestId,
  disposition: 'discard_unreturned_response_allow_new_requests', originalRecordSha256: hash(JSON.stringify(intent)),
  evidencePath: evidenceFile, evidenceSha256: hash(bytes) }
const halt = rows.find(row => row.kind === 'halt' && row.requestId === intent.requestId)
if (halt) audit.originalHaltSha256 = hash(JSON.stringify(halt))
if (legacyGracefulWatchdog) audit.legacyGracefulWatchdogFlagReviewed = true
reviewedDiscardedResponses([...rows, audit])
const fd = fs.openSync(config.journalPath, 'a', 0o600)
try { fs.writeSync(fd, JSON.stringify(audit) + '\n'); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
console.log(JSON.stringify({ ok: true, requestId: intent.requestId, originalOutcome: 'unknown', replayed: false,
  cumulativeCalls: rows.filter(row => row.kind === 'intent').length, evidenceSha256: audit.evidenceSha256 }))
