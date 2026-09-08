/** minecraft-protocol emits both signed and profileless messages as playerChat. */
export function componentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(componentText).join('')
  if (!value || typeof value !== 'object') return ''
  const node = value as { text?: unknown; extra?: unknown }
  return (typeof node.text === 'string' ? node.text : '') + (Array.isArray(node.extra) ? node.extra.map(componentText).join('') : '')
}

function component(value: unknown): any {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return null }
}

export function incomingWhisper(packet: any, players: Record<string, { uuid?: string }>, formats?: Record<number, { name?: string; formatString?: string }>): { username: string; message: string } | null {
  const type = packet?.type?.chatType ?? packet?.type
  const format = formats?.[type]
  // prismarine-registry stores a localized formatString and (in 1.21) id + 1.
  // Its namespaced name is stable across language, holder index and registration order.
  if (format?.name !== 'minecraft:msg_command_incoming') return null
  const sender = component(packet.senderName)
  const uuid = String(packet.sender ?? sender?.hoverEvent?.contents?.id ?? '').replaceAll('-', '').toLowerCase()
  const candidates = [sender?.hoverEvent?.contents?.name, sender?.insertion, componentText(sender)].filter(x => typeof x === 'string' && x)
  const entries = Object.entries(players)
  const found = (uuid && entries.find(([, player]) => player.uuid?.replaceAll('-', '').toLowerCase() === uuid)) ||
    entries.find(([name]) => candidates.some(candidate => candidate.toLowerCase() === name.toLowerCase()))
  if (!found) return null
  const message = typeof packet.plainMessage === 'string' ? packet.plainMessage : componentText(component(packet.formattedMessage))
  return message ? { username: found[0], message } : null
}
