import { parseSpokenIntent } from '../gameplay/commands/spoken-intent.ts'
import type { AtomSummary } from '../gameplay/magic/contracts.ts'
import type { PlayerCommandRequest, PlayerReceipt } from './player-command-ports.ts'

export interface SpokenCommandPorts {
  atoms(): AtomSummary[]
  execute(request: PlayerCommandRequest): Promise<PlayerReceipt>
  prepareCast?(actor: string, recordedAt: number | undefined, recordingEndedAt: number | undefined): Promise<PlayerReceipt>
  feedback(actor: string, text: string): void
  conversation(actor: string, text: string): Promise<void>
}

const quoteArgument = (argument: string): string => `"${argument.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** Human feedback uses the real receipt; a started cast is not a confirmed hit. */
export function spokenFeedback(verb: string, result: PlayerReceipt): string {
  if (result.code === 'casting_started') return '开始咏唱。'
  if (result.code === 'outcome_unknown') return '没有收到施法结果，请先查看游戏里的效果。'
  if (verb === 'status' && result.ok) {
    const native = result.native as Record<string, unknown> | undefined
    if (native?.ok) return `你现在${native.level}级，铁魔法法力${native.mana}，上限${native.maxMana}。`
  }
  if (verb === 'skillbar' && result.ok && Array.isArray(result.skillbar)) {
    const first = result.skillbar.find((entry: { slot?: number; name?: string }) => entry.slot === 1)
    return first?.name ? `快捷槽一是${first.name}。举杖后用肩键选择，松开使用键释放。` : '快捷槽一是空的，可以说“快捷技能设为烟花术”。'
  }
  if (typeof result.summary === 'string' && result.summary.trim())
    return result.summary.replace(/[\r\n]+/g, ' ').slice(0, 180)
  return result.ok ? '已收到游戏执行回执。' : '这次没有施放成功，请查看游戏提示。'
}

/** Same player use cases as CLI, with no model involved in recognizing actions.
 * Conversation is a separate reply-only port and is never sniffed for spells. */
export function createSpokenCommands(ports: SpokenCommandPorts) {
  function feedback(actor: string, text: string): boolean {
    try { ports.feedback(actor, text); return true } catch { return false }
  }
  async function execute(actor: string, text: string, context?: { recordedAt: number; recordingEndedAt: number }): Promise<PlayerReceipt> {
    const intent = parseSpokenIntent(text, ports.atoms())
    if (intent.kind === 'conversation') {
      try {
        await ports.conversation(actor, intent.text)
        return { kind: 'conversation', code: 'conversation', ok: true }
      } catch { return { kind: 'conversation', code: 'conversation_unavailable', ok: false } }
    }
    if (intent.kind === 'chant') {
      const result = { kind: 'chant', ok: false, code: 'unknown_chant',
        summary: '没认出这句咒语。可以说“咏唱烟花术”，或“打开技能罗盘”。' }
      return { ...result, feedbackDelivered: feedback(actor, result.summary) }
    }
    const command = [intent.verb, ...intent.args.map(quoteArgument)].join(' ')
    let result: PlayerReceipt
    try {
      if (intent.verb === 'cast' && ports.prepareCast) {
        const gate = await ports.prepareCast(actor, context?.recordedAt, context?.recordingEndedAt)
        if (gate.ok !== true) return { ...gate, kind: 'command', verb: intent.verb,
          feedbackDelivered: feedback(actor, spokenFeedback(intent.verb, gate)) }
      }
      result = await ports.execute({ actor, command })
    }
    catch { result = { ok: false, code: 'outcome_unknown', summary: '没有收到施法结果，请先查看游戏里的效果。' } }
    return { ...result, kind: 'command', verb: intent.verb,
      feedbackDelivered: feedback(actor, spokenFeedback(intent.verb, result)) }
  }
  return { execute }
}
