'use strict'

const { spawn } = require('node:child_process')
const os = require('node:os')

async function listMindcraftProcesses(mindcraftDir) {
  const processes = os.platform() === 'win32'
    ? await listWindowsProcesses()
    : await listUnixProcesses()

  const normalizedDir = normalizeForMatch(mindcraftDir)
  return processes.filter(processInfo => {
    const command = normalizeForMatch(processInfo.command)
    return command.includes('node') && command.includes('main.js') &&
      (!normalizedDir || command.includes(normalizedDir))
  })
}

function normalizeForMatch(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase()
}

function run(command, args, timeoutMs = 4000) {
  return new Promise(resolve => {
    let child
    try {
      child = spawn(command, args, { windowsHide: true })
    } catch (error) {
      resolve({ code: 1, stdout: '', stderr: error.message })
      return
    }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: 124, stdout, stderr })
    }, timeoutMs)
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', error => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr: error.message })
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

async function listWindowsProcesses() {
  const command = [
    'Get-CimInstance Win32_Process',
    '| Where-Object { $_.CommandLine -and $_.CommandLine -match "node(.exe)?(.+)?main.js" }',
    '| Select-Object ProcessId,CommandLine',
    '| ConvertTo-Json -Compress'
  ].join(' ')
  const result = await run('powershell.exe', ['-NoProfile', '-Command', command])
  if (result.code !== 0 || !result.stdout.trim()) return []
  try {
    const parsed = JSON.parse(result.stdout)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows.map(row => ({
      pid: Number(row.ProcessId),
      command: String(row.CommandLine || '')
    }))
  } catch {
    return []
  }
}

async function listUnixProcesses() {
  const result = await run('ps', ['-axo', 'pid=,command='])
  if (result.code !== 0) return []
  return result.stdout.split(/\r?\n/).map(line => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/)
    return match ? { pid: Number(match[1]), command: match[2] } : null
  }).filter(Boolean)
}

module.exports = { listMindcraftProcesses }
