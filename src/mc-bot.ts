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
      // NeoForge 21.1.248 = MC 1.21.1：显式钉版本，避免 mineflayer 默认版本探测
      // 在 config/registry 同步阶段失配（Goddess 连 25599 曾卡死在 connecting）。
      version: '1.21.1',
    })
    currentBot = bot

    // 实体 name 归一化：mod 实体（numen/settlements 的村民 base_villager）在 mineflayer
    // registry 里查不到 → name='unknown' → viewer 的 getEntityMesh 对 'unknown' throw → 紫盒/不可见。
    // 这里把已知 mod 实体的 name 归一到 vanilla 对应名，viewer 就能用自带模型渲染。
    // 映射表集中在 B 仓 src/ 可维护；modName 取 mineflayer 的 entityType（协议内部 id）。
    // 注意：必须在创建 viewer(WorldView) 之前注册，保证事件监听先于 viewer，读到的是归一后的 name。
    const MOD_ENTITY_NAME: Record<number, string> = {
      130: 'villager', // numen/settlements 村民（诊断证实 19 位村民均 entityType=130）
    }
    const normalizeModEntity = (e: { name?: string; entityType?: number }): void => {
      if (!e || e.name !== 'unknown' || e.entityType === undefined) return
      const mapped = MOD_ENTITY_NAME[e.entityType]
      if (mapped) e.name = mapped
    }
    bot.on('entitySpawn', (e: any) => normalizeModEntity(e))
    bot.on('entityUpdated', (e: any) => normalizeModEntity(e))
    // 对已连接的旧实体立即归一（防实体早于我注册 hook 已入列）。
    // ⚠️ bot.entities 由 mineflayer 内部插件在 inject_allowed（下一个 event-loop tick）才初始化；
    // createBot() 同步返回的那一刻它仍是 undefined，直接 Object.values 会抛
    // "Cannot convert undefined or null to object"，中断 connect() 后续装配（spawn/error/end
    // 处理器不再注册）→ 进程半挂 → Goddess 卡死在 connecting、RCON 显示在线但没有 spawned。
    // 故必须判空；已连接的实体后续会经 entitySpawn/entityUpdated hook + spawn 时兜底归一到。
    if (bot.entities) for (const e of Object.values(bot.entities)) normalizeModEntity(e)

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
