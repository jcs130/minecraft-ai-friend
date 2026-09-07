import { qwenpawHeaders } from '../qwenpaw-auth.ts'
import type { ModelProvider, ModelReply, ModelRequest, ModelUsage } from './model-provider.ts'
import { DEFAULT_MODEL_PROVIDER_INFO } from './provider-info.ts'

export interface QwenpawProviderOptions {
  /** Preserve the disabled saga/evolution consumers' historical header contract. */
  legacyHeaders?: boolean
  /** God includes up to 200 response characters; the two legacy callers omit them. */
  includeChatErrorBody?: boolean
  fetch?: typeof globalThis.fetch
  headers?: (roleId: string) => Record<string, string>
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
  timeoutSignal?: (milliseconds: number) => AbortSignal
}

/** Last formal message only; reasoning/tool messages never become the reply. */
export function parseQwenpawSse(text: string): ModelReply {
  let messageId: string | null = null
  let usage: ModelUsage | undefined
  const pending: Record<string, { delta: string; full: string }> = Object.create(null)
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    const body = line.slice(5).trim()
    if (!body) continue
    let event: any
    try { event = JSON.parse(body) } catch { continue }
    if (!event || typeof event !== 'object') continue
    if (event.type === 'turn_usage' && event.usage && typeof event.usage === 'object') {
      usage = event.usage as ModelUsage
      continue
    }
    if (event.object === 'message') {
      if (event.type === 'message') messageId = event.id
      continue
    }
    if (event.object === 'content' && typeof event.msg_id === 'string') {
      const fragment = String(event.data?.text ?? event.text ?? '')
      if (!fragment) continue
      const slot = (pending[event.msg_id] ??= { delta: '', full: '' })
      if (event.delta === false) slot.full = fragment
      else slot.delta += fragment
    }
  }
  const selected = messageId ? pending[messageId] : undefined
  return { text: selected ? selected.delta || selected.full : '', ...(usage ? { usage } : {}) }
}

/** Historical task result contract: text segments of the final output message. */
export function extractQwenpawTaskText(result: unknown): string {
  try {
    const output = (result as any)?.output
    if (!Array.isArray(output) || !output.length) return ''
    const content = output[output.length - 1]?.content
    if (!Array.isArray(content)) return ''
    return content.filter((item: any) => item && item.type === 'text' && typeof item.text === 'string')
      .map((item: any) => item.text).join('\n').trim()
  } catch { return '' }
}

function payload(request: ModelRequest) {
  const content: { type: string; text?: string; image_url?: string }[] = []
  for (const image of request.images ?? []) content.push({ type: 'image', image_url: image })
  content.push({ type: 'text', text: request.prompt })
  return { channel: 'console', user_id: request.userId, session_id: request.sessionId,
    input: [{ role: 'user', content }] }
}

/** Keeps the existing QwenPaw HTTP/SSE/task behavior; never retries or falls back itself. */
export function createQwenpawProvider(chatUrl: string, options: QwenpawProviderOptions = {}): ModelProvider {
  const send = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
  const timeout = options.timeoutSignal ?? AbortSignal.timeout
  const headers = options.headers ?? (options.legacyHeaders
    ? (roleId: string) => ({ 'Content-Type': 'application/json', 'X-Agent-Id': roleId })
    : qwenpawHeaders)
  return {
    info: DEFAULT_MODEL_PROVIDER_INFO,
    async chat(request) {
      const response = await send(chatUrl, { method: 'POST', headers: headers(request.roleId),
        signal: timeout(request.timeoutMs), body: JSON.stringify(payload(request)) })
      if (!response.ok) {
        const detail = options.includeChatErrorBody === false ? '' : ': ' + (await response.text()).slice(0, 200)
        throw new Error(`goddess API ${response.status}${detail}`)
      }
      return parseQwenpawSse(await response.text())
    },
    async task(request) {
      const base = chatUrl.replace(/\/console\/chat\/?$/, '')
      // Capture once for the submitted task, as the existing consumer did.
      const taskHeaders = headers(request.roleId)
      const post = await send(`${base}/console/chat/task`, { method: 'POST', headers: taskHeaders,
        signal: timeout(30_000), body: JSON.stringify({ ...payload(request), timeout: 570_000 }) })
      if (!post.ok) throw new Error(`goddess task submit ${post.status}: ${(await post.text()).slice(0, 200)}`)
      const { task_id: taskId } = await post.json() as { task_id?: string }
      if (!taskId) throw new Error('goddess task: no task_id')
      const deadline = now() + 590_000
      while (now() < deadline) {
        await sleep(5_000)
        const response = await send(`${base}/console/chat/task/${taskId}`, { headers: taskHeaders, signal: timeout(15_000) })
        if (!response.ok) throw new Error(`goddess task status ${response.status}`)
        const body = await response.json() as { status?: string; result?: unknown }
        if (body.status === 'finished') {
          const text = extractQwenpawTaskText(body.result)
          if (text) return { text }
          throw new Error('goddess task finished without text')
        }
        const errorText = (() => { try { return JSON.stringify(body.result).slice(0, 200) } catch { return '' } })()
        if (body.status === 'failed' || body.status === 'cancelled' || body.status === 'canceled') {
          throw new Error(`goddess task ${body.status}${errorText ? ': ' + errorText : ''}`)
        }
        if (body.status && !['pending', 'running', 'queued'].includes(body.status)) {
          throw new Error(`goddess task unknown terminal status "${body.status}"${errorText ? ': ' + errorText : ''}`)
        }
      }
      throw new Error('goddess task timed out')
    },
  }
}
