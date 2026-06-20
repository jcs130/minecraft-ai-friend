'use strict'

const fs = require('node:fs')
const path = require('node:path')

class Logger {
  constructor(logDir) {
    this.logDir = logDir
    this.entries = []
    this.maxEntries = 300
    fs.mkdirSync(logDir, { recursive: true })
    this.logFile = path.join(logDir, 'app.log')
  }

  info(message, meta) {
    this.write('info', message, meta)
  }

  warn(message, meta) {
    this.write('warn', message, meta)
  }

  error(message, meta) {
    this.write('error', message, meta)
  }

  write(level, message, meta) {
    const entry = {
      at: new Date().toISOString(),
      level,
      message: String(message),
      meta: meta || null
    }
    this.entries.push(entry)
    if (this.entries.length > this.maxEntries) this.entries.shift()
    const line = `${entry.at} ${level.toUpperCase()} ${entry.message}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`
    fs.appendFile(this.logFile, line, () => {})
    process.stderr.write(line)
  }

  recent(limit = 120) {
    return this.entries.slice(-limit)
  }
}

module.exports = { Logger }
