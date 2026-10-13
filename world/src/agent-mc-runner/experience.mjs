/** Small, reproducible view of previous known actions. Never supplies stale
 * executable arguments or claims that a historic resource is still present.
 */
export function successfulExperiences(rows, bodyId, limit = 16) {
  const pending = new Map(), experiences = new Map(), seen = new Set()
  let menu = null
  for (const row of rows) {
    if (row.name === 'mc_do' && row.args?.action_id) pending.set(row.args.action_id, row.args)
    const receipt = row.value, intent = pending.get(receipt?.action_id)
    if (!intent || seen.has(receipt.action_id) || receipt.bodyId !== bodyId || !receipt.terminal ||
        receipt.ok !== true || receipt.outcomeKnown !== true || receipt.outcomeUnknown) continue
    seen.add(receipt.action_id)
    const result = receipt.result
    if (!result || result.outcomeUnknown) continue
    if (intent.operation === 'society.open') menu = intent.args?.menu || null
    if (intent.operation === 'menu.close') menu = null
    const delta = result.inventoryDelta
    if (!delta?.available || delta.playerUuid !== bodyId || !delta.added?.length) continue
    const items = list => (list || []).filter(i => typeof i.id === 'string' && Number.isInteger(i.count) && i.count > 0)
      .map(({ id, count }) => ({ id, count })).slice(0, 12)
    const produced = items(delta.added), consumed = items(delta.removed)
    if (!produced.length) continue
    const experience = { actionId: receipt.action_id, operation: intent.operation, observedAt: row.at,
      menuContext: intent.operation === 'menu.click' ? menu : null, code: result.code ?? null,
      produced, consumed, attribution: 'observed during this action; not proof of sole causation',
      requiresFreshState: true }
    const key = JSON.stringify([experience.operation, experience.menuContext, produced.map(i => i.id)])
    experiences.delete(key); experiences.set(key, experience)
  }
  return [...experiences.values()].slice(-limit)
}
