// Mojang 1.21.1 TagParser (uz) and Brigadier StringReader grammar, parsed as
// data only. The extra depth/size/node limits and duplicate-key rejection are
// deliberate fail-closed viewer limits, not a replacement ItemStack codec.
export const NATIVE_ITEM_STACK_LIMITS = Object.freeze({ bytes: 65536, depth: 16, nodes: 4096 })
const RESOURCE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/
const INTEGER = /^[-+]?(?:0|[1-9][0-9]*)$/
const REAL = '[-+]?(?:[0-9]+[.]?|[0-9]*[.][0-9]+)(?:e[-+]?[0-9]+)?'
const FLOAT = new RegExp(`^${REAL}f$`, 'i')
const DOUBLE_SUFFIX = new RegExp(`^${REAL}d$`, 'i')
const DOUBLE = /^[-+]?(?:[0-9]+[.]|[0-9]*[.][0-9]+)(?:e[-+]?[0-9]+)?$/i
const INTEGER_SUFFIX = /^([-+]?(?:0|[1-9][0-9]*))([bsl])$/i
const WORD = /[A-Za-z0-9_.+\-]/
const TAG = Symbol('native-snbt-tag')
const parsedStacks = new WeakSet()
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = code => { throw Error(`NATIVE_ITEM_STACK_${code}`) }
const tagged = (type, value) => {
  const result = { type, value }
  Object.defineProperty(result, TAG, { value: type })
  return result
}
const typeOf = value => value?.[TAG] ?? (Array.isArray(value) ? 'list' : record(value) ? 'compound' : typeof value === 'number' ? 'int' : 'string')

// Usually decimal -> JS double -> float has the same rounding as Java's direct
// Float.parseFloat. At a double-rounded float midpoint it may differ by one
// ULP. Compare the original bounded decimal exactly only at those midpoints.
function float32Decimal (literal) {
  const number = Number(literal), rounded = Math.fround(number), magnitude = Math.abs(number)
  if (!Number.isFinite(number) || rounded === number) return rounded
  const view = new DataView(new ArrayBuffer(8))
  const float = bits => { view.setUint32(0, bits); return view.getFloat32(0) }
  view.setFloat32(0, Math.abs(rounded))
  const bits = view.getUint32(0)
  let low, high, lowBits
  if (bits === 0x7f800000) {
    lowBits = 0x7f7fffff; low = float(lowBits); high = 2 ** 128
  } else if (Math.abs(rounded) < magnitude) {
    lowBits = bits; low = float(bits); high = float(bits + 1)
  } else {
    lowBits = bits - 1; low = float(lowBits); high = float(bits)
  }
  const midpoint = (low + high) / 2
  if (magnitude !== midpoint) return rounded
  // The complete SNBT is bounded, but arbitrary decimal exponentiation is
  // not an acceptable renderer cost. Rare oversized midpoint literals remain
  // an explicit typed unavailable value with the entire original token.
  if (literal.length > 512) return null
  const [mantissa, exponentText = '0'] = literal.replace(/^[+-]/, '').toLowerCase().split('e')
  const decimalExponent = Number(exponentText) - (mantissa.includes('.') ? mantissa.length - mantissa.indexOf('.') - 1 : 0)
  if (!Number.isSafeInteger(decimalExponent) || Math.abs(decimalExponent) > 512) return null
  let decimalNumerator = BigInt(mantissa.replace('.', '')), decimalDenominator = 1n
  if (decimalExponent >= 0) decimalNumerator *= 10n ** BigInt(decimalExponent)
  else decimalDenominator = 10n ** BigInt(-decimalExponent)
  view.setFloat64(0, midpoint)
  const binary = view.getBigUint64(0), power = Number((binary >> 52n) & 2047n) - 1023 - 52
  let binaryNumerator = (binary & ((1n << 52n) - 1n)) | (1n << 52n), binaryDenominator = 1n
  if (power >= 0) binaryNumerator <<= BigInt(power)
  else binaryDenominator <<= BigInt(-power)
  const comparison = decimalNumerator * binaryDenominator - binaryNumerator * decimalDenominator
  const chosen = comparison < 0n ? low : comparison > 0n ? high : lowBits % 2 === 0 ? low : high
  return number < 0 ? -Math.fround(chosen) : Math.fround(chosen)
}

