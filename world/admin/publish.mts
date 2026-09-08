// Runs inside the existing trusted world process. The HTTP process receives only
// this allow-listed read model, never world files, command queues or credentials.
import fs from 'node:fs'
import path from 'node:path'
import { validateSkillCatalog } from '../src/gameplay/magic/catalog.ts'
import { projectWorld, chinaDate } from './read-model.mjs'

export function startPanelPublisher({ worldDir, sharedDir, outputDir, intervalMs = 15000 }: {
  worldDir: string; sharedDir: string; outputDir?: string; intervalMs?: number
}) {
  if (!outputDir) return { dispose() {} }
  let lastError = ''
  function publish() {
    const warnings: string[] = []
    const read = (root: string, filename: string): any => {
      try {
        const file = path.join(root, filename)
        if (fs.statSync(file).size > 4 * 1024 * 1024) throw new Error('limit')
        return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
      } catch { warnings.push(`未取得 ${filename} 的有效快照`); return null }
    }
    try {
      const now = Date.now()
      const heartbeat = read(worldDir, 'world-heartbeat.json')
      const state = read(worldDir, 'magic-state.json')
      const waypoints = read(worldDir, 'waypoints.json')
      const atoms = read(worldDir, 'magic-atoms.json')
      const rawCatalog = read(worldDir, 'skill-catalog.json')
      let catalog = null
      try { catalog = validateSkillCatalog(rawCatalog, atoms?.atoms ?? []) }
      catch { warnings.push('技能目录校验未通过，暂不展示可用技能') }
      const npc = read(sharedDir, 'npc-health.json')
      const guildHealth = read(sharedDir, 'guild-health.json')
      const village = path.join(sharedDir, 'village')
      const board = read(village, `guild-${chinaDate(now)}.json`)
      const fame = read(village, 'guild-fame.json')
      const model = projectWorld({ heartbeat, state, waypoints, atoms, rawCatalog, catalog, npc, guildHealth, board, fame, warnings }, now)
      fs.mkdirSync(outputDir!, { recursive: true })
      const temporary = path.join(outputDir!, `world.${process.pid}.tmp`)
      fs.writeFileSync(temporary, JSON.stringify(model) + '\n', 'utf8')
      fs.renameSync(temporary, path.join(outputDir!, 'world.json'))
      lastError = ''
    } catch {
      if (!lastError) console.error('[panel-publisher] Public snapshot unavailable; panel will mark previous data stale')
      lastError = 'unavailable'
    }
  }
  publish()
  const timer = setInterval(publish, intervalMs)
  timer.unref()
  return { dispose() { clearInterval(timer) } }
}
