import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

// Exercise the production welcome formatter with transport/timers stubbed out.
// No Minecraft connection, lifecycle startup, region/entity writes or real timers.
const source = readFileSync(new URL('../src/mc-bubble.ts', import.meta.url), 'utf8')
const start = source.indexOf('  async function goddessWelcome(player: string)')
const end = source.indexOf('  // ---------- 生命周期', start)
assert(start >= 0 && end > start, 'Cannot locate production welcome function')
const script = transformSync(source.slice(start, end), { loader: 'ts', format: 'cjs', target: 'node22' }).code
const factory = new Function('rsend', 'welcomeFailed', 'log', 'setTimeout', script + '\nreturn goddessWelcome;')

test('welcome JSON preserves Chinese, quotes and backslashes and keeps clickable text structured', async () => {
  // The second value stresses message formatting only; it is never sent as a real player selector.
  for (const label of ['OfflineProbe', '中文"引号\\路径']) {
    const commands = [], failed = new Set()
    const welcome = factory(async command => { commands.push(command); return '' }, failed, () => {}, callback => callback())
    await welcome(label)
    assert.equal(failed.size, 0)
    assert.equal(commands.length, 11, 'Both title lines and all nine tellraw lines are built')
    const components = commands.map(command => {
      const start = command.indexOf(' {')
      assert(start >= 0)
      const json = command.slice(start + 1)
      assert(json.startsWith('{"'), 'Structure quotes must remain JSON delimiters')
      return JSON.parse(json)
    })
    assert.equal(components[0].text, '千灯纪')
    assert.equal(components[0].bold, true)
    assert.equal(components[1].color, 'yellow')
    assert.equal(components[3].text, `欢迎降临千灯纪，远方的旅人 ${label}。`)
    const clickable = components.find(component => component.extra)?.extra[0]
    assert.equal(clickable.clickEvent.action, 'suggest_command')
    assert.equal(clickable.clickEvent.value, '/msg Goddess ')
    assert.equal(clickable.hoverEvent.action, 'show_text')
  }
})