// Only values actually produced as numeric tags by this parser are unwrapped.
// A compound with keys called "type" and "value" cannot impersonate a tag.
export function nativeNumericValue (value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) return value
  if (!record(value) || !['byte', 'short', 'long', 'float', 'double'].includes(value[TAG])) return null
  if (value[TAG] === 'long') {
    const number = Number(value.value)
    return Number.isSafeInteger(number) ? number : null
  }
  return typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : null
}

// Large chunk positions and scan identifiers must not round through a double.
// Only a real LongTag from the bounded parser may supply this value.
export function nativeLongValue(value) {
  return record(value) && value[TAG] === 'long' ? BigInt(value.value) : null
}

function numericOrString (word) {
  if (FLOAT.test(word) || DOUBLE_SUFFIX.test(word) || DOUBLE.test(word)) {
    const type = FLOAT.test(word) ? 'float' : 'double'
    const number = Number(/[fd]$/i.test(word) ? word.slice(0, -1) : word)
    const value = type === 'float' ? float32Decimal(word.slice(0, -1)) : number
    if (value === null) return Object.assign(tagged(type, null), { literal: word, unavailableReason: 'NATIVE_ITEM_STACK_FLOAT_LITERAL_UNVERIFIED' })
    // Java accepts floating overflow. Preserve its tag without creating a
    // non-finite JSON number; providers cannot treat it as usable geometry.
    return tagged(type, Number.isFinite(value) ? value : value < 0 ? '-Infinity' : 'Infinity')
  }
  const suffix = INTEGER_SUFFIX.exec(word)
  if (suffix) {
    const number = BigInt(suffix[1]), letter = suffix[2].toLowerCase()
    const [type, min, max] = letter === 'b' ? ['byte', -128n, 127n]
      : letter === 's' ? ['short', -32768n, 32767n] : ['long', -9223372036854775808n, 9223372036854775807n]
    // Mojang falls through to a StringTag on NumberFormatException.
    return number < min || number > max ? word : tagged(type, type === 'long' ? number.toString() : Number(number))
  }
  if (INTEGER.test(word)) {
    const value = Number(word)
    return value >= -2147483648 && value <= 2147483647 ? value === 0 ? 0 : value : word
  }
  if (/^(true|false)$/i.test(word)) return tagged('byte', word.toLowerCase() === 'true' ? 1 : 0)
  return word
}

class SnbtReader {
  constructor (source) { this.source = source; this.offset = 0; this.nodes = 0 }
  skip () { while (/\s/.test(this.source[this.offset] ?? '') && this.offset < this.source.length) this.offset++ }
  expect (character) {
    this.skip()
    if (this.source[this.offset++] !== character) fail('SYNTAX')
  }
  string () {
    const quote = this.source[this.offset]
    if (quote !== '"' && quote !== "'") {
      const start = this.offset
      while (WORD.test(this.source[this.offset] ?? '') && this.offset < this.source.length) this.offset++
      if (this.offset === start) fail('SYNTAX')
      return this.source.slice(start, this.offset)
    }
    this.offset++
    let result = ''
    while (this.offset < this.source.length) {
      const character = this.source[this.offset++]
      if (character === quote) return result
      if (character === '\\') {
        const escaped = this.source[this.offset++]
        // Brigadier allows only the closing quote and backslash to be escaped.
        // JSON unicode/control escapes are not Mojang SNBT escapes.
        if (escaped !== quote && escaped !== '\\') fail('STRING_ESCAPE')
        result += escaped
      } else result += character
    }
    fail('SYNTAX')
  }
  separator (closing) {
    this.skip()
    if (this.source[this.offset] === ',') {
      this.offset++; this.skip()
      return this.source[this.offset] !== closing
    }
    if (this.source[this.offset] !== closing) fail('SYNTAX')
    return false
  }
  value (depth = 1) {
    this.skip()
    if (++this.nodes > NATIVE_ITEM_STACK_LIMITS.nodes) fail('NODE_LIMIT')
    if (depth > NATIVE_ITEM_STACK_LIMITS.depth) fail('DEPTH_LIMIT')
    const next = this.source[this.offset]
    if (next === '{') return this.compound(depth)
    if (next === '[') return this.array(depth)
    const quoted = next === '"' || next === "'"
    const string = this.string()
    return quoted ? string : numericOrString(string)
  }
  compound (depth) {
    this.expect('{')
    const result = {}
    this.skip()
    if (this.source[this.offset] !== '}') {
      do {
        const key = this.string()
        if (!key.length) fail('EMPTY_KEY')
        if (Object.hasOwn(result, key)) fail('DUPLICATE_KEY')
        this.expect(':')
        // Defining an own property preserves legitimate arbitrary NBT keys,
        // including __proto__, without changing the object's prototype.
        Object.defineProperty(result, key, { value: this.value(depth + 1), enumerable: true, configurable: true, writable: true })
      } while (this.separator('}'))
    }
    this.expect('}')
    return result
  }
  array (depth) {
    this.expect('['); this.skip()
    let arrayType = null
    if (this.source[this.offset + 1] === ';') {
      arrayType = ({ B: 'byte', I: 'int', L: 'long' })[this.source[this.offset]]
      if (!arrayType) fail('ARRAY_TYPE')
      this.offset += 2; this.skip()
    }
    const result = []
    let elementType = arrayType
    if (this.source[this.offset] !== ']') {
      do {
        const value = this.value(depth + 1), type = typeOf(value)
        if (elementType !== null && type !== elementType) fail('ARRAY_TYPE')
        elementType ??= type
        result.push(arrayType ? type === 'int' ? value : value.value : value)
      } while (this.separator(']'))
    }
    this.expect(']')
    return arrayType ? tagged(`${arrayType}Array`, result) : result
  }
}

