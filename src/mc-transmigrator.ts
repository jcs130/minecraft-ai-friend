import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * mc-transmigrator —— 穿越者档案服务。
 *
 * 每个「穿越者」= 人格层（backstory 前世 + persona 注入 mc-loop 的人格）
 * 与技能层（innate 初始技能偏好，走 MC 魔法系统）彻底解耦。IP 人物只带
 * 思考方式/行为风格/性格口吻/价值观，原作技能不带入 MC。
 *
 * 档案索引在 data/transmigrators.json；backstory / persona 正文放独立
 * .md 文件（相对索引所在目录解析），便于人工润色，符合「灵魂三件套」惯例。
 */
export const name = 'mc-transmigrator'
export const inject: string[] = []

export interface Config {
  registryPath: string
}

export const Config: Schema<Config> = Schema.object({
  registryPath: Schema.string().default('./data/transmigrators.json'),
})

export interface InnatePreference {
  preferredAtoms: string[]
  reasoning: string
}

export interface Transmigrator {
  id: string
  name: string
  username: string
  origin: 'ip' | 'random'
  source: string | null
  epithet: string
  backstory: string
  persona: string
  innate: InnatePreference
}

/** 档案索引文件里的原始条目（backstory/persona 是文件引用，加载时读入）。 */
interface RawEntry {
  id: string
  name?: string
  username: string
  origin?: 'ip' | 'random'
  source?: string | null
  epithet?: string
  backstoryFile?: string
  personaFile?: string
  innate?: InnatePreference
}

export class TransmigratorRegistry {
  private readonly items: Transmigrator[]
  private readonly byUsername: Map<string, Transmigrator>

  constructor(registryPath: string) {
    const path = resolve(registryPath)
    const base = dirname(path)
    const entries = this.loadEntries(path)
    this.items = entries.map((e) => this.materialize(base, e))
    this.byUsername = new Map(this.items.map((t) => [t.username.toLowerCase(), t]))
  }

  private loadEntries(path: string): RawEntry[] {
    try {
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, 'utf-8'))
        const list = Array.isArray(raw) ? raw : raw?.transmigrators
        if (Array.isArray(list)) {
          return list.filter(
            (e): e is RawEntry =>
              !!e && typeof e.id === 'string' && typeof e.username === 'string',
          )
        }
      }
    } catch (err) {
      console.error(
        `[mc-transmigrator] failed to load registry: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    return []
  }

  private readText(base: string, rel: string | undefined, fallback: string): string {
    if (!rel) return fallback
    try {
      const p = resolve(base, rel)
      if (existsSync(p)) return readFileSync(p, 'utf-8').trim()
    } catch {
      /* ignore */
    }
    return fallback
  }

  private materialize(base: string, e: RawEntry): Transmigrator {
    return {
      id: e.id,
      name: e.name || e.username,
      username: e.username,
      origin: e.origin === 'random' ? 'random' : 'ip',
      source: e.source ?? null,
      epithet: e.epithet ?? '',
      backstory: this.readText(base, e.backstoryFile, ''),
      persona: this.readText(base, e.personaFile, ''),
      innate: e.innate ?? { preferredAtoms: [], reasoning: '' },
    }
  }

  getByUsername(username: string): Transmigrator | null {
    if (!username) return null
    return this.byUsername.get(username.toLowerCase()) ?? null
  }

  list(): Transmigrator[] {
    return this.items
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcTransmigrators: TransmigratorRegistry
  }
}

export function apply(ctx: Context, config: Config) {
  const registry = new TransmigratorRegistry(config.registryPath)
  ctx.provide('mcTransmigrators', registry)
  const names = registry.list().map((t) => `${t.name}(${t.username})`).join(', ') || '(none)'
  console.log(`[mc-transmigrator] loaded ${registry.list().length} transmigrator(s): ${names}`)
}
