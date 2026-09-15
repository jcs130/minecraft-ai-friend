// Catalogue policy; callers supply data, this module performs no I/O.

export interface SkillCatalogEntry {
  status: 'featured' | 'archived'
  reason: string
  nativeHints: string[]
  /** A thematic alias for this exact native spell, never a grant or legacy fallback. */
  nativeSpell?: string
  category?: string
  group?: SkillCatalogGroup
}

export type SkillCatalogGroup = 'combat' | 'support' | 'movement' | 'life' | 'passive' | 'native'
export const IRON_SPELL_ID = /^irons_spellbooks:[a-z0-9_./-]+$/
const categoryId = /^[a-z][a-z0-9_]{0,63}$/
const groups: readonly string[] = ['combat', 'support', 'movement', 'life', 'passive', 'native']

export interface SkillCatalog {
  featured: string[]
  entries: ReadonlyMap<string, SkillCatalogEntry>
  icons: ReadonlyMap<string, string>
}

export type CatalogAtom = { id: string; type?: 'active' | 'passive' }

export const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

export const resourceId = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/

/** A present catalogue is a runtime allow-list. Invalid or incomplete data must
 * fail closed, never silently expose the original full atom set. */
export function validateSkillCatalog(raw: unknown, atoms: readonly CatalogAtom[]): SkillCatalog {
  const fail = (message: string): never => { throw new Error(`Invalid skill catalogue: ${message}`) }
  if (!object(raw) || raw.schema !== 1) return fail('schema must be 1')
  if (!Array.isArray(raw.featured) || !object(raw.archived)) return fail('featured/archived are required')
  const known = new Map<string, CatalogAtom>()
  for (const atom of atoms) {
    if (!nonempty(atom.id) || known.has(atom.id)) return fail(`invalid/duplicate atom ID ${atom.id}`)
    known.set(atom.id, atom)
  }
  const entries = new Map<string, SkillCatalogEntry>()
  const featured: string[] = []
  const details = raw.featuredDetails ?? {}
  if (!object(details)) return fail('featuredDetails must be an object')
  for (const id of raw.featured) {
    if (!nonempty(id) || !known.has(id)) return fail(`unknown featured ID ${String(id)}`)
    if (entries.has(id)) return fail(`duplicate featured ID ${id}`)
    if (known.get(id)?.type === 'passive') return fail(`passive ${id} cannot be featured as active`)
    const detail = details[id]
    if (detail !== undefined && (!object(detail) || !nonempty(detail.reason))) return fail(`invalid featured details ${id}`)
    if (object(detail) && detail.category !== undefined &&
        (typeof detail.category !== 'string' || !categoryId.test(detail.category))) return fail(`invalid category for ${id}`)
    if (object(detail) && detail.nativeSpell !== undefined &&
        (typeof detail.nativeSpell !== 'string' || detail.nativeSpell.length > 128 || !IRON_SPELL_ID.test(detail.nativeSpell) ||
         typeof detail.category !== 'string')) return fail(`invalid native spell mapping ${id}`)
    entries.set(id, { status: 'featured', reason: object(detail) ? String(detail.reason) : '精选特色技能', nativeHints: [],
      ...(object(detail) && typeof detail.category === 'string' ? { category: detail.category } : {}),
      ...(object(detail) && typeof detail.nativeSpell === 'string' ? { nativeSpell: detail.nativeSpell } : {}),
    })
    featured.push(id)
  }
  for (const id of Object.keys(details)) if (!featured.includes(id)) return fail(`unknown/non-featured detail ${id}`)
  for (const [id, row] of Object.entries(raw.archived)) {
    if (!known.has(id)) return fail(`unknown archived ID ${id}`)
    if (entries.has(id)) return fail(`duplicate classification ${id}`)
    if (!object(row) || !nonempty(row.reason) || !nonempty(row.kind) || !Array.isArray(row.nativeHints) ||
        row.nativeSpell !== undefined ||
        row.nativeHints.some((v) => typeof v !== 'string' || !resourceId.test(v)) ||
        new Set(row.nativeHints).size !== row.nativeHints.length) return fail(`invalid archived entry ${id}`)
    if ((known.get(id)?.type === 'passive') !== (row.kind === 'passive')) return fail(`passive classification mismatch ${id}`)
    entries.set(id, { status: 'archived', reason: row.reason, nativeHints: [...row.nativeHints] as string[] })
  }
  const missing = [...known.keys()].filter((id) => !entries.has(id))
  if (missing.length) return fail(`unclassified IDs: ${missing.join(', ')}`)
  const icons = new Map<string, string>()
  if (raw.icons !== undefined) {
    if (!object(raw.icons)) return fail('icons must be an object')
    for (const [id, icon] of Object.entries(raw.icons)) {
      if (!known.has(id) || typeof icon !== 'string' || !resourceId.test(icon)) return fail(`invalid icon ${id}`)
      icons.set(id, icon)
    }
  }
  if (raw.categories !== undefined) {
    if (!object(raw.categories)) return fail('categories must be an object')
    const categorized = new Set<string>()
    for (const [category, row] of Object.entries(raw.categories)) {
      if (!categoryId.test(category) || !object(row) || !nonempty(row.name) || !Array.isArray(row.ids) ||
          (row.group !== undefined && (typeof row.group !== 'string' || !groups.includes(row.group)))) return fail(`invalid category ${category}`)
      for (const id of row.ids) {
        if (typeof id !== 'string' || !known.has(id) || categorized.has(id)) return fail(`unknown/duplicate category ID ${String(id)}`)
        categorized.add(id)
        const entry = entries.get(id)!
        if (entry.category !== undefined && entry.category !== category) return fail(`category mismatch ${id}`)
        entry.category = category
        if (row.group !== undefined) entry.group = row.group as SkillCatalogGroup
      }
    }
    for (const [id, entry] of entries) if (entry.nativeSpell && !categorized.has(id)) return fail(`uncategorized native mapping ${id}`)
  } else if ([...entries.values()].some((entry) => entry.nativeSpell)) {
    return fail('native mappings require categories')
  }
  return { featured, entries, icons }
}

export function projectCatalogEntry(catalog: SkillCatalog | null, id: string): SkillCatalogEntry | undefined {
  const entry = catalog?.entries.get(id)
  return entry ? { ...entry, nativeHints: [...entry.nativeHints] } : undefined
}