export function parseNativeItemStack (item) {
  if (!record(item) || typeof item.name !== 'string' || !RESOURCE.test(item.name) ||
      item.name.split('/').some(part => ['.', '..', ''].includes(part)) ||
      !Number.isSafeInteger(item.count) || item.count <= 0 || item.count > 2147483647) fail('IDENTITY')
  // The native presentation contract supplies one complete serialized stack.
  // A second structured component source has no agreed typed schema; ignoring
  // it could hide a custom model or a different book selection.
  if (Object.hasOwn(item, 'components') && item.components !== null && item.components !== undefined) fail('COMPONENT_SOURCE_CONFLICT')
  if (typeof item.snbt !== 'string' || !item.snbt.length) fail('UNKNOWN')
  if (item.snbt.length > NATIVE_ITEM_STACK_LIMITS.bytes || new TextEncoder().encode(item.snbt).byteLength > NATIVE_ITEM_STACK_LIMITS.bytes) fail('BYTE_LIMIT')
  const reader = new SnbtReader(item.snbt), stack = reader.value()
  reader.skip()
  if (reader.offset !== item.snbt.length) fail('TRAILING_DATA')
  if (!record(stack) || typeOf(stack) !== 'compound' ||
      Object.keys(stack).some(key => !['id', 'count', 'components'].includes(key))) fail('ENVELOPE')
  if (stack.id !== item.name || typeOf(stack.count) !== 'int' || stack.count !== item.count) fail('IDENTITY')
  if (stack.components !== undefined && (!record(stack.components) || typeOf(stack.components) !== 'compound')) fail('COMPONENTS')
  // An omitted components compound means the observed serialized patch is
  // empty. A provider still needs the locked mod's default item/render rules.
  const result = { id: stack.id, count: stack.count, components: stack.components ?? {} }
  // Selection accepts only parser-produced values. Freeze the bounded tree so
  // callers cannot replace a genuine numeric tag with a lookalike compound
  // after validation, including while an asynchronous asset read is pending.
  const freeze = value => {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) freeze(child)
      Object.freeze(value)
    }
  }
  freeze(result); parsedStacks.add(result)
  return result
}

export function assertNativeItemStack(stack) {
  if (!parsedStacks.has(stack)) fail('PARSED_REQUIRED')
  return stack
}

