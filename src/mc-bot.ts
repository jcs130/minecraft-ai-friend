import mineflayer from 'mineflayer'
import type { Bot } from 'mineflayer'
import pf from 'mineflayer-pathfinder'
import { plugin as toolPlugin } from 'mineflayer-tool'

/**
 * mc-bot —— 女神化身（Goddess）的 mineflayer 假玩家，世界进程唯一。
 *
 * 已脱 cordis 壳（2026-08-21）：不再 import @deepseek-ai/cordis，
 * 由 bootstrap-world.mts 显式 createBot() 装配；bot 实例会随断线重连
 * 变化，故对外暴露 getBot() getter（替代原 ctx.mcbot 可变引用），
 * 依赖方每次现取，不持有过期快照。
 */

export interface Config {
  host: string
  port: number
  username: string
  autoReconnect: boolean
  viewerEnabled: boolean
  viewerPort: number
  viewerFirstPerson: boolean
}

export interface BotHandle {
  /** 当前 bot 实例（断线重连会换新实例，务必每次现取）。 */
  getBot: () => Bot
  dispose: () => void
}

export function createBot(config: Config): BotHandle {
  const log = (msg: string) => console.log(`[mc-bot-service] ${msg}`)
  let disposed = false
  let currentBot: Bot | null = null
  let closeViewer: (() => void) | null = null

  function connect(): Bot {
    log(`connecting to ${config.host}:${config.port} as "${config.username}"`)
    const bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      checkTimeoutInterval: 30_000,
    })
    currentBot = bot

    // Official plugins: pathfinding + best-tool-for-block selection.
    bot.loadPlugin(pf.pathfinder)
    bot.loadPlugin(toolPlugin)

    bot.once('spawn', async () => {
      const p = bot.entity?.position
      log(`spawned at ${p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})` : 'unknown'}`)
      const movements = new pf.Movements(bot)
      bot.pathfinder.setMovements(movements)

      // 双视角 viewer（prismarine-viewer），供观察面板 iframe 嵌入：
      //   viewerPort     = 第三人称（环绕跟随，默认 3001）
      //   viewerPort+100 = 第一人称（bot 眼中世界）
      // 两个实例的 close 句柄分别保存；重连时先全部关闭再重建。
      // viewer 懒加载：不用 viewer（MC_VIEWER=0）的部署完全不需要装
      // node-canvas-webgl/canvas/gl 这些 native 依赖（很多平台编译不过）。
      if (config.viewerEnabled) {
        try {
          if (closeViewer) {
            closeViewer()
            closeViewer = null
          }
          // ⚠️ 必须变量化 import 路径：esbuild 会把字面量 `import('prismarine-viewer')`
          // 提升成顶层静态 import（CJS/ESM 都如此），导致即使 viewerEnabled=false，
          // 模块加载时就 require prismarine-viewer → canvas。世界镜像用
          // --omit=optional 跳过 canvas，会直接崩。变量化后 esbuild 无法静态分析，
          // 保持真正的懒加载（viewer 关闭的部署完全不需要 canvas 全家桶）。
          const pvModule = 'prismarine-viewer'
          const pv = await import(pvModule)
          const prismarineViewer = (pv as any).default
          const mineflayerViewer = prismarineViewer.mineflayer
          mineflayerViewer(bot, {
            port: config.viewerPort,
            firstPerson: false,
          })
          const closeThird = (bot as any).viewer.close.bind((bot as any).viewer)
          const closers: Array<() => void> = [closeThird]
          try {
            mineflayerViewer(bot, {
              port: config.viewerPort + 100,
              firstPerson: true,
            })
            closers.push((bot as any).viewer.close.bind((bot as any).viewer))
            log(`viewer ready: third @ :${config.viewerPort}, first @ :${config.viewerPort + 100}`)
          } catch (e) {
            // 第一人称端口失败不影响第三人称
            log(`first-person viewer start failed (ignored): ${(e as Error).message}`)
          }
          closeViewer = () => closers.forEach((c) => { try { c() } catch { /* already closed */ } })
        } catch (err) {
          log(`viewer start failed: ${(err as Error).message}`)
        }
      }
    })

    bot.on('error', (err: Error) => {
      log(`bot error: ${err.message}`)
    })

    bot.on('end', (reason: string) => {
      log(`bot disconnected: ${reason}`)
      if (!disposed && config.autoReconnect) {
        setTimeout(() => {
          if (disposed) return
          connect()
        }, 3000)
      }
    })

    return bot
  }

  connect()

  const dispose = () => {
    disposed = true
    log('disposing, ending bot')
    if (closeViewer) {
      closeViewer()
      closeViewer = null
    }
    if (currentBot) {
      currentBot.end('plugin disposed')
      currentBot = null
    }
  }

  return {
    getBot: () => {
      if (!currentBot) throw new Error('[mc-bot-service] bot not connected yet')
      return currentBot
    },
    dispose,
  }
}
