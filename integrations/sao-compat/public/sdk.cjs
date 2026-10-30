'use strict'
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), zlib = require('node:zlib')
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
async function limitedFetch (url, budget) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw Error('native_registry_download_' + response.status)
  if (Number(response.headers.get('content-length')) > budget) throw Error('native_registry_download_budget')
  const chunks = []; let total = 0
  for await (const chunk of response.body) { total += chunk.length; if (total > budget) throw Error('native_registry_download_budget'); chunks.push(chunk) }
  return Buffer.concat(chunks)
}
async function prepareConnection ({ host, port = 28977, cacheDirectory }) {
  if (typeof host !== 'string' || !host || /[\s/@?#]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !cacheDirectory) throw Error('explicit_host_port_and_private_cache_required')
  const base = new URL('http://' + host + ':' + port)
  const manifest = JSON.parse((await limitedFetch(new URL('/native-manifest.json', base), 65536)).toString('utf8'))
  if (manifest.schemaVersion !== 1 || manifest.minecraft !== '1.20.1' || !/^[a-f0-9-]{36}$/.test(manifest.serverEpoch)) throw Error('invalid_native_registry_manifest')
  const root = path.resolve(cacheDirectory, sha(Buffer.from(host + ':' + port)).slice(0, 16), manifest.serverEpoch)
  const directory = path.join(root, 'registry', manifest.serverEpoch)
  await fs.mkdir(directory, { recursive: true })
  const files = {}
  for (const name of ['states.jsonl', 'items.jsonl', 'entities.jsonl']) {
    const item = manifest.files?.[name]
    if (!item || item.path !== '/native/' + manifest.serverEpoch + '/' + name + '.gz' ||
        !/^[a-f0-9]{64}$/.test(item.sha256) || !/^[a-f0-9]{64}$/.test(item.compressedSha256) ||
        !Number.isInteger(item.bytes) || item.bytes < 0 || item.bytes > 192 * 1024 * 1024) throw Error('invalid_native_registry_file')
    const target = path.join(directory, name); let bytes
    try { bytes = await fs.readFile(target); if (sha(bytes) !== item.sha256) throw Error('cached_native_registry_hash_mismatch') } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (!bytes) {
      const packed = await limitedFetch(new URL(item.path, base), 32 * 1024 * 1024)
      if (sha(packed) !== item.compressedSha256) throw Error('downloaded_native_registry_hash_mismatch')
      bytes = zlib.gunzipSync(packed, { maxOutputLength: 192 * 1024 * 1024 })
      if (bytes.length !== item.bytes || sha(bytes) !== item.sha256) throw Error('expanded_native_registry_hash_mismatch')
      try { await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 }) } catch (error) { if (error.code !== 'EEXIST' || sha(await fs.readFile(target)) !== item.sha256) throw error }
    }
    files[name] = { sha256: item.sha256, bytes: item.bytes }
  }
  const write = (name, value) => fs.writeFile(path.join(root, name), JSON.stringify(value), { mode: 0o600 })
  await write('pack-source.json', { scope: 'remote_client_cache', minecraft: '1.20.1' })
  await write('agent-connection.json', { host, port })
  await write('registry-bundle.json', { schemaVersion: 1, serverEpoch: manifest.serverEpoch, files })
  await fs.writeFile(path.join(root, 'registry/current.json'), JSON.stringify(manifest.metadata), { mode: 0o600 })
  return root
}
async function connect (options) {
  const root = await prepareConnection(options)
  const { createSAOBot } = require('./integrations/sao-compat/sao_bot.cjs')
  const { attachSaoGameplay } = require('./integrations/sao-compat/sao-client.cjs')
  const bot = createSAOBot({ root, username: options.username, botOptions: options.botOptions || {}, authenticate: options.authenticate })
  bot.sao = attachSaoGameplay(bot)
  await bot.nativeReady
  return bot
}
module.exports = { prepareConnection, connect }
