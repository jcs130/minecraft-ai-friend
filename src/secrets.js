'use strict'

const fs = require('node:fs')

const SECRET_NAME_PATTERN = /^[A-Z0-9_]*(API_KEY|TOKEN|SECRET|KEY)$/

function loadSecretEnv(options = {}) {
  const baseEnv = options.baseEnv || process.env
  const logger = options.logger
  const next = { ...baseEnv }
  const loadedFiles = []

  for (const filePath of options.paths || []) {
    if (!filePath || !fs.existsSync(filePath)) continue
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      for (const [name, value] of Object.entries(parsed)) {
        if (!isSecretName(name)) continue
        if (typeof value !== 'string' || !value.trim()) continue
        if (!next[name]) next[name] = value.trim()
      }
      loadedFiles.push(filePath)
    } catch (error) {
      if (logger) logger.warn(`Secret file load failed: ${filePath}: ${error.message}`)
    }
  }

  Object.defineProperty(next, '__secretFiles', {
    value: loadedFiles,
    enumerable: false
  })
  return next
}

function secretEnvStatus(env = process.env) {
  return {
    loadedFiles: Array.isArray(env.__secretFiles) ? env.__secretFiles : []
  }
}

function isSecretName(name) {
  return SECRET_NAME_PATTERN.test(String(name || ''))
}

module.exports = { loadSecretEnv, secretEnvStatus }
