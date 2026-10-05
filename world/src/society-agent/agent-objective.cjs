'use strict'
const DEFAULT_OBJECTIVE = '在 My Agent World 长期生存与成长；真实获取原料、加工食物和合成装备，建立并运营 MineColonies 殖民地，支持居民与其真实任务。'
function resolveAgentObjective ({ configObjective, savedObjective } = {}) {
  const value = configObjective ?? savedObjective ?? DEFAULT_OBJECTIVE
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw Error('AGENT_OBJECTIVE_INVALID')
  return value.trim()
}
module.exports = { resolveAgentObjective, DEFAULT_OBJECTIVE }
