import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Rcon } from './rcon.ts'

/**
 * mc-rcon —— 世界侧共享 RCON 服务（仅世界进程加载）。
 *
 * 铁律：RCON 只存在于世界进程（天神侧）。穿越者进程（bot）不得 import 本文件，
 * 也不得读取 rcon-secret —— 它们与世界的全部交互走 MC 聊天文字（见 mc-mystic）。
 *
 * RCON 协议不能直接传非 ASCII 字符（中文命令会被截断/拒绝）：
 * send() 自动把非 ASCII 转成 \uXXXX 转义，服务端按文本正常解析。
 */
export const name = 'mc-rcon'
export const inject = []

export interface Config {
  enabled: boolean
  host: string
  port: number
  passwordPath: string
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  host: Schema.string().default('localhost'),
  port: Schema.number().default(25575),
  passwordPath: Schema.string().default('./data/rcon-secret.txt'),
})

export interface SpawnPoint {
  x: number
  y: number
  z: number
}

export interface RconService {
  /** 执行一条服务器命令（非 ASCII 自动转义）。返回服务端响应文本。 */
  send(cmd: string): Promise<string>
  /** 查询实体数值字段（Health / foodLevel / ...），失败返回 null。 */
  getEntityNumber(target: string, path: string): Promise<number | null>
  /** 玩家实时坐标（data get Pos），失败返回 null。女神化身看不见远处玩家时的兜底。 */
  getPos(username: string): Promise<SpawnPoint | null>
  /** 玩家重生点（床 / 世界出生点），读不到返回 null。 */
  getSpawn(username: string): Promise<SpawnPoint | null>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcRcon: RconService
  }
}

/** RCON 通道只接受可打印 ASCII：其余字符转 \uXXXX（服务端按 JSON/文本转义解析）。 */
export function toAscii(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, (ch) => {
    const code = ch.codePointAt(0) ?? 0
    return '\\u' + code.toString(16).padStart(4, '0')
  })
}

export function apply(ctx: Context, config: Config) {
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
  async function ensure(): Promise<Rcon> {
    if (rcon && rcon.isConnected()) return rcon
    if (!password) throw new Error(`rcon password not configured (${config.passwordPath})`)
    rcon?.close()
    const conn = new Rcon(config.host, config.port, password)
    await conn.connect()
    rcon = conn
    log('rcon connected')
    return conn
  }

  const service: RconService = {
    send: async (cmd) => (await ensure()).send(toAscii(cmd)),
    getEntityNumber: async (target, path) => {
      try {
        const out = await service.send(`data get entity ${target} ${path}`)
        const m = out.match(/-?\d+(\.\d+)?/)
        return m ? parseFloat(m[0]) : null
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
  ctx.provide('mcRcon', service)

  ctx.effect(() => () => {
    rcon?.close()
    rcon = null
    log('rcon disposed')
  })

  if (config.enabled) {
    log(
      password
        ? `rcon service armed (${config.host}:${config.port})`
        : 'rcon service armed but NO password — commands will fail until the secret file exists',
    )
  }
}
