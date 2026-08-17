/**
 * test-logwatch.mts — mc-logwatch 解析层 + 尾随层单测（纯离线，不连服务器）。
 * 用法：..\node_modules\.bin\tsx.CMD test-logwatch.mts
 */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogTailer, extractKiller, parseLogLine } from './src/mc-logwatch.ts'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`) }
  else { fail++; console.log(`FAIL  ${name} ${extra}`) }
}

const L = (s: string) => `[13:00:00] [Server thread/INFO]: ${s}`

console.log('== parseLogLine: 事件类别 ==')
{
  const chat = parseLogLine(`[13:00:00] [Async Chat Thread/#/INFO]: <Kirito> hello 世界`)
  check('聊天：kind/player/message', chat?.kind === 'chat' && chat?.player === 'Kirito' && chat?.message === 'hello 世界')
  check('加入', parseLogLine(L('Kirito joined the game'))?.kind === 'join')
  check('离开', parseLogLine(L('Kirito left the game'))?.kind === 'leave')
  const adv = parseLogLine(L('Kirito has made the advancement [Stone Age]'))
  check('成就：title', adv?.kind === 'advancement' && adv?.title === 'Stone Age')
  check('成就：goal 变体', parseLogLine(L('Kirito has reached the goal [Getting an Upgrade]'))?.kind === 'advancement')
  check('成就：challenge 变体', parseLogLine(L('Kirito has completed the challenge [Monster Hunter]'))?.kind === 'advancement')
  const cmd = parseLogLine(L('Kirito issued server command: tp MengMeng'))
  check('命令：kind/message', cmd?.kind === 'command' && cmd?.message === 'tp MengMeng')
}

console.log('== parseLogLine: 非事件行 ==')
{
  check('启动横幅', parseLogLine(L('Starting minecraft server version 1.21.11')) === null)
  check('Preparing spawn（假玩家名前缀）', parseLogLine(L('Preparing spawn area: 85%')) === null)
  check('Done 行', parseLogLine(L('Done (12.345s)! For help, type "help"')) === null)
  check('登录技术行', parseLogLine(L('Kirito[/192.168.3.5:55555] logged in with entity id 420')) === null)
  check('断连技术行', parseLogLine(L('Kirito lost connection: Disconnected')) === null)
  check('无前缀行', parseLogLine('[13:00:00] [Server thread/INFO]: ') === null)
  check('非日志行', parseLogLine('random console noise') === null)
}

console.log('== parseLogLine: 死亡动词 + 击杀者 ==')
{
  const d = (s: string) => parseLogLine(L(s))
  const slain = d('Kirito was slain by Zombie')
  check('近战击杀', slain?.kind === 'death' && slain?.killer === 'Zombie' && slain?.cause === 'was slain by Zombie')
  check('带武器从句', d('Kirito was slain by MengMeng using [Iron Sword]')?.killer === 'MengMeng')
  check('远程击杀', d('Kirito was shot by Skeleton')?.killer === 'Skeleton')
  check('whilst fighting：击杀者取 by 后', d('Kirito was killed by Zombie whilst fighting Creeper')?.killer === 'Zombie')
  check('坠落（无击杀者）', d('Kirito fell from a high place')?.killer === undefined)
  check('溺水逃亡（状语名非击杀者）', d('Kirito drowned whilst trying to escape Zombie')?.killer === undefined)
  check('doomed to fall', d('Kirito was doomed to fall by Creeper')?.killer === 'Creeper')
  const shriek = d('Kirito was obliterated by a sonically-charged shriek')
  check('监守者尖啸：剥冠词', shriek?.killer === 'sonically-charged shriek')
  check('/kill 泛化死亡', d('Kirito died')?.kind === 'death')
  check('fell out of the world', d('Kirito fell out of the world')?.kind === 'death')
  check('starved', d('Kirito starved to death')?.kind === 'death')
  check('withered', d('Kirito withered away')?.kind === 'death')
  check('kinetic energy', d('Kirito experienced kinetic energy')?.kind === 'death')
  check('hit the ground', d('Kirito hit the ground too hard')?.kind === 'death')
  check('岩浆', d('Kirito tried to swim in lava while trying to escape Zombie')?.kind === 'death')
  check('stalagmite', d('Kirito was impaled on a stalagmite')?.kind === 'death')
  check('frozen', d('Kirito was frozen to death')?.kind === 'death')
  check('poison蜂蛰', d('Kirito was stung to death by Bee')?.killer === 'Bee')
}

console.log('== extractKiller: 边界 ==')
{
  check('无 by → undefined', extractKiller('fell from a high place') === undefined)
  check('by 后截断到 32 字符外 → undefined', extractKiller('was killed by ' + 'x'.repeat(64)) === undefined)
  check('纯冠词 → undefined', extractKiller('was killed by the') === undefined)
}

console.log('== createLogTailer: 真文件尾随 ==')
{
  const dir = mkdtempSync(join(tmpdir(), 'mc-logwatch-'))
  const file = join(dir, 'latest.log')
  writeFileSync(file, L('Kirito joined the game') + '\n') // 历史行：不得重放

  const lines: string[] = []
  const states: string[] = []
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  async function until(cond: () => boolean, ms = 3000): Promise<boolean> {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (cond()) return true
      await sleep(40)
    }
    return cond()
  }

  const tail = createLogTailer({
    path: file,
    pollMs: 25,
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t) },
    onLine: (l) => lines.push(l),
    onState: (s) => states.push(s),
  })
  try {
    await sleep(120) // 让 tailer 在 EOF 就位
    appendFileSync(file, L('Kirito was slain by Zombie') + '\n')
    check('新写入行被捕获', await until(() => lines.length >= 1))
    check('历史行不重放', !lines.some((l) => l.includes('joined')))

    // 半行：无换行符先到，攒缓冲
    appendFileSync(file, '[13:00:02] [Server thread/INFO]: Kirito was shot')
    await sleep(120)
    check('半行挂起不派发', lines.length === 1)
    appendFileSync(file, ' by Skeleton\n')
    check('半行补齐后派发', await until(() => lines.length >= 2))
    check('补齐行解析正确', parseLogLine(lines[1] ?? '')?.killer === 'Skeleton')

    // 轮转：文件被重建变短（服务器重启形态）
    writeFileSync(file, L('Starting minecraft server version 1.21.11') + '\n')
    appendFileSync(file, L('Kirito died') + '\n')
    check('轮转后重读新内容', await until(() => lines.some((l) => l.includes('Kirito died'))))
    check('轮转状态上报', states.includes('rotated'))
    check('轮转后旧缓冲不串扰', !lines.some((l) => l.includes('was shot') && lines.indexOf(l) > 1))

    // 停表
    tail.stop()
    appendFileSync(file, L('Kirito starved to death') + '\n')
    await sleep(150)
    check('stop 后不再派发', !lines.some((l) => l.includes('starved')))
  } finally {
    tail.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
