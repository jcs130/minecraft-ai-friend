const fs = require('fs')
const path = require('path')

function findOfficialRoot () {
  const overlayRoot = fs.realpathSync(__dirname)
  const candidates = []
  const seen = new Set()
  const add = (p) => { if (p && !seen.has(p)) { seen.add(p); candidates.push(p) } }
  let dir = __dirname
  for (let i = 0; i < 16; i++) {
    add(path.join(dir, 'node_modules/minecraft-data'))
    if (path.basename(dir) === 'node_modules') add(path.join(dir, 'minecraft-data'))
    const pnpm = path.join(dir, 'node_modules/.pnpm')
    if (fs.existsSync(pnpm)) {
      for (const entry of fs.readdirSync(pnpm)) {
        if (!entry.startsWith('minecraft-data@')) continue
        add(path.join(pnpm, entry, 'node_modules/minecraft-data'))
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  let fallback = null
  for (const candidate of candidates) {
    const pkg = path.join(candidate, 'package.json')
    if (!fs.existsSync(pkg)) continue
    const resolved = fs.realpathSync(candidate)
    if (resolved === overlayRoot) continue
    if (!fs.existsSync(path.join(resolved, 'data.js'))) continue
    let version = ''
    try { version = JSON.parse(fs.readFileSync(pkg, 'utf8')).version || '' } catch {}
    if (version.startsWith('3.119')) return resolved
    if (!fallback) fallback = resolved
  }
  if (fallback) return fallback
  throw new Error('cannot locate official minecraft-data beside the 26.2 overlay')
}

const officialRoot = findOfficialRoot()
const officialData = require(path.join(officialRoot, 'data.js'))
const official = {
  pc: Object.assign({}, officialData.pc),
  bedrock: officialData.bedrock
}
const overlayFile = (name) => require(path.join(__dirname, 'overlay/pc/26.2', name))

const shared = official.pc['26.1']
if (!shared) throw new Error('official minecraft-data is missing 26.1 data; cannot build the 26.2 overlay')

official.pc['26.2'] = {
  get attributes () { return overlayFile('attributes.json') },
  get blockCollisionShapes () { return overlayFile('blockCollisionShapes.json') },
  get blocks () { return overlayFile('blocks.json') },
  get blockLoot () { return overlayFile('blockLoot.json') },
  get biomes () { return overlayFile('biomes.json') },
  get commands () { return overlayFile('commands.json') },
  get effects () { return overlayFile('effects.json') },
  get enchantments () { return overlayFile('enchantments.json') },
  get entities () { return overlayFile('entities.json') },
  get entityLoot () { return overlayFile('entityLoot.json') },
  get foods () { return overlayFile('foods.json') },
  get instruments () { return overlayFile('instruments.json') },
  get goatHornInstruments () { return overlayFile('goatHornInstruments.json') },
  get items () { return overlayFile('items.json') },
  get language () { return overlayFile('language.json') },
  get loginPacket () { return overlayFile('loginPacket.json') },
  get mapIcons () { return overlayFile('mapIcons.json') },
  get materials () { return overlayFile('materials.json') },
  get particles () { return overlayFile('particles.json') },
  get protocol () { return overlayFile('protocol.json') },
  get recipes () { return overlayFile('recipes.json') },
  get sounds () { return overlayFile('sounds.json') },
  get tints () { return overlayFile('tints.json') },
  get version () { return overlayFile('version.json') },
  get windows () { return overlayFile('windows.json') },
  proto: path.join(officialRoot, 'minecraft-data/data/pc/latest/proto.yml')
}

module.exports = official
