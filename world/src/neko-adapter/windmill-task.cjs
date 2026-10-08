'use strict'
const key = p => p && ['x', 'y', 'z'].every(k => Number.isInteger(p[k])) ? `${p.x},${p.y},${p.z}` : null
// Observation only. Model completion text cannot substitute for world evidence.
class WindmillTaskEvidence {
  constructor (playerUuid) { this.playerUuid = playerUuid; this.bearings = new Map(); this.crafts = []; this.samples = []; this.complete = false }
  observe (receipt, at = Date.now()) {
    if (receipt?.playerUuid !== this.playerUuid || receipt.ok !== true || receipt.outcomeUnknown === true) return
    const r = receipt.result
    if (r?.playerUuid && r.playerUuid !== this.playerUuid) return
    if (r?.ok !== true || r.outcomeKnown === false || r.outcomeUnknown === true) return
    if (['native.craft', 'native.craftRecipe'].includes(receipt.id)) this.crafts.push({ at, outputId: r.outputId ?? r.output?.id ?? r.id ?? null, recipeId: r.recipeId ?? null, receiptIDs: r.receiptIDs ?? [] })
    const p = key(r.position)
    if (receipt.id === 'world.place' && r.nativePlacementVerified && r.nativeBlock?.id === 'create:windmill_bearing' && p) {
      this.bearings.set(p, { at, position: r.position, callId: receipt.callId })
    }
    const w = r.block?.windmill
    if (!['world.lookAt', 'world.look'].includes(receipt.id) || !p || !this.bearings.has(p) ||
        r.block.id !== 'create:windmill_bearing' || w?.source !== 'native_visible_block_entity' ||
        !w.running || w.stalled !== false || !Number.isFinite(w.generatedSpeed) || w.generatedSpeed === 0 ||
        !Number.isInteger(w.sailCount) || w.sailCount < w.minimumSails || !Number.isFinite(w.angleDegrees) || !w.contraptionUuid) return
    this.samples.push({ at, position: r.position, ...w })
    if (this.samples.length > 12) this.samples.shift()
    this.complete ||= this.samples.some(old => key(old.position) === p && old.contraptionUuid === w.contraptionUuid &&
      at - old.at >= 250 && Math.abs(((w.angleDegrees - old.angleDegrees + 540) % 360) - 180) > 0.01)
  }
  snapshot () { return { kind: 'create_windmill', complete: this.complete, playerUuid: this.playerUuid,
    placedBearings: [...this.bearings.values()], crafts: this.crafts, samples: this.samples,
    scope: 'ordinary_player_construction_from_task_materials_not_natural_resource_gathering' } }
}
module.exports = { WindmillTaskEvidence }
