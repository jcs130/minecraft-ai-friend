'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const SETTINGS_KEYS = new Set([
  'minecraft_version',
  'host',
  'port',
  'auth',
  'mindserver_port',
  'auto_open_ui',
  'base_profile',
  'profiles',
  'load_memory',
  'init_message',
  'only_chat_with',
  'speak',
  'chat_ingame',
  'language',
  'render_bot_view',
  'allow_insecure_coding',
  'allow_vision',
  'blocked_actions',
  'code_timeout_mins',
  'relevant_docs_count',
  'max_messages',
  'num_examples',
  'max_commands',
  'show_command_syntax',
  'narrate_behavior',
  'chat_bot_messages',
  'spawn_timeout',
  'block_place_delay',
  'log_all_prompts'
])

const BOOLEAN_KEYS = new Set([
  'auto_open_ui',
  'load_memory',
  'chat_ingame',
  'render_bot_view',
  'allow_insecure_coding',
  'allow_vision',
  'narrate_behavior',
  'chat_bot_messages',
  'log_all_prompts'
])

const NUMBER_KEYS = new Set([
  'port',
  'mindserver_port',
  'code_timeout_mins',
  'relevant_docs_count',
  'max_messages',
  'num_examples',
  'max_commands',
  'spawn_timeout',
  'block_place_delay'
])

const ARRAY_KEYS = new Set(['profiles', 'only_chat_with', 'blocked_actions'])

const SECRET_FILE_NAMES = new Set(['keys.json', 'keys.example.json', 'package.json', 'package-lock.json'])

async function readMindcraftConfig(mindcraftDir, requestedProfilePath = '') {
  const dir = resolveMindcraftDir(mindcraftDir)
  const settingsFile = settingsPath(dir)
  const settings = fs.existsSync(settingsFile) ? await importSettings(settingsFile) : {}
  const profileOptions = listProfileOptions(dir)
  const selectedProfilePath = normalizeProfilePath(dir, requestedProfilePath || firstProfile(settings, profileOptions))
  const profile = selectedProfilePath ? readProfile(dir, selectedProfilePath) : null

  return {
    directory: dir,
    settingsPath: settingsFile,
    settingsExists: fs.existsSync(settingsFile),
    settings: pickSettings(settings),
    profileOptions,
    selectedProfilePath,
    selectedProfileExists: Boolean(profile),
    selectedProfileJson: profile ? JSON.stringify(profile, null, 2) : ''
  }
}

async function writeMindcraftConfig(mindcraftDir, payload) {
  const dir = resolveMindcraftDir(mindcraftDir)
  const settingsFile = settingsPath(dir)
  if (!fs.existsSync(settingsFile)) throw new Error(`Mindcraft settings.js not found at ${settingsFile}`)

  const currentSettings = await importSettings(settingsFile)
  const nextSettings = sanitizeSettings({ ...currentSettings, ...(payload.settings || {}) })
  const settingsBackupPath = backupFile(settingsFile)
  fs.writeFileSync(settingsFile, renderSettingsFile(nextSettings), 'utf8')

  let profileBackupPath = ''
  let savedProfilePath = ''
  if (payload.profilePath && payload.profileJson !== undefined) {
    const profilePath = normalizeProfilePath(dir, payload.profilePath)
    if (!profilePath) throw new Error('Invalid Mindcraft profile path')
    const profileFile = profileAbsolutePath(dir, profilePath)
    const profile = parseProfileJson(payload.profileJson)
    profileBackupPath = fs.existsSync(profileFile) ? backupFile(profileFile) : ''
    fs.writeFileSync(profileFile, JSON.stringify(profile, null, 2) + '\n', 'utf8')
    savedProfilePath = profilePath
  }

  return {
    ...(await readMindcraftConfig(dir, savedProfilePath || payload.profilePath || '')),
    settingsBackupPath,
    profileBackupPath,
    savedProfilePath
  }
}

function resolveMindcraftDir(mindcraftDir) {
  const dir = String(mindcraftDir || '').trim()
  if (!dir) throw new Error('Mindcraft directory is not configured')
  if (!fs.existsSync(dir)) throw new Error(`Mindcraft directory not found: ${dir}`)
  return path.resolve(dir)
}

function settingsPath(mindcraftDir) {
  return path.join(mindcraftDir, 'settings.js')
}

async function importSettings(filePath) {
  const url = pathToFileURL(filePath)
  url.searchParams.set('mtime', String(fs.statSync(filePath).mtimeMs))
  const mod = await import(url.href)
  return cloneJson(mod.default || {})
}

function pickSettings(settings) {
  const picked = {}
  for (const key of SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) picked[key] = settings[key]
  }
  return sanitizeSettings(picked)
}

