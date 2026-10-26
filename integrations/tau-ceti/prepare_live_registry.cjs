'use strict'
// Build one immutable registry snapshot from this exact running JVM's export.
// Generated mod registration order can change across boots even with identical JARs.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process')
const { fileHash } = require('./gateway-overrides/bounded-jsonl.cjs')

const NAMES = ['components.tsv', 'particles.tsv', 'entity-data-serializers.tsv', 'network-channels.json',
  'block-states.jsonl', 'blocks.tsv', 'items.tsv', 'entities.tsv']
function rebaseItems (catalog, rows) {
  const byName = new Map(), ids = new Set()
  for (const line of rows.split(/\r?\n/)) {
    if (!line) continue
    const [name, value] = line.split('\t'), id = Number(value)
    if (!/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(name) || !Number.isSafeInteger(id) || id < 0 || byName.has(name) || ids.has(id)) throw Error('INVALID_LIVE_ITEM_REGISTRY')
    byName.set(name, id); ids.add(id)
  }
  return { ...catalog, items: catalog.items.map(row => {
    if (!byName.has(row.nativeItem)) throw Error('LIVE_ITEM_MISSING ' + row.nativeItem)
    return { ...row, nativeId: byName.get(row.nativeItem) }
  }) }
}
function prepare (source, template, output, pid) {
  source = path.resolve(source); template = path.resolve(template); output = path.resolve(output)
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error('LIVE_JVM_PID_REQUIRED')
  if (fs.existsSync(output)) throw Error('LIVE_REGISTRY_OUTPUT_EXISTS')
  const completeFile = path.join(source, 'complete.json')
  const completeBytes = fs.readFileSync(completeFile), complete = JSON.parse(completeBytes)
  if (complete.processId !== pid) throw Error('LIVE_REGISTRY_WRONG_PROCESS')
  const metadata = JSON.parse(fs.readFileSync(path.join(source, 'network-channels.json'), 'utf8'))
  if (metadata.neoforge !== '21.1.234' || metadata.minecraft !== '1.21.1') throw Error('LIVE_REGISTRY_VERSION')
  fs.mkdirSync(output, { recursive: false })
  for (const name of NAMES) fs.copyFileSync(path.join(source, name), path.join(output, name), fs.constants.COPYFILE_EXCL)
  if (!fs.readFileSync(completeFile).equals(completeBytes)) throw Error('LIVE_REGISTRY_EXPORT_CHANGED')
  const catalog = JSON.parse(fs.readFileSync(path.join(template, 'registry/items.json'), 'utf8'))
  fs.writeFileSync(path.join(output, 'items.json'), JSON.stringify(rebaseItems(catalog, fs.readFileSync(path.join(output, 'items.tsv'), 'utf8'))))
  const dependencies = path.join(template, 'node_modules')
  const requireDependencies = require('node:module').createRequire(path.join(template, 'node_modules/__tau__.cjs'))
  const data = requireDependencies('minecraft-data')('1.21.1')
  const vanilla = path.join(output, 'vanilla'); fs.mkdirSync(vanilla)
  for (const key of ['blocks', 'items']) fs.writeFileSync(path.join(vanilla, key + '.json'), JSON.stringify(Object.values(data[key])))
  const env = { ...process.env, NODE_PATH: dependencies, MINECRAFT_DATA_DIR: vanilla,
    IDMAP_DUMP_DIR: output, IDMAP_OUTPUT_FILE: path.join(output, 'idmap.json') }
  const result = cp.spawnSync(path.join(template, 'node.exe'), [path.join(template, 'gate/build-idmap.cjs')],
    { env, encoding: 'utf8', timeout: 90000, windowsHide: true, maxBuffer: 1024 * 1024 })
  if (result.error || result.status !== 0) throw Error('LIVE_REGISTRY_MAPPING_FAILED ' + (result.error?.message || result.stderr?.slice(-1000)))
  const hashes = Object.fromEntries([...NAMES, 'items.json', 'idmap.json'].map(name => [name, fileHash(path.join(output, name))]))
  const record = { schemaVersion: 1, serverPid: pid, sourceExport: complete, observedAt: new Date().toISOString(),
    templateReleaseSha256: fileHash(path.join(template, 'release.json')), files: hashes,
    customModelMarkersPreservedByName: true }
  fs.writeFileSync(path.join(output, 'complete.json'), JSON.stringify(record))
  return { status: 'prepared', serverPid: pid, directory: output, statesSha256: hashes['block-states.jsonl'] }
}
module.exports = { rebaseItems, prepare }
if (require.main === module) {
  const [source, template, output, pid] = process.argv.slice(2)
  try { console.log(JSON.stringify(prepare(source, template, output, Number(pid)))) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
