import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import mineflayer from 'mineflayer'
import type { Bot } from 'mineflayer'
import pf from 'mineflayer-pathfinder'
import { plugin as toolPlugin } from 'mineflayer-tool'

export const name = 'mc-bot-service'

export interface Config {
  host: string
  port: number
  username: string
  autoReconnect: boolean
  viewerEnabled: boolean
  viewerPort: number
  viewerFirstPerson: boolean
}

export const Config: Schema<Config> = Schema.object({
  host: Schema.string().default('localhost'),
  port: Schema.number().default(25565),
  username: Schema.string().default('HarnessBot'),
  autoReconnect: Schema.boolean().default(true),
  viewerEnabled: Schema.boolean().default(true),
  viewerPort: Schema.number().default(3001),
  viewerFirstPerson: Schema.boolean().default(false),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcbot: Bot
  }
}

export function apply(ctx: Context, config: Config) {
  const log = (msg: string) => console.log(`[mc-bot-service] ${msg}`)
  let disposed = false
  let provided = false
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
    // Register the service on first connect; reconnects overwrite the value.
    // (cordis: `set` on an unprovided name throws, so provide must come first.)
    if (provided) {
      ctx.set('mcbot', bot)
    } else {
      ctx.provide('mcbot', bot)
      provided = true
    }

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
          const { default: prismarineViewer } = await import('prismarine-viewer')
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

  ctx.effect(() => {
    return () => {
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
  })
}
