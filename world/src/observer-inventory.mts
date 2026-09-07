/** Read-only canonical names for Goddess's own inventory; never a global ID registry. */
const snapshots = new WeakMap()
const NAME = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const INTERVAL_MS = 5000, MAX_AGE_MS = 10000
const labels = { 'qiandeng_chanting:whispering_staff': '旅人言灵杖', 'qiandeng_chanting:resonance_staff': '千灯共鸣杖' }
const live = bot => bot?.username === 'Goddess' && bot._client?.state === 'play'
  && bot._client?.ended !== true && bot._client?.socket?.destroyed !== true && Array.isArray(bot.inventory?.slots)

// Split only at the outer level. Nested components and quoted book text are
// skipped, never decoded or exposed; all bracket/quote boundaries are checked.
function split(value, delimiter) {
  const output = [], stack = []; let quote = '', start = 0
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (quote) {
      if (ch === '\\') { if (++i >= value.length || ![quote, '\\'].includes(value[i])) throw Error('Invalid escape') }
      else if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{' || ch === '[') { stack.push(ch); if (stack.length > 32) throw Error('Nested inventory') }
    else if (ch === '}' || ch === ']') { if (stack.pop() !== (ch === '}' ? '{' : '[')) throw Error('Unbalanced inventory') }
    else if (ch === delimiter && !stack.length) { output.push(value.slice(start, i).trim()); start = i + 1 }
  }
  if (quote || stack.length) throw Error('Truncated inventory')
  output.push(value.slice(start).trim()); return output
}
function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1)
  return value
}
export function nativeInventorySlot(slot) {
  if (Number.isInteger(slot) && slot >= 0 && slot <= 8) return slot + 36
  if (Number.isInteger(slot) && slot >= 9 && slot <= 35) return slot
  return new Map([[100, 8], [101, 7], [102, 6], [103, 5], [-106, 45]]).get(slot) ?? null
}
export function observerEquipmentSlot(bot, index) {
  if (index === 0) return Number.isInteger(bot?.quickBarSlot) && bot.quickBarSlot >= 0 && bot.quickBarSlot <= 8 ? bot.quickBarSlot + 36 : null
  return [null, 45, 8, 7, 6, 5][index] ?? null
}
export function parseObserverInventory(raw) {
  if (typeof raw !== 'string' || raw.length > 32768) throw Error('Invalid inventory response')
  const prefix = 'Goddess has the following entity data: '
  const text = raw.replace(/\u001b\[[0-9;]*m/g, '').trim()
  if (!text.startsWith(prefix)) throw Error('Wrong observer response')
  const list = text.slice(prefix.length).trim()
  if (!list.startsWith('[') || !list.endsWith(']')) throw Error('Invalid inventory list')
  const records = list.slice(1, -1).trim() ? split(list.slice(1, -1), ',') : []
  if (records.length > 41) throw Error('Too many inventory slots')
  const rows = [], seen = new Set()
  for (const record of records) {
    if (!record.startsWith('{') || !record.endsWith('}')) throw Error('Invalid item compound')
    const fields = new Map()
    for (const field of split(record.slice(1, -1), ',')) {
      const parts = split(field, ':'); if (parts.length < 2) throw Error('Invalid item field')
      const key = unquote(parts.shift().trim()), value = parts.join(':').trim()
      if (fields.has(key)) throw Error('Duplicate item field')
      fields.set(key, value)
    }
    const native = fields.get('Slot'), count = fields.get('count'), name = unquote(fields.get('id') ?? '')
    if (!/^-?\d+b?$/.test(native ?? '') || !/^\d+$/.test(count ?? '') || !NAME.test(name)) throw Error('Invalid item identity')
    const slot = nativeInventorySlot(Number(native.replace(/b$/, ''))), amount = Number(count)
    if (slot === null || seen.has(slot) || !Number.isSafeInteger(amount) || amount <= 0 || amount > 65536) throw Error('Invalid item slot/count')
    seen.add(slot); rows.push({ slot, name, count: amount })
  }
  return rows
}
export function observerItemIdentity(bot, value, slot, now = Date.now()) {
  if (!live(bot) || !value || !Number.isInteger(slot)) return null
  const snapshot = snapshots.get(bot), row = snapshot?.rows.get(slot), current = bot.inventory.slots[slot]
  if (!row || now < snapshot.at || now - snapshot.at > MAX_AGE_MS || !current
      || current.type !== row.type || value.type !== row.type || current.count !== row.count || value.count !== row.count) return null
  return { name: row.name, displayName: labels[row.name] ?? row.name, source: 'observer_rcon_inventory' }
}
export function createObserverInventoryReader({ getBot, sendCommand, now = Date.now }) {
  let current = null, emitter = null, revision = 0, pending = null, lastStarted = -Infinity, closed = false
  const invalidate = () => { revision++; if (current) snapshots.delete(current) }
  function detach() { emitter?.off?.('updateSlot', invalidate); emitter = null; invalidate() }
  async function refresh() {
    if (closed || pending || now() - lastStarted < INTERVAL_MS) return false
    let bot; try { bot = getBot() } catch { bot = null }
    if (bot !== current) { detach(); current = bot; emitter = bot?.inventory; emitter?.on?.('updateSlot', invalidate) }
    if (!live(bot)) { invalidate(); return false }
    lastStarted = now(); const beganRevision = revision
    const slots = bot.inventory.slots.slice(0, 46).map(value => value ? { type: value.type, count: value.count } : null)
    pending = (async () => {
      try {
        const rows = parseObserverInventory(await Promise.resolve().then(() => sendCommand('data get entity Goddess Inventory')))
        if (closed || getBot() !== bot || !live(bot) || revision !== beganRevision) return false
        const mapped = new Map()
        for (const row of rows) {
          const seen = slots[row.slot], currentItem = bot.inventory.slots[row.slot]
          if (seen && Number.isSafeInteger(seen.type) && seen.type >= 0 && seen.count === row.count
              && currentItem?.type === seen.type && currentItem.count === seen.count) mapped.set(row.slot, { ...row, type: seen.type })
        }
        snapshots.set(bot, { at: now(), rows: mapped }); return true
      } catch { snapshots.delete(bot); return false }
      finally { pending = null }
    })()
    return pending
  }
  function close() { closed = true; detach(); current = null }
  return { refresh, close }
}
