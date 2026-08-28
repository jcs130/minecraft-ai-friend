// 出 1.21.1 原版 blocksByStateId → {id: name} JSON 表
const mcData = require('minecraft-data')('1.21.1')
const out = {}
for (const [id, b] of Object.entries(mcData.blocksByStateId)) {
  out[id] = b.name || b.jsonId || 'unknown'
}
require('fs').writeFileSync(
  String.raw`C:\Users\lzl19\.copaw\workspaces\mc-god\scratch\tno-state-names.json`,
  JSON.stringify(out)
)
console.log('states:', Object.keys(out).length, 'max id:', Math.max(...Object.keys(out).map(Number)))
