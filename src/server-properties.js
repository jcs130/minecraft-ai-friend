'use strict'

const fs = require('node:fs')
const path = require('node:path')

const EDITABLE_KEYS = new Set([
  'gamemode',
  'force-gamemode',
  'difficulty',
  'hardcore',
  'pvp',
  'white-list',
  'online-mode',
  'max-players',
  'motd',
  'level-name',
  'spawn-protection',
  'allow-flight',
  'enable-command-block',
  'view-distance',
  'simulation-distance'
])

function propertiesPath(serverDir) {
  const dir = String(serverDir || '').trim()
  return dir ? path.join(dir, 'server.properties') : ''
}

function readServerProperties(serverDir) {
  const filePath = propertiesPath(serverDir)
  if (!filePath) {
    return {
      serverDir: '',
      path: '',
      exists: false,
      values: {},
      editableKeys: Array.from(EDITABLE_KEYS)
    }
  }

  if (!fs.existsSync(filePath)) {
    return {
      serverDir,
      path: filePath,
      exists: false,
      values: {},
      editableKeys: Array.from(EDITABLE_KEYS)
    }
  }

  const raw = fs.readFileSync(filePath, 'utf8')
  return {
    serverDir,
    path: filePath,
    exists: true,
    values: pickEditableValues(parseProperties(raw)),
    editableKeys: Array.from(EDITABLE_KEYS)
  }
}

function writeServerProperties(serverDir, updates) {
  const filePath = propertiesPath(serverDir)
  if (!filePath) throw new Error('Minecraft server directory is not configured')
  if (!fs.existsSync(filePath)) throw new Error(`server.properties not found at ${filePath}`)

  const cleanUpdates = sanitizeUpdates(updates)
  const raw = fs.readFileSync(filePath, 'utf8')
  const backupPath = backupFile(filePath, raw)
  const next = updatePropertiesText(raw, cleanUpdates)
  fs.writeFileSync(filePath, next, 'utf8')

  return {
    ...readServerProperties(serverDir),
    backupPath,
    savedKeys: Object.keys(cleanUpdates)
  }
}

function parseProperties(raw) {
  const values = {}
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index === -1) continue
    const key = line.slice(0, index).trim()
    values[key] = line.slice(index + 1).trim()
  }
  return values
}

function pickEditableValues(values) {
  const picked = {}
  for (const key of EDITABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(values, key)) picked[key] = values[key]
  }
  return picked
}

function sanitizeUpdates(updates) {
  const clean = {}
  for (const [key, value] of Object.entries(updates || {})) {
    if (!EDITABLE_KEYS.has(key)) continue
    clean[key] = sanitizeValue(key, value)
  }
  return clean
}

function sanitizeValue(key, value) {
  const raw = String(value ?? '').trim()
  if (['force-gamemode', 'hardcore', 'pvp', 'white-list', 'online-mode', 'allow-flight', 'enable-command-block'].includes(key)) {
    return raw === 'true' ? 'true' : 'false'
  }
  if (key === 'gamemode') {
    return ['survival', 'creative', 'adventure', 'spectator'].includes(raw) ? raw : 'survival'
  }
  if (key === 'difficulty') {
    return ['peaceful', 'easy', 'normal', 'hard'].includes(raw) ? raw : 'normal'
  }
  if (['max-players', 'spawn-protection', 'view-distance', 'simulation-distance'].includes(key)) {
    const number = Number(raw)
    if (!Number.isFinite(number)) return key === 'max-players' ? '20' : '10'
    const min = key === 'max-players' ? 1 : 0
    const max = key === 'max-players' ? 200 : 64
    return String(Math.max(min, Math.min(max, Math.round(number))))
  }
  return raw.replace(/\r?\n/g, ' ').slice(0, 160)
}

function updatePropertiesText(raw, updates) {
  const seen = new Set()
  const lines = String(raw).split(/\r?\n/)
  const updated = lines.map(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !line.includes('=')) return line
    const index = line.indexOf('=')
    const key = line.slice(0, index).trim()
    if (!Object.prototype.hasOwnProperty.call(updates, key)) return line
    seen.add(key)
    return `${key}=${updates[key]}`
  })

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) updated.push(`${key}=${value}`)
  }

  return updated.join('\n')
}

function backupFile(filePath, raw) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${filePath}.bak-${stamp}`
  fs.writeFileSync(backupPath, raw, 'utf8')
  return backupPath
}

module.exports = {
  readServerProperties,
  writeServerProperties
}