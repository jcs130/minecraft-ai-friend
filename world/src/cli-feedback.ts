const PLAYER = /^[\p{L}\p{N}_]{1,16}$/u
const MAX_BODY_BYTES = 32_000
const INCOMING_TRANSLATE = 'commands.message.display.incoming'

/** Deliver short replies by /tell and long replies as a targeted system whisper. */
export function privateFeedbackCommand(sender: string, target: string, text: string): string {
  if (!PLAYER.test(sender) || !PLAYER.test(target)) throw new Error('Invalid private feedback player')
  // MessageArgument treats the remainder as one message. Strip line separators so
  // a response remains one RCON command; JSON structure and Unicode stay intact.
  const body = text.replace(/[\r\n\0\u2028\u2029]/g, ' ')
  if (!body || Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new Error('Invalid private feedback length')
  // Java String length, like JS length, counts UTF-16 units (an emoji uses two).
  if (body.length <= 256) return `execute as ${sender} run tell ${target} ${body}`
  const component = { translate: INCOMING_TRANSLATE,
    with: [{ selector: '@s' }, { text: body }], color: 'gray', italic: true }
  const command = `execute as ${sender} run tellraw ${target} ${JSON.stringify(component)}`
  // JSON control-character escaping can expand a legal body beyond the RCON frame.
  if (Buffer.byteLength(command, 'utf8') > 65_522) throw new Error('Invalid encoded private feedback length')
  return command
}

type OnlinePlayers = Record<string, { uuid?: string }>
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)

function uuidKey(value: unknown): string | null {
  if (typeof value === 'string' && /^(?:[\da-f]{32}|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})$/i.test(value))
    return value.replaceAll('-', '').toLowerCase()
  if (Array.isArray(value) && value.length === 4 && value.every(n => Number.isInteger(n) && n >= -2_147_483_648 && n <= 2_147_483_647))
    return value.map(n => (n >>> 0).toString(16).padStart(8, '0')).join('')
  return null
}

function literalText(value: unknown, depth = 0): string | null {
  if (depth > 8) return null
  if (typeof value === 'string') return value.length <= 256 ? value : null
  if (!object(value) || (value.text !== undefined && typeof value.text !== 'string') ||
      ['translate', 'selector', 'score', 'nbt', 'keybind', 'with'].some(key => key in value)) return null
  let text = value.text ?? ''
  if (value.extra !== undefined) {
    if (!Array.isArray(value.extra) || value.extra.length > 16) return null
    for (const child of value.extra) {
      const part = literalText(child, depth + 1)
      if (part === null || text.length + part.length > 256) return null
      text += part
    }
  }
  return text.length <= 256 ? text : null
}

/** An explicit unknown/conflicting UUID never falls back to a familiar name. */
function onlineSender(sender: unknown, players: OnlinePlayers): string | null {
  const names = new Set<string>(), uuids = new Set<string>()
  const visible = literalText(sender)
  if (visible === null) return null
  if (PLAYER.test(visible)) names.add(visible.toLowerCase())
  const stack: Array<{ node: unknown; depth: number }> = [{ node: sender, depth: 0 }]
  let count = 0
  while (stack.length) {
    const { node, depth } = stack.pop()!
    if (++count > 64 || depth > 8) return null
    if (typeof node === 'string') continue
    if (!object(node)) return null
    if (node.insertion !== undefined) {
      if (typeof node.insertion !== 'string' || !PLAYER.test(node.insertion)) return null
      names.add(node.insertion.toLowerCase())
    }
    if (node.hoverEvent !== undefined) {
      const hover = node.hoverEvent
      if (!object(hover) || hover.action !== 'show_entity' || !object(hover.contents) || hover.contents.type !== 'minecraft:player') return null
      const uuid = uuidKey(hover.contents.id)
      if (!uuid) return null
      uuids.add(uuid)
      if (hover.contents.name !== undefined) {
        const name = literalText(hover.contents.name)
        if (name === null || !PLAYER.test(name)) return null
        names.add(name.toLowerCase())
      }
    }
    if (Array.isArray(node.extra)) for (const child of node.extra) stack.push({ node: child, depth: depth + 1 })
  }
  if (uuids.size > 1 || names.size > 1) return null
  const live = Object.entries(players).filter(([name]) => PLAYER.test(name))
  const matches = uuids.size
    ? live.filter(([, player]) => uuids.has(uuidKey(player?.uuid) ?? ''))
    : live.filter(([name]) => names.has(name.toLowerCase()))
  if (matches.length !== 1 || (names.size && !names.has(matches[0][0].toLowerCase()))) return null
  return matches[0][0]
}

/** Only call for minecraft-protocol's systemChat event. Accept the exact server
 * whisper envelope, never rendered public chat or JSON inside its text. Online
 * identity correlation does not authenticate against a malicious server/operator. */
export function incomingSystemWhisper(packet: unknown, players: OnlinePlayers): { username: string; message: string } | null {
  if (!object(packet) || packet.positionId !== 1 ||
      ['plainMessage', 'sender', 'senderName', 'type', 'unsignedContent'].some(key => key in packet)) return null
  let component: unknown = packet.formattedMessage
  if (typeof component === 'string') {
    if (Buffer.byteLength(component, 'utf8') > 256_000) return null
    try { component = JSON.parse(component) } catch { return null }
  }
  if (!object(component) || component.translate !== INCOMING_TRANSLATE ||
      ['text', 'extra', 'selector', 'score', 'nbt', 'keybind', 'fallback'].some(key => key in component) ||
      !Array.isArray(component.with) || component.with.length !== 2) return null
  const serializedBody = component.with[1]
  // The deployed minecraft-protocol/NBT bridge preserves an anonymous string
  // tag as {"": text}. Accept only this exact literal shape, never scan content.
  const body = object(serializedBody) && Object.keys(serializedBody).length === 1 && typeof serializedBody[''] === 'string'
    ? serializedBody[''] : serializedBody
  // Minecraft's Component CODEC collapses a plain, unstyled text component to a
  // string on the wire. Both representations must retain the entire literal body.
  const message = typeof body === 'string' ? body :
    object(body) && Object.keys(body).every(key => key === 'text') && typeof body.text === 'string' ? body.text : null
  if (!message || Buffer.byteLength(message, 'utf8') > MAX_BODY_BYTES) return null
  const username = onlineSender(component.with[0], players)
  return username ? { username, message } : null
}
