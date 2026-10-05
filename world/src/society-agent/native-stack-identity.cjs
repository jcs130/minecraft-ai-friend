'use strict'

// Keep component SNBT opaque, including numeric tag types and nested count
// fields. Only the bounded outer ItemStack count is separated for comparisons.
// Different textual component encodings may be rejected as unequal; they are
// never flattened into approximate JSON or interpreted with eval.
function nativeStackIdentity (item) {
  const reject = reason => ({ available: false, reason })
  if (!item || !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(item.id || '') || !Number.isInteger(item.count) || item.count < 1 ||
      typeof item.snbt !== 'string' || Buffer.byteLength(item.snbt, 'utf8') > 65536) return reject('native_stack_identity_unavailable')
  const text = item.snbt.trim()
  if (text[0] !== '{' || text.at(-1) !== '}') return reject('native_stack_identity_invalid')
  const fields = [], nesting = []; let start = 1, quote = null, escaped = false
  for (let i = 1; i < text.length - 1; i++) {
    const ch = text[i]
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '{' || ch === '[') { nesting.push(ch); if (nesting.length > 16) return reject('native_stack_identity_budget_exceeded') }
    else if (ch === '}' || ch === ']') { if (nesting.pop() !== (ch === '}' ? '{' : '[')) return reject('native_stack_identity_invalid') }
    else if (ch === ',' && nesting.length === 0) { fields.push(text.slice(start, i).trim()); start = i + 1 }
  }
  if (quote || escaped || nesting.length) return reject('native_stack_identity_invalid')
  fields.push(text.slice(start, -1).trim())
  const values = new Map()
  for (const field of fields) {
    const match = /^(id|count|components|"id"|"count"|"components"|'id'|'count'|'components')\s*:\s*([\s\S]+)$/.exec(field)
    if (!match) return reject('native_stack_identity_invalid')
    const key = match[1].replace(/^['"]|['"]$/g, '')
    if (values.has(key)) return reject('native_stack_identity_duplicate_key')
    values.set(key, match[2].trim())
  }
  const id = values.get('id'), quotedId = id === `"${item.id}"` || id === `'${item.id}'` || id === item.id
  const count = values.get('count')
  if (!quotedId || (count !== undefined && (!/^\d+$/.test(count) || Number(count) !== item.count)) || (count === undefined && item.count !== 1)) {
    return reject('native_stack_identity_conflict')
  }
  const components = values.get('components') ?? '{}'
  if (components[0] !== '{' || components.at(-1) !== '}') return reject('native_stack_components_unavailable')
  return { available: true, id: item.id, count: item.count, snbt: item.snbt, key: item.id + '#' + components }
}

function nativeComponentDelta (before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return { available: false, reason: 'native_component_inventory_unavailable', added: [], removed: [] }
  const aggregate = items => {
    const groups = new Map()
    for (const item of items) {
      const identity = nativeStackIdentity(item)
      if (!identity.available) return { error: identity.reason }
      const group = groups.get(identity.key) ?? { id: item.id, key: identity.key, count: 0, stacks: [] }
      group.count += item.count; group.stacks.push({ ...item }); groups.set(identity.key, group)
    }
    return { groups }
  }
  const a = aggregate(before), b = aggregate(after), added = [], removed = []
  if (a.error || b.error) return { available: false, reason: a.error || b.error, added, removed }
  for (const key of new Set([...a.groups.keys(), ...b.groups.keys()])) {
    const old = a.groups.get(key), current = b.groups.get(key), delta = (current?.count ?? 0) - (old?.count ?? 0)
    if (delta > 0) added.push({ id: current.id, key, count: delta, stacks: current.stacks })
    if (delta < 0) removed.push({ id: old.id, key, count: -delta, stacks: old.stacks })
  }
  return { available: true, added, removed }
}
module.exports = { nativeStackIdentity, nativeComponentDelta }
