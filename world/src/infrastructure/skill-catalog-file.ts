// File loading and duplicate-key checks kept outside catalogue policy.
import { existsSync, readFileSync } from 'node:fs'
import { validateSkillCatalog, type CatalogAtom, type SkillCatalog } from '../gameplay/magic/catalog.ts'

/** Absent optional catalogue keeps old isolated fixtures compatible. Once a
 * running engine has a catalogue, deletion on reload is an error. */
export function loadSkillCatalog(path: string | null, atoms: readonly CatalogAtom[], required = false): SkillCatalog | null {
  if (path === null || !existsSync(path)) {
    if (required) throw new Error('Skill catalogue disappeared; refusing to reopen archived skills')
    return null
  }
  let raw: unknown
  try {
    const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
    raw = JSON.parse(text)
    // JSON.parse otherwise accepts duplicate object keys with last-write-wins.
    // Reject those too: editing an allow-list must not silently overwrite policy.
    const stack: { object: boolean; key: boolean; keys: Set<string> }[] = []
    for (const token of text.match(/"(?:[^"\\]|\\.)*"|[{}\[\],:]/g) ?? []) {
      if (token === '{' || token === '[') stack.push({ object: token === '{', key: true, keys: new Set() })
      else if (token === '}' || token === ']') stack.pop()
      else {
        const top = stack.at(-1)
        if (token === ',' && top?.object) top.key = true
        else if (token.startsWith('"') && top?.object && top.key) {
          const key = JSON.parse(token) as string
          if (top.keys.has(key)) throw new Error(`duplicate object key ${key}`)
          top.keys.add(key)
          top.key = false
        }
      }
    }
  }
  catch (error) { throw new Error(`Invalid skill catalogue JSON: ${error instanceof Error ? error.message : String(error)}`) }
  return validateSkillCatalog(raw, atoms)
}
