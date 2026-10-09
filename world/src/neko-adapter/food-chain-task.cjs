'use strict'
const key = p => p && ['x', 'y', 'z'].every(k => Number.isInteger(p[k])) ? `${p.x},${p.y},${p.z}` : null
const items = state => state.playerInventory ?? state.slots ?? []
const total = (state, id) => items(state).reduce((n, item, index) => n +
  (item?.id === id && (item.slot ?? index) >= 9 && (item.slot ?? index) <= 44 ? item.count : 0), 0)
const slot = (state, index) => state.slots?.find((item, i) => (item?.slot ?? i) === index) ?? null
// Only evidence: never places a machine, rolls a reward or advances the model.
class FoodChainTaskEvidence {
  constructor (playerUuid, { bearingPosition, contraptionUuid }) {
    this.playerUuid = playerUuid; this.bearingPosition = bearingPosition; this.contraptionUuid = contraptionUuid
    this.crafts = []; this.samples = []; this.placed = new Map(); this.progress = {}; this.complete = false
    this.flourBaseline = null; this.breadBaseline = null; this.furnaceContext = null; this.furnaceInputCount = null
  }
  observe (receipt, at = Date.now(), args = {}) {
    if (receipt?.playerUuid !== this.playerUuid || receipt.ok !== true || receipt.outcomeUnknown === true) return
    const r = receipt.result
    if (!r || r.ok === false || r.outcomeKnown === false || r.outcomeUnknown === true || r.playerUuid !== this.playerUuid) return
    if (['native.craft', 'native.craftRecipe'].includes(receipt.id)) {
      const outputId = r.item?.id ?? r.id ?? r.outputId ?? r.output?.id
      if (typeof outputId !== 'string') return
      this.crafts.push({ at, outputId, ...(r.recipeId ? { recipeId: r.recipeId } : {}), ...(receipt.callId ? { callId: receipt.callId } : {}) })
      if (outputId === 'create:dough' && this.progress.flourAcquired) this.progress.doughCrafted = { at, callId: receipt.callId }
    }
    const p = key(r.position)
    if (receipt.id === 'world.place' && r.nativePlacementVerified === true && p && typeof r.nativeBlock?.id === 'string') this.placed.set(p, r.nativeBlock.id)
    if (receipt.id === 'world.dig' && r.code === 'native_block_removed' && r.outcomeKnown === true && p) {
      this.placed.delete(p)
      if (this.furnaceContext === p) this.furnaceContext = null
    }
    const observedBlock = receipt.id === 'world.place' ? r.nativeBlock : ['world.lookAt', 'world.look'].includes(receipt.id) ? r.block : null
    if (this.placed.get(p) === 'create:millstone' && observedBlock?.id === 'create:millstone' &&
        Number.isFinite(observedBlock.kinetic?.speed) && observedBlock.kinetic.speed !== 0 && observedBlock.kinetic.overstressed === false) {
      this.progress.millstonePowered = { at, position: r.position, rpm: observedBlock.kinetic.speed }
    }
    if (['world.lookAt', 'world.look'].includes(receipt.id)) {
      const w = r.block?.windmill
      if (p === key(this.bearingPosition) && w?.running === true && w.stalled === false && w.contraptionUuid === this.contraptionUuid && w.generatedSpeed !== 0) {
        this.samples.push({ at, angleDegrees: w.angleDegrees, contraptionUuid: w.contraptionUuid })
        this.samples = this.samples.slice(-12)
        if (this.samples.some(old => at - old.at >= 250 && old.angleDegrees !== w.angleDegrees)) this.progress.windmillRunning = { at, position: r.position }
      }
      if (this.placed.get(p) === 'create:millstone' && r.block?.id === 'create:millstone') {
        const processing = r.block.processing, kinetic = r.block.kinetic
        // PlayerWorldBridge exposes Create's getSpeed() as speed (RPM).
        // Do not substitute theoreticalSpeed: an overstressed machine can have
        // a theoretical drive speed while its actual speed is zero.
        const rpm = kinetic?.speed
        if (processing?.type === 'create:milling' && processing.recipeId === 'create:milling/wheat' &&
            rpm !== 0 && Number.isFinite(rpm) && kinetic.overstressed === false && processing.advancing === true) {
          this.progress.poweredMilling = { at, position: r.position, rpm, recipeId: processing.recipeId }
        }
        if (this.progress.poweredMilling && key(this.progress.poweredMilling.position) === p &&
            processing?.output?.some(item => item.id === 'create:wheat_flour' && item.count > 0 && item.snbt)) this.progress.flourOutput = { at, position: r.position }
      }
    }
    if (receipt.id === 'world.interact') this.furnaceContext = this.placed.get(key(args.position)) === 'minecraft:furnace' && r.ok === true ? key(args.position) : null
    if (receipt.id === 'menu.close') this.furnaceContext = null
    const state = receipt.id === 'menu.current' ? r : r.state
    if (state?.playerUuid === this.playerUuid && Array.isArray(state.slots)) {
      const flour = total(state, 'create:wheat_flour'), bread = total(state, 'minecraft:bread')
      if (this.flourBaseline === null || !this.progress.flourOutput) this.flourBaseline = flour
      if (this.breadBaseline === null) this.breadBaseline = bread
      if (this.progress.flourOutput && flour > this.flourBaseline) this.progress.flourAcquired = { at, count: flour - this.flourBaseline }
      if (this.furnaceContext && state.menuType === 'minecraft:furnace') {
        const input = slot(state, 0), output = slot(state, 2)
        if (!this.progress.breadBaked && this.furnaceInputCount > 0 && (input?.id !== 'create:dough' || input.count < this.furnaceInputCount) && output?.id === 'minecraft:bread' && output.count > 0) {
          this.progress.breadBaked = { at, furnacePosition: this.furnaceContext, count: output.count }
          this.breadBaseline = bread // Old emergency bread already carried cannot establish pickup of this output.
        }
        if (input?.id === 'create:dough' && this.progress.doughCrafted) this.furnaceInputCount = input.count
      }
      if (this.progress.breadBaked && bread > this.breadBaseline) this.progress.breadAcquired = { at, count: bread - this.breadBaseline }
    }
    if (receipt.id === 'inventory.consume' && r.itemId === 'minecraft:bread' && r.consumedCount === 1 &&
        r.foodAfter > r.foodBefore && this.progress.breadAcquired) this.progress.breadEaten = { at, foodBefore: r.foodBefore, foodAfter: r.foodAfter, callId: receipt.callId }
    this.complete = ['windmillRunning', 'poweredMilling', 'flourOutput', 'flourAcquired', 'doughCrafted', 'breadBaked', 'breadAcquired', 'breadEaten'].every(k => this.progress[k])
  }
  snapshot () { return { kind: 'create_food_chain', playerUuid: this.playerUuid, complete: this.complete,
    progress: this.progress, crafts: this.crafts, samples: this.samples, placedMachines: [...this.placed].map(([position, id]) => ({ position, id })),
    scope: 'ordinary_player_food_production_from_disclosed_supplied_resources_not_natural_gathering' } }
}
module.exports = { FoodChainTaskEvidence }
