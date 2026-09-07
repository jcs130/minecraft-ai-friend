// _dbg_setup_failed.cjs — 单次连接，打印 setup_failed 的原始解码原因（调试用）
'use strict'
const { attempt } = require('./probe.cjs')
const P = require('./payloads.cjs')

// 模式：play=只放 PLAY 桶；both=两桶都放（默认 play——协商按桶串行，必需通道放错桶必死）
const MODE = process.argv[2] || 'play'
const four = [
  { id: 'guardvillagers:following', version: '1', optional: false },
  { id: 'guardvillagers:set_patrol', version: '1', optional: false },
  { id: 'guardvillagers:open_inventory', version: '1', optional: false },
  { id: 'villagertradingplus:trade_catalog', version: '1', optional: false }
]
const channelList = MODE === 'both' ? { 3: four, 4: four } : { 4: four }
console.log('MODE:', MODE)

attempt({ host: '127.0.0.1', port: 25799, username: 'NeoDbg' }, channelList).then((r) => {
  console.log('outcome:', r.outcome)
  if (r.failures) {
    for (const [ch, reasons] of Object.entries(r.failures)) {
      console.log('====', ch)
      console.log(JSON.stringify(reasons, null, 1).slice(0, 2000))
    }
  }
  if (r.reason) console.log('reason:', r.reason)
  process.exit(0)
}).catch((e) => { console.error(e); process.exit(1) })
