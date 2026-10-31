'use strict'
// Prepare, never start, one loopback gateway from this exact JVM's export.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto')
const { createRequire } = require('node:module')
const channelModule = path.resolve(__dirname, '../../../integrations/tau-ceti/gateway-overrides/channel-manifest.cjs')
const { patchGateway } = require('./gateway-patch.cjs')
const { improveFile } = require('./faithful-vanilla-map.cjs')
function validateExport (complete, channels, pid, now = Date.now()) {
  if (!Number.isSafeInteger(pid) || pid < 1 || complete?.schemaVersion !== 1 || complete.processId !== pid) throw Error('LIVE_JVM_ID_REQUIRED')
  const date = Date.parse(complete.completedAt)
  if (!Number.isFinite(date) || date > now + 5000 || now - date > 600000) throw Error('FRESH_REGISTRY_EXPORT_REQUIRED')
  if (channels?.minecraft !== '1.21.1' || channels.neoforge !== '21.1.252') throw Error('REVIEWED_REGISTRY_VERSION_REQUIRED')
  require(channelModule).channelKnowledge(channels)
}
const inside = (parent, child) => { const rel = path.relative(parent, child); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)) }
function prepare ({ source, template, output, pid, listenPort = 39771, backendPort = 39761 }) {
  for (const p of [listenPort, backendPort]) if (!Number.isSafeInteger(p) || p < 1024 || p > 65535) throw Error('EXPLICIT_UNPRIVILEGED_PORT_REQUIRED')
  source = fs.realpathSync(source); template = fs.realpathSync(template); output = path.resolve(output)
  if (fs.existsSync(output) || inside(source, output) || inside(template, output)) throw Error('FRESH_SEPARATE_OUTPUT_REQUIRED')
  const completeBytes = fs.readFileSync(path.join(source, 'complete.json'))
  if (completeBytes.length > 4096) throw Error('REGISTRY_MARKER_BUDGET')
  const channelsFile = path.join(source, 'network-channels.json')
  if (fs.statSync(channelsFile).size > 1024 * 1024) throw Error('CHANNEL_MANIFEST_BUDGET')
  const complete = JSON.parse(completeBytes), channels = JSON.parse(fs.readFileSync(channelsFile))
  validateExport(complete, channels, pid)
  const patchedGateway = patchGateway(fs.readFileSync(path.join(template, 'gate/gate.cjs')))
  process.kill(pid, 0) // A dead JVM is not a usable endpoint. The host also checks its owned process receipt.
  const deps = createRequire(path.join(template, 'node_modules/_native_gateway_.cjs'))
  const data = deps('minecraft-data')('1.21.1')
  const node = path.join(template, 'node.exe'); if (!fs.existsSync(node)) throw Error('FROZEN_NODE_RUNTIME_REQUIRED')
  fs.mkdirSync(output)
  const gate = path.join(output, 'gate'), registry = path.join(output, 'registry'), vanilla = path.join(registry, 'vanilla')
  fs.cpSync(path.join(template, 'gate'), gate, { recursive: true, force: false, errorOnExist: true })
  fs.copyFileSync(channelModule, path.join(gate, 'channel-manifest.cjs'))
  fs.writeFileSync(path.join(gate, 'gate.cjs'), patchedGateway)
  for (const name of ['direct-gateway.cjs', 'native-world.cjs', 'registry-protocol.cjs'])
    fs.copyFileSync(path.join(__dirname, 'agent-access', name), path.join(gate, name))
  fs.mkdirSync(registry); fs.mkdirSync(vanilla)
  const names = ['components.tsv', 'particles.tsv', 'entity-data-serializers.tsv', 'network-channels.json', 'block-states.jsonl', 'blocks.tsv', 'items.tsv', 'entities.tsv']
  for (const name of names) fs.copyFileSync(path.join(source, name), path.join(registry, name), fs.constants.COPYFILE_EXCL)
  if (!fs.readFileSync(path.join(source, 'complete.json')).equals(completeBytes)) throw Error('REGISTRY_EXPORT_CHANGED')
  for (const name of ['blocks', 'items']) fs.writeFileSync(path.join(vanilla, name + '.json'), JSON.stringify(Object.values(data[name])))
  const env = { ...process.env, NODE_PATH: path.join(template, 'node_modules'), MINECRAFT_DATA_DIR: vanilla, IDMAP_DUMP_DIR: registry, IDMAP_OUTPUT_FILE: path.join(registry, 'idmap.json') }
  const result = cp.spawnSync(node, [path.join(gate, 'build-idmap.cjs')], { env, timeout: 90000, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 })
  fs.writeFileSync(path.join(output, 'mapping.log'), (result.stdout || '') + (result.stderr || ''))
  if (result.error || result.status !== 0) throw Error('REGISTRY_MAPPING_FAILED')
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const faithfulProjection = improveFile(path.join(registry, 'idmap.json'), path.join(registry, 'block-states.jsonl'), hash(path.join(registry, 'block-states.jsonl')))
  const launch = { schemaVersion: 1, serverPid: pid, command: node, args: [path.join(gate, 'gate.cjs'), String(listenPort), '127.0.0.1', String(backendPort)],
    cwd: output, env: { NODE_PATH: path.join(template, 'node_modules'), GATE_LISTEN_HOST: '127.0.0.1', GATE_PUBLIC_GAME_ACCESS: '0', GATE_VANILLA: '0',
      GATE_COMPONENTS_FILE: path.join(registry, 'components.tsv'), GATE_PARTICLES_FILE: path.join(registry, 'particles.tsv'),
      GATE_ENTITY_SERIALIZERS_FILE: path.join(registry, 'entity-data-serializers.tsv'), GATE_CHANNELS_FILE: path.join(registry, 'network-channels.json'),
      GATE_NATIVE_STATES_FILE: path.join(registry, 'block-states.jsonl'), GATE_IDMAP_FILE: path.join(registry, 'idmap.json'),
      GATE_CACHE_FILE: path.join(output, 'knowledge.json'), GATE_NATIVE_VIEWER: '1', GATE_VANILLA_PROJECTION: '1', GATE_NEOFORGE_TIME_BRIDGE: '1', GATE_SKIP_MOD_RECIPES: '1', GATE_MINEFLAYER_DIRECT: '1' },
    started: false, primaryModified: false }
  fs.writeFileSync(path.join(output, 'launch.json'), JSON.stringify(launch, null, 2))
  const record = { schemaVersion: 1, serverPid: pid, sourceExport: complete, observedAt: new Date().toISOString(),
    files: Object.fromEntries([...names, 'idmap.json'].map(name => [name, hash(path.join(registry, name))])),
    templateReleaseSha256: hash(path.join(template, 'release.json')), sourceSha256: hash(__filename), faithfulProjection,
    gateSourceSha256: hash(path.join(gate, 'gate.cjs')), started: false }
  fs.writeFileSync(path.join(registry, 'complete.json'), JSON.stringify(record, null, 2))
  return { status: 'prepared', serverPid: pid, output, registrySha256: record.files['block-states.jsonl'], started: false }
}
module.exports = { prepare, validateExport }
if (require.main === module) {
  const [source, template, output, serverPid, listenPort = '39771', backendPort = '39761'] = process.argv.slice(2)
  try { console.log(JSON.stringify(prepare({ source, template, output, pid: Number(serverPid), listenPort: Number(listenPort), backendPort: Number(backendPort) }))) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
