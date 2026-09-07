import type { PlayerReceipt } from './application/player-command-ports.ts'

/** Reads the custom item gesture gate. It never executes a spell or retries a
 * consumed gesture; the caller subsequently runs the existing player use case. */
export function createChantingStaffClient(rcon: { send(command: string): Promise<string> }) {
  async function claim(actor: string, recordedAt: number | undefined, recordingEndedAt: number | undefined, slot = 0): Promise<PlayerReceipt> {
    if (!/^[A-Za-z0-9_]{1,16}$/.test(actor) || !Number.isSafeInteger(recordedAt) || recordedAt! <= 0
      || !Number.isSafeInteger(recordingEndedAt) || recordingEndedAt! < recordedAt! || !Number.isInteger(slot) || slot < 0 || slot > 8)
      return { ok: false, code: 'invalid_voice_context', summary: '这段语音缺少有效的玩家或录音时间，请重新咏唱。' }
    try {
      const raw = await rcon.send(`qdchant claim ${actor} ${recordedAt} ${recordingEndedAt} ${slot}`)
      const lines = raw.split(/\r?\n/).filter(line => line.startsWith('QD_CHANT_JSON '))
      if (lines.length !== 1 || lines[0].length > 8192) throw new Error('Missing bounded gesture receipt')
      const receipt = JSON.parse(lines[0].slice('QD_CHANT_JSON '.length))
      if (receipt?.schema !== 1 || typeof receipt.ok !== 'boolean' || typeof receipt.code !== 'string'
        || receipt.actor !== actor || typeof receipt.actorUuid !== 'string'
        || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(receipt.actorUuid))
        throw new Error('Uncorrelated gesture receipt')
      return receipt
    } catch {
      return { ok: false, code: 'staff_gate_unavailable', summary: '言灵法杖暂时没有回应，请稍后重新咏唱。' }
    }
  }
  async function syncBar(actor: string, slots: Array<{ slot: number; id: string; name: string; icon: string; chant: string }>): Promise<PlayerReceipt> {
    if (!/^[A-Za-z0-9_]{1,16}$/.test(actor) || slots.length !== 8) return { ok: false, code: 'invalid_bar', summary: '快捷栏数据无效。' }
    try {
      const encoded = Buffer.from(JSON.stringify(slots), 'utf8').toString('base64url')
      if (encoded.length > 16000) throw new Error('bar_too_large')
      const raw = await rcon.send(`qdchant bar ${actor} ${encoded}`)
      const lines = raw.split(/\r?\n/).filter(line => line.startsWith('QD_CHANT_JSON '))
      if (lines.length !== 1 || lines[0].length > 8192) throw new Error('invalid_receipt')
      const receipt = JSON.parse(lines[0].slice('QD_CHANT_JSON '.length))
      if (receipt.schema !== 1 || typeof receipt.ok !== 'boolean' || receipt.actor !== actor || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(receipt.actorUuid ?? '')) throw new Error('uncorrelated_receipt')
      return receipt
    } catch { return { ok: false, code: 'staff_gate_unavailable', summary: '快捷栏显示暂时无法同步。' } }
  }
  async function claimVoice(actor: string, recordedAt: number | undefined, recordingEndedAt: number | undefined): Promise<PlayerReceipt> {
    // Recognition may finish while the player still holds use. Only an explicit
    // pending receipt may be polled; uncertain/consumed claims are never retried.
    for (;;) {
      const result = await claim(actor, recordedAt, recordingEndedAt, 0)
      if (result.code !== 'gesture_pending') return result
      if (recordedAt === undefined || Date.now() - recordedAt > 120_000) return { ok: false, code: 'gesture_expired', summary: '这次咏唱等待过久，请重新举杖。' }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
  return { claim, claimVoice, syncBar }
}
