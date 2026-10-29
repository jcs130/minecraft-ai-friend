'use strict'
const { randomUUID } = require('node:crypto')
function attachProtection (bot, onReply = () => {}) {
  const cache = new Map(), pending = new Map()
  const key = (a, d, p) => `${a}|${d.replace(/^minecraft:/,'')}|${p.x},${p.y},${p.z}`
  bot._client.on('custom_payload', packet => {
    if (packet.channel !== 'mcagent:protection' || !Buffer.isBuffer(packet.data) || packet.data.length > 4096) return
    try {
      const row = JSON.parse(packet.data.toString('utf8'))
      if (!['break','place'].includes(row.action) || !['deny','unknown','allow_likely'].includes(row.status)
          || typeof row.dimension !== 'string' || !['x','y','z'].every(k => Number.isSafeInteger(row[k]))) return
      cache.set(key(row.action,row.dimension,row), { row, at:Date.now() })
      onReply(row)
      const p = pending.get(row.requestId)
      if (p && p.key === key(row.action,row.dimension,row)) { clearTimeout(p.timer); pending.delete(row.requestId);p.resolve(row) }
    } catch {}
  })
  bot.once('end', () => { for(const p of pending.values()){clearTimeout(p.timer);p.resolve({...p.input,status:'unknown',reason:'connection_closed'})}pending.clear();cache.clear() })
  return {
    verdict(action,dimension,cell) { const got=cache.get(key(action,dimension,cell)); return got && Date.now()-got.at<5000 ? got.row.status:null },
    check(action,dimension,cell,fresh=false) {
      if(!['break','place'].includes(action)||typeof dimension!=='string'||!['x','y','z'].every(k=>Number.isSafeInteger(cell[k])))return Promise.reject(Error('explicit_integer_world_coordinates_required'))
      const k=key(action,dimension,cell), got=cache.get(k)
      if(!fresh&&got&&Date.now()-got.at<1000)return Promise.resolve(got.row)
      const input={action,dimension,x:cell.x,y:cell.y,z:cell.z},requestId=randomUUID()
      return new Promise(resolve=>{
        const timer=setTimeout(()=>{pending.delete(requestId);resolve({...input,status:'unknown',reason:'protection_query_timeout'})},2000)
        pending.set(requestId,{resolve,timer,key:k,input})
        bot._client.write('custom_payload',{channel:'mcagent:protection_query',data:Buffer.from(JSON.stringify({...input,requestId}))})
      })
    }
  }
}
module.exports={attachProtection}
