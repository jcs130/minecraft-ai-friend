'use strict'

/**
 * Compiled protodef switches without a `default` arm decode as void (0 bytes).
 * An unknown SlotComponent type or entity-metadata type would then be skipped,
 * the cursor would stay put, and later fields would be read from the wrong
 * bytes — appearing to succeed. The interpreter path already throws.
 *
 * This module installs a throwing default on those two switches and records
 * sanitized evidence (no payload bytes, no NBT, no item contents).
 */

const EVIDENCE_CAP = 32
const evidence = []

function sanitizeEvidence (input) {
  const remaining = Number(input?.remainingBytes)
  return {
    kind: String(input?.kind || 'unknown_discriminated_field'),
    discriminator: input?.discriminator === undefined || input?.discriminator === null
      ? null
      : (typeof input.discriminator === 'number' || typeof input.discriminator === 'boolean'
        ? input.discriminator
        : String(input.discriminator).slice(0, 128)),
    remainingBytes: Number.isFinite(remaining) ? remaining : null,
    at: new Date().toISOString()
  }
}

function recordUnknownField (input) {
  const ev = sanitizeEvidence(input)
  evidence.push(ev)
  if (evidence.length > EVIDENCE_CAP) evidence.shift()
  return ev
}

function getUnknownFieldEvidence () {
  return evidence.slice()
}

function clearUnknownFieldEvidence () {
  evidence.length = 0
}

class UnknownDiscriminatedFieldError extends Error {
  constructor (evidence) {
    const ev = sanitizeEvidence(evidence)
    super(`unknown ${ev.kind} discriminator=${JSON.stringify(ev.discriminator)} remainingBytes=${ev.remainingBytes}`)
    this.name = 'UnknownDiscriminatedFieldError'
    this.code = 'UNKNOWN_DISCRIMINATED_FIELD'
    this.evidence = ev
  }
}

function fail (kind, discriminator, remainingBytes) {
  const ev = recordUnknownField({ kind, discriminator, remainingBytes })
  throw new UnknownDiscriminatedFieldError(ev)
}

const compilerTypes = {
  Read: {
    strictUnknownDiscriminator: ['native', (buffer, offset) => {
      fail('strictUnknownDiscriminator', undefined, buffer.length - offset)
    }]
  },
  Write: {
    strictUnknownDiscriminator: ['native', (_value, _buffer, _offset) => {
      fail('strictUnknownDiscriminator', undefined, null)
    }]
  },
  SizeOf: {
    strictUnknownDiscriminator: ['native', () => {
      fail('strictUnknownDiscriminator', undefined, null)
    }]
  }
}

const interpreterTypes = {
  strictUnknownDiscriminator: [
    (buffer, offset) => { fail('strictUnknownDiscriminator', undefined, buffer.length - offset) },
    () => { fail('strictUnknownDiscriminator', undefined, null) },
    () => { fail('strictUnknownDiscriminator', undefined, null) }
  ]
}

function patchSwitchDefault (node, kind) {
  if (!Array.isArray(node) || node[0] !== 'container') return false
  for (const field of node[1] || []) {
    const t = field?.type
    if (Array.isArray(t) && t[0] === 'switch' && t[1] && typeof t[1] === 'object') {
      t[1].default = 'strictUnknownDiscriminator'
      t[1].strictKind = kind
      return true
    }
  }
  return false
}

function walkPatchSwitch (node, compareTo, kind) {
  let patched = false
  const visit = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) {
      if (n[0] === 'switch' && n[1] && typeof n[1] === 'object' && n[1].compareTo === compareTo) {
        // Optional arms use default "void". Missing / null / None defaults would
        // otherwise compile as void and skip unknown ids — fail closed instead.
        if (n[1].default !== 'void') {
          n[1].default = 'strictUnknownDiscriminator'
          n[1].strictKind = kind
          patched = true
        }
        return
      }
      for (const x of n) visit(x)
      return
    }
    for (const v of Object.values(n)) visit(v)
  }
  visit(node)
  return patched
}

function applyStrictDiscriminators (protocol) {
  const types = protocol?.types
  if (!types) return { slotComponent: false, entityMetadataEntry: false }
  const playTypes = protocol.play?.toClient?.types
  return {
    slotComponent: types.SlotComponent ? patchSwitchDefault(types.SlotComponent, 'slot_component') : false,
    entityMetadataEntry: types.entityMetadataEntry ? patchSwitchDefault(types.entityMetadataEntry, 'entity_metadata_type') : false,
    particle: types.Particle ? walkPatchSwitch(types.Particle, 'type', 'particle') : false,
    vibrationPosition: types.Particle ? walkPatchSwitch(types.Particle, 'positionType', 'vibration_position') : false,
    commandParser: types.command_node ? walkPatchSwitch(types.command_node, 'parser', 'command_parser') : false,
    commandNodeType: types.command_node ? walkPatchSwitch(types.command_node, 'flags/command_node_type', 'command_node_type') : false,
    slotDisplay: playTypes?.SlotDisplay ? walkPatchSwitch(playTypes.SlotDisplay, 'type', 'slot_display') : false,
    recipeDisplay: playTypes?.RecipeDisplay ? walkPatchSwitch(playTypes.RecipeDisplay, 'type', 'recipe_display') : false
  }
}

module.exports = {
  UnknownDiscriminatedFieldError,
  recordUnknownField,
  getUnknownFieldEvidence,
  clearUnknownFieldEvidence,
  compilerTypes,
  interpreterTypes,
  applyStrictDiscriminators
}