// Public spectators need the visible model, not book text, container contents,
// private custom_data or command-bearing item descriptions. Preserve the typed
// visual components from the actual stack; never infer a replacement model.
export function publicNativeItemStack(item) {
  if (item == null) return null
  const stack = parseNativeItemStack(item)
  const visual = new Set(['custom_model_data', 'damage', 'max_damage', 'dyed_color', 'profile', 'trim',
    'enchantment_glint_override', 'enchantments', 'stored_enchantments', 'potion_contents',
    'banner_patterns', 'base_color', 'firework_explosion', 'map_color', 'map_id'])
  const quote = s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
  const encode = value => {
    const type = typeOf(value)
    if (type === 'string') return quote(value)
    if (type === 'compound') return '{' + Object.entries(value).map(([k,v]) => quote(k)+':'+encode(v)).join(',') + '}'
    if (type === 'list') return '[' + value.map(encode).join(',') + ']'
    if (type.endsWith('Array')) return '['+({byteArray:'B',intArray:'I',longArray:'L'})[type]+';'+value.value.map(v=>String(v)+(type==='longArray'?'L':type==='byteArray'?'b':'')).join(',')+']'
    if (type === 'int') return String(value)
    return (value.literal ?? String(value.value))+({byte:'b',short:'s',long:'L',float:'f',double:'d'})[type]
  }
  const components = Object.fromEntries(Object.entries(stack.components).filter(([key]) =>
    visual.has(key.replace(/^!/, '').replace(/^minecraft:/, '')) && /^!?minecraft:/.test(key)))
  // Names are necessary for special items such as the personal backpack. Keep
  // real text/styles while dropping click/hover actions and credential text.
  const secret = /(?:MC_AUTH_|\/(?:[\w-]+:)?(?:login|register|changepass(?:word)?|password|2fa|totp|auth)\b|password|passwd|api[ _-]?key|authorization|bearer\s|(?:sk[-_]|(?:srv|obs|pub|pat)_)[A-Za-z0-9_-]{16}|eyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.|密码|口令|验证码|密钥|令牌)/i
  const textComponent = (value, depth = 0) => {
    if (depth > 12) return null
    if (typeof value === 'string') return secret.test(value) ? null : value
    if (Array.isArray(value)) return value.map(v => textComponent(v, depth + 1)).filter(v => v !== null)
    if (!record(value)) return null
    const result = {}
    for (const key of ['text','color','font','bold','italic','underlined','strikethrough','obfuscated','extra']) {
      if (!Object.hasOwn(value, key)) continue
      if (key === 'extra') result.extra = textComponent(value.extra, depth + 1)
      else if (typeof value[key] === 'boolean' || typeof value[key] === 'string' && !secret.test(value[key])) result[key] = value[key]
    }
    return typeof result.text === 'string' || Array.isArray(result.extra) ? result : null
  }
  for (const key of ['minecraft:custom_name','minecraft:item_name']) {
    const raw = stack.components[key]
    if (typeof raw === 'string' && raw.length <= 8192) {
      try { const value = textComponent(JSON.parse(raw)); if (value !== null) components[key] = JSON.stringify(value) } catch {}
    }
    if (Object.hasOwn(stack.components, '!' + key)) components['!' + key] = stack.components['!' + key]
  }
  return { name: stack.id, count: stack.count, snbt: '{id:'+quote(stack.id)+',count:'+stack.count+',components:'+encode(components)+'}' }
}

// ItemContainerContents.copyOne() copies slot ZERO, not the first nonempty
// entry. Reuse parser-produced nested values without losing numeric tag types
// in a JSON round trip, or accepting a fabricated typed-tag lookalike.
export function nativeContainerItemAt(stack,slot=0){
  assertNativeItemStack(stack)
  if(Object.hasOwn(stack.components,'!minecraft:container')){
    const removed=stack.components['!minecraft:container']
    if(!record(removed)||Object.keys(removed).length||Object.hasOwn(stack.components,'minecraft:container'))fail('CONTAINER')
    return null
  }
  const rows=stack.components['minecraft:container']??[]
  if(!Array.isArray(rows)||rows.length>256||!Number.isInteger(slot)||slot<0||slot>255)fail('CONTAINER')
  let selected=null;const seen=new Set()
  for(const row of rows){
    if(!record(row)||typeOf(row)!=='compound'||Object.keys(row).some(k=>!['slot','item'].includes(k))||typeOf(row.slot)!=='int'||!Number.isInteger(row.slot)||row.slot<0||row.slot>255||seen.has(row.slot)||!record(row.item)||typeOf(row.item)!=='compound')fail('CONTAINER')
    seen.add(row.slot);const item=row.item,count=item.count??1
    if(!RESOURCE.test(item.id??'')||Object.keys(item).some(k=>!['id','count','components'].includes(k))||!Number.isInteger(count)||count<=0||count>2147483647||typeOf(count)!=='int'||(item.components!==undefined&&(!record(item.components)||typeOf(item.components)!=='compound')))fail('CONTAINER')
    if(row.slot===slot&&item.id!=='minecraft:air')selected=Object.freeze({id:item.id,count,components:item.components??Object.freeze({})})
  }
  if(selected)parsedStacks.add(selected)
  return selected
}
