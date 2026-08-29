import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Rcon } from './rcon.ts'

/**
 * mc-rcon —— 世界侧共享 RCON 服务（仅世界进程加载）。
 *
 * 铁律：RCON 只存在于世界进程（天神侧）。穿越者进程（bot）不得 import 本文件，
 * 也不得读取 rcon-secret —— 它们与世界的全部交互走 MC 聊天文字（见 mc-mystic）。
 *
 * 2026-08-29 定谳：RCON 协议 payload 本就是 UTF-8（rcon.ts Buffer.from(payload,'utf-8')），
 * 服务端 1.21.1 按 UTF-8 收——中文命令直发即合法（rcon-cli 召唤中文名村民/发命格书
 * 千百次验证）。旧 toAscii() 把中文转 \uXXXX 字面量，SNBT 引号串里是非法转义
 * （Invalid escape sequence '\u'）——发书、影分身召唤雪傀儡失败的根因，已拆除。
 *
 * 已脱 cordis 壳（2026-08-21）：不再 import @deepseek-ai/cordis / schemastery，
 * 由 bootstrap-world.mts 显式 createRcon() 装配并注入依赖。
 */

export interface Config {
  enabled: boolean
  host: string
  port: number
  passwordPath: string
}

export interface SpawnPoint {
  x: number
  y: number
  z: number
}

export interface RconService {
  /** 执行一条服务器命令（原生 UTF-8 直发，中文合法）。返回服务端响应文本。 */
  send(cmd: string): Promise<string>
  /** 查询实体数值字段（Health / foodLevel / ...），失败返回 null。 */
  getEntityNumber(target: string, path: string): Promise<number | null>
  /** 玩家实时坐标（data get Pos），失败返回 null。女神化身看不见远处玩家时的兜底。 */
  getPos(username: string): Promise<SpawnPoint | null>
  /** 玩家重生点（床 / 世界出生点），读不到返回 null。 */
  getSpawn(username: string): Promise<SpawnPoint | null>
}

/** 服务句柄：bootstrap 拿 service 注入其他服务，进程收尾时调 dispose。 */
export interface RconHandle {
  service: RconService
  dispose: () => void
}

export function createRcon(config: Config): RconHandle {
  const log = (msg: string) => console.log(`[mc-rcon] ${msg}`)

  const passwordPath = resolve(config.passwordPath)
  let password = ''
  if (existsSync(passwordPath)) {
    try {
      password = readFileSync(passwordPath, 'utf-8').trim()
    } catch (err) {
      log(`failed to read rcon password: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  let rcon: Rcon | null = null
  let connecting: Promise<Rcon> | null = null
  async function ensure(): Promise<Rcon> {
    if (rcon && rcon.isConnected()) return rcon
    if (connecting) return connecting
    if (!password) throw new Error(`rcon password not configured (${config.passwordPath})`)
    connecting = (async () => {
      rcon?.close()
      const conn = new Rcon(config.host, config.port, password)
      await conn.connect()
      rcon = conn
      log('rcon connected')
      return conn
    })()
    try {
      return await connecting
    } finally {
      connecting = null
    }
  }

  const service: RconService = {
    send: async (cmd) => {
      try {
        return (await ensure()).send(cmd)
      } catch (e) {
        // 保守重试：仅当「连接本来就没建立/已明确断开（命令根本没发出去）」时重建一次。
        // 不重试 timed out / closed —— 那些命令可能已被服务器执行，双发会重复给物/广播。
        const msg = e instanceof Error ? e.message : String(e)
        if (/rcon not connected/i.test(msg)) {
          rcon?.close()
          rcon = null
          return (await ensure()).send(cmd)
        }
        throw e
      }
    },
    getEntityNumber: async (target, path) => {
      try {
        const out = await service.send(`data get entity ${target} ${path}`)
        // 严格只认 "entity data: <value>" 尾值（可带 d/f/L 类型后缀）。
        // 旧版抓「响应中第一个数字」——异常/串线响应里的无关数字（如 Air=300 满氧
        // 气值）会被误当查询值，污染等级等关键状态（08-18 鸣人 300 级事故根因）。
        const m = out.match(/entity data:\s*(-?\d+(?:\.\d+)?)(?:[dLf])?\s*$/)
        return m ? parseFloat(m[1]) : null
      } catch {
        return null
      }
    },
    getPos: async (username) => {
      try {
        const out = await service.send(`data get entity ${username} Pos`)
        // 回显形如 "Kirito has the following entity data: [D: -107.5, D: 64.0, D: 144.5]"
        const nums = out.match(/-?\d+(\.\d+)?/g)
        if (!nums || nums.length < 3) return null
        const [x, y, z] = nums.slice(0, 3).map(parseFloat)
        return { x: Math.round(x), y: Math.round(y), z: Math.round(z) }
      } catch {
        return null
      }
    },
    getSpawn: async (username) => {
      try {
        const out = await service.send(`data get entity ${username} SpawnX`)
        // 回显形如 "Kirito has the following entity data: -112"，逐字段再取 Y/Z。
        const probe = async (field: string, prev?: number) => {
          if (prev !== undefined) return prev
          const o = await service.send(`data get entity ${username} ${field}`)
          const m = o.match(/-?\d+(\.\d+)?/)
          return m ? parseFloat(m[0]) : undefined
        }
        const x = await probe('SpawnX', out.match(/-?\d+(\.\d+)?/)?.[0] ? parseFloat(out.match(/-?\d+(\.\d+)?/)![0]) : undefined)
        const y = await probe('SpawnY')
        const z = await probe('SpawnZ')
        if (x === undefined || y === undefined || z === undefined) return null
        return { x: Math.round(x), y: Math.round(y), z: Math.round(z) }
      } catch (err) {
        log(`getSpawn(${username}) failed: ${err instanceof Error ? err.message : String(err)}`)
        return null
      }
    },
  }

  const dispose = () => {
    rcon?.close()
    rcon = null
    log('rcon disposed')
  }

  if (config.enabled) {
    log(
      password
        ? `rcon service armed (${config.host}:${config.port})`
        : 'rcon service armed but NO password — commands will fail until the secret file exists',
    )
  }

  return { service, dispose }
}
