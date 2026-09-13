/** Local Agent CLI mailbox. Claims persist across crashes; actions are never replayed. */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SKILL_ACTOR } from './irons-spell-client.ts'

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export interface SkillRequest { id: string; actor: string; command: string; submittedAt: number; expiresAt: number }

export function createSkillCliQueue(root: string, execute: (request: SkillRequest) => Promise<Record<string, unknown>>) {
  const requests = join(root, 'requests'), processing = join(root, 'processing'), results = join(root, 'results'), duplicates = join(root, 'duplicates')
  for (const path of [requests, processing, results, duplicates]) mkdirSync(path, { recursive: true })
  let busy = false
  const publish = (id: string, value: Record<string, unknown>) => {
    const temp = join(results, `${id}.tmp`)
    writeFileSync(temp, JSON.stringify({ requestId: id, finishedAt: Date.now(), ...value }) + '\n', 'utf8')
    renameSync(temp, join(results, `${id}.json`))
  }
  // A former process may have executed an action before it stopped. Mark uncertain;
  // do not infer failure and repeat resource-consuming actions on startup.
  for (const id of readdirSync(processing).filter(name => ID.test(name))) {
    if (!existsSync(join(results, `${id}.json`))) publish(id, { ok: false, code: 'outcome_unknown', summary: '世界进程曾在执行中退出；请查询角色状态，不要自动重发。' })
  }
  return {
    async poll() {
      if (busy) return
      busy = true
      try {
        for (const id of readdirSync(requests).filter(name => ID.test(name) && existsSync(join(requests, name, 'request.json'))).sort().slice(0, 8)) {
          const source = join(requests, id)
          if (!existsSync(join(source, 'request.json'))) continue
          if (existsSync(join(processing, id))) {
            // A duplicate manually submitted ID cannot block later requests, or
            // overwrite the already claimed action/receipt.
            renameSync(source, join(duplicates, `${id}-${Date.now()}`))
            continue
          }
          // Only a complete immutable request directory is claimed.
          renameSync(source, join(processing, id))
          if (existsSync(join(results, `${id}.json`))) continue
          try {
            const request: SkillRequest = JSON.parse(readFileSync(join(processing, id, 'request.json'), 'utf8'))
            if (request.id !== id || !SKILL_ACTOR.test(request.actor) ||
                typeof request.command !== 'string' || !request.command.trim() || request.command.length > 1024 || /[\r\n\0]/.test(request.command) ||
                !Number.isFinite(request.submittedAt) || !Number.isFinite(request.expiresAt) ||
                request.expiresAt < request.submittedAt || request.expiresAt - request.submittedAt > 60_000) {
              publish(id, { ok: false, code: 'invalid_request', summary: '技能请求格式无效。' }); continue
            }
            const now = Date.now()
            if (now > request.expiresAt || request.submittedAt > now + 5_000) {
              publish(id, { ok: false, code: 'expired', summary: '请求已过期，未执行。' }); continue
            }
            const result = await execute(request)
            publish(id, { actor: request.actor, ...result })
          } catch {
            publish(id, { ok: false, code: 'outcome_unknown', summary: '未能完成执行回执；请查询角色状态，不要自动重发。' })
          }
        }
      } finally { busy = false }
    },
  }
}
