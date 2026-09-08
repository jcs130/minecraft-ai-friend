// Deterministic native storage callback double; no network or game mutations.
export function springRcon(options = {}) {
  const records = new Map(), commands = []
  let effects = 0
  async function send(command) {
    commands.push(command)
    if (command.startsWith('execute unless data storage qiandeng:spell_receipts ')) {
      const key = command.split(' ')[5]
      const match = command.match(/\{identity:"([a-f0-9]+)",nonce:"([a-f0-9-]+)"/)
      if (!records.has(key)) records.set(key, { identity: match[1], nonce: match[2],
        loaded: -1, beforeWater: -1, success: -1, result: -1, afterSource: -1 })
      return ''
    }
    const get = command.match(/^data get storage qiandeng:spell_receipts (\w+)\.(\w+)$/)
    if (get) {
      if (options.readFailure === get[2]) return ''
      const value = records.get(get[1])?.[get[2]]
      return `Storage qiandeng:spell_receipts has the following contents: ${typeof value === 'string' ? JSON.stringify(value) : value + 'b'}`
    }
    const stored = command.match(/^execute store success storage qiandeng:spell_receipts (\w+)\.(\w+) byte 1 /)
    if (stored) {
      const row = records.get(stored[1]), field = stored[2]
      if (field === 'success') {
        effects++
        row.success = options.success ?? 1
        row.result = options.result ?? row.success
        if (options.lostResponse) throw new Error('connection closed after dispatch')
      } else row[field] = options[field] ?? ({ loaded: 1, beforeWater: 0, afterSource: 1 })[field]
      return ''
    }
    return undefined
  }
  return { send, records, commands, get effects() { return effects } }
}
