'use strict'
// Offline migration into a NEW Tau world, using the installed YAWP 0.6.3-beta3
// schema. No author owners, claims or progression are imported.
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib')
const net = require('node:net')
const nbt = require(process.env.TAU_NBT_MODULE || 'prismarine-nbt')
const str = value => ({ type: 'string', value })
const compound = value => ({ type: 'compound', value })
const list = values => ({ type: 'list', value: { type: 'string', value: values } })
function flag (name) {
  return compound({ name: str(name), type: str('BooleanFlag'), state: str('Denied'),
    override: { type: 'byte', value: 0 }, msg: compound({ msg: str('艾恩葛朗特原图受保护；采集和建设请使用 /mycli wild。'),
      muted: { type: 'byte', value: 0 }, default: { type: 'byte', value: 0 } }) })
}
function sanitize (value) {
  if (!value || typeof value !== 'object') return
  if (value.groups?.value) value.groups = compound({ owners: compound({ name: str('owners') }), members: compound({ name: str('members') }) })
  for (const child of Object.values(value)) sanitize(child)
}
async function read (file) { return (await nbt.parse(fs.readFileSync(file))).parsed }
function save (file, value) { fs.writeFileSync(file, zlib.gzipSync(nbt.writeUncompressed(value))) }
async function install (source, world) {
  world = path.resolve(world); source = path.resolve(source)
  if (world !== path.resolve('E:/MC/servers/tau-ceti-1.3.3/server/world')) throw Error('EXACT_NEW_CANDIDATE_REQUIRED')
  for (const port of [39476, 28976, 28989]) {
    const active = await new Promise(resolve => {
      const socket = net.connect({ host: '127.0.0.1', port })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => resolve(false)); socket.setTimeout(500, () => { socket.destroy(); resolve(false) })
    })
    if (active) throw Error('STOP_NEW_CANDIDATE_FIRST ' + port)
  }
  const output = path.join(world, 'data/yawp'); fs.mkdirSync(output, { recursive: true })
  const global = await read(path.join(source, 'global.dat')); sanitize(global)
  global.value.data.value.global.value.childrenNames = list(['minecraft:overworld', 'myagentworld:wilderness', 'tauceti:tower'])
  save(path.join(output, 'global.dat'), global)
  const dims = await read(path.join(source, 'dimensions.dat'))
  dims.value.data.value.dims = list(['minecraft:overworld', 'myagentworld:wilderness', 'tauceti:tower'])
  save(path.join(output, 'dimensions.dat'), dims)
  const main = await read(path.join(source, 'minecraft_overworld.dat')); sanitize(main)
  const data = main.value.data.value
  data.local_regions = compound({}); data.dim_region.value.childrenNames = list([])
  data.dim_region.value.flags = compound(Object.fromEntries(['break-blocks', 'place-blocks', 'mob-griefing', 'explosions-blocks', 'fire-tick'].map(name => [name, flag(name)])))
  save(path.join(output, 'minecraft_overworld.dat'), main)
  const wild = structuredClone(main), w = wild.value.data.value
  w.id = str('myagentworld:wilderness'); w.dim_region.value.name = str('myagentworld:wilderness')
  w.dim_region.value.dimension = str('myagentworld:wilderness'); w.dim_region.value.flags = compound({})
  save(path.join(output, 'myagentworld_wilderness.dat'), wild)
  const tower = await read(path.join(source, 'tauceti_tower.dat')); sanitize(tower)
  save(path.join(output, 'tauceti_tower.dat'), tower)
  const level = await read(path.join(world, 'level.dat')), settings = level.value.Data.value
  settings.LevelName = str('My Agent World - Aincrad Beta')
  for (const [name, value] of Object.entries({ BorderCenterX: 144, BorderCenterZ: 40, BorderSize: 4736, BorderSizeLerpTarget: 4736 })) settings[name] = { type: 'double', value }
  settings.BorderSizeLerpTime = { type: 'long', value: [0, 0] }
  save(path.join(world, 'level.dat'), level)
  return { installed: true, mapProtected: true, resourceBuildingAllowed: true, authorOwnersImported: false, boundary: { centerX: 144, centerZ: 40, size: 4736 } }
}
module.exports = { flag, sanitize, install }
if (require.main === module) install(process.argv[2], process.argv[3]).then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e.message); process.exitCode = 1 })