function sanitizeSettings(settings) {
  const clean = {}
  for (const [key, value] of Object.entries(settings || {})) {
    if (!SETTINGS_KEYS.has(key)) continue
    if (BOOLEAN_KEYS.has(key)) {
      clean[key] = Boolean(value)
    } else if (NUMBER_KEYS.has(key)) {
      clean[key] = sanitizeNumber(key, value)
    } else if (ARRAY_KEYS.has(key)) {
      clean[key] = sanitizeArray(key, value)
    } else if (key === 'auth') {
      clean[key] = ['offline', 'microsoft'].includes(String(value)) ? String(value) : 'offline'
    } else if (key === 'base_profile') {
      clean[key] = ['survival', 'assistant', 'creative', 'god_mode'].includes(String(value)) ? String(value) : 'assistant'
    } else if (key === 'show_command_syntax') {
      clean[key] = ['full', 'shortened', 'none'].includes(String(value)) ? String(value) : 'full'
    } else if (key === 'init_message') {
      clean[key] = value === null || String(value).trim() === '' ? null : String(value).trim().slice(0, 500)
    } else if (key === 'speak') {
      clean[key] = value === false || String(value).trim() === 'false' ? false : String(value || 'system').trim().slice(0, 120)
    } else {
      clean[key] = String(value ?? '').trim().slice(0, 240)
    }
  }
  return clean
}

function sanitizeNumber(key, value) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return ['port', 'mindserver_port'].includes(key) ? (key === 'port' ? 25565 : 8080) : -1
  }
  const rounded = Math.round(number)
  if (key === 'port') return Math.max(-1, Math.min(65535, rounded))
  if (key === 'mindserver_port') return Math.max(1, Math.min(65535, rounded))
  if (key === 'block_place_delay') return Math.max(0, Math.min(60000, rounded))
  if (key === 'spawn_timeout') return Math.max(1, Math.min(600, rounded))
  if (['max_messages', 'num_examples', 'relevant_docs_count'].includes(key)) return Math.max(-1, Math.min(200, rounded))
  return Math.max(-1, Math.min(10000, rounded))
}

function sanitizeArray(key, value) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,]/)
  return items.map(item => String(item).trim()).filter(Boolean).map(item => {
    if (key === 'profiles') return normalizeProfileLikeString(item)
    if (key === 'blocked_actions' && !item.startsWith('!')) return `!${item}`
    return item.slice(0, 160)
  }).filter(Boolean)
}

function normalizeProfileLikeString(value) {
  const raw = String(value || '').replace(/\\/g, '/').trim()
  if (!raw || raw.includes('..') || !raw.endsWith('.json')) return ''
  return raw.startsWith('./') ? raw : `./${raw.replace(/^\/+/, '')}`
}

function listProfileOptions(mindcraftDir) {
  const options = []
  addRootProfiles(mindcraftDir, options)
  addDirectoryProfiles(path.join(mindcraftDir, 'profiles'), './profiles', options)
  return options.sort((a, b) => a.path.localeCompare(b.path))
}

function addRootProfiles(mindcraftDir, options) {
  for (const entry of safeReadDir(mindcraftDir)) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    if (SECRET_FILE_NAMES.has(entry.name)) continue
    options.push({ path: `./${entry.name}`, label: entry.name })
  }
}

function addDirectoryProfiles(dir, prefix, options) {
  for (const entry of safeReadDir(dir)) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['defaults', 'tasks'].includes(entry.name)) continue
      addDirectoryProfiles(fullPath, `${prefix}/${entry.name}`, options)
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      options.push({ path: `${prefix}/${entry.name}`, label: `${prefix}/${entry.name}` })
    }
  }
}

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function firstProfile(settings, profileOptions) {
  const profiles = Array.isArray(settings.profiles) ? settings.profiles : []
  return profiles[0] || (profileOptions[0] ? profileOptions[0].path : '')
}

function normalizeProfilePath(mindcraftDir, profilePath) {
  const normalized = normalizeProfileLikeString(profilePath)
  if (!normalized) return ''
  const fullPath = profileAbsolutePath(mindcraftDir, normalized)
  const relative = path.relative(mindcraftDir, fullPath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return ''
  if (SECRET_FILE_NAMES.has(path.basename(fullPath))) return ''
  return normalized
}

function profileAbsolutePath(mindcraftDir, profilePath) {
  const relative = profilePath.replace(/^\.\//, '')
  return path.resolve(mindcraftDir, relative)
}

function readProfile(mindcraftDir, profilePath) {
  const fullPath = profileAbsolutePath(mindcraftDir, profilePath)
  if (!fs.existsSync(fullPath)) return null
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'))
}

function parseProfileJson(profileJson) {
  let parsed
  try {
    parsed = JSON.parse(String(profileJson || '{}'))
  } catch (error) {
    throw new Error(`Agent Profile JSON 格式错误：${error.message}`)
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Agent Profile 必须是 JSON 对象')
  delete parsed.apiKey
  delete parsed.api_key
  delete parsed.key
  return parsed
}

function renderSettingsFile(settings) {
  return `const settings = ${JSON.stringify(settings, null, 4)};\n\nexport default settings;\n`
}

function backupFile(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = `${filePath}.bak-${stamp}`
  fs.copyFileSync(filePath, backupPath)
  return backupPath
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

module.exports = {
  readMindcraftConfig,
  writeMindcraftConfig
}
